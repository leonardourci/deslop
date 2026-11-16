import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import picomatch from 'picomatch';
import { git } from './process.js';

export const DEFAULT_SKILLS = Object.fromEntries(
  ['review-code', 'audit-tests', 'kill-ai-slop'].map((name) => [
    name,
    fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)),
  ]),
);
const aliases = {
  code: 'review-code',
  tests: 'audit-tests',
  writing: 'kill-ai-slop',
};
const testFile = picomatch(
  [
    '**/*.{test,spec}.{js,cjs,mjs,jsx,ts,cts,mts,tsx}',
    '**/{test,tests,__tests__}/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}',
  ],
  { dot: true },
);

export function canonicalSkill(name) {
  return Object.hasOwn(aliases, name) ? aliases[name] : name;
}

export function defaultSkills({
  kind,
  path,
  hasTests
}) {
  if (
    ['docs', 'prose'].includes(kind.name) ||
    /\.(md|mdx|txt|rst|adoc)$/i.test(path)
  )
    return ['kill-ai-slop'];
  if (['test', 'tests'].includes(kind.name) || testFile(path) || hasTests)
    return ['review-code', 'audit-tests', 'kill-ai-slop'];
  return ['review-code', 'kill-ai-slop'];
}

export function instructionPaths({
  root,
  instructions = {}
}) {
  return Object.fromEntries(
    Object.entries(instructions).map(([name, file]) => [
      canonicalSkill(name),
      file === false ? false : resolve(root, file),
    ]),
  );
}

export async function repoHasTests({
  cwd,
  config
}) {
  if (
    Object.hasOwn(config.commands, 'test') ||
    Object.hasOwn(config.commands, 'tests')
  )
    return true;
  const paths = (
    await git({
      cwd,
      args: ['ls-files', '-z'],
    })
  )
    .split('\0')
    .filter(Boolean);
  return paths.some((path) => testFile(path));
}
