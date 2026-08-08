import { isPremiseBound } from "../../schemata/index.js"
import type {
    TCoreQuadrivalentValue,
    TCoreResolvedAssignment,
} from "../../types/evaluation.js"
import type { TArgumentEvaluationContext } from "./argument-evaluation.js"

/**
 * Build a resolver that lazily evaluates internally premise-bound variables
 * by evaluating their bound premise's expression tree under the same
 * assignment. Claim-bound and externally-bound variables are read straight
 * from the assignment.
 *
 * Results are cached per variable for the resolver's lifetime, so one resolver
 * belongs to one assignment — a counterfactual re-close needs its own.
 */
export function createPremiseBoundResolver(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreResolvedAssignment
): (variableId: string) => TCoreQuadrivalentValue {
    const cache = new Map<string, TCoreQuadrivalentValue>()
    const resolver = (variableId: string): TCoreQuadrivalentValue => {
        if (cache.has(variableId)) {
            return cache.get(variableId)!
        }
        const variable = ctx.getVariable(variableId)
        if (
            !variable ||
            !isPremiseBound(variable) ||
            variable.boundArgumentId !== ctx.argumentId
        ) {
            return assignment.variables[variableId] ?? null
        }
        const boundPremise = ctx.getPremise(variable.boundPremiseId)
        if (!boundPremise) {
            cache.set(variableId, null)
            return null
        }
        const premiseResult = boundPremise.evaluate(assignment, { resolver })
        const value = premiseResult?.rootValue ?? null
        cache.set(variableId, value)
        return value
    }
    return resolver
}
