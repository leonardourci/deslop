#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE, WORKFLOW_FILE, locations, loadConfig, loadSettings, readJson, validateConfig } from './config.js';
import { git, VerifyError } from './process.js';
import { markerFromBody, markerWorkflow, pullRequest, validMarker } from './github.js';
import { readState, run } from './run.js';

const HELP = `verify init (--repo | --machine) [--mode ci|local] [--config <file>]
verify run [--local] [--reviewer <name>] [--reviewer-model <model>] [--reviewer-effort <effort>] [--decline "R1: reason"]
verify status

init writes a repo config with its marker workflow, or a machine-only config.
run performs the selected checks and one fresh review; findings prevent a marker.
status reads the exact commit marker on the pull request.`;

export function parseArgs({ args }) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') return { command: 'help', options: {} };
  const allowed = {
    init: { '--repo': false, '--machine': false, '--mode': true, '--config': true },
    run: { '--local': false, '--reviewer': true, '--reviewer-model': true, '--reviewer-effort': true, '--decline': true },
    status: {},
  }[command];
  if (!allowed) throw new VerifyError('USAGE', HELP);
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (!Object.hasOwn(allowed, flag)) throw new VerifyError('USAGE', `Unknown option ${flag}\n${HELP}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    let value = true;
    if (allowed[flag]) {
      value = rest[++index];
      if (!value || value.startsWith('--')) throw new VerifyError('USAGE', `${flag} needs a value`);
    }
    if (key === 'decline') {
      if (!options.decline) options.decline = [];
      options.decline.push(value);
    } else {
      if (options[key] !== undefined) throw new VerifyError('USAGE', `Repeated option ${flag}`);
      options[key] = value;
    }
  }
  return { command, options };
}

export function init({ places, options }) {
  loadSettings({ home: places.home });
  if (Boolean(options.repo) === Boolean(options.machine)) throw new VerifyError('USAGE', 'Choose exactly one: --repo or --machine');
  const workflowPath = join(places.root, WORKFLOW_FILE);
  const configPath = options.repo ? join(places.root, CONFIG_FILE) : places.machineConfig;
  if (existsSync(configPath) || options.repo && existsSync(workflowPath)) throw new VerifyError('CONFIG', 'Config or workflow already exists; edit it explicitly');
  if (options.machine && existsSync(join(places.root, CONFIG_FILE))) throw new VerifyError('CONFIG', 'Repo config takes precedence; edit it instead');
  const workflows = join(places.root, '.github', 'workflows');
  const hasCI = existsSync(workflows) && readdirSync(workflows).some(file => /\.ya?ml$/.test(file));
  const mode = options.mode || (hasCI ? 'ci' : 'local');
  const config = options.config ? readJson({ path: options.config }) : {
    mode, localRunCounts: true, decline: 'agent',
    steps: { tests: "echo 'Configure the tests step in verify.config.json' >&2; exit 1" },
    kinds: [
      { name: 'docs', match: ['**/*.md'], steps: [], checks: [], skills: [] },
      { name: 'code', match: ['**'], steps: ['tests'], checks: 'all', skills: [] },
    ], skills: {},
  };
  if (options.mode) config.mode = options.mode;
  validateConfig({ root: places.root, config });
  mkdirSync(dirname(configPath), { recursive: true });
  if (options.repo) {
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, markerWorkflow(), { flag: 'wx' });
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  console.log(`wrote: ${configPath}${options.repo ? `, ${workflowPath}` : ''}\nhelp: Configure steps and skills, ${options.repo ? 'commit both files, ' : ''}then run verify run`);
}

export async function status({ places }) {
  const config = loadConfig({ places });
  loadSettings({ home: places.home });
  const pr = await pullRequest({ cwd: places.root });
  const marker = markerFromBody({ body: pr.body });
  const head = await git({ cwd: places.root, args: ['rev-parse', 'HEAD'] });
  const dirty = await git({ cwd: places.root, args: ['status', '--porcelain', '--untracked-files=all'] });
  const current = !dirty && validMarker({ marker, head: pr.headRefOid, localRunCounts: config.localRunCounts !== false }) && head === pr.headRefOid;
  console.log(`marker: ${current ? 'current' : 'missing or stale'}, head ${pr.headRefOid}`);
  if (dirty) console.log('worktree: uncommitted changes');
  if (marker) {
    console.log(`steps: ${marker.mode === 'local' ? 'ran locally' : 'ran in ci'}\nreview: ${JSON.stringify(marker.review)}\nfixed: ${JSON.stringify(marker.fixed || [])}\ndeclined: ${JSON.stringify(marker.declined || [])}\nrestarts: ${JSON.stringify(marker.restarts || [])}`);
  }
  if (!current) {
    const saved = Object.values(readState({ file: places.state })).filter(entry => entry.pr === pr.url).sort((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt)).at(-1);
    if (saved?.round >= 3 && saved.findings.length) console.log('review: stopped after three rounds\nhelp: An owner must comment: verify restart review: <reason>');
    if (saved) console.log(`last run head: ${saved.head}\nlast run: ${saved.mode === 'local' ? 'ran locally' : 'ran in ci'}\nreview: ${saved.reviewer}, round ${saved.round}\nfindings: ${JSON.stringify(saved.findings)}\ndeclined: ${JSON.stringify(saved.declines)}\nrestarts: ${JSON.stringify(saved.restarts || [])}`);
  }
  console.log(`help: ${current ? 'Ready for the owner to merge' : 'Run verify run on the clean, pushed PR head'}`);
  return current;
}

export async function main({ args = process.argv.slice(2), cwd = process.cwd(), env = process.env } = {}) {
  const { command, options } = parseArgs({ args });
  if (command === 'help') { console.log(HELP); return 0; }
  const places = await locations({ cwd, env });
  if (command === 'init') { init({ places, options }); return 0; }
  if (command === 'status') return await status({ places }) ? 0 : 1;
  await run({ places, options, env });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`error: ${error.message}\ncode: ${error.code || 'VERIFY'}`); process.exitCode = 1; }
}
