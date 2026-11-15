import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { review } from '../src/review.js';

test('custom resumes retain the latest returned session id', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'deslop-provider-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const script = "console.log(JSON.stringify({items:[],sessionId:process.argv[1]+'-next'}))";
  const config = { reviewers: { custom: {
    command: [process.execPath, '-e', script, 'initial'],
    resume: [process.execPath, '-e', script, '{sessionId}'],
  } } };
  const args = { cwd, common: cwd, choices: ['custom'], config, settings: {}, prompt: '' };
  const first = await review(args);
  const second = await review({ ...args, session: first.session });
  assert.equal(second.session.id, 'initial-next-next');
  const third = await review({ ...args, session: second.session });
  assert.equal(third.session.id, 'initial-next-next-next');
});

test('a provider failure after editing stops before fallback', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'deslop-provider-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const config = { reviewers: {
    first: { command: [process.execPath, '-e', "require('node:fs').writeFileSync('work.txt', 'partial'); process.exit(1)"] },
    fallback: { command: [process.execPath, '-e', "require('node:fs').writeFileSync('work.txt', 'fallback'); console.log(JSON.stringify({items:[]}))"] },
  } };
  await assert.rejects(review({ cwd, common: cwd, choices: ['first', 'fallback'], config, settings: {}, prompt: '' }), { code: 'COMMAND' });
  assert.equal(readFileSync(join(cwd, 'work.txt'), 'utf8'), 'partial');
});

test('a custom provider without a session id receives prior-edit context', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'deslop-provider-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const config = { reviewers: { custom: {
    command: [process.execPath, '-e', "let input=''; process.stdin.on('data', chunk=>input+=chunk); process.stdin.on('end',()=>console.log(JSON.stringify({items:[{id:'R1',where:'prompt',problem:input,fixed:true}]})))"],
    resume: ['unused', '{sessionId}'],
  } } };
  const result = await review({ cwd, common: cwd, choices: ['custom'], config, settings: {}, prompt: 'Fix failures', session: { provider: 'custom', commits: ['previous-commit'] } });
  assert.match(result.items[0].problem, /prior edits were committed as previous-commit/);
});
