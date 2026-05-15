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
// **D0c — AN-2 + AN-3 native, AN-1/4 still delegated.** `applyAN2`
// and `applyAN3` implement their rules directly via
// `PremiseEngine.removeExpression(id, false)`. `applyAN1`,
// `applyAN4`, and `applyANToFixedPoint` still delegate to the legacy
// `pe.normalizeExpressions()` full sweep; D0d-D0e rewrite the
// remaining two rules natively and D0f flips the
// `runAssistiveNormalization` + `normalizeArgument` bridges to call
// `applyANToFixedPoint` directly without going through
// `pe.normalizeExpressions()`. Until then this module establishes
// the **module boundary** — callers in `auto-normalize.ts` and
// `normalize.ts` route AN through this module's exports rather than
// reaching into PE directly. That boundary lets the remaining rules
// be replaced in place without touching the bridge.
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
 * is a separate P-3 scope). The local
 * `hasBinaryOperatorInBoundedSubtreeFor` helper mirrors the validator's
 * `hasBinaryOperatorInBoundedSubtree` in
 * `validators/presentable.ts` but operates against
 * `pe.getChildExpressions(id)` so AN-3 doesn't need access to the
 * validator's internal `TChildMap`.
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
                !hasBinaryOperatorInBoundedSubtreeFor(pe, children[0].id)
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
 * Returns `true` if the subtree rooted at `expressionId` (within
 * `pe`) contains a binary operator (`and` or `or`). Traversal stops
 * at nested formulas — each formula is its own P-3 scope.
 *
 * Mirrors `hasBinaryOperatorInBoundedSubtree` in
 * `src/lib/grammar/validators/presentable.ts`, but operates against
 * the premise engine's public child-lookup API instead of the
 * validator's `TChildMap`. The duplication is intentional: AN-3's
 * collapse decision happens mid-mutation when the validator's
 * snapshot would be stale.
 *
 * Note: `implies` and `iff` are intentionally excluded from the
 * "binary operator" check — S-5 restricts both to premise roots, so
 * they cannot appear as formula descendants in a Structural-valid
 * tree.
 */
function hasBinaryOperatorInBoundedSubtreeFor<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    pe: PremiseEngine<TArg, TPremise, TExpr, TVar>,
    expressionId: string
): boolean {
    const root = pe.getExpression(expressionId)
    if (!root) return false
    const stack = [root]
    while (stack.length > 0) {
        const cursor = stack.pop()!
        if (
            cursor.type === "operator" &&
            (cursor.operator === "and" || cursor.operator === "or")
        ) {
            return true
        }
        // Stop at nested formulas — separate scope.
        if (cursor.id !== expressionId && cursor.type === "formula") continue
        for (const child of pe.getChildExpressions(cursor.id)) {
            stack.push(child)
        }
    }
    return false
}

/**
 * Run AN-4 (absorb same-operator through formula) on every premise of
 * `engine`. Returns `true` iff any mutation occurred.
 *
 * **D0a state: delegates to `pe.normalizeExpressions()`.** Native
 * rewrite lands in D0d.
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
    return runLegacyNormalizeAndReportChange(engine)
}

/**
 * Run AN-1 (insert formula buffer between operators) on every premise
 * of `engine`. Returns `true` iff any mutation occurred.
 *
 * **D0a state: delegates to `pe.normalizeExpressions()`.** Native
 * rewrite lands in D0e — AN-1 is sequenced last because it's the most
 * complex rule (parent-position bookkeeping + PERMISSIVE config swap
 * to avoid the legacy inline P-1 enforcement throw, which is queued
 * for removal in D2).
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
    return runLegacyNormalizeAndReportChange(engine)
}

/**
 * Run AN-1..AN-4 to fixed point on every premise of `engine`.
 *
 * **D0c state: AN-2 and AN-3 are native; AN-1/4 still delegate to
 * `pe.normalizeExpressions()`.** Each call of the delegating rules
 * runs the full legacy sweep (which itself is fixed-pointed), so
 * within a single iteration of this driver any delegating call
 * converges the tree. AN-2 and AN-3 native passes are effectively
 * fast-paths before the legacy sweep — they catch their specific
 * patterns explicitly so the regression-guard tests can spy on the
 * native code paths. D0f rewires this function to call the four
 * native passes in order (AN-2, AN-3, AN-4, AN-1 — buffer
 * insertion sequenced last so earlier passes see the post-collapse
 * tree).
 *
 * Convergence cap: `MAX_AN_ITERATIONS = 10`. Typical convergence is ≤ 3
 * iterations (spec §5.1); the cap protects against pathological inputs
 * (e.g. malformed Structural state that would otherwise oscillate).
 * In D0c, the outer loop typically exits within 1 iteration because
 * the legacy sweep already drives the rest of convergence. Once
 * D0d-D0e are native, the outer loop is what drives convergence.
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
        // Order matches the post-D0f intent: AN-2/3/4 before AN-1
        // so buffer insertion sees the post-collapse tree. In the
        // current D0c-D0d delegation, `applyAN4`/`applyAN1` still
        // run the full legacy sweep, so only the first non-no-op
        // call reports change; subsequent calls in the same
        // iteration are effective no-ops. The redundancy is
        // acceptable scaffolding; D0d-D0e replace each function
        // with a single-rule implementation that fires only when
        // its pattern matches. The `||` short-circuit semantics
        // become meaningful only post-D0f — see the D0f task in the
        // plan for the convergence-ordering revisit.
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
    // trips. Unreachable in D0c-D0d on Presentable-clean inputs
    // (the legacy sweep is internally fixed-pointed and converges
    // in a single outer iteration); becomes reachable once D0e is
    // native and the outer loop is the actual convergence driver.
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

/**
 * D0a-only helper. Runs `pe.normalizeExpressions()` on every premise
 * of `engine`. Returns `true` iff any mutation occurred (detected by
 * comparing pre/post per-premise expression counts; rough but
 * sufficient as a change indicator for the convergence loop above).
 *
 * Deleted in D0f when each `applyAN*` becomes a single-rule native
 * implementation.
 */
function runLegacyNormalizeAndReportChange<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): boolean {
    let anyChanged = false
    for (const pe of engine.listPremises()) {
        const beforeIds = new Set(pe.getExpressions().map((e) => e.id))
        pe.normalizeExpressions()
        const afterIds = new Set(pe.getExpressions().map((e) => e.id))
        if (beforeIds.size !== afterIds.size) {
            anyChanged = true
            continue
        }
        for (const id of beforeIds) {
            if (!afterIds.has(id)) {
                anyChanged = true
                break
            }
        }
    }
    return anyChanged
}
