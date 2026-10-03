import { isClaimBound } from "../../schemata/index.js"
import type { TLinkElement, TLinkReference } from "../../types/response.js"
import type {
    ArgumentEngine,
    TArgumentEngineSnapshot,
} from "../argument-engine.js"
import { isPremiseRootExpression } from "./fingerprint.js"
import {
    assertTargetSnapshot,
    listLinks,
    snapshotExpressions,
    snapshotVariables,
} from "./links.js"

/**
 * Whether a referenced link is about an element of the argument its response
 * answers. True when the reference names a link of `response` and:
 *
 * - for a claim, the link binds a variable expression of that claim, at any
 *   version of the claim;
 * - for an expression, the link binds that expression, or the root of the
 *   premise that contains it.
 *
 * A reference to another argument, another version, or a premise that is not
 * a link is never about anything.
 *
 * @throws When `targetSnapshot` is not the argument and version `response`
 * answers.
 */
export function linkTargetsElement(
    reference: TLinkReference,
    response: ArgumentEngine,
    targetSnapshot: TArgumentEngineSnapshot,
    element: TLinkElement
): boolean {
    assertTargetSnapshot(response, targetSnapshot)
    const argument = response.getArgument()
    if (
        reference.argumentId !== argument.id ||
        reference.argumentVersion !== argument.version
    )
        return false
    const link = listLinks(response).find(
        (candidate) => candidate.premiseId === reference.premiseId
    )
    if (link === undefined) return false

    const expressions = snapshotExpressions(targetSnapshot)
    const bound = expressions.get(link.boundExpressionId)
    if (bound === undefined) return false

    if (element.kind === "claim") {
        if (bound.type !== "variable") return false
        const variable = snapshotVariables(targetSnapshot).get(bound.variableId)
        return (
            variable !== undefined &&
            isClaimBound(variable) &&
            variable.claimId === element.claimId
        )
    }

    if (bound.id === element.expressionId) return true
    const contained = expressions.get(element.expressionId)
    return (
        contained !== undefined &&
        isPremiseRootExpression(targetSnapshot, bound.id) &&
        bound.premiseId === contained.premiseId
    )
}
