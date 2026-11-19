---
name: audit-tests
description: Check changed behavior coverage and test quality without adding duplicate, trivial or implementation-shaped tests.
---

# Audit tests

Map the key behaviors in the diff to the tests that protect them. Check both whether existing tests
are sound and whether an important changed behavior is missing coverage. Follow meaningful new
branches, failure paths and boundaries that a user or caller depends on.

Flag a missing test only for a concrete behavior whose breakage would matter. Add no test when the
type checker already guarantees the property, or for wiring, configuration or framework behavior.
Do not chase coverage numbers, test trivial code or add assertions just because a line changed.
Reading the code and tests is enough to assess the gap; never demand receipts or evidence the tool
cannot produce.

Prefer deleting unnecessary tests and folding overlapping ones to adding more. Fold new coverage
into the existing related test before adding a test or file: a new login field goes in the existing
login-flow test. Add focused coverage only for a real contract, failure path or boundary that is
otherwise unprotected.

Assert behavior through the public surface. Tests should survive renaming constants, functions and
files, or any refactor that preserves behavior.
Remove duplicate, cosmetic and snapshot-only assertions that merely repeat the implementation. Do not
pin private helper calls, incidental ordering or call counts unless that is the contract. Keep tests
isolated from real accounts, user homes, shared services and unrelated work.

For a flaky test, find the behavior it guards, then delete it if unnecessary or rewrite it
deterministically. Never use retries, sleeps or longer timeouts to make it pass.
