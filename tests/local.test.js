import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const module = new URL('../src/local.js', import.meta.url).href;

function worker({ home, exclusive = false }) {
  const call = exclusive ? `exclusiveRun({file:${JSON.stringify(join(home, 'active.sqlite'))},work})` : `localSlot({home:${JSON.stringify(home)},limit:1,work})`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {localSlot,exclusiveRun} from ${JSON.stringify(module)};const work=async()=>{console.log('entered');process.stdin.resume();await new Promise(resolve=>process.stdin.once('end',resolve));};await ${call};`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const pending = [];
  child.stdout.on('data', chunk => { stdout += chunk; for (const entry of pending) if (stdout.includes(entry.text)) entry.resolve(); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => child.on('exit', (code, signal) => code === 0 || signal === 'SIGKILL' ? resolve() : reject(new Error(stderr))));
  function wait(text) {
    if (stdout.includes(text)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No ${text}: ${stdout} ${stderr}`)), 10000);
      pending.push({ text, resolve: () => { clearTimeout(timer); resolve(); } });
    });
  }
  return { child, done, wait, output: () => stdout };
}

test('machine local limit queues runs across repos and recovers a dead holder', async t => {
  const home = mkdtempSync(join(tmpdir(), 'verify-queue-'));
  const children = [];
  t.after(async () => { for (const run of children) if (run.child.exitCode === null) run.child.kill('SIGKILL'); await Promise.all(children.map(run => run.done)); rmSync(home, { recursive: true, force: true }); });
  const first = worker({ home }); children.push(first);
  await first.wait('entered');
  const second = worker({ home }); children.push(second);
  await second.wait('queued:');
  assert.doesNotMatch(second.output(), /entered/);
  first.child.kill('SIGKILL'); await first.done;
  await second.wait('entered');
  second.child.stdin.end();
  await second.done;
  const third = worker({ home }); children.push(third);
  await third.wait('entered'); third.child.stdin.end(); await third.done;
});


test('a checkout admits only one verification writer and releases its lock after completion', async t => {
  const home = mkdtempSync(join(tmpdir(), 'verify-exclusive-'));
  const children = [];
  t.after(async () => { for (const run of children) if (run.child.exitCode === null) run.child.kill('SIGKILL'); await Promise.allSettled(children.map(run => run.done)); rmSync(home, { recursive: true, force: true }); });
  const first = worker({ home, exclusive: true }); children.push(first);
  await first.wait('entered');
  const second = worker({ home, exclusive: true }); children.push(second);
  await assert.rejects(second.done, /already running/);
  assert.doesNotMatch(second.output(), /entered/);
  first.child.stdin.end(); await first.done;
  const third = worker({ home, exclusive: true }); children.push(third);
  await third.wait('entered'); third.child.stdin.end(); await third.done;
});
