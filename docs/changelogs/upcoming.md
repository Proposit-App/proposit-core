# Upcoming

## Fixed

### Evaluation gives the citation when asking whether the premises can hold

Commits `825fec8..6593eb1`.

`ArgumentEngine.evaluate` built its forced-true set from
`getAxiomaticBoundVariableIds()` while `checkValidity` used
`getGroundedBoundVariableIds()`. Both feed the same `isPremiseSetSatisfiable`,
so one premise set could be satisfiable when evaluation asked and contradictory
when validity asked — on any argument holding only while a cited claim is false.

**Not fixed by widening the existing option.** `options.forcedTrueVariableIds`
is read at three places in `evaluateArgument`: the satisfiability call
(`:660`), `isReaderAsserted` (`:750`), and `conclusionClaimVariableIds`
(`:780`). The second drives `assertedByReader` and which claims get a
`claimAttribution` entry; the third decides what enters the
reached-without-assertion counterfactual. Putting citations in that set gives
the right satisfiability answer and two wrong attribution ones — the reader
loses credit for a cited claim they asserted, and `reachedWithoutAssertion`
inverts, so the argument reports reaching its conclusion on its own merits using
a value the reader supplied.

`TCoreArgumentEvaluationOptions` therefore gains
`satisfiabilityForcedTrueVariableIds`, defaulting to `forcedTrueVariableIds` and
read only at `:660`. `ArgumentEngine.evaluate` passes the grounded set there and
keeps the axiomatic-only set for the other two. `checkValidity` passes only
`forcedTrueVariableIds` and is unchanged — the coupling is harmless there
because its rows are generated assignments with no reader behind them.

`test/evaluation/citation-satisfiability.test.ts` (8 tests). The naive widening
was implemented and run against the full suite to check the pins discriminate:
it passed all 2431 tests on the first attempt, because the attribution pin was
asserting on `variableProvenance` — a different mechanism. Re-aimed at
`conclusionAttribution`, it fails exactly the two attribution tests and nothing
else.

**Measured on real data** (114 published arguments in a local
`proposit-server` database, this change plus the satisfiability decomposition):
`premiseSetSatisfiable` moved `null` 16 → 3 and `true` 94 → 107. The `false`
count stayed at **2**, the same two arguments. Nothing was newly blocked.
