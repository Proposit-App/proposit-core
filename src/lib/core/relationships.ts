import type { ArgumentEngine } from "./argument-engine.js"
import type { PremiseEngine } from "./premise-engine.js"
import type {
    TCoreVariableAppearance,
    TCorePremiseProfile,
    TCorePremiseSide,
    TCorePremiseRelationResult,
    TCorePremiseRelationshipAnalysis,
    TCoreVariableRelationship,
} from "../types/relationships.js"

// ── Variable profiling ──────────────────────────────────────────────────

function collectVariableAppearances(
    premise: PremiseEngine,
    expressionId: string,
    side: TCorePremiseSide
): TCoreVariableAppearance[] {
    const appearances: TCoreVariableAppearance[] = []
    const stack: { id: string; negationDepth: number }[] = [
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
                polarity: negationDepth % 2 === 0 ? "positive" : "negative",
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
    premise: PremiseEngine
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

// ── Graph edge types ────────────────────────────────────────────────────

type TVariableEdge = {
    variableId: string
    polarityMatch: boolean
}

type TPremiseEdge = {
    targetPremiseId: string
    variables: TVariableEdge[]
}

// ── Graph construction ──────────────────────────────────────────────────

function buildVariableFlowGraph(
    profiles: Map<string, TCorePremiseProfile>
): Map<string, TPremiseEdge[]> {
    const graph = new Map<string, TPremiseEdge[]>()

    for (const [sourceId, sourceProfile] of profiles) {
        if (!sourceProfile.isInference) continue
        const edges: TPremiseEdge[] = []

        const conseqVars = sourceProfile.appearances.filter(
            (a) => a.side === "consequent"
        )

        for (const [targetId, targetProfile] of profiles) {
            if (targetId === sourceId || !targetProfile.isInference) continue

            const anteVars = targetProfile.appearances.filter(
                (a) => a.side === "antecedent"
            )

            const variables: TVariableEdge[] = []
            for (const cv of conseqVars) {
                for (const av of anteVars) {
                    if (cv.variableId === av.variableId) {
                        variables.push({
                            variableId: cv.variableId,
                            polarityMatch: cv.polarity === av.polarity,
                        })
                    }
                }
            }

            if (variables.length > 0) {
                edges.push({ targetPremiseId: targetId, variables })
            }
        }

        graph.set(sourceId, edges)
    }

    return graph
}

// ── BFS reachability ────────────────────────────────────────────────────

type TReachResult = {
    reachable: boolean
    polarityMatch: boolean
    variableDetails: TCoreVariableRelationship[]
    transitive: boolean
}

function bfsToTarget(
    graph: Map<string, TPremiseEdge[]>,
    sourceId: string,
    targetId: string
): TReachResult {
    const visited = new Set<string>()
    visited.add(sourceId)

    const queue: {
        premiseId: string
        polarityMatch: boolean
        entryVariables: TVariableEdge[]
    }[] = []

    // Seed with direct edges from source
    const sourceEdges = graph.get(sourceId) ?? []
    for (const edge of sourceEdges) {
        const allMatch = edge.variables.every((v) => v.polarityMatch)
        if (edge.targetPremiseId === targetId) {
            return {
                reachable: true,
                polarityMatch: allMatch,
                variableDetails: edge.variables.map((v) => ({
                    variableId: v.variableId,
                    relationship: v.polarityMatch
                        ? "supporting"
                        : "contradicting",
                })),
                transitive: false,
            }
        }
        if (!visited.has(edge.targetPremiseId)) {
            visited.add(edge.targetPremiseId)
            queue.push({
                premiseId: edge.targetPremiseId,
                polarityMatch: allMatch,
                entryVariables: edge.variables,
            })
        }
    }

    while (queue.length > 0) {
        const { premiseId, polarityMatch, entryVariables } = queue.shift()!
        const edges = graph.get(premiseId) ?? []

        for (const edge of edges) {
            if (edge.targetPremiseId === targetId) {
                const stepMatch = edge.variables.every((v) => v.polarityMatch)
                // XOR logic: both match or both mismatch = overall match
                const finalMatch =
                    (polarityMatch && stepMatch) ||
                    (!polarityMatch && !stepMatch)
                return {
                    reachable: true,
                    polarityMatch: finalMatch,
                    variableDetails: entryVariables.map((v) => ({
                        variableId: v.variableId,
                        relationship: finalMatch
                            ? "supporting"
                            : "contradicting",
                    })),
                    transitive: true,
                }
            }
            if (!visited.has(edge.targetPremiseId)) {
                visited.add(edge.targetPremiseId)
                const stepMatch = edge.variables.every((v) => v.polarityMatch)
                const nextMatch =
                    (polarityMatch && stepMatch) ||
                    (!polarityMatch && !stepMatch)
                queue.push({
                    premiseId: edge.targetPremiseId,
                    polarityMatch: nextMatch,
                    entryVariables,
                })
            }
        }
    }

    return {
        reachable: false,
        polarityMatch: true,
        variableDetails: [],
        transitive: false,
    }
}

// ── Restricting check ───────────────────────────────────────────────────

function hasVariableOnBothSides(
    profile: TCorePremiseProfile,
    focusedProfile: TCorePremiseProfile
): TCoreVariableRelationship[] {
    const antecedentVarIds = new Set(
        profile.appearances
            .filter((a) => a.side === "antecedent")
            .map((a) => a.variableId)
    )
    const consequentVarIds = new Set(
        profile.appearances
            .filter((a) => a.side === "consequent")
            .map((a) => a.variableId)
    )

    const bothSideVarIds = new Set(
        [...antecedentVarIds].filter((id) => consequentVarIds.has(id))
    )

    const focusedVarIds = new Set(
        focusedProfile.appearances.map((a) => a.variableId)
    )

    const restricting: TCoreVariableRelationship[] = []
    for (const varId of bothSideVarIds) {
        if (focusedVarIds.has(varId)) {
            restricting.push({
                variableId: varId,
                relationship: "restricting",
            })
        }
    }
    return restricting
}

// ── Constraint premise classification ───────────────────────────────────

function classifyConstraintPremise(
    premise: PremiseEngine,
    focusedProfile: TCorePremiseProfile,
    connectedVarIds: Set<string>
): TCorePremiseRelationResult {
    const premiseVarIds = premise.getReferencedVariableIds()
    const focusedVarIds = new Set(
        focusedProfile.appearances.map((a) => a.variableId)
    )

    const directOverlap = [...premiseVarIds].some((id) => focusedVarIds.has(id))
    const transitiveOverlap = [...premiseVarIds].some((id) =>
        connectedVarIds.has(id)
    )

    if (directOverlap || transitiveOverlap) {
        return {
            premiseId: premise.getId(),
            relationship: "restricting",
            variableDetails: [],
            transitive: !directOverlap && transitiveOverlap,
        }
    }

    return {
        premiseId: premise.getId(),
        relationship: "unrelated",
        variableDetails: [],
        transitive: false,
    }
}

// ── Precedence ──────────────────────────────────────────────────────────

const PRECEDENCE: Record<string, number> = {
    contradicting: 3,
    restricting: 2,
    supporting: 1,
}

function applyPrecedence(
    details: TCoreVariableRelationship[]
): "supporting" | "contradicting" | "restricting" {
    let highest: "supporting" | "contradicting" | "restricting" = "supporting"
    for (const d of details) {
        if (PRECEDENCE[d.relationship] > PRECEDENCE[highest]) {
            highest = d.relationship
        }
    }
    return highest
}

// ── Main function ───────────────────────────────────────────────────────

/**
 * Analyzes how every other premise in the argument relates to the focused
 * premise, classifying each as supporting, contradicting, restricting,
 * downstream, or unrelated.
 */
export function analyzePremiseRelationships(
    engine: ArgumentEngine,
    focusedPremiseId: string
): TCorePremiseRelationshipAnalysis {
    const focusedPremise = engine.getPremise(focusedPremiseId)
    if (!focusedPremise) {
        throw new Error(
            `Premise "${focusedPremiseId}" does not exist in the argument.`
        )
    }

    const allPremises = engine.listPremises()
    const otherPremises = allPremises.filter(
        (pm) => pm.getId() !== focusedPremiseId
    )

    if (otherPremises.length === 0) {
        return { focusedPremiseId, premises: [] }
    }

    // Build profiles for all premises
    const profiles = new Map<string, TCorePremiseProfile>()
    for (const pm of allPremises) {
        profiles.set(pm.getId(), buildPremiseProfile(pm))
    }

    const focusedProfile = profiles.get(focusedPremiseId)!

    // Build variable flow graph (inference premises only)
    const graph = buildVariableFlowGraph(profiles)

    // Collect all variable IDs connected to the focused premise
    // (for constraint classification)
    const connectedVarIds = new Set<string>()
    for (const pm of allPremises) {
        const pmId = pm.getId()
        if (pmId === focusedPremiseId) continue
        const profile = profiles.get(pmId)!
        if (!profile.isInference) continue
        const toFocused = bfsToTarget(graph, pmId, focusedPremiseId)
        const fromFocused = bfsToTarget(graph, focusedPremiseId, pmId)
        if (toFocused.reachable || fromFocused.reachable) {
            for (const varId of pm.getReferencedVariableIds()) {
                connectedVarIds.add(varId)
            }
        }
    }
    for (const a of focusedProfile.appearances) {
        connectedVarIds.add(a.variableId)
    }

    // Classify each premise
    const results: TCorePremiseRelationResult[] = []

    for (const pm of otherPremises) {
        const pmId = pm.getId()
        const profile = profiles.get(pmId)!

        // Constraint premises get special handling
        if (!profile.isInference) {
            results.push(
                classifyConstraintPremise(pm, focusedProfile, connectedVarIds)
            )
            continue
        }

        // If focused premise is a constraint, all sharing premises are
        // restricting
        if (!focusedProfile.isInference) {
            const focusedVarIds = focusedPremise.getReferencedVariableIds()
            const pmVarIds = pm.getReferencedVariableIds()
            const shares = [...pmVarIds].some((id) => focusedVarIds.has(id))
            results.push({
                premiseId: pmId,
                relationship: shares ? "restricting" : "unrelated",
                variableDetails: [],
                transitive: false,
            })
            continue
        }

        // Check restricting (variable on both sides of source, appearing
        // in focused)
        const restrictingDetails = hasVariableOnBothSides(
            profile,
            focusedProfile
        )

        // Check forward path (source → focused)
        const toFocused = bfsToTarget(graph, pmId, focusedPremiseId)

        // Check reverse path (focused → source) for downstream
        const fromFocused = bfsToTarget(graph, focusedPremiseId, pmId)

        if (restrictingDetails.length > 0 || toFocused.reachable) {
            const allDetails = [
                ...restrictingDetails,
                ...toFocused.variableDetails,
            ]
            const relationship = applyPrecedence(allDetails)
            results.push({
                premiseId: pmId,
                relationship,
                variableDetails: allDetails,
                transitive: toFocused.transitive,
            })
        } else if (fromFocused.reachable) {
            results.push({
                premiseId: pmId,
                relationship: "downstream",
                variableDetails: [],
                transitive: fromFocused.transitive,
            })
        } else {
            results.push({
                premiseId: pmId,
                relationship: "unrelated",
                variableDetails: [],
                transitive: false,
            })
        }
    }

    return { focusedPremiseId, premises: results }
}
