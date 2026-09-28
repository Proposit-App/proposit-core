import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type { ExpressionManager } from "../expression-manager.js"
import type { VariableManager } from "../variable-manager.js"

/**
 * What a `PremiseEngine`'s read-only routines consult, built by the engine
 * for each call. `emptyBoundPremiseCheck` and `readVariableIds` reach the
 * engine's current callbacks on every call, and return `undefined` when none
 * is set.
 */
export type TPremiseReadContext<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
> = {
    premiseId: string
    argument: { id: string }
    rootExpressionId: string | undefined
    expressions: ExpressionManager<TExpr>
    variables: VariableManager<TVar>
    emptyBoundPremiseCheck: (variableId: string) => boolean | undefined
    readVariableIds: () => Set<string> | undefined
}
