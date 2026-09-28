import {
    isExternallyBound,
    isPremiseBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCorePremiseEvaluationResult,
    TCorePremiseInferenceDiagnostic,
    TCoreQuadrivalentValue,
    TCoreResolvedAssignment,
} from "../../types/evaluation.js"
import { sortedUnique } from "../../utils/collections.js"
import {
    belnapAnd,
    belnapIff,
    belnapImplies,
    belnapNot,
    belnapOr,
    belnapXor,
} from "../evaluation/belnap.js"
import { buildDirectionalVacuity } from "../evaluation/validation.js"
import type { TExpressionInput } from "../expression-manager.js"
import type { TPremiseReadContext } from "./read-context.js"

/**
 * Evaluates a premise under an assignment, recording a value for every
 * expression and, for an inference, the directional diagnostics. The caller
 * has already confirmed the premise is evaluable, so the root exists.
 * `isInference` asks the engine, at the two points the method always asked
 * it, so an engine that overrides `isInference()` still decides it.
 */
export function evaluatePremise<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    ctx: TPremiseReadContext<TExpr, TVar>,
    assignment: TCoreResolvedAssignment,
    isInference: () => boolean,
    options?: {
        strictUnknownKeys?: boolean
        requireExactCoverage?: boolean
        resolver?: (variableId: string) => TCoreQuadrivalentValue
    }
): TCorePremiseEvaluationResult {
    const rootExpressionId = ctx.rootExpressionId!
    const referencedVariableIds = sortedUnique(
        ctx.expressions
            .toArray()
            .filter(
                (
                    expr
                ): expr is TExpressionInput<TExpr> & {
                    type: "variable"
                    variableId: string
                } => expr.type === "variable"
            )
            .map((expr) => expr.variableId)
    )

    if (options?.strictUnknownKeys || options?.requireExactCoverage) {
        const knownVariableIds = new Set(referencedVariableIds)
        const unknownKeys = Object.keys(assignment.variables).filter(
            (variableId) => !knownVariableIds.has(variableId)
        )
        if (unknownKeys.length > 0) {
            throw new Error(
                `Assignment contains unknown variable IDs for premise "${ctx.premiseId}": ${unknownKeys.join(", ")}`
            )
        }
    }

    const expressionValues: Record<string, TCoreQuadrivalentValue> = {}
    const evaluateExpression = (
        expressionId: string
    ): TCoreQuadrivalentValue => {
        const expression = ctx.expressions.getExpression(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" was not found.`)
        }

        if (expression.type === "variable") {
            let value: TCoreQuadrivalentValue
            if (options?.resolver) {
                const variable = ctx.variables.getVariable(
                    expression.variableId
                )
                if (
                    variable &&
                    isPremiseBound(variable) &&
                    !isExternallyBound(variable, ctx.argument.id)
                ) {
                    value = options.resolver(expression.variableId)
                } else {
                    value = assignment.variables[expression.variableId] ?? null
                }
            } else {
                value = assignment.variables[expression.variableId] ?? null
            }
            expressionValues[expression.id] = value
            return value
        }

        const children = ctx.expressions.getChildExpressions(expression.id)
        let value: TCoreQuadrivalentValue

        if (expression.type === "formula") {
            value = evaluateExpression(children[0].id)
            expressionValues[expression.id] = value
            return value
        }

        switch (expression.operator) {
            case "not":
                value = belnapNot(evaluateExpression(children[0].id))
                break
            case "and":
                value = children.reduce<TCoreQuadrivalentValue>(
                    (acc, child) =>
                        belnapAnd(acc, evaluateExpression(child.id)),
                    true
                )
                break
            case "or":
                value = children.reduce<TCoreQuadrivalentValue>(
                    (acc, child) => belnapOr(acc, evaluateExpression(child.id)),
                    false
                )
                break
            // Seeded `false` because that is xor's identity, not because
            // `or` is: parity counts the true operands, so seeding `true`
            // would report every operand count with the opposite parity.
            case "xor":
                value = children.reduce<TCoreQuadrivalentValue>(
                    (acc, child) =>
                        belnapXor(acc, evaluateExpression(child.id)),
                    false
                )
                break
            case "implies": {
                const left = children[0]
                const right = children[1]
                value = belnapImplies(
                    evaluateExpression(left.id),
                    evaluateExpression(right.id)
                )
                break
            }
            case "iff": {
                const left = children[0]
                const right = children[1]
                value = belnapIff(
                    evaluateExpression(left.id),
                    evaluateExpression(right.id)
                )
                break
            }
        }

        expressionValues[expression.id] = value
        return value
    }

    const rootValue = evaluateExpression(rootExpressionId)
    const variableValues: Record<string, TCoreQuadrivalentValue> = {}
    for (const variableId of referencedVariableIds) {
        if (options?.resolver) {
            const variable = ctx.variables.getVariable(variableId)
            if (variable && isPremiseBound(variable)) {
                variableValues[variableId] = options.resolver(variableId)
                continue
            }
        }
        variableValues[variableId] = assignment.variables[variableId] ?? null
    }

    let inferenceDiagnostic: TCorePremiseInferenceDiagnostic | undefined
    if (isInference()) {
        const root = ctx.expressions.getExpression(rootExpressionId)
        if (root?.type === "operator") {
            const children = ctx.expressions.getChildExpressions(root.id)
            const left = children[0]
            const right = children[1]
            if (left && right) {
                const leftValue = expressionValues[left.id]
                const rightValue = expressionValues[right.id]
                if (root.operator === "implies") {
                    inferenceDiagnostic = {
                        kind: "implies",
                        premiseId: ctx.premiseId,
                        rootExpressionId,
                        leftValue,
                        rightValue,
                        rootValue,
                        antecedentTrue: leftValue,
                        consequentTrue: rightValue,
                        isVacuouslyTrue: belnapNot(leftValue),
                        fired: leftValue,
                        firedAndHeld: belnapAnd(leftValue, rightValue),
                    }
                } else if (root.operator === "iff") {
                    const leftToRight = buildDirectionalVacuity(
                        leftValue,
                        rightValue
                    )
                    const rightToLeft = buildDirectionalVacuity(
                        rightValue,
                        leftValue
                    )
                    inferenceDiagnostic = {
                        kind: "iff",
                        premiseId: ctx.premiseId,
                        rootExpressionId,
                        leftValue,
                        rightValue,
                        rootValue,
                        leftToRight,
                        rightToLeft,
                        bothSidesTrue: belnapAnd(leftValue, rightValue),
                        bothSidesFalse: belnapAnd(
                            belnapNot(leftValue),
                            belnapNot(rightValue)
                        ),
                    }
                }
            }
        }
    }

    return {
        premiseId: ctx.premiseId,
        premiseType: isInference() ? "inference" : "constraint",
        rootExpressionId,
        rootValue,
        expressionValues,
        variableValues,
        inferenceDiagnostic,
    }
}
