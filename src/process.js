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
 * @param {{command: string, args?: string[], cwd?: string, input?: string, env?: NodeJS.ProcessEnv, inherit?: boolean, log?: import('node:stream').Writable, timeoutMs?: number, timeoutCode?: string}} options
 * @returns {Promise<string>}
 */
export async function execute({
  command,
  args = [],
  cwd,
  input,
  env = process.env,
  inherit = false,
  log,
  timeoutMs = 15 * 60 * 1000,
  timeoutCode = 'COMMAND_TIMEOUT',
}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', inherit ? 'inherit' : 'pipe', 'pipe'],
    });
    let timedOut = false;
    let escalation;
    let terminated = Promise.resolve();
    const kill = (signal) => {
      if (process.platform === 'win32') child.kill(signal);
      else {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      terminated = new Promise((resolve) => {
        escalation = setTimeout(() => {
          kill('SIGKILL');
          resolve();
        }, KILL_GRACE_MS);
      });
    }, timeoutMs);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
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
      reject(error);
    });
    child.on('close', async (status, signal) => {
      clearTimeout(timer);
      await terminated;
      if (status !== 0 || timedOut) {
        const error = new DeslopError(
          timedOut ? timeoutCode : 'COMMAND',
          `${command} ${timedOut ? 'timed out' : `failed (${signal || status})`}: ${(stderr || stdout).trim().slice(-4000)}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        error.status = status;
        reject(error);
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
