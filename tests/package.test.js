import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture } from './fixtures.js';

test('the installed package supplies its review skills and fallback lint', (t) => {
  const f = fixture(t);
  const project = fileURLToPath(new URL('..', import.meta.url));
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', f.home], {
    cwd: project,
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  const archive = JSON.parse(packed.stdout)[0].filename;
  const extracted = spawnSync('tar', ['-xzf', join(f.home, archive), '-C', f.home]);
  assert.equal(extracted.status, 0, extracted.stderr.toString());
  const installed = join(f.home, 'package');
  symlinkSync(join(project, 'node_modules'), join(installed, 'node_modules'), 'dir');
  delete f.config.fallbackLint;
  f.config.checkFixAttempts = 0;
  f.configure();
  writeFileSync(join(f.root, 'invalid.js'), 'export const unusedPair = { left: 1, right: 2 };');
  mkdirSync(join(f.root, 'src/__tests__'), { recursive: true });
  writeFileSync(join(f.root, 'src/__tests__/behavior.js'), 'export const present = true;');
  f.commit();
  const run = spawnSync(process.execPath, [join(installed, 'src/cli.js'), 'run', '--reviewer', 'fixture'], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /deslop lint fail/);
  const failure = f.runs()[0].checks.find((check) => check.name === 'deslop lint');
  assert.match(JSON.stringify(failure.failures), /invalid\.js/);
  assert.match(JSON.stringify(failure.failures), /deslop\/entries-on-lines/);
  const prompt = f.load().calls[0].prompt.split('\n\nBranch diff')[0];
  assert.match(prompt, /review-code:/);
  assert.match(prompt, /audit-tests:/);
  assert.match(prompt, /kill-ai-slop:/);
});
