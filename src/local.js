import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execute, VerifyError } from './process.js';

const POLL_MS = 500;
const QUEUE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function alive({ pid }) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export async function localSlot({ home, limit, work }) {
  if (limit === undefined) return await work();
  mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(join(home, 'local-runs.sqlite'));
  db.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL)');
  const ticket = db.prepare('INSERT INTO queue (pid) VALUES (?)').run(process.pid).lastInsertRowid;
  const clean = () => { db.prepare('DELETE FROM queue WHERE id = ?').run(ticket); };
  process.once('exit', clean);
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;
  let reported = false;
  try {
    while (Date.now() < deadline) {
      db.exec('BEGIN IMMEDIATE');
      let rows;
      try {
        for (const row of db.prepare('SELECT id, pid FROM queue').all()) {
          if (!alive({ pid: row.pid })) db.prepare('DELETE FROM queue WHERE id = ?').run(row.id);
        }
        rows = db.prepare('SELECT id FROM queue ORDER BY id').all();
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const position = rows.findIndex(row => BigInt(row.id) === BigInt(ticket));
      if (position >= 0 && position < limit) return await work();
      if (!reported) {
        console.log(`queued: ${limit} local slots busy; ${Math.max(0, position - limit)} ahead`);
        reported = true;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
    throw new VerifyError('QUEUE', 'Local queue wait expired; run again');
  } finally {
    process.removeListener('exit', clean);
    clean();
    db.close();
  }
}

export async function runSteps({ cwd, names, commands, assertHead }) {
  for (const name of names) {
    console.log(`step: ${name}`);
    await execute({ cwd, command: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', args: process.platform === 'win32' ? ['/c', commands[name]] : ['-c', commands[name]], inherit: true });
    await assertHead();
  }
  return names;
}

export async function exclusiveRun({ file, work }) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS active (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const owner = db.prepare('SELECT pid FROM active WHERE id = 1').get();
    if (owner && alive({ pid: owner.pid })) throw new VerifyError('RUN_IN_PROGRESS', 'Verification is already running in this checkout');
    db.exec('DELETE FROM active');
    db.prepare('INSERT INTO active (id, pid) VALUES (1, ?)').run(process.pid);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const clean = () => db.prepare('DELETE FROM active WHERE id = 1 AND pid = ?').run(process.pid);
  process.once('exit', clean);
  try { return await work(); }
  finally { process.removeListener('exit', clean); clean(); db.close(); }
}
