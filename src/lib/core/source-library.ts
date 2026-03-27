import { Value } from "typebox/value"
import type { TCoreSource } from "../schemata/source.js"
import { CoreSourceSchema } from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TSourceLibraryManagement,
    TSourceLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    SOURCE_SCHEMA_INVALID,
    SOURCE_FROZEN_NO_SUCCESSOR,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

export class SourceLibrary<
    TSource extends TCoreSource = TCoreSource,
> implements TSourceLibraryManagement<TSource> {
    private entities: Map<string, Map<number, TSource>>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.entities = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    private restoreFromSnapshot(snap: TSourceLibrarySnapshot<TSource>): void {
        this.entities = new Map()
        for (const entity of snap.sources) {
            let versions = this.entities.get(entity.id)
            if (!versions) {
                versions = new Map()
                this.entities.set(entity.id, versions)
            }
            versions.set(entity.version, entity)
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

    public create(
        source: Omit<TSource, "version" | "frozen" | "checksum">
    ): TSource {
        return this.withValidation(() => {
            if (this.entities.has(source.id as string)) {
                throw new Error(`Source with ID "${source.id}" already exists.`)
            }
            const full = {
                ...source,
                version: 0,
                frozen: false,
                checksum: "",
            } as TSource
            full.checksum = this.computeChecksum(full)
            const versions = new Map<number, TSource>()
            versions.set(0, full)
            this.entities.set(full.id, versions)
            return full
        })
    }

    public update(
        id: string,
        updates: Partial<
            Omit<TSource, "id" | "version" | "frozen" | "checksum">
        >
    ): TSource {
        return this.withValidation(() => {
            const versions = this.entities.get(id)
            if (!versions) {
                throw new Error(`Source "${id}" does not exist.`)
            }
            const maxVersion = this.maxVersion(versions)
            const current = versions.get(maxVersion)!
            if (current.frozen) {
                throw new Error(
                    `Source "${id}" version ${maxVersion} is frozen and cannot be updated.`
                )
            }
            const updated = {
                ...current,
                ...updates,
                id: current.id,
                version: current.version,
                frozen: current.frozen,
                checksum: "",
            } as TSource
            updated.checksum = this.computeChecksum(updated)
            versions.set(maxVersion, updated)
            return updated
        })
    }

    public freeze(id: string): { frozen: TSource; current: TSource } {
        return this.withValidation(() => {
            const versions = this.entities.get(id)
            if (!versions) {
                throw new Error(`Source "${id}" does not exist.`)
            }
            const maxVersion = this.maxVersion(versions)
            const current = versions.get(maxVersion)!
            if (current.frozen) {
                throw new Error(
                    `Source "${id}" version ${maxVersion} is already frozen.`
                )
            }
            const frozenEntity = {
                ...current,
                frozen: true,
                checksum: "",
            } as TSource
            frozenEntity.checksum = this.computeChecksum(frozenEntity)
            versions.set(maxVersion, frozenEntity)

            const nextVersion = maxVersion + 1
            const nextEntity = {
                ...current,
                version: nextVersion,
                frozen: false,
                checksum: "",
            } as TSource
            nextEntity.checksum = this.computeChecksum(nextEntity)
            versions.set(nextVersion, nextEntity)

            return { frozen: frozenEntity, current: nextEntity }
        })
    }

    public get(id: string, version: number): TSource | undefined {
        return this.entities.get(id)?.get(version)
    }

    public getCurrent(id: string): TSource | undefined {
        const versions = this.entities.get(id)
        if (!versions) return undefined
        return versions.get(this.maxVersion(versions))
    }

    public getAll(): TSource[] {
        const result: TSource[] = []
        for (const versions of this.entities.values()) {
            for (const entity of versions.values()) {
                result.push(entity)
            }
        }
        return result
    }

    public getVersions(id: string): TSource[] {
        const versions = this.entities.get(id)
        if (!versions) return []
        return Array.from(versions.values()).sort(
            (a, b) => a.version - b.version
        )
    }

    public snapshot(): TSourceLibrarySnapshot<TSource> {
        return { sources: this.getAll() }
    }

    public static fromSnapshot<TSource extends TCoreSource = TCoreSource>(
        snapshot: TSourceLibrarySnapshot<TSource>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): SourceLibrary<TSource> {
        const lib = new SourceLibrary<TSource>(options)
        for (const entity of snapshot.sources) {
            let versions = lib.entities.get(entity.id)
            if (!versions) {
                versions = new Map()
                lib.entities.set(entity.id, versions)
            }
            versions.set(entity.version, entity)
        }
        return lib
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [id, versions] of this.entities) {
            const sortedVersions = [...versions.entries()].sort(
                ([a], [b]) => a - b
            )
            for (const [version, source] of sortedVersions) {
                if (!Value.Check(CoreSourceSchema, source)) {
                    violations.push({
                        code: SOURCE_SCHEMA_INVALID,
                        message: `Source "${id}" version ${version} does not conform to schema`,
                        entityType: "source",
                        entityId: id,
                    })
                }
                if (source.frozen) {
                    const maxVer = this.maxVersion(versions)
                    if (version < maxVer && !versions.has(version + 1)) {
                        violations.push({
                            code: SOURCE_FROZEN_NO_SUCCESSOR,
                            message: `Source "${id}" version ${version} is frozen but has no successor version`,
                            entityType: "source",
                            entityId: id,
                        })
                    }
                }
            }
        }
        return { ok: violations.length === 0, violations }
    }

    private maxVersion(versions: Map<number, TSource>): number {
        let max = -1
        for (const v of versions.keys()) {
            if (v > max) max = v
        }
        return max
    }

    private computeChecksum(entity: TSource): string {
        const fields =
            this.checksumConfig?.sourceFields ??
            DEFAULT_CHECKSUM_CONFIG.sourceFields!
        return entityChecksum(
            entity as unknown as Record<string, unknown>,
            fields
        )
    }
}
