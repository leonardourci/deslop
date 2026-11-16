---
name: audit-tests
description: Check changed behavior coverage and test quality without adding duplicate, trivial or implementation-shaped tests.
---

# Audit tests

Map the key behaviors in the diff to the tests that protect them. Check both whether existing tests
are sound and whether an important changed behavior is missing coverage. Follow meaningful new
branches, failure paths and boundaries that a user or caller depends on.

Flag a missing test only for a concrete behavior whose breakage would matter. Do not chase coverage
numbers, test trivial code or the framework, or add assertions just because a line changed. Reading
the code and tests is enough to assess the gap; never demand receipts or evidence the tool cannot
produce.

Prefer deleting unnecessary tests and folding overlapping ones to adding more. Reuse an existing
behavioral test when it can cover the failure clearly. Add focused coverage for a fix only when it
pins a real contract, failure path or boundary that is otherwise unprotected.

Assert observable results. A test should survive a rename or refactor that preserves behavior.
Remove duplicate, cosmetic and snapshot-only assertions that merely repeat the implementation. Do not
pin private helper calls, incidental ordering or call counts unless that is the contract. Keep tests
isolated from real accounts, user homes, shared services and unrelated work.
