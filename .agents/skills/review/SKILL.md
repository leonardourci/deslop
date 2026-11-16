---
name: review
description: Review contributions to deslop against its behavior contract, JavaScript toolchain and exact-commit proof requirements.
---

# Review a deslop contribution

Read [the contract](../../../docs/spec.md) before reviewing orchestration, configuration, providers,
checks or proof. Preserve its settled choices; update it in the same change when behavior changes.
Do not turn a documented choice into another feature during review.

Use the shipped [review-code](../../../skills/review-code/SKILL.md),
[kill-ai-slop](../../../skills/kill-ai-slop/SKILL.md) and
[audit-tests](../../../skills/audit-tests/SKILL.md) for their concern checklists.

Keep source JavaScript and use JSDoc where the type checker needs it. Follow the development checks
in [the README](../../../README.md#developing-deslop), on the Node versions selected by CI.
Validate the latest commit and keep the PR's description and evidence current after later changes.
Hydra requests the CodeRabbit challenger review; do not request it automatically.
