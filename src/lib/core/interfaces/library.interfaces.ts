import type { TCoreClaim } from "../../schemata/claim.js"
import type { TCoreClaimConnection } from "../../schemata/claim-connection.js"
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

    /**
     * Returns the latest version of a claim for the given ID, or `undefined`
     * if the claim does not exist in this lookup.
     *
     * Implementations backed by a flat array (e.g. `createLookup`) return the
     * item with the highest version number for the given ID. The full
     * `ClaimLibrary` class tracks versions natively and returns its internal
     * latest version directly.
     *
     * @param id - The claim ID.
     * @returns The latest claim entity, or `undefined`.
     */
    getCurrent(id: string): TClaim | undefined
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
 * Narrow read-only interface for claim-connection lookups.
 * Implemented by `ClaimCitationLibrary` and `ClaimAxiomLibrary`.
 *
 * A claim connection is a directional support edge between two claims. The
 * supported endpoint lives at `claimId`; the endpoint that supplies the
 * support lives at `supportingClaimId`. Specializations (citation vs. axiom)
 * differ in which library they live in and what type the supporting-side
 * claim must have.
 */
export interface TClaimConnectionLookup<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
> {
    /**
     * Returns all connections where the given claim is the supported
     * endpoint (i.e. the `claimId` side of the edge).
     *
     * @param claimId - The supported claim ID to filter by.
     * @returns An array of matching connections.
     */
    getConnectionsForClaim(claimId: string): TConn[]

    /**
     * Returns a connection by ID, or `undefined` if not found.
     *
     * @param id - The connection ID.
     * @returns The connection entity, or `undefined`.
     */
    get(id: string): TConn | undefined
}

/**
 * Full management interface for a claim-connection library. Extends
 * `TClaimConnectionLookup` with mutation, query, and snapshot methods.
 * Connections are create-or-delete only — no update path.
 */
export interface TClaimConnectionLibraryManagement<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
> extends TClaimConnectionLookup<TConn> {
    /**
     * Creates a claim connection. Implementations validate that both the
     * supported and supporting claims exist in the underlying claim library
     * and that the supporting-side claim has the type required by this
     * specialization (e.g. `'citation'` for `ClaimCitationLibrary`,
     * `'axiomatic'` for `ClaimAxiomLibrary`). Citation libraries also
     * reject any edge that would introduce a cycle in the global
     * claim-citation graph.
     *
     * @param connection - The connection data without the `checksum` field.
     * @returns The created connection with `checksum` populated.
     * @throws If a connection with the same ID already exists.
     * @throws If either referenced claim does not exist in the claim library.
     * @throws If the supporting-side claim has the wrong `type` for this
     *   specialization.
     * @throws If the connection would create a cycle (citation library only).
     */
    add(connection: Omit<TConn, "checksum">): TConn

    /**
     * Removes a claim connection by ID.
     *
     * @param id - The connection ID to remove.
     * @returns The removed connection entity.
     * @throws If the connection does not exist.
     */
    remove(id: string): TConn

    /**
     * Returns all connections in the library.
     *
     * @returns An array of all connection entities.
     */
    getAll(): TConn[]

    /**
     * Returns all connections matching the predicate.
     *
     * @param predicate - A filter function applied to each connection.
     * @returns An array of matching connections.
     */
    filter(predicate: (c: TConn) => boolean): TConn[]

    /**
     * Returns a serializable snapshot of all connections in the library.
     *
     * @returns The claim-connection library snapshot.
     */
    snapshot(): TClaimConnectionLibrarySnapshot<TConn>

    /**
     * Run invariant validation on the claim-connection library.
     *
     * @returns The invariant validation result.
     */
    validate(): TInvariantValidationResult
}

export type TClaimConnectionLibrarySnapshot<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
> = {
    /** All claim-connection entities in the library. */
    connections: TConn[]
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
 * all managed libraries: arguments, claims, claim citations, axioms, and fork
 * records.
 */
export type TPropositCoreSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
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
    citations: TClaimConnectionLibrarySnapshot<TCitation>
    /** Snapshot of the claim-axiom library. */
    axioms: TClaimConnectionLibrarySnapshot<TAxiom>
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
    /**
     * Default behavior for engines constructed via this core's
     * `arguments.create(...)`. Passed through to `TLogicEngineOptions.behavior`.
     * Defaults to `'assistive'` at engine level if omitted.
     *
     * @since 1.0.0
     */
    behavior?: "assistive" | "permissive"
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}
