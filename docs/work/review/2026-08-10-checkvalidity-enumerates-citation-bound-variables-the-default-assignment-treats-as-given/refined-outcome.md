# Refined outcome — accepted

Accepted by the user on 2026-08-10, together with its consumer-side sibling in
`proposit-server`. `ebf1a23..e2c6d7d`, four commits on `main`.

## The decision and what it rested on

All eight acceptance criteria met, `pnpm run check` green at **2408 passed / 12
skipped across 87 files** (baseline 2401). Two pieces of evidence carried more
weight than the count:

**The failing test failed for the right reason.** Running T1 at `ebf1a23` gave
3 failures, all on `expect` rather than on fixture construction — so the pins
were exercising the behavior, not erroring on the way to it.

**The boundary pin discriminates.** Widening `collectAxiomaticBoundVariables` to
include `"citation"` — the plausible wrong fix, and the one the spec was written
to prevent — fails exactly one test ("accepts a caller assignment on a
citation-bound variable") and no others: 1 failed, 6 passed. A pin that would
have caught the wrong fix is worth more than a pin that merely passes, and this
one was checked rather than assumed.

The vacuous fixture caught during implementation is recorded in `outcome.md` and
stands as the item's most useful lesson: a test that passes before the change
reads as coverage and is worse than no test. It was replaced with `(C ∧ A) → Q`,
which has three counterexamples before and one after.

## Closeout choices

**Merge route.** Direct on `main`, no branch, no PR. The change is four commits
in one repo with no consumer coordination — a branch would have bought nothing.
Unpushed and unpublished, per the user's earlier call to land locally and hold
the publish.

**Documentation.** Complete at implementation time: `docs/api-reference.md` (the
paragraph asserting the old behavior is replaced, not amended),
`argument-engine.interfaces.ts` JSDoc, both `upcoming.md` files, and a new
`AGENTS.md` invariant — *"'Grounded' and 'unassignable' are different sets, and
conflating them breaks readers."* That invariant is the durable artifact here;
the code change is small and the trap it avoids is not obvious from reading it.

**Version.** Deferred past this closeout on purpose. Core `4.0.0` is published,
so these commits need a new version — but a second core item
(`2026-08-10-the-satisfiability-walk-pays-2-n-for-variables-that-cannot-interact`)
is being implemented in the same session and touches the same evaluation path.
One cut covering both, once that lands, rather than two versions a day apart.

**Follow-up filed.** The known gap named in `outcome.md` is now
`2026-08-10-evaluation-time-satisfiability-still-reads-citations-as-free-while-checkvalidity-gives-them`
(backlog, `bug`). Its request states the product question the one-line fix
depends on: pinning citations true at `argument-evaluation.ts:637` can flip a
premise set from satisfiable to contradictory, which surfaces to a reader as a
blocked review. What a reader should see when their argument only works if a
cited source is wrong is not a consistency question.

## Capabilities

No ledger write. Core carries no capability ledger of its own
(`docs/capabilities/` is empty), and the reader-facing consequence belongs to
`proposit-shared/reviews/results/check-every-possible-assignment`, reconciled
under the server item.

## What acceptance does not claim

No reader has exercised this through core alone. End-to-end evidence comes from
the server item, whose browser pass ran the exhaustive check on a real argument
for the first time. Accepting this item accepts the engine change and its unit
pins; the reader-visible behavior was verified there, not here.
