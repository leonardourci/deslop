import { DatabaseSync } from 'node:sqlite';
import { DeslopError } from './process.js';

function alive({ pid }) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export async function exclusiveRun({ file, work }) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS active (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const owner = db.prepare('SELECT pid FROM active WHERE id = 1').get();
    if (owner && alive({ pid: owner.pid })) throw new DeslopError('RUN_IN_PROGRESS', 'Verification is already running in this checkout');
    db.exec('DELETE FROM active');
    db.prepare('INSERT INTO active (id, pid) VALUES (1, ?)').run(process.pid);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const clean = () => db.prepare('DELETE FROM active WHERE id = 1 AND pid = ?').run(process.pid);
  process.once('exit', clean);
  try { return await work(); }
  finally { process.removeListener('exit', clean); clean(); db.close(); }
}
