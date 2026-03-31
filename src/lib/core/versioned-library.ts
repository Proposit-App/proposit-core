import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
    TInvariantViolationEntityType,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

/** Base shape for entities managed by {@link VersionedLibrary}. */
export type TVersionedEntity = {
    id: string
    version: number
    frozen: boolean
    checksum: string
}

/**
 * Abstract base class for versioned, freezable entity libraries.
 * Provides CRUD, freeze/unfreeze lifecycle, schema validation, and checksum
 * computation. Subclasses supply the entity label, schema, and validation codes.
 */
export abstract class VersionedLibrary<TEntity extends TVersionedEntity> {
    protected entities: Map<string, Map<number, TEntity>>
    protected checksumConfig?: TCoreChecksumConfig

    protected abstract readonly entityLabel: string
    protected abstract readonly entityType: TInvariantViolationEntityType
    protected abstract readonly schema: TSchema
    protected abstract readonly checksumFieldsKey: keyof TCoreChecksumConfig
    protected abstract readonly schemaInvalidCode: string
    protected abstract readonly frozenSuccessorCode: string

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.entities = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    protected restoreFromEntities(items: TEntity[]): void {
        this.entities = new Map()
        for (const entity of items) {
            let versions = this.entities.get(entity.id)
            if (!versions) {
                versions = new Map()
                this.entities.set(entity.id, versions)
            }
            versions.set(entity.version, entity)
        }
    }

    protected withValidation<T>(fn: () => T): T {
        const all = this.getAll()
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.restoreFromEntities(all)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromEntities(all)
            }
            throw e
        }
    }

    /** Creates a new entity at version 0. Throws if the ID already exists. */
    public create(
        entity: Omit<TEntity, "version" | "frozen" | "checksum">
    ): TEntity {
        return this.withValidation(() => {
            if (this.entities.has(entity.id as string)) {
                throw new Error(
                    `${this.entityLabel} with ID "${entity.id}" already exists.`
                )
            }
            const full = {
                ...entity,
                version: 0,
                frozen: false,
                checksum: "",
            } as TEntity
            full.checksum = this.computeChecksum(full)

            const versions = new Map<number, TEntity>()
            versions.set(0, full)
            this.entities.set(full.id, versions)
            return full
        })
    }

    /** Applies partial updates to the latest version of an entity. Throws if the entity is frozen. */
    public update(
        id: string,
        updates: Partial<
            Omit<TEntity, "id" | "version" | "frozen" | "checksum">
        >
    ): TEntity {
        return this.withValidation(() => {
            const versions = this.entities.get(id)
            if (!versions) {
                throw new Error(`${this.entityLabel} "${id}" does not exist.`)
            }
            const maxVersion = this.maxVersion(versions)
            const current = versions.get(maxVersion)!
            if (current.frozen) {
                throw new Error(
                    `${this.entityLabel} "${id}" version ${maxVersion} is frozen and cannot be updated.`
                )
            }
            const updated = {
                ...current,
                ...updates,
                id: current.id,
                version: current.version,
                frozen: current.frozen,
                checksum: "",
            } as TEntity
            updated.checksum = this.computeChecksum(updated)
            versions.set(maxVersion, updated)
            return updated
        })
    }

    /** Freezes the latest version and creates a new mutable successor. Returns both. */
    public freeze(id: string): { frozen: TEntity; current: TEntity } {
        return this.withValidation(() => {
            const versions = this.entities.get(id)
            if (!versions) {
                throw new Error(`${this.entityLabel} "${id}" does not exist.`)
            }
            const maxVersion = this.maxVersion(versions)
            const current = versions.get(maxVersion)!
            if (current.frozen) {
                throw new Error(
                    `${this.entityLabel} "${id}" version ${maxVersion} is already frozen.`
                )
            }
            const frozenEntity = {
                ...current,
                frozen: true,
                checksum: "",
            } as TEntity
            frozenEntity.checksum = this.computeChecksum(frozenEntity)
            versions.set(maxVersion, frozenEntity)

            const nextVersion = maxVersion + 1
            const nextEntity = {
                ...current,
                version: nextVersion,
                frozen: false,
                checksum: "",
            } as TEntity
            nextEntity.checksum = this.computeChecksum(nextEntity)
            versions.set(nextVersion, nextEntity)

            return { frozen: frozenEntity, current: nextEntity }
        })
    }

    /** Returns a specific version of an entity, or `undefined` if not found. */
    public get(id: string, version: number): TEntity | undefined {
        return this.entities.get(id)?.get(version)
    }

    /** Returns the latest (highest-version) entity for the given ID, or `undefined` if not found. */
    public getCurrent(id: string): TEntity | undefined {
        const versions = this.entities.get(id)
        if (!versions) return undefined
        return versions.get(this.maxVersion(versions))
    }

    /** Returns every entity across all IDs and versions. */
    public getAll(): TEntity[] {
        const result: TEntity[] = []
        for (const versions of this.entities.values()) {
            for (const entity of versions.values()) {
                result.push(entity)
            }
        }
        return result
    }

    /** Returns all versions of an entity sorted ascending by version number. */
    public getVersions(id: string): TEntity[] {
        const versions = this.entities.get(id)
        if (!versions) return []
        return Array.from(versions.values()).sort(
            (a, b) => a.version - b.version
        )
    }

    /** Validates all entities against the schema and checks that frozen versions have successors. */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [id, versions] of this.entities) {
            const sortedVersions = [...versions.entries()].sort(
                ([a], [b]) => a - b
            )
            for (const [version, entity] of sortedVersions) {
                if (!Value.Check(this.schema, entity)) {
                    violations.push({
                        code: this.schemaInvalidCode,
                        message: `${this.entityLabel} "${id}" version ${version} does not conform to schema`,
                        entityType: this.entityType,
                        entityId: id,
                    })
                }
                if (entity.frozen) {
                    const maxVer = this.maxVersion(versions)
                    if (version < maxVer && !versions.has(version + 1)) {
                        violations.push({
                            code: this.frozenSuccessorCode,
                            message: `${this.entityLabel} "${id}" version ${version} is frozen but has no successor version`,
                            entityType: this.entityType,
                            entityId: id,
                        })
                    }
                }
            }
        }
        return { ok: violations.length === 0, violations }
    }

    private maxVersion(versions: Map<number, TEntity>): number {
        let max = -1
        for (const v of versions.keys()) {
            if (v > max) max = v
        }
        return max
    }

    private computeChecksum(entity: TEntity): string {
        const fields =
            this.checksumConfig?.[this.checksumFieldsKey] ??
            DEFAULT_CHECKSUM_CONFIG[this.checksumFieldsKey]!
        return entityChecksum(
            entity as unknown as Record<string, unknown>,
            fields
        )
    }
}
