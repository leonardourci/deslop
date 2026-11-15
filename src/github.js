import { execute, git, DeslopError } from './process.js';

export async function github({ cwd, args, input }) { return await execute({ cwd, command: 'gh', args, input }); }
export async function remoteHead({ cwd, branch }) {
  try { return (await git({ cwd, args: ['ls-remote', 'origin', `refs/heads/${branch}`] })).split(/\s/)[0] || null; }
  catch (error) { if (error.code !== 'COMMAND') throw error; return null; }
}
export async function repository({ cwd }) {
  return JSON.parse(await github({ cwd, args: ['repo', 'view', '--json', 'nameWithOwner'] })).nameWithOwner;
}
export async function branchInfo({ cwd, override }) {
  const branch = await git({ cwd, args: ['symbolic-ref', '--short', 'HEAD'] });
  let defaultRef;
  try { defaultRef = (await git({ cwd, args: ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'] })).replace(/^origin\//, ''); } catch (error) { if (error.code !== 'COMMAND') throw error; }
  if (!defaultRef) for (const candidate of ['main', 'master']) {
    try { await git({ cwd, args: ['rev-parse', '--verify', candidate] }); defaultRef = candidate; break; } catch (error) { if (error.code !== 'COMMAND') throw error; }
  }
  if (!defaultRef) throw new DeslopError('BASE', 'Cannot determine the default branch; configure origin/HEAD');
  if (branch === defaultRef) throw new DeslopError('BRANCH', 'Switch off the default branch before running deslop');
  let baseRef = override;
  if (!baseRef) {
    try { const pr = JSON.parse(await github({ cwd, args: ['pr', 'view', '--json', 'baseRefName,state'] })); if (pr.state === 'OPEN') baseRef = pr.baseRefName; } catch (error) { if (error.code !== 'COMMAND' && error.code !== 'ENOENT') throw error; }
  }
  if (!baseRef) {
    try { await git({ cwd, args: ['rev-parse', '--verify', `origin/${defaultRef}`] }); baseRef = `origin/${defaultRef}`; } catch (error) { if (error.code !== 'COMMAND') throw error; baseRef = defaultRef; }
  } else {
    try { await git({ cwd, args: ['rev-parse', '--verify', baseRef] }); } catch (error) {
      if (error.code !== 'COMMAND') throw error;
      await git({ cwd, args: ['rev-parse', '--verify', `origin/${baseRef}`] }); baseRef = `origin/${baseRef}`;
    }
  }
  const base = await git({ cwd, args: ['merge-base', 'HEAD', baseRef] });
  return { branch, defaultBranch: defaultRef, base, baseRef };
}
export async function pushFixes({ cwd, branch, defaultBranch, expected }) {
  if (branch === defaultBranch || (await remoteHead({ cwd, branch })) !== expected) throw new DeslopError('PUSH', 'Remote branch moved; deslop will not overwrite it');
  await git({ cwd, args: ['push', 'origin', `HEAD:refs/heads/${branch}`] });
}
export function checkStates({ runs, statuses, names }) {
  const latest = new Map();
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    if (run.name === 'deslop' || /^coderabbit(?:ai)?$/i.test(run.name) || /^coderabbit(?:ai)?$/i.test(run.app?.slug || '') || latest.has(run.name)) continue;
    latest.set(run.name, { name: run.name, state: run.status === 'completed' ? run.conclusion : run.status, url: run.details_url });
  }
  for (const status of [...statuses].sort((a, b) => b.id - a.id)) if (!latest.has(status.context)) latest.set(status.context, { name: status.context, state: status.state, url: status.target_url });
  return names.map(name => latest.get(name) || { name, state: 'missing' });
}
export async function waitForChecks({ cwd, head, names, timeoutMs = 3600000, pollMs = 5000 }) {
  const repo = await repository({ cwd });
  const deadline = Date.now() + timeoutMs;
  let checks = names.map(name => ({ name, state: 'missing' }));
  while (Date.now() < deadline) {
    const [runs, statuses] = await Promise.all([
      github({ cwd, args: ['api', '--paginate', '--slurp', `repos/${repo}/commits/${head}/check-runs?per_page=100`] }),
      github({ cwd, args: ['api', '--paginate', '--slurp', `repos/${repo}/commits/${head}/statuses?per_page=100`] }),
    ]);
    checks = checkStates({ runs: JSON.parse(runs).flatMap(page => page.check_runs), statuses: JSON.parse(statuses).flat(), names });
    if (checks.every(check => ['success', 'failure', 'error', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale', 'neutral', 'skipped'].includes(check.state))) return checks;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  return checks;
}
export async function commitStatus({ cwd, head, branch, state, description }) {
  if (await remoteHead({ cwd, branch }) !== head) return false;
  const repo = await repository({ cwd });
  await github({ cwd, args: ['api', '--method', 'POST', `repos/${repo}/statuses/${head}`, '-f', 'context=deslop', '-f', `state=${state}`, '-f', `description=${description}`] });
  return true;
}
