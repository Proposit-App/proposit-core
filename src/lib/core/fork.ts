import { randomUUID } from "node:crypto"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TPremiseBoundVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type {
    TCoreSource,
    TCoreClaimSourceAssociation,
} from "../schemata/source.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
} from "./interfaces/library.interfaces.js"
import type { TForkArgumentOptions, TForkRemapTable } from "../types/fork.js"
import type { TOptionalChecksum } from "../schemata/shared.js"
import { ArgumentEngine } from "./argument-engine.js"
import { serializeChecksumConfig } from "../consts.js"
import { isPremiseBound } from "../schemata/propositional.js"

/**
 * Creates an independent copy of an argument engine under a new argument ID.
 *
 * Every premise, expression, and variable receives a fresh ID. All internal
 * cross-references are remapped.
 *
 * This function does NOT call `engine.canFork()` — callers are responsible
 * for checking fork eligibility.
 *
 * @param engine - The source engine to fork.
 * @param newArgumentId - The ID for the forked argument.
 * @param libraries - Claim, source, and claim-source libraries for the new engine.
 * @param options - Optional ID generator, checksum/position/grammar config overrides.
 * @returns The forked engine and a remap table mapping original to new entity IDs.
 */
export function forkArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
>(
    engine: ArgumentEngine<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >,
    newArgumentId: string,
    libraries: {
        claimLibrary: TClaimLookup<TClaim>
        sourceLibrary: TSourceLookup<TSource>
        claimSourceLibrary: TClaimSourceLookup<TAssoc>
    },
    options?: TForkArgumentOptions
): {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    remapTable: TForkRemapTable
} {
    const generateId = options?.generateId ?? randomUUID

    // Snapshot includes config from the source engine
    const snap = engine.snapshot()

    const originalArgumentId = snap.argument.id

    // Build remap tables (old ID → new ID)
    const premiseRemap = new Map<string, string>()
    const expressionRemap = new Map<string, string>()
    const variableRemap = new Map<string, string>()

    for (const ps of snap.premises) {
        premiseRemap.set(ps.premise.id, generateId())
        for (const expr of ps.expressions.expressions) {
            expressionRemap.set(expr.id, generateId())
        }
    }
    for (const v of snap.variables.variables) {
        variableRemap.set(v.id, generateId())
    }

    const remapTable: TForkRemapTable = {
        argumentId: { from: originalArgumentId, to: newArgumentId },
        premises: premiseRemap,
        expressions: expressionRemap,
        variables: variableRemap,
    }

    // Remap argument
    snap.argument = {
        ...snap.argument,
        id: newArgumentId,
        version: 0,
    } as TOptionalChecksum<TArg>

    // Remap premises and expressions
    for (const ps of snap.premises) {
        const originalPremiseId = ps.premise.id
        const newPremiseId = premiseRemap.get(originalPremiseId)!

        ps.premise = {
            ...ps.premise,
            id: newPremiseId,
            argumentId: newArgumentId,
            argumentVersion: 0,
        } as TOptionalChecksum<TPremise>

        if (ps.rootExpressionId) {
            ps.rootExpressionId = expressionRemap.get(ps.rootExpressionId)!
        }

        ps.expressions.expressions = ps.expressions.expressions.map((expr) => {
            const originalExprId = expr.id
            const newExprId = expressionRemap.get(originalExprId)!

            const remapped = {
                ...expr,
                id: newExprId,
                argumentId: newArgumentId,
                argumentVersion: 0,
                premiseId: newPremiseId,
                parentId: expr.parentId
                    ? (expressionRemap.get(expr.parentId) ?? null)
                    : null,
            } as TExpr

            if (
                (remapped as { type: string }).type === "variable" &&
                "variableId" in remapped
            ) {
                const origVarId = (
                    remapped as unknown as { variableId: string }
                ).variableId
                ;(remapped as unknown as { variableId: string }).variableId =
                    variableRemap.get(origVarId)!
            }

            return remapped
        })
    }

    // Remap variables
    snap.variables.variables = snap.variables.variables.map((v) => {
        const originalVarId = v.id
        const newVarId = variableRemap.get(originalVarId)!

        const remapped = {
            ...v,
            id: newVarId,
            argumentId: newArgumentId,
            argumentVersion: 0,
        }

        if (isPremiseBound(remapped as unknown as TCorePropositionalVariable)) {
            const premiseBound =
                remapped as unknown as TPremiseBoundVariable & {
                    boundPremiseId: string
                    boundArgumentId: string
                    boundArgumentVersion: number
                }
            premiseBound.boundPremiseId = premiseRemap.get(
                premiseBound.boundPremiseId
            )!
            premiseBound.boundArgumentId = newArgumentId
            premiseBound.boundArgumentVersion = 0
        }

        return remapped as TVar
    })

    // Remap conclusion
    if (snap.conclusionPremiseId) {
        snap.conclusionPremiseId = premiseRemap.get(snap.conclusionPremiseId)
    }

    // Override config from options if provided; snapshot already has source config
    if (options?.checksumConfig) {
        snap.config = {
            ...snap.config,
            checksumConfig: serializeChecksumConfig(options.checksumConfig),
        }
    }
    if (options?.positionConfig) {
        snap.config = { ...snap.config, positionConfig: options.positionConfig }
    }
    if (options?.grammarConfig) {
        snap.config = { ...snap.config, grammarConfig: options.grammarConfig }
    }

    const grammarConfig = options?.grammarConfig ?? snap.config?.grammarConfig

    // Construct new engine
    const forkedEngine = ArgumentEngine.fromSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >(
        snap,
        libraries.claimLibrary,
        libraries.sourceLibrary,
        libraries.claimSourceLibrary,
        grammarConfig,
        "ignore"
    )

    return { engine: forkedEngine, remapTable }
}
