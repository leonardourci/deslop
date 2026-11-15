import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { select, validateConfig, instructionsFor } from '../src/config.js';
import { checkStates } from '../src/github.js';
import { reviewerChoices, modelChoice, runningAgent } from '../src/review.js';
import { fixture } from './fixtures.js';

test('kinds select unioned requirements and built-ins can be overridden per repository', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'review.md'), 'Repo-specific review');
  const config = {
    commands: { tests: 'npm test', lint: 'npm run lint' },
    instructions: { code: 'review.md' },
    kinds: [
      {
        name: 'docs',
        match: ['**/*.md'],
        commands: [],
        checks: [],
        instructions: ['writing'],
      },
      {
        name: 'web',
        match: ['web/**'],
        commands: ['lint', 'tests'],
        checks: ['UI'],
      },
      { name: 'code', match: ['**'], commands: ['tests'], checks: ['Tests'] },
    ],
  };
  validateConfig({ root: f.root, config });
  const chosen = select({
    config,
    paths: ['web/app.js', 'src/old.js', 'docs/new.md'],
  });
  assert.deepEqual(chosen.commands, ['lint', 'tests']);
  assert.deepEqual(chosen.checks, ['UI', 'Tests']);
  assert.match(
    instructionsFor({ root: f.root, config, selection: chosen }),
    /Repo-specific review/,
  );
  assert.deepEqual(select({ config, paths: ['README.md'] }).commands, []);
  assert.throws(
    () =>
      validateConfig({ root: f.root, config: { ...config, mode: 'local' } }),
    /unsupported/,
  );
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: { ...config, checkFixAttempts: -1 },
      }),
    /nonnegative/,
  );
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: { ...config, instructions: { code: 'missing' } },
      }),
    /Missing/,
  );
});

test('CI selects newest named checks, excludes the marker and never passes missing CI', (t) => {
  const f = fixture(t);
  const runs = [
    { id: 1, name: 'Tests', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'Tests', status: 'in_progress' },
    { id: 3, name: 'deslop', status: 'queued' },
  ];
  assert.deepEqual(
    checkStates({ runs, statuses: [], names: ['Tests', 'Missing'] }),
    [
      { name: 'Tests', state: 'in_progress', url: undefined },
      { name: 'Missing', state: 'missing' },
    ],
  );
  const s = f.load();
  s.checks = [];
  f.save(s);
  const script = `import { waitForChecks } from ${JSON.stringify(new URL('../src/github.js', import.meta.url).href)}; const checks=await waitForChecks({cwd:process.cwd(),head:process.argv[1],names:['Tests'],timeoutMs:150,pollMs:1});console.log(JSON.stringify(checks));if(checks.every(c=>c.state==='success'))process.exit(0);process.exit(1);`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, f.git('rev-parse', 'HEAD')],
    { cwd: f.root, env: f.env, encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /missing/);
});

test('provider preference and per-provider model precedence support hosted Codex', () => {
  assert.equal(runningAgent({ env: { CODEX_THREAD_ID: 'hosted' } }), 'codex');
  assert.deepEqual(
    reviewerChoices({ settings: { reviewer: ['claude', 'codex'] }, env: {} }),
    ['claude', 'codex'],
  );
  assert.deepEqual(
    reviewerChoices({
      override: 'custom',
      settings: { reviewer: 'codex' },
      env: {},
    }),
    ['custom'],
  );
  assert.throws(
    () => reviewerChoices({ settings: {}, env: {} }),
    /pass --reviewer/,
  );
  assert.deepEqual(
    modelChoice({
      provider: 'codex',
      config: { reviewerModels: { codex: { model: 'repo', effort: 'high' } } },
      settings: { reviewerModels: { codex: { model: 'machine' } } },
      model: 'run',
    }),
    { model: 'run', effort: 'high' },
  );
});

test('CI missing and unreachable waits end with bounded reasons', (t) => {
  const f = fixture(t),
    s = f.load();
  s.checks = [];
  f.save(s);
  const script = `import {waitForChecks} from ${JSON.stringify(new URL('../src/github.js', import.meta.url).href)}; console.log(JSON.stringify(await waitForChecks({cwd:process.cwd(),head:'head',names:['Tests'],missingMs:0,timeoutMs:2000,pollMs:1})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /missing/);
});
