import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { finished } from 'node:stream/promises';
import { github, waitForChecks } from './github.js';

export function failureDetails({ name, output }) {
  const lines = output.split('\n');
  const index = lines.findIndex(line => /(?:FAIL|Error:|AssertionError|[×✖])/i.test(line));
  const start = Math.max(0, index);
  return [{ test: name, message: (lines[index] || `${name} failed`).slice(0, 500), excerpt: lines.slice(start, start + 20).map(line => line.slice(0, 1000)).join('\n') }];
}
async function commandCheck({ cwd, name, command, file }) {
  const log = createWriteStream(file);
  let ok;
  try {
    ok = await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/c', command] : ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      child.on('error', reject); child.on('close', code => resolve(code === 0));
    });
  } finally { log.end(); await finished(log); }
  const output = ok ? '' : readFileSync(file, 'utf8');
  return { name, ok, log: relative(cwd, file), failures: ok ? [] : failureDetails({ name, output }) };
}
export async function runChecks({ cwd, dir, config, selection, ci, head, attempt }) {
  const checks = [];
  if (!ci) {
    for (const [index, name] of selection.commands.entries()) checks.push(await commandCheck({ cwd, name, command: config.commands[name], file: join(dir, `checks-${attempt}-${index}.log`) }));
    return checks;
  }
  const states = await waitForChecks({ cwd, head, names: selection.checks });
  for (const [index, state] of states.entries()) {
    const file = join(dir, `checks-${attempt}-${index}.log`);
    const ok = state.state === 'success';
    let output = `${state.name}: ${state.state}\n`;
    const run = state.url?.match(/\/actions\/runs\/(\d+)/)?.[1];
    if (!ok && run) {
      try { output += await github({ cwd, args: ['run', 'view', run, '--log-failed'] }); } catch (error) { output += `Cannot read failed CI logs: ${error.message}`; }
    }
    writeFileSync(file, output);
    checks.push({ name: state.name, ok, log: relative(cwd, file), failures: ok ? [] : failureDetails({ name: state.name, output }) });
  }
  return checks;
}
