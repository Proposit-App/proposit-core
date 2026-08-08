# Plan — Rejection strikes the premise; evaluation emits orthogonal facts

Reads with `spec.md` beside it. Section references below (`Design §n`) are that
spec's.

**Branch.** All work on `feature/rejection-strikes-the-premise`, cut from `main`.
Not on `main` — this is a breaking change to a published library and the consumer
repos stay pinned to `main`'s tarball until the whole initiative lands.

**Blockers.** None. This slice leads the initiative; every dependency runs the
other way (B is blocked by A, in the `proposit-shared` node). Nothing to record
here with `tcw work edit --blocked-by`.

**Ordering principle.** `gradeEvaluation` is deleted **last** among the code
tasks. Every earlier task changes behavior the grade ladder still compiles
against, so the suite stays green throughout; deleting the grade first would
force rewriting `test/default-assignment.test.ts` against facts that do not exist
yet. The riskiest change (satisfiability, T4) lands after the propagator is
already simplified and its tests exist.

**Test conventions** (`AGENTS.md` → Testing). Tests live under `test/`, build
their fixtures inline, share no `beforeEach` state, and a new feature's tests go
in the matching dir — so this slice adds `test/evaluation/` rather than growing
`core.test.ts`. Test titles state the behavior; they carry no criterion codes, no
slice or phase labels, and no work-item paths.

---

## Code tasks

### T1 — Rejection strikes; nothing is asserted

**Changes**

- `src/lib/core/evaluation/argument-evaluation.ts`
  - delete the `"rejected"` branch of `propagateOperatorConstraints`
    (lines 375-441) and the two-phase loop wrapper (line 289) — one pass over
    accepted operators remains;
  - delete `trySetChild`'s "false overrides propagated true" branch
    (lines 278-282), which existed only to let a rejection beat an acceptance and
    is the one thing making closure non-monotone;
  - compute the struck set in `evaluateArgument`: any premise carrying a
    `"rejected"` operator assignment, **excluding** the conclusion premise and
    any `type: "derivation"` premise (Design §1). Emit `struckPremiseIds`;
  - exclude struck premises from `propagateOperatorConstraints`' `exprById` /
    `childrenOf` build (lines 164-177), so no accepted operator inside a struck
    premise propagates;
  - exclude struck premises from the supporting and constraint aggregates;
    rename `allSupportingPremisesTrue` → `survivingSupportingPremisesTrue` and add
    `survivingSupportingPremiseCount`;
  - keep struck premises in the returned `supportingPremises` /
    `constraintPremises` arrays — struck, not deleted.
- `src/lib/core/premise-engine.ts` — delete the rejected short-circuit in
  `evaluate` (lines 1568-1572); re-express the inference-diagnostic suppression
  (line 1665) so it is not keyed on `"rejected"`.
- `src/lib/types/evaluation.ts` — the two renamed/added result fields; JSDoc for
  the `A ∧ (B → C)` engine limitation on the struck-set field.
- `src/lib/core/evaluation/grading.ts` — read the renamed field so it still
  compiles. Deleted in T5.

**Verifies** — new `test/evaluation/striking.test.ts`:

| Test | Criterion |
| --- | --- |
| `it("rejecting an implication assigns nothing to its antecedent or consequent")` — `P → Q`, `P` true, `Q` unassigned, root rejected → `Q` stays `null`, `P` stays `true`, no other variable gains a value | 1 |
| `it("accepting a conditional whose antecedent is a conjunction assigns nothing to the conjuncts")` — `(A ∧ B) → C`, only the root accepted → `A`, `B` stay `null` | 2 |
| `it("leaves an explicitly unknown claim unknown when a premise is rejected")` | 3 (rejection half) |
| `it("never strikes the conclusion premise or a derivation premise")` | Design §1 |
| `it("keeps a struck premise in the reported results")` | Design §1 |

Plus: update every existing assertion that depended on rejection forcing values —
`test/core.test.ts` (`propagateOperatorConstraints` block, ~line 21035) and
`test/default-assignment.test.ts`. Those edits belong in this commit; a task that
leaves the suite red for the next one is two tasks.

### T2 — Per-value provenance

**Changes** — `argument-evaluation.ts`: tag every entry of the propagated map
with `TCoreValueOrigin` and, for derived values, the immediate producing step
(`expressionId`, `premiseId`, `fromVariableIds`), recorded where the value is set
in `trySetChild`. Emit `variableProvenance` alongside `propagatedVariableValues`,
under the same `includeDiagnostics` gate (lines 605-612). New types in
`src/lib/types/evaluation.ts`, exported via the existing
`export * from "./types/evaluation.js"` (`src/lib/index.ts:31`).

**Verifies** — new `test/evaluation/provenance.test.ts`:
`it("names the step that derived a value in a two-link chain")` — `P → Q`,
`Q → R`, both accepted, `P` true → `Q` and `R` are `"derived"`, and `R`'s step
names the second premise's root with `Q` among its inputs;
`it("marks a reader-supplied value as asserted and an untouched one as unassigned")`.

### T3 — Conclusion and per-claim attribution

**Changes** — `argument-evaluation.ts`: a withheld-seed helper that removes the
named variables from the seed and re-runs `propagateOperatorConstraints`
(intervention + fresh closure, never tag deletion). Emit
`conclusionAttribution` — withhold every claim-bound variable the conclusion
premise references, re-close, and test the conclusion root for `true` — and
`claimAttribution`, one entry per **reader-asserted claim-bound variable**, each
asking whether the same value returns. Skip the whole map when no operator is
accepted (nothing can derive). Gated on `includeDiagnostics`.

**Verifies** — new `test/evaluation/attribution.test.ts`:

| Test | Criterion |
| --- | --- |
| `it("reports a conclusion the reader supplied as not reached by the argument")` — water and mammals: conclusion `W`, sole premise `M → W`, `M` and `W` both true, premise accepted → conclusion true, asserted, not reached, nothing struck | 5 |
| `it("reports the conclusion reached when a granted premise supports it and another is struck")` — `A → C` struck, `B → C` accepted with `B` true | 6 |
| `it("reports nothing reached when every supporting premise is struck")` — surviving count `0`, not reached, despite the surviving-conjunction being vacuously true | 4 |
| `it("does not treat mutually supporting premises as an independent derivation")` — `A → B`, `B → A` both accepted, `A` asserted true → withholding `A` re-derives nothing | Design §3 (least fixed point) |
| `it("derives a claim over a reader's explicit unknown when the reader granted the step")` | 3 (acceptance half) |

### T4 — Premise-set satisfiability and derivation suppression

**Changes**

- New `src/lib/core/evaluation/satisfiability.ts`: classical SAT over the
  **surviving** premise set alone, ignoring the reader's assignment. Enumerate the
  same free-variable set `checkArgumentValidity` uses
  (`argument-evaluation.ts:696-722`), axioms pinned `true`, reusing the existing
  lazy premise-bound `resolver` (lines 530-557) rather than reimplementing
  evaluation. Ceiling 16 free variables → `null` ("not determined"). No SAT-solver
  dependency.
- `argument-evaluation.ts`: emit `premiseSetSatisfiable`; when it is `false`, skip
  `propagateOperatorConstraints` entirely so nothing is derived; accept a
  precomputed value as an option and have `checkArgumentValidity` compute it once
  before its row loop (lines 747-801) instead of once per row.

**Verifies** — new `test/evaluation/satisfiability.test.ts`:
`it("derives nothing while the surviving premise set is unsatisfiable")` —
`{A, B, ¬(A ∧ B)}` → unsatisfiable, no `"derived"` provenance;
`it("restores derivation when the contradicting restriction is struck")`;
`it("reports satisfiability as undetermined beyond the variable ceiling")`;
`it("checks validity of a ten-variable argument without recomputing satisfiability per row")`
— the 2ⁿ × 2ⁿ regression guard, asserted by timing budget **and** by a spy/counter
on the satisfiability entry point (a timing-only assertion would pass either way
on a fast machine).

### T5 — Delete the grade; rename the misnamed facts

**Changes**

- Delete `src/lib/core/evaluation/grading.ts` and its exports
  (`src/lib/index.ts:32-36`): `gradeEvaluation`, `TCoreEvaluationGrade`,
  `TCoreEvaluationGrading`.
- `src/lib/types/evaluation.ts` / `argument-evaluation.ts`: rename
  `isCounterexample` → `premisesHoldConclusionFalse` (computed over the surviving
  set) and delete `preservesTruthUnderAssignment`. `TCoreCounterexample` and
  `checkValidity` keep the word `counterexample` — there it is correct.
- `src/cli/commands/analysis.ts` (lines 529, 544) and
  `src/cli/commands/graph.ts` (line 115, colour map 117-121): print the facts as
  facts. No label composition in the CLI — that would be a fourth string table.
- `test/default-assignment.test.ts`: replace the `gradeEvaluation` precedence
  block (lines 481-640) with assertions on the facts.

**Verifies** — new `test/evaluation/facts.test.ts`:
`it("exposes no grade from the library barrel")` — the three symbols are absent
from `src/lib/index.ts`'s exports; `it("reports premises holding while the
conclusion does not follow")` — `P ∨ R`, `P → Q`, conclusion `Q`, with `P` false,
`R` true, `Q` false, nothing struck; `it("reports an inadmissible assignment as a
fact rather than an outcome")`. Then `pnpm run check`.

---

## Documentation Sync

Evaluated against every entry in `AGENTS.md` → Documentation Sync. This is a
breaking public-API change, so most fire. **One block, at the end** — the doc pass
runs once over the finished diff, not interleaved between code tasks.

### Fires

- **D1 — `docs/api-reference.md` [Public-API].** The evaluation surface is
  described in several places (≈ lines 291, 293, 312, 1439, 2351). Do it as one
  pass driven by a grep for `grade`, `isCounterexample`,
  `preservesTruthUnderAssignment`, `allSupportingPremisesTrue`, `inadmissible`,
  not as spot edits — a partial update leaves the reference describing a removed
  enum. Must newly document: the six facts, provenance, attribution and its
  counterfactual, satisfiability + suppression and its ceiling, the striking
  exclusions, and the `A ∧ (B → C)` engine limitation.
- **D2 — `src/lib/core/interfaces/argument-engine.interfaces.ts`
  [Public-Engine-API].** `evaluate`'s JSDoc names `isAdmissibleAssignment` and
  `isCounterexample` (lines 585-600); `checkValidity` (line 620) gains the
  precomputed-satisfiability note.
- **D3 — `src/lib/core/interfaces/premise-engine.interfaces.ts`
  [Public-Engine-API].** `evaluate` (line 422): a rejected expression no longer
  evaluates `false`.
- **D4 — `README.md` [Public-CLI-API].** Line 1266 states a rejected expression
  "will evaluate to `false` and its children are skipped" — now wrong. Also the
  assignment-semantics paragraph (line 545) and the pipeline diagram's
  "rejected expression IDs" node (line 504).
- **D5 — `README.md` "Invalid Constructions" [Validation-Rules].** *Verify, then
  most likely no edit.* No validation rule, thrown error or error code changes,
  and the axiom row (line 905) is untouched. Listed because the trigger names
  "operator constraints", which is ambiguous against
  `propagateOperatorConstraints`; resolve it explicitly rather than by silence.
- **D6 — `CLI_EXAMPLES.md` [Public-CLI-API].** The `set-operator` walkthrough
  (lines 686-693) describes rejection as "relationship doesn't hold" feeding
  normal evaluation.
- **D7 — `scripts/smoke-test.sh` [Public-CLI-API].** Section 9g already rejects an
  operator and re-evaluates (lines 361-364); its expected output changes, and it
  should gain a case where striking a premise leaves the argument reaching its
  conclusion through another.
- **D8 — `AGENTS.md` [Routing].** A genuinely new easy-to-violate invariant — *an
  operator decision is never a truth value; a rejection strikes its whole premise
  from the evaluated set and asserts nothing* — earned by two independent sites
  having encoded the opposite. Add one bullet to the invariants list. No new doc
  route.
- **D9 — `docs/release-notes/upcoming.md` [Public-API].** Plain language, no
  jargon: what a rejection now means, that the single grade is gone and why, and
  that consumers must compose the two assessments.
- **D10 — `docs/changelogs/upcoming.md` [Any-Code-Change].** Technical, grouped,
  with the commit-hash range; every removed and renamed symbol listed explicitly —
  this is the migration note two consumer repos will read.

### Does not fire

`src/lib/core/interfaces/shared.interfaces.ts` (no shared-interface signature
changes) · `library.interfaces.ts` (no library or snapshot signature changes) ·
`src/lib/core/proposit-core.ts`, `argument-library.ts`, `fork-library.ts`,
`fork-namespace.ts` (none expose evaluation) · `examples/arguments/*.yaml`
(no argument-schema change — evaluation results are not persisted).

### Adjacent, not a Documentation Sync entry

- **D11 — taxonomy.** `docs/taxonomy/argument-evaluation` reads *"…to determine
  validity and grade its inferences."* Both words leave the model. Re-word via
  `tcw taxonomy`.

---

## Closeout

- **C1 — full gate.** `pnpm run check`, then `pnpm run build` and
  `bash scripts/smoke-test.sh`.
- **C2 — version.** `pnpm version major` (`3.4.2` → `4.0.0`); rename
  `docs/release-notes/upcoming.md` → `v4.0.0.md` and `docs/changelogs/upcoming.md`
  → `v4.0.0.md`, start fresh `upcoming.md` files; `git tag v4.0.0`.
- **C3 — validation tarball, no publish.** `pnpm run build && pnpm run pack:branch`.
  **Never plain `pnpm pack`** — it names the file by version alone, so two
  branches at the same version overwrite each other in a directory a consumer is
  pinned to. Remove any stray `*.tgz` from the package root afterwards.
- **C4 — stop.** Do not publish to npm. `proposit-server` and `proposit-mobile`
  will be red on the deleted `TCoreEvaluationGrade` — **that is the signal the
  slice worked, not a regression to chase.** The coordinated release happens at
  the workspace root once all five slices are code-complete.

## Verification

What the suite cannot check, to be confirmed by hand before `submit`:

1. **The vocabulary proposals (spec Q1/Q2) are confirmed by the user.** Nothing in
   core's code depends on the words, so implementation can proceed without the
   answer — but the answer must land in the spec before slice B starts, because B
   is where the words get written down.
2. **Struck-premise rendering reads correctly to a consumer.** Core returns struck
   premises in the results with their values intact; only a client can confirm
   that is enough to cross one out and show its objection. Slice C/E.
3. **No shipped string carries planning language.** Grep `src/` and `test/` for
   slice/phase/wave/cycle labels, initiative names and `docs/work` paths before
   the final commit. Mechanical, but nothing in the suite fails on it.
4. **No user-facing string implies an inductively accepted step establishes less
   than an entailment, and no label uses proof language** (initiative criterion
   10). Core ships no labels at all, which is how it satisfies this — worth
   stating explicitly in the outcome so a reviewer does not read the absence as an
   oversight.
5. **Attribution cost on the largest example argument.** Sanity-check
   `examples/arguments/` under `includeDiagnostics: true`; the map is one closure
   per reader-asserted claim, which should be invisible, but it is the one new
   per-call cost.
6. **`tcw work complete` on a `[product]`-tagged item may ask for a
   `capabilities.yaml` sidecar.** This node declares no capabilities
   (`docs/capabilities/` is empty). If the CLI fails closed, the correct answer is
   an empty/declined sidecar, not an invented capability.

## Notes

Deliberately not done, with the reason:

- **No SAT-solver dependency.** Real arguments are small and the repo already owns
  a truth-table walk with a ceiling. Revisit only if the ceiling starts being hit.
- **No special case for `A ∧ (B → C)`.** Striking it discards the independently
  asserted `A`. Unreachable in the product, reachable in the engine, documented in
  D1/T1. A partial strike would put a hole in a formula, which the design forbids.
- **Nested acceptance rules for `and` / `or` / `iff` / `not` are left alone.** The
  accept-side manufacturing is fixed by target selection in slice B, "without any
  semantic change" (design §4); core's obligation is only that a decision on the
  root of `(A ∧ B) → C` assigns nothing to the conjuncts, which T1 pins.
- **`checkValidity` and `TCoreCounterexample` survive.** The design drops the
  entailment check as a *reported finding* (slice C), not as an engine capability.
- **`TCoreOperatorAssignment` keeps the member name `"rejected"`.** Only its
  meaning changes. Renaming it to `"struck"` would break the persisted analysis
  schema (`src/lib/schemata/analysis.ts:14`) and slice C's stored reactions for no
  gain.
