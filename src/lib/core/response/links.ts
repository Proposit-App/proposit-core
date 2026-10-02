import {
    isClaimBound,
    isExpressionBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TLinkMove,
    TLinkValidationResult,
    TLinkViolation,
    TPremiseElements,
    TResponseLink,
} from "../../types/response.js"
import type {
    ArgumentEngine,
    TArgumentEngineSnapshot,
} from "../argument-engine.js"

type TExpressionLike = Pick<TCorePropositionalExpression, "id" | "type"> & {
    parentId: string | null
    operator?: string
    variableId?: string
}

/**
 * Reads a premise's expressions as a link. A premise is a link exactly when
 * its whole content is one variable expression, or `NOT` over one, and that
 * variable is expression-bound. The move follows from the variable's aspect
 * and whether `NOT` is present; nothing else is stored, so a link cannot
 * disagree with its own content.
 *
 * @returns The link, or `undefined` when the premise is not one.
 */
export function readLink(
    premiseId: string,
    expressions: readonly TExpressionLike[],
    getVariable: (id: string) => TCorePropositionalVariable | undefined
): TResponseLink | undefined {
    let negated: boolean
    let leaf: TExpressionLike | undefined
    if (expressions.length === 1) {
        negated = false
        leaf = expressions[0]
    } else if (expressions.length === 2) {
        const root = expressions.find((expr) => expr.parentId === null)
        if (root?.type !== "operator" || root.operator !== "not")
            return undefined
        negated = true
        leaf = expressions.find((expr) => expr.parentId === root.id)
    } else {
        return undefined
    }
    if (leaf?.type !== "variable" || leaf.variableId === undefined)
        return undefined
    if (!negated && leaf.parentId !== null) return undefined
    const variable = getVariable(leaf.variableId)
    if (variable === undefined || !isExpressionBound(variable)) return undefined
    return {
        premiseId,
        variableId: variable.id,
        boundExpressionId: variable.boundExpressionId,
        boundAspect: variable.boundAspect,
        move: moveOf(variable.boundAspect, negated),
    }
}

function moveOf(
    aspect: "statement" | "inference",
    negated: boolean
): TLinkMove {
    if (aspect === "statement") return negated ? "contradict" : "affirm"
    return negated ? "undercut" : "reinforce"
}

/** Every link of a response, in premise order. Empty for a standard argument. */
export function listLinks(response: ArgumentEngine): TResponseLink[] {
    const links: TResponseLink[] = []
    for (const premise of response.listPremises()) {
        const link = readLink(premise.getId(), premise.getExpressions(), (id) =>
            response.getVariable(id)
        )
        if (link !== undefined) links.push(link)
    }
    return links
}

/** Throws unless `targetSnapshot` is the argument and version `response` answers. */
export function assertTargetSnapshot(
    response: ArgumentEngine,
    targetSnapshot: TArgumentEngineSnapshot
): void {
    const respondsTo = response.getRespondsTo()
    if (respondsTo === undefined) {
        throw new Error(
            `Argument "${response.getArgument().id}" is not a response.`
        )
    }
    const { id, version } = targetSnapshot.argument
    if (
        id !== respondsTo.argumentId ||
        version !== respondsTo.argumentVersion
    ) {
        throw new Error(
            `The response answers "${respondsTo.argumentId}" version ${respondsTo.argumentVersion}, but the snapshot is "${id}" version ${version}.`
        )
    }
}

/** Every expression of a snapshot, by id. */
export function snapshotExpressions(
    snapshot: TArgumentEngineSnapshot
): Map<string, TCorePropositionalExpression> {
    const byId = new Map<string, TCorePropositionalExpression>()
    for (const ps of snapshot.premises) {
        for (const expr of ps.expressions.expressions) byId.set(expr.id, expr)
    }
    return byId
}

/** Every variable of a snapshot, by id. */
export function snapshotVariables(
    snapshot: TArgumentEngineSnapshot
): Map<string, TCorePropositionalVariable> {
    return new Map(snapshot.variables.variables.map((v) => [v.id, v]))
}

/** The claim id behind a variable expression, when its variable is claim-bound. */
function claimOfExpression(
    expr: TCorePropositionalExpression | undefined,
    variables: ReadonlyMap<string, TCorePropositionalVariable>
): string | undefined {
    if (expr?.type !== "variable") return undefined
    const variable = variables.get(expr.variableId)
    return variable !== undefined && isClaimBound(variable)
        ? variable.claimId
        : undefined
}

/**
 * The claims a snapshot uses: those of its claim-bound variables that some
 * expression references.
 */
export function snapshotClaimIds(
    snapshot: TArgumentEngineSnapshot
): Set<string> {
    const variables = snapshotVariables(snapshot)
    const used = new Set<string>()
    for (const expr of snapshotExpressions(snapshot).values()) {
        const claimId = claimOfExpression(expr, variables)
        if (claimId !== undefined) used.add(claimId)
    }
    return used
}

/**
 * Checks a response's expression bindings against the snapshot of the
 * argument it answers.
 *
 * @throws When `targetSnapshot` is not the argument and version the response
 * answers.
 */
export function validateLinks(
    response: ArgumentEngine,
    targetSnapshot: TArgumentEngineSnapshot
): TLinkValidationResult {
    assertTargetSnapshot(response, targetSnapshot)
    const respondsTo = response.getRespondsTo()!
    const targetExpressions = snapshotExpressions(targetSnapshot)
    const targetVariables = snapshotVariables(targetSnapshot)
    const violations: TLinkViolation[] = []

    const usedClaims = snapshotClaimIds(targetSnapshot)

    const variables = response.getVariables()
    for (const variable of variables) {
        if (isClaimBound(variable)) {
            if (usedClaims.has(variable.claimId)) {
                violations.push({
                    code: "LINK_CLAIM_USED_BY_TARGET",
                    severity: "error",
                    message: `Variable "${variable.id}" is bound to claim "${variable.claimId}", which the argument answered uses; affirm it through a link instead.`,
                    variableId: variable.id,
                    claimId: variable.claimId,
                })
            }
            continue
        }
        if (!isExpressionBound(variable)) continue
        if (variable.boundArgumentVersion !== respondsTo.argumentVersion) {
            violations.push({
                code: "LINK_VERSION_MISMATCH",
                severity: "error",
                message: `Variable "${variable.id}" binds version ${variable.boundArgumentVersion} of "${variable.boundArgumentId}", but the response answers version ${respondsTo.argumentVersion}.`,
                variableId: variable.id,
                expressionId: variable.boundExpressionId,
            })
            continue
        }
        const bound = targetExpressions.get(variable.boundExpressionId)
        if (bound === undefined) {
            violations.push({
                code: "LINK_EXPRESSION_MISSING",
                severity: "error",
                message: `Variable "${variable.id}" binds expression "${variable.boundExpressionId}", which is not in the argument answered.`,
                variableId: variable.id,
                expressionId: variable.boundExpressionId,
            })
            continue
        }
        if (variable.boundAspect === "inference" && bound.type !== "operator") {
            violations.push({
                code: "LINK_INFERENCE_ON_NON_OPERATOR",
                severity: "error",
                message: `Variable "${variable.id}" binds the step of expression "${bound.id}", which is not an operator and so has no step.`,
                variableId: variable.id,
                expressionId: bound.id,
            })
        }
    }

    // Links on different occurrences of one claim, in one aspect.
    const byClaim = new Map<string, TResponseLink[]>()
    for (const link of listLinks(response)) {
        const variable = response.getVariable(link.variableId)
        if (
            variable === undefined ||
            !isExpressionBound(variable) ||
            variable.boundArgumentVersion !== respondsTo.argumentVersion
        )
            continue
        const claimId = claimOfExpression(
            targetExpressions.get(link.boundExpressionId),
            targetVariables
        )
        if (claimId === undefined) continue
        const key = `${link.boundAspect}:${claimId}`
        const group = byClaim.get(key) ?? []
        group.push(link)
        byClaim.set(key, group)
    }
    for (const [key, group] of byClaim) {
        const occurrences = new Set(group.map((link) => link.boundExpressionId))
        if (occurrences.size < 2) continue
        const claimId = key.slice(key.indexOf(":") + 1)
        violations.push({
            code: "LINK_SAME_CLAIM",
            severity: "info",
            message: `Links ${group.map((link) => `"${link.premiseId}"`).join(", ")} bind different occurrences of claim "${claimId}"; they are checked as one.`,
            premiseIds: group.map((link) => link.premiseId),
            claimId,
        })
    }

    return {
        ok: violations.every((violation) => violation.severity !== "error"),
        violations,
    }
}

/**
 * Every expression id and claim id in one premise of a snapshot. Claims are
 * those of the premise's claim-bound variable expressions; bindings to other
 * premises are not followed.
 *
 * @throws When the snapshot has no such premise.
 */
export function elementsWithinPremise(
    targetSnapshot: TArgumentEngineSnapshot,
    premiseId: string
): TPremiseElements {
    const premise = targetSnapshot.premises.find(
        (ps) => ps.premise.id === premiseId
    )
    if (premise === undefined) {
        throw new Error(
            `Premise "${premiseId}" is not in argument "${targetSnapshot.argument.id}".`
        )
    }
    const variables = snapshotVariables(targetSnapshot)
    const expressionIds: string[] = []
    const claimIds = new Set<string>()
    for (const expr of premise.expressions.expressions) {
        expressionIds.push(expr.id)
        const claimId = claimOfExpression(expr, variables)
        if (claimId !== undefined) claimIds.add(claimId)
    }
    return { expressionIds, claimIds: [...claimIds] }
}
