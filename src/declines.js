import { github } from './github.js';
import { VerifyError } from './process.js';

const RESTART_COMMAND = /^verify restart review:[ \t]*(\S[^\r\n]*)$/;
const DECLINE_COMMAND = /^verify decline ([^:\s]+):[ \t]*(\S[^\r\n]*)$/;

function ownerCommand({ body, pattern }) {
  if (typeof body !== 'string') return null;
  return pattern.exec(body.trim());
}

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
  const requests = comments.map(comment => ({ comment, command: ownerCommand({ body: comment.body, pattern: RESTART_COMMAND }) }));
  const recent = requests.filter(request => request.command && Date.parse(request.comment.created_at) > Date.parse(previous.finishedAt));
  const request = recent.at(-1);
  if (!request) throw new VerifyError('OWNER_REQUIRED', 'Three rounds are not clean. An owner must comment: verify restart review: <reason>');
  return { by: request.comment.user.login, reason: request.command[1], url: request.comment.html_url };
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
    const match = ownerCommand({ body: comment.body, pattern: DECLINE_COMMAND });
    const finding = previous.find(item => item.id === match?.[1]);
    if (!finding || Date.parse(comment.created_at) < Date.parse(finding.reportedAt)) continue;
    accepted.push({ id: finding.id, finding: findingKey({ finding }), by: comment.user.login, reason: match[2], url: comment.html_url });
  }
  return accepted;
}
