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
// **D0a — scaffold delegation (current state).** Each `applyAN*`
// function and `applyANToFixedPoint` initially delegate to
// `pe.normalizeExpressions()` which is the existing
// `ExpressionManager.normalize()` full-sweep implementation. The native
// per-rule rewrites land in D0b-D0e; D0f flips the
// `runAssistiveNormalization` + `normalizeArgument` bridges to call
// `applyANToFixedPoint` directly without going through
// `pe.normalizeExpressions()`. Until then this module establishes the
// **module boundary** — callers in `auto-normalize.ts` and
// `normalize.ts` route AN through this module's exports rather than
// reaching into PE directly. That boundary lets D0b-D0e replace each
// rule's implementation in place without touching the bridge.
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
 * **D0a state: delegates to `pe.normalizeExpressions()`.** The legacy
 * sweep runs every rule (1–5) in one pass; an AN-2-specific dispatch
 * is not possible without breaking the all-or-nothing contract of the
 * legacy implementation. Native rewrite lands in D0b.
 *
 * @since 1.0.0
 */
export function applyAN2(engine: TAnyEngine): boolean {
    return runLegacyNormalizeAndReportChange(engine)
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
 * **D0a state: delegates to `pe.normalizeExpressions()`.** D0f rewires
 * this function to run the four native passes in order
 * (AN-2, AN-3, AN-4, AN-1 — buffer insertion is sequenced last so the
 * earlier passes operate on the post-collapse tree and avoid inserting
 * buffers that would then need to be collapsed). Until D0f the legacy
 * fixed-point loop inside `ExpressionManager.normalize()` is what
 * actually drives convergence.
 *
 * Convergence cap: `MAX_AN_ITERATIONS = 10`. Typical convergence is ≤ 3
 * iterations (spec §5.1); the cap protects against pathological inputs
 * (e.g. malformed Structural state that would otherwise oscillate).
 * The current D0a delegation runs the legacy sweep inside a single
 * iteration of the loop below — the legacy sweep is itself
 * fixed-pointed, so the outer loop exits immediately. Once D0b-D0e are
 * native, the outer loop is what drives convergence.
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
