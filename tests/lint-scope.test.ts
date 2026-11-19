import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintInvocation } from '../src/lint.ts';
import { fixture } from './fixtures.ts';

test('fallback lint excludes files reached through a directory symlink', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.home, 'outside.js'), 'const unused = 1;');
  symlinkSync(f.home, join(f.root, 'linked'));
  assert.equal(lintInvocation({
    cwd: f.root,
    config: {
      ...f.config,
      fallbackLint: true
    },
    selection: {
      kinds: [],
      commands: [],
      checks: [],
      requiredChecks: [],
      instructions: [],
    },
    paths: ['linked/outside.js'],
  }), null);
});
