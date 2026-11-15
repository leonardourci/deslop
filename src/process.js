import { spawn } from 'node:child_process';

export class DeslopError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function execute({ command, args = [], cwd, input, env = process.env, inherit = false }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', inherit ? 'inherit' : 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      if (status !== 0) {
        const error = new DeslopError('COMMAND', `${command} failed (${signal || status}): ${stderr.trim()}`);
        error.stdout = stdout; error.stderr = stderr; error.status = status;
        reject(error);
        return;
      }
      resolve(stdout.trimEnd());
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}

export async function git({ cwd, args }) {
  return await execute({ cwd, command: 'git', args });
}
