import { commitStatus, readChecks, remoteHead } from './github.js';

export async function publishSuccess({
  cwd,
  head,
  branch,
  config,
  selection,
  local = false,
}) {
  if (local && !config.publishLocal)
    return {
      published: false,
      statusReason:
        'not published yet; local publication is disabled; run deslop status --publish to verify CI',
    };
  if (
    (await remoteHead({
      cwd,
      branch,
    })) !== head
  )
    return {
      published: false,
      statusReason:
        'not published yet; push the checked commit and retry deslop status --publish',
    };
  const names = config.publishLocal
    ? selection.requiredChecks
    : selection.checks;
  if (!config.publishLocal && !names.length)
    return {
      published: false,
      statusReason:
        'not published yet; no CI checks configured and local publication is disabled',
    };
  if (names.length) {
    const checks = await readChecks({
      cwd,
      head,
      names,
    });
    const failures = checks.filter((check) => check.state !== 'success');
    if (failures.length)
      return {
        published: false,
        statusReason: `not published yet; CI not green on ${head}: ${failures.map((check) => `${check.name} ${check.state}`).join(', ')}`,
      };
  }
  return {
    published: await commitStatus({
      cwd,
      head,
      branch,
      state: 'success',
      description: 'Review fixed and checks passed',
    }),
  };
}
