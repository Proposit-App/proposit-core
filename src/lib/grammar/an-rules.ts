// AN rule set — native implementations of AN-1..AN-4.
//
// Per spec §5.1 the auto-normalization rule set consists of four local
// cleanup rules:
//
//   AN-1  Insert formula buffer when a non-`not` operator becomes a
//         direct child of another operator. Preserves P-1.
//   AN-2  Collapse double negation (NOT(NOT(x)) → x). Preserves P-2.
//   AN-3  Collapse 0-child operator/formula (recursing to grandparent);
//         promote single child where the parent is non-meaningful.
//         Preserves P-3 and P-4 (incidentally E-1).
//   AN-4  Absorb same-operator adjacency through a formula. Preserves
//         P-5.
//
// This module is the **native home** of the rule set for v1.0. Phase D
// owns this module: D0 (this file) lifts the rules out of
// `ExpressionManager.normalize()` and into the grammar module so the AN
// pass is no longer coupled to the legacy `grammarConfig` machinery; D2
// removes the legacy plumbing entirely (the per-mutation AN inside
// `ExpressionManager` mutation methods + the 11 P-1 throw sites — see
// the plan's Phase D summary).
//
// **D0e — AN-1 + AN-2 + AN-3 + AN-4 all native.** `applyAN1`,
// `applyAN2`, `applyAN3`, and `applyAN4` implement their rules
// directly against the public `PremiseEngine` mutation API. AN-1 uses
// `pe.wrapInFormula(childOpId, formulaId)` to atomically insert a
// formula buffer between an operator parent and a non-`not` operator
// child (composing this from `addExpression` + `reparentExpression`
// would trip S-9 transiently and violate parent child-limits under
// unary `not` and binary `implies`/`iff` parents — see the
// `wrapInFormula` JSDoc on PE for the full argument). AN-2 and AN-3
// use `pe.removeExpression(id, false)`. AN-4 uses
// `pe.reparentExpression(c_i, outerId, position_i)` + a final
// `pe.removeExpression(formula, false)` cleanup. The four `applyAN*`
// exports no longer delegate to the legacy `pe.normalizeExpressions()`
// full sweep; the `runLegacyNormalizeAndReportChange` helper is
// removed in this commit. D0f follows up by switching
// `applyANToFixedPoint`'s `||` short-circuit chain to a reduce-or
// accumulator (synthesis P2 #2 — deferred per D0e dispatch). D2
// removes the legacy per-flag `grammarConfig` machinery and the 11
// P-1 throw sites that the PERMISSIVE swap in `normalize.ts`
// currently works around.
//
// The per-rule tests (`test/grammar/an-rules.test.ts`) assert behavior
// the native implementation must preserve once it lands; today they
// pass because the delegated implementation already produces that
// behavior. Each test is a regression guard for the eventual native
// rewrite.

import type { ArgumentEngine } from "../core/argument-engine.js"
import type { PremiseEngine } from "../core/premise-engine.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../schemata/index.js"
import { hasBinaryOperatorInBoundedSubtree } from "./bounded-subtree.js"

/**
 * Convergence safety cap — typically AN converges in ≤ 3 iterations
 * because the rules are local and idempotent in combination. The cap is
 * a defense against pathological inputs (e.g. a malformed Structural
 * state that would otherwise oscillate). When the cap is hit the
 * implementation throws an InvariantViolationError-shaped Error so
 * regressions surface loudly rather than silently truncating.
 */
const MAX_AN_ITERATIONS = 10

/**
 * Run AN-2 (collapse double negation) on every premise of `engine`.
 * Returns `true` iff any mutation occurred.
 *
 * **D0b: native rewrite.** Walks each premise's expression tree
 * looking for NOT(NOT(x)) — both the direct form (`NOT_outer →
 * NOT_inner → x`) and the buffered form (`NOT_outer → formula →
 * NOT_inner → x`). For each match issues two
 * `pe.removeExpression(id, false)` calls that promote the
 * grandchild (and, in the buffered case, the residual formula)
 * through the two NOT layers.
 *
 * The buffered case leaves an unjustified `formula(x)` residue
 * which AN-3 cleans up in a subsequent iteration of
 * `applyANToFixedPoint`. AN-2 stays focused on the NOT-NOT
 * collapse itself — no formula bookkeeping.
 *
 * Behavior parity with the legacy `ExpressionManager.normalize()`
 * pass 4 is asserted by the regression-guard tests in
 * `test/grammar/an-rules.test.ts` and the broader 1598-test
 * baseline (which exercises double-negation collapse via
 * `pe.normalizeExpressions()` and `engine.normalize()`).
 *
 * @since 1.0.0
 */
export function applyAN2<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): boolean {
    let anyChanged = false
    for (const pe of engine.listPremises()) {
        // Loop until no AN-2 pattern remains in this premise. Cascading
        // NOT chains (NOT-NOT-NOT-NOT-x) need multiple sweeps to fully
        // collapse; doing them in one call keeps the outer
        // fixed-point driver simple.
        let premiseChanged = true
        while (premiseChanged) {
            premiseChanged = collapseOneDoubleNegationInPremise(pe)
            if (premiseChanged) anyChanged = true
        }
    }
    return anyChanged
}

/**
 * Find one NOT(NOT(x)) pattern in `pe`'s tree (direct or buffered)
 * and collapse it. Returns `true` iff a collapse occurred.
 *
 * Each call collapses exactly one pattern. The caller loops until
 * no patterns remain.
 */
function collapseOneDoubleNegationInPremise<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(pe: PremiseEngine<TArg, TPremise, TExpr, TVar>): boolean {
    for (const expr of pe.getExpressions()) {
        if (expr.type !== "operator" || expr.operator !== "not") continue
        const children = pe.getChildExpressions(expr.id)
        if (children.length !== 1) continue
        const child = children[0]

        // Direct: NOT_outer → NOT_inner → x
        if (child.type === "operator" && child.operator === "not") {
            const innerChildren = pe.getChildExpressions(child.id)
            if (innerChildren.length !== 1) continue
            // Promote x into inner NOT's slot, then promote x into
            // outer NOT's slot. Two removeExpression(_, false) calls.
            pe.removeExpression(child.id, false)
            pe.removeExpression(expr.id, false)
            return true
        }

        // Buffered: NOT_outer → formula → NOT_inner → x
        if (child.type === "formula") {
            const formulaChildren = pe.getChildExpressions(child.id)
            if (formulaChildren.length !== 1) continue
            const innerNot = formulaChildren[0]
            if (innerNot.type !== "operator" || innerNot.operator !== "not") {
                continue
            }
            const innerChildren = pe.getChildExpressions(innerNot.id)
            if (innerChildren.length !== 1) continue
            // Promote x into inner NOT's slot (formula now wraps x),
            // then promote formula into outer NOT's slot. The
            // residual `formula(x)` is unjustified (no binary
            // operator in its bounded subtree) and AN-3 collapses
            // it in a subsequent fixed-point iteration.
            pe.removeExpression(innerNot.id, false)
            pe.removeExpression(expr.id, false)
            return true
        }
    }
    return false
}

/**
 * Run AN-3 (collapse 0/1-child operator/formula) on every premise of
 * `engine`. Returns `true` iff any mutation occurred.
 *
 * **D0c: native rewrite.** Walks each premise's expression tree and
 * collapses four sub-cases via `pe.removeExpression(id, false)`:
 *
 *   1. Operator with 0 children → removed (leaf removal).
 *   2. Operator with 1 child (non-`not`) → child promoted into the
 *      operator's slot. `not` is unary so 1-child `not` is its
 *      Presentable form and is NOT collapsed by AN-3.
 *   3. Formula with 0 children → removed.
 *   4. Formula with 1 child whose bounded subtree contains no binary
 *      operator (`and`/`or`) → child promoted (the formula is
 *      unjustified per P-3, so it disappears).
 *
 * Bounded-subtree traversal stops at nested formulas (each formula
 * is a separate P-3 scope). The shared
 * `hasBinaryOperatorInBoundedSubtree` helper in
 * `src/lib/grammar/bounded-subtree.ts` is used by both this rule and
 * the P-3 validator; AN-3 binds its lookup function to
 * `pe.getChildExpressions(id)` so it sees live mid-mutation reads,
 * while the validator binds to a snapshot `TChildMap`. The lift
 * resolves the pre-D0e duplication (D0a P2 #3 / D0d P2 #3).
 *
 * Behavior parity with the legacy `ExpressionManager.normalize()`
 * passes 1 + 2 is asserted by the regression-guard tests in
 * `test/grammar/an-rules.test.ts` and the broader 1603-test
 * baseline.
 *
 * @since 1.0.0
 */
export function applyAN3<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): boolean {
    let anyChanged = false
    for (const pe of engine.listPremises()) {
        let premiseChanged = true
        while (premiseChanged) {
            premiseChanged = collapseOneAN3InPremise(pe)
            if (premiseChanged) anyChanged = true
        }
    }
    return anyChanged
}

/**
 * Find one AN-3 candidate in `pe`'s tree and collapse it. Returns
 * `true` iff a collapse occurred.
 *
 * Each call collapses exactly one node. The caller loops until the
 * tree is stable. The single-collapse-per-call shape mirrors AN-2 so
 * cascading mutations don't trip mid-iteration tree-walk invariants.
 */
function collapseOneAN3InPremise<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(pe: PremiseEngine<TArg, TPremise, TExpr, TVar>): boolean {
    for (const expr of pe.getExpressions()) {
        // Sub-case 1 & 2: operator collapse.
        if (expr.type === "operator") {
            const children = pe.getChildExpressions(expr.id)
            if (children.length === 0) {
                // 0-child operator — remove wholesale.
                pe.removeExpression(expr.id, false)
                return true
            }
            if (children.length === 1 && expr.operator !== "not") {
                // 1-child non-not operator — promote single child.
                pe.removeExpression(expr.id, false)
                return true
            }
            continue
        }

        // Sub-case 3 & 4: formula collapse.
        if (expr.type === "formula") {
            const children = pe.getChildExpressions(expr.id)
            if (children.length === 0) {
                // 0-child formula — remove wholesale.
                pe.removeExpression(expr.id, false)
                return true
            }
            if (
                children.length === 1 &&
                !hasBinaryOperatorInBoundedSubtree(
                    children[0].id,
                    (id) => pe.getChildExpressions(id),
                    (id) => pe.getExpression(id)
                )
            ) {
                // Unjustified formula (no binary operator in bounded
                // subtree) — promote single child.
                pe.removeExpression(expr.id, false)
                return true
            }
        }
    }
    return false
}

/**
 * Run AN-4 (absorb same-operator through formula) on every premise of
 * `engine`. Returns `true` iff any mutation occurred.
 *
 * **D0e: native rewrite.** Walks each premise's expression tree for
 * the absorption shape `OUTER_OP → (..., ) formula → INNER_OP (same
 * operator) → [c1, c2, …, cN]`, with both operators being `and` or
 * `or` (S-5 restricts `implies`/`iff` to roots, so they never appear in
 * AN-4-firing positions). For each match:
 *
 *   1. Compute target positions for the N inner children under the
 *      outer operator using the legacy spacing algorithm from
 *      `ExpressionManager.absorbSameOperator` (em.ts:1240-1349):
 *      `leftPos + ((rightPos - leftPos) / (count + 1)) * (i + 1)`,
 *      truncated to integers. `leftPos` and `rightPos` are the
 *      formula's outer neighbors (or `positionConfig.min`/`max` at
 *      boundaries).
 *   2. If `gap = rightPos - leftPos <= count` (tight neighborhood
 *      where N evenly-spaced positions would collide), fall back to a
 *      **full redistribution**: renumber every existing sibling of the
 *      formula evenly across `positionConfig.min..max`, then redo the
 *      spacing on the refreshed boundaries before reparenting.
 *   3. Reparent each inner child to the outer operator at its computed
 *      target position via `pe.reparentExpression`.
 *   4. Remove the now-empty inner operator via
 *      `pe.removeExpression(inner.id, true)` (deleteSubtree is fine —
 *      it has zero children).
 *   5. Remove the now-empty formula wrapper via
 *      `pe.removeExpression(formula.id, false)`. Hits the 0-child
 *      leaf-removal branch of `removeAndPromote` so the inline P-1
 *      enforcement throw is not reached.
 *
 * Identity preservation: each absorbed child's expression id survives
 * the operation — `reparentExpression` mutates the position/parentId
 * fields atomically without minting new ids. Asserted by the contract
 * regression-guard tests in `test/grammar/an-rules.test.ts:559-893`.
 *
 * @since 1.0.0
 */
export function applyAN4<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): boolean {
    let anyChanged = false
    for (const pe of engine.listPremises()) {
        let premiseChanged = true
        while (premiseChanged) {
            premiseChanged = absorbOneSameOperatorInPremise(pe)
            if (premiseChanged) anyChanged = true
        }
    }
    return anyChanged
}

/**
 * Find one AN-4 candidate (inner OP whose parent is a formula whose
 * parent is the same-typed outer OP) in `pe`'s tree and absorb it.
 * Returns `true` iff an absorption occurred.
 *
 * Each call absorbs exactly one inner operator. The caller loops until
 * the tree is stable. The single-absorption-per-call shape matches
 * AN-2/AN-3 so cascading mutations don't trip mid-iteration tree-walk
 * invariants.
 */
function absorbOneSameOperatorInPremise<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(pe: PremiseEngine<TArg, TPremise, TExpr, TVar>): boolean {
    for (const inner of pe.getExpressions()) {
        // Only and/or inner operators absorb (S-5 keeps implies/iff at
        // root; not is unary so absorption doesn't apply).
        if (inner.type !== "operator") continue
        if (inner.operator !== "and" && inner.operator !== "or") continue

        const formulaId = inner.parentId
        if (formulaId === null) continue
        const formula = pe.getExpression(formulaId)
        if (!formula || formula.type !== "formula") continue

        const outerId = formula.parentId
        if (outerId === null) continue
        const outer = pe.getExpression(outerId)
        if (!outer || outer.type !== "operator") continue
        if (outer.operator !== inner.operator) continue

        // Pattern matches — absorb.
        absorbSameOperatorMatch(pe, inner.id, formulaId, outerId)
        return true
    }
    return false
}

/**
 * Execute one AN-4 absorption: move every child of `innerId` to be a
 * direct child of `outerId` at spacing-algorithm positions between the
 * formula's outer neighbors; remove `innerId` and `formulaId`.
 *
 * Ports the position-spacing + redistribution-fallback algorithm from
 * `ExpressionManager.absorbSameOperator` (em.ts:1240-1349) to the
 * public PE-mutation surface.
 */
function absorbSameOperatorMatch<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    pe: PremiseEngine<TArg, TPremise, TExpr, TVar>,
    innerId: string,
    formulaId: string,
    outerId: string
): void {
    const positionConfig = pe.getPositionConfig()

    // Capture inner children up front — we'll reparent each one. Use
    // the live ordering (getChildExpressions returns sorted by
    // position) so the target ordering under `outerId` matches the
    // inner's pre-absorption ordering.
    const innerChildren = pe.getChildExpressions(innerId)
    const count = innerChildren.length

    // Determine left/right neighbors of the formula under `outerId`.
    const outerChildren = pe.getChildExpressions(outerId)
    const formulaIdx = outerChildren.findIndex((c) => c.id === formulaId)
    const leftPos =
        formulaIdx > 0
            ? outerChildren[formulaIdx - 1].position
            : positionConfig.min
    const rightPos =
        formulaIdx < outerChildren.length - 1
            ? outerChildren[formulaIdx + 1].position
            : positionConfig.max

    // Tight-neighborhood guard: if `rightPos - leftPos <= count`, even
    // spacing collides. Redistribute all of outer's children evenly
    // across the full positionConfig range first, then re-compute the
    // formula's neighbors on the refreshed positions.
    const gap = rightPos - leftPos
    let effectiveLeftPos = leftPos
    let effectiveRightPos = rightPos
    if (gap <= count) {
        redistributeChildrenEvenly(pe, outerId, positionConfig)
        const refreshedOuter = pe.getChildExpressions(outerId)
        const refreshedFormulaIdx = refreshedOuter.findIndex(
            (c) => c.id === formulaId
        )
        effectiveLeftPos =
            refreshedFormulaIdx > 0
                ? refreshedOuter[refreshedFormulaIdx - 1].position
                : positionConfig.min
        effectiveRightPos =
            refreshedFormulaIdx < refreshedOuter.length - 1
                ? refreshedOuter[refreshedFormulaIdx + 1].position
                : positionConfig.max
    }

    // Reparent each inner child into the outer at its computed
    // position. Positions are `leftPos + ((rightPos - leftPos) /
    // (count + 1)) * (i + 1)`, truncated to integer per the legacy.
    for (let i = 0; i < count; i++) {
        const targetPosition = Math.trunc(
            effectiveLeftPos +
                ((effectiveRightPos - effectiveLeftPos) / (count + 1)) * (i + 1)
        )
        pe.reparentExpression(innerChildren[i].id, outerId, targetPosition)
    }

    // Inner is now empty. Remove with deleteSubtree=true (no subtree
    // remains, so this is a leaf removal).
    pe.removeExpression(innerId, true)

    // Formula is now empty (inner was its only child). Removing with
    // deleteSubtree=false routes through removeAndPromote's
    // 0-child leaf-removal branch — no promotion attempted, so the
    // inline P-1 enforcement throw at em.ts:863-876 cannot fire.
    pe.removeExpression(formulaId, false)
}

/**
 * Redistribute every existing child of `parentId` evenly across the
 * full position range (`positionConfig.min..max`). Used by AN-4's
 * tight-neighborhood fallback when the formula's left/right neighbors
 * sit so close that N evenly-spaced positions would collide.
 *
 * Implementation routes through `pe.reparentExpression(child.id,
 * parentId, newPos)` so the operation is observable via the public
 * mutation API and respects S-9 (which tolerates same-parent moves —
 * see `PremiseEngine.reparentExpression` JSDoc). We do the moves in
 * order, but the order within a same-parent redistribution doesn't
 * matter for the final state: each move detaches the child from its
 * old slot (freeing the position) before attaching at the new
 * position.
 *
 * **Two-phase ordering** required to avoid transient S-9 collisions:
 * if a child's new position happens to equal another child's existing
 * position, the single-shot reparent would throw S-9. Park each child
 * at a unique position in a high-half scratch range first (which is
 * guaranteed not to collide with any low-half target position), then
 * place them at their final positions in a second pass.
 */
function redistributeChildrenEvenly<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    pe: PremiseEngine<TArg, TPremise, TExpr, TVar>,
    parentId: string,
    positionConfig: ReturnType<typeof pe.getPositionConfig>
): void {
    const children = pe.getChildExpressions(parentId)
    const total = children.length
    if (total === 0) return

    const min = positionConfig.min
    const max = positionConfig.max
    const range = max - min

    // Compute the final target positions for each child.
    const targets: number[] = []
    for (let i = 0; i < total; i++) {
        targets.push(Math.trunc(min + (range / (total + 1)) * (i + 1)))
    }

    // Phase 1: park each child at a scratch position in the top half
    // of the range that cannot collide with any target (which all sit
    // in the lower half by `range / (total + 1)` construction). The
    // scratch positions are densely packed at the top so they also
    // don't collide with each other.
    const scratchBase = max - total
    for (let i = 0; i < total; i++) {
        pe.reparentExpression(children[i].id, parentId, scratchBase + i)
    }

    // Phase 2: move each child to its final target position. Targets
    // are all distinct by construction and all in the lower half, so
    // no two moves collide.
    for (let i = 0; i < total; i++) {
        pe.reparentExpression(children[i].id, parentId, targets[i])
    }
}

/**
 * Run AN-1 (insert formula buffer between operators) on every premise
 * of `engine`. Returns `true` iff any mutation occurred.
 *
 * **D0e: native rewrite.** Walks each premise's expression tree
 * looking for non-`not` operators whose parent is also an operator —
 * i.e., the P-1 violation shape `parent-op → child-op (non-not)`. For
 * each match, calls `pe.wrapInFormula(childOpId, formulaId)` which
 * atomically inserts a freshly-minted `formula` between parent and
 * child. The formula takes the child's original slot; the child
 * becomes the formula's sole child at position 0. Per spec §5.1 the
 * result preserves P-1.
 *
 * Why a dedicated `wrapInFormula` primitive rather than composing
 * `addExpression(formula)` + `reparentExpression(child)`:
 *
 *   - `addExpression(formula, parent, childPosition)` would throw S-9
 *     because the child still occupies that slot.
 *   - For unary `not` parents and binary `implies`/`iff` parents,
 *     `assertChildLimit` would reject the formula even transiently —
 *     even though the *net* child count of the parent is unchanged
 *     after the wrap (the formula displaces the child).
 *
 * `pe.wrapInFormula` sidesteps both by performing the insertion +
 * reparent as one bundled-composite mutation per spec §8 (see the PE
 * method's JSDoc for the atomicity contract).
 *
 * The new formula's id is minted via `engine.idGenerator` so id
 * provenance stays at the engine boundary (matches the
 * `populateFromGrounding` factory pattern in `populate-from.ts`).
 *
 * @since 1.0.0
 */
export function applyAN1<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): boolean {
    let anyChanged = false
    const gen = engine.idGenerator
    for (const pe of engine.listPremises()) {
        let premiseChanged = true
        while (premiseChanged) {
            premiseChanged = insertOneFormulaBufferInPremise(pe, gen)
            if (premiseChanged) anyChanged = true
        }
    }
    return anyChanged
}

/**
 * Find one P-1 violation in `pe`'s tree (non-`not` operator whose
 * parent is also an operator) and wrap the child in a formula buffer.
 * Returns `true` iff a wrap occurred.
 *
 * Single-fire-per-call shape matches AN-2/AN-3/AN-4 so cascading
 * mutations don't trip mid-iteration tree-walk invariants.
 */
function insertOneFormulaBufferInPremise<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(pe: PremiseEngine<TArg, TPremise, TExpr, TVar>, gen: () => string): boolean {
    for (const expr of pe.getExpressions()) {
        // P-1 fires on a non-`not` operator that is a direct child of
        // another operator.
        if (expr.type !== "operator") continue
        if (expr.operator === "not") continue
        if (expr.parentId === null) continue

        const parent = pe.getExpression(expr.parentId)
        if (!parent || parent.type !== "operator") continue

        // Wrap the child in a fresh formula. The primitive is atomic:
        // formula takes the child's slot, child becomes formula's sole
        // child at position 0.
        pe.wrapInFormula(expr.id, gen())
        return true
    }
    return false
}

/**
 * Run AN-1..AN-4 to fixed point on every premise of `engine`.
 *
 * **D0e state: all four rules are native.** The driver issues
 * single-rule passes in order — AN-2, AN-3, AN-4, AN-1 — so buffer
 * insertion sees the post-collapse tree (avoids inserting a buffer
 * that would then need to be collapsed by AN-3). The outer loop is
 * the actual convergence driver: each iteration fires at most one
 * rule's pattern (via the `||` short-circuit) and loops until no
 * pattern remains. D0f re-evaluates the short-circuit semantics
 * (synthesis P2 #2 — `let changed = applyAN2(eng); changed =
 * applyAN3(eng) || changed; …` reduce-or vs the current chain).
 *
 * Convergence cap: `MAX_AN_ITERATIONS = 10`. Typical convergence is ≤ 3
 * iterations (spec §5.1); the cap protects against pathological inputs
 * (e.g. malformed Structural state that would otherwise oscillate).
 *
 * @since 1.0.0
 */
export function applyANToFixedPoint<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): void {
    let lastChangedRule: "AN-1" | "AN-2" | "AN-3" | "AN-4" | null = null
    for (let i = 0; i < MAX_AN_ITERATIONS; i++) {
        // Order: AN-2/3/4 before AN-1 so buffer insertion (AN-1)
        // sees the post-collapse tree (avoids inserting a buffer
        // that AN-3 would then collapse). All four rules are now
        // native single-rule passes (D0e), so the `||` short-circuit
        // means at most one rule fires per outer iteration — if AN-2
        // fires, AN-3/4/1 are skipped this iteration and we loop
        // back. Worst-case the chain takes ~4x as many iterations as
        // a reduce-or accumulator; spec §5.1 budgets "≤ 3 iterations
        // typical" so this is comfortably within the MAX_AN_ITERATIONS
        // cap on the existing test corpus. D0f revisits the
        // short-circuit semantics (synthesis P2 #2).
        let changed = false
        if (applyAN2(engine)) {
            lastChangedRule = "AN-2"
            changed = true
        } else if (applyAN3(engine)) {
            lastChangedRule = "AN-3"
            changed = true
        } else if (applyAN4(engine)) {
            lastChangedRule = "AN-4"
            changed = true
        } else if (applyAN1(engine)) {
            lastChangedRule = "AN-1"
            changed = true
        }
        if (!changed) return
    }
    // Diagnostic context: include the iteration count and the
    // last-changed rule + a representative premise id. Helps the
    // next dev triage where the loop is oscillating when the cap
    // trips. As of D0e the outer loop is the actual convergence
    // driver — all four rules are native single-rule passes — so
    // a cap-trip indicates a real oscillation, not a budgeting
    // artifact of the prior delegation pattern.
    const premises = engine.listPremises()
    const representativePremiseId =
        premises.length > 0 ? premises[0].getId() : "<no premises>"
    throw new Error(
        `AN convergence cap reached (${MAX_AN_ITERATIONS} iterations; ` +
            `last-changed rule: ${lastChangedRule ?? "<none>"}; ` +
            `representative premise: ${representativePremiseId}). ` +
            `Argument may be in a malformed Structural state — ` +
            `investigate before re-running.`
    )
}

// `runLegacyNormalizeAndReportChange` lived here during D0a-D0d as a
// shared delegation helper for applyAN1 / applyAN4. With AN-1 and AN-4
// natively implemented in D0e, no caller remains and the helper is
// removed. D0f follows up by re-evaluating the `||` short-circuit
// chain in `applyANToFixedPoint` (synthesis P2 #2 — left intact this
// cycle per dispatch instructions).
