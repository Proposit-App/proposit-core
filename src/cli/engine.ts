import fs from "node:fs/promises"
import {
    ArgumentEngine,
    type TArgumentEngineSnapshot,
} from "../lib/core/argument-engine.js"
import type { TPremiseEngineSnapshot } from "../lib/core/premise-engine.js"
import { ClaimLibrary } from "../lib/core/claim-library.js"
import { PropositCore } from "../lib/core/proposit-core.js"
import type {
    TCoreArgument,
    TCorePropositionalExpression,
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
    readForkLibrary,
    writeClaimLibrary,
    writeSourceLibrary,
    writeClaimSourceLibrary,
    writeForkLibrary,
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

export async function hydratePropositCore(): Promise<PropositCore> {
    const [claimLibrary, sourceLibrary, forkLibrary] = await Promise.all([
        readClaimLibrary(),
        readSourceLibrary(),
        readForkLibrary(),
    ])
    const claimSourceLibrary = await readClaimSourceLibrary(
        claimLibrary,
        sourceLibrary
    )
    return new PropositCore({
        claimLibrary,
        sourceLibrary,
        claimSourceLibrary,
        forkLibrary,
    })
}

export async function persistCore(core: PropositCore): Promise<void> {
    await Promise.all([
        writeClaimLibrary(core.claims),
        writeSourceLibrary(core.sources),
        writeClaimSourceLibrary(core.claimSources),
        writeForkLibrary(core.forks),
    ])
}

/**
 * Builds a fully-hydrated ArgumentEngine from the on-disk state for the
 * given argument ID and version number.
 *
 * Uses `ArgumentEngine.fromSnapshot()` to restore the engine, which
 * correctly suppresses auto-variable creation during premise restoration.
 */
export async function hydrateEngine(
    argumentId: string,
    version: number,
    core?: PropositCore
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

    const resolvedCore = core ?? (await hydratePropositCore())

    // Placeholder claim generation for backward compatibility.
    // Arguments created before library persistence was implemented have
    // variables referencing claims that don't exist in the library.
    let claimLibrary = resolvedCore.claims
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

    // Build premise snapshots from disk data
    const premiseSnapshots: TPremiseEngineSnapshot[] = []
    for (const premiseId of premiseIds) {
        const [meta, data] = await Promise.all([
            readPremiseMeta(argumentId, version, premiseId),
            readPremiseData(argumentId, version, premiseId),
        ])

        const { id: _id, ...premiseExtras } = meta
        premiseSnapshots.push({
            premise: {
                id: premiseId,
                argumentId,
                argumentVersion: version,
                ...premiseExtras,
            },
            rootExpressionId: data.rootExpressionId,
            expressions: {
                expressions: data.expressions.map((e) => ({
                    ...e,
                    premiseId,
                    argumentVersion: version,
                })) as TCorePropositionalExpression[],
            },
        })
    }

    // Build full engine snapshot
    const engineSnapshot: TArgumentEngineSnapshot = {
        argument,
        variables: {
            variables: allVariables.map((v) => ({
                ...v,
                argumentVersion: version,
            })),
        },
        premises: premiseSnapshots,
        conclusionPremiseId: roles.conclusionPremiseId,
    }

    // Use fromSnapshot which correctly handles restoringFromSnapshot flag,
    // preventing auto-variable creation during premise restoration.
    const engine = ArgumentEngine.fromSnapshot(
        engineSnapshot,
        claimLibrary,
        resolvedCore.sources,
        resolvedCore.claimSources,
        undefined,
        "ignore"
    )

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
