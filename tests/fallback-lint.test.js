import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';

function lintFixture(t) {
  const f = fixture(t);
  delete f.config.fallbackLint;
  f.config.checkFixAttempts = 0;
  return f;
}
const pass = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);
const lintCheck = (f) =>
  f.runs()[0].checks.find((check) => check.name === 'deslop lint');

test('a repo without lint gets the shipped ESLint on changed files', (t) => {
  const f = lintFixture(t);
  writeFileSync(
    join(f.root, 'bad.js'),
    'export const pair = {left:1,right:2};',
  );
  f.configure();
  f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  const check = lintCheck(f);
  assert.equal(check.ok, false);
  assert.match(
    readFileSync(join(f.root, check.log), 'utf8'),
    /deslop\/entries-on-lines/,
  );
});

test('fallback lint leaves files outside the review diff alone', (t) => {
  const f = lintFixture(t);
  writeFileSync(join(f.root, 'legacy.js'), 'const unused = 1;');
  f.configure();
  f.commit();
  f.git('branch', 'review-base');
  writeFileSync(join(f.root, 'changed.js'), 'export const value = 1;');
  f.commit();
  pass(f.call('run', '--base', 'review-base', '--reviewer', 'fixture'));
  assert.equal(lintCheck(f).ok, true);
});


for (const filename of ['eslint.config.mjs', 'package.json'])
  test(`the repo config in ${filename} replaces shipped rules`, (t) => {
    const f = lintFixture(t);
    writeFileSync(
      join(f.root, filename),
      filename.endsWith('mjs')
        ? "export default [{rules:{'no-unused-vars':'off'}}];"
        : JSON.stringify({
          name: 'fixture',
          eslintConfig: { rules: { 'no-unused-vars': 'off' } }
        }),
    );
    writeFileSync(
      join(f.root, 'custom.js'),
      'export const pair = {left:1,right:2}; const unused=1;',
    );
    f.configure();
    f.commit();
    pass(f.call('run', '--reviewer', 'fixture'));
    assert.equal(lintCheck(f).ok, true);
  });

for (const filename of ['eslint.config.mjs', '.eslintrc.json', 'package.json'])
  test(`fallback lint enforces the repo rules in ${filename}`, (t) => {
    const f = lintFixture(t);
    writeFileSync(
      join(f.root, filename),
      filename.endsWith('mjs')
        ? "export default [{rules:{'no-console':'error'}}];"
        : JSON.stringify(filename === 'package.json'
          ? { eslintConfig: { rules: { 'no-console': 'error' } } }
          : { rules: { 'no-console': 'error' } }),
    );
    writeFileSync(join(f.root, 'custom.js'), "console.log('demo');");
    f.configure();
    f.commit();
    assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
    assert.match(
      readFileSync(join(f.root, lintCheck(f).log), 'utf8'),
      /no-console/,
    );
  });

test('fallback lint can be disabled without changing repo commands', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.equal(lintCheck(f), undefined);
  assert.deepEqual(
    f.runs()[0].checks.map((c) => c.name),
    ['tests'],
  );
});

test('a selected repo lint command prevents a duplicate fallback', (t) => {
  const f = lintFixture(t);
  f.config.commands.lint = 'node -e "console.log(\'repo lint\')"';
  f.config.kinds[0].commands = ['lint', 'tests'];
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.configure();
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.equal(lintCheck(f), undefined);
  assert.deepEqual(
    f.runs()[0].checks.map((c) => c.name),
    ['lint', 'tests'],
  );
});

test('a selected lint CI check prevents duplicate local lint', (t) => {
  const f = lintFixture(t);
  f.config.kinds[0].checks = ['Lint', 'Tests'];
  f.config.commands.tests = 'node -e "process.exit(1)"';
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.configure();
  f.commit();
  f.push();
  const s = f.load();
  s.checks.push({
    id: 2,
    name: 'Lint',
    status: 'completed',
    conclusion: 'success',
  });
  f.save(s);
  pass(f.call('run', '--reviewer', 'fixture'));
  assert.equal(lintCheck(f), undefined);
  assert.deepEqual(
    f.runs()[0].checks.map((c) => c.name),
    ['Lint', 'Tests'],
  );
});

test('fallback lint failures reach repair before CI waiting', (t) => {
  const f = lintFixture(t);
  f.config.checkFixAttempts = 1;
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.configure();
  f.commit();
  f.push();
  const s = f.load();
  s.checks[0].conclusion = 'skipped';
  f.save(s);
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(lintCheck(f).ok, false);
  assert.equal(f.load().calls.length, 2);
  assert.match(f.load().calls[1].prompt, /no-unused-vars/);
  assert.equal(
    f
      .load()
      .github.some((args) => args.some((arg) => arg.includes('/check-runs?'))),
    false,
  );
});

test('a local lint command skipped for CI does not suppress fallback lint', (t) => {
  const f = lintFixture(t);
  f.config.commands.lint = 'node -e ""';
  f.config.kinds[0].commands = ['lint', 'tests'];
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.configure();
  f.commit();
  f.push();
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(lintCheck(f).ok, false);
});

test('optional lint CI does not suppress fallback lint under --local', (t) => {
  const f = lintFixture(t);
  f.config.kinds[0].checks = ['Lint'];
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.configure();
  f.commit();
  const result = f.call('run', '--local', '--reviewer', 'fixture');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(lintCheck(f).ok, false);
});

test('a fallback lint failure resumes the same agent for a code fix', (t) => {
  const f = lintFixture(t);
  f.config.checkFixAttempts = 1;
  writeFileSync(join(f.root, 'bad.js'), 'const unused=1;');
  f.configure();
  f.commit();
  const s = f.load();
  s.actions = [{}, { files: { 'bad.js': 'export const value=1;' } }];
  f.save(s);
  pass(f.call('run', '--reviewer', 'fixture'));
  const calls = f.load().calls;
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['--resume', 'session-fixture']);
  assert.match(calls[1].prompt, /deslop lint/);
  assert.equal(f.runs()[0].checks.at(-1).ok, true);
});
