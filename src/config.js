import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import picomatch from 'picomatch';
import { git, VerifyError } from './process.js';
import { separateCheck } from './github.js';

export const CONFIG_FILE = 'verify.config.json';
export const WORKFLOW_FILE = '.github/workflows/verify.yml';

export function machineHome({ env = process.env } = {}) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'verify');
}

export function readJson({ path }) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new VerifyError('CONFIG', `Cannot read ${path}: ${error.message}`); }
}

function requireConfig({ condition, message }) {
  if (!condition) throw new VerifyError('CONFIG', message);
}

function stringList(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateModels({ models = {} }) {
  requireConfig({ condition: object(models), message: 'reviewerModels must be an object' });
  for (const [provider, choice] of Object.entries(models)) {
    requireConfig({ condition: object(choice) && Object.keys(choice).every(key => ['model', 'effort'].includes(key))
      && Object.values(choice).every(value => typeof value === 'string' && value.length > 0),
    message: `reviewerModels.${provider} needs model and/or effort strings` });
  }
}

export function validateConfig({ config, root }) {
  requireConfig({ condition: object(config), message: 'Config must be an object' });
  requireConfig({ condition: config.maxLocalRuns === undefined && config.reviewer === undefined, message: 'reviewer and maxLocalRuns belong in machine settings' });
  requireConfig({ condition: ['local', 'ci'].includes(config.mode), message: 'mode must be local or ci' });
  requireConfig({ condition: config.localRunCounts === undefined || typeof config.localRunCounts === 'boolean', message: 'localRunCounts must be boolean' });
  requireConfig({ condition: config.mode === 'ci' || config.localRunCounts !== false, message: 'localRunCounts: false requires CI mode' });
  requireConfig({ condition: config.decline === undefined || ['agent', 'owner'].includes(config.decline), message: 'decline must be agent or owner' });
  requireConfig({ condition: object(config.steps) && Object.values(config.steps).every(value => typeof value === 'string' && value.trim()), message: 'steps must map names to commands' });
  requireConfig({ condition: object(config.skills) && Object.values(config.skills).every(value => typeof value === 'string' && value.length > 0), message: 'skills must map names to files' });
  for (const [name, file] of Object.entries(config.skills)) {
    requireConfig({ condition: existsSync(resolve(root, file)), message: `skills.${name}: file does not exist: ${file}` });
  }
  requireConfig({ condition: Array.isArray(config.kinds) && config.kinds.length > 0, message: 'kinds must be a nonempty array' });
  const names = new Set();
  for (const [index, kind] of config.kinds.entries()) {
    const label = `kinds[${index}]`;
    requireConfig({ condition: object(kind) && typeof kind.name === 'string' && kind.name.length > 0 && !names.has(kind.name), message: `${label}: needs a unique name` });
    names.add(kind.name);
    requireConfig({ condition: stringList(kind.match) && kind.match.length > 0, message: `${label}.match needs patterns` });
    requireConfig({ condition: stringList(kind.steps), message: `${label}.steps must be an array` });
    requireConfig({ condition: kind.checks === 'all' || stringList(kind.checks), message: `${label}.checks must be names or all` });
    requireConfig({ condition: kind.skills === 'all' || stringList(kind.skills), message: `${label}.skills must be names or all` });
    requireConfig({ condition: kind.checks === 'all' || !kind.checks.some(name => separateCheck({ name })), message: `${label}.checks cannot wait for the marker check or CodeRabbit` });
    for (const step of kind.steps) requireConfig({ condition: Object.hasOwn(config.steps, step), message: `${label}.steps: unknown step ${step}` });
    if (kind.skills !== 'all') for (const skill of kind.skills) requireConfig({ condition: Object.hasOwn(config.skills, skill), message: `${label}.skills: unknown skill ${skill}` });
  }
  if (config.ownerLogins !== undefined) requireConfig({ condition: stringList(config.ownerLogins) && config.ownerLogins.length > 0, message: 'ownerLogins must be a nonempty list of logins' });
  requireConfig({ condition: config.binary === undefined || ['metadata', 'fail'].includes(config.binary), message: 'binary must be metadata or fail' });
  validateModels({ models: config.reviewerModels });
  if (config.reviewers !== undefined) {
    requireConfig({ condition: object(config.reviewers), message: 'reviewers must map names to custom commands' });
    for (const [name, reviewer] of Object.entries(config.reviewers)) {
      requireConfig({ condition: !['codex', 'claude'].includes(name) && object(reviewer) && stringList(reviewer.command) && reviewer.command.length > 0,
        message: `reviewers.${name}.command must be an argv array for a custom reviewer` });
    }
  }
  return config;
}

export function select({ config, paths }) {
  const kinds = new Set();
  for (const path of paths) {
    const kind = config.kinds.find(candidate => picomatch(candidate.match, { dot: true })(path));
    if (!kind) throw new VerifyError('CONFIG', `No change kind matches ${path}`);
    kinds.add(kind);
  }
  if (paths.length === 0) throw new VerifyError('NO_CHANGES', 'No changes against the base branch');
  const selected = [...kinds];
  const steps = [...new Set(selected.flatMap(kind => kind.steps))];
  const skills = [...new Set(selected.flatMap(kind => kind.skills === 'all' ? Object.keys(config.skills) : kind.skills))];
  const checks = selected.some(kind => kind.checks === 'all') ? 'all' : [...new Set(selected.flatMap(kind => kind.checks))];
  return { kinds: selected.map(kind => kind.name), steps, skills, checks };
}

export async function locations({ cwd, env = process.env }) {
  const root = await git({ cwd, args: ['rev-parse', '--show-toplevel'] });
  const common = await git({ cwd: root, args: ['rev-parse', '--path-format=absolute', '--git-common-dir'] });
  let identity;
  try {
    const remote = await git({ cwd: root, args: ['remote', 'get-url', 'origin'] });
    identity = remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '').replace(/\/$/, '');
  } catch { identity = common; }
  const key = createHash('sha256').update(identity).digest('hex');
  const home = machineHome({ env });
  return { root, home, common, machineConfig: join(home, 'repos', key, CONFIG_FILE), state: resolve(root, await git({ cwd: root, args: ['rev-parse', '--git-path', 'verify.json'] })) };
}

export function loadSettings({ home }) {
  const path = join(home, 'settings.json');
  const settings = existsSync(path) ? readJson({ path }) : {};
  requireConfig({ condition: object(settings), message: 'Machine settings must be an object' });
  if (settings.reviewer !== undefined) requireConfig({ condition: typeof settings.reviewer === 'string' && settings.reviewer.length > 0 || stringList(settings.reviewer) && settings.reviewer.length > 0, message: 'reviewer must be a name or a nonempty list' });
  if (settings.maxLocalRuns !== undefined) requireConfig({ condition: Number.isInteger(settings.maxLocalRuns) && settings.maxLocalRuns > 0, message: 'maxLocalRuns must be a positive integer; omit for unlimited' });
  validateModels({ models: settings.reviewerModels });
  return settings;
}

export function loadConfig({ places }) {
  const repoPath = join(places.root, CONFIG_FILE);
  const path = existsSync(repoPath) ? repoPath : places.machineConfig;
  if (path === repoPath && !existsSync(join(places.root, WORKFLOW_FILE))) throw new VerifyError('CONFIG', `Repo config requires ${WORKFLOW_FILE}; run verify init`);
  if (!existsSync(path)) throw new VerifyError('CONFIG', 'No config; run verify init --repo or verify init --machine');
  return validateConfig({ root: places.root, config: readJson({ path }) });
}
