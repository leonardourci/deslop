import { optionalGit } from './git.js';
import { execute, git, DeslopError } from './process.js';

export async function github({ cwd, args, input }) {
  return await execute({ cwd, command: 'gh', args, input });
}
export async function remoteHead({ cwd, branch }) {
  try {
    return (
      (
        await git({
          cwd,
          args: ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`],
        })
      ).split(/\s/)[0] || null
    );
  } catch (error) {
    if (error.code !== 'COMMAND' || error.status !== 2) throw error;
    return null;
  }
}
export async function repository({ cwd }) {
  return JSON.parse(
    await github({ cwd, args: ['repo', 'view', '--json', 'nameWithOwner'] }),
  ).nameWithOwner;
}
export async function branchInfo({ cwd, override }) {
  const branch = await git({ cwd, args: ['symbolic-ref', '--short', 'HEAD'] });
  const remoteDefault = await optionalGit({
    cwd,
    args: ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
  });
  let defaultBranch = remoteDefault?.replace(/^origin\//, '');
  if (!defaultBranch) {
    for (const candidate of ['main', 'master']) {
      if (
        await optionalGit({ cwd, args: ['rev-parse', '--verify', candidate] })
      ) {
        defaultBranch = candidate;
        break;
      }
    }
  }
  if (!defaultBranch)
    throw new DeslopError(
      'BASE',
      'Cannot determine the default branch; configure origin/HEAD',
    );
  if (branch === defaultBranch)
    throw new DeslopError(
      'BRANCH',
      'Switch off the default branch before running deslop',
    );
  let requestedBase;
  if (!override) {
    try {
      const pr = JSON.parse(
        await github({
          cwd,
          args: ['pr', 'view', '--json', 'baseRefName,state'],
        }),
      );
      if (pr.state === 'OPEN') requestedBase = pr.baseRefName;
    } catch (error) {
      if (!['COMMAND', 'COMMAND_TIMEOUT', 'ENOENT'].includes(error.code))
        throw error;
    }
  }
  const candidate = requestedBase || defaultBranch;
  const remoteBase = `origin/${candidate}`;
  const baseRef =
    override ||
    ((await optionalGit({ cwd, args: ['rev-parse', '--verify', remoteBase] }))
      ? remoteBase
      : candidate);
  const base = await git({ cwd, args: ['merge-base', 'HEAD', baseRef] });
  return { branch, defaultBranch, base, baseRef };
}
export async function pushFixes({ cwd, branch, expected }) {
  if ((await remoteHead({ cwd, branch })) !== expected)
    throw new DeslopError(
      'PUSH',
      'Remote branch moved; deslop will not overwrite it',
    );
  await git({ cwd, args: ['push', 'origin', `HEAD:refs/heads/${branch}`] });
}
export function checkStates({ runs, statuses, names }) {
  const latest = new Map();
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    if (latest.has(run.name)) continue;
    latest.set(run.name, {
      name: run.name,
      state: run.status === 'completed' ? run.conclusion : run.status,
      url: run.details_url,
    });
  }
  for (const status of [...statuses].sort((a, b) => b.id - a.id))
    if (!latest.has(status.context))
      latest.set(status.context, {
        name: status.context,
        state: status.state,
        url: status.target_url,
      });
  return names.map((name) => latest.get(name) || { name, state: 'missing' });
}
export const CI_TIMEOUT_MS = 3600000;
export const CI_MISSING_MS = 180000;
export const CI_POLL_MS = 15000;
const FINISHED = new Set([
  'success',
  'failure',
  'error',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
  'neutral',
  'skipped',
]);
export async function waitForChecks({
  cwd,
  head,
  names,
  timeoutMs = CI_TIMEOUT_MS,
  pollMs = CI_POLL_MS,
  missingMs = CI_MISSING_MS,
}) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let checks = names.map((name) => ({ name, state: 'missing' }));
  let lastError;
  let repo;
  while (Date.now() < deadline) {
    try {
      repo ||= await repository({ cwd });
      checks = await readChecks({ cwd, head, names, repo });
      lastError = null;
      if (
        checks.some(
          (check) =>
            FINISHED.has(check.state) &&
            !['success', 'failure', 'error', 'timed_out'].includes(check.state),
        )
      )
        return checks;
      if (checks.every((check) => FINISHED.has(check.state))) return checks;
      if (
        Date.now() - started >= missingMs &&
        checks.some((check) => check.state === 'missing')
      )
        return checks;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))),
    );
  }
  if (lastError)
    throw new DeslopError(
      'GITHUB_UNREACHABLE',
      `GitHub unreachable; rerun with --local (${lastError.message})`,
    );
  return checks.map((check) =>
    FINISHED.has(check.state)
      ? check
      : { ...check, state: `wait_timeout (${check.state})` },
  );
}
export async function commitStatus({ cwd, head, branch, state, description }) {
  if ((await remoteHead({ cwd, branch })) !== head) return false;
  const repo = await repository({ cwd });
  await github({
    cwd,
    args: [
      'api',
      '--method',
      'POST',
      `repos/${repo}/statuses/${head}`,
      '-f',
      'context=deslop',
      '-f',
      `state=${state}`,
      '-f',
      `description=${description}`,
    ],
  });
  return true;
}

export async function readChecks({ cwd, head, names, repo }) {
  repo ||= await repository({ cwd });
  const [runs, statuses] = await Promise.all([
    github({
      cwd,
      args: [
        'api',
        '--paginate',
        '--slurp',
        `repos/${repo}/commits/${head}/check-runs?per_page=100`,
      ],
    }),
    github({
      cwd,
      args: [
        'api',
        '--paginate',
        '--slurp',
        `repos/${repo}/commits/${head}/statuses?per_page=100`,
      ],
    }),
  ]);
  return checkStates({
    runs: JSON.parse(runs).flatMap((page) => page.check_runs),
    statuses: JSON.parse(statuses).flat(),
    names,
  });
}
