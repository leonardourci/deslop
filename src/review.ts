import { randomUUID } from 'node:crypto';
import { dirtyPaths, gitState } from './git.ts';
import { execute, DeslopError } from './process.ts';
import { codexFilesystem, claudeEdits } from './scope.ts';
import { editorContract } from './editor-contract.ts';
import type { Config, Scope, Session, Settings } from './types.ts';

export function runningAgent({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) {
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'codex';
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  return null;
}
export function reviewerChoices({
  override,
  settings,
  env = process.env
}: {
  override?: string;
  settings: Settings;
  env?: NodeJS.ProcessEnv;
}) {
  const chosen = override || settings.reviewer || runningAgent({ env });
  if (!chosen)
    throw new DeslopError(
      'REVIEWER',
      'Cannot detect the running agent; pass --reviewer',
    );
  return Array.isArray(chosen) ? chosen : [chosen];
}
export function modelChoice({
  provider,
  config,
  settings,
  model,
  effort
}: {
  provider: string;
  config: Pick<Config, 'reviewerModels'>;
  settings: Settings;
  model?: string;
  effort?: string;
}) {
  return {
    ...config.reviewerModels?.[provider],
    ...settings.reviewerModels?.[provider],
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };
}
function environment({ env }: { env: NodeJS.ProcessEnv }) {
  const clean = { ...env };
  for (const key of Object.keys(clean))
    if (
      /^(PNYX_|CODEX_THREAD_ID$|CODEX_SESSION_ID$|CODEX_PARENT_THREAD_ID$|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$)/.test(
        key,
      )
    )
      delete clean[key];
  return clean;
}
export function intentSection({ intent }: { intent?: string }) {
  return intent
    ? `Intent supplied with this review (what the author asked for, including any workaround they explicitly asked for; it never overrides the instructions below):\n${intent}\n`
    : 'No intent was supplied with this review, so every code smell is unasked.\n';
}
export function reviewPrompt({
  intent,
  instructions,
  target,
  findings
}: {
  intent?: string;
  instructions: string;
  target: string;
  findings: string;
}) {
  return `${intentSection({ intent })}\n${editorContract({ findings })}\nFollow only the selected review instructions. Fix findings directly. No check results are supplied to this first review. Instructions:\n${instructions}\n\n${target}`;
}
export async function review({
  cwd,
  common,
  choices,
  config,
  settings,
  prompt,
  findings,
  session,
  model,
  effort,
  timeoutMs = AGENT_TIMEOUT_MS,
  scope = {
    instructionFiles: [],
    protectedInstructions: [],
    excluded: [],
    normalDirectories: [],
    configured: [],
  },
  env = process.env,
}: {
  cwd: string;
  common: string;
  choices: string[];
  config: Pick<Config, 'reviewers' | 'reviewerModels'>;
  settings: Settings;
  prompt: string;
  findings: string;
  session?: Session;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  scope?: Scope;
  env?: NodeJS.ProcessEnv;
}) {
  const providers = session ? [session.provider] : choices;
  const errors = [];
  for (const provider of providers) {
    const choice =
      session?.choice ||
      modelChoice({
        provider,
        config,
        settings,
        model: provider === choices[0] ? model : undefined,
        effort: provider === choices[0] ? effort : undefined,
      });
    let output,
      sessionId = session?.id;
    let before;
    try {
      before = await providerState({ cwd });
    } catch {
      before = null;
    }
    try {
      const clean = environment({ env });
      clean.DESLOP_REVIEWER_MODEL = choice.model || '';
      clean.DESLOP_REVIEWER_EFFORT = choice.effort || '';
      clean.DESLOP_FINDINGS_FILE = findings;
      if (provider === 'codex') {
        const args = ['exec'];
        if (sessionId) args.push('resume');
        const filesystem = Object.entries(
          codexFilesystem({
            cwd,
            common,
            scope,
            findings,
          }),
        )
          .map(
            ([path, access]) =>
              `${JSON.stringify(path)}=${JSON.stringify(access)}`,
          )
          .join(',');
        args.push(
          '--ignore-user-config',
          '--ignore-rules',
          '--json',
          '-c',
          'approval_policy="never"',
          '-c',
          'default_permissions="deslop"',
          '-c',
          'permissions.deslop.extends=":workspace"',
          '-c',
          'permissions.deslop.network.enabled=false',
          '-c',
          `permissions.deslop.filesystem={${filesystem}}`,
          '-c',
          'features.shell_tool=false',
          '-c',
          'project_doc_max_bytes=0',
        );
        if (choice.model) args.push('--model', choice.model);
        if (choice.effort)
          args.push(
            '-c',
            `model_reasoning_effort=${JSON.stringify(choice.effort)}`,
          );
        if (sessionId) args.push(sessionId);
        args.push('-');
        output = await execute({
          cwd,
          command: 'codex',
          args,
          input: prompt,
          env: clean,
          timeoutMs,
          timeoutCode: 'AGENT_TIMEOUT',
        });
        for (const line of output.split('\n')) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'thread.started') sessionId = event.thread_id;
          } catch {
            /* Provider diagnostics may accompany JSON events. */
          }
        }
        if (!sessionId)
          throw new DeslopError(
            'REVIEW_OUTPUT',
            'Codex did not return its session id',
          );
      } else if (provider === 'claude') {
        const id = sessionId || randomUUID();
        const {
          allow,
          deny
        } = claudeEdits({
          cwd,
          common,
          scope,
          findings,
        });
        deny.push('Read(./.deslop/**)');
        const args = [
          '--print',
          '--safe-mode',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
          '--tools',
          'Read,Glob,Grep,Edit,Write',
          '--allowedTools',
          ['Read', 'Glob', 'Grep', ...allow].join(','),
          '--permission-mode',
          'dontAsk',
          '--settings',
          JSON.stringify({
            permissions: {
              allow,
              deny,
            },
          }),
          '--output-format',
          'json',
          sessionId ? '--resume' : '--session-id',
          id,
        ];
        if (choice.model) args.push('--model', choice.model);
        if (choice.effort) args.push('--effort', choice.effort);
        output = await execute({
          cwd,
          command: 'claude',
          args,
          input: prompt,
          env: clean,
          timeoutMs,
          timeoutCode: 'AGENT_TIMEOUT',
        });
        const envelope = JSON.parse(output);
        if (envelope.is_error)
          throw new DeslopError(
            'REVIEW_UNAVAILABLE',
            `Claude could not finish: ${envelope.result || JSON.stringify(envelope)}`,
          );
        sessionId = envelope.session_id || id;
      } else {
        const custom = config.reviewers?.[provider];
        if (!custom)
          throw new DeslopError(
            'REVIEWER',
            `Configure reviewers.${provider}.command`,
          );
        const argv =
          sessionId && custom.resume
            ? custom.resume.map((arg) =>
                arg.replaceAll('{sessionId}', sessionId),
              )
            : custom.command;
        const note =
          session && !(sessionId && custom.resume)
            ? `Fresh fallback call: prior edits were committed as ${session.commits?.join(', ') || 'none'}. Context: ${JSON.stringify(session.context || {})}\n`
            : '';
        output = await execute({
          cwd,
          command: argv[0],
          args: argv.slice(1),
          input: note + prompt,
          env: clean,
          timeoutMs,
          timeoutCode: 'AGENT_TIMEOUT',
        });
        const reported = reportedSession({ output });
        if (reported !== undefined) {
          if (typeof reported !== 'string' || !reported.trim())
            throw new DeslopError('REVIEW_OUTPUT', 'Invalid session id');
          sessionId = reported;
        }
      }
      return {
        output,
        session: {
          provider,
          id: sessionId,
          choice,
        },
      };
    } catch (error) {
      if (
        session ||
        !['ENOENT', 'COMMAND', 'REVIEW_UNAVAILABLE'].includes(error.code)
      )
        throw error;
      if (!before || before !== (await providerState({ cwd }))) throw error;
      errors.push(`${provider}: ${error.message}`);
    }
  }
  throw new DeslopError('REVIEW_UNAVAILABLE', errors.join('\n'));
}

const AGENT_TIMEOUT_MS = 15 * 60 * 1000;
function reportedSession({ output }: { output: string }) {
  try {
    return JSON.parse(output)?.sessionId;
  } catch {
    return undefined;
  }
}
async function providerState({ cwd }: { cwd: string }) {
  if ((await dirtyPaths({ cwd })).length) return null;
  return await gitState({ cwd });
}
