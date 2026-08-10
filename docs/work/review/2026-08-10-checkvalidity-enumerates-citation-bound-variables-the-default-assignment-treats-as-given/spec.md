# Spec — citations are given in `checkValidity`

## Capability changes

None. `proposit-core` declares no capability ledger (`docs/capabilities/` is
empty; it is a library node with no user-facing surface of its own). The Feature
this touches is `argument-evaluation`; the Vocabulary terms `citation-claim` and
`axiomatic-claim` already exist and need no wording change — this item makes the
engine agree with what they already say.

The consumer-facing consequence is carried by
`proposit-shared/reviews/results/check-every-possible-assignment`, whose wording
("either no failing case exists, or here are the ones that do") stays true. No
ledger write anywhere.

## Problem

Two parts of the engine read a citation claim in opposite ways.

**Grouped as grounded.** `isGroundedVariable`
(`src/lib/core/argument-engine.ts:2911`) returns `true` for a claim-bound
variable whose claim type is `"citation"` **or** `"axiomatic"`, and its doc calls
these "the 'grounded' claim types that a default assignment seeds `true`". The
default assignment honours it twice: the seed at
`argument-engine.ts:2972` (`isGroundedVariable(base) ? true : null`) and the
result at `argument-engine.ts:2978`.

**Split in `checkValidity`.** `checkValidity`
(`argument-engine.ts:2844`) builds its carve-out from
`getAxiomaticBoundVariableIds()` (`argument-engine.ts:2808`), which filters on
`claim?.type === "axiomatic"` alone (`argument-engine.ts:2769`). A
citation-bound variable is therefore `isClaimBound` and nothing else, so the
filter at `src/lib/core/evaluation/argument-evaluation.ts:946` keeps it and it
becomes a free column in the 2ⁿ enumeration
(`argument-evaluation.ts:987`, `totalAssignments = 2 ** checkedVariableIds.length`).

The check consequently searches rows in which a cited source's claim reads
`false`, and can report a failing case that exists only in a world where the
source says the opposite of what it says. Every citation also doubles the search
space, against a ceiling the caller sets at 16.

**The decision, taken 2026-08-10:** a citation is **given**. `checkValidity`
excludes citation-bound variables from the enumeration and pins them true,
exactly as it does axiomatic ones.

## Goals

1. `checkValidity`'s excluded set and forced-true set are the **grounded** set
   (axiomatic ∪ citation), not the axiomatic set.
2. The grouping is stated once and consumed by every site that needs it, so the
   two cannot drift apart again.
3. The asymmetry that remains — evaluation still lets a reader assign a citation,
   validity does not enumerate one — is documented as deliberate, at both sites.

## Non-goals

**`evaluate()` keeps its current treatment of citations, and this is load-bearing
rather than laziness.** `applyAxiomaticForcedAssignments`
(`argument-engine.ts:2782`) does two things to an axiomatic variable: it
*throws* `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` if the caller assigned it, and it
forces it true. Widening that pre-pass to the grounded set would make a reader's
assignment on any citation-backed claim throw — which is a normal thing for a
reader to do and is exercised throughout the review flow. The two questions are
genuinely different:

- `evaluate()` answers *the reader's* question. A citation is seeded true and
  the reader may override it.
- `checkValidity()` answers a *structural* question about the argument, ignoring
  the reader's assignment entirely (it generates its own rows). There, the source
  says what it says.

So the fix must **not** be "widen `collectAxiomaticBoundVariables`". That is the
trap this design exists to avoid.

**The sibling satisfiability site is out of scope, deliberately.**
`evaluateArgument` calls `isPremiseSetSatisfiable`
(`argument-evaluation.ts:637`) with `forcedTrueVariableIds` supplied by
`ArgumentEngine.evaluate` — the axiomatic set. Under the given-reading that call
arguably wants the grounded set too: it asks the same structural "can these
premises all hold at once?" question. It is excluded here because pinning
citations true there can only *shrink* the model set, so a premise set that holds
only with a cited claim false flips from satisfiable to contradictory — and
`premiseSetSatisfiable === false` suppresses derivation
(`argument-evaluation.ts:648`) and drives the review's **blocked** state in the
clients. That is a user-visible product change, not the enumeration question that
was decided, and it deserves its own item and its own decision.

Also out of scope: the ceiling value itself (16), the client-side gate that
misuses it (`proposit-server`'s own item), and any change to the default
assignment.

## Design

**One accessor for the grouping.** `collectAxiomaticBoundVariables` stays exactly
as it is and keeps serving `applyAxiomaticForcedAssignments`. Add a sibling that
collects by the existing `isGroundedVariable` predicate — the same predicate the
default assignment already uses — and expose its ids the way
`getAxiomaticBoundVariableIds` exposes the narrow set. `checkValidity` switches
to it for both `excludedVariableIds` and `forcedTrueVariableIds`; the union with
the caller's own sets is unchanged.

Nothing downstream needs to change. `argument-evaluation.ts:946` already drops
anything in `excludedVariableIds` before it asks about binding, the row loop at
`argument-evaluation.ts:1005` already overwrites every forced id to `true` on
every row, and the satisfiability precompute at `argument-evaluation.ts:975`
already takes both sets from the same variables — so it follows the change for
free, which is the correct behaviour *for the validity path only*.

The over-limit message (`argument-evaluation.ts:965`) reports
`checkedVariableIds.length`, so it starts quoting the reduced count with no edit.

## Acceptance criteria

1. For an argument with a citation-backed supporting claim, `checkValidity`'s
   enumeration does not include that claim's variable: `numAssignmentsChecked`
   for an otherwise identical argument is half what it is when the same claim is
   `normal`.
2. Every generated row assigns a citation-bound variable `true`; no returned
   counterexample contains a citation-bound variable set to `false`.
3. An argument that is valid once citations are given, but has a counterexample
   when they are free, returns `isValid: true` — the case the fix exists for,
   pinned by a test that fails before the change.
4. Axiomatic behaviour is unchanged: still excluded, still forced true.
5. **`evaluate()` still accepts a caller assignment on a citation-bound variable
   and does not throw**, while still throwing
   `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` for an axiomatic one. This criterion is
   what proves the trap in Non-goals was avoided.
6. The default assignment is byte-for-byte unchanged in behaviour: citations
   still seed `true`.
7. An over-limit argument's error message quotes the post-exclusion count.
8. `isGroundedVariable` and `checkValidity` each carry a comment stating why
   validity excludes what evaluation permits.

## Risks

- **Widening the wrong collector** breaks reader assignment on every
  citation-backed claim, and the failure is a thrown invariant deep in the review
  flow rather than a test failure in this repo. Criterion 5 exists solely to
  catch it.
- **Fewer columns can turn a previously-reported counterexample into none.** That
  is the intended effect, but any consumer fixture asserting a counterexample on
  a citation-bound argument will change. The suite is the check; nothing is
  published, so no consumer is exposed until a window opens.
- **The excluded sibling site** leaves the engine still reading citations two ways
  across `checkValidity` and `evaluateArgument`'s satisfiability. That is a known,
  recorded inconsistency after this item — narrower than the one it removes, and
  filed rather than forgotten.

## Notes

Shipping decision, taken with the semantics decision: **land locally, hold the
publish.** Core merges to `main` and tags; consumers stay on npm `4.0.0` until a
window opens for other reasons. Nothing here is reachable by a reader today
anyway — `proposit-server`'s gate disables the exhaustive check on every real
argument.
