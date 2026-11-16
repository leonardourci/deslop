import { spawn } from 'node:child_process';

export class DeslopError extends Error {
  /** @type {string|undefined} */
  stdout;
  /** @type {string|undefined} */
  stderr;
  /** @type {number|null|undefined} */
  status;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {{command: string, args?: string[], cwd?: string, input?: string, env?: NodeJS.ProcessEnv, log?: import('node:stream').Writable, timeoutMs?: number, timeoutCode?: string}} options
 * @returns {Promise<string>}
 */
export async function execute({
  command,
  args = [],
  cwd,
  input,
  env = process.env,
  log,
  timeoutMs = 15 * 60 * 1000,
  timeoutCode = 'COMMAND_TIMEOUT',
}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Decode across chunk boundaries so split multibyte characters survive.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let timedOut = false;
    let stoppedBy;
    let escalation;
    let terminated = Promise.resolve();
    const kill = (signal) => {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: KILL_GRACE_MS
        });
        killer.on('error', () => child.kill(signal));
        killer.on('exit', (code) => {
          if (code !== 0) child.kill(signal);
        });
      }
      else {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    };
    const terminate = (reason) => {
      if (stoppedBy) return;
      stoppedBy = reason;
      timedOut = reason === 'timeout';
      clearTimeout(timer);
      kill('SIGTERM');
      terminated = new Promise((resolve) => {
        escalation = setTimeout(() => {
          kill('SIGKILL');
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          resolve();
        }, KILL_GRACE_MS);
      });
    };
    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const handlers = signals.map(signal => ({
      signal,
      handler: () => terminate(signal)
    }));
    for (const {
      signal,
      handler
    } of handlers) process.on(signal, handler);
    const cleanup = () => {
      for (const {
        signal,
        handler
      } of handlers) process.removeListener(signal, handler);
    };
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      if (log) {
        log.write(chunk);
        stdout = (stdout + chunk).slice(-4000);
      } else stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (log) {
        log.write(chunk);
        stderr = (stderr + chunk).slice(-4000);
      } else stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      cleanup();
      reject(error);
    });
    const fail = (status, signal) => {
      const error = new DeslopError(
        timedOut ? timeoutCode : stoppedBy ? 'COMMAND_INTERRUPTED' : 'COMMAND',
        `${command} ${timedOut ? 'timed out' : stoppedBy ? `interrupted (${stoppedBy})` : `failed (${signal || status})`}: ${(stderr || stdout).trim().slice(-4000)}`,
      );
      error.stdout = stdout;
      error.stderr = stderr;
      error.status = status;
      reject(error);
    };
    child.on('close', async (status, signal) => {
      clearTimeout(timer);
      await terminated;
      cleanup();
      if (status !== 0 || stoppedBy) {
        fail(status, signal);
        return;
      }
      resolve(stdout.trimEnd());
    });
    child.stdin.on('error', (error) => {
      const brokenPipe = 'code' in error && error.code === 'EPIPE';
      if (!brokenPipe) reject(error);
    });
    child.stdin.end(input);
  });
}

export async function git({
  cwd,
  args
}) {
  return await execute({
    cwd,
    command: 'git',
    args,
  });
}

const KILL_GRACE_MS = 1000;
