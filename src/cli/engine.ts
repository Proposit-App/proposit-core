import fs from "node:fs/promises"
import { ArgumentEngine } from "../lib/core/argument-engine.js"
import { ClaimLibrary } from "../lib/core/claim-library.js"
import { ClaimSourceLibrary } from "../lib/core/claim-source-library.js"
import { SourceLibrary } from "../lib/core/source-library.js"
import type {
    TClaimBoundVariable,
    TCoreArgument,
    TOptionalChecksum,
} from "../lib/schemata/index.js"
import { isClaimBound } from "../lib/schemata/index.js"
import type { TCliArgumentMeta, TCliArgumentVersionMeta } from "./schemata.js"
import { getPremisesDir } from "./config.js"
import {
    readArgumentMeta,
    readVersionMeta,
    writeArgumentMeta,
    writeVersionMeta,
} from "./storage/arguments.js"
import {
    readClaimLibrary,
    readSourceLibrary,
    readClaimSourceLibrary,
    writeClaimLibrary,
    writeSourceLibrary,
    writeClaimSourceLibrary,
} from "./storage/libraries.js"
import {
    listPremiseIds,
    readPremiseData,
    readPremiseMeta,
    writePremiseData,
    writePremiseMeta,
} from "./storage/premises.js"
import { readRoles, writeRoles } from "./storage/roles.js"
import { readVariables, writeVariables } from "./storage/variables.js"

export async function hydrateLibraries(): Promise<{
    claimLibrary: ClaimLibrary
    sourceLibrary: SourceLibrary
    claimSourceLibrary: ClaimSourceLibrary
}> {
    const claimLibrary = await readClaimLibrary()
    const sourceLibrary = await readSourceLibrary()
    const claimSourceLibrary = await readClaimSourceLibrary(
        claimLibrary,
        sourceLibrary
    )
    return { claimLibrary, sourceLibrary, claimSourceLibrary }
}

export async function persistLibraries(
    claimLibrary: ClaimLibrary,
    sourceLibrary: SourceLibrary,
    claimSourceLibrary: ClaimSourceLibrary
): Promise<void> {
    await Promise.all([
        writeClaimLibrary(claimLibrary),
        writeSourceLibrary(sourceLibrary),
        writeClaimSourceLibrary(claimSourceLibrary),
    ])
}

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
    version: number,
    libraries?: {
        claimLibrary: ClaimLibrary
        sourceLibrary: SourceLibrary
        claimSourceLibrary: ClaimSourceLibrary
    }
): Promise<ArgumentEngine> {
    const [argMeta, versionMeta, allVariables, roles, premiseIds] =
        await Promise.all([
            readArgumentMeta(argumentId),
            readVersionMeta(argumentId, version),
            readVariables(argumentId, version),
            readRoles(argumentId, version),
            listPremiseIds(argumentId, version),
        ])

    const argument: TOptionalChecksum<TCoreArgument> = {
        ...argMeta,
        ...versionMeta,
    }

    const libs = libraries ?? (await hydrateLibraries())
    let { claimLibrary } = libs
    const { sourceLibrary, claimSourceLibrary } = libs

    // Placeholder claim generation for backward compatibility.
    // Arguments created before library persistence was implemented have
    // variables referencing claims that don't exist in the library.
    const missingClaims: { id: string; version: number }[] = []
    for (const variable of allVariables) {
        if (
            isClaimBound(variable) &&
            !claimLibrary.get(variable.claimId, variable.claimVersion)
        ) {
            missingClaims.push({
                id: variable.claimId,
                version: variable.claimVersion,
            })
        }
    }
    if (missingClaims.length > 0) {
        const snapshot = claimLibrary.snapshot()
        for (const missing of missingClaims) {
            snapshot.claims.push({
                id: missing.id,
                version: missing.version,
                frozen: true,
                checksum: "",
            } as (typeof snapshot.claims)[number])
        }
        claimLibrary = ClaimLibrary.fromSnapshot(snapshot)
    }

    const engine = new ArgumentEngine(
        argument,
        claimLibrary,
        sourceLibrary,
        claimSourceLibrary
    )

    // Register all argument-level variables once on the engine; the shared
    // VariableManager is visible to every PremiseEngine.
    for (const variable of allVariables) {
        engine.addVariable({
            ...variable,
            argumentVersion: version,
        } as TOptionalChecksum<TClaimBoundVariable>)
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
}
