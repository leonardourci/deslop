import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import shipped from '../eslint/default.config.js';

function repoConfig({
  cwd,
  file
}) {
  let directory = dirname(file);
  for (;;) {
    for (const name of [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      'eslint.config.mts',
      'eslint.config.cts',
    ]) {
      const path = join(directory, name);
      if (existsSync(path)) return {
        file: path,
        legacy: false
      };
    }
    for (const name of [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
    ]) {
      const path = join(directory, name);
      if (existsSync(path)) return {
        file: path,
        legacy: true
      };
    }
    const pkg = join(directory, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).eslintConfig)
      return {
        file: pkg,
        legacy: true
      };
    if (directory === cwd) return null;
    directory = dirname(directory);
  }
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const {
  cwd,
  files
} = JSON.parse(input);
const groups = new Map();
for (const file of files) {
  const config = repoConfig({
    cwd,
    file
  });
  const key = config?.file || '';
  if (!groups.has(key)) groups.set(key, {
    config,
    files: []
  });
  groups.get(key).files.push(file);
}
/** @type {import('eslint').ESLint.LintResult[]} */
const results = [];
for (const {
  config,
  files: scope
} of groups.values()) {
  /** @type {import('eslint').ESLint.Options} */
  let options;
  if (!config)
    options = {
      cwd,
      overrideConfigFile: true,
      overrideConfig: shipped
    };
  else if (!config.legacy)
    options = {
      cwd: dirname(config.file),
      overrideConfigFile: config.file
    };
  else {
    const compat = new FlatCompat({
      baseDirectory: dirname(config.file),
      recommendedConfig: js.configs.recommended,
      allConfig: js.configs.all,
    });
    options = {
      cwd: dirname(config.file),
      overrideConfigFile: true,
      overrideConfig: compat.extends(config.file),
    };
  }
  const eslint = new ESLint(options);
  results.push(...(await eslint.lintFiles(scope)));
}
const formatter = await new ESLint({ overrideConfigFile: true }).loadFormatter(
  'stylish',
);
process.stdout.write(await formatter.format(results));
if (results.some((result) => result.errorCount > 0)) process.exitCode = 1;
