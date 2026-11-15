import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './fixtures.js';
function passed(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function failed(result, code) { assert.notEqual(result.status, 0, result.stdout); assert.match(result.stderr, new RegExp(`code: ${code}`)); }
const finding = { id: 'R1', where: 'work.txt:1', problem: 'bad content', fixed: true };

test('commits review edits before checks and marks the final local commit without any PR', t => {
  const f = fixture(t); const s = f.load(); s.actions = [{ edit: 'good', items: [finding] }]; f.save(s);
  writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit(); const initial = f.git('rev-parse', 'HEAD');
  passed(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD'), data = f.runs()[0];
  assert.notEqual(head, initial); assert.deepEqual(data.commits, [head]); assert.equal(data.review.fixed, 1); assert.equal(data.checks[0].ok, true);
  assert.match(f.git('log', '-1', '--format=%s'), /^deslop: fix review findings$/);
  assert.equal(JSON.parse(f.git('notes', '--ref=deslop', 'show', head)).head, head);
  assert.equal(f.git('status', '--porcelain'), ''); passed(f.call('status'));
  const state = f.load(); assert.equal(state.calls.length, 1); assert.match(state.calls[0].prompt, /No check results are supplied/); assert.match(state.calls[0].prompt, /Never require|never demand/);
  assert.equal(state.github.some(args => args.includes('--method')), false);
  writeFileSync(join(f.root, 'new.txt'), 'new'); f.commit(); assert.equal(f.call('status').status, 1);
});

test('failed checks resume the same session and produce bounded failure excerpts and full logs', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit();
  const s = f.load(); s.actions = [{}, { edit: 'good', items: [finding] }]; f.save(s);
  passed(f.call('--reviewer', 'fixture'));
  const calls = f.load().calls, data = f.runs()[0];
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, ['--resume', 'session-fixture']);
  assert.match(calls[1].prompt, /FAIL work/);
  assert.equal(data.checks[0].ok, false); assert.equal(data.checks[1].ok, true);
  assert.ok(data.checks[0].failures[0].excerpt.split('\n').length <= 20);
  assert.ok(readFileSync(join(f.root, data.checks[0].log), 'utf8').split('\n').length > 20);
  passed(f.call('status')); assert.equal(data.commits.length, 1); assert.equal(f.git('log', '-1', '--format=%s'), 'deslop: fix failing checks');
});

test('attempt limits return failures without proof and zero makes no check-fix call', t => {
  const f = fixture(t); f.config.checkFixAttempts = 0; f.configure(); writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1); assert.equal(f.load().calls.length, 1); assert.equal(f.runs()[0].verdict, 'failed'); assert.equal(f.call('status').status, 1);
  f.config.checkFixAttempts = 2; f.configure(); f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1); assert.equal(f.load().calls.length, 4); assert.equal(f.call('status').status, 1);
});

test('dirty work is refused in one line before any agent call and default branches are refused', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'untracked'), 'dirty');
  const result = f.call('run', '--reviewer', 'fixture'); assert.equal(result.stderr.trim(), 'commit or stash your changes first'); assert.equal(f.load().calls.length, 0);
  rmSync(join(f.root, 'untracked')); f.git('switch', 'main'); failed(f.call('run', '--reviewer', 'fixture'), 'BRANCH');
});

test('an agent trying to commit is detected and cannot receive a marker or push', t => {
  const f = fixture(t); const s = f.load(); s.actions = [{ git: true }]; f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'AGENT_GIT');
  assert.equal(f.runs()[0].verdict, 'failed'); assert.equal(f.runs()[0].commits.length, 0); assert.equal(f.call('status').status, 1);
  assert.equal(f.load().github.some(args => args.includes('--method')), false);
});

test('pushed CI runs push only review fixes and publish an exact-head status without a PR', t => {
  const f = fixture(t); f.push(); const initial = f.git('rev-parse', 'HEAD');
  const s = f.load(); s.actions = [{ edit: 'better', items: [finding] }]; f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD'); assert.notEqual(head, initial);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0], head);
  const calls = f.load().github;
  assert.ok(calls.some(args => args.includes(`repos/example/project/commits/${head}/check-runs?per_page=100`)));
  assert.ok(calls.some(args => args.includes(`repos/example/project/statuses/${head}`) && args.includes('state=success')));
  assert.equal(f.runs()[0].checks[0].name, 'Tests');
  const red = f.load(); red.checks[0].conclusion = 'failure'; f.save(red);
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(f.call('status').status, 1);
});

test('local override keeps fix commits local even when the starting commit was pushed', t => {
  const f = fixture(t); f.push(); const initial = f.git('rev-parse', 'HEAD');
  const s = f.load(); s.actions = [{ edit: 'good', items: [finding] }]; f.save(s);
  writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit(); f.git('push', 'origin', 'HEAD:refs/heads/change'); const pushed = f.git('rev-parse', 'HEAD');
  passed(f.call('run', '--local', '--reviewer', 'fixture')); assert.notEqual(f.git('rev-parse', 'HEAD'), initial);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0], pushed);
  assert.equal(f.load().github.some(args => args.includes('state=success')), false);
});

test('providers deny git tools, retain sessions, detect hosted Codex and apply model precedence', t => {
  const f = fixture(t); f.env.CODEX_THREAD_ID = 'hosted';
  f.config.reviewerModels = { codex: { model: 'repo', effort: 'high' } }; f.configure(); writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit();
  const s = f.load(); s.actions = [{}, { edit: 'good', items: [finding] }]; f.save(s);
  passed(f.call('run', '--reviewer-model', 'run'));
  const calls = f.load().calls;
  assert.ok(calls[0].args.includes('features.shell_tool=false')); assert.ok(calls[0].args.includes('sandbox_mode="workspace-write"'));
  assert.ok(calls[0].args.includes('run')); assert.ok(calls[0].args.includes('model_reasoning_effort="high"'));
  assert.ok(calls[1].args.includes('resume')); assert.ok(calls[1].args.includes('session-fixture')); assert.equal(calls[0].parent, undefined);
  passed(f.call('run', '--reviewer', 'claude'));
  const claude = f.load().calls.at(-1); assert.ok(claude.args.includes('Read,Glob,Grep,Edit,Write')); assert.match(claude.args[claude.args.indexOf('--settings')+1], /Write\(\*\*\/\.git/); assert.ok(claude.args.includes('--session-id'));
});

test('custom commands without resume get a fresh call explaining earlier commits', t => {
  const f = fixture(t); delete f.config.reviewers.fixture.resume; f.configure(); writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit();
  const s = f.load(); s.actions = [{}, { edit: 'good', items: [finding] }]; f.save(s);
  passed(f.call('run', '--reviewer', 'fixture')); assert.match(f.load().calls[1].prompt, /Fresh fallback call/); assert.deepEqual(f.load().calls[1].args, []);
});

test('invalid agent output and unfixed items cannot create proof', t => {
  const f = fixture(t); let s = f.load(); s.actions = [{ invalid: true }]; f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'REVIEW_OUTPUT'); assert.equal(f.call('status').status, 1);
  s = f.load(); s.actions = [{ items: [{ ...finding, fixed: false }] }]; f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'UNFIXED'); assert.equal(f.call('status').status, 1);
});

test('base override wins over an open stacked PR base and no PR falls back locally', t => {
  const f = fixture(t); f.git('branch', 'parent'); writeFileSync(join(f.root, 'later.txt'), 'later'); f.commit();
  const s = f.load(); s.pr = { state: 'OPEN', baseRefName: 'parent' }; f.save(s);
  passed(f.call('run', '--reviewer', 'fixture')); assert.doesNotMatch(f.load().calls[0].prompt, /diff --git a\/work.txt/);
  passed(f.call('run', '--base', 'main', '--reviewer', 'fixture')); assert.match(f.load().calls[1].prompt, /diff --git a\/work.txt/);
});

test('init creates config without a workflow, repo wins, and shape works outside a repository', t => {
  const f = fixture(t); rmSync(join(f.root, 'deslop.config.json')); f.commit();
  passed(f.call('init', '--machine')); assert.equal(existsSync(join(f.root, 'deslop.config.json')), false);
  passed(f.call('init')); assert.equal(existsSync(join(f.root, '.github/workflows')), false);
  failed(f.call('init'), 'CONFIG');
  const result = spawnSync(process.execPath, [f.cli, 'shape'], { cwd: f.home, env: f.env, encoding: 'utf8' }); passed(result); assert.match(result.stdout, /Potentially long/); assert.match(result.stdout, /20 lines/);
});

test('installed executable symlinks invoke the command and removed flags are rejected', t => {
  const f = fixture(t); const bin = join(f.home, 'installed'); symlinkSync(f.cli, bin);
  passed(spawnSync(process.execPath, [bin, 'shape'], { cwd: f.home, env: f.env, encoding: 'utf8' }));
  failed(f.call('run', '--mode', 'local'), 'USAGE'); failed(f.call('run', '--decline', 'R1:reason'), 'USAGE'); failed(f.call('run', '--skip', 'tests'), 'USAGE');
});


test('failed CI resumes the agent, pushes only its fix and waits on the new exact head', t => {
  const f = fixture(t); f.push(); const initial = f.git('rev-parse', 'HEAD');
  const s = f.load(); s.checks[0].conclusion = 'failure'; s.actions = [{}, { edit: 'good\n', items: [finding], checks: [{ id: 2, name: 'Tests', status: 'completed', conclusion: 'success' }] }]; f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD'); assert.notEqual(head, initial);
  assert.deepEqual(f.load().calls[1].args, ['--resume', 'session-fixture']);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0], head);
  assert.ok(f.load().github.some(args => args.includes(`repos/example/project/commits/${head}/check-runs?per_page=100`)));
  passed(f.call('status'));
});

test('unavailable providers fall back with their own models rather than the primary override', t => {
  const f = fixture(t); f.config.reviewers.missing = { command: ['missing-agent'] }; f.config.reviewerModels = { fixture: { model: 'fallback-model', effort: 'low' } }; f.configure(); f.commit();
  mkdirSync(join(f.home, 'config/deslop'), { recursive: true }); writeFileSync(join(f.home, 'config/deslop/settings.json'), JSON.stringify({ reviewer: ['missing', 'fixture'] }));
  passed(f.call('run', '--reviewer-model', 'primary-model', '--reviewer-effort', 'high'));
  assert.equal(f.load().calls[0].model, 'fallback-model'); assert.equal(f.load().calls[0].effort, 'low');
});
