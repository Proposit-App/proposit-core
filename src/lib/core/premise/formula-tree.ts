import type {
    TCoreLogicalOperatorType,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type { ExpressionManager } from "../expression-manager.js"
import type { TFormulaTreeVisitor } from "../interfaces/index.js"
import type { TPremiseReadContext } from "./read-context.js"

// Read-only walks over one premise's expression tree.

export function renderPremiseExpression<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(ctx: TPremiseReadContext<TExpr, TVar>, expressionId: string): string {
    const expression = ctx.expressions.getExpression(expressionId)
    if (!expression) {
        throw new Error(`Expression "${expressionId}" was not found.`)
    }

    if (expression.type === "variable") {
        const variable = ctx.variables.getVariable(expression.variableId)
        if (!variable) {
            throw new Error(
                `Variable "${expression.variableId}" for expression "${expressionId}" was not found.`
            )
        }
        return variable.symbol
    }

    if (expression.type === "formula") {
        const children = ctx.expressions.getChildExpressions(expression.id)
        if (children.length === 0) {
            return "(?)"
        }
        return `(${renderPremiseExpression(ctx, children[0].id)})`
    }

    const children = ctx.expressions.getChildExpressions(expression.id)
    if (expression.operator === "not") {
        if (children.length === 0) {
            return `${operatorSymbol(expression.operator)} (?)`
        }
        return `${operatorSymbol(expression.operator)}(${renderPremiseExpression(ctx, children[0].id)})`
    }

    if (children.length === 0) {
        return "(?)"
    }

    const renderedChildren = children.map((child) =>
        renderPremiseExpression(ctx, child.id)
    )
    return `(${renderedChildren.join(` ${operatorSymbol(expression.operator)} `)})`
}

export function walkPremiseExpression<
    T,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
>(
    ctx: TPremiseReadContext<TExpr, TVar>,
    visitor: TFormulaTreeVisitor<T>,
    expressionId: string
): T {
    const expression = ctx.expressions.getExpression(expressionId)
    if (!expression) {
        throw new Error(`Expression "${expressionId}" was not found.`)
    }

    if (expression.type === "variable") {
        const variable = ctx.variables.getVariable(expression.variableId)
        if (!variable) {
            throw new Error(
                `Variable "${expression.variableId}" for expression "${expressionId}" was not found.`
            )
        }
        return visitor.variable(variable.symbol, expression.variableId)
    }

    if (expression.type === "formula") {
        const children = ctx.expressions.getChildExpressions(expression.id)
        if (children.length === 0) {
            return visitor.empty()
        }
        return visitor.formula(
            walkPremiseExpression(ctx, visitor, children[0].id)
        )
    }

    const children = ctx.expressions.getChildExpressions(expression.id)
    const renderedChildren = children.map((child) =>
        walkPremiseExpression(ctx, visitor, child.id)
    )
    return visitor.operator(expression.operator, renderedChildren)
}

function operatorSymbol(operator: TCoreLogicalOperatorType): string {
    switch (operator) {
        case "and":
            return "∧"
        case "or":
            return "∨"
        case "implies":
            return "→"
        case "iff":
            return "↔"
        case "not":
            return "¬"
        case "xor":
            return "⊻"
    }
}

/**
 * Every operator other than `not` in the tree under `rootId`, in depth-first
 * order — the operators a reader can grant or reject.
 */
export function collectDecidableOperators<
    TExpr extends TCorePropositionalExpression,
>(expressions: ExpressionManager<TExpr>, rootId: string | undefined): TExpr[] {
    const result: TExpr[] = []
    if (rootId === undefined) return result

    const visit = (exprId: string): void => {
        const expr = expressions.getExpression(exprId)
        if (!expr) return
        if (expr.type === "operator" && expr.operator !== "not") {
            result.push(expr)
        }
        for (const child of expressions.getChildExpressions(exprId)) {
            visit(child.id)
        }
    }

    visit(rootId)
    return result
}

/**
 * Returns true iff `candidateId` is a descendant of `ancestorId` in
 * this premise's expression tree. Used by `reparentExpression` for
 * the S-4 no-cycles check.
 */
export function isDescendantOf<TExpr extends TCorePropositionalExpression>(
    expressions: ExpressionManager<TExpr>,
    candidateId: string,
    ancestorId: string
): boolean {
    const stack: string[] = [ancestorId]
    while (stack.length > 0) {
        const cursor = stack.pop()!
        for (const child of expressions.getChildExpressions(cursor)) {
            if (child.id === candidateId) return true
            stack.push(child.id)
        }
    }
    return false
}

export function collectSubtree<TExpr extends TCorePropositionalExpression>(
    expressions: ExpressionManager<TExpr>,
    rootId: string
): TExpr[] {
    const result: TExpr[] = []
    const stack = [rootId]
    while (stack.length > 0) {
        const id = stack.pop()!
        const expr = expressions.getExpression(id)
        if (!expr) continue
        result.push(expr)
        for (const child of expressions.getChildExpressions(id)) {
            stack.push(child.id)
        }
    }
    return result
}
