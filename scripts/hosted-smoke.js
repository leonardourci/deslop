import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fixture } from '../tests/fixtures.js';

if (!process.env.CODEX_THREAD_ID && !process.env.CODEX_SESSION_ID) throw new Error('Run this smoke check from a real hosted Codex session');
const cleanup = [];
const context = { after: callback => cleanup.push(callback) };
const test = fixture(context);
try {
  rmSync(join(test.home, 'bin', 'codex'));
  test.env.PATH = `${join(test.home, 'bin')}:${process.env.PATH}`;
  test.env.CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
  if (process.env.OPENAI_API_KEY) test.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  test.env.CODEX_THREAD_ID = process.env.CODEX_THREAD_ID;
  test.env.CODEX_SESSION_ID = process.env.CODEX_SESSION_ID;
  const base = test.load();
  base.pr.baseRefOid = test.git('rev-parse', 'HEAD');
  test.save(base);
  writeFileSync(join(test.root, 'README.md'), '# Fixture\n\nA synthetic repository for checking hosted reviewer detection.\n');
  test.commit();
  const result = test.call('run');
  console.log(result.stdout);
  console.error(result.stderr);
  if (result.status !== 0) throw new Error(`Hosted Codex smoke failed with ${result.status}`);
  const body = test.load().pr.body;
  if (!body.includes('"provider":"codex"')) throw new Error('Running provider was not detected');
  console.log('Hosted Codex auto-detection, real read-only review and exact-commit marker passed against synthetic GitHub.');
} finally { for (const callback of cleanup) callback(); }
