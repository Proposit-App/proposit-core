import type { TCoreClaim } from "../schemata/claim.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TClaimLibraryManagement,
    TClaimLibrarySnapshot,
} from "./interfaces/library.interfaces.js"

export class ClaimLibrary<
    TClaim extends TCoreClaim = TCoreClaim,
> implements TClaimLibraryManagement<TClaim> {
    private entities: Map<string, Map<number, TClaim>>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.entities = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    public create(
        claim: Omit<TClaim, "version" | "frozen" | "checksum">
    ): TClaim {
        if (this.entities.has(claim.id as string)) {
            throw new Error(`Claim with ID "${claim.id}" already exists.`)
        }
        const full = {
            ...claim,
            version: 0,
            frozen: false,
            checksum: "",
        } as TClaim
        full.checksum = this.computeChecksum(full)

        const versions = new Map<number, TClaim>()
        versions.set(0, full)
        this.entities.set(full.id, versions)
        return full
    }

    public update(
        id: string,
        updates: Partial<Omit<TClaim, "id" | "version" | "frozen" | "checksum">>
    ): TClaim {
        const versions = this.entities.get(id)
        if (!versions) {
            throw new Error(`Claim "${id}" does not exist.`)
        }
        const maxVersion = this.maxVersion(versions)
        const current = versions.get(maxVersion)!
        if (current.frozen) {
            throw new Error(
                `Claim "${id}" version ${maxVersion} is frozen and cannot be updated.`
            )
        }
        const updated = {
            ...current,
            ...updates,
            id: current.id,
            version: current.version,
            frozen: current.frozen,
            checksum: "",
        } as TClaim
        updated.checksum = this.computeChecksum(updated)
        versions.set(maxVersion, updated)
        return updated
    }

    public freeze(id: string): { frozen: TClaim; current: TClaim } {
        const versions = this.entities.get(id)
        if (!versions) {
            throw new Error(`Claim "${id}" does not exist.`)
        }
        const maxVersion = this.maxVersion(versions)
        const current = versions.get(maxVersion)!
        if (current.frozen) {
            throw new Error(
                `Claim "${id}" version ${maxVersion} is already frozen.`
            )
        }
        const frozenEntity = {
            ...current,
            frozen: true,
            checksum: "",
        } as TClaim
        frozenEntity.checksum = this.computeChecksum(frozenEntity)
        versions.set(maxVersion, frozenEntity)

        const nextVersion = maxVersion + 1
        const nextEntity = {
            ...current,
            version: nextVersion,
            frozen: false,
            checksum: "",
        } as TClaim
        nextEntity.checksum = this.computeChecksum(nextEntity)
        versions.set(nextVersion, nextEntity)

        return { frozen: frozenEntity, current: nextEntity }
    }

    public get(id: string, version: number): TClaim | undefined {
        return this.entities.get(id)?.get(version)
    }

    public getCurrent(id: string): TClaim | undefined {
        const versions = this.entities.get(id)
        if (!versions) return undefined
        return versions.get(this.maxVersion(versions))
    }

    public getAll(): TClaim[] {
        const result: TClaim[] = []
        for (const versions of this.entities.values()) {
            for (const entity of versions.values()) {
                result.push(entity)
            }
        }
        return result
    }

    public getVersions(id: string): TClaim[] {
        const versions = this.entities.get(id)
        if (!versions) return []
        return Array.from(versions.values()).sort(
            (a, b) => a.version - b.version
        )
    }

    public snapshot(): TClaimLibrarySnapshot<TClaim> {
        return { claims: this.getAll() }
    }

    public static fromSnapshot<TClaim extends TCoreClaim = TCoreClaim>(
        snapshot: TClaimLibrarySnapshot<TClaim>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimLibrary<TClaim> {
        const lib = new ClaimLibrary<TClaim>(options)
        for (const entity of snapshot.claims) {
            let versions = lib.entities.get(entity.id)
            if (!versions) {
                versions = new Map()
                lib.entities.set(entity.id, versions)
            }
            versions.set(entity.version, entity)
        }
        return lib
    }

    private maxVersion(versions: Map<number, TClaim>): number {
        let max = -1
        for (const v of versions.keys()) {
            if (v > max) max = v
        }
        return max
    }

    private computeChecksum(entity: TClaim): string {
        const fields =
            this.checksumConfig?.claimFields ??
            DEFAULT_CHECKSUM_CONFIG.claimFields!
        return entityChecksum(
            entity as unknown as Record<string, unknown>,
            fields
        )
    }
}
