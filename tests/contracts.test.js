import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import picomatch from 'picomatch';
import { checkStates, markerWorkflow, validMarker } from '../src/github.js';
import { select } from '../src/config.js';
import { runningAgent, reviewerChoices, modelChoice } from '../src/review.js';

test('first kind per path unions requirements, including both sides of a rename', () => {
  const config = { skills: { review: 'review.md', writing: 'writing.md' }, kinds: [
    { name: 'docs', match: ['docs/**', '**/*.md'], steps: [], checks: [], skills: ['writing'] },
    { name: 'ui', match: ['web/**'], steps: ['lint', 'test'], checks: ['UI'], skills: 'all' },
    { name: 'code', match: ['**'], steps: ['test'], checks: ['API'], skills: ['review'] },
  ] };
  assert.deepEqual(select({ config, paths: ['README.md'] }), { kinds: ['docs'], steps: [], checks: [], skills: ['writing'] });
  assert.deepEqual(select({ config, paths: ['web/app.js', 'src/old.js', 'docs/new.md'] }), { kinds: ['ui', 'code', 'docs'], steps: ['lint', 'test'], checks: ['UI', 'API'], skills: ['review', 'writing'] });
  assert.throws(() => select({ config: { ...config, kinds: [config.kinds[0]] }, paths: ['unknown.js'] }), /No change kind/);
});

test('CI uses newest exact-name checks and never waits for the marker', () => {
  const runs = [
    { id: 1, name: 'Tests', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'Tests', status: 'in_progress' },
    { id: 3, name: 'verify', status: 'queued' },
    { id: 4, name: 'CodeRabbit', status: 'in_progress', app: { slug: 'coderabbitai' } },
  ];
  assert.deepEqual(checkStates({ runs, statuses: [], names: ['Tests', 'Missing'] }), [{ name: 'Tests', state: 'in_progress' }, { name: 'Missing', state: 'missing' }]);
  assert.deepEqual(checkStates({ runs, statuses: [{ id: 4, context: 'Legacy', state: 'success' }], names: 'all' }), [{ name: 'Tests', state: 'in_progress' }, { name: 'Legacy', state: 'success' }]);
  assert.deepEqual(checkStates({ runs: [], statuses: [], names: 'all' }), [{ name: 'all', state: 'missing' }]);
});

test('generated workflow validates exact commits and local policy without executing pull request code', async () => {
  const head = 'a'.repeat(40);
  const marker = { version: 1, head, mode: 'local', steps: { passed: true, names: ['tests'] }, review: { clean: true, provider: 'codex', round: 1 }, finishedAt: '2026-01-01T00:00:00Z' };
  assert.equal(validMarker({ marker, head }), true);
  assert.equal(validMarker({ marker, head: 'b'.repeat(40) }), false);
  assert.equal(validMarker({ marker, head, localRunCounts: false }), false);
  assert.equal(validMarker({ marker: { ...marker, review: {} }, head }), false);
  const script = markerWorkflow().split('script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('github', 'context', 'core', script);
  const context = { repo: { owner: 'example', repo: 'project' }, issue: { number: 1 }, payload: { repository: { default_branch: 'main' } } };
  let failed = false;
  let accepted = false;
  const github = { rest: { pulls: { get: async () => ({ data: { body: `<!-- verify:v1 ${JSON.stringify(marker)} -->`, head: { sha: head } } }) }, repos: { getContent: async options => { assert.equal(options.ref, 'main'); return { data: { content: Buffer.from(JSON.stringify({ localRunCounts: accepted })).toString('base64') } }; } } } };
  await run(github, context, { setFailed: () => { failed = true; } });
  assert.equal(failed, true);
  accepted = true; failed = false;
  await run(github, context, { setFailed: () => { failed = true; } });
  assert.equal(failed, false);
});

test('reviewer and provider model precedence support hosted Codex, Claude, preferences and explicit overrides', () => {
  assert.equal(runningAgent({ env: { CODEX_THREAD_ID: 'hosted' } }), 'codex');
  assert.equal(runningAgent({ env: { CODEX_SESSION_ID: 'session' } }), 'codex');
  assert.equal(runningAgent({ env: { CLAUDECODE: '1' } }), 'claude');
  assert.deepEqual(reviewerChoices({ settings: {}, env: { CODEX_THREAD_ID: 'hosted' } }), ['codex']);
  assert.deepEqual(reviewerChoices({ settings: { reviewer: ['claude', 'codex'] }, env: {} }), ['claude', 'codex']);
  assert.deepEqual(reviewerChoices({ override: 'custom', settings: { reviewer: 'claude' }, env: {} }), ['custom']);
  assert.throws(() => reviewerChoices({ settings: {}, env: {} }), /pass --reviewer/);
  assert.deepEqual(modelChoice({ provider: 'codex', config: { reviewerModels: { codex: { model: 'repo', effort: 'high' }, claude: { model: 'unrelated' } } }, settings: { reviewerModels: { codex: { model: 'machine' } } }, model: 'run' }), { model: 'run', effort: 'high' });
});


test('CI schedules required checks for repository policy and review skill changes', () => {
  const config = JSON.parse(readFileSync(new URL('../verify.config.json', import.meta.url), 'utf8'));
  const patterns = parse(readFileSync(new URL('../.github/workflows/tests.yml', import.meta.url), 'utf8')).on.pull_request.paths;
  function scheduled(path) {
    let included = false;
    for (const pattern of patterns) {
      const negative = pattern.startsWith('!');
      if (picomatch(negative ? pattern.slice(1) : pattern, { dot: true })(path)) included = !negative;
    }
    return included;
  }
  const paths = ['verify.config.json', '.agents/skills/review/SKILL.md', 'scripts/hosted-smoke.js', 'README.md', 'docs/spec.md'];
  assert.deepEqual(paths.map(path => ({ scheduled: scheduled(path), required: select({ config, paths: [path] }).checks.length > 0 })), [
    { scheduled: true, required: true },
    { scheduled: true, required: true },
    { scheduled: true, required: true },
    { scheduled: false, required: false },
    { scheduled: false, required: false },
  ]);
});
