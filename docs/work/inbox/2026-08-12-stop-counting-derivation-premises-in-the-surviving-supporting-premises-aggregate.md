---
from: proposit-app
---

# Stop counting derivation premises in the surviving-supporting-premises aggregate

> Escalated by `proposit-shared` on 2026-08-07; routed here by the orchestrator on 2026-08-12. Original entry title: *a derivation premise for a claim no authored premise references is counted in the supporting aggregate*.

Target repo: **`proposit-core`** (evaluation set / `survivingSupportingPremisesTrue`).

Raised while implementing the `proposit-shared` slice of the two-axes epic,
which was asked to narrow the claim queue by reachability. It is **not a
blocker** for that slice; it is why the narrowing was not shipped.

## Problem

A claim that no *authored* premise references, but which carries a citation,
still has an engine-generated derivation premise shaped
`implies(source_var, Q)`. That premise is counted among the surviving supporting
premises, so a reader's answer about a claim the argument never uses moves
`survivingSupportingPremisesTrue`.

## Why it matters

The design (§9) asks the review flow to stop offering a review step for a
proposition that "cannot bear on anything". The reported case — a four-claim
queue against a three-claim text tree — is exactly this shape: the text tree
skips derivation premises, so the reader is asked about a claim they cannot see
anywhere in the argument.

That step **can** bear on the outcome, though, and only because of this defect.
Removing it from the queue while the derivation premise still counts would leave
the premise unresolved and drag the aggregate to unknown for every reader who
would have answered it. So the queue narrowing is blocked on the evaluation-set
question, which only `proposit-core` can answer.

## Root cause (proposed)

The evaluation context filters *naked-Q* derivation premises out of
`listSupportingPremises()`, but keeps citation- and axiom-backed ones. Those are
engine wiring, not authored inferential steps — the same category the review
queues already exclude by `type === "derivation"`. Counting them in an aggregate
about whether the author's premises hold reads a claim about the engine's own
bookkeeping as a claim about the argument.

## Reproduction

`proposit-shared`, `src/engine/review/__tests__/step-queue.test.ts`, the test
*"the step is not inert: answering it moves the supporting aggregate"*, against
the fixture `buildEngineWithDerivationOnlyClaim` in
`src/engine/review/__tests__/fixtures.ts`:

- `implies(A, Q)` authored, conclusion `Q`, plus `cCited` reachable only through
  `implies(source_var, Cited)`.
- Reader answers `A` true, `Q` true, **`Cited` true** →
  `survivingSupportingPremisesTrue === true`.
- Reader answers `A` true, `Q` true, **leaves `Cited` unanswered** →
  `survivingSupportingPremisesTrue === null`.

Only the unreferenced claim's answer differs.

## Also worth recording — the design's stated cause was wrong

The absorbed `proposit-mobile` request and design §9 both state that the queue
walks each premise's *variables* and that a claim-bound variable no expression
references is therefore offered as a step. It is not:
`collectArgumentReferencedClaims` walks each premise's **expression tree** and
records a claim only at a variable expression
(`src/lib/core/review-helpers.ts`). The variable-level narrowing both documents
call for would be a no-op. The DB-level orphan variable the request's SQL finds
is a co-symptom of the same editing history, not the cause — the claim stays
queued through its other, derivation-bound variable.

`proposit-shared` pinned the already-correct behavior with tests and recorded
the rest in the `buildClaimQueue` doc comment.

## Proposed fix

Exclude a derivation premise from the supporting aggregate when the claim it
derives is referenced by no non-derivation premise — or, more simply, exclude
derivation premises from `survivingSupportingPremisesTrue` outright, matching
how the review queues already treat them. Then the claim-queue narrowing in
`proposit-shared` becomes safe and can be done as a follow-up.

## Consumer impact

- **shared** — can then drop derivation-only claims from `buildClaimQueue`,
  closing the reported count mismatch. One doc comment and one test to update.
- **server / mobile** — step counts shrink for the ~9% of argument versions
  measured to contain one. No rendering change either way; both already resolve
  step content from the claim record.

