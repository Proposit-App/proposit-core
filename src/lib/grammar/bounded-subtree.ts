// Shared helper for "formula bounded subtree" traversal.
//
// P-3 justifies a formula iff its bounded subtree contains a variadic
// connective (`and`, `or` or `xor`). The traversal stops at any *nested*
// formula — each formula is its own P-3 scope.
//
// Two consumers need this check at different points in the engine's
// lifecycle:
//
//   - `src/lib/grammar/validators/presentable.ts` (P-3 validator):
//     reads from a `TChildMap` snapshot built once from the engine's
//     expression list. Stale-snapshot reads don't matter because
//     `validate(tier)` is a pure query against a settled tree.
//   - `src/lib/grammar/an-rules.ts` (native AN-3): reads from
//     `pe.getChildExpressions(id)` so it sees the live tree mid-AN
//     pass. A `TChildMap` snapshot from before the pass would be stale
//     and produce wrong answers for already-collapsed subtrees.
//
// This module factors the traversal out behind a `(id) => readonly TExpr[]`
// lookup-function parameter so both consumers can share one
// implementation while binding the lookup to their own freshness story,
// rather than duplicating the bounded-subtree walk in each.

import type { TCorePropositionalExpression } from "../schemata/index.js"

/**
 * Returns `true` iff the subtree rooted at `expressionId` contains a
 * variadic connective (`and`, `or` or `xor`). Traversal stops at nested
 * formulas (each formula starts a new P-3 scope).
 *
 * The starting node itself counts: if the caller asks "does formula
 * F's bounded subtree contain a variadic connective?", they pass F's
 * **child** (not F itself) — because traversal stops at the first
 * nested formula encountered, and starting at F would immediately
 * stop. (Equivalently: callers may iterate F's children and call this
 * helper on each child, or pass F's only child for the typical
 * `formula(x)` case.)
 *
 * Note: `implies` and `iff` are intentionally excluded. S-5 restricts both
 * to premise roots, so they cannot appear as formula descendants in a
 * Structural-valid tree. `xor` is not root-restricted and is included:
 * omitting it would make AN-3 strip the very buffer AN-1 inserts around a
 * nested `xor`, and `applyANToFixedPoint` would oscillate to its cap.
 *
 * @param expressionId Subtree root id.
 * @param lookup `(id) => children` — must return live children at
 *               call time. Typical bindings: a closure over a
 *               pre-built `TChildMap` for validator use, or
 *               `pe.getChildExpressions.bind(pe)` for AN-pass use.
 * @param getExpression `(id) => TCorePropositionalExpression | undefined`
 *               — resolve the starting node by id; the lookup function
 *               returns descendants by id but doesn't include the
 *               start node itself.
 */
export function hasBinaryOperatorInBoundedSubtree(
    expressionId: string,
    lookup: (id: string) => readonly TCorePropositionalExpression[],
    getExpression: (id: string) => TCorePropositionalExpression | undefined
): boolean {
    const root = getExpression(expressionId)
    if (!root) return false
    const stack: TCorePropositionalExpression[] = [root]
    while (stack.length > 0) {
        const cursor = stack.pop()!
        if (
            cursor.type === "operator" &&
            (cursor.operator === "and" ||
                cursor.operator === "or" ||
                cursor.operator === "xor")
        ) {
            return true
        }
        // Stop at nested formulas — each formula is its own P-3 scope.
        // The starting node is not treated as a nested formula even if
        // it happens to be one (the caller is asking about *its*
        // subtree).
        if (cursor.id !== expressionId && cursor.type === "formula") continue
        for (const child of lookup(cursor.id)) {
            stack.push(child)
        }
    }
    return false
}
