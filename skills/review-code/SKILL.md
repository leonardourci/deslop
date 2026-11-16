---
name: review-code
description: Review changed code for correctness and bugs across its callers, failure paths and boundaries.
---

# Review code

Trace changed behavior through its callers and dependencies. Check successful calls, empty inputs,
failures, boundaries, concurrent work and permissions where they apply. Follow the data through
validation, persistence and output rather than judging a function in isolation.

Fix concrete defects and explain the input or state that breaks the behavior. Preserve established
contracts unless the requested change alters them. Use the installed version's APIs and existing
project mechanisms. Keep each rule in one place, and prefer a clear implementation over new scaffolding.

Judge tests with audit-tests and readability with kill-ai-slop when those skills are selected.
