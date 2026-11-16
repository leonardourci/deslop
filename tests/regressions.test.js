import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './fixtures.js';
const pass = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

test('initial review config edits determine the checks used for proof', (t) => {
  const f = fixture(t);
  const config = JSON.parse(JSON.stringify(f.config));
  config.commands.tests = 'node -e "process.exit(1)"';
  config.checkFixAttempts = 0;
  const state = f.load();
  state.actions = [{ files: { 'deslop.config.json': JSON.stringify(config) } }];
  f.save(state);
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(f.runs()[0].checks[0].ok, false);
  assert.equal(f.call('status').status, 1);
});

test('a missing Codex result after edits stops before fallback', (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.bin, 'codex'),
    `#!/usr/bin/env node
process.stdin.resume();process.stdin.on('end',()=>{require('node:fs').writeFileSync('work.txt','partial');});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(f.home, 'config/deslop'), { recursive: true });
  writeFileSync(
    join(f.home, 'config/deslop/settings.json'),
    JSON.stringify({ reviewer: ['codex', 'fixture'] }),
  );
  const result = f.call('run');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(f.load().calls.length, 0);
  assert.equal(readFileSync(join(f.root, 'work.txt'), 'utf8'), 'partial');
  assert.deepEqual(f.runs()[0].commits, []);
  assert.equal(f.call('status').status, 1);
});

test('sibling branch config writes during checks do not invalidate this checkout', (t) => {
  const f = fixture(t);
  f.config.commands.tests = 'git config branch.peer.remote origin';
  f.configure();
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
});

test('PR review prefers the remote base over a stale local base', (t) => {
  const f = fixture(t);
  f.push();
  f.git('switch', 'main');
  writeFileSync(join(f.root, 'landed-by-someone-else.txt'), 'landed');
  f.commit();
  f.git('push', 'origin', 'HEAD:refs/heads/main');
  f.git('switch', 'change');
  f.git('reset', '--hard', 'origin/main');
  writeFileSync(join(f.root, 'own.txt'), 'own');
  f.commit();
  const s = f.load();
  s.pr = {
    state: 'OPEN',
    baseRefName: 'main',
  };
  f.save(s);
  // Keep local main stale, while retaining a runnable config on the branch.
  f.git('branch', '-f', 'main', 'HEAD~2');
  f.config.commands.tests = 'node -e ""';
  f.configure();
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.doesNotMatch(f.load().calls[0].prompt, /landed-by-someone-else/);
});

test('check artifacts are committed under the command that created them', (t) => {
  const f = fixture(t);
  const command = `node -e "require('node:fs').writeFileSync('junit.xml','artifact')"`;
  f.config.commands.tests = command;
  f.configure();
  f.commit();
  const head = f.git('rev-parse', 'HEAD');
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.notEqual(f.git('rev-parse', 'HEAD'), head);
  assert.equal(f.git('log', '-1', '--format=%s'), `deslop: ${command}`);
  assert.equal(f.git('ls-files', 'junit.xml'), 'junit.xml');
  pass(f.call('status'));
});

for (const conclusion of [
  'skipped',
  'neutral',
  'cancelled',
  'action_required',
  'stale',
])
  test(`${conclusion} CI ends red without a fix call`, (t) => {
    const f = fixture(t);
    f.push();
    const s = f.load();
    s.checks[0].conclusion = conclusion;
    f.save(s);
    assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
    assert.equal(f.load().calls.length, 1);
  });

test('publication outage preserves proof until a red verdict', (t) => {
  const f = fixture(t);
  f.push();
  pass(f.call('run', '--reviewer', 'fixture'));
  const s = f.load();
  s.publicationOutage = true;
  f.save(s);
  pass(f.call('run', '--reviewer', 'fixture'));
  pass(f.call('status'));
  assert.equal(f.load().calls.length, 2);
});

test('a fix turn without edits ends red without rerunning checks', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(f.runs()[0].checks.length, 1);
});

test('sibling branch config writes during review also survive', (t) => {
  const f = fixture(t),
    s = f.load();
  s.actions = [{ config: ['branch.peer.remote', 'origin'] }];
  f.save(s);
  pass(f.call('run', '--reviewer', 'fixture'));
});

test('a transient check-runs error is retried', (t) => {
  const f = fixture(t),
    s = f.load();
  f.push();
  s.transientPoll = true;
  f.save(s);
  const script = `import {waitForChecks} from ${JSON.stringify(new URL('../src/github.js', import.meta.url).href)}; console.log(JSON.stringify(await waitForChecks({cwd:process.cwd(),head:'head',names:['Tests'],pollMs:1,timeoutMs:10000})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8',
  });
  pass(r);
  assert.match(r.stdout, /success/);
});

test('status refuses copied notes and dirty work', (t) => {
  const f = fixture(t);
  pass(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD'),
    note = JSON.parse(f.git('notes', '--ref=deslop', 'show', head));
  f.git(
    'notes',
    '--ref=deslop',
    'add',
    '-f',
    '-m',
    JSON.stringify({
      ...note,
      head: 'different',
    }),
    head,
  );
  assert.equal(f.call('status').status, 1);
  f.git('notes', '--ref=deslop', 'add', '-f', '-m', JSON.stringify(note), head);
  writeFileSync(join(f.root, 'dirty.txt'), 'dirty');
  assert.equal(f.call('status').status, 1);
});

test('commit statuses count as exact-head CI checks', (t) => {
  const f = fixture(t);
  f.push();
  const s = f.load();
  s.checks = [];
  s.statuses = [
    {
      id: 1,
      context: 'Tests',
      state: 'success',
    },
  ];
  f.save(s);
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.deepEqual(
    f.runs()[0].checks.map((c) => [c.name, c.ok]),
    [['Tests', true]],
  );
});

test('unfixed check repairs end red and stay separate from review findings', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const s = f.load();
  s.actions = [
    {},
    {
      edit: 'good',
      items: [
        {
          id: 'R1',
          where: 'work.txt',
          problem: 'unresolved',
          fixed: false,
        },
      ],
    },
  ];
  f.save(s);
  const r = f.call('run', '--reviewer', 'fixture');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /UNFIXED/);
  const d = f.runs()[0];
  assert.equal(d.review.found, 0);
  assert.equal(d.checkFixes[0].items[0].fixed, false);
  assert.equal(f.call('status').status, 1);
});

test('failure excerpts cap long lines and identify individual tests', (t) => {
  const f = fixture(t);
  f.config.checkFixAttempts = 0;
  f.config.commands.tests = `node -e "console.error('not ok 1 - first\\nnot ok 2 - second\\n'+ 'x'.repeat(2000));process.exit(1)"`;
  f.configure();
  f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  const failures = f.runs()[0].checks[0].failures;
  assert.deepEqual(
    failures.map((x) => x.test),
    ['first', 'second'],
  );
  assert.ok(
    failures.every((x) =>
      x.excerpt.split('\n').every((line) => line.length <= 1000),
    ),
  );
});

test('nested reviewers do not inherit the Pnyx task identity', (t) => {
  const f = fixture(t);
  f.env.PNYX_TASK = 'caller-task';
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.equal(f.load().calls[0].pnyx, undefined);
});

test('init accepts an explicit config and repeated command/check options', (t) => {
  const f = fixture(t);
  const source = join(f.home, 'source.json');
  writeFileSync(source, JSON.stringify(f.config));
  rmSync(join(f.root, 'deslop.config.json'));
  pass(f.call('init', '--config', source));
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.root, 'deslop.config.json'), 'utf8')),
    f.config,
  );
  rmSync(join(f.root, 'deslop.config.json'));
  pass(
    f.call(
      'init',
      '--command',
      'tests=npm test',
      '--command=lint=npm run lint',
      '--check',
      'Tests',
      '--check=Lint',
    ),
  );
  const config = JSON.parse(
    readFileSync(join(f.root, 'deslop.config.json'), 'utf8'),
  );
  assert.deepEqual(config.commands, {
    tests: 'npm test',
    lint: 'npm run lint',
  });
  assert.deepEqual(config.kinds.at(-1).checks, ['Tests', 'Lint']);
});

test('remote movement prevents pushing review fixes', (t) => {
  const f = fixture(t);
  f.push();
  const remote = join(f.home, 'remote.git'),
    base = f.git('rev-parse', 'main');
  f.config.reviewers.fixture.command = [
    'node',
    '-e',
    `process.stdin.resume();process.stdin.on('end',()=>{require('node:child_process').execFileSync('git',['--git-dir',${JSON.stringify(remote)},'update-ref','refs/heads/change',${JSON.stringify(base)}]);require('node:fs').writeFileSync('work.txt','fixed');console.log(JSON.stringify({items:[]}))});`,
  ];
  f.configure();
  f.commit();
  f.git('push', 'origin', 'HEAD:refs/heads/change');
  const r = f.call('run', '--reviewer', 'fixture');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PUSH/);
  assert.equal(
    f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0],
    base,
  );
});

test('legacy checkout locks fail closed without deleting an older writer', (t) => {
  const f = fixture(t);
  // A reaped child supplies an actual dead pid rather than guessing an unused one.
  const { pid } = spawnSync(process.execPath, ['-e', ''], { env: f.env });
  writeFileSync(join(f.root, '.git', 'deslop.lock'), String(pid));
  writeFileSync(join(f.root, '.git', 'deslop.lock.reclaim'), String(pid));
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LEGACY_LOCK/);
  assert.equal(readFileSync(join(f.root, '.git', 'deslop.lock'), 'utf8'), String(pid));
  assert.equal(f.load().calls.length, 0);
});

for (const path of ['deslop.config.json', 'instructions.md'])
  test(`check fixes cannot change ${path}`, (t) => {
    const f = fixture(t);
    if (path === 'instructions.md') {
      writeFileSync(join(f.root, path), 'rules');
      f.config.instructions = { code: path };
      f.configure();
    }
    writeFileSync(join(f.root, 'work.txt'), 'bad');
    f.commit();
    const s = f.load();
    s.actions = [{}, { files: { [path]: 'changed' } }];
    f.save(s);
    const r = f.call('run', '--reviewer', 'fixture');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /PROOF_EDIT/);
    assert.ok(f.runs()[0].left.includes(path));
    assert.match(r.stdout, /left:/);
  });

test('workflow changes in check repairs appear in the summary', (t) => {
  const f = fixture(t);
  f.config.checkFixAttempts = 2;
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const s = f.load();
  s.actions = [
    {},
    {
      edit: 'still bad',
      files: { '.github/workflows/test.yml': 'workflow' },
    },
    { edit: 'good' },
  ];
  f.save(s);
  const r = f.call('run', '--reviewer', 'fixture');
  pass(r);
  assert.match(r.stdout, /workflows: .github\/workflows\/test.yml/);
});

test('workflow changes in the initial review appear in the summary and run record', (t) => {
  const f = fixture(t);
  const s = f.load();
  s.actions = [{ files: { '.github/workflows/test.yml': 'workflow' } }];
  f.save(s);
  const result = f.call('run', '--reviewer', 'fixture');
  pass(result);
  assert.match(result.stdout, /workflows: .github\/workflows\/test.yml/);
  assert.deepEqual(f.runs()[0].workflowEdits, ['.github/workflows/test.yml']);
});

test('large changed files are listed with bounded additional contents', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'large.txt'), 'x'.repeat(40000));
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.match(
    f.load().calls[0].prompt,
    /large.txt: 40000 bytes; see branch diff/,
  );
});

test('CLI help, version and equals options work and irrelevant options fail', (t) => {
  const f = fixture(t);
  for (const args of [['-h'], ['help'], ['--version']]) pass(f.call(...args));
  pass(f.call('run', '--base=main', '--reviewer=fixture'));
  assert.equal(f.call('status', '--base=x').status, 1);
});

test('clean provider failures fall back with their own model settings', (t) => {
  const f = fixture(t);
  f.config.reviewers.unavailable = {
    command: ['node', '-e', "console.log('rate limited');process.exit(1)"],
  };
  f.config.reviewerModels = { fixture: { model: 'fallback-model' } };
  f.configure();
  f.commit();
  const home = join(f.home, 'config', 'deslop');
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'settings.json'),
    JSON.stringify({ reviewer: ['unavailable', 'fixture'] }),
  );
  pass(f.call('run', '--reviewer-model', 'primary'));
  assert.equal(f.load().calls[0].model, 'fallback-model');
});

test('red rerun removes a previous note and publishes failure together', (t) => {
  const f = fixture(t);
  f.push();
  pass(f.call('run', '--reviewer', 'fixture'));
  const s = f.load();
  s.actions = [
    {
      items: [
        {
          id: 'R1',
          where: 'work.txt',
          problem: 'unfixed',
          fixed: false,
        },
      ],
    },
  ];
  f.save(s);
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(f.call('status').status, 1);
  assert.ok(f.load().github.some((args) => args.includes('state=failure')));
  assert.equal(
    f.load().github.some((args) => args.includes('state=pending')),
    false,
  );
});

test('a failed remote lookup is reported when local commands replace CI', (t) => {
  const f = fixture(t);
  f.push();
  f.git('remote', 'set-url', 'origin', join(f.home, 'absent-remote'));
  const r = f.call('run', '--reviewer', 'fixture');
  pass(r);
  assert.match(r.stdout, /origin unreachable; ran local commands/);
});

test('fresh check repairs receive review items and paths and keep review counts stable', (t) => {
  const f = fixture(t);
  delete f.config.reviewers.fixture.resume;
  f.configure();
  f.commit();
  const s = f.load();
  s.actions = [
    {
      edit: 'still bad',
      items: [
        {
          id: 'R1',
          where: 'work.txt',
          problem: 'earlier review finding',
          fixed: true,
        },
      ],
    },
    {
      edit: 'good',
      items: [
        {
          id: 'R1',
          where: 'work.txt',
          problem: 'check repair',
          fixed: true,
        },
      ],
    },
  ];
  f.save(s);
  const r = f.call('run', '--reviewer', 'fixture');
  pass(r);
  const prompt = f.load().calls[1].prompt;
  assert.match(prompt, /earlier review finding/);
  assert.match(prompt, /work.txt/);
  assert.equal((prompt.match(/Review and edit files only/g) || []).length, 1);
  assert.match(r.stdout, /review: found 1, fixed 1/);
  assert.match(r.stdout, /local, not pushed/);
  assert.equal(f.runs()[0].review.found, 1);
  assert.equal(f.runs()[0].checkFixes.length, 1);
});

test('status publication timeouts preserve successful local proof', (t) => {
  const f = fixture(t);
  f.config.publishLocal = true;
  f.configure();
  f.commit();
  f.push();
  const preloader = join(f.home, 'timeouts.cjs');
  writeFileSync(
    preloader,
    `const original=setTimeout;global.setTimeout=(fn,ms,...args)=>original(fn,Math.min(ms,1000),...args);`,
  );
  f.env.NODE_OPTIONS = `--require=${preloader}`;
  const s = f.load();
  s.publicationHang = true;
  f.save(s);
  const r = f.call('run', '--local', '--reviewer', 'fixture');
  pass(r);
  assert.match(r.stdout, /proof: local git note/);
  assert.match(f.runs()[0].publicationError, /timed out/);
  pass(f.call('status'));
  const publication = f.call('status', '--publish');
  assert.equal(publication.status, 1);
  assert.match(publication.stdout, /proof: local git note/);
});


test('nonliteral true enables worktree configuration guarding', async (t) => {
  const f = fixture(t);
  const { gitState } = await import('../src/git.js');
  f.git('config', 'extensions.worktreeConfig', 'yes');
  const before = await gitState({ cwd: f.root });
  f.git('config', '--worktree', 'unrelated.value', 'changed');
  assert.notEqual(await gitState({ cwd: f.root }), before);
});

test('unfixed findings invalidate proof before a rejecting commit hook', (t) => {
  const f = fixture(t);
  f.git('config', 'core.hooksPath', '.git/hooks');
  const hook = join(f.root, '.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  pass(f.call('run', '--local', '--reviewer', 'fixture'));
  const s = f.load();
  s.actions = [{
    edit: 'changed',
    items: [{
      id: 'R1',
      where: 'work.txt',
      problem: 'unfixed',
      fixed: false
    }]
  }];
  f.save(s);
  assert.equal(f.call('run', '--local', '--reviewer', 'fixture').status, 1);
  f.git('reset', '--hard', 'HEAD');
  assert.equal(f.call('status').status, 1);
});


test('a remote move after push preflight cannot be overwritten', (t) => {
  const f = fixture(t);
  f.push();
  const expected = f.git('rev-parse', 'HEAD');
  const remote = join(f.home, 'remote.git');
  const intervening = f.git('rev-parse', 'HEAD^');
  writeFileSync(join(f.root, 'work.txt'), 'fixed');
  f.commit();
  rmSync(join(f.bin, 'git'));
  writeFileSync(join(f.bin, 'git'), `#!/usr/bin/env node
const cp=require('node:child_process');
const args=process.argv.slice(2);
if(args[0]==='push') cp.execFileSync(${JSON.stringify(f.gitBin)}, ['--git-dir',${JSON.stringify(remote)},'update-ref','refs/heads/change',${JSON.stringify(intervening)}]);
const r=cp.spawnSync(${JSON.stringify(f.gitBin)},args,{stdio:'inherit'});process.exit(r.status);
`, { mode: 0o755 });
  const script = `import {pushFixes} from ${JSON.stringify(new URL('../src/github.js', import.meta.url).href)};await pushFixes({cwd:process.cwd(),branch:'change',expected:${JSON.stringify(expected)}});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8'
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /stale info/, r.stdout + r.stderr);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0], intervening);
});
