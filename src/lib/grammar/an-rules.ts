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
// **D0b — AN-2 native, AN-1/3/4 still delegated.** `applyAN2`
// implements double-negation collapse directly via
// `PremiseEngine.removeExpression(id, false)`. `applyAN1`,
// `applyAN3`, `applyAN4`, and `applyANToFixedPoint` still
// delegate to the legacy `pe.normalizeExpressions()` full sweep;
// D0c-D0e rewrite the remaining three rules natively and D0f
// flips the `runAssistiveNormalization` + `normalizeArgument`
// bridges to call `applyANToFixedPoint` directly without going
// through `pe.normalizeExpressions()`. Until then this module
// establishes the **module boundary** — callers in
// `auto-normalize.ts` and `normalize.ts` route AN through this
// module's exports rather than reaching into PE directly. That
// boundary lets the remaining rules be replaced in place without
// touching the bridge.
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

type TAnyEngine = ArgumentEngine<
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim
>

type TAnyPremiseEngine = PremiseEngine<
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable
>

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
export function applyAN2(engine: TAnyEngine): boolean {
    let anyChanged = false
    for (const pe of engine.listPremises() as TAnyPremiseEngine[]) {
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
function collapseOneDoubleNegationInPremise(pe: TAnyPremiseEngine): boolean {
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
 * **D0a state: delegates to `pe.normalizeExpressions()`.** Native
 * rewrite lands in D0c.
 *
 * @since 1.0.0
 */
export function applyAN3(engine: TAnyEngine): boolean {
    return runLegacyNormalizeAndReportChange(engine)
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
export function applyAN4(engine: TAnyEngine): boolean {
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
export function applyAN1(engine: TAnyEngine): boolean {
    return runLegacyNormalizeAndReportChange(engine)
}

/**
 * Run AN-1..AN-4 to fixed point on every premise of `engine`.
 *
 * **D0b state: AN-2 is native; AN-1/3/4 still delegate to
 * `pe.normalizeExpressions()`.** Each call of the delegating rules
 * runs the full legacy sweep (which itself is fixed-pointed), so
 * within a single iteration of this driver any one of the
 * delegating calls converges the tree. AN-2's native pass is
 * effectively a fast-path before the legacy sweep — it catches the
 * NOT(NOT(x)) case explicitly so the regression-guard tests can
 * spy on the native code path. D0f rewires this function to call
 * the four native passes in order (AN-2, AN-3, AN-4, AN-1 — buffer
 * insertion sequenced last so earlier passes see the post-collapse
 * tree).
 *
 * Convergence cap: `MAX_AN_ITERATIONS = 10`. Typical convergence is ≤ 3
 * iterations (spec §5.1); the cap protects against pathological inputs
 * (e.g. malformed Structural state that would otherwise oscillate).
 * In D0b, the outer loop typically exits within 1 iteration because
 * the legacy sweep already drives the rest of convergence. Once
 * D0c-D0e are native, the outer loop is what drives convergence.
 *
 * @since 1.0.0
 */
export function applyANToFixedPoint(engine: TAnyEngine): void {
    for (let i = 0; i < MAX_AN_ITERATIONS; i++) {
        const changed =
            // Order matches the post-D0f intent: AN-2/3/4 before AN-1
            // so buffer insertion sees the post-collapse tree. In the
            // current D0a delegation each `applyAN*` runs the full
            // legacy sweep, so only the first non-no-op call reports
            // change; subsequent calls in the same iteration are
            // effective no-ops. The redundancy is acceptable scaffolding;
            // D0b-D0e replace each function with a single-rule
            // implementation that fires only when its pattern matches.
            applyAN2(engine) ||
            applyAN3(engine) ||
            applyAN4(engine) ||
            applyAN1(engine)
        if (!changed) return
    }
    throw new Error(
        `AN convergence cap reached (${MAX_AN_ITERATIONS} iterations). ` +
            `Argument may be in a malformed Structural state — investigate ` +
            `before re-running.`
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
function runLegacyNormalizeAndReportChange(engine: TAnyEngine): boolean {
    let anyChanged = false
    for (const pe of engine.listPremises() as TAnyPremiseEngine[]) {
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
