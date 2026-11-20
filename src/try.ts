import { DeslopError } from './process.ts';
import type { Config, Selection, TryMode } from './types.ts';

export const TRY_MODES: TryMode[] = ['none', 'code', 'ui'];

export function tryOverride({ intent }: { intent?: string }) {
  const heading = intent?.match(/^(#{1,6})\s+how to try this\s*#*\s*$/im);
  if (!heading) return {};
  const rest = intent.slice(heading.index + heading[0].length);
  const end = rest.search(new RegExp(`^(#{1,${heading[1].length}}\\s|<details)`, 'm'));
  const text = (end < 0 ? rest : rest.slice(0, end))
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const [first, ...others] = text.split('\n');
  const line = first.match(/^try:\s*(.*?)\s*$/i);
  const mode = line?.[1].toLowerCase() as TryMode | undefined;
  if (line && !TRY_MODES.includes(mode))
    throw new DeslopError(
      'USAGE',
      `How to try this: use Try: none, code or ui, not "${line[1]}"`,
    );
  return {
    mode,
    guidance: (line ? others.join('\n') : text).trim() || undefined,
  };
}

export function tryPlan({
  override,
  config,
  selection
}: {
  override: ReturnType<typeof tryOverride>;
  config: Config;
  selection: Pick<Selection, 'kinds'>;
}) {
  const kindMode = config.kinds
    .filter((kind) => selection.kinds.includes(kind.name))
    .map((kind) => TRY_MODES.indexOf(kind.try ?? 'none'))
    .reduce((highest, rank) => Math.max(highest, rank), 0);
  return {
    mode: override.mode ?? TRY_MODES[kindMode],
    source: override.mode ? ('intent' as const) : ('kind' as const),
    guidance: override.guidance,
  };
}

export function tryPrompt({
  mode,
  guidance,
  notes,
  scratch,
  unfixedFile,
  findingsFile
}: {
  mode: TryMode;
  guidance?: string;
  notes?: string;
  scratch: string;
  unfixedFile: string;
  findingsFile: string;
}) {
  const exercise =
    'Exercise the changed behavior directly with real cases: call the changed functions, run the CLI or hit the API, including the edge cases the change touches. Try only what changed.';
  const screen =
    'Then start the app yourself, using the notes and guidance below, and drive the changed screens in a headless browser of your choice. Stop every process you started before you finish.';
  return [
    `The checks pass. Now try the change yourself to find bugs the checks missed. Try mode: ${mode}.`,
    mode === 'ui' ? `${exercise} ${screen}` : exercise,
    'You may run commands in this turn, but never run git, commit, stage, push or change branches, and never edit deslop.config.json or instruction files. Deslop commits your fixes as `deslop: fix try findings` and reruns the checks.',
    `Keep every scratch file (scripts, inputs, screenshots, logs) in ${scratch}, outside the repository; deslop deletes that folder after this turn.`,
    `Fix every bug you find in the repository. Add what you tried and what you found to the end of ${findingsFile}, keeping what it already holds.`,
    `If something still fails and you could not fix it, describe it in ${unfixedFile}. Leave that file absent when everything you tried works.`,
    notes ? `How to run this repository (tryNotes from deslop.config.json):\n${notes}` : '',
    guidance
      ? `How to try this, from the intent:\n${guidance}`
      : 'The intent gives no try guidance; exercise what the diff changes.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
