import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';

function passed(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function failed(result, code) { assert.notEqual(result.status, 0, result.stdout); assert.match(result.stderr, new RegExp(`code: ${code}`)); }

test('local run reviews clean committed work, records evidence and makes every new commit stale', t => {
  const f = fixture(t);
  f.env.PNYX_ACTOR = 'worker:fixture'; f.env.CODEX_THREAD_ID = 'hosted-fixture';
  f.config.reviewerModels = { fixture: { model: 'repo-model', effort: 'low' } }; f.configure(); f.commit();
  mkdirSync(join(f.home, 'config/verify'), { recursive: true });
  writeFileSync(join(f.home, 'config/verify/settings.json'), JSON.stringify({ reviewer: 'fixture', reviewerModels: { fixture: { model: 'machine-model' } } }));
  passed(f.call('run', '--reviewer-model', 'run-model'));
  const state = f.load();
  assert.match(state.pr.body, /"head":"[a-f0-9]+"/);
  assert.match(state.pr.body, /"mode":"local"/);
  assert.equal(state.prompts.length, 1);
  assert.match(state.prompts[0], /full branch review/);
  assert.match(state.prompts[0], /work.txt/);
  assert.deepEqual(state.reviewEnvs, [{ model: 'run-model', effort: 'low' }]);
  passed(f.call('status'));
  writeFileSync(join(f.root, 'README.md'), 'docs changed\n'); f.commit();
  assert.equal(f.call('status').status, 1);
  writeFileSync(join(f.root, 'dirty.txt'), 'dirty');
  failed(f.call('run'), 'HEAD_CHANGED');
  assert.equal(f.load().prompts.length, 1);
});

test('findings go back to the working agent, then a narrow review records fixed findings', t => {
  const f = fixture(t);
  const state = f.load(); state.reviews = [{ findings: [{ id: 'R1', where: 'work.txt:1', problem: 'Wrong content', fix: 'Use fixed content' }] }, { findings: [] }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  assert.doesNotMatch(f.load().pr.body, /verify:v1/);
  writeFileSync(join(f.root, 'work.txt'), 'fixed content\n'); f.commit();
  passed(f.call('run', '--reviewer', 'fixture'));
  const after = f.load();
  assert.match(after.prompts[1], /narrow follow-up/);
  assert.match(after.prompts[1], /fixed content/);
  assert.match(after.pr.body, /"round":2/);
  assert.match(f.call('status').stdout, /fixed: \["R1"\]/);
});

test('a failed local step or invalid reviewer output cannot write proof', t => {
  const f = fixture(t);
  f.config.steps.test = `${JSON.stringify(process.execPath)} -e "process.exit(1)"`; f.configure(); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'COMMAND');
  assert.equal(f.load().prompts, undefined);
  f.config.steps.test = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`; f.configure(); f.commit();
  const state = f.load(); state.reviews = [{ clean: true }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'REVIEW_OUTPUT');
  assert.doesNotMatch(f.load().pr.body, /verify:v1/);
});

test('CI waits only for selected exact-head checks and local fallback is visibly recorded or refused', t => {
  const f = fixture(t); f.config.mode = 'ci'; f.configure(); f.commit();
  const state = f.load(); state.checks = [{ id: 1, name: 'Tests', status: 'completed', conclusion: 'success' }, { id: 2, name: 'verify', status: 'queued' }, { id: 3, name: 'Unrelated', status: 'completed', conclusion: 'failure' }]; f.save(state);
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.match(f.load().pr.body, /"mode":"ci"/);
  passed(f.call('run', '--local', '--reviewer', 'fixture'));
  assert.match(f.call('status').stdout, /ran locally/);
  f.config.localRunCounts = false; f.configure(); f.commit();
  failed(f.call('run', '--local', '--reviewer', 'fixture'), 'LOCAL_REFUSED');
  const failing = f.load(); failing.checks[0].conclusion = 'failure'; f.save(failing);
  failed(f.call('run', '--reviewer', 'fixture'), 'CI_FAILED');
});

test('configuration and unsupported switches fail before steps or reviews', t => {
  const f = fixture(t);
  failed(f.call('run', '--only', 'tests'), 'USAGE');
  failed(f.call('run', '--skip', 'review'), 'USAGE');
  failed(f.call('run'), 'REVIEWER');
  f.config.kinds[0].steps = ['missing']; f.configure(); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'CONFIG');
  f.config.kinds[0].steps = ['test']; f.config.kinds[0].skills = ['missing']; f.configure(); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'CONFIG');
  f.config.kinds[0].skills = []; f.config.kinds[0].checks = ['verify']; f.configure(); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'CONFIG');
  assert.equal(f.load().prompts, undefined);
});

test('init writes both repo files, machine init writes only config, and existing files survive', t => {
  const f = fixture(t);
  rmSync(join(f.root, 'verify.config.json')); rmSync(join(f.root, '.github'), { recursive: true });
  passed(f.call('init', '--machine'));
  assert.equal(existsSync(join(f.root, 'verify.config.json')), false);
  assert.equal(existsSync(join(f.root, '.github')), false);
  passed(f.call('init', '--repo'));
  assert.equal(JSON.parse(readFileSync(join(f.root, 'verify.config.json'), 'utf8')).mode, 'local');
  const workflow = readFileSync(join(f.root, '.github/workflows/verify.yml'), 'utf8');
  assert.match(workflow, /pull_request_target/); assert.doesNotMatch(workflow, /actions\/checkout/);
  failed(f.call('init', '--repo'), 'CONFIG');
  assert.equal(readFileSync(join(f.root, '.github/workflows/verify.yml'), 'utf8'), workflow);
});

test('visible agent declines are recorded; owner-only declines reject overrides and unauthorized comments', t => {
  const f = fixture(t);
  const finding = { id: 'R1', where: 'work.txt:1', problem: 'Intentional choice', fix: 'Change it' };
  let state = f.load(); state.reviews = [{ findings: [finding] }, { findings: [] }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  passed(f.call('run', '--reviewer', 'fixture', '--decline', 'R1: Required by the contract'));
  assert.match(f.call('status').stdout, /Required by the contract/);
  f.config.decline = 'owner'; f.configure(); f.commit();
  state = f.load(); state.reviews = [{ findings: [finding] }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture', '--decline', 'R1: agent says so'), 'DECLINE');
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  state = f.load(); state.reviews = [{ findings: [finding] }]; state.comments = [{ user: { login: 'outsider' }, body: 'verify decline R1: forged', created_at: new Date(Date.now() + 1000).toISOString(), html_url: 'https://example.invalid/comment' }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  state = f.load(); state.reviews = [{ findings: [] }]; state.comments = [{ user: { login: 'example' }, body: 'verify decline R1: Owner accepts this', created_at: new Date(Date.now() + 1000).toISOString(), html_url: 'https://example.invalid/owner-comment' }]; f.save(state);
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.match(f.call('status').stdout, /"by":"example"/);
  assert.match(f.call('status').stdout, /Owner accepts this/);
});

test('three unresolved reviews stop and require owner intervention', t => {
  const f = fixture(t);
  const finding = { id: 'R1', where: 'work.txt:1', problem: 'Still broken', fix: 'Fix it' };
  const state = f.load(); state.reviews = [{ findings: [finding] }, { findings: [finding] }, { findings: [finding] }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  writeFileSync(join(f.root, 'work.txt'), 'attempt two'); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  writeFileSync(join(f.root, 'work.txt'), 'attempt three'); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'OWNER_REQUIRED');
  writeFileSync(join(f.root, 'work.txt'), 'attempt four'); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'OWNER_REQUIRED');
  assert.equal(f.load().prompts.length, 3);
  assert.match(f.call('status').stdout, /verify restart review: <reason>/);
  const restart = f.load();
  restart.comments = [{ user: { login: 'example' }, body: 'verify restart review: fixes are ready', created_at: new Date(Date.now() + 1000).toISOString(), html_url: 'https://example.invalid/restart' }];
  restart.reviews = [{ findings: [] }]; f.save(restart);
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.equal(f.load().prompts.length, 4);
  assert.match(f.load().prompts[3], /full branch review/);
  assert.match(f.call('status').stdout, /fixes are ready/);
});

test('a rerun that fails checks clears previous proof on the same head', t => {
  const f = fixture(t);
  f.config.mode = 'ci'; f.configure(); f.commit();
  let state = f.load(); state.checks = [{ id: 1, name: 'Tests', status: 'completed', conclusion: 'success' }]; f.save(state);
  passed(f.call('run', '--reviewer', 'fixture'));
  passed(f.call('status'));
  state = f.load(); state.checks = [{ id: 2, name: 'Tests', status: 'completed', conclusion: 'failure' }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'CI_FAILED');
  assert.equal(f.call('status').status, 1);
});

test('hosted Codex detection invokes fresh read-only provider with its model settings', t => {
  const f = fixture(t);
  f.env.CODEX_THREAD_ID = 'hosted-session'; f.env.PNYX_ACTOR = 'worker:fixture';
  f.config.reviewerModels = { codex: { model: 'gpt-fixture', effort: 'high' } }; f.configure(); f.commit();
  writeFileSync(join(f.home, 'bin/codex'), `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);let prompt='';process.stdin.on('data',chunk=>prompt+=chunk);process.stdin.on('end',()=>{const path=process.env.VERIFY_TEST_STATE;const state=JSON.parse(fs.readFileSync(path));state.providerArgs=args;state.providerEnvironment={thread:process.env.CODEX_THREAD_ID,actor:process.env.PNYX_ACTOR};state.providerPrompt=prompt;fs.writeFileSync(path,JSON.stringify(state));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({findings:[]}));});`, { mode: 0o755 });
  passed(f.call('run'));
  const state = f.load();
  assert.equal(state.providerArgs[state.providerArgs.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(state.providerArgs[state.providerArgs.indexOf('--model') + 1], 'gpt-fixture');
  assert.ok(state.providerArgs.includes('model_reasoning_effort="high"'));
  assert.ok(state.providerArgs.includes('--ephemeral'));
  assert.ok(state.providerArgs.includes('features.shell_tool=false'));
  assert.deepEqual(state.providerEnvironment, {});
  assert.match(state.providerPrompt, /work.txt/);
  assert.match(state.pr.body, /"provider":"codex"/);
});

test('unavailable preferred reviewer falls back once, while malformed output cannot fall through to a clean reviewer', t => {
  const f = fixture(t);
  f.config.reviewers.unavailable = { command: [join(f.home, 'missing-reviewer')] }; f.configure(); f.commit();
  mkdirSync(join(f.home, 'config/verify'), { recursive: true });
  writeFileSync(join(f.home, 'config/verify/settings.json'), JSON.stringify({ reviewer: ['unavailable', 'fixture'] }));
  passed(f.call('run'));
  assert.match(f.load().pr.body, /"provider":"fixture"/);
});

test('changing config cannot bypass the three-round owner stop', t => {
  const f = fixture(t);
  const finding = { id: 'R1', where: 'work.txt:1', problem: 'Still wrong', fix: 'Fix it' };
  const state = f.load(); state.reviews = [{ findings: [finding] }, { findings: [finding] }, { findings: [finding] }]; f.save(state);
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  f.config.kinds[0].name = 'changed'; f.configure(); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'FINDINGS');
  f.config.kinds[0].name = 'changed again'; f.configure(); f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'OWNER_REQUIRED');
  assert.match(f.load().prompts[1], /full branch review/);
});

test('invalid JSON shape from the preferred reviewer cannot fall through to a clean reviewer', t => {
  const f = fixture(t);
  f.config.reviewers.second = f.config.reviewers.fixture; f.configure(); f.commit();
  mkdirSync(join(f.home, 'config/verify'), { recursive: true });
  writeFileSync(join(f.home, 'config/verify/settings.json'), JSON.stringify({ reviewer: ['fixture', 'second'] }));
  const state = f.load(); state.reviews = [{ clean: true }, { findings: [] }]; f.save(state);
  failed(f.call('run'), 'REVIEW_OUTPUT');
  assert.equal(f.load().prompts.length, 1);
  assert.doesNotMatch(f.load().pr.body, /verify:v1/);
});
