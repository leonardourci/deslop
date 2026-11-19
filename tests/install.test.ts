import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../docs/install.sh', import.meta.url));
const latestApi = 'https://api.github.com/repos/leonardourci/deslop/releases/latest';
const latestTag = 'v0.1.0-0123456789abcdef0123456789abcdef01234567';

for (const scenario of [
  {
    name: 'latest',
    status: 0,
  },
  {
    name: 'pinned',
    tag: 'v0.1.0-abcdef0123456789abcdef0123456789abcdef01',
    status: 0,
  },
  {
    name: 'latest lookup failure',
    failure: 'lookup',
    status: 22,
  },
  {
    name: 'latest metadata without a tag',
    failure: 'metadata',
    status: 1,
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
const api = args[1] === '${latestApi}';
fs.appendFileSync(process.env.INSTALL_TEST_ROOT + '/url', args[1] + '\\n');
const content = api ? JSON.stringify(process.env.INSTALL_TEST_FAILURE === 'metadata' ? {} : {tag_name: '${latestTag}'}) : 'release tarball';
fs.writeFileSync(args[args.indexOf('-o') + 1], content);
if (process.env.INSTALL_TEST_FAILURE === (api ? 'lookup' : 'download')) process.exit(22);
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
      const urls = [];
      if (!scenario.tag) urls.push(latestApi);
      if (scenario.failure !== 'lookup' && scenario.failure !== 'metadata') {
        urls.push(`https://github.com/leonardourci/deslop/releases/download/${scenario.tag ?? latestTag}/deslop.tgz`);
      }
      assert.deepEqual(readFileSync(urlLog, 'utf8').trim().split('\n'), urls);
    }
    assert.equal(existsSync(join(root, 'installed')), scenario.status === 0 || scenario.failure === 'install');
    assert.deepEqual(readdirSync(downloads), []);
  });
}
