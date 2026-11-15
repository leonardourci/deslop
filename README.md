# deslop

Deslop reviews committed work, fixes it, runs its checks and marks the final commit. It works before a pull request or push exists. A fresh agent sees the branch diff without check results and edits files; deslop owns every commit, push, check and marker.

Requires Node 22.13+, Git and a signed-in Codex, Claude or configured custom agent. GitHub checks/statuses also need the signed-in `gh` CLI. Install from GitHub:

```sh
npm install -g github:leonardourci/deslop
deslop init --command tests="npm test" --check "Tests"
# Commit your config and work, then:
deslop
```

For a pinned per-repository install, use `npm install --save-dev github:leonardourci/deslop#<commit>` and run `npx deslop`. Apache-2.0 licensed.

## Commands

- `deslop run` (or bare `deslop`): fresh review and fixes, checks, bounded check fixes, then proof. Dirty work stops with `commit or stash your changes first`.
- `deslop init`: write repo config. `--command name="shell command"` and `--check "CI name"` are repeatable. `--config file` imports an existing config. Missing required values prompt in a terminal and name the missing flag otherwise. No workflow is installed.
- `deslop status`: read the current commit's git note. `--publish` publishes its GitHub commit status if that final commit is pushed.
- `deslop shape`: print a small example of the run JSON and identify fields that may be long.

The base is `--base`, the open PR's base, origin's default branch, or local main/master, in that order. Default-branch runs are refused. Local unpushed branches run commands without a PR. If the starting commit is pushed and selected kinds need CI, deslop pushes only its own fixes to the same branch and waits for those exact-head checks. `--local` forces local commands and keeps fixes local. Missing checks end red after the appearance limit. Skipped, neutral, cancelled, approval-required and stale checks end red without an agent fix call. CI polling retries transient API errors; an unreachable GitHub ends red with a `--local` hint. Deslop never merges or pushes to the default branch.

Only failing, errored or timed-out checks resume the same Codex or Claude session by id, with short failure excerpts. Deslop commits its fixes and reruns checks up to `checkFixAttempts` times (default 1, 0 returns failures immediately). A custom provider without resume support receives a fresh call with a note of earlier changes. Neither AGENTS.md nor CLAUDE.md loads implicitly; set an `instructions` entry to AGENTS.md to use it. Agents can read/edit files, with git tools denied; unexpected git-state changes stop the run. Commit messages are `deslop: fix review findings` or `deslop: fix failing checks`, as the configured user, with no attribution footer.

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
      "instructions": ["writing"]
    },
    {
      "name": "code",
      "match": ["**"],
      "commands": ["lint", "tests"],
      "checks": ["Tests"]
    }
  ],
  "checkFixAttempts": 1,
  "instructions": { "code": ".agents/skills/review/SKILL.md" },
  "reviewerModels": {
    "codex": { "model": "<gpt-model>", "effort": "high" },
    "claude": { "model": "<claude-model>", "effort": "high" }
  }
}
```

Each changed path uses its first matching kind; the run unions commands, checks and instructions. Renames count both paths. Unmatched paths, missing instruction files and unknown commands stop the run. Built-in instructions cover code review, test audit and plain writing; `instructions` replaces named defaults with files, and kinds can choose an instruction list. An omitted list uses all built-in defaults.

Machine preferences live in `$XDG_CONFIG_HOME/deslop/settings.json`, normally `~/.config/deslop/settings.json`. `reviewer` is one provider or an ordered fallback list; otherwise deslop detects the calling agent, including hosted Codex. `--reviewer` overrides it. Model/effort precedence is CLI (`--reviewer-model`, `--reviewer-effort`), machine `reviewerModels`, repo `reviewerModels`, provider default. CLI overrides apply to the primary provider; fallback providers use their own settings.

Custom providers use `reviewers.<name>.command` as an argv array, receiving the prompt on stdin and returning JSON `{ "items": [{ "id": "R1", "where": "file:line", "problem": "description", "fixed": true }], "sessionId": "optional" }`. An optional `resume` argv array substitutes `{sessionId}`. Custom commands must restrict themselves to file editing; deslop refuses unexpected git-state changes.

## Output and proof

A short summary lists the verdict, each check, findings/fixes and commits, with a path to `.deslop/runs/<id>/run.json`. This folder is git-ignored. JSON includes `left` paths after failures, separate `checkFixes` by turn, workflow edits, and checks with `name`, `ok`, `log` and `failures`, review counts/items, and commits. Failure excerpts have at most 20 lines; full output stays in separate logs and can be large. Use `deslop shape` before reading a large run file.

Green checks and completed fixes add a git note under `refs/notes/deslop` to the final exact commit. The GitHub commit status is named `deslop` and is published only once that commit is pushed. A new commit has no proof until it passes its own run. This is an honesty record, not a signature. Failed runs have no new marker.

See [the contract](docs/spec.md).

A GitHub outage does not block local proof. Passed checks keep their git note if status publication fails; retry `deslop status --publish` after a push or when GitHub recovers. A rerun preserves existing proof until a red review or check verdict removes the note and attempts to publish failure together. No pending status is posted.

Check-fix edits to config or instruction files end red and remain available for inspection. Workflow edits are named in the summary. A fix call that changes nothing ends red without repeating the checks. Each command and agent call has a bounded runtime. Additional file contents in prompts are capped per file and per run; larger files are listed by size alongside the branch diff.

## Editing scope

Tracked instruction prose such as `.agents/`, `.claude/`, `AGENTS.md` and `skills/` can be edited when it is in the reviewed diff. Other instruction files, existing untracked files and ignored paths stay outside the editing scope; git metadata and git commands remain denied. New normal source and test files can be created and are included in deslop's commit and `run.json` under `newFiles`. A dirty checkout is refused before the agent runs.

Codex uses a current CLI with [permission-profile support](https://developers.openai.com/codex/permissions) to grant exact instruction-file exceptions while preserving git protection. Claude uses file-specific Edit rules and non-interactive permissions. Custom commands must honor the supplied file scope and keep git operations disabled.
