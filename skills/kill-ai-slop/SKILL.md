---
name: kill-ai-slop
description: Remove AI-sounding prose, em dashes, obvious comments and needless complexity from changed code and text.
---

# Kill AI slop

Slop is complexity the job did not ask for. Remove it while preserving facts, contracts and intended
behavior. Work on the change under review.

## Words and comments

Write for someone who did not see the conversation. Lead with the concrete problem, action or result.
Keep commit and PR text plain. Cut drafting history, assistant chatter, self-praise and recap paragraphs.
Replace filler such as "delve", "leverage", "seamless", "robust", "it is worth noting" and "this PR aims
to" with plain words and specific facts. Add no claim the evidence does not support.

Replace em dashes with the period, comma, colon or parentheses that fits. Remove slogans, invented
labels, needless headings and repeated explanations. Keep lists when they make steps or comparisons
easier to follow.

Delete narrating and obvious comments, step numbers, signature paraphrases and stale claims. Keep a
comment only when it explains a non-obvious constraint, invariant or workaround. Prefer a clearer name
or implementation to an explanation of what the code does.

## Code

Remove dead code and unused scaffolding. Inline one-caller wrappers that only forward arguments or
rename an existing operation. Keep a helper when it names a distinct read, decision or write. Flatten
needless nesting with clear guards, reuse existing code and keep one home for each rule.

Unpack cryptic shorthand into plain named steps when it hides a decision: conditional spreads,
logical assignment, unexplained defaults, bare void promises and promise chains. Keep every arm's
outcome, including defaults for an empty list. Declarative map/filter, independent concurrent awaits
and clear render conditions are useful; do not replace them with loops just to look simpler.

Keep errors visible. Preserve fallback values, ordering, concurrency, retries, cleanup and the message
the caller sees. Do not add an abstraction or dependency just to make a pattern look cleaner.

Use focused checks for changed behavior. A prose-only or behavior-preserving cleanup needs no new test.
