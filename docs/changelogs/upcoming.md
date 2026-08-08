# Upcoming

<changes starting-hash="10e8466" ending-hash="TBD">

## Breaking

### Removed

| Symbol                                                        | Replacement                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `gradeEvaluation`                                             | Compose from the result facts. Core ships no label strings.                                                                               |
| `TCoreEvaluationGrade`                                        | —                                                                                                                                         |
| `TCoreEvaluationGrading`                                      | —                                                                                                                                         |
| `TCoreArgumentEvaluationResult.preservesTruthUnderAssignment` | `!premisesHoldConclusionFalse`, if you need the inverse. The old name claimed entailment preservation, which the field never established. |

`src/lib/core/evaluation/grading.ts` is deleted along with its three exports from `src/lib/index.ts`.

### Renamed

| Was                                                       | Is                                |
| --------------------------------------------------------- | --------------------------------- |
| `TCoreArgumentEvaluationResult.allSupportingPremisesTrue` | `survivingSupportingPremisesTrue` |
| `TCoreArgumentEvaluationResult.isCounterexample`          | `premisesHoldConclusionFalse`     |

Both are now computed over the **surviving** (non-struck) set. The first rename is load-bearing: the old name invited a consumer to read "all premises true" as "the argument worked", which is false whenever every supporting premise has been struck and the conjunction is vacuously `true`.

`TCoreCounterexample` and `checkValidity` keep the word `counterexample` — there it denotes a genuine countermodel found by exhaustive search, which `premisesHoldConclusionFalse` does not.

### Changed semantics

`operatorAssignments[id] === "rejected"` no longer forces the expression false.

- `propagateOperatorConstraints` — the whole rejection branch is deleted, along with the two-phase (rejections-then-acceptances) loop and `trySetChild`'s "false overrides propagated true" override. One pass over accepted operators remains. Closure now only ever fills `null`s, so it is monotone and its result is the least fixed point of its seed.
- `PremiseEngine.evaluate` — the short-circuit returning `false` for a rejected expression is deleted, as is the suppression of `inferenceDiagnostic` for a rejected inference root. Operator decisions no longer affect premise-level evaluation at all; a rejected expression evaluates from its children like any other. This was an independent second site, not a consequence of the first.

## Added

### Striking

`evaluateArgument` computes the struck set: any premise carrying a `"rejected"` operator assignment, **excluding** the conclusion premise and any `type: "derivation"` premise. A struck premise is excluded from `propagateOperatorConstraints`' expression index, from the supporting and constraint aggregates, and from the satisfiability search — but is still evaluated and still returned in `supportingPremises` / `constraintPremises`.

- `TCoreArgumentEvaluationResult.struckPremiseIds: string[]`
- `TCoreArgumentEvaluationResult.survivingSupportingPremiseCount: number`
- `TEvaluablePremise.getPremiseType?(): string` — optional; an implementation that omits it is treated as freeform. Implemented on `PremiseEngine` as `getPremiseType()`.
- `TCorePropagationOptions` — `excludedPremiseIds`, `withheldVariableIds`; third parameter of `propagateOperatorConstraints`.

Granularity is fixed at the premise. A premise of the shape `A ∧ (B → C)` asserts `A` outright _and_ embodies a step, so striking it discards both — documented in `docs/api-reference.md` and unreachable in products that keep inference operators at a premise root. A partial strike would leave a hole in a formula and is not offered.

### Attribution

- `TCoreArgumentEvaluationResult.conclusionAttribution: TCoreValueAttribution`
- `TCoreArgumentEvaluationResult.claimAttribution?: Record<string, TCoreValueAttribution>`
- `TCoreValueAttribution` — `{ assertedByReader: boolean; reachedWithoutAssertion: boolean }`

Computed by intervention followed by fresh derivational closure: the reader's assignments are withheld from the seed and closure is recomputed from the remaining inputs — never by deleting a provenance tag from a value already derived. The conclusion withholds every claim-bound variable its premise references and asks whether the root comes back `true`; a per-claim entry withholds one variable and asks whether the **same value** returns.

`claimAttribution` is scoped to reader-asserted claim-bound variables, gated on `includeDiagnostics`, and omitted entirely when no operator is accepted (nothing can derive, so every answer would be `false`).

New option `TCoreArgumentEvaluationOptions.forcedTrueVariableIds` — variables pinned `true` in the satisfiability search and never read back as reader assertions. `ArgumentEngine.evaluate` passes its axiomatic-bound set automatically.

### Provenance

- `TCoreArgumentEvaluationResult.variableProvenance?: Record<string, TCoreVariableProvenance>` — keyed like `propagatedVariableValues`, same `includeDiagnostics` gate.
- `TCoreValueOrigin` — `"asserted" | "derived" | "unassigned"`.
- `TCoreDerivationStep` — `{ expressionId, premiseId, fromVariableIds }`.
- `TCoreVariableProvenance` — `{ value, origin, derivedBy? }`.

One **immediate** step per derived value, recorded where the value is set rather than reconstructed afterwards; walk `fromVariableIds` transitively for a chain. `"asserted"` is reserved for a reader-supplied `true`/`false` — an explicit _unknown_ reads `"unassigned"`.

`closeUnderAcceptedOperators` is exported alongside `propagateOperatorConstraints` and returns `{ variables, provenance }`; the older function is now a thin wrapper over it.

### Premise-set satisfiability

New `src/lib/core/evaluation/satisfiability.ts`, exported from the barrel:

- `isPremiseSetSatisfiable(ctx, { premises, freeVariableIds, forcedTrueVariableIds? })`
- `SATISFIABILITY_VARIABLE_CEILING = 16`
- `TPremiseSetSatisfiabilityInput`
- `TCoreArgumentEvaluationResult.premiseSetSatisfiable: TCoreTrivalentValue`
- `TCoreArgumentEvaluationOptions.premiseSetSatisfiable` — a precomputed answer that skips the search.

Classical satisfiability over the surviving premise set alone, ignoring the reader's assignment entirely — a truth-table walk reusing the lazy premise-bound resolver, no SAT-solver dependency. `null` past the ceiling means "not determined": do not suppress, do not warn. When `false`, propagation is skipped entirely.

`checkArgumentValidity` computes it **once** before its row loop and threads it into every row. Its generated assignments carry no operator decisions, so nothing is struck and the premise set never varies; computing it per row would have made the search 2ⁿ × 2ⁿ. `test/evaluation/satisfiability.test.ts` guards this with a call counter, not a timing budget.

### Internal

`src/lib/core/evaluation/premise-resolver.ts` — `createPremiseBoundResolver(ctx, assignment)`, extracted from `evaluateArgument` so the satisfiability walk and the attribution counterfactual reuse it instead of reimplementing lazy premise-bound resolution.

## CLI

`analysis evaluate` and the `graph --overlay` summary no longer print a grade. Both print the facts: admissibility, surviving support with its count, struck premises, the conclusion's value and attribution, `premisesHoldConclusionFalse`, and satisfiability. The graph overlay's grade-colour map is removed. No label composition in the CLI — that would only become a string table nobody maintains.

## Tests

New `test/evaluation/` — `striking`, `provenance`, `attribution`, `satisfiability`, `facts`, plus a `fixtures.ts` argument builder. Existing premise-level rejection tests in `test/core.test.ts` were rewritten against the new semantics, and `test/default-assignment.test.ts`'s `gradeEvaluation` precedence block was replaced with assertions on the facts.

</changes>
