# Outcome — Rejection strikes the premise; evaluation emits orthogonal facts

Branch `feature/rejection-strikes-the-premise`, cut from `main`, merged back
fast-forward. Commit range on `main`: `420b34a..68e32e9`. Version `3.4.2` →
`4.0.0`, tagged `v4.0.0`. Not pushed, not published.

## What shipped, task by task

### T1 + T2 — striking, and per-value provenance — `10e8466`

Shipped as one commit rather than two. The two tasks rewrite the same forty
lines of `trySetChild` and its enclosing loop, so splitting them meant writing
that function twice; the plan's ordering rationale (keep the suite green at
each boundary) is unaffected because both land together.

**Both defect sites are gone.**

- `propagateOperatorConstraints` (`src/lib/core/evaluation/argument-evaluation.ts`):
  the whole rejection branch, the two-phase rejections-then-acceptances loop,
  and `trySetChild`'s "false overrides propagated true" override are deleted.
  One pass over accepted operators remains, and closure now only ever fills
  `null`s — monotone, therefore the least fixed point of its seed. That is a
  structural property of the code now, not an invariant someone has to
  remember, and it is what makes the T3 counterfactual correct.
- `PremiseEngine.evaluate` (`src/lib/core/premise-engine.ts`): the
  short-circuit returning `false` for a rejected expression is deleted.
  Operator decisions no longer affect premise-level evaluation at all. This
  was the site producing the reported `unsound` symptom, and fixing the
  propagator alone would have left it.

`evaluateArgument` computes `struckPremiseIds` — premises carrying a
`"rejected"` assignment, excluding the conclusion premise and any
`type: "derivation"` premise (`TEvaluablePremise.getPremiseType?()`, new,
optional; `PremiseEngine.getPremiseType()` implements it). A struck premise is
excluded from the closure's expression index, from both aggregates, and later
from the satisfiability set — but is still evaluated and still returned.

`propagateOperatorConstraints` gains a third `TCorePropagationOptions`
parameter (`excludedPremiseIds`, `withheldVariableIds`) and becomes a thin
wrapper over the new `closeUnderAcceptedOperators`, which returns
`{ variables, provenance }`. Provenance is recorded where a value is set, not
reconstructed afterwards.

Renames: `allSupportingPremisesTrue` → `survivingSupportingPremisesTrue`,
`isCounterexample` → `premisesHoldConclusionFalse`;
`preservesTruthUnderAssignment` removed. Existing assertions in
`test/core.test.ts` that depended on rejection forcing values were rewritten in
the same commit.

New: `test/evaluation/striking.test.ts` (7 tests),
`test/evaluation/provenance.test.ts` (5), `test/evaluation/fixtures.ts`.

### T3 — conclusion and per-claim attribution — `8882ff3`

Intervention followed by fresh closure: withhold from the seed, recompute from
what is left. The conclusion withholds every claim-bound variable its premise
references and asks whether the root comes back `true`; a per-claim entry
withholds one variable and asks whether the same value returns. Both go through
`closeUnderAcceptedOperators` with `withheldVariableIds`, so no code path
anywhere deletes a tag from an already-derived value.

`claimAttribution` is scoped to reader-asserted claim-bound variables, gated on
`includeDiagnostics`, and skipped entirely when no operator is accepted.

`createPremiseBoundResolver` extracted to
`src/lib/core/evaluation/premise-resolver.ts` so the counterfactual evaluation
and (in T4) the satisfiability walk reuse the lazy resolver instead of
reimplementing it.

New option `forcedTrueVariableIds`, supplied automatically by
`ArgumentEngine.evaluate` from its axiomatic-bound set, so an engine-forced
axiom is never read back as a reader assertion.

New: `test/evaluation/attribution.test.ts` (7 tests).

### T4 — premise-set satisfiability and derivation suppression — `90f6ed1`

New `src/lib/core/evaluation/satisfiability.ts`:
`isPremiseSetSatisfiable(ctx, { premises, freeVariableIds, forcedTrueVariableIds? })`
and `SATISFIABILITY_VARIABLE_CEILING = 16`. Classical SAT over the surviving
set alone, ignoring the reader's assignment; a truth-table walk over the same
free-variable set evaluation uses, reusing the lazy resolver. No SAT-solver
dependency. `null` past the ceiling.

When `false`, every premise is excluded from the closure, so nothing is
derived, `canDerive` is false for attribution too, and provenance shows only
`asserted` / `unassigned`.

`checkArgumentValidity` computes it once before its row loop and threads it
through `options.premiseSetSatisfiable`. The performance trap the spec found is
closed and guarded by a call counter, not a timing budget.

New: `test/evaluation/satisfiability.test.ts` (4 tests).

### T5 — delete the grade, rename the misnamed facts — `09f2561`

`src/lib/core/evaluation/grading.ts` deleted with its three exports.
`analysis evaluate` and the graph overlay print the facts as facts; the
grade-colour map is gone. `test/default-assignment.test.ts`'s precedence block
is replaced by assertions on the facts.

New: `test/evaluation/facts.test.ts` (3 tests).

### Documentation — `76e3e9a`

One pass over the finished diff, after the suite was green. Nine triggers
answered, one verified and skipped:

`docs/api-reference.md` (new *Evaluation facts* section, the striking
exclusions and the `A ∧ (B → C)` limitation, attribution, provenance,
satisfiability, the `checkValidity` precompute note) · both engine interface
JSDoc files · `README.md` (pipeline diagram node, assignment semantics,
evaluation example, `analysis reject`/`evaluate` descriptions) ·
`CLI_EXAMPLES.md` set-operator walkthrough · `scripts/smoke-test.sh` (9g
reworded, new 9g1 showing striking one premise while the argument still reaches
its conclusion through another) · a new `AGENTS.md` invariant ·
`docs/release-notes/upcoming.md` · `docs/changelogs/upcoming.md` · the
`argument-evaluation` taxonomy Feature, re-worded off "validity" and "grade".

**Verified, does not fire:** `README.md` "Invalid Constructions" — no
validation rule, thrown error, error code, operator constraint or cascade
changed. Also confirmed not firing: `shared.interfaces.ts`,
`library.interfaces.ts`, `proposit-core.ts`, `argument-library.ts`,
`fork-library.ts`, `fork-namespace.ts`, `examples/arguments/*.yaml`.

### Closeout — `68e32e9`

`pnpm run check` green; `pnpm run build` + `bash scripts/smoke-test.sh` exit 0.
`pnpm version major` → `4.0.0` (its `preversion` re-ran the full check).
`upcoming.md` files rotated to `v4.0.0.md` on both sides, fresh `upcoming.md`
started, tagged `v4.0.0`. `pnpm run build && pnpm run pack:branch` →
`proposit-proposit-core-4.0.0-feature-rejection-strikes-the-premise.tgz`, the
only `*.tgz` in the package root. Merged to `main` locally. Not pushed, not
published.

## Test result

`pnpm run check` — typecheck, prettier, eslint, **2380 passed / 12 skipped
across 86 files**, build. `bash scripts/smoke-test.sh` — exit 0.

26 new tests across `test/evaluation/`. Acceptance criteria 1–12 all covered by
a named test; the mapping is the plan's, with AC-5 corrected (below). Titles
state behavior and carry no criterion codes, slice labels or work-item paths;
`src/` and `test/` were grepped for planning vocabulary before the final commit
and the only hits are pre-existing numbered algorithm steps that `AGENTS.md`
explicitly preserves.

## What the spec and plan got wrong

All five corrected in place in `spec.md` / `plan.md`, each with the correction
recorded beside the original text.

1. **AC-5 contradicted itself, and it is the criterion that matters most.**
   It set up water-and-mammals with the reader *accepting* the premise and then
   demanded `reachedWithoutAssertion === false`. But an accepted `M → W` with
   `M` true derives `W` by modus ponens, so the counterfactual correctly
   returns `true` — the reader granted the step, and the argument does reach
   the conclusion. The defect AC-5 exists to pin is the *other* case, the one
   the design actually describes: a reader who grants nothing, assigns both
   claims true, and gets `sound` from the old ladder. Shipped with that setup,
   plus a sibling test pinning the accepted-premise variant as *reached*, so
   both readings are held down.
2. **`TCoreClaimAttribution` shipped as `TCoreValueAttribution`**, one
   interface for both `conclusionAttribution` and each `claimAttribution`
   entry. The shapes are identical; only the meaning of
   `reachedWithoutAssertion` differs, and that is stated per field in JSDoc.
   Two names for one shape is drift waiting to happen across four repos.
3. **The `PremiseEngine` diagnostic suppression is deleted, not "re-expressed
   as struck".** `PremiseEngine` is a premise-level API with no knowledge of
   argument-level striking; re-expressing it would mean plumbing a struck flag
   into that API for no behavioral gain. With the short-circuit gone there is
   nothing left to suppress.
4. **`conclusionAttribution` is not gated on `includeDiagnostics`** — the plan
   gated both attribution fields. It is one of the six core facts and the sole
   input to the "reaches its conclusion" reading, so gating it would leave a
   consumer that turns diagnostics off unable to compose the primary label. Its
   cost is one premise evaluation, and the closure behind it is skipped
   whenever no operator is accepted (which is every `checkValidity` row).
   `claimAttribution` and `variableProvenance` stay gated.
5. **The perf guard is the call counter alone, no timing budget.** The counter
   fails deterministically on a regression (1 call versus 1 + 2ⁿ); the plan's
   own parenthesis concedes a timing assertion proves nothing on a fast
   machine, so it would only add flake.
6. **D1's premise was slightly off:** `gradeEvaluation` was never documented in
   `docs/api-reference.md` at all. There was no removed enum to chase out of
   the reference — only rejection semantics to correct and the new facts to
   add. Noted in the plan.

Nothing in the spec proved unworkable, and no scope was added or dropped.

## Notes

- **Q1 and Q2 were confirmed by the user before implementation** and are built
  as the spec records them. Core ships **no label strings at all** — that is
  how it satisfies initiative criterion 10 (no proof language, nothing
  implying an inductively accepted step establishes less than an entailment).
  A reviewer should read that absence as the design, not an oversight.
- **The two consumers are expected to be red** on the deleted
  `TCoreEvaluationGrade`. Not touched, not chased.
- **Attribution cost on real arguments** is invisible: `test/examples.test.ts`
  runs the full example corpus under default options and the suite time is
  unchanged. The map is one closure per reader-asserted claim, skipped
  entirely when no operator is accepted.
- **Struck-premise rendering** still needs a client to confirm (slice C/E).
  Core returns struck premises in `supportingPremises` / `constraintPremises`
  with their values intact and lists them in `struckPremiseIds`; whether that
  is enough to cross one out and show its objection is not something this repo
  can verify.
- **`tcw work submit` / `complete` were not run**, per instruction.
