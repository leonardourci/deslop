import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CONFIG_FILE,
  locations,
  readJson,
  validateConfig,
  loadConfig,
  loadSettings,
  select,
} from './config.ts';
import { git, DeslopError } from './process.ts';
import { run } from './run.ts';
import { dirtyPaths, optionalGit } from './git.ts';
import { requiredValue } from './prompt.ts';
import { DEFAULT_SKILLS, canonicalSkill } from './instructions.ts';
import { runningAgent } from './review.ts';
import { branchInfo } from './github.ts';
import { publishSuccess } from './publication.ts';
import type { Places, RunOptions } from './types.ts';

type CliOptions = RunOptions & {
  publish?: boolean;
  help?: boolean;
  version?: boolean;
  config?: string;
  command?: string[];
  check?: string[];
  noPrTemplate?: boolean;
};
const PR_SECTIONS = [
  {
    name: 'What was asked',
    body: '## What was asked\n\n<!-- State the intent and why it matters. -->\n',
  },
  {
    name: 'What changed',
    body: '## What changed\n'
  },
  {
    name: 'How it was checked',
    body: '## How it was checked\n'
  },
  {
    name: 'Intentional slop',
    body: '<details>\n<summary>Intentional slop</summary>\n\n<!-- One item per line: file, what is kept, and why. -->\n\n</details>\n',
  },
];
function prTemplates({ root }: { root: string }) {
  const templates: string[] = [];
  function collect(directory: string, nested = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!nested && !/^pull_request_template(\..+)?$/i.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new DeslopError('CONFIG', `Cannot merge a symlinked PR template: ${path}`);
      if (entry.isFile()) templates.push(path);
      else if (entry.isDirectory() && !nested) collect(path, true);
    }
  }
  for (const folder of ['', '.github', 'docs']) {
    const directory = join(root, folder);
    if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new DeslopError('CONFIG', `Cannot merge PR templates through a symlink: ${directory}`);
    if (existsSync(directory) && statSync(directory).isDirectory()) collect(directory);
  }
  return templates.length ? templates : [join(root, '.github', 'pull_request_template.md')];
}
function mergePrSections(text: string) {
  const sections = new Set([
    ...[...text.matchAll(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((match) => match[1].toLowerCase()),
    ...[...text.matchAll(/<summary>\s*(.*?)\s*<\/summary>/gi)].map((match) => match[1].toLowerCase()),
  ]);
  const missing = PR_SECTIONS.filter(({ name }) => !sections.has(name.toLowerCase()));
  if (!missing.length) return text;
  return `${text}${text ? '\n\n' : ''}${missing.map(({ body }) => body).join('\n')}`;
}

const SHAPE = {
  id: 'run id',
  date: '2026-01-31T12:00:00.000Z',
  repo: '/path/to/repo',
  branch: 'branch',
  pr: 12,
  mode: 'run|clean',
  paths: ['src'],
  intent: {
    source: 'file|pr|none',
    pr: 12,
  },
  verdict: 'passed|failed',
  head: 'commit',
  checks: [
    {
      name: 'tests',
      ok: false,
      log: '/path/to/repo/.deslop/runs/id/checks-0-0.log',
      failures: [
        {
          test: 'test name',
          message: 'short failure',
          excerpt: 'at most 20 lines',
        },
      ],
    },
  ],
  commits: ['commit'],
  newFiles: ['new.test.js'],
  findings: 'the agent findings text, verbatim',
  left: ['uncommitted.txt'],
  unstableCommands: ['pnpm lint:fix'],
};
async function init({
  places,
  options
}: {
  places: Places;
  options: CliOptions;
}) {
  const target = join(places.root, CONFIG_FILE);
  if (existsSync(target))
    throw new DeslopError('CONFIG', 'Config already exists');
  if (!options.config) {
    options.command = options.command || [
      await requiredValue({
        flag: '--command tests="npm test"',
        question: 'Test command (name=command)',
      }),
    ];
    options.check = options.check || [
      await requiredValue({
        flag: '--check "Tests"',
        question: 'CI check name',
      }),
    ];
  }
  const commands = Object.fromEntries(
    (options.command || []).map((value) => {
      const split = value.indexOf('=');
      if (split <= 0 || !value.slice(split + 1).trim())
        throw new DeslopError('USAGE', 'Use --command name="shell command"');
      return [value.slice(0, split), value.slice(split + 1)];
    }),
  );
  const config = options.config
    ? readJson({ path: options.config })
    : {
        commands,
        kinds: [
          {
            name: 'docs',
            match: ['**/*.md'],
            commands: [],
            checks: [],
            instructions: ['kill-ai-slop'],
          },
          {
            name: 'code',
            match: ['**'],
            commands: Object.keys(commands),
            checks: options.check,
          },
        ],
        checkFixAttempts: 1,
      };
  validateConfig({
    config,
    root: places.root,
  });
  const templates = options.noPrTemplate ? [] : prTemplates({ root: places.root });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  console.log(`wrote: ${target}`);
  for (const template of templates) {
    const before = existsSync(template) ? readFileSync(template, 'utf8') : '';
    const after = mergePrSections(before);
    if (after === before) continue;
    mkdirSync(dirname(template), { recursive: true });
    writeFileSync(template, after);
    console.log(`wrote: ${template}`);
  }
  console.log(
    'next: configure commands and kinds, then commit before running deslop',
  );
}
function copySkill({
  places,
  positionals
}: {
  places: Places;
  positionals: string[];
}) {
  const [action, requested, ...extra] = positionals;
  const name = canonicalSkill(requested ?? '');
  if (action !== 'copy' || extra.length || !Object.hasOwn(DEFAULT_SKILLS, name))
    throw new DeslopError(
      'USAGE',
      `Use deslop skill copy <name> with one of: ${Object.keys(DEFAULT_SKILLS).join(', ')}`,
    );
  const [target, claudeSkill] = ['.agents', '.claude'].map((folder) =>
    join(places.root, folder, 'skills', name, 'SKILL.md'),
  );
  for (const file of [target, claudeSkill])
    if (existsSync(file))
      throw new DeslopError('SKILL_EXISTS', `${file} already exists`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(DEFAULT_SKILLS[name]), { flag: 'wx' });
  console.log(`wrote: ${target}\nnext: edit it and commit; it replaces the shipped ${name}`);
}
async function status({
  places,
  options
}: {
  places: Places;
  options: CliOptions;
}) {
  const cwd = places.root,
    head = await git({
      cwd,
      args: ['rev-parse', 'HEAD'],
    });
  let marker;
  try {
    marker = JSON.parse(
      await optionalGit({
        cwd,
        args: ['notes', '--ref=deslop', 'show', head],
      }),
    );
  } catch (error) {
    if (error.code !== 'COMMAND' && !(error instanceof SyntaxError))
      throw error;
  }
  const dirty = (await dirtyPaths({ cwd })).length;
  const valid =
    !dirty &&
    marker?.version === 1 &&
    marker.head === head &&
    marker.verdict === 'passed' &&
    Array.isArray(marker.checks) &&
    marker.checks.every((check) => check?.ok === true);
  if (!valid) {
    console.log(`marker: missing or stale, head ${head}`);
    process.exitCode = 1;
    return;
  }
  const scope =
    marker.mode === 'clean'
      ? `scope: deslop clean ${marker.paths.join(' ')}\n`
      : '';
  console.log(
    `marker: current, head ${head}\n${scope}details: ${marker.run}\nshape: deslop shape\nlogs: checks[].log (full logs can be large)`,
  );
  if (options.publish) {
    const branch = await git({
      cwd,
      args: ['symbolic-ref', '--short', 'HEAD'],
    });
    try {
      const config = await loadConfig({ places });
      let selection;
      if (Array.isArray(marker.ciChecks) && Array.isArray(marker.requiredCI)) {
        selection = {
          checks: marker.ciChecks,
          requiredChecks: marker.requiredCI,
        };
      } else {
        const info = await branchInfo({ cwd });
        const paths = (
          await git({
            cwd,
            args: [
              'diff',
              '--name-only',
              '--no-renames',
              '-z',
              info.base,
              head,
            ],
          })
        )
          .split('\0')
          .filter(Boolean);
        selection = select({
          config,
          paths,
        });
      }
      const {
        published,
        statusReason
      } = await publishSuccess({
        cwd,
        head,
        branch,
        config,
        selection,
      });
      console.log(`status: ${published ? 'published' : statusReason}`);
      if (!published) process.exitCode = 1;
    } catch (error) {
      if (!['COMMAND', 'COMMAND_TIMEOUT', 'ENOENT'].includes(error.code))
        throw error;
      console.log(
        'proof: local git note\nstatus: not published yet; retry deslop status --publish when GitHub recovers',
      );
      process.exitCode = 1;
    }
  }
}
async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
}: {
  argv?: string[];
  cwd?: string;
} = {}) {
  const args = argv.flatMap((arg) =>
    arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg === '-h' ? '--help' : arg],
  );
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'run';
  const options: CliOptions = {};
  const booleans = ['local', 'publish', 'help', 'version', 'no-pr-template'];
  const values = [
    'base',
    'intent',
    'reviewer',
    'reviewer-model',
    'reviewer-effort',
    'config',
    'command',
    'check',
  ];
  const positionals: string[] = [];
  while (args.length) {
    const flag = args.shift();
    if (!flag.startsWith('--')) {
      positionals.push(flag);
      continue;
    }
    const name = flag.slice(2),
      key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (booleans.includes(name)) options[key] = true;
    else if (values.includes(name) && args[0] && !args[0].startsWith('--')) {
      const value = args.shift();
      if (['command', 'check'].includes(name))
        (options[key] ||= []).push(value);
      else options[key] = value;
    } else
      throw new DeslopError('USAGE', `Unknown or incomplete option: ${flag}`);
  }
  if (options.version) {
    console.log(
      JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      ).version,
    );
    return;
  }
  if (command === 'help') options.help = true;
  if (options.help) {
    console.log(
      'deslop [run] [--local] [--base ref] [--intent file] [--reviewer provider] [--reviewer-model name] [--reviewer-effort effort]\ndeslop clean <path>... [run options]\ndeslop init [--config file | --command name=command --check name] [--no-pr-template]\ndeslop status [--publish]\ndeslop skill copy <name>\ndeslop shape',
    );
    return;
  }
  const runOptions = ['local', 'base', 'intent', 'reviewer', 'reviewerModel', 'reviewerEffort'];
  const allowed = {
    run: runOptions,
    clean: runOptions,
    init: ['config', 'command', 'check', 'noPrTemplate'],
    status: ['publish'],
    skill: [],
    shape: [],
  };
  if (!allowed[command])
    throw new DeslopError('USAGE', `Unknown command: ${command}`);
  for (const key of Object.keys(options))
    if (!allowed[command].includes(key))
      throw new DeslopError(
        'USAGE',
        `Option ${key} is not valid for ${command}`,
      );
  if (command === 'clean') {
    if (!positionals.length)
      throw new DeslopError('USAGE', 'Name at least one path: deslop clean <path>...');
    options.paths = positionals;
  } else if (positionals.length && command !== 'skill')
    throw new DeslopError('USAGE', `Unexpected argument: ${positionals[0]}`);
  if (command === 'shape') {
    console.log(JSON.stringify(SHAPE, null, 2));
    console.log(
      'Potentially long: findings, checks[], checks[].failures[], commits[]. Excerpts <=20 lines. Full logs can be large.',
    );
    return;
  }
  const places = await locations({ cwd });
  if (options.paths)
    options.paths = options.paths.map((path) => {
      const inside = relative(places.root, resolve(realpathSync(cwd), path));
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
        throw new DeslopError('USAGE', `Path is outside the repository: ${path}`);
      return inside || '.';
    });
  if (command === 'init')
    return await init({
      places,
      options,
    });
  if (command === 'skill')
    return copySkill({
      places,
      positionals,
    });
  if (command === 'status')
    return await status({
      places,
      options,
    });
  if (
    !options.reviewer &&
    !loadSettings({ home: places.home }).reviewer &&
    !runningAgent()
  )
    options.reviewer = await requiredValue({
      flag: '--reviewer',
      question: 'Reviewer',
    });
  const result = await run({
    places,
    options,
  });
  if (result.verdict !== 'passed') process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  if (error.code !== 'DIRTY') console.error(`code: ${error.code || 'ERROR'}`);
  process.exitCode = 1;
});
