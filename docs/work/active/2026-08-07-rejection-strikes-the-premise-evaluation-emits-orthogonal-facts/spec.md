# Spec — Rejection strikes the premise; evaluation emits orthogonal facts

Design of record:
`/Users/brian/Projects/Proposit-App/docs/work/active/2026-08-07-review-verdicts-as-two-axes-with-rejection-striking-premises-from-the-record/design.md`.
Where this spec and the design disagree, the design wins; where the design is
illustrative, this spec is normative for `proposit-core`.

## Capability changes

None. `docs/capabilities/` in this node is empty (`tcw capabilities list` returns
nothing) — the library declares no end-user capability, and this slice ships no
user-facing surface. The product-facing labels this slice *fixes the vocabulary
for* are declared by `proposit-server` and `proposit-mobile` in slices C–E.

One taxonomy delta is required (not a capability): the `argument-evaluation`
Feature currently reads *"Evaluating an argument under trivalent truth values to
determine validity and grade its inferences."* Both "validity" and "grade" are
words this slice removes from the model. Re-word during implementation.

## Problem

Three defects, all instances of one mistake: **an operator decision is stored and
evaluated as a truth value.**

1. **Rejection manufactures values.** `propagateOperatorConstraints`
   (`src/lib/core/evaluation/argument-evaluation.ts:375-441`) treats a rejected
   operator as *the expression is false* and back-propagates: rejecting `A → B`
   force-sets `A` true and `B` false (lines 415-423); rejecting `A ∨ B` sets every
   child false (408-413); rejecting `¬A` sets the child true (378-384). Nobody
   asserted any of it.
2. **The same reading is duplicated one layer down.**
   `PremiseEngine.evaluate` short-circuits any rejected expression to `false`
   (`src/lib/core/premise-engine.ts:1568-1572`), so a rejected premise root drags
   `allSupportingPremisesTrue` to `false`
   (`argument-evaluation.ts:579-583`), which `gradeEvaluation` reports as
   **`unsound`** (`src/lib/core/evaluation/grading.ts:48`) — the reading reserved
   for a factually false premise. This is the reported symptom, and it is a second
   site, not a consequence of the first: fixing only the propagator would leave it.
   A partial acknowledgement already exists at `premise-engine.ts:1665`, which
   suppresses the inference diagnostic for a rejected root while still reporting
   the premise false.
3. **Acceptance manufactures values.** An accepted `and` forces every conjunct
   true (`argument-evaluation.ts:313-319`). Reachable today only because the
   consumer fans a premise-scope decision out onto every non-`not` operator; core
   itself has no fan-out (`PremiseEngine.getDecidableOperatorExpressions`,
   `premise-engine.ts:1744-1762`, merely *lists* the candidates).

Downstream of all three, `gradeEvaluation` (`grading.ts:37-80`) collapses six
unrelated questions into one enum under a precedence ladder, and reads
"all supporting premises true + conclusion true" as `sound` without ever asking
where the conclusion's truth came from.

Two structural traps follow from striking:

- `allSupportingPremisesTrue` is a `reduce` seeded `true`
  (`argument-evaluation.ts:579-583`), so an empty surviving supporting set is
  vacuously `true` and today's ladder would read it as `sound`. Striking makes
  that path reachable for the first time.
- `isCounterexample` (`argument-evaluation.ts:586-589`, typed at
  `src/lib/types/evaluation.ts:158`) is named for a countermodel to entailment but
  computes a reader-relative condition. Design §6 is explicit that these are
  different and that the stronger claim is not licensed.

## Goals

1. No truth value ever appears that a person did not put there, except through an
   inference that person explicitly granted.
2. Rejection removes a premise from the evaluated set and asserts nothing.
3. Evaluation emits orthogonal facts; no named-grade enum, no precedence ladder.
4. Conclusion attribution is two facts computed by intervention plus a fresh
   least-fixed-point closure.
5. Every derived value carries the step that produced it.
6. Derivation is suppressed while the surviving premise set is unsatisfiable.
7. Settle the assessment vocabulary and the fate of the six existing grade words,
   so slices B–E inherit one set of words.

## Non-goals

- Predicate calculus and any representation of inductive strength. All acceptances
  keep identical deductive force; do not add a defeasibility flag, and do not
  record the deferral as "the next engine version fixes it".
- Any static entailment check as a *reported* finding. (`checkValidity` itself
  survives as an engine capability — see Design §9.)
- The §6 graph-reachability "can this argument reach its conclusion at all" check.
  Not in the request's scope list and not in the initiative's slice-A boundary;
  file it separately if wanted.
- Computing whether a refusal was load-bearing (the per-refusal counterfactual).
- Scoped assumptions and discharge.
- Review flow, decision-target selection, contradiction prose, the `blocked`
  state, claim-queue narrowing — all slice B and later.
- Publishing. See Design §11.

---

## Open questions settled here — PROPOSALS AWAITING CONFIRMATION

> **These two answers are proposals, not decisions.** They are the highest-value
> output of this stage, they will be inherited by every user-facing string in four
> repos, and they should be confirmed before the plan is executed. Nothing else in
> this spec depends on the exact words — only on the *shape* (two axes, facts not
> a grade enum).

### Q1. The final assessment vocabulary

**First, what is being named.** Core ships **no label strings at all** — that is
the design's whole point (§5: emit facts, compose the label). So this vocabulary
is not a core deliverable; it is a contract recorded here because slice A is the
slice that fixes it, and its natural implementation home is `@proposit/shared`
(slice B), so that four repos share one composer instead of four string tables.

**The two axes.** **Conclusion assessment** and **argument assessment**.

- *Assessment* over *grade*: "grade" implies one winner on one scale, which is the
  thing being deleted. Over *verdict*: juridical, and the existing sidebar
  "verdict" contradicting the inline pill is the reported bug — reusing the word
  would carry the confusion forward. The initiative's acceptance criterion 9
  already says "assessment"; inherit it rather than invent.

**Axis 1 — the conclusion.** Unchanged vocabulary: **True / False / Unknown**.
These are already the three words a reviewer picks from, and a second vocabulary
for the same trichotomy is how the pill/verdict contradiction started.
Attribution renders as two independent statements, never a fused label:

| Fact | Reads as | Negated |
| --- | --- | --- |
| asserted by the reader | "You assigned this." | (absent) |
| reached without that assertion | "The argument reaches it on its own." | "It holds only because you assigned it." |

**Axis 2 — the argument.** One primary value plus a reason, composed:

| Primary | Words |
| --- | --- |
| reached | **Reaches its conclusion** |
| not reached | **Doesn't reach its conclusion** |
| premises conflict | **Its premises contradict each other** |

| Reason (shown with *doesn't reach*) | Words |
| --- | --- |
| conclusion asserted, nothing derived | **the conclusion came from you** |
| something struck | **you rejected part of its reasoning** |
| nothing struck, not enough settled | **not enough was settled** |
| every surviving supporting premise true, conclusion false | **its premises hold and its conclusion doesn't follow** |

Struck premises are a **separate badge** (`"1 premise rejected"`), not part of the
primary value — which is what lets *Reaches its conclusion* + *1 premise rejected*
compose without a seventh enum member, and is the design's §5 row
"reaches its conclusion, with reasoning refused" expressed as two facts.

**Word-by-word reasoning.**

- **"Reaches its conclusion"** over *proves / establishes / demonstrates / valid /
  sound*. *Proved* is barred outright (hard constraint). *Establishes* is an
  ordinary-language synonym for *proves* and smuggles the same overclaim back —
  note that initiative criterion 6 uses "established" as *prose*; it names the
  fact `reachedWithoutAssertion === true`, not the label. *Valid* is a term of art
  we deliberately dropped (design §6). *Supports* understates: a premise supports,
  an argument reaches. *Reach* is spatial, plain, and naturally reader-relative —
  "for you, it reaches" is grammatical; "for you, it is proved" is not.
- **"Doesn't reach its conclusion"** rather than a distinct antonym, so the two
  halves of the binary are visibly one question. Contraction deliberate: these are
  chips, not legal text.
- **Second person throughout** ("you assigned", "you rejected", "the conclusion
  came from you"). Reader-relativity is then carried by grammar rather than by a
  disclaimer nobody reads, which is the cheapest way to satisfy criterion 10.
- **"the conclusion came from you"** rather than *you begged the question* or
  *circular*: it states the fact and allocates no fault, matching the design's
  standing rule that no copy allocates fault (§7).
- **Exactly two terms for the refusal mechanism, not three.** The reader's act
  stays **reject** (the shipped control word, and the reject-reason codes
  `non-sequitur` / `counterexamples-exist` / … only make sense under it). The
  effect on evaluation is **struck** (engine field names and explanatory prose:
  "this premise is struck from the evaluation"). **Drop "refused" entirely** —
  the design uses it illustratively, and three near-synonyms across four repos is
  a guaranteed drift. Exception already recorded as design open question 4:
  restriction premises read as *declined*, never *rejected* or *denied*; that
  exception stands and is slice B/C copy.
- **No new word for "unknown".** *Indeterminate*, *undetermined*, *inconclusive*
  all compete with the reviewer's own **Unknown** button.

### Q2. Where the six existing grade words re-home

Current enum, `src/lib/core/evaluation/grading.ts:7-13`:
`sound | vacuously-true | unsound | counterexample | inadmissible | indeterminate`.

| Word | What it means today | Where it goes |
| --- | --- | --- |
| **`sound`** | admissible **and** all supporting premises true **and** conclusion true (`grading.ts:48-76`) | **Argument axis**, redefined and renamed to **Reaches its conclusion** — gated on *attribution*, which the current condition never asks about (the water-and-mammals bug). **The word disappears** from the API and every user-facing string: classical soundness is *validity + true premises*, and validity is dropped (design §6), so we cannot honestly claim it. It may survive in explanatory documentation *about classical logic*. |
| **`unsound`** | some supporting premise false (`grading.ts:48`) | **Argument axis**, as the plain fact **"a premise you called false"** — fact 5 (`survivingSupportingPremisesTrue === false`). It was never a statement about the conclusion, which is why it sat on the wrong axis. **The word disappears**, for the same reason as `sound`, and because it is the label the reject bug currently produces. |
| **`vacuously-true`** | the *conclusion premise's own* root is an implication true because its antecedent is false (`grading.ts:66-75`, via `TCoreDirectionalVacuity.isVacuouslyTrue`, `src/lib/types/evaluation.ts:68-79`) | **Splits.** The per-premise *diagnostic* survives unchanged where it already lives — it is a true and useful statement about one implication. As an overall grade it **disappears**: design §5 rules that a vacuously-true premise did no work, so nothing was derived through it and the case lands in a *doesn't reach* row by attribution, with no label of its own. |
| **`counterexample`** | admissible + all supporting true + conclusion false (`grading.ts:52`, `argument-evaluation.ts:586-589`) | **Splits, and this is a rename with teeth.** The **word keeps its home** in truth-table validity checking (`TCoreCounterexample`, `src/lib/types/evaluation.ts:195-200`, `checkArgumentValidity`) where it genuinely denotes a countermodel. The **review-time condition** re-homes to the argument axis as **"its premises hold and its conclusion doesn't follow"**, and design §5 is explicit that this is *not* a countermodel — a weaker, reader-relative claim. So `isCounterexample` / `preservesTruthUnderAssignment` on the evaluation result are **misnamed for review use and are renamed** (Design §4). Unaffected: the `counterexamples-exist` reject-reason code in `@proposit/shared`, which is a reader's case-level judgment and genuinely a counterexample to the inference. |
| **`inadmissible`** | some constraint premise evaluates false (`grading.ts:44`, `isAdmissibleAssignment`, `types/evaluation.ts:152`) | **Demoted, word preserved** (design §8). Stops being a grade; `isAdmissibleAssignment` stays as a reported *fact*, and the product treats it as an instance of the coherence gate — it **blocks**, it does not label. The word survives only in alert prose with exactly its existing meaning (*this assignment violates a restriction premise*) and never labels an argument or a conclusion again. Newly reachable consequence: a reader who rejects a restriction premise strikes it, so it stops constraining them — inadmissibility becomes escapable, which it is not today. |
| **`indeterminate`** | the catch-all: evaluation failed, **or** premises not known true, **or** conclusion not true (`grading.ts:40, 62, 79`) | **Splits three ways and the word disappears.** (a) Evaluation failed (`ok === false`) → not an assessment at all; the result already carries `ok` + `validation`, and per design §7's reasoning about `blocked`, "we cannot assess this" must never render as "the argument established nothing". (b) Conclusion value unknown → **conclusion axis: Unknown**. (c) Not derivable, nothing struck → **argument axis: doesn't reach — not enough was settled**. |

Net: **four words are deleted** (`sound`, `unsound`, `indeterminate`, and
`vacuously-true` as a grade), **one is preserved in a narrower home**
(`counterexample`, validity checking only), **one is preserved as prose with its
existing meaning** (`inadmissible`). `TCoreEvaluationGrade`, `TCoreEvaluationGrading`
and `gradeEvaluation` are removed from the public API.

---

## Design

### 1. Striking

A premise is **struck** for an evaluation iff any expression in it carries
`operatorAssignments[expressionId] === "rejected"`, subject to two exclusions:

- The **conclusion premise is never struck**. A rejection recorded against one of
  its operators is ignored for evaluation. Ignored rather than thrown: a stored
  review must keep evaluating, and the omission is observable because the result
  reports `struckPremiseIds`.
- **Derivation premises are never struck** (`type === "derivation"`). Engine
  wiring is not a user-authored inferential step. Note `listSupportingPremises`
  (`src/lib/core/argument-engine.ts:1858-1867`) selects on `isInference()`, which
  is true for derivation premises, so the exclusion must be explicit.

Effect of being struck:

- excluded from `allSupportingPremisesTrue` / `isAdmissibleAssignment` aggregation;
- excluded from `propagateOperatorConstraints` entirely — its expressions are not
  added to `exprById` (`argument-evaluation.ts:164-177`), so no accepted operator
  inside a struck premise propagates;
- excluded from the satisfiability set (Design §5);
- **still evaluated and still returned** in `supportingPremises` /
  `constraintPremises`, so a consumer can render it crossed out. Struck, not
  deleted.

Granularity is fixed at the premise: the operator id is provenance for the
objection and never a different evaluation rule (design §3). Formulas never
contain holes.

**Recorded engine limitation.** A premise of the shape `A ∧ (B → C)` asserts `A`
outright *and* embodies a step; striking it discards both. This is **not
reachable in the product**, which places inference operators at the root of a
premise's tree, but **is reachable in the engine**, which imposes no such
restriction. Document it in `docs/api-reference.md` and in the striking helper's
JSDoc. **Do not build a special case** — a partial strike would put a hole in a
formula, which §3 forbids. (`(A ∧ B) → C` is unaffected: it asserts only the
conditional.)

### 2. Propagation

Delete the rejection branch of `propagateOperatorConstraints`
(`argument-evaluation.ts:375-441`) and with it the two-phase loop
(`line 289`) — one pass over accepted operators remains. Delete the
"false overrides propagated true" branch of `trySetChild`
(`argument-evaluation.ts:278-282`): it exists solely to let a rejection beat an
acceptance, and with rejection gone it is dead code **and** the only thing that
made closure non-monotone. Delete the rejected short-circuit in
`PremiseEngine.evaluate` (`premise-engine.ts:1568-1572`); the diagnostic
suppression at `premise-engine.ts:1665` becomes unnecessary once struck premises
are excluded upstream.

*(Corrected during implementation: the suppression is **deleted**, not
re-expressed as "struck". `PremiseEngine` is a premise-level API with no
knowledge of argument-level striking, so re-expressing it would mean plumbing a
struck flag into that API for no behavioral gain. With the short-circuit gone a
rejected root evaluates normally, so there is nothing left to suppress — the
diagnostic is true and useful either way.)*

With those three deletions closure only ever fills `null`s from a seed, which
makes it monotone and its result **the least fixed point** of that seed. That is
not a nicety — it is condition 2 of the attribution counterfactual (Design §3),
and it is now a structural property of the code rather than an invariant somebody
has to remember.

**Acceptance propagation is otherwise unchanged**, including the rules for `and`,
`or`, `iff` and `not`. Design §4 states the accept-side manufacturing is fixed by
*target selection* — the consumer deciding only the premise's outermost decidable
operator — "without any semantic change". Deleting the nested accept rules is not
asked for and would break `iff` and disjunctive-syllogism propagation that
consumers may drive directly. Core's obligation is only that a decision on the
root of `(A ∧ B) → C` assigns nothing to `A` or `B` — which it already satisfies,
because the `and` is then unassigned and evaluates normally. Pin it with a test
(AC-2); slice B removes the fan-out that makes it false today.

### 3. Attribution

Two facts, computed by **intervention followed by fresh closure**, never by
deleting a provenance tag from an already-derived value:

- `assertedByReader` — the reader supplied `true` or `false`. An explicit
  *unknown* is a decision but not an assertion (design §5), so it does not count.
- `reachedWithoutAssertion` — withhold the reader's own assignments, re-run
  `propagateOperatorConstraints` from the reduced seed, and ask again.

**Conclusion attribution.** Withhold the reader's assignment for *every*
claim-bound variable referenced by the conclusion premise, re-close, and evaluate
the conclusion premise root: `reachedWithoutAssertion` is true iff that root is
`true`. For the ordinary shape — a conclusion premise that is a single bare claim
variable — this reduces exactly to the design's one-variable counterfactual, and
it generalises to a compound conclusion without a special case.

**Per-claim attribution — the design's open question 3: CONFIRMED, extend it.**
Grounds, after reading the code:

- The mechanism is one call. `propagateOperatorConstraints`
  (`argument-evaluation.ts:149-448`) is already a whole-argument fixed-point over
  a seed map, so a withheld-seed re-run is the same function with keys removed. No
  new algorithm.
- Least-fixed-point correctness comes free from §2's deletions, and it is exactly
  what makes the cyclic case right: with `A → B` and `B → A` both accepted and `A`
  asserted true, withholding `A` leaves both antecedents `null`, so nothing
  derives and the cycle does **not** report as an independent derivation.
- Scope it to **reader-asserted claim-bound variables only**. Withholding a
  variable the reader never asserted produces an identical closure, so the entry
  would be meaningless; restricting the map keeps the cost proportional to what
  the reader actually did.
- Honest cost note, against the design's "nearly free": it is *N* extra closures,
  not zero — one per reader-asserted claim-bound variable. Each is small
  (arguments carry single-digit to low-double-digit claims) and the whole map is
  skipped when no operator is accepted, because then nothing can derive. Emit it
  only under `includeDiagnostics` (already the gate for
  `propagatedVariableValues`, `argument-evaluation.ts:605-612`) so the hot path is
  opt-out.
- What it buys: slice B's contradiction alert must name the chain behind a derived
  value, and slices C/E want to mark a claim chip as *derived* rather than
  *yours*. Both need per-claim attribution, and building it later means a second
  breaking change to the same result type.

**Asymmetry, stated deliberately:** the conclusion's `reachedWithoutAssertion`
asks whether the root comes back **true**; an intermediate claim's asks whether it
comes back with **the same value**. The conclusion question is about establishing
it; the intermediate question is about explaining a value already on screen.

### 4. The emitted facts

The six facts of design §5, on `TCoreArgumentEvaluationResult`. Names follow the
repo's `T`-prefixed `PascalCase` / `camelCase` conventions and carry no planning
language:

| Design fact | Field | Type |
| --- | --- | --- |
| Conclusion value | `conclusionTrue` (existing) | `TCoreTrivalentValue` |
| Asserted by the reader | `conclusionAttribution.assertedByReader` | `boolean` |
| Reached with that assertion withheld | `conclusionAttribution.reachedWithoutAssertion` | `boolean` |
| Premises struck | `struckPremiseIds` + `survivingSupportingPremiseCount` | `string[]`, `number` |
| Surviving supporting premises all true | `survivingSupportingPremisesTrue` | `TCoreTrivalentValue` |
| Premise set satisfiable | `premiseSetSatisfiable` | `TCoreTrivalentValue` |

Plus, from §3 and §6: `claimAttribution?: Record<string, TCoreValueAttribution>`
and `variableProvenance?: Record<string, TCoreVariableProvenance>`.

*(Corrected during implementation: shipped as `TCoreValueAttribution`, one
interface used by both `conclusionAttribution` and each `claimAttribution`
entry, rather than a separate `TCoreClaimAttribution`. The two fields have
identical shape; only the meaning of `reachedWithoutAssertion` differs, and
that is stated per field in JSDoc. Two names for one shape is drift waiting to
happen across four repos.)*

Renames and removals (all breaking, all intended):

- `allSupportingPremisesTrue` → `survivingSupportingPremisesTrue`. The rename is
  load-bearing: the old name licenses the empty-conjunction trap by inviting a
  consumer to read "all premises true" as "the argument worked".
- `isCounterexample` → `premisesHoldConclusionFalse`;
  `preservesTruthUnderAssignment` → removed (a negation of the above, and its name
  claims entailment preservation, which is exactly the stronger claim design §6
  forbids). Both computed over the *surviving* set.
- `gradeEvaluation`, `TCoreEvaluationGrade`, `TCoreEvaluationGrading` — deleted,
  along with their exports (`src/lib/index.ts:32-36`).

**The empty-surviving-set guard is structural, not a branch.** `Reaches its
conclusion` is composed from `conclusionAttribution.reachedWithoutAssertion`,
never from `survivingSupportingPremisesTrue`. With every supporting premise
struck nothing propagates, so nothing derives, so `reachedWithoutAssertion` is
`false`. The vacuously-`true` conjunction (`argument-evaluation.ts:579-583`)
therefore cannot reach a positive reading through any composition. It is still
reported honestly, alongside `survivingSupportingPremiseCount === 0`, which is
what lets a consumer say *"everything was rejected"* instead of *"all premises
hold"*.

### 5. Satisfiability and derivation suppression

Classical SAT over the **surviving** premise set alone, **ignoring the reader's
assignment entirely** (design §7). Distinct from the strong-Kleene partial
evaluation the rest of the pipeline does; the two answer different questions.

Implementation: enumerate total assignments over the same free-variable set
`checkArgumentValidity` uses (`argument-evaluation.ts:696-722` — claim-bound and
externally-bound premise variables, axiomatic variables pinned `true`), and ask
whether some row makes every surviving premise root true. Reuse the existing lazy
premise-bound `resolver` (`argument-evaluation.ts:530-557`) rather than
reimplementing evaluation. **No SAT-solver dependency**: real arguments are small,
and a truth-table walk with the ceiling already in the codebase is the cheaper
correct thing.

- Ceiling: at more than 16 free variables, report `premiseSetSatisfiable: null`
  ("not determined"). `null` means *do not suppress and do not warn* — the trivalent
  type already carries the third state, so no new type is needed.
- **When `false`, skip `propagateOperatorConstraints` entirely.** The conclusion
  then reports only what the reader asserted, with no inferential content, and
  `variableProvenance` shows every value as `asserted`. Per-premise evaluation and
  the reader's assignments are still collected and still meaningful.
- **Performance trap to avoid:** `checkArgumentValidity` calls `evaluateArgument`
  once per truth-table row (`argument-evaluation.ts:771-777`). Computing
  satisfiability inside each call makes it 2ⁿ × 2ⁿ. The surviving premise set does
  not vary across rows, so compute it once in `checkArgumentValidity` and thread
  it through as an option.

### 6. Provenance

Every value in the propagated map is tagged with where it came from:

```
type TCoreValueOrigin = "asserted" | "derived" | "unassigned"

interface TCoreDerivationStep {
    expressionId: string   // the granted operator that produced the value
    premiseId: string      // the premise it lives in
    fromVariableIds: string[]  // the values the step consumed
}

interface TCoreVariableProvenance {
    value: TCoreTrivalentValue
    origin: TCoreValueOrigin
    derivedBy?: TCoreDerivationStep  // present iff origin === "derived"
}
```

One immediate step per derived value, recorded where the value is set
(`trySetChild`, `argument-evaluation.ts:266-283`); a consumer walks
`fromVariableIds` transitively to reconstruct the chain design §7 requires
("`P → Q`, `Q → R`, `P` true, `R` false" surfacing at the second premise while its
cause spans both). Storing whole chains per value would duplicate the graph.

**Explicit unknown vs never-asked.** A key present with value `null` is an
explicit *unknown*; an absent key is *no value*. That distinction alone is not
reliable in this codebase — `deriveDefaultAssignment`
(`argument-engine.ts:2934`) returns a key for every variable, most of them
`null`, so key presence already means "the engine defaulted it". Provenance is
what carries the distinction outward: `origin: "unassigned"` for a value nobody
supplied and nothing derived, `"asserted"` only for a reader-supplied `true` or
`false`, `"derived"` for anything closure produced — including a derived value
that overrode an explicit unknown, which design §5 rules is correct and **not** a
collision. Slice B's *skipped* vs *never asked* distinction is review-flow state
and stays in `@proposit/shared`; core's obligation is to never silently present a
derived value as the reader's own, and provenance discharges it.

Criterion 3 ("a claim decided unknown is never overwritten except by an inference
the reader granted") holds structurally once §2 lands: rejection no longer
propagates at all, so **the only remaining source of a propagated value is an
operator the reader accepted**.

### 7. CLI

`analysis evaluate` (`src/cli/commands/analysis.ts:529, 544`) and the graph
overlay (`src/cli/commands/graph.ts:115`) both call `gradeEvaluation`. Replace
with the facts printed as facts — no label composition in the CLI, which would be
a fourth string table nobody maintains. The graph overlay's grade-colour map
(`graph.ts:117-121`) goes with it.

### 8. Version and publish

Breaking → **major**, `3.4.2` → `4.0.0`. This slice **completes without
publishing**: merged, version-bumped, tagged `v4.0.0`, plus
`pnpm run build && pnpm run pack:branch` for a branch-suffixed validation tarball.
Never plain `pnpm pack` — it names the file by version alone, so two branches at
the same version overwrite each other in a directory a consumer is pinned to.
`proposit-server` and `proposit-mobile` will be red on the deleted
`TCoreEvaluationGrade`; that is the signal the slice worked. The npm release is
coordinated at the workspace root once all five slices are code-complete.

### 9. What survives untouched

`checkValidity` / `checkArgumentValidity` and `TCoreCounterexample` stay. Design
§6 drops the entailment check as a **reported finding to authors and readers** —
that is slice C's notice, not this API. Removing a working engine capability that
the CLI exposes is not in the request's scope, and it is the only exhaustive
search core offers.

## Acceptance criteria

Each is one named engine test. AC-1..AC-6 are the request's criteria verbatim in
intent; AC-7..AC-12 cover the rest of the slice's boundary.

1. **AC-1** — Given `P → Q` with `P` true, `Q` unassigned, and the premise's root
   rejected: `Q` is `null` in the propagated assignment, `P` remains `true`, and
   no variable in the argument gained a value. (Today the propagator sets `P` true
   and `Q` false: `argument-evaluation.ts:415-423`.)
2. **AC-2** — Given `(A ∧ B) → C` with only the root `implies` accepted and `C`
   unassigned: `A` and `B` remain `null`.
3. **AC-3** — A variable explicitly assigned `null` is `null` after evaluation
   unless an **accepted** operator derived it; a rejection anywhere in the
   argument never changes it.
4. **AC-4** — With every supporting premise struck:
   `survivingSupportingPremiseCount === 0`,
   `conclusionAttribution.reachedWithoutAssertion === false`, and
   `struckPremiseIds` lists them all — regardless of
   `survivingSupportingPremisesTrue` being vacuously `true`.
5. **AC-5** — Water and mammals: conclusion `W`, sole supporting premise `M → W`,
   reader assigns `M` true and `W` true and **grants no step**. Result:
   `conclusionTrue === true`, `assertedByReader === true`,
   `reachedWithoutAssertion === false`, `struckPremiseIds` empty.
   *(Corrected during implementation. As first written this criterion said the
   reader "accepts the premise", which contradicts its own expectation: an
   accepted `M → W` with `M` true derives `W` by modus ponens, so the
   counterfactual correctly returns `true`. The bug the criterion exists to
   pin is the old ladder reporting `sound` when the reader granted nothing and
   merely assigned both claims true — that is the design's "a reader who
   strikes nothing but already believed the conclusion of an argument that
   establishes nothing". The accepted-premise variant is pinned as a separate
   test asserting `reachedWithoutAssertion === true`.)*
6. **AC-6** — Redundant support: conclusion `C`, supporting `A → C` and `B → C`;
   `A` true, first premise's root rejected; `B` true, second accepted. Result:
   `conclusionTrue === true`, `reachedWithoutAssertion === true`,
   `struckPremiseIds` is exactly the first premise, and
   `survivingSupportingPremisesTrue === true`.
7. **AC-7** — A rejection recorded against a conclusion-premise operator, or
   against a derivation premise, leaves `struckPremiseIds` empty and changes no
   value.
8. **AC-8** — Cyclic support: `A → B` and `B → A` both accepted, `A` asserted
   true. `claimAttribution[A].reachedWithoutAssertion === false`. (Least fixed
   point; a cycle must not certify itself.)
9. **AC-9** — Premise set `{A, B, ¬(A ∧ B)}`: `premiseSetSatisfiable === false`,
   no value is derived, and every entry in `variableProvenance` has
   `origin !== "derived"`. Striking the restriction restores
   `premiseSetSatisfiable === true` and derivation resumes.
10. **AC-10** — Chain `P → Q`, `Q → R`, both accepted, `P` true: `Q` and `R` are
    `origin: "derived"`, and `variableProvenance[R].derivedBy` names the second
    premise's root expression with `fromVariableIds` containing `Q`.
11. **AC-11** — A constraint premise false under the assignment yields
    `isAdmissibleAssignment === false` **and no grade**; `gradeEvaluation`,
    `TCoreEvaluationGrade` and `TCoreEvaluationGrading` are not exported from
    `src/lib/index.ts`.
12. **AC-12** — `premisesHoldConclusionFalse === true` for `P ∨ R`, `P → Q`,
    conclusion `Q`, with `P` false, `R` true, `Q` false, nothing struck (design
    §6's worked example); and `preservesTruthUnderAssignment` no longer exists.

Non-test criteria: `pnpm run check` green; no string in `src/` matching
slice/phase/initiative planning vocabulary; `docs/api-reference.md` describes the
facts and the `A ∧ (B → C)` engine limitation.

## Risks

1. **The satisfiability walk inside `checkArgumentValidity` is a 2ⁿ × 2ⁿ trap.**
   Mitigated by computing once and threading it through (Design §5). This is the
   one place a naive implementation ships an unusable regression rather than a
   wrong answer, so it gets its own test asserting `checkValidity` on a 10-variable
   argument still completes.
2. **Two consumers break by design.** Expected and desired; the risk is someone
   "fixing" it by publishing core mid-chain. The plan's final task states the
   stop.
3. **The vocabulary is a proposal.** If Q1/Q2 are answered differently after this
   spec, the *facts* are unaffected — only slices B–E's strings move. That
   separation is deliberate: nothing in core depends on the words.
4. **Attribution cost grows with reader-asserted claims.** Bounded by scoping the
   map to asserted claim-bound variables and by the `includeDiagnostics` gate, but
   worth a sanity check on the largest example argument.
5. **`docs/api-reference.md` is large and the evaluation surface is described in
   several places** (lines ~291, ~312, ~1439, ~2351). A partial update leaves the
   reference describing a removed enum. The Documentation Sync block in the plan
   treats it as one task with an explicit grep, not a spot edit.

## Notes

**Sibling-defect sweep, repo-wide.** Grepping `operatorAssignments` across `src/`
found exactly two places that read a decision as a truth value —
`propagateOperatorConstraints` (`argument-evaluation.ts:375-441`) and
`PremiseEngine.evaluate` (`premise-engine.ts:1568-1572`) — plus one partial
acknowledgement (`premise-engine.ts:1665`). Everything else is transport: the CLI
analysis-state commands (`src/cli/commands/analysis.ts`, `graph.ts`) and the
`analysis` schema (`src/lib/schemata/analysis.ts:14`), which store and forward the
map without interpreting it. The sweep was not narrowed.

**Assumption.** `TCoreOperatorAssignment` (`src/lib/types/evaluation.ts:12`) keeps
both members — `"rejected"` remains the wire value; only its *meaning* changes,
from "this expression is false" to "this premise is struck". Renaming it to
`"struck"` would be a second breaking change to the persisted analysis schema
(`src/lib/schemata/analysis.ts`) and to slice C's stored reactions, for no gain.
