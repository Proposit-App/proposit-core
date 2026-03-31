import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import type { TCoreEntityForkRecord } from "../schemata/fork.js"
import { CoreEntityForkRecordSchema } from "../schemata/fork.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import { FORK_RECORD_SCHEMA_INVALID } from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

/**
 * A keyed collection of fork records for a single entity type.
 * Each record maps a forked entity back to its origin via `entityId → forkId`.
 * Records are schema-validated on mutation; invalid state throws {@link InvariantViolationError}.
 */
export class ForkNamespace<
    T extends TCoreEntityForkRecord = TCoreEntityForkRecord,
> {
    private records: Map<string, T>
    private schema: TSchema

    constructor(schema: TSchema = CoreEntityForkRecordSchema) {
        this.records = new Map()
        this.schema = schema
    }

    private restoreFromRecords(records: Map<string, T>): void {
        this.records = new Map(records)
    }

    private withValidation<R>(fn: () => R): R {
        const snap = new Map(this.records)
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.restoreFromRecords(snap)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromRecords(snap)
            }
            throw e
        }
    }

    /** Registers a fork record. Throws if the `entityId` already exists. */
    public create(record: T): T {
        return this.withValidation(() => {
            if (this.records.has(record.entityId)) {
                throw new Error(
                    `ForkRecord with entityId "${record.entityId}" already exists.`
                )
            }
            this.records.set(record.entityId, record)
            return record
        })
    }

    /** Returns the fork record for the given entity ID, or `undefined`. */
    public get(entityId: string): T | undefined {
        return this.records.get(entityId)
    }

    /** Returns all fork records in this namespace. */
    public getAll(): T[] {
        return Array.from(this.records.values())
    }

    /** Returns all records that share the given origin `forkId`. */
    public getByForkId(forkId: string): T[] {
        return Array.from(this.records.values()).filter(
            (r) => r.forkId === forkId
        )
    }

    /** Removes and returns the fork record for the given entity ID. Throws if not found. */
    public remove(entityId: string): T {
        return this.withValidation(() => {
            const record = this.records.get(entityId)
            if (!record) {
                throw new Error(
                    `ForkRecord with entityId "${entityId}" not found.`
                )
            }
            this.records.delete(entityId)
            return record
        })
    }

    /** Returns a serializable snapshot of all records. */
    public snapshot(): T[] {
        return Array.from(this.records.values())
    }

    /** Restores a namespace from a previously captured snapshot. */
    public static fromSnapshot<
        T extends TCoreEntityForkRecord = TCoreEntityForkRecord,
    >(records: T[], schema?: TSchema): ForkNamespace<T> {
        const ns = new ForkNamespace<T>(schema ?? CoreEntityForkRecordSchema)
        for (const record of records) {
            ns.records.set(record.entityId, record)
        }
        return ns
    }

    /** Validates every record against the namespace's schema. */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [entityId, record] of this.records) {
            if (!Value.Check(this.schema, record)) {
                violations.push({
                    code: FORK_RECORD_SCHEMA_INVALID,
                    message: `ForkRecord "${entityId}" does not conform to schema`,
                    entityType: "forkRecord",
                    entityId,
                })
            }
        }
        return { ok: violations.length === 0, violations }
    }
}
