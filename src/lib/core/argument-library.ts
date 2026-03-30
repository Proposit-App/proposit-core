import type {
    TCoreArgument,
    TCoreClaim,
    TCoreClaimSourceAssociation,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreSource,
    TOptionalChecksum,
} from "../schemata/index.js"
import { ArgumentEngine, type TLogicEngineOptions } from "./argument-engine.js"
import { ClaimLibrary } from "./claim-library.js"
import { ClaimSourceLibrary } from "./claim-source-library.js"
import { SourceLibrary } from "./source-library.js"
import type { TArgumentLibrarySnapshot } from "./interfaces/library.interfaces.js"
import type { TInvariantValidationResult } from "../types/validation.js"

export type TArgumentLibraryLibraries<
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> = {
    claimLibrary: ClaimLibrary<TClaim>
    sourceLibrary: SourceLibrary<TSource>
    claimSourceLibrary: ClaimSourceLibrary<TAssoc>
}

/**
 * Engine registry with lifecycle management. Stores `ArgumentEngine` instances
 * keyed by argument ID.
 */
export class ArgumentLibrary<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    private engines: Map<
        string,
        ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    >
    private libraries: TArgumentLibraryLibraries<TSource, TClaim, TAssoc>
    private options?: TLogicEngineOptions

    constructor(
        libraries: TArgumentLibraryLibraries<TSource, TClaim, TAssoc>,
        options?: TLogicEngineOptions
    ) {
        this.engines = new Map()
        this.libraries = libraries
        this.options = options
    }

    /**
     * Constructs a new `ArgumentEngine` for the given argument and stores it.
     *
     * @param argument - The argument entity to create an engine for. Checksum
     *   fields are optional and will be computed lazily by the engine.
     * @returns The newly created engine.
     * @throws If an engine with the same argument ID already exists.
     */
    public create(
        argument: TOptionalChecksum<TArg>
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        if (this.engines.has(argument.id)) {
            throw new Error(
                `ArgumentLibrary: argument "${argument.id}" already exists.`
            )
        }
        const engine = new ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            argument,
            this.libraries.claimLibrary,
            this.libraries.sourceLibrary,
            this.libraries.claimSourceLibrary,
            this.options
        )
        this.engines.set(argument.id, engine)
        return engine
    }

    /**
     * Registers a pre-built `ArgumentEngine` in the library by its argument ID.
     * Used internally when forking creates a new engine that needs to be tracked.
     *
     * @param engine - The engine to register.
     * @throws If an engine with the same argument ID already exists.
     */
    public register(
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >
    ): void {
        const id = engine.getArgument().id
        if (this.engines.has(id)) {
            throw new Error(`ArgumentLibrary: argument "${id}" already exists.`)
        }
        this.engines.set(id, engine)
    }

    /**
     * Returns the engine for the given argument ID, or `undefined` if not
     * found.
     *
     * @param argumentId - The argument ID to look up.
     * @returns The engine, or `undefined`.
     */
    public get(
        argumentId: string
    ):
        | ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
        | undefined {
        return this.engines.get(argumentId)
    }

    /**
     * Returns all engines in the library as an array.
     *
     * @returns An array of all managed engines.
     */
    public getAll(): ArgumentEngine<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >[] {
        return Array.from(this.engines.values())
    }

    /**
     * Removes the engine for the given argument ID and returns it.
     *
     * @param argumentId - The argument ID to remove.
     * @returns The removed engine.
     * @throws If no engine with the given ID exists.
     */
    public remove(
        argumentId: string
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        const engine = this.engines.get(argumentId)
        if (engine === undefined) {
            throw new Error(
                `ArgumentLibrary: argument "${argumentId}" not found.`
            )
        }
        this.engines.delete(argumentId)
        return engine
    }

    /**
     * Returns a serializable snapshot of all engines in the library.
     *
     * @returns The argument library snapshot.
     */
    public snapshot(): TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar> {
        return {
            arguments: Array.from(this.engines.values()).map((engine) =>
                engine.snapshot()
            ),
        }
    }

    /**
     * Merges invariant validation results from all managed engines.
     *
     * @returns A combined validation result.
     */
    public validate(): TInvariantValidationResult {
        const violations = []
        for (const engine of this.engines.values()) {
            const result = engine.validate()
            violations.push(...result.violations)
        }
        return { ok: violations.length === 0, violations }
    }

    /**
     * Restores an `ArgumentLibrary` from a snapshot by calling
     * `ArgumentEngine.fromSnapshot()` for each engine snapshot.
     *
     * @param snapshot - The serialized library snapshot.
     * @param libraries - The shared library instances (claim, source, claim-source).
     * @param options - Optional engine construction options.
     * @returns A fully restored `ArgumentLibrary`.
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
    >(
        snapshot: TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar>,
        libraries: TArgumentLibraryLibraries<TSource, TClaim, TAssoc>,
        options?: TLogicEngineOptions
    ): ArgumentLibrary<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        const lib = new ArgumentLibrary<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(libraries, options)
        for (const engineSnap of snapshot.arguments) {
            const engine = ArgumentEngine.fromSnapshot<
                TArg,
                TPremise,
                TExpr,
                TVar,
                TSource,
                TClaim,
                TAssoc
            >(
                engineSnap,
                libraries.claimLibrary,
                libraries.sourceLibrary,
                libraries.claimSourceLibrary,
                undefined,
                "ignore",
                options?.generateId
            )
            lib.engines.set(engine.getArgument().id, engine)
        }
        return lib
    }
}
