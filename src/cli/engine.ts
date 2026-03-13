import fs from "node:fs/promises"
import { ArgumentEngine } from "../lib/core/argument-engine.js"
import { AssertionLibrary } from "../lib/core/assertion-library.js"
import { SourceLibrary } from "../lib/core/source-library.js"
import type { TCoreArgument } from "../lib/schemata/index.js"
import type { TCliArgumentMeta, TCliArgumentVersionMeta } from "./schemata.js"
import { getPremisesDir, getSourcesDir } from "./config.js"
import {
    readArgumentMeta,
    readVersionMeta,
    writeArgumentMeta,
    writeVersionMeta,
} from "./storage/arguments.js"
import {
    listPremiseIds,
    readPremiseData,
    readPremiseMeta,
    writePremiseData,
    writePremiseMeta,
} from "./storage/premises.js"
import { readRoles, writeRoles } from "./storage/roles.js"
import {
    readExpressionAssociations,
    readVariableAssociations,
    writeExpressionAssociations,
    writeVariableAssociations,
} from "./storage/sources.js"
import { readVariables, writeVariables } from "./storage/variables.js"

/**
 * Builds a fully-hydrated ArgumentEngine from the on-disk state for the
 * given argument ID and version number.
 *
 * All argument-level variables are registered with every PremiseEngine so
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

    const argument: Omit<TCoreArgument, "checksum"> = {
        ...argMeta,
        ...versionMeta,
    }
    const engine = new ArgumentEngine(
        argument,
        new AssertionLibrary(),
        new SourceLibrary()
    )

    // Register all argument-level variables once on the engine; the shared
    // VariableManager is visible to every PremiseEngine.
    for (const variable of allVariables) {
        engine.addVariable({ ...variable, argumentVersion: version })
    }

    for (const premiseId of premiseIds) {
        const [meta, data] = await Promise.all([
            readPremiseMeta(argumentId, version, premiseId),
            readPremiseData(argumentId, version, premiseId),
        ])

        const { id: _id, ...premiseExtras } = meta
        const { result: pm } = engine.createPremiseWithId(
            premiseId,
            premiseExtras
        )

        // Add expressions in BFS order: root (parentId===null) first, then
        // children of already-added expressions.
        const remaining = [...data.expressions]
        const added = new Set<string>()

        // First pass: root expressions
        for (let i = remaining.length - 1; i >= 0; i--) {
            const expr = remaining[i]
            if (expr.parentId === null) {
                pm.addExpression({
                    ...expr,
                    premiseId: premiseId,
                    argumentVersion: version,
                })
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
                    pm.addExpression({
                        ...expr,
                        premiseId: premiseId,
                        argumentVersion: version,
                    })
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
    // Supporting premises are now derived from expression type (inference premises
    // that aren't the conclusion), so no explicit role assignment is needed.

    // ── Sources ────────────────────────────────────────────────────────────
    // Restore sources via snapshot/rollback to preserve association IDs
    // (engine.addVariableSourceAssociation would generate new IDs).
    const [varAssociations, exprAssociations] = await Promise.all([
        readVariableAssociations(argumentId, version),
        readExpressionAssociations(argumentId, version),
    ])

    if (varAssociations.length > 0 || exprAssociations.length > 0) {
        const snap = engine.snapshot()
        snap.sources = {
            variableSourceAssociations: varAssociations.map((a) => ({
                ...a,
                checksum: a.checksum ?? "",
            })),
            expressionSourceAssociations: exprAssociations.map((a) => ({
                ...a,
                checksum: a.checksum ?? "",
            })),
        }
        engine.rollback(snap)
    }

    return engine
}

/**
 * Persists a fully-hydrated ArgumentEngine to disk, writing all metadata,
 * variables, roles, and premise data. This is the logical inverse of
 * `hydrateEngine()`.
 */
export async function persistEngine(engine: ArgumentEngine): Promise<void> {
    const arg = engine.getArgument()
    const { id } = arg

    // Extract CLI-specific fields from the argument (which has extras via
    // additionalProperties) and write them as flat argument/version meta.
    const argRecord = arg as Record<string, unknown>
    await writeArgumentMeta({
        id,
        title: argRecord.title,
        description: argRecord.description,
    } as TCliArgumentMeta)
    await writeVersionMeta(id, {
        version: arg.version,
        createdAt: argRecord.createdAt,
        published: argRecord.published,
    } as TCliArgumentVersionMeta)

    const variables = engine.getVariables()
    await writeVariables(id, arg.version, variables)

    await writeRoles(id, arg.version, engine.getRoleState())

    await fs.mkdir(getPremisesDir(id, arg.version), { recursive: true })
    for (const pm of engine.listPremises()) {
        const data = pm.toPremiseData()
        const {
            id: premiseId,
            argumentId: _a,
            argumentVersion: _av,
            checksum: _c,
            ...premiseMeta
        } = data as Record<string, unknown>
        await writePremiseMeta(id, arg.version, {
            id: data.id,
            ...premiseMeta,
        } as import("./schemata.js").TCliPremiseMeta)
        await writePremiseData(id, arg.version, data.id, {
            rootExpressionId: pm.getRootExpressionId(),
            variables: [...pm.getReferencedVariableIds()].sort(),
            expressions: pm.getExpressions(),
        })
    }

    // ── Sources ────────────────────────────────────────────────────────────
    const sourcesDir = getSourcesDir(id, arg.version)
    await fs.mkdir(sourcesDir, { recursive: true })

    // Source entities now live in the global SourceLibrary and are not
    // persisted per-argument by the engine. Only associations are stored.
    // TODO: persist source entities from SourceLibrary when the CLI is
    // updated to use global libraries.

    await writeVariableAssociations(
        id,
        arg.version,
        engine.getAllVariableSourceAssociations()
    )
    await writeExpressionAssociations(
        id,
        arg.version,
        engine.getAllExpressionSourceAssociations()
    )
}
