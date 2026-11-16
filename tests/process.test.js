import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/process.js';

test('hung commands and their children are terminated with a timeout reason', async () => {
  await assert.rejects(
    execute({
      command: process.execPath,
      args: [
        '-e',
        `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});setInterval(()=>{},1000)`,
      ],
      timeoutMs: 100,
    }),
    { code: 'COMMAND_TIMEOUT' },
  );
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
