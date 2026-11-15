import { github } from './github.js';
import { VerifyError } from './process.js';

export function findingKey({ finding }) {
  return JSON.stringify([finding.id, finding.where, finding.problem, finding.fix]);
}

async function ownerComments({ cwd, config, pr }) {
  const repo = JSON.parse(await github({ cwd, args: ['repo', 'view', '--json', 'nameWithOwner,owner'] }));
  const owner = JSON.parse(await github({ cwd, args: ['api', `users/${repo.owner.login}`] }));
  const logins = config.ownerLogins || (owner.type === 'User' ? [repo.owner.login] : []);
  if (!Array.isArray(logins) || logins.length === 0 || logins.some(login => typeof login !== 'string' || !login.trim())) {
    throw new VerifyError('CONFIG', 'Owner authority in an organization requires ownerLogins in repo config');
  }
  const pages = JSON.parse(await github({ cwd, args: ['api', '--paginate', '--slurp', `repos/${repo.nameWithOwner}/issues/${pr.number}/comments?per_page=100`] }));
  return pages.flat().filter(comment => logins.some(login => login.toLowerCase() === comment.user.login.toLowerCase()));
}

export async function restartFor({ cwd, config, pr, previous }) {
  const comments = await ownerComments({ cwd, config, pr });
  const comment = comments.filter(comment => Date.parse(comment.created_at) > Date.parse(previous.finishedAt)
    && /^verify restart review:\s*\S[^\r\n]*$/m.test(comment.body)).at(-1);
  if (!comment) throw new VerifyError('OWNER_REQUIRED', 'Three rounds are not clean. An owner must comment: verify restart review: <reason>');
  return { by: comment.user.login, reason: /^verify restart review:\s*(\S[^\r\n]*)$/m.exec(comment.body)[1], url: comment.html_url };
}

export async function declinesFor({ cwd, config, pr, previous, arguments: requested = [] }) {
  if (config.decline !== 'owner') {
    return requested.map(text => {
      const match = /^([^:]+):\s*(\S[\s\S]*)$/.exec(text);
      const finding = previous.find(item => item.id === match?.[1]);
      if (!match || !finding) throw new VerifyError('DECLINE', 'Use --decline "<previous-finding-id>: <visible reason>"');
      return { id: finding.id, finding: findingKey({ finding }), by: 'agent', reason: match[2] };
    });
  }
  if (requested.length) throw new VerifyError('DECLINE', 'This repository accepts owner PR comments only; no CLI override');
  const comments = await ownerComments({ cwd, config, pr });
  const accepted = [];
  for (const comment of comments) {
    const match = /^verify decline ([^:\s]+):\s*(\S[^\r\n]*)$/m.exec(comment.body);
    const finding = previous.find(item => item.id === match?.[1]);
    if (!finding || Date.parse(comment.created_at) < Date.parse(finding.reportedAt)) continue;
    accepted.push({ id: finding.id, finding: findingKey({ finding }), by: comment.user.login, reason: match[2], url: comment.html_url });
  }
  return accepted;
}
