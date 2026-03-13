import type { TCoreAssertion } from "../schemata/assertion.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TAssertionLookup,
    TAssertionLibrarySnapshot,
} from "./interfaces/library.interfaces.js"

export class AssertionLibrary<
    TAssertion extends TCoreAssertion = TCoreAssertion,
> implements TAssertionLookup<TAssertion> {
    private entities: Map<string, Map<number, TAssertion>>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.entities = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    public create(
        assertion: Omit<TAssertion, "version" | "frozen" | "checksum">
    ): TAssertion {
        if (this.entities.has(assertion.id as string)) {
            throw new Error(
                `Assertion with ID "${assertion.id}" already exists.`
            )
        }
        const full = {
            ...assertion,
            version: 0,
            frozen: false,
            checksum: "",
        } as TAssertion
        full.checksum = this.computeChecksum(full)

        const versions = new Map<number, TAssertion>()
        versions.set(0, full)
        this.entities.set(full.id, versions)
        return full
    }

    public update(
        id: string,
        updates: Partial<
            Omit<TAssertion, "id" | "version" | "frozen" | "checksum">
        >
    ): TAssertion {
        const versions = this.entities.get(id)
        if (!versions) {
            throw new Error(`Assertion "${id}" does not exist.`)
        }
        const maxVersion = this.maxVersion(versions)
        const current = versions.get(maxVersion)!
        if (current.frozen) {
            throw new Error(
                `Assertion "${id}" version ${maxVersion} is frozen and cannot be updated.`
            )
        }
        const updated = {
            ...current,
            ...updates,
            id: current.id,
            version: current.version,
            frozen: current.frozen,
            checksum: "",
        } as TAssertion
        updated.checksum = this.computeChecksum(updated)
        versions.set(maxVersion, updated)
        return updated
    }

    public freeze(id: string): { frozen: TAssertion; current: TAssertion } {
        const versions = this.entities.get(id)
        if (!versions) {
            throw new Error(`Assertion "${id}" does not exist.`)
        }
        const maxVersion = this.maxVersion(versions)
        const current = versions.get(maxVersion)!
        if (current.frozen) {
            throw new Error(
                `Assertion "${id}" version ${maxVersion} is already frozen.`
            )
        }
        const frozenEntity = {
            ...current,
            frozen: true,
            checksum: "",
        } as TAssertion
        frozenEntity.checksum = this.computeChecksum(frozenEntity)
        versions.set(maxVersion, frozenEntity)

        const nextVersion = maxVersion + 1
        const nextEntity = {
            ...current,
            version: nextVersion,
            frozen: false,
            checksum: "",
        } as TAssertion
        nextEntity.checksum = this.computeChecksum(nextEntity)
        versions.set(nextVersion, nextEntity)

        return { frozen: frozenEntity, current: nextEntity }
    }

    public get(id: string, version: number): TAssertion | undefined {
        return this.entities.get(id)?.get(version)
    }

    public getCurrent(id: string): TAssertion | undefined {
        const versions = this.entities.get(id)
        if (!versions) return undefined
        return versions.get(this.maxVersion(versions))
    }

    public getAll(): TAssertion[] {
        const result: TAssertion[] = []
        for (const versions of this.entities.values()) {
            for (const entity of versions.values()) {
                result.push(entity)
            }
        }
        return result
    }

    public getVersions(id: string): TAssertion[] {
        const versions = this.entities.get(id)
        if (!versions) return []
        return Array.from(versions.values()).sort(
            (a, b) => a.version - b.version
        )
    }

    public snapshot(): TAssertionLibrarySnapshot<TAssertion> {
        return { assertions: this.getAll() }
    }

    public static fromSnapshot<
        TAssertion extends TCoreAssertion = TCoreAssertion,
    >(
        snapshot: TAssertionLibrarySnapshot<TAssertion>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): AssertionLibrary<TAssertion> {
        const lib = new AssertionLibrary<TAssertion>(options)
        for (const entity of snapshot.assertions) {
            let versions = lib.entities.get(entity.id)
            if (!versions) {
                versions = new Map()
                lib.entities.set(entity.id, versions)
            }
            versions.set(entity.version, entity)
        }
        return lib
    }

    private maxVersion(versions: Map<number, TAssertion>): number {
        let max = -1
        for (const v of versions.keys()) {
            if (v > max) max = v
        }
        return max
    }

    private computeChecksum(entity: TAssertion): string {
        const fields =
            this.checksumConfig?.assertionFields ??
            DEFAULT_CHECKSUM_CONFIG.assertionFields!
        return entityChecksum(
            entity as unknown as Record<string, unknown>,
            fields
        )
    }
}
