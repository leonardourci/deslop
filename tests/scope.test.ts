import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewScope, codexFilesystem, claudeEdits } from '../src/scope.ts';
import { fixture } from './fixtures.ts';

test('only tracked instruction files in the diff gain write access and git stays read-only', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.agents'));
  mkdirSync(join(f.root, '.codex'));
  writeFileSync(join(f.root, '.agents', 'changed.md'), 'before');
  writeFileSync(join(f.root, '.agents', 'unchanged.md'), 'keep');
  writeFileSync(join(f.root, '.codex/config.toml'), 'before');
  writeFileSync(join(f.root, '.gitignore'), '.agents/ignored.md\n');
  const base = f.commit();
  writeFileSync(join(f.root, '.agents', 'changed.md'), 'after');
  writeFileSync(join(f.root, '.codex/config.toml'), 'after');
  f.commit();
  writeFileSync(join(f.root, '.agents', 'ignored.md'), 'private');
  writeFileSync(join(f.root, '.agents', 'untracked.md'), 'keep');
  const scope = await reviewScope({
    cwd: f.root,
    base,
    config: f.config,
  });
  assert.deepEqual(scope.instructionFiles, ['.agents/changed.md']);
  const findingsFile = join(f.home, '.deslop', 'repos', 'repo', 'reviews', 'run.json');
  const files = codexFilesystem({
    cwd: f.root,
    common: join(f.root, '.git'),
    scope,
    findingsFile,
  });
  assert.equal(files[findingsFile], 'write');
  assert.equal(files[join(f.root, '.agents/changed.md')], 'write');
  assert.equal(files[join(f.root, '.agents/unchanged.md')], 'read');
  assert.equal(files[join(f.root, '.agents/ignored.md')], 'deny');
  assert.equal(files[join(f.root, '.agents/untracked.md')], 'deny');
  assert.equal(files[join(f.root, '.git')], 'read');
  assert.equal(files[join(f.root, '.codex/config.toml')], 'read');
  const claude = claudeEdits({
    cwd: f.root,
    common: join(f.root, '.git'),
    scope,
    findingsFile,
  });
  assert.ok(claude.allow.includes(`Write(/${findingsFile})`));
  assert.ok(
    claude.allow.includes(`Edit(/${join(f.root, '.agents/changed.md')})`),
  );
  assert.ok(
    claude.deny.includes(`Edit(/${join(f.root, '.agents/untracked.md')})`),
  );
  assert.ok(claude.deny.includes(`Edit(/${join(f.root, '.git')}/**)`));
  assert.ok(claude.deny.includes(`Write(/${join(f.root, '.git')}/**)`));
  assert.ok(claude.allow.includes(`Write(/${join(f.root, 'tests')}/**)`));
  assert.ok(
    claude.deny.includes(`Write(/${join(f.root, '.agents/untracked.md')})`),
  );
});

test('excluded filenames are literal Claude read denies', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'private[prod]*?.json'), 'secret');
  const scope = await reviewScope({
    cwd: f.root,
    base: 'main',
    config: f.config
  });
  const rules = claudeEdits({
    cwd: f.root,
    common: join(f.root, '.git'),
    scope,
    findingsFile: join(f.home, 'findings.txt'),
  });
  assert.ok(rules.deny.includes(`Read(/${f.root}/private\\[prod\\]\\*\\?.json)`));
});
