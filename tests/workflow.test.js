import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('CI runs for pushed branches without a PR and keeps event groups separate', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/tests.yml', import.meta.url), 'utf8'));
  assert.ok(Object.hasOwn(workflow.on, 'push'));
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
  assert.deepEqual(workflow.on.push.paths, workflow.on.pull_request.paths);
  assert.match(workflow.concurrency.group, /github.event_name/);
  assert.match(workflow.concurrency.group, /github.ref/);
});
