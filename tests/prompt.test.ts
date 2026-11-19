import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { requiredValue } from '../src/prompt.ts';

test('missing terminal input prompts and returns the entered value', async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = new PassThrough();
  let prompt = '';
  output.on('data', (chunk) => (prompt += chunk));
  const answer = requiredValue({
    flag: '--reviewer',
    question: 'Reviewer',
    input,
    output,
  });
  input.write('codex\n');
  assert.equal(await answer, 'codex');
  assert.match(prompt, /Reviewer:/);
  input.end();
  output.end();
});
