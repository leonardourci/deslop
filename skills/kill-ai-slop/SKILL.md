---
name: kill-ai-slop
description: Remove AI-sounding prose, code comments, unasked workarounds and needless complexity from changed code and text.
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

Delete code comments by default, including doc comments on exported functions. Keep license
headers and type annotations a type checker reads, such as JSDoc types in JavaScript.

When a deleted comment carried meaning, put that meaning into the code by renaming the function,
constant or variable, or extracting a well-named step. Only when no name can carry it does the reason
go in the PR description, never back into a comment.

Resolve every entry in the supplied comment list: rename or extract to carry its meaning, delete it,
or keep it under the exceptions above or the intentional slop rule below.

## Intentional slop

Keep comments, workarounds and one-off values listed under the intent's "Intentional slop" section,
unless a low-hanging clean alternative removes them. Apply that alternative and say so in findings.
Unlisted items follow the usual rules in this skill.

## Workarounds

Treat code-smell workarounds as defects: lint or type silencing (`eslint-disable`, `@ts-ignore`,
`@ts-expect-error`, `as any`, or a non-null `!` used to silence the checker), empty or swallowing
`catch` blocks, blind retries, sleeps, arbitrary timeouts and special cases hardcoded for one input.
Fix the real cause or remove the workaround, subject to the intentional slop rule above. Put any
reason in the PR description, never a code comment. With no intent supplied, every smell is unasked.
Never judge a product behavior choice as a workaround.

## Code

Remove dead code and unused scaffolding. Inline one-caller wrappers that only forward arguments or
rename an existing operation. Keep a helper when it names a distinct read, decision or write. Flatten
needless nesting with clear guards, reuse existing code and keep one home for each rule.

Unpack cryptic shorthand into plain named steps when it hides a decision: conditional spreads,
logical assignment, unexplained defaults, bare void promises and promise chains. Keep every arm's
outcome, including defaults for an empty list. Declarative map/filter, independent concurrent awaits
and clear render conditions are useful; do not replace them with loops just to look simpler.

Keep errors visible. Outside the defects above, preserve fallback values, ordering, concurrency,
cleanup and the message the caller sees. Do not add an abstraction or dependency just to make a
pattern look cleaner.
