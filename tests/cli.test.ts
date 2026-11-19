import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture, nonDefectExamples } from './fixtures.ts';
function passed(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function failed(result, code) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, new RegExp(`code: ${code}`));
}
const finding = {
  id: 'R1',
  where: 'work.txt:1',
  problem: 'bad content',
  fixed: true,
  kind: 'defect',
};

test('checks cannot change configured hooks or enable an existing hook', (t) => {
  const f = fixture(t);
  const hooks = join(f.home, 'custom-hooks');
  mkdirSync(hooks);
  const hook = join(hooks, 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  f.git('config', 'core.hooksPath', hooks);
  const operation = `require('node:fs').writeFileSync(${JSON.stringify(hook)}, 'changed')`;
  const helper = join(f.home, 'change-hook.cjs');
  writeFileSync(helper, operation);
  f.config.commands.tests = `node ${JSON.stringify(helper)}`;
  f.configure();
  f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'CHECK_GIT');
  assert.deepEqual(f.runs()[0].commits, []);
  assert.equal(f.call('status').status, 1);
});

test('a dangling hook does not block review or proof', (t) => {
  const f = fixture(t);
  symlinkSync(join(f.home, 'missing-hook'), join(f.root, '.git/hooks/pre-commit'));
  passed(f.call('run', '--reviewer', 'fixture'));
  passed(f.call('status'));
});

test('checks cannot create worktree-specific git config after it is enabled', (t) => {
  const f = fixture(t);
  f.git('config', 'extensions.worktreeConfig', 'true');
  f.config.commands.tests = 'git config --worktree core.fileMode false';
  f.configure();
  f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'CHECK_GIT');
  assert.deepEqual(f.runs()[0].commits, []);
  assert.equal(f.call('status').status, 1);
});

test('enabled worktree config without a file does not block review or proof', (t) => {
  const f = fixture(t);
  f.git('config', 'extensions.worktreeConfig', 'true');
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.equal(f.runs()[0].checks[0].ok, true);
  passed(f.call('status'));
});

test('status rejects malformed proof counts and null checks without crashing', (t) => {
  const f = fixture(t),
    head = f.git('rev-parse', 'HEAD');
  for (const fields of [
    { review: {} },
    {
      review: {
        found: -1,
        fixed: -1,
      },
    },
    { checks: [null] },
  ]) {
    const marker = {
      version: 1,
      head,
      verdict: 'passed',
      checks: [],
      review: {
        found: 0,
        fixed: 0,
      },
      ...fields,
    };
    f.git(
      'notes',
      '--ref=deslop',
      'add',
      '-f',
      '-m',
      JSON.stringify(marker),
      head,
    );
    const result = f.call('status', '--publish');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /marker: missing or stale/);
    assert.doesNotMatch(result.stderr, /TypeError/);
  }
  assert.equal(
    f.load().github.some((args) => args.includes('--method')),
    false,
  );
});

test('checks cannot switch to the default branch at the same commit', (t) => {
  const f = fixture(t);
  f.config.commands.tests = 'git branch -f main HEAD && git switch main';
  f.configure();
  f.commit();
  const result = f.call('run', '--reviewer', 'fixture');
  failed(result, 'CHECK_GIT');
  assert.equal(f.runs()[0].verdict, 'failed');
  assert.deepEqual(f.runs()[0].commits, []);
  assert.equal(f.call('status').status, 1);
  assert.equal(
    f.load().github.some((args) => args.includes('--method')),
    false,
  );
});

test('removing a file introduced by an earlier fix retains its required checks', (t) => {
  const f = fixture(t);
  f.config.commands.extra = 'node -e "process.exit(1)"';
  f.config.kinds = [
    {
      name: 'extra',
      match: ['extra.txt'],
      commands: ['extra'],
      checks: [],
    },
    {
      name: 'other',
      match: ['**'],
      commands: [],
      checks: [],
    },
  ];
  f.config.reviewers.fixture = {
    command: [
      'node',
      '-e',
      `
    const fs = require('node:fs');
    process.stdin.resume();
    process.stdin.on('end', () => {
      if (fs.existsSync('extra.txt')) fs.unlinkSync('extra.txt');
      else fs.writeFileSync('extra.txt', 'introduced by review');
      console.log(JSON.stringify({items: []}));
    });
  `,
    ],
  };
  f.configure();
  f.commit();
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const data = f.runs()[0];
  assert.deepEqual(
    data.checks.map((check) => check.name),
    ['extra', 'extra'],
  );
  assert.ok(data.checks.every((check) => !check.ok));
  assert.equal(existsSync(join(f.root, 'extra.txt')), false);
  assert.equal(f.call('status').status, 1);
});

test('reverting a changed file during review retains its required checks', (t) => {
  const f = fixture(t);
  f.config.kinds = [
    {
      name: 'work',
      match: ['work.txt'],
      commands: ['tests'],
      checks: ['Tests'],
    },
    {
      name: 'other',
      match: ['**'],
      commands: [],
      checks: [],
    },
  ];
  f.configure();
  f.git('add', '.');
  f.git('commit', '-m', 'configure kinds');
  f.git('branch', 'review-base');
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const s = f.load();
  s.actions = [
    {
      edit: 'good',
      items: [finding],
    },
  ];
  f.save(s);
  passed(f.call('run', '--base', 'review-base', '--reviewer', 'fixture'));
  assert.equal(f.runs()[0].checks.length, 1);
  assert.equal(f.runs()[0].checks[0].name, 'tests');
  assert.equal(f.runs()[0].checks[0].ok, true);
});

test('changed directory symlinks are reviewed without reading their targets', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'linked-directory'));
  writeFileSync(join(f.root, 'linked-directory', 'inner.txt'), 'inside');
  f.commit();
  f.git('branch', 'review-base');
  writeFileSync(join(f.home, 'inner.txt'), 'outside secret');
  rmSync(join(f.root, 'linked-directory'), { recursive: true });
  symlinkSync(f.home, join(f.root, 'linked-directory'));
  f.commit();
  passed(f.call('run', '--base', 'review-base', '--reviewer', 'fixture'));
  const prompt = f.load().calls[0].prompt;
  assert.match(
    prompt,
    /linked-directory: symlink or submodule; see branch diff/,
  );
  assert.doesNotMatch(prompt, /outside secret/);
  passed(f.call('status'));
});

test('commits review edits before checks and marks the final local commit without any PR', (t) => {
  const f = fixture(t);
  const s = f.load();
  s.actions = [
    {
      edit: 'good',
      items: [finding],
    },
  ];
  f.save(s);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const initial = f.git('rev-parse', 'HEAD');
  passed(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD'),
    data = f.runs()[0];
  assert.notEqual(head, initial);
  assert.deepEqual(data.commits, [head]);
  assert.equal(data.review.fixed, 1);
  assert.equal(data.checks[0].ok, true);
  assert.match(
    f.git('log', '-1', '--format=%s'),
    /^deslop: fix review findings$/,
  );
  assert.equal(
    JSON.parse(f.git('notes', '--ref=deslop', 'show', head)).head,
    head,
  );
  assert.equal(f.git('status', '--porcelain'), '');
  passed(f.call('status'));
  const state = f.load();
  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0].prompt, /No check results are supplied/);
  assert.match(state.calls[0].prompt, /never demand/);
  assert.equal(
    state.github.some((args) => args.includes('--method')),
    false,
  );
  writeFileSync(join(f.root, 'new.txt'), 'new');
  f.commit();
  assert.equal(f.call('status').status, 1);
});

test('failed checks resume the same session and produce bounded failure excerpts and full logs', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const s = f.load();
  s.actions = [
    {},
    {
      edit: 'good',
      items: [finding],
    },
  ];
  f.save(s);
  passed(f.call('--reviewer', 'fixture'));
  const calls = f.load().calls,
    data = f.runs()[0];
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['--resume', 'session-fixture']);
  assert.match(calls[1].prompt, /FAIL work/);
  assert.equal(data.checks[0].ok, false);
  assert.equal(data.checks[1].ok, true);
  assert.ok(data.checks[0].failures[0].excerpt.split('\n').length <= 20);
  assert.ok(
    readFileSync(join(f.root, data.checks[0].log), 'utf8').split('\n').length >
      20,
  );
  passed(f.call('status'));
  assert.equal(data.commits.length, 1);
  assert.equal(f.git('log', '-1', '--format=%s'), 'deslop: fix failing checks');
});

test('attempt limits return failures without proof and zero makes no check-fix call', (t) => {
  const f = fixture(t);
  f.config.checkFixAttempts = 0;
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(f.load().calls.length, 1);
  assert.equal(f.runs()[0].verdict, 'failed');
  assert.equal(f.call('status').status, 1);
  f.config.checkFixAttempts = 2;
  f.configure();
  f.commit();
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(f.load().calls.length, 3);
  assert.equal(f.call('status').status, 1);
});

test('dirty work is refused in one line before any agent call and default branches are refused', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'untracked'), 'dirty');
  const result = f.call('run', '--reviewer', 'fixture');
  assert.equal(result.stderr.trim(), 'commit or stash your changes first');
  assert.equal(f.load().calls.length, 0);
  rmSync(join(f.root, 'untracked'));
  f.git('switch', 'main');
  failed(f.call('run', '--reviewer', 'fixture'), 'BRANCH');
});

test('work that becomes dirty before the lock is acquired is refused before review', (t) => {
  const f = fixture(t);
  rmSync(join(f.bin, 'git'));
  writeFileSync(
    join(f.bin, 'git'),
    `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2),counter=${JSON.stringify(join(f.home, 'status-count'))};
if(args[0]==='status') {
  const count=fs.existsSync(counter)?Number(fs.readFileSync(counter))+1:1;
  fs.writeFileSync(counter,String(count));
  if(count===2)fs.writeFileSync('untracked','concurrent edit');
}
const result=cp.spawnSync(${JSON.stringify(f.gitBin)},args,{stdio:'inherit'});process.exit(result.status??1);
`,
    { mode: 0o755 },
  );
  const result = f.call('run', '--reviewer', 'fixture');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /commit or stash your changes first/);
  assert.equal(f.load().calls.length, 0);
  assert.equal(
    readFileSync(join(f.root, 'untracked'), 'utf8'),
    'concurrent edit',
  );
  assert.equal(existsSync(join(f.root, '.deslop')), false);
});

test('an agent trying to commit is detected and cannot receive a marker or push', (t) => {
  const f = fixture(t);
  const s = f.load();
  s.actions = [{ git: true }];
  f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'AGENT_GIT');
  assert.equal(f.runs()[0].verdict, 'failed');
  assert.equal(f.runs()[0].commits.length, 0);
  assert.equal(f.call('status').status, 1);
  assert.equal(
    f.load().github.some((args) => args.includes('--method')),
    false,
  );
});

test('pushed CI runs push only review fixes and publish an exact-head status without a PR', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  f.push();
  const initial = f.git('rev-parse', 'HEAD');
  const s = f.load();
  s.actions = [
    {
      edit: 'good',
      items: [finding],
    },
  ];
  f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD');
  assert.notEqual(head, initial);
  assert.equal(
    f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0],
    head,
  );
  const calls = f.load().github;
  assert.ok(
    calls.some((args) =>
      args.includes(
        `repos/example/project/commits/${head}/check-runs?per_page=100`,
      ),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args.includes(`repos/example/project/statuses/${head}`) &&
        args.includes('state=success'),
    ),
  );
  assert.deepEqual(
    f.runs()[0].checks.map((check) => check.name),
    ['Tests'],
  );
  const red = f.load();
  red.checks[0].conclusion = 'failure';
  f.save(red);
  assert.equal(f.call('run', '--reviewer', 'fixture').status, 1);
  assert.equal(f.call('status').status, 1);
});

test('local override keeps fix commits local even when the starting commit was pushed', (t) => {
  const f = fixture(t);
  f.push();
  const initial = f.git('rev-parse', 'HEAD');
  const s = f.load();
  s.actions = [
    {
      edit: 'good',
      items: [finding],
    },
  ];
  f.save(s);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  f.git('push', 'origin', 'HEAD:refs/heads/change');
  const pushed = f.git('rev-parse', 'HEAD');
  passed(f.call('run', '--local', '--reviewer', 'fixture'));
  assert.notEqual(f.git('rev-parse', 'HEAD'), initial);
  assert.equal(
    f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0],
    pushed,
  );
  assert.equal(
    f.load().github.some((args) => args.includes('state=success')),
    false,
  );
});

test('providers deny git tools, retain sessions, detect hosted Codex and apply model precedence', (t) => {
  const f = fixture(t);
  f.env.CODEX_THREAD_ID = 'hosted';
  f.config.reviewerModels = {
    codex: {
      model: 'repo',
      effort: 'high',
    },
  };
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const s = f.load();
  s.actions = [
    {},
    {
      edit: 'good',
      items: [finding],
    },
  ];
  f.save(s);
  passed(f.call('run', '--reviewer-model', 'run'));
  const calls = f.load().calls;
  assert.ok(calls[0].args.includes('project_doc_max_bytes=0'));
  assert.ok(calls[0].args.includes('features.shell_tool=false'));
  assert.ok(calls[0].args.includes('default_permissions="deslop"'));
  assert.ok(calls[0].args.includes('run'));
  assert.ok(calls[0].args.includes('model_reasoning_effort="high"'));
  assert.ok(calls[1].args.includes('resume'));
  assert.ok(calls[1].args.includes('session-fixture'));
  assert.equal(calls[0].parent, undefined);
  passed(f.call('run', '--reviewer', 'claude'));
  const claude = f.load().calls.at(-1);
  assert.ok(claude.args.includes('Read,Glob,Grep,Edit,Write'));
  assert.ok(claude.args.includes('--session-id'));
  const deny = JSON.parse(claude.args[claude.args.indexOf('--settings') + 1])
    .permissions.deny;
  assert.ok(
    deny.includes(
      `Write(/${f.git('rev-parse', '--path-format=absolute', '--git-common-dir')}/**)`,
    ),
  );
  assert.ok(
    deny.includes(
      `Edit(/${f.git('rev-parse', '--path-format=absolute', '--git-common-dir')}/**)`,
    ),
  );
  assert.ok(deny.includes('Read(./.deslop/**)'));
});

test('custom commands without resume get a fresh call explaining earlier commits', (t) => {
  const f = fixture(t);
  delete f.config.reviewers.fixture.resume;
  f.configure();
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  const s = f.load();
  s.actions = [
    {},
    {
      edit: 'good',
      items: [finding, {
        ...nonDefectExamples[0],
        kind: 'verification'
      }],
    },
  ];
  f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.deepEqual(f.runs()[0].checkFixes[0].items, [finding]);
  assert.match(f.load().calls[1].prompt, /Fresh fallback call/);
  assert.deepEqual(f.load().calls[1].args, []);
});

test('invalid agent output and unfixed items cannot create proof', (t) => {
  const f = fixture(t);
  let s = f.load();
  s.actions = [{ invalid: true }];
  f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'REVIEW_OUTPUT');
  assert.equal(f.call('status').status, 1);
  s = f.load();
  s.actions = [
    {
      items: [
        {
          ...finding,
          fixed: false,
        },
      ],
    },
  ];
  f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'UNFIXED');
  assert.equal(f.call('status').status, 1);
});

test('reviewer non-defect notes do not block checks or proof', (t) => {
  const f = fixture(t);
  const s = f.load();
  s.actions = [{ items: [
    ...nonDefectExamples.map((item, index) => ({
      ...item,
      kind: index === 0 ? 'verification' : 'note'
    })),
    finding,
  ] }];
  f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  const data = f.runs()[0];
  assert.deepEqual(data.review, {
    found: 1,
    fixed: 1,
    items: [finding]
  });
  assert.equal(data.checks[0].ok, true);
  passed(f.call('status'));
});

test('real unfixed defects still block proof regardless of wording', (t) => {
  const f = fixture(t);
  const s = f.load();
  const defects = [
    'No defect found is printed even when a real finding is unfixed',
    'Verification fails because the command exits successfully on invalid input',
    'The reviewer ran no checks warning hides a failed required check',
  ].map((problem, index) => ({
    id: `R${index}`,
    where: 'src/run.js:1',
    problem,
    fixed: false,
    kind: 'defect',
  }));
  s.actions = [{ items: [...defects, ...nonDefectExamples.map(item => ({
    ...item,
    kind: 'note'
  }))] }];
  f.save(s);
  failed(f.call('run', '--reviewer', 'fixture'), 'UNFIXED');
  assert.deepEqual(f.runs()[0].review, {
    found: defects.length,
    fixed: 0,
    items: defects
  });
  assert.equal(f.call('status').status, 1);
});

test('base override wins over an open stacked PR base and no PR falls back locally', (t) => {
  const f = fixture(t);
  f.push();
  f.git('branch', 'parent');
  writeFileSync(join(f.root, 'later.txt'), 'later');
  f.commit();
  const s = f.load();
  s.pr = {
    state: 'OPEN',
    baseRefName: 'parent',
  };
  f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.doesNotMatch(f.load().calls[0].prompt, /diff --git a\/work.txt/);
  passed(f.call('run', '--base', 'main', '--reviewer', 'fixture'));
  assert.match(f.load().calls[1].prompt, /diff --git a\/work.txt/);
});

test('the prompt opens with the intent file, else the open PR description, else says none was supplied', (t) => {
  const f = fixture(t);
  f.push();
  const s = f.load();
  s.pr = {
    state: 'OPEN',
    baseRefName: 'main',
    number: 7,
    body: 'Asked: keep the retry around the flaky upstream call.',
  };
  f.save(s);
  writeFileSync(join(f.home, 'intent.md'), 'Asked: rename the login field.');
  passed(f.call('run', '--intent', join(f.home, 'intent.md'), '--reviewer', 'fixture', '--local'));
  passed(f.call('run', '--reviewer', 'fixture', '--local'));
  const prompts = f.load().calls.map((call) => call.prompt);
  assert.match(prompts[0], /^Intent supplied with this review[^\n]*\nAsked: rename the login field\./);
  assert.doesNotMatch(prompts[0], /flaky upstream/);
  assert.match(prompts[1], /^Intent supplied with this review[^\n]*\nAsked: keep the retry/);
  const pr = f.load();
  delete pr.pr;
  f.save(pr);
  passed(f.call('run', '--reviewer', 'fixture', '--local'));
  assert.match(f.load().calls.at(-1).prompt, /^Intent supplied with this review: none\. No intent was supplied, so every code smell is unasked\./);
  assert.deepEqual(
    f.runs().map((run) => run.intent).sort((a, b) => a.source.localeCompare(b.source)),
    [
      {
        source: 'file',
        path: join(f.home, 'intent.md'),
      },
      { source: 'none' },
      {
        source: 'pr',
        pr: 7,
      },
    ],
  );
});

test('init creates repo config without a workflow and shape works outside a repository', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'deslop.config.json'));
  f.commit();
  failed(f.call('init', '--machine'), 'USAGE');
  failed(f.call('init'), 'USAGE');
  passed(f.call('init', '--command', 'tests=npm test', '--check', 'Tests'));
  assert.equal(existsSync(join(f.root, '.github/workflows')), false);
  failed(f.call('init'), 'CONFIG');
  const result = spawnSync(process.execPath, [f.cli, 'shape'], {
    cwd: f.home,
    env: f.env,
    encoding: 'utf8',
  });
  passed(result);
  assert.match(result.stdout, /Potentially long/);
  assert.match(result.stdout, /20 lines/);
});

test('installed executable symlinks invoke the command and removed flags are rejected', (t) => {
  const f = fixture(t);
  const bin = join(f.home, 'installed');
  symlinkSync(fileURLToPath(new URL('../bin/deslop.js', import.meta.url)), bin);
  passed(
    spawnSync(process.execPath, [bin, 'shape'], {
      cwd: f.home,
      env: f.env,
      encoding: 'utf8',
    }),
  );
  failed(f.call('run', '--mode', 'local'), 'USAGE');
  failed(f.call('run', '--decline', 'R1:reason'), 'USAGE');
  failed(f.call('run', '--skip', 'tests'), 'USAGE');
});

test('failed CI resumes the agent, pushes only its fix and waits on the new exact head', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'work.txt'), 'bad');
  f.commit();
  f.push();
  const initial = f.git('rev-parse', 'HEAD');
  const s = f.load();
  s.checks[0].conclusion = 'failure';
  s.actions = [
    {},
    {
      edit: 'good',
      items: [finding],
      checks: [
        {
          id: 2,
          name: 'Tests',
          status: 'completed',
          conclusion: 'success',
        },
      ],
    },
  ];
  f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  const head = f.git('rev-parse', 'HEAD');
  assert.notEqual(head, initial);
  assert.deepEqual(f.load().calls[1].args, ['--resume', 'session-fixture']);
  assert.equal(
    f.git('ls-remote', 'origin', 'refs/heads/change').split(/\s/)[0],
    head,
  );
  assert.ok(
    f
      .load()
      .github.some((args) =>
        args.includes(
          `repos/example/project/commits/${head}/check-runs?per_page=100`,
        ),
      ),
  );
  passed(f.call('status'));
});

test('unavailable providers fall back with their own models rather than the primary override', (t) => {
  const f = fixture(t);
  f.config.reviewers.missing = { command: ['missing-agent'] };
  f.config.reviewerModels = {
    fixture: {
      model: 'fallback-model',
      effort: 'low',
    },
  };
  f.configure();
  f.commit();
  mkdirSync(join(f.home, 'config/deslop'), { recursive: true });
  writeFileSync(
    join(f.home, 'config/deslop/settings.json'),
    JSON.stringify({ reviewer: ['missing', 'fixture'] }),
  );
  passed(
    f.call(
      'run',
      '--reviewer-model',
      'primary-model',
      '--reviewer-effort',
      'high',
    ),
  );
  assert.equal(f.load().calls[0].model, 'fallback-model');
  assert.equal(f.load().calls[0].effort, 'low');
});

test('a concurrent HEAD change between final checks and proof cannot receive a marker', (t) => {
  const f = fixture(t);
  rmSync(join(f.bin, 'git'));
  writeFileSync(
    join(f.bin, 'git'),
    `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2), real=${JSON.stringify(f.gitBin)}, root=${JSON.stringify(f.root)}, counter=${JSON.stringify(join(f.home, 'statuses-after-checks'))};
if(args[0]==='status') { const runs=path.join(root,'.deslop','runs'); if(fs.existsSync(runs)) { const ids=fs.readdirSync(runs); const record=ids[0]&&path.join(runs,ids[0],'run.json'); if(record&&fs.existsSync(record)&&JSON.parse(fs.readFileSync(record)).checks.some(check=>check.ok)) { if(!fs.existsSync(counter)){fs.writeFileSync(counter,'changed');cp.execFileSync(real,['commit','--allow-empty','-m','concurrent commit'],{cwd:root});} } } }
const result=cp.spawnSync(real,args,{stdio:'inherit'});process.exit(result.status??1);
`,
    { mode: 0o755 },
  );
  failed(f.call('run', '--reviewer', 'fixture'), 'HEAD_CHANGED');
  assert.equal(f.runs()[0].verdict, 'failed');
  assert.equal(f.call('status').status, 1);
});

test('a GitHub publication outage cannot block local proof and status can retry later', (t) => {
  const f = fixture(t);
  f.config.publishLocal = true;
  f.configure();
  f.commit();
  f.push();
  const s = f.load();
  s.publicationOutage = true;
  f.save(s);
  const result = f.call('run', '--local', '--reviewer', 'fixture');
  passed(result);
  assert.match(result.stdout, /proof: local/);
  assert.match(result.stdout, /status: not published yet/);
  assert.equal(f.runs()[0].published, false);
  passed(f.call('status'));
  assert.equal(
    f.load().github.some((args) => args.includes('state=pending')),
    false,
  );
  const recovered = f.load();
  recovered.publicationOutage = false;
  f.save(recovered);
  passed(f.call('status', '--publish'));
  assert.ok(f.load().github.some((args) => args.includes('state=success')));
});

test('another worktree committing during checks does not invalidate this checkout', (t) => {
  const f = fixture(t),
    peer = join(f.home, 'peer'),
    helper = join(f.home, 'peer-commit.cjs');
  f.git('worktree', 'add', '-b', 'peer', peer, 'main');
  writeFileSync(
    helper,
    `const fs=require('node:fs'),cp=require('node:child_process');const cwd=${JSON.stringify(peer)};fs.writeFileSync(require('node:path').join(cwd,'peer.txt'),'other worker');cp.execFileSync('git',['add','peer.txt'],{cwd});cp.execFileSync('git',['commit','-m','other worker commit'],{cwd});`,
  );
  f.config.commands.tests = `node ${JSON.stringify(helper)}`;
  f.configure();
  f.commit();
  const head = f.git('rev-parse', 'HEAD');
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(
    f.git('log', 'peer', '-1', '--format=%s'),
    'other worker commit',
  );
  assert.deepEqual(f.runs()[0].commits, []);
  passed(f.call('status'));
});

test('checks changing this checkout index are refused without proof', (t) => {
  const f = fixture(t);
  f.config.commands.tests = 'git rm --cached work.txt';
  f.configure();
  f.commit();
  failed(f.call('run', '--reviewer', 'fixture'), 'CHECK_GIT');
  assert.equal(f.runs()[0].verdict, 'failed');
  assert.equal(f.call('status').status, 1);
});

test('new normal test files are created, checked, committed and listed in the run record', (t) => {
  const f = fixture(t);
  f.config.commands.tests = 'node --test new-regression.test.cjs';
  f.configure();
  f.commit();
  const s = f.load();
  s.actions = [
    {
      newFile: {
        path: 'new-regression.test.cjs',
        content:
          "require('node:test').test('coverage',()=>require('node:assert/strict').equal(2,2));",
      },
      items: [finding],
    },
  ];
  f.save(s);
  passed(f.call('run', '--reviewer', 'fixture'));
  assert.deepEqual(f.runs()[0].newFiles, ['new-regression.test.cjs']);
  assert.equal(
    f.git('ls-files', '--error-unmatch', 'new-regression.test.cjs'),
    'new-regression.test.cjs',
  );
  assert.equal(f.runs()[0].checks[0].ok, true);
  passed(f.call('status'));
});
