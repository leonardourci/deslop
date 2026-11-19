import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { review } from '../src/review.ts';
import { fixture } from './fixtures.ts';

test('Claude honors the agent timeout and reports AGENT_TIMEOUT', async (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.bin, 'claude'),
    '#!/usr/bin/env node\nprocess.stdin.resume();setInterval(()=>{},1000);',
    { mode: 0o755 },
  );
  await assert.rejects(
    review({
      cwd: f.root,
      common: join(f.root, '.git'),
      choices: ['claude'],
      config: f.config,
      settings: {},
      prompt: '',
      findings: join(f.home, 'findings.txt'),
      env: f.env,
      timeoutMs: 100,
    }),
    { code: 'AGENT_TIMEOUT' },
  );
});

test('custom resumes retain the latest returned session id', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deslop-provider-'));
  t.after(() =>
    rmSync(cwd, {
      recursive: true,
      force: true,
    }),
  );
  const script =
    "console.log(JSON.stringify({sessionId:process.argv[1]+'-next'}))";
  const config = {
    reviewers: {
      custom: {
        command: [process.execPath, '-e', script, 'initial'],
        resume: [process.execPath, '-e', script, '{sessionId}'],
      },
    },
  };
  const args = {
    cwd,
    common: cwd,
    choices: ['custom'],
    config,
    settings: {},
    prompt: '',
    findings: join(cwd, 'findings.txt'),
  };
  const first = await review(args);
  const second = await review({
    ...args,
    session: first.session,
  });
  assert.equal(second.session.id, 'initial-next-next');
  const third = await review({
    ...args,
    session: second.session,
  });
  assert.equal(third.session.id, 'initial-next-next-next');
});

test('a provider failure after editing stops before fallback', async (t) => {
  const f = fixture(t);
  const cwd = f.root;
  const config = {
    reviewers: {
      first: {
        command: [
          process.execPath,
          '-e',
          "require('node:fs').writeFileSync('work.txt', 'partial'); process.exit(1)",
        ],
      },
      fallback: {
        command: [
          process.execPath,
          '-e',
          "require('node:fs').writeFileSync('work.txt', 'fallback'); console.log('done')",
        ],
      },
    },
  };
  await assert.rejects(
    review({
      cwd,
      common: cwd,
      choices: ['first', 'fallback'],
      config,
      settings: {},
      prompt: '',
      findings: join(f.home, 'findings.txt'),
    }),
    { code: 'COMMAND' },
  );
  assert.equal(readFileSync(join(cwd, 'work.txt'), 'utf8'), 'partial');
});

test('a fallback provider starts from the findings text the failed one found', async (t) => {
  const f = fixture(t);
  const findings = join(f.home, 'findings.txt');
  writeFileSync(findings, 'earlier\n');
  const config = {
    reviewers: {
      first: {
        command: [
          process.execPath,
          '-e',
          "require('node:fs').appendFileSync(process.env.DESLOP_FINDINGS_FILE, 'discarded\\n'); process.exit(1)",
        ],
      },
      fallback: {
        command: [
          process.execPath,
          '-e',
          "process.stdout.write(require('node:fs').readFileSync(process.env.DESLOP_FINDINGS_FILE, 'utf8'))",
        ],
      },
    },
  };
  const result = await review({
    cwd: f.root,
    common: f.root,
    choices: ['first', 'fallback'],
    config,
    settings: {},
    prompt: '',
    findings,
    env: f.env,
  });
  assert.equal(result.output, 'earlier');
});

test('a custom provider without a session id receives prior-edit context', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deslop-provider-'));
  t.after(() =>
    rmSync(cwd, {
      recursive: true,
      force: true,
    }),
  );
  const config = {
    reviewers: {
      custom: {
        command: [
          process.execPath,
          '-e',
          "process.stdin.pipe(process.stdout)",
        ],
        resume: ['unused', '{sessionId}'],
      },
    },
  };
  const result = await review({
    cwd,
    common: cwd,
    choices: ['custom'],
    config,
    settings: {},
    prompt: 'Fix failures',
    findings: join(cwd, 'findings.txt'),
    session: {
      provider: 'custom',
      commits: ['previous-commit'],
    },
  });
  assert.match(
    result.output,
    /prior edits were committed as previous-commit/,
  );
});

test('a hung reviewer ends with AGENT_TIMEOUT', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deslop-provider-'));
  t.after(() =>
    rmSync(cwd, {
      recursive: true,
      force: true,
    }),
  );
  const config = {
    reviewers: {
      hung: { command: [process.execPath, '-e', 'setInterval(()=>{},1000)'] },
    },
  };
  await assert.rejects(
    review({
      cwd,
      common: cwd,
      choices: ['hung'],
      config,
      settings: {},
      prompt: '',
      findings: join(cwd, 'findings.txt'),
      timeoutMs: 100,
    }),
    { code: 'AGENT_TIMEOUT' },
  );
});
