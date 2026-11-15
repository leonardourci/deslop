import { execute, VerifyError } from './process.js';

export const MARKER_PREFIX = '<!-- verify:v1 ';
const MARKER_END = ' -->';
const POLL_MS = 5000;
const WAIT_MS = 60 * 60 * 1000;

export async function github({ cwd, args, input }) {
  return await execute({ cwd, command: 'gh', args, input });
}

export async function pullRequest({ cwd }) {
  const pr = JSON.parse(await github({ cwd, args: ['pr', 'view', '--json', 'number,url,headRefOid,baseRefOid,body,state'] }));
  if (pr.state !== 'OPEN') throw new VerifyError('PR', 'An open pull request is required');
  return pr;
}

export function markerFromBody({ body }) {
  const markers = body.split('\n').filter(line => line.startsWith(MARKER_PREFIX));
  if (markers.length !== 1 || !markers[0].endsWith(MARKER_END)) return null;
  try { return JSON.parse(markers[0].slice(MARKER_PREFIX.length, -MARKER_END.length)); }
  catch { return null; }
}

export function validMarker({ marker, head, localRunCounts = true }) {
  return marker?.head === head && /^[0-9a-f]{40,64}$/.test(head)
    && marker.version === 1 && ['local', 'ci'].includes(marker.mode)
    && (marker.mode !== 'local' || localRunCounts)
    && marker.steps?.passed === true && Array.isArray(marker.steps.names)
    && marker.review?.clean === true && typeof marker.review.provider === 'string' && marker.review.provider.length > 0
    && Number.isInteger(marker.review.round) && marker.review.round >= 1 && marker.review.round <= 3
    && typeof marker.finishedAt === 'string' && Number.isFinite(Date.parse(marker.finishedAt));
}

export async function writeMarker({ cwd, head, marker }) {
  const latest = await pullRequest({ cwd });
  if (latest.headRefOid !== head) throw new VerifyError('HEAD_CHANGED', 'PR head changed before marker write; run again');
  const body = latest.body.split('\n').filter(line => !line.startsWith(MARKER_PREFIX)).join('\n').trimEnd();
  const text = `${body}\n\n${MARKER_PREFIX}${JSON.stringify(marker)}${MARKER_END}\n`;
  await github({ cwd, args: ['pr', 'edit', String(latest.number), '--body-file', '-'], input: text });
  const after = await pullRequest({ cwd });
  if (after.headRefOid !== head) throw new VerifyError('HEAD_CHANGED', 'PR head changed during marker write; marker is stale');
}

export async function clearMarker({ cwd, head }) {
  const pr = await pullRequest({ cwd });
  if (pr.headRefOid !== head) throw new VerifyError('HEAD_CHANGED', 'PR head changed before verification');
  if (!pr.body.split('\n').some(line => line.startsWith(MARKER_PREFIX))) return;
  const body = pr.body.split('\n').filter(line => !line.startsWith(MARKER_PREFIX)).join('\n').trimEnd();
  await github({ cwd, args: ['pr', 'edit', String(pr.number), '--body-file', '-'], input: `${body}\n` });
}

export function separateCheck({ name, app }) {
  const provider = app?.slug || app?.name || '';
  return name === 'verify' || /^coderabbit(?:ai)?$/i.test(name) || /^coderabbit(?:ai)?$/i.test(provider);
}

export function checkStates({ runs, statuses, names }) {
  const latest = new Map();
  for (const run of [...runs].sort((left, right) => right.id - left.id)) {
    if (separateCheck({ name: run.name, app: run.app }) || latest.has(run.name)) continue;
    latest.set(run.name, { name: run.name, state: run.status === 'completed' ? run.conclusion : run.status });
  }
  for (const status of [...statuses].sort((left, right) => right.id - left.id)) {
    if (separateCheck({ name: status.context }) || latest.has(status.context)) continue;
    latest.set(status.context, { name: status.context, state: status.state });
  }
  const requested = names === 'all' ? [...latest.keys()] : names;
  if (names === 'all' && requested.length === 0) return [{ name: 'all', state: 'missing' }];
  return requested.map(name => latest.get(name) || { name, state: 'missing' });
}

export async function waitForChecks({ cwd, head, names, timeoutMs = WAIT_MS, pollMs = POLL_MS }) {
  if (Array.isArray(names) && names.length === 0) return [];
  const repo = JSON.parse(await github({ cwd, args: ['repo', 'view', '--json', 'nameWithOwner'] })).nameWithOwner;
  const deadline = Date.now() + timeoutMs;
  let printed = '';
  while (Date.now() < deadline) {
    const pr = await pullRequest({ cwd });
    if (pr.headRefOid !== head) throw new VerifyError('HEAD_CHANGED', 'PR head changed while waiting for CI');
    const [runPages, statusPages] = await Promise.all([
      github({ cwd, args: ['api', '--paginate', '--slurp', `repos/${repo}/commits/${head}/check-runs?per_page=100`] }),
      github({ cwd, args: ['api', '--paginate', '--slurp', `repos/${repo}/commits/${head}/statuses?per_page=100`] }),
    ]);
    const checks = checkStates({ runs: JSON.parse(runPages).flatMap(page => page.check_runs), statuses: JSON.parse(statusPages).flat(), names });
    const line = JSON.stringify(checks);
    if (line !== printed) {
      console.log(`checks: ${line}\nhelp: Approve pending CI if needed, or use verify run --local`);
      printed = line;
    }
    if (checks.some(check => ['failure', 'error', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale', 'neutral', 'skipped'].includes(check.state))) {
      throw new VerifyError('CI_FAILED', 'A required check did not pass');
    }
    if (checks.every(check => check.state === 'success')) return checks.map(check => check.name);
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  throw new VerifyError('CI_WAIT', 'Required checks are missing or pending; resolve CI or use verify run --local');
}

export function markerWorkflow() {
  const validation = validMarker.toString();
  const parsing = markerFromBody.toString();
  return `name: Verify\non:\n  pull_request_target:\n    types: [opened, edited, synchronize, reopened]\npermissions:\n  contents: read\n  pull-requests: read\nconcurrency:\n  group: verify-marker-\${{ github.event.pull_request.number }}\n  cancel-in-progress: true\njobs:\n  marker:\n    name: verify\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/github-script@v7\n        with:\n          script: |\n            const MARKER_PREFIX = ${JSON.stringify(MARKER_PREFIX)};\n            const MARKER_END = ${JSON.stringify(MARKER_END)};\n            ${parsing.replaceAll('\n', '\n            ')}\n            ${validation.replaceAll('\n', '\n            ')}\n            const {data: pr} = await github.rest.pulls.get({...context.repo, pull_number: context.issue.number});\n            let localRunCounts = true;\n            try {\n              const {data: file} = await github.rest.repos.getContent({...context.repo, path: 'verify.config.json', ref: context.payload.repository.default_branch});\n              const config = JSON.parse(Buffer.from(file.content, 'base64').toString());\n              localRunCounts = config.localRunCounts !== false;\n            } catch (error) {\n              if (error.status !== 404) throw error;\n            }\n            const marker = markerFromBody({body: pr.body || ''});\n            if (!validMarker({marker, head: pr.head.sha, localRunCounts})) core.setFailed('Run verify run on the exact PR head with a clean review.');\n`;
}
