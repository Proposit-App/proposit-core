# Persistence Utilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add changeset merge/ordering utilities, library lookup helpers, and verify/fix a reported ancestor checksum bug — reducing boilerplate for consumers that persist argument data.

**Architecture:** Two new utility modules (`changeset.ts`, `lookup.ts`) in `src/lib/utils/` with standalone functions. The changeset utilities operate on the existing `TCoreChangeset` type. No changes to engine internals unless the checksum bug is confirmed.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| Action | Path                         | Responsibility                                                                           |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| Create | `src/lib/utils/changeset.ts` | `mergeChangesets`, `orderChangeset`, `TOrderedOperation` type                            |
| Create | `src/lib/utils/lookup.ts`    | `createLookup`, `EMPTY_CLAIM_LOOKUP`, `EMPTY_SOURCE_LOOKUP`, `EMPTY_CLAIM_SOURCE_LOOKUP` |
| Modify | `src/lib/index.ts`           | Re-export new utilities                                                                  |
| Modify | `test/core.test.ts`          | Tests for all new functions + bug verification                                           |
| Modify | `CLAUDE.md`                  | Design rule for `orderChangeset` ordering invariant                                      |

---

### Task 1: `mergeChangesets` — failing tests

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("mergeChangesets", () => {
    it("merges two empty changesets", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result).toEqual({})
    })

    it("deduplicates by id with last-write-wins", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "old",
                        descendantChecksum: null,
                        combinedChecksum: "old",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "new",
                        descendantChecksum: null,
                        combinedChecksum: "new",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.expressions?.added[0].checksum).toBe("new")
    })

    it("merges different entity categories independently", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "var1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.variables?.added).toHaveLength(1)
    })

    it("throws when an entity appears in both added and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow()
    })

    it("throws when an entity appears in both added and modified", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                    },
                ],
                removed: [],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow()
    })

    it("throws when an entity appears in both modified and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow()
    })

    it("takes roles from b when present", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = { roles: { conclusionPremiseId: "p2" } }
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p2")
    })

    it("keeps roles from a when b has none", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p1")
    })

    it("takes argument from b when present", () => {
        const a: TCoreChangeset = {
            argument: { id: "a1", version: 0 } as TCoreArgument,
        }
        const b: TCoreChangeset = {
            argument: { id: "a1", version: 1 } as TCoreArgument,
        }
        const result = mergeChangesets(a, b)
        expect(result.argument?.version).toBe(1)
    })

    it("omits empty entity categories from result", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {
            expressions: { added: [], modified: [], removed: [] },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions).toBeUndefined()
    })
})
```

- [ ] **Step 2: Add the import placeholder**

Add `mergeChangesets` to the import from `"../src/lib/index"` at the top of the test file. This will cause a compile error since the function doesn't exist yet.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "mergeChangesets|FAIL"`
Expected: Compilation error — `mergeChangesets` is not exported.

---

### Task 2: `mergeChangesets` — implementation

**Files:**

- Create: `src/lib/utils/changeset.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Create `src/lib/utils/changeset.ts` with `mergeChangesets`**

````typescript
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type { TCoreEntityChanges, TCoreChangeset } from "../types/mutation.js"

/**
 * Merges two changesets into one, deduplicating entities by `id` within each
 * bucket (added/modified/removed) with last-write-wins semantics.
 *
 * Use this when a single logical operation requires multiple engine calls that
 * each produce a changeset. For example, creating a conclusion premise requires
 * both `createPremiseWithId` and `setConclusionPremise`, each returning a
 * changeset — `mergeChangesets` combines them into one changeset suitable for
 * a single persistence call.
 *
 * @param a - The first changeset.
 * @param b - The second changeset. Its entries take precedence when both
 *   changesets contain the same entity ID in the same bucket.
 * @returns A merged changeset. Entity categories that are empty after merge
 *   are omitted from the result.
 * @throws {Error} If any entity ID appears in more than one bucket
 *   (added/modified/removed) within the same category after merge. This
 *   indicates a logic error in the caller.
 *
 * @example
 * ```ts
 * const { changes: createChanges } = engine.createPremiseWithId(premiseId, data)
 * const { changes: roleChanges } = engine.setConclusionPremise(premiseId)
 * const combined = mergeChangesets(createChanges, roleChanges)
 * await persistChangeset(db, combined)
 * ```
 */
export function mergeChangesets<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
>(
    a: TCoreChangeset<TExpr, TVar, TPremise, TArg>,
    b: TCoreChangeset<TExpr, TVar, TPremise, TArg>
): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    const result: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}

    const mergedExpressions = mergeEntityChanges(
        a.expressions,
        b.expressions,
        "expressions"
    )
    if (mergedExpressions) result.expressions = mergedExpressions

    const mergedVariables = mergeEntityChanges(
        a.variables,
        b.variables,
        "variables"
    )
    if (mergedVariables) result.variables = mergedVariables

    const mergedPremises = mergeEntityChanges(
        a.premises,
        b.premises,
        "premises"
    )
    if (mergedPremises) result.premises = mergedPremises

    if (b.roles !== undefined) {
        result.roles = b.roles
    } else if (a.roles !== undefined) {
        result.roles = a.roles
    }

    if (b.argument !== undefined) {
        result.argument = b.argument
    } else if (a.argument !== undefined) {
        result.argument = a.argument
    }

    return result
}

function mergeEntityChanges<T extends { id: string }>(
    a: TCoreEntityChanges<T> | undefined,
    b: TCoreEntityChanges<T> | undefined,
    categoryName: string
): TCoreEntityChanges<T> | undefined {
    if (!a && !b) return undefined

    const dedup = (aList: T[], bList: T[]): T[] => {
        const map = new Map<string, T>()
        for (const item of aList) map.set(item.id, item)
        for (const item of bList) map.set(item.id, item)
        return [...map.values()]
    }

    const added = dedup(a?.added ?? [], b?.added ?? [])
    const modified = dedup(a?.modified ?? [], b?.modified ?? [])
    const removed = dedup(a?.removed ?? [], b?.removed ?? [])

    // Enforce invariant: no entity ID may appear in more than one bucket.
    const addedIds = new Set(added.map((e) => e.id))
    const modifiedIds = new Set(modified.map((e) => e.id))
    const removedIds = new Set(removed.map((e) => e.id))

    for (const id of addedIds) {
        if (modifiedIds.has(id)) {
            throw new Error(
                `mergeChangesets: entity "${id}" appears in both added and modified in ${categoryName}`
            )
        }
        if (removedIds.has(id)) {
            throw new Error(
                `mergeChangesets: entity "${id}" appears in both added and removed in ${categoryName}`
            )
        }
    }
    for (const id of modifiedIds) {
        if (removedIds.has(id)) {
            throw new Error(
                `mergeChangesets: entity "${id}" appears in both modified and removed in ${categoryName}`
            )
        }
    }

    if (added.length === 0 && modified.length === 0 && removed.length === 0) {
        return undefined
    }

    return { added, modified, removed }
}
````

- [ ] **Step 2: Add export to `src/lib/index.ts`**

Add this line after the existing `export * from "./types/mutation.js"` line:

```typescript
export { mergeChangesets } from "./utils/changeset.js"
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "mergeChangesets|FAIL|passed"`
Expected: All `mergeChangesets` tests pass.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/changeset.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add mergeChangesets utility for combining changesets"
```

---

### Task 3: `orderChangeset` — failing tests

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("orderChangeset", () => {
    // Helper: extract entity names from operation list in order
    const opSummary = (ops: TOrderedOperation[]) =>
        ops.map((op) => `${op.type}:${op.entity}`)

    it("returns empty array for empty changeset", () => {
        const result = orderChangeset({})
        expect(result).toEqual([])
    })

    it("orders deletes in reverse FK order: expressions → variables → premises", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
            variables: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
            },
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const deleteExpr = summary.indexOf("delete:expression")
        const deleteVar = summary.indexOf("delete:variable")
        const deletePremise = summary.indexOf("delete:premise")
        expect(deleteExpr).toBeLessThan(deleteVar)
        expect(deleteVar).toBeLessThan(deletePremise)
    })

    it("orders inserts in FK-safe order: premises → variables → expressions", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const insertPremise = summary.indexOf("insert:premise")
        const insertVar = summary.indexOf("insert:variable")
        const insertExpr = summary.indexOf("insert:expression")
        expect(insertPremise).toBeLessThan(insertVar)
        expect(insertVar).toBeLessThan(insertExpr)
    })

    it("orders premise updates before deletes", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [],
                modified: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                    },
                ],
                removed: [
                    {
                        id: "p2",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p2",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const updatePremise = summary.indexOf("update:premise")
        const deleteExpr = summary.indexOf("delete:expression")
        expect(updatePremise).toBeLessThan(deleteExpr)
    })

    it("topologically sorts inserted expressions so parents come before children", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "child",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "parent",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        id: "parent",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const insertOps = ops.filter(
            (op) => op.type === "insert" && op.entity === "expression"
        )
        expect(insertOps).toHaveLength(2)
        expect(insertOps[0].data.id).toBe("parent")
        expect(insertOps[1].data.id).toBe("child")
    })

    it("topologically sorts 3-level deep inserted expressions", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "grandchild",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "child",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        id: "root",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        id: "child",
                        type: "formula",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "root",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const insertOps = ops.filter(
            (op) => op.type === "insert" && op.entity === "expression"
        )
        expect(insertOps.map((op) => op.data.id)).toEqual([
            "root",
            "child",
            "grandchild",
        ])
    })

    it("puts deletes before inserts", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e2",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const deleteIdx = summary.indexOf("delete:expression")
        const insertIdx = summary.indexOf("insert:expression")
        expect(deleteIdx).toBeLessThan(insertIdx)
    })

    it("includes argument and roles updates at the end", () => {
        const changeset: TCoreChangeset = {
            roles: { conclusionPremiseId: "p1" },
            argument: { id: "a1", version: 1 } as TCoreArgument,
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const insertVar = summary.indexOf("insert:variable")
        const updateArg = summary.indexOf("update:argument")
        const updateRoles = summary.indexOf("update:roles")
        expect(insertVar).toBeLessThan(updateArg)
        expect(insertVar).toBeLessThan(updateRoles)
    })
})
```

- [ ] **Step 2: Add `orderChangeset` and `TOrderedOperation` to the import**

Add `orderChangeset` and `type TOrderedOperation` to the import from `"../src/lib/index"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "orderChangeset|FAIL"`
Expected: Compilation error — `orderChangeset` / `TOrderedOperation` not exported.

---

### Task 4: `orderChangeset` — implementation

**Files:**

- Modify: `src/lib/utils/changeset.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Add `TOrderedOperation` type and `orderChangeset` to `src/lib/utils/changeset.ts`**

Append to the existing file:

```typescript
/**
 * A single persistence operation produced by {@link orderChangeset}.
 *
 * Each operation is a tagged union of `type` (the DML verb) and `entity`
 * (which table/collection the operation targets). The `data` field contains
 * the full entity state — for inserts and updates, this is the entity to
 * write; for deletes, this is the entity that was removed (useful for
 * identifying the row to delete).
 */
export type TOrderedOperation<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> =
    | { type: "delete"; entity: "expression"; data: TExpr }
    | { type: "delete"; entity: "variable"; data: TVar }
    | { type: "delete"; entity: "premise"; data: TPremise }
    | { type: "insert"; entity: "premise"; data: TPremise }
    | { type: "insert"; entity: "variable"; data: TVar }
    | { type: "insert"; entity: "expression"; data: TExpr }
    | { type: "update"; entity: "expression"; data: TExpr }
    | { type: "update"; entity: "variable"; data: TVar }
    | { type: "update"; entity: "premise"; data: TPremise }
    | { type: "update"; entity: "argument"; data: TArg }
    | { type: "update"; entity: "roles"; data: TCoreArgumentRoleState }

/**
 * Converts a changeset into a flat, ordered array of persistence operations
 * that is safe to execute sequentially against a relational store with
 * foreign key constraints.
 *
 * The entities in a proposit-core argument form a dependency chain:
 * - **Premises** own **expressions** (via `premiseId` FK).
 * - **Expressions** reference **variables** (via `variableId` FK).
 * - **Expressions** form a parent-child tree (via `parentId` self-FK).
 *
 * These FK constraints dictate the ordering of operations. Executing them
 * out of order will violate referential integrity. The returned array
 * follows this sequence:
 *
 * 1. **Update premises** — ensure premise rows have correct metadata
 *    before dependent deletes run.
 * 2. **Delete expressions** — expression rows hold FKs to variables and
 *    premises, so they must be removed first.
 * 3. **Delete variables** — safe after expression deletes (no remaining
 *    FK references from expressions).
 * 4. **Delete premises** — safe after all child rows are removed.
 * 5. **Insert premises** — new premises must exist before their
 *    expressions and variables can be inserted.
 * 6. **Insert variables** — new variables must exist before
 *    variable-type expressions can reference them.
 * 7. **Insert expressions** — inserted last, topologically sorted so
 *    parent expressions are inserted before their children (satisfies
 *    the `parentId` self-FK).
 * 8. **Update variables** — position-independent; grouped after inserts
 *    for clarity.
 * 9. **Update expressions** — checksum and position updates.
 * 10. **Update argument metadata** — if present.
 * 11. **Update role state** — if present.
 *
 * @param changeset - The changeset to convert.
 * @returns An array of operations in FK-safe execution order.
 */
export function orderChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
>(
    changeset: TCoreChangeset<TExpr, TVar, TPremise, TArg>
): TOrderedOperation<TExpr, TVar, TPremise, TArg>[] {
    const ops: TOrderedOperation<TExpr, TVar, TPremise, TArg>[] = []

    // Phase 1: Update premises — ensure premise rows have correct metadata
    // before dependent deletes run.
    for (const p of changeset.premises?.modified ?? []) {
        ops.push({ type: "update", entity: "premise", data: p })
    }

    // Phase 2: Delete expressions — expression rows hold FKs to variables
    // and premises, so they must be removed before variables or premises.
    for (const e of changeset.expressions?.removed ?? []) {
        ops.push({ type: "delete", entity: "expression", data: e })
    }

    // Phase 3: Delete variables — safe now that no expression rows
    // reference them.
    for (const v of changeset.variables?.removed ?? []) {
        ops.push({ type: "delete", entity: "variable", data: v })
    }

    // Phase 4: Delete premises — safe now that all child rows (expressions,
    // variables) have been removed.
    for (const p of changeset.premises?.removed ?? []) {
        ops.push({ type: "delete", entity: "premise", data: p })
    }

    // Phase 5: Insert premises — new premise rows must exist before their
    // expressions and variables can be inserted.
    for (const p of changeset.premises?.added ?? []) {
        ops.push({ type: "insert", entity: "premise", data: p })
    }

    // Phase 6: Insert variables — new variable rows must exist before
    // variable-type expressions can reference them via variableId FK.
    for (const v of changeset.variables?.added ?? []) {
        ops.push({ type: "insert", entity: "variable", data: v })
    }

    // Phase 7: Insert expressions — topologically sorted so parent
    // expressions are inserted before their children (parentId self-FK).
    const addedExprs = changeset.expressions?.added ?? []
    if (addedExprs.length > 0) {
        const sorted = topologicalSortExpressions(addedExprs)
        for (const e of sorted) {
            ops.push({ type: "insert", entity: "expression", data: e })
        }
    }

    // Phase 8: Update variables.
    for (const v of changeset.variables?.modified ?? []) {
        ops.push({ type: "update", entity: "variable", data: v })
    }

    // Phase 9: Update expressions — checksum and position updates.
    for (const e of changeset.expressions?.modified ?? []) {
        ops.push({ type: "update", entity: "expression", data: e })
    }

    // Phase 10: Update argument metadata.
    if (changeset.argument) {
        ops.push({
            type: "update",
            entity: "argument",
            data: changeset.argument,
        })
    }

    // Phase 11: Update role state.
    if (changeset.roles) {
        ops.push({ type: "update", entity: "roles", data: changeset.roles })
    }

    return ops
}

/**
 * Topologically sorts expressions so parents come before children.
 * Expressions whose `parentId` is `null` or references an expression
 * not in the input array are treated as roots.
 */
function topologicalSortExpressions<TExpr extends TCorePropositionalExpression>(
    exprs: TExpr[]
): TExpr[] {
    const byId = new Map(exprs.map((e) => [e.id, e]))
    const addedIds = new Set(exprs.map((e) => e.id))
    const sorted: TExpr[] = []
    const visited = new Set<string>()

    const visit = (expr: TExpr): void => {
        if (visited.has(expr.id)) return
        if (
            expr.parentId !== null &&
            addedIds.has(expr.parentId) &&
            !visited.has(expr.parentId)
        ) {
            visit(byId.get(expr.parentId)!)
        }
        visited.add(expr.id)
        sorted.push(expr)
    }

    for (const expr of exprs) {
        visit(expr)
    }

    return sorted
}
```

- [ ] **Step 2: Add exports to `src/lib/index.ts`**

Add alongside the existing `mergeChangesets` export:

```typescript
export { mergeChangesets, orderChangeset } from "./utils/changeset.js"
export type { TOrderedOperation } from "./utils/changeset.js"
```

(Replace the existing `mergeChangesets`-only export line.)

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "orderChangeset|FAIL|passed"`
Expected: All `orderChangeset` tests pass.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/changeset.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add orderChangeset utility for FK-safe persistence ordering"
```

---

### Task 5: `createLookup` and empty lookup constants — failing tests

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("createLookup", () => {
    it("builds a lookup from an array", () => {
        const items = [
            { id: "c1", version: 0, frozen: false, checksum: "" },
            { id: "c1", version: 1, frozen: true, checksum: "abc" },
            { id: "c2", version: 0, frozen: false, checksum: "" },
        ]
        const lookup = createLookup(items, (c) => `${c.id}:${c.version}`)
        expect(lookup.get("c1", 0)).toEqual(items[0])
        expect(lookup.get("c1", 1)).toEqual(items[1])
        expect(lookup.get("c2", 0)).toEqual(items[2])
    })

    it("returns undefined for missing keys", () => {
        const lookup = createLookup([], (c) => `${c.id}:${c.version}`)
        expect(lookup.get("missing", 0)).toBeUndefined()
    })

    it("last item wins when keys collide", () => {
        const items = [
            { id: "c1", version: 0, frozen: false, checksum: "first" },
            { id: "c1", version: 0, frozen: false, checksum: "second" },
        ]
        const lookup = createLookup(items, (c) => `${c.id}:${c.version}`)
        expect(lookup.get("c1", 0)?.checksum).toBe("second")
    })
})

describe("empty lookup constants", () => {
    it("EMPTY_CLAIM_LOOKUP.get returns undefined", () => {
        expect(EMPTY_CLAIM_LOOKUP.get("any", 0)).toBeUndefined()
    })

    it("EMPTY_SOURCE_LOOKUP.get returns undefined", () => {
        expect(EMPTY_SOURCE_LOOKUP.get("any", 0)).toBeUndefined()
    })

    it("EMPTY_CLAIM_SOURCE_LOOKUP.get returns undefined", () => {
        expect(EMPTY_CLAIM_SOURCE_LOOKUP.get("any")).toBeUndefined()
    })

    it("EMPTY_CLAIM_SOURCE_LOOKUP.getForClaim returns empty array", () => {
        expect(EMPTY_CLAIM_SOURCE_LOOKUP.getForClaim("any")).toEqual([])
    })

    it("EMPTY_CLAIM_SOURCE_LOOKUP.getForSource returns empty array", () => {
        expect(EMPTY_CLAIM_SOURCE_LOOKUP.getForSource("any")).toEqual([])
    })
})
```

- [ ] **Step 2: Add imports**

Add `createLookup`, `EMPTY_CLAIM_LOOKUP`, `EMPTY_SOURCE_LOOKUP`, `EMPTY_CLAIM_SOURCE_LOOKUP` to the import from `"../src/lib/index"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "createLookup|empty lookup|FAIL"`
Expected: Compilation error — exports don't exist yet.

---

### Task 6: `createLookup` and empty lookup constants — implementation

**Files:**

- Create: `src/lib/utils/lookup.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Create `src/lib/utils/lookup.ts`**

````typescript
import type { TCoreClaim } from "../schemata/claim.js"
import type {
    TCoreClaimSourceAssociation,
    TCoreSource,
} from "../schemata/source.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
} from "../core/interfaces/library.interfaces.js"

/**
 * Creates a keyed lookup from an array of items. Items are indexed by a
 * composite string key (typically `"id:version"`), and the returned object
 * exposes a `get(id, version)` method that reconstructs the same key
 * internally.
 *
 * Use this to build the `TClaimLookup` or `TSourceLookup` required by
 * `ArgumentEngine`'s constructor from flat arrays (e.g. database query
 * results).
 *
 * @param items - The array of items to index.
 * @param getKey - A function that produces the composite key for each item.
 *   Must return a string of the form `"id:version"` so that the returned
 *   `get(id, version)` method can reconstruct it.
 * @returns An object with a `get(id, version)` method that looks up items
 *   by reconstructing the composite key. Returns `undefined` if no item
 *   matches.
 *
 * @example
 * ```ts
 * const claimLookup = createLookup(claims, (c) => `${c.id}:${c.version}`)
 * const sourceLookup = createLookup(sources, (s) => `${s.id}:${s.version}`)
 * const engine = new ArgumentEngine(arg, claimLookup, sourceLookup, ...)
 * ```
 */
export function createLookup<T>(
    items: T[],
    getKey: (item: T) => string
): { get(id: string, version: number): T | undefined } {
    const map = new Map<string, T>()
    for (const item of items) {
        map.set(getKey(item), item)
    }
    return {
        get(id: string, version: number): T | undefined {
            return map.get(`${id}:${version}`)
        },
    }
}

/**
 * A no-op claim lookup that always returns `undefined`. Use this when the
 * consumer does not use claims (e.g. an argument with no claim-bound
 * variables).
 */
export const EMPTY_CLAIM_LOOKUP: TClaimLookup = {
    get: () => undefined,
}

/**
 * A no-op source lookup that always returns `undefined`. Use this when the
 * consumer does not use sources.
 */
export const EMPTY_SOURCE_LOOKUP: TSourceLookup = {
    get: () => undefined,
}

/**
 * A no-op claim-source association lookup that always returns `undefined`
 * or empty arrays. Use this when the consumer does not use claim-source
 * associations.
 */
export const EMPTY_CLAIM_SOURCE_LOOKUP: TClaimSourceLookup = {
    getForClaim: () => [],
    getForSource: () => [],
    get: () => undefined,
}
````

- [ ] **Step 2: Add exports to `src/lib/index.ts`**

Add after the changeset exports:

```typescript
export {
    createLookup,
    EMPTY_CLAIM_LOOKUP,
    EMPTY_SOURCE_LOOKUP,
    EMPTY_CLAIM_SOURCE_LOOKUP,
} from "./utils/lookup.js"
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "createLookup|empty lookup|FAIL|passed"`
Expected: All lookup tests pass.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/lookup.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add createLookup factory and empty lookup constants"
```

---

### Task 7: Verify ancestor checksum bug

The `proposit-server` has a workaround for a reported bug where `addExpression`/`appendExpression` changesets omit ancestor expressions whose checksums changed. However, the workaround code in the server has reference errors (`result` and `pm` are not in scope), and proposit-core already has passing tests for this exact behavior at `test/core.test.ts:20753-21092`.

This task verifies whether the bug exists. If it does, we fix it. If it doesn't, we skip it.

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Review existing ancestor checksum tests**

Read `test/core.test.ts` lines 20753-21092. These tests cover:

- `addExpression` includes parent in modified
- `addExpression` includes all ancestors up to root in modified
- `appendExpression` includes parent in modified
- `addExpressionRelative` includes ancestors in modified
- Modified expressions have correct (non-stale) checksums
- Added expressions are not duplicated in modified

- [ ] **Step 2: Run the existing tests in isolation**

Run: `pnpm run test -- --reporter=verbose -t "Changeset includes ancestor checksum updates"`
Expected: All tests pass.

- [ ] **Step 3: If all pass, document and move on**

If all tests pass, the bug either doesn't exist in the current version or was already fixed. No code changes needed. Add a comment to the spec noting the finding.

- [ ] **Step 4: If any fail, investigate and fix**

If any test fails, trace the failure to the root cause in `src/lib/core/expression-manager.ts` (likely in `flushExpressionChecksums` around lines 219-232) and fix it. Ensure the fix makes the failing test pass without breaking others.

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All 976+ tests pass.

- [ ] **Step 6: Commit (if changes were made)**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "fix: ensure ancestor checksums appear in changeset after expression add"
```

---

### Task 8: CLAUDE.md design rule

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `orderChangeset` ordering invariant to "Key design rules"**

Add the following entry to the "Key design rules" section in `CLAUDE.md`, after the existing rules:

```markdown
- **`orderChangeset` FK-safe ordering:** The `orderChangeset` function in `src/lib/utils/changeset.ts` returns persistence operations in a specific order that satisfies FK constraints: premise updates → expression deletes → variable deletes → premise deletes → premise inserts → variable inserts → expression inserts (topologically sorted) → variable updates → expression updates → argument updates → role updates. This ordering is an invariant. Any future work that changes entity relationships, adds new entity types, or modifies FK dependencies must preserve or extend this ordering. Flag any planned change that would violate this guarantee.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add orderChangeset ordering invariant to CLAUDE.md design rules"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, and all tests pass.

- [ ] **Step 2: Verify exports**

Run: `pnpm run build && node --input-type=module -e "import { mergeChangesets, orderChangeset, createLookup, EMPTY_CLAIM_LOOKUP, EMPTY_SOURCE_LOOKUP, EMPTY_CLAIM_SOURCE_LOOKUP } from './dist/index.js'; console.log(typeof mergeChangesets, typeof orderChangeset, typeof createLookup, typeof EMPTY_CLAIM_LOOKUP, typeof EMPTY_SOURCE_LOOKUP, typeof EMPTY_CLAIM_SOURCE_LOOKUP)"`
Expected: `function function function object object object`

- [ ] **Step 3: Review all new exports against spec**

Verify every item listed in the spec's "Exports" section is available:

- `mergeChangesets` — function
- `orderChangeset` — function
- `TOrderedOperation` — type (verify via typecheck, not runtime)
- `createLookup` — function
- `EMPTY_CLAIM_LOOKUP` — constant
- `EMPTY_SOURCE_LOOKUP` — constant
- `EMPTY_CLAIM_SOURCE_LOOKUP` — constant
