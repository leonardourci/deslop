import { execute } from './process.ts';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { lintInvocation } from './lint.ts';
import { github, repository, waitForChecks } from './github.ts';
import type { Check, Config, Selection } from './types.ts';

export function failureDetails({
  name,
  output
}: {
  name: string;
  output: string;
}) {
  const lines = output.split('\n');
  const index = lines.findIndex((line) =>
    /(?:FAIL|Error:|AssertionError|[×✖])/i.test(line),
  );
  const start = Math.max(0, index);
  const tests = [
    ...new Set(
      lines.flatMap((line) => {
        const match = line.match(/(?:not ok \d+ - |[✖×] |FAIL\s+)(.+)/);
        return match ? [match[1].trim()] : [];
      }),
    ),
  ].slice(0, MAX_FAILURES);
  return (tests.length ? tests : [name]).map((test) => ({
    test,
    message: (lines[index] || `${name} failed`).slice(0, 500),
    excerpt: lines
      .slice(start, start + 20)
      .map((line) => line.slice(0, 1000))
      .join('\n'),
  }));
}
async function commandCheck({
  args,
  input,
  cwd,
  name,
  command,
  file
}: {
  cwd: string;
  name: string;
  command: string;
  file: string;
  args?: string[];
  input?: string;
}) {
  let ok = true;
  const log = createWriteStream(file);
  try {
    await execute({
      cwd,
      command: args
        ? command
        : process.platform === 'win32'
          ? 'cmd.exe'
          : '/bin/sh',
      args:
        args ||
        (process.platform === 'win32' ? ['/c', command] : ['-c', command]),
      input,
      timeoutMs: CHECK_TIMEOUT_MS,
      log,
    });
  } catch (error) {
    ok = false;
    log.write(`\n${error.message}`);
  } finally {
    log.end();
    await finished(log);
  }
  const output = ok ? '' : readFileSync(file, 'utf8');
  return {
    name,
    ok,
    log: file,
    failures: ok
      ? []
      : failureDetails({
          name,
          output,
        }),
  };
}
export async function runChecks({
  cwd,
  dir,
  config,
  selection,
  ci,
  head,
  attempt,
  beforeCommand,
  afterCommand,
  localCommands,
  paths = [],
}: {
  cwd: string;
  dir: string;
  config: Config;
  selection: Selection;
  ci: boolean;
  head: string;
  attempt: number;
  beforeCommand?: (options: { command: string }) => Promise<void>;
  afterCommand?: (options: { command: string }) => Promise<void>;
  localCommands?: string[];
  paths?: Iterable<string>;
}) {
  const checks: Check[] = [];
  if (!ci) {
    for (const [index, name] of (
      localCommands || selection.commands
    ).entries()) {
      const command = config.commands[name];
      await beforeCommand?.({ command });
      const check = await commandCheck({
        cwd,
        name,
        command,
        file: join(dir, `checks-${attempt}-${index}.log`),
      });
      await afterCommand?.({ command });
      checks.push(check);
    }
    const invocation = lintInvocation({
      cwd,
      config,
      selection: {
        ...selection,
        commands: localCommands || selection.commands,
      },
      paths
    });
    if (invocation) {
      await beforeCommand?.({ command: 'eslint' });
      checks.push(
        await commandCheck({
          cwd,
          name: 'deslop lint',
          ...invocation,
          file: join(dir, `checks-${attempt}-lint.log`),
        }),
      );
      await afterCommand?.({ command: 'eslint' });
    }
    return checks;
  }
  const states = await waitForChecks({
    cwd,
    head,
    names: selection.checks,
  });
  for (const [index, state] of states.entries()) {
    const file = join(dir, `checks-${attempt}-${index}.log`);
    const ok = state.state === 'success';
    let output = `${state.name}: ${state.state}\n`;
    const run = state.url?.match(/\/actions\/runs\/(\d+)/)?.[1];
    if (!ok && run) {
      try {
        output += await github({
          cwd,
          args: ['run', 'view', run, '--repo', await repository({ cwd }), '--log-failed'],
        });
      } catch (error) {
        output += `Cannot read failed CI logs: ${error.message}`;
      }
    }
    writeFileSync(file, output);
    checks.push({
      name: state.name,
      ok,
      fixable: ['failure', 'error', 'timed_out'].includes(state.state),
      log: file,
      failures: ok
        ? []
        : failureDetails({
            name: state.name,
            output,
          }),
    });
  }
  return checks;
}

const CHECK_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_FAILURES = 20;
