import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../docs/install.sh', import.meta.url));

for (const scenario of [
  {
    name: 'latest',
    status: 0,
  },
  {
    name: 'pinned',
    tag: 'v0.1.0-0123456789abcdef0123456789abcdef01234567',
    status: 0,
  },
  {
    name: 'an empty pin',
    tag: '',
    status: 2,
  },
  {
    name: 'download failure',
    failure: 'download',
    status: 22,
  },
  {
    name: 'install failure',
    failure: 'install',
    status: 7,
  },
]) {
  test(`the release installer handles ${scenario.name} and removes its download`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'deslop-install-test-'));
    t.after(() => {
      rmSync(root, {
        recursive: true,
        force: true,
      });
    });
    const bin = join(root, 'bin');
    const downloads = join(root, 'downloads');
    mkdirSync(bin);
    mkdirSync(downloads);
    writeFileSync(join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.INSTALL_TEST_ROOT + '/url', args[1]);
fs.writeFileSync(args[args.indexOf('-o') + 1], 'release tarball');
if (process.env.INSTALL_TEST_FAILURE === 'download') process.exit(22);
`, { mode: 0o755 });
    writeFileSync(join(bin, 'npm'), `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [command, scope, archive] = process.argv.slice(2);
assert.equal(command, 'install');
assert.equal(scope, '--global');
assert.equal(fs.readFileSync(archive, 'utf8'), 'release tarball');
fs.writeFileSync(process.env.INSTALL_TEST_ROOT + '/installed', archive);
if (process.env.INSTALL_TEST_FAILURE === 'install') process.exit(7);
`, { mode: 0o755 });
    const args = [installer];
    if (scenario.tag !== undefined) args.push(scenario.tag);
    const result = spawnSync('sh', args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        TMPDIR: downloads,
        INSTALL_TEST_ROOT: root,
        INSTALL_TEST_FAILURE: scenario.failure ?? '',
      },
    });
    assert.equal(result.status, scenario.status, result.error?.message ?? result.stdout + result.stderr);
    const urlLog = join(root, 'url');
    if (scenario.tag === '') {
      assert.equal(existsSync(urlLog), false);
    } else {
      const release = scenario.tag ? `download/${scenario.tag}` : 'latest/download';
      assert.equal(readFileSync(urlLog, 'utf8'),
        `https://github.com/leonardourci/deslop/releases/${release}/deslop.tgz`);
    }
    assert.equal(existsSync(join(root, 'installed')), scenario.tag !== '' && scenario.failure !== 'download');
    assert.deepEqual(readdirSync(downloads), []);
  });
}
