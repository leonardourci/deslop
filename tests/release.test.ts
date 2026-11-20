import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures.ts';

test('the release workflow publishes consecutive versions and the installer pins one', (t) => {
  const project = fileURLToPath(new URL('..', import.meta.url));
  const f = fixture(t);
  const root = f.home;
  const remote = join(root, 'remote.git');
  const checkout = f.root;
  const bin = f.bin;
  const releases = join(root, 'releases');
  mkdirSync(releases);
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  git('clone', '--bare', '--no-local', '--no-tags', '--single-branch', checkout, remote);
  git('-C', checkout, 'remote', 'add', 'origin', remote);
  const head = git('-C', checkout, 'rev-parse', 'HEAD');
  const parent = git('-C', checkout, 'rev-parse', 'HEAD^');
  const legacy = `v0.1.0-${head}`;
  git('--git-dir', remote, 'update-ref', `refs/tags/${legacy}`, head);
  const workflow = readFileSync(join(project, '.github/workflows/release.yml'), 'utf8');
  const script = workflow.split('        run: |\n')[1].replace(/^ {10}/gm, '');
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const root = process.env.RELEASE_TEST_ROOT;
if (args[0] === 'api') {
  assert.equal(args[2], 'POST');
  assert.equal(args[3], 'repos/fixture/deslop/git/refs');
  const ref = args.find((arg) => arg.startsWith('ref=')).slice(4);
  const sha = args.find((arg) => arg.startsWith('sha=')).slice(4);
  execFileSync('git', ['--git-dir', join(root, 'remote.git'), 'update-ref', ref, sha, '']);
} else {
  assert.deepEqual(args.slice(0, 2), ['release', 'create']);
  const tag = args[2];
  assert.ok(args.includes('--verify-tag'));
  execFileSync('git', ['--git-dir', join(root, 'remote.git'), 'rev-parse', 'refs/tags/' + tag]);
  const destination = join(root, 'releases', tag);
  mkdirSync(destination);
  copyFileSync(args[3], join(destination, 'deslop.tgz'));
}
`, { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env node
const { copyFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const url = args.find((arg) => arg.startsWith('https://'));
require('node:assert/strict').equal(url, 'https://github.com/leonardourci/deslop/releases/download/v0.1.1/deslop.tgz');
copyFileSync(join(process.env.RELEASE_TEST_ROOT, 'releases/v0.1.1/deslop.tgz'), args[args.indexOf('-o') + 1]);
`, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    RELEASE_TEST_ROOT: root,
    GH_REPO: 'fixture/deslop',
    RUNNER_TEMP: root,
    npm_config_prefix: join(root, 'installed'),
    npm_config_ignore_scripts: 'true',
    npm_config_offline: 'true',
    npm_config_audit: 'false',
  };
  for (const [sha, version] of [[parent, '0.1.1'], [head, '0.1.2'], [head, '2.0.11']]) {
    if (version === '2.0.11') {
      for (const tag of ['v1.99.99', 'v2.0.9', 'v2.0.10', 'v9.0.0-rc.1', 'v99.0.0-build']) {
        git('--git-dir', remote, 'update-ref', `refs/tags/${tag}`, head);
      }
    }
    git('-C', checkout, 'reset', '--hard', sha);
    git('-C', checkout, 'push', 'origin', 'HEAD:refs/heads/proof');
    git('-C', checkout, 'fetch', '--tags', 'origin');
    for (const path of ['bin', 'src', 'docs', 'eslint', 'skills']) {
      cpSync(join(project, path), join(checkout, path), { recursive: true });
    }
    copyFileSync(join(project, 'README.md'), join(checkout, 'README.md'));
    copyFileSync(join(project, 'package.json'), join(checkout, 'package.json'));
    copyFileSync(join(project, 'package-lock.json'), join(checkout, 'package-lock.json'));
    const released = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: checkout,
      env: {
        ...env,
        GITHUB_SHA: sha
      },
      encoding: 'utf8',
    });
    assert.equal(released.status, 0, released.stdout + released.stderr);
    assert.equal(git('--git-dir', remote, 'rev-parse', `refs/tags/v${version}`), sha);
    assert.equal(git('-C', checkout, 'rev-parse', 'HEAD'), sha);
    const archive = join(releases, `v${version}`, 'deslop.tgz');
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
    assert.equal(metadata.version, version);
    t.diagnostic(`push ${sha}: v${version}; packed version ${metadata.version}; HEAD unchanged`);
  }
  assert.equal(git('--git-dir', remote, 'rev-parse', `refs/tags/${legacy}`), head);
  const installed = spawnSync('sh', [join(project, 'docs/install.sh'), 'v0.1.1'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const version = execFileSync(join(root, 'installed/bin/deslop'), ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, '0.1.1');
  t.diagnostic(`installer pin v0.1.1: installed deslop --version = ${version}`);
});
