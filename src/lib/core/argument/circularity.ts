import {
    isPremiseBound,
    type TCoreArgument,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TPremiseBoundVariable,
} from "../../schemata/index.js"
import type { PremiseEngine } from "../premise-engine.js"
import type { VariableManager } from "../variable-manager.js"

/**
 * What the circularity check reads from an `ArgumentEngine`. The engine's
 * implementation reads each field back from itself when used, as the method
 * did before it moved.
 */
export type TCycleContext<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
> = {
    variables: VariableManager<TVar>
    premises: Map<string, PremiseEngine<TArg, TPremise, TExpr, TVar>>
}

/**
 * Whether binding `variableId` into the premise `targetPremiseId` would close
 * a cycle: the variable is bound to that premise, directly or through the
 * premise-bound variables of the premises it reaches.
 */
export function wouldCreateCycle<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    ctx: TCycleContext<TArg, TPremise, TExpr, TVar>,
    variableId: string,
    targetPremiseId: string,
    visited: Set<string>
): boolean {
    const variable = ctx.variables.getVariable(variableId)
    if (!variable) return false

    if (!isPremiseBound(variable)) return false

    const bound = variable as unknown as TPremiseBoundVariable
    if (bound.boundPremiseId === targetPremiseId) return true

    if (visited.size >= ctx.premises.size) {
        throw new Error(
            `Circularity check depth limit exceeded (visited ${visited.size} premises).`
        )
    }

    if (visited.has(bound.boundPremiseId)) return false
    visited.add(bound.boundPremiseId)

    const boundPremise = ctx.premises.get(bound.boundPremiseId)
    if (!boundPremise) return false

    for (const expr of boundPremise.getExpressions()) {
        if (expr.type === "variable") {
            if (
                wouldCreateCycle(ctx, expr.variableId, targetPremiseId, visited)
            ) {
                return true
            }
        }
    }

    return false
}
