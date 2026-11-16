import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';

test('CI waiting replaces local commands rather than running both', (t) => {
  const f = fixture(t);
  f.config.checkFixAttempts = 0;
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  f.push();
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const data = f.runs()[0];
  assert.deepEqual(
    data.checks.map(({
      name,
      ok
    }) => ({
      name,
      ok,
    })),
    [
      {
        name: 'Tests',
        ok: true,
      },
    ],
  );
  assert.match(
    readFileSync(join(f.root, data.checks[0].log), 'utf8'),
    /Tests: success/,
  );
  assert.equal(f.call('status').status, 0);
});

test('successful CI checks do not prevent repairing another failed check', (t) => {
  const f = fixture(t);
  f.config.kinds[0].checks = ['Passed', 'Tests'];
  f.configure();
  f.commit();
  f.push();
  const success = {
    id: 1,
    name: 'Passed',
    status: 'completed',
    conclusion: 'success',
  };
  const s = f.load();
  s.checks = [
    success,
    {
      id: 2,
      name: 'Tests',
      status: 'completed',
      conclusion: 'failure',
    },
  ];
  s.actions = [
    {},
    {
      edit: 'fixed',
      checks: [
        success,
        {
          id: 3,
          name: 'Tests',
          status: 'completed',
          conclusion: 'success',
        },
      ],
    },
  ];
  f.save(s);
  const r = f.call('run', '--reviewer', 'fixture');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.load().calls.length, 2);
  assert.equal(f.call('status').status, 0);
});
