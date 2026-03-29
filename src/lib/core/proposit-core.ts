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
import { ClaimLibrary } from "./claim-library.js"
import { SourceLibrary } from "./source-library.js"
import { ClaimSourceLibrary } from "./claim-source-library.js"
import { ArgumentLibrary } from "./argument-library.js"
import { ForkLibrary } from "./fork-library.js"

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
}
