import { mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DeslopError } from './process.js';

function alive({ pid }) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

export async function exclusiveRun({
  file,
  work
}) {
  const owner = `${process.pid}-${randomUUID()}`;
  const prepared = `${file}.${owner}`;
  mkdirSync(prepared);
  writeFileSync(join(prepared, owner), '');
  try {
    for (;;) {
      try {
        // Publish a populated directory: a replacement lock is never empty.
        renameSync(prepared, file);
        break;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'ENOTDIR'].includes(error.code)) throw error;
        let owners;
        try {
          owners = readdirSync(file);
        } catch (readError) {
          if (readError.code === 'ENOENT') continue;
          if (readError.code !== 'ENOTDIR') throw readError;
          throw new DeslopError('LEGACY_LOCK', 'Legacy deslop lock found; stop older writers and remove it before retrying');
        }
        if (owners.some((name) => alive({ pid: Number(name.split('-')[0]) })))
          throw new DeslopError('RUN_IN_PROGRESS', 'deslop is already running in this checkout');
        try {
          for (const name of owners) unlinkSync(join(file, name));
          if (owners.length) console.error(`Recovered deslop lock from dead owner ${owners.join(', ')}`);
          // A competing replacement contains its unique owner, so rmdir cannot remove it.
          rmdirSync(file);
        } catch (reclaimError) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(reclaimError.code)) throw reclaimError;
        }
      }
    }
  } catch (error) {
    unlinkSync(join(prepared, owner));
    rmdirSync(prepared);
    throw error;
  }
  const clean = () => {
    unlinkSync(join(file, owner));
    try {
      rmdirSync(file);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  };
  process.once('exit', clean);
  try {
    return await work();
  } finally {
    process.removeListener('exit', clean);
    clean();
  }
}
