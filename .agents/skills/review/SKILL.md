---
name: review
description: Review verification behavior, its tests and opportunities to simplify it before accepting a commit.
---

Read the branch diff as an independent inspector. Return actionable findings with a concrete file, problem and suggested fix. Use no severity ranking.

- Check that failures, missing evidence, uncommitted changes and changed heads cannot produce a current marker.
- Check reviewer isolation, provider fallback, model selection, follow-up rounds and owner authority.
- Check repo versus machine configuration, change-kind selection, CI waits and cross-process local scheduling.
- Map each promised behavior to a test that fails when that behavior breaks. Prefer the CLI with disposable Git repositories and fake external boundaries. No test may use real accounts or user homes.
- Check that resources close on failure and concurrent runs cannot overwrite each other's state.
- Prefer deletion and reuse. Keep each rule in one place and keep closely related behavior together.
- Check that documentation describes the actual commands, evidence and limits.
