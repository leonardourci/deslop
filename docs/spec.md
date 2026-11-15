# Verification contract

Finished work goes through `verify run`, selected steps, one fresh review, an exact-commit marker on the PR, and owner merge. A failed step, an invalid review response or an unresolved finding prevents a new marker.

There are three commands: init, run and status. Init writes repo config and marker check together, or machine config alone. No separate CI setup command exists. Repo config takes precedence. The tool never generates a workflow to run project checks.

Each repository chooses CI or local steps. Existing CI makes CI the initialization default. CI mode only waits for configured GitHub checks on the exact commit. Each change kind lists check names, all reported checks, or none. The marker check is excluded. Local mode runs configured commands. A CI repository can fall back with --local unless its local-run policy refuses it. Local evidence is visibly labeled. There is no per-run switch from local to CI and no option to skip selected requirements.

Each file selects its first matching kind; the change uses the union across files. Missing config references and files fail before execution. Both sides of a rename are classified. Unknown files fail closed.

The machine controls simultaneous local runs. The default is unlimited. With a configured limit, extra runs queue in order across repos; CI waiters consume no local slot.

The review is one fresh, read-only, non-interactive invocation receiving the built-in agnostic prompt, selected repo skills and the branch diff. The first review is full. Follow-ups check the fixes, every newly introduced change and their regressions. Findings have no severity ranking. The working agent fixes all findings. Three non-clean rounds stop. Only a subsequent standalone plain-text owner PR comment `verify restart review: <reason>` starts a new full cycle. Status names the stop, the required comment, and accepted restarts with their authors and reasons. A review cannot be skipped.

Agents may decline findings with visible reasons unless owner-only mode is configured. Owner-only declines require PR comments from authorized owner logins, with no CLI bypass. A user-owned repository defaults to its owner login; organizations require explicit ownerLogins. Accepted declines record authors and reasons.

A one-run reviewer override wins over the machine preference. A machine list falls back to the next unavailable provider. Otherwise the running agent reviews; unknown agents must pass a reviewer. Claude and Codex are built in; other reviewers use a custom command. Model and effort are chosen per provider from a one-run override, machine preference, repository config, or provider defaults.

A marker names exactly one commit, records check execution mode and review result, and replaces self-ticked review boxes. Any subsequent commit makes it stale. The repo workflow reads PR metadata only under pull_request_target and never executes PR code. Machine-only configuration has no merge-blocking workflow; callers use verify status.

CodeRabbit is separate, requested by the owner when wanted. Verification never invokes or waits for it. The owner merges; verification never merges.

Binary changes default to metadata review: path, extension-derived type, byte size and added/changed/removed state. The marker and status say binary files, not content-reviewed. Repositories can set `binary: fail` to reject such changes with an unsupported-evidence error. The PR-body marker is an honesty record, not authenticated attestation.
