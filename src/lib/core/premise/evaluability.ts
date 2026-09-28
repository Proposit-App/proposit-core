import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import {
    makeErrorIssue,
    makeValidationResult,
} from "../evaluation/validation.js"
import type { TPremiseReadContext } from "./read-context.js"

/**
 * Whether a premise can be evaluated: a tree with a root the premise agrees
 * on, every variable declared, and every operator and formula holding the
 * number of children its kind requires. Warns on a variable bound to a
 * premise with no tree.
 */
export function validatePremiseEvaluability<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(ctx: TPremiseReadContext<TExpr, TVar>): TCoreValidationResult {
    const issues: TCoreValidationIssue[] = []
    const roots = ctx.expressions.getChildExpressions(null)

    if (ctx.expressions.toArray().length === 0) {
        issues.push(
            makeErrorIssue({
                code: "PREMISE_EMPTY",
                message: `Premise "${ctx.premiseId}" has no expressions to evaluate.`,
                premiseId: ctx.premiseId,
            })
        )
        return makeValidationResult(issues)
    }

    if (roots.length === 0) {
        issues.push(
            makeErrorIssue({
                code: "PREMISE_ROOT_MISSING",
                message: `Premise "${ctx.premiseId}" has expressions but no root expression.`,
                premiseId: ctx.premiseId,
            })
        )
    }

    if (ctx.rootExpressionId === undefined) {
        issues.push(
            makeErrorIssue({
                code: "PREMISE_ROOT_MISSING",
                message: `Premise "${ctx.premiseId}" does not have rootExpressionId set.`,
                premiseId: ctx.premiseId,
            })
        )
    } else if (!ctx.expressions.getExpression(ctx.rootExpressionId)) {
        issues.push(
            makeErrorIssue({
                code: "PREMISE_ROOT_MISMATCH",
                message: `Premise "${ctx.premiseId}" rootExpressionId "${ctx.rootExpressionId}" does not exist.`,
                premiseId: ctx.premiseId,
                expressionId: ctx.rootExpressionId,
            })
        )
    } else if (roots[0] && roots[0].id !== ctx.rootExpressionId) {
        issues.push(
            makeErrorIssue({
                code: "PREMISE_ROOT_MISMATCH",
                message: `Premise "${ctx.premiseId}" rootExpressionId "${ctx.rootExpressionId}" does not match actual root "${roots[0].id}".`,
                premiseId: ctx.premiseId,
                expressionId: ctx.rootExpressionId,
            })
        )
    }

    for (const expr of ctx.expressions.toArray()) {
        if (
            expr.type === "variable" &&
            !ctx.variables.hasVariable(expr.variableId)
        ) {
            issues.push(
                makeErrorIssue({
                    code: "EXPR_VARIABLE_UNDECLARED",
                    message: `Expression "${expr.id}" references undeclared variable "${expr.variableId}".`,
                    premiseId: ctx.premiseId,
                    expressionId: expr.id,
                    variableId: expr.variableId,
                })
            )
        }

        if (
            expr.type === "variable" &&
            ctx.emptyBoundPremiseCheck(expr.variableId)
        ) {
            issues.push({
                code: "EXPR_BOUND_PREMISE_EMPTY",
                severity: "warning",
                message: `Variable "${expr.variableId}" is bound to a premise with no expression tree`,
                expressionId: expr.id,
            })
        }

        if (expr.type !== "operator" && expr.type !== "formula") {
            continue
        }

        const children = ctx.expressions.getChildExpressions(expr.id)

        if (expr.type === "formula") {
            if (children.length !== 1) {
                issues.push(
                    makeErrorIssue({
                        code: "EXPR_CHILD_COUNT_INVALID",
                        message: `Formula expression "${expr.id}" must have exactly 1 child; found ${children.length}.`,
                        premiseId: ctx.premiseId,
                        expressionId: expr.id,
                    })
                )
            }
            continue
        }

        if (expr.operator === "not" && children.length !== 1) {
            issues.push(
                makeErrorIssue({
                    code: "EXPR_CHILD_COUNT_INVALID",
                    message: `Operator "${expr.id}" (not) must have exactly 1 child; found ${children.length}.`,
                    premiseId: ctx.premiseId,
                    expressionId: expr.id,
                })
            )
        }

        if (
            (expr.operator === "implies" || expr.operator === "iff") &&
            children.length !== 2
        ) {
            issues.push(
                makeErrorIssue({
                    code: "EXPR_CHILD_COUNT_INVALID",
                    message: `Operator "${expr.id}" (${expr.operator}) must have exactly 2 children; found ${children.length}.`,
                    premiseId: ctx.premiseId,
                    expressionId: expr.id,
                })
            )
        }

        if (
            (expr.operator === "and" ||
                expr.operator === "or" ||
                expr.operator === "xor") &&
            children.length < 2
        ) {
            issues.push(
                makeErrorIssue({
                    code: "EXPR_CHILD_COUNT_INVALID",
                    message: `Operator "${expr.id}" (${expr.operator}) must have at least 2 children; found ${children.length}.`,
                    premiseId: ctx.premiseId,
                    expressionId: expr.id,
                })
            )
        }

        if (expr.operator === "implies" || expr.operator === "iff") {
            const childPositions = new Set(
                children.map((child) => child.position)
            )
            if (children.length !== 2 || childPositions.size !== 2) {
                issues.push(
                    makeErrorIssue({
                        code: "EXPR_BINARY_POSITIONS_INVALID",
                        message: `Operator "${expr.id}" (${expr.operator}) must have exactly 2 children with distinct positions.`,
                        premiseId: ctx.premiseId,
                        expressionId: expr.id,
                    })
                )
            }
        }
    }

    return makeValidationResult(issues)
}
