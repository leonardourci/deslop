import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import config from '../eslint/default.config.js';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: config,
});

for (const [filePath, code] of [
  ['object.js', 'export const pair = { left: 1, right: 2 };'],
  [
    'pattern.js',
    'const {left, right} = {left: 1, right: 2}; export {left, right};',
  ],
  ['type.ts', 'export type Pair = { left: number; right: number };'],
  ['interface.ts', 'export interface Pair { left: number; right: number }'],
])
  test(`multi-entry ${filePath} must put entries on separate lines`, async () => {
    const [result] = await eslint.lintText(code, { filePath });
    assert.ok(
      result.messages.some(
        (message) => message.ruleId === 'deslop/entries-on-lines',
      ),
    );
    const fixer = new ESLint({
      overrideConfigFile: true,
      overrideConfig: config,
      fix: true,
    });
    const [fixed] = await fixer.lintText(code, { filePath });
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
    assert.match(fixed.output, /\n\s+left/);
  });

test('a single-entry object may remain inline', async () => {
  const [result] = await eslint.lintText('export const one = { value: 1 };', {
    filePath: 'one.js',
  });
  assert.equal(result.errorCount, 0);
});

test('unused variables and imports fail lint', async () => {
  const [result] = await eslint.lintText(
    "import unused from 'node:fs'; const extra = 1;",
    { filePath: 'unused.js' },
  );
  assert.equal(
    result.messages.filter((message) => message.ruleId === 'no-unused-vars')
      .length,
    2,
  );
});

test('em dashes in strings, templates and comments fail lint', async () => {
  const dash = String.fromCharCode(0x2014);
  const [result] = await eslint.lintText(
    `export const text = '${dash}'; export const template = \`${dash}\`; // ${dash}`,
    { filePath: 'words.js' },
  );
  assert.equal(
    result.messages.filter((message) => message.ruleId === 'deslop/no-em-dash')
      .length,
    3,
  );
});

test('the project type checker rejects a JavaScript type error', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'deslop-typecheck-'));
  t.after(() =>
    rmSync(home, {
      recursive: true,
      force: true,
    }),
  );
  mkdirSync(join(home, 'src'));
  symlinkSync(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(home, 'node_modules'),
    'dir',
  );
  copyFileSync(
    new URL('../tsconfig.json', import.meta.url),
    join(home, 'tsconfig.json'),
  );
  writeFileSync(
    join(home, 'src/invalid.js'),
    'const value = 1; value.toUpperCase();',
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../node_modules/typescript/bin/tsc', import.meta.url),
      ),
      '--noEmit',
    ],
    {
      cwd: home,
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /TS2339.*toUpperCase/);
});
