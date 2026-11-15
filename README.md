# verify

Run the checks a change needs, get a fresh agent review, and record the exact commit on its pull request. Findings return to the agent doing the work. The owner merges.

Requires Node.js 22.13+, Git, the signed-in GitHub CLI, and a reviewer: Codex, Claude Code, or a custom command.

## Install

```sh
npm install -g git+https://github.com/<account>/<repo>.git
```

For a local checkout:

```sh
npm install
npm link
```

## Three commands

```sh
verify init --repo
verify run
verify status
```

`init --repo` writes `verify.config.json` and `.github/workflows/verify.yml` together. The workflow checks the marker; it never checks out or executes pull request code. `init --machine` keeps only the config on your machine, shared across copies of the same remote repository. A repo config wins over a machine config. Existing files are never overwritten. Use `--config <file>` to initialize from a prepared config. To enforce the marker, require the `verify` status check in branch protection. Replace legacy gate names and remove global CI requirements if per-kind selection and accepted local fallback should decide what counts.

Repositories with existing GitHub workflows default to CI mode. Others default to local mode. `init --mode local` or `--mode ci` chooses explicitly. Fill in local step commands before running. The tool creates no workflow to run those steps.

`run` needs a clean, committed, pushed branch with an open pull request. In CI mode it waits for the configured GitHub checks on that head; it runs no local steps. In local mode it runs the configured commands. Both modes then make one fresh, read-only, non-interactive review call. The reviewer receives the branch diff, the built-in review prompt, and selected repository skills. It gets no earlier agent conversation.

```sh
verify run --local
verify run --reviewer codex --reviewer-model <gpt-model> --reviewer-effort high
verify run --reviewer claude --reviewer-model <claude-model> --reviewer-effort high
```

`--local` is the fallback when GitHub CI cannot run. It counts unless the repo refuses it with `localRunCounts: false`. The marker and status always identify it as **ran locally**. There are no `--only` or `--skip` options. A local repo cannot switch to CI for a single run. Refusing local runs with `localRunCounts: false` requires CI mode.

`status` reads the PR marker and exits successfully only when it names the current pushed commit, has passed checks and a clean review, and satisfies the local-run policy. A new commit makes the marker stale, including documentation edits and commits with the same tree. Uncommitted changes also prevent status from reporting the checkout as current. The PR-body marker is an honesty record for one exact commit, not a signature or authenticated attestation.

## Repository config

```json
{
  "mode": "ci",
  "localRunCounts": true,
  "decline": "agent",
  "steps": {
    "lint": "npm run lint",
    "tests": "npm test"
  },
  "kinds": [
    {
      "name": "docs",
      "match": ["docs/**", "**/*.md"],
      "steps": [],
      "checks": [],
      "skills": ["writing"]
    },
    {
      "name": "code",
      "match": ["**"],
      "steps": ["lint", "tests"],
      "checks": ["Tests"],
      "skills": "all"
    }
  ],
  "skills": {
    "review": ".agents/skills/review/SKILL.md",
    "writing": ".agents/skills/writing/SKILL.md"
  },
  "reviewerModels": {
    "codex": { "model": "<gpt-model>", "effort": "high" },
    "claude": { "model": "<claude-model>", "effort": "high" }
  }
}
```

Each changed file uses its first matching kind. A change spanning kinds needs the union of their steps, checks and skills. Put specific matches before a catch-all. Renames count both paths. A file with no matching kind stops verification. Missing skill files and unknown steps or skills fail before any steps run.

Checks can be an array of exact GitHub check names or `"all"`. Empty arrays wait for nothing. `"all"` waits for every reported check except the `verify` marker check and CodeRabbit. Missing checks keep waiting; failures and skipped or neutral checks fail. A wait expires with instructions to resolve CI or run locally. The marker check is never a dependency of itself.

## Binary files

The reviewer receives binary-file metadata beside the text diff: path, extension-derived type, byte size, and whether the file was added, changed or removed. The marker and status label these as **binary files, not content-reviewed**. The reviewer can flag suspicious metadata; it does not inspect binary contents. Set `"binary": "fail"` in repo config to reject any binary change with an unsupported-evidence error instead. The default is `"binary": "metadata"`.

## Machine settings

`$XDG_CONFIG_HOME/verify/settings.json` (normally `~/.config/verify/settings.json`):

```json
{
  "reviewer": ["codex", "claude"],
  "reviewerModels": {
    "codex": { "model": "<gpt-model>", "effort": "high" },
    "claude": { "model": "<claude-model>", "effort": "high" }
  },
  "maxLocalRuns": 2
}
```

All settings are optional. Local runs have no limit by default. Setting `maxLocalRuns` queues extra local runs across repositories; waiting for GitHub takes no slot. Dead processes release their place in the queue.

Reviewer selection: `--reviewer`, then the machine preference, then the running agent. A preference list tries the next provider when a provider cannot run. Invalid review output fails closed. Codex detection uses `CODEX_THREAD_ID` or `CODEX_SESSION_ID`, including hosted sessions. Claude detection uses `CLAUDECODE` or `CLAUDE_CODE_ENTRYPOINT`. When detection fails, pass `--reviewer`. A run without a review cannot pass.

Model and effort selection for each provider: CLI override, machine settings, repo `reviewerModels`, then the provider's own defaults. One-run model and effort flags apply to the primary reviewer; a fallback uses its own saved settings or provider defaults.

## Findings and follow-up

Every finding includes its ID, location, problem and suggested fix, without severities. Fix every finding, commit, push, and run again. Round two checks the fixes, every newly introduced change, and their regressions. Three rounds with findings stop verification. An owner can start a new full cycle with a standalone plain-text comment `verify restart review: <reason>` on the PR. The same owner-login rules apply, and status records who restarted the review and why. Run state stays in the checkout's Git directory.

To decline an incorrect finding with a visible reason:

```sh
verify run --decline "R1: The caller validates this value before invoking the function"
```

With `decline: "owner"`, CLI declines are refused. Only a repository owner's standalone plain-text PR comment counts:

```text
verify decline R1: The caller validates this value before invoking the function
```

For user-owned repositories the owner login is the default. Organization repositories must set `ownerLogins` in repo config. Status shows each accepted decline, its author and reason. Accepted reasons remain in later review prompts and owner restarts; the current owner-only policy still decides which can apply. Comments must follow the finding's report.

## Custom reviewers

```json
{
  "reviewers": {
    "inspector": { "command": ["/path/to/read-only-reviewer", "--json"] }
  }
}
```

Pass `--reviewer inspector`. The command receives the prompt on stdin in an empty temporary working directory and returns the findings JSON described above. It must enforce read-only execution and avoid interactive prompts. Optional `VERIFY_REVIEWER_MODEL` and `VERIFY_REVIEWER_EFFORT` environment variables carry the selected settings. Built-in reviewers disable tools and inherited project integrations; Codex also uses its read-only sandbox.

CodeRabbit stays separate and on request. This tool never requests it or waits for it.

The [specification](docs/spec.md) records the workflow and configuration rules.
