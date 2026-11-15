import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, VerifyError } from './process.js';
import { loadConfig, loadSettings, select } from './config.js';
import { clearMarker, pullRequest, waitForChecks, writeMarker } from './github.js';
import { reviewerChoices, reviewPrompt, review } from './review.js';
import { exclusiveRun, localSlot, runSteps } from './local.js';
import { declinesFor, findingKey, restartFor } from './declines.js';
import { binaryEvidence, BINARY_NOTE } from './binary.js';

const MAX_ROUNDS = 3;

export function readState({ file }) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new VerifyError('STATE', `Invalid run state at ${file}; inspect it before retrying`); }
}

function saveState({ file, state }) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

export async function cleanHead({ cwd, head }) {
  const [after, dirty] = await Promise.all([
    git({ cwd, args: ['rev-parse', 'HEAD'] }),
    git({ cwd, args: ['status', '--porcelain', '--untracked-files=all'] }),
  ]);
  if (after !== head || dirty) throw new VerifyError('HEAD_CHANGED', 'Commit all changes and rerun verify on a clean, unchanged HEAD');
}

export async function run({ places, options, env = process.env }) {
  return await exclusiveRun({ file: `${places.state}.sqlite`, work: async () => await performRun({ places, options, env }) });
}

async function performRun({ places, options, env }) {
  const cwd = places.root;
  const head = await git({ cwd, args: ['rev-parse', 'HEAD'] });
  const pr = await pullRequest({ cwd });
  if (pr.headRefOid !== head) throw new VerifyError('HEAD_CHANGED', 'Push HEAD to the pull request before verification');
  await clearMarker({ cwd, head });
  const config = loadConfig({ places });
  const settings = loadSettings({ home: places.home });
  const choices = reviewerChoices({ override: options.reviewer, settings, env });
  const mode = options.local ? 'local' : config.mode;
  if (mode === 'local' && config.mode === 'ci' && config.localRunCounts === false) throw new VerifyError('LOCAL_REFUSED', 'This repository requires CI verification');
  await cleanHead({ cwd, head });
  const base = await git({ cwd, args: ['merge-base', head, pr.baseRefOid] });
  const paths = (await git({ cwd, args: ['diff', '--name-only', '--no-renames', '-z', base, head] })).split('\0').filter(Boolean);
  const selection = select({ config, paths });
  const binaryFiles = await binaryEvidence({ cwd, base, head });
  if (binaryFiles.length && config.binary === 'fail') throw new VerifyError('BINARY_EVIDENCE', `Unsupported binary content evidence: ${binaryFiles.map(file => file.path).join(', ')}`);
  const skills = selection.skills.map(name => `${name}:\n${readFileSync(resolve(cwd, config.skills[name]), 'utf8')}`).join('\n\n');
  const signature = createHash('sha256').update(JSON.stringify({ config, skills, base: pr.baseRefOid })).digest('hex');
  const allState = readState({ file: places.state });
  const key = pr.url;
  let previous = allState[key];
  const restarts = [...(previous?.restarts || [])];
  if (previous?.findings?.length && previous.round >= MAX_ROUNDS) {
    restarts.push(await restartFor({ cwd, config, pr, previous }));
    previous = null;
  }
  if (previous?.head === head && previous.findings?.length && !options.decline?.length && config.decline !== 'owner') throw new VerifyError('FINDINGS', 'Fix the reported findings, commit and run again; or decline with visible reasons');
  const declines = await declinesFor({ cwd, config, pr, previous: previous?.findings || [], arguments: options.decline });
  const round = previous?.findings?.length ? previous.round + 1 : 1;
  const diff = await git({ cwd, args: ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', base, head] });
  let fixDiff = '';
  let narrow = round > 1 && previous.signature === signature;
  if (narrow) {
    try { await git({ cwd, args: ['merge-base', '--is-ancestor', previous.head, head] }); }
    catch { narrow = false; }
  }
  if (narrow) fixDiff = await git({ cwd, args: ['diff', '--no-ext-diff', '--no-textconv', previous.head, head] });
  console.log(`change: ${selection.kinds.join(', ')}; ${paths.length} files\nsteps: ${mode === 'local' ? 'ran locally' : 'waiting for GitHub CI'}, head ${head}`);
  let stepNames;
  if (mode === 'local') {
    stepNames = await localSlot({ home: places.home, limit: settings.maxLocalRuns, work: async () => await runSteps({ cwd, names: selection.steps, commands: config.steps, assertHead: async () => await cleanHead({ cwd, head }) }) });
  } else stepNames = await waitForChecks({ cwd, head, names: selection.checks });
  await cleanHead({ cwd, head });
  const result = await review({ cwd, choices, config, settings,
    prompt: reviewPrompt({ diff, skills, previous: narrow ? previous.findings : null, fixDiff, declines: [...(previous?.declines || []), ...declines], binaryFiles }),
    model: options.reviewerModel, effort: options.reviewerEffort, env });
  await cleanHead({ cwd, head });
  if ((await pullRequest({ cwd })).headRefOid !== head) throw new VerifyError('HEAD_CHANGED', 'PR head changed during review');
  const reportedAt = new Date().toISOString();
  const remaining = result.findings.filter(finding => !declines.some(decline => decline.finding === findingKey({ finding })));
  const state = { binaryFiles, signature, restarts, pr: pr.url, finishedAt: reportedAt, head, round, mode, steps: stepNames, reviewer: result.provider, model: result.choice,
    findings: remaining.map(finding => ({ ...finding, reportedAt })), declines: [...(previous?.declines || []), ...declines],
    fixed: [...(previous?.fixed || []), ...(previous?.findings?.filter(finding => !remaining.some(item => item.id === finding.id) && !declines.some(item => item.id === finding.id)).map(finding => finding.id) || [])] };
  allState[key] = state;
  saveState({ file: places.state, state: allState });
  console.log(`review: ${result.provider}, round ${round}\nfindings: ${JSON.stringify(remaining)}`);
  if (remaining.length) throw new VerifyError(round >= MAX_ROUNDS ? 'OWNER_REQUIRED' : 'FINDINGS', round >= MAX_ROUNDS ? 'Three rounds are not clean; ask the owner. No marker written.' : 'Fix every finding, commit and run verify run again. No marker written.');
  const marker = { binaryFiles, version: 1, head, mode, finishedAt: reportedAt,
    steps: { passed: true, names: stepNames }, review: { clean: true, provider: result.provider, round, ...result.choice },
    fixed: state.fixed, declined: state.declines, restarts };
  if (binaryFiles.length) marker.binaryNote = BINARY_NOTE;
  await writeMarker({ cwd, head, marker });
  console.log(`marker: written for ${head}\nhelp: Ready for the owner to merge`);
  return marker;
}
