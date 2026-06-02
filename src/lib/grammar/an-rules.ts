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
// This module is the **native home** of the rule set for v1.0. The
// rules live here, in the grammar module, rather than inside
// `ExpressionManager.normalize()`, so the AN pass is not coupled to the
// legacy `grammarConfig` machinery, and so the per-mutation AN inside
// `ExpressionManager` mutation methods and the legacy P-1 throw sites
// are no longer needed.
//
// **All four rules are native.** `applyAN1`, `applyAN2`, `applyAN3`,
// and `applyAN4` implement their rules directly against the public
// `PremiseEngine` mutation API. AN-1 uses
// `pe.wrapInFormula(childOpId, formulaId)` to atomically insert a
// formula buffer between an operator parent and a non-`not` operator
// child (composing this from `addExpression` + `reparentExpression`
// would trip S-9 transiently and violate parent child-limits under
// unary `not` and binary `implies`/`iff` parents — see the
// `wrapInFormula` JSDoc on PE for the full argument). AN-2 and AN-3
// use `pe.removeExpression(id, false)`. AN-4 uses
// `pe.reparentExpression(c_i, outerId, position_i)` + a final
// `pe.removeExpression(formula, false)` cleanup.
//
// `applyANToFixedPoint` uses a reduce-or accumulator (all four rules
// per outer iteration, OR'd into the changed flag) rather than a `||`
// short-circuit chain (which would fire at most one rule per outer
// iteration). The PERMISSIVE config swap that once disarmed the legacy
// inline P-1 enforcement throws is gone — those throw sites and the
// surrounding `grammarConfig` machinery have been removed — so AN-2 and
// AN-3 can run unconditionally without tripping a P-1 throw mid-pass.
//
// The per-rule tests (`test/grammar/an-rules.test.ts`) assert behavior
// the native implementation must preserve.

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
 * Walks each premise's expression tree looking for NOT(NOT(x)) —
 * both the direct form (`NOT_outer → NOT_inner → x`) and the
 * buffered form (`NOT_outer → formula → NOT_inner → x`). For each
 * match issues two `pe.removeExpression(id, false)` calls that
 * promote the grandchild (and, in the buffered case, the residual
 * formula) through the two NOT layers.
 *
 * The buffered case leaves an unjustified `formula(x)` residue
 * which AN-3 cleans up in a subsequent iteration of
 * `applyANToFixedPoint`. AN-2 stays focused on the NOT-NOT
 * collapse itself — no formula bookkeeping.
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
 * Walks each premise's expression tree and collapses four sub-cases
 * via `pe.removeExpression(id, false)`:
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
 * while the validator binds to a snapshot `TChildMap`. Sharing the
 * one helper keeps the rule and its validator in lockstep.
 *
 * Behavior is asserted by the regression-guard tests in
 * `test/grammar/an-rules.test.ts`.
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
 * Walks each premise's expression tree for the absorption shape
 * `OUTER_OP → (..., ) formula → INNER_OP (same
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
    // position. Naive position formula (from the legacy AN-4):
    //   `leftPos + ((rightPos - leftPos) / (count + 1)) * (i + 1)`,
    // truncated to integer.
    //
    // **Forbidden-set walk.** A naive computed target can collide
    // with two kinds of obstacles, both of which would trip S-9
    // inside `pe.reparentExpression`:
    //
    //   (a) **The formula's current position.** The formula is still
    //       a child of `outerId` at this point — we only remove it
    //       *after* the inner reparents. After
    //       `redistributeChildrenEvenly` fires the formula sits at
    //       one of the redistributed slots between `effectiveLeftPos`
    //       and `effectiveRightPos`; on the non-redistribute path
    //       the formula keeps its pre-mutation position. Either way,
    //       any naive target equal to the formula's position would
    //       collide.
    //
    //   (b) **Already-placed inner-child target positions.** When
    //       `gap = count + 1` (integer spacing 1) a simple ±1 shift
    //       would move a colliding target to the slot reserved for the
    //       *next* planned target, so the next iteration would then
    //       trip S-9 against the just-placed inner child.
    //
    // To handle both, a single `forbidden` set is tracked: the
    // formula's current position seeds the set, and each chosen
    // target gets added as it's planned. For any computed target
    // already in `forbidden`, scan outward (±1, ±2, ...) for the
    // first free integer strictly inside `(effectiveLeftPos,
    // effectiveRightPos)`. The band-exhaustion case (no free integer
    // anywhere in the band) is structurally reachable only when the
    // position keyspace is deeply pathological — throw with a
    // diagnostic that names the forbidden set to aid triage.
    const refreshedFormula = pe.getExpression(formulaId)
    const formulaCurrentPosition = refreshedFormula
        ? refreshedFormula.position
        : null
    const forbidden = new Set<number>()
    if (formulaCurrentPosition !== null) {
        forbidden.add(formulaCurrentPosition)
    }
    for (let i = 0; i < count; i++) {
        const naiveTarget = Math.trunc(
            effectiveLeftPos +
                ((effectiveRightPos - effectiveLeftPos) / (count + 1)) * (i + 1)
        )
        let chosen = naiveTarget
        if (forbidden.has(chosen)) {
            // Scan outward in expanding ±k rings for a free integer
            // strictly inside `(effectiveLeftPos, effectiveRightPos)`.
            // Down-first then up-first per ring matches the prior ±1
            // shift's "shift toward effectiveLeftPos when target is
            // left of midpoint" bias without depending on the
            // midpoint calculation (the integer-truncation boundary
            // doesn't change ring search behavior).
            const bandWidth = effectiveRightPos - effectiveLeftPos
            let found = false
            for (let k = 1; k < bandWidth; k++) {
                const down = naiveTarget - k
                if (down > effectiveLeftPos && !forbidden.has(down)) {
                    chosen = down
                    found = true
                    break
                }
                const up = naiveTarget + k
                if (up < effectiveRightPos && !forbidden.has(up)) {
                    chosen = up
                    found = true
                    break
                }
            }
            if (!found) {
                const sortedForbidden = [...forbidden]
                    .sort((a, b) => a - b)
                    .join(", ")
                throw new Error(
                    `AN-4 absorbSameOperatorMatch: no free position in ` +
                        `(${effectiveLeftPos}, ${effectiveRightPos}) for ` +
                        `inner child #${i} of "${innerId}" under "${outerId}" ` +
                        `(forbidden: [${sortedForbidden}]). ` +
                        `Position keyspace is over-saturated — argument ` +
                        `may be in a structurally pathological state.`
                )
            }
        }
        forbidden.add(chosen)
        pe.reparentExpression(innerChildren[i].id, outerId, chosen)
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
 * see `PremiseEngine.reparentExpression` JSDoc).
 *
 * **Two-phase ordering** required to avoid transient S-9 collisions:
 * the bulk move uses scratch positions that are guaranteed disjoint
 * from (a) every currently-occupied position under `parentId` and (b)
 * the final target positions, then phase 2 places each child at its
 * target. Scratch positions are picked by scanning from `max`
 * downward, skipping any position currently held by a child of
 * `parentId`. This is robust against the pathological case where some
 * children sit close to `POSITION_MAX` — a fixed-scratch range
 * `[max - total, max - 1]` could collide with existing children near
 * the top, tripping the S-9 check inside `pe.reparentExpression`. That
 * collision case is structurally reachable precisely because the
 * redistribute fallback's own raison d'être is pathological
 * position-keyspace clustering.
 *
 * Edge case: total saturation (every position from `min` to `max`
 * occupied) is astronomical — `total > range` (≈ 4.3B) — and is not
 * defended against here. If the scratch scan can't find `total`
 * disjoint positions an Error is thrown with diagnostic context.
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

    // Build the forbidden-position set: union of (a) current
    // positions held by children of parentId and (b) the final
    // target positions. Phase-1 scratches must avoid both:
    //
    //   (a) avoids S-9 on a not-yet-moved sibling during phase 1;
    //   (b) avoids S-9 in phase 2, where targets land on positions
    //       still held by not-yet-moved children carrying scratch
    //       positions from phase 1.
    //
    // A hard-coded scratch window `[max - total, max - 1]` would
    // cover both concerns *only* when current positions were well
    // below the top of the range — leaving clustered-near-max inputs
    // (which is the redistribute fallback's own raison d'être)
    // structurally exposed to a collision.
    const forbidden = new Set<number>()
    for (const c of children) {
        forbidden.add(c.position)
    }
    for (const t of targets) {
        forbidden.add(t)
    }

    // Skip children that are already at their target position.
    // Unconditionally scratching and back-moving every child would
    // emit 2 reparent change records per already-at-target child;
    // skipping them is correctness-equivalent:
    // - The skipped child's current position equals its target, so it
    //   sits inside `forbidden` already (both via the `current` and
    //   the `targets` contributions) — phase-1 scratches still avoid
    //   it, and other children's phase-2 targets are pairwise
    //   distinct from this child's target.
    // Only count + reserve scratches for children that actually move.
    const needsMove: boolean[] = []
    let movingCount = 0
    for (let i = 0; i < total; i++) {
        const moves = children[i].position !== targets[i]
        needsMove.push(moves)
        if (moves) movingCount++
    }

    // Phase 1: scan downward from `max` selecting `movingCount`
    // distinct scratch positions not in `forbidden`. The resulting
    // scratches are pairwise distinct (the scan never revisits) and
    // disjoint from all current child positions AND from all target
    // positions, so neither phase-1 nor phase-2 reparents can trip
    // S-9.
    const scratches: number[] = []
    let cursor = max
    while (scratches.length < movingCount && cursor >= min) {
        if (!forbidden.has(cursor)) {
            scratches.push(cursor)
        }
        cursor--
    }
    if (scratches.length < movingCount) {
        throw new Error(
            `AN-4 redistributeChildrenEvenly: cannot find ${movingCount} ` +
                `disjoint scratch positions in [${min}, ${max}] for ` +
                `parent "${parentId}" (current+target occupied: ${forbidden.size}).`
        )
    }

    let scratchIdx = 0
    for (let i = 0; i < total; i++) {
        if (!needsMove[i]) continue
        pe.reparentExpression(children[i].id, parentId, scratches[scratchIdx++])
    }

    // Phase 2: move each child to its final target position. Targets
    // are pairwise distinct by `range / (total + 1)` construction and
    // disjoint from scratches by the `forbidden` exclusion above, so
    // no phase-2 reparent collides.
    for (let i = 0; i < total; i++) {
        if (!needsMove[i]) continue
        pe.reparentExpression(children[i].id, parentId, targets[i])
    }
}

/**
 * Run AN-1 (insert formula buffer between operators) on every premise
 * of `engine`. Returns `true` iff any mutation occurred.
 *
 * Walks each premise's expression tree looking for non-`not`
 * operators whose parent is also an operator — i.e., the P-1
 * violation shape `parent-op → child-op (non-not)`. For
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
 * All four rules are native. The driver issues single-rule passes in
 * order — AN-2, AN-3, AN-4, AN-1 — so buffer insertion sees the
 * post-collapse tree (avoids inserting a buffer that would then need
 * to be collapsed by AN-3).
 *
 * The driver uses a reduce-or accumulator rather than a `||`
 * short-circuit chain: every outer iteration fires all four rules
 * and records whether ANY produced a mutation. This reduces outer
 * iterations by ~4x in the worst case versus the short-circuit
 * pattern, and pulls the iteration count back well within
 * MAX_AN_ITERATIONS for borderline inputs.
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
    // The PERMISSIVE swap that disarmed the legacy inline P-1
    // enforcement throws is gone — those P-1 throw sites and the
    // surrounding `grammarConfig.enforceFormulaBetweenOperators`
    // machinery have been removed. AN-2 and AN-3 can now run
    // unconditionally without tripping a P-1 throw mid-pass.
    //
    // Re-entrance guard: AN's own mutations
    // (`pe.removeExpression` / `pe.reparentExpression` /
    // `pe.wrapInFormula`) re-fire `setOnMutate` on the engine, which
    // calls `runAssistiveNormalization(this)` → `applyANToFixedPoint`
    // again. The guard short-circuits nested entries so the outer
    // sweep runs uninterrupted. `beginApplyAN` returns `false` when
    // AN is already in progress; we no-op in that case.
    if (!engine.beginApplyAN()) return
    try {
        applyANRulesToConvergence(engine)
    } finally {
        engine.endApplyAN()
    }
}

function applyANRulesToConvergence<
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
        // that AN-3 would then collapse). All four rules are native
        // single-rule passes.
        //
        // Reduce-or accumulator rather than a `||` short-circuit: a
        // short-circuit would fire at most one rule per outer
        // iteration — if AN-2 fired, AN-3/4/1 would be skipped this
        // iteration and the loop would go back to the top. The
        // accumulator runs ALL four rules per iteration and records
        // whether ANY made a change. This reduces outer iterations
        // by ~4x in the worst case where multiple rules have
        // independent firing sites in the same premise tree, and
        // pulls the outer loop's iteration count back well within
        // MAX_AN_ITERATIONS for inputs that would otherwise approach
        // the cap. `lastChangedRule` records the most recently
        // changed rule (kept stable across the iteration in
        // priority order AN-2 → AN-3 → AN-4 → AN-1 so the
        // diagnostic still reports which rule was active last when
        // the cap trips).
        let changed = false
        if (applyAN2(engine)) {
            lastChangedRule = "AN-2"
            changed = true
        }
        if (applyAN3(engine)) {
            lastChangedRule = "AN-3"
            changed = true
        }
        if (applyAN4(engine)) {
            lastChangedRule = "AN-4"
            changed = true
        }
        if (applyAN1(engine)) {
            lastChangedRule = "AN-1"
            changed = true
        }
        if (!changed) return
    }
    // Diagnostic context: include the iteration count and the
    // last-changed rule + a representative premise id to aid triage
    // of where the loop is oscillating when the cap trips. The outer
    // loop is the actual convergence driver — all four rules are
    // native single-rule passes — so a cap-trip indicates a real
    // oscillation in a malformed Structural state.
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
