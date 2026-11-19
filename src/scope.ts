import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { git, DeslopError } from './process.ts';
import type { Config, Scope } from './types.ts';

const INSTRUCTION_ROOTS = ['.agents', '.claude', '.codex', 'skills'];
const split = (value: string) => value.split('\0').filter(Boolean);
// Null unless the path is a regular file inside cwd, not reached through a symlinked directory.
export function regularFile({
  cwd,
  path
}: {
  cwd: string;
  path: string;
}) {
  const absolute = resolve(cwd, path);
  if (!absolute.startsWith(cwd + sep) || !existsSync(absolute)) return null;
  if (!lstatSync(absolute).isFile()) return null;
  for (let parent = dirname(absolute); parent !== cwd; parent = dirname(parent))
    if (lstatSync(parent).isSymbolicLink()) return null;
  return absolute;
}
export function instructionPath({
  path,
  configured = []
}: {
  path: string;
  configured?: string[];
}) {
  return (
    INSTRUCTION_ROOTS.includes(path.split('/')[0]) ||
    /(^|\/)(AGENTS|CLAUDE)\.md$/.test(path) ||
    configured.includes(path)
  );
}
function projectPath({
  cwd,
  path
}: {
  cwd: string;
  path: string;
}) {
  const absolute = resolve(cwd, path);
  if (
    !absolute.startsWith(cwd + sep) ||
    relative(cwd, absolute)
      .split(sep)
      .some((part) => part.toLowerCase() === '.git')
  )
    throw new DeslopError(
      'EDITOR_SCOPE',
      'Git metadata and paths outside the project are not editable',
    );
  return regularFile({
    cwd,
    path,
  });
}
export async function reviewScope({
  cwd,
  base,
  config
}: {
  cwd: string;
  base: string;
  config: Config;
}) {
  const [diff, tracked, ignored, untracked] = await Promise.all([
    git({
      cwd,
      args: ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
    }),
    git({
      cwd,
      args: ['ls-files', '-z'],
    }),
    git({
      cwd,
      args: [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '-z',
      ],
    }),
    git({
      cwd,
      args: ['ls-files', '--others', '--exclude-standard', '--directory', '-z'],
    }),
  ]);
  const configured = Object.values(config.instructions || {})
    .filter((file) => typeof file === 'string')
    .map((path) => relative(cwd, resolve(cwd, path)).split(sep).join('/'));
  const trackedFiles = new Set(split(tracked));
  const instructionFiles = split(diff).filter(
    (path) =>
      trackedFiles.has(path) &&
      instructionPath({
        path,
        configured,
      }) &&
      (configured.includes(path) || /\.(md|mdx|rst|txt)$/i.test(path)) &&
      projectPath({
        cwd,
        path,
      }),
  );
  if (instructionFiles.some((path) => /[*?[\]\r\n]/.test(path)))
    throw new DeslopError(
      'EDITOR_SCOPE',
      'Instruction filenames with glob characters cannot receive a literal write grant',
    );
  const excluded = [...new Set([...split(ignored), ...split(untracked)])];
  const protectedInstructions = split(tracked).filter(
    (path) =>
      instructionPath({
        path,
        configured,
      }) && !instructionFiles.includes(path),
  );
  const normalDirectories = readdirSync(cwd, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !INSTRUCTION_ROOTS.includes(entry.name) &&
        entry.name !== '.git' &&
        !excluded.some((path) => path.replace(/\/$/, '') === entry.name),
    )
    .map((entry) => entry.name);
  const sourceDirectories = [
    ...new Set([...normalDirectories, 'src', 'test', 'tests', '__tests__']),
  ];
  return {
    instructionFiles,
    protectedInstructions,
    excluded,
    normalDirectories: sourceDirectories,
    configured,
  };
}
export function codexFilesystem({
  cwd,
  common,
  scope
}: {
  cwd: string;
  common: string;
  scope: Scope;
}) {
  const rules: Record<string, string> = {
    ':tmpdir': 'read',
    ':slash_tmp': 'read',
    [join(cwd, '.git')]: 'read',
    [common]: 'read',
  };
  for (const root of INSTRUCTION_ROOTS) rules[join(cwd, root)] = 'read';
  for (const file of ['AGENTS.md', 'CLAUDE.md', ...scope.protectedInstructions])
    rules[resolve(cwd, file)] = 'read';
  for (const path of scope.instructionFiles)
    rules[resolve(cwd, path)] = 'write';
  for (const path of scope.excluded) rules[resolve(cwd, path)] = 'deny';
  return rules;
}
export function claudeEdits({
  cwd,
  common,
  scope
}: {
  cwd: string;
  common: string;
  scope: Scope;
}) {
  const absolute = (path: string) => '/' + resolve(cwd, path);
  const allow = [
    `Edit(${absolute('*')})`,
    ...scope.normalDirectories.map((path) => `Edit(${absolute(path)}/**)`),
    ...scope.instructionFiles.map((path) => `Edit(${absolute(path)})`),
  ];
  allow.push(...allow.map((rule) => rule.replace(/^Edit\(/, 'Write(')));
  const denied = new Set([
    '.git',
    common,
    ...scope.excluded,
    ...scope.protectedInstructions,
    ...['AGENTS.md', 'CLAUDE.md'].filter(
      (path) => !scope.instructionFiles.includes(path),
    ),
  ]);
  const literalPath = (path: string) => absolute(path).replace(/[\\*?[\]]/g, '\\$&');
  const deny = ['Bash', 'Agent'];
  for (const path of denied)
    deny.push(
      `Edit(${literalPath(path)})`,
      `Edit(${literalPath(path).replace(/\/$/, '')}/**)`,
      `Write(${literalPath(path)})`,
      `Write(${literalPath(path).replace(/\/$/, '')}/**)`,
    );
  for (const path of scope.excluded) {
    const literal = literalPath(path);
    deny.push(
      `Read(${literal})`,
      `Read(${literal.replace(/\/$/, '')}/**)`,
    );
  }
  return {
    allow,
    deny,
  };
}
export async function assertInstructionScope({
  cwd,
  scope
}: {
  cwd: string;
  scope: Scope;
}) {
  const [diff, untracked] = await Promise.all([
    git({
      cwd,
      args: ['diff', '--name-only', '-z', 'HEAD'],
    }),
    git({
      cwd,
      args: ['ls-files', '--others', '--exclude-standard', '-z'],
    }),
  ]);
  const outside = [...split(diff), ...split(untracked)].find(
    (path) =>
      instructionPath({
        path,
        configured: scope.configured,
      }) && !scope.instructionFiles.includes(path),
  );
  if (outside)
    throw new DeslopError(
      'EDITOR_SCOPE',
      `Instruction file is outside the reviewed diff: ${outside}`,
    );
}
