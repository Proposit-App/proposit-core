# Upcoming

## Changed

### `checkValidity` excludes grounded variables, not just axiomatic ones

Commits `ebf1a23..796f57a`.

`ArgumentEngine.checkValidity` built its carve-out from
`getAxiomaticBoundVariableIds()`, which filters on `claim?.type === "axiomatic"`
alone. A citation-bound variable was therefore `isClaimBound` and nothing else,
so `checkArgumentValidity`'s filter kept it and it became a free column in the
2ⁿ enumeration — while `isGroundedVariable` and the default assignment had
always grouped citation _with_ axiomatic as the types seeded `true`. One engine,
two readings of the same claim type.

`checkValidity` now takes both `excludedVariableIds` and `forcedTrueVariableIds`
from a new `getGroundedBoundVariableIds()`, built on the existing
`isGroundedVariable` predicate. The enumeration filter, the row loop's
forced-true overwrite, and the satisfiability precompute all read those sets
already, so nothing downstream changed. The over-limit message quotes the
reduced count with no edit.

`2^(k - g)` rows instead of `2^(k - a)`; no counterexample can carry a
citation-bound variable set to `false`.

### The evaluate-time pre-pass deliberately keeps the narrow set

`collectAxiomaticBoundVariables` and `applyAxiomaticForcedAssignments` are
untouched, and this is the point rather than an omission. That pre-pass _throws_
`AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` when a caller assigns the variable, so
widening it to the grounded set would make a reader's assignment on any
citation-backed claim throw — a normal action, exercised throughout the review
flow, failing deep inside a consumer.

`test/evaluation/validity-citations.test.ts` (7 tests) covers both halves. The
boundary pins were confirmed to discriminate: widening
`collectAxiomaticBoundVariables` to include `"citation"` fails exactly the
"accepts a caller assignment on a citation-bound variable" test and nothing
else.

## Known gap

`evaluateArgument`'s own `isPremiseSetSatisfiable` call still receives only the
axiomatic set as `forcedTrueVariableIds`, so the engine reads citations two ways
across `checkValidity` and evaluation-time satisfiability. Narrower than the
inconsistency removed here, and filed rather than folded in: pinning citations
true there can only shrink the model set, flipping a premise set that holds only
with a cited claim false from satisfiable to contradictory — which drives the
review's blocked state in the clients and is a product decision, not this
item's.
