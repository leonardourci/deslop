import {
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let pid;
      try {
        pid = Number(readFileSync(file, 'utf8'));
      } catch (readError) {
        if (readError.code === 'ENOENT') continue;
        throw readError;
      }
      if (alive({ pid }))
        throw new DeslopError(
          'RUN_IN_PROGRESS',
          'deslop is already running in this checkout',
        );
      // Claim a dead owner's file atomically so competing takers cannot unlink a new lock.
      const claim = `${file}.reclaim`;
      let fd;
      try {
        fd = openSync(claim, 'wx');
        writeFileSync(fd, String(process.pid));
      } catch (claimError) {
        if (claimError.code !== 'EEXIST') throw claimError;
        try {
          const claimant = Number(readFileSync(claim, 'utf8'));
          if (!alive({ pid: claimant })) {
            unlinkSync(claim);
            continue;
          }
        } catch (readError) {
          if (readError.code === 'ENOENT') continue;
          throw readError;
        }
        throw new DeslopError(
          'RUN_IN_PROGRESS',
          'deslop lock is being recovered; retry',
        );
      }
      try {
        if (Number(readFileSync(file, 'utf8')) === pid) unlinkSync(file);
      } catch (reclaimError) {
        if (reclaimError.code !== 'ENOENT') throw reclaimError;
      } finally {
        closeSync(fd);
        unlinkSync(claim);
      }
    }
  }
  const clean = () => {
    try {
      if (Number(readFileSync(file, 'utf8')) === process.pid) unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
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
