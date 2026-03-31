import { Value } from "typebox/value"
import type { TCoreClaimSourceAssociation } from "../schemata/source.js"
import { CoreClaimSourceAssociationSchema } from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLibraryManagement,
    TClaimSourceLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    ASSOC_SCHEMA_INVALID,
    ASSOC_CLAIM_REF_NOT_FOUND,
    ASSOC_SOURCE_REF_NOT_FOUND,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

export class ClaimSourceLibrary<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> implements TClaimSourceLibraryManagement<TAssoc> {
    private associations: Map<string, TAssoc>
    private claimToAssociations: Map<string, Set<string>>
    private sourceToAssociations: Map<string, Set<string>>
    private claimLookup: TClaimLookup
    private sourceLookup: TSourceLookup
    private checksumConfig?: TCoreChecksumConfig

    constructor(
        claimLookup: TClaimLookup,
        sourceLookup: TSourceLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ) {
        this.associations = new Map()
        this.claimToAssociations = new Map()
        this.sourceToAssociations = new Map()
        this.claimLookup = claimLookup
        this.sourceLookup = sourceLookup
        this.checksumConfig = options?.checksumConfig
    }

    private restoreFromSnapshot(
        snap: TClaimSourceLibrarySnapshot<TAssoc>
    ): void {
        this.associations = new Map()
        this.claimToAssociations = new Map()
        this.sourceToAssociations = new Map()
        for (const assoc of snap.claimSourceAssociations) {
            this.associations.set(assoc.id, assoc)
        }
        for (const [id, assoc] of this.associations) {
            const claimKey = assoc.claimId
            if (!this.claimToAssociations.has(claimKey)) {
                this.claimToAssociations.set(claimKey, new Set())
            }
            this.claimToAssociations.get(claimKey)!.add(id)

            const sourceKey = assoc.sourceId
            if (!this.sourceToAssociations.has(sourceKey)) {
                this.sourceToAssociations.set(sourceKey, new Set())
            }
            this.sourceToAssociations.get(sourceKey)!.add(id)
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

    public add(assoc: Omit<TAssoc, "checksum">): TAssoc {
        return this.withValidation(() => {
            if (this.associations.has(assoc.id)) {
                throw new Error(
                    `ClaimSourceAssociation with ID "${assoc.id}" already exists.`
                )
            }

            const claim = this.claimLookup.get(
                assoc.claimId,
                assoc.claimVersion
            )
            if (!claim) {
                throw new Error(
                    `Claim "${assoc.claimId}" version ${assoc.claimVersion} not found in claim lookup.`
                )
            }

            const source = this.sourceLookup.get(
                assoc.sourceId,
                assoc.sourceVersion
            )
            if (!source) {
                throw new Error(
                    `Source "${assoc.sourceId}" version ${assoc.sourceVersion} not found in source lookup.`
                )
            }

            const full = { ...assoc, checksum: "" } as TAssoc
            full.checksum = this.computeChecksum(full)

            this.associations.set(full.id, full)

            let claimSet = this.claimToAssociations.get(full.claimId)
            if (!claimSet) {
                claimSet = new Set()
                this.claimToAssociations.set(full.claimId, claimSet)
            }
            claimSet.add(full.id)

            let sourceSet = this.sourceToAssociations.get(full.sourceId)
            if (!sourceSet) {
                sourceSet = new Set()
                this.sourceToAssociations.set(full.sourceId, sourceSet)
            }
            sourceSet.add(full.id)

            return full
        })
    }

    public remove(id: string): TAssoc {
        return this.withValidation(() => {
            const assoc = this.associations.get(id)
            if (!assoc) {
                throw new Error(`ClaimSourceAssociation "${id}" not found.`)
            }

            this.associations.delete(id)

            const claimSet = this.claimToAssociations.get(assoc.claimId)
            if (claimSet) {
                claimSet.delete(id)
            }

            const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.delete(id)
            }

            return assoc
        })
    }

    public getForClaim(claimId: string): TAssoc[] {
        const ids = this.claimToAssociations.get(claimId)
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.associations.get(id)!)
            .filter(Boolean)
    }

    public getForSource(sourceId: string): TAssoc[] {
        const ids = this.sourceToAssociations.get(sourceId)
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.associations.get(id)!)
            .filter(Boolean)
    }

    public get(id: string): TAssoc | undefined {
        return this.associations.get(id)
    }

    public getAll(): TAssoc[] {
        return Array.from(this.associations.values())
    }

    public filter(predicate: (a: TAssoc) => boolean): TAssoc[] {
        return this.getAll().filter(predicate)
    }

    public snapshot(): TClaimSourceLibrarySnapshot<TAssoc> {
        return { claimSourceAssociations: this.getAll() }
    }

    /** Restores a claim-source library from a snapshot, re-indexing all associations. */
    public static fromSnapshot<
        TAssoc extends TCoreClaimSourceAssociation =
            TCoreClaimSourceAssociation,
    >(
        snapshot: TClaimSourceLibrarySnapshot<TAssoc>,
        claimLookup: TClaimLookup,
        sourceLookup: TSourceLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimSourceLibrary<TAssoc> {
        const lib = new ClaimSourceLibrary<TAssoc>(
            claimLookup,
            sourceLookup,
            options
        )
        for (const assoc of snapshot.claimSourceAssociations) {
            lib.associations.set(assoc.id, assoc)

            let claimSet = lib.claimToAssociations.get(assoc.claimId)
            if (!claimSet) {
                claimSet = new Set()
                lib.claimToAssociations.set(assoc.claimId, claimSet)
            }
            claimSet.add(assoc.id)

            let sourceSet = lib.sourceToAssociations.get(assoc.sourceId)
            if (!sourceSet) {
                sourceSet = new Set()
                lib.sourceToAssociations.set(assoc.sourceId, sourceSet)
            }
            sourceSet.add(assoc.id)
        }
        return lib
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [id, assoc] of this.associations) {
            if (!Value.Check(CoreClaimSourceAssociationSchema, assoc)) {
                violations.push({
                    code: ASSOC_SCHEMA_INVALID,
                    message: `Association "${id}" does not conform to schema`,
                    entityType: "association",
                    entityId: id,
                })
            }
            if (!this.claimLookup.get(assoc.claimId, assoc.claimVersion)) {
                violations.push({
                    code: ASSOC_CLAIM_REF_NOT_FOUND,
                    message: `Association "${id}" references non-existent claim "${assoc.claimId}" version ${assoc.claimVersion}`,
                    entityType: "association",
                    entityId: id,
                })
            }
            if (!this.sourceLookup.get(assoc.sourceId, assoc.sourceVersion)) {
                violations.push({
                    code: ASSOC_SOURCE_REF_NOT_FOUND,
                    message: `Association "${id}" references non-existent source "${assoc.sourceId}" version ${assoc.sourceVersion}`,
                    entityType: "association",
                    entityId: id,
                })
            }
        }
        return { ok: violations.length === 0, violations }
    }

    private computeChecksum(assoc: TAssoc): string {
        const fields =
            this.checksumConfig?.claimSourceAssociationFields ??
            DEFAULT_CHECKSUM_CONFIG.claimSourceAssociationFields!
        return entityChecksum(
            assoc as unknown as Record<string, unknown>,
            fields
        )
    }
}
