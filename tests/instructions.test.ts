import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { select } from '../src/config.ts';
import { repoHasTests } from '../src/instructions.ts';
import { fixture } from './fixtures.ts';

const config = {
  commands: {},
  kinds: [
    {
      name: 'docs',
      match: ['**/*.md'],
      commands: [],
      checks: [],
    },
    {
      name: 'tests',
      match: ['**/*.test.js'],
      commands: [],
      checks: [],
    },
    {
      name: 'code',
      match: ['**'],
      commands: [],
      checks: [],
    },
  ],
};
const pass = (result) =>
  assert.equal(result.status, 0, result.stdout + result.stderr);

test('a code diff without tests selects correctness and cleanup skills', () => {
  assert.deepEqual(
    select({
      config,
      paths: ['src/app.js'],
    }).instructions,
    ['review-code', 'kill-ai-slop'],
  );
});

test('test files or existing tests add audit-tests to code review', () => {
  for (const options of [
    { paths: ['src/app.test.js'] },
    { paths: ['tests/test_behavior.py'] },
    {
      paths: ['src/app.js'],
      hasTests: true,
    },
  ]) {
    assert.deepEqual(
      select({
        config,
        ...options,
      }).instructions,
      ['review-code', 'audit-tests', 'kill-ai-slop'],
    );
  }
});

test('a prose-only diff selects cleanup without a test audit', () => {
  assert.deepEqual(
    select({
      config,
      paths: ['README.md'],
      hasTests: true,
    }).instructions,
    ['kill-ai-slop'],
  );
});

test('repo instructions replace one default skill and can disable the others', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'review.md'), 'Repo-specific correctness rules');
  f.config.instructions = {
    'review-code': 'review.md',
    'audit-tests': false,
    'kill-ai-slop': false,
  };
  f.configure();
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
  const prompt = f.load().calls[0].prompt.split('\n\nBranch diff')[0];
  assert.match(prompt, /Repo-specific correctness rules/);
  assert.doesNotMatch(prompt, /audit-tests:|kill-ai-slop:|regression coverage|Judge coverage/);
});

test('repo skills named like shipped ones replace them, below the instructions map', (t) => {
  const f = fixture(t);
  const skill = (folder, name, text) => {
    mkdirSync(join(f.root, folder, 'skills', name), { recursive: true });
    writeFileSync(join(f.root, folder, 'skills', name, 'SKILL.md'), text);
  };
  skill('.agents', 'kill-ai-slop', 'Agents cleanup rules');
  skill('.claude', 'kill-ai-slop', 'Claude cleanup rules');
  skill('.claude', 'review-code', 'Claude correctness rules');
  skill('.agents', 'audit-tests', 'Agents test rules');
  writeFileSync(join(f.root, 'tests.md'), 'Mapped test rules');
  f.config.instructions = { 'audit-tests': 'tests.md' };
  f.configure();
  f.commit();
  pass(f.call('run', '--reviewer', 'fixture'));
  const prompt = f.load().calls[0].prompt.split('\n\nBranch diff')[0];
  assert.match(prompt, /review-code:\nClaude correctness rules/);
  assert.match(prompt, /audit-tests:\nMapped test rules/);
  assert.match(prompt, /kill-ai-slop:\nAgents cleanup rules/);
  assert.doesNotMatch(prompt, /Claude cleanup rules|Agents test rules|# Kill AI slop/);
});

test('machine skill overrides win over repo settings without changing the tree', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'repo.md'), 'Repo cleanup rules');
  f.config.instructions = {
    'review-code': false,
    'kill-ai-slop': 'repo.md',
  };
  f.configure();
  f.commit();
  writeFileSync(join(f.home, 'local-review.md'), 'Machine correctness rules');
  const overrides = join(f.home, 'instructions.json');
  writeFileSync(
    overrides,
    JSON.stringify({
      'review-code': 'local-review.md',
      'kill-ai-slop': false,
      'audit-tests': false,
    }),
  );
  f.env.DESLOP_INSTRUCTIONS = overrides;
  pass(f.call('run', '--reviewer', 'fixture'));
  const prompt = f.load().calls[0].prompt.split('\n\nBranch diff')[0];
  assert.match(prompt, /Machine correctness rules/);
  assert.doesNotMatch(prompt, /Repo cleanup rules|audit-tests:|kill-ai-slop:/);
  assert.equal(f.git('status', '--porcelain'), '');
});


test('existing conventional or configured test paths select a code audit', async (t) => {
  for (const path of ['src/__tests__/behavior.js', 'tests/test_behavior.py', 'checks/behavior.py']) {
    const f = fixture(t);
    const detection = {
      commands: {},
      kinds: [{
        name: 'tests',
        match: ['checks/**/*.py']
      }]
    };
    assert.equal(await repoHasTests({
      cwd: f.root,
      config: detection
    }), false);
    mkdirSync(join(f.root, path, '..'), { recursive: true });
    writeFileSync(join(f.root, path), 'test fixture');
    f.commit();
    const hasTests = await repoHasTests({
      cwd: f.root,
      config: detection
    });
    assert.equal(hasTests, true, path);
    assert.ok(select({
      config,
      paths: ['src/app.js'],
      hasTests
    }).instructions.includes('audit-tests'));
  }
});
