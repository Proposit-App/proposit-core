# Global Libraries Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `AssertionLibrary` and `SourceLibrary` as global, inter-argument entity repositories with versioning and freeze semantics, and integrate them as required `ArgumentEngine` dependencies.

**Architecture:** Libraries are standalone generic classes with CRUD + version + freeze. The engine depends on narrow read-only lookup interfaces (`TAssertionLookup`, `TSourceLookup`) for validation. `SourceManager` is stripped to association-only. `TSource` generic is removed from changeset/mutation/diff types.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

**Design doc:** `docs/plans/2026-03-13-global-libraries-design.md`

---

## Chunk 1: Schema and Type Foundation

### Task 1: CoreAssertionSchema

**Files:**

- Create: `src/lib/schemata/assertion.ts`
- Modify: `src/lib/schemata/index.ts`

- [ ] **Step 1: Write the assertion schema**

Create `src/lib/schemata/assertion.ts`:

```typescript
import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreAssertionSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number({
            description: "Assertion version number. Starts at 0.",
        }),
        frozen: Type.Boolean({
            description:
                "Whether this version is frozen (immutable). Frozen versions cannot be updated.",
        }),
        checksum: Type.String({
            description: "Entity-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A global assertion representing propositional content. Variables reference assertions by ID and version.",
    }
)
export type TCoreAssertion = Static<typeof CoreAssertionSchema>
```

- [ ] **Step 2: Export from schemata barrel**

In `src/lib/schemata/index.ts`, add:

```typescript
export * from "./assertion.js"
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 4: Commit**

```bash
git add src/lib/schemata/assertion.ts src/lib/schemata/index.ts
git commit -m "feat: add CoreAssertionSchema"
```

### Task 2: Update CoreSourceSchema

**Files:**

- Modify: `src/lib/schemata/source.ts`

- [ ] **Step 1: Write failing typecheck by removing argumentId/argumentVersion**

In `src/lib/schemata/source.ts`, replace the `CoreSourceSchema` definition (lines 4–18) with:

```typescript
export const CoreSourceSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number({
            description: "Source version number. Starts at 0.",
        }),
        frozen: Type.Boolean({
            description:
                "Whether this version is frozen (immutable). Frozen versions cannot be updated.",
        }),
        checksum: Type.String({
            description: "Source-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A global source entity providing evidentiary support for variables or expressions.",
    }
)
```

- [ ] **Step 2: Run typecheck to see what breaks**

Run: `pnpm run typecheck`
Expected: FAIL — downstream code references `source.argumentId` and `source.argumentVersion`

Note all error locations for later tasks. Do NOT fix them yet — later tasks handle each.

- [ ] **Step 3: Add sourceVersion to association schemas**

In the same file, update `CoreVariableSourceAssociationSchema` (lines 21–30) — add `sourceVersion` after `sourceId`:

```typescript
export const CoreVariableSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    sourceVersion: Type.Number({
        description: "The version of the source this association pins to.",
    }),
    variableId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String({
        description: "Association checksum for sync detection.",
    }),
})
```

Update `CoreExpressionSourceAssociationSchema` (lines 35–45) — add `sourceVersion` after `sourceId`:

```typescript
export const CoreExpressionSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    sourceVersion: Type.Number({
        description: "The version of the source this association pins to.",
    }),
    expressionId: UUID,
    premiseId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String({
        description: "Association checksum for sync detection.",
    }),
})
```

- [ ] **Step 4: Commit (typecheck will still fail — that's expected)**

```bash
git add src/lib/schemata/source.ts
git commit -m "feat: update CoreSourceSchema to global, add sourceVersion to associations"
```

### Task 3: Update CorePropositionalVariableSchema

**Files:**

- Modify: `src/lib/schemata/propositional.ts`

- [ ] **Step 1: Add assertionId and assertionVersion**

In `src/lib/schemata/propositional.ts`, update `CorePropositionalVariableSchema` (lines 93–111). Add `assertionId` and `assertionVersion` after `symbol` and before `checksum`:

```typescript
export const CorePropositionalVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String({
            description:
                'Human-readable symbol for this variable (e.g. "P", "Q").',
        }),
        assertionId: UUID,
        assertionVersion: Type.Number({
            description:
                "The version of the assertion this variable references.",
        }),
        checksum: Type.String({
            description: "Entity-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A named propositional variable belonging to a specific argument version, referencing a global assertion.",
    }
)
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemata/propositional.ts
git commit -m "feat: add assertionId/assertionVersion to CorePropositionalVariableSchema"
```

### Task 4: Update TCoreChecksumConfig and DEFAULT_CHECKSUM_CONFIG

**Files:**

- Modify: `src/lib/types/checksum.ts`
- Modify: `src/lib/consts.ts`

- [ ] **Step 1: Add assertionFields to TCoreChecksumConfig**

In `src/lib/types/checksum.ts`, add after `roleFields` (line 12):

```typescript
    /** Fields to hash for assertion entities. Defaults to ["id", "version"]. */
    assertionFields?: Set<string>
```

- [ ] **Step 2: Update DEFAULT_CHECKSUM_CONFIG**

In `src/lib/consts.ts`, update the config object:

1. Add `assertionFields` after `roleFields` (after line 18):

```typescript
    assertionFields: new Set(["id", "version"]),
```

2. Update `sourceFields` (line 19) from `new Set(["id", "argumentId", "argumentVersion"])` to:

```typescript
    sourceFields: new Set(["id", "version"]),
```

3. Update `variableFields` (line 15) to add assertion fields:

```typescript
    variableFields: new Set([
        "id",
        "symbol",
        "argumentId",
        "argumentVersion",
        "assertionId",
        "assertionVersion",
    ]),
```

4. Add `sourceVersion` to `variableSourceAssociationFields` (lines 20–26):

```typescript
    variableSourceAssociationFields: new Set([
        "id",
        "sourceId",
        "sourceVersion",
        "variableId",
        "argumentId",
        "argumentVersion",
    ]),
```

5. Add `sourceVersion` to `expressionSourceAssociationFields` (lines 27–34):

```typescript
    expressionSourceAssociationFields: new Set([
        "id",
        "sourceId",
        "sourceVersion",
        "expressionId",
        "premiseId",
        "argumentId",
        "argumentVersion",
    ]),
```

6. Add `"assertionFields"` to the `keys` array in `createChecksumConfig()` (line 44–53):

```typescript
const keys = [
    "expressionFields",
    "variableFields",
    "premiseFields",
    "argumentFields",
    "roleFields",
    "assertionFields",
    "sourceFields",
    "variableSourceAssociationFields",
    "expressionSourceAssociationFields",
] as const
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/checksum.ts src/lib/consts.ts
git commit -m "feat: update checksum config for assertions and global sources"
```

### Task 5: Update TCoreChangeset and TCoreMutationResult — drop TSource

**Files:**

- Modify: `src/lib/types/mutation.ts`

- [ ] **Step 1: Remove TSource generic and sources field**

Replace the entire file content:

```typescript
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type {
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"

/** Added/modified/removed entities of one type within a single mutation. */
export interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[]
    removed: T[]
}

/**
 * Entity-typed changeset produced by every mutating operation.
 * Only categories that were actually affected are present.
 */
export interface TCoreChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    /** New role state, present only when roles changed. */
    roles?: TCoreArgumentRoleState
    /** New argument metadata, present only when argument changed. */
    argument?: TArg
    variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>
    expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>
}

/**
 * Every mutating method returns this wrapper.
 * `result` is the direct answer (e.g. the removed expression).
 * `changes` is the full set of DB-level side effects.
 */
export interface TCoreMutationResult<
    T,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    result: T
    changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
}
```

- [ ] **Step 2: Commit (typecheck will fail — many consumers pass TSource generic)**

```bash
git add src/lib/types/mutation.ts
git commit -m "feat: remove TSource generic from TCoreChangeset and TCoreMutationResult"
```

### Task 6: Update TReactiveSnapshot — drop sources

**Files:**

- Modify: `src/lib/types/reactive.ts`

- [ ] **Step 1: Remove TSource generic and sources field**

Replace the file:

```typescript
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"
import type { TCoreArgumentRoleState } from "./evaluation.js"

export type TReactivePremiseSnapshot<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = {
    premise: TPremise
    expressions: Record<string, TExpr>
    rootExpressionId: string | undefined
}

export type TReactiveSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    argument: TArg
    variables: Record<string, TVar>
    premises: Record<string, TReactivePremiseSnapshot<TPremise, TExpr>>
    roles: TCoreArgumentRoleState
    variableSourceAssociations: Record<string, TCoreVariableSourceAssociation>
    expressionSourceAssociations: Record<
        string,
        TCoreExpressionSourceAssociation
    >
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types/reactive.ts
git commit -m "feat: remove TSource and sources from TReactiveSnapshot"
```

### Task 7: Update diff types — drop TSource

**Files:**

- Modify: `src/lib/types/diff.ts`

- [ ] **Step 1: Remove TSource from TCoreArgumentDiff and TCoreDiffOptions, drop sources field**

In `src/lib/types/diff.ts`:

1. Remove `TCoreSource` from the import (line 6).
2. In `TCoreArgumentDiff` (lines 55–69): remove `TSource` generic param and `sources` field.
3. In `TCoreDiffOptions` (lines 78–92): remove `TSource` generic param and `compareSource` field.

The updated types:

```typescript
/** Top-level diff result from `diffArguments`. */
export interface TCoreArgumentDiff<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    argument: TCoreEntityFieldDiff<TArg>
    variables: TCoreEntitySetDiff<TVar>
    premises: TCorePremiseSetDiff<TPremise, TExpr>
    roles: TCoreRoleDiff
    variableSourceAssociations: TCoreEntitySetDiff<TCoreVariableSourceAssociation>
    expressionSourceAssociations: TCoreEntitySetDiff<TCoreExpressionSourceAssociation>
}

/** Per-entity comparator overrides for `diffArguments`. */
export interface TCoreDiffOptions<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    compareArgument?: TCoreFieldComparator<TArg>
    compareVariable?: TCoreFieldComparator<TVar>
    comparePremise?: TCoreFieldComparator<TPremise>
    compareExpression?: TCoreFieldComparator<TExpr>
    compareVariableSourceAssociation?: TCoreFieldComparator<TCoreVariableSourceAssociation>
    compareExpressionSourceAssociation?: TCoreFieldComparator<TCoreExpressionSourceAssociation>
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types/diff.ts
git commit -m "feat: remove TSource from diff types"
```

---

## Chunk 2: Library Classes

### Task 8: Library lookup interfaces

**Files:**

- Create: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`

- [ ] **Step 1: Write tests for lookup interface shape**

In `test/core.test.ts`, add a new describe block at the bottom:

```typescript
describe("Library lookup interfaces", () => {
    it("TAssertionLookup has get method", () => {
        const lookup: TAssertionLookup = {
            get: (_id: string, _version: number) => undefined,
        }
        expect(lookup.get("x", 0)).toBeUndefined()
    })

    it("TSourceLookup has get method", () => {
        const lookup: TSourceLookup = {
            get: (_id: string, _version: number) => undefined,
        }
        expect(lookup.get("x", 0)).toBeUndefined()
    })
})
```

Add imports at the top of test file:

```typescript
import type {
    TAssertionLookup,
    TSourceLookup,
} from "../src/lib/core/interfaces/library.interfaces"
import type { TCoreAssertion } from "../src/lib/schemata/assertion"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test`
Expected: FAIL — module not found

- [ ] **Step 3: Create the interfaces file**

Create `src/lib/core/interfaces/library.interfaces.ts`:

```typescript
import type { TCoreAssertion } from "../../schemata/assertion.js"
import type { TCoreSource } from "../../schemata/source.js"

/** Narrow read-only interface for assertion lookups. Used by ArgumentEngine for validation. */
export interface TAssertionLookup<
    TAssertion extends TCoreAssertion = TCoreAssertion,
> {
    get(id: string, version: number): TAssertion | undefined
}

/** Narrow read-only interface for source lookups. Used by ArgumentEngine for validation. */
export interface TSourceLookup<TSource extends TCoreSource = TCoreSource> {
    get(id: string, version: number): TSource | undefined
}

/** Serializable snapshot of an AssertionLibrary. */
export type TAssertionLibrarySnapshot<
    TAssertion extends TCoreAssertion = TCoreAssertion,
> = {
    assertions: TAssertion[]
}

/** Serializable snapshot of a SourceLibrary. */
export type TSourceLibrarySnapshot<TSource extends TCoreSource = TCoreSource> =
    {
        sources: TSource[]
    }
```

- [ ] **Step 4: Export from interfaces barrel**

In `src/lib/core/interfaces/index.ts`, add:

```typescript
export type {
    TAssertionLookup,
    TSourceLookup,
    TAssertionLibrarySnapshot,
    TSourceLibrarySnapshot,
} from "./library.interfaces.js"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test -- --testNamePattern="Library lookup"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/interfaces/library.interfaces.ts src/lib/core/interfaces/index.ts test/core.test.ts
git commit -m "feat: add TAssertionLookup and TSourceLookup interfaces"
```

### Task 9: AssertionLibrary class

**Files:**

- Create: `src/lib/core/assertion-library.ts`

- [ ] **Step 1: Write tests for AssertionLibrary**

Add to `test/core.test.ts` — import `AssertionLibrary` at top, then add describe block:

```typescript
import { AssertionLibrary } from "../src/lib/core/assertion-library"
```

```typescript
describe("AssertionLibrary", () => {
    function makeLibrary() {
        return new AssertionLibrary()
    }

    describe("create", () => {
        it("creates an assertion at version 0, unfrozen", () => {
            const lib = makeLibrary()
            const a = lib.create({ id: "a1" })
            expect(a.id).toBe("a1")
            expect(a.version).toBe(0)
            expect(a.frozen).toBe(false)
            expect(a.checksum).toBeTruthy()
        })

        it("throws on duplicate ID", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            expect(() => lib.create({ id: "a1" })).toThrow("already exists")
        })
    })

    describe("get", () => {
        it("returns undefined for nonexistent", () => {
            const lib = makeLibrary()
            expect(lib.get("x", 0)).toBeUndefined()
        })

        it("returns the assertion at a specific version", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            const result = lib.get("a1", 0)
            expect(result).toBeDefined()
            expect(result!.version).toBe(0)
        })
    })

    describe("getCurrent", () => {
        it("returns the highest version", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            lib.freeze("a1")
            const current = lib.getCurrent("a1")
            expect(current!.version).toBe(1)
        })
    })

    describe("update", () => {
        it("throws when latest is frozen", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            lib.freeze("a1")
            lib.freeze("a1") // freeze v1 too
            // now latest (v2) is unfrozen, should work
            lib.update("a1", {})
        })

        it("throws when ID does not exist", () => {
            const lib = makeLibrary()
            expect(() => lib.update("nope", {})).toThrow("does not exist")
        })

        it("updates the highest version", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            const updated = lib.update("a1", {})
            expect(updated.version).toBe(0)
        })
    })

    describe("freeze", () => {
        it("freezes current and creates next version", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            const { frozen, current } = lib.freeze("a1")
            expect(frozen.version).toBe(0)
            expect(frozen.frozen).toBe(true)
            expect(current.version).toBe(1)
            expect(current.frozen).toBe(false)
        })

        it("throws when latest is already frozen", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            lib.freeze("a1")
            lib.freeze("a1")
            lib.freeze("a1")
            // After 3 freezes: v0 frozen, v1 frozen, v2 frozen, v3 unfrozen
            const v3 = lib.getCurrent("a1")
            expect(v3!.version).toBe(3)
            expect(v3!.frozen).toBe(false)
        })

        it("throws when ID does not exist", () => {
            const lib = makeLibrary()
            expect(() => lib.freeze("nope")).toThrow("does not exist")
        })
    })

    describe("getAll / getVersions", () => {
        it("returns all versions of all assertions", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            lib.freeze("a1")
            lib.create({ id: "a2" })
            expect(lib.getAll()).toHaveLength(3)
        })

        it("returns versions for a specific ID", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            lib.freeze("a1")
            expect(lib.getVersions("a1")).toHaveLength(2)
        })
    })

    describe("snapshot / fromSnapshot", () => {
        it("round-trips", () => {
            const lib = makeLibrary()
            lib.create({ id: "a1" })
            lib.freeze("a1")
            const snap = lib.snapshot()
            const restored = AssertionLibrary.fromSnapshot(snap)
            expect(restored.get("a1", 0)!.frozen).toBe(true)
            expect(restored.get("a1", 1)!.frozen).toBe(false)
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --testNamePattern="AssertionLibrary"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AssertionLibrary**

Create `src/lib/core/assertion-library.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --testNamePattern="AssertionLibrary"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/assertion-library.ts test/core.test.ts
git commit -m "feat: implement AssertionLibrary with versioning and freeze"
```

### Task 10: SourceLibrary class

**Files:**

- Create: `src/lib/core/source-library.ts`

- [ ] **Step 1: Write tests for SourceLibrary**

Add to `test/core.test.ts` — import `SourceLibrary` at top:

```typescript
import { SourceLibrary } from "../src/lib/core/source-library"
```

```typescript
describe("SourceLibrary", () => {
    function makeLibrary() {
        return new SourceLibrary()
    }

    it("creates a source at version 0, unfrozen", () => {
        const lib = makeLibrary()
        const s = lib.create({ id: "s1" })
        expect(s.version).toBe(0)
        expect(s.frozen).toBe(false)
        expect(s.checksum).toBeTruthy()
    })

    it("freeze creates next version", () => {
        const lib = makeLibrary()
        lib.create({ id: "s1" })
        const { frozen, current } = lib.freeze("s1")
        expect(frozen.version).toBe(0)
        expect(frozen.frozen).toBe(true)
        expect(current.version).toBe(1)
        expect(current.frozen).toBe(false)
    })

    it("snapshot round-trips", () => {
        const lib = makeLibrary()
        lib.create({ id: "s1" })
        lib.freeze("s1")
        const restored = SourceLibrary.fromSnapshot(lib.snapshot())
        expect(restored.get("s1", 0)!.frozen).toBe(true)
        expect(restored.get("s1", 1)!.frozen).toBe(false)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --testNamePattern="SourceLibrary"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SourceLibrary**

Create `src/lib/core/source-library.ts` — same structure as AssertionLibrary but for `TCoreSource`:

```typescript
import type { TCoreSource } from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TSourceLookup,
    TSourceLibrarySnapshot,
} from "./interfaces/library.interfaces.js"

export class SourceLibrary<
    TSource extends TCoreSource = TCoreSource,
> implements TSourceLookup<TSource> {
    private entities: Map<string, Map<number, TSource>>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.entities = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    public create(
        source: Omit<TSource, "version" | "frozen" | "checksum">
    ): TSource {
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
    }

    public update(
        id: string,
        updates: Partial<
            Omit<TSource, "id" | "version" | "frozen" | "checksum">
        >
    ): TSource {
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
    }

    public freeze(id: string): { frozen: TSource; current: TSource } {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --testNamePattern="SourceLibrary"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/source-library.ts test/core.test.ts
git commit -m "feat: implement SourceLibrary with versioning and freeze"
```

---

## Chunk 3: SourceManager Simplification and ChangeCollector

### Task 11: Strip SourceManager to association-only

**Files:**

- Modify: `src/lib/core/source-manager.ts`

- [ ] **Step 1: Rewrite SourceManager**

Remove source entity storage, orphan cleanup, and update snapshot type. The class retains association CRUD and queries with lazy `sourceToAssociations` init.

Replace the entire file with:

```typescript
import type {
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"

export interface TSourceAssociationRemovalResult {
    removedVariableAssociations: TCoreVariableSourceAssociation[]
    removedExpressionAssociations: TCoreExpressionSourceAssociation[]
}

export interface TSourceManagerSnapshot {
    variableSourceAssociations: TCoreVariableSourceAssociation[]
    expressionSourceAssociations: TCoreExpressionSourceAssociation[]
}

/**
 * Registry for source associations to variables and expressions within an
 * argument. Source entities themselves live in SourceLibrary.
 */
export class SourceManager {
    private variableAssociations: Map<string, TCoreVariableSourceAssociation>
    private expressionAssociations: Map<
        string,
        TCoreExpressionSourceAssociation
    >
    private sourceToAssociations: Map<string, Set<string>>
    private variableToAssociations: Map<string, Set<string>>
    private expressionToAssociations: Map<string, Set<string>>

    constructor() {
        this.variableAssociations = new Map()
        this.expressionAssociations = new Map()
        this.sourceToAssociations = new Map()
        this.variableToAssociations = new Map()
        this.expressionToAssociations = new Map()
    }

    // -----------------------------------------------------------------------
    // Variable association mutations
    // -----------------------------------------------------------------------

    public addVariableSourceAssociation(
        assoc: TCoreVariableSourceAssociation
    ): void {
        if (this.variableAssociations.has(assoc.id)) {
            throw new Error(
                `Variable-source association with ID "${assoc.id}" already exists.`
            )
        }
        this.variableAssociations.set(assoc.id, assoc)

        let sourceSet = this.sourceToAssociations.get(assoc.sourceId)
        if (!sourceSet) {
            sourceSet = new Set()
            this.sourceToAssociations.set(assoc.sourceId, sourceSet)
        }
        sourceSet.add(assoc.id)

        let varSet = this.variableToAssociations.get(assoc.variableId)
        if (!varSet) {
            varSet = new Set()
            this.variableToAssociations.set(assoc.variableId, varSet)
        }
        varSet.add(assoc.id)
    }

    public removeVariableSourceAssociation(
        id: string
    ): TSourceAssociationRemovalResult {
        const assoc = this.variableAssociations.get(id)
        if (!assoc) {
            throw new Error(
                `Variable-source association "${id}" does not exist.`
            )
        }
        this.variableAssociations.delete(id)

        const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
        if (sourceSet) {
            sourceSet.delete(id)
            if (sourceSet.size === 0) {
                this.sourceToAssociations.delete(assoc.sourceId)
            }
        }

        const varSet = this.variableToAssociations.get(assoc.variableId)
        if (varSet) {
            varSet.delete(id)
            if (varSet.size === 0) {
                this.variableToAssociations.delete(assoc.variableId)
            }
        }

        return {
            removedVariableAssociations: [assoc],
            removedExpressionAssociations: [],
        }
    }

    // -----------------------------------------------------------------------
    // Expression association mutations
    // -----------------------------------------------------------------------

    public addExpressionSourceAssociation(
        assoc: TCoreExpressionSourceAssociation
    ): void {
        if (this.expressionAssociations.has(assoc.id)) {
            throw new Error(
                `Expression-source association with ID "${assoc.id}" already exists.`
            )
        }
        this.expressionAssociations.set(assoc.id, assoc)

        let sourceSet = this.sourceToAssociations.get(assoc.sourceId)
        if (!sourceSet) {
            sourceSet = new Set()
            this.sourceToAssociations.set(assoc.sourceId, sourceSet)
        }
        sourceSet.add(assoc.id)

        let exprSet = this.expressionToAssociations.get(assoc.expressionId)
        if (!exprSet) {
            exprSet = new Set()
            this.expressionToAssociations.set(assoc.expressionId, exprSet)
        }
        exprSet.add(assoc.id)
    }

    public removeExpressionSourceAssociation(
        id: string
    ): TSourceAssociationRemovalResult {
        const assoc = this.expressionAssociations.get(id)
        if (!assoc) {
            throw new Error(
                `Expression-source association "${id}" does not exist.`
            )
        }
        this.expressionAssociations.delete(id)

        const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
        if (sourceSet) {
            sourceSet.delete(id)
            if (sourceSet.size === 0) {
                this.sourceToAssociations.delete(assoc.sourceId)
            }
        }

        const exprSet = this.expressionToAssociations.get(assoc.expressionId)
        if (exprSet) {
            exprSet.delete(id)
            if (exprSet.size === 0) {
                this.expressionToAssociations.delete(assoc.expressionId)
            }
        }

        return {
            removedVariableAssociations: [],
            removedExpressionAssociations: [assoc],
        }
    }

    // -----------------------------------------------------------------------
    // Bulk association removal
    // -----------------------------------------------------------------------

    public removeAssociationsForVariable(
        variableId: string
    ): TSourceAssociationRemovalResult {
        const assocIds = this.variableToAssociations.get(variableId)
        if (!assocIds || assocIds.size === 0) {
            return {
                removedVariableAssociations: [],
                removedExpressionAssociations: [],
            }
        }

        const removedVariableAssociations: TCoreVariableSourceAssociation[] = []
        for (const assocId of assocIds) {
            const assoc = this.variableAssociations.get(assocId)
            if (!assoc) continue
            this.variableAssociations.delete(assocId)

            const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.delete(assocId)
                if (sourceSet.size === 0) {
                    this.sourceToAssociations.delete(assoc.sourceId)
                }
            }
            removedVariableAssociations.push(assoc)
        }

        this.variableToAssociations.delete(variableId)

        return {
            removedVariableAssociations,
            removedExpressionAssociations: [],
        }
    }

    public removeAssociationsForExpression(
        expressionId: string
    ): TSourceAssociationRemovalResult {
        const assocIds = this.expressionToAssociations.get(expressionId)
        if (!assocIds || assocIds.size === 0) {
            return {
                removedVariableAssociations: [],
                removedExpressionAssociations: [],
            }
        }

        const removedExpressionAssociations: TCoreExpressionSourceAssociation[] =
            []
        for (const assocId of assocIds) {
            const assoc = this.expressionAssociations.get(assocId)
            if (!assoc) continue
            this.expressionAssociations.delete(assocId)

            const sourceSet = this.sourceToAssociations.get(assoc.sourceId)
            if (sourceSet) {
                sourceSet.delete(assocId)
                if (sourceSet.size === 0) {
                    this.sourceToAssociations.delete(assoc.sourceId)
                }
            }
            removedExpressionAssociations.push(assoc)
        }

        this.expressionToAssociations.delete(expressionId)

        return {
            removedVariableAssociations: [],
            removedExpressionAssociations,
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    public getAssociationsForSource(sourceId: string): {
        variable: TCoreVariableSourceAssociation[]
        expression: TCoreExpressionSourceAssociation[]
    } {
        const assocIds = this.sourceToAssociations.get(sourceId)
        if (!assocIds) return { variable: [], expression: [] }

        const variable: TCoreVariableSourceAssociation[] = []
        const expression: TCoreExpressionSourceAssociation[] = []
        for (const assocId of assocIds) {
            const varAssoc = this.variableAssociations.get(assocId)
            if (varAssoc) {
                variable.push(varAssoc)
                continue
            }
            const exprAssoc = this.expressionAssociations.get(assocId)
            if (exprAssoc) expression.push(exprAssoc)
        }
        return { variable, expression }
    }

    public getAssociationsForVariable(
        variableId: string
    ): TCoreVariableSourceAssociation[] {
        const assocIds = this.variableToAssociations.get(variableId)
        if (!assocIds) return []
        const result: TCoreVariableSourceAssociation[] = []
        for (const assocId of assocIds) {
            const assoc = this.variableAssociations.get(assocId)
            if (assoc) result.push(assoc)
        }
        return result
    }

    public getAssociationsForExpression(
        expressionId: string
    ): TCoreExpressionSourceAssociation[] {
        const assocIds = this.expressionToAssociations.get(expressionId)
        if (!assocIds) return []
        const result: TCoreExpressionSourceAssociation[] = []
        for (const assocId of assocIds) {
            const assoc = this.expressionAssociations.get(assocId)
            if (assoc) result.push(assoc)
        }
        return result
    }

    public getAllVariableSourceAssociations(): TCoreVariableSourceAssociation[] {
        return Array.from(this.variableAssociations.values())
    }

    public getAllExpressionSourceAssociations(): TCoreExpressionSourceAssociation[] {
        return Array.from(this.expressionAssociations.values())
    }

    // -----------------------------------------------------------------------
    // Snapshot & restoration
    // -----------------------------------------------------------------------

    public snapshot(): TSourceManagerSnapshot {
        return {
            variableSourceAssociations: Array.from(
                this.variableAssociations.values()
            ).sort((a, b) => a.id.localeCompare(b.id)),
            expressionSourceAssociations: Array.from(
                this.expressionAssociations.values()
            ).sort((a, b) => a.id.localeCompare(b.id)),
        }
    }

    public static fromSnapshot(data: TSourceManagerSnapshot): SourceManager {
        const sm = new SourceManager()

        for (const assoc of data.variableSourceAssociations) {
            sm.variableAssociations.set(assoc.id, assoc)

            let sourceSet = sm.sourceToAssociations.get(assoc.sourceId)
            if (!sourceSet) {
                sourceSet = new Set()
                sm.sourceToAssociations.set(assoc.sourceId, sourceSet)
            }
            sourceSet.add(assoc.id)

            let varSet = sm.variableToAssociations.get(assoc.variableId)
            if (!varSet) {
                varSet = new Set()
                sm.variableToAssociations.set(assoc.variableId, varSet)
            }
            varSet.add(assoc.id)
        }

        for (const assoc of data.expressionSourceAssociations) {
            sm.expressionAssociations.set(assoc.id, assoc)

            let sourceSet = sm.sourceToAssociations.get(assoc.sourceId)
            if (!sourceSet) {
                sourceSet = new Set()
                sm.sourceToAssociations.set(assoc.sourceId, sourceSet)
            }
            sourceSet.add(assoc.id)

            let exprSet = sm.expressionToAssociations.get(assoc.expressionId)
            if (!exprSet) {
                exprSet = new Set()
                sm.expressionToAssociations.set(assoc.expressionId, exprSet)
            }
            exprSet.add(assoc.id)
        }

        return sm
    }
}
```

- [ ] **Step 2: Commit (typecheck will fail until engine is updated)**

```bash
git add src/lib/core/source-manager.ts
git commit -m "feat: strip SourceManager to association-only management"
```

### Task 12: Update ChangeCollector — drop TSource

**Files:**

- Modify: `src/lib/core/change-collector.ts`

- [ ] **Step 1: Remove TSource generic, addedSource/removedSource methods, sources field**

Remove `TCoreSource` import, `TSource` generic param, `sources` private field, `addedSource`/`removedSource` methods, and the `sources` line in `toChangeset()`.

The updated file:

```typescript
import type { TCorePremise } from "../schemata/index.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/propositional.js"
import type {
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/source.js"
import type { TCoreEntityChanges, TCoreChangeset } from "../types/mutation.js"

function emptyEntityChanges<T>(): TCoreEntityChanges<T> {
    return { added: [], modified: [], removed: [] }
}

function isEntityChangesEmpty<T>(ec: TCoreEntityChanges<T>): boolean {
    return (
        ec.added.length === 0 &&
        ec.modified.length === 0 &&
        ec.removed.length === 0
    )
}

export class ChangeCollector<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    private expressions: TCoreEntityChanges<TExpr> = emptyEntityChanges()
    private variables: TCoreEntityChanges<TVar> = emptyEntityChanges()
    private premises: TCoreEntityChanges<TPremise> = emptyEntityChanges()
    private roles: TCoreArgumentRoleState | undefined = undefined
    private argument: TArg | undefined = undefined
    private variableSourceAssociations: TCoreEntityChanges<TCoreVariableSourceAssociation> =
        emptyEntityChanges()
    private expressionSourceAssociations: TCoreEntityChanges<TCoreExpressionSourceAssociation> =
        emptyEntityChanges()

    addedExpression(expr: TExpr): void {
        this.expressions.added.push(expr)
    }
    modifiedExpression(expr: TExpr): void {
        this.expressions.modified.push(expr)
    }
    removedExpression(expr: TExpr): void {
        this.expressions.removed.push(expr)
    }

    addedVariable(variable: TVar): void {
        this.variables.added.push(variable)
    }
    modifiedVariable(variable: TVar): void {
        this.variables.modified.push(variable)
    }
    removedVariable(variable: TVar): void {
        this.variables.removed.push(variable)
    }

    addedPremise(premise: TPremise): void {
        this.premises.added.push(premise)
    }
    removedPremise(premise: TPremise): void {
        this.premises.removed.push(premise)
    }

    setRoles(roles: TCoreArgumentRoleState): void {
        this.roles = roles
    }

    setArgument(argument: TArg): void {
        this.argument = argument
    }

    addedVariableSourceAssociation(
        assoc: TCoreVariableSourceAssociation
    ): void {
        this.variableSourceAssociations.added.push(assoc)
    }
    removedVariableSourceAssociation(
        assoc: TCoreVariableSourceAssociation
    ): void {
        this.variableSourceAssociations.removed.push(assoc)
    }

    addedExpressionSourceAssociation(
        assoc: TCoreExpressionSourceAssociation
    ): void {
        this.expressionSourceAssociations.added.push(assoc)
    }
    removedExpressionSourceAssociation(
        assoc: TCoreExpressionSourceAssociation
    ): void {
        this.expressionSourceAssociations.removed.push(assoc)
    }

    toChangeset(): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        const cs: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
        if (!isEntityChangesEmpty(this.expressions))
            cs.expressions = this.expressions
        if (!isEntityChangesEmpty(this.variables)) cs.variables = this.variables
        if (!isEntityChangesEmpty(this.premises)) cs.premises = this.premises
        if (this.roles !== undefined) cs.roles = this.roles
        if (this.argument !== undefined) cs.argument = this.argument
        if (!isEntityChangesEmpty(this.variableSourceAssociations))
            cs.variableSourceAssociations = this.variableSourceAssociations
        if (!isEntityChangesEmpty(this.expressionSourceAssociations))
            cs.expressionSourceAssociations = this.expressionSourceAssociations
        return cs
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/core/change-collector.ts
git commit -m "feat: remove TSource from ChangeCollector"
```

### Task 13: Update argument-engine.interfaces.ts — drop TSource

**Files:**

- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`

- [ ] **Step 1: Remove TSource generic from all interfaces**

In `argument-engine.interfaces.ts`:

1. Remove `TCoreSource` from imports (line 7)
2. Remove `TSource extends TCoreSource = TCoreSource` generic param from `TPremiseCrud`, `TVariableManagement`, `TArgumentRoleState`, `TArgumentLifecycle`
3. Remove `TSource` from all `TCoreMutationResult` return types (drop the 6th generic arg)
4. Remove `TSource` from all `PremiseEngine` type params
5. Remove `TSource` from `TReactiveSnapshot` usage in `getSnapshot()`
6. Remove `TSource` from `TArgumentEngineSnapshot` usage in `snapshot()` and `rollback()`
7. Update `updateVariable` JSDoc to reflect new `{ symbol?; assertionId?; assertionVersion? }` updates param

- [ ] **Step 2: Commit**

```bash
git add src/lib/core/interfaces/argument-engine.interfaces.ts
git commit -m "feat: remove TSource from argument engine interfaces"
```

### Task 14: Update premise-engine.interfaces.ts — drop TSource

**Files:**

- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`

- [ ] **Step 1: Remove TSource generic from all interfaces**

In `premise-engine.interfaces.ts`:

1. Remove `TCoreSource` from imports (line 6)
2. Remove `TSource extends TCoreSource = TCoreSource` generic param from `TExpressionMutations`, `TVariableReferences`, `TPremiseIdentity`
3. Remove `TSource` from all `TCoreMutationResult` return types (drop the 6th generic arg)
4. Update `addExpressionSourceAssociation` to accept `sourceVersion` parameter:

```typescript
    addExpressionSourceAssociation(
        sourceId: string,
        sourceVersion: number,
        expressionId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/core/interfaces/premise-engine.interfaces.ts
git commit -m "feat: remove TSource from premise engine interfaces, add sourceVersion"
```

### Task 15: Update TSourceManagement interface

**Files:**

- Modify: `src/lib/core/interfaces/source-management.interfaces.ts`

- [ ] **Step 1: Remove source entity methods, add sourceVersion to association methods**

Replace the entire file. Remove `addSource`, `removeSource`, `getSources`, `getSource`. Update `addVariableSourceAssociation` and `addExpressionSourceAssociation` to accept `sourceVersion`. Remove `TSource` from generic params and `TCoreMutationResult` usage:

```typescript
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../../schemata/index.js"
import type { TCoreMutationResult } from "../../types/mutation.js"

/**
 * Source association management and lookup for an argument.
 * Source entities live in SourceLibrary; this interface manages associations only.
 */
export interface TSourceManagement<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Creates an association between a source and a variable.
     *
     * @param sourceId - The ID of the source.
     * @param sourceVersion - The version of the source to associate.
     * @param variableId - The ID of the variable to associate.
     * @returns The created association and changeset.
     * @throws If the source does not exist in the source library.
     * @throws If the variable does not exist.
     */
    addVariableSourceAssociation(
        sourceId: string,
        sourceVersion: number,
        variableId: string
    ): TCoreMutationResult<
        TCoreVariableSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg
    >

    /**
     * Removes a variable-source association by its own ID.
     *
     * @param associationId - The ID of the association to remove.
     * @returns The removed association, or `undefined` if not found.
     */
    removeVariableSourceAssociation(
        associationId: string
    ): TCoreMutationResult<
        TCoreVariableSourceAssociation | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg
    >

    /**
     * Creates an association between a source and an expression within a
     * specific premise.
     *
     * @param sourceId - The ID of the source.
     * @param sourceVersion - The version of the source to associate.
     * @param expressionId - The ID of the expression to associate.
     * @param premiseId - The ID of the premise that owns the expression.
     * @returns The created association and changeset.
     * @throws If the source does not exist in the source library.
     * @throws If the expression does not exist in the specified premise.
     */
    addExpressionSourceAssociation(
        sourceId: string,
        sourceVersion: number,
        expressionId: string,
        premiseId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg
    >

    /**
     * Removes an expression-source association by its own ID.
     *
     * @param associationId - The ID of the association to remove.
     * @returns The removed association, or `undefined` if not found.
     */
    removeExpressionSourceAssociation(
        associationId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg
    >

    /**
     * Returns all variable and expression associations for a given source.
     * Returns associations across all source versions for that ID.
     */
    getAssociationsForSource(sourceId: string): {
        variable: TCoreVariableSourceAssociation[]
        expression: TCoreExpressionSourceAssociation[]
    }

    /** Returns all source associations for a given variable. */
    getAssociationsForVariable(
        variableId: string
    ): TCoreVariableSourceAssociation[]

    /** Returns all source associations for a given expression. */
    getAssociationsForExpression(
        expressionId: string
    ): TCoreExpressionSourceAssociation[]

    /** Returns all variable-source associations across the argument. */
    getAllVariableSourceAssociations(): TCoreVariableSourceAssociation[]

    /** Returns all expression-source associations across the argument. */
    getAllExpressionSourceAssociations(): TCoreExpressionSourceAssociation[]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/core/interfaces/source-management.interfaces.ts
git commit -m "feat: update TSourceManagement to association-only with sourceVersion"
```

---

## Chunk 4: ArgumentEngine and PremiseEngine Refactor

### Task 16: Update ArgumentEngine

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

This is the largest task. The engine needs:

1. New `TAssertion` generic param
2. Libraries as required constructor params
3. Validation in `addVariable` and `updateVariable`
4. Updated source association methods (sourceVersion param, validate via library)
5. Remove `addSource`/`removeSource`/`getSource`/`getSources`
6. Drop `TSource` from all `ChangeCollector`/`TCoreMutationResult` usage
7. Update reactive snapshot (drop sources record)
8. Update `TArgumentEngineSnapshot` (drop sources)

- [ ] **Step 1: Update imports, types, and class signature**

Add imports for the new types:

```typescript
import type { TCoreAssertion } from "../schemata/assertion.js"
import type {
    TAssertionLookup,
    TSourceLookup,
} from "./interfaces/library.interfaces.js"
```

Update `TArgumentEngineSnapshot` — add `TAssertion` generic, remove `TSource` from sources field:

```typescript
export type TArgumentEngineSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    argument: TOptionalChecksum<TArg>
    variables: TVariableManagerSnapshot<TVar>
    premises: TPremiseEngineSnapshot<TPremise, TExpr>[]
    conclusionPremiseId?: string
    config?: TLogicEngineOptions
    sources?: TSourceManagerSnapshot
}
```

Update class signature — add `TAssertion`, drop `TSource` from interface impls:

```typescript
export class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TAssertion extends TCoreAssertion = TCoreAssertion,
>
    implements
        TPremiseCrud<TArg, TPremise, TExpr, TVar>,
        TVariableManagement<TArg, TPremise, TExpr, TVar>,
        TArgumentExpressionQueries<TExpr>,
        TArgumentRoleState<TArg, TPremise, TExpr, TVar>,
        TArgumentEvaluation,
        TArgumentLifecycle<TArg, TPremise, TExpr, TVar>,
        TArgumentIdentity<TArg>,
        TSourceManagement<TArg, TPremise, TExpr, TVar>,
        TDisplayable,
        TChecksummable
```

- [ ] **Step 2: Update private fields and constructor**

Add library fields, update constructor signature:

```typescript
    private assertionLibrary: TAssertionLookup<TAssertion>
    private sourceLibrary: TSourceLookup<TSource>
```

Update constructor:

```typescript
    constructor(
        argument: TOptionalChecksum<TArg>,
        assertionLibrary: TAssertionLookup<TAssertion>,
        sourceLibrary: TSourceLookup<TSource>,
        options?: TLogicEngineOptions
    ) {
        this.argument = { ...argument }
        this.assertionLibrary = assertionLibrary
        this.sourceLibrary = sourceLibrary
        // ... rest same but with new config order
    }
```

- [ ] **Step 3: Update addVariable — add assertion validation**

In `addVariable`, after the argumentVersion check, add:

```typescript
const varTyped = variable as unknown as {
    assertionId?: string
    assertionVersion?: number
}
if (varTyped.assertionId == null || varTyped.assertionVersion == null) {
    throw new Error("Variable must have assertionId and assertionVersion.")
}
if (
    !this.assertionLibrary.get(varTyped.assertionId, varTyped.assertionVersion)
) {
    throw new Error(
        `Assertion "${varTyped.assertionId}" version ${varTyped.assertionVersion} does not exist in the assertion library.`
    )
}
```

Remove `TSource` from all `ChangeCollector` instantiations — they now take 4 generic params.

- [ ] **Step 4: Update updateVariable — add assertion reference support and validation**

Update the `updates` parameter type to accept assertion fields:

```typescript
    public updateVariable(
        variableId: string,
        updates: {
            symbol?: string
            assertionId?: string
            assertionVersion?: number
        }
    )
```

Add validation before applying:

```typescript
if ((updates.assertionId != null) !== (updates.assertionVersion != null)) {
    throw new Error(
        "assertionId and assertionVersion must be provided together."
    )
}
if (
    updates.assertionId != null &&
    updates.assertionVersion != null &&
    !this.assertionLibrary.get(updates.assertionId, updates.assertionVersion)
) {
    throw new Error(
        `Assertion "${updates.assertionId}" version ${updates.assertionVersion} does not exist in the assertion library.`
    )
}
```

- [ ] **Step 5: Remove addSource, removeSource, getSource, getSources methods**

Delete the `addSource()`, `removeSource()`, `getSource()`, `getSources()` methods entirely.

- [ ] **Step 6: Update addVariableSourceAssociation — add sourceVersion, validate via library**

Update signature to `(sourceId: string, sourceVersion: number, variableId: string)`. Replace `this.sourceManager.getSource(sourceId)` check with:

```typescript
if (!this.sourceLibrary.get(sourceId, sourceVersion)) {
    throw new Error(
        `Source "${sourceId}" version ${sourceVersion} does not exist in the source library.`
    )
}
```

Add `sourceVersion` to the association entity:

```typescript
const assoc: TCoreVariableSourceAssociation = {
    id: randomUUID(),
    sourceId,
    sourceVersion,
    variableId,
    argumentId: this.argument.id,
    argumentVersion: this.argument.version,
    checksum: "",
}
```

- [ ] **Step 7: Update addExpressionSourceAssociation — same pattern**

Update signature to `(sourceId: string, sourceVersion: number, expressionId: string, premiseId: string)`. Add library validation and `sourceVersion` to entity.

- [ ] **Step 8: Update removeVariableSourceAssociation and removeExpressionSourceAssociation**

Remove the orphan source handling (`removedOrphanSources` / `collector.removedSource`). These methods now only deal with associations.

- [ ] **Step 9: Update reactive snapshot — drop sources record**

In `buildReactiveSnapshot()`, remove the `sourcesRecord` variable and the `sources` field from the snapshot object. Remove `dirty.sources` from the dirty tracking. Update `TReactiveSnapshot` usage to drop `TSource`.

- [ ] **Step 10: Update PremiseEngine references — drop TSource**

In `PremiseEngine` type params throughout `argument-engine.ts`, remove the `TSource` generic. Update `Map<string, PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>>` to `Map<string, PremiseEngine<TArg, TPremise, TExpr, TVar>>`.

- [ ] **Step 11: Update snapshot() and fromSnapshot()**

Update `TArgumentEngineSnapshot` usage. In `fromSnapshot`, the method now takes `assertionLibrary` and `sourceLibrary` as params. Update the static method signature accordingly.

- [ ] **Step 12: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "feat: integrate libraries into ArgumentEngine, drop TSource from generics"
```

### Task 17: Update PremiseEngine — drop TSource, add sourceVersion

**Files:**

- Modify: `src/lib/core/premise-engine.ts`

- [ ] **Step 1: Remove TSource generic parameter from class**

Update class signature to 4 generic params (drop `TSource`). Update all `implements` clauses, `ChangeCollector` instantiations, and `TCoreMutationResult` return types to drop `TSource`.

Remove `sourceManager?: SourceManager<TSource>` → `sourceManager?: SourceManager` (SourceManager is no longer generic).

Remove the orphan cleanup code in `removeExpressionSourceAssociation`.

Update `addExpressionSourceAssociation` to accept `sourceVersion` parameter and include it in the constructed association entity:

```typescript
    public addExpressionSourceAssociation(
        sourceId: string,
        sourceVersion: number,
        expressionId: string
    )
```

Add `sourceVersion` to the association entity construction inside this method.

- [ ] **Step 2: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "feat: drop TSource from PremiseEngine"
```

### Task 18: Update diff.ts — remove source diffing

**Files:**

- Modify: `src/lib/core/diff.ts`

- [ ] **Step 1: Remove defaultCompareSource function**

Delete the `defaultCompareSource` function (lines 55–61).

- [ ] **Step 2: Update defaultCompareVariable — add assertionId/assertionVersion**

```typescript
export function defaultCompareVariable(
    before: TCorePropositionalVariable,
    after: TCorePropositionalVariable
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.symbol !== after.symbol) {
        changes.push({
            field: "symbol",
            before: before.symbol,
            after: after.symbol,
        })
    }
    const bAssert = before as unknown as {
        assertionId?: string
        assertionVersion?: number
    }
    const aAssert = after as unknown as {
        assertionId?: string
        assertionVersion?: number
    }
    if (bAssert.assertionId !== aAssert.assertionId) {
        changes.push({
            field: "assertionId",
            before: bAssert.assertionId,
            after: aAssert.assertionId,
        })
    }
    if (bAssert.assertionVersion !== aAssert.assertionVersion) {
        changes.push({
            field: "assertionVersion",
            before: bAssert.assertionVersion,
            after: aAssert.assertionVersion,
        })
    }
    return changes
}
```

- [ ] **Step 3: Update defaultCompareVariableSourceAssociation — add sourceVersion**

Add sourceVersion comparison to the function.

- [ ] **Step 4: Update defaultCompareExpressionSourceAssociation — add sourceVersion**

Add sourceVersion comparison to the function.

- [ ] **Step 5: Update diffArguments — remove TSource generic, remove source diffing**

Drop `TSource` generic param. Remove `compareSrc` and the `sources:` line from the return object. Remove `TCoreSource` import.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/diff.ts
git commit -m "feat: remove source entity diffing, add assertion/sourceVersion to comparators"
```

---

## Chunk 5: Barrel Exports, IEEE Extension, and Tests

### Task 19: Update library barrel exports

**Files:**

- Modify: `src/lib/index.ts`

- [ ] **Step 1: Add new exports, update existing ones**

Add:

```typescript
export { AssertionLibrary } from "./core/assertion-library.js"
export { SourceLibrary } from "./core/source-library.js"
```

Update `SourceManager` exports — remove `TSourceRemovalResult`:

```typescript
export { SourceManager } from "./core/source-manager.js"
export type {
    TSourceManagerSnapshot,
    TSourceAssociationRemovalResult,
} from "./core/source-manager.js"
```

Remove `defaultCompareSource` from diff exports.

- [ ] **Step 2: Commit**

```bash
git add src/lib/index.ts
git commit -m "feat: update barrel exports for global libraries"
```

### Task 20: Update IEEE extension

**Files:**

- Modify: `src/extensions/ieee/source.ts`

- [ ] **Step 1: Update IEEESourceSchema**

The `CoreSourceSchema` no longer has `argumentId`/`argumentVersion` and now has `version`/`frozen`. The `Type.Intersect` pattern still works — no changes needed to the file structure, but the resulting type changes. Verify typecheck passes.

Run: `pnpm run typecheck`

If it passes, no changes needed. If not, update accordingly.

- [ ] **Step 2: Commit if changed**

```bash
git add src/extensions/ieee/source.ts
git commit -m "fix: update IEEE source extension for new CoreSourceSchema"
```

### Task 21: Update existing tests

**Files:**

- Modify: `test/core.test.ts`

- [ ] **Step 1: Update test fixtures and helpers**

Every `new ArgumentEngine(arg)` call now needs `assertionLibrary` and `sourceLibrary` params. Every `makeVar()` call now needs `assertionId` and `assertionVersion`.

Add at top of fixtures section:

```typescript
function makeAssertionLibrary() {
    const lib = new AssertionLibrary()
    lib.create({ id: "assert-default" })
    return lib
}

function makeSourceLibrary() {
    return new SourceLibrary()
}
```

Update `makeVar` helper:

```typescript
function makeVar(
    id: string,
    symbol: string,
    assertionId = "assert-default",
    assertionVersion = 0
): TVariableInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol,
        assertionId,
        assertionVersion,
    }
}
```

Update every `new ArgumentEngine(...)` call to pass libraries.

- [ ] **Step 2: Update source-related tests**

Existing source tests that call `engine.addSource()` must be rewritten to use a `SourceLibrary` instead. Association tests must pass `sourceVersion`.

- [ ] **Step 3: Run full test suite**

Run: `pnpm run test`
Expected: PASS (all existing + new tests)

- [ ] **Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/core.test.ts
git commit -m "test: update all tests for global libraries"
```

### Task 22: Documentation sync check

**Files:**

- Potentially modify: `CLAUDE.md`, `docs/api-reference.md`, `README.md`

- [ ] **Step 1: Update CLAUDE.md design rules**

Update the source-related rules in the "Key design rules" section to reflect:

- Sources are library-scoped (not argument-scoped)
- `SourceManager` is association-only
- Orphan cleanup is removed
- Variables require assertion references
- Libraries are required by ArgumentEngine

- [ ] **Step 2: Update api-reference.md if it exists**

Check if `docs/api-reference.md` needs updates for the new constructor signature and removed methods.

- [ ] **Step 3: Commit docs**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update for global libraries"
```

### Task 23: Final verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, format, test, build)

- [ ] **Step 2: Verify test count**

Run: `pnpm run test`
Verify test count is higher than current (566 tests). The new library tests should add ~20+ tests.
