# Hierarchical Checksums Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-checksum system with a three-pronged hierarchical checksum model (meta, descendant, combined) on expressions, premises, and arguments, with bottom-up dirty propagation and lazy flush.

**Architecture:** Every hierarchical entity carries `checksum` (meta), `descendantChecksum`, and `combinedChecksum`. Dirty flags propagate up the tree on mutation. Recomputation is lazy — triggered by explicit `flushChecksums()` or by accessing checksum properties. Collection checksums (per descendant collection) are exposed via engine methods.

**Tech Stack:** TypeScript, TypeBox schemas, FNV-1a hashing (existing `computeHash`), Vitest

**Spec:** `docs/plans/2026-03-24-hierarchical-checksums-design.md`

---

### Task 1: Schema Changes — Add Hierarchical Checksum Fields

**Files:**
- Modify: `src/lib/schemata/propositional.ts:17-35` (BasePropositionalExpressionSchema)
- Modify: `src/lib/schemata/propositional.ts:166-180` (CorePremiseSchema)
- Modify: `src/lib/schemata/argument.ts:4-16` (CoreArgumentSchema)
- Modify: `src/lib/schemata/shared.ts:85-91` (add TOptionalHierarchicalChecksum)
- Modify: `src/cli/schemata.ts:37-46` (CliArgumentSchema)
- Modify: `src/cli/schemata.ts:65-73` (CliBaseExpressionSchema)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test — expression entity has hierarchical checksum fields**

```typescript
describe("hierarchical checksum schema", () => {
    it("expression entity includes descendantChecksum and combinedChecksum", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        const v = engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        const result = pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        const expr = pe.getExpression("e1")!
        expect(expr).toHaveProperty("checksum")
        expect(expr).toHaveProperty("descendantChecksum")
        expect(expr).toHaveProperty("combinedChecksum")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "expression entity includes descendantChecksum"`
Expected: FAIL — `descendantChecksum` property missing

- [ ] **Step 3: Add `descendantChecksum` and `combinedChecksum` to `BasePropositionalExpressionSchema`**

In `src/lib/schemata/propositional.ts:17-35`, add after the `checksum` field:

```typescript
descendantChecksum: Nullable(Type.String(), {
    description:
        "Checksum derived from direct children's combinedChecksums. Null for leaf expressions.",
}),
combinedChecksum: Type.String({
    description:
        "Hash of checksum + descendantChecksum. Equals checksum when descendantChecksum is null.",
}),
```

- [ ] **Step 4: Add same fields to `CorePremiseSchema`**

In `src/lib/schemata/propositional.ts:166-180`, add after the `checksum` field:

```typescript
descendantChecksum: Nullable(Type.String(), {
    description:
        "Checksum derived from descendant expression tree. Null if premise has no expressions.",
}),
combinedChecksum: Type.String({
    description:
        "Hash of checksum + descendantChecksum. Equals checksum when descendantChecksum is null.",
}),
```

- [ ] **Step 5: Add same fields to `CoreArgumentSchema`**

In `src/lib/schemata/argument.ts:4-16`, add after the `checksum` field:

```typescript
descendantChecksum: Nullable(Type.String(), {
    description:
        "Checksum derived from premises and variables collections. Null if argument has no descendants.",
}),
combinedChecksum: Type.String({
    description:
        "Hash of checksum + descendantChecksum. Equals checksum when descendantChecksum is null.",
}),
```

- [ ] **Step 6: Add `TOptionalHierarchicalChecksum<T>` to `src/lib/schemata/shared.ts`**

After the existing `TOptionalChecksum` (line 91), add:

```typescript
/** Makes `checksum`, `descendantChecksum`, and `combinedChecksum` optional on a hierarchical entity type. */
export type TOptionalHierarchicalChecksum<
    T extends { checksum: unknown; descendantChecksum: unknown; combinedChecksum: unknown },
> = Omit<T, "checksum" | "descendantChecksum" | "combinedChecksum"> &
    Partial<Pick<T, "checksum" | "descendantChecksum" | "combinedChecksum">>
```

- [ ] **Step 7: Add optional hierarchical checksum fields to CLI schemas**

In `src/cli/schemata.ts`, add to `CliArgumentSchema` (after `checksum` line 40):

```typescript
descendantChecksum: Type.Optional(Nullable(Type.String())),
combinedChecksum: Type.Optional(Type.String()),
```

In `src/cli/schemata.ts`, add to `CliBaseExpressionSchema` (after `checksum` line 72):

```typescript
descendantChecksum: Type.Optional(Nullable(Type.String())),
combinedChecksum: Type.Optional(Type.String()),
```

- [ ] **Step 8: Update `TExpressionInput` and `TExpressionWithoutPosition` to omit new fields**

In `src/lib/core/expression-manager.ts:25-40`, update both types:

```typescript
export type TExpressionInput<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TCorePropositionalExpression
        ? Omit<U, "checksum" | "descendantChecksum" | "combinedChecksum">
        : never
    : never

export type TExpressionWithoutPosition<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TCorePropositionalExpression
        ? Omit<U, "position" | "checksum" | "descendantChecksum" | "combinedChecksum">
        : never
    : never
```

- [ ] **Step 9: Fix all type errors across the codebase**

Run: `pnpm run typecheck`

The new required fields will cause type errors anywhere entities are constructed inline (tests, `attachChecksum`, `computeChecksum`, `toPremiseData`, snapshot restoration). Fix these by providing placeholder values temporarily — subsequent tasks will implement correct computation.

Placeholder strategy:
- `descendantChecksum: null`
- `combinedChecksum: ""` (will be overwritten by flush)

Work through each type error. Key locations:
- `ExpressionManager.attachChecksum()` — add the two new fields
- `PremiseEngine.toPremiseData()` — add placeholder fields
- `ArgumentEngine.snapshot()` — argument entity spread already includes all fields
- Test fixtures — add the new fields to any inline entity construction

- [ ] **Step 10: Run tests to verify everything passes**

Run: `pnpm run check`

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add hierarchical checksum fields to expression, premise, and argument schemas"
```

---

### Task 2: Interface Changes — `THierarchicalChecksummable`

**Files:**
- Modify: `src/lib/core/interfaces/shared.interfaces.ts:13-24`
- Modify: `src/lib/core/interfaces/index.ts:1`
- Modify: `src/lib/core/argument-engine.ts:117` (implements clause)
- Modify: `src/lib/core/premise-engine.ts:89` (implements clause)
- Test: `test/core.test.ts`

- [ ] **Step 1: Replace `TChecksummable` with `THierarchicalChecksummable`**

In `src/lib/core/interfaces/shared.interfaces.ts`, replace lines 13-24:

```typescript
/**
 * An entity that can produce hierarchical content checksums:
 * meta (entity-only), descendant (children), and combined (both).
 */
export interface THierarchicalChecksummable<
    TCollectionName extends string = string,
> {
    /** Returns the meta checksum — derived from entity data only. */
    checksum(): string
    /** Returns the descendant checksum — derived from children's combinedChecksums. Null if no children. */
    descendantChecksum(): string | null
    /** Returns the combined checksum — hash(checksum + descendantChecksum), or equals checksum if no descendants. */
    combinedChecksum(): string
    /** Returns the checksum for a named descendant collection. Null if collection is empty. */
    getCollectionChecksum(name: TCollectionName): string | null
    /** Forces recomputation of all dirty checksums in the hierarchy. */
    flushChecksums(): void
}
```

- [ ] **Step 2: Update the barrel export**

In `src/lib/core/interfaces/index.ts`, line 1:

```typescript
export type { TDisplayable, THierarchicalChecksummable } from "./shared.interfaces.js"
```

- [ ] **Step 3: Update `ArgumentEngine` implements clause**

In `src/lib/core/argument-engine.ts:117`, replace `TChecksummable` with `THierarchicalChecksummable<"premises" | "variables">`.

Add stub methods to satisfy the interface (will be implemented in Task 5):

```typescript
public descendantChecksum(): string | null { return null }
public combinedChecksum(): string { return this.checksum() }
public getCollectionChecksum(_name: "premises" | "variables"): string | null { return null }
public flushChecksums(): void { /* stub */ }
```

- [ ] **Step 4: Update `PremiseEngine` implements clause**

In `src/lib/core/premise-engine.ts:89`, replace `TChecksummable` with `THierarchicalChecksummable<"expressions">`.

Add stub methods (will be implemented in Task 4):

```typescript
public descendantChecksum(): string | null { return null }
public combinedChecksum(): string { return this.checksum() }
public getCollectionChecksum(_name: "expressions"): string | null { return null }
public flushChecksums(): void { /* stub */ }
```

- [ ] **Step 5: Update all imports of `TChecksummable` to `THierarchicalChecksummable`**

Search for `TChecksummable` across the codebase and update imports.

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm run check`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace TChecksummable with THierarchicalChecksummable interface"
```

---

### Task 3: Expression-Level Hierarchical Checksums

**Files:**
- Modify: `src/lib/core/expression-manager.ts:74-111` (class fields, attachChecksum, new methods)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test — leaf expression has correct hierarchical checksums**

```typescript
describe("expression hierarchical checksums", () => {
    it("leaf expression has null descendantChecksum and combinedChecksum equals checksum", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.flushChecksums()
        const expr = pe.getExpression("e1")!
        expect(expr.descendantChecksum).toBeNull()
        expect(expr.combinedChecksum).toBe(expr.checksum)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "leaf expression has null descendantChecksum"`
Expected: FAIL

- [ ] **Step 3: Write failing test — parent expression has descendantChecksum derived from children**

```typescript
it("parent expression descendantChecksum reflects children", () => {
    // Build: and(P, Q)
    const claimLib = new ClaimLibrary<TCoreClaim>()
    const sourceLib = new SourceLibrary<TCoreSource>()
    const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
    const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
    const engine = new ArgumentEngine(
        { id: "a1", version: 0 },
        claimLib, sourceLib, csLib,
    )
    const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
    engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
    engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
    pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
    pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
    pe.addExpression({ id: "e3", type: "variable", variableId: "v2", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
    pe.flushChecksums()

    const parent = pe.getExpression("e1")!
    const child1 = pe.getExpression("e2")!
    const child2 = pe.getExpression("e3")!

    // Children are leaves
    expect(child1.descendantChecksum).toBeNull()
    expect(child2.descendantChecksum).toBeNull()

    // Parent has non-null descendantChecksum
    expect(parent.descendantChecksum).not.toBeNull()
    expect(parent.descendantChecksum).toEqual(expect.any(String))

    // Parent combinedChecksum differs from its meta checksum
    expect(parent.combinedChecksum).not.toBe(parent.checksum)
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "parent expression descendantChecksum reflects children"`

- [ ] **Step 5: Write failing test — expression checksums change when a child is added**

```typescript
it("adding a child changes parent descendantChecksum", () => {
    const claimLib = new ClaimLibrary<TCoreClaim>()
    const sourceLib = new SourceLibrary<TCoreSource>()
    const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
    const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
    const engine = new ArgumentEngine(
        { id: "a1", version: 0 },
        claimLib, sourceLib, csLib,
    )
    const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
    engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
    engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
    pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
    pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
    pe.flushChecksums()
    const beforeDesc = pe.getExpression("e1")!.descendantChecksum
    const beforeCombined = pe.getExpression("e1")!.combinedChecksum

    pe.addExpression({ id: "e3", type: "variable", variableId: "v2", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
    pe.flushChecksums()
    const afterDesc = pe.getExpression("e1")!.descendantChecksum
    const afterCombined = pe.getExpression("e1")!.combinedChecksum

    expect(afterDesc).not.toBe(beforeDesc)
    expect(afterCombined).not.toBe(beforeCombined)
})
```

- [ ] **Step 6: Implement expression-level hierarchical checksums in `ExpressionManager`**

In `src/lib/core/expression-manager.ts`:

Add private field after line 82:

```typescript
private dirtyExpressionIds = new Set<string>()
```

Update `attachChecksum` (line 100-111) to set initial hierarchical values:

```typescript
private attachChecksum(expr: TExpressionInput<TExpr>): TExpr {
    const fields =
        this.config?.checksumConfig?.expressionFields ??
        DEFAULT_CHECKSUM_CONFIG.expressionFields!
    const metaChecksum = entityChecksum(
        expr as unknown as Record<string, unknown>,
        fields
    )
    return {
        ...expr,
        checksum: metaChecksum,
        descendantChecksum: null,
        combinedChecksum: metaChecksum,
    } as TExpr
}
```

Add dirty marking methods:

```typescript
/** Marks an expression and all its ancestors as checksum-dirty. */
public markExpressionDirty(exprId: string): void {
    let current: string | null = exprId
    while (current !== null) {
        if (this.dirtyExpressionIds.has(current)) break
        this.dirtyExpressionIds.add(current)
        const expr = this.expressions.get(current)
        current = expr ? expr.parentId : null
    }
}

/** Flushes dirty expression checksums in leaf-to-root order. */
public flushExpressionChecksums(): void {
    if (this.dirtyExpressionIds.size === 0) return

    // Sort dirty expressions by depth (deepest first) for bottom-up processing.
    // Depth = length of parentId chain to root.
    const dirtyIds = [...this.dirtyExpressionIds]
    const depthOf = (id: string): number => {
        let depth = 0
        let current = this.expressions.get(id)
        while (current && current.parentId !== null) {
            depth++
            current = this.expressions.get(current.parentId)
        }
        return depth
    }
    dirtyIds.sort((a, b) => depthOf(b) - depthOf(a))

    const fields =
        this.config?.checksumConfig?.expressionFields ??
        DEFAULT_CHECKSUM_CONFIG.expressionFields!

    for (const id of dirtyIds) {
        const expr = this.expressions.get(id)
        if (!expr) continue

        const metaChecksum = entityChecksum(
            expr as unknown as Record<string, unknown>,
            fields
        )

        const childIds = this.childExpressionIdsByParentId.get(id)
        let descendantChecksum: string | null = null
        if (childIds && childIds.size > 0) {
            const childMap: Record<string, string> = {}
            for (const childId of childIds) {
                const child = this.expressions.get(childId)
                if (child) {
                    childMap[childId] = child.combinedChecksum
                }
            }
            descendantChecksum = computeHash(canonicalSerialize(childMap))
        }

        const combinedChecksum =
            descendantChecksum === null
                ? metaChecksum
                : computeHash(metaChecksum + descendantChecksum)

        this.expressions.set(id, {
            ...expr,
            checksum: metaChecksum,
            descendantChecksum,
            combinedChecksum,
        } as TExpr)
    }

    this.dirtyExpressionIds.clear()
}

/** Removes deleted expression IDs from the dirty set. */
public pruneDeletedFromDirtySet(deletedIds: Set<string>): void {
    for (const id of deletedIds) {
        this.dirtyExpressionIds.delete(id)
    }
}
```

Add import for `computeHash` and `canonicalSerialize` from `./checksum.js` at the top of the file.

- [ ] **Step 7: Wire dirty marking into mutation methods**

In `ExpressionManager.addExpression()`: after the expression is stored, call `this.markExpressionDirty(expression.id)`. Also mark the parent dirty if `expression.parentId` is not null (the parent's descendantChecksum changed).

In `ExpressionManager.removeExpression()` (both `removeSubtree` and `removeAndPromote`): after deletion, call `this.pruneDeletedFromDirtySet(deletedIds)` and mark the parent of the removed expression dirty via `this.markExpressionDirty(parentId)`.

In `ExpressionManager.updateExpression()`: after the update, call `this.markExpressionDirty(expressionId)`.

In methods that reparent expressions (including `insertExpression`): mark both
old and new parent chains dirty via `markExpressionDirty`.

For `removeExpression` and `collapseIfNeeded`: the collapse logic recursively
deletes expressions and may promote children. Track deleted IDs during collapse
by collecting them from the `ChangeCollector`'s removed entries, or by adding
a return value to `collapseIfNeeded` that reports deleted IDs. After collapse:
1. Call `this.pruneDeletedFromDirtySet(deletedIds)` to remove stale IDs.
2. For promoted children (whose `parentId` changed), call
   `this.markExpressionDirty(promotedChildId)` so their meta checksum is
   recomputed (parentId is a checksum field).

- [ ] **Step 8: Wire `flushExpressionChecksums` into `PremiseEngine.flushChecksums`**

In `PremiseEngine`, update `flushChecksums()` (currently a stub from Task 2) to call `this.expressions.flushExpressionChecksums()`.

- [ ] **Step 9: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "expression hierarchical checksums"`
Expected: all three tests PASS

- [ ] **Step 10: Run full check**

Run: `pnpm run check`

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: implement expression-level hierarchical checksum computation with dirty propagation"
```

---

### Task 4: Premise-Level Hierarchical Checksums

**Files:**
- Modify: `src/lib/core/premise-engine.ts:91-99,1210-1274`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test — premise meta checksum is entity-only**

```typescript
describe("premise hierarchical checksums", () => {
    it("premise checksum is entity-only (meta)", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })

        const checksumBefore = pe.checksum()
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        const checksumAfter = pe.checksum()

        // Meta checksum should NOT change when expressions change
        expect(checksumAfter).toBe(checksumBefore)
    })

    it("premise descendantChecksum is null when no expressions", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        expect(pe.descendantChecksum()).toBeNull()
    })

    it("premise descendantChecksum equals root expression combinedChecksum", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.flushChecksums()

        const rootExpr = pe.getExpression("e1")!
        expect(pe.descendantChecksum()).toBe(rootExpr.combinedChecksum)
    })

    it("premise getCollectionChecksum('expressions') equals root expression combinedChecksum", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.flushChecksums()

        expect(pe.getCollectionChecksum("expressions")).toBe(pe.descendantChecksum())
    })

    it("premise combinedChecksum changes when expression tree changes", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        pe.flushChecksums()
        const metaBefore = pe.checksum()
        const combinedBefore = pe.combinedChecksum()

        pe.addExpression({ id: "e3", type: "variable", variableId: "v2", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        pe.flushChecksums()
        const combinedAfter = pe.combinedChecksum()

        expect(combinedAfter).not.toBe(combinedBefore)
        // Meta checksum unchanged (premise entity unchanged)
        expect(pe.checksum()).toBe(metaBefore)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "premise hierarchical checksums"`

- [ ] **Step 3: Implement premise-level hierarchical checksums**

In `src/lib/core/premise-engine.ts`:

Replace private fields (lines 98-99):

```typescript
private checksumDirty = true
private cachedMetaChecksum: string | undefined
private cachedDescendantChecksum: string | null | undefined
private cachedCombinedChecksum: string | undefined
```

Replace `checksum()` method (lines 1217-1223):

```typescript
public checksum(): string {
    if (this.checksumDirty || this.cachedMetaChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedMetaChecksum!
}

public descendantChecksum(): string | null {
    if (this.checksumDirty || this.cachedDescendantChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedDescendantChecksum!
}

public combinedChecksum(): string {
    if (this.checksumDirty || this.cachedCombinedChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedCombinedChecksum!
}

public getCollectionChecksum(_name: "expressions"): string | null {
    // For premises, the expressions collection checksum equals descendantChecksum
    return this.descendantChecksum()
}

public flushChecksums(): void {
    this.expressions.flushExpressionChecksums()

    const premiseFields =
        this.checksumConfig?.premiseFields ??
        DEFAULT_CHECKSUM_CONFIG.premiseFields!
    this.cachedMetaChecksum = entityChecksum(
        this.premise as unknown as Record<string, unknown>,
        premiseFields
    )

    const rootId = this.rootExpressionId
    if (rootId) {
        const rootExpr = this.expressions.get(rootId)
        this.cachedDescendantChecksum = rootExpr
            ? rootExpr.combinedChecksum
            : null
    } else {
        this.cachedDescendantChecksum = null
    }

    this.cachedCombinedChecksum =
        this.cachedDescendantChecksum === null
            ? this.cachedMetaChecksum
            : computeHash(
                  this.cachedMetaChecksum + this.cachedDescendantChecksum
              )

    this.checksumDirty = false
}
```

Remove the old `computeChecksum()` method (lines 1229-1247).

Update `toPremiseData()` (lines 1210-1215):

```typescript
public toPremiseData(): TPremise {
    this.flushChecksums()
    return {
        ...this.premise,
        checksum: this.cachedMetaChecksum!,
        descendantChecksum: this.cachedDescendantChecksum!,
        combinedChecksum: this.cachedCombinedChecksum!,
    } as TPremise
}
```

Add `computeHash` import from `./checksum.js`.

Update `PremiseEngine.snapshot()` to flush and include hierarchical checksums
on the premise entity:

```typescript
public snapshot(): TPremiseEngineSnapshot<TPremise, TExpr> {
    this.flushChecksums()
    return {
        premise: {
            ...this.premise,
            checksum: this.cachedMetaChecksum!,
            descendantChecksum: this.cachedDescendantChecksum!,
            combinedChecksum: this.cachedCombinedChecksum!,
        } as TPremise,
        expressions: this.expressions.snapshot(),
        config: this.config,
    }
}
```

(Adjust to match the actual `snapshot()` shape — the key change is that the
premise entity in the snapshot must carry all three checksum fields.)

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "premise hierarchical checksums"`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: implement premise-level hierarchical checksum computation"
```

---

### Task 5: Argument-Level Hierarchical Checksums

**Files:**
- Modify: `src/lib/core/argument-engine.ts:119-143,1211-1257`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests — argument hierarchical checksums**

```typescript
describe("argument hierarchical checksums", () => {
    it("argument checksum includes role state", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })

        const checksumBefore = engine.checksum()
        engine.setConclusionPremise("p1")
        const checksumAfter = engine.checksum()

        // Meta checksum changes because role state is folded in
        expect(checksumAfter).not.toBe(checksumBefore)
    })

    it("argument descendantChecksum is null when no premises and no variables", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        expect(engine.descendantChecksum()).toBeNull()
    })

    it("argument getCollectionChecksum('premises') changes when premise expression changes", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.flushChecksums()
        const premisesBefore = engine.getCollectionChecksum("premises")

        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        engine.flushChecksums()
        const premisesAfter = engine.getCollectionChecksum("premises")

        expect(premisesAfter).not.toBe(premisesBefore)
    })

    it("argument getCollectionChecksum('variables') changes when variable is added", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        engine.flushChecksums()
        const varsBefore = engine.getCollectionChecksum("variables")

        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.flushChecksums()
        const varsAfter = engine.getCollectionChecksum("variables")

        expect(varsAfter).not.toBe(varsBefore)
    })

    it("argument combinedChecksum changes when deep expression added", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        engine.flushChecksums()
        const metaBefore = engine.checksum()
        const combinedBefore = engine.combinedChecksum()

        pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        engine.flushChecksums()
        const combinedAfter = engine.combinedChecksum()

        expect(combinedAfter).not.toBe(combinedBefore)
        // Meta checksum unchanged (argument entity and roles unchanged)
        expect(engine.checksum()).toBe(metaBefore)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "argument hierarchical checksums"`

- [ ] **Step 3: Implement argument-level hierarchical checksums**

In `src/lib/core/argument-engine.ts`:

Replace private fields (lines 129-130):

```typescript
private checksumDirty = true
private cachedMetaChecksum: string | undefined
private cachedDescendantChecksum: string | null | undefined
private cachedCombinedChecksum: string | undefined
private premisesCollectionChecksumDirty = true
private variablesCollectionChecksumDirty = true
private cachedPremisesCollectionChecksum: string | null | undefined
private cachedVariablesCollectionChecksum: string | null | undefined
```

Replace `checksum()` and `computeChecksum()` methods (lines 1211-1246):

```typescript
public checksum(): string {
    if (this.checksumDirty || this.cachedMetaChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedMetaChecksum!
}

public descendantChecksum(): string | null {
    if (this.checksumDirty || this.cachedDescendantChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedDescendantChecksum!
}

public combinedChecksum(): string {
    if (this.checksumDirty || this.cachedCombinedChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedCombinedChecksum!
}

public getCollectionChecksum(name: "premises" | "variables"): string | null {
    if (name === "premises") {
        if (this.premisesCollectionChecksumDirty || this.cachedPremisesCollectionChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedPremisesCollectionChecksum!
    }
    if (this.variablesCollectionChecksumDirty || this.cachedVariablesCollectionChecksum === undefined) {
        this.flushChecksums()
    }
    return this.cachedVariablesCollectionChecksum!
}

public flushChecksums(): void {
    const config = this.checksumConfig

    // 1. Flush all premise checksums (which flush expression checksums)
    for (const pe of this.listPremises()) {
        pe.flushChecksums()
    }

    // 2. Compute argument meta checksum (entity fields + role state merged)
    const argumentFields =
        config?.argumentFields ?? DEFAULT_CHECKSUM_CONFIG.argumentFields!
    const roleFields =
        config?.roleFields ?? DEFAULT_CHECKSUM_CONFIG.roleFields!
    const mergedFields = new Set([...argumentFields, ...roleFields])
    const mergedEntity = {
        ...(this.argument as unknown as Record<string, unknown>),
        ...(this.getRoleState() as unknown as Record<string, unknown>),
    }
    this.cachedMetaChecksum = entityChecksum(mergedEntity, mergedFields)

    // 3. Compute collection checksums
    const premiseEntries = this.listPremises()
    if (premiseEntries.length > 0) {
        const premiseMap: Record<string, string> = {}
        for (const pe of premiseEntries) {
            premiseMap[pe.getId()] = pe.combinedChecksum()
        }
        this.cachedPremisesCollectionChecksum = computeHash(
            canonicalSerialize(premiseMap)
        )
    } else {
        this.cachedPremisesCollectionChecksum = null
    }

    const vars = this.variables.toArray()
    if (vars.length > 0) {
        const varMap: Record<string, string> = {}
        for (const v of vars) {
            varMap[v.id] = v.checksum
        }
        this.cachedVariablesCollectionChecksum = computeHash(
            canonicalSerialize(varMap)
        )
    } else {
        this.cachedVariablesCollectionChecksum = null
    }

    // 4. Compute descendant checksum from non-null collection checksums
    const collectionMap: Record<string, string> = {}
    if (this.cachedPremisesCollectionChecksum !== null) {
        collectionMap.premises = this.cachedPremisesCollectionChecksum
    }
    if (this.cachedVariablesCollectionChecksum !== null) {
        collectionMap.variables = this.cachedVariablesCollectionChecksum
    }
    this.cachedDescendantChecksum =
        Object.keys(collectionMap).length > 0
            ? computeHash(canonicalSerialize(collectionMap))
            : null

    // 5. Compute combined checksum
    this.cachedCombinedChecksum =
        this.cachedDescendantChecksum === null
            ? this.cachedMetaChecksum
            : computeHash(
                  this.cachedMetaChecksum + this.cachedDescendantChecksum
              )

    this.checksumDirty = false
    this.premisesCollectionChecksumDirty = false
    this.variablesCollectionChecksumDirty = false
}
```

Update `markDirty()` (line 1248):

```typescript
private markDirty(): void {
    this.checksumDirty = true
    this.premisesCollectionChecksumDirty = true
    this.variablesCollectionChecksumDirty = true
}
```

Add `canonicalSerialize` to the import from `./checksum.js`.

Remove the now-unnecessary separate collection dirty flags
(`premisesCollectionChecksumDirty`, `variablesCollectionChecksumDirty`) — the
single `checksumDirty` flag is sufficient since `flushChecksums()` recomputes
everything and all flags are set/cleared together.

Update `ArgumentEngine.snapshot()` to flush and include hierarchical checksums
on the argument entity:

```typescript
public snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar> {
    this.flushChecksums()
    return {
        argument: {
            ...this.argument,
            checksum: this.cachedMetaChecksum!,
            descendantChecksum: this.cachedDescendantChecksum!,
            combinedChecksum: this.cachedCombinedChecksum!,
        } as TArg,
        variables: this.variables.snapshot(),
        premises: this.listPremises().map((pe) => pe.snapshot()),
        ...(this.conclusionPremiseId !== undefined
            ? { conclusionPremiseId: this.conclusionPremiseId }
            : {}),
        config: {
            checksumConfig: serializeChecksumConfig(this.checksumConfig),
            positionConfig: this.positionConfig,
            grammarConfig: this.grammarConfig,
        } as TLogicEngineOptions,
    }
}
```

Update `ArgumentEngine.getArgument()` to include all three checksums:

```typescript
public getArgument(): TArg {
    this.flushChecksums()
    return {
        ...this.argument,
        checksum: this.cachedMetaChecksum!,
        descendantChecksum: this.cachedDescendantChecksum!,
        combinedChecksum: this.cachedCombinedChecksum!,
    } as TArg
}
```

- [ ] **Step 4: Wire premise mutation propagation to ArgumentEngine dirty flag**

The existing `PremiseEngine.onMutate` callback is called after expression
mutations — it currently drives the reactive dirty system. Add a second
callback or extend the existing one to also mark the argument checksum dirty.

In `ArgumentEngine`, when wiring premises (both in constructor paths and
`createPremise`), ensure the `onMutate` callback also calls `this.markDirty()`:

```typescript
pe.setOnMutate(() => {
    this.markDirty()
    this.reactiveDirty.premiseIds.add(premiseId)
    this.notifySubscribers()
})
```

This ensures that when an expression changes within a PremiseEngine, the
ArgumentEngine's checksum dirty flag is set, so the next access to
`engine.combinedChecksum()` triggers a full flush.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "argument hierarchical checksums"`
Expected: PASS

- [ ] **Step 6: Run full check**

Run: `pnpm run check`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: implement argument-level hierarchical checksum computation with collection checksums"
```

---

### Task 6: Snapshot Restoration with Checksum Verification

**Files:**
- Modify: `src/lib/core/argument-engine.ts:966-1041` (fromSnapshot)
- Modify: `src/lib/core/argument-engine.ts:1049-1079` (fromData)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test — `fromSnapshot` with strict verification passes for correct checksums**

```typescript
describe("checksum verification on load", () => {
    it("fromSnapshot with 'strict' passes when checksums match", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        engine.flushChecksums()
        const snap = engine.snapshot()

        expect(() => {
            ArgumentEngine.fromSnapshot(snap, claimLib, sourceLib, csLib, undefined, "strict")
        }).not.toThrow()
    })

    it("fromSnapshot with 'strict' throws when checksum is tampered", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with an expression checksum
        snap.premises[0].expressions[0].checksum = "tampered!"

        expect(() => {
            ArgumentEngine.fromSnapshot(snap, claimLib, sourceLib, csLib, undefined, "strict")
        }).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'ignore' (default) does not throw on tampered checksums", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const snap = engine.snapshot()
        snap.argument.checksum = "tampered!"

        expect(() => {
            ArgumentEngine.fromSnapshot(snap, claimLib, sourceLib, csLib)
        }).not.toThrow()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "checksum verification on load"`

- [ ] **Step 3: Add `checksumVerification` parameter to `fromSnapshot`**

In `src/lib/core/argument-engine.ts`, update the `fromSnapshot` signature (line 976-982) to accept a new parameter:

```typescript
snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>,
claimLibrary: TClaimLookup<TClaim>,
sourceLibrary: TSourceLookup<TSource>,
claimSourceLibrary: TClaimSourceLookup<TAssoc>,
grammarConfig?: TGrammarConfig,
checksumVerification?: "ignore" | "strict"
```

After the engine is fully restored (before the return statement at line 1040), add verification:

```typescript
engine.flushChecksums()

if (checksumVerification === "strict") {
    // Verify expression checksums
    for (const pe of engine.listPremises()) {
        for (const expr of pe.getExpressions()) {
            const premiseSnap = snapshot.premises.find(
                (ps) => ps.premise.id === pe.getId()
            )
            const exprSnap = premiseSnap?.expressions.find(
                (e) => e.id === expr.id
            )
            if (exprSnap) {
                if (exprSnap.checksum && exprSnap.checksum !== expr.checksum) {
                    throw new Error(
                        `Checksum mismatch on expression "${expr.id}": stored checksum="${exprSnap.checksum}", computed="${expr.checksum}"`
                    )
                }
                if (exprSnap.descendantChecksum !== undefined && exprSnap.descendantChecksum !== expr.descendantChecksum) {
                    throw new Error(
                        `Checksum mismatch on expression "${expr.id}": stored descendantChecksum="${exprSnap.descendantChecksum}", computed="${expr.descendantChecksum}"`
                    )
                }
                if (exprSnap.combinedChecksum && exprSnap.combinedChecksum !== expr.combinedChecksum) {
                    throw new Error(
                        `Checksum mismatch on expression "${expr.id}": stored combinedChecksum="${exprSnap.combinedChecksum}", computed="${expr.combinedChecksum}"`
                    )
                }
            }
        }
    }
    // Verify variable checksums
    for (const v of engine.listVariables()) {
        const varSnap = snapshot.variables.variables.find(
            (sv) => (sv as Record<string, unknown>).id === v.id
        )
        if (varSnap && (varSnap as Record<string, unknown>).checksum) {
            if ((varSnap as Record<string, unknown>).checksum !== v.checksum) {
                throw new Error(
                    `Checksum mismatch on variable "${v.id}": stored="${(varSnap as Record<string, unknown>).checksum}", computed="${v.checksum}"`
                )
            }
        }
    }
    // Verify premise checksums (all three fields)
    for (const pe of engine.listPremises()) {
        const premiseSnap = snapshot.premises.find(
            (ps) => ps.premise.id === pe.getId()
        )
        if (premiseSnap?.premise) {
            const sp = premiseSnap.premise as Record<string, unknown>
            for (const field of ["checksum", "descendantChecksum", "combinedChecksum"] as const) {
                const stored = sp[field]
                const computed = pe[field]()
                if (stored !== undefined && stored !== computed) {
                    throw new Error(
                        `Checksum mismatch on premise "${pe.getId()}" field "${field}": stored="${stored}", computed="${computed}"`
                    )
                }
            }
        }
    }
    // Verify argument checksums (all three fields)
    const sa = snapshot.argument as Record<string, unknown>
    for (const field of ["checksum", "descendantChecksum", "combinedChecksum"] as const) {
        const stored = sa[field]
        const computed = engine[field]()
        if (stored !== undefined && stored !== computed) {
            throw new Error(
                `Checksum mismatch on argument "${engine.getArgument().id}" field "${field}": stored="${stored}", computed="${computed}"`
            )
        }
    }
}

return engine
```

- [ ] **Step 4: Add same parameter to `fromData`**

Update `fromData` signature similarly. Add `checksumVerification` parameter after `grammarConfig`. Add the same verification logic before the return.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "checksum verification on load"`
Expected: PASS

- [ ] **Step 6: Run full check**

Run: `pnpm run check`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add checksum verification option to fromSnapshot and fromData"
```

---

### Task 7: Update Existing Checksum Tests

**Files:**
- Modify: `test/core.test.ts:5263-5490` (existing checksum describe blocks)

- [ ] **Step 1: Update existing "checksum utilities" tests**

The tests at lines 5263+ should still pass since `entityChecksum`, `computeHash`, and `canonicalSerialize` are unchanged. Verify this.

Run: `pnpm vitest run test/core.test.ts -t "checksum utilities"`

- [ ] **Step 2: Update existing "PremiseEngine — checksum" tests**

Tests at line 5348+ may reference the old composite `checksum()` behavior. Update them:
- Tests expecting `checksum()` to change when expressions change → change to `combinedChecksum()`
- Tests expecting same `checksum()` for same state → keep (meta checksum is still deterministic)

- [ ] **Step 3: Update existing "ArgumentEngine — checksum" tests**

Tests at line 5438+ may reference the old composite `checksum()` behavior. Same updates:
- Composite behavior → `combinedChecksum()`
- Entity-only behavior → `checksum()` (now meta)

- [ ] **Step 4: Update existing "entity checksum fields" tests**

Tests at line 5497+ verify `.checksum` on entities. These should still pass since meta checksums work the same way. Verify and add assertions for `descendantChecksum` and `combinedChecksum` where appropriate.

- [ ] **Step 5: Update "checksumConfig Set reconstruction" tests**

Tests at line 14839+ should still pass. Verify.

- [ ] **Step 6: Run full test suite**

Run: `pnpm run check`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: update existing checksum tests for hierarchical checksum semantics"
```

---

### Task 8: Diff System — Exclude Derived Checksums

**Files:**
- Modify: `src/lib/core/diff.ts:69-115`
- Test: `test/core.test.ts`

- [ ] **Step 1: Verify `defaultCompareExpression` does not compare checksum fields**

Read `src/lib/core/diff.ts:69-115`. The current implementation only compares `type`, `parentId`, `position`, `variableId`, `operator`. It does NOT compare `checksum`, `descendantChecksum`, or `combinedChecksum`. No changes needed.

- [ ] **Step 2: Verify `defaultCompareArgument` and `defaultComparePremise` return empty**

Both return `[]` — no diffable fields. No changes needed since the new checksum fields are derived and should not be diffed.

- [ ] **Step 3: Write a test confirming derived checksums are not in diff output**

```typescript
describe("diff excludes derived checksums", () => {
    it("expression diff does not include checksum, descendantChecksum, or combinedChecksum", () => {
        // Build two engines with same structure but different internal checksums
        // (due to different creation order or variable IDs).
        // Run diffArguments and verify no checksum fields appear in expression field diffs.
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })

        const engine1 = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe1 = engine1.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine1.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe1.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })

        // Clone via snapshot to get identical structure
        engine1.flushChecksums()
        const snap = engine1.snapshot()
        const engine2 = ArgumentEngine.fromSnapshot(snap, claimLib, sourceLib, csLib)

        const diff = diffArguments(engine1, engine2)
        // No expression changes — structure is identical
        for (const premiseDiff of Object.values(diff.premises.modified)) {
            expect(premiseDiff.expressions.modified).toEqual({})
        }
    })
})
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run test/core.test.ts -t "diff excludes derived checksums"`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify diff system excludes derived checksum fields"
```

---

### Task 9: End-to-End Propagation Tests

**Files:**
- Test: `test/core.test.ts`

- [ ] **Step 1: Write deep propagation test**

```typescript
describe("hierarchical checksum propagation", () => {
    it("deep expression change propagates to premise and argument combined checksums", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.addVariable({ id: "v3", symbol: "R", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })

        // Build: and(P, or(Q, R))
        pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        pe.addExpression({ id: "e3", type: "formula", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        pe.addExpression({ id: "e4", type: "operator", operator: "or", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e3" })
        pe.addExpression({ id: "e5", type: "variable", variableId: "v2", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e4" })
        engine.flushChecksums()

        const argMetaBefore = engine.checksum()
        const argCombinedBefore = engine.combinedChecksum()
        const premiseMetaBefore = pe.checksum()
        const premiseCombinedBefore = pe.combinedChecksum()
        const e4Before = pe.getExpression("e4")!.combinedChecksum
        const e3Before = pe.getExpression("e3")!.combinedChecksum
        const e1Before = pe.getExpression("e1")!.combinedChecksum

        // Add R as child of or — deep mutation
        pe.addExpression({ id: "e6", type: "variable", variableId: "v3", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e4" })
        engine.flushChecksums()

        // e4 (or) changed — new child
        expect(pe.getExpression("e4")!.combinedChecksum).not.toBe(e4Before)
        // e3 (formula) changed — child e4 changed
        expect(pe.getExpression("e3")!.combinedChecksum).not.toBe(e3Before)
        // e1 (and, root) changed — child e3 changed
        expect(pe.getExpression("e1")!.combinedChecksum).not.toBe(e1Before)
        // Premise combined changed
        expect(pe.combinedChecksum()).not.toBe(premiseCombinedBefore)
        // Argument combined changed
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)

        // But meta checksums unchanged
        expect(pe.checksum()).toBe(premiseMetaBefore)
        expect(engine.checksum()).toBe(argMetaBefore)
    })

    it("variable mutation changes argument combinedChecksum but not premise combinedChecksum", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        engine.flushChecksums()

        const argCombinedBefore = engine.combinedChecksum()
        const premiseCombinedBefore = pe.combinedChecksum()

        engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.flushChecksums()

        // Argument combined changed (variables collection changed)
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
        // Premise combined unchanged (variables are argument-scoped)
        expect(pe.combinedChecksum()).toBe(premiseCombinedBefore)
    })

    it("operator collapse after removeExpression does not break flush", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        // Build: and(P, Q) — removing Q should collapse `and` and promote P
        pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        pe.addExpression({ id: "e3", type: "variable", variableId: "v2", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        engine.flushChecksums()

        pe.removeExpression("e3") // triggers collapse: and removed, P promoted to root
        // Should not throw — deleted expression IDs pruned from dirty set
        expect(() => engine.flushChecksums()).not.toThrow()

        // P is now root, its parentId changed so its meta checksum is recomputed
        const promotedExpr = pe.getExpression("e2")!
        expect(promotedExpr.parentId).toBeNull()
        expect(promotedExpr.descendantChecksum).toBeNull() // still a leaf
    })

    it("insertExpression propagates checksum changes to both old and new parent chains", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        engine.addVariable({ id: "v2", symbol: "Q", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        // Build: and(P, Q) then insert implies between root and children
        pe.addExpression({ id: "e1", type: "operator", operator: "and", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        pe.addExpression({ id: "e2", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        pe.addExpression({ id: "e3", type: "variable", variableId: "v2", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: "e1" })
        engine.flushChecksums()
        const combinedBefore = engine.combinedChecksum()

        pe.insertExpression({
            id: "e4",
            type: "operator",
            operator: "implies",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            leftNodeId: "e2",
            rightNodeId: "e3",
        })
        engine.flushChecksums()

        expect(engine.combinedChecksum()).not.toBe(combinedBefore)
    })

    it("snapshot round-trip preserves all hierarchical checksums", () => {
        const claimLib = new ClaimLibrary<TCoreClaim>()
        const sourceLib = new SourceLibrary<TCoreSource>()
        const csLib = new ClaimSourceLibrary<TCoreClaimSourceAssociation>()
        const claim = claimLib.create({ id: "c1", version: 0, frozen: false, checksum: "" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLib, sourceLib, csLib,
        )
        const pe = engine.createPremise({ id: "p1", argumentId: "a1", argumentVersion: 0 })
        engine.addVariable({ id: "v1", symbol: "P", argumentId: "a1", argumentVersion: 0, claimId: claim.id, claimVersion: claim.version })
        pe.addExpression({ id: "e1", type: "variable", variableId: "v1", argumentId: "a1", argumentVersion: 0, premiseId: "p1", parentId: null })
        engine.flushChecksums()

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, claimLib, sourceLib, csLib)
        restored.flushChecksums()

        expect(restored.checksum()).toBe(engine.checksum())
        expect(restored.descendantChecksum()).toBe(engine.descendantChecksum())
        expect(restored.combinedChecksum()).toBe(engine.combinedChecksum())
    })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "hierarchical checksum propagation"`
Expected: PASS

- [ ] **Step 3: Run full check**

Run: `pnpm run check`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add end-to-end hierarchical checksum propagation tests"
```

---

### Task 10: Cleanup and Documentation Sync

**Files:**
- Modify: `CLAUDE.md` — update design rules for hierarchical checksums
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts` — update JSDoc
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` — update JSDoc
- Modify: `src/lib/core/interfaces/shared.interfaces.ts` — verify JSDoc

- [ ] **Step 1: Update CLAUDE.md design rules**

Replace the checksum-related content with the new hierarchical model. Key points:
- Three-pronged checksums: `checksum` (meta), `descendantChecksum`, `combinedChecksum`
- Meta checksum = entity data only, driven by `checksumConfig`
- Descendant/combined are fixed recursive formulas
- Lazy flush with dirty propagation
- Variables are non-hierarchical (single `checksum`)

- [ ] **Step 2: Update interface JSDoc**

Ensure `argument-engine.interfaces.ts` and `premise-engine.interfaces.ts` reflect the new `THierarchicalChecksummable` methods in their interface documentation.

- [ ] **Step 3: Run lint and prettify**

Run: `pnpm run prettify && pnpm run lint`

- [ ] **Step 4: Run full check**

Run: `pnpm run check`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md and interface JSDoc for hierarchical checksums"
```

- [ ] **Step 6: Offer version bump**

Offer to cut a new version via `pnpm version minor` (this is a significant feature/breaking change). Write release notes to `docs/release-notes/<version>.md`.
