import type { TCoreClaimSourceAssociation } from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLibraryManagement,
    TClaimSourceLibrarySnapshot,
} from "./interfaces/library.interfaces.js"

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

    public add(assoc: Omit<TAssoc, "checksum">): TAssoc {
        if (this.associations.has(assoc.id)) {
            throw new Error(
                `ClaimSourceAssociation with ID "${assoc.id}" already exists.`
            )
        }

        const claim = this.claimLookup.get(assoc.claimId, assoc.claimVersion)
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
    }

    public remove(id: string): TAssoc {
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
