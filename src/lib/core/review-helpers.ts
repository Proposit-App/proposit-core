import {
    isClaimBound,
    type TClaimBoundVariable,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreOperatorAssignment } from "../types/evaluation.js"
import type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "./evaluation/argument-evaluation.js"
import {
    InvalidArgumentStructureError,
    NotOperatorNotDecidableError,
    UnknownExpressionError,
} from "./review-errors.js"

export interface TCollectArgumentReferencedClaimsResult {
    /** Claim IDs in first-occurrence order. */
    claimIds: string[]
    byId: Record<
        string,
        {
            claimVersion: number
            variableIds: string[]
            premiseIds: string[]
        }
    >
}

/**
 * Collects every distinct claim referenced by any variable in any premise
 * of the argument.
 *
 * Ordering: supporting premises (in `listSupportingPremises()` order), then
 * the conclusion premise, then remaining premises (constraints). Within a
 * premise, claims appear in the order their first-referencing variable
 * appears in the expression tree (pre-order DFS). A claim shared across
 * premises is emitted once at its first occurrence.
 *
 * Variables without a bound claim (e.g. premise-bound variables) are
 * skipped silently — not an error.
 *
 * @throws {InvalidArgumentStructureError} If two variables in the argument
 *   bind the same `claimId` with different `claimVersion`s.
 */
export function collectArgumentReferencedClaims(
    ctx: TArgumentEvaluationContext
): TCollectArgumentReferencedClaimsResult {
    // First pass: detect same-claim-different-version across ALL premises.
    const claimVersionsSeen = new Map<string, Map<number, string[]>>()
    for (const pm of ctx.listPremises()) {
        for (const variable of pm.getVariables()) {
            if (!isClaimBound(variable)) continue
            const cb: TClaimBoundVariable = variable
            let versions = claimVersionsSeen.get(cb.claimId)
            if (!versions) {
                versions = new Map()
                claimVersionsSeen.set(cb.claimId, versions)
            }
            let ids = versions.get(cb.claimVersion)
            if (!ids) {
                ids = []
                versions.set(cb.claimVersion, ids)
            }
            if (!ids.includes(cb.id)) ids.push(cb.id)
        }
    }
    for (const [claimId, versions] of claimVersionsSeen) {
        if (versions.size > 1) {
            const summary = Array.from(versions.entries())
                .map(
                    ([v, ids]) =>
                        `version ${v} via variables [${ids.join(", ")}]`
                )
                .join("; ")
            throw new InvalidArgumentStructureError(
                `Claim "${claimId}" is referenced with multiple versions: ${summary}.`
            )
        }
    }

    // Second pass: walk supporting → conclusion → constraint, pre-order DFS.
    type TAccumulator = {
        claimVersion: number
        variableIds: Set<string>
        premiseIds: Set<string>
    }
    const byId = new Map<string, TAccumulator>()
    const order: string[] = []

    const conclusion = ctx.getConclusionPremise()
    const supporting = ctx.listSupportingPremises()
    const supportingIds = new Set(supporting.map((p) => p.getId()))
    const conclusionId = conclusion?.getId()
    const remaining = ctx
        .listPremises()
        .filter(
            (p) => p.getId() !== conclusionId && !supportingIds.has(p.getId())
        )

    const premiseSequence: TEvaluablePremise[] = [
        ...supporting,
        ...(conclusion ? [conclusion] : []),
        ...remaining,
    ]

    for (const premise of premiseSequence) {
        const premiseId = premise.getId()
        const varsById = new Map<string, TCorePropositionalVariable>(
            premise.getVariables().map((v) => [v.id, v])
        )
        const expressions = premise.getExpressions()
        const exprById = new Map(expressions.map((e) => [e.id, e]))
        const rootExpr = expressions.find((e) => e.parentId === null)
        if (!rootExpr) continue

        const visit = (exprId: string): void => {
            const expr = exprById.get(exprId)
            if (!expr) return
            if (expr.type === "variable") {
                const variable = varsById.get(expr.variableId)
                if (variable && isClaimBound(variable)) {
                    const cb: TClaimBoundVariable = variable
                    let entry = byId.get(cb.claimId)
                    if (!entry) {
                        entry = {
                            claimVersion: cb.claimVersion,
                            variableIds: new Set(),
                            premiseIds: new Set(),
                        }
                        byId.set(cb.claimId, entry)
                        order.push(cb.claimId)
                    }
                    entry.variableIds.add(cb.id)
                    entry.premiseIds.add(premiseId)
                }
            }
            for (const child of premise.getChildExpressions(exprId)) {
                visit(child.id)
            }
        }

        visit(rootExpr.id)
    }

    const outById: TCollectArgumentReferencedClaimsResult["byId"] = {}
    for (const claimId of order) {
        const entry = byId.get(claimId)!
        outById[claimId] = {
            claimVersion: entry.claimVersion,
            variableIds: Array.from(entry.variableIds),
            premiseIds: Array.from(entry.premiseIds),
        }
    }

    return { claimIds: order, byId: outById }
}

export interface TCanonicalizeOperatorAssignmentsInput {
    premiseScope: Record<string, TCoreOperatorAssignment>
    expressionOverrides?: Record<string, TCoreOperatorAssignment>
}

/**
 * Expands `premiseScope` decisions into per-expression operator
 * assignments via `TEvaluablePremise.getDecidableOperatorExpressions()`,
 * then layers `expressionOverrides` on top.
 *
 * **Overrides without matching premiseScope**: An override whose parent
 * premise is not listed in `premiseScope` is still applied verbatim. This
 * lets the review wizard collect expression-level decisions without
 * having to decide at premise scope first.
 *
 * Output keys are exactly those expression ids that ended up with an
 * assignment — not every expression in the argument.
 *
 * @throws {UnknownExpressionError} For any override id that does not
 *   exist in the argument.
 * @throws {NotOperatorNotDecidableError} With `reason: "is-not-operator"`
 *   for overrides targeting a `"not"` operator, or with
 *   `reason: "not-an-operator-type"` for overrides targeting a variable
 *   or formula expression.
 */
export function canonicalizeOperatorAssignments(
    ctx: TArgumentEvaluationContext,
    input: TCanonicalizeOperatorAssignmentsInput
): Record<string, TCoreOperatorAssignment> {
    const out: Record<string, TCoreOperatorAssignment> = {}

    // Expand premise-scope entries. TEvaluablePremise exposes
    // getDecidableOperatorExpressions (added in Task 2).
    for (const [premiseId, value] of Object.entries(input.premiseScope)) {
        const premise = ctx.getPremise(premiseId)
        if (!premise) continue
        for (const expr of premise.getDecidableOperatorExpressions()) {
            out[expr.id] = value
        }
    }

    // Apply expression overrides.
    const overrides = input.expressionOverrides ?? {}
    if (Object.keys(overrides).length > 0) {
        const exprById = new Map<string, TCorePropositionalExpression>()
        for (const pm of ctx.listPremises()) {
            for (const e of pm.getExpressions()) {
                exprById.set(e.id, e)
            }
        }
        for (const [exprId, value] of Object.entries(overrides)) {
            const expr = exprById.get(exprId)
            if (!expr) throw new UnknownExpressionError(exprId)
            if (expr.type !== "operator") {
                throw new NotOperatorNotDecidableError(
                    exprId,
                    "not-an-operator-type"
                )
            }
            if (expr.operator === "not") {
                throw new NotOperatorNotDecidableError(
                    exprId,
                    "is-not-operator"
                )
            }
            out[exprId] = value
        }
    }

    return out
}
