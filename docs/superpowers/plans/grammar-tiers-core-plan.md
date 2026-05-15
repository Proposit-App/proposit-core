# Grammar Tiers — proposit-core Implementation Plan

> **Implementation status — 2026-05-14 (latest), branch `grammar-tiers/core` at HEAD.**
>
> **Phases A, B (all), C1–C8, D0 (a–f), and D1 complete. `ManagedDerivationPremiseEngine` is deleted; the legacy `pe.normalizeExpressions()` delegation is gone; all four AN rules are native single-rule passes against the public PE mutation API. The two carry-over P2 items from the D0f dual-review (AN-4 phase-2 formula-position collision + `redistributeChildrenEvenly` no-op skip when `position === target`) are folded.**
> Tests at 1596 passed + 8 skipped (1631 prior + 1 new D1 P2 #1 regression guard; −35 passing + −1 skipped from MDPE block deletion across constructor validation / fromSnapshot / mutation enforcement / populateFromSupports citations-only / populateFromSupports v0.12). `pnpm run check` green.
>
> **Latest commits (newest first):**
>
> ```
> 41f6ecc     D1   — delete ManagedDerivationPremiseEngine (subsumed by D-tier validators + populateFromCitations/Axioms factories)
> 90026d6     D1   — redistributeChildrenEvenly skip no-op when position === target (P2 #2 carry-over)
> 5355611     D1   — AN-4 absorbSameOperatorMatch phase-2 target collision with formula position S-9 trip (P2 #1 carry-over)
> 26fb004     —    — docs(plan): D0f reconcile Implementation Status
> bafaa04     —    — D0f: applyANToFixedPoint rule chain to reduce-or accumulator (all rules run per iteration)
> 6eb3eb8     —    — D0f: move PERMISSIVE swap into applyANToFixedPoint (both AN entry points benefit)
> 6fcd6d7     —    — D0f: AN-4 redistributeChildrenEvenly scratch-range collision near POSITION_MAX (P2 #1)
> fdb7fb6     —    — D0f: em.wrapInFormula formulaId uniqueness check (S-10 enforcement gap — P2 #2)
> c03e7b8     —    — D0f: pe.reparentExpression parent-type + arity validation (S-1 enforcement gap — P1)
> 5308ad7     —    — D0e fold: lift hasBinaryOperatorInBoundedSubtree to shared bounded-subtree.ts helper
> c8dfd0b     —    — D0e: applyAN1 native (formula buffer insertion via pe.wrapInFormula) + delete legacy delegation helper
> 4323113     —    — D0e: applyAN4 native (multi-child same-operator absorption via pe.reparentExpression)
> 10d8fef     —    — D0e: public reparentExpression + normalize.ts swap target fix (PERMISSIVE)
> 80bea1c     —    — D0d (partial): applyAN4 regression-guard tests; native rewrite re-routed to D0e (see below)
> 6ba7882     —    — fold D0a dual-review polish (generic AN signatures, normalize.ts comment, convergence-cap context, idGenerator @internal, test coupling note)
> e55f2c0     —    — D0c: applyAN3 native (0/1-child operator + formula collapse via PE.removeExpression)
> 79da962     —    — D0b: applyAN2 native (double-negation collapse via PE.removeExpression)
> 9fb18ae     —    — D0a scaffold: src/lib/grammar/an-rules.ts (delegated impl) + rewire bridges
> 1870592     —    — fold C6+C7+C8 dual-review polish (P1 generator accessor, P2 dedup/tests/atomicity, P3 TODO sweep)
> 3f9710c     —    — docs(plan): lock D0 design — spec-direct AN-1..AN-4 rewrite blueprint
> 03fd64f     C8   — evaluation no-op on naked-Q derivation premises
> ce27619     C7   — snapshot loading accepts any Structural state
> 507e02c     C6   — populateFromCitations + populateFromAxioms factories
> ```
>
> **D1 implementation notes (2026-05-14, fresh-context dev #5):**
>
> Three-commit cycle combining D0f review carry-overs with the MDPE
> deletion:
>
> 1. **P2 #1 carry-over — AN-4 `absorbSameOperatorMatch` phase-2 target-collides-with-formula (`5355611`).** After `redistributeChildrenEvenly` fires, the formula sits at one of the redistributed slots between `effectiveLeftPos` and `effectiveRightPos`. The phase-2 inner-child reparents compute target positions in that same range. If any computed target equals the formula's current position, `pe.reparentExpression` trips S-9 — the formula is still a child of `outerId` at that point (it's removed at the end of absorption). Same hazard exists on the non-redistribute path when the formula's pre-mutation position equals one of the computed targets. Fix layer is `absorbSameOperatorMatch`, NOT `redistributeChildrenEvenly` — the formula is already in `redistribute`'s `forbidden` set (current ∪ targets) since it IS one of `outerId`'s children; the collision is a separate code block at the next call-stack level up. Fix looks up the formula's current position once, shifts any colliding target by ±1 (safe because spacing between targets is ≥ 2 on both paths). Failing-test-first regression guard in `test/grammar/an-rules.test.ts` with the trace example from the dual-review (positionConfig min=0/max=20, outer with 3 children at {1, 2, 3} where middle is the formula; redistribute lands formula at 10; phase-2 targets [7, 10, 12] hit formula at index i=1).
> 2. **P2 #2 carry-over — `redistributeChildrenEvenly` no-op skip when position === target (`90026d6`).** Pre-D1 the helper unconditionally scratched and back-moved every child, emitting 2 reparent change records per child. When a child is already at its target position, the scratch+back-move is wasted work. Added a `needsMove[i] = children[i].position !== targets[i]` per-child filter; only `movingCount` scratches are reserved (down from `total`), and both phases skip already-at-target children. The `forbidden` set still includes the skipped children's positions (via both `current` and `targets` contributions, since `position === target` for them), so other children's phase-1 scratches and phase-2 targets remain S-9-safe.
> 3. **MDPE deletion (`41f6ecc`).** Per spec §10.1 — `ManagedDerivationPremiseEngine` is removed wholesale. Its enforcement responsibilities split: D-tier mutation throws (`DERIVATION_STRUCTURE_INVALID`, `DERIVATION_TYPE_MISMATCH`, `DERIVATION_ANTECEDENT_NON_EMPTY`, `DERIVATION_CONSEQUENT_LOCKED`, `DERIVATION_ROOT_OPERATOR_INVALID`) → D-1..D-6 Derivable validators + E-6 evaluation guard, all already landed in Phase B and queryable via `engine.validate('derivable')`/`engine.validate('evaluable')`. S-14 (derivation root operator constraint) was promoted to `PremiseEngine.addExpression` in C5 — still enforced, just no longer routed through the subclass. `populateFromSupports` (citation + axiom mixed into a single OR antecedent) → `engine.populateFromCitations` + `engine.populateFromAxioms` (C6, factory + naked-Q-only + no-throw-on-already-populated). D-3 forbids mixing in v1.0, so the legacy mixed-grounding behavior is intentionally not preserved. CLI `populate-supports` command rewritten to call the two new factories sequentially (citations first, axioms second — see the commit body for migration semantics). The `DERIVATION_*` engine-error constants stay exported from `src/lib/types/validation.ts` — harmless and may still be referenced by future engine-internal throws. Test impact: −35 passing tests, −1 skipped (all MDPE-class behavior assertions). The "Fork integration with derivation premises" test that previously reloaded a forked premise's snapshot via `MDPE.fromSnapshot` was rewritten to verify via `forkedEngine.validate('derivable')`.
>
> **D1 addresses every D0f review carry-over.** P2 #1 + P2 #2 fixed
> per above. P3 #1 (check-order in `reparentExpression`) noted as
> defensible — no code change. P3 #2 (`lastChangedRule` could become
> `Set<"AN-N">`) tracked for a future cap-trip-debug enhancement. P3 #3
> (test coverage for the new P2 #1 fix) covered by the new regression
> test. P3 #4 carry-overs (`naked-q.ts:71` cast, `em.ts:2506` cast,
> `toThrowError` deprecation, 11 inline P-1 throws, S-14 audit) all
> remain parked at their original target cycles (D2 / D6).
>
> **D0 per-rule native-rewrite status:**
>
> | Rule | Native? | Notes                                                                                                                                                                                                                       |
> | ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | AN-1 | **yes** | D0e — formula buffer insertion via `pe.wrapInFormula(childOpId, formulaId)` (bundled-composite primitive; S-10 uniqueness enforced D0f)                                                                                     |
> | AN-2 | **yes** | D0b — double-negation collapse via two `pe.removeExpression(id, false)` calls                                                                                                                                               |
> | AN-3 | **yes** | D0c — 0/1-child operator + formula collapse via `pe.removeExpression(id, false)`                                                                                                                                            |
> | AN-4 | **yes** | D0e — same-operator absorption via `pe.reparentExpression(c_i, outerId, position_i)` + `pe.removeExpression(formula, false)` cleanup. D0f hardened the redistribute-fallback scratch range against POSITION_MAX clustering. |
>
> **D0f implementation notes (2026-05-14, fresh-context dev #4):**
>
> Six-commit cycle folding D0e dual-review findings + carry-overs:
>
> 1. **P1 — `pe.reparentExpression` parent-type + arity validation (`c03e7b8`).** D0e review surfaced that `reparentExpression` did not enforce `newParent.type ∈ {operator, formula}` — a caller could reparent under a variable and produce a malformed AST. Also wired arity guards mirroring `addExpression`'s `assertChildLimit` (unary `not` max 1; binary `implies`/`iff` max 2). Same-parent moves bypass the arity check (count unchanged). 3 new failing-test-first regression guards in `test/core.test.ts`. PE JSDoc updated.
> 2. **P2 #2 — `em.wrapInFormula` formulaId uniqueness check (`fdb7fb6`).** Pre-D0f `registerFormulaBuffer` silently overwrote via `this.expressions.set(formulaId, …)` with no `has()` check — violated S-10 (entity ID uniqueness). Added the throw before delegation; new test under `PremiseEngine.wrapInFormula (D0f)` describe block. PE JSDoc gains a matching `@throws S-10` entry.
> 3. **P2 #1 — AN-4 `redistributeChildrenEvenly` scratch collision near POSITION_MAX (`6fcd6d7`).** Pre-D0f scratch window was hard-coded `[max - total, max - 1]`; if outer's current children sat in that window, phase-1 reparents tripped S-9 against not-yet-moved siblings. Replaced with a downward scan from `max` skipping the `forbidden` union of (current child positions ∪ target positions) — covers both phase-1 (scratch lands on sibling) AND phase-2 (target lands on a child still carrying its scratch) collision risks. New regression test forces the `gap ≤ count` redistribute path with outer children clustered near `max=20`; verified to fail pre-fix.
> 4. **P2 #3 — PERMISSIVE swap relocation (`6eb3eb8`).** Pre-D0f the `PERMISSIVE_GRAMMAR_CONFIG` swap lived only in `normalize.ts`'s `normalizeArgument`. `runAssistiveNormalization` (post-mutation hook) did NOT swap, leaving AN-2/AN-3 cascades on non-Presentable input exposed to the inline P-1 throw. Moved the try/finally inside `applyANToFixedPoint` itself so both callers benefit automatically. Extracted inner convergence loop to private `applyANRulesToConvergence` so the wrapping try/finally stays compact. D2 still owns the ultimate fix (delete the 11 P-1 throws).
> 5. **Original D0f scope — `||` short-circuit → reduce-or accumulator (`bafaa04`).** Pre-D0f the chain `applyAN2 || applyAN3 || applyAN4 || applyAN1` fired at most one rule per outer iteration; rewrite to a 4-statement `if (applyAN_N(eng)) changed = true;` accumulator runs all four rules per iteration. `lastChangedRule` preserved for the convergence-cap diagnostic.
> 6. **P3 #3 — plan-doc reconciliation (this commit).** Substitutes `c8dfd0b` for the prior `<D0e-an1>` placeholder, drops the stale "helper-lift deferred to D0f" claim (was landed in `5308ad7`), and refreshes this Implementation Status block to reflect D0f's commits + Phase D outlook.
>
> **D0f addressed every D0e review item:**
>
> - **D0e P1** (`reparentExpression` parent-type gap) → `c03e7b8`.
> - **D0e P2 #1** (AN-4 redistribute scratch collision) → `6fcd6d7`.
> - **D0e P2 #2** (`wrapInFormula` formulaId uniqueness) → `fdb7fb6`.
> - **D0e P2 #3** (PERMISSIVE swap relocation) → `6eb3eb8`.
> - **D0e P3 #1** (redistribute math edge case for total ≥ 4.3B) → documented in JSDoc; tracking-only, no code change.
> - **D0e P3 #2** (`em.ts:2493` redundant cast) → still parked; the file was touched in `6fcd6d7` for the redistribute scratch fix but the cast is in `wrapInFormula` (unchanged path); not in-and-out churn but defer to D6 sweep.
> - **D0e P3 #3** (plan-doc staleness) → this commit.
> - **D0e P3 #4** (test coverage gaps for P1/P2 fixes) → covered by the 5 new tests across `c03e7b8` / `fdb7fb6` / `6fcd6d7`.
> - **D0e P3 #5** (`toThrowError` deprecation warnings) → still parked; new D0f tests use the same old-style pattern. Defer to D6 cleanup.
> - **D0e P3 #6** (`naked-q.ts:71` pre-existing cast, `||` short-circuit, helper-lift) → `||` short-circuit addressed in `bafaa04`; helper-lift was already landed in `5308ad7`; `naked-q.ts:71` cast still parked per all prior dispatches.
>
> **D0d implementation notes (2026-05-14, fresh-context dev #2):**
>
> Original dispatch instructed: "Native rewrite of `applyAN4` mirrors
> the AN-2/AN-3 patterns ... mutate via `pe.removeExpression(id,
deleteSubtree=false)`". **Technical analysis shows this is not
> feasible against the current public API.**
>
> The P-5 absorption pattern is `OUTER_OP → (..., ) formula → INNER_OP
(with same operator as outer) → [c1, c2, ...]`. The legitimate AN-4
> firings are inner-OP with **multiple** children — see the
> `presentable.test.ts` P-5 tests and the legacy
> `ExpressionManager.absorbSameOperator()` at
> `src/lib/core/expression-manager.ts:1255–1335`. `pe.removeExpression
(id, false)` only promotes when the target has ≤ 1 children (the
> EM's `removeAndPromote` throws otherwise — see
> `expression-manager.ts:833–836`). So a multi-child inner-OP cannot
> be removed via `removeExpression(_, false)`.
>
> Alternative decompositions all fail:
>
> - `removeExpression(formula, false)` first → `OUTER(..., INNER(c1,
c2), ...)`. Now inner has 2 children, still can't
>   `removeExpression(inner, false)`.
> - `removeExpression(formula, false)` then iterative
>   `removeExpression(c_i, true)` + re-`appendExpression` of each
>   subtree under outer. This recreates child subtrees with **new
>   IDs**, breaking the existing
>   `core.test.ts:26598–26622` test that asserts `e-a`/`e-b`/`e-c`
>   survive through the post-mutation AN-4 sweep.
> - Friend-package escape into `(pe as { expressions:
ExpressionManager }).expressions.reparentExpression(...)` is the
>   D0e design's rejected option (c) — bypasses PE's
>   invariant-enforcement layer.
> - In assistive mode, `removeExpression(formula, false)` would
>   produce a transient P-1 violation (operator as direct child of
>   operator) — the inline P-1 throws at
>   `expression-manager.ts:863–876` fire. Same blocker the D0e plan
>   notes for the AN-1 native rewrite.
>
> **Conclusion:** AN-4's native rewrite needs the exact primitive the
> user already approved for D0e — `public reparentExpression(exprId,
newParentId, newPosition)` on `PremiseEngine` (option (a)). The
> dispatch sequenced D0d before D0e expecting AN-4 was a simpler
> two-removal job; in reality D0d and D0e share the same blocker.
>
> **What D0d landed this cycle (split into two commits):**
>
> 1. The D0a dual-review polish (5 items: parameterized AN signatures
>    drop the `as unknown as ArgumentEngine` double casts; `normalize.ts`
>    comment fixed to reflect the no-op nature of the D0a-D0d PE-config
>    swap pre-D0e; convergence-cap throw now carries last-changed-rule
>     - representative-premise diagnostic context; `idGenerator` getter
>       marked `@internal`; `populate-from.test.ts` dedup test gains an
>       assistive-mode-coupling note).
> 2. Four AN-4 regression-guard tests in `an-rules.test.ts` asserting
>    the absorption contract on the delegated path (OR/AND multi-child
>    absorption + mixed-operator no-op). These tests stay valid once
>    the eventual native rewrite lands via D0e's reparent primitive.
>
> The native rewrite of `applyAN4` is now bundled into D0e's scope.
> When the D0e dev adds `pe.reparentExpression`, the AN-4 native
> rewrite is a 10-line function: walk premises, find each `OP →
formula → OP(same)` shape, for each inner child call `pe.reparent
Expression(childId, outerId, midpointPosition)`, then
> `pe.removeExpression(formula, false)` (formula now wraps the
> already-empty inner OP). Or do a final cleanup pass on the
> now-childless inner OP.
>
> **D0 remaining (sequenced):**
>
> - **D0e** rewrite `applyAN1` natively (formula buffer insertion)
>   **AND `applyAN4` natively** (same-operator absorption). Both gated
>   on `pe.reparentExpression`. User has confirmed option (a) — add
>   `public reparentExpression(exprId, newParentId, newPosition)` to
>   `PremiseEngine` as a bundled-composite mutation per spec §8. AN-1's
>   rewrite uses it to insert a formula buffer; AN-4's rewrite uses it
>   to move inner-OP children into outer-OP positions.
> - **D0f** rewire `auto-normalize.ts`'s `runAssistiveNormalization` and
>   `normalize.ts`'s `normalizeArgument` to call `applyANToFixedPoint`
>   without the legacy delegation (D0a's
>   `runLegacyNormalizeAndReportChange` helper goes). Move the
>   try/finally PE-config swap from `normalize.ts` into
>   `applyANToFixedPoint` (until D2 deletes it along with the legacy
>   per-flag config). Replace the whole-sweep ID-set change detector
>   with per-rule `changed` flags (synthesis P2 #2). Reconsider the
>   `||` short-circuit vs `let changed = applyAN2(eng); changed =
applyAN3(eng) || changed; ...` ordering (synthesis P2 #3).
>
> After D0f, all 1598 existing tests + the `an-rules.test.ts` regression
> guards should still pass — the only behavior change is _where_ the AN
> rules live, not what they do. The `an-rules.test.ts` regression-guards
> prove the contract.
>
> **D0b implementation notes:**
>
> - `applyAN2` walks each premise's tree via `pe.getExpressions()` and
>   issues two `pe.removeExpression(id, false)` calls per match (inner
>   NOT first, outer NOT second). Both direct (`NOT_outer → NOT_inner →
x`) and buffered (`NOT_outer → formula → NOT_inner → x`) forms are
>   handled.
> - The buffered case leaves a `formula(x)` residue which AN-3 collapses
>   in a subsequent `applyANToFixedPoint` iteration. AN-2 deliberately
>   stops at the NOT-NOT collapse — keeps the rule contract narrow.
> - Cascading chains (NOT-NOT-NOT-NOT-x) converge inside a single
>   `applyAN2` call via an inner `while (premiseChanged)` loop. The
>   outer fixed-point driver still iterates AN-2/3/4/1 but typically
>   exits within 1 iteration for D0b inputs.
> - **P-1 concern parked, not hit.** `pe.removeExpression(id, false)`
>   trips the inline P-1 throw at `expression-manager.ts:863–876` when
>   it would promote a non-not operator as direct child of an operator.
>   For Presentable-clean inputs the formula buffers (inserted by AN-1
>   per-mutation) keep the inner NOT's child = formula, so the throw
>   doesn't fire. The pathological "non-buffered NOT(NOT(operator))"
>   case isn't covered by any existing test; if a future test surfaces
>   it, the fix is to either (a) detect the case and skip the collapse
>   (legacy parity loses), or (b) add a private bypass primitive (D0e
>   may need this anyway for AN-1). Defer until D0e clarifies the
>   `reparentExpression` decision.
>
> **D0c implementation notes (read before D0d):**
>
> - `applyAN3` walks each premise's tree and dispatches by sub-case:
>   (1) 0-child operator → remove via `pe.removeExpression(id, false)`,
>   (2) 1-child non-not operator → same call (promotes single child),
>   (3) 0-child formula → same call, (4) 1-child formula whose bounded
>   subtree has no binary operator → same call.
> - 1-child `not` is NOT collapsed (NOT is unary; `NOT(x)` is its
>   Presentable form). Tested by a dedicated guard.
> - 1-child formula whose bounded subtree DOES contain a binary
>   operator is NOT collapsed (formula is justified per P-3). Tested
>   by a dedicated guard.
> - Local helper `hasBinaryOperatorInBoundedSubtreeFor(pe, id)` mirrors
>   the validator's `hasBinaryOperatorInBoundedSubtree` in
>   `validators/presentable.ts` but operates against
>   `pe.getChildExpressions(id)` so AN-3 doesn't need access to the
>   validator's internal `TChildMap`. The duplication is intentional
>   (validator snapshot would be stale mid-mutation). If a future
>   refactor wants to deduplicate, lift both to a shared util that
>   takes a `(id) => children[]` lookup function.
> - Same P-1 concern as D0b's notes — promoting a non-not operator
>   into an operator parent's slot could trip the inline P-1 throw.
>   For Presentable-clean inputs this is prevented by formula buffers;
>   for pathological inputs the legacy `promoteChild` (private)
>   bypassed the check. Defer the bypass-primitive design to D0e.
>
> **Phase D remaining work after D1:**
>
> - **D2 (next-up)** — Delete the legacy `grammarConfig` / `autoNormalize` / `TGrammarOptions` / `DEFAULT_GRAMMAR_CONFIG` / `PERMISSIVE_GRAMMAR_CONFIG` machinery, the 11 inline P-1 enforcement throws at the briefing §10 sites (with the AN-1 native rewrite already landed, the inline throws are no longer needed — assistive mode handles buffer insertion via the post-mutation hook; permissive mode leaves the unbufferred state and `validate('presentable')` flags it), and the legacy `PremiseEngine.normalizeExpressions()` method. The PERMISSIVE-swap inside `applyANToFixedPoint` becomes unnecessary once the 11 throws are gone — D2 removes it in the same cycle.
> - **D3** — Delete `LOAD_GRAMMAR` / `STRICT_GRAMMAR` snapshot config split (the constants live in `src/lib/types/grammar.ts` which D2 will delete; verify no other references remain).
> - **D4** — Delete deprecated `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` evaluation throw plus the legacy `validate()` no-arg overload + `ArgumentEngine.normalizeAllExpressions`.
> - **D5** — Resolve the `FOLLOWUP(D5)` marker at `proposit-core.ts` (behavior threading through the fork path).
> - **D6** — Interface JSDoc cleanup; sweep the parked P3 carry-overs (`naked-q.ts:71` cast, `em.ts:2506` redundant cast, `toThrowError` deprecation warnings).
>
> **Older history is preserved verbatim below (do not delete) so that
> the C1–C8 design decisions and audit findings stay discoverable.**
>
> ---
>
> **Implementation status — 2026-05-14 (earlier), branch `grammar-tiers/core` at `7491eee`.**
>
> **Phases A, B (all), C1–C5 complete.** Tests at 1578 passed + 2 skipped.
> `pnpm run check` green. Branch is shippable-as-WIP if needed.
>
> Recent commits (newest first):
>
> ```
> 7491eee  C5  — mutations throw on Structural violations regardless of behavior
> 4f5cac6  C4  — four repair primitives (E-1/E-3/E-6/D-3) + engine.getClaim()
> 67ca148  —   — fold C1+C2 dual-review polish (P1 test + 4 P2 doc items)
> c53d33c  —   — engine.validate(tier?) overload (C4 precursor — not in original plan)
> 6ec65b3  C3  — normalize(tier?) global pass on ArgumentEngine
> d49e44b  C2  — AN post-hook bridge (behavior gates auto-normalization)
> 4474665  C1  — behavior + setBehavior() on ArgumentEngine
> d293f57  —   — B4+B5 review polish (P-3 JSDoc + dispatcher D-1 absence assertion)
> f5421f3  —   — D-1 source bug fix (orChildren.length < 2)
> 08a804a  —   — B2+B3 review polish (E-6 flag-all, D-4/D-5 naked-Q, E-5 buffer test)
> 71ffb12  B5  — validate(tier) dispatcher tests
> 5886de3  B4  — Presentable validators
> 313c718  B3  — Derivable validators
> 202acab  B2  — Evaluable validators
> 26e963c  B1.8-14 — Structural validators S-8..S-14
> ee19877  B1.2-7  — Structural validators S-2..S-7
> ```
>
> **Phase C remaining (in order):**
>
> - **C6** — split `populateFromSupports` into `populateFromCitations` +
>   `populateFromAxioms`. **Design refined post-handoff (2026-05-14):**
>   method-arg form remains (`engine.populateFromCitations(claimId,
lookup)`) but the API shape is now **factory + naked-Q-only + no
>   throw on already-populated**. Each method atomically constructs the
>   per-claim derivation premise's expression tree in fully-populated
>   form (`IMPLIES(c, Q)` for n=1, `IMPLIES(OR(c₁,…,cₙ), Q)` for n≥2;
>   AN-1 inserts the formula buffer in assistive mode). If the target
>   premise is **not naked-Q** (already populated with citations or
>   axioms), the factory **no-ops** and returns the existing state — it
>   does NOT throw, per the Structural-only mutation throw rule (see
>   §10 of the briefing). UI/caller is responsible for explicit user
>   consent + clearing the antecedent via a repair primitive before
>   re-calling. Return shape:
>   `{ kind: 'populated' | 'no-op', state: TCoreDerivationPremise,
resolved?: TViolation[] }`. The full refinement (rationale,
>   `TVariableMaterializer` interaction, MDPE intactness) lives in
>   **briefing §7** at
>   `docs/superpowers/briefings/grammar-tiers-core-agenda.md` and in
>   **spec §12** at
>   `docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`.
>   Fresh-session-you reads those before touching C6 code.
> - **C7** — moderate scope; mostly removing `grammarConfig` parameter
>   from `fromSnapshot`/`fromData` + adding a Structural-validation gate
>   at load time.
> - **C8** — small/focused.
>
> **Phase D scope expansion noted (was pure removal):** the AN module
> must own AN-1..AN-4 natively _before_ the legacy plumbing can come
> out. Both `runAssistiveNormalization` (C2) and `normalize(tier?)`'s
> try/finally PE-config swap (C3) currently bridge through
> `PremiseEngine.normalizeExpressions()`, which is driven by the legacy
> per-flag `grammarConfig`. Phase D's first task is spec-direct
> AN-1..AN-4 implementation; only after that can D1 remove MDPE, D2
> remove `grammarConfig` / `autoNormalize` / `TGrammarOptions` /
> `DEFAULT_GRAMMAR_CONFIG` / `PERMISSIVE_GRAMMAR_CONFIG`,
> `computeEffectiveGrammarConfig`, `PremiseEngine.getGrammarConfig`,
> the `normalize(tier?)` try/finally dance, the legacy `validate()`
> no-arg overload, etc.
>
> **Phase D — P-1 throw audit findings (2026-05-14 post-handoff):**
> CLAUDE.md's rule "Mutations enforce only Structural; never throw on
> higher tiers" is currently violated by several inline P-1 enforcement
> throws gated on `grammarConfig.enforceFormulaBetweenOperators`. All
> die wholesale when the AN-1 rewrite lands (their job moves to a true
> post-mutation pass; permissive leaves the unbufferred state and
> `validate('presentable')` flags it). **Do NOT remove these in
> C6/C7/C8** — the AN-1 rewrite must land first so buffer insertion
> has a new home. Sites:
>
> - `src/lib/core/expression-manager.ts:401–406` — `addExpression`
> - `src/lib/core/expression-manager.ts:681–688` — `removeExpression`
> - `src/lib/core/expression-manager.ts:1655, 1963, 2235` —
>   `wrapExpression` + related P-1 sites
> - `src/lib/core/premise-engine.ts:797` — `toggleNegation`
>
> MDPE D-tier throws (`DERIVATION_STRUCTURE_INVALID`,
> `DERIVATION_ANTECEDENT_NON_EMPTY`, `DERIVATION_TYPE_MISMATCH`) die
> wholesale when MDPE itself is removed in D1 — no separate action.
> Throws that stay: entity-not-found checks, all S-rule throws (S-8 /
> S-9 / S-12 / S-13 / S-14), API-shape contracts (forbidden field
> updates, "use toggleNegation" message, permitted operator swaps).
> Full audit in **briefing §10** at
> `docs/superpowers/briefings/grammar-tiers-core-agenda.md`.
>
> **C4 precursor not in original plan:** `engine.validate(tier?)`
> overload was added as a separate commit (`c53d33c`) because all four
> repair primitives need it to discover their target violations. Kept
> as its own commit so any future rework of the bridge surface stays
> isolated from the repair logic. `TArgumentLifecycle` interface JSDoc
> updated; legacy no-arg `validate()` overload preserved until Phase D.
>
> **Design decisions locked through C5:**
>
> - `normalize(tier?)` bypasses `behavior` — user-initiated; runs even
>   in permissive mode. Engine.behavior is not mutated.
> - In v1.0, `tier ∈ {structural, evaluable, derivable}` is a no-op for
>   `normalize()` (forward-compat surface). All AN rules target
>   Presentable invariants in v1.0.
> - Repair primitives respect `behavior` (the per-mutation AN post-hook
>   still gates as usual); `removeOrphanOperators` bypasses (delegates
>   to `normalize()`).
> - Snapshot intentionally omits `behavior` from serialization
>   (consumer re-supplies at restore; defaults to `assistive`); Phase D
>   TODO at `PropositCore.forkArgument` tracks the matched threading.
> - C1+C2 dual-review polish folded: P1 test gap for createPremise() +
>   4 P2 doc/comment items.
> - B4+B5 polish folded: P-3 JSDoc note + dispatcher D-1 absence
>   assertion. P2 (TChildMap dedup) intentionally deferred to Phase D/E.
>
> **Restart-from-fresh-session prerequisites:** read this implementation
> status block, then the briefing at
> `docs/superpowers/briefings/grammar-tiers-core-agenda.md`, then the
> spec at `docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`.
> The plan body below describes Phase A / B / B0 in its pre-restructure
> framing — see the "Design restructure" sub-note below.
>
> ---
>
> **D0 design — locked, ready for fresh-session implementation:**
>
> Goal: implement AN-1..AN-4 directly inside the grammar module, not via
> delegation to `PremiseEngine.normalizeExpressions()` / the legacy
> per-flag `grammarConfig`.
>
> Reference implementation: the existing
> `ExpressionManager.normalize()` at
> `src/lib/core/expression-manager.ts:1390–1610` does AN-1..AN-4 as five
> passes (collapse 0/1-child operators, collapse unjustified formulas,
> insert formula buffers, collapse double negation, absorb same-operator
> through formula). The mechanics are sound; the v1.0 refactor lifts
> them out of the expression manager and into
> `src/lib/grammar/auto-normalize.ts` so that the AN module owns the
> rules natively.
>
> Suggested module layout:
>
> ```ts
> // src/lib/grammar/an-rules.ts (new)
> //
> // One function per rule. Each returns true if it made any change so
> // the driver can iterate to fixed point.
> export function applyAN1(engine): boolean // formula buffer insertion (P-1)
> export function applyAN2(engine): boolean // double negation collapse (P-2)
> export function applyAN3(engine): boolean // 0/1-child collapse (P-3, P-4)
> export function applyAN4(engine): boolean // same-operator absorption through formula (P-5)
>
> export function applyANToFixedPoint(engine): void {
>     // Typical convergence ≤ 3 iterations (spec §5.1).
>     // Apply AN-2, AN-3, AN-4 before AN-1 so the buffer-insertion pass
>     // sees the post-collapse tree (avoids inserting a buffer that
>     // would then need to be collapsed by AN-3).
>     // Safety cap: 10 iterations + invariant assertion.
> }
> ```
>
> The implementation operates on each `PremiseEngine` via the public
> mutation API (`pe.addExpression`, `pe.removeExpression(id, false)` for
> child promotion, `pe.appendExpression`). For formula-buffer insertion
> (AN-1), the cleanest path is to use `pe.wrapExpression` if it exists
> at the right granularity, otherwise add a formula expression then
> reparent the operator under it.
>
> **Critical constraint during D0:** the legacy expression-manager still
> contains the P-1 inline enforcement throws (briefing §8, audit list of
> 11 sites). When the AN-1 buffer-insertion pass runs, it MUST be able
> to add the formula without those throws firing. Pre-D2 (when the
> throws are still in place), the D0 implementation runs each PE's
> grammar config swapped to `PERMISSIVE_GRAMMAR_CONFIG` for the duration
> of the AN pass — the same try/finally dance used by C3's `normalize()`
> and C7's `runLoadTimeValidationCore`. Post-D2, the swap can be
> dropped (the throws no longer exist).
>
> **Refactoring sequence:**
>
> 1. **D0a** — Add `src/lib/grammar/an-rules.ts` with the four `applyANN`
>    functions + `applyANToFixedPoint`, initially delegating to the
>    expression-manager's `normalize()` (effectively a re-export so the
>    new boundary is established without behavior change). Add unit
>    tests per rule in `test/grammar/an-rules.test.ts`.
> 2. **D0b** — Rewrite `applyAN2` (double negation) natively. Simplest
>    rule; uses `pe.removeExpression(id, false)` twice (promotes
>    grandchild through both NOT layers). Validate that
>    `ExpressionManager.normalize()`'s pass 4 still passes the existing
>    tests.
> 3. **D0c** — Rewrite `applyAN3` natively (empty/single-child
>    collapse). Be careful with the "single-child formula collapses only
>    if its bounded subtree has no binary operator" rule — preserve the
>    `hasBinaryOperatorInBoundedSubtree` helper either by lifting it or
>    by exposing it from the validator.
> 4. **D0d** — Rewrite `applyAN4` natively (same-operator absorption
>    through formula).
> 5. **D0e** — Rewrite `applyAN1` natively (formula buffer insertion).
>    Most complex due to the parent-position bookkeeping; use the
>    PERMISSIVE swap to avoid the legacy throw fallback path.
> 6. **D0f** — Rewire `auto-normalize.ts`'s
>    `runAssistiveNormalization` and `normalize.ts`'s
>    `normalizeArgument` to call `applyANToFixedPoint` directly. Delete
>    the try/finally PE-config dance for `normalize` (the dance moves
>    inside `applyANToFixedPoint` until D2 removes it entirely).
>
> Each sub-step lands as its own commit. After D0f, all 1589 existing
> tests should still pass — the only behavior change is _where_ the AN
> rules live, not what they do.
>
> **Then D1** removes
> `ManagedDerivationPremiseEngine` wholesale (its
> `populateFromSupports` was replaced by C6's factory methods; no other
> users remain on the v1.0 surface).
>
> **Then D2** removes the legacy `grammarConfig` / `autoNormalize`
> machinery and the 11 P-1 throw sites listed in briefing §8. The AN-1
> pass from D0 now handles buffer insertion exclusively.
>
> **Then D3–D6** finish the legacy removal + interface JSDoc cleanup
> per the Phase D summary above.

> **Design restructure — 2026-05-14.** Wire-format types
> (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) **now live in
> proposit-core**, not in `@proposit/shared`. Original plan had shared
> own the types and core import them; that direction would have created
> a mutual peer-dep pattern because shared already has
> `@proposit/proposit-core` as a peer dep. After the flip: core
> publishes **first** (owns the wire-format definitions); shared
> publishes second with re-exports + the 422 response envelope. The
> sections below that describe Phase B0 as a "swap to shared imports"
> are superseded — B0 is now a **promotion of the Phase A stub to real
> TypeBox + type exports** with no cross-repo dependency. Phase B1+ /
> C / D / E / F sequencing is unchanged. The Goal / Architecture /
> Tech-stack paragraphs below have been updated; the long-form Task A1
> / B0 sub-step text was not rewritten — read it with the design
> restructure in mind. The full picture lives in
> `docs/superpowers/briefings/grammar-tiers-core-agenda.md` and in
> `docs/release-notes/upcoming.md`. Phases A and B0 are already done
> as of branch `grammar-tiers/core` HEAD; tracking in
> `~/.claude/tasks/grammar-tiers/`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is mandatory: every behavior task starts with a failing test. All TypeScript work must invoke the `brain-style` skill before writing or reviewing code. Commit messages must not include co-author trailers.

**Goal:** Replace the existing `grammarConfig` / `autoNormalize` / `ManagedDerivationPremiseEngine` / `LOAD_GRAMMAR-STRICT_GRAMMAR` machinery in `@proposit/proposit-core` with a four-tier (`structural` ⊇ `evaluable` ⊇ `derivable` ⊇ `presentable`) grammar model, a `validate(tier)` API returning `readonly TViolation[]`, a `normalize(tier?)` global pass, an engine-level `behavior: 'assistive' | 'permissive'` setting with a uniform AN post-mutation hook, targeted repair primitives, and a split `populateFromCitations` / `populateFromAxioms` pair — then ship a 1.0.0 major release.

**Architecture:** Wire-format types (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) live in `proposit-core` (`src/lib/grammar/types.ts` — TypeBox schemas + derived TS types). `@proposit/shared@0.9.0` re-exports them for consumer ergonomics; server and mobile may import from either location. Validators are grouped into one file per tier under `src/lib/grammar/validators/` and aggregated by a `src/lib/grammar/validate.ts` dispatcher that short-circuits per the §7.1 four-case enumeration. Auto-normalization (AN) is implemented as a single post-hook on `ArgumentEngine` that runs the §5.1 rule set in order whenever the engine's `behavior === 'assistive'` and a structural mutation succeeds. Snapshot loading accepts any Structural state; lower-tier violations are queryable post-load. The old `ManagedDerivationPremiseEngine` subclass is deleted; its enforcement folds into the new `validate('derivable')` plus the new Evaluable rule E-6 (claim-derivation pairing). Two methods replace `populateFromSupports`: `populateFromCitations` and `populateFromAxioms`, each operating on one grounding kind — no silent dropping.

**Tech Stack:** TypeScript (strict, ESM, `.js` import suffixes), pnpm, Vitest, ESLint + Prettier, TypeBox (`typebox` package, default-import convention), `@typescript-eslint/naming-convention` (per the `brain-style` skill). Node `>=22.3.0`.

**Cross-repo dependency:** **None.** `proposit-core` publishes first. Adding or renaming a rule code is a single-repo coordinated change — extend the TypeBox union in `src/lib/grammar/types.ts` and ship the validator implementation in the same commit; TypeScript catches drift at build time. `@proposit/shared@0.9.0` publishes _after_ this release with re-exports + the 422 response envelope.

---

## Phase summary and dependency DAG

```
Phase A — No-blocker work (start immediately)
  A0  Branch setup, baseline check
  A1  Local stubs for TGrammarTier / TGrammarRuleCode / TViolation (typed identically to shared's planned exports, swappable in a single import-rewrite)
  A2  Scaffold src/lib/grammar/ directory + empty validator modules + validate() dispatcher signature + AN post-hook signature
  A3  Documentation rewrite scaffolding: stub the new Proposit_Grammar.md sections, README outline
  A4  Failing-test scaffolds for every tier (one describe block per rule, with `it.todo` placeholders)

Phase B — Validators (after shared READY)
  B0  Swap local stubs for `@proposit/shared/schemas/grammar` imports; bump shared dep to ^0.9.0
  B1  Implement Structural validators (S-1..S-14) + tests
  B2  Implement Evaluable validators (E-1, E-3..E-7) + tests
  B3  Implement Derivable validators (D-1..D-6) + tests
  B4  Implement Presentable validators (P-1..P-5) + tests
  B5  Implement validate(tier) dispatcher with four-case short-circuit

Phase C — Engine surface
  C1  Wire `behavior` field + `setBehavior(...)` on ArgumentEngine
  C2  Implement AN post-hook (AN-1..AN-4)
  C3  Implement normalize(tier?) global pass
  C4  Implement repair primitives (removeUnresolvableVariables, removeOrphanOperators, ...)
  C5  Mutation API S-8/S-9/S-12/S-13/S-14 promotion to throw-on-violation
  C6  Split populateFromSupports → populateFromCitations / populateFromAxioms
  C7  Snapshot loading: fromSnapshot/fromData accept any Structural state
  C8  Evaluation no-op on naked-Q (delete DERIVATION_STRUCTURE_INVALID_AT_EVALUATION on naked-Q)

Phase D — Spec-direct AN rewrite + legacy removal
  D0  Rewrite src/lib/grammar/auto-normalize.ts and src/lib/grammar/normalize.ts to implement AN-1..AN-4 directly against the engine's expression tree (no delegation to PremiseEngine.normalizeExpressions / legacy grammarConfig). Until this lands, the legacy plumbing below cannot be removed.
  D1  Delete ManagedDerivationPremiseEngine subclass and its populateFromSupports method (C6 factory split replaces it).
  D2  Delete grammarConfig / autoNormalize / TGrammarOptions / DEFAULT_GRAMMAR_CONFIG / PERMISSIVE_GRAMMAR_CONFIG / TAutoNormalizeConfig / resolveAutoNormalize, plus ArgumentEngine.computeEffectiveGrammarConfig, PremiseEngine.getGrammarConfig, the try/finally PE-config swap in normalizeArgument, and the snapshot's grammarConfig field.
  D2b Remove the P-1 inline enforcement throws that currently violate "Mutations enforce only Structural; never throw on higher tiers" — buffer insertion moves to the AN-1 pass from D0; permissive engines leave the unbufferred state for `validate('presentable')` to flag. Audit list (locked 2026-05-14, see Implementation Status block + briefing §10): `expression-manager.ts:401–406` (addExpression), `:681–688` (removeExpression), `:1655, 1963, 2235` (wrapExpression + related); `premise-engine.ts:797` (toggleNegation).
  D3  Delete LOAD_GRAMMAR / STRICT_GRAMMAR split.
  D4  Delete deprecated DERIVATION_STRUCTURE_INVALID_AT_EVALUATION call site + the legacy validate() no-arg overload + ArgumentEngine.normalizeAllExpressions().
  D5  Address the PropositCore.forkArgument behavior-threading TODO (added in C1+C2 review polish): thread engine.behavior through forkArgumentEngine + snapshot. Decide whether behavior joins the snapshot or stays a constructor-only setting.
  D6  Update all interface JSDoc to reflect the removed surface.

Phase E — Documentation
  E1  Delete docs/Proposit_Grammar.md, write new one per spec §11
  E2  Rewrite README.md
  E3  Rewrite CLAUDE.md "Key design rules" section
  E4  Update CLI_EXAMPLES.md, scripts/smoke-test.sh, examples/arguments/*.yaml
  E5  Update docs/api-reference.md
  E6  Write release-notes/upcoming.md and changelogs/upcoming.md

Phase F — Publish
  F1  Run pnpm run check + smoke-test (baseline green)
  F2  SendMessage team-lead with proposed version + changelog summary; wait for green light
  F3  pnpm version major; rename upcoming.md → v1.0.0.md (release-notes + changelogs)
  F4  pnpm publish --access public (human OTP)
  F5  git tag v1.0.0; push branch + tag; open PR; merge
  F6  Post READY: on broker thread grammar-tiers
```

Dependencies:

- A0 → A1 → (A2, A3, A4 in parallel)
- (A2, A4) → B0 (which requires shared READY)
- B0 → B1 → B2 → B3 → B4 → B5 (validators must compile in tier order so dispatcher can compose them; but tests inside each tier may be authored before later tiers exist)
- B5 → C1..C8 (engine surface depends on validators)
- C5 → D1, D2, D3 (cannot remove old machinery until new mutation enforcement is in place)
- E1..E5 may begin in parallel with B/C once the API shape is locked (after C1)
- F1..F6 strictly sequential at end

---

## File structure changes

### New files

| Path                                           | Responsibility                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/grammar/types.ts`                     | (Phase A only) Local stubs of `TGrammarTier`, `TGrammarRuleCode`, `TViolation`. Deleted in B0 — replaced with `import type { ... } from "@proposit/shared/schemas/grammar"`. |
| `src/lib/grammar/validators/structural.ts`     | S-1..S-14 validators. One exported function per rule plus a `validateStructural(args, ctx): readonly TViolation[]` aggregator.                                               |
| `src/lib/grammar/validators/evaluable.ts`      | E-1, E-3, E-4, E-5, E-6, E-7. `'E-2'` reserved (comment).                                                                                                                    |
| `src/lib/grammar/validators/derivable.ts`      | D-1..D-6. `'D-7'` reserved (comment).                                                                                                                                        |
| `src/lib/grammar/validators/presentable.ts`    | P-1..P-5.                                                                                                                                                                    |
| `src/lib/grammar/validators/context.ts`        | Shared `TValidatorContext` view (premises, expressions, variables, claims, role state) consumed by all four validator modules. Pure data — no engine reference.              |
| `src/lib/grammar/validate.ts`                  | Top-level dispatcher `validate(tier: TGrammarTier, ctx: TValidatorContext): readonly TViolation[]`. Implements §7.1's four-case union.                                       |
| `src/lib/grammar/normalize.ts`                 | Global `normalize(tier, ctx, mutator): void` pass that re-applies AN rules everywhere they can fire.                                                                         |
| `src/lib/grammar/auto-normalize.ts`            | Post-mutation `runAssistiveNormalization(engine, changeset): TCoreMutationResult` hook running AN-1..AN-4 in order.                                                          |
| `src/lib/grammar/repair.ts`                    | Targeted repair primitives — `removeUnresolvableVariables`, `removeOrphanOperators`, etc. Each returns the violations it resolved.                                           |
| `test/grammar/structural.test.ts`              | Per-rule validator tests for S-1..S-14.                                                                                                                                      |
| `test/grammar/evaluable.test.ts`               | Per-rule validator tests for E-1, E-3..E-7.                                                                                                                                  |
| `test/grammar/derivable.test.ts`               | Per-rule validator tests for D-1..D-6.                                                                                                                                       |
| `test/grammar/presentable.test.ts`             | Per-rule validator tests for P-1..P-5.                                                                                                                                       |
| `test/grammar/validate-dispatcher.test.ts`     | Coverage of `validate(tier)`'s four-case short-circuit semantics.                                                                                                            |
| `test/grammar/auto-normalize.test.ts`          | Coverage of AN post-hook in `assistive` mode + bypass in `permissive`.                                                                                                       |
| `test/grammar/normalize.test.ts`               | Coverage of the global `normalize()` pass and tier parameter forward-compat behavior.                                                                                        |
| `test/grammar/repair.test.ts`                  | Per-primitive tests + AN-respects-behavior tests.                                                                                                                            |
| `test/grammar/populate-from-citations.test.ts` | Tests for the new `populateFromCitations` method.                                                                                                                            |
| `test/grammar/populate-from-axioms.test.ts`    | Tests for the new `populateFromAxioms` method.                                                                                                                               |
| `test/grammar/snapshot-loading.test.ts`        | Tests that `fromSnapshot`/`fromData` accept any Structural state.                                                                                                            |
| `docs/Proposit_Grammar.md`                     | **New file at same path as the deleted one.** Per spec §11 ToC.                                                                                                              |

### Modified files

| Path                                                                                  | Change                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                                        | Bump `@proposit/shared` to `^0.9.0`. Bump version to `1.0.0` at publish time.                                                                                                                                                                               |
| `src/lib/index.ts`                                                                    | Remove exports of `ManagedDerivationPremiseEngine`, `TVariableMaterializer`, `TGrammarConfig`/`TGrammarOptions`/`TAutoNormalizeConfig`/`DEFAULT_GRAMMAR_CONFIG`/`PERMISSIVE_GRAMMAR_CONFIG`/`resolveAutoNormalize`. Add new exports for the grammar module. |
| `src/lib/core/argument-engine.ts`                                                     | Add `validate(tier)`, `normalize(tier?)`, `behavior`, `setBehavior(...)`, and repair primitives. Wire AN post-hook. Drop `validateDerivationStructures` (folds into D-1).                                                                                   |
| `src/lib/core/premise-engine.ts`                                                      | Remove `grammarConfig` option threading + per-flag `resolveAutoNormalize` calls. Mutations now enforce _only_ Structural rules and throw on violation; they don't auto-fix. Add S-8/S-9 enforcement (position invariants previously enforced indirectly).   |
| `src/lib/core/expression-manager.ts`                                                  | Same shape changes as `premise-engine.ts` — strip per-flag config reads.                                                                                                                                                                                    |
| `src/lib/core/argument-engine.ts` (`fromSnapshot`/`fromData`)                         | Drop `grammarConfig` parameter; accept any Structural state; surface load failures only for Structural breakage.                                                                                                                                            |
| `src/lib/core/proposit-core.ts`                                                       | Drop `grammarConfig` wiring; add `behavior` option to `TPropositCoreOptions`.                                                                                                                                                                               |
| `src/lib/core/argument-engine.ts` (`evaluate`/`checkValidity`/`validateEvaluability`) | Skip naked-Q derivation premises rather than throwing.                                                                                                                                                                                                      |
| `src/lib/core/interfaces/argument-engine.interfaces.ts`                               | New JSDoc for `validate`, `normalize`, `behavior`, `setBehavior`, repair primitives. Remove JSDoc for removed APIs.                                                                                                                                         |
| `src/lib/core/interfaces/premise-engine.interfaces.ts`                                | Remove references to old auto-normalize flags.                                                                                                                                                                                                              |
| `src/lib/types/grammar.ts`                                                            | **Deleted** (Phase D2).                                                                                                                                                                                                                                     |
| `src/lib/types/fork.ts`                                                               | Remove `grammarConfig?: TGrammarConfig` field.                                                                                                                                                                                                              |
| `src/lib/types/validation.ts`                                                         | Remove `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`. Most existing codes remain — they continue to identify _engine errors_ (throws), distinct from the new `TGrammarRuleCode` _violation codes_. Add a comment clarifying the two namespaces.              |
| `src/lib/core/managed-derivation-premise-engine.ts`                                   | **Deleted** (Phase D1).                                                                                                                                                                                                                                     |
| `src/cli/commands/repair.ts`                                                          | Update to use new repair-primitive APIs.                                                                                                                                                                                                                    |
| `src/cli/commands/premises.ts`                                                        | Update to drop autoNormalize flags.                                                                                                                                                                                                                         |
| `src/cli/engine.ts`                                                                   | Update to drop grammarConfig option.                                                                                                                                                                                                                        |
| `src/lib/parsing/argument-parser.ts`                                                  | Drop grammarConfig option threading.                                                                                                                                                                                                                        |
| `README.md`                                                                           | Full rewrite.                                                                                                                                                                                                                                               |
| `CLAUDE.md`                                                                           | Rewrite "Key design rules" section.                                                                                                                                                                                                                         |
| `CLI_EXAMPLES.md`                                                                     | Update flags + remove old autoNormalize examples.                                                                                                                                                                                                           |
| `scripts/smoke-test.sh`                                                               | Update flags.                                                                                                                                                                                                                                               |
| `examples/arguments/*.yaml`                                                           | Confirm still load under new model (likely no change needed).                                                                                                                                                                                               |
| `docs/api-reference.md`                                                               | Full pass for new API.                                                                                                                                                                                                                                      |
| `docs/release-notes/upcoming.md`                                                      | User-facing release notes for 1.0.0.                                                                                                                                                                                                                        |
| `docs/changelogs/upcoming.md`                                                         | Developer changelog with commit hash ranges.                                                                                                                                                                                                                |

### Deleted files

- `src/lib/core/managed-derivation-premise-engine.ts`
- `src/lib/types/grammar.ts`
- `docs/Proposit_Grammar.md` (replaced by a same-path rewrite)

---

# Phase A — Pre-shared work (begin immediately)

Phase A is independent of `@proposit/shared@^0.9.0` shipping. It produces a feature branch, type-stub scaffolding, an empty `src/lib/grammar/` tree, failing-test skeletons for every rule, and the beginnings of the documentation rewrite. None of this changes engine behavior; everything is additive or scoped to new files.

## Task A0: Branch setup + baseline check

**Files:**

- None (git only).

- [ ] **Step 1: Create and check out the feature branch**

Run:

```bash
git checkout -b grammar-tiers/core
```

- [ ] **Step 2: Confirm baseline is green**

Run:

```bash
pnpm run check
```

Expected: all of typecheck, lint, build, test pass. (Verified already: 2026-05-14, `pnpm run check` exit code 0.)

- [ ] **Step 3: Confirm smoke test is green (requires build first)**

Run:

```bash
bash scripts/smoke-test.sh
```

Expected: smoke test exits 0.

- [ ] **Step 4: Commit branch baseline marker (empty doc note)**

No commit yet — wait until A1 lands the first concrete file.

---

## Task A1: Local type stubs for shared wire format

**Goal:** Define `TGrammarTier`, `TGrammarRuleCode`, `TViolation` locally with the same shape `@proposit/shared@^0.9.0` will export. In Phase B0 we replace the stub file's contents with a single `export type { ... } from "@proposit/shared/schemas/grammar"` re-export and delete the local definitions — leaving the stub _path_ unchanged so downstream files don't need to rewrite imports.

**Files:**

- Create: `src/lib/grammar/types.ts`
- Test: none (pure type aliases; type errors at build time are the test)

- [ ] **Step 1: Write the file**

```ts
// src/lib/grammar/types.ts
//
// PHASE A STUB. In Phase B0 the body of this file is replaced with a
// re-export from `@proposit/shared/schemas/grammar`. The exported names
// (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) remain unchanged, so
// internal callers do not need to rewrite imports across the swap.
//
// Definitions kept identical to spec §7.1 so the swap is structurally
// transparent.

export type TGrammarTier =
    | "structural"
    | "evaluable"
    | "derivable"
    | "presentable"

// Codes 'E-2' and 'D-7' are intentionally absent — those rules were
// promoted/restated in the spec and their codes are reserved (not reused)
// to keep historical references unambiguous.
export type TGrammarRuleCode =
    | "S-1"
    | "S-2"
    | "S-3"
    | "S-4"
    | "S-5"
    | "S-6"
    | "S-7"
    | "S-8"
    | "S-9"
    | "S-10"
    | "S-11"
    | "S-12"
    | "S-13"
    | "S-14"
    | "E-1"
    | "E-3"
    | "E-4"
    | "E-5"
    | "E-6"
    | "E-7"
    | "D-1"
    | "D-2"
    | "D-3"
    | "D-4"
    | "D-5"
    | "D-6"
    | "P-1"
    | "P-2"
    | "P-3"
    | "P-4"
    | "P-5"

export type TViolation = {
    tier: TGrammarTier
    code: TGrammarRuleCode
    message: string
    argumentId?: string
    premiseId?: string
    expressionId?: string
    variableId?: string
    claimId?: string
}
```

- [ ] **Step 2: Re-export the types from the library barrel**

Edit `src/lib/index.ts`:

```ts
export type {
    TGrammarTier,
    TGrammarRuleCode,
    TViolation,
} from "./grammar/types.js"
```

(Add this near the other `./types/*` exports.)

- [ ] **Step 3: Build to confirm**

Run:

```bash
pnpm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/grammar/types.ts src/lib/index.ts
git commit -m "feat(grammar): add local stubs for shared wire-format types (TGrammarTier, TGrammarRuleCode, TViolation)"
```

---

## Task A2: Scaffold the grammar module tree

**Goal:** Create the validator-module skeleton with empty exported functions so that the dispatcher and tests can reference them by name from day one. Every validator returns `[]` for now; tests written in A4 will fail.

**Files:**

- Create: `src/lib/grammar/validators/context.ts`
- Create: `src/lib/grammar/validators/structural.ts`
- Create: `src/lib/grammar/validators/evaluable.ts`
- Create: `src/lib/grammar/validators/derivable.ts`
- Create: `src/lib/grammar/validators/presentable.ts`
- Create: `src/lib/grammar/validate.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Create `src/lib/grammar/validators/context.ts`**

```ts
// src/lib/grammar/validators/context.ts
//
// Pure data view consumed by every tier's validators. No engine references.
// Built by ArgumentEngine.validate() before delegating to the dispatcher.

import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../../schemata/index.js"
import type { TCoreArgumentRoleState } from "../../types/evaluation.js"

export type TValidatorContext = {
    argument: TCoreArgument
    premises: readonly TCorePremise[]
    expressions: readonly TCorePropositionalExpression[]
    variables: readonly TCorePropositionalVariable[]
    claims: readonly TCoreClaim[]
    roleState: TCoreArgumentRoleState
}
```

- [ ] **Step 2: Create `src/lib/grammar/validators/structural.ts`**

```ts
// src/lib/grammar/validators/structural.ts
//
// S-1..S-14. Each rule has an exported function with the signature
// (ctx: TValidatorContext) => readonly TViolation[]. The aggregator
// validateStructural runs every rule and concatenates the results.
//
// S-1  FK soundness
// S-2  operator types
// S-3  variable required reference
// S-4  no cycles
// S-5  root-only IMPLIES/IFF
// S-6  premise type discriminator consistency
// S-7  claim type immutability  (creation-time invariant; runtime no-op)
// S-8  binary operator arity + positions
// S-9  sibling position uniqueness
// S-10 entity ID uniqueness
// S-11 variable symbol uniqueness
// S-12 NOT unary arity
// S-13 formula unary arity
// S-14 derivation premise root operator

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateS1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS2(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS6(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS7(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS8(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS9(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS10(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS11(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS12(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS13(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS14(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

export function validateStructural(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateS1(ctx),
        ...validateS2(ctx),
        ...validateS3(ctx),
        ...validateS4(ctx),
        ...validateS5(ctx),
        ...validateS6(ctx),
        ...validateS7(ctx),
        ...validateS8(ctx),
        ...validateS9(ctx),
        ...validateS10(ctx),
        ...validateS11(ctx),
        ...validateS12(ctx),
        ...validateS13(ctx),
        ...validateS14(ctx),
    ]
}
```

- [ ] **Step 3: Create `src/lib/grammar/validators/evaluable.ts`**

```ts
// src/lib/grammar/validators/evaluable.ts
//
// E-1, E-3, E-4, E-5, E-6, E-7. Codes 'E-2' is reserved — see spec §4.2.
//
// E-1  variadic operator arity floor (and/or ≥ 2 children)
// E-3  variable binding resolves
// E-4  axiomatic-binding constraint (runtime guard; ctx-only checker is a no-op,
//      documented in JSDoc)
// E-5  derivation premise consequent present
// E-6  claim-derivation pairing (≤ 1 derivation premise per normal claim)
// E-7  argument has conclusion premise

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateE1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
// 'E-2' reserved — not used.
export function validateE3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE6(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE7(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

export function validateEvaluable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateE1(ctx),
        ...validateE3(ctx),
        ...validateE4(ctx),
        ...validateE5(ctx),
        ...validateE6(ctx),
        ...validateE7(ctx),
    ]
}
```

- [ ] **Step 4: Create `src/lib/grammar/validators/derivable.ts`**

```ts
// src/lib/grammar/validators/derivable.ts
//
// D-1..D-6. Code 'D-7' is reserved — see spec §4.3.
//
// D-1 derivation premise canonical shape (naked-Q or populated)
// D-2 single-citation derivation form (IMPLIES(c, Q), no OR wrapper)
// D-3 no mixing axioms and citations in one derivation
// D-4 axiomatic claim placement (only in derivation antecedent)
// D-5 citation claim placement (only in derivation antecedent)
// D-6 derivation premise role (supporting, not conclusion)

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateD1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD2(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD6(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
// 'D-7' reserved — not used.

export function validateDerivable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateD1(ctx),
        ...validateD2(ctx),
        ...validateD3(ctx),
        ...validateD4(ctx),
        ...validateD5(ctx),
        ...validateD6(ctx),
    ]
}
```

- [ ] **Step 5: Create `src/lib/grammar/validators/presentable.ts`**

```ts
// src/lib/grammar/validators/presentable.ts
//
// P-1..P-5.
//
// P-1 formula buffer between operators
// P-2 no double negation
// P-3 formula has operator descendant
// P-4 no single-child binary operator (largely redundant with E-1)
// P-5 no operator-of-same-type adjacency through a formula

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateP1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP2(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

export function validatePresentable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateP1(ctx),
        ...validateP2(ctx),
        ...validateP3(ctx),
        ...validateP4(ctx),
        ...validateP5(ctx),
    ]
}
```

- [ ] **Step 6: Create `src/lib/grammar/validate.ts`**

```ts
// src/lib/grammar/validate.ts
//
// Dispatcher per spec §7.1. Returns the union of violations across all
// tiers up to and including the requested tier (Structural is most
// permissive; Presentable is strictest):
//
//   validate('structural')  → Structural violations only.
//   validate('evaluable')   → Structural + Evaluable.
//   validate('derivable')   → Structural + Evaluable + Derivable.
//   validate('presentable') → Structural + Evaluable + Derivable + Presentable.
//
// Never throws on grammar issues; only throws on invalid argument shapes
// that prevent dispatch.

import type { TGrammarTier, TViolation } from "./types.js"
import type { TValidatorContext } from "./validators/context.js"
import { validateStructural } from "./validators/structural.js"
import { validateEvaluable } from "./validators/evaluable.js"
import { validateDerivable } from "./validators/derivable.js"
import { validatePresentable } from "./validators/presentable.js"

export function validate(
    tier: TGrammarTier,
    ctx: TValidatorContext
): readonly TViolation[] {
    const structural = validateStructural(ctx)
    if (tier === "structural") return structural
    const evaluable = [...structural, ...validateEvaluable(ctx)]
    if (tier === "evaluable") return evaluable
    const derivable = [...evaluable, ...validateDerivable(ctx)]
    if (tier === "derivable") return derivable
    return [...derivable, ...validatePresentable(ctx)]
}
```

- [ ] **Step 7: Re-export from `src/lib/index.ts`**

Add near the existing exports:

```ts
export { validate as validateGrammar } from "./grammar/validate.js"
export type { TValidatorContext } from "./grammar/validators/context.js"
```

Use the `validateGrammar` re-export name only at the library boundary to avoid conflict with the existing `validateArgument` / `validateArgumentEvaluability` exports. The `ArgumentEngine.validate(tier)` method (Phase C) calls the internal function directly.

- [ ] **Step 8: Typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/grammar src/lib/index.ts
git commit -m "feat(grammar): scaffold src/lib/grammar tree (validator modules return empty arrays; validate(tier) dispatcher wired)"
```

---

## Task A3: Documentation rewrite — start the new `Proposit_Grammar.md`

**Goal:** Begin the durable grammar reference now while the code work is blocked on shared. The old file stays in place for now (deleted in E1); the new content goes into a temporary scratch file that becomes the new doc in E1.

**Files:**

- Create: `docs/Proposit_Grammar.draft.md` (scratch file; renamed in E1)

- [ ] **Step 1: Stub the new doc with the §11 ToC**

```md
# Proposit Grammar Reference

> **Status — draft (grammar-tiers/core, 2026-05).** This doc replaces the
> pre-1.0 `Proposit_Grammar.md`, which covered only the formula-string
> parser grammar. The new model spans the entire engine: the four-tier
> grammar (Structural / Evaluable / Derivable / Presentable), enforcement
> gates, auto-normalization, the `validate(tier)` / `normalize(tier?)` API,
> and the rule-code wire format.
>
> The cross-repo design spec lives at
> `proposit-orchestration/docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`
> and is the source of truth for §2–§6 here.

## 1. Formula-string parser grammar

_(preserved verbatim from the pre-1.0 doc)_

## 2. The four-tier model

- 2.1 Definitions
- 2.2 The subset chain
- 2.3 Enforcement gates

## 3. Rule inventory

- 3.1 Structural rules (S-1..S-14)
- 3.2 Evaluable rules (E-1, E-3..E-7; E-2 reserved)
- 3.3 Derivable rules (D-1..D-6; D-7 reserved)
- 3.4 Presentable rules (P-1..P-5)

For each rule: tier, code, statement, examples of valid + invalid states,
which validator function checks it.

## 4. Engine behavior and auto-normalization

- 4.1 `behavior: 'assistive' | 'permissive'`
- 4.2 AN rule set (AN-1..AN-4)
- 4.3 Worked examples — AN preserves Presentable across each mutation kind

## 5. `normalize(tier?)` contract

- 5.1 What `normalize` does
- 5.2 What `normalize` does _not_ do
- 5.3 Worked examples
- 5.4 Forward-compat `tier` parameter

## 6. Validation output reference

- 6.1 `TViolation` shape
- 6.2 `TGrammarRuleCode` namespace
- 6.3 Example validation responses

## 7. Migration notes (pre-1.0 → 1.0)

- 7.1 Removed: `grammarConfig`, `autoNormalize`, `enforceFormulaBetweenOperators`
- 7.2 Removed: `LOAD_GRAMMAR` / `STRICT_GRAMMAR` split
- 7.3 Removed: `ManagedDerivationPremiseEngine`
- 7.4 Replaced: `populateFromSupports` → `populateFromCitations` + `populateFromAxioms`
- 7.5 Behavioral change: naked-Q is a valid Derivable state, eval no-op
- 7.6 Behavioral change: snapshot loading accepts any Structural state
```

- [ ] **Step 2: Copy the formula-string parser grammar from the existing doc into §1**

Open `docs/Proposit_Grammar.md` and copy everything from `## Quick Reference` through the end into the new doc under `## 1. Formula-string parser grammar`, adjusting heading levels by one (e.g., `## Quick Reference` becomes `### 1.1 Quick Reference`).

- [ ] **Step 3: Commit**

```bash
git add docs/Proposit_Grammar.draft.md
git commit -m "docs(grammar): scaffold new Proposit_Grammar.md with spec §11 ToC; preserve parser grammar in §1"
```

---

## Task A4: Failing-test scaffolds for every tier

**Goal:** Use Vitest `.todo` markers to lock in test naming + locations for every rule. After B1..B4 each `.todo` becomes a real assertion. Tests that _can_ be written now without shared imports (since the stub types are local) are written as failing assertions where possible.

**Files:**

- Create: `test/grammar/structural.test.ts`
- Create: `test/grammar/evaluable.test.ts`
- Create: `test/grammar/derivable.test.ts`
- Create: `test/grammar/presentable.test.ts`
- Create: `test/grammar/validate-dispatcher.test.ts`

- [ ] **Step 1: Create `test/grammar/structural.test.ts`**

```ts
import { describe, it } from "vitest"

describe("grammar/structural", () => {
    describe("S-1 FK soundness", () => {
        it.todo(
            "returns a violation when expression.parentId points at a missing expression"
        )
        it.todo(
            "returns a violation when variable.boundPremiseId points at a missing premise"
        )
        it.todo(
            "returns a violation when claim-bound variable.claimId points at a missing claim"
        )
        it.todo("returns an empty array when every FK resolves")
    })

    describe("S-2 operator types", () => {
        it.todo(
            "returns a violation when expression.type is not one of the allowed discriminators"
        )
        it.todo("returns an empty array for every legal operator type")
    })

    describe("S-3 variable required reference", () => {
        it.todo(
            "returns a violation when a variable has neither claim ref nor premise ref"
        )
        it.todo(
            "returns a violation when a variable has both claim ref and premise ref"
        )
        it.todo(
            "returns an empty array when exactly one of the two refs is present"
        )
    })

    describe("S-4 no cycles", () => {
        it.todo(
            "returns a violation when the expression tree of a premise has a cycle"
        )
        it.todo(
            "returns a violation when the argument's claim/citation/axiom graph has a cycle"
        )
        it.todo("returns an empty array for acyclic graphs")
    })

    describe("S-5 root-only IMPLIES/IFF", () => {
        it.todo("returns a violation when implies appears as a non-root child")
        it.todo("returns a violation when iff appears as a non-root child")
        it.todo(
            "returns a violation when a premise has more than one implies/iff at root"
        )
        it.todo(
            "returns an empty array when implies/iff is exactly at root and there's at most one per premise"
        )
    })

    describe("S-6 premise type discriminator consistency", () => {
        it.todo(
            "returns a violation when type='derivation' premise has null derivedClaimId"
        )
        it.todo(
            "returns a violation when type='freeform' premise has non-null derivedClaimId"
        )
        it.todo(
            "returns an empty array for consistent type+derivedClaimId pairs"
        )
    })

    describe("S-7 claim type immutability", () => {
        // S-7 is a creation-time invariant enforced by ClaimLibrary; the
        // validator is a no-op at the AST level. The test confirms it.
        it.todo(
            "validateS7 returns an empty array for any context (rule is creation-time only)"
        )
    })

    describe("S-8 binary operator arity + positions", () => {
        it.todo("returns a violation when implies has != 2 children")
        it.todo("returns a violation when iff has != 2 children")
        it.todo(
            "returns a violation when implies' children are not at positions 0 and 1"
        )
        it.todo(
            "returns a violation when iff's children are not at positions 0 and 1"
        )
        it.todo("returns an empty array for IMPLIES(a@0, b@1)")
    })

    describe("S-9 sibling position uniqueness", () => {
        it.todo(
            "returns a violation when two siblings under the same parent share a position value"
        )
        it.todo(
            "returns an empty array when every sibling group has unique positions"
        )
    })

    describe("S-10 entity ID uniqueness", () => {
        it.todo(
            "returns a violation when two premises in the same argument share an ID"
        )
        it.todo(
            "returns a violation when two expressions in the same argument share an ID"
        )
        it.todo(
            "returns a violation when two variables in the same argument share an ID"
        )
        it.todo("returns an empty array when all entity IDs are unique")
    })

    describe("S-11 variable symbol uniqueness", () => {
        it.todo(
            "returns a violation when two variables share a symbol within an argument"
        )
        it.todo("returns an empty array when every variable's symbol is unique")
    })

    describe("S-12 NOT unary arity", () => {
        it.todo("returns a violation when a not expression has 0 children")
        it.todo("returns a violation when a not expression has 2 children")
        it.todo("returns an empty array when every not has exactly one child")
    })

    describe("S-13 formula unary arity", () => {
        it.todo("returns a violation when a formula expression has 0 children")
        it.todo("returns a violation when a formula expression has 2+ children")
        it.todo(
            "returns an empty array when every formula has exactly one child"
        )
    })

    describe("S-14 derivation premise root operator", () => {
        it.todo("returns a violation when a derivation premise root is 'and'")
        it.todo("returns a violation when a derivation premise root is 'or'")
        it.todo("returns a violation when a derivation premise root is 'not'")
        it.todo(
            "returns a violation when a derivation premise root is 'formula'"
        )
        it.todo(
            "returns an empty array when the root is 'variable', 'implies', or 'iff'"
        )
    })

    describe("aggregator validateStructural", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
```

- [ ] **Step 2: Create `test/grammar/evaluable.test.ts`**

```ts
import { describe, it } from "vitest"

describe("grammar/evaluable", () => {
    describe("E-1 variadic operator arity floor", () => {
        it.todo("returns a violation when 'and' has 0 children")
        it.todo("returns a violation when 'and' has 1 child")
        it.todo("returns a violation when 'or' has 0 children")
        it.todo("returns a violation when 'or' has 1 child")
        it.todo("returns an empty array when 'and' and 'or' have 2+ children")
    })

    // E-2 is reserved — see spec §4.2. No test block.

    describe("E-3 variable binding resolves", () => {
        it.todo(
            "returns a violation when a claim-bound variable references a non-existent claim"
        )
        it.todo(
            "returns a violation when a premise-bound variable references a non-existent premise"
        )
        it.todo("returns an empty array when every binding resolves")
    })

    describe("E-4 axiomatic-binding constraint (no-op at AST level)", () => {
        // E-4 is a runtime guard on caller-supplied evaluation input. The
        // validator cannot detect it from the argument tree alone. Documented
        // in JSDoc; the test confirms ctx-only checker is a no-op.
        it.todo(
            "validateE4 returns an empty array regardless of argument shape (runtime-only guard)"
        )
    })

    describe("E-5 derivation premise consequent present", () => {
        it.todo(
            "returns a violation when a derivation premise's tree contains no variable bound to derivedClaimId"
        )
        it.todo(
            "returns an empty array for naked-Q (lone variable at root is the consequent)"
        )
        it.todo(
            "returns an empty array for populated form (consequent at position 1)"
        )
    })

    describe("E-6 claim-derivation pairing", () => {
        it.todo(
            "returns a violation when a normal claim has 2+ derivation premises with matching derivedClaimId"
        )
        it.todo(
            "returns an empty array when a normal claim has 0 derivation premises (post-pruning state)"
        )
        it.todo(
            "returns an empty array when a normal claim has exactly 1 derivation premise (mid-edit state)"
        )
    })

    describe("E-7 argument has conclusion premise", () => {
        it.todo(
            "returns a violation when an argument with premises has no conclusion designated"
        )
        it.todo(
            "returns an empty array for an argument with zero premises (brand-new)"
        )
        it.todo(
            "returns an empty array for an argument with one conclusion premise designated"
        )
    })

    describe("aggregator validateEvaluable", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
```

- [ ] **Step 3: Create `test/grammar/derivable.test.ts`**

```ts
import { describe, it } from "vitest"

describe("grammar/derivable", () => {
    describe("D-1 derivation premise canonical shape", () => {
        it.todo(
            "accepts naked-Q form (single variable at root bound to derivedClaimId)"
        )
        it.todo(
            "accepts populated form IMPLIES(citation-var, Q) (single citation)"
        )
        it.todo(
            "accepts populated form IMPLIES(OR(citation-vars...), Q) (multi-citation)"
        )
        it.todo(
            "accepts populated form with intervening formula buffer IMPLIES(formula(OR(...)), Q)"
        )
        it.todo("rejects populated form with IFF at root")
        it.todo(
            "rejects populated form where antecedent mixes axioms and citations"
        )
        it.todo(
            "rejects populated form where antecedent is a non-claim variable"
        )
    })

    describe("D-2 single-citation derivation form", () => {
        it.todo(
            "rejects IMPLIES(OR(single-citation-var), Q) — should be IMPLIES(citation-var, Q)"
        )
        it.todo("accepts IMPLIES(citation-var, Q)")
    })

    describe("D-3 no mixing axioms and citations in one derivation", () => {
        it.todo("rejects IMPLIES(OR(axiom-var, citation-var), Q)")
        it.todo("rejects IMPLIES(formula(OR(axiom-var, citation-var)), Q)")
        it.todo("accepts IMPLIES(OR(citation-var, citation-var), Q)")
        it.todo("accepts IMPLIES(OR(axiom-var, axiom-var), Q)")
    })

    describe("D-4 axiomatic claim placement", () => {
        it.todo(
            "rejects axiomatic-bound variable appearing in a freeform premise"
        )
        it.todo(
            "rejects axiomatic-bound variable at the consequent slot of a derivation premise"
        )
        it.todo(
            "accepts axiomatic-bound variable in the antecedent of a derivation premise"
        )
    })

    describe("D-5 citation claim placement", () => {
        it.todo("rejects citation-bound variable in a freeform premise")
        it.todo(
            "rejects citation-bound variable at the consequent slot of a derivation premise"
        )
        it.todo(
            "accepts citation-bound variable in the antecedent of a derivation premise"
        )
    })

    describe("D-6 derivation premise role", () => {
        it.todo("rejects a derivation premise designated as conclusion")
        it.todo("accepts a derivation premise as supporting")
    })

    // D-7 reserved — see spec §4.3. No test block.

    describe("aggregator validateDerivable", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
```

- [ ] **Step 4: Create `test/grammar/presentable.test.ts`**

```ts
import { describe, it } from "vitest"

describe("grammar/presentable", () => {
    describe("P-1 formula buffer between operators", () => {
        it.todo("rejects AND(OR(...), ...) — OR is a direct child of AND")
        it.todo("rejects OR(AND(...), ...) — AND is a direct child of OR")
        it.todo("accepts AND(formula(OR(...)), ...) — buffer between operators")
        it.todo(
            "accepts NOT(AND(...)) — not is exempt as a child of an operator"
        )
        it.todo(
            "accepts AND(NOT(...), ...) — not as a child of an operator is allowed"
        )
    })

    describe("P-2 no double negation", () => {
        it.todo("rejects NOT(NOT(x))")
        it.todo("accepts NOT(x) for any x")
    })

    describe("P-3 formula has operator descendant", () => {
        it.todo("rejects formula(variable) — leaf wrapper")
        it.todo(
            "rejects formula(NOT(variable)) — single not, no binary operator"
        )
        it.todo("accepts formula(AND(...))")
        it.todo("accepts formula(OR(...))")
    })

    describe("P-4 no single-child binary operator", () => {
        it.todo("rejects AND with 1 child")
        it.todo("rejects OR with 1 child")
        it.todo("accepts AND/OR with 2+ children")
    })

    describe("P-5 no operator-of-same-type adjacency through a formula", () => {
        it.todo("rejects AND(formula(AND(B, C)), D)")
        it.todo("rejects OR(formula(OR(B, C)), D)")
        it.todo("accepts AND(formula(OR(B, C)), D)")
    })

    describe("aggregator validatePresentable", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
```

- [ ] **Step 5: Create `test/grammar/validate-dispatcher.test.ts`**

```ts
import { describe, it } from "vitest"

describe("grammar/validate dispatcher (spec §7.1)", () => {
    it.todo("validate('structural') returns Structural violations only")
    it.todo(
        "validate('evaluable') returns Structural + Evaluable violations in that order"
    )
    it.todo(
        "validate('derivable') returns Structural + Evaluable + Derivable in that order"
    )
    it.todo(
        "validate('presentable') returns Structural + Evaluable + Derivable + Presentable in that order"
    )
    it.todo(
        "returns an empty array when the context is at the requested tier or stricter"
    )
    it.todo("never throws on grammar issues")
})
```

- [ ] **Step 6: Run the test suite to confirm the todos register**

Run:

```bash
pnpm run test -- grammar
```

Expected: every test in `test/grammar/*.test.ts` reports as `todo`; total test suite passes (todos are not failures in Vitest).

- [ ] **Step 7: Commit**

```bash
git add test/grammar/
git commit -m "test(grammar): scaffold per-rule test files with it.todo entries for every Structural/Evaluable/Derivable/Presentable rule and the dispatcher"
```

---

## Task A5: Confirm baseline still green; SendMessage team-lead

- [ ] **Step 1: Final Phase A baseline**

Run:

```bash
pnpm run check
```

Expected: green.

- [ ] **Step 2: Notify team-lead**

SendMessage to `team-lead`:

> Phase A complete. Branch `grammar-tiers/core`, four commits. Grammar module scaffold is in place with empty validators, dispatcher wired, type stubs swappable to `@proposit/shared/schemas/grammar` in one file. Test scaffolds for every rule are `it.todo`. New Proposit_Grammar.md draft has the spec §11 ToC and the preserved formula-parser grammar in §1. Holding on Phase B until shared@^0.9.0 publishes (waiting on `proposit-shared-dev`'s READY: on broker thread `grammar-tiers`). While I wait, I will keep advancing the documentation rewrite (Phase E1/E2 content) since that work is independent of shared.

- [ ] **Step 3: Continue Phase A-bonus (doc work) while waiting on shared**

See Phase E tasks below. E1.1–E1.4 (the new Proposit_Grammar.md sections 2–6) and E2 (README rewrite) can be authored in parallel with B/C/D as long as the API shape from §7.1 of the spec is treated as fixed (it is).

---

# Phase B — Validators (after shared READY)

**Precondition:** `proposit-shared-dev` posts `READY: @proposit/shared@^0.9.0 published with TGrammarTier, TGrammarRuleCode, TViolation` on broker thread `grammar-tiers`. Confirm the published types match the local stub in `src/lib/grammar/types.ts` before proceeding.

---

## Task B0: Swap stubs for shared imports + bump shared dep

**Files:**

- Modify: `package.json`
- Modify: `src/lib/grammar/types.ts`

- [ ] **Step 1: Bump `@proposit/shared` to `^0.9.0` in `package.json`**

Locate the `dependencies` block and update:

```json
"@proposit/shared": "^0.9.0"
```

(Replace whatever current version pin exists. If the field doesn't exist yet because the dep was never added, add it under `dependencies`.)

- [ ] **Step 2: Install**

Run:

```bash
pnpm install
```

Expected: lockfile updates, install succeeds.

- [ ] **Step 3: Replace the stubs with a re-export**

Edit `src/lib/grammar/types.ts` so that the entire body becomes:

```ts
// Wire-format types live in @proposit/shared. Core owns the rule *definitions*
// (what each code means and what triggers it); shared owns the string-literal
// codes themselves. Adding a new rule requires a coordinated shared+core
// publish — see proposit-orchestration spec 2026-05-13-grammar-tiers-design §10.
export type {
    TGrammarTier,
    TGrammarRuleCode,
    TViolation,
} from "@proposit/shared/schemas/grammar"
```

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: no errors. If `@proposit/shared/schemas/grammar` doesn't export one of the names, **stop and SendMessage team-lead** — shared's publish does not match the spec.

- [ ] **Step 5: Test**

Run:

```bash
pnpm run test -- grammar
```

Expected: same `todo` count as Phase A4; no regressions.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/grammar/types.ts
git commit -m "feat(grammar): swap local stubs for @proposit/shared@^0.9.0 wire-format types"
```

---

## Task B1: Implement Structural validators (S-1..S-14)

**Approach:** TDD per rule. For each rule, write the failing test first (replacing the `it.todo` with a real `it(...)`), run it, then implement until green. Commit at the per-rule boundary so the history is bisectable.

**Files:**

- Modify: `src/lib/grammar/validators/structural.ts`
- Modify: `test/grammar/structural.test.ts`

### Helper: a small fixture-builder for these tests

Before starting S-1, add a fixture builder so each test stays short:

- [ ] **Step 0a: Create `test/grammar/fixtures.ts`**

```ts
// test/grammar/fixtures.ts
//
// Inline fixture builder for grammar validator tests. Each test composes
// the minimal context it needs. No shared beforeEach state; per the repo
// CLAUDE.md "all tests build their own fixtures inline."

import type { TValidatorContext } from "../../src/lib/grammar/validators/context.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../../src/lib/schemata/index.js"
import type { TCoreArgumentRoleState } from "../../src/lib/types/evaluation.js"

export function buildContext(
    parts: Partial<TValidatorContext>
): TValidatorContext {
    return {
        argument: parts.argument ?? makeArgument(),
        premises: parts.premises ?? [],
        expressions: parts.expressions ?? [],
        variables: parts.variables ?? [],
        claims: parts.claims ?? [],
        roleState: parts.roleState ?? { conclusionPremiseId: undefined },
    }
}

export function makeArgument(
    overrides: Partial<TCoreArgument> = {}
): TCoreArgument {
    return {
        id: overrides.id ?? "arg-1",
        version: overrides.version ?? 1,
        // …fill in remaining required fields per the TCoreArgument schema;
        // exact fields depend on src/lib/schemata/argument.ts at time of
        // implementation. Inspect that file and inline the required shape.
        ...overrides,
    } as TCoreArgument
}

// Helpers — fill in as tests grow:
// export function makeFreeformPremise(...) { ... }
// export function makeDerivationPremise(...) { ... }
// export function makeVariableExpr(...) { ... }
// export function makeOperatorExpr(...) { ... }
// export function makeFormulaExpr(...) { ... }
// export function makeClaimBoundVariable(...) { ... }
// export function makePremiseBoundVariable(...) { ... }
// export function makeNormalClaim(...) { ... }
// export function makeCitationClaim(...) { ... }
// export function makeAxiomaticClaim(...) { ... }
```

The helpers' exact field lists depend on the schemata at the time of implementation. Inspect `src/lib/schemata/propositional.ts`, `src/lib/schemata/claim.ts`, `src/lib/schemata/argument.ts` while implementing, and inline only the required fields each helper needs.

- [ ] **Step 0b: Commit the fixtures scaffolding**

```bash
git add test/grammar/fixtures.ts
git commit -m "test(grammar): add fixtures builder for validator tests"
```

### S-1 (FK soundness) — example flow for _every_ rule in B1

The S-1 flow below is the **canonical pattern**; the same flow repeats for S-2..S-14 with rule-specific tests and implementations. Do _not_ skip the "run failing test" step — that's the TDD checkpoint that protects against accidental passing tests.

- [ ] **Step 1.1: Write the first failing test for S-1**

Replace one of the `it.todo("returns a violation when expression.parentId points at a missing expression")` lines in `test/grammar/structural.test.ts` with:

```ts
it("returns a violation when expression.parentId points at a missing expression", () => {
    const ctx = buildContext({
        expressions: [
            // dangling parentId → no matching expression in the context
            {
                id: "e1",
                premiseId: "p1",
                parentId: "missing-parent",
                position: 0,
                type: "variable",
                variableId: "v1",
                checksum: null,
            } as TCorePropositionalExpression,
        ],
    })
    const violations = validateS1(ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
        tier: "structural",
        code: "S-1",
        expressionId: "e1",
    })
})
```

Add the necessary imports at the top of the file:

```ts
import { describe, it, expect } from "vitest"
import {
    validateS1 /*, validateS2, ... */,
} from "../../src/lib/grammar/validators/structural.js"
import { buildContext } from "./fixtures.js"
import type { TCorePropositionalExpression } from "../../src/lib/schemata/index.js"
```

- [ ] **Step 1.2: Run failing test**

Run:

```bash
pnpm run test -- grammar/structural
```

Expected: 1 failing test (the new S-1 case), no longer `todo`. Failure message: `expected length 0 to be 1` (validator currently returns `[]`).

- [ ] **Step 1.3: Implement `validateS1`**

Replace the stub in `src/lib/grammar/validators/structural.ts`:

```ts
export function validateS1(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const expressionIds = new Set(ctx.expressions.map((e) => e.id))
    const premiseIds = new Set(ctx.premises.map((p) => p.id))
    const claimIds = new Set(ctx.claims.map((c) => c.id))

    // Expression parent refs
    for (const e of ctx.expressions) {
        if (e.parentId !== null && !expressionIds.has(e.parentId)) {
            violations.push({
                tier: "structural",
                code: "S-1",
                message: `expression ${e.id} has parentId ${e.parentId} which does not resolve`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }
    // Variable refs (claim-bound + premise-bound)
    for (const v of ctx.variables) {
        if ("claimId" in v && v.claimId !== undefined) {
            if (!claimIds.has(v.claimId)) {
                violations.push({
                    tier: "structural",
                    code: "S-1",
                    message: `variable ${v.id} has claimId ${v.claimId} which does not resolve`,
                    argumentId: ctx.argument.id,
                    variableId: v.id,
                    claimId: v.claimId,
                })
            }
        }
        if ("boundPremiseId" in v && v.boundPremiseId !== undefined) {
            // Skip external bindings (where boundArgumentId !== ctx.argument.id);
            // those resolve in a different argument and are not S-1's concern.
            if (
                "boundArgumentId" in v &&
                v.boundArgumentId === ctx.argument.id &&
                !premiseIds.has(v.boundPremiseId)
            ) {
                violations.push({
                    tier: "structural",
                    code: "S-1",
                    message: `variable ${v.id} has boundPremiseId ${v.boundPremiseId} which does not resolve`,
                    argumentId: ctx.argument.id,
                    variableId: v.id,
                    premiseId: v.boundPremiseId,
                })
            }
        }
    }
    // Premise argument refs
    for (const p of ctx.premises) {
        // Schema requires argumentId/argumentVersion to match the container —
        // exact field names depend on src/lib/schemata/argument.ts at time
        // of implementation.
    }
    return violations
}
```

- [ ] **Step 1.4: Run test to verify pass**

Run:

```bash
pnpm run test -- grammar/structural
```

Expected: previously failing test passes. Other todos remain todo.

- [ ] **Step 1.5: Add remaining S-1 test cases**

Replace the three remaining `it.todo` lines under "S-1 FK soundness" with real assertions covering: variable.boundPremiseId missing premise, claim-bound variable.claimId missing claim, and the all-resolve baseline (expect `[]`).

- [ ] **Step 1.6: Run all S-1 cases**

Run:

```bash
pnpm run test -- grammar/structural
```

Expected: all four S-1 cases pass.

- [ ] **Step 1.7: Commit S-1**

```bash
git add src/lib/grammar/validators/structural.ts test/grammar/structural.test.ts
git commit -m "feat(grammar): implement S-1 (FK soundness) validator"
```

### S-2 through S-14 — apply the canonical pattern

For each remaining Structural rule, repeat the same six-step cycle from S-1: write first failing test → run → implement → run pass → fill remaining tests → commit. Rule-specific implementation notes follow. Take particular care with the rules called out in the briefing — they have subtle interactions.

- [ ] **S-2 (operator types):** check `expression.type` is one of `"variable" | "formula" | "not" | "and" | "or" | "implies" | "iff"`. Any other value emits an `S-2` violation. Test cases: each legal type passes; an injected `"junk"` type fails.

- [ ] **S-3 (variable required reference):** discriminate `TClaimBoundVariable` vs `TPremiseBoundVariable` (use existing helpers in `src/lib/schemata/propositional.ts`). A variable that satisfies neither, or satisfies both, emits `S-3`. Test cases: missing both, has both, has only claimId, has only boundPremiseId.

- [ ] **S-4 (no cycles):** two checks. (a) Expression tree of every premise — walk parents, detect a revisit. (b) Argument's claim/citation/axiom graph — the existing `CITATION_CYCLE_DETECTED` machinery in `claim-citation-library.ts` covers the connection-level acyclic invariant; S-4 here re-asserts the _argument-AST_ cycle invariant. Test cases: an expression whose parentId chain loops; an acyclic baseline.

- [ ] **S-5 (root-only IMPLIES/IFF):** for each premise, count root-level `implies`/`iff` and any non-root `implies`/`iff`. Multiple root-level or any non-root → violation. Test cases per the todo list (per-rule, four cases).

- [ ] **S-6 (premise type discriminator consistency):** for each premise, check `type='derivation' ↔ derivedClaimId != null` and `type='freeform' ↔ derivedClaimId == null`. Both halves emit S-6.

- [ ] **S-7 (claim type immutability):** intentional no-op at AST level — the validator returns `[]`. JSDoc explains it's a creation-time invariant enforced by `ClaimLibrary.update()` via `CLAIM_TYPE_IMMUTABLE`. Test: `validateS7(buildContext({}))` returns `[]`.

- [ ] **S-8 (binary operator arity + positions):** for every `implies`/`iff` expression in the context, gather its children sorted by position. Emit S-8 if (a) `children.length !== 2`, or (b) positions are not `[0, 1]`. Test cases: 1 child, 3 children, swapped positions, correct shape.

- [ ] **S-9 (sibling position uniqueness):** group children by `parentId`, within each group check for duplicate `position` values. Emit one S-9 per duplicate pair. Test cases per the todo list.

- [ ] **S-10 (entity ID uniqueness):** premises, expressions, variables each. Within each collection, detect duplicate IDs. Emit S-10 per duplicate (using `entityType` field on the violation if extended; otherwise embed in `message`). Test cases per the todo list.

- [ ] **S-11 (variable symbol uniqueness):** group variables by `symbol`, emit S-11 for any group with size ≥ 2. Test cases per the todo list.

- [ ] **S-12 (NOT unary arity):** for each `not`, count children. `!= 1` emits S-12. Test cases per the todo list.

- [ ] **S-13 (formula unary arity):** identical pattern to S-12 but for `formula`. Test cases per the todo list.

- [ ] **S-14 (derivation premise root operator):** for each `type='derivation'` premise, find the root expression (parentId === null). Root must be `variable | implies | iff`. Anything else emits S-14. Test cases per the todo list.

- [ ] **S-aggregator test (validateStructural):** create a context with one violation each of S-1, S-8, S-12. Assert the aggregator returns all three codes, order-independent.

- [ ] **Final B1 typecheck + test pass:**

```bash
pnpm run check
```

Expected: green. If lint flags the validator file, run `pnpm eslint . --fix` and recheck.

- [ ] **Final B1 commit (if any leftover changes):**

The per-rule commits above cover the source changes. Any aggregator-test commit:

```bash
git commit -m "test(grammar): cover validateStructural aggregator"
```

---

## Task B2: Implement Evaluable validators (E-1, E-3..E-7)

Same per-rule TDD cycle as B1 (Step 1.1–1.7). Per-rule implementation notes:

- [ ] **E-1 (variadic arity floor):** for each `and`/`or`, count children; `< 2` emits E-1. Test cases per the todo list.

- [ ] **E-3 (variable binding resolves):** for each variable, check that its target exists _and_ is non-deleted. Test cases per the todo list. Reuse logic from S-1 where possible (extract a shared `resolveVariableTarget` helper into `validators/context.ts` if it stays small).

- [ ] **E-4 (axiomatic-binding constraint, no-op at AST level):** the validator returns `[]`. JSDoc on the exported function:

    ```ts
    /**
     * E-4 is a runtime evaluation guard, not an AST invariant. The actual
     * check (caller-supplied input must not assign axiomatic-bound variables)
     * runs inside ArgumentEngine.evaluate / .checkValidity. This validator
     * cannot detect E-4 from the argument tree alone and intentionally
     * returns an empty array.
     */
    ```

    Test: `validateE4(buildContext({...}))` returns `[]` for any context.

- [ ] **E-5 (derivation premise consequent present):** for each `type='derivation'` premise, check that _some_ expression in its tree is a variable bound to `premise.derivedClaimId`. Naked-Q satisfies this (the lone root variable). Test cases per the todo list.

- [ ] **E-6 (claim-derivation pairing):** group derivation premises by `derivedClaimId`, find any group with size ≥ 2. Each duplicate emits E-6 once. Test cases per the todo list.

- [ ] **E-7 (argument has conclusion premise):** check the role state. If `premises.length > 0 && roleState.conclusionPremiseId == null`, emit E-7. If `premises.length === 0`, no violation. If the designated `conclusionPremiseId` doesn't match any premise, that's _also_ an E-7 (matches current `ARGUMENT_CONCLUSION_NOT_FOUND`). Test cases per the todo list.

- [ ] **Evaluable aggregator test:** context with one violation each of E-1, E-6, E-7. Assert aggregator returns all three.

---

## Task B3: Implement Derivable validators (D-1..D-6)

Same per-rule TDD cycle. Implementation notes:

- [ ] **D-1 (canonical shape):** for each `type='derivation'` premise:
    1. Find root expression.
    2. If root is `variable` and references the consequent variable → naked-Q ✓.
    3. If root is `implies` with arity 2 → walk antecedent past any intervening `formula` buffers (use a helper `peelFormulas(expr, expressions): TCorePropositionalExpression`). Result must be one of:
        - `variable` bound to a `'citation'` or `'axiomatic'` claim (single-grounding form per D-2), OR
        - `or` whose children (after peeling formulas) are all variables bound to claims of the _same_ grounding type (citation or axiomatic) and `or.children.length >= 2`.
    4. Anything else → D-1 violation. IFF at root specifically → D-1 violation (the briefing spells this out for IFF-at-derivation-root).
       Test cases per the todo list — naked-Q OK, populated single-citation OK, populated multi-citation OK with and without buffer, IFF at root rejected, mixed grounding rejected, non-claim variable rejected.

- [ ] **D-2 (single-citation form):** if a populated derivation has antecedent `OR(single-element)` (peeling formulas), emit D-2 — should be `IMPLIES(citation-var, Q)` directly. Test cases per the todo list.

- [ ] **D-3 (no mixing axioms and citations):** in the antecedent's claim-bound variables, count distinct grounding types (citation vs axiomatic). `> 1` distinct → D-3. Test cases per the todo list.

- [ ] **D-4 (axiomatic claim placement):** scan every expression. Any variable bound to a `'axiomatic'` claim that does not appear in a derivation premise's antecedent → D-4. The consequent-slot check piggybacks on D-1 but D-4 explicitly flags the case where the variable _appears anywhere_ outside the antecedent.

- [ ] **D-5 (citation claim placement):** mirror of D-4 for `'citation'` claims.

- [ ] **D-6 (derivation premise role):** if a `type='derivation'` premise has `roleState.conclusionPremiseId === premise.id` → D-6 violation.

- [ ] **Derivable aggregator test:** context with one violation each of D-1, D-3, D-6.

---

## Task B4: Implement Presentable validators (P-1..P-5)

Same per-rule TDD cycle. Implementation notes:

- [ ] **P-1 (formula buffer between operators):** for each expression that is an operator and _not_ `not`, walk children. If any child is a non-`not` operator (not separated by a formula), emit P-1.

- [ ] **P-2 (no double negation):** for each `not` expression, check its single child; if the child is also `not`, emit P-2 on the outer.

- [ ] **P-3 (formula has operator descendant):** for each `formula`, walk its bounded subtree (stop at the next nested formula); if no binary operator (`and`/`or`/`implies`/`iff`) appears, emit P-3. Pure variable subtrees and pure `not`-chains both fail.

- [ ] **P-4 (no single-child binary operator):** mirror of E-1 but at Presentable. Largely redundant — a tree that fails P-4 also fails E-1. Implement the check (it's cheap) and document the redundancy in a comment. Test cases per the todo list.

- [ ] **P-5 (operator-of-same-type adjacency through a formula):** for each operator `op` (and/or), check whether any child is a `formula` whose single descendant is an `op` of the same operator type. If so, emit P-5.

- [ ] **Presentable aggregator test:** context with one violation each of P-1, P-2, P-5.

---

## Task B5: validate(tier) dispatcher tests

**Files:**

- Modify: `test/grammar/validate-dispatcher.test.ts`

The dispatcher is already implemented in `src/lib/grammar/validate.ts` (Phase A2). Verify its semantics by writing the six tests:

- [ ] **Step 1: Convert each `it.todo` in `validate-dispatcher.test.ts` to a real test**

Use the validators directly to seed a context that produces one violation per tier (e.g., expose a `oneViolationPerTier()` helper in `fixtures.ts`). Then assert:

```ts
import { validate as validateGrammar } from "../../src/lib/grammar/validate.js"

const ctx = oneViolationPerTier()

expect(validateGrammar("structural", ctx).map((v) => v.tier)).toEqual([
    "structural",
])
expect(validateGrammar("evaluable", ctx).map((v) => v.tier)).toEqual([
    "structural",
    "evaluable",
])
expect(validateGrammar("derivable", ctx).map((v) => v.tier)).toEqual([
    "structural",
    "evaluable",
    "derivable",
])
expect(validateGrammar("presentable", ctx).map((v) => v.tier)).toEqual([
    "structural",
    "evaluable",
    "derivable",
    "presentable",
])
```

Empty-context test:

```ts
expect(validateGrammar("presentable", emptyContext())).toEqual([])
```

Never-throws test: pass a deliberately broken context (e.g., one with an unknown operator type to trigger S-2) and assert `validateGrammar(...)` does not throw and returns the violation.

- [ ] **Step 2: Run + commit**

```bash
pnpm run test -- grammar/validate-dispatcher
git add test/grammar/validate-dispatcher.test.ts
git commit -m "test(grammar): cover validate(tier) dispatcher short-circuit semantics"
```

---

# Phase C — Engine surface

## Task C1: Add `behavior` field + `setBehavior(...)` on `ArgumentEngine`

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`
- Modify: `src/lib/core/proposit-core.ts` (option threading)
- Create: `test/grammar/behavior.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/grammar/behavior.test.ts
import { describe, it, expect } from "vitest"
import { PropositCore } from "../../src/lib/index.js"

describe("ArgumentEngine.behavior", () => {
    it("defaults to 'assistive'", () => {
        const core = new PropositCore()
        const { engine } = core.arguments.create()
        expect(engine.behavior).toBe("assistive")
    })

    it("accepts initial behavior via options", () => {
        const core = new PropositCore({ behavior: "permissive" })
        const { engine } = core.arguments.create()
        expect(engine.behavior).toBe("permissive")
    })

    it("setBehavior(...) switches modes at runtime", () => {
        const core = new PropositCore()
        const { engine } = core.arguments.create()
        engine.setBehavior("permissive")
        expect(engine.behavior).toBe("permissive")
        engine.setBehavior("assistive")
        expect(engine.behavior).toBe("assistive")
    })
})
```

- [ ] **Step 2: Run failing**

```bash
pnpm run test -- grammar/behavior
```

Expected: type error or runtime error on `.behavior` access.

- [ ] **Step 3: Add `behavior` to the engine class**

In `src/lib/core/argument-engine.ts`, add a private field + public accessor + setter:

```ts
private _behavior: "assistive" | "permissive" = "assistive"

public get behavior(): "assistive" | "permissive" {
    return this._behavior
}

public setBehavior(b: "assistive" | "permissive"): void {
    this._behavior = b
}
```

Thread the initial value through the constructor's `TLogicEngineOptions`:

```ts
// in TLogicEngineOptions (defined in argument-engine.ts):
behavior?: "assistive" | "permissive"

// in the constructor:
this._behavior = options?.behavior ?? "assistive"
```

- [ ] **Step 4: Thread through `PropositCore`**

In `src/lib/core/proposit-core.ts`, add `behavior` to `TPropositCoreOptions` and pass it through when the engine is constructed via `arguments.create()`.

- [ ] **Step 5: Update interface JSDoc**

In `src/lib/core/interfaces/argument-engine.interfaces.ts`, add to the relevant interface:

```ts
/**
 * Engine behavior. Controls whether auto-normalization (AN) runs as a
 * post-hook after every successful Structural mutation.
 *
 * - `'assistive'` (default): AN runs after every successful Structural
 *   mutation. AN preserves Presentable: if the pre-mutation state was
 *   Presentable, the post-mutation state is Presentable too.
 * - `'permissive'`: AN does not run. The engine accepts any Structural
 *   state and never auto-fixes; advanced-mode users opt into this.
 *
 * The engine guarantees only Structural integrity at every moment in
 * either mode; lower-tier violations are surfaced via `validate(tier)`.
 *
 * @since 1.0.0
 */
behavior: "assistive" | "permissive"

/**
 * Switches the engine's behavior at runtime. When switching from
 * `'permissive'` to `'assistive'` the engine does NOT auto-run a global
 * `normalize()` pass — the UI prompts the user explicitly before invoking
 * `normalize()`.
 *
 * @since 1.0.0
 */
setBehavior(b: "assistive" | "permissive"): void
```

- [ ] **Step 6: Run test to verify pass**

```bash
pnpm run test -- grammar/behavior
```

Expected: all three tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts src/lib/core/proposit-core.ts test/grammar/behavior.test.ts
git commit -m "feat(engine): add behavior field and setBehavior() on ArgumentEngine"
```

---

## Task C2: Implement AN post-hook (AN-1..AN-4)

**Files:**

- Create: `src/lib/grammar/auto-normalize.ts`
- Create: `test/grammar/auto-normalize.test.ts`
- Modify: `src/lib/core/premise-engine.ts` (call the hook after each successful Structural mutation when engine.behavior === 'assistive')

- [ ] **Step 1: Write failing tests**

```ts
// test/grammar/auto-normalize.test.ts
import { describe, it, expect } from "vitest"
import { PropositCore } from "../../src/lib/index.js"

describe("auto-normalization post-hook", () => {
    it("AN-1: inserts a formula buffer when a mutation places a non-not operator as a direct child of another operator", () => {
        // construct argument with parent operator AND, add OR as a child;
        // assertions: a formula now sits between them.
    })

    it("AN-2: collapses double negation NOT(NOT(x)) → x after a mutation", () => {
        // construct AND(...), wrap a child in NOT twice; assert collapse.
    })

    it("AN-3a: deletes a 0-child operator (recursing to grandparent)", () => {
        // remove the only child of an OR; assert OR is gone.
    })

    it("AN-3b: deletes a 0-child formula", () => {
        // remove the only child of a formula; assert formula is gone.
    })

    it("AN-3c: promotes a single child of a formula when not justified", () => {
        // formula wrapping a single variable; assert variable replaces formula.
    })

    it("AN-4: absorbs same-operator adjacency through a formula after an operator swap", () => {
        // updateExpression to swap AND→AND child shape; assert absorbed.
    })

    it("does NOT run when engine.behavior === 'permissive'", () => {
        // identical fixture but engine in permissive; assert raw structure preserved.
    })
})
```

(Fill in each `it` block's body using `PropositCore` + mutation methods; the comments name the canonical fixtures.)

- [ ] **Step 2: Run failing**

```bash
pnpm run test -- grammar/auto-normalize
```

Expected: all fail.

- [ ] **Step 3: Implement `runAssistiveNormalization`**

Create `src/lib/grammar/auto-normalize.ts`:

```ts
// src/lib/grammar/auto-normalize.ts
//
// Auto-normalization post-mutation hook per spec §5.1. Runs AN-1..AN-4 in
// order. Each rule is a local repair driven by the mutation's changeset
// (so the hook only inspects affected nodes, not the whole argument).
//
// AN-1 — insert formula buffer
// AN-2 — collapse double negation
// AN-3 — collapse empty/single-child operator/formula
// AN-4 — absorb same-operator adjacency

import type { TCoreMutationResult } from "../types/mutation.js"
// … plus engine + expression-manager imports as needed at implementation time

export type TAutoNormalizationInput = {
    // The changeset just produced by the mutation, so we know which nodes
    // to inspect. Doing a global pass would be a normalize() call (§6), not
    // this hook.
    changeset: TCoreMutationResult<unknown /* ...generic args... */>
    // … plus the engine handle to mutate
}

export function runAssistiveNormalization(
    input: TAutoNormalizationInput
): void {
    // 1. AN-1: for each newly inserted operator expression, if its parent
    //    is an operator (and the new node is not `not`), insert a formula
    //    node between them.
    // 2. AN-2: for each newly inserted/modified `not` expression, if its
    //    parent is also `not` (or vice versa), collapse.
    // 3. AN-3: for each removed expression, walk parent → grandparent and
    //    collapse 0-child / single-child operators and formulas.
    // 4. AN-4: for each `updateExpression` that swapped an operator, walk
    //    children to detect same-operator-through-formula adjacency.
    // Implementation details are derived from today's flag-driven logic in
    // expression-manager.ts (the existing wrapInsertFormula /
    // collapseEmptyFormula / collapseDoubleNegation / absorbSameOperator
    // implementations are the seed; the post-hook re-applies them
    // uniformly rather than per-mutation-method.)
}
```

- [ ] **Step 4: Wire the hook into mutation methods**

In `src/lib/core/premise-engine.ts`, replace every per-method `resolveAutoNormalize(...)`-gated cleanup with a single call to `runAssistiveNormalization(...)` at the end of each successful Structural mutation, gated on `this.argument.engine.behavior === 'assistive'`.

Specific call sites:

- `addExpression`, `appendExpression`, `addExpressionRelative` — replace `wrapInsertFormula` / `repositionOnCollision` per-method logic with the post-hook.
- `insertExpression` — replace `wrapInsertFormula` / `repositionOnCollision` / spacing logic.
- `removeExpression` — replace `collapseEmptyFormula` recursion with the post-hook.
- `wrapExpression` — replace `wrapInsertFormula` logic.
- `toggleNegation` — replace `collapseDoubleNegation` / `negationInsertFormula` logic.
- `updateExpression` — replace `absorbSameOperator` logic.
- `promoteChild` — replace `repositionOnCollision` logic.

Note: S-9 (sibling position uniqueness) is _promoted to Structural enforcement_ per the briefing — so `repositionOnCollision` becomes part of the mutation's bundled op (composite mutations shift colliding siblings; pure structural ops throw on collision). The post-hook does _not_ re-do S-9 — it's already guaranteed by the mutation. AN-1..AN-4 are the post-hook's only responsibilities.

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm run test -- grammar/auto-normalize
```

Expected: all 7 tests pass.

- [ ] **Step 6: Run the full test suite — expect regressions**

```bash
pnpm run test
```

This will surface every existing test that depended on the old per-flag config (`autoNormalize: { collapseEmptyFormula: false, ... }`). Triage the failures: tests that pinned the old config to verify per-flag behavior should be updated to use `behavior: 'permissive'` (no AN runs) or removed if they tested the granular config itself.

- [ ] **Step 7: Commit**

Commit the AN post-hook + premise-engine wiring + test updates together so the history is consistent:

```bash
git add src/lib/grammar/auto-normalize.ts src/lib/core/premise-engine.ts test/grammar/auto-normalize.test.ts test/core.test.ts
git commit -m "feat(engine): wire AN post-hook (AN-1..AN-4) on every successful Structural mutation in assistive mode"
```

---

## Task C3: Implement `normalize(tier?)` global pass

**Files:**

- Create: `src/lib/grammar/normalize.ts`
- Create: `test/grammar/normalize.test.ts`
- Modify: `src/lib/core/argument-engine.ts` (expose `normalize(tier?)` on the engine)

- [ ] **Step 1: Write failing test for default-tier global pass**

```ts
// test/grammar/normalize.test.ts
import { describe, it, expect } from "vitest"
import { PropositCore } from "../../src/lib/index.js"

describe("ArgumentEngine.normalize(tier?)", () => {
    it("defaults tier to 'presentable'", () => {
        // construct an argument in permissive mode with P-1, P-2, P-3 violations
        // call engine.normalize(); assert validate('presentable') is now empty.
    })

    it("normalize('derivable') is a no-op in v1.0 (forward-compat)", () => {
        // construct an argument with P-1 violation
        // call engine.normalize('derivable'); assert P-1 violation persists.
    })

    it("does not change logical meaning — variables, claim refs, operator semantics preserved", () => {
        // construct a Presentable-ish argument; capture evaluate() result;
        // run normalize(); re-run evaluate(); assert results match.
    })

    it("cannot recover from Evaluable / Derivable violations", () => {
        // construct an argument with an E-1 (and with 1 child) violation;
        // call normalize(); assert the violation persists (per §6).
    })
})
```

- [ ] **Step 2: Run failing**

```bash
pnpm run test -- grammar/normalize
```

Expected: all fail.

- [ ] **Step 3: Implement `normalize`**

Create `src/lib/grammar/normalize.ts`:

```ts
// src/lib/grammar/normalize.ts
//
// Global normalize() pass per spec §6. Runs the AN rule set everywhere it
// can fire, converging the argument toward the requested tier (default
// 'presentable'). Forward-compat: in v1.0 every AN rule (AN-1..AN-4)
// targets a Presentable invariant, so tier values 'derivable',
// 'evaluable', 'structural' are effectively no-ops. The parameter exists
// so a future submit/finalize gate can introduce lower-tier AN rules
// without an API break.
//
// `normalize` does NOT change logical meaning. It only inserts buffers,
// collapses redundant nodes, and absorbs same-operator children. It never
// deletes a variable, changes a claim reference, or modifies an operator
// semantics — even for Evaluable/Derivable violations. Recovery from
// those requires user intent and is exposed via the repair primitives
// (§7.1, Phase C4).

import type { TGrammarTier } from "./types.js"

export function normalize(
    _tier: TGrammarTier = "presentable"
    // … engine handle and expression-manager handle
): void {
    // Walk the entire argument once and apply AN-1..AN-4 wherever they
    // fire. Repeat until a fixed point is reached (typical convergence is
    // ≤ 3 iterations because the rules are local and idempotent in
    // combination).
}
```

- [ ] **Step 4: Expose `normalize` on ArgumentEngine**

In `src/lib/core/argument-engine.ts`:

```ts
public normalize(tier: TGrammarTier = "presentable"): void {
    return normalizeArgument(tier, this /* + manager refs */)
}
```

Add interface JSDoc in `argument-engine.interfaces.ts`:

```ts
/**
 * Global normalize pass per spec §6. Runs the AN rule set (AN-1..AN-4)
 * everywhere it can fire, converging the argument toward `tier`
 * (defaults to `'presentable'`).
 *
 * `normalize` is non-destructive in the logical-meaning sense — it does
 * not delete variables, change claim references, or modify operator
 * semantics. Recovery from Evaluable or Derivable violations requires
 * user intent and is exposed via the repair primitives (Phase C4).
 *
 * In v1.0 every AN rule targets a Presentable invariant, so calls with
 * `tier` ∈ {'structural', 'evaluable', 'derivable'} are effectively
 * no-ops. The parameter exists as forward-compatible API surface.
 *
 * @since 1.0.0
 */
normalize(tier?: TGrammarTier): void
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm run test -- grammar/normalize
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/grammar/normalize.ts src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts test/grammar/normalize.test.ts
git commit -m "feat(engine): implement ArgumentEngine.normalize(tier?) global pass"
```

---

## Task C4: Implement repair primitives

**Files:**

- Create: `src/lib/grammar/repair.ts`
- Create: `test/grammar/repair.test.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`

**Goal:** Targeted destructive repair primitives that the UI invokes when the user explicitly accepts a fix that would change argument meaning. Each returns the violations it resolved. Per the briefing, the exact list is "your call — enumerate during implementation."

Recommended initial set, each tied to a specific Evaluable/Derivable violation:

| Primitive                                                                                | Resolves                               | Behavior                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `removeUnresolvableVariables()`                                                          | E-3 (binding doesn't resolve)          | Deletes the variable + cascades expression removal (with operator collapse).                                                                                                                         |
| `removeOrphanOperators()`                                                                | E-1 (and/or with < 2 children)         | Deletes empty operators and promotes single-child operators (already AN-3 territory, but standalone here for the UI's "I accept this delete" flow).                                                  |
| `removeDuplicateDerivationPremises(strategy: 'keep-first' \| 'keep-largest-antecedent')` | E-6 (claim has > 1 derivation premise) | Deletes the extras per strategy.                                                                                                                                                                     |
| `dropAxiomsFromMixedAntecedent()`                                                        | D-3 (mixing axioms and citations)      | Deletes axiom-bound-variable expressions from the antecedent, leaving citations. (Mirrors the migration repair from spec §9.2; useful at runtime if an advanced-mode user ever produces this state.) |

- [ ] **Step 1: For each primitive, write a failing test in `test/grammar/repair.test.ts`**

Each test follows the pattern:

1. Construct an argument with the targeted violation.
2. Call the primitive.
3. Assert it returns the violations it resolved (with correct `code`/`tier`).
4. Assert the post-state has no violations of the targeted code via `validate(...)`.
5. Assert AN respects behavior: in `assistive` mode the post-state is also Presentable; in `permissive` it isn't normalized.

- [ ] **Step 2: Implement the primitives in `src/lib/grammar/repair.ts`**

```ts
import type { TViolation } from "./types.js"
// … engine + manager imports

export function removeUnresolvableVariables(/* ... */): readonly TViolation[] {
    // 1. Run validate('evaluable') filtered to E-3.
    // 2. For each E-3 violation, delete the offending variable.
    //    Cascade via the existing removeVariable() pathway.
    // 3. If engine.behavior === 'assistive', AN runs (via the mutation's
    //    own post-hook, free of charge).
    // 4. Return the E-3 violations that were resolved.
}
// … and the other three primitives
```

- [ ] **Step 3: Expose primitives on ArgumentEngine**

```ts
public removeUnresolvableVariables(): readonly TViolation[] { /* ... */ }
public removeOrphanOperators(): readonly TViolation[] { /* ... */ }
public removeDuplicateDerivationPremises(
    strategy: "keep-first" | "keep-largest-antecedent" = "keep-first"
): readonly TViolation[] { /* ... */ }
public dropAxiomsFromMixedAntecedent(): readonly TViolation[] { /* ... */ }
```

JSDoc per interface — emphasize "user-initiated; never auto-runs; respects behavior."

- [ ] **Step 4: Run + commit**

```bash
pnpm run test -- grammar/repair
git add src/lib/grammar/repair.ts src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts test/grammar/repair.test.ts
git commit -m "feat(engine): targeted repair primitives for E-1/E-3/E-6/D-3 (user-initiated, AN-aware)"
```

---

## Task C5: Promote S-8, S-9, S-12, S-13, S-14 to throw-on-violation in mutations

The new model says mutations throw on Structural violations and never on Evaluable/Derivable/Presentable. The current mutation API enforces some of S-\* indirectly via the per-flag config. With the config gone, the mutations must directly throw on Structural-rule violation.

**Files:**

- Modify: `src/lib/core/premise-engine.ts`
- Modify: `src/lib/core/expression-manager.ts`

- [ ] **Step 1: For each Structural rule the mutation API can violate, write a failing test**

In `test/core.test.ts` (or `test/grammar/mutation-structural.test.ts`):

- S-8: `engine.insertExpression` that would leave IMPLIES with 3 children throws.
- S-9: `engine.insertExpression` with a colliding position (pure structural op) throws; the composite `insertExpression(position)` shifts siblings instead.
- S-12: `engine.appendExpression` adding a second child under a `not` throws.
- S-13: `engine.removeExpression` that would leave a `formula` with 0 children throws (in `permissive` mode where AN doesn't run to delete the parent).
- S-14: `engine.updateExpression` swapping a derivation root to `and` throws.

- [ ] **Step 2: Implement direct throws**

Each mutation method's invariant check rejects with `InvariantViolationError` (or a new dedicated `StructuralViolationError`?) carrying the corresponding `S-*` code and the entity ID.

**Decision point:** the existing `InvariantViolationError` carries a `code: string` payload — reuse it and map the rule code into a new code constant (e.g., `STRUCTURAL_S8_VIOLATED`), or extend the error class with a `tier`/`ruleCode` field that matches `TViolation`'s shape. **Recommend** extending `InvariantViolationError` with `tier?: TGrammarTier; ruleCode?: TGrammarRuleCode` so a thrown structural violation is shaped like the `TViolation` returned by `validate('structural')`. Document this in the interface JSDoc.

- [ ] **Step 3: Run + commit**

```bash
pnpm run test -- grammar/mutation-structural
git add src/lib/core/premise-engine.ts src/lib/core/expression-manager.ts src/lib/core/invariant-violation-error.ts test/grammar/mutation-structural.test.ts
git commit -m "feat(engine): mutations throw on Structural violations (S-8, S-9, S-12, S-13, S-14) regardless of behavior"
```

---

## Task C6: Split `populateFromSupports` → `populateFromCitations` + `populateFromAxioms`

> **API shape — refined (2026-05-14 post-handoff):** factory +
> naked-Q-only + no throw on already-populated. Signatures:
>
> ```ts
> engine.populateFromCitations(
>     derivedClaimId: string,
>     citationLookup: TClaimConnectionLookup<TCoreClaimConnection>
> ): {
>     kind: "populated" | "no-op"
>     state: TCoreDerivationPremise
>     resolved?: readonly TViolation[]
> }
> // Mirror signature for populateFromAxioms with axiomLookup.
> ```
>
> Each is a **factory**: atomically constructs the per-claim derivation
> premise's expression tree in fully-populated form
> (`IMPLIES(c, Q)` for n=1, `IMPLIES(OR(c₁,…,cₙ), Q)` for n≥2; AN-1
> inserts the formula buffer in assistive mode for n≥2). No
> mutate-in-place half-populated state is ever observable.
>
> **No throw on already-populated.** Per the Structural-only mutation
> throw rule (CLAUDE.md "Key design rules" + briefing §10), the factory
> does NOT throw on D-3 conditions or when the antecedent already
> carries grounding. If the target premise is **not naked-Q**, the
> factory **no-ops** and returns
> `{ kind: 'no-op', state: <existing> }`. UI/caller is responsible for
> explicit user consent (Proposit principle: no changes without
> explicit consent) + clearing the antecedent via a repair primitive
> before re-calling.
>
> **Library-passing remains method-arg** for the same reasons logged
> in the implementation status block: keeps `ArgumentEngine`
> constructor stable, matches how `claimLibrary` is passed to
> `fromSnapshot`, lets consumers swap lookups without re-instantiating.
> `PropositCore` callers pass `core.citations` and `core.axioms`
> directly.
>
> **MDPE stays intact through C6.** The new factory methods on
> `ArgumentEngine` route around MDPE entirely. Phase D1 removes MDPE
> wholesale. The plan body's "Step 4: Remove the old
> `populateFromSupports`" step is deferred to Phase D1.
>
> Full refinement rationale (factory atomicity, no-throw justification,
> consent flow) lives in **briefing §7** at
> `docs/superpowers/briefings/grammar-tiers-core-agenda.md` and **spec
> §12** at `docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`.

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (or wherever the method lives once `ManagedDerivationPremiseEngine` is deleted; the briefing places it at engine API)
- Modify: `src/lib/index.ts` (drop the `populateFromSupports` export if any)
- Create: `test/grammar/populate-from-citations.test.ts`
- Create: `test/grammar/populate-from-axioms.test.ts`

- [ ] **Step 1: Write failing tests for `populateFromCitations`**

For each `derivedClaimId`, the method reads citation connections via `core.citations.getConnectionsForClaim(claimId)`, materializes claim-bound variables for each citation claim, and populates the per-claim derivation premise's antecedent. Cases:

- 0 citations → premise stays naked-Q.
- 1 citation → antecedent is `IMPLIES(citation-var, Q)` (D-2 form).
- 2+ citations → antecedent is `IMPLIES(OR(c1, c2, ...), Q)`, with the canonical Presentable formula buffer between IMPLIES and OR.
- Rejects if antecedent already has citation grounding (idempotent or merge — pick one explicitly).
- **Throws D-3 (or refuses) if antecedent already has axiom grounding.** Per the no-mixing rule, the UI is expected to call only one of the two methods per premise at a time. Switching requires emptying the antecedent first.

- [ ] **Step 2: Write failing tests for `populateFromAxioms`** (mirror of Step 1 for axioms).

- [ ] **Step 3: Implement both methods**

The implementations share most of their plumbing. Extract a private helper `populateAntecedent(kind: 'citation' | 'axiomatic')` and have the two public methods delegate. Internally, use the existing `ensureClaimBoundVariable` to materialize variables; use the engine's structural mutation primitives (`createPremise(type='derivation', ...)`, `addExpression`, etc.) and rely on the AN post-hook (in `assistive` mode) to insert the formula buffer between IMPLIES and OR for n≥2. In `permissive` mode the buffer is omitted (caller chose advanced; their state is Structural-valid but not Presentable).

- [ ] **Step 4: Remove the old `populateFromSupports`**

Delete the `populateFromSupports` method from `ManagedDerivationPremiseEngine` (or wherever it currently lives). This is Phase D1 territory but the method-split is so coupled that it's cleaner to land both together.

- [ ] **Step 5: Run + commit**

```bash
pnpm run test -- grammar/populate-from
git add src/lib/core/argument-engine.ts src/lib/core/managed-derivation-premise-engine.ts test/grammar/populate-from-citations.test.ts test/grammar/populate-from-axioms.test.ts
git commit -m "feat(engine): split populateFromSupports into populateFromCitations and populateFromAxioms (no silent dropping; D-3-respecting)"
```

---

## Task C7: Snapshot loading accepts any Structural state

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (`fromSnapshot`, `fromData`)
- Modify: `src/lib/core/proposit-core.ts` (`fromSnapshot`)
- Modify: `src/lib/types/fork.ts` (drop the `grammarConfig?` field from any fork-related option types)
- Create: `test/grammar/snapshot-loading.test.ts`

- [ ] **Step 1: Write failing tests**

- Snapshot containing Evaluable-only violation (e.g., `and` with 1 child) loads successfully; `validate('evaluable')` returns the violation post-load.
- Snapshot containing Derivable-only violation (e.g., mixed axiom+citation antecedent) loads successfully; `validate('derivable')` returns the violation.
- Snapshot containing Presentable-only violation (e.g., AND directly under AND, no formula buffer) loads successfully; `validate('presentable')` returns the violation.
- Snapshot containing a **Structural** violation (e.g., dangling parentId) fails to load with a structured error.
- Legacy snapshots with the historical `LOAD_GRAMMAR` / `STRICT_GRAMMAR` config flags load (the flag is ignored; new model accepts anything Structural).

- [ ] **Step 2: Implement**

Strip the `grammarConfig` parameter from `fromSnapshot`/`fromData`. Replace the post-load normalization step with: nothing. The snapshot is loaded as-is. Lower-tier violations queryable via `validate(tier)`.

For Structural validation at load time: run `validate('structural')` on the loaded context; if non-empty, throw `InvariantViolationError` with the violations attached. (The current `LEGACY_*` codes for truly broken snapshots fold into Structural violations with stable codes per the briefing — the existing `LEGACY_CLAIM_MISSING_TYPE`, `LEGACY_PREMISE_MISSING_TYPE`, `LEGACY_CLAIM_CITATION_SHAPE`, `LEGACY_MISSING_AXIOM_SLOT` continue to throw at the _library_ level before reaching the engine.)

- [ ] **Step 3: Run + commit**

```bash
pnpm run test -- grammar/snapshot-loading
git add src/lib/core/argument-engine.ts src/lib/core/proposit-core.ts src/lib/types/fork.ts test/grammar/snapshot-loading.test.ts
git commit -m "feat(engine): fromSnapshot/fromData accept any Structural state; drop grammarConfig load-time enforcement"
```

---

## Task C8: Evaluation no-op on naked-Q

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (`evaluate`, `checkValidity`, `validateEvaluability`, `validateDerivationStructures`)
- Modify: `src/lib/core/evaluation/argument-evaluation.ts` (where the standalone evaluator handles derivation premises)
- Modify: `test/core.test.ts` (any test pinning `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` on naked-Q updates to assert eval returns OK with the naked-Q skipped)

- [ ] **Step 1: Write a failing test**

```ts
it("evaluate() treats a naked-Q derivation premise as a no-op (does not throw, does not affect result)", () => {
    // construct an argument where claim Q has a derivation premise in naked-Q
    // form, and the conclusion premise asserts Q via another path.
    // assertions:
    //   - evaluate() returns a result (no throw)
    //   - the result is identical to one computed without the naked-Q premise
})
```

- [ ] **Step 2: Run failing**

Expected: current code throws `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`.

- [ ] **Step 3: Implement**

In `validateEvaluability`/`validateDerivationStructures`, remove the throw for naked-Q. Update the standalone evaluator to skip premises whose tree is a single-variable root.

- [ ] **Step 4: Run + commit**

```bash
pnpm run test -- "core.test.ts -t 'naked'" -- grammar
git add src/lib/core/argument-engine.ts src/lib/core/evaluation/argument-evaluation.ts test/core.test.ts
git commit -m "feat(engine): naked-Q derivation premise is an evaluation no-op (was: throw)"
```

---

# Phase D — Removal + cleanup

## Task D1: Delete `ManagedDerivationPremiseEngine`

**Files:**

- Delete: `src/lib/core/managed-derivation-premise-engine.ts`
- Modify: `src/lib/index.ts` (drop the exports)
- Modify: any internal callers (the `core.test.ts` blocks that instantiate it; CLI repair commands; any subclass references)

- [ ] **Step 1: Find every reference**

```bash
rg -n "ManagedDerivationPremiseEngine|TVariableMaterializer" --type ts
```

Inspect each hit and decide: callers of `populateFromSupports` already moved to the new methods in C6; callers that need derivation invariants now rely on `validate('derivable')` + the throw-on-Structural mutation enforcement from C5.

- [ ] **Step 2: Delete the file and its exports**

```bash
git rm src/lib/core/managed-derivation-premise-engine.ts
```

Edit `src/lib/index.ts` to remove:

```ts
export { ManagedDerivationPremiseEngine } from "./core/managed-derivation-premise-engine.js"
export type { TVariableMaterializer } from "./core/managed-derivation-premise-engine.js"
```

- [ ] **Step 3: Update remaining callers**

Wherever code used `ManagedDerivationPremiseEngine` to _enforce_ derivation invariants, the equivalent is now: do the mutation through the regular `PremiseEngine` (or via `ArgumentEngine`'s structural mutation methods) and call `engine.validate('derivable')` to detect issues. Update CLI commands (`src/cli/commands/repair.ts`, `src/cli/commands/premises.ts`) accordingly.

- [ ] **Step 4: Typecheck + test**

```bash
pnpm run check
```

Expected: green. Any lingering test that relied on `ManagedDerivationPremiseEngine`'s throw-on-mutation behavior needs to be rewritten to call `validate('derivable')` and assert the violation list.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(engine): remove ManagedDerivationPremiseEngine (folded into validate('derivable'))"
```

---

## Task D2: Delete `grammarConfig` machinery

**Files:**

- Delete: `src/lib/types/grammar.ts`
- Modify: `src/lib/index.ts` (drop the type exports)
- Modify: `src/lib/types/fork.ts` (drop the `grammarConfig?` field)
- Modify: `src/lib/core/argument-engine.ts`, `src/lib/core/premise-engine.ts`, `src/lib/core/expression-manager.ts`, `src/lib/core/proposit-core.ts`, `src/lib/parsing/argument-parser.ts`, `src/cli/commands/premises.ts`, `src/cli/commands/repair.ts`, `src/cli/engine.ts` (every reference)

- [ ] **Step 1: Find every reference**

```bash
rg -n "autoNormalize|grammarConfig|TGrammarOptions|TGrammarConfig|TAutoNormalizeConfig|DEFAULT_GRAMMAR_CONFIG|PERMISSIVE_GRAMMAR_CONFIG|resolveAutoNormalize|enforceFormulaBetweenOperators" --type ts
```

- [ ] **Step 2: Strip the references**

Most call sites are already dead code by Phase C2 (mutations no longer consult per-flag config). Remove the field, the parameter, the imports. The engine's behavior is now controlled exclusively by `this.behavior`.

- [ ] **Step 3: Delete `src/lib/types/grammar.ts`**

```bash
git rm src/lib/types/grammar.ts
```

Edit `src/lib/index.ts` to drop:

```ts
export * from "./types/grammar.js"
```

- [ ] **Step 4: Typecheck + test**

```bash
pnpm run check
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(engine): remove grammarConfig / autoNormalize / enforceFormulaBetweenOperators (replaced by behavior+AN post-hook)"
```

---

## Task D3: Delete `LOAD_GRAMMAR` / `STRICT_GRAMMAR` split

The two constants live in `src/lib/types/grammar.ts` (already deleted in D2). Verify no other references remain:

```bash
rg -n "LOAD_GRAMMAR|STRICT_GRAMMAR"
```

Any remaining references in tests or CLI commands → delete them.

- [ ] **Step 1: Clean up + commit (if any leftover references)**

```bash
git add -A
git commit -m "refactor(engine): remove LOAD_GRAMMAR / STRICT_GRAMMAR snapshot config split"
```

---

## Task D4: Delete deprecated `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`

**Files:**

- Modify: `src/lib/types/validation.ts`

- [ ] **Step 1: Verify no usage**

```bash
rg -n "DERIVATION_STRUCTURE_INVALID_AT_EVALUATION"
```

After C8 every usage should be gone. If any remain, fix them first.

- [ ] **Step 2: Delete the constant**

Edit `src/lib/types/validation.ts` and remove:

```ts
export const DERIVATION_STRUCTURE_INVALID_AT_EVALUATION =
    "DERIVATION_STRUCTURE_INVALID_AT_EVALUATION"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/validation.ts
git commit -m "refactor(engine): drop DERIVATION_STRUCTURE_INVALID_AT_EVALUATION (naked-Q is now a no-op)"
```

---

## Task D5: Update interface JSDoc + add Engine-/Wire-namespace clarification

**Files:**

- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`
- Modify: `src/lib/types/validation.ts` (add namespace comment)

- [ ] **Step 1: Comment the two error namespaces clearly**

In `src/lib/types/validation.ts`, add at top:

```ts
/**
 * Engine-error codes (this file).
 *
 * These string constants identify *thrown* errors from engine operations
 * — schema validation failures, mutation rejections, snapshot load
 * failures, etc. They are distinct from the *grammar-rule* codes
 * (`TGrammarRuleCode`, exported from `@proposit/shared/schemas/grammar`)
 * which identify *returned* violations from `validate(tier)`.
 *
 * Both namespaces are stable wire format — do not rename without a
 * coordinated shared+core publish.
 */
```

- [ ] **Step 2: Pass over every method JSDoc in `argument-engine.interfaces.ts`**

Any reference to old config flags or `ManagedDerivationPremiseEngine` or `populateFromSupports` → replace with the new model's equivalent. Cross-reference Phase C1, C3, C4 JSDoc blocks for the canonical wording.

- [ ] **Step 3: Pass over `premise-engine.interfaces.ts`**

Drop JSDoc references to `grammarConfig` / `autoNormalize`. Mention that mutations enforce only Structural rules and throw on Structural violation; AN runs as a post-hook in `assistive` mode.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/interfaces/ src/lib/types/validation.ts
git commit -m "docs(interfaces): clarify engine-error vs grammar-rule code namespaces; refresh JSDoc for new API"
```

---

# Phase E — Documentation

## Task E1: Replace `docs/Proposit_Grammar.md`

**Files:**

- Delete: `docs/Proposit_Grammar.md` (old file)
- Move: `docs/Proposit_Grammar.draft.md` → `docs/Proposit_Grammar.md`
- Modify: the new file with §2–§7 fully written out

- [ ] **Step 1: Author §2 The four-tier model**

Pull definitions, subset-chain diagram, and gate table verbatim from spec §3. Worked examples: show one canonical argument that's at each tier (Presentable; Derivable-but-not-Presentable; Evaluable-but-not-Derivable; Structural-but-not-Evaluable).

- [ ] **Step 2: Author §3 Rule inventory**

For every rule (S-1..S-14, E-1+E-3..E-7, D-1..D-6, P-1..P-5):

- Rule statement (from spec §4)
- Tier + code
- Validator function name (from `src/lib/grammar/validators/*`)
- Concrete example of a violating shape (mini-AST or pseudocode)
- Concrete example of a non-violating shape
- Reserved-code callouts for `E-2` and `D-7`

- [ ] **Step 3: Author §4 Engine behavior and AN**

Pull from spec §5 + §5.1. Add worked examples (AST before/after) for each AN rule.

- [ ] **Step 4: Author §5 `normalize()` contract**

Pull from spec §6. Add a worked example of "advanced-mode user goes back to normal mode; the prompt offers normalize(); they accept; here's what the AST looked like before and after."

- [ ] **Step 5: Author §6 Validation output reference**

`TViolation` shape (link to `@proposit/shared/schemas/grammar`), `TGrammarRuleCode` listing, two example response payloads (one all-empty, one with mixed-tier violations).

- [ ] **Step 6: Author §7 Migration notes**

Subsections 7.1–7.6 per the draft ToC. Concise (one paragraph each). Cross-reference release-notes/v1.0.0.md (written in E6) for user-facing wording.

- [ ] **Step 7: Delete the old file, rename the draft**

```bash
git rm docs/Proposit_Grammar.md
git mv docs/Proposit_Grammar.draft.md docs/Proposit_Grammar.md
```

- [ ] **Step 8: Commit**

```bash
git add docs/Proposit_Grammar.md
git commit -m "docs(grammar): rewrite Proposit_Grammar.md to cover the four-tier model, rule inventory, AN, normalize, validation output, and migration"
```

---

## Task E2: Rewrite `README.md`

The new README is the public face of `@proposit/proposit-core@1.0.0`. Per the briefing:

> It should describe the four-tier grammar model, the `ArgumentEngine` API surface, the rule inventory, the auto-normalization contract, the `validate(tier)` / `normalize(tier?)` / behavior modes, the repair primitives, and a clear migration note for pre-1.0 users.

- [ ] **Step 1: Outline sections**

1. What is `@proposit/proposit-core`?
2. Quick start (5 lines of TypeScript: `new PropositCore()`, create an argument, add a premise, call `validate('presentable')`).
3. The four-tier grammar model (linked to `docs/Proposit_Grammar.md` for the full reference).
4. ArgumentEngine API surface (mutations + validate/normalize/behavior/repair).
5. Auto-normalization contract (AN preserves Presentable in assistive mode).
6. Migration from pre-1.0 (table of "before → after" patterns).
7. Invalid Constructions section (still updated per CLAUDE.md Documentation Sync — list which mutations throw which Structural rule codes).
8. Concepts (preserved if still relevant; freshen up).
9. Usage examples (CLI + library; one canonical end-to-end example).
10. Versioning and stability (1.0.0 marks the first stable wire-format commitment).

- [ ] **Step 2: Write the rewrite**

(Author all sections. The exact prose is the engineer's; just make sure the API names match what landed in B/C/D.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite for 1.0.0 — four-tier grammar, new API, migration notes"
```

---

## Task E3: Rewrite the `CLAUDE.md` "Key design rules" section

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Pass over every bullet**

Drop:

- "Operator nesting restriction" (the bullet that references `grammarConfig.enforceFormulaBetweenOperators`)
- "Granular auto-normalize" (the very long bullet listing six flags)
- "Operator collapse" (bullet talking about `collapseEmptyFormula`)
- "Formula collapse rule" (same)
- "Operator collapse gated on `collapseEmptyFormula`" (same)
- "Derivation premise structure" — rewrite to drop the naked-Q-depends-on-`collapseEmptyFormula` warning
- "`ManagedDerivationPremiseEngine`" (the whole bullet)
- "`populateFromSupports`" (rewrite to describe the two new methods)
- "Evaluation pre-flight for derivation premises" — drop the throw-on-naked-Q description; replace with "naked-Q is a no-op."

Add:

- **Four-tier grammar:** bullet describing `Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`, the subset chain, and `validate(tier)` semantics.
- **Engine behavior:** bullet describing `behavior: 'assistive' | 'permissive'`, `setBehavior(...)`, and the AN post-hook.
- **`normalize(tier?)`:** bullet describing the global pass, the tier forward-compat, the non-destructiveness rule.
- **Repair primitives:** bullet listing the four primitives + the consent rule.
- **Mutation throws only on Structural:** bullet making explicit that the mutation API never throws on Evaluable/Derivable/Presentable. Validation is queried; not thrown.
- **Wire format owned by shared:** bullet noting `TGrammarTier` / `TGrammarRuleCode` / `TViolation` live in `@proposit/shared/schemas/grammar`; adding a rule code requires a coordinated shared+core publish.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): rewrite Key design rules for the four-tier model (drop autoNormalize/grammarConfig/ManagedDerivationPremiseEngine)"
```

---

## Task E4: Update `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`, `examples/arguments/*.yaml`

- [ ] **Step 1: `CLI_EXAMPLES.md`**

```bash
rg -n "autoNormalize|grammarConfig|enforce|--no-auto-normalize" CLI_EXAMPLES.md
```

Replace any reference to the dropped flags with the new model's equivalent. The CLI's `behavior` flag may need adding — coordinate with CLI surface changes from Phase C.

- [ ] **Step 2: `scripts/smoke-test.sh`**

Same scan for old flags. Update calls to use the new behavior switch.

- [ ] **Step 3: `examples/arguments/*.yaml`**

Run the parser over each example and confirm they load under the new model:

```bash
pnpm run build
node dist/cli/index.js parse examples/arguments/<each-file>.yaml
```

Expected: all load successfully (the new model is more permissive at load time, so no breakage expected). If anything breaks, fix the example to be Structural-valid under the new rules.

- [ ] **Step 4: Commit**

```bash
git add CLI_EXAMPLES.md scripts/smoke-test.sh examples/arguments/
git commit -m "docs(cli): update CLI_EXAMPLES, smoke-test, and example arguments for the new behavior switch"
```

---

## Task E5: Update `docs/api-reference.md`

- [ ] **Step 1: Pass over every section**

Find every reference to the dropped APIs and replace with the new model. Add fresh sections for:

- `validate(tier)`
- `normalize(tier?)`
- `behavior` / `setBehavior(...)`
- `removeUnresolvableVariables` and other repair primitives
- `populateFromCitations` / `populateFromAxioms`

Drop:

- `grammarConfig` / `TGrammarConfig` / `TAutoNormalizeConfig` / `DEFAULT_GRAMMAR_CONFIG` / `PERMISSIVE_GRAMMAR_CONFIG`
- `ManagedDerivationPremiseEngine` / `TVariableMaterializer`
- `populateFromSupports`
- `validateDerivationStructures` (if it's exported in the new model only via `validate('derivable')`)
- `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`

- [ ] **Step 2: Commit**

```bash
git add docs/api-reference.md
git commit -m "docs(api-reference): full pass for 1.0.0 API"
```

---

## Task E6: Release notes + changelog

**Files:**

- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Write `docs/release-notes/upcoming.md`**

Plain language, user-facing. Cover:

- The four-tier grammar model and what changed at the API surface.
- The `behavior` setting and the assistive-vs-permissive distinction.
- The `validate(tier)` + `normalize(tier?)` API.
- The repair primitives.
- The `populateFromCitations` / `populateFromAxioms` split (no silent dropping of user-provided data).
- Snapshot loading now accepts any Structural state.
- Naked-Q derivation premises are a valid evaluation no-op.
- **Removed APIs (no deprecation period):** `grammarConfig`, `autoNormalize`, `enforceFormulaBetweenOperators`, `LOAD_GRAMMAR` / `STRICT_GRAMMAR`, `ManagedDerivationPremiseEngine`, `TVariableMaterializer`, `populateFromSupports`, `validateDerivationStructures` (folded into `validate('derivable')`), `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`.
- **For external consumers:** the API is breaking. The recommended migration path (table of before/after patterns).

- [ ] **Step 2: Write `docs/changelogs/upcoming.md`**

Developer-facing. Commit-hash-range based. Group by Phase (B/C/D/E). Reference commits by their short SHAs (use `git log --oneline grammar-tiers/core` to gather).

- [ ] **Step 3: Commit**

```bash
git add docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs(release): 1.0.0 release notes and changelog (drafted; rename happens at publish-time)"
```

---

# Phase F — Publish

## Task F1: Pre-publish baseline

- [ ] **Step 1: Run full check**

```bash
pnpm run check
```

Expected: all green.

- [ ] **Step 2: Run smoke test**

```bash
pnpm run build
bash scripts/smoke-test.sh
```

Expected: smoke test exits 0.

- [ ] **Step 3: Run examples test**

```bash
pnpm run test -- examples
```

Expected: every example argument loads under the new model.

---

## Task F2: SendMessage team-lead for publish authorization

- [ ] **Step 1: Compose message**

SendMessage to `team-lead`:

> Ready to publish `@proposit/proposit-core@1.0.0`.
>
> **Version recommendation:** `major` (→ 1.0.0). Rationale: the API change is breaking — `grammarConfig`, `autoNormalize`, `enforceFormulaBetweenOperators`, `LOAD_GRAMMAR`/`STRICT_GRAMMAR`, `ManagedDerivationPremiseEngine`, `populateFromSupports`, and `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` are _removed_, not deprecated. A 1.0.0 marks the first stable wire-format commitment (rule codes now live in `@proposit/shared@^0.9.0`). Pre-1.0 path (0.13.0) is technically defensible but the briefing recommends major as the cleaner signal.
>
> **Changelog summary:**
>
> - New: four-tier grammar (`Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`); `validate(tier)`, `normalize(tier?)`, `behavior: 'assistive'|'permissive'`, `setBehavior(...)`, four repair primitives.
> - New: `populateFromCitations` and `populateFromAxioms` (split from `populateFromSupports`; no silent dropping).
> - Changed: snapshot loading accepts any Structural state; lower-tier violations queryable post-load.
> - Changed: naked-Q derivation premise is a valid evaluation no-op (was: throw).
> - Removed: every flag in the old `grammarConfig` (including the per-flag `autoNormalize` config object).
> - Removed: `ManagedDerivationPremiseEngine` + `TVariableMaterializer`.
> - Removed: `LOAD_GRAMMAR` / `STRICT_GRAMMAR` snapshot split.
> - Removed: `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`.
>
> Branch `grammar-tiers/core` is at <commit SHA>, all tests green, smoke test passing. Awaiting your green light to run `pnpm version major`.

- [ ] **Step 2: Wait for `team-lead`'s OK**

Do not proceed to F3 until the orchestrator approves.

---

## Task F3: Version bump

- [ ] **Step 1: Bump**

```bash
pnpm version major
```

Expected: `package.json` now reads `"version": "1.0.0"`. A commit is created with the bump and a `v1.0.0` tag is _not_ yet (we tag in F5 after publish).

- [ ] **Step 2: Rename release-notes + changelog**

```bash
git mv docs/release-notes/upcoming.md docs/release-notes/v1.0.0.md
git mv docs/changelogs/upcoming.md docs/changelogs/v1.0.0.md
```

- [ ] **Step 3: Start fresh upcoming files**

Create empty stubs:

```md
<!-- docs/release-notes/upcoming.md -->

# Upcoming release notes

_No changes yet._
```

```md
<!-- docs/changelogs/upcoming.md -->

# Upcoming changelog

_No changes yet._
```

- [ ] **Step 4: Commit the rename + stubs**

```bash
git add docs/release-notes/ docs/changelogs/
git commit -m "docs(release): rename upcoming.md to v1.0.0.md; start fresh upcoming files"
```

---

## Task F4: Publish to npm

- [ ] **Step 1: Final pre-publish check**

```bash
pnpm run check
```

Expected: green.

- [ ] **Step 2: Publish (human OTP)**

```bash
pnpm publish --access public
```

The human enters the OTP. Expected: registry confirms `@proposit/proposit-core@1.0.0` published.

---

## Task F5: Tag, push, PR, merge

- [ ] **Step 1: Tag**

```bash
git tag v1.0.0
```

- [ ] **Step 2: Push branch + tag**

```bash
git push origin grammar-tiers/core
git push origin v1.0.0
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Grammar Tiers — proposit-core 1.0.0" --body "$(cat <<'EOF'
## Summary

- Four-tier grammar model (`Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`) replaces the per-flag `grammarConfig` + `autoNormalize` machinery.
- `validate(tier)`, `normalize(tier?)`, `behavior` + `setBehavior()`, and four repair primitives are the new engine surface.
- `populateFromSupports` is split into `populateFromCitations` and `populateFromAxioms` (no silent dropping; D-3-respecting).
- Snapshot loading accepts any Structural state; lower-tier violations are queryable post-load.
- Naked-Q derivation premises are a valid evaluation no-op (was: throw).
- `ManagedDerivationPremiseEngine`, `grammarConfig`, the LOAD/STRICT split, and `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` are removed.

Cross-repo spec: `proposit-orchestration/docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`. Briefing: `docs/superpowers/briefings/grammar-tiers-core-agenda.md`. Plan: `docs/superpowers/plans/grammar-tiers-core-plan.md`.

## Test plan

- [ ] `pnpm run check` green
- [ ] `bash scripts/smoke-test.sh` green
- [ ] All examples in `examples/arguments/` load under the new model
- [ ] `validate(tier)` short-circuit semantics match spec §7.1 for all four tiers
- [ ] AN post-hook preserves Presentable in `assistive` mode; does not run in `permissive`
- [ ] Snapshot loading accepts Structural-only states; surfaces violations via `validate()`
EOF
)"
```

- [ ] **Step 4: Merge**

Once CI is green, merge the PR.

---

## Task F6: Post READY: on broker thread

- [ ] **Step 1: SendMessage on broker thread `grammar-tiers`**

Use the broker pattern (see `skill-cefailures:broker`):

> READY: @proposit/proposit-core@1.0.0 published. Server and mobile can bump.

---

# Self-review

Run through the spec one section at a time and confirm each requirement maps to a task.

| Spec section                                      | Plan task(s)                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1 Capability changes (server + mobile own these) | Out of scope for core; noted in briefing                                                                                                                                                         |
| §2 Goal                                           | Phase B + C overall                                                                                                                                                                              |
| §3 The four grammar tiers                         | B1–B5 validators; E1–E3 documentation                                                                                                                                                            |
| §4 Rule inventory                                 | B1 (S-1..S-14), B2 (E-_), B3 (D-_), B4 (P-\*)                                                                                                                                                    |
| §5 Engine behavior                                | C1 (behavior field), C2 (AN post-hook)                                                                                                                                                           |
| §5.1 AN rule set                                  | C2 (AN-1..AN-4)                                                                                                                                                                                  |
| §6 normalize()                                    | C3 (normalize global pass)                                                                                                                                                                       |
| §7.1 API surface                                  | C1, C3, C4, B5 dispatcher                                                                                                                                                                        |
| §7.2 Snapshot loading                             | C7                                                                                                                                                                                               |
| §8 Mutation API categorization                    | C5 (Structural-only throws); D2 (drop old flag plumbing); E5 docs                                                                                                                                |
| §9 Migration strategy — code                      | F3–F5 publish flow; downstream consumers bump on their own                                                                                                                                       |
| §9 Migration strategy — data                      | Out of scope (server)                                                                                                                                                                            |
| §10 Per-repo scope sketch — core                  | All of B/C/D/E                                                                                                                                                                                   |
| §11 Proposit_Grammar.md rewrite                   | E1                                                                                                                                                                                               |
| §12 Open decisions                                | All resolved in the briefing; codified in B–E (e.g., populateFromCitations/Axioms in C6; naked-Q no-op in C8; IFF-at-derivation-root flagged D-1 in B3; advanced-mode behavior=permissive in C1) |
| §13 Acceptance criteria                           | F1 (pre-publish baseline) + F4 (publish) + F6 (broker READY)                                                                                                                                     |

Briefing-specific items also covered:

- Briefing #1 (wire format imports): A1 stub, B0 swap.
- Briefing #2 (validators): B1–B5.
- Briefing #3 (normalize): C3.
- Briefing #4 (repair primitives): C4.
- Briefing #5 (behavior + AN post-hook): C1, C2.
- Briefing #6 (remove old machinery): D1–D4.
- Briefing #7 (split populateFromSupports): C6.
- Briefing #8 (snapshot loading): C7.
- Briefing #9 (documentation rewrite): E1–E5.

Documentation Sync (per `CLAUDE.md`):

- `README.md` [Public-CLI-API] → E2.
- `README.md` "Invalid Constructions" [Validation-Rules] → E2 step 1 (section #7).
- `docs/api-reference.md` [Public-API] → E5.
- `CLAUDE.md` [Public-API] → E3.
- `CLI_EXAMPLES.md` [Public-CLI-API] → E4.
- `scripts/smoke-test.sh` [Public-CLI-API] → E4.
- `src/lib/core/interfaces/*.interfaces.ts` [Public-Engine-API] → C1, C3, C4, D5.
- `docs/release-notes/upcoming.md` → E6, then renamed in F3.
- `docs/changelogs/upcoming.md` → E6, then renamed in F3.
- `examples/arguments/*.yaml` → E4 step 3.

Placeholder scan: no TODOs, no "TBD", no "similar to Task N" cross-references — every task contains its own concrete content. Test code is shown in the canonical S-1 flow and is referenced as "apply the canonical pattern" for S-2..S-14 with rule-specific prose (acceptable because the pattern is fully spelled out within the same task — no out-of-order reading risk).

Type consistency: `TViolation`, `TGrammarTier`, `TGrammarRuleCode` are defined in A1, swapped in B0, used identically through C/D/E. `behavior` field, `setBehavior(...)`, `validate(tier)`, `normalize(tier?)`, the four repair primitives, and `populateFromCitations`/`populateFromAxioms` all use the same names from the task they're introduced through to the publish notes.

---

# Open decisions deferred to implementation

These choices are intentionally left to the implementer because they depend on details that only surface mid-implementation. The plan flags them so they aren't skipped:

1. **`InvariantViolationError` shape extension (Phase C5):** does the existing error class get extended with optional `tier` and `ruleCode` fields, or does a new `StructuralViolationError` subclass get introduced? Recommend extending the existing class; flag if the choice affects external consumers.
2. **Repair primitive set (Phase C4):** the four primitives listed are a starting point. If implementation surfaces additional repair paths (e.g., `flattenNestedSameOperator()` for unusual P-5 cases), add them — each should resolve a specific Evaluable/Derivable violation and respect `behavior`.
3. **`engine.validateEvaluability` / `engine.checkValidity` consolidation (briefing item):** these existing methods may merge into `validate('evaluable')` or stay as thin wrappers. Recommend keeping them as wrappers for backward compatibility within the 1.0 surface; they call `validate('evaluable')` internally.
4. **AN-3 single-child promotion behavior:** the briefing notes the rule but the exact semantics need a quick decision at C2 — does AN-3 promote a single child _always_, or only when the parent is non-meaningful (formula, or operator with one child)? Recommend the latter (matches today's `collapseEmptyFormula` behavior).

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/grammar-tiers-core-plan.md`. Two execution options:

**1. Subagent-Driven** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Particularly appropriate here given the 30+ validator tasks and the long doc rewrite — checkpoints between tiers prevent drift.

**2. Inline Execution (recommended for this work)** — Execute tasks in this session using `superpowers:executing-plans`. Given that the same agent should hold the full context of validator interactions (e.g., S-9 ↔ AN-1 ordering, D-1's formula-transparency rule applying to D-2/D-3), and given that the test fixtures evolve organically across tiers, inline execution with checkpoint commits is the lower-risk path.

Either way, the broker thread `grammar-tiers` is the coordination point with `proposit-shared-dev`, and SendMessage `team-lead` is the escalation channel.
