import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type { ExpressionManager } from "../expression-manager.js"
import type { VariableManager } from "../variable-manager.js"

/**
 * What a `PremiseEngine`'s read-only routines consult, by reference: the
 * managers are the engine's own, not copies. `PremiseEngine.evaluate` runs
 * inside the satisfiability search once per row, so a context that copied
 * the expressions would cost that search a copy per row. Built fresh per
 * call, so it never holds a stale root.
 */
export type TPremiseReadContext<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
> = {
    premiseId: string
    argumentId: string
    rootExpressionId: string | undefined
    expressions: ExpressionManager<TExpr>
    variables: VariableManager<TVar>
    emptyBoundPremiseCheck?: (variableId: string) => boolean
    variableIdsCallback?: () => Set<string>
}
