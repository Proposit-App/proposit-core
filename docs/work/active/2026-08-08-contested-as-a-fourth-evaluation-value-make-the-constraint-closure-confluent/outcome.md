# Outcome — Contested as a fourth evaluation value; a confluent closure

Branch `contested-value-belnap-closure`, three planning commits plus two work
commits. Version stays `4.0.0`; not published, not pushed.

| Commit    | What                                                              |
| --------- | ----------------------------------------------------------------- |
| `2525198` | The fourth value, the Belnap tables, the confluent closure, and the three independent defects |
| `ade251d` | The docs, including the three false least-fixed-point claims       |

## What shipped

**The value type (D1).** `CONTESTED = "contested"`, `TCoreContestedValue`,
`TCoreQuadrivalentValue`, `TCoreResolvedVariableValues`,
`TCoreResolvedAssignment`, `isContested` — all in
`src/lib/types/evaluation.ts` and re-exported by the barrel.
`TCoreTrivalentValue`, `TCoreVariableAssignment` and
`TCoreExpressionAssignment` are untouched, so `variables[id] = CONTESTED` at an
assignment call site is a compile error. Pinned with `@ts-expect-error` in
`test/evaluation/contested-value.test.ts`, which fails loudly if the
restriction is ever relaxed.

**The operator tables (D2).** `src/lib/core/evaluation/kleene.ts` becomes
`belnap.ts`; the five `kleene*` functions become `belnap*`, joined by
`hasTrueComponent`, `hasFalseComponent`, `joinKnowledge`. Implemented on a
two-bit component encoding rather than five written-out tables; the tables are
pinned exhaustively (4 unary + 4×4 per binary operator, plus the join's
idempotence/commutativity/associativity) in
`test/evaluation/operator-tables.test.ts`. Restricted to the three reader
values every table is the strong-Kleene table it already was, which is why the
2 398-test suite needed only the two changes below.

**The closure (D3, D4).** `trySetChild` becomes `mergeIntoChild`: it joins in
the knowledge order instead of refusing to overwrite, the `userAssigned`
immunity is deleted (the set now only tags provenance), and every rule triggers
on a truth component rather than an exact value. Provenance records a step on
every firing, keyed and overwritten so `fromVariableIds` is read off the
converged state, then sorts by `(premiseId, expressionId, value)`.

**The three independent defects.** `ArgumentEngine.evaluate` unions
`forcedTrueVariableIds` with the axiomatic set (D9);
`premisesHoldConclusionFalse` is `null` when the argument had supporting
premises and every one was struck (D7), with the CLI label corrected in
`analysis.ts` and `graph.ts`; `isPremiseSetSatisfiable` returns `null` rather
than `false` when no row was all-true and some row could not be settled (D8).

**The false claims (D10).** Rewritten in `argument-evaluation.ts`,
`docs/api-reference.md` and `AGENTS.md`. `AGENTS.md` gained a second invariant
bullet: propagation merges, never overwrites and never declines to write, and
widening a trigger back to an exact-value test reintroduces the
nondeterminism silently.

## Follow-ups from re-review (folded in)

- **`contestedVariableIds`** on `TCoreArgumentEvaluationResult` — sorted,
  always present when `ok`, not diagnostics-gated. The forward rule carries
  only the told-true component, so a contested variable can yield an
  uncontested `true` downstream and leave *every* aggregate reading clean.
  Verified failing-clean case, now pinned in `confluence.test.ts`: conclusion
  `Y`; constraint `or(and(P, Q), R)` with the inner `and` accepted; supporting
  `P → Y` accepted; reader asserts `P = false`, `R = true`. Variable-keyed —
  no claim→variable resolution invented here, since `getVariableIdForClaim` is
  known-broken and separately escalated.
- **Arity guards in `resolveValue`**, mirroring `evaluateSubtree`. Now that
  `closeUnderAcceptedOperators` is exported, a caller can hand the closure a
  tree that never passed `validateEvaluability()`; an accepted
  `or(A, implies(B))` with a one-child `implies` threw a raw `TypeError`.
- **`docs/api-reference.md`** discussed the paraconsistency trade-off only for
  `→`. Extended to `∨`: an accepted `A ∨ B` with `A` contested commits
  disjunctive syllogism off a contested disjunct, which is the pattern
  Belnap's paraconsistency exists to block. Deliberate, monotone, and now
  documented where a reader will hit it.
- **Attribution corrected.** The rules are *not* Fitting's Φ. Fitting's
  operator transfers both components across a rule, which from `A = false` and
  `A → B` would derive `B = false` — affirming the consequent. Ours is a
  componentwise transfer: forward on `hasTrueComponent(left)` merging
  told-true, backward on `hasFalseComponent(right)` merging told-false, which
  is what a one-way material implication licenses. Fitting is the *setting*
  (monotone-in-`≤_k` consequence operator on a bilattice), not the operator.
  Corrected in `spec.md` and recorded in the closure's doc comment, where a
  future editor could break it.

## Deviations from the plan

- **T5's `contested` colour** landed as a light purple fill and a purple pen in
  `graph.ts`, deliberately away from the unknown grey. No new CLI flag, so
  `scripts/smoke-test.sh` was left alone (it passes).
- **T9 implements the stronger rule** the spec chose over the request's
  wording: `null` when *some* row was indeterminate, not only when *every* row
  was. Same line of code, and one indeterminate row is already enough to make
  `false` a claim the search did not establish.
- **`test/evaluation/fixtures.ts`** had `variableId` declared as a method;
  passing it around tripped `@typescript-eslint/unbound-method`. Redeclared as
  an arrow property.

## Evidence

- `pnpm run check` green — typecheck, prettier, eslint, 2 398 tests, build.
- `bash scripts/smoke-test.sh` passes against the fresh build.
- **The harness discriminates.** With `mergeIntoChild` temporarily reverted to
  the old "already has a value, decline" rule, all five confluence tests fail
  and the 300-run repro returns `[true, false]` — the reported split. With the
  merge in place it returns `['contested']`, and the 300 provenance snapshots
  collapse to one distinct shape.
- Two pre-existing tests in `test/core.test.ts` asserted the deleted immunity
  ("user assignment wins over propagation", "never overwrites user-assigned
  values"). Both were rewritten to the new reading rather than deleted; they
  are now the reader-assertion-contested cases.

## Behaviour a consumer will notice

Beyond the type widening (enumerated in `spec.md` → Downstream API delta):

1. `TCoreValueOrigin` gains `"contested"`. Surveyed the three consumers: none
   has an exhaustive `switch` or `Record<TCoreValueOrigin, …>`, so nothing
   breaks at compile time — it breaks a **runtime wire gate**,
   `proposit-shared/src/schemas/review.ts:250-254`, which rejects the new
   origin.
2. `contestedVariableIds` is the field consumers must read; a conflict can
   leave every other fact reading clean.
3. A reader's own assertion can come back `CONTESTED`.
4. An accepted disjunction with every disjunct asserted false now contests them
   all; previously it said nothing.
5. `premisesHoldConclusionFalse` can be `null`.
6. `isPremiseSetSatisfiable` can return `null` where it returned `false`.

## Not done, deliberately

- No consumer changes. `@proposit/shared`, `proposit-server` and
  `proposit-mobile` plan from the delta section of `spec.md`.
- No SAT solver. The truth-table walk and its ceiling stay; only the
  `false`-vs-`null` answer changed.
- No version bump and no tag — 4.0.0 is unreleased and absorbed this work.
- Not published, not pushed.

## Left for verification

The reader-facing rendering of `contested` is the consumers' call; core ships
the value, the provenance and the guidance, and no label strings.
