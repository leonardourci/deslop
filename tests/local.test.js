import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const module = new URL('../src/local.js', import.meta.url).href;

function worker({ home }) {
  const call = `exclusiveRun({file:${JSON.stringify(join(home, 'deslop.lock'))},work})`;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {exclusiveRun} from ${JSON.stringify(module)};const work=async()=>{console.log('entered');process.stdin.resume();await new Promise(resolve=>process.stdin.once('end',resolve));};await ${call};`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  const pending = [];
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    for (const entry of pending)
      if (stdout.includes(entry.text)) entry.resolve();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve, reject) =>
    child.on('exit', (code, signal) =>
      code === 0 || signal === 'SIGKILL'
        ? resolve()
        : reject(new Error(stderr)),
    ),
  );
  done.catch(() => {});
  function wait(text) {
    if (stdout.includes(text)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No ${text}: ${stdout} ${stderr}`)),
        10000,
      );
      pending.push({
        text,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }
  return {
    child,
    done,
    wait,
    output: () => stdout,
  };
}

test('a checkout admits only one deslop writer and releases its lock after completion', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'deslop-exclusive-'));
  const children = [];
  t.after(async () => {
    for (const run of children)
      if (run.child.exitCode === null) run.child.kill('SIGKILL');
    await Promise.allSettled(children.map((run) => run.done));
    rmSync(home, {
      recursive: true,
      force: true,
    });
  });
  const first = worker({ home });
  children.push(first);
  await first.wait('entered');
  const second = worker({ home });
  children.push(second);
  await assert.rejects(second.done, /already running/);
  assert.doesNotMatch(second.output(), /entered/);
  first.child.stdin.end();
  await first.done;
  const third = worker({ home });
  children.push(third);
  await third.wait('entered');
  third.child.stdin.end();
  await third.done;
});

test('concurrent stale-lock recovery admits one writer, including empty abandoned recovery', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'deslop-recovery-'));
  const {
    mkdirSync,
    writeFileSync
  } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { pid } = spawnSync(process.execPath, ['-e', '']);
  const file = join(home, 'deslop.lock');
  mkdirSync(file);
  writeFileSync(join(file, `${pid}-dead`), '');
  const children = [];
  t.after(async () => {
    for (const run of children)
      if (run.child.exitCode === null) run.child.kill('SIGKILL');
    await Promise.allSettled(children.map(run => run.done));
    rmSync(home, {
      recursive: true,
      force: true
    });
  });
  for (let i = 0; i < 8; i++) children.push(worker({ home }));
  const results = await Promise.allSettled(children.map(run => run.wait('entered')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = children.find(run => run.output().includes('entered'));
  winner.child.kill('SIGKILL');
  await winner.done;
  const next = worker({ home });
  children.push(next);
  await next.wait('entered');
  next.child.stdin.end();
  await next.done;
  mkdirSync(file);
  const recovered = worker({ home });
  children.push(recovered);
  await recovered.wait('entered');
  recovered.child.stdin.end();
  await recovered.done;
});
