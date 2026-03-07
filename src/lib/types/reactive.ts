import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreArgumentRoleState } from "./evaluation.js"

export type TReactivePremiseSnapshot<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = {
    premise: TPremise
    expressions: Record<string, TExpr>
    rootExpressionId: string | undefined
}

export type TReactiveSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    argument: TArg
    variables: Record<string, TVar>
    premises: Record<string, TReactivePremiseSnapshot<TPremise, TExpr>>
    roles: TCoreArgumentRoleState
}
