# deslop

Deslop reviews committed work, fixes it, runs its checks and marks the final commit. It works before a pull request or push exists. A fresh agent sees the branch diff without check results and edits files; deslop owns every commit, push, check and marker.

Requires Node 22.18+, npm, Git and a signed-in Codex, Claude or configured custom agent. GitHub checks/statuses also need the signed-in `gh` CLI. Install the latest GitHub release:

```sh
curl -fsSL https://raw.githubusercontent.com/leonardourci/deslop/main/docs/install.sh | sh
deslop init --command tests="npm test" --check "Tests"
# Commit your config and work, then:
deslop
```

Apache-2.0 licensed.

## Pinned or always latest

Each passing push to `main` publishes `deslop.tgz` under the next patch tag (`v0.1.1`, `v0.1.2`, ...).
The packed package uses that version, so `deslop --version` matches the release. Releases queue in one workflow concurrency group, without canceling older pushes. The workflow finds the highest existing `vX.Y.Z` tag and bumps its patch number; with none, it bumps the version in `package.json`. It tags the pushed commit without committing version changes back to `main`.
Published assets and tags are never replaced by the workflow. Legacy `v0.1.0-<full commit SHA>` releases remain installable. Pick a tag from [Releases](https://github.com/leonardourci/deslop/releases) to pin an install.

- Global latest: rerun the installer above to update. It resolves the latest tag through the public GitHub API, downloads that tag's tarball to a temporary folder, installs the local tarball and removes the download. It needs no `gh` login and works on npm 11 and 12 without enabling remote or git dependencies.
- Global pinned: `curl -fsSL https://raw.githubusercontent.com/leonardourci/deslop/main/docs/install.sh | sh -s -- v0.1.1`.
- Pinned dev dependency: `npm install --save-dev --allow-remote=root 'https://github.com/leonardourci/deslop/releases/download/v0.1.1/deslop.tgz'`, then run `npx deslop`. With pnpm: `pnpm add --save-dev 'https://github.com/leonardourci/deslop/releases/download/v0.1.1/deslop.tgz'`, then run `pnpm exec deslop`.
- Direct global pinned install: `npm install -g --allow-remote=root 'https://github.com/leonardourci/deslop/releases/download/v0.1.1/deslop.tgz'`.

To always use the latest release, run the installer before each use, then run `deslop`. The installer avoids GitHub's latest-download redirect, which can serve an older release after publication. A pinned URL and the repository's lockfile keep a dev dependency on that release until you change it.

npm 12 blocks remote tarball URLs by default, so direct npm URL commands need `--allow-remote=root` (also accepted by npm 11). pnpm needs no such flag. The installed package uses jiti and needs no install script or build step.

GitHub source installs remain an alternative. Use `npm install -g github:leonardourci/deslop`, `npm install --save-dev 'github:leonardourci/deslop#<commit>'`, or `npx github:leonardourci/deslop`. npm 12 blocks these by default with `EALLOWGIT` and requires `--allow-git=root`.

Do not use `npm update -g deslop`: it replaces this install with the unrelated `deslop` package on the npm registry.

## Commands

- `deslop run` (or bare `deslop`): fresh review and fixes, checks, bounded check fixes, then proof. Dirty work stops with `commit or stash your changes first`. `--intent file` supplies what was asked.
- `deslop clean <path>...`: review and fix every tracked file under the given paths in full instead of the branch diff, then run the same checks, commits and proof as `run`. It takes the same options as `run` and is refused on the default branch. The prompt lists the file paths and the agent reads each file itself, so file size does not limit the prompt. One PR per folder keeps reviews small, but nothing enforces it.
- `deslop init`: write repo config. `--command name="shell command"` and `--check "CI name"` are repeatable. `--config file` imports an existing config. It also writes `.github/pull_request_template.md` with what was asked (the intent), what changed, how it was checked, how to try it, and a folded Intentional slop section. Each intentional item names the file, what is kept and why. Existing templates keep their content and receive only missing sections, including templates in `PULL_REQUEST_TEMPLATE` folders; `--no-pr-template` skips template changes. The template is optional: `--intent` or any PR description works without it. Missing required values prompt in a terminal and name the missing flag otherwise. No workflow is installed.
- `deslop status`: read the current commit's git note. `--publish` publishes its GitHub commit status if that final commit is pushed.
- `deslop skill copy <name>`: copy a shipped skill to `.agents/skills/<name>/SKILL.md` so the repo can tweak it. It refuses when that file or the matching `.claude/skills/<name>/SKILL.md` already exists.
- `deslop shape`: print a small example of the run record and identify fields that may be long.

The reviewer prompt opens with the intent: the `--intent` file, otherwise the open PR's description fetched through `gh`, capped at 32 KiB. With neither, the prompt says no intent was supplied, so every code smell counts as unasked. The run record's `intent.source` is `file`, `pr` or `none`.

Immediately after intent, the prompt lists every comment line added in the reviewed diff as `file:line: text`. For `clean`, it lists every comment in the reviewed files. JS/TS comments come from TypeScript's tokenizer through its syntax tree, so strings, regular expressions and JSX text do not count. Other supported extensions use a simple per-extension rule: a line that starts with a comment marker counts, and so do the following lines of a block comment it opens. That fallback does not recognize comments after code and is not a full parser. The reviewer resolves each entry under the selected skills; collection is deterministic and the agent makes the decision.

The base is `--base`, the open PR's base, origin's default branch, or local main/master, in that order. Default-branch runs are refused. Local unpushed branches run commands without a PR. If the starting commit is pushed and selected kinds need CI, deslop pushes only its own fixes to the same branch and waits for those exact-head checks. `--local` forces local commands and keeps fixes local; kinds marked `ciRequired` still require CI on the final commit. The CI wait has a 60-minute timeout, with a three-minute appearance limit for missing checks and 15-second polling. Missing checks end red after the appearance limit. Skipped, neutral, cancelled, approval-required and stale checks end red without an agent fix call. CI polling retries transient API errors; an unreachable GitHub ends red with a `--local` hint. Deslop never merges or pushes to the default branch.

Only failing, errored or timed-out checks resume the same Codex or Claude session by id, with short failure excerpts. Deslop commits its fixes and reruns checks up to `checkFixAttempts` times (default 1, 0 returns failures immediately). A custom provider without resume support receives a fresh call with a note of earlier changes. Neither AGENTS.md nor CLAUDE.md loads implicitly; set an `instructions` entry to AGENTS.md to use it. Agents can read and edit files, with git tools denied; only the try turn (below) may also run commands. Unexpected git-state changes stop the run. Agent edits use `deslop: fix review findings`, `deslop: fix failing checks` or `deslop: fix try findings`, as the configured user, with no attribution footer. Check commands use their own command-named commits.

## Trying the change

Once the checks pass, deslop can also have the agent try the change to find bugs the checks missed. It is off by default. A kind's `try` is `none`, `code` or `ui`:

- `code`: the agent exercises the changed logic directly. It calls the function, runs the CLI or hits the API with real cases.
- `ui`: the same, plus it starts the app and drives the changed screens in a headless browser of its choosing, then stops what it started.

Deslop manages no app or browser. It only picks the mode and passes the guidance; the agent uses the repository's own commands. The repo-level `tryNotes` string says how to run the app, for example `"tryNotes": "pnpm web:dev serves port 5173"`.

With several kinds selected, the highest mode applies. A PR can override it in its "How to try this" section. A first line `Try: none`, `Try: code` or `Try: ui` wins over the kind default for that run, and the rest of the section tells the agent what to exercise and with which inputs. Any other `Try:` value stops the run with a usage error. Without the section, the kind default applies.

The try turn runs once and resumes the same session after the checks first pass. Commands are allowed, but git and gh are denied and git cannot reach any remote. Scratch files stay in a temporary folder outside the repository, which custom providers get in `DESLOP_TRY_DIR`. The agent fixes bugs by editing existing files; edits are committed as `deslop: fix try findings` and the checks rerun, using the same `checkFixAttempts` budget. A try turn that leaves new files in the repository ends red. What the agent tried and found goes into the review file's findings, and the record's `try` field notes the mode and how many seconds the turn took. A failure it cannot fix ends the run red with a failed `try` check, as a check that still fails after fixes would. Otherwise the checks alone decide the verdict.

## Configuration

```json
{
  "commands": { "tests": "npm test", "lint": "npm run lint" },
  "kinds": [
    {
      "name": "docs",
      "match": ["docs/**", "**/*.md"],
      "commands": [],
      "checks": [],
      "instructions": ["kill-ai-slop"]
    },
    {
      "name": "code",
      "match": ["**"],
      "commands": ["lint", "tests"],
      "checks": ["Tests"]
    }
  ],
  "checkFixAttempts": 1,
  "publishLocal": false,
  "agentTimeoutMinutes": 45,
  "reviewerModels": {
    "codex": { "model": "<gpt-model>", "effort": "high" },
    "claude": { "model": "<claude-model>", "effort": "high" }
  }
}
```

`publishLocal` defaults to `false`. A kind may set `ciRequired: true` to require all of its named checks in CI, including under `--local` and when local publication is enabled. That kind needs at least one check. Kinds that require CI run local commands first, including on pushed runs; failures resume the agent with trimmed details before any required-CI wait. Required CI starts only after every local command passes; if their final commit is not pushed, deslop ends red with a push-and-rerun hint and posts nothing to GitHub. `--local` never pushes.

Each changed path uses its first matching kind; the run unions commands, checks and instructions. Renames count both paths. Unmatched paths, missing instruction files and unknown commands stop the run. The shipped skills are `review-code`, `kill-ai-slop` and `audit-tests`. Code gets correctness and cleanup review; names, project conventions and data model design are checked where the diff touches them. Cleanup deletes code comments, including exported-function doc comments, except license headers and type annotations read by a type checker. When a comment carried meaning, cleanup puts it into a function, constant or variable name, or extracts a well-named step. A reason that no name can carry belongs in the PR description. The intent's Intentional slop section protects listed comments, workarounds and one-off values, unless a low-hanging clean alternative removes them; the reviewer applies that alternative and reports it in findings. Unlisted comments follow the default deletion rule, and unlisted code-smell workarounds are fixed or removed. Product behavior choices are not workarounds. Test diffs or a repository with tests also get the test audit. Docs/prose get writing cleanup. Kinds can select an explicit instruction list. A tracked repo file at `.agents/skills/<name>/SKILL.md` (or `.claude/skills/<name>/SKILL.md`) with a shipped skill's name replaces that skill with no config; `.agents` wins when both exist. `deslop skill copy <name>` starts one from the shipped text. Each skill can also be replaced with a repo file or disabled with `false` in the root `instructions` map. A project that keeps exported-function doc comments can keep its own copy of the cleanup rule. On your machine, a file at `~/.deslop/repos/<repo>/skills/<name>/SKILL.md` replaces that skill for that repo only. `DESLOP_INSTRUCTIONS` entries win over local per-repo skills, which win over the `instructions` map, which wins over same-name repo skills, which win over shipped defaults.

Machine preferences live in `~/.deslop/settings.json`. `reviewer` is one provider or an ordered fallback list; otherwise deslop detects the calling agent, including hosted Codex. `--reviewer` overrides it. Model/effort precedence is CLI (`--reviewer-model`, `--reviewer-effort`), machine `reviewerModels`, repo `reviewerModels`, provider default. CLI overrides apply to the primary provider; fallback providers use their own settings.

Custom providers use `reviewers.<name>.command` as an argv array and receive the prompt on stdin. Like Codex and Claude, they write their findings as plain text into the run's review file, whose path is in the prompt and in `DESLOP_FINDINGS_FILE`. An optional `resume` argv array substitutes `{sessionId}`; to support it, the command prints `{ "sessionId": "..." }` as its last stdout line. Other output is ignored. Custom commands must restrict themselves to file editing; deslop refuses unexpected git-state changes.

Deslop runs a fallback ESLint pass on changed JS/TS files when the selected commands and active CI do not already name lint. An optional CI lint check does not suppress the fallback under `--local`. It uses the repository's ESLint config when present, otherwise the shipped recommended and house rules: no unused variables/imports, no em dashes in strings/comments, and separate lines for multi-entry objects, patterns and type literals. Set `fallbackLint: false` to disable the fallback, including when an opaque command already lints.

For machine-only skill changes, set `DESLOP_INSTRUCTIONS` to a JSON file outside the repo. Values are paths relative to that JSON file, or `false`; each entry overrides just that skill:

```json
{
  "kill-ai-slop": "my-cleanup/SKILL.md",
  "audit-tests": false
}
```

The test audit checks important changed behavior through the public surface, with assertions that survive renaming constants, functions and files. It skips properties guaranteed by the type checker, wiring, configuration and framework behavior. It folds new coverage into existing related tests first: a new login field goes in the existing login-flow test. Flaky tests are deleted when unnecessary or rewritten deterministically, without retries, sleeps or longer timeouts. Missing coverage matters only for real user/caller behavior, such as a new branch, failure path or boundary; it does not chase coverage numbers or demand evidence the tool cannot produce.

## Output and proof

Every run has one review file: `~/.deslop/repos/<repo>/reviews/<YYYY-MM-DD>-PR-<n>.json`, or `<YYYY-MM-DD>-<branch>.json` when the branch has no open PR, so past reviews stay queryable. A later run for the same PR or branch on the same day gets a numeric suffix (`-2`, `-3`). `<repo>` is the origin repository name, or the checkout folder without an origin. Deslop creates the file empty before the agent starts. The agent fixes every finding and writes all of them there as plain text, in any form. When the agent finishes, deslop rewrites the file as its run record: date, repo, PR or branch, mode, intent source, verdict, checks with `name`, `ok`, `log` and `failures`, commits, `left` paths after failures, workflow edits, and `findings` with the agent's text verbatim. Check-fix turns get the findings text back in the same file and add theirs to it. Empty findings mean none. Check logs and per-turn agent output stay in the git-ignored `.deslop/runs/<id>/` folder; each `checks[].log` in the record is an absolute path. Failure excerpts have at most 20 lines; full output stays in separate logs and can be large. Use `deslop shape` before reading a large run record.

A short summary lists the verdict, each check, the findings text (or a pointer to the review file when the text is longer than 20 lines), commits and the review file's path. The verdict comes only from the checks and deslop's git-state and scope guards; findings never fail a run.

Green checks add a git note under `refs/notes/deslop` to the final exact commit. The GitHub commit status is named `deslop` and requires a pushed commit. Local runs keep their proof local by default. `status --publish` checks the selected CI on that exact commit before posting success. Set `publishLocal: true` to allow local checks alone to publish success. A new commit has no proof until it passes its own run. This is an honesty record, not a signature. Failed runs have no new marker.

See [the contract](docs/spec.md).

A GitHub outage does not block local proof. Passed checks keep their git note if status publication fails; retry `deslop status --publish` after a push or when GitHub recovers. A rerun preserves existing proof until a red check verdict removes the note and attempts to publish failure together. No pending status is posted.

Check-fix edits to config or instruction files end red and remain available for inspection. Workflow edits are named in the summary. A fix call that changes nothing ends red without repeating the checks. Each local command has a 15-minute timeout. Reviewer agent calls (review, check-fix, clean and try) default to 45 minutes per call. Set `--agent-timeout <minutes>` for one run, or `agentTimeoutMinutes` in `~/.deslop/settings.json` or `deslop.config.json`. Precedence is CLI, machine, repo, then the default. Values must be positive numbers (fractional minutes are allowed), within Node’s maximum timer delay of 2,147,483,647 milliseconds. A timeout ends the run red; the terminal summary and review record name the call and provider, the timeout in minutes, and the settings that raise it. Additional file contents in prompts are capped per file and per run; larger files are listed by size alongside the branch diff.

## Editing scope

Tracked instruction prose such as `.agents/`, `.claude/`, `AGENTS.md` and `skills/` can be edited when it is in the reviewed diff. Other instruction files, existing untracked files and ignored paths stay outside the editing scope; git metadata and git commands remain denied. New normal source and test files can be created and are included in deslop's commit and the run record under `newFiles`. A dirty checkout is refused before the agent runs.

Codex uses a current CLI with [permission-profile support](https://developers.openai.com/codex/permissions) to grant exact instruction-file exceptions while preserving git protection. Claude uses file-specific Edit rules and non-interactive permissions. Custom commands must honor the supplied file scope and keep git operations disabled.

## Local command edits

Local checks run in order on the evolving tree. After each command, deslop commits all of its nonignored edits as `deslop: <command>`; each command has its own commit. When any command changes files, deslop runs the sequence once more as the proof pass. That pass decides the verdict by exit codes and commits its own edits the same way. Commands that still edit files in the proof pass are named as unstable in the summary. Deslop never loops until files stop changing or refuses command edits. There is no configuration option for this behavior.

## Developing deslop

Run `npm ci`, `npm run lint`, `npm run typecheck` and `npm test`. `npm run lint:fix` applies safe layout fixes. Source and tests are TypeScript that Node runs directly, so they use only erasable syntax and `.ts` import paths. The installed command and the fallback lint worker start from JavaScript entries in `bin/` that load the TypeScript through jiti (see [the spec](docs/spec.md#lint-and-type-checking)). The configured deslop commands and CI run lint, type checking and tests on Node 22.18 and 24.

`node --test tests/release.test.ts` runs the workflow's publish script against a temporary bare Git repository. It verifies consecutive versions, numeric tag ordering and prerelease exclusion, then installs the `v0.1.1` pin and checks `deslop --version`. GitHub and curl use local stand-ins. npm resolves package dependencies through the registry using a temporary cache.

Contributor reviews follow [the repository skill](.agents/skills/review/SKILL.md) and the three
shipped skills. CodeRabbit is an on-demand challenger requested by Hydra; automatic reviews are off.

## Supported environment

Deslop supports macOS and Linux with github.com. Windows and GitHub Enterprise are outside the
supported environment.

## Security

Run deslop only on repositories you trust. It executes the repository's configured commands, ESLint
configuration and tooling with your user account, just like running that repository's test suite.
The editor's tool restrictions do not sandbox verification commands or edited execution policy.
