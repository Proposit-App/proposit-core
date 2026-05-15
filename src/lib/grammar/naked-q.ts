// Shared naked-Q predicates.
//
// A derivation premise is in **naked-Q form** when its expression tree is
// exactly one expression at the root and that expression is of type
// `variable`. Naked-Q is the canonical post-creation state for a
// derivation premise — it represents "no support given yet" and is a
// valid Derivable state (D-1 admits it; D-2/D-3 govern populated forms).
//
// Two predicates are exported because two callers have slightly different
// preconditions:
//
//   - `isNakedQTree(pe)` — checks tree shape only (`exprs.length === 1`
//     and `root.type === 'variable'`). Used by callers that already know
//     the premise is `type='derivation'`, e.g.
//     `populateFromGrounding` inside the C6 factory after the derivation
//     premise has been located by `derivedClaimId`.
//
//   - `isNakedQDerivationPremise(pe)` — additionally checks the
//     premise's `type === 'derivation'`. Used by the evaluator's C8 skip
//     filter, which scans all premises (any type) and must reject
//     non-derivation premises before checking the tree shape.
//
// The two share a single tree-shape helper; the second composes the
// derivation-type check on top. Consolidates the duplicated predicates
// that existed in `populate-from.ts` (`isNakedQ`, local to the factory)
// and `argument-engine.ts` (`isNakedQDerivation`, local to
// `asEvaluationContext`).

import type { PremiseEngine } from "../core/premise-engine.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"

/**
 * Return `true` iff `pe`'s expression tree is exactly one expression at
 * the root and that expression is of type `variable`. Does NOT inspect
 * the premise type — caller is responsible for any `type === 'derivation'`
 * check.
 *
 * @since 1.0.0
 */
export function isNakedQTree<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(pe: PremiseEngine<TArg, TPremise, TExpr, TVar>): boolean {
    const exprs = pe.getExpressions()
    if (exprs.length !== 1) return false
    const root = pe.getRootExpression()
    if (root === undefined) return false
    return root.type === "variable"
}

/**
 * Return `true` iff `pe` is a derivation-typed premise (`type ===
 * 'derivation'`) AND its expression tree is in naked-Q form per
 * `isNakedQTree`.
 *
 * @since 1.0.0
 */
export function isNakedQDerivationPremise<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(pe: PremiseEngine<TArg, TPremise, TExpr, TVar>): boolean {
    // `TPremise extends TCorePremise`, so `.type` is in-scope without a cast.
    if (pe.toPremiseData().type !== "derivation") return false
    return isNakedQTree(pe)
}
