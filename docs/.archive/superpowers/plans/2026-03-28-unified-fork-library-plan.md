# Unified ForkLibrary & PropositCore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ForksLibrary with unified ForkLibrary (namespaced entity fork records), introduce ArgumentLibrary and PropositCore orchestrator, remove inline fork fields from entity schemas.

**Architecture:** New `PropositCore` class composes `ArgumentLibrary`, `ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary`, and `ForkLibrary`. Fork provenance moves from entity-level fields to `ForkLibrary` namespaces. `PropositCore.forkArgument()` orchestrates cross-library forking including claim/source cloning. `PropositCore.diffArguments()` provides fork-aware diffing.

**Tech Stack:** TypeScript, Typebox schemas, Vitest tests

**Spec:** `docs/superpowers/specs/2026-03-28-unified-fork-library-design.md`

---

### Task 1: Fork Record Schemas

**Files:**

- Modify: `src/lib/schemata/fork.ts`
- Modify: `test/core.test.ts`

Replace the existing `CoreForkSchema`/`TCoreFork` with the new entity fork record schemas. The old `TCoreFork` had fields `id`, `sourceArgumentId`, `sourceArgumentVersion`, `createdOn`, `creatorId?`, `checksum`. The new base `TCoreEntityForkRecord` has fields `entityId`, `forkedFromEntityId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`. No checksum — fork records are immutable.

- [ ] **Step 1: Write failing tests for the new fork record schemas**

Add a new describe block at the bottom of `test/core.test.ts`:

```typescript
describe("ForkRecordSchemas", () => {
    describe("CoreEntityForkRecordSchema", () => {
        it("should accept a valid entity fork record", () => {
            const record = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 3,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(true)
        })

        it("should reject a record missing required fields", () => {
            const record = {
                entityId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(false)
        })

        it("should accept additional properties", () => {
            const record = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
                customField: "hello",
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(true)
        })
    })

    describe("CoreExpressionForkRecordSchema", () => {
        it("should require forkedFromPremiseId", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreExpressionForkRecordSchema, base)).toBe(
                false
            )

            const withPremise = {
                ...base,
                forkedFromPremiseId: crypto.randomUUID(),
            }
            expect(
                Value.Check(CoreExpressionForkRecordSchema, withPremise)
            ).toBe(true)
        })
    })

    describe("CoreClaimForkRecordSchema", () => {
        it("should require forkedFromEntityVersion", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreClaimForkRecordSchema, base)).toBe(false)

            const withVersion = { ...base, forkedFromEntityVersion: 2 }
            expect(Value.Check(CoreClaimForkRecordSchema, withVersion)).toBe(
                true
            )
        })
    })

    describe("CoreSourceForkRecordSchema", () => {
        it("should require forkedFromEntityVersion", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreSourceForkRecordSchema, base)).toBe(false)

            const withVersion = { ...base, forkedFromEntityVersion: 1 }
            expect(Value.Check(CoreSourceForkRecordSchema, withVersion)).toBe(
                true
            )
        })
    })
})
```

Import `CoreEntityForkRecordSchema`, `CoreExpressionForkRecordSchema`, `CoreClaimForkRecordSchema`, `CoreSourceForkRecordSchema` from `"../src/lib/index.js"` at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ForkRecordSchemas"`
Expected: FAIL �� the new schemas don't exist yet.

- [ ] **Step 3: Implement the new fork record schemas**

Replace the contents of `src/lib/schemata/fork.ts` with:

```typescript
import { Type, type Static } from "typebox"
import { UUID } from "./shared.js"

/**
 * Base schema shared by all entity fork records. Each record tracks that
 * a specific entity was created as part of a fork operation.
 *
 * No checksum field — fork records are immutable after creation.
 */
export const CoreEntityForkRecordSchema = Type.Object(
    {
        entityId: UUID,
        forkedFromEntityId: UUID,
        forkedFromArgumentId: UUID,
        forkedFromArgumentVersion: Type.Number({
            minimum: 0,
            description: "Version of the original argument at fork time",
        }),
        forkId: UUID,
    },
    { additionalProperties: true }
)

export type TCoreEntityForkRecord = Static<typeof CoreEntityForkRecordSchema>

/** Argument fork record. Identical to base — the record whose forkId other records reference. */
export const CoreArgumentForkRecordSchema = CoreEntityForkRecordSchema
export type TCoreArgumentForkRecord = TCoreEntityForkRecord

/** Premise fork record. Identical to base. */
export const CorePremiseForkRecordSchema = CoreEntityForkRecordSchema
export type TCorePremiseForkRecord = TCoreEntityForkRecord

/** Expression fork record. Adds source premise reference. */
export const CoreExpressionForkRecordSchema = Type.Intersect(
    [
        CoreEntityForkRecordSchema,
        Type.Object({
            forkedFromPremiseId: UUID,
        }),
    ],
    { additionalProperties: true }
)
export type TCoreExpressionForkRecord = Static<
    typeof CoreExpressionForkRecordSchema
>

/** Variable fork record. Identical to base. */
export const CoreVariableForkRecordSchema = CoreEntityForkRecordSchema
export type TCoreVariableForkRecord = TCoreEntityForkRecord

/** Claim fork record. Adds version tracking for independently versioned claims. */
export const CoreClaimForkRecordSchema = Type.Intersect(
    [
        CoreEntityForkRecordSchema,
        Type.Object({
            forkedFromEntityVersion: Type.Number({
                minimum: 0,
                description: "Claim version that was cloned",
            }),
        }),
    ],
    { additionalProperties: true }
)
export type TCoreClaimForkRecord = Static<typeof CoreClaimForkRecordSchema>

/** Source fork record. Adds version tracking for independently versioned sources. */
export const CoreSourceForkRecordSchema = Type.Intersect(
    [
        CoreEntityForkRecordSchema,
        Type.Object({
            forkedFromEntityVersion: Type.Number({
                minimum: 0,
                description: "Source version that was cloned",
            }),
        }),
    ],
    { additionalProperties: true }
)
export type TCoreSourceForkRecord = Static<typeof CoreSourceForkRecordSchema>
```

Keep the old `CoreForkSchema`/`TCoreFork` exports temporarily — they'll be removed in Task 9 when ForksLibrary is deleted.

- [ ] **Step 4: Export the new schemas from `src/lib/schemata/index.ts`**

The barrel `export * from "./fork.js"` already covers everything since we're adding to the same file. No changes needed to `src/lib/schemata/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ForkRecordSchemas"`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemata/fork.ts test/core.test.ts
git commit -m "feat: add entity fork record schemas"
```

---

### Task 2: ForkNamespace Class

**Files:**

- Create: `src/lib/core/fork-namespace.ts`
- Modify: `src/lib/types/validation.ts`
- Modify: `test/core.test.ts`

Standalone class managing fork records for one entity type. Keyed by `entityId`. CRUD + snapshot + schema-only validation.

- [ ] **Step 1: Add validation code for fork namespace**

Add to `src/lib/types/validation.ts`:

```typescript
export const FORK_RECORD_SCHEMA_INVALID = "FORK_RECORD_SCHEMA_INVALID"
```

Add `"forkRecord"` to the `TInvariantViolationEntityType` union.

- [ ] **Step 2: Write failing tests**

Add a new describe block in `test/core.test.ts`:

```typescript
describe("ForkNamespace", () => {
    const makeRecord = (
        overrides: Partial<TCoreEntityForkRecord> = {}
    ): TCoreEntityForkRecord => ({
        entityId: crypto.randomUUID(),
        forkedFromEntityId: crypto.randomUUID(),
        forkedFromArgumentId: crypto.randomUUID(),
        forkedFromArgumentVersion: 0,
        forkId: crypto.randomUUID(),
        ...overrides,
    })

    describe("create", () => {
        it("should store and return the record", () => {
            const ns = new ForkNamespace()
            const record = makeRecord()
            const result = ns.create(record)
            expect(result).toEqual(record)
            expect(ns.get(record.entityId)).toEqual(record)
        })

        it("should throw on duplicate entityId", () => {
            const ns = new ForkNamespace()
            const record = makeRecord()
            ns.create(record)
            expect(() => ns.create(record)).toThrow(/already exists/)
        })
    })

    describe("get", () => {
        it("should return undefined for missing entityId", () => {
            const ns = new ForkNamespace()
            expect(ns.get("nonexistent")).toBeUndefined()
        })
    })

    describe("getAll", () => {
        it("should return all records", () => {
            const ns = new ForkNamespace()
            const r1 = ns.create(makeRecord())
            const r2 = ns.create(makeRecord())
            expect(ns.getAll()).toEqual(expect.arrayContaining([r1, r2]))
            expect(ns.getAll()).toHaveLength(2)
        })
    })

    describe("getByForkId", () => {
        it("should return records matching the forkId", () => {
            const ns = new ForkNamespace()
            const forkId = crypto.randomUUID()
            const r1 = ns.create(makeRecord({ forkId }))
            const r2 = ns.create(makeRecord({ forkId }))
            ns.create(makeRecord({ forkId: crypto.randomUUID() }))

            const results = ns.getByForkId(forkId)
            expect(results).toHaveLength(2)
            expect(results).toEqual(expect.arrayContaining([r1, r2]))
        })

        it("should return empty array for unknown forkId", () => {
            const ns = new ForkNamespace()
            expect(ns.getByForkId("nonexistent")).toEqual([])
        })
    })

    describe("remove", () => {
        it("should remove and return the record", () => {
            const ns = new ForkNamespace()
            const record = ns.create(makeRecord())
            const removed = ns.remove(record.entityId)
            expect(removed).toEqual(record)
            expect(ns.get(record.entityId)).toBeUndefined()
        })

        it("should throw if entityId not found", () => {
            const ns = new ForkNamespace()
            expect(() => ns.remove("nonexistent")).toThrow(/not found/)
        })
    })

    describe("snapshot / fromSnapshot", () => {
        it("should round-trip all records", () => {
            const ns = new ForkNamespace()
            const r1 = ns.create(makeRecord())
            const r2 = ns.create(makeRecord())

            const snap = ns.snapshot()
            const restored = ForkNamespace.fromSnapshot(snap)

            expect(restored.getAll()).toEqual(expect.arrayContaining([r1, r2]))
            expect(restored.getAll()).toHaveLength(2)
        })
    })

    describe("validate", () => {
        it("should return ok for valid records", () => {
            const ns = new ForkNamespace()
            ns.create(makeRecord())
            const result = ns.validate()
            expect(result.ok).toBe(true)
        })
    })
})
```

Import `ForkNamespace` and `TCoreEntityForkRecord` from `"../src/lib/index.js"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ForkNamespace"`
Expected: FAIL — ForkNamespace doesn't exist yet.

- [ ] **Step 4: Implement ForkNamespace**

Create `src/lib/core/fork-namespace.ts`:

```typescript
import { Value } from "typebox/value"
import type { TCoreEntityForkRecord } from "../schemata/fork.js"
import { CoreEntityForkRecordSchema } from "../schemata/fork.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import { FORK_RECORD_SCHEMA_INVALID } from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"
import type { TStaticLike } from "typebox"

/**
 * Manages fork records for one entity type. Each record tracks that a
 * specific entity was created as part of a fork operation.
 *
 * Records are keyed by `entityId` — each forked entity appears at most
 * once per namespace. Records are immutable after creation (create/delete
 * only, no update path).
 */
export class ForkNamespace<
    T extends TCoreEntityForkRecord = TCoreEntityForkRecord,
> {
    private records: Map<string, T>
    private schema: TStaticLike

    constructor(schema: TStaticLike = CoreEntityForkRecordSchema) {
        this.records = new Map()
        this.schema = schema
    }

    private restoreFromSnapshot(snap: T[]): void {
        this.records = new Map()
        for (const record of snap) {
            this.records.set(record.entityId, record)
        }
    }

    private withValidation<R>(fn: () => R): R {
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

    /**
     * Stores a fork record. Throws if a record with the same `entityId`
     * already exists.
     */
    public create(record: T): T {
        return this.withValidation(() => {
            if (this.records.has(record.entityId)) {
                throw new Error(
                    `Fork record for entity "${record.entityId}" already exists.`
                )
            }
            this.records.set(record.entityId, record)
            return record
        })
    }

    /** Returns the fork record for a forked entity, or `undefined`. */
    public get(entityId: string): T | undefined {
        return this.records.get(entityId)
    }

    /** Returns all records in the namespace. */
    public getAll(): T[] {
        return Array.from(this.records.values())
    }

    /** Returns all records from one fork operation (matching `forkId`). */
    public getByForkId(forkId: string): T[] {
        return this.getAll().filter((r) => r.forkId === forkId)
    }

    /**
     * Removes a fork record by entity ID. Throws if not found.
     * Returns the removed record.
     */
    public remove(entityId: string): T {
        return this.withValidation(() => {
            const record = this.records.get(entityId)
            if (!record) {
                throw new Error(
                    `Fork record for entity "${entityId}" not found.`
                )
            }
            this.records.delete(entityId)
            return record
        })
    }

    /** Returns all records as a serializable array. */
    public snapshot(): T[] {
        return this.getAll()
    }

    /** Reconstructs a namespace from a snapshot array. */
    public static fromSnapshot<T extends TCoreEntityForkRecord>(
        records: T[],
        schema: TStaticLike = CoreEntityForkRecordSchema
    ): ForkNamespace<T> {
        const ns = new ForkNamespace<T>(schema)
        for (const record of records) {
            ns.records.set(record.entityId, record)
        }
        return ns
    }

    /** Schema-only validation of all records. */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [entityId, record] of this.records) {
            if (!Value.Check(this.schema, record)) {
                violations.push({
                    code: FORK_RECORD_SCHEMA_INVALID,
                    message: `Fork record for entity "${entityId}" does not conform to schema`,
                    entityType: "forkRecord",
                    entityId,
                })
            }
        }
        return { ok: violations.length === 0, violations }
    }
}
```

- [ ] **Step 5: Export ForkNamespace from `src/lib/index.ts`**

Add to `src/lib/index.ts`:

```typescript
export { ForkNamespace } from "./core/fork-namespace.js"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ForkNamespace"`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/fork-namespace.ts src/lib/types/validation.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add ForkNamespace class"
```

---

### Task 3: ForkLibrary Class

**Files:**

- Create: `src/lib/core/fork-library.ts`
- Modify: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`
- Modify: `src/lib/index.ts`
- Modify: `test/core.test.ts`

Composes six `ForkNamespace` instances. Pure record store with snapshot/validate.

- [ ] **Step 1: Add `TForkLibrarySnapshot` to library interfaces**

Add to `src/lib/core/interfaces/library.interfaces.ts`:

```typescript
import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
    TCoreSourceForkRecord,
} from "../../schemata/fork.js"

/**
 * Serializable snapshot of a `ForkLibrary`. Contains all six namespace arrays.
 */
export type TForkLibrarySnapshot<
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
> = {
    arguments: TArgFork[]
    premises: TPremiseFork[]
    expressions: TExprFork[]
    variables: TVarFork[]
    claims: TClaimFork[]
    sources: TSourceFork[]
}
```

Export `TForkLibrarySnapshot` from `src/lib/core/interfaces/index.ts`.

- [ ] **Step 2: Write failing tests**

Add to `test/core.test.ts`:

```typescript
describe("ForkLibrary", () => {
    const makeBaseRecord = (
        overrides: Partial<TCoreEntityForkRecord> = {}
    ): TCoreEntityForkRecord => ({
        entityId: crypto.randomUUID(),
        forkedFromEntityId: crypto.randomUUID(),
        forkedFromArgumentId: crypto.randomUUID(),
        forkedFromArgumentVersion: 0,
        forkId: crypto.randomUUID(),
        ...overrides,
    })

    it("should expose six namespaces", () => {
        const lib = new ForkLibrary()
        expect(lib.arguments).toBeInstanceOf(ForkNamespace)
        expect(lib.premises).toBeInstanceOf(ForkNamespace)
        expect(lib.expressions).toBeInstanceOf(ForkNamespace)
        expect(lib.variables).toBeInstanceOf(ForkNamespace)
        expect(lib.claims).toBeInstanceOf(ForkNamespace)
        expect(lib.sources).toBeInstanceOf(ForkNamespace)
    })

    it("should round-trip all namespaces via snapshot/fromSnapshot", () => {
        const lib = new ForkLibrary()
        const forkId = crypto.randomUUID()
        const argRecord = lib.arguments.create(makeBaseRecord({ forkId }))
        const premRecord = lib.premises.create(makeBaseRecord({ forkId }))
        const exprRecord = lib.expressions.create({
            ...makeBaseRecord({ forkId }),
            forkedFromPremiseId: crypto.randomUUID(),
        } as TCoreExpressionForkRecord)
        const varRecord = lib.variables.create(makeBaseRecord({ forkId }))
        const claimRecord = lib.claims.create({
            ...makeBaseRecord({ forkId }),
            forkedFromEntityVersion: 2,
        } as TCoreClaimForkRecord)
        const sourceRecord = lib.sources.create({
            ...makeBaseRecord({ forkId }),
            forkedFromEntityVersion: 1,
        } as TCoreSourceForkRecord)

        const snap = lib.snapshot()
        const restored = ForkLibrary.fromSnapshot(snap)

        expect(restored.arguments.get(argRecord.entityId)).toEqual(argRecord)
        expect(restored.premises.get(premRecord.entityId)).toEqual(premRecord)
        expect(restored.expressions.get(exprRecord.entityId)).toEqual(
            exprRecord
        )
        expect(restored.variables.get(varRecord.entityId)).toEqual(varRecord)
        expect(restored.claims.get(claimRecord.entityId)).toEqual(claimRecord)
        expect(restored.sources.get(sourceRecord.entityId)).toEqual(
            sourceRecord
        )
    })

    it("should merge validation results from all namespaces", () => {
        const lib = new ForkLibrary()
        lib.arguments.create(makeBaseRecord())
        const result = lib.validate()
        expect(result.ok).toBe(true)
    })
})
```

Import `ForkLibrary`, `ForkNamespace`, `TCoreExpressionForkRecord`, `TCoreClaimForkRecord`, `TCoreSourceForkRecord` from `"../src/lib/index.js"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ForkLibrary"`
Expected: FAIL — ForkLibrary doesn't exist yet.

- [ ] **Step 4: Implement ForkLibrary**

Create `src/lib/core/fork-library.ts`:

```typescript
import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
    TCoreSourceForkRecord,
} from "../schemata/fork.js"
import {
    CoreEntityForkRecordSchema,
    CoreExpressionForkRecordSchema,
    CoreClaimForkRecordSchema,
    CoreSourceForkRecordSchema,
} from "../schemata/fork.js"
import { ForkNamespace } from "./fork-namespace.js"
import type { TForkLibrarySnapshot } from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"

/**
 * Composes six `ForkNamespace` instances — one per entity type.
 * Pure record store with no orchestration logic.
 */
export class ForkLibrary<
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
> {
    public arguments: ForkNamespace<TArgFork>
    public premises: ForkNamespace<TPremiseFork>
    public expressions: ForkNamespace<TExprFork>
    public variables: ForkNamespace<TVarFork>
    public claims: ForkNamespace<TClaimFork>
    public sources: ForkNamespace<TSourceFork>

    constructor() {
        this.arguments = new ForkNamespace<TArgFork>(CoreEntityForkRecordSchema)
        this.premises = new ForkNamespace<TPremiseFork>(
            CoreEntityForkRecordSchema
        )
        this.expressions = new ForkNamespace<TExprFork>(
            CoreExpressionForkRecordSchema
        )
        this.variables = new ForkNamespace<TVarFork>(CoreEntityForkRecordSchema)
        this.claims = new ForkNamespace<TClaimFork>(CoreClaimForkRecordSchema)
        this.sources = new ForkNamespace<TSourceFork>(
            CoreSourceForkRecordSchema
        )
    }

    /** Returns all six namespace arrays as a serializable snapshot. */
    public snapshot(): TForkLibrarySnapshot<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    > {
        return {
            arguments: this.arguments.snapshot(),
            premises: this.premises.snapshot(),
            expressions: this.expressions.snapshot(),
            variables: this.variables.snapshot(),
            claims: this.claims.snapshot(),
            sources: this.sources.snapshot(),
        }
    }

    /** Reconstructs a ForkLibrary from a snapshot. */
    public static fromSnapshot<
        TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
        TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
        TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
        TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
        TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
        TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
    >(
        snapshot: TForkLibrarySnapshot<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >
    ): ForkLibrary<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    > {
        const lib = new ForkLibrary<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >()
        lib.arguments = ForkNamespace.fromSnapshot(
            snapshot.arguments,
            CoreEntityForkRecordSchema
        )
        lib.premises = ForkNamespace.fromSnapshot(
            snapshot.premises,
            CoreEntityForkRecordSchema
        )
        lib.expressions = ForkNamespace.fromSnapshot(
            snapshot.expressions,
            CoreExpressionForkRecordSchema
        )
        lib.variables = ForkNamespace.fromSnapshot(
            snapshot.variables,
            CoreEntityForkRecordSchema
        )
        lib.claims = ForkNamespace.fromSnapshot(
            snapshot.claims,
            CoreClaimForkRecordSchema
        )
        lib.sources = ForkNamespace.fromSnapshot(
            snapshot.sources,
            CoreSourceForkRecordSchema
        )
        return lib
    }

    /** Delegates to each namespace, merges results. */
    public validate(): TInvariantValidationResult {
        const allViolations: TInvariantViolation[] = []
        for (const ns of [
            this.arguments,
            this.premises,
            this.expressions,
            this.variables,
            this.claims,
            this.sources,
        ]) {
            const result = ns.validate()
            allViolations.push(...result.violations)
        }
        return { ok: allViolations.length === 0, violations: allViolations }
    }
}
```

- [ ] **Step 5: Export ForkLibrary**

Add to `src/lib/index.ts`:

```typescript
export { ForkLibrary } from "./core/fork-library.js"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ForkLibrary"`
Expected: PASS

- [ ] **Step 7: Run full test suite and commit**

Run: `pnpm vitest run`
Expected: All tests pass.

```bash
git add src/lib/core/fork-library.ts src/lib/core/interfaces/library.interfaces.ts src/lib/core/interfaces/index.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add ForkLibrary class with six namespaces"
```

---

### Task 4: ArgumentLibrary Class

**Files:**

- Create: `src/lib/core/argument-library.ts`
- Modify: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`
- Modify: `src/lib/index.ts`
- Modify: `test/core.test.ts`

Engine registry with lifecycle management. Stores `ArgumentEngine` instances keyed by argument ID.

- [ ] **Step 1: Add `TArgumentLibrarySnapshot` to library interfaces**

Add to `src/lib/core/interfaces/library.interfaces.ts`:

```typescript
import type { TArgumentEngineSnapshot } from "../argument-engine.js"

/**
 * Serializable snapshot of an `ArgumentLibrary`. Contains engine snapshots
 * for all managed arguments.
 */
export type TArgumentLibrarySnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    arguments: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>[]
}
```

Add the necessary schema imports. Export from `interfaces/index.ts`.

- [ ] **Step 2: Write failing tests**

Add to `test/core.test.ts`:

```typescript
describe("ArgumentLibrary", () => {
    const makeArgument = (): TCoreArgument => ({
        id: crypto.randomUUID(),
        version: 0,
    })

    const makeLibraries = () => {
        const claimLibrary = new ClaimLibrary()
        const sourceLibrary = new SourceLibrary()
        const claimSourceLibrary = new ClaimSourceLibrary(
            claimLibrary,
            sourceLibrary
        )
        return { claimLibrary, sourceLibrary, claimSourceLibrary }
    }

    it("should create and retrieve an engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = argLib.create(arg)

        expect(engine).toBeInstanceOf(ArgumentEngine)
        expect(engine.getArgument().id).toBe(arg.id)
        expect(argLib.get(arg.id)).toBe(engine)
    })

    it("should throw on duplicate argument ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)
        expect(() => argLib.create(arg)).toThrow(/already exists/)
    })

    it("should list all engines", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        argLib.create(makeArgument())
        argLib.create(makeArgument())
        expect(argLib.getAll()).toHaveLength(2)
    })

    it("should remove and return an engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = argLib.create(arg)
        const removed = argLib.remove(arg.id)

        expect(removed).toBe(engine)
        expect(argLib.get(arg.id)).toBeUndefined()
    })

    it("should throw when removing nonexistent ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        expect(() => argLib.remove("nonexistent")).toThrow(/not found/)
    })

    it("should round-trip via snapshot/fromSnapshot", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)

        const snap = argLib.snapshot()
        const restored = ArgumentLibrary.fromSnapshot(snap, libs)

        expect(restored.get(arg.id)).toBeDefined()
        expect(restored.get(arg.id)!.getArgument().id).toBe(arg.id)
    })
})
```

Import `ArgumentLibrary` from `"../src/lib/index.js"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentLibrary"`
Expected: FAIL.

- [ ] **Step 4: Implement ArgumentLibrary**

Create `src/lib/core/argument-library.ts`:

```typescript
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type {
    TCoreSource,
    TCoreClaimSourceAssociation,
} from "../schemata/source.js"
import type { TArgumentEngineOptions } from "../types/engine.js"
import { ArgumentEngine } from "./argument-engine.js"
import type { TArgumentEngineSnapshot } from "./argument-engine.js"
import type { ClaimLibrary } from "./claim-library.js"
import type { SourceLibrary } from "./source-library.js"
import type { ClaimSourceLibrary } from "./claim-source-library.js"
import type { TArgumentLibrarySnapshot } from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"

/**
 * Engine registry with lifecycle management. Stores `ArgumentEngine`
 * instances keyed by argument ID. Creating an engine goes through the
 * library, which wires in the shared claim, source, and claim-source
 * libraries.
 */
export class ArgumentLibrary<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    private engines: Map<
        string,
        ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    >
    private libraries: {
        claimLibrary: ClaimLibrary<TClaim>
        sourceLibrary: SourceLibrary<TSource>
        claimSourceLibrary: ClaimSourceLibrary<TAssoc>
    }
    private engineOptions?: TArgumentEngineOptions

    constructor(
        libraries: {
            claimLibrary: ClaimLibrary<TClaim>
            sourceLibrary: SourceLibrary<TSource>
            claimSourceLibrary: ClaimSourceLibrary<TAssoc>
        },
        options?: TArgumentEngineOptions
    ) {
        this.engines = new Map()
        this.libraries = libraries
        this.engineOptions = options
    }

    /**
     * Constructs an engine with shared libraries and stores it.
     * Throws if an engine with the same argument ID already exists.
     */
    public create(
        argument: TArg
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        if (this.engines.has(argument.id)) {
            throw new Error(
                `Argument with ID "${argument.id}" already exists in the library.`
            )
        }
        const engine = new ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            argument,
            this.libraries.claimLibrary,
            this.libraries.sourceLibrary,
            this.libraries.claimSourceLibrary,
            this.engineOptions
        )
        this.engines.set(argument.id, engine)
        return engine
    }

    /** Retrieves an engine by argument ID, or `undefined`. */
    public get(
        argumentId: string
    ):
        | ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
        | undefined {
        return this.engines.get(argumentId)
    }

    /** Returns all engines. */
    public getAll(): ArgumentEngine<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >[] {
        return Array.from(this.engines.values())
    }

    /**
     * Removes and returns an engine. Throws if not found.
     */
    public remove(
        argumentId: string
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        const engine = this.engines.get(argumentId)
        if (!engine) {
            throw new Error(
                `Argument "${argumentId}" not found in the library.`
            )
        }
        this.engines.delete(argumentId)
        return engine
    }

    /** Snapshots all engines. */
    public snapshot(): TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar> {
        return {
            arguments: this.getAll().map((e) => e.snapshot()),
        }
    }

    /** Restores all engines from a snapshot. */
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TSource extends TCoreSource = TCoreSource,
        TClaim extends TCoreClaim = TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation =
            TCoreClaimSourceAssociation,
    >(
        snapshot: TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar>,
        libraries: {
            claimLibrary: ClaimLibrary<TClaim>
            sourceLibrary: SourceLibrary<TSource>
            claimSourceLibrary: ClaimSourceLibrary<TAssoc>
        },
        options?: TArgumentEngineOptions
    ): ArgumentLibrary<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        const lib = new ArgumentLibrary<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(libraries, options)
        for (const engineSnap of snapshot.arguments) {
            const engine = ArgumentEngine.fromSnapshot<
                TArg,
                TPremise,
                TExpr,
                TVar,
                TSource,
                TClaim,
                TAssoc
            >(
                engineSnap,
                libraries.claimLibrary,
                libraries.sourceLibrary,
                libraries.claimSourceLibrary,
                engineSnap.config?.grammarConfig,
                "ignore"
            )
            lib.engines.set(engine.getArgument().id, engine)
        }
        return lib
    }

    /** Validates all engines, merges results. */
    public validate(): TInvariantValidationResult {
        const allViolations: TInvariantViolation[] = []
        for (const engine of this.engines.values()) {
            const result = engine.validate()
            allViolations.push(...result.violations)
        }
        return { ok: allViolations.length === 0, violations: allViolations }
    }

    /**
     * Registers a pre-constructed engine. Used internally by PropositCore
     * during forking when the engine is built by forkArgumentEngine().
     */
    public register(
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >
    ): void {
        const id = engine.getArgument().id
        if (this.engines.has(id)) {
            throw new Error(
                `Argument with ID "${id}" already exists in the library.`
            )
        }
        this.engines.set(id, engine)
    }
}
```

- [ ] **Step 5: Export ArgumentLibrary**

Add to `src/lib/index.ts`:

```typescript
export { ArgumentLibrary } from "./core/argument-library.js"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentLibrary"`
Expected: PASS

- [ ] **Step 7: Run full test suite and commit**

Run: `pnpm vitest run`

```bash
git add src/lib/core/argument-library.ts src/lib/core/interfaces/library.interfaces.ts src/lib/core/interfaces/index.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add ArgumentLibrary engine registry"
```

---

### Task 5: PropositCore — Construction & State

**Files:**

- Create: `src/lib/core/proposit-core.ts`
- Modify: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`
- Modify: `src/lib/index.ts`
- Modify: `test/core.test.ts`

Top-level orchestrator. This task covers constructor, properties, snapshot/fromSnapshot, validate. Cross-library operations (forkArgument, diffArguments) are added in subsequent tasks.

- [ ] **Step 1: Add `TPropositCoreSnapshot` to library interfaces**

Add to `src/lib/core/interfaces/library.interfaces.ts` the `TPropositCoreSnapshot` type with all 13 generic parameters and the 5 library snapshot fields (`arguments`, `claims`, `sources`, `claimSources`, `forks`). Also add `TPropositCoreOptions` type with optional fields: `checksumConfig`, `positionConfig`, `grammarConfig`, and optional pre-constructed library instances.

Export both from `interfaces/index.ts`.

- [ ] **Step 2: Write failing tests**

Add to `test/core.test.ts`:

```typescript
describe("PropositCore", () => {
    it("should construct with default libraries", () => {
        const core = new PropositCore()
        expect(core.arguments).toBeInstanceOf(ArgumentLibrary)
        expect(core.claims).toBeInstanceOf(ClaimLibrary)
        expect(core.sources).toBeInstanceOf(SourceLibrary)
        expect(core.claimSources).toBeInstanceOf(ClaimSourceLibrary)
        expect(core.forks).toBeInstanceOf(ForkLibrary)
    })

    it("should round-trip via snapshot/fromSnapshot", () => {
        const core = new PropositCore()
        const claim = core.claims.create({ id: crypto.randomUUID() })
        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.claims.get(claim.id, claim.version)).toBeDefined()
        expect(restored.arguments.get(arg.id)).toBeDefined()
    })

    it("should merge validation results from all libraries", () => {
        const core = new PropositCore()
        const result = core.validate()
        expect(result.ok).toBe(true)
    })

    it("should accept pre-constructed libraries", () => {
        const claimLibrary = new ClaimLibrary()
        const sourceLibrary = new SourceLibrary()
        const claimSourceLibrary = new ClaimSourceLibrary(
            claimLibrary,
            sourceLibrary
        )
        const core = new PropositCore({
            claimLibrary,
            sourceLibrary,
            claimSourceLibrary,
        })
        expect(core.claims).toBe(claimLibrary)
        expect(core.sources).toBe(sourceLibrary)
        expect(core.claimSources).toBe(claimSourceLibrary)
    })
})
```

Import `PropositCore` from `"../src/lib/index.js"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "PropositCore"`
Expected: FAIL.

- [ ] **Step 4: Implement PropositCore**

Create `src/lib/core/proposit-core.ts`. The class should:

- Accept `TPropositCoreOptions` in the constructor
- Construct default libraries if not provided (order: claims → sources → claimSources → forks → arguments)
- Expose all libraries as `public` properties (use `protected` backing fields for subclassing)
- Implement `snapshot()` that calls `snapshot()` on each library
- Implement `static fromSnapshot()` that restores in dependency order
- Implement `validate()` that merges all library validation results

All internal state should be `protected` for subclassing.

- [ ] **Step 5: Export PropositCore**

Add to `src/lib/index.ts`:

```typescript
export { PropositCore } from "./core/proposit-core.js"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "PropositCore"`
Expected: PASS

- [ ] **Step 7: Run full test suite and commit**

Run: `pnpm vitest run`

```bash
git add src/lib/core/proposit-core.ts src/lib/core/interfaces/library.interfaces.ts src/lib/core/interfaces/index.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add PropositCore orchestrator with construction and state"
```

---

### Task 6: PropositCore.forkArgument()

**Files:**

- Modify: `src/lib/core/proposit-core.ts`
- Modify: `test/core.test.ts`

The core orchestration method. Clones claims, sources, associations; forks the engine; remaps claim references; creates fork records in all 6 namespaces.

- [ ] **Step 1: Write failing tests**

Add inside the `describe("PropositCore", ...)` block:

```typescript
describe("forkArgument", () => {
    const setupForFork = () => {
        const core = new PropositCore()

        // Create a claim and source
        const claim = core.claims.create({ id: crypto.randomUUID() })
        const frozenResult = core.claims.freeze(claim.id)
        const source = core.sources.create({ id: crypto.randomUUID() })
        const frozenSource = core.sources.freeze(source.id)
        const assoc = core.claimSources.add({
            id: crypto.randomUUID(),
            claimId: frozenResult.frozen.id,
            claimVersion: frozenResult.frozen.version,
            sourceId: frozenSource.frozen.id,
            sourceVersion: frozenSource.frozen.version,
        })

        // Create an argument with a variable referencing the claim
        const arg = { id: crypto.randomUUID(), version: 0 }
        const engine = core.arguments.create(arg)
        const premise = engine.createPremise()
        const variable = engine.addVariable({
            id: crypto.randomUUID(),
            symbol: "P",
            argumentId: arg.id,
            argumentVersion: 0,
            claimId: frozenResult.frozen.id,
            claimVersion: frozenResult.frozen.version,
        })

        return {
            core,
            arg,
            engine,
            claim: frozenResult.frozen,
            source: frozenSource.frozen,
            assoc,
            variable,
            premise,
        }
    }

    it("should fork an argument with cloned claims, sources, and associations", () => {
        const { core, arg } = setupForFork()
        const newArgId = crypto.randomUUID()
        const result = core.forkArgument(arg.id, newArgId)

        // Forked engine registered
        expect(core.arguments.get(newArgId)).toBeDefined()
        expect(result.engine.getArgument().id).toBe(newArgId)

        // Claim remap populated
        expect(result.claimRemap.size).toBe(1)

        // Source remap populated
        expect(result.sourceRemap.size).toBe(1)

        // Fork records in all namespaces
        expect(result.argumentFork).toBeDefined()
        expect(core.forks.arguments.getAll()).toHaveLength(1)
        expect(core.forks.premises.getAll().length).toBeGreaterThan(0)
        expect(core.forks.variables.getAll().length).toBeGreaterThan(0)
        expect(core.forks.claims.getAll()).toHaveLength(1)
        expect(core.forks.sources.getAll()).toHaveLength(1)
    })

    it("should update forked variables to reference cloned claims", () => {
        const { core, arg, claim } = setupForFork()
        const newArgId = crypto.randomUUID()
        const result = core.forkArgument(arg.id, newArgId)

        const forkedVars = result.engine.getVariables()
        expect(forkedVars).toHaveLength(1)
        // Variable should reference the CLONED claim, not the original
        expect(forkedVars[0].claimId).not.toBe(claim.id)
        expect(result.claimRemap.get(claim.id)).toBe(forkedVars[0].claimId)
    })

    it("should throw when canFork returns false", () => {
        const core = new PropositCore()
        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)

        // Override canFork on the engine — use a subclass via snapshot trick
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        // Replace with a no-fork engine
        const engine = core.arguments.remove(arg.id)
        const snap = engine.snapshot()
        const noFork = new NoForkEngine(
            snap.argument,
            core.claims,
            core.sources,
            core.claimSources
        )
        core.arguments.register(noFork)

        expect(() => core.forkArgument(arg.id, crypto.randomUUID())).toThrow(
            /not allowed/
        )
    })

    it("should throw when argument not found", () => {
        const core = new PropositCore()
        expect(() =>
            core.forkArgument("nonexistent", crypto.randomUUID())
        ).toThrow(/not found/)
    })

    it("should create cloned claim-source associations", () => {
        const { core, arg, assoc } = setupForFork()
        const assocsBefore = core.claimSources.getAll().length
        core.forkArgument(arg.id, crypto.randomUUID())
        // Should have the original association plus the cloned one
        expect(core.claimSources.getAll().length).toBe(assocsBefore + 1)
    })

    it("should dedup claims when multiple variables reference the same claim", () => {
        const core = new PropositCore()
        const claim = core.claims.create({ id: crypto.randomUUID() })

        const arg = { id: crypto.randomUUID(), version: 0 }
        const engine = core.arguments.create(arg)
        engine.createPremise()
        engine.addVariable({
            id: crypto.randomUUID(),
            symbol: "P",
            argumentId: arg.id,
            argumentVersion: 0,
            claimId: claim.id,
            claimVersion: claim.version,
        })
        engine.addVariable({
            id: crypto.randomUUID(),
            symbol: "Q",
            argumentId: arg.id,
            argumentVersion: 0,
            claimId: claim.id,
            claimVersion: claim.version,
        })

        const result = core.forkArgument(arg.id, crypto.randomUUID())
        // Only one cloned claim despite two variables referencing it
        expect(result.claimRemap.size).toBe(1)
        // Both forked variables should reference the same cloned claim
        const forkedVars = result.engine.getVariables()
        const claimIds = new Set(forkedVars.map((v) => v.claimId))
        expect(claimIds.size).toBe(1)
    })

    it("should merge extras into fork records", () => {
        const { core, arg } = setupForFork()
        const result = core.forkArgument(arg.id, crypto.randomUUID(), {
            argumentForkExtras: { customTag: "test" },
        })
        expect((result.argumentFork as Record<string, unknown>).customTag).toBe(
            "test"
        )
    })

    it("should be overridable by subclasses", () => {
        let hookCalled = false
        class CustomCore extends PropositCore {
            public override forkArgument(
                ...args: Parameters<PropositCore["forkArgument"]>
            ) {
                hookCalled = true
                return super.forkArgument(...args)
            }
        }
        const core = new CustomCore()
        const claim = core.claims.create({ id: crypto.randomUUID() })
        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)

        core.forkArgument(arg.id, crypto.randomUUID())
        expect(hookCalled).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "forkArgument"`
Expected: FAIL.

- [ ] **Step 3: Implement PropositCore.forkArgument()**

Add the `forkArgument()` method to `src/lib/core/proposit-core.ts`. Follow the 10 steps from the spec:

1. Retrieve source engine from `this.arguments`. Throw if not found.
2. Call `engine.canFork()` — throw if false.
3. Collect all unique claim IDs from variables. For each, read current version from `this.claims`, create clone via `this.claims.create()` with new UUID. Build `claimRemap: Map<string, string>`.
4. For each cloned claim, find associations in `this.claimSources`. Collect unique source IDs. Clone each source via `this.sources.create()`. Build `sourceRemap: Map<string, string>`.
5. For each original association, create new association in `this.claimSources` with new UUID, linking cloned claim (version 0) to cloned source (version 0).
6. Call `forkArgumentEngine(engine, newArgumentId, { claimLibrary: this.claims, sourceLibrary: this.sources, claimSourceLibrary: this.claimSources }, options)`.
7. Snapshot forked engine, update variable `claimId`/`claimVersion` using `claimRemap`, reconstruct engine via `ArgumentEngine.fromSnapshot()`.
8. Register forked engine via `this.arguments.register()`.
9. Create fork records in all 6 namespaces using remap table + claim/source remaps. Merge extras.
10. Return `{ engine, remapTable, claimRemap, sourceRemap, argumentFork }`.

Use `randomUUID()` for new IDs (or `options.generateId` if provided).

Import `forkArgumentEngine` from `"./fork.js"`, `isClaimBound` from `"../schemata/propositional.js"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "forkArgument"`
Expected: PASS

- [ ] **Step 5: Run full test suite and commit**

Run: `pnpm vitest run`

```bash
git add src/lib/core/proposit-core.ts test/core.test.ts
git commit -m "feat: add PropositCore.forkArgument with claim/source cloning"
```

---

### Task 7: PropositCore.diffArguments()

**Files:**

- Modify: `src/lib/core/proposit-core.ts`
- Modify: `test/core.test.ts`

Fork-aware diffing that automatically injects matchers from fork records.

- [ ] **Step 1: Write failing tests**

Add inside `describe("PropositCore", ...)`:

```typescript
describe("diffArguments", () => {
    it("should diff two arguments", () => {
        const core = new PropositCore()
        const arg1 = { id: crypto.randomUUID(), version: 0 }
        const arg2 = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg1)
        core.arguments.create(arg2)

        const diff = core.diffArguments(arg1.id, arg2.id)
        expect(diff).toBeDefined()
        expect(diff.argument).toBeDefined()
    })

    it("should automatically pair forked entities via fork records", () => {
        const core = new PropositCore()

        const claim = core.claims.create({ id: crypto.randomUUID() })
        const arg = { id: crypto.randomUUID(), version: 0 }
        const engine = core.arguments.create(arg)
        const premise = engine.createPremise()
        const variable = engine.addVariable({
            id: crypto.randomUUID(),
            symbol: "P",
            argumentId: arg.id,
            argumentVersion: 0,
            claimId: claim.id,
            claimVersion: claim.version,
        })

        const newArgId = crypto.randomUUID()
        const { engine: forkedEngine } = core.forkArgument(arg.id, newArgId)

        const diff = core.diffArguments(arg.id, newArgId)
        // Premises should be paired (not added/removed), so changed list should contain them
        // The exact diff content depends on the changes — but premises should not appear in added/removed
        expect(diff.premises.added).toHaveLength(0)
        expect(diff.premises.removed).toHaveLength(0)
    })

    it("should allow caller-provided matchers to override", () => {
        const core = new PropositCore()
        const arg1 = { id: crypto.randomUUID(), version: 0 }
        const arg2 = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg1)
        core.arguments.create(arg2)

        const neverMatch = () => false
        const diff = core.diffArguments(arg1.id, arg2.id, {
            premiseMatcher: neverMatch,
        })
        expect(diff).toBeDefined()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "diffArguments"`
Expected: FAIL.

- [ ] **Step 3: Implement PropositCore.diffArguments()**

Add to `src/lib/core/proposit-core.ts`:

```typescript
import { diffArguments as standaloneDiff } from "./diff.js"

public diffArguments(
    argumentIdA: string,
    argumentIdB: string,
    options?: TCoreDiffOptions<TPremise, TExpr, TVar>
): TCoreArgumentDiff<TPremise, TExpr, TVar> {
    const engineA = this.arguments.get(argumentIdA)
    if (!engineA) {
        throw new Error(`Argument "${argumentIdA}" not found.`)
    }
    const engineB = this.arguments.get(argumentIdB)
    if (!engineB) {
        throw new Error(`Argument "${argumentIdB}" not found.`)
    }

    // Build fork-aware matchers from fork records
    const forkPremiseMatcher = (a: TPremise, b: TPremise): boolean => {
        const record = this.forks.premises.get(b.id)
        return record?.forkedFromEntityId === a.id
    }
    const forkVariableMatcher = (a: TVar, b: TVar): boolean => {
        const record = this.forks.variables.get(b.id)
        return record?.forkedFromEntityId === a.id
    }
    const forkExpressionMatcher = (a: TExpr, b: TExpr): boolean => {
        const record = this.forks.expressions.get(b.id)
        return record?.forkedFromEntityId === a.id
    }

    // Caller-provided matchers override fork-aware matchers
    return standaloneDiff(engineA, engineB, {
        ...options,
        premiseMatcher: options?.premiseMatcher ?? forkPremiseMatcher,
        variableMatcher: options?.variableMatcher ?? forkVariableMatcher,
        expressionMatcher: options?.expressionMatcher ?? forkExpressionMatcher,
    })
}
```

Import `TCoreDiffOptions` and `TCoreArgumentDiff` from the diff types.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "diffArguments"`
Expected: PASS

- [ ] **Step 5: Run full test suite and commit**

Run: `pnpm vitest run`

```bash
git add src/lib/core/proposit-core.ts test/core.test.ts
git commit -m "feat: add PropositCore.diffArguments with fork-aware matching"
```

---

### Task 8: Entity Schema & Checksum Cleanup

**Files:**

- Modify: `src/lib/schemata/argument.ts`
- Modify: `src/lib/schemata/propositional.ts`
- Modify: `src/lib/consts.ts`
- Modify: `src/lib/types/checksum.ts`
- Modify: `src/lib/core/fork.ts`
- Modify: `test/core.test.ts`

Remove all `forkedFrom*` and `forkId` fields from entity schemas. Remove fork-related entries from checksum configs. Update `forkArgumentEngine()` to stop setting `forkedFrom*` fields.

- [ ] **Step 1: Remove fork fields from entity schemas**

In `src/lib/schemata/argument.ts`, remove:

- `forkedFromArgumentId: Type.Optional(Nullable(UUID, {...}))`
- `forkedFromArgumentVersion: Type.Optional(Nullable(Type.Number({...})))`
- `forkId: Type.Optional(Nullable(UUID, {...}))`

In `src/lib/schemata/propositional.ts`, remove from `BasePropositionalExpressionSchema`:

- `forkedFromExpressionId`, `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`

Remove from `CoreVariableBaseFields`:

- `forkedFromVariableId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`

Remove from `CorePremiseSchema`:

- `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`

- [ ] **Step 2: Remove fork fields from checksum config**

In `src/lib/consts.ts` `DEFAULT_CHECKSUM_CONFIG`:

- From `expressionFields`: remove `"forkedFromExpressionId"`, `"forkedFromPremiseId"`, `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`, `"forkId"`
- From `variableFields`: remove `"forkedFromVariableId"`, `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`, `"forkId"`
- From `premiseFields`: remove `"forkedFromPremiseId"`, `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`, `"forkId"`
- From `argumentFields`: remove `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`, `"forkId"`
- Remove the entire `forkFields` entry

In `normalizeChecksumConfig()`, `serializeChecksumConfig()`, and `createChecksumConfig()`: remove all references to `forkFields`.

In `src/lib/types/checksum.ts` `TCoreChecksumConfig`: remove the `forkFields?: Set<string>` property.

- [ ] **Step 3: Update forkArgumentEngine()**

In `src/lib/core/fork.ts`, remove all lines that set `forkedFrom*` fields on entities:

- Remove `forkedFromArgumentId` and `forkedFromArgumentVersion` from the argument remap block
- Remove `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion` from the premise remap block
- Remove `forkedFromExpressionId`, `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion` from the expression remap block
- Remove `forkedFromVariableId`, `forkedFromArgumentId`, `forkedFromArgumentVersion` from the variable remap block

The function should now only remap IDs and internal cross-references (id, argumentId, argumentVersion, premiseId, parentId, variableId, boundPremiseId, boundArgumentId, etc.).

- [ ] **Step 4: Update existing tests**

Search `test/core.test.ts` for all references to `forkedFrom`, `forkId`, and `forkFields`. Update or remove tests that:

- Check for `forkedFrom*` fields on forked entities
- Check for `forkId` on forked entities
- Verify `forkId` or `forkedFrom*` in checksum config field sets
- Verify checksum values that include fork fields (checksums will change)

The existing ForksLibrary tests will be removed entirely in Task 9. For now, they may fail — that's expected.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run`

Fix any remaining test failures related to checksum changes or removed fields. Entity checksums will compute differently now that fork fields are excluded — update any hardcoded checksum expectations.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemata/argument.ts src/lib/schemata/propositional.ts src/lib/consts.ts src/lib/types/checksum.ts src/lib/core/fork.ts test/core.test.ts
git commit -m "feat: remove inline fork fields from entity schemas and checksum configs"
```

---

### Task 9: Remove Old Code & Update Exports

**Files:**

- Delete: `src/lib/core/forks-library.ts`
- Modify: `src/lib/core/diff.ts`
- Modify: `src/lib/schemata/fork.ts`
- Modify: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`
- Modify: `src/lib/index.ts`
- Modify: `test/core.test.ts`

Remove `ForksLibrary`, `createForkedFromMatcher`, old fork types/schemas, and update all exports.

- [ ] **Step 1: Delete ForksLibrary**

Delete the file `src/lib/core/forks-library.ts`.

- [ ] **Step 2: Remove createForkedFromMatcher from diff.ts**

In `src/lib/core/diff.ts`, remove the `createForkedFromMatcher()` function entirely (lines ~410-446).

- [ ] **Step 3: Remove old fork schemas**

In `src/lib/schemata/fork.ts`, remove the old `CoreForkSchema` and `TCoreFork` exports that were kept temporarily in Task 1.

- [ ] **Step 4: Remove old fork interfaces**

In `src/lib/core/interfaces/library.interfaces.ts`, remove `TForkLookup` and `TForksLibrarySnapshot`. Remove the import of `TCoreFork`.

In `src/lib/core/interfaces/index.ts`, remove `TForkLookup` and `TForksLibrarySnapshot` from the re-exports.

- [ ] **Step 5: Update barrel exports in `src/lib/index.ts`**

- Remove: `export { ForksLibrary }`
- Remove: `export { createForkedFromMatcher }`
- Remove: type exports for `TForkLookup`, `TForksLibrarySnapshot`
- Verify all new exports are present: `ForkNamespace`, `ForkLibrary`, `ArgumentLibrary`, `PropositCore`, `forkArgumentEngine`, and all new types/schemas from `fork.ts`

- [ ] **Step 6: Remove old ForksLibrary tests**

In `test/core.test.ts`, remove the entire `describe("ForksLibrary", ...)` block and any tests that reference `ForksLibrary` or `createForkedFromMatcher`.

Update remaining fork-related test imports.

- [ ] **Step 7: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass. Fix any import errors or missed references.

- [ ] **Step 8: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Fix any issues. Run `pnpm eslint . --fix` and `pnpm run prettify` if needed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove ForksLibrary, createForkedFromMatcher, and old fork types"
```

---

### Task 10: Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Update CLAUDE.md**

Add to the "Key design rules" section:

- **No application metadata:** The core library does not deal in metadata such as user IDs, timestamps, or display text. These are application-level concerns. The CLI adds some metadata for its own purposes, but the core schemas are intentionally minimal. Applications extend core types via generic parameters.
- **PropositCore orchestrator:** `PropositCore` is the recommended entry point. It holds all libraries (`ArgumentLibrary`, `ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary`, `ForkLibrary`) and provides cross-library operations (`forkArgument`, `diffArguments`). Designed for subclassing ��� all internal state is `protected`.
- **ArgumentLibrary:** Engine registry with lifecycle management. Creating engines goes through the library. `register()` is for internal use (e.g., forking).
- **ForkLibrary / ForkNamespace:** Fork provenance lives in `ForkLibrary` (6 namespaces), not on entity schemas. Fork records are immutable, no checksums. `ForkNamespace` is a standalone reusable class.

Update the "Argument forking" bullet to reflect that forking goes through `PropositCore.forkArgument()`, which clones claims, sources, and associations.

Remove any references to `ForksLibrary` or `createForkedFromMatcher` in design rules.

Update the "Documentation Sync" section if needed.

- [ ] **Step 2: Update README.md**

Add a "PropositCore" section explaining it as the recommended entry point with a usage example. Update the forking section to show `core.forkArgument()` instead of the old API. Add the "No application metadata" note.

Remove references to `ForksLibrary` and `createForkedFromMatcher`.

- [ ] **Step 3: Update docs/api-reference.md**

Add sections for `PropositCore`, `ArgumentLibrary`, `ForkLibrary`, `ForkNamespace`. Remove the `ForksLibrary` section. Update the fork types table. Remove `createForkedFromMatcher` from the diff section.

- [ ] **Step 4: Update release notes and changelog**

Update `docs/release-notes/upcoming.md` with user-facing changes: PropositCore as new entry point, ForkLibrary replacing ForksLibrary, entity schemas slimmed down, automatic fork-aware diffing.

Update `docs/changelogs/upcoming.md` with developer-facing details.

- [ ] **Step 5: Run checks**

Run: `pnpm run check`
Expected: All checks pass (typecheck, lint, test, build).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/api-reference.md docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: add PropositCore, ForkLibrary, ArgumentLibrary documentation"
```
