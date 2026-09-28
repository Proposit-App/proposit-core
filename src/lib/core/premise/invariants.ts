import { Value } from "typebox/value"
import {
    CorePremiseSchema,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePropositionalVariableExpression,
} from "../../schemata/index.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../../types/validation.js"
import {
    PREMISE_ROOT_EXPRESSION_INVALID,
    PREMISE_SCHEMA_INVALID,
    PREMISE_VARIABLE_REF_NOT_FOUND,
} from "../../types/validation.js"
import type { TPremiseReadContext } from "./read-context.js"

/**
 * The premise's invariant sweep: schema conformance of `premiseData` (which
 * the caller builds, flushing checksums, before this runs), the expression
 * store's own checks, root consistency, and — when the argument supplies its
 * variable ids — that every variable expression names one of them.
 */
export function validatePremiseInvariants<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    ctx: TPremiseReadContext<TExpr, TVar>,
    premiseData: TCorePremise
): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []
    const premiseId = ctx.premiseId

    // 1. Schema check (the caller's premise data carries computed checksums)
    if (
        !Value.Check(CorePremiseSchema, premiseData as unknown as TCorePremise)
    ) {
        violations.push({
            code: PREMISE_SCHEMA_INVALID,
            message: `Premise "${premiseId}" does not conform to CorePremiseSchema.`,
            entityType: "premise",
            entityId: premiseId,
            premiseId,
        })
    }

    // 2. Delegate to expression-level validation, attaching premiseId
    const exprResult = ctx.expressions.validate()
    for (const v of exprResult.violations) {
        violations.push({ ...v, premiseId })
    }

    // 3. Root expression consistency
    if (ctx.rootExpressionId !== undefined) {
        const rootExpr = ctx.expressions.getExpression(ctx.rootExpressionId)
        if (!rootExpr) {
            violations.push({
                code: PREMISE_ROOT_EXPRESSION_INVALID,
                message: `Premise "${premiseId}" rootExpressionId "${ctx.rootExpressionId}" does not exist in expression store.`,
                entityType: "premise",
                entityId: premiseId,
                premiseId,
            })
        } else if (rootExpr.parentId !== null) {
            violations.push({
                code: PREMISE_ROOT_EXPRESSION_INVALID,
                message: `Premise "${premiseId}" rootExpressionId "${ctx.rootExpressionId}" has non-null parentId "${rootExpr.parentId}".`,
                entityType: "premise",
                entityId: premiseId,
                premiseId,
            })
        }
    }

    // 4. Variable references: every variable-type expression must
    //    reference a variableId that exists in the argument's variable set
    if (ctx.variableIdsCallback) {
        const variableIds = ctx.variableIdsCallback()
        for (const expr of ctx.expressions.toArray()) {
            if (expr.type === "variable") {
                const varExpr =
                    expr as unknown as TCorePropositionalVariableExpression
                if (!variableIds.has(varExpr.variableId)) {
                    violations.push({
                        code: PREMISE_VARIABLE_REF_NOT_FOUND,
                        message: `Expression "${expr.id}" in premise "${premiseId}" references non-existent variable "${varExpr.variableId}".`,
                        entityType: "expression",
                        entityId: expr.id,
                        premiseId,
                    })
                }
            }
        }
    }

    return {
        ok: violations.length === 0,
        violations,
    }
}
