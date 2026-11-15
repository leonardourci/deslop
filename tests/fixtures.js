import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

export function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'verify-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'repo');
  const bin = join(home, 'bin');
  mkdirSync(root); mkdirSync(bin);
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, 'config'), PATH: `${bin}:${process.env.PATH}`, VERIFY_TEST_STATE: join(home, 'github.json') };
  for (const key of Object.keys(env)) if (/^(PNYX_|CODEX_|CLAUDE)/.test(key)) delete env[key];
  function git(...args) { return execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim(); }
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD'); git('switch', '-c', 'change');
  const external = join(home, 'reviewer.cjs');
  writeFileSync(external, `const fs = require('node:fs'); const state = JSON.parse(fs.readFileSync(process.env.VERIFY_TEST_STATE)); let prompt='';process.stdin.on('data',chunk=>prompt+=chunk);process.stdin.on('end',()=>{state.prompts ||= [];state.prompts.push(prompt); state.reviewEnvs ||= []; state.reviewEnvs.push({model:process.env.VERIFY_REVIEWER_MODEL,effort:process.env.VERIFY_REVIEWER_EFFORT,worker:process.env.PNYX_ACTOR,thread:process.env.CODEX_THREAD_ID});const result=state.reviews.shift() || {findings:[]};fs.writeFileSync(process.env.VERIFY_TEST_STATE, JSON.stringify(state)); console.log(JSON.stringify(result));});`);
  const config = { mode: 'local', steps: { test: `${JSON.stringify(process.execPath)} -e "process.exit(0)"` },
    kinds: [{ name: 'code', match: ['**'], steps: ['test'], checks: ['Tests'], skills: [] }], skills: {}, reviewers: { fixture: { command: [process.execPath, external] } } };
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);const path=process.env.VERIFY_TEST_STATE;const state=JSON.parse(fs.readFileSync(path));state.calls ||= [];state.calls.push(args);fs.writeFileSync(path,JSON.stringify(state));
if(args[0]==='pr'&&args[1]==='view'){console.log(JSON.stringify(state.pr));}
else if(args[0]==='pr'&&args[1]==='edit'){let body='';process.stdin.on('data',chunk=>body+=chunk);process.stdin.on('end',()=>{state.pr.body=body;fs.writeFileSync(path,JSON.stringify(state));});}
else if(args[0]==='repo'){console.log(JSON.stringify({nameWithOwner:'example/project',owner:{login:'example'}}));}
else if(args.includes('users/example')) console.log(JSON.stringify({type:state.ownerType || 'User'}));
else if(args.some(arg=>arg.endsWith('/comments?per_page=100'))) console.log(JSON.stringify([state.comments||[]]));
else if(args.some(arg=>arg.includes('/check-runs?'))) console.log(JSON.stringify([{check_runs:state.checks||[]}]));
else if(args.some(arg=>arg.includes('/statuses?'))) console.log(JSON.stringify([state.statuses||[]]));
else {console.error('unexpected gh '+JSON.stringify(args));process.exit(3);}
`, { mode: 0o755 });
  const state = { pr: { number: 1, url: 'https://github.com/example/project/pull/1', state: 'OPEN', headRefOid: '', baseRefOid: base, body: 'A useful change.' }, reviews: [] };
  function save(value = state) { writeFileSync(env.VERIFY_TEST_STATE, JSON.stringify(value)); }
  function load() { return JSON.parse(readFileSync(env.VERIFY_TEST_STATE, 'utf8')); }
  function commit() { git('add', '.'); git('commit', '-m', 'change'); const next = load(); next.pr.headRefOid = git('rev-parse', 'HEAD'); save(next); }
  function call(...args) { return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' }); }
  function configure() { writeFileSync(join(root, 'verify.config.json'), JSON.stringify(config)); mkdirSync(join(root, '.github/workflows'), { recursive: true }); writeFileSync(join(root, '.github/workflows/verify.yml'), 'name: Verify\n'); }
  save(); configure(); writeFileSync(join(root, 'work.txt'), 'new\n'); commit();
  return { root, home, env, git, config, save, load, commit, call, configure };
}
