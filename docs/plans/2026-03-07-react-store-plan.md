# React Store Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `subscribe()` and `getSnapshot()` to `ArgumentEngine` so it works as a `useSyncExternalStore`-compatible external store with structurally-shared snapshots.

**Architecture:** `ArgumentEngine` gains a listener set, dirty-tracking flags, and a cached reactive snapshot. `PremiseEngine` accepts an `onMutate` callback so mutations through it trigger notifications. Snapshots use structural sharing — unchanged slices keep the same object reference.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add `TReactiveSnapshot` type

**Files:**

- Create: `src/lib/types/reactive.ts`
- Modify: `src/lib/index.ts`

**Step 1: Create the type file**

```ts
// src/lib/types/reactive.ts
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
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
}
```

**Step 2: Export from barrel**

Add to `src/lib/index.ts`:

```ts
export * from "./types/reactive.js"
```

**Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```
feat: add TReactiveSnapshot type
```

---

### Task 2: Add `onMutate` callback to `PremiseEngine`

**Files:**

- Modify: `src/lib/core/premiseEngine.ts`
- Test: `test/core.test.ts`

**Step 1: Write the failing test**

Add a new `describe("PremiseEngine onMutate callback")` block:

```ts
describe("PremiseEngine onMutate callback", () => {
    it("fires onMutate when addExpression is called", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()

        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        expect(callCount).toBe(1)
    })

    it("fires onMutate when removeExpression is called", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.removeExpression("expr-1", true)

        expect(callCount).toBe(1)
    })

    it("fires onMutate when updateExpression is called", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.updateExpression("expr-1", { operator: "or" })

        expect(callCount).toBe(1)
    })

    it("fires onMutate when appendExpression is called", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()

        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })

        premise.appendExpression(null, {
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
        })

        expect(callCount).toBe(1)
    })

    it("fires onMutate when insertExpression is called", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()

        premise.addExpression({
            id: "root",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const v = engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })

        premise.appendExpression("root", {
            id: "child-1",
            type: "variable",
            variableId: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
        })

        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })

        premise.insertExpression(
            {
                id: "wrapper",
                type: "operator",
                operator: "or",
                argumentId: arg.id,
                argumentVersion: arg.version,
                premiseId: premise.getId(),
                parentId: "root",
                position: 0,
            },
            "child-1"
        )

        expect(callCount).toBe(1)
    })

    it("does not fire onMutate when deleteExpressionsUsingVariable finds nothing", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()

        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.deleteExpressionsUsingVariable("nonexistent")

        expect(callCount).toBe(0)
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "PremiseEngine onMutate callback"`
Expected: FAIL — `setOnMutate` is not a function

**Step 3: Implement `setOnMutate` and call it from mutation methods**

In `src/lib/core/premiseEngine.ts`:

Add a private field after the existing private fields (around line 71):

```ts
private onMutate?: () => void
```

Add a public setter:

```ts
public setOnMutate(callback: (() => void) | undefined): void {
    this.onMutate = callback
}
```

Then add `this.onMutate?.()` at the end of each mutation method, right before the `return` statement (after `markDirty()` and `syncExpressionIndex()` calls):

- `addExpression` (line ~198, before `return`)
- `appendExpression` (line ~265, before `return`)
- `addExpressionRelative` (line ~325, before `return`)
- `updateExpression` (line ~398, before `return`) — only call when `changeset.expressions !== undefined`
- `removeExpression` (line ~464, before `return` inside the try block, after the snapshot check)
- `insertExpression` (line ~526, before `return`)
- `deleteExpressionsUsingVariable` (line ~126, before `return`) — only call when `removed.length > 0`

Note: `deleteExpressionsUsingVariable` calls `removeExpression` internally, but `removeExpression` will fire `onMutate` for each removal. Since `deleteExpressionsUsingVariable` is called by `ArgumentEngine.removeVariable` which handles its own notification, and `onMutate` is a no-op signal, multiple fires are acceptable. However, to keep it clean: only fire `onMutate` in `deleteExpressionsUsingVariable` if `removed.length > 0`, and do NOT fire in `removeExpression` when called internally from `deleteExpressionsUsingVariable`. The simplest approach: fire `onMutate` in every mutation method unconditionally (when something actually changed), and let `ArgumentEngine` debounce notifications if needed. Since `notifySubscribers` is synchronous and `getSnapshot` is lazy, multiple fires just mean multiple listener calls before the next render — React batches these naturally.

Actually, the simplest correct approach: call `this.onMutate?.()` at the end of each public mutation method that actually changed something. For `deleteExpressionsUsingVariable`, it internally calls `removeExpression` which will each fire `onMutate`. That's fine — the listener is just `() => this.markDirtyAndNotify(premiseId)` which is idempotent (dirty flag is already set after first call, notify fires listeners that will lazily rebuild snapshot).

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "PremiseEngine onMutate callback"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm vitest run`
Expected: all existing tests pass (no behavioral change)

**Step 6: Commit**

```
feat: add onMutate callback to PremiseEngine
```

---

### Task 3: Add subscribe/notify to `ArgumentEngine`

**Files:**

- Modify: `src/lib/core/argumentEngine.ts`
- Test: `test/core.test.ts`

**Step 1: Write the failing test**

Add a new `describe("ArgumentEngine subscribe")` block:

```ts
describe("ArgumentEngine subscribe", () => {
    it("notifies subscriber when a premise is created", () => {
        const engine = new ArgumentEngine(makeArgument())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.createPremise()
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a premise is removed", () => {
        const engine = new ArgumentEngine(makeArgument())
        const { result: premise } = engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removePremise(premise.getId())
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is added", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is updated", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.updateVariable("v1", { symbol: "Q" })
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is removed", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removeVariable("v1")
        expect(notified).toBe(true)
    })

    it("notifies subscriber when conclusion is set", () => {
        const engine = new ArgumentEngine(makeArgument())
        const { result: premise } = engine.createPremise()
        engine.clearConclusionPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.setConclusionPremise(premise.getId())
        expect(notified).toBe(true)
    })

    it("notifies subscriber when conclusion is cleared", () => {
        const engine = new ArgumentEngine(makeArgument())
        engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.clearConclusionPremise()
        expect(notified).toBe(true)
    })

    it("notifies subscriber on rollback", () => {
        const engine = new ArgumentEngine(makeArgument())
        const snap = engine.snapshot()
        engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.rollback(snap)
        expect(notified).toBe(true)
    })

    it("unsubscribe stops notifications", () => {
        const engine = new ArgumentEngine(makeArgument())
        let count = 0
        const unsub = engine.subscribe(() => {
            count++
        })
        engine.createPremise()
        expect(count).toBe(1)
        unsub()
        engine.createPremise()
        expect(count).toBe(1)
    })

    it("notifies subscriber when expression is mutated through PremiseEngine", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()
        let count = 0
        engine.subscribe(() => {
            count++
        })

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        expect(count).toBeGreaterThanOrEqual(1)
    })

    it("does not notify when removePremise finds nothing", () => {
        const engine = new ArgumentEngine(makeArgument())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removePremise("nonexistent")
        expect(notified).toBe(false)
    })

    it("does not notify when removeVariable finds nothing", () => {
        const engine = new ArgumentEngine(makeArgument())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removeVariable("nonexistent")
        expect(notified).toBe(false)
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentEngine subscribe"`
Expected: FAIL — `engine.subscribe` is not a function

**Step 3: Implement subscribe/notify in ArgumentEngine**

In `src/lib/core/argumentEngine.ts`, add private fields (after `expressionIndex` around line 79):

```ts
private listeners: Set<() => void> = new Set()
```

Add public `subscribe` method:

```ts
public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
}

private notifySubscribers(): void {
    for (const listener of this.listeners) {
        listener()
    }
}
```

Then wire `onMutate` into premise creation. In `createPremiseWithId` (line ~170), after creating the `PremiseEngine`, wire the callback:

```ts
pm.setOnMutate(() => {
    this.notifySubscribers()
})
```

Add `this.notifySubscribers()` at the end of each `ArgumentEngine` mutation method (just before `return`):

- `createPremiseWithId` (line ~192)
- `removePremise` (line ~220) — only when premise was found
- `addVariable` (line ~281)
- `updateVariable` (line ~308) — only when variable was found
- `removeVariable` (line ~347) — only when variable was found
- `setConclusionPremise` (line ~484)
- `clearConclusionPremise` (line ~503)
- `rollback` (line ~698)

For `rollback`, also re-wire `onMutate` on all reconstructed premises:

```ts
for (const pe of this.premises.values()) {
    pe.setOnMutate(() => {
        this.notifySubscribers()
    })
}
```

Also wire `onMutate` in `fromSnapshot` and `fromData` static methods — the engine returned from those should have premises wired. These statics create an engine via the constructor and `createPremiseWithId`, so if `createPremiseWithId` wires the callback, they're already covered.

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentEngine subscribe"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm vitest run`
Expected: all tests pass

**Step 6: Commit**

```
feat: add subscribe/notify to ArgumentEngine
```

---

### Task 4: Add dirty tracking and `getSnapshot()` with structural sharing

**Files:**

- Modify: `src/lib/core/argumentEngine.ts`
- Test: `test/core.test.ts`

**Step 1: Write the failing tests**

Add a new `describe("ArgumentEngine getSnapshot")` block:

```ts
describe("ArgumentEngine getSnapshot", () => {
    it("returns a snapshot with argument, variables, premises, and roles", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })
        const { result: premise } = engine.createPremise()
        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const snap = engine.getSnapshot()

        expect(snap.argument.id).toBe(arg.id)
        expect(snap.variables["v1"]).toBeDefined()
        expect(snap.variables["v1"].symbol).toBe("P")
        expect(snap.premises[premise.getId()]).toBeDefined()
        expect(
            snap.premises[premise.getId()].expressions["expr-1"]
        ).toBeDefined()
        expect(snap.premises[premise.getId()].rootExpressionId).toBe("expr-1")
        expect(snap.roles).toBeDefined()
    })

    it("returns the same reference when nothing has changed", () => {
        const engine = new ArgumentEngine(makeArgument())
        engine.createPremise()
        const snap1 = engine.getSnapshot()
        const snap2 = engine.getSnapshot()
        expect(snap1).toBe(snap2)
    })

    it("returns a new top-level reference after a mutation", () => {
        const engine = new ArgumentEngine(makeArgument())
        const snap1 = engine.getSnapshot()
        engine.createPremise()
        const snap2 = engine.getSnapshot()
        expect(snap1).not.toBe(snap2)
    })

    it("preserves premise reference when a different premise is mutated", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premiseA } = engine.createPremiseWithId("pA")
        engine.createPremiseWithId("pB")
        const snap1 = engine.getSnapshot()

        premiseA.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: "pA",
            parentId: null,
            position: 0,
        })

        const snap2 = engine.getSnapshot()
        // pA changed — different reference
        expect(snap2.premises["pA"]).not.toBe(snap1.premises["pA"])
        // pB unchanged — same reference
        expect(snap2.premises["pB"]).toBe(snap1.premises["pB"])
    })

    it("returns new variables reference when a variable is added", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const snap1 = engine.getSnapshot()
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })
        const snap2 = engine.getSnapshot()
        expect(snap2.variables).not.toBe(snap1.variables)
    })

    it("preserves variables reference when only a premise is mutated", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        const { result: premise } = engine.createPremise()
        const snap1 = engine.getSnapshot()

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const snap2 = engine.getSnapshot()
        expect(snap2.variables).toBe(snap1.variables)
    })

    it("returns new roles reference when conclusion changes", () => {
        const engine = new ArgumentEngine(makeArgument())
        const { result: premise } = engine.createPremise()
        engine.clearConclusionPremise()
        const snap1 = engine.getSnapshot()
        engine.setConclusionPremise(premise.getId())
        const snap2 = engine.getSnapshot()
        expect(snap2.roles).not.toBe(snap1.roles)
    })

    it("preserves roles reference when only a variable changes", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        engine.createPremise()
        const snap1 = engine.getSnapshot()
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })
        const snap2 = engine.getSnapshot()
        expect(snap2.roles).toBe(snap1.roles)
    })

    it("rebuilds fully after rollback", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)
        engine.createPremise()
        const engineSnap = engine.snapshot()
        const reactiveSnap1 = engine.getSnapshot()

        engine.createPremise()
        engine.rollback(engineSnap)

        const reactiveSnap2 = engine.getSnapshot()
        expect(reactiveSnap2).not.toBe(reactiveSnap1)
        expect(Object.keys(reactiveSnap2.premises).length).toBe(1)
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentEngine getSnapshot"`
Expected: FAIL — `engine.getSnapshot` is not a function

**Step 3: Implement dirty tracking and getSnapshot**

In `src/lib/core/argumentEngine.ts`, add the import for the reactive type:

```ts
import type {
    TReactiveSnapshot,
    TReactivePremiseSnapshot,
} from "../types/reactive.js"
```

Add private fields (after `listeners`):

```ts
private reactiveDirty = {
    argument: true,
    variables: true,
    roles: true,
    premiseIds: new Set<string>(),
    allPremises: true,  // initial build needs all
}
private cachedReactiveSnapshot: TReactiveSnapshot<TArg, TPremise, TExpr, TVar> | undefined
```

Add `getSnapshot`:

```ts
public getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar> {
    const dirty = this.reactiveDirty
    const prev = this.cachedReactiveSnapshot

    if (prev && !dirty.argument && !dirty.variables && !dirty.roles && dirty.premiseIds.size === 0 && !dirty.allPremises) {
        return prev
    }

    const argument = dirty.argument || !prev
        ? this.getArgument()
        : prev.argument

    const variables = dirty.variables || !prev
        ? this.buildVariablesRecord()
        : prev.variables

    const roles = dirty.roles || !prev
        ? { ...this.getRoleState() }
        : prev.roles

    let premises: Record<string, TReactivePremiseSnapshot<TPremise, TExpr>>
    if (dirty.allPremises || !prev) {
        premises = this.buildAllPremisesRecord()
    } else {
        premises = { ...prev.premises }
        // Remove premises that no longer exist
        for (const id of Object.keys(premises)) {
            if (!this.premises.has(id)) {
                delete premises[id]
            }
        }
        // Rebuild dirty premises and add new ones
        for (const id of dirty.premiseIds) {
            const pm = this.premises.get(id)
            if (pm) {
                premises[id] = this.buildPremiseRecord(pm)
            }
        }
        // Add any premises that exist but aren't in the snapshot yet
        for (const [id, pm] of this.premises) {
            if (!(id in premises)) {
                premises[id] = this.buildPremiseRecord(pm)
            }
        }
    }

    const snapshot: TReactiveSnapshot<TArg, TPremise, TExpr, TVar> = {
        argument,
        variables,
        premises,
        roles,
    }

    this.cachedReactiveSnapshot = snapshot
    this.reactiveDirty = {
        argument: false,
        variables: false,
        roles: false,
        premiseIds: new Set(),
        allPremises: false,
    }

    return snapshot
}

private buildVariablesRecord(): Record<string, TVar> {
    const result: Record<string, TVar> = {}
    for (const v of this.variables.toArray()) {
        result[v.id] = v
    }
    return result
}

private buildAllPremisesRecord(): Record<string, TReactivePremiseSnapshot<TPremise, TExpr>> {
    const result: Record<string, TReactivePremiseSnapshot<TPremise, TExpr>> = {}
    for (const [id, pm] of this.premises) {
        result[id] = this.buildPremiseRecord(pm)
    }
    return result
}

private buildPremiseRecord(
    pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
): TReactivePremiseSnapshot<TPremise, TExpr> {
    const expressions: Record<string, TExpr> = {}
    for (const expr of pm.getExpressions()) {
        expressions[expr.id] = expr
    }
    return {
        premise: pm.toPremiseData(),
        expressions,
        rootExpressionId: pm.getRootExpressionId(),
    }
}
```

Now update `markDirty` and add `markReactiveDirty`:

Add a helper that reads a changeset and sets the appropriate dirty flags:

```ts
private markReactiveDirty(changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>): void {
    if (changes.argument) {
        this.reactiveDirty.argument = true
    }
    if (changes.variables) {
        this.reactiveDirty.variables = true
    }
    if (changes.roles) {
        this.reactiveDirty.roles = true
    }
    if (changes.expressions) {
        const allExprs = [
            ...changes.expressions.added,
            ...changes.expressions.modified,
            ...changes.expressions.removed,
        ]
        for (const expr of allExprs) {
            this.reactiveDirty.premiseIds.add(expr.premiseId)
        }
    }
    if (changes.premises) {
        for (const p of [...changes.premises.added, ...changes.premises.modified, ...changes.premises.removed]) {
            this.reactiveDirty.premiseIds.add(p.id)
        }
    }
}
```

Then call `this.markReactiveDirty(changes)` in each mutation method, right before `this.notifySubscribers()`. The changeset is already computed at that point.

For `rollback`, set all dirty flags since the entire state is replaced:

```ts
this.reactiveDirty = {
    argument: true,
    variables: true,
    roles: true,
    premiseIds: new Set(),
    allPremises: true,
}
```

For the `onMutate` callback wired on `PremiseEngine`, change it from just calling `notifySubscribers` to also marking that premise dirty:

```ts
pm.setOnMutate(() => {
    this.reactiveDirty.premiseIds.add(id)
    this.notifySubscribers()
})
```

Note: the `id` here is the premise ID captured in the closure from `createPremiseWithId`. This is the existing variable `id` at line 161.

**Step 4: Add the TCoreChangeset import if not already present**

Check that `TCoreChangeset` is imported in `argumentEngine.ts`. It's currently imported only as a type in `premiseEngine.ts`. Add to `argumentEngine.ts` imports:

```ts
import type { TCoreMutationResult, TCoreChangeset } from "../types/mutation.js"
```

(Replace the existing `import type { TCoreMutationResult }` line.)

**Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentEngine getSnapshot"`
Expected: PASS

**Step 6: Run full test suite**

Run: `pnpm vitest run`
Expected: all tests pass

**Step 7: Commit**

```
feat: add getSnapshot with structural sharing to ArgumentEngine
```

---

### Task 5: Export `subscribe` and `getSnapshot` from barrel, verify full integration

**Files:**

- Modify: `src/lib/index.ts` (already done in Task 1 for types)
- Test: `test/core.test.ts`

`subscribe` and `getSnapshot` are instance methods on `ArgumentEngine` which is already exported. No additional barrel changes needed beyond the type export from Task 1.

**Step 1: Write an integration test**

Add to `test/core.test.ts`:

```ts
describe("ArgumentEngine reactive store integration", () => {
    it("works as a useSyncExternalStore-compatible store", () => {
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg)

        // Simulate useSyncExternalStore contract:
        // 1. subscribe returns unsubscribe
        // 2. getSnapshot returns stable reference when unchanged
        // 3. getSnapshot returns new reference when changed

        const snapshots: TReactiveSnapshot[] = []
        const unsub = engine.subscribe(() => {
            snapshots.push(engine.getSnapshot())
        })

        const snap0 = engine.getSnapshot()

        // Mutation 1: add variable
        engine.addVariable({
            id: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            symbol: "P",
        })

        // Mutation 2: create premise and add expression
        const { result: premise } = engine.createPremise()
        premise.appendExpression(null, {
            id: "expr-root",
            type: "variable",
            variableId: "v1",
            argumentId: arg.id,
            argumentVersion: arg.version,
            premiseId: premise.getId(),
        })

        // Should have been notified for each mutation
        expect(snapshots.length).toBeGreaterThanOrEqual(3)

        // Each snapshot should be a different reference
        for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]).not.toBe(snapshots[i - 1])
        }

        // Final snapshot should reflect current state
        const final = engine.getSnapshot()
        expect(final.variables["v1"]).toBeDefined()
        expect(Object.keys(final.premises).length).toBe(1)
        expect(
            final.premises[premise.getId()].expressions["expr-root"]
        ).toBeDefined()

        unsub()
    })
})
```

**Step 2: Run it**

Run: `pnpm vitest run test/core.test.ts -t "ArgumentEngine reactive store integration"`
Expected: PASS

**Step 3: Run the full test suite one final time**

Run: `pnpm vitest run`
Expected: all tests pass

**Step 4: Verify TypeScript compiles cleanly**

Run: `pnpm tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```
feat: add reactive store integration test
```

---

### Task 6 (optional): Verify `TReactiveSnapshot` is importable from the package barrel

**Step 1: Quick check**

In `test/core.test.ts`, add to the import from `../src/lib/index`:

```ts
import type { TReactiveSnapshot } from "../src/lib/index"
```

And use it in the integration test (e.g., type the `snapshots` array).

Run: `pnpm tsc --noEmit`
Expected: no errors

**Step 2: Commit if any changes**

```
chore: verify TReactiveSnapshot barrel export
```
