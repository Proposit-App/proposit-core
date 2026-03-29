import type { TCoreClaim } from "../../schemata/claim.js"
import type {
    TCoreClaimSourceAssociation,
    TCoreSource,
} from "../../schemata/source.js"
import type { TCoreFork } from "../../schemata/fork.js"
import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
    TCoreSourceForkRecord,
} from "../../schemata/fork.js"
import type { TInvariantValidationResult } from "../../types/validation.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"
import type { TCoreChecksumConfig } from "../../types/checksum.js"
import type { TCorePositionConfig } from "../../utils/position.js"
import type { TGrammarConfig } from "../../types/grammar.js"

/**
 * Narrow read-only interface for claim lookups. Used by `ArgumentEngine` for
 * variable validation — callers that only need to verify claim existence
 * should depend on this rather than the full `ClaimLibrary`.
 */
export interface TClaimLookup<TClaim extends TCoreClaim = TCoreClaim> {
    /**
     * Returns a claim by ID and version, or `undefined` if not found.
     *
     * @param id - The claim ID.
     * @param version - The claim version number.
     * @returns The claim entity, or `undefined`.
     */
    get(id: string, version: number): TClaim | undefined
}

/**
 * Narrow read-only interface for source lookups. Used by `ArgumentEngine` for
 * validation — callers that only need to verify source existence should depend
 * on this rather than the full `SourceLibrary`.
 */
export interface TSourceLookup<TSource extends TCoreSource = TCoreSource> {
    /**
     * Returns a source by ID and version, or `undefined` if not found.
     *
     * @param id - The source ID.
     * @param version - The source version number.
     * @returns The source entity, or `undefined`.
     */
    get(id: string, version: number): TSource | undefined
}

/**
 * Full management interface for a versioned claim library. Extends
 * `TClaimLookup` with mutation, query, and snapshot methods.
 */
export interface TClaimLibraryManagement<
    TClaim extends TCoreClaim = TCoreClaim,
> extends TClaimLookup<TClaim> {
    /**
     * Creates a new claim at version 0. The `version`, `frozen`, and
     * `checksum` fields are assigned automatically.
     *
     * @param claim - The claim data without system-managed fields.
     * @returns The created claim entity with all fields populated.
     * @throws If a claim with the same ID already exists.
     */
    create(claim: Omit<TClaim, "version" | "frozen" | "checksum">): TClaim

    /**
     * Updates mutable fields on the current (latest, unfrozen) version of a
     * claim. System-managed fields (`id`, `version`, `frozen`, `checksum`)
     * cannot be updated.
     *
     * @param id - The claim ID.
     * @param updates - The fields to update.
     * @returns The updated claim entity.
     * @throws If the claim does not exist.
     * @throws If the current version is frozen.
     */
    update(
        id: string,
        updates: Partial<Omit<TClaim, "id" | "version" | "frozen" | "checksum">>
    ): TClaim

    /**
     * Freezes the current version of a claim (marking it immutable) and
     * creates a new mutable version at `version + 1`.
     *
     * @param id - The claim ID.
     * @returns An object containing the `frozen` version and the new
     *   `current` (mutable) version.
     * @throws If the claim does not exist.
     * @throws If the current version is already frozen.
     */
    freeze(id: string): { frozen: TClaim; current: TClaim }

    /**
     * Returns the latest version of a claim, or `undefined` if not found.
     *
     * @param id - The claim ID.
     * @returns The latest claim entity, or `undefined`.
     */
    getCurrent(id: string): TClaim | undefined

    /**
     * Returns all claim entities across all IDs and versions.
     *
     * @returns An array of all claim entities.
     */
    getAll(): TClaim[]

    /**
     * Returns all versions of a claim sorted by version number ascending.
     *
     * @param id - The claim ID.
     * @returns An array of claim entities, or an empty array if the ID does
     *   not exist.
     */
    getVersions(id: string): TClaim[]

    /**
     * Returns a serializable snapshot of all claims in the library.
     *
     * @returns The claim library snapshot.
     */
    snapshot(): TClaimLibrarySnapshot<TClaim>

    /**
     * Run invariant validation on the claim library.
     *
     * @returns The invariant validation result.
     */
    validate(): TInvariantValidationResult
}

/**
 * Full management interface for a versioned source library. Extends
 * `TSourceLookup` with mutation, query, and snapshot methods.
 */
export interface TSourceLibraryManagement<
    TSource extends TCoreSource = TCoreSource,
> extends TSourceLookup<TSource> {
    /**
     * Creates a new source at version 0. The `version`, `frozen`, and
     * `checksum` fields are assigned automatically.
     *
     * @param source - The source data without system-managed fields.
     * @returns The created source entity with all fields populated.
     * @throws If a source with the same ID already exists.
     */
    create(source: Omit<TSource, "version" | "frozen" | "checksum">): TSource

    /**
     * Updates mutable fields on the current (latest, unfrozen) version of a
     * source. System-managed fields (`id`, `version`, `frozen`, `checksum`)
     * cannot be updated.
     *
     * @param id - The source ID.
     * @param updates - The fields to update.
     * @returns The updated source entity.
     * @throws If the source does not exist.
     * @throws If the current version is frozen.
     */
    update(
        id: string,
        updates: Partial<
            Omit<TSource, "id" | "version" | "frozen" | "checksum">
        >
    ): TSource

    /**
     * Freezes the current version of a source (marking it immutable) and
     * creates a new mutable version at `version + 1`.
     *
     * @param id - The source ID.
     * @returns An object containing the `frozen` version and the new
     *   `current` (mutable) version.
     * @throws If the source does not exist.
     * @throws If the current version is already frozen.
     */
    freeze(id: string): { frozen: TSource; current: TSource }

    /**
     * Returns the latest version of a source, or `undefined` if not found.
     *
     * @param id - The source ID.
     * @returns The latest source entity, or `undefined`.
     */
    getCurrent(id: string): TSource | undefined

    /**
     * Returns all source entities across all IDs and versions.
     *
     * @returns An array of all source entities.
     */
    getAll(): TSource[]

    /**
     * Returns all versions of a source sorted by version number ascending.
     *
     * @param id - The source ID.
     * @returns An array of source entities, or an empty array if the ID does
     *   not exist.
     */
    getVersions(id: string): TSource[]

    /**
     * Returns a serializable snapshot of all sources in the library.
     *
     * @returns The source library snapshot.
     */
    snapshot(): TSourceLibrarySnapshot<TSource>

    /**
     * Run invariant validation on the source library.
     *
     * @returns The invariant validation result.
     */
    validate(): TInvariantValidationResult
}

/**
 * Narrow read-only interface for claim-source association lookups.
 * Implemented by `ClaimSourceLibrary`. Passed to `ArgumentEngine` as the
 * fourth constructor parameter.
 */
export interface TClaimSourceLookup<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    /**
     * Returns all associations for the given claim ID.
     *
     * @param claimId - The claim ID to filter by.
     * @returns An array of matching associations.
     */
    getForClaim(claimId: string): TAssoc[]

    /**
     * Returns all associations for the given source ID.
     *
     * @param sourceId - The source ID to filter by.
     * @returns An array of matching associations.
     */
    getForSource(sourceId: string): TAssoc[]

    /**
     * Returns an association by ID, or `undefined` if not found.
     *
     * @param id - The association ID.
     * @returns The association entity, or `undefined`.
     */
    get(id: string): TAssoc | undefined
}

/**
 * Full management interface for a claim-source association library. Extends
 * `TClaimSourceLookup` with mutation, query, and snapshot methods.
 * Associations are create-or-delete only — no update path.
 */
export interface TClaimSourceLibraryManagement<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> extends TClaimSourceLookup<TAssoc> {
    /**
     * Creates a claim-source association. Validates that the referenced claim
     * and source exist in their respective libraries.
     *
     * @param assoc - The association data without the `checksum` field.
     * @returns The created association with checksum populated.
     * @throws If an association with the same ID already exists.
     * @throws If the referenced claim or source does not exist.
     */
    add(assoc: Omit<TAssoc, "checksum">): TAssoc

    /**
     * Removes a claim-source association by ID.
     *
     * @param id - The association ID to remove.
     * @returns The removed association entity.
     * @throws If the association does not exist.
     */
    remove(id: string): TAssoc

    /**
     * Returns all associations in the library.
     *
     * @returns An array of all association entities.
     */
    getAll(): TAssoc[]

    /**
     * Returns all associations matching the predicate.
     *
     * @param predicate - A filter function applied to each association.
     * @returns An array of matching associations.
     */
    filter(predicate: (a: TAssoc) => boolean): TAssoc[]

    /**
     * Returns a serializable snapshot of all associations in the library.
     *
     * @returns The claim-source library snapshot.
     */
    snapshot(): TClaimSourceLibrarySnapshot<TAssoc>

    /**
     * Run invariant validation on the claim-source association library.
     *
     * @returns The invariant validation result.
     */
    validate(): TInvariantValidationResult
}

/**
 * Serializable snapshot of a `ClaimLibrary`. Contains all claim entities
 * across all IDs and versions.
 */
export type TClaimLibrarySnapshot<TClaim extends TCoreClaim = TCoreClaim> = {
    /** All claim entities in the library. */
    claims: TClaim[]
}

/**
 * Serializable snapshot of a `SourceLibrary`. Contains all source entities
 * across all IDs and versions.
 */
export type TSourceLibrarySnapshot<TSource extends TCoreSource = TCoreSource> =
    {
        /** All source entities in the library. */
        sources: TSource[]
    }

/**
 * Serializable snapshot of a `ClaimSourceLibrary`. Contains all association
 * entities.
 */
export type TClaimSourceLibrarySnapshot<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> = {
    /** All claim-source association entities in the library. */
    claimSourceAssociations: TAssoc[]
}

/**
 * Narrow read-only interface for fork record lookups. Implemented by
 * `ForksLibrary`. Use this interface for consumers that only need to
 * query fork records without mutation access.
 */
export interface TForkLookup<TFork extends TCoreFork = TCoreFork> {
    /**
     * Returns a fork record by ID, or `undefined` if not found.
     *
     * @param id - The fork record ID.
     * @returns The fork entity, or `undefined`.
     */
    get(id: string): TFork | undefined

    /**
     * Returns all fork records in the library.
     *
     * @returns An array of all fork entities.
     */
    getAll(): TFork[]
}

/**
 * Serializable snapshot of a `ForksLibrary`. Contains all fork record
 * entities.
 */
export type TForksLibrarySnapshot<TFork extends TCoreFork = TCoreFork> = {
    /** All fork record entities in the library. */
    forks: TFork[]
}

/**
 * Serializable snapshot of a `ForkLibrary`. Contains arrays of fork records
 * for each entity type.
 */
export type TForkLibrarySnapshot<
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
> = {
    /** All argument fork records. */
    arguments: TArgFork[]
    /** All premise fork records. */
    premises: TPremiseFork[]
    /** All expression fork records. */
    expressions: TExprFork[]
    /** All variable fork records. */
    variables: TVarFork[]
    /** All claim fork records. */
    claims: TClaimFork[]
    /** All source fork records. */
    sources: TSourceFork[]
}

/**
 * Serializable snapshot of an `ArgumentLibrary`. Contains snapshots of all
 * managed `ArgumentEngine` instances.
 */
export type TArgumentLibrarySnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    /** Snapshots of all argument engines in the library. */
    arguments: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>[]
}

/**
 * Serializable snapshot of a `PropositCore` instance. Contains snapshots of
 * all managed libraries: arguments, claims, sources, claim-source associations,
 * and fork records.
 */
export type TPropositCoreSnapshot<
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
> = {
    /** Snapshot of all argument engines. */
    arguments: TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar>
    /** Snapshot of the claim library. */
    claims: TClaimLibrarySnapshot<TClaim>
    /** Snapshot of the source library. */
    sources: TSourceLibrarySnapshot<TSource>
    /** Snapshot of the claim-source association library. */
    claimSources: TClaimSourceLibrarySnapshot<TAssoc>
    /** Snapshot of the fork library. */
    forks: TForkLibrarySnapshot<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    >
}

/**
 * Shared configuration options for `PropositCore`. These config values are
 * threaded to all internally constructed libraries and engines.
 */
export type TPropositCoreConfig = {
    /** Checksum config shared across all libraries and engines. */
    checksumConfig?: TCoreChecksumConfig
    /** Position config for argument engines. */
    positionConfig?: TCorePositionConfig
    /** Grammar config for argument engines. */
    grammarConfig?: TGrammarConfig
}
