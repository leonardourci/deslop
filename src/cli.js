#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, locations, readJson, validateConfig } from './config.js';
import { git, DeslopError } from './process.js';
import { run } from './run.js';
import { commitStatus } from './github.js';

export const SHAPE = { verdict: 'passed|failed', head: 'commit', checks: [{ name: 'tests', ok: false, log: '.deslop/runs/id/checks-0-0.log', failures: [{ test: 'test name', message: 'short failure', excerpt: 'at most 20 lines' }] }], review: { found: 1, fixed: 1, items: [{ id: 'R1', where: 'file:line', problem: 'one line', fixed: true }] }, commits: ['commit'] };
async function init({ places, options }) {
  const target = options.machine ? places.machineConfig : join(places.root, CONFIG_FILE);
  if (existsSync(target)) throw new DeslopError('CONFIG', 'Config already exists');
  const config = options.config ? readJson({ path: options.config }) : { commands: { tests: "echo 'Configure commands.tests in deslop.config.json' >&2; exit 1" }, kinds: [{ name: 'docs', match: ['**/*.md'], commands: [], checks: [], instructions: ['writing'] }, { name: 'code', match: ['**'], commands: ['tests'], checks: ['Tests'] }], checkFixAttempts: 1 };
  validateConfig({ config, root: places.root });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  console.log(`wrote: ${target}\nnext: configure commands and kinds, then commit before running deslop`);
}
async function status({ places, options }) {
  const cwd = places.root, head = await git({ cwd, args: ['rev-parse', 'HEAD'] });
  let marker;
  try { marker = JSON.parse(await git({ cwd, args: ['notes', '--ref=deslop', 'show', head] })); } catch (error) { if (error.code !== 'COMMAND' && !(error instanceof SyntaxError)) throw error; }
  const dirty = await git({ cwd, args: ['status', '--porcelain', '--untracked-files=all'] });
  const valid = !dirty && marker?.version === 1 && marker.head === head && marker.verdict === 'passed' && Array.isArray(marker.checks) && marker.checks.every(check => check?.ok === true) && marker.review && Number.isInteger(marker.review.found) && marker.review.found >= 0 && marker.review.found === marker.review.fixed;
  if (!valid) { console.log(`marker: missing or stale, head ${head}`); process.exitCode = 1; return; }
  console.log(`marker: current, head ${head}\ndetails: ${marker.run}\nshape: deslop shape\nlogs: checks[].log (full logs can be large)`);
  if (options.publish) {
    const branch = await git({ cwd, args: ['symbolic-ref', '--short', 'HEAD'] });
    try {
      const published = await commitStatus({ cwd, head, branch, state: 'success', description: 'Review fixed and checks passed' });
      console.log(`status: ${published ? 'published' : 'not published yet; push the checked commit and retry deslop status --publish'}`);
      if (!published) process.exitCode = 1;
    } catch (error) {
      if (!['COMMAND', 'ENOENT'].includes(error.code)) throw error;
      console.log('proof: local git note\nstatus: not published yet; retry deslop status --publish when GitHub recovers'); process.exitCode = 1;
    }
  }
}
export async function main({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'run';
  const options = {};
  const booleans = ['local', 'machine', 'publish', 'help'];
  const values = ['base', 'reviewer', 'reviewer-model', 'reviewer-effort', 'config'];
  while (args.length) {
    const flag = args.shift();
    if (!flag?.startsWith('--')) throw new DeslopError('USAGE', 'Expected a named option');
    const name = flag.slice(2), key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (booleans.includes(name)) options[key] = true;
    else if (values.includes(name) && args[0] && !args[0].startsWith('--')) options[key] = args.shift();
    else throw new DeslopError('USAGE', `Unknown or incomplete option: ${flag}`);
  }
  if (options.help) { console.log('deslop [run] [--local] [--base ref] [--reviewer provider] [--reviewer-model name] [--reviewer-effort effort]\ndeslop init [--machine] [--config file]\ndeslop status [--publish]\ndeslop shape'); return; }
  if (command === 'shape') { console.log(JSON.stringify(SHAPE, null, 2)); console.log('Potentially long: checks[], checks[].failures[], review.items[], commits[]. Excerpts <=20 lines. Full logs can be large.'); return; }
  const places = await locations({ cwd });
  if (command === 'init') return await init({ places, options });
  if (command === 'status') return await status({ places, options });
  if (command !== 'run') throw new DeslopError('USAGE', `Unknown command: ${command}`);
  const result = await run({ places, options });
  if (result.verdict !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); if (error.code !== 'DIRTY') console.error(`code: ${error.code || 'ERROR'}`); process.exitCode = 1; });
}
