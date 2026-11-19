import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
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
};

const SHAPE = {
  id: 'run id',
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
  review: {
    found: 1,
    fixed: 1,
    items: [
      {
        id: 'R1',
        where: 'file:line',
        problem: 'one line',
        fixed: true,
        kind: 'defect',
      },
    ],
  },
  commits: ['commit'],
  newFiles: ['new.test.js'],
  checkFixes: [
    {
      turn: 1,
      items: [],
    },
  ],
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
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  console.log(
    `wrote: ${target}\nnext: configure commands and kinds, then commit before running deslop`,
  );
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
    marker.checks.every((check) => check?.ok === true) &&
    marker.review &&
    Number.isInteger(marker.review.found) &&
    marker.review.found >= 0 &&
    marker.review.found === marker.review.fixed;
  if (!valid) {
    console.log(`marker: missing or stale, head ${head}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `marker: current, head ${head}\ndetails: ${marker.run}\nshape: deslop shape\nlogs: checks[].log (full logs can be large)`,
  );
  if (options.publish) {
    const branch = await git({
      cwd,
      args: ['symbolic-ref', '--short', 'HEAD'],
    });
    try {
      const config = loadConfig({ places });
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
  const booleans = ['local', 'publish', 'help', 'version'];
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
      'deslop [run] [--local] [--base ref] [--intent file] [--reviewer provider] [--reviewer-model name] [--reviewer-effort effort]\ndeslop clean <path>... [run options]\ndeslop init [--config file | --command name=command --check name]\ndeslop status [--publish]\ndeslop shape',
    );
    return;
  }
  const allowed = {
    run: ['local', 'base', 'intent', 'reviewer', 'reviewerModel', 'reviewerEffort'],
    clean: ['local', 'base', 'intent', 'reviewer', 'reviewerModel', 'reviewerEffort'],
    init: ['config', 'command', 'check'],
    status: ['publish'],
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
  } else if (positionals.length)
    throw new DeslopError('USAGE', `Unexpected argument: ${positionals[0]}`);
  if (command === 'shape') {
    console.log(JSON.stringify(SHAPE, null, 2));
    console.log(
      'Potentially long: checks[], checks[].failures[], review.items[], commits[]. Excerpts <=20 lines. Full logs can be large.',
    );
    return;
  }
  const places = await locations({ cwd });
  if (command === 'init')
    return await init({
      places,
      options,
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
