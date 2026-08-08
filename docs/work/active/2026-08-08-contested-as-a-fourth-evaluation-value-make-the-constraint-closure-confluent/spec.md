# Spec — Contested as a fourth evaluation value; a confluent closure

## Capability changes

None in this node. `docs/capabilities/` here is empty — the library declares no
end-user capability. The reader-facing surface for `contested` is declared by
`proposit-server` and `proposit-mobile`; this spec's **Downstream API delta**
section is what those nodes plan against.

One taxonomy re-wording is required: the `argument-evaluation` Feature says
"trivalent truth values". Evaluation output is no longer trivalent.

## Problem

`closeUnderAcceptedOperators` is a `while (changed)` sweep over accepted
operators. `trySetChild` refuses to overwrite a value that is already present,
so when two granted steps derive **opposite** values for the same variable, the
one the sweep reaches first wins and the other is dropped on the floor. Premise
order is `ArgumentEngine.listPremiseIds()`, which sorts by lexicographic UUID,
so the answer is decided by a random id. Measured over 300 structurally
identical arguments: `conclusionTrue` was `true` 157 times, `false` 143 times.

Nothing downstream can detect this. `premiseSetSatisfiable` asks about the
premise set alone — it excludes the reader's assertions, and here it is the
assertions *plus* the granted steps that are jointly inconsistent, so it reports
`true` in every run.

The comment at `argument-evaluation.ts` (and the same claim in
`docs/api-reference.md` and `AGENTS.md`) says the closure is a **least fixed
point** because it "only ever fills `null`s". Fill-only gives *monotonicity*,
which attribution's counterfactual genuinely needs. It does not give
*uniqueness*: `true` and `false` are incomparable in the information order, so
the ordered set the closure is climbing has no least upper bound for a conflict
— and the code silently picks one branch instead of failing to have an answer.

## Prior art, and why we are not inventing an algebra

This is **Belnap's four-valued logic** — the bilattice `FOUR`. The four values
are the four subsets of the classical `{t, f}`:

| Subset  | Reading                          | This codebase |
| ------- | -------------------------------- | ------------- |
| `{}`    | told neither — no information     | `null`        |
| `{t}`   | told true only                    | `true`        |
| `{f}`   | told false only                   | `false`       |
| `{t,f}` | told both — conflicting information | `"contested"` |

Two independent orders sit on those four values. The **truth order** `≤_t`
(`false ≤ null ≤ true`, `false ≤ contested ≤ true`, with `null` and `contested`
incomparable) gives the connectives: `∧` is its meet, `∨` its join. The
**knowledge order** `≤_k` (`null ≤ true ≤ contested`, `null ≤ false ≤
contested`, with `true` and `false` incomparable) measures how much we have
been told; its join `⊕` is what merges two sources.

Strong Kleene's three values are exactly the sublattice without `⊤`, which is
why the reader's three-valued assignment is untouched and only evaluation can
reach the fourth value. Restricted to `{null, true, false}` every table below
is byte-for-byte the strong-Kleene table the code ships today.

Sources:

- N. D. Belnap, "A Useful Four-Valued Logic" (1977) — the four values as
  "told true"/"told false" subsets, and the two lattice orders.
- G. Priest, *An Introduction to Non-Classical Logic*, ch. 8 (FDE and LP) —
  the connective tables and the invalidity of modus ponens for the material
  conditional.
- SEP, "Paraconsistent Logic" (relational semantics for FDE) — used to check
  the tables: `¬A` relates to 1 iff `A` relates to 0; `A ∧ B` relates to 1 iff
  both do and to 0 iff either does; `A ∨ B` dually.
- M. C. Fitting, "Bilattices and the semantics of logic programming",
  *J. Logic Programming* 11 (1991) — the monotone-in-`≤_k` immediate-consequence
  operator whose least fixed point is the program's meaning, and where the
  fourth value arises precisely from conflicting rules. This is the source for
  the **propagation** half of the design; Belnap/FDE is the source for the
  **evaluation** half. They are different objects and the spec keeps them apart.
- M. Ginsberg, "Multivalued logics: a uniform approach to inference in AI"
  (1988) — bilattices as the general setting.

## Design

### D1 — The value type

```ts
/** The fourth truth value. Evaluation may produce it; a reader may never assign it. */
export const CONTESTED = "contested"
export type TCoreContestedValue = typeof CONTESTED

/** Three-valued truth value: true, false, or null (unset/unknown). */
export type TCoreTrivalentValue = boolean | null

/** Four-valued truth value: the three above plus `"contested"`. */
export type TCoreQuadrivalentValue = TCoreTrivalentValue | TCoreContestedValue
```

**A widened output type, not a widened input type.** Assignment keeps the
existing three-valued alias:

```ts
export type TCoreVariableAssignment = Record<string, TCoreTrivalentValue>
export interface TCoreExpressionAssignment {
    variables: TCoreVariableAssignment              // unchanged: three-valued
    operatorAssignments: Record<string, TCoreOperatorAssignment>
}
```

and a **new, distinct** type carries what the closure produced:

```ts
export type TCoreResolvedVariableValues = Record<string, TCoreQuadrivalentValue>
export interface TCoreResolvedAssignment {
    variables: TCoreResolvedVariableValues
    operatorAssignments: Record<string, TCoreOperatorAssignment>
}
```

`TCoreExpressionAssignment` is structurally assignable to
`TCoreResolvedAssignment`, never the reverse. `ArgumentEngine.evaluate` and
`propagateOperatorConstraints` keep taking `TCoreExpressionAssignment`, so
`variables[id] = CONTESTED` at any assignment call site is a **compile error** —
that is the enforcement, in the type, not a runtime check and not a convention.
`PremiseEngine.evaluate` widens to `TCoreResolvedAssignment` because it is the
one place the evaluator re-feeds its own closure output, which by construction
may contain `contested`.

`"contested"` is a JSON string literal rather than a symbol or sentinel object
on purpose: every one of these values crosses an HTTP boundary to
`proposit-server` and `proposit-mobile`.

### D2 — Operator tables (Belnap / FDE)

`N = null`, `T = true`, `F = false`, `B = contested`. Rows are the left
operand.

Negation:

| `¬` | T   | F   | N   | B   |
| --- | --- | --- | --- | --- |
|     | F   | T   | N   | B   |

Conjunction (meet in `≤_t`):

| `∧` | T   | F   | N   | B   |
| --- | --- | --- | --- | --- |
| T   | T   | F   | N   | B   |
| F   | F   | F   | F   | F   |
| N   | N   | F   | N   | F   |
| B   | B   | F   | F   | B   |

Disjunction (join in `≤_t`):

| `∨` | T   | F   | N   | B   |
| --- | --- | --- | --- | --- |
| T   | T   | T   | T   | T   |
| F   | T   | F   | N   | B   |
| N   | T   | N   | N   | T   |
| B   | T   | B   | T   | B   |

Material implication, `a → b ≝ ¬a ∨ b` (the existing three-valued definition,
unchanged):

| `→` | T   | F   | N   | B   |
| --- | --- | --- | --- | --- |
| T   | T   | F   | N   | B   |
| F   | T   | T   | T   | T   |
| N   | T   | N   | N   | T   |
| B   | T   | B   | T   | B   |

Biconditional, `a ↔ b ≝ (a → b) ∧ (b → a)` (unchanged definition):

| `↔` | T   | F   | N   | B   |
| --- | --- | --- | --- | --- |
| T   | T   | F   | N   | B   |
| F   | F   | T   | N   | B   |
| N   | N   | N   | N   | T   |
| B   | B   | B   | T   | B   |

The four cases the request asked to settle from the literature rather than by
taste: `B ∧ F = F`, `B ∨ T = T`, `¬B = B`, and `B → q = B ∨ q` (so `B → T = T`,
`B → F = B`, `B → N = T`, `B → B = B`).

Two entries deserve a note, and neither is a deviation:

- `N ∧ B = F` and `N ∨ B = T`. Surprising read as "unknown", obvious read as
  subsets: `{} ∧ {t,f}` is told-true by neither and told-false by the second,
  hence `{f}`.
- `N ↔ B = T`. Forced by defining `↔` from the material `→`, which is what the
  three-valued code already does. `N → B = ¬N ∨ B = {} ∨ {t,f} = {t}` and
  `B → N = ¬B ∨ N = {t,f} ∨ {} = {t}`, so the conjunction is `{t}`. We keep the
  definitional chain rather than special-casing an entry.

**Implementation.** One two-bit encoding, not five hand-written tables: `t`-bit
`1`, `f`-bit `2`; `not` swaps the bits, `and` is `t = ta & tb`, `f = fa | fb`,
`or` is the dual, and `implies`/`iff` compose as above. The tables above then
hold by construction, and the exhaustive 4×4 tests pin them.

### D3 — Propagation, and what `X` contested does to `X → Y`

**These rules are not the FDE tables and are not meant to be.** Evaluation
answers "what value does this formula display"; propagation answers "what does
the reader's granted step force". They are separate objects in the literature
too — FDE for the former, Fitting's bilattice consequence operator for the
latter.

State is a map from variable id to a value in FOUR, ordered by `≤_k`. Write
`T?(v)` for "`v` has the `t` component" (`v` is `true` or `contested`) and
`F?(v)` for "`v` has the `f` component" (`v` is `false` or `contested`). A rule
never overwrites: it **joins** with `⊕` (bitwise union of components), so
`true ⊕ false = contested` and `contested ⊕ anything = contested`.

For each **accepted** operator:

| Operator                | Rule                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `¬A`                    | `A ⊕= false`                                                          |
| `A₁ ∧ … ∧ Aₙ`           | `Aᵢ ⊕= true` for every `i`                                            |
| `A₁ ∨ … ∨ Aₙ`           | if `F?(Aⱼ)` for every `j ≠ i`, then `Aᵢ ⊕= true`                      |
| `A → B`                 | if `T?(A)` then `B ⊕= true`; if `F?(B)` then `A ⊕= false`              |
| `A ↔ B`                 | `T?(A) ⇒ B ⊕= true`; `F?(A) ⇒ B ⊕= false`; and symmetrically from `B`  |

**The asked question: `X` is contested and `X → Y` is accepted, so what is
`Y`?** `Y ⊕= true`. `T?(contested)` holds, the granted step is modus ponens on
the `t` component, and the closure fires it.

This is a **deliberate deviation from FDE validity, and the only one.** Under
the material conditional, `contested → Y` evaluates to `contested ∨ Y`, which
already carries `t` for every `Y` — the implication is satisfied by the
antecedent's own inconsistency, so as an *entailment* it forces nothing on `Y`.
FDE is paraconsistent precisely so that a contradiction does not explode, and
modus ponens for `→` is invalid there (Priest ch. 8). We fire it anyway because:

1. The reader **granted this step**. Refusing to carry it means one conflict
   anywhere upstream silently freezes every downstream variable at `null`, and
   the reader is shown "unknown" for a step they explicitly accepted — the
   outcome the product owner rejected in the same breath as rejecting
   `unknown` for the conflict itself.
2. It is exactly Fitting's operator: rules fire on the presence of a component
   and their results are joined, which is what makes the closure monotone in
   `≤_k` and therefore confluent (D4). The `≤_t`-flavoured alternative —
   "fire only when the antecedent is exactly `true`" — is **not** monotone in
   `≤_k` (a variable that later becomes `contested` would retract the
   derivation), and non-monotone is precisely the bug being fixed.
3. It does not explode. Firing on the `t` component propagates a specific
   granted inference; it never licenses an arbitrary conclusion, and the
   `contested` marking travels with it so a reader can see the conflict on the
   chain.

Two further consequences, both intended:

- **The reader's own assertions are joinable.** The old `userAssigned`
  immunity is deleted. If the reader asserts `A = true` and a granted step
  forces `A` false, `A` becomes `contested` rather than silently keeping the
  assertion and dropping the derivation. That is the product owner's sentence
  — "the user saying it is both true and false" — and it removes the last place
  where an order-dependent choice was being made quietly. Axiomatic
  forced-`true` variables are joinable on the same footing: an argument that
  forces an axiom false is contested, not silently ignored.
- **Conflicts spread along the chain.** In the reported repro (`A = true`,
  `F = false`, accepted `A → X` and `X → F`) the fixed point is
  `A = X = F = contested`: `X` takes `true` from `A → X` and `false` from
  `X → F`, then `F?(X)` back-propagates onto `A` and `T?(X)` forward onto `F`.
  The inconsistency is not localisable to one variable, and the closure says so
  rather than picking a scapegoat.

`provenance` gains an origin for this: see D6.

### D4 — Confluence

**Claim.** The closure's result — variable values *and* provenance — does not
depend on the order premises, expressions, or rules are visited in.

**Proof.** The state space is `FOUR^V` for the finite variable set `V`, a
finite complete lattice under the componentwise `≤_k`. Each rule in D3 is a
function `s ↦ s ⊕ (x ↦ c)` for a fixed variable `x` and constant `c`, guarded by
a predicate built from `T?` and `F?` and conjunction. `T?` and `F?` are
`≤_k`-monotone (a component, once present, is never removed, because `⊕` only
adds); conjunctions of monotone predicates are monotone; and `s ↦ s ⊕ k` is
monotone and inflationary. So each rule is monotone and inflationary, and so is
the one-sweep operator `Φ` that composes them. By Knaster–Tarski — in the
chaotic-iteration form (Cousot & Cousot 1977) — iterating any *fair* schedule
of the individual rules from the seed `s₀` converges to the least fixed point of
`Φ` above `s₀`, and that limit is independent of the schedule. The
`while (changed)` loop is fair: it only exits after a full sweep in which every
rule fired without changing anything. Termination is immediate — each variable's
value can only climb a lattice of height 2, so at most `2·|V|` joins can change
the state.

The old sweep failed exactly one hypothesis: `trySetChild`'s "already has a
value" test is `≤_k`-**anti**-monotone, so the rule could stop firing as
information grew, and two schedules reached different maximal-but-not-least
fixed points. Likewise the old `or` rule's "exactly one child is still `null`"
guard. Both are replaced above with monotone guards.

**Provenance is part of the result, so it gets the same treatment.** A step is
recorded whenever its rule fires, whether or not the join changed a bit, keyed
by `(expressionId, value)` and overwritten each time — so at the fixed point
every recorded step carries `fromVariableIds` computed from the *converged*
state, and the last (no-change) sweep re-records all of them identically. The
final list is then sorted by `(premiseId, expressionId, value)`. Nothing about
either the set or the contents depends on visitation order.

**How it is tested.** Three ways:

1. The reported repro, built 300 times with freshly randomised UUIDs — the same
   harness shape that found the bug, since UUID randomisation is exactly what
   permutes `listPremiseIds()`. Every run must yield `conclusionTrue ===
   CONTESTED`, and the full `variableProvenance` must be deep-equal across all
   300 runs.
2. The same argument built with its premises **added in reverse order**, which
   permutes insertion order independently of id sort order.
3. The 4×4 operator tables, exhaustively, per operator.

### D5 — Aggregates and attribution

| Field                              | With `contested` in play                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `conclusionTrue`                   | `TCoreQuadrivalentValue`. `contested` when the conclusion premise root evaluates to it.                          |
| `survivingSupportingPremisesTrue`  | `TCoreQuadrivalentValue`; the fold is Belnap `∧`, so one contested premise among true ones gives `contested`.     |
| `isAdmissibleAssignment`           | Same, over constraint premises.                                                                                  |
| `premisesHoldConclusionFalse`      | `∧(admissible, ∧(support, ¬conclusion))`; `¬contested = contested`, so it can be `contested`. See also D7.        |
| `premiseSetSatisfiable`            | Unchanged, **stays trivalent**. It is a classical truth-table search with no operator decisions, so no closure runs and no contested value can arise. |
| `conclusionAttribution`            | `reachedWithoutAssertion` stays `=== true`: a contested conclusion is not a reached one.                          |
| `claimAttribution`                 | `reachedWithoutAssertion` stays an equality against the reader's asserted value, so a re-closure that comes back `contested` is not "the same value". |

Every existing `=== true` / `=== false` comparison downstream keeps its meaning
and is left alone; in particular `checkArgumentValidity` counts a counterexample
only on `premisesHoldConclusionFalse === true`, so a contested row is not a
counterexample, and `numAdmissibleAssignments` only counts
`isAdmissibleAssignment === true`. This is the intended reading: a validity
check enumerates total classical assignments and grants no operators, so it
cannot produce a contested value in the first place.

### D6 — Provenance

`TCoreValueOrigin` gains `"contested"`, reported whenever the final value is
`CONTESTED` — it takes precedence over `"asserted"` and `"derived"`.

`TCoreVariableProvenance` gains `contestedBy?: TCoreDerivationStep[]`, present
iff `origin === "contested"`, listing every granted step that contributed a
component, deterministically sorted (D4). `derivedBy` keeps its meaning for
`origin === "derived"` and is absent when the value is contested — a single
"the step that produced it" is a lie once two steps disagree.

A reader-asserted variable that a granted step then contradicts reports
`origin: "contested"` with the contradicting step(s) in `contestedBy`; the
reader's own assertion is not a step and is not listed. A consumer that wants
"you said true, the argument forces false" reads the two components off the
`contestedBy` steps' `value`.

### D7 — `premisesHoldConclusionFalse` vacuity

`survivingSupportingPremisesTrue` folds an empty list to `true` and documents
that. `premisesHoldConclusionFalse` builds on it and does not, so striking the
only supporting premise reports `true` — "the premises hold and your conclusion
is false" — when nothing was even weighed.

**Guard.** When the argument has at least one supporting premise and **every**
one of them was struck, `premisesHoldConclusionFalse` is `null`: the reader
withheld the whole case, so whether the premises hold is not a question we can
answer. The guard is on *striking*, not on the count: an argument authored with
zero supporting premises is the legitimate entailment-from-nothing case, where a
false conclusion genuinely is a counterexample, and `checkArgumentValidity` —
which never strikes anything — must keep behaving exactly as it does today.

The doc comment gains the vacuity note its sibling already carries. The CLI
label is wrong on its own terms and becomes `premises hold, conclusion false`
in both `src/cli/commands/analysis.ts` and `src/cli/commands/graph.ts`.

### D8 — `isPremiseSetSatisfiable`: unsatisfiable ≠ unevaluable

Today the walk returns `false` whenever no row makes every premise `true`,
including when no row could be evaluated at all — and `false` suppresses
derivation argument-wide.

**Rule.** A row is *determinate* when either some premise's root value is
`false` (the row is settled, whatever the rest is) or every premise's root value
is non-`null`. If no row comes back all-true **and at least one row was
indeterminate**, return `null` rather than `false`.

This is stronger than "return `null` when *every* row was indeterminate": one
indeterminate row is already enough to make `false` a claim the search did not
establish, and `null` is the answer the variable ceiling already gives for
"not determined". No reachable trigger was constructed by the review, so this
is hardening either way; the stronger rule costs the same line of code.

### D9 — `evaluate` must union `forcedTrueVariableIds`

`ArgumentEngine.evaluate` does `options?.forcedTrueVariableIds ??
this.getAxiomaticBoundVariableIds()`. `checkValidity` unions the two sets;
`evaluate` replaces. A caller passing `new Set()` — or any set that does not
happen to contain the axioms — loses the axiomatic set entirely: the
satisfiability search stops pinning axioms true (so `premiseSetSatisfiable` can
flip `false → true` and un-suppress derivation), and `isReaderAsserted` stops
excluding them (so a forced axiom is reported as
`conclusionAttribution.assertedByReader`). Union, exactly as `checkValidity`
does.

### D10 — The three false "least fixed point" claims

`argument-evaluation.ts`, `docs/api-reference.md` and `AGENTS.md` each say the
fill-`null`s-only rule makes the closure a least fixed point. After this work
the closure *is* a least fixed point — but in the knowledge order, reached by
joining rather than by refusing to overwrite. All three passages are rewritten
to state what actually holds: the closure is the least fixed point of a
monotone consequence operator on the four-value knowledge order, it only ever
adds information, it is order-independent, and conflicting information produces
`contested` rather than a coin flip. The `AGENTS.md` invariant keeps its
operative half — an operator decision is never a truth value — and its
"least fixed point" sentence is replaced with the confluence property that
attribution actually depends on.

## Downstream API delta

For `@proposit/shared`, `proposit-server` and `proposit-mobile`, which all
model three values today. Nothing here is published yet — this rides 4.0.0.

**New exports** (`@proposit/proposit-core`):

| Export                        | Kind  | Notes                                                     |
| ----------------------------- | ----- | --------------------------------------------------------- |
| `CONTESTED`                   | const | the string literal `"contested"`                           |
| `TCoreContestedValue`         | type  | `typeof CONTESTED`                                         |
| `TCoreQuadrivalentValue`      | type  | `boolean \| null \| "contested"`                           |
| `TCoreResolvedVariableValues` | type  | `Record<string, TCoreQuadrivalentValue>`                   |
| `TCoreResolvedAssignment`     | type  | resolved `variables` + the unchanged `operatorAssignments` |
| `isContested`                 | fn    | narrowing guard, `(v) => v === CONTESTED`                  |

**Unchanged** (deliberately): `TCoreTrivalentValue`, `TCoreVariableAssignment`,
`TCoreExpressionAssignment`, `TCoreOperatorAssignment`, and the signatures of
`ArgumentEngine.evaluate`, `ArgumentEngine.checkValidity`,
`propagateOperatorConstraints`, `isPremiseSetSatisfiable`. A consumer that only
*writes* assignments needs no change at all.

**Widened from `TCoreTrivalentValue` to `TCoreQuadrivalentValue`** — every one
of these is a place a consumer *reads* a value and must now handle a fourth
case:

- `TCoreArgumentEvaluationResult`: `isAdmissibleAssignment`,
  `survivingSupportingPremisesTrue`, `conclusionTrue`,
  `premisesHoldConclusionFalse`, `propagatedVariableValues` (value type),
  and `assignment` (now `TCoreResolvedAssignment`).
- `TCorePremiseEvaluationResult`: `rootValue`, `expressionValues` (value type),
  `variableValues` (value type).
- `TCorePremiseInferenceDiagnostic`, both arms: `leftValue`, `rightValue`,
  `rootValue`, `antecedentTrue`, `consequentTrue`, `isVacuouslyTrue`, `fired`,
  `firedAndHeld`, `bothSidesTrue`, `bothSidesFalse`.
- `TCoreDirectionalVacuity`: every field.
- `TCoreVariableProvenance.value`.
- `TCoreCounterexample.assignment` (now `TCoreResolvedAssignment`).
- `PremiseEngine.evaluate(assignment)` parameter widens to
  `TCoreResolvedAssignment` (a widened *input*, so existing call sites still
  compile).

**Behaviour changes with no type change:**

- `TCoreValueOrigin` gains the member `"contested"` — an exhaustive `switch`
  or a union-keyed lookup map on this type will fail to compile until the
  consumer adds a branch. This is the one change most likely to break a build.
- `TCoreVariableProvenance` gains optional `contestedBy?: TCoreDerivationStep[]`.
- `premisesHoldConclusionFalse` can now be `null` when every supporting premise
  was struck (D7).
- `isPremiseSetSatisfiable` can now return `null` where it returned `false`
  (D8).
- `ArgumentEngine.evaluate` now unions the caller's `forcedTrueVariableIds`
  with the axiomatic set instead of replacing it (D9). A caller that was
  relying on the replace to *suppress* axioms no longer can — none exists.
- Reader assertions are no longer immune to propagation: a variable the reader
  asserted can come back `contested` (D3).
- Internal rename, not exported and listed only for completeness:
  `evaluateSubtreeKleene` → `evaluateSubtree`, and
  `src/lib/core/evaluation/kleene.ts` (`kleeneNot`/`kleeneAnd`/`kleeneOr`/
  `kleeneImplies`/`kleeneIff`) → `belnap.ts` (`belnapNot`/…). Neither the file
  nor those functions appear in `src/lib/index.ts`.

**UI guidance for the fourth value.** `contested` is not a shade of unknown and
must not render as one. It means *the reader's own inputs, run through the
steps they granted, force this both true and false* — a state only they can
resolve, by changing an assignment or withdrawing an acceptance.
`variableProvenance[id].contestedBy` names the granted steps to point at.

## Acceptance criteria

1. The reported repro, built 300 times with randomised UUIDs, yields
   `conclusionTrue === CONTESTED` on every run, and identical
   `variableProvenance` across all runs.
2. The same argument built with premises added in reverse order gives an
   identical result.
3. All five operators are pinned exhaustively over 4 values (4 unary + 4×4×4
   binary cases) against the D2 tables.
4. `variables[id] = CONTESTED` in a `TCoreExpressionAssignment` is a
   TypeScript compile error, pinned by a type-level test.
5. A reader assertion contradicted by a granted step reports
   `origin: "contested"` with the contradicting step in `contestedBy`.
6. `evaluate({ forcedTrueVariableIds: new Set() })` on an argument with an
   axiomatic-bound variable behaves identically to `evaluate({})`:
   same `premiseSetSatisfiable`, and the axiom is not reported as
   `assertedByReader`.
7. Striking the only supporting premise gives
   `premisesHoldConclusionFalse === null`; an argument authored with zero
   supporting premises and a false conclusion still gives `true`.
8. `isPremiseSetSatisfiable` returns `null`, not `false`, when no row is
   all-true and some row was indeterminate.
9. Existing three-valued behaviour is unchanged wherever no conflict arises:
   the full suite passes with the strong-Kleene expectations it already
   carries.
10. `pnpm run check` green. Version stays `4.0.0`;
    `docs/release-notes/v4.0.0.md` and `docs/changelogs/v4.0.0.md` absorb this
    work.
