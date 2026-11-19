import { fileURLToPath } from 'node:url';
import { regularFile } from './scope.ts';
import type { Config, Selection } from './types.ts';

export function lintInvocation({
  cwd,
  config,
  selection,
  paths
}: {
  cwd: string;
  config: Config;
  selection: Selection;
  paths: Iterable<string>;
}) {
  if (config.fallbackLint === false) return null;
  const lintName = /\b(?:eslint|lint)(?::[\w-]+)?\b/i;
  const wired = [
    ...selection.commands,
    ...selection.checks,
    ...selection.commands.map((name) => config.commands[name]),
  ].some((name) => lintName.test(name));
  if (wired) return null;
  const files = Array.from(paths)
    .filter((path) => /\.[cm]?[jt]sx?$/i.test(path))
    .map((path) =>
      regularFile({
        cwd,
        path,
      }),
    )
    .filter(Boolean);
  if (!files.length) return null;
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('../bin/lint-worker.js', import.meta.url))],
    input: JSON.stringify({
      cwd,
      files
    }),
  };
}
