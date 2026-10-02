# Decide whether accepting a non-conditional conclusion root is the reader's assertion

## What was found

Found by the fourth review of `2026-10-02-carry-a-reader-s-agreement-with-a-response-argument-into-the-argument-it-answers`, and reproduced on `feat/response-arguments` at `0e7b6ea3`.

When the conclusion premise's root is `and` or `not`, and the reader accepts that root operator and gives no variable values, evaluation reports the conclusion as reached on the argument's own merits:

- conclusion `and(Q, R)`, one unrelated premise `M → N`, `operatorAssignments: { [conclusionRoot]: "accepted" }`, `variables: {}`: `conclusionTrue: true`, `conclusionAttribution: { assertedByReader: false, reachedWithoutAssertion: true }`;
- the same with conclusion `not(C)`: the same result.
- a freeform supporting premise `Q ∧ R` with its root accepted, conclusion `Q`, no values: also `assertedByReader: false`, `reachedWithoutAssertion: true`. Granting a non-conditional premise's step is itself an unconditional assertion.

An accepted `or` or `xor` conclusion root forces nothing on its own and does not show this (with no values the conclusion is unknown; with Q false it is true and counted as the reader's).

## Why

- Propagation reads an accepted `and` as "every child is true" and an accepted `not` as "the child is false" (`src/lib/core/evaluation/propagation.ts:281-300`). At the conclusion's root that asserts the conclusion itself.
- Attribution counts only variable values as the reader's assertions (`isReaderAsserted`, `src/lib/core/evaluation/argument-evaluation.ts:455-457`).
- The counterfactual withholds the conclusion's claim variables but keeps operator decisions (`:477-500`), so the accepted operator forces them back and the conclusion is still reached.

A conditional root (`P → Q`) does not show this, because the counterfactual withholds P and Q and nothing forces them back.

## What needs deciding

Whether a reader accepting a non-conditional root, of the conclusion or of any freeform premise, has asserted what it forces. Treating a granted step as the argument's merit is intended for conditionals (`M → Q` with M true), and conditional and derivation roots do not show this. If yes, attribution should count it, for example by treating such an acceptance as a reader assertion of the conclusion's variables, or by withholding the decision in the counterfactual. If no, the current report stands and should be documented.

This is blocked on that decision, which is the maintainer's: it changes an evaluation result field for an input expressible today.

## Related

The carrying item avoids the case by not carrying a reinforce of such a root (reason `conclusionStatement`). Deciding this item may let that reinforce be carried later.
