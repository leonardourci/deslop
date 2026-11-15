import { extname } from 'node:path';
import { git } from './process.js';

export const BINARY_NOTE = 'binary files, not content-reviewed';

export async function binaryEvidence({ cwd, base, head }) {
  const counts = await git({ cwd, args: ['diff', '--numstat', '--no-renames', '-z', base, head] });
  const paths = counts.split('\0').filter(record => record.startsWith('-\t-\t')).map(record => record.slice(4));
  if (!paths.length) return [];
  const changes = (await git({ cwd, args: ['diff', '--raw', '--no-abbrev', '--no-renames', '-z', base, head] })).split('\0');
  const objects = new Map();
  for (let index = 0; index < changes.length - 1; index += 2) {
    const [, , oldObject, newObject, status] = changes[index].split(' ');
    objects.set(changes[index + 1], { oldObject, newObject, status });
  }
  return await Promise.all(paths.map(async path => {
    const object = objects.get(path);
    const removed = object.status === 'D';
    const sha = removed ? object.oldObject : object.newObject;
    const size = Number(await git({ cwd, args: ['cat-file', '-s', sha] }));
    let change = 'changed';
    if (removed) change = 'removed';
    else if (object.status === 'A') change = 'added';
    return { path, type: extname(path).slice(1).toLowerCase() || 'binary', size,
      change };
  }));
}
