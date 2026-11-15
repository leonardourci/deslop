import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
export function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'deslop-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'repo'), bin = join(home, 'bin'), stateFile = join(home, 'state.json');
  mkdirSync(root); mkdirSync(bin);
  const gitBin = process.env.PATH.split(delimiter).map(path => join(path, 'git')).find(path => existsSync(path));
  symlinkSync(gitBin, join(bin, 'git')); symlinkSync(process.execPath, join(bin, 'node'));
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', PATH: bin, TMPDIR: home, TMP: home, TEMP: home, DESLOP_TEST_STATE: stateFile };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const save = value => writeFileSync(stateFile, JSON.stringify({ ...value, github: [] }));
  const load = () => ({ ...JSON.parse(readFileSync(stateFile, 'utf8')), github: readdirSync(home).filter(name => name.startsWith('gh-call-')).map(name => JSON.parse(readFileSync(join(home, name), 'utf8'))) });
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture change'); return git('rev-parse', 'HEAD'); };
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'base.txt'), 'base'); const base = commit(); git('switch', '-c', 'change');
  const agent = join(home, 'agent.cjs');
  const agentSource = `#!/usr/bin/env node
const fs=require('node:fs'), cp=require('node:child_process'); const path=process.env.DESLOP_TEST_STATE; let prompt=''; process.stdin.on('data',v=>prompt+=v); process.stdin.on('end',()=>{ const state=JSON.parse(fs.readFileSync(path)); state.calls.push({prompt,args:process.argv.slice(2),model:process.env.DESLOP_REVIEWER_MODEL,effort:process.env.DESLOP_REVIEWER_EFFORT,parent:process.env.CODEX_THREAD_ID}); const action=state.actions.shift()||{}; if(action.edit)fs.writeFileSync('work.txt',action.edit); if(action.newFile)fs.writeFileSync(action.newFile.path,action.newFile.content); if(action.checks)state.checks=action.checks; if(action.git)cp.execFileSync('git',['commit','--allow-empty','-m','agent must not commit']); fs.writeFileSync(path,JSON.stringify(state)); const value=action.invalid?{wrong:true}:{items:action.items||[],sessionId:'session-fixture'}; const args=process.argv.slice(2); if(args.includes('--output-last-message')){fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(value));console.log(JSON.stringify({type:'thread.started',thread_id:'session-fixture'}));}else if(args.includes('--output-format'))console.log(JSON.stringify({structured_output:value,session_id:'session-fixture'}));else console.log(JSON.stringify(value)); });`;
  writeFileSync(agent, agentSource, { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), agentSource, { mode: 0o755 }); writeFileSync(join(bin, 'claude'), agentSource, { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('node:fs');const path=process.env.DESLOP_TEST_STATE,args=process.argv.slice(2),s=JSON.parse(fs.readFileSync(path));fs.writeFileSync(require('node:path').join(require('node:path').dirname(path),'gh-call-'+process.pid+'-'+require('node:crypto').randomUUID()),JSON.stringify(args));
if(args[0]==='pr'){if(!s.pr){console.error('no pull request');process.exit(1)}console.log(JSON.stringify(s.pr));}
else if(args[0]==='repo')console.log(JSON.stringify({nameWithOwner:'example/project'}));
else if(args.includes('--method')){if(s.publicationOutage){console.error('GitHub unavailable');process.exit(1)}console.log('{}');}
else if(args.some(a=>a.includes('/check-runs?')))console.log(JSON.stringify([{check_runs:s.checks}]));
else if(args.some(a=>a.includes('/statuses?')))console.log('[[]]');
else if(args[0]==='run')console.log('FAIL synthetic CI failure\\nassertion failed');
else {console.error('unexpected gh args');process.exit(2)}
`, { mode: 0o755 });
  save({ actions: [], calls: [], github: [], checks: [{ id: 1, name: 'Tests', status: 'completed', conclusion: 'success' }] });
  const config = { commands: { tests: 'node check.cjs' }, kinds: [{ name: 'code', match: ['**'], commands: ['tests'], checks: ['Tests'] }], reviewers: { fixture: { command: ['node', agent], resume: ['node', agent, '--resume', '{sessionId}'] } } };
  const configure = () => writeFileSync(join(root, 'deslop.config.json'), JSON.stringify(config));
  configure(); writeFileSync(join(root, 'work.txt'), 'good'); writeFileSync(join(root, 'check.cjs'), "if(require('node:fs').readFileSync('work.txt','utf8')!=='good'){console.error('FAIL work: expected good\\n'+Array(40).fill('failure detail').join('\\n'));process.exit(1)}console.log('passed')"); commit();
  const call = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
  const runs = () => readdirSync(join(root, '.deslop', 'runs')).map(id => JSON.parse(readFileSync(join(root, '.deslop', 'runs', id, 'run.json'), 'utf8')));
  const push = () => { const remote = join(home, 'remote.git'); execFileSync('git', ['init', '--bare', remote], { env, stdio: 'ignore' }); git('remote', 'add', 'origin', remote); git('push', 'origin', `${base}:refs/heads/main`); git('push', '-u', 'origin', 'HEAD:refs/heads/change'); git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'); };
  return { home, root, bin, gitBin, env, config, configure, git, commit, call, load, save, runs, push, cli };
}
