import { Value } from "typebox/value"
import type { TCoreClaimAxiom } from "../schemata/claim-axiom.js"
import { CoreClaimAxiomSchema } from "../schemata/claim-axiom.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TClaimLookup,
    TClaimConnectionLibraryManagement,
    TClaimConnectionLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    AXIOM_SCHEMA_INVALID,
    AXIOM_DUPLICATE_ID,
    AXIOM_CLAIM_REF_NOT_FOUND,
    AXIOM_SUPPORTING_REF_NOT_FOUND,
    AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE,
    AXIOM_CLAIM_NOT_NORMAL_TYPE,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

/**
 * Manages axiom-invocation edges between claims. Each connection goes from a
 * dependent `claimId` (which must be a `'normal'` claim) to a supporting
 * `supportingClaimId` (which must be an `'axiomatic'` claim).
 *
 * Cycle detection is omitted because axiomatic claims cannot appear on the
 * supported (`claimId`) side — `AXIOM_CLAIM_NOT_NORMAL_TYPE` blocks that —
 * so cycles are structurally impossible.
 */
export class ClaimAxiomLibrary<
    TConnection extends TCoreClaimAxiom = TCoreClaimAxiom,
> implements TClaimConnectionLibraryManagement<TConnection> {
    private axioms: Map<string, TConnection>
    private claimToConnections: Map<string, Set<string>>
    private claimLookup: TClaimLookup
    private checksumConfig?: TCoreChecksumConfig

    constructor(
        claimLookup: TClaimLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ) {
        this.axioms = new Map()
        this.claimToConnections = new Map()
        this.claimLookup = claimLookup
        this.checksumConfig = options?.checksumConfig
    }

    private restoreFromSnapshot(
        snap: TClaimConnectionLibrarySnapshot<TConnection>
    ): void {
        this.axioms = new Map()
        this.claimToConnections = new Map()
        for (const axiom of snap.connections) {
            this.axioms.set(axiom.id, axiom)
        }
        for (const [id, axiom] of this.axioms) {
            const claimKey = axiom.claimId
            if (!this.claimToConnections.has(claimKey)) {
                this.claimToConnections.set(claimKey, new Set())
            }
            this.claimToConnections.get(claimKey)!.add(id)
        }
    }

    private withValidation<T>(fn: () => T): T {
        const snap = this.snapshot()
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.restoreFromSnapshot(snap)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromSnapshot(snap)
            }
            throw e
        }
    }

    public add(axiom: Omit<TConnection, "checksum">): TConnection {
        return this.withValidation(() => {
            if (this.axioms.has(axiom.id)) {
                throw new InvariantViolationError([
                    {
                        code: AXIOM_DUPLICATE_ID,
                        message: `${AXIOM_DUPLICATE_ID}: axiom with id ${axiom.id} already exists`,
                        entityType: "axiom",
                        entityId: axiom.id,
                    },
                ])
            }

            const dependentClaim = this.claimLookup.get(
                axiom.claimId,
                axiom.claimVersion
            )
            if (!dependentClaim) {
                throw new InvariantViolationError([
                    {
                        code: AXIOM_CLAIM_REF_NOT_FOUND,
                        message: `${AXIOM_CLAIM_REF_NOT_FOUND}: axiom references unknown dependent claim ${axiom.claimId}@${axiom.claimVersion}`,
                        entityType: "axiom",
                        entityId: axiom.id,
                    },
                ])
            }
            if (dependentClaim.type !== "normal") {
                throw new InvariantViolationError([
                    {
                        code: AXIOM_CLAIM_NOT_NORMAL_TYPE,
                        message: `${AXIOM_CLAIM_NOT_NORMAL_TYPE}: axiom dependent claim ${axiom.claimId} has type='${dependentClaim.type}'; only 'normal' is permitted on the dependent side`,
                        entityType: "axiom",
                        entityId: axiom.id,
                    },
                ])
            }

            const supportingClaim = this.claimLookup.get(
                axiom.supportingClaimId,
                axiom.supportingClaimVersion
            )
            if (!supportingClaim) {
                throw new InvariantViolationError([
                    {
                        code: AXIOM_SUPPORTING_REF_NOT_FOUND,
                        message: `${AXIOM_SUPPORTING_REF_NOT_FOUND}: axiom references unknown supporting claim ${axiom.supportingClaimId}@${axiom.supportingClaimVersion}`,
                        entityType: "axiom",
                        entityId: axiom.id,
                    },
                ])
            }
            if (supportingClaim.type !== "axiomatic") {
                throw new InvariantViolationError([
                    {
                        code: AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE,
                        message: `${AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE}: axiom supporting claim ${axiom.supportingClaimId} has type='${supportingClaim.type}'; only 'axiomatic' is permitted on the supporting side`,
                        entityType: "axiom",
                        entityId: axiom.id,
                    },
                ])
            }

            const full = { ...axiom, checksum: "" } as TConnection
            full.checksum = this.computeChecksum(full)

            this.axioms.set(full.id, full)

            let claimSet = this.claimToConnections.get(full.claimId)
            if (!claimSet) {
                claimSet = new Set()
                this.claimToConnections.set(full.claimId, claimSet)
            }
            claimSet.add(full.id)

            return full
        })
    }

    public remove(id: string): TConnection {
        return this.withValidation(() => {
            const axiom = this.axioms.get(id)
            if (!axiom) {
                throw new Error(`ClaimAxiom "${id}" not found.`)
            }

            this.axioms.delete(id)

            const claimSet = this.claimToConnections.get(axiom.claimId)
            if (claimSet) {
                claimSet.delete(id)
            }

            return axiom
        })
    }

    public getConnectionsForClaim(claimId: string): TConnection[] {
        const ids = this.claimToConnections.get(claimId)
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.axioms.get(id)!)
            .filter(Boolean)
    }

    public get(id: string): TConnection | undefined {
        return this.axioms.get(id)
    }

    public getAll(): TConnection[] {
        return Array.from(this.axioms.values())
    }

    public filter(predicate: (c: TConnection) => boolean): TConnection[] {
        return this.getAll().filter(predicate)
    }

    public snapshot(): TClaimConnectionLibrarySnapshot<TConnection> {
        return { connections: this.getAll() }
    }

    /** Restores a claim-axiom library from a snapshot, re-indexing all axioms. */
    public static fromSnapshot<
        TConnection extends TCoreClaimAxiom = TCoreClaimAxiom,
    >(
        snapshot: TClaimConnectionLibrarySnapshot<TConnection>,
        claimLookup: TClaimLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimAxiomLibrary<TConnection> {
        const lib = new ClaimAxiomLibrary<TConnection>(claimLookup, options)
        for (const axiom of snapshot.connections) {
            lib.axioms.set(axiom.id, axiom)

            let claimSet = lib.claimToConnections.get(axiom.claimId)
            if (!claimSet) {
                claimSet = new Set()
                lib.claimToConnections.set(axiom.claimId, claimSet)
            }
            claimSet.add(axiom.id)
        }
        return lib
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [id, axiom] of this.axioms) {
            if (!Value.Check(CoreClaimAxiomSchema, axiom)) {
                violations.push({
                    code: AXIOM_SCHEMA_INVALID,
                    message: `${AXIOM_SCHEMA_INVALID}: axiom "${id}" does not conform to schema`,
                    entityType: "axiom",
                    entityId: id,
                })
            }
            if (!this.claimLookup.get(axiom.claimId, axiom.claimVersion)) {
                violations.push({
                    code: AXIOM_CLAIM_REF_NOT_FOUND,
                    message: `${AXIOM_CLAIM_REF_NOT_FOUND}: axiom "${id}" references non-existent dependent claim "${axiom.claimId}" version ${axiom.claimVersion}`,
                    entityType: "axiom",
                    entityId: id,
                })
            }
            if (
                !this.claimLookup.get(
                    axiom.supportingClaimId,
                    axiom.supportingClaimVersion
                )
            ) {
                violations.push({
                    code: AXIOM_SUPPORTING_REF_NOT_FOUND,
                    message: `${AXIOM_SUPPORTING_REF_NOT_FOUND}: axiom "${id}" references non-existent supporting claim "${axiom.supportingClaimId}" version ${axiom.supportingClaimVersion}`,
                    entityType: "axiom",
                    entityId: id,
                })
            }
        }

        // Strict supporting-side type: every axiom's supporting claim must have
        // type='axiomatic'. Catches tampered snapshots loaded via fromSnapshot.
        for (const axiom of this.axioms.values()) {
            const supportingClaim = this.claimLookup.get(
                axiom.supportingClaimId,
                axiom.supportingClaimVersion
            )
            if (supportingClaim && supportingClaim.type !== "axiomatic") {
                violations.push({
                    code: AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE,
                    message: `${AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE}: axiom ${axiom.id} supporting claim ${axiom.supportingClaimId} has type='${supportingClaim.type}'; only 'axiomatic' is permitted on the supporting side`,
                    entityType: "axiom",
                    entityId: axiom.id,
                })
            }
        }

        // Strict dependent-side type: every axiom's dependent claim must have
        // type='normal'. Catches tampered snapshots loaded via fromSnapshot.
        for (const axiom of this.axioms.values()) {
            const dependentClaim = this.claimLookup.get(
                axiom.claimId,
                axiom.claimVersion
            )
            if (dependentClaim && dependentClaim.type !== "normal") {
                violations.push({
                    code: AXIOM_CLAIM_NOT_NORMAL_TYPE,
                    message: `${AXIOM_CLAIM_NOT_NORMAL_TYPE}: axiom ${axiom.id} dependent claim ${axiom.claimId} has type='${dependentClaim.type}'; only 'normal' is permitted on the dependent side`,
                    entityType: "axiom",
                    entityId: axiom.id,
                })
            }
        }

        return { ok: violations.length === 0, violations }
    }

    private computeChecksum(axiom: TConnection): string {
        const fields =
            this.checksumConfig?.claimAxiomFields ??
            DEFAULT_CHECKSUM_CONFIG.claimAxiomFields ??
            DEFAULT_CHECKSUM_CONFIG.claimCitationFields!
        return entityChecksum(
            axiom as unknown as Record<string, unknown>,
            fields
        )
    }
}
