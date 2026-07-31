// Presentable-tier validators (P-1..P-5).
//
// P-1 formula buffer between operators
// P-2 no double negation
// P-3 formula has operator descendant
// P-4 no single-child binary operator (largely redundant with E-1, kept
//     for clarity in the rule inventory)
// P-5 no operator-of-same-type adjacency through a formula
// P-6 enthymeme marks a claim-bound variable

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"
import type { TCorePropositionalExpression } from "../../schemata/index.js"
import { isPremiseBound } from "../../schemata/index.js"
import { hasBinaryOperatorInBoundedSubtree } from "../bounded-subtree.js"

type TChildMap = Map<string, TCorePropositionalExpression[]>

/**
 * Build a Map<parentId, children-sorted-by-position> view of the
 * expression tree.
 */
function buildChildMap(
    expressions: readonly TCorePropositionalExpression[]
): TChildMap {
    const out: TChildMap = new Map()
    for (const e of expressions) {
        if (e.parentId === null) continue
        const list = out.get(e.parentId) ?? []
        list.push(e)
        out.set(e.parentId, list)
    }
    for (const list of out.values()) {
        list.sort((a, b) => a.position - b.position)
    }
    return out
}

/**
 * Map<expressionId, expression> view for quick lookup.
 */
function buildExpressionsById(
    expressions: readonly TCorePropositionalExpression[]
): Map<string, TCorePropositionalExpression> {
    const out = new Map<string, TCorePropositionalExpression>()
    for (const e of expressions) out.set(e.id, e)
    return out
}

/**
 * P-1 — Formula buffer between operators. A non-`not` operator (`and`,
 * `or`, `implies`, `iff`) is never a direct child of another operator
 * expression. `not` is exempt — it can be a direct child of any
 * operator.
 *
 * Reports the inner (child) operator that breaks the rule, with the
 * outer (parent) operator referenced in the message.
 */
export function validateP1(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const byId = buildExpressionsById(ctx.expressions)
    for (const e of ctx.expressions) {
        if (e.type !== "operator") continue
        if (e.operator === "not") continue
        if (e.parentId === null) continue
        const parent = byId.get(e.parentId)
        if (parent === undefined) continue
        if (parent.type !== "operator") continue
        violations.push({
            tier: "presentable",
            code: "P-1",
            message: `${e.operator} expression ${e.id} is a direct child of operator ${parent.operator} ${parent.id} (formula buffer required)`,
            argumentId: ctx.argument.id,
            premiseId: e.premiseId,
            expressionId: e.id,
        })
    }
    return violations
}

/**
 * P-2 — No double negation. `not(not(x))` does not appear in the tree.
 * Reports the outer NOT.
 */
export function validateP2(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildChildMap(ctx.expressions)
    for (const outer of ctx.expressions) {
        if (outer.type !== "operator" || outer.operator !== "not") continue
        const kids = children.get(outer.id) ?? []
        if (kids.length !== 1) continue
        const child = kids[0]
        if (child.type === "operator" && child.operator === "not") {
            violations.push({
                tier: "presentable",
                code: "P-2",
                message: `not expression ${outer.id} wraps another not (${child.id})`,
                argumentId: ctx.argument.id,
                premiseId: outer.premiseId,
                expressionId: outer.id,
            })
        }
    }
    return violations
}

/**
 * P-3 — Formula has operator descendant. A `formula` node's bounded
 * subtree (stopping at the next nested formula) contains at least one
 * binary operator (`and` or `or`). Formulas wrapping a leaf or a single
 * `not` chain are not Presentable.
 */
export function validateP3(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildChildMap(ctx.expressions)
    const exprById = new Map<string, TCorePropositionalExpression>()
    for (const e of ctx.expressions) exprById.set(e.id, e)
    const lookup = (id: string): readonly TCorePropositionalExpression[] =>
        children.get(id) ?? []
    const getExpression = (
        id: string
    ): TCorePropositionalExpression | undefined => exprById.get(id)
    for (const f of ctx.expressions) {
        if (f.type !== "formula") continue
        if (!hasBinaryOperatorInBoundedSubtree(f.id, lookup, getExpression)) {
            violations.push({
                tier: "presentable",
                code: "P-3",
                message: `formula ${f.id} has no binary operator (and/or) descendant in its bounded subtree`,
                argumentId: ctx.argument.id,
                premiseId: f.premiseId,
                expressionId: f.id,
            })
        }
    }
    return violations
}

/**
 * P-4 — No single-child binary operator. `and` / `or` with exactly one
 * child is not Presentable. Largely redundant with E-1 (variadic arity
 * ≥ 2), kept for clarity in the rule inventory.
 */
export function validateP4(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildChildMap(ctx.expressions)
    for (const e of ctx.expressions) {
        if (e.type !== "operator") continue
        if (e.operator !== "and" && e.operator !== "or") continue
        const count = (children.get(e.id) ?? []).length
        if (count === 1) {
            violations.push({
                tier: "presentable",
                code: "P-4",
                message: `${e.operator} expression ${e.id} has a single child`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }
    return violations
}

/**
 * P-5 — No operator-of-same-type adjacency through a formula. When a
 * parent operator (`and` / `or`) has a `formula` child whose only
 * descendant operator (after peeling through transparent formula
 * buffers) is the same operator, the inner operator should be absorbed
 * into the parent.
 *
 * Example: `AND(formula(AND(b, c)), d)` should be `AND(b, c, d)`.
 *
 * The rule applies to `and` / `or` only — `implies` / `iff` are root-
 * only per S-5 and cannot appear as a child operator.
 */
export function validateP5(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildChildMap(ctx.expressions)
    for (const parent of ctx.expressions) {
        if (parent.type !== "operator") continue
        if (parent.operator !== "and" && parent.operator !== "or") continue
        const parentOp = parent.operator
        for (const child of children.get(parent.id) ?? []) {
            if (child.type !== "formula") continue
            const innerOp = singleOperatorInsideFormula(child, children)
            if (innerOp === parentOp) {
                violations.push({
                    tier: "presentable",
                    code: "P-5",
                    message: `${parentOp} expression ${parent.id} has a formula child ${child.id} whose inner operator is the same (${innerOp}); absorb`,
                    argumentId: ctx.argument.id,
                    premiseId: parent.premiseId,
                    expressionId: child.id,
                })
            }
        }
    }
    return violations
}

/**
 * Returns the operator kind (`and` / `or` / `implies` / `iff`) of the
 * single operator expression inside a `formula`'s bounded subtree —
 * stopping at any nested formula. Returns `undefined` if the formula
 * contains no operator, or more than one operator at the same level,
 * or contains a `not` operator anywhere (different shape; not the
 * absorption case P-5 targets).
 *
 * This is a deliberate simplification: P-5 fires on the canonical
 * `parent(formula(sameOp(...)))` shape where the formula immediately
 * wraps a single operator of the same kind as the parent. More complex
 * mixed-operator-under-formula shapes are not the absorbable case.
 */
function singleOperatorInsideFormula(
    formula: TCorePropositionalExpression,
    children: TChildMap
): "and" | "or" | "implies" | "iff" | undefined {
    const kids = children.get(formula.id) ?? []
    if (kids.length !== 1) return undefined
    const inner = kids[0]
    if (inner.type !== "operator") return undefined
    // Exclude `not` — P-5 targets the absorption case where the parent
    // and inner operators are the same `and` / `or` / `implies` / `iff`
    // kind. A NOT inside the formula is a different shape (not absorbable).
    if (inner.operator === "not") return undefined
    return inner.operator
}

/**
 * P-6 — An enthymeme marks a claim-bound variable. A variable expression
 * carrying `enthymeme: true` resolves to a claim-bound variable.
 *
 * The schema confines the annotation to variable expressions and premises,
 * but cannot express claim-boundness: that is a property of the variable the
 * expression points at, not of the expression itself. Marking a
 * premise-bound variable unspoken is meaningless — its truth is derived from
 * another premise's evaluation, so there is no natural-language assertion for
 * a speaker to have suppressed.
 *
 * An expression whose variable cannot be resolved is not reported here; the
 * dangling reference is a Structural concern.
 */
export function validateP6(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const variablesById = new Map(ctx.variables.map((v) => [v.id, v]))
    for (const e of ctx.expressions) {
        if (e.type !== "variable") continue
        if (e.enthymeme !== true) continue
        const variable = variablesById.get(e.variableId)
        if (variable === undefined) continue
        if (!isPremiseBound(variable)) continue
        violations.push({
            tier: "presentable",
            code: "P-6",
            message: `expression ${e.id} is marked unspoken but its variable ${variable.id} (${variable.symbol}) is premise-bound, not claim-bound`,
            argumentId: ctx.argument.id,
            premiseId: e.premiseId,
            expressionId: e.id,
            variableId: variable.id,
        })
    }
    return violations
}

export function validatePresentable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateP1(ctx),
        ...validateP2(ctx),
        ...validateP3(ctx),
        ...validateP4(ctx),
        ...validateP5(ctx),
        ...validateP6(ctx),
    ]
}
