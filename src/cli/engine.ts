import { ArgumentEngine } from "../lib/core/ArgumentEngine.js"
import type { TCoreArgument } from "../lib/schemata/index.js"
import { readArgumentMeta, readVersionMeta } from "./storage/arguments.js"
import {
    listPremiseIds,
    readPremiseData,
    readPremiseMeta,
} from "./storage/premises.js"
import { readRoles } from "./storage/roles.js"
import { readVariables } from "./storage/variables.js"

/**
 * Builds a fully-hydrated ArgumentEngine from the on-disk state for the
 * given argument ID and version number.
 *
 * All argument-level variables are registered with every PremiseManager so
 * that expression validation and evaluation work correctly.
 *
 * Expressions are added in BFS order (root first, then children) to satisfy
 * the parent-existence requirement of addExpression.
 */
export async function hydrateEngine(
    argumentId: string,
    version: number
): Promise<ArgumentEngine> {
    const [argMeta, versionMeta, allVariables, roles, premiseIds] =
        await Promise.all([
            readArgumentMeta(argumentId),
            readVersionMeta(argumentId, version),
            readVariables(argumentId, version),
            readRoles(argumentId, version),
            listPremiseIds(argumentId, version),
        ])

    const argument: TCoreArgument = { ...argMeta, ...versionMeta }
    const engine = new ArgumentEngine(argument)

    for (const premiseId of premiseIds) {
        const [meta, data] = await Promise.all([
            readPremiseMeta(argumentId, version, premiseId),
            readPremiseData(argumentId, version, premiseId),
        ])

        const pm = engine.createPremiseWithId(premiseId, meta.metadata)

        for (const variable of allVariables) {
            pm.addVariable({ ...variable, argumentVersion: version })
        }

        // Add expressions in BFS order: root (parentId===null) first, then
        // children of already-added expressions.
        const remaining = [...data.expressions]
        const added = new Set<string>()

        // First pass: root expressions
        for (let i = remaining.length - 1; i >= 0; i--) {
            const expr = remaining[i]
            if (expr.parentId === null) {
                pm.addExpression({ ...expr, argumentVersion: version })
                added.add(expr.id)
                remaining.splice(i, 1)
            }
        }

        // Subsequent passes: children of already-added nodes
        let progress = true
        while (remaining.length > 0 && progress) {
            progress = false
            for (let i = remaining.length - 1; i >= 0; i--) {
                const expr = remaining[i]
                if (expr.parentId !== null && added.has(expr.parentId)) {
                    pm.addExpression({ ...expr, argumentVersion: version })
                    added.add(expr.id)
                    remaining.splice(i, 1)
                    progress = true
                }
            }
        }
    }

    if (roles.conclusionPremiseId !== undefined) {
        engine.setConclusionPremise(roles.conclusionPremiseId)
    }
    for (const id of roles.supportingPremiseIds) {
        engine.addSupportingPremise(id)
    }

    return engine
}
