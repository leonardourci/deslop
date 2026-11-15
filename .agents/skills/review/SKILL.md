---
name: review
description: Review and fix command orchestration, agent file editing, check recovery and exact-commit proof.
---

Trace success, failure, dirty inputs, git-state protection, provider fallback and session resumption. Fix concrete defects and missing behavioral regression coverage. Read tests and code to judge what breaks. Prefer deletion, shared rules and clear prose. Deslop owns all checks and git operations; edit files only.

Preserve the settled contract in docs/spec.md. Commands and CI waiting are alternatives: CI waiting replaces local commands, never adds them. Retain accumulated requirements across fixes. Agents edit files only; deslop owns checks and git state. Do not turn a documented choice into a new feature during review.
