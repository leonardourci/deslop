import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import picomatch from 'picomatch';
import { git, DeslopError } from './process.js';
import {
  DEFAULT_SKILLS,
  canonicalSkill,
  defaultSkills,
  instructionPaths,
} from './instructions.js';

export const CONFIG_FILE = 'deslop.config.json';
function fail(message) {
  throw new DeslopError('CONFIG', message);
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim())
  );
}
export function readJson({ path }) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Cannot read ${path}: ${error.message}`);
  }
}
export function validateModels({ models = {} }) {
  if (!object(models)) fail('reviewerModels must be an object');
  for (const [provider, choice] of Object.entries(models)) {
    if (
      !object(choice) ||
      !Object.keys(choice).every((key) => ['model', 'effort'].includes(key)) ||
      !Object.values(choice).every(
        (value) => typeof value === 'string' && value.trim(),
      )
    )
      fail(`Invalid model settings for ${provider}`);
  }
}
export function validateConfig({
  config,
  root
}) {
  const keys = [
    'commands',
    'kinds',
    'instructions',
    'checkFixAttempts',
    'reviewerModels',
    'reviewers',
    'publishLocal',
    'fallbackLint',
  ];
  if (!object(config) || Object.keys(config).some((key) => !keys.includes(key)))
    fail('Config contains unsupported settings');
  if (
    !object(config.commands) ||
    !Object.values(config.commands).every(
      (command) => typeof command === 'string' && command.trim(),
    )
  )
    fail('commands must map names to shell commands');
  if (
    config.checkFixAttempts !== undefined &&
    (!Number.isInteger(config.checkFixAttempts) || config.checkFixAttempts < 0)
  )
    fail('checkFixAttempts must be a nonnegative integer');
  if (
    config.publishLocal !== undefined &&
    typeof config.publishLocal !== 'boolean'
  )
    fail('publishLocal must be boolean');
  if (
    config.fallbackLint !== undefined &&
    typeof config.fallbackLint !== 'boolean'
  )
    fail('fallbackLint must be boolean');
  if (config.instructions !== undefined)
    validateInstructions({
      instructions: config.instructions,
      root,
    });
  if (!Array.isArray(config.kinds) || !config.kinds.length)
    fail('kinds must be nonempty');
  const names = new Set();
  for (const kind of config.kinds) {
    if (
      !object(kind) ||
      typeof kind.name !== 'string' ||
      names.has(kind.name) ||
      !strings(kind.match) ||
      !kind.match.length ||
      !strings(kind.commands) ||
      !strings(kind.checks)
    )
      fail('Each kind needs a unique name, patterns, commands and checks');
    if (kind.ciRequired !== undefined && typeof kind.ciRequired !== 'boolean')
      fail(`ciRequired must be boolean in ${kind.name}`);
    if (kind.ciRequired && !kind.checks.length)
      fail(`ciRequired needs CI checks in ${kind.name}`);
    names.add(kind.name);
    if (kind.commands.some((name) => !Object.hasOwn(config.commands, name)))
      fail(`Unknown command in ${kind.name}`);
    if (
      kind.checks.some(
        (name) => name === 'deslop' || /^coderabbit(?:ai)?$/i.test(name),
      )
    )
      fail('Checks cannot include deslop or CodeRabbit');
    if (
      kind.instructions !== undefined &&
      (!strings(kind.instructions) ||
        kind.instructions.some(
          (name) =>
            !Object.hasOwn(DEFAULT_SKILLS, canonicalSkill(name)) &&
            !Object.hasOwn(config.instructions || {}, name),
        ))
    )
      fail(`Unknown instructions in ${kind.name}`);
  }
  validateModels({ models: config.reviewerModels });
  if (config.reviewers !== undefined) {
    if (!object(config.reviewers))
      fail('reviewers must map provider names to commands');
    for (const reviewer of Object.values(config.reviewers)) {
      if (
        !object(reviewer) ||
        !strings(reviewer.command) ||
        !reviewer.command.length ||
        (reviewer.resume !== undefined &&
          (!strings(reviewer.resume) || !reviewer.resume.length))
      )
        fail('Custom providers need argv command and optional resume arrays');
    }
  }
  return config;
}
export function select({
  config,
  paths,
  hasTests = false
}) {
  const selected = new Set();
  const instructions = new Set();
  for (const path of paths) {
    const kind = config.kinds.find((kind) =>
      picomatch(kind.match, { dot: true })(path),
    );
    if (!kind) fail(`No change kind matches ${path}`);
    selected.add(kind);
    const names =
      kind.instructions ||
      defaultSkills({
        kind,
        path,
        hasTests,
      });
    for (const name of names) instructions.add(canonicalSkill(name));
  }
  const kinds = [...selected];
  return {
    kinds: kinds.map((kind) => kind.name),
    commands: [...new Set(kinds.flatMap((kind) => kind.commands))],
    checks: [...new Set(kinds.flatMap((kind) => kind.checks))],
    requiredChecks: [
      ...new Set(
        kinds.filter((kind) => kind.ciRequired).flatMap((kind) => kind.checks),
      ),
    ],
    instructions: [
      ...Object.keys(DEFAULT_SKILLS).filter((name) => instructions.has(name)),
      ...Array.from(instructions).filter(
        (name) => !Object.hasOwn(DEFAULT_SKILLS, name),
      ),
    ],
  };
}
export function instructionsFor({
  root,
  config,
  selection
}) {
  const paths = {
    ...DEFAULT_SKILLS,
    ...instructionPaths({
      root,
      instructions: config.instructions,
    }),
  };
  return selection.instructions
    .filter((name) => paths[name] !== false)
    .map((name) => `${name}:\n${readFileSync(paths[name], 'utf8')}`)
    .join('\n\n');
}
function validateInstructions({
  instructions,
  root
}) {
  if (!object(instructions))
    fail('instructions must map skill names to files or false');
  for (const [name, file] of Object.entries(instructions)) {
    if (file === false) continue;
    if (
      typeof file !== 'string' ||
      !file.trim() ||
      !existsSync(resolve(root, file))
    )
      fail(`Missing instructions file: ${name}`);
  }
}
export async function locations({
  cwd,
  env = process.env
}) {
  const root = await git({
    cwd,
    args: ['rev-parse', '--show-toplevel'],
  });
  const common = await git({
    cwd: root,
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  });
  const home = join(
    env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'deslop',
  );
  const lock = resolve(
    root,
    await git({
      cwd: root,
      args: ['rev-parse', '--git-path', 'deslop.lock'],
    }),
  );
  return {
    root,
    common,
    home,
    lock,
  };
}
export function loadSettings({ home }) {
  const file = join(home, 'settings.json');
  const settings = existsSync(file) ? readJson({ path: file }) : {};
  if (
    !object(settings) ||
    Object.keys(settings).some(
      (key) => !['reviewer', 'reviewerModels'].includes(key),
    )
  )
    fail('Unsupported machine settings');
  if (
    settings.reviewer !== undefined &&
    !(typeof settings.reviewer === 'string' && settings.reviewer.trim()) &&
    !(strings(settings.reviewer) && settings.reviewer.length)
  )
    fail('reviewer must be a provider or nonempty list');
  validateModels({ models: settings.reviewerModels });
  return settings;
}
export function loadConfig({
  places,
  env = process.env
}) {
  const file = join(places.root, CONFIG_FILE);
  if (!existsSync(file)) fail('No config; run deslop init');
  const config = validateConfig({
    root: places.root,
    config: readJson({ path: file }),
  });
  config.instructions = instructionPaths({
    root: places.root,
    instructions: config.instructions,
  });
  if (env.DESLOP_INSTRUCTIONS) {
    const localFile = resolve(env.DESLOP_INSTRUCTIONS);
    const instructions = readJson({ path: localFile });
    const root = dirname(localFile);
    validateInstructions({
      instructions,
      root,
    });
    config.instructions = {
      ...config.instructions,
      ...instructionPaths({
        root,
        instructions,
      }),
    };
  }
  return config;
}
