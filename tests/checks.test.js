import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';

test('CI success cannot hide a failed local command and logs remain separate', t => {
  const f = fixture(t);
  f.config.checkFixAttempts = 0;
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad'); f.commit(); f.push();
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const data = f.runs()[0];
  assert.deepEqual(data.checks.map(({ name, ok }) => ({ name, ok })), [
    { name: 'tests', ok: false }, { name: 'Tests', ok: true },
  ]);
  assert.notEqual(data.checks[0].log, data.checks[1].log);
  assert.match(readFileSync(join(f.root, data.checks[0].log), 'utf8'), /FAIL work/);
  assert.match(readFileSync(join(f.root, data.checks[1].log), 'utf8'), /Tests: success/);
  assert.equal(f.call('status').status, 1);
});
