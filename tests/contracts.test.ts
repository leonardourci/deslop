import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { select, validateConfig, instructionsFor, loadSettings } from '../src/config.ts';
import { checkStates } from '../src/github.ts';
import { reviewerChoices, modelChoice, runningAgent } from '../src/review.ts';
import { fixture } from './fixtures.ts';
import type { Config } from '../src/types.ts';

test('kinds select unioned requirements and built-ins can be overridden per repository', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'review.md'), 'Repo-specific review');
  const config = {
    commands: {
      tests: 'npm test',
      lint: 'npm run lint',
    },
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
      {
        name: 'code',
        match: ['**'],
        commands: ['tests'],
        checks: ['Tests'],
      },
    ],
  };
  validateConfig({
    root: f.root,
    config,
  });
  const chosen = select({
    config,
    paths: ['web/app.js', 'src/old.js', 'docs/new.md'],
  });
  assert.deepEqual(chosen.commands, ['lint', 'tests']);
  assert.deepEqual(chosen.checks, ['UI', 'Tests']);
  assert.match(
    instructionsFor({
      root: f.root,
      config,
      selection: chosen,
    }),
    /Repo-specific review/,
  );
  assert.deepEqual(
    select({
      config,
      paths: ['README.md'],
    }).commands,
    [],
  );
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: {
          ...config,
          mode: 'local',
        } as Config,
      }),
    /unsupported/,
  );
  for (const minutes of [0, -1, Infinity, NaN, 40000, '45']) {
    assert.throws(() => validateConfig({
      root: f.root,
      config: {
        ...config,
        agentTimeoutMinutes: minutes
      } as Config,
    }), /agentTimeoutMinutes/);
    writeFileSync(join(f.home, 'settings.json'), JSON.stringify({ agentTimeoutMinutes: minutes }));
    assert.throws(() => loadSettings({ home: f.home }), /agentTimeoutMinutes/);
  }
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: {
          ...config,
          checkFixAttempts: -1,
        },
      }),
    /nonnegative/,
  );
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: {
          ...config,
          instructions: { code: 'missing' },
        },
      }),
    /Missing/,
  );
});

test('CI selects newest named checks, excludes the marker and never passes missing CI', (t) => {
  const f = fixture(t);
  const runs = [
    {
      id: 1,
      name: 'Tests',
      status: 'completed',
      conclusion: 'success',
    },
    {
      id: 2,
      name: 'Tests',
      status: 'in_progress',
    },
    {
      id: 3,
      name: 'deslop',
      status: 'queued',
    },
  ];
  assert.deepEqual(
    checkStates({
      runs,
      statuses: [],
      names: ['Tests', 'Missing'],
    }),
    [
      {
        name: 'Tests',
        state: 'in_progress',
        url: undefined,
      },
      {
        name: 'Missing',
        state: 'missing',
      },
    ],
  );
  const s = f.load();
  s.checks = [];
  f.save(s);
  f.push();
  const script = `import { waitForChecks } from ${JSON.stringify(new URL('../src/github.ts', import.meta.url).href)}; const checks=await waitForChecks({cwd:process.cwd(),head:process.argv[1],names:['Tests'],timeoutMs:150,pollMs:1});console.log(JSON.stringify(checks));if(checks.every(c=>c.state==='success'))process.exit(0);process.exit(1);`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, f.git('rev-parse', 'HEAD')],
    {
      cwd: f.root,
      env: f.env,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /missing/);
});

test('provider preference and per-provider model precedence support hosted Codex', () => {
  assert.equal(runningAgent({ env: { CODEX_THREAD_ID: 'hosted' } }), 'codex');
  assert.deepEqual(
    reviewerChoices({
      settings: { reviewer: ['claude', 'codex'] },
      env: {},
    }),
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
    () =>
      reviewerChoices({
        settings: {},
        env: {},
      }),
    /pass --reviewer/,
  );
  assert.deepEqual(
    modelChoice({
      provider: 'codex',
      config: {
        reviewerModels: {
          codex: {
            model: 'repo',
            effort: 'high',
          },
        },
      },
      settings: { reviewerModels: { codex: { model: 'machine' } } },
      model: 'run',
    }),
    {
      model: 'run',
      effort: 'high',
    },
  );
});

test('missing CI checks end at their appearance limit', (t) => {
  const f = fixture(t),
    s = f.load();
  s.checks = [];
  f.save(s);
  f.push();
  const script = `import {waitForChecks} from ${JSON.stringify(new URL('../src/github.ts', import.meta.url).href)}; console.log(JSON.stringify(await waitForChecks({cwd:process.cwd(),head:'head',names:['Tests'],missingMs:0,timeoutMs:2000,pollMs:1})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].state, 'missing');
});

test('persistent CI API errors end red with a local rerun hint', (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.bin, 'gh'),
    `#!/usr/bin/env node
if(process.argv[2]==='repo')console.log(JSON.stringify({nameWithOwner:'example/project'}));else {console.error('HTTP 502: Bad Gateway');process.exit(1)}
`,
    { mode: 0o755 },
  );
  f.push();
  const script = `import {waitForChecks} from ${JSON.stringify(new URL('../src/github.ts', import.meta.url).href)}; await waitForChecks({cwd:process.cwd(),head:'head',names:['Tests'],timeoutMs:1000,pollMs:1});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GitHub unreachable; rerun with --local/);
  assert.match(r.stderr, /HTTP 502/);
});

for (const persistent of [false, true])
  test(`repository lookup ${persistent ? 'outages end with a local hint' : 'failures are retried'} during CI waiting`, (t) => {
    const f = fixture(t);
    writeFileSync(
      join(f.bin, 'gh'),
      `#!/usr/bin/env node
const fs=require('node:fs'), marker=process.env.DESLOP_TEST_STATE+'.repo-retried';
if(process.argv[2]==='repo') {
  if(${persistent}||!fs.existsSync(marker)){fs.writeFileSync(marker,'1');console.error('HTTP 502: repository unavailable');process.exit(1)}
  console.log(JSON.stringify({nameWithOwner:'example/project'}));
} else if(process.argv.some(arg=>arg.includes('/check-runs?'))) console.log(JSON.stringify([{check_runs:[{id:1,name:'Tests',status:'completed',conclusion:'success'}]}]));
else console.log('[[]]');
`,
      { mode: 0o755 },
    );
    f.push();
  const script = `import {waitForChecks} from ${JSON.stringify(new URL('../src/github.ts', import.meta.url).href)}; console.log(JSON.stringify(await waitForChecks({cwd:process.cwd(),head:'head',names:['Tests'],timeoutMs:2000,pollMs:1})));`;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: f.root,
        env: f.env,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, persistent ? 1 : 0, result.stderr);
    if (persistent)
      assert.match(result.stderr, /GitHub unreachable; rerun with --local/);
    else assert.match(result.stdout, /success/);
  });

test('publication policy only accepts booleans and CI-required kinds need checks', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: {
          ...f.config,
          publishLocal: 'yes',
        } as unknown as Config,
      }),
    /publishLocal must be boolean/,
  );
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: {
          ...f.config,
          kinds: [
            {
              ...f.config.kinds[0],
              ciRequired: 'yes',
            },
          ],
        } as unknown as Config,
      }),
    /ciRequired must be boolean/,
  );
  assert.throws(
    () =>
      validateConfig({
        root: f.root,
        config: {
          ...f.config,
          kinds: [
            {
              ...f.config.kinds[0],
              ciRequired: true,
              checks: [],
            },
          ],
        },
      }),
    /ciRequired needs CI checks/,
  );
});


for (const state of ['failure', 'pending'])
  test(`a same-name commit status ${state} survives a successful check run`, () => {
    const checks = checkStates({
      runs: [{
        id: 2,
        name: 'Tests',
        status: 'completed',
        conclusion: 'success'
      }],
      statuses: [{
        id: 3,
        context: 'Tests',
        state
      }, {
        id: 1,
        context: 'Tests',
        state: 'success'
      }],
      names: ['Tests'],
    });
    assert.deepEqual(checks.map(check => check.state), ['success', state]);
  });
