import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type { ExpressionManager } from "../expression-manager.js"
import type { VariableManager } from "../variable-manager.js"

/**
 * What a `PremiseEngine`'s read-only routines consult. The engine's
 * implementation reads each field back from itself when it is used, so
 * nothing is copied — `PremiseEngine.evaluate` runs inside the
 * satisfiability search once per row — and nothing goes stale mid-call.
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
