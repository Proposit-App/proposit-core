# ForksLibrary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an external `ForksLibrary` class for first-class fork provenance, extract the fork remap logic into a standalone function, and move `forkArgument()` orchestration to the library.

**Architecture:** ForksLibrary is a standalone, external class following the ClaimSourceLibrary pattern (create/delete only, no versioning/freeze). The engine's `forkArgument()` is decomposed: remap/reconstruct logic becomes a standalone `forkArgumentEngine()` function, and `ForksLibrary.forkArgument()` orchestrates fork record creation + the standalone function. `canFork()` becomes public on the engine. A new `forkId` field is added to all entity schemas.

**Tech Stack:** TypeScript, Typebox (schemas), Vitest (tests)

---

### Task 1: Add `CoreForkSchema` and `TCoreFork` type

**Files:**

- Create: `src/lib/schemata/fork.ts`
- Modify: `src/lib/schemata/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts` at the bottom (new `describe` block):

```typescript
describe("ForksLibrary", () => {
    it("CoreForkSchema validates a complete fork record", () => {
        const fork = {
            id: "fork-1",
            sourceArgumentId: "arg-1",
            sourceArgumentVersion: 3,
            createdOn: "2026-03-28T12:00:00.000Z",
            checksum: "abc123",
        }
        expect(Value.Check(CoreForkSchema, fork)).toBe(true)
    })

    it("CoreForkSchema validates a fork with optional creatorId", () => {
        const fork = {
            id: "fork-1",
            sourceArgumentId: "arg-1",
            sourceArgumentVersion: 3,
            createdOn: "2026-03-28T12:00:00.000Z",
            creatorId: "user-42",
            checksum: "abc123",
        }
        expect(Value.Check(CoreForkSchema, fork)).toBe(true)
    })

    it("CoreForkSchema rejects a fork missing required fields", () => {
        const fork = {
            id: "fork-1",
            sourceArgumentId: "arg-1",
            // missing sourceArgumentVersion, createdOn, checksum
        }
        expect(Value.Check(CoreForkSchema, fork)).toBe(false)
    })
})
```

Import `CoreForkSchema` from `../src/lib/schemata` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "CoreForkSchema"`
Expected: FAIL — `CoreForkSchema` does not exist.

- [ ] **Step 3: Create the schema file**

Create `src/lib/schemata/fork.ts`:

```typescript
import type { Static } from "typebox"
import Type from "typebox"
import { UUID } from "./shared.js"

/**
 * Schema for a fork record. Represents a single fork operation — the event of
 * creating an independent copy of an argument. Create-or-delete only; fork
 * records are immutable after creation.
 */
export const CoreForkSchema = Type.Object(
    {
        id: UUID,
        sourceArgumentId: UUID,
        sourceArgumentVersion: Type.Number({
            description:
                "The version of the source argument at the time of the fork.",
        }),
        createdOn: Type.String({
            description: "ISO 8601 timestamp of when the fork was created.",
        }),
        creatorId: Type.Optional(
            Type.String({
                description: "Optional application-provided ID of the creator.",
            })
        ),
        checksum: Type.String({
            description: "Fork record checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A fork record. Extended via generics for additional fields.",
    }
)

/** A fork record entity. */
export type TCoreFork = Static<typeof CoreForkSchema>
```

- [ ] **Step 4: Export from schemata barrel**

Add to `src/lib/schemata/index.ts`:

```typescript
export * from "./fork.js"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "CoreForkSchema"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemata/fork.ts src/lib/schemata/index.ts test/core.test.ts
git commit -m "feat: add CoreForkSchema and TCoreFork type"
```

---

### Task 2: Add `forkId` field to entity schemas

**Files:**

- Modify: `src/lib/schemata/argument.ts`
- Modify: `src/lib/schemata/propositional.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `ForksLibrary` describe block in `test/core.test.ts`:

```typescript
it("CoreArgumentSchema accepts forkId field", () => {
    const arg = {
        id: "arg-1",
        version: 0,
        checksum: "cs1",
        descendantChecksum: null,
        combinedChecksum: "cs1",
        forkId: "fork-1",
    }
    expect(Value.Check(CoreArgumentSchema, arg)).toBe(true)
})

it("CoreArgumentSchema accepts forkId as null", () => {
    const arg = {
        id: "arg-1",
        version: 0,
        checksum: "cs1",
        descendantChecksum: null,
        combinedChecksum: "cs1",
        forkId: null,
    }
    expect(Value.Check(CoreArgumentSchema, arg)).toBe(true)
})

it("CorePremiseSchema accepts forkId field", () => {
    const premise = {
        id: "prem-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        checksum: "cs2",
        descendantChecksum: null,
        combinedChecksum: "cs2",
        forkId: "fork-1",
    }
    expect(Value.Check(CorePremiseSchema, premise)).toBe(true)
})

it("CorePropositionalExpressionSchema accepts forkId field", () => {
    const expr = {
        id: "expr-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "prem-1",
        parentId: null,
        position: 0,
        checksum: "cs3",
        descendantChecksum: null,
        combinedChecksum: "cs3",
        type: "variable" as const,
        variableId: "var-1",
        forkId: "fork-1",
    }
    expect(Value.Check(CorePropositionalExpressionSchema, expr)).toBe(true)
})

it("CorePropositionalVariableSchema accepts forkId field", () => {
    const variable = {
        id: "var-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        symbol: "P",
        checksum: "cs4",
        claimId: "claim-1",
        claimVersion: 1,
        forkId: "fork-1",
    }
    expect(Value.Check(CorePropositionalVariableSchema, variable)).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "forkId"`
Expected: FAIL — `forkId` is not in the schemas. (Note: schemas use `additionalProperties: true`, so they will actually pass even without adding the field. The real validation is that `forkId` appears as a recognized field. Since `additionalProperties: true` is set, these tests will pass even without changes. We need a different strategy.)

Actually, because all schemas have `additionalProperties: true`, these tests would pass already. The `forkId` field needs to be added to schemas for type-level support (so `TCorePropositionalExpression.forkId` etc. exist in TypeScript), not for runtime validation. We should add the schema fields and verify they compile correctly via the type system.

Skip the test-first approach for this task — this is purely a schema/type addition. Add the fields directly.

- [ ] **Step 3: Add `forkId` to `CoreArgumentSchema`**

In `src/lib/schemata/argument.ts`, add after the `forkedFromArgumentVersion` field:

```typescript
        forkId: Type.Optional(
            Nullable(UUID, {
                description:
                    "References the fork record this entity belongs to, or null if not from a fork.",
            })
        ),
```

- [ ] **Step 4: Add `forkId` to `BasePropositionalExpressionSchema`**

In `src/lib/schemata/propositional.ts`, add after the `forkedFromArgumentVersion` field in `BasePropositionalExpressionSchema`:

```typescript
    forkId: Type.Optional(
        Nullable(UUID, {
            description:
                "References the fork record this expression belongs to, or null if not from a fork.",
        })
    ),
```

- [ ] **Step 5: Add `forkId` to `CoreVariableBaseFields`**

In `src/lib/schemata/propositional.ts`, add after the `forkedFromArgumentVersion` field in `CoreVariableBaseFields`:

```typescript
    forkId: Type.Optional(
        Nullable(UUID, {
            description:
                "References the fork record this variable belongs to, or null if not from a fork.",
        })
    ),
```

- [ ] **Step 6: Add `forkId` to `CorePremiseSchema`**

In `src/lib/schemata/propositional.ts`, add after the `forkedFromArgumentVersion` field in `CorePremiseSchema`:

```typescript
        forkId: Type.Optional(
            Nullable(UUID, {
                description:
                    "References the fork record this premise belongs to, or null if not from a fork.",
            })
        ),
```

- [ ] **Step 7: Add `forkId` to `DEFAULT_CHECKSUM_CONFIG`**

In `src/lib/consts.ts`, add `"forkId"` to `expressionFields`, `variableFields`, `premiseFields`, and `argumentFields` sets. Also add a `forkFields` entry for the new fork entity:

```typescript
forkFields: new Set([
    "id",
    "sourceArgumentId",
    "sourceArgumentVersion",
    "createdOn",
]),
```

- [ ] **Step 8: Add `forkFields` to `TCoreChecksumConfig`**

In `src/lib/types/checksum.ts`, add:

```typescript
    /** Fields to hash for fork records. Defaults to ["id", "sourceArgumentId", "sourceArgumentVersion", "createdOn"]. */
    forkFields?: Set<string>
```

Also add `"forkFields"` to the `keys` arrays in `normalizeChecksumConfig`, `serializeChecksumConfig`, and `createChecksumConfig` in `src/lib/consts.ts`.

- [ ] **Step 9: Add schema forkId tests and checksum config tests**

Add inside the `ForksLibrary` describe block in `test/core.test.ts`:

```typescript
it("DEFAULT_CHECKSUM_CONFIG includes forkId in argument fields", () => {
    expect(DEFAULT_CHECKSUM_CONFIG.argumentFields).toContain("forkId")
})

it("DEFAULT_CHECKSUM_CONFIG includes forkId in premise fields", () => {
    expect(DEFAULT_CHECKSUM_CONFIG.premiseFields).toContain("forkId")
})

it("DEFAULT_CHECKSUM_CONFIG includes forkId in expression fields", () => {
    expect(DEFAULT_CHECKSUM_CONFIG.expressionFields).toContain("forkId")
})

it("DEFAULT_CHECKSUM_CONFIG includes forkId in variable fields", () => {
    expect(DEFAULT_CHECKSUM_CONFIG.variableFields).toContain("forkId")
})

it("DEFAULT_CHECKSUM_CONFIG has forkFields", () => {
    expect(DEFAULT_CHECKSUM_CONFIG.forkFields).toBeDefined()
    expect(DEFAULT_CHECKSUM_CONFIG.forkFields).toContain("id")
    expect(DEFAULT_CHECKSUM_CONFIG.forkFields).toContain("sourceArgumentId")
    expect(DEFAULT_CHECKSUM_CONFIG.forkFields).toContain(
        "sourceArgumentVersion"
    )
    expect(DEFAULT_CHECKSUM_CONFIG.forkFields).toContain("createdOn")
})
```

- [ ] **Step 10: Run tests and typecheck**

Run: `pnpm vitest run test/core.test.ts -t "ForksLibrary" && pnpm run typecheck`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/lib/schemata/argument.ts src/lib/schemata/propositional.ts src/lib/consts.ts src/lib/types/checksum.ts test/core.test.ts
git commit -m "feat: add forkId field to entity schemas and forkFields to checksum config"
```

---

### Task 3: Add `TForkLookup` and `TForksLibrarySnapshot` interfaces

**Files:**

- Modify: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`

- [ ] **Step 1: Add interfaces to `library.interfaces.ts`**

At the bottom of `src/lib/core/interfaces/library.interfaces.ts`, add:

```typescript
/**
 * Narrow read-only interface for fork record lookups. Implemented by
 * `ForksLibrary`. Use this interface for consumers that only need to
 * query fork records without mutation access.
 */
export interface TForkLookup<TFork extends TCoreFork = TCoreFork> {
    /**
     * Returns a fork record by ID, or `undefined` if not found.
     *
     * @param id - The fork record ID.
     * @returns The fork entity, or `undefined`.
     */
    get(id: string): TFork | undefined

    /**
     * Returns all fork records in the library.
     *
     * @returns An array of all fork entities.
     */
    getAll(): TFork[]
}

/**
 * Serializable snapshot of a `ForksLibrary`. Contains all fork record
 * entities.
 */
export type TForksLibrarySnapshot<TFork extends TCoreFork = TCoreFork> = {
    /** All fork record entities in the library. */
    forks: TFork[]
}
```

Add the import for `TCoreFork` at the top of the file:

```typescript
import type { TCoreFork } from "../../schemata/fork.js"
```

- [ ] **Step 2: Export from interfaces barrel**

In `src/lib/core/interfaces/index.ts`, add `TForkLookup` and `TForksLibrarySnapshot` to the exports from `library.interfaces.js`:

```typescript
export type {
    TClaimLookup,
    TClaimLibraryManagement,
    TSourceLookup,
    TSourceLibraryManagement,
    TClaimLibrarySnapshot,
    TSourceLibrarySnapshot,
    TClaimSourceLookup,
    TClaimSourceLibraryManagement,
    TClaimSourceLibrarySnapshot,
    TForkLookup,
    TForksLibrarySnapshot,
} from "./library.interfaces.js"
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/interfaces/library.interfaces.ts src/lib/core/interfaces/index.ts
git commit -m "feat: add TForkLookup and TForksLibrarySnapshot interfaces"
```

---

### Task 4: Implement `ForksLibrary` class

**Files:**

- Create: `src/lib/core/forks-library.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `ForksLibrary` describe block in `test/core.test.ts`. Import `ForksLibrary` from `../src/lib/core/forks-library` at the top of the test file.

```typescript
it("create() stores a fork record and computes checksum", () => {
    const lib = new ForksLibrary()
    lib.create({
        id: "fork-1",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 3,
        createdOn: "2026-03-28T12:00:00.000Z",
    })
    const fork = lib.get("fork-1")
    expect(fork).toBeDefined()
    expect(fork!.id).toBe("fork-1")
    expect(fork!.sourceArgumentId).toBe("arg-1")
    expect(fork!.sourceArgumentVersion).toBe(3)
    expect(fork!.checksum).toBeDefined()
    expect(typeof fork!.checksum).toBe("string")
    expect(fork!.checksum.length).toBeGreaterThan(0)
})

it("create() stores a fork with optional creatorId", () => {
    const lib = new ForksLibrary()
    lib.create({
        id: "fork-1",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 0,
        createdOn: "2026-03-28T12:00:00.000Z",
        creatorId: "user-42",
    })
    const fork = lib.get("fork-1")
    expect(fork!.creatorId).toBe("user-42")
})

it("create() throws on duplicate ID", () => {
    const lib = new ForksLibrary()
    lib.create({
        id: "fork-1",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 0,
        createdOn: "2026-03-28T12:00:00.000Z",
    })
    expect(() =>
        lib.create({
            id: "fork-1",
            sourceArgumentId: "arg-2",
            sourceArgumentVersion: 1,
            createdOn: "2026-03-28T13:00:00.000Z",
        })
    ).toThrow()
})

it("get() returns undefined for missing ID", () => {
    const lib = new ForksLibrary()
    expect(lib.get("nonexistent")).toBeUndefined()
})

it("getAll() returns all fork records", () => {
    const lib = new ForksLibrary()
    lib.create({
        id: "fork-1",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 0,
        createdOn: "2026-03-28T12:00:00.000Z",
    })
    lib.create({
        id: "fork-2",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 1,
        createdOn: "2026-03-28T13:00:00.000Z",
    })
    expect(lib.getAll()).toHaveLength(2)
})

it("remove() deletes a fork record", () => {
    const lib = new ForksLibrary()
    lib.create({
        id: "fork-1",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 0,
        createdOn: "2026-03-28T12:00:00.000Z",
    })
    lib.remove("fork-1")
    expect(lib.get("fork-1")).toBeUndefined()
    expect(lib.getAll()).toHaveLength(0)
})

it("remove() throws for missing ID", () => {
    const lib = new ForksLibrary()
    expect(() => lib.remove("nonexistent")).toThrow()
})

it("snapshot() and fromSnapshot() round-trip preserves records", () => {
    const lib = new ForksLibrary()
    lib.create({
        id: "fork-1",
        sourceArgumentId: "arg-1",
        sourceArgumentVersion: 0,
        createdOn: "2026-03-28T12:00:00.000Z",
    })
    lib.create({
        id: "fork-2",
        sourceArgumentId: "arg-2",
        sourceArgumentVersion: 1,
        createdOn: "2026-03-28T13:00:00.000Z",
        creatorId: "user-42",
    })

    const snap = lib.snapshot()
    const restored = ForksLibrary.fromSnapshot(snap)

    expect(restored.getAll()).toHaveLength(2)
    const f1 = restored.get("fork-1")!
    expect(f1.sourceArgumentId).toBe("arg-1")
    expect(f1.checksum).toBe(lib.get("fork-1")!.checksum)
    const f2 = restored.get("fork-2")!
    expect(f2.creatorId).toBe("user-42")
    expect(f2.checksum).toBe(lib.get("fork-2")!.checksum)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ForksLibrary"`
Expected: FAIL — `ForksLibrary` does not exist.

- [ ] **Step 3: Implement ForksLibrary**

Create `src/lib/core/forks-library.ts`:

```typescript
import type { TCoreFork } from "../schemata/fork.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type {
    TForkLookup,
    TForksLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type { TInvariantValidationResult } from "../types/validation.js"
import { entityChecksum } from "./checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { Value } from "typebox/value"
import { CoreForkSchema } from "../schemata/fork.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

/**
 * Manages fork records — provenance metadata for argument fork operations.
 * Create-or-delete only; fork records are immutable after creation.
 * Follows the same external library pattern as `ClaimSourceLibrary`.
 *
 * @typeParam TFork - Fork entity type, defaults to `TCoreFork`.
 */
export class ForksLibrary<
    TFork extends TCoreFork = TCoreFork,
> implements TForkLookup<TFork> {
    private forks: Map<string, TFork>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.forks = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    /**
     * Stores state before a mutation, executes the mutation, validates the
     * result, and rolls back on failure.
     */
    private withValidation<T>(fn: () => T): T {
        const snap = this.snapshot()
        const result = fn()
        const validation = this.validate()
        if (!validation.valid) {
            this.restoreFromSnapshot(snap)
            throw new InvariantViolationError(validation.violations)
        }
        return result
    }

    private restoreFromSnapshot(snap: TForksLibrarySnapshot<TFork>): void {
        this.forks.clear()
        for (const fork of snap.forks) {
            this.forks.set(fork.id, fork)
        }
    }

    private computeChecksum(fork: TFork): string {
        const fields =
            this.checksumConfig?.forkFields ??
            DEFAULT_CHECKSUM_CONFIG.forkFields!
        return entityChecksum(
            fork as unknown as Record<string, unknown>,
            fields
        )
    }

    /**
     * Creates a fork record. The `checksum` field is computed automatically.
     *
     * @param fork - The fork data. The `checksum` field, if provided, is overwritten.
     * @throws If a fork with the same ID already exists.
     */
    create(fork: Omit<TFork, "checksum"> & { checksum?: string }): TFork {
        return this.withValidation(() => {
            if (this.forks.has(fork.id)) {
                throw new Error(`Fork with ID "${fork.id}" already exists.`)
            }
            const complete = {
                ...fork,
                checksum: "",
            } as TFork
            complete.checksum = this.computeChecksum(complete)
            this.forks.set(complete.id, complete)
            return complete
        })
    }

    /**
     * Returns a fork record by ID, or `undefined` if not found.
     *
     * @param id - The fork record ID.
     */
    get(id: string): TFork | undefined {
        return this.forks.get(id)
    }

    /**
     * Returns all fork records in the library.
     */
    getAll(): TFork[] {
        return [...this.forks.values()]
    }

    /**
     * Removes a fork record by ID. Does not cascade-delete forked entities.
     *
     * @param id - The fork record ID.
     * @returns The removed fork entity.
     * @throws If the fork record does not exist.
     */
    remove(id: string): TFork {
        return this.withValidation(() => {
            const fork = this.forks.get(id)
            if (!fork) {
                throw new Error(`Fork with ID "${id}" not found.`)
            }
            this.forks.delete(id)
            return fork
        })
    }

    /**
     * Returns a serializable snapshot of all fork records.
     */
    snapshot(): TForksLibrarySnapshot<TFork> {
        return { forks: [...this.forks.values()] }
    }

    /**
     * Reconstructs a `ForksLibrary` from a snapshot.
     *
     * @param snapshot - The snapshot to restore from.
     * @param options - Optional checksum config.
     */
    static fromSnapshot<TFork extends TCoreFork = TCoreFork>(
        snapshot: TForksLibrarySnapshot<TFork>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ForksLibrary<TFork> {
        const lib = new ForksLibrary<TFork>(options)
        for (const fork of snapshot.forks) {
            lib.forks.set(fork.id, fork)
        }
        return lib
    }

    /**
     * Validates invariants: all stored fork records conform to schema and
     * have no duplicate IDs (enforced by Map, but schema conformance is checked).
     */
    validate(): TInvariantValidationResult {
        const violations: string[] = []
        for (const fork of this.forks.values()) {
            if (!Value.Check(CoreForkSchema, fork)) {
                violations.push(
                    `Fork "${fork.id}" does not conform to CoreForkSchema.`
                )
            }
        }
        return violations.length > 0
            ? { valid: false, violations }
            : { valid: true, violations: [] }
    }
}
```

- [ ] **Step 4: Export from library barrel**

In `src/lib/index.ts`, add after the `ClaimSourceLibrary` export:

```typescript
export { ForksLibrary } from "./core/forks-library.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ForksLibrary" && pnpm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/forks-library.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: implement ForksLibrary class"
```

---

### Task 5: Extract standalone `forkArgumentEngine()` function

**Files:**

- Create: `src/lib/core/fork.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `src/lib/types/fork.ts`
- Modify: `src/lib/index.ts`

This task extracts the remap/reconstruct logic from `ArgumentEngine.forkArgument()` into a standalone function. The engine's `forkArgument()` is not removed yet (that happens in Task 7). Instead, the engine method is refactored to delegate to the standalone function.

- [ ] **Step 1: Write the failing test**

Add inside the `ForksLibrary` describe block in `test/core.test.ts`. Import `forkArgumentEngine` from `../src/lib/index`.

```typescript
describe("forkArgumentEngine", () => {
    it("produces identical results to the former engine method", () => {
        const claimLib = aLib()
        const sourceLib = sLib()
        const csLibrary = new ClaimSourceLibrary(claimLib, sourceLib)

        const eng = new ArgumentEngine(
            { id: "src-arg", version: 2 },
            claimLib,
            sourceLib,
            csLibrary
        )

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-1")
        pm.addExpression({
            id: "expr-1",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: POSITION_INITIAL,
        })

        eng.setConclusionPremise("prem-1")

        const forkClaimLib = aLib()
        const forkSourceLib = sLib()
        const forkCsLib = new ClaimSourceLibrary(forkClaimLib, forkSourceLib)

        let counter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
                sourceLibrary: forkSourceLib,
                claimSourceLibrary: forkCsLib,
            },
            { generateId: () => `fk-${counter++}` }
        )

        // Verify argument identity and forkedFrom
        const forkedArg = forked.getArgument()
        expect(forkedArg.id).toBe("fork-arg")
        expect(forkedArg.version).toBe(0)
        expect(forkedArg.forkedFromArgumentId).toBe("src-arg")
        expect(forkedArg.forkedFromArgumentVersion).toBe(2)

        // Verify remap table
        expect(remapTable.argumentId).toEqual({
            from: "src-arg",
            to: "fork-arg",
        })
        expect(remapTable.premises.size).toBe(1)
        expect(remapTable.expressions.size).toBe(1)
        expect(remapTable.variables.size).toBe(2) // var-p + auto premise-bound

        // Verify premise forkedFrom
        const forkedPremise = forked.listPremises()[0]
        const forkedPremiseData = forkedPremise.snapshot().premise
        expect(forkedPremiseData.forkedFromPremiseId).toBe("prem-1")

        // Verify expression forkedFrom
        const forkedExpr = forkedPremise.getExpressions()[0]
        expect(forkedExpr.forkedFromExpressionId).toBe("expr-1")

        // Verify variable forkedFrom
        const forkedVar = forked
            .getVariables()
            .find((v) => v.id === remapTable.variables.get("var-p"))!
        expect(forkedVar.forkedFromVariableId).toBe("var-p")

        // Verify conclusion remapped
        expect(forked.getConclusionPremise()?.getId()).toBe(
            remapTable.premises.get("prem-1")
        )

        // Verify independence
        forked.createPremise()
        expect(eng.listPremises()).toHaveLength(1)
        expect(forked.listPremises()).toHaveLength(2)
    })

    it("does not call canFork()", () => {
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        const eng = new NoForkEngine(ARG, aLib(), sLib(), csLib())
        // Standalone function should NOT check canFork
        expect(() =>
            forkArgumentEngine(eng, "new-arg", {
                claimLibrary: aLib(),
                sourceLibrary: sLib(),
                claimSourceLibrary: csLib(),
            })
        ).not.toThrow()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "forkArgumentEngine"`
Expected: FAIL — `forkArgumentEngine` does not exist.

- [ ] **Step 3: Create the standalone function**

Create `src/lib/core/fork.ts`. Extract the body of `ArgumentEngine.forkArgument()` (lines 2594-2761 of argument-engine.ts) into this standalone function. The function takes the engine, snapshot it, remaps, and reconstructs — identical logic, just not an instance method.

```typescript
import { randomUUID } from "node:crypto"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TPremiseBoundVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type { TCoreSource } from "../schemata/source.js"
import type { TCoreClaimSourceAssociation } from "../schemata/source.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
} from "./interfaces/library.interfaces.js"
import type { TForkArgumentOptions, TForkRemapTable } from "../types/fork.js"
import type { TOptionalChecksum } from "../schemata/shared.js"
import { ArgumentEngine } from "./argument-engine.js"
import { serializeChecksumConfig } from "../consts.js"
import { isPremiseBound } from "../schemata/propositional.js"

/**
 * Creates an independent copy of an argument engine under a new argument ID.
 *
 * Every premise, expression, and variable receives a fresh ID. All internal
 * cross-references are remapped. Each forked entity carries `forkedFrom*`
 * metadata pointing back to the originals.
 *
 * This function does NOT call `engine.canFork()` — callers are responsible
 * for checking fork eligibility before calling.
 *
 * @param engine - The source engine to fork.
 * @param newArgumentId - The ID for the forked argument.
 * @param libraries - Claim, source, and claim-source libraries for the fork.
 * @param options - Optional ID generator, checksum/position/grammar config overrides.
 * @returns The forked engine and a remap table mapping original → new entity IDs.
 */
export function forkArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
>(
    engine: ArgumentEngine<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >,
    newArgumentId: string,
    libraries: {
        claimLibrary: TClaimLookup<TClaim>
        sourceLibrary: TSourceLookup<TSource>
        claimSourceLibrary: TClaimSourceLookup<TAssoc>
    },
    options?: TForkArgumentOptions
): {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    remapTable: TForkRemapTable
} {
    const generateId = options?.generateId ?? randomUUID

    const snap = engine.snapshot()

    const originalArgumentId = snap.argument.id
    const originalArgumentVersion = snap.argument.version

    // Build remap tables (old ID → new ID)
    const premiseRemap = new Map<string, string>()
    const expressionRemap = new Map<string, string>()
    const variableRemap = new Map<string, string>()

    for (const ps of snap.premises) {
        premiseRemap.set(ps.premise.id, generateId())
        for (const expr of ps.expressions.expressions) {
            expressionRemap.set(expr.id, generateId())
        }
    }
    for (const v of snap.variables.variables) {
        variableRemap.set(v.id, generateId())
    }

    const remapTable: TForkRemapTable = {
        argumentId: { from: originalArgumentId, to: newArgumentId },
        premises: premiseRemap,
        expressions: expressionRemap,
        variables: variableRemap,
    }

    // Remap argument
    snap.argument = {
        ...snap.argument,
        id: newArgumentId,
        version: 0,
        forkedFromArgumentId: originalArgumentId,
        forkedFromArgumentVersion: originalArgumentVersion,
    } as TOptionalChecksum<TArg>

    // Remap premises and expressions
    for (const ps of snap.premises) {
        const originalPremiseId = ps.premise.id
        const newPremiseId = premiseRemap.get(originalPremiseId)!

        ps.premise = {
            ...ps.premise,
            id: newPremiseId,
            argumentId: newArgumentId,
            argumentVersion: 0,
            forkedFromPremiseId: originalPremiseId,
            forkedFromArgumentId: originalArgumentId,
            forkedFromArgumentVersion: originalArgumentVersion,
        } as TOptionalChecksum<TPremise>

        if (ps.rootExpressionId) {
            ps.rootExpressionId = expressionRemap.get(ps.rootExpressionId)!
        }

        ps.expressions.expressions = ps.expressions.expressions.map((expr) => {
            const originalExprId = expr.id
            const newExprId = expressionRemap.get(originalExprId)!

            const remapped = {
                ...expr,
                id: newExprId,
                argumentId: newArgumentId,
                argumentVersion: 0,
                premiseId: newPremiseId,
                parentId: expr.parentId
                    ? (expressionRemap.get(expr.parentId) ?? null)
                    : null,
                forkedFromExpressionId: originalExprId,
                forkedFromPremiseId: originalPremiseId,
                forkedFromArgumentId: originalArgumentId,
                forkedFromArgumentVersion: originalArgumentVersion,
            } as TExpr

            if (
                (remapped as { type: string }).type === "variable" &&
                "variableId" in remapped
            ) {
                const origVarId = (
                    remapped as unknown as { variableId: string }
                ).variableId
                ;(remapped as unknown as { variableId: string }).variableId =
                    variableRemap.get(origVarId)!
            }

            return remapped
        })
    }

    // Remap variables
    snap.variables.variables = snap.variables.variables.map((v) => {
        const originalVarId = v.id
        const newVarId = variableRemap.get(originalVarId)!

        const remapped = {
            ...v,
            id: newVarId,
            argumentId: newArgumentId,
            argumentVersion: 0,
            forkedFromVariableId: originalVarId,
            forkedFromArgumentId: originalArgumentId,
            forkedFromArgumentVersion: originalArgumentVersion,
        }

        if (isPremiseBound(remapped as unknown as TCorePropositionalVariable)) {
            const premiseBound =
                remapped as unknown as TPremiseBoundVariable & {
                    boundPremiseId: string
                    boundArgumentId: string
                    boundArgumentVersion: number
                }
            premiseBound.boundPremiseId = premiseRemap.get(
                premiseBound.boundPremiseId
            )!
            premiseBound.boundArgumentId = newArgumentId
            premiseBound.boundArgumentVersion = 0
        }

        return remapped as TVar
    })

    // Remap conclusion
    if (snap.conclusionPremiseId) {
        snap.conclusionPremiseId = premiseRemap.get(snap.conclusionPremiseId)
    }

    // Carry config
    snap.config = {
        checksumConfig: serializeChecksumConfig(
            options?.checksumConfig ?? engine.getChecksumConfig?.()
        ),
        positionConfig: options?.positionConfig ?? engine.getPositionConfig?.(),
        grammarConfig: options?.grammarConfig ?? engine.getGrammarConfig?.(),
    }

    // Construct new engine
    const forkedEngine = ArgumentEngine.fromSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >(
        snap,
        libraries.claimLibrary,
        libraries.sourceLibrary,
        libraries.claimSourceLibrary,
        options?.grammarConfig ?? engine.getGrammarConfig?.(),
        "ignore"
    )

    return { engine: forkedEngine, remapTable }
}
```

**Important:** The standalone function needs access to the engine's config (checksum, position, grammar). Check whether `ArgumentEngine` has public getters for these. If not, they need to be exposed. The current `forkArgument()` accesses `this.checksumConfig`, `this.positionConfig`, `this.grammarConfig` directly as private fields. The standalone function can get these from the snapshot's `config` field instead — the snapshot already includes config. Adjust the config section:

```typescript
// Carry config from the snapshot (already includes engine config) or options
if (
    options?.checksumConfig ||
    options?.positionConfig ||
    options?.grammarConfig
) {
    snap.config = {
        ...snap.config,
        ...(options.checksumConfig
            ? {
                  checksumConfig: serializeChecksumConfig(
                      options.checksumConfig
                  ),
              }
            : {}),
        ...(options.positionConfig
            ? { positionConfig: options.positionConfig }
            : {}),
        ...(options.grammarConfig
            ? { grammarConfig: options.grammarConfig }
            : {}),
    }
}
```

Actually, the `snapshot()` method already populates `snap.config` with the engine's config. So the standalone function only needs to override the config fields when options are provided. The default case (no options) already works because the snapshot contains the config.

Revise the config section to:

```typescript
// Override config from options if provided; otherwise snapshot already has it
if (options?.checksumConfig) {
    snap.config = {
        ...snap.config,
        checksumConfig: serializeChecksumConfig(options.checksumConfig),
    }
}
if (options?.positionConfig) {
    snap.config = { ...snap.config, positionConfig: options.positionConfig }
}
if (options?.grammarConfig) {
    snap.config = { ...snap.config, grammarConfig: options.grammarConfig }
}

// grammarConfig for fromSnapshot comes from snap.config or options
const grammarConfig = options?.grammarConfig ?? snap.config?.grammarConfig
```

And use `grammarConfig` in the `fromSnapshot` call.

- [ ] **Step 4: Export from library barrel**

In `src/lib/index.ts`, add:

```typescript
export { forkArgumentEngine } from "./core/fork.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "forkArgumentEngine" && pnpm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/fork.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: extract forkArgumentEngine standalone function"
```

---

### Task 6: Make `canFork()` public on ArgumentEngine

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `ForksLibrary` describe block in `test/core.test.ts`:

```typescript
it("canFork() is publicly accessible", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    // Should be callable without casting
    expect(eng.canFork()).toBe(true)
})

it("canFork() override still works on subclass", () => {
    class RestrictedEngine extends ArgumentEngine {
        public override canFork(): boolean {
            return false
        }
    }
    const eng = new RestrictedEngine(ARG, aLib(), sLib(), csLib())
    expect(eng.canFork()).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "canFork"`
Expected: FAIL — TypeScript error, `canFork` is `protected`.

Actually, Vitest runs compiled JS, so `protected` doesn't prevent runtime access. The test would pass at runtime but fail at type-check. Run typecheck:

Run: `pnpm run typecheck`
Expected: Compile error — cannot access protected member `canFork`.

- [ ] **Step 3: Change visibility**

In `src/lib/core/argument-engine.ts`, change:

```typescript
    protected canFork(): boolean {
```

to:

```typescript
    public canFork(): boolean {
```

- [ ] **Step 4: Add `canFork()` to the engine interface**

Check if `TArgumentLifecycle` (in `src/lib/core/interfaces/argument-engine.interfaces.ts`) includes `canFork`. If not, add it. If `canFork` isn't part of any interface, add it to the appropriate interface so it's documented.

- [ ] **Step 5: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm vitest run test/core.test.ts -t "canFork"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts test/core.test.ts
git commit -m "feat: make canFork() public on ArgumentEngine"
```

---

### Task 7: Add `ForksLibrary.forkArgument()` and remove engine method

**Files:**

- Modify: `src/lib/core/forks-library.ts`
- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `ForksLibrary` describe block in `test/core.test.ts`:

```typescript
describe("ForksLibrary.forkArgument()", () => {
    it("creates fork record, sets forkId on all entities, returns engine + remapTable + fork", () => {
        const claimLib = aLib()
        const sourceLib = sLib()
        const csLibrary = new ClaimSourceLibrary(claimLib, sourceLib)

        const eng = new ArgumentEngine(
            { id: "src-arg", version: 2 },
            claimLib,
            sourceLib,
            csLibrary
        )

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-1")
        pm.addExpression({
            id: "expr-1",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const forksLib = new ForksLibrary()
        const forkClaimLib = aLib()
        const forkSourceLib = sLib()
        const forkCsLib = new ClaimSourceLibrary(forkClaimLib, forkSourceLib)

        let counter = 0
        const {
            engine: forked,
            remapTable,
            fork,
        } = forksLib.forkArgument(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
                sourceLibrary: forkSourceLib,
                claimSourceLibrary: forkCsLib,
            },
            {
                generateId: () => `fk-${counter++}`,
                creatorId: "user-42",
            }
        )

        // Fork record created in library
        expect(fork.id).toBeDefined()
        expect(fork.sourceArgumentId).toBe("src-arg")
        expect(fork.sourceArgumentVersion).toBe(2)
        expect(fork.creatorId).toBe("user-42")
        expect(fork.createdOn).toBeDefined()
        expect(forksLib.get(fork.id)).toBe(fork)

        // forkId set on argument
        const forkedArg = forked.getArgument()
        expect(forkedArg.forkId).toBe(fork.id)

        // forkId set on premises
        const forkedPremise = forked.listPremises()[0]
        const premiseData = forkedPremise.snapshot().premise
        expect(premiseData.forkId).toBe(fork.id)

        // forkId set on expressions
        const forkedExpr = forkedPremise.getExpressions()[0]
        expect(forkedExpr.forkId).toBe(fork.id)

        // forkId set on variables
        for (const v of forked.getVariables()) {
            expect(v.forkId).toBe(fork.id)
        }

        // forkedFrom still set
        expect(forkedArg.forkedFromArgumentId).toBe("src-arg")
        expect(premiseData.forkedFromPremiseId).toBe("prem-1")

        // Remap table correct
        expect(remapTable.premises.size).toBe(1)
        expect(remapTable.expressions.size).toBe(1)
    })

    it("calls canFork() and throws when false", () => {
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        const eng = new NoForkEngine(ARG, aLib(), sLib(), csLib())
        const forksLib = new ForksLibrary()

        expect(() =>
            forksLib.forkArgument(eng, "new-arg", {
                claimLibrary: aLib(),
                sourceLibrary: sLib(),
                claimSourceLibrary: csLib(),
            })
        ).toThrow("Forking is not allowed")
    })

    it("accepts a caller-provided forkId", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const forksLib = new ForksLibrary()

        const { fork } = forksLib.forkArgument(
            eng,
            "fork-arg",
            {
                claimLibrary: aLib(),
                sourceLibrary: sLib(),
                claimSourceLibrary: csLib(),
            },
            { forkId: "my-custom-fork-id" }
        )

        expect(fork.id).toBe("my-custom-fork-id")
        expect(forksLib.get("my-custom-fork-id")).toBeDefined()
    })

    it("remove() does not cascade to forked entities", () => {
        const claimLib = aLib()
        const sourceLib = sLib()
        const csLibrary = new ClaimSourceLibrary(claimLib, sourceLib)
        const eng = new ArgumentEngine(
            { id: "src-arg", version: 0 },
            claimLib,
            sourceLib,
            csLibrary
        )
        eng.createPremise()

        const forksLib = new ForksLibrary()
        const forkClaimLib = aLib()
        const forkSourceLib = sLib()
        const forkCsLib = new ClaimSourceLibrary(forkClaimLib, forkSourceLib)

        const { engine: forked, fork } = forksLib.forkArgument(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
                sourceLibrary: forkSourceLib,
                claimSourceLibrary: forkCsLib,
            }
        )

        // Remove fork record
        forksLib.remove(fork.id)
        expect(forksLib.get(fork.id)).toBeUndefined()

        // Forked engine is unaffected
        expect(forked.listPremises()).toHaveLength(1)
        expect(forked.getArgument().forkId).toBe(fork.id) // forkId still on entity
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ForksLibrary.forkArgument"`
Expected: FAIL — `forkArgument` does not exist on `ForksLibrary`.

- [ ] **Step 3: Implement `ForksLibrary.forkArgument()`**

Add to `src/lib/core/forks-library.ts`:

Import at the top:

```typescript
import { randomUUID } from "node:crypto"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type { TCoreSource } from "../schemata/source.js"
import type { TCoreClaimSourceAssociation } from "../schemata/source.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
} from "./interfaces/library.interfaces.js"
import type { TForkArgumentOptions, TForkRemapTable } from "../types/fork.js"
import { ArgumentEngine } from "./argument-engine.js"
import { forkArgumentEngine } from "./fork.js"
```

Add method to the class:

```typescript
    /**
     * Creates an independent copy of an argument engine under a new argument ID,
     * with a fork record tracking the operation.
     *
     * Calls `engine.canFork()` as a guard. Creates the fork record, delegates
     * engine forking to `forkArgumentEngine()`, and sets `forkId` on all
     * entities in the forked engine.
     *
     * @param engine - The source engine to fork.
     * @param newArgumentId - The ID for the forked argument.
     * @param libraries - Claim, source, and claim-source libraries for the fork.
     * @param options - Fork options plus optional `forkId` and `creatorId`.
     * @returns The forked engine, remap table, and fork record.
     * @throws If `engine.canFork()` returns false.
     */
    forkArgument<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TSource extends TCoreSource = TCoreSource,
        TClaim extends TCoreClaim = TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
    >(
        engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>,
        newArgumentId: string,
        libraries: {
            claimLibrary: TClaimLookup<TClaim>
            sourceLibrary: TSourceLookup<TSource>
            claimSourceLibrary: TClaimSourceLookup<TAssoc>
        },
        options?: TForkArgumentOptions & {
            forkId?: string
            creatorId?: string
        }
    ): {
        engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
        remapTable: TForkRemapTable
        fork: TFork
    } {
        // 1. Guard
        if (!engine.canFork()) {
            throw new Error("Forking is not allowed for this engine.")
        }

        // 2. Snapshot source argument metadata for the fork record
        const sourceArg = engine.getArgument()

        // 3. Fork the engine
        const { engine: forkedEngine, remapTable } = forkArgumentEngine(
            engine,
            newArgumentId,
            libraries,
            options
        )

        // 4. Create fork record
        const forkId = options?.forkId ?? randomUUID()
        const fork = this.create({
            id: forkId,
            sourceArgumentId: sourceArg.id,
            sourceArgumentVersion: sourceArg.version,
            createdOn: new Date().toISOString(),
            ...(options?.creatorId ? { creatorId: options.creatorId } : {}),
        } as Omit<TFork, "checksum">)

        // 5. Set forkId on all entities in the forked engine
        //    Snapshot → inject forkId → restore
        const snap = forkedEngine.snapshot()
        snap.argument = { ...snap.argument, forkId } as typeof snap.argument
        for (const ps of snap.premises) {
            ps.premise = { ...ps.premise, forkId } as typeof ps.premise
            ps.expressions.expressions = ps.expressions.expressions.map(
                (expr) => ({ ...expr, forkId }) as typeof expr
            )
        }
        snap.variables.variables = snap.variables.variables.map(
            (v) => ({ ...v, forkId }) as typeof v
        )

        const finalEngine = ArgumentEngine.fromSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            snap,
            libraries.claimLibrary,
            libraries.sourceLibrary,
            libraries.claimSourceLibrary,
            snap.config?.grammarConfig,
            "ignore"
        )

        return { engine: finalEngine, remapTable, fork }
    }
```

- [ ] **Step 4: Remove `forkArgument()` from ArgumentEngine**

In `src/lib/core/argument-engine.ts`:

1. Delete the `forkArgument()` method (lines ~2582-2764).
2. Remove any now-unused imports that were only used by `forkArgument()` (e.g., `isPremiseBound` if not used elsewhere, `serializeChecksumConfig` if not used elsewhere). Check carefully before removing.
3. Keep `canFork()` (now public).

- [ ] **Step 5: Update `TForkArgumentResult` type**

In `src/lib/types/fork.ts`, update `TForkArgumentResult` to include the fork record, or remove it if it's no longer used (since `ForksLibrary.forkArgument()` defines its own return type inline). Check if `TForkArgumentResult` is referenced anywhere else. If not, remove it. If it is used, update it to include `fork`.

- [ ] **Step 6: Update existing fork tests**

The existing tests in the `forkArgument` describe block (lines 17985-18678) call `eng.forkArgument(...)`. These must be updated to use `ForksLibrary.forkArgument()` or `forkArgumentEngine()`. For each existing test:

- Schema validation tests (lines 17986-18196): These don't call `forkArgument()` — no change needed.
- `canFork rejects` test (line 18198): Update to use `ForksLibrary.forkArgument()`.
- `forks a simple argument` test (line 18210): Update to use `ForksLibrary.forkArgument()`.
- `remaps parentId chains` test (line 18316): Update to use `ForksLibrary.forkArgument()`.
- `remap table covers all entities` test (line 18479): Update to use `ForksLibrary.forkArgument()`.
- `forked engine is independent` test (line 18558): Update to use `ForksLibrary.forkArgument()`.
- `forked entities are fully mutable` test (line 18592): Update to use `ForksLibrary.forkArgument()`.

Pattern for updating each test — replace:

```typescript
const { engine: forked, remapTable } = eng.forkArgument(
    "forked-arg",
    forkClaimLib,
    forkSourceLib,
    forkCsLib,
    options
)
```

with:

```typescript
const forksLib = new ForksLibrary()
const { engine: forked, remapTable } = forksLib.forkArgument(
    eng,
    "forked-arg",
    {
        claimLibrary: forkClaimLib,
        sourceLibrary: forkSourceLib,
        claimSourceLibrary: forkCsLib,
    },
    options
)
```

- [ ] **Step 7: Run all tests and typecheck**

Run: `pnpm run check`
Expected: PASS — all tests pass, types check, lint passes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/forks-library.ts src/lib/core/argument-engine.ts src/lib/types/fork.ts test/core.test.ts
git commit -m "feat: add ForksLibrary.forkArgument() and remove engine method"
```

---

### Task 8: Update `createForkedFromMatcher()` regression test

**Files:**

- Modify: `test/core.test.ts`

- [ ] **Step 1: Add regression test**

Add inside the `ForksLibrary` describe block. This confirms that `createForkedFromMatcher()` continues to work with the new fork flow:

```typescript
it("createForkedFromMatcher() works with ForksLibrary-forked engines", () => {
    const claimLib = aLib()
    const sourceLib = sLib()
    const csLibrary = new ClaimSourceLibrary(claimLib, sourceLib)
    const eng = new ArgumentEngine(
        { id: "src-arg", version: 0 },
        claimLib,
        sourceLib,
        csLibrary
    )

    eng.addVariable({
        id: "var-p",
        argumentId: "src-arg",
        argumentVersion: 0,
        symbol: "P",
        claimId: "claim-default",
        claimVersion: 0,
    } as TClaimBoundVariable)

    const { result: pm } = eng.createPremiseWithId("prem-1")
    pm.addExpression({
        id: "expr-1",
        argumentId: "src-arg",
        argumentVersion: 0,
        premiseId: "prem-1",
        type: "variable",
        variableId: "var-p",
        parentId: null,
        position: POSITION_INITIAL,
    })

    const forksLib = new ForksLibrary()
    const forkClaimLib = aLib()
    const forkSourceLib = sLib()
    const forkCsLib = new ClaimSourceLibrary(forkClaimLib, forkSourceLib)

    const { engine: forked } = forksLib.forkArgument(eng, "fork-arg", {
        claimLibrary: forkClaimLib,
        sourceLibrary: forkSourceLib,
        claimSourceLibrary: forkCsLib,
    })

    // Diff with forked-from matchers
    const matchers = createForkedFromMatcher()
    const diff = diffArguments(eng, forked, matchers)

    // Premises should be paired (not added/removed)
    expect(diff.premises.added).toHaveLength(0)
    expect(diff.premises.removed).toHaveLength(0)

    // Expressions should be paired
    expect(diff.expressions.added).toHaveLength(0)
    expect(diff.expressions.removed).toHaveLength(0)
})
```

Import `diffArguments` and `createForkedFromMatcher` from `../src/lib/index` if not already imported.

- [ ] **Step 2: Run test**

Run: `pnpm vitest run test/core.test.ts -t "createForkedFromMatcher"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add createForkedFromMatcher regression test with ForksLibrary"
```

---

### Task 9: Update documentation

**Files:**

- Modify: `docs/api-reference.md`
- Modify: `README.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Update API reference**

Add a `ForksLibrary` section to `docs/api-reference.md` documenting:

- `ForksLibrary<TFork>` class
- `create()`, `get()`, `getAll()`, `remove()`, `snapshot()`, `fromSnapshot()`
- `forkArgument()` method
- `TCoreFork`, `TForkLookup`, `TForksLibrarySnapshot` types
- `forkArgumentEngine()` standalone function
- Note that `ArgumentEngine.forkArgument()` has been removed (breaking change)
- Note that `canFork()` is now public

- [ ] **Step 2: Update README forking section**

Update the forking section in `README.md` to use `ForksLibrary.forkArgument()` instead of `engine.forkArgument()`.

- [ ] **Step 3: Write release notes**

Update `docs/release-notes/upcoming.md` with user-facing changes:

- New: `ForksLibrary` for managing fork records
- New: `forkArgumentEngine()` standalone function
- New: `forkId` field on all entity schemas
- Changed: `canFork()` is now public
- Breaking: `ArgumentEngine.forkArgument()` removed — use `ForksLibrary.forkArgument()` instead

- [ ] **Step 4: Write changelog**

Update `docs/changelogs/upcoming.md` with developer-facing details.

- [ ] **Step 5: Commit**

```bash
git add docs/api-reference.md README.md docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: update documentation for ForksLibrary"
```

---

### Task 10: Final lint, typecheck, and full test run

**Files:** None (validation only)

- [ ] **Step 1: Run the full check suite**

Run: `pnpm run check`
Expected: PASS — typecheck, lint, all tests pass, build succeeds.

- [ ] **Step 2: Fix any issues**

If lint fails, run `pnpm eslint . --fix` then `pnpm run prettify`. Re-run `pnpm run check`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint and formatting"
```

---

### Task 11: Clean up change request

**Files:**

- Delete: `docs/change-requests/2026-03-28-forks-library.md`

- [ ] **Step 1: Delete the change request file**

Per CLAUDE.md: "After a change request is fully implemented, delete its markdown file from `docs/change-requests/`."

```bash
rm docs/change-requests/2026-03-28-forks-library.md
git add docs/change-requests/2026-03-28-forks-library.md
git commit -m "chore: remove completed forks-library change request"
```
