import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
const pass = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);
const successes = (f) =>
  f.load().github.filter((args) => args.includes('state=success'));

for (const publishLocal of [false, true])
  test(`local success publication is ${publishLocal ? 'enabled' : 'disabled by default'}`, (t) => {
    const f = fixture(t);
    if (publishLocal) {
      f.config.publishLocal = true;
      f.configure();
      f.commit();
    }
    f.push();
    const s = f.load();
    s.checks[0].conclusion = 'failure';
    f.save(s);
    const r = f.call('run', '--local', '--reviewer', 'fixture');
    pass(r);
    pass(f.call('status'));
    assert.equal(successes(f).length, publishLocal ? 1 : 0);
    if (!publishLocal) assert.match(r.stdout, /local publication.*disabled/i);
    const publish = f.call('status', '--publish');
    assert.equal(publish.status, publishLocal ? 0 : 1);
    assert.equal(successes(f).length, publishLocal ? 2 : 0);
  });

test('status publication validates CI on the exact local-proof commit', (t) => {
  const f = fixture(t);
  f.push();
  pass(f.call('run', '--local', '--reviewer', 'fixture'));
  assert.equal(successes(f).length, 0);
  pass(f.call('status', '--publish'));
  assert.equal(successes(f).length, 1);
  const head = f.git('rev-parse', 'HEAD');
  assert.ok(
    f
      .load()
      .github.some((args) =>
        args.includes(
          `repos/example/project/commits/${head}/check-runs?per_page=100`,
        ),
      ),
  );
});

for (const publishLocal of [false, true])
  test(`ciRequired still checks CI under --local with publishLocal=${publishLocal}`, (t) => {
    const f = fixture(t);
    f.config.publishLocal = publishLocal;
    f.config.kinds[0].ciRequired = true;
    f.config.checkFixAttempts = 0;
    f.configure();
    f.commit();
    f.push();
    const s = f.load();
    s.checks[0].conclusion = 'failure';
    f.save(s);
    const r = f.call('run', '--local', '--reviewer', 'fixture');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(f.call('status').status, 1);
    assert.equal(successes(f).length, 0);
    assert.deepEqual(
      f.runs()[0].checks.map((c) => c.name),
      ['tests', 'Tests'],
    );
  });

test('ciRequired local fixes stay local and publish nothing until pushed', (t) => {
  const f = fixture(t);
  f.config.publishLocal = true;
  f.config.kinds[0].ciRequired = true;
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  f.push();
  const remote = f.git('rev-parse', 'HEAD');
  const s = f.load();
  s.actions = [{ edit: 'good' }];
  f.save(s);
  const r = f.call('run', '--local', '--reviewer', 'fixture');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /push.*rerun/i);
  assert.notEqual(f.git('rev-parse', 'HEAD'), remote);
  assert.equal(
    f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0],
    remote,
  );
  assert.equal(
    f.load().github.some((args) => args.includes('--method')),
    false,
  );
  assert.equal(f.call('status').status, 1);
});

test('only ciRequired kinds are checked alongside local commands', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'optional.txt'), 'optional');
  f.config.kinds = [
    {
      name: 'optional',
      match: ['optional.txt'],
      commands: [],
      checks: ['Optional'],
    },
    { ...f.config.kinds[0], ciRequired: true },
  ];
  f.configure();
  f.commit();
  f.push();
  pass(f.call('run', '--local', '--reviewer', 'fixture'));
  assert.deepEqual(
    f.runs()[0].checks.map((c) => c.name),
    ['tests', 'Tests'],
  );
  assert.equal(successes(f).length, 0);
});

test('unpushed required CI ends red even when local publication is enabled', (t) => {
  const f = fixture(t);
  f.config.publishLocal = true;
  f.config.kinds[0].ciRequired = true;
  f.configure();
  f.commit();
  const r = f.call('run', '--local', '--reviewer', 'fixture');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /push.*rerun/i);
  assert.equal(f.call('status').status, 1);
  assert.equal(successes(f).length, 0);
});

test('status --publish cannot bypass ciRequired after CI turns red', (t) => {
  const f = fixture(t);
  f.config.publishLocal = true;
  f.config.kinds[0].ciRequired = true;
  f.configure();
  f.commit();
  f.push();
  pass(f.call('run', '--local', '--reviewer', 'fixture'));
  const count = successes(f).length;
  const s = f.load();
  s.checks[0].conclusion = 'failure';
  f.save(s);
  const r = f.call('status', '--publish');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /CI not green/);
  assert.equal(successes(f).length, count);
});

test('status publication preserves the explicit review base check selection', (t) => {
  const f = fixture(t);
  f.config.kinds = [
    { name: 'docs', match: ['*.md'], commands: [], checks: ['Docs'] },
    f.config.kinds[0],
  ];
  f.configure();
  f.commit();
  f.push();
  f.git('branch', 'parent');
  writeFileSync(join(f.root, 'README.md'), 'docs');
  f.commit();
  f.git('push', 'origin', 'HEAD:refs/heads/change');
  const s = f.load();
  s.checks = [
    { id: 1, name: 'Docs', status: 'completed', conclusion: 'success' },
  ];
  f.save(s);
  pass(f.call('run', '--base', 'parent', '--local', '--reviewer', 'fixture'));
  pass(f.call('status', '--publish'));
  assert.equal(successes(f).length, 1);
});

for (const passName of ['initial', 'proof'])
  test(`${passName} local failures resume repair before required CI`, (t) => {
    const f = fixture(t);
    f.config.kinds[0].ciRequired = true;
    if (passName === 'proof') {
      writeFileSync(
        join(f.root, 'format.cjs'),
        "require('node:fs').writeFileSync('formatted.txt','formatted')",
      );
      f.config.commands.format = 'node format.cjs';
      f.config.kinds[0].commands = ['format', 'tests'];
    }
    writeFileSync(join(f.root, 'work.txt'), 'bad');
    f.configure();
    f.commit();
    f.push();
    const s = f.load();
    s.checks[0].conclusion = 'skipped';
    s.actions = [{}, { edit: 'good' }];
    f.save(s);

    const result = f.call('run', '--local', '--reviewer', 'fixture');
    const calls = f.load().calls;
    assert.equal(calls.length, 2, result.stdout + result.stderr);
    assert.deepEqual(calls[1].args, ['--resume', 'session-fixture']);
    assert.match(calls[1].prompt, /FAIL work/);
    assert.equal(readFileSync(join(f.root, 'work.txt'), 'utf8'), 'good');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CI_REQUIRED/);
    assert.match(result.stderr, /push.*rerun/);
    assert.equal(
      f
        .load()
        .github.some((args) =>
          args.some((arg) => arg.includes('/check-runs?')),
        ),
      false,
    );
    const data = f.runs()[0];
    assert.equal(data.checks.at(-1).ok, true);
    assert.equal(
      f.git('show', '-s', '--format=%s', data.commits.at(-1)),
      'deslop: fix failing checks',
    );
    if (passName === 'proof') {
      assert.equal(
        f.git('show', '-s', '--format=%s', data.commits[0]),
        'deslop: node format.cjs',
      );
      assert.equal(
        f.git(
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          data.commits[0],
        ),
        'formatted.txt',
      );
    }
  });
