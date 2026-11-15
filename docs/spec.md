# Deslop contract

Deslop works on commits, without requiring a push or pull request. A dirty checkout stops with one line: `commit or stash your changes first`. It refuses the default branch. There is one flow, with fixing as its only behavior; there are no modes.

1. A fresh non-interactive agent reviews the branch diff without check results and edits files to fix findings. Only deslop can stage, commit, push or write markers. The agent's tools deny git operations; deslop also rejects unexpected git-state changes. Edits become `deslop: fix review findings` commits as the configured user, with no attribution footer.
2. Deslop runs the selected commands locally. When the original commit is already pushed and selected kinds require CI, it pushes only its own fix commits to that same branch and waits for the named checks on that exact commit. `--local` forces local commands and keeps fix commits local. Missing CI never counts as passed.
3. Failed checks return trimmed failure details to the same agent session, resumed by id. Deslop commits edits as `deslop: fix failing checks` and reruns checks. `checkFixAttempts` defaults to 1; 0 returns failures without another agent call. Exhausting attempts leaves no marker. A custom command without resume support receives a fresh call describing prior changes.
4. Success adds a git note under `refs/notes/deslop` to the final commit. A GitHub status named `deslop` is published only when that final commit is pushed. Markers never describe another commit. Deslop never merges or pushes to the default branch.

Commands: `deslop run` (also bare `deslop`), `deslop init`, `deslop status`, `deslop shape`. Base selection is explicit `--base`, then an open PR's base branch, then origin's default branch, then local main/master. PR lookup is optional; local repositories work without GitHub.

Configuration contains commands, change kinds with command/check/instruction selection, instruction-file overrides, checkFixAttempts, custom provider commands and per-provider model/effort. Repository config wins over machine config. Built-in instructions cover code review, test audit and plain writing. The first matching kind applies per changed path; requirements are unioned across paths, including both sides of renames. Agent selection uses CLI override, then machine preference/list, then the detected caller. Model and effort use CLI override for the primary provider, then machine, then repo, then provider default. Fallback providers use their own settings.

Each run writes git-ignored `.deslop/runs/<id>/run.json`. It contains verdict, checks with name/ok/log/failures, review with found/fixed/items, and commits. Each failure has test, message and an excerpt of at most 20 lines; full output stays in separate log files. The short terminal summary lists checks, findings/fixes, commits, run.json, `deslop shape`, and warns that full logs can be large. Shape prints a small example and identifies fields that may be long.

There are no review rounds, declines, owner restart comments, PR-body markers or marker-check workflows. CodeRabbit remains separate and only on request. Both implementation and migration PRs stay open for owner review and merge.

A GitHub outage does not block local proof. Local runs skip the initial pending-status write. Passed checks keep their git note even if status publication fails; output says the proof is local and the status is not published yet. Retry `deslop status --publish` after a push or when GitHub recovers.

The git-state guard covers this checkout’s HEAD, branch, staged index, config and hooks. Other worktrees may commit to their own branches during a run. Provider tool restrictions still deny git operations; unrelated shared refs do not invalidate this checkout.

Tracked instruction prose in the reviewed diff receives file-level write grants, including protected agent-instruction directories. Existing untracked and ignored paths stay excluded; other instruction files remain read-only. Git metadata and git commands stay denied. New normal source/test files are allowed, committed by deslop, and listed in run.json's newFiles array. Codex uses a scoped permission profile; Claude uses native Edit permission rules. A post-edit scope check refuses instruction changes outside the reviewed diff.
