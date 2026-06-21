# Auto-Conclusion on First Premise — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically designate the first premise added to an ArgumentEngine as the conclusion premise.

**Architecture:** Add a conditional block in `createPremiseWithId` that sets `this.conclusionPremiseId` when it's currently `undefined`. The changeset emits the role change. Existing tests need minor updates to account for the auto-assignment.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing tests for auto-conclusion behavior

**Files:**

- Modify: `test/ExpressionManager.test.ts` (append new describe block at bottom)

**Step 1: Write the failing tests**

Add a new describe block at the bottom of the test file (before the closing of the file):

```typescript
// ---------------------------------------------------------------------------
// ArgumentEngine — auto-conclusion on first premise
// ---------------------------------------------------------------------------

describe("ArgumentEngine — auto-conclusion on first premise", () => {
    it("first createPremise auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("first createPremiseWithId auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm, changes } = eng.createPremiseWithId("my-premise")
        expect(eng.getRoleState().conclusionPremiseId).toBe("my-premise")
        expect(changes.roles?.conclusionPremiseId).toBe("my-premise")
    })

    it("second createPremise does not change conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: first } = eng.createPremise()
        const { changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(first.getId())
        expect(changes.roles).toBeUndefined()
    })

    it("createPremise after clearConclusionPremise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        eng.clearConclusionPremise()
        const { result: pm2, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm2.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm2.getId())
    })

    it("createPremise after removing conclusion premise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: first } = eng.createPremise()
        eng.removePremise(first.getId())
        const { result: second, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(second.getId())
    })

    it("setConclusionPremise overrides auto-assignment", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: first } = eng.createPremise()
        const { result: second } = eng.createPremise()
        eng.setConclusionPremise(second.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: The new tests fail — `getRoleState().conclusionPremiseId` is `undefined` after first createPremise.

**Step 3: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Add failing tests for auto-conclusion on first premise"
```

### Task 2: Implement auto-conclusion in createPremiseWithId

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts:85-107`

**Step 1: Add auto-conclusion logic**

In `createPremiseWithId`, after the line `this.markDirty()` (line 102) and before the `return`, add the auto-conclusion logic. The full method should become:

```typescript
public createPremiseWithId(
    id: string,
    extras?: Record<string, unknown>
): TCoreMutationResult<PremiseManager> {
    if (this.premises.has(id)) {
        throw new Error(`Premise "${id}" already exists.`)
    }
    const pm = new PremiseManager(
        id,
        this.argument,
        this.variables,
        extras,
        this.checksumConfig
    )
    this.premises.set(id, pm)
    const collector = new ChangeCollector()
    collector.addedPremise(pm.toData())
    this.markDirty()

    if (this.conclusionPremiseId === undefined) {
        this.conclusionPremiseId = id
        collector.setRoles(this.getRoleState())
    }

    return {
        result: pm,
        changes: collector.toChangeset() as TCoreChangeset,
    }
}
```

**Step 2: Run tests to verify new tests pass**

Run: `pnpm test`
Expected: All 6 new tests pass.

**Step 3: Commit**

```bash
git add src/lib/core/ArgumentEngine.ts
git commit -m "Auto-set first premise as conclusion in createPremiseWithId"
```

### Task 3: Fix existing tests affected by auto-conclusion

**Files:**

- Modify: `test/ExpressionManager.test.ts`

The following existing tests need updates because the first `createPremise` now auto-sets the conclusion:

**Step 1: Update "createPremise returns PremiseManager and records added premise" (line ~4861)**

This test now gets `roles` in the changeset. Add an assertion:

```typescript
it("createPremise returns PremiseManager and records added premise", () => {
    const eng = new ArgumentEngine({ id: "arg1", version: 0 })
    const { result: pm, changes } = eng.createPremise()
    expect(pm).toBeInstanceOf(PremiseManager)
    expect(changes.premises?.added).toHaveLength(1)
    expect(changes.premises?.added[0].id).toBe(pm.getId())
    expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
})
```

**Step 2: Update "createPremiseWithId returns PremiseManager with specified ID" (line ~4869)**

Same — add roles assertion:

```typescript
it("createPremiseWithId returns PremiseManager with specified ID", () => {
    const eng = new ArgumentEngine({ id: "arg1", version: 0 })
    const { result: pm, changes } = eng.createPremiseWithId("my-premise")
    expect(pm.getId()).toBe("my-premise")
    expect(changes.premises?.added).toHaveLength(1)
    expect(changes.premises?.added[0].id).toBe("my-premise")
    expect(changes.roles?.conclusionPremiseId).toBe("my-premise")
})
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Update existing tests for auto-conclusion changeset"
```

### Task 4: Run full checks and update documentation

**Files:**

- Modify: `README.md` (if ArgumentEngine behavior is documented there)
- Modify: `CLAUDE.md` (update "Key design decisions" section)

**Step 1: Run full check**

Run: `pnpm run check`
Expected: All checks pass (typecheck, lint, test, build).

**Step 2: Update CLAUDE.md**

In the "Key design decisions" section, under the class hierarchy or ArgumentEngine description, add a note about auto-conclusion behavior. Add this after the paragraph about `ArgumentEngine` in the "Class hierarchy" section:

> When the first premise is added to an `ArgumentEngine` (via `createPremise` or `createPremiseWithId`), it is automatically designated as the conclusion premise if no conclusion is currently set. This auto-assignment is reflected in the mutation changeset. Explicit `setConclusionPremise()` overrides the auto-assignment. Removing or clearing the conclusion re-enables auto-assignment for the next premise created.

**Step 3: Update README.md if applicable**

Check if README.md documents ArgumentEngine premise creation or role behavior — update accordingly.

**Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document auto-conclusion behavior"
```
