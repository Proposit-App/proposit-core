// Lookup tables over a flat list of expressions, shared by the tier
// validators. Internal to the grammar module; not exported from the package.

import type { TCorePropositionalExpression } from "../../schemata/index.js"

export type TChildMap = Map<string, TCorePropositionalExpression[]>

/**
 * Build a Map<parentId, children-sorted-by-position> view of the
 * expression tree. Root expressions (no parent) are left out. Children
 * sharing a position keep their input order, because the sort is stable.
 */
export function buildChildMap(
    expressions: readonly TCorePropositionalExpression[]
): TChildMap {
    const out: TChildMap = new Map()
    for (const e of expressions) {
        if (e.parentId === null) continue
        const list = out.get(e.parentId) ?? []
        list.push(e)
        out.set(e.parentId, list)
    }
    for (const list of out.values()) {
        list.sort((a, b) => a.position - b.position)
    }
    return out
}

/**
 * Map<expressionId, expression> view for quick lookup. When two
 * expressions share an id, the later one in the input wins.
 */
export function buildExpressionsById(
    expressions: readonly TCorePropositionalExpression[]
): Map<string, TCorePropositionalExpression> {
    const out = new Map<string, TCorePropositionalExpression>()
    for (const e of expressions) out.set(e.id, e)
    return out
}
