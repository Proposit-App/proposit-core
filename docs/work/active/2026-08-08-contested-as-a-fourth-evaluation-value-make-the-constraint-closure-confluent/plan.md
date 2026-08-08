# Plan — Contested as a fourth evaluation value; a confluent closure

Reads with `spec.md` beside it; `D<n>` below are its design sections.

**Branch.** `contested-value-belnap-closure`, cut from `main`. Not `main`.

**Blockers.** None.

**Version.** Stays `4.0.0` — unreleased. No `pnpm version`, no new tag; the
existing `docs/release-notes/v4.0.0.md` and `docs/changelogs/v4.0.0.md` absorb
this work (T10).

**Test conventions** (`AGENTS.md` → Testing). Under `test/`, fixtures built
inline, no shared `beforeEach`. New suites go in `test/evaluation/`, beside the
existing `facts.test.ts` / `provenance.test.ts` / `satisfiability.test.ts`.
Test titles state behaviour — no criterion codes, no slice/phase labels, no
`docs/work/**` paths. Same rule for every comment and CLI string this work
touches.

**Ordering principle.** The value type lands first because every later task
types against it; the operator tables land second because the closure and both
engines call them; the closure lands third. The three independent defects
(T7–T9) are last and could ship in any order — they are grouped after the big
change so a bisect separates "the closure changed" from "these three were
wrong".

**Failing test first** on every task that changes behaviour, per `AGENTS.md`.

---

## Code tasks

### T1 — The value type

`src/lib/types/evaluation.ts`.

- Add `CONTESTED`, `TCoreContestedValue`, `TCoreQuadrivalentValue`,
  `TCoreResolvedVariableValues`, `TCoreResolvedAssignment`, `isContested`
  (D1). `TCoreTrivalentValue`, `TCoreVariableAssignment` and
  `TCoreExpressionAssignment` are **not** touched.
- Widen the read-side fields listed under "Downstream API delta" in the spec:
  `TCoreDirectionalVacuity` (all), `TCorePremiseInferenceDiagnostic` (both
  arms), `TCorePremiseEvaluationResult` (`rootValue`, `expressionValues`,
  `variableValues`), `TCoreArgumentEvaluationResult` (`assignment`,
  `isAdmissibleAssignment`, `survivingSupportingPremisesTrue`,
  `conclusionTrue`, `premisesHoldConclusionFalse`,
  `propagatedVariableValues`), `TCoreVariableProvenance.value`,
  `TCoreCounterexample.assignment`.
- `TCoreValueOrigin` gains `"contested"`; `TCoreVariableProvenance` gains
  `contestedBy?: TCoreDerivationStep[]` with the doc rule from D6.
- `TCoreArgumentEvaluationOptions.premiseSetSatisfiable` stays
  `TCoreTrivalentValue` (D5).
- Export the new names from `src/lib/index.ts` — note `export * from
  "./types/evaluation.js"` already covers types, so only the `CONTESTED` value
  and `isContested` function need adding if the barrel does not re-export
  values from that module.

**Test.** `test/evaluation/contested-value.test.ts`, a compile-time test:
`// @ts-expect-error` on `{ variables: { v1: CONTESTED } } satisfies
TCoreExpressionAssignment`, plus a positive case showing the same literal is
accepted by `TCoreResolvedAssignment`. Fails before the types exist, and
`@ts-expect-error` fails loudly if the restriction is ever relaxed (AC-4).

### T2 — Belnap operator tables

Rename `src/lib/core/evaluation/kleene.ts` → `belnap.ts`; rename the five
functions `kleene*` → `belnap*` (`git mv`, then update the four importers:
`argument-evaluation.ts`, `premise-engine.ts`, `validation.ts`,
`test/core.test.ts`).

Implement on the two-bit encoding from D2 — `not` swaps, `and`/`or` are bitwise
on components, `implies`/`iff` compose. Roughly 30 lines total; no per-operator
lookup tables.

**Test (first).** `test/evaluation/operator-tables.test.ts` — the D2 tables
written out literally: 4 unary cases and 4×4 per binary operator, `it.each`-style
over an explicit table so a wrong cell names itself (AC-3). The three-valued
sub-block of each table must match what `test/core.test.ts` already asserts;
those existing cases stay where they are as a regression on the sublattice
(AC-9).

### T3 — The confluent closure

`src/lib/core/evaluation/argument-evaluation.ts`,
`closeUnderAcceptedOperators`.

**Test (first).** `test/evaluation/confluence.test.ts`:

- the reported repro (conclusion `X`; supporting `A → X`, `X → F`; reader
  asserts `A = true`, `F = false`, accepts both roots), built 300 times with
  freshly randomised UUIDs via the engine's injected `generateId`; assert
  `conclusionTrue === CONTESTED` on every run and `variableProvenance`
  deep-equal across all 300 (AC-1);
- the same argument with premises added in reverse order, asserted equal to the
  forward build (AC-2);
- `A = true` asserted, accepted `¬A` ⇒ `A` is `contested` with `origin:
  "contested"` and the `not` expression in `contestedBy` (AC-5).

**Changes.**

- Replace `trySetChild` with a `joinChild(child, value, step)` that joins the
  leaf variable's value with `value` under `⊕`, records the step (always, keyed
  `(expressionId, value)`, overwriting — D4), and returns whether any component
  bit changed. Delete the `userAssigned` immunity and the "already has a value"
  early return; `userAssigned` survives only as the provenance marker for
  `origin: "asserted"`.
- Rewrite the five rule bodies to D3's monotone guards. `or` loses the
  "exactly one child still `null`" scan in favour of "every other child has the
  `f` component"; `implies`/`iff` swap `=== true` / `=== false` /
  `!== null` for `T?` / `F?`.
- `resolveValue` keeps working unchanged — it is Belnap evaluation over the
  current state, and T2 widened the operators under it.
- Provenance assembly: origin is `"contested"` whenever the final value is
  `CONTESTED`, else the existing asserted/derived/unassigned rule; `derivedBy`
  only for `"derived"`; `contestedBy` sorted by
  `(premiseId, expressionId, value)` for `"contested"` (D6).
- Rewrite the "least fixed point" paragraph in the function's doc comment to
  the confluence property that actually holds (D10) — no planning language, and
  the sentence attribution depends on stays.
- Rename `evaluateSubtreeKleene` → `evaluateSubtree` and fix its one caller in
  `argument-engine.ts`.

**Watch.** `propagateOperatorConstraints` returns `.variables`; its declared
return type becomes `TCoreResolvedVariableValues` while its *parameter* stays
`TCoreExpressionAssignment`.

### T4 — Thread the resolved assignment through evaluation

`evaluateArgument` builds `propagatedAssignment` from the closure and feeds it
to `PremiseEngine.evaluate` and `createPremiseBoundResolver`.

- `PremiseEngine.evaluate`'s parameter widens to `TCoreResolvedAssignment`
  (`src/lib/core/premise-engine.ts` and its interface JSDoc in
  `src/lib/core/interfaces/premise-engine.interfaces.ts`); the local
  `TCoreTrivalentValue` annotations inside it become
  `TCoreQuadrivalentValue`; `TEvaluablePremise.evaluate` in
  `argument-evaluation.ts` matches.
- `createPremiseBoundResolver` (`premise-resolver.ts`) — its resolver returns
  `boolean | null` today; widen to `TCoreQuadrivalentValue` and follow the
  `options.resolver` type in `PremiseEngine.evaluate`.
- The `?? null` coercions around `rootValue` stay correct as-is.

**Test.** Covered by T3's suite end to end (`conclusionTrue` only reaches
`CONTESTED` if the value survives the whole path) plus the existing suites.

### T5 — CLI and diagnostics render four values

`src/cli/commands/graph.ts`: `truthColor` / `truthFillColor` / the `tri` helper
take `TCoreQuadrivalentValue` and get a `contested` branch (distinct colour,
not the unknown grey — D-delta "UI guidance"). `src/cli/commands/analysis.ts`
prints the value as-is, so only the label changes (T8).

**Test.** `scripts/smoke-test.sh` already exercises `analysis evaluate` and
`graph`; extend only if a new flag appears — it does not.

### T6 — Documentation of the model

- `docs/api-reference.md`: the four values, the D2 tables, the propagation
  rules, the confluence statement replacing the "least fixed point" claim
  (D10), and the widened field types.
- `AGENTS.md`: rewrite the trailing clause of the "An operator decision is
  never a truth value" invariant (D10). Add no new invariant bullet unless the
  join rule proves to need one — it does: a one-line bullet that propagation
  joins rather than overwrites, and that a reader assertion can therefore come
  back `contested`.
- `README.md` "Invalid Constructions" is untouched — no validation rule,
  error code or operator constraint changes.

### T7 — `evaluate` unions `forcedTrueVariableIds`

**Test (first).** `test/evaluation/facts.test.ts`: an argument with an
axiomatic-bound variable, evaluated once with `{}` and once with
`{ forcedTrueVariableIds: new Set() }`; assert equal `premiseSetSatisfiable`
and that the axiom is not `assertedByReader` (AC-6).

**Change.** `argument-engine.ts` `evaluate` — union the caller's set with
`getAxiomaticBoundVariableIds()`, mirroring `checkValidity` (D9).

### T8 — `premisesHoldConclusionFalse` vacuity + CLI label

**Test (first).** `test/evaluation/facts.test.ts`: strike the only supporting
premise ⇒ `premisesHoldConclusionFalse === null`; an argument with zero
supporting premises and a false conclusion ⇒ still `true` (AC-7). The second
half is the boundary that stops the guard from breaking
`checkArgumentValidity`.

**Change.** Guard in `evaluateArgument` (D7), the doc-comment vacuity note in
`types/evaluation.ts`, and the label
`premises hold, conclusion does not follow` → `premises hold, conclusion false`
in `src/cli/commands/analysis.ts` and `src/cli/commands/graph.ts`.

### T9 — `isPremiseSetSatisfiable`: unsatisfiable ≠ unevaluable

**Test (first).** `test/evaluation/satisfiability.test.ts`, driving the
standalone function with a stub premise whose `rootValue` is `null` on every
row ⇒ `null`, not `false` (AC-8). The function is exported from
`src/lib/index.ts`, so the test needs no engine.

**Change.** `satisfiability.ts` — track row determinacy per D8 and return
`null` when no row was all-true and some row was indeterminate.

### T10 — Version docs

Fold into `docs/release-notes/v4.0.0.md` (plain language: the fourth value, what
a reader sees, that their assignments still only have three states) and
`docs/changelogs/v4.0.0.md` (the API delta table from the spec, verbatim enough
that the consumer repos can plan from it). No version bump, no tag.

---

## Verification

- `pnpm -C . run check` green (AC-10) — typecheck, lint, test, build.
- `bash scripts/smoke-test.sh` after the build, for the CLI label and the
  `contested` rendering.
- Spot-check that no shipped string, comment or test title carries planning
  language.

## Out of scope

- `@proposit/shared`, server and mobile changes. This node publishes the delta;
  the consumers plan their own work from the spec's delta section.
- A SAT solver for `isPremiseSetSatisfiable`. The truth-table walk and its
  ceiling stay as they are; only the `false`-vs-`null` answer changes.
- Any new reader-facing assignment state. Readers still assign three values.
