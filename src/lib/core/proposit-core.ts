import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type {
    TCoreClaimSourceAssociation,
    TCoreSource,
} from "../schemata/source.js"
import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
    TCoreSourceForkRecord,
} from "../schemata/fork.js"
import type {
    TPropositCoreSnapshot,
    TPropositCoreConfig,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import type { TForkArgumentOptions, TForkRemapTable } from "../types/fork.js"
import type { TCoreArgumentDiff, TCoreDiffOptions } from "../types/diff.js"
import { isClaimBound } from "../schemata/propositional.js"
import { ClaimLibrary } from "./claim-library.js"
import { SourceLibrary } from "./source-library.js"
import { ClaimSourceLibrary } from "./claim-source-library.js"
import { ArgumentLibrary } from "./argument-library.js"
import { ArgumentEngine, defaultGenerateId } from "./argument-engine.js"
import { ForkLibrary } from "./fork-library.js"
import { forkArgumentEngine } from "./fork.js"
import { diffArguments as standaloneDiffArguments } from "./diff.js"

/**
 * Options for constructing a `PropositCore` instance. Accepts optional
 * pre-constructed library instances and/or shared configuration. When a
 * library instance is provided, it is used directly; otherwise a new one
 * is constructed using the shared config.
 */
export type TPropositCoreOptions<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
> = TPropositCoreConfig & {
    /** Pre-constructed claim library instance. */
    claimLibrary?: ClaimLibrary<TClaim>
    /** Pre-constructed source library instance. */
    sourceLibrary?: SourceLibrary<TSource>
    /** Pre-constructed claim-source association library instance. */
    claimSourceLibrary?: ClaimSourceLibrary<TAssoc>
    /** Pre-constructed fork library instance. */
    forkLibrary?: ForkLibrary<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    >
    /** Pre-constructed argument library instance. */
    argumentLibrary?: ArgumentLibrary<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >
}

/**
 * Top-level orchestrator for the proposit-core system. Owns all five
 * libraries (claims, sources, claim-source associations, forks, arguments)
 * and provides unified snapshot/restore and validation.
 *
 * Construction order follows dependency order:
 * claims -> sources -> claimSources -> forks -> arguments.
 */
export class PropositCore<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
> {
    public readonly claims: ClaimLibrary<TClaim>
    public readonly sources: SourceLibrary<TSource>
    public readonly claimSources: ClaimSourceLibrary<TAssoc>
    public readonly forks: ForkLibrary<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    >
    public readonly arguments: ArgumentLibrary<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >
    protected generateId: () => string

    constructor(
        options?: TPropositCoreOptions<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc,
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >
    ) {
        this.generateId = options?.generateId ?? defaultGenerateId

        const checksumOpts = options?.checksumConfig
            ? { checksumConfig: options.checksumConfig }
            : undefined

        // Dependency order: claims -> sources -> claimSources -> forks -> arguments
        this.claims =
            options?.claimLibrary ?? new ClaimLibrary<TClaim>(checksumOpts)

        this.sources =
            options?.sourceLibrary ?? new SourceLibrary<TSource>(checksumOpts)

        this.claimSources =
            options?.claimSourceLibrary ??
            new ClaimSourceLibrary<TAssoc>(
                this.claims,
                this.sources,
                checksumOpts
            )

        this.forks =
            options?.forkLibrary ??
            new ForkLibrary<
                TArgFork,
                TPremiseFork,
                TExprFork,
                TVarFork,
                TClaimFork,
                TSourceFork
            >()

        this.arguments =
            options?.argumentLibrary ??
            new ArgumentLibrary<
                TArg,
                TPremise,
                TExpr,
                TVar,
                TSource,
                TClaim,
                TAssoc
            >(
                {
                    claimLibrary: this.claims,
                    sourceLibrary: this.sources,
                    claimSourceLibrary: this.claimSources,
                },
                {
                    checksumConfig: options?.checksumConfig,
                    positionConfig: options?.positionConfig,
                    grammarConfig: options?.grammarConfig,
                    generateId: this.generateId,
                }
            )
    }

    /**
     * Returns a serializable snapshot of the entire PropositCore state,
     * including all libraries.
     */
    public snapshot(): TPropositCoreSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc,
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    > {
        return {
            arguments: this.arguments.snapshot(),
            claims: this.claims.snapshot(),
            sources: this.sources.snapshot(),
            claimSources: this.claimSources.snapshot(),
            forks: this.forks.snapshot(),
        }
    }

    /**
     * Restores a `PropositCore` instance from a snapshot. Libraries are
     * restored in dependency order: claims -> sources -> claimSources ->
     * forks -> arguments.
     *
     * @param snapshot - The serialized PropositCore snapshot.
     * @param config - Optional shared configuration for the restored instance.
     * @returns A fully restored `PropositCore` instance.
     */
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TSource extends TCoreSource = TCoreSource,
        TClaim extends TCoreClaim = TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation =
            TCoreClaimSourceAssociation,
        TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
        TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
        TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
        TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
        TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
        TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
    >(
        snapshot: TPropositCoreSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc,
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >,
        config?: TPropositCoreConfig
    ): PropositCore<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc,
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    > {
        const checksumOpts = config?.checksumConfig
            ? { checksumConfig: config.checksumConfig }
            : undefined

        // Dependency order: claims -> sources -> claimSources -> forks -> arguments
        const claims = ClaimLibrary.fromSnapshot<TClaim>(
            snapshot.claims,
            checksumOpts
        )
        const sources = SourceLibrary.fromSnapshot<TSource>(
            snapshot.sources,
            checksumOpts
        )
        const claimSources = ClaimSourceLibrary.fromSnapshot<TAssoc>(
            snapshot.claimSources,
            claims,
            sources,
            checksumOpts
        )
        const forks = ForkLibrary.fromSnapshot<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >(snapshot.forks)
        const restoredArguments = ArgumentLibrary.fromSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            snapshot.arguments,
            {
                claimLibrary: claims,
                sourceLibrary: sources,
                claimSourceLibrary: claimSources,
            },
            {
                checksumConfig: config?.checksumConfig,
                positionConfig: config?.positionConfig,
                grammarConfig: config?.grammarConfig,
                generateId: config?.generateId,
            }
        )

        const core = new PropositCore<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc,
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >({
            claimLibrary: claims,
            sourceLibrary: sources,
            claimSourceLibrary: claimSources,
            forkLibrary: forks,
            argumentLibrary: restoredArguments,
        })

        core.generateId = config?.generateId ?? defaultGenerateId

        return core
    }

    /**
     * Runs invariant validation across all managed libraries and merges
     * the results.
     *
     * @returns A combined validation result.
     */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = [
            ...this.claims.validate().violations,
            ...this.sources.validate().violations,
            ...this.claimSources.validate().violations,
            ...this.forks.validate().violations,
            ...this.arguments.validate().violations,
        ]
        return { ok: violations.length === 0, violations }
    }

    /**
     * Forks an argument, cloning its referenced claims, sources, and
     * claim-source associations, then remaps variable claim references to
     * point at the cloned claims. Creates fork records in all six
     * namespaces.
     *
     * @param argumentId - The ID of the argument to fork.
     * @param newArgumentId - The ID for the forked argument. Defaults to `this.generateId()`.
     * @param options - Optional fork configuration and extras for fork records.
     * @returns The forked engine, remap tables, and the argument fork record.
     */
    public forkArgument(
        argumentId: string,
        newArgumentId?: string,
        options?: TForkArgumentOptions & {
            forkId?: string
            argumentForkExtras?: Partial<
                Omit<TArgFork, keyof TCoreArgumentForkRecord>
            >
            premiseForkExtras?: Partial<
                Omit<TPremiseFork, keyof TCorePremiseForkRecord>
            >
            expressionForkExtras?: Partial<
                Omit<TExprFork, keyof TCoreExpressionForkRecord>
            >
            variableForkExtras?: Partial<
                Omit<TVarFork, keyof TCoreVariableForkRecord>
            >
            claimForkExtras?: Partial<
                Omit<TClaimFork, keyof TCoreClaimForkRecord>
            >
            sourceForkExtras?: Partial<
                Omit<TSourceFork, keyof TCoreSourceForkRecord>
            >
        }
    ): {
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >
        remapTable: TForkRemapTable
        claimRemap: Map<string, string>
        sourceRemap: Map<string, string>
        argumentFork: TArgFork
    } {
        // Step 1: Retrieve source engine
        const engine = this.arguments.get(argumentId)
        if (!engine) {
            throw new Error(
                `Argument "${argumentId}" not found in ArgumentLibrary.`
            )
        }

        // Step 2: canFork guard
        if (!engine.canFork()) {
            throw new Error(`Forking argument "${argumentId}" is not allowed.`)
        }

        const sourceArg = engine.getArgument()
        const resolvedNewArgumentId = newArgumentId ?? this.generateId()
        const forkId = options?.forkId ?? this.generateId()

        // Build expressionId → premiseId map from source engine snapshot
        const sourceSnap = engine.snapshot()
        const exprToPremiseMap = new Map<string, string>()
        for (const ps of sourceSnap.premises) {
            for (const expr of ps.expressions.expressions) {
                exprToPremiseMap.set(expr.id, ps.premise.id)
            }
        }

        // Step 3: Clone claims
        const claimRemap = new Map<string, string>()
        const claimVersionMap = new Map<string, number>()
        const variables = engine.getVariables()
        const uniqueClaimIds = new Set<string>()
        for (const v of variables) {
            if (isClaimBound(v)) {
                uniqueClaimIds.add(v.claimId)
            }
        }
        for (const originalClaimId of uniqueClaimIds) {
            const currentClaim = this.claims.getCurrent(originalClaimId)
            if (!currentClaim) {
                throw new Error(
                    `Claim "${originalClaimId}" not found in ClaimLibrary.`
                )
            }
            claimVersionMap.set(originalClaimId, currentClaim.version)
            const newClaimId = this.generateId()
            const {
                id: _id,
                version: _v,
                frozen: _f,
                checksum: _c,
                ...claimData
            } = currentClaim as Record<string, unknown>
            this.claims.create({
                ...claimData,
                id: newClaimId,
            } as Omit<TClaim, "version" | "frozen" | "checksum">)
            claimRemap.set(originalClaimId, newClaimId)
        }

        // Step 4: Clone sources
        const sourceRemap = new Map<string, string>()
        const sourceVersionMap = new Map<string, number>()
        const uniqueSourceIds = new Set<string>()
        for (const originalClaimId of uniqueClaimIds) {
            const associations = this.claimSources.getForClaim(originalClaimId)
            for (const assoc of associations) {
                uniqueSourceIds.add(assoc.sourceId)
            }
        }
        for (const originalSourceId of uniqueSourceIds) {
            const currentSource = this.sources.getCurrent(originalSourceId)
            if (!currentSource) {
                throw new Error(
                    `Source "${originalSourceId}" not found in SourceLibrary.`
                )
            }
            sourceVersionMap.set(originalSourceId, currentSource.version)
            const newSourceId = this.generateId()
            const {
                id: _id,
                version: _v,
                frozen: _f,
                checksum: _c,
                ...sourceData
            } = currentSource as Record<string, unknown>
            this.sources.create({
                ...sourceData,
                id: newSourceId,
            } as Omit<TSource, "version" | "frozen" | "checksum">)
            sourceRemap.set(originalSourceId, newSourceId)
        }

        // Step 5: Clone associations
        for (const originalClaimId of uniqueClaimIds) {
            const associations = this.claimSources.getForClaim(originalClaimId)
            for (const assoc of associations) {
                const clonedClaimId = claimRemap.get(originalClaimId)!
                const clonedSourceId = sourceRemap.get(assoc.sourceId)
                if (clonedSourceId) {
                    this.claimSources.add({
                        id: this.generateId(),
                        claimId: clonedClaimId,
                        claimVersion: 0,
                        sourceId: clonedSourceId,
                        sourceVersion: 0,
                    } as Omit<TAssoc, "checksum">)
                }
            }
        }

        // Step 6: Fork engine
        const { engine: forkedEngine, remapTable } = forkArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            engine,
            resolvedNewArgumentId,
            {
                claimLibrary: this.claims,
                sourceLibrary: this.sources,
                claimSourceLibrary: this.claimSources,
            },
            {
                ...options,
                generateId: options?.generateId ?? this.generateId,
            }
        )

        // Step 7: Remap claim references
        const snap = forkedEngine.snapshot()
        snap.variables.variables = snap.variables.variables.map((v) => {
            if (isClaimBound(v)) {
                const clonedClaimId = claimRemap.get(v.claimId)
                if (clonedClaimId) {
                    return {
                        ...v,
                        claimId: clonedClaimId,
                        claimVersion: 0,
                    } as typeof v
                }
            }
            return v
        })

        const finalEngine = ArgumentEngine.fromSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            snap,
            this.claims,
            this.sources,
            this.claimSources,
            snap.config?.grammarConfig,
            "ignore",
            this.generateId
        )

        // Step 8: Register engine
        this.arguments.register(finalEngine)

        // Step 9: Create fork records

        // Argument fork record
        const argumentFork = this.forks.arguments.create({
            entityId: resolvedNewArgumentId,
            forkedFromEntityId: sourceArg.id,
            forkedFromArgumentId: sourceArg.id,
            forkedFromArgumentVersion: sourceArg.version,
            forkId,
            ...options?.argumentForkExtras,
        } as TArgFork)

        // Premise fork records
        for (const [oldPremiseId, newPremiseId] of remapTable.premises) {
            this.forks.premises.create({
                entityId: newPremiseId,
                forkedFromEntityId: oldPremiseId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                ...options?.premiseForkExtras,
            } as TPremiseFork)
        }

        // Expression fork records
        for (const [oldExprId, newExprId] of remapTable.expressions) {
            this.forks.expressions.create({
                entityId: newExprId,
                forkedFromEntityId: oldExprId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                forkedFromPremiseId: exprToPremiseMap.get(oldExprId)!,
                ...options?.expressionForkExtras,
            } as TExprFork)
        }

        // Variable fork records
        for (const [oldVarId, newVarId] of remapTable.variables) {
            this.forks.variables.create({
                entityId: newVarId,
                forkedFromEntityId: oldVarId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                ...options?.variableForkExtras,
            } as TVarFork)
        }

        // Claim fork records
        for (const [originalClaimId, clonedClaimId] of claimRemap) {
            this.forks.claims.create({
                entityId: clonedClaimId,
                forkedFromEntityId: originalClaimId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                forkedFromEntityVersion: claimVersionMap.get(originalClaimId)!,
                ...options?.claimForkExtras,
            } as TClaimFork)
        }

        // Source fork records
        for (const [originalSourceId, clonedSourceId] of sourceRemap) {
            this.forks.sources.create({
                entityId: clonedSourceId,
                forkedFromEntityId: originalSourceId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                forkedFromEntityVersion:
                    sourceVersionMap.get(originalSourceId)!,
                ...options?.sourceForkExtras,
            } as TSourceFork)
        }

        // Step 10: Return
        return {
            engine: finalEngine,
            remapTable,
            claimRemap,
            sourceRemap,
            argumentFork,
        }
    }

    /**
     * Computes a structural diff between two arguments managed by this
     * `PropositCore` instance. Automatically injects fork-aware entity
     * matchers derived from the fork records stored in `this.forks`.
     * Caller-provided matchers in `options` take precedence over the
     * fork-aware defaults.
     *
     * @param argumentIdA - The ID of the "before" argument.
     * @param argumentIdB - The ID of the "after" argument.
     * @param options - Optional diff configuration and comparator overrides.
     * @returns A structural diff between the two arguments.
     */
    public diffArguments(
        argumentIdA: string,
        argumentIdB: string,
        options?: TCoreDiffOptions<TArg, TVar, TPremise, TExpr>
    ): TCoreArgumentDiff<TArg, TVar, TPremise, TExpr> {
        const engineA = this.arguments.get(argumentIdA)
        if (!engineA) {
            throw new Error(`Argument "${argumentIdA}" not found.`)
        }
        const engineB = this.arguments.get(argumentIdB)
        if (!engineB) {
            throw new Error(`Argument "${argumentIdB}" not found.`)
        }

        // Build fork-aware matchers from fork records
        const forkPremiseMatcher = (a: TPremise, b: TPremise): boolean => {
            const record = this.forks.premises.get(b.id)
            return record?.forkedFromEntityId === a.id
        }
        const forkVariableMatcher = (a: TVar, b: TVar): boolean => {
            const record = this.forks.variables.get(b.id)
            return record?.forkedFromEntityId === a.id
        }
        const forkExpressionMatcher = (a: TExpr, b: TExpr): boolean => {
            const record = this.forks.expressions.get(b.id)
            return record?.forkedFromEntityId === a.id
        }

        // Caller-provided matchers override fork-aware matchers
        return standaloneDiffArguments(engineA, engineB, {
            ...options,
            premiseMatcher: options?.premiseMatcher ?? forkPremiseMatcher,
            variableMatcher: options?.variableMatcher ?? forkVariableMatcher,
            expressionMatcher:
                options?.expressionMatcher ?? forkExpressionMatcher,
        })
    }
}
