import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { execute } from '../src/process.js';

test('hung commands and their children are terminated with a timeout reason', async (t) => {
  let output = '';
  const log = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
  await assert.rejects(
    execute({
      command: process.execPath,
      args: [
        '-e',
        `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('descendant ready '+process.pid);setInterval(()=>{},1000)"],{stdio:'inherit'});setInterval(()=>{},1000)`,
      ],
      timeoutMs: 1000,
      log,
    }),
    { code: 'COMMAND_TIMEOUT' },
  );
  const pid = Number(output.match(/descendant ready (\d+)\r?\n/)?.[1]);
  assert.ok(pid, output);
  t.after(() => { if (running(pid)) process.kill(pid, 'SIGKILL'); });
  const deadline = Date.now() + 5000;
  while (running(pid) && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(running(pid), false, `descendant ${pid} survived timeout`);
});

test('a multibyte character split across output chunks is decoded intact', async () => {
  const output = await execute({
    command: process.execPath,
    args: [
      '-e',
      'process.stdout.write(Buffer.from([0xc3]));setTimeout(()=>process.stdout.write(Buffer.from([0xa9])),50)',
    ],
  });
  assert.equal(output, 'é');
});

test('a failed command reports stdout when stderr is empty', async () => {
  await assert.rejects(
    execute({
      command: process.execPath,
      args: ['-e', "console.log('rate limited');process.exit(1)"],
    }),
    /rate limited/,
  );
});


function running(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0];
      if (state === 'Z') return false;
    }
    return true;
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes(error.code)) return false;
    throw error;
  }
}

test('interrupting a command runner terminates its active child group before returning', { skip: process.platform === 'win32' }, async (t) => {
  const { spawn } = await import('node:child_process');
  const descendant = "process.on('SIGTERM',()=>{});console.log('descendant ready '+process.pid);setInterval(()=>{},1000)";
  const script = `import {execute} from ${JSON.stringify(new URL('../src/process.js', import.meta.url).href)};execute({command:process.execPath,args:['-e',${JSON.stringify(descendant)}],log:process.stdout,timeoutMs:10000}).catch(error=>{console.error(error.code);process.exitCode=1;});`;
  const driver = spawn(process.execPath, ['--input-type=module', '-e', script]);
  let output = '', errors = '', pid;
  const done = new Promise(resolve => driver.once('close', resolve));
  t.after(() => {
    if (driver.exitCode === null) driver.kill('SIGKILL');
    if (pid && running(pid)) process.kill(pid, 'SIGKILL');
  });
  driver.stderr.on('data', chunk => errors += chunk);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('descendant did not start')), 5000);
    driver.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/descendant ready (\d+)\r?\n/);
      if (match) {
        pid = Number(match[1]);
        clearTimeout(timer);
        resolve();
      }
    });
  });
  driver.kill('SIGTERM');
  await done;
  assert.match(errors, /COMMAND_INTERRUPTED/);
  assert.equal(running(pid), false, `descendant ${pid} survived interruption`);
});
