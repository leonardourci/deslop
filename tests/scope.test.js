import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewScope, codexFilesystem, claudeEdits } from '../src/scope.js';
import { fixture } from './fixtures.js';

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
  const scope = await reviewScope({ cwd: f.root, base, config: f.config });
  assert.deepEqual(scope.instructionFiles, ['.agents/changed.md']);
  const files = codexFilesystem({
    cwd: f.root,
    common: join(f.root, '.git'),
    scope,
  });
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
  });
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
