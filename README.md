# deslop

Deslop reviews committed work, fixes it, runs its checks and marks the final commit. It works before a pull request or push exists. A fresh agent sees the branch diff without check results and edits files; deslop owns every commit, push, check and marker.

Requires Node 22.18+, Git and a signed-in Codex, Claude or configured custom agent. GitHub checks/statuses also need the signed-in `gh` CLI. Install from GitHub:

```sh
npm install -g github:leonardourci/deslop
deslop init --command tests="npm test" --check "Tests"
# Commit your config and work, then:
deslop
```

Apache-2.0 licensed.

### Pinned or always latest

- Pinned: `npm install --save-dev github:leonardourci/deslop#<commit>`, then run `npx deslop`. The repo's lockfile keeps that commit until you change it.
- Always latest: run `npx github:leonardourci/deslop` (for example `npx github:leonardourci/deslop clean src`). npx resolves the default branch through git on every run (checked with npm 11) and installs the newest commit when it has moved, so each run pays a git lookup, plus an install after a push.
- Global: re-run `npm install -g github:leonardourci/deslop` to move to the newest commit. Do not use `npm update -g deslop`: it replaces this install with the unrelated `deslop` package on the npm registry.

## Commands

- `deslop run` (or bare `deslop`): fresh review and fixes, checks, bounded check fixes, then proof. Dirty work stops with `commit or stash your changes first`. `--intent file` supplies what was asked.
- `deslop clean <path>...`: review and fix the whole tracked files under the given paths instead of the branch diff, then run the same checks, commits and proof as `run`. It takes the same options as `run` and is refused on the default branch. The prompt lists the file paths and the agent reads each file itself, so file size does not limit the prompt. One PR per folder keeps reviews small, but nothing enforces it.
- `deslop init`: write repo config. `--command name="shell command"` and `--check "CI name"` are repeatable. `--config file` imports an existing config. It also writes `.github/pull_request_template.md` with three short sections (what was asked, including any explicitly requested workaround; what changed; how it was checked) when the repo has no PR template; `--no-pr-template` skips it. The template is optional: `--intent` or any PR description works without it. Missing required values prompt in a terminal and name the missing flag otherwise. No workflow is installed.
- `deslop status`: read the current commit's git note. `--publish` publishes its GitHub commit status if that final commit is pushed.
- `deslop skill copy <name>`: copy a shipped skill to `.agents/skills/<name>/SKILL.md` so the repo can tweak it. It refuses when that file or the matching `.claude/skills/<name>/SKILL.md` already exists.
- `deslop shape`: print a small example of the run record and identify fields that may be long.

The reviewer prompt opens with the intent: the `--intent` file, otherwise the open PR's description fetched through `gh`, capped at 32 KiB. With neither, the prompt says no intent was supplied, so every code smell counts as unasked. The run record's `intent.source` is `file`, `pr` or `none`.

The base is `--base`, the open PR's base, origin's default branch, or local main/master, in that order. Default-branch runs are refused. Local unpushed branches run commands without a PR. If the starting commit is pushed and selected kinds need CI, deslop pushes only its own fixes to the same branch and waits for those exact-head checks. `--local` forces local commands and keeps fixes local; kinds marked `ciRequired` still require CI on the final commit. The CI wait has a 60-minute timeout, with a three-minute appearance limit for missing checks and 15-second polling. Missing checks end red after the appearance limit. Skipped, neutral, cancelled, approval-required and stale checks end red without an agent fix call. CI polling retries transient API errors; an unreachable GitHub ends red with a `--local` hint. Deslop never merges or pushes to the default branch.

Only failing, errored or timed-out checks resume the same Codex or Claude session by id, with short failure excerpts. Deslop commits its fixes and reruns checks up to `checkFixAttempts` times (default 1, 0 returns failures immediately). A custom provider without resume support receives a fresh call with a note of earlier changes. Neither AGENTS.md nor CLAUDE.md loads implicitly; set an `instructions` entry to AGENTS.md to use it. Agents can read/edit files, with git tools denied; unexpected git-state changes stop the run. Agent edits use `deslop: fix review findings` or `deslop: fix failing checks`, as the configured user, with no attribution footer. Check commands use their own command-named commits.

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
  "reviewerModels": {
    "codex": { "model": "<gpt-model>", "effort": "high" },
    "claude": { "model": "<claude-model>", "effort": "high" }
  }
}
```

`publishLocal` defaults to `false`. A kind may set `ciRequired: true` to require all of its named checks in CI, including under `--local` and when local publication is enabled. That kind needs at least one check. Kinds that require CI run local commands first, including on pushed runs; failures resume the agent with trimmed details before any required-CI wait. Required CI starts only after every local command passes; if their final commit is not pushed, deslop ends red with a push-and-rerun hint and posts nothing to GitHub. `--local` never pushes.

Each changed path uses its first matching kind; the run unions commands, checks and instructions. Renames count both paths. Unmatched paths, missing instruction files and unknown commands stop the run. The shipped skills are `review-code`, `kill-ai-slop` and `audit-tests`. Code gets correctness and cleanup review; names, project conventions and data model design are checked where the diff touches them. Cleanup deletes code comments, including exported-function doc comments, except license headers and type annotations read by a type checker. It fixes or removes code-smell workarounds unless the intent supplied with this review explicitly asks for them; product behavior choices are not workarounds. Test diffs or a repository with tests also get the test audit. Docs/prose get writing cleanup. Kinds can select an explicit instruction list. A tracked repo file at `.agents/skills/<name>/SKILL.md` (or `.claude/skills/<name>/SKILL.md`) with a shipped skill's name replaces that skill with no config; `.agents` wins when both exist. `deslop skill copy <name>` starts one from the shipped text. Each skill can also be replaced with a repo file or disabled with `false` in the root `instructions` map. A project that keeps exported-function doc comments can keep its own copy of the cleanup rule. Local overrides win over the `instructions` map, which wins over same-name repo skills, which win over shipped defaults.

Machine preferences live in `$XDG_CONFIG_HOME/deslop/settings.json`, normally `~/.config/deslop/settings.json`. `reviewer` is one provider or an ordered fallback list; otherwise deslop detects the calling agent, including hosted Codex. `--reviewer` overrides it. Model/effort precedence is CLI (`--reviewer-model`, `--reviewer-effort`), machine `reviewerModels`, repo `reviewerModels`, provider default. CLI overrides apply to the primary provider; fallback providers use their own settings.

Custom providers use `reviewers.<name>.command` as an argv array, receiving the prompt on stdin and returning JSON `{ "items": [{ "id": "R1", "where": "file:line", "problem": "description", "fixed": true, "kind": "defect" }], "sessionId": "optional" }`. Every reviewer's items follow the one schema deslop passes to Codex `--output-schema` and Claude `--json-schema`: a nonblank unique `id`, string `where` and `problem` (either may be empty), boolean `fixed` and `kind` of `defect`, `note` or `verification`, and no other fields. An item outside the schema fails the run and names that item. An optional `resume` argv array substitutes `{sessionId}`. Custom commands must restrict themselves to file editing; deslop refuses unexpected git-state changes.

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

A short summary lists the verdict, each check, findings/fixes and commits, with the path to the run record. Every run saves its record as `~/deslop/reviews/<YYYY-MM-DD>-<repo>-PR-<n>.json`, or `<YYYY-MM-DD>-<repo>-<branch>.json` when the branch has no open PR, so past reviews stay queryable. A later run for the same PR or branch on the same day gets a numeric suffix (`-2`, `-3`). `<repo>` is the origin repository name, or the checkout folder without an origin. Check logs and per-turn agent output stay in the git-ignored `.deslop/runs/<id>/` folder, and the record holds their absolute paths. JSON includes `left` paths after failures, separate `checkFixes` by turn, workflow edits, and checks with `name`, `ok`, `log` and `failures`, review counts/items, and commits. Failure excerpts have at most 20 lines; full output stays in separate logs and can be large. Use `deslop shape` before reading a large run record.

Green checks and completed fixes add a git note under `refs/notes/deslop` to the final exact commit. The GitHub commit status is named `deslop` and requires a pushed commit. Local runs keep their proof local by default. `status --publish` checks the selected CI on that exact commit before posting success. Set `publishLocal: true` to allow local checks alone to publish success. A new commit has no proof until it passes its own run. This is an honesty record, not a signature. Failed runs have no new marker.

See [the contract](docs/spec.md).

A GitHub outage does not block local proof. Passed checks keep their git note if status publication fails; retry `deslop status --publish` after a push or when GitHub recovers. A rerun preserves existing proof until a red review or check verdict removes the note and attempts to publish failure together. No pending status is posted.

Check-fix edits to config or instruction files end red and remain available for inspection. Workflow edits are named in the summary. A fix call that changes nothing ends red without repeating the checks. Each local command and agent call has a 15-minute timeout. Additional file contents in prompts are capped per file and per run; larger files are listed by size alongside the branch diff.

## Editing scope

Tracked instruction prose such as `.agents/`, `.claude/`, `AGENTS.md` and `skills/` can be edited when it is in the reviewed diff. Other instruction files, existing untracked files and ignored paths stay outside the editing scope; git metadata and git commands remain denied. New normal source and test files can be created and are included in deslop's commit and the run record under `newFiles`. A dirty checkout is refused before the agent runs.

Codex uses a current CLI with [permission-profile support](https://developers.openai.com/codex/permissions) to grant exact instruction-file exceptions while preserving git protection. Claude uses file-specific Edit rules and non-interactive permissions. Custom commands must honor the supplied file scope and keep git operations disabled.

## Local command edits

Local checks run in order on the evolving tree. After each command, deslop commits all of its nonignored edits as `deslop: <command>`; each command has its own commit. When any command changes files, deslop runs the sequence once more as the proof pass. That pass decides the verdict by exit codes and commits its own edits the same way. Commands that still edit files in the proof pass are named as unstable in the summary. Deslop never loops until files stop changing or refuses command edits. There is no configuration option for this behavior.

## Developing deslop

Run `npm ci`, `npm run lint`, `npm run typecheck` and `npm test`. `npm run lint:fix` applies safe layout fixes. Source and tests are TypeScript that Node runs directly, so they use only erasable syntax and `.ts` import paths. The installed command and the fallback lint worker start from JavaScript entries in `bin/` that load the TypeScript through jiti (see [the spec](docs/spec.md#lint-and-type-checking)). The configured deslop commands and CI run lint, type checking and tests on Node 22.18 and 24.

Contributor reviews follow [the repository skill](.agents/skills/review/SKILL.md) and the three
shipped skills. CodeRabbit is an on-demand challenger requested by Hydra; automatic reviews are off.

## Supported environment

Deslop supports macOS and Linux with github.com. Windows and GitHub Enterprise are outside the
supported environment.

## Security

Run deslop only on repositories you trust. It executes the repository's configured commands, ESLint
configuration and tooling with your user account, just like running that repository's test suite.
The editor's tool restrictions do not sandbox verification commands or edited execution policy.
