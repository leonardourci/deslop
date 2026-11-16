import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { git } from './process.js';

export async function optionalGit({
  cwd,
  args
}) {
  try {
    return await git({
      cwd,
      args,
    });
  } catch (error) {
    if (error.code !== 'COMMAND') throw error;
    return null;
  }
}

export async function dirtyPaths({ cwd }) {
  const output = await git({
    cwd,
    args: ['status', '--porcelain', '-z', '--untracked-files=all'],
  });
  const paths = [];
  const records = output.split('\0').filter(Boolean);
  for (let i = 0; i < records.length; i++) {
    paths.push(records[i].slice(3));
    if (/^[RC]|^.[RC]/.test(records[i])) paths.push(records[++i]);
  }
  return paths;
}
export async function gitState({ cwd }) {
  const branch = await git({
    cwd,
    args: ['symbolic-ref', '--short', 'HEAD'],
  });
  const commands = [
    ['rev-parse', 'HEAD'],
    ['symbolic-ref', 'HEAD'],
    ['ls-files', '--stage'],
  ];
  /** @type {unknown[]} */
  const values = await Promise.all(
    commands.map((args) =>
      git({
        cwd,
        args,
      }),
    ),
  );
  const configuration =
    (await optionalGit({
      cwd,
      args: ['config', '--null', '--list'],
    })) || '';
  values.push(
    configuration
      .split('\0')
      .filter((entry) => {
        const key = entry.split('\n')[0].toLowerCase();
        return (
          key.startsWith(`branch.${branch.toLowerCase()}.`) ||
          /^(core\.hookspath|remote\.origin\.|user\.|commit\.|gpg\.|extensions\.worktreeconfig)/.test(
            key,
          )
        );
      })
      .sort(),
  );
  if (
    (await optionalGit({
      cwd,
      args: ['config', '--bool', '--get', 'extensions.worktreeConfig'],
    })) === 'true'
  ) {
    const path = await git({
      cwd,
      args: ['rev-parse', '--git-path', 'config.worktree'],
    });
    values.push(
      existsSync(resolve(cwd, path))
        ? readFileSync(resolve(cwd, path), 'utf8')
        : null,
    );
  }
  const hooksPath = await optionalGit({
    cwd,
    args: ['config', '--get', 'core.hooksPath'],
  });
  const hooks = resolve(
    cwd,
    hooksPath ||
      (await git({
        cwd,
        args: ['rev-parse', '--git-path', 'hooks'],
      })),
  );
  if (existsSync(hooks))
    for (const name of readdirSync(hooks).sort()) {
      const path = join(hooks, name);
      try {
        values.push([
          name,
          statSync(path).mode,
          readFileSync(path).toString('base64'),
        ]);
      } catch (error) {
        // Directories and dangling symlinks are not runnable hooks.
        if (!['EISDIR', 'ENOENT'].includes(error.code)) throw error;
      }
    }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
