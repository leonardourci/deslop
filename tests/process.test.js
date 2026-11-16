import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { execute } from '../src/process.js';

test('hung commands and their children are terminated with a timeout reason', async () => {
  let output = '';
  const log = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
  await assert.rejects(
    execute({
      command: process.execPath,
      args: [
        '-e',
        `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('descendant ready');setInterval(()=>{},1000)"],{stdio:'inherit'});setInterval(()=>{},1000)`,
      ],
      timeoutMs: 1000,
      log,
    }),
    { code: 'COMMAND_TIMEOUT' },
  );
  assert.match(output, /descendant ready/);
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
