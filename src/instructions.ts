import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import picomatch from 'picomatch';
import { git } from './process.ts';
import type { Config, Kind } from './types.ts';

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
const testKinds = new Set(['test', 'tests']);
const testFile = picomatch(
  [
    '**/*.{test,spec}.*',
    '**/{test,tests,__tests__,spec,specs}/**',
    '**/{test_*,*_test,*_spec}.*',
  ],
  { dot: true },
);

export function canonicalSkill(name: string) {
  return Object.hasOwn(aliases, name) ? aliases[name] : name;
}

export function defaultSkills({
  kind,
  path,
  hasTests
}: {
  kind: Kind;
  path: string;
  hasTests: boolean;
}) {
  if (
    ['docs', 'prose'].includes(kind.name) ||
    /\.(md|mdx|txt|rst|adoc)$/i.test(path)
  )
    return ['kill-ai-slop'];
  if (testKinds.has(kind.name) || testFile(path) || hasTests)
    return ['review-code', 'audit-tests', 'kill-ai-slop'];
  return ['review-code', 'kill-ai-slop'];
}

export function instructionPaths({
  root,
  instructions = {}
}: {
  root: string;
  instructions?: Record<string, string | false>;
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
}: {
  cwd: string;
  config: Pick<Config, 'commands'> & { kinds: Pick<Kind, 'name' | 'match'>[] };
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
  const kinds = config.kinds.map((kind) => ({
    name: kind.name,
    matches: picomatch(kind.match, { dot: true }),
  }));
  return paths.some(
    (path) =>
      testFile(path) ||
      testKinds.has(kinds.find((kind) => kind.matches(path))?.name),
  );
}
