import { SATISFIABILITY_VARIABLE_CEILING } from "../evaluation/satisfiability.js"
import {
    evaluateCombinedNode,
    type TCombinedNode,
    type TTargetExpander,
} from "./combined-premise-set.js"

/**
 * What "this expression has this value" says about its columns.
 *
 * - `cube`: exactly the rows where each column in `fixed` has its value and
 *   every other column is free.
 * - `notExpressible`: the rows are not of that shape, so no set of fixed
 *   values says the same thing.
 * - `impossible`: no row gives the expression the value.
 * - `vacuous`: every row does.
 * - `tooLarge`: the expression reads more columns than the search allows.
 */
export type TStatementDecomposition =
    | { kind: "cube"; fixed: Map<string, boolean> }
    | { kind: "notExpressible" }
    | { kind: "impossible" }
    | { kind: "vacuous" }
    | { kind: "tooLarge" }

/** Every column a formula reads, once each, in first-seen order. */
function columnsOf(node: TCombinedNode): string[] {
    const keys = new Set<string>()
    const visit = (current: TCombinedNode): void => {
        if (current.kind === "column") keys.add(current.key)
        else current.kids.forEach(visit)
    }
    visit(node)
    return [...keys]
}

/**
 * Reads "the target expression `expressionId` has value `value`" as fixed
 * column values, over the expression's own expansion with every column free.
 * Nothing outside the expression enters: not the response's premises, not
 * the response's grounded columns, not the target's axioms.
 */
export function decomposeStatement(
    expander: TTargetExpander,
    expressionId: string,
    value: boolean
): TStatementDecomposition {
    const node = expander.expand(expressionId)
    // The expander's own column map holds every column any expansion made,
    // so the expression's columns are read from its formula.
    const keys = columnsOf(node)
    if (keys.length > SATISFIABILITY_VARIABLE_CEILING)
        return { kind: "tooLarge" }

    let kept = 0
    // For each column: the value every kept row so far gives it, or `null`
    // once two kept rows disagree.
    const agreed = new Map<string, boolean | null>()
    const row: Record<string, boolean> = {}
    const total = 2 ** keys.length
    for (let mask = 0; mask < total; mask++) {
        keys.forEach((key, index) => {
            row[key] = (mask & (1 << index)) !== 0
        })
        if (evaluateCombinedNode(node, (key) => row[key]) !== value) continue
        kept++
        for (const key of keys) {
            const seen = agreed.get(key)
            if (seen === undefined) agreed.set(key, row[key])
            else if (seen !== null && seen !== row[key]) agreed.set(key, null)
        }
    }

    if (kept === 0) return { kind: "impossible" }
    if (kept === total) return { kind: "vacuous" }
    const fixed = new Map<string, boolean>()
    for (const [key, seen] of agreed) {
        if (seen !== null) fixed.set(key, seen)
    }
    // The kept rows form a cube exactly when they are every row of the
    // columns left free.
    if (kept !== 2 ** (keys.length - fixed.size))
        return { kind: "notExpressible" }
    return { kind: "cube", fixed }
}
