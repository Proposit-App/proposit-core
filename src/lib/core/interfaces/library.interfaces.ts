import type { TCoreClaim } from "../../schemata/claim.js"
import type { TCoreClaimCitation } from "../../schemata/claim-citation.js"
import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
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
 * Full management interface for a versioned claim library. Extends
 * `TClaimLookup` with mutation, query, and snapshot methods.
 */
export interface TClaimLibraryManagement<
    TClaim extends TCoreClaim = TCoreClaim,
> extends TClaimLookup<TClaim> {
    /**
     * Creates a new claim at version 0. The `version`, `frozen`, and
     * `checksum` fields are assigned automatically. The `id` field is
     * auto-generated when omitted. The `type` field is required and is
     * immutable across the claim's lifetime.
     *
     * @param claim - The claim data without system-managed fields. `id` is
     *   optional (auto-generated when omitted) and `type` is required.
     * @returns The created claim entity with all fields populated.
     * @throws If a claim with the same ID already exists.
     */
    create(
        claim:
            | Omit<TClaim, "version" | "frozen" | "checksum">
            | (Omit<TClaim, "id" | "version" | "frozen" | "checksum"> & {
                  id?: string
              })
    ): TClaim

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
 * Narrow read-only interface for claim-citation lookups.
 * Implemented by `ClaimCitationLibrary`.
 */
export interface TClaimCitationLookup<
    TCitation extends TCoreClaimCitation = TCoreClaimCitation,
> {
    /**
     * Returns all citations where the given claim is the citing-side endpoint.
     *
     * @param citingClaimId - The citing claim ID to filter by.
     * @returns An array of matching citations.
     */
    getCitationsForCitingClaim(citingClaimId: string): TCitation[]

    /**
     * Returns all citations where the given claim is the source-side endpoint.
     *
     * @param sourceClaimId - The source claim ID to filter by.
     * @returns An array of matching citations.
     */
    getCitationsForSourceClaim(sourceClaimId: string): TCitation[]

    /**
     * Returns a citation by ID, or `undefined` if not found.
     *
     * @param id - The citation ID.
     * @returns The citation entity, or `undefined`.
     */
    get(id: string): TCitation | undefined
}

/**
 * Full management interface for a claim-citation library. Extends
 * `TClaimCitationLookup` with mutation, query, and snapshot methods.
 * Citations are create-or-delete only — no update path.
 */
export interface TClaimCitationLibraryManagement<
    TCitation extends TCoreClaimCitation = TCoreClaimCitation,
> extends TClaimCitationLookup<TCitation> {
    /**
     * Creates a claim citation. Validates that both the citing and source
     * claims exist in the claim library, that the source-side claim has
     * type='citation', and that the new edge does not introduce a cycle in
     * the global claim-citation graph.
     *
     * @param citation - The citation data without the `checksum` field.
     * @returns The created citation with checksum populated.
     * @throws If a citation with the same ID already exists.
     * @throws If the referenced citing or source claim does not exist.
     * @throws If the source-side claim has type !== 'citation'.
     * @throws If the citation would create a cycle.
     */
    add(citation: Omit<TCitation, "checksum">): TCitation

    /**
     * Removes a claim citation by ID.
     *
     * @param id - The citation ID to remove.
     * @returns The removed citation entity.
     * @throws If the citation does not exist.
     */
    remove(id: string): TCitation

    /**
     * Returns all citations in the library.
     *
     * @returns An array of all citation entities.
     */
    getAll(): TCitation[]

    /**
     * Returns all citations matching the predicate.
     *
     * @param predicate - A filter function applied to each citation.
     * @returns An array of matching citations.
     */
    filter(predicate: (c: TCitation) => boolean): TCitation[]

    /**
     * Returns a serializable snapshot of all citations in the library.
     *
     * @returns The claim-citation library snapshot.
     */
    snapshot(): TClaimCitationLibrarySnapshot<TCitation>

    /**
     * Run invariant validation on the claim-citation library.
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
 * Serializable snapshot of a `ClaimCitationLibrary`. Contains all citation
 * entities.
 */
export type TClaimCitationLibrarySnapshot<
    TCitation extends TCoreClaimCitation = TCoreClaimCitation,
> = {
    /** All claim citation entities in the library. */
    claimCitations: TCitation[]
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
 * all managed libraries: arguments, claims, claim citations, and fork records.
 */
export type TPropositCoreSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimCitation = TCoreClaimCitation,
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
> = {
    /** Snapshot of all argument engines. */
    arguments: TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar>
    /** Snapshot of the claim library. */
    claims: TClaimLibrarySnapshot<TClaim>
    /** Snapshot of the claim-citation library. */
    claimCitations: TClaimCitationLibrarySnapshot<TCitation>
    /** Snapshot of the fork library. */
    forks: TForkLibrarySnapshot<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork
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
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}
