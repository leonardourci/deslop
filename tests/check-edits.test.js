import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';

const passed = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

test('command-generated files add their required checks before proof', (t) => {
  const f = fixture(t);
  f.config.commands = {
    generate: `node -e "require('node:fs').writeFileSync('generated.js','generated')"`,
    generated: 'node -e "process.exit(1)"',
  };
  f.config.kinds = [
    { name: 'generated', match: ['generated.js'], commands: ['generated'], checks: [] },
    { name: 'other', match: ['**'], commands: ['generate'], checks: [] },
  ];
  f.config.checkFixAttempts = 0;
  f.configure();
  f.commit();
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const data = f.runs()[0];
  assert.ok(data.checks.some((check) => check.name === 'generated' && !check.ok));
  assert.equal(f.call('status').status, 1);
  assert.equal(f.load().calls.length, 1);
});

test('lint:fix and generation edits land in separate command-named commits', (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.bin, 'pnpm'),
    `#!/usr/bin/env node
const fs=require('node:fs');fs.writeFileSync('work.txt','good');fs.writeFileSync('format.js','formatted');fs.writeFileSync('ignored.log','ignored');`,
    { mode: 0o755 },
  );
  writeFileSync(join(f.root, '.gitignore'), 'ignored.log\n');
  writeFileSync(
    join(f.root, 'generate.cjs'),
    `require('node:fs').writeFileSync('generated.js','generated')`,
  );
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.config.commands.format = 'pnpm lint:fix';
  f.config.commands.generate = 'node generate.cjs';
  f.config.kinds[0].commands = ['format', 'generate', 'tests'];
  f.configure();
  f.commit();
  const r = f.call('run', '--reviewer', 'fixture');
  passed(r);
  const data = f.runs()[0];
  assert.equal(data.commits.length, 2);
  assert.equal(
    f.git('show', '-s', '--format=%s', data.commits[0]),
    'deslop: pnpm lint:fix',
  );
  assert.equal(
    f.git('show', '-s', '--format=%s', data.commits[1]),
    'deslop: node generate.cjs',
  );
  assert.deepEqual(
    f
      .git('diff-tree', '--no-commit-id', '--name-only', '-r', data.commits[0])
      .split('\n'),
    ['format.js', 'work.txt'],
  );
  assert.equal(
    f.git('diff-tree', '--no-commit-id', '--name-only', '-r', data.commits[1]),
    'generated.js',
  );
  assert.equal(f.git('ls-files', 'ignored.log'), '');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(data.checks.length, 6);
  passed(f.call('status'));
});

for (const verdict of ['always-green', 'proof-red', 'proof-green'])
  test(`a bounded proof pass handles ${verdict} commands`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.root, 'counter.txt'), '0');
    const exit =
      verdict === 'proof-red'
        ? 'count===2?1:0'
        : verdict === 'proof-green'
          ? 'count===1?1:0'
          : '0';
    writeFileSync(
      join(f.root, 'churn.cjs'),
      `const fs=require('node:fs');const count=Number(fs.readFileSync('counter.txt'))+1;fs.writeFileSync('counter.txt',String(count));process.exit(${exit})`,
    );
    f.config.commands = { churn: 'node churn.cjs' };
    f.config.kinds[0].commands = ['churn'];
    f.config.checkFixAttempts = 0;
    f.configure();
    f.commit();
    const r = f.call('run', '--reviewer', 'fixture');
    assert.equal(
      r.status,
      verdict === 'proof-red' ? 1 : 0,
      r.stdout + r.stderr,
    );
    const data = f.runs()[0];
    assert.equal(data.commits.length, 2);
    assert.equal(data.checks.length, 2);
    assert.equal(readFileSync(join(f.root, 'counter.txt'), 'utf8'), '2');
    assert.equal(f.load().calls.length, 1);
    assert.match(r.stdout, /unstable commands: node churn.cjs/);
    assert.equal(f.call('status').status, verdict === 'proof-red' ? 1 : 0);
  });
