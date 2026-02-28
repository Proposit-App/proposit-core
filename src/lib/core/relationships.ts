import type { ArgumentEngine } from "./ArgumentEngine.js"
import type { PremiseManager } from "./PremiseManager.js"
import type {
    TCoreVariableAppearance,
    TCorePremiseProfile,
    TCorePremiseSide,
    TCorePremiseRelationshipAnalysis,
} from "../types/relationships.js"

function collectVariableAppearances(
    premise: PremiseManager,
    expressionId: string,
    side: TCorePremiseSide
): TCoreVariableAppearance[] {
    const appearances: TCoreVariableAppearance[] = []
    const stack: Array<{ id: string; negationDepth: number }> = [
        { id: expressionId, negationDepth: 0 },
    ]

    while (stack.length > 0) {
        const { id, negationDepth } = stack.pop()!
        const expr = premise.getExpression(id)
        if (!expr) continue

        if (expr.type === "variable") {
            appearances.push({
                variableId: expr.variableId,
                side,
                polarity:
                    negationDepth % 2 === 0 ? "positive" : "negative",
            })
        } else {
            const nextDepth =
                expr.type === "operator" && expr.operator === "not"
                    ? negationDepth + 1
                    : negationDepth
            for (const child of premise.getChildExpressions(id)) {
                stack.push({ id: child.id, negationDepth: nextDepth })
            }
        }
    }

    return appearances
}

/**
 * Builds a profile of a premise's variable appearances, recording each
 * variable's side (antecedent/consequent) and polarity (positive/negative).
 */
export function buildPremiseProfile(
    premise: PremiseManager
): TCorePremiseProfile {
    const premiseId = premise.getId()

    if (!premise.isInference()) {
        return { premiseId, isInference: false, appearances: [] }
    }

    const root = premise.getRootExpression()!
    const children = premise.getChildExpressions(root.id)
    const leftChild = children.find((c) => c.position === 0)
    const rightChild = children.find((c) => c.position === 1)

    const appearances: TCoreVariableAppearance[] = []
    if (leftChild) {
        appearances.push(
            ...collectVariableAppearances(premise, leftChild.id, "antecedent")
        )
    }
    if (rightChild) {
        appearances.push(
            ...collectVariableAppearances(premise, rightChild.id, "consequent")
        )
    }

    return { premiseId, isInference: true, appearances }
}

/**
 * Analyzes how every other premise in the argument relates to the focused
 * premise, classifying each as supporting, contradicting, restricting,
 * downstream, or unrelated.
 */
export function analyzePremiseRelationships(
    engine: ArgumentEngine,
    focusedPremiseId: string
): TCorePremiseRelationshipAnalysis {
    throw new Error("Not implemented")
}
