# Lookup API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add O(1) lookup methods for variables and expressions to ArgumentEngine, backed by maintained index maps.

**Architecture:** VariableManager gains a symbol→variableId reverse map. ArgumentEngine creates a shared expressionId→premiseId index Map and passes it to each PremiseEngine, which updates it in every mutation wrapper. New public methods on ArgumentEngine delegate to these indexes.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: VariableManager — symbol reverse lookup

**Files:**

- Modify: `src/lib/core/VariableManager.ts`
- Test: `test/ExpressionManager.test.ts` (new describe block at bottom)

**Step 1: Write the failing tests**

Add a new `describe("VariableManager — getVariableBySymbol")` block at the bottom of the test file:

```typescript
describe("VariableManager — getVariableBySymbol", () => {
    const makeVar = (id: string, symbol: string) => ({
        id,
        symbol,
        argumentId: "arg-1",
        argumentVersion: 0,
        checksum: "x",
    })

    it("returns undefined for unknown symbol", () => {
        const vm = new VariableManager()
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
    })

    it("returns the variable matching the symbol", () => {
        const vm = new VariableManager()
        const v = makeVar("v1", "P")
        vm.addVariable(v)
        expect(vm.getVariableBySymbol("P")).toEqual(v)
    })

    it("returns undefined after the variable is removed", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.removeVariable("v1")
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
    })

    it("tracks symbol changes after rename", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.renameVariable("v1", "Q")
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
        expect(vm.getVariableBySymbol("Q")?.id).toBe("v1")
    })

    it("tracks symbol changes after updateVariable", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.updateVariable("v1", { symbol: "R" })
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
        expect(vm.getVariableBySymbol("R")?.id).toBe("v1")
    })

    it("survives snapshot round-trip", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.addVariable(makeVar("v2", "Q"))
        const restored = VariableManager.fromSnapshot(vm.snapshot())
        expect(restored.getVariableBySymbol("P")?.id).toBe("v1")
        expect(restored.getVariableBySymbol("Q")?.id).toBe("v2")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "VariableManager — getVariableBySymbol"`
Expected: FAIL — `getVariableBySymbol` does not exist

**Step 3: Implement the changes in VariableManager**

In `src/lib/core/VariableManager.ts`:

1. Replace `private variableSymbols: Set<string>` (line 23) with:

    ```typescript
    private variablesBySymbol: Map<string, string>
    ```

2. In the constructor (line 27), replace `this.variableSymbols = new Set()` with:

    ```typescript
    this.variablesBySymbol = new Map()
    ```

3. In `addVariable` (line 45), replace `this.variableSymbols.has(variable.symbol)` with:

    ```typescript
    this.variablesBySymbol.has(variable.symbol)
    ```

    And replace `this.variableSymbols.add(variable.symbol)` with:

    ```typescript
    this.variablesBySymbol.set(variable.symbol, variable.id)
    ```

4. In `removeVariable` (line 63), replace `this.variableSymbols.delete(variable.symbol)` with:

    ```typescript
    this.variablesBySymbol.delete(variable.symbol)
    ```

5. In `renameVariable` (line 90), replace `this.variableSymbols.has(newSymbol)` with:

    ```typescript
    this.variablesBySymbol.has(newSymbol)
    ```

    Replace `this.variableSymbols.delete(variable.symbol)` with:

    ```typescript
    this.variablesBySymbol.delete(variable.symbol)
    ```

    Replace `this.variableSymbols.add(newSymbol)` with:

    ```typescript
    this.variablesBySymbol.set(newSymbol, variableId)
    ```

6. Add the new public method after `getVariable`:
    ```typescript
    /** Returns the variable with the given symbol, or `undefined` if not found. */
    public getVariableBySymbol(symbol: string): TVar | undefined {
        const id = this.variablesBySymbol.get(symbol)
        if (id === undefined) return undefined
        return this.variables.get(id)
    }
    ```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "VariableManager — getVariableBySymbol"`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `pnpm run test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/lib/core/VariableManager.ts test/ExpressionManager.test.ts
git commit -m "Add getVariableBySymbol to VariableManager with symbol→id reverse map"
```

---

### Task 2: Shared expression index — PremiseEngine plumbing

**Files:**

- Modify: `src/lib/core/PremiseEngine.ts`
- Test: `test/ExpressionManager.test.ts` (new describe block at bottom)

**Step 1: Write the failing tests**

Add a new `describe("PremiseEngine — shared expression index")` block:

```typescript
describe("PremiseEngine — shared expression index", () => {
    const arg = { id: "arg-1", version: 0 }
    const makeVariable = (id: string, symbol: string) => ({
        id,
        symbol,
        argumentId: "arg-1",
        argumentVersion: 0,
        checksum: "x",
    })
    const makeExpr = (
        id: string,
        parentId: string | null,
        premiseId: string,
        overrides: Record<string, unknown> = {}
    ) => ({
        id,
        type: "variable" as const,
        variableId: "v1",
        parentId,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId,
        ...overrides,
    })

    it("populates the shared index on addExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm, expressionIndex: index }
        )
        pe.addExpression(makeExpr("e1", null, "p1"))
        expect(index.get("e1")).toBe("p1")
    })

    it("removes entries from the shared index on removeExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm, expressionIndex: index }
        )
        pe.addExpression(makeExpr("e1", null, "p1"))
        pe.removeExpression("e1", true)
        expect(index.has("e1")).toBe(false)
    })

    it("removes subtree entries from the shared index", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm, expressionIndex: index }
        )
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionInput)
        pe.addExpression(makeExpr("e1", "op1", "p1", { position: 0 }))
        pe.addExpression(makeExpr("e2", "op1", "p1", { position: 1, id: "e2" }))
        pe.removeExpression("op1", true)
        expect(index.has("op1")).toBe(false)
        expect(index.has("e1")).toBe(false)
        expect(index.has("e2")).toBe(false)
    })

    it("populates the shared index on insertExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm, expressionIndex: index }
        )
        pe.addExpression(makeExpr("e1", null, "p1"))
        pe.insertExpression(
            {
                id: "op1",
                type: "operator",
                operator: "not",
                parentId: null,
                position: 0,
                argumentId: "arg-1",
                argumentVersion: 0,
                premiseId: "p1",
            } as TExpressionInput,
            "e1"
        )
        expect(index.get("op1")).toBe("p1")
        expect(index.get("e1")).toBe("p1")
    })

    it("works correctly when no shared index is provided", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm }
        )
        // Should not throw when no index is provided
        pe.addExpression(makeExpr("e1", null, "p1"))
        pe.removeExpression("e1", true)
    })

    it("populates the shared index on appendExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm, expressionIndex: index }
        )
        pe.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as any)
        expect(index.get("e1")).toBe("p1")
    })

    it("removes entries on deleteExpressionsUsingVariable", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        vm.addVariable(makeVariable("v2", "Q"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 0 },
            { argument: arg, variables: vm, expressionIndex: index }
        )
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionInput)
        pe.addExpression(makeExpr("e1", "op1", "p1", { position: 0 }))
        pe.addExpression(
            makeExpr("e2", "op1", "p1", {
                position: 1,
                id: "e2",
                variableId: "v2",
            })
        )
        pe.deleteExpressionsUsingVariable("v1")
        expect(index.has("e1")).toBe(false)
        // e2 and possibly op1 may or may not survive depending on collapse
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "PremiseEngine — shared expression index"`
Expected: FAIL — PremiseEngine constructor does not accept `expressionIndex`

**Step 3: Implement the shared index in PremiseEngine**

In `src/lib/core/PremiseEngine.ts`:

1. Add `expressionIndex` to the private fields (after line 63):

    ```typescript
    private expressionIndex?: Map<string, string>
    ```

2. Update the `deps` parameter type in the constructor (line 71-74):

    ```typescript
    deps: {
        argument: TOptionalChecksum<TArg>
        variables: VariableManager<TVar>
        expressionIndex?: Map<string, string>
    },
    ```

3. Store it in the constructor body (after line 83):

    ```typescript
    this.expressionIndex = deps.expressionIndex
    ```

4. Add a private helper method to sync the expression index from a changeset:

    ```typescript
    private syncExpressionIndex(changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>): void {
        if (!this.expressionIndex || !changes.expressions) return
        for (const expr of changes.expressions.added) {
            this.expressionIndex.set(expr.id, this.premise.id)
        }
        for (const expr of changes.expressions.removed) {
            this.expressionIndex.delete(expr.id)
        }
    }
    ```

    Import `TCoreChangeset` from `../types/mutation.js` (add to existing import).

5. Call `this.syncExpressionIndex(changeset)` before each `return` in these methods, where `changeset` is the result of `collector.toChangeset()`:
    - `addExpression` (around line 188): add `this.syncExpressionIndex(changes)` before return, using the changeset from `collector.toChangeset()`. Restructure the return to capture the changeset first:
        ```typescript
        const changes = collector.toChangeset()
        this.syncExpressionIndex(changes)
        return { result: ..., changes }
        ```
    - `appendExpression` (same pattern)
    - `addExpressionRelative` (same pattern)
    - `updateExpression` (same pattern — note: updateExpression has no added/removed, only modified, so no index change needed, but call for consistency)
    - `removeExpression` (same pattern)
    - `insertExpression` (same pattern)
    - `deleteExpressionsUsingVariable` (same pattern)

6. Update `fromSnapshot` (line 1173) to accept and pass the expression index:
    ```typescript
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    >(
        snapshot: TPremiseEngineSnapshot<TPremise, TExpr>,
        argument: TOptionalChecksum<TArg>,
        variables: VariableManager<TVar>,
        expressionIndex?: Map<string, string>
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> {
        const pe = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
            snapshot.premise,
            { argument, variables, expressionIndex },
            snapshot.config
        )
        pe.expressions = ExpressionManager.fromSnapshot<TExpr>(
            snapshot.expressions
        )
        pe.rootExpressionId = (snapshot.premise as Record<string, unknown>)
            .rootExpressionId as string | undefined
        pe.rebuildVariableIndex()
        // Populate expression index from restored expressions
        if (expressionIndex) {
            for (const expr of pe.expressions.toArray()) {
                expressionIndex.set(expr.id, pe.getId())
            }
        }
        return pe
    }
    ```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "PremiseEngine — shared expression index"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass (existing tests don't pass expressionIndex, so the optional parameter is backward-compatible)

**Step 6: Commit**

```bash
git add src/lib/core/PremiseEngine.ts test/ExpressionManager.test.ts
git commit -m "Add shared expression index plumbing to PremiseEngine"
```

---

### Task 3: ArgumentEngine — wire up expression index and add variable lookups

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`
- Test: `test/ExpressionManager.test.ts` (new describe block at bottom)

**Step 1: Write the failing tests**

Add a new `describe("ArgumentEngine — lookup methods")` block:

```typescript
describe("ArgumentEngine — lookup methods", () => {
    function setupEngine() {
        const arg = { id: "arg-1", version: 0 }
        const engine = new ArgumentEngine(arg)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 0,
        })
        engine.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 0,
        })
        const { result: p1 } = engine.createPremiseWithId("p1")
        const { result: p2 } = engine.createPremiseWithId("p2")

        p1.addExpression({
            id: "e1",
            type: "variable" as const,
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        })

        p2.addExpression({
            id: "op1",
            type: "operator" as const,
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        } as TExpressionInput)
        p2.addExpression({
            id: "e2",
            type: "variable" as const,
            variableId: "v1",
            parentId: "op1",
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        })
        p2.addExpression({
            id: "e3",
            type: "variable" as const,
            variableId: "v2",
            parentId: "op1",
            position: 1,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        })

        return { engine, p1, p2 }
    }

    describe("getVariable", () => {
        it("returns the variable by ID", () => {
            const { engine } = setupEngine()
            expect(engine.getVariable("v1")?.symbol).toBe("P")
        })

        it("returns undefined for unknown ID", () => {
            const { engine } = setupEngine()
            expect(engine.getVariable("unknown")).toBeUndefined()
        })
    })

    describe("hasVariable", () => {
        it("returns true for existing variable", () => {
            const { engine } = setupEngine()
            expect(engine.hasVariable("v1")).toBe(true)
        })

        it("returns false for unknown variable", () => {
            const { engine } = setupEngine()
            expect(engine.hasVariable("unknown")).toBe(false)
        })
    })

    describe("getVariableBySymbol", () => {
        it("returns the variable by symbol", () => {
            const { engine } = setupEngine()
            expect(engine.getVariableBySymbol("P")?.id).toBe("v1")
        })

        it("returns undefined for unknown symbol", () => {
            const { engine } = setupEngine()
            expect(engine.getVariableBySymbol("Z")).toBeUndefined()
        })

        it("reflects updates after updateVariable", () => {
            const { engine } = setupEngine()
            engine.updateVariable("v1", { symbol: "R" })
            expect(engine.getVariableBySymbol("P")).toBeUndefined()
            expect(engine.getVariableBySymbol("R")?.id).toBe("v1")
        })
    })

    describe("buildVariableIndex", () => {
        it("builds a custom-keyed map from variables", () => {
            const { engine } = setupEngine()
            const bySymbol = engine.buildVariableIndex((v) => v.symbol)
            expect(bySymbol.get("P")?.id).toBe("v1")
            expect(bySymbol.get("Q")?.id).toBe("v2")
            expect(bySymbol.size).toBe(2)
        })
    })

    describe("getExpression", () => {
        it("returns an expression from any premise by ID", () => {
            const { engine } = setupEngine()
            const e1 = engine.getExpression("e1")
            expect(e1?.id).toBe("e1")
            const e3 = engine.getExpression("e3")
            expect(e3?.id).toBe("e3")
        })

        it("returns undefined for unknown ID", () => {
            const { engine } = setupEngine()
            expect(engine.getExpression("unknown")).toBeUndefined()
        })
    })

    describe("hasExpression", () => {
        it("returns true for existing expression", () => {
            const { engine } = setupEngine()
            expect(engine.hasExpression("e1")).toBe(true)
        })

        it("returns false for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.hasExpression("unknown")).toBe(false)
        })
    })

    describe("getExpressionPremiseId", () => {
        it("returns the premiseId for an expression", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionPremiseId("e1")).toBe("p1")
            expect(engine.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("returns undefined for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionPremiseId("unknown")).toBeUndefined()
        })
    })

    describe("findPremiseByExpressionId", () => {
        it("returns the PremiseEngine containing the expression", () => {
            const { engine } = setupEngine()
            const pe = engine.findPremiseByExpressionId("e3")
            expect(pe?.getId()).toBe("p2")
        })

        it("returns undefined for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.findPremiseByExpressionId("unknown")).toBeUndefined()
        })
    })

    describe("getAllExpressions", () => {
        it("returns all expressions across all premises", () => {
            const { engine } = setupEngine()
            const all = engine.getAllExpressions()
            const ids = all.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "e2", "e3", "op1"])
        })
    })

    describe("getExpressionsByVariableId", () => {
        it("returns expressions referencing the variable across premises", () => {
            const { engine } = setupEngine()
            const exprs = engine.getExpressionsByVariableId("v1")
            const ids = exprs.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "e2"])
        })

        it("returns empty array for unreferenced variable", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionsByVariableId("unknown")).toEqual([])
        })
    })

    describe("listRootExpressions", () => {
        it("returns root expressions from all premises", () => {
            const { engine } = setupEngine()
            const roots = engine.listRootExpressions()
            const ids = roots.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "op1"])
        })
    })

    describe("expression index stays in sync after mutations", () => {
        it("tracks expression removal", () => {
            const { engine, p2 } = setupEngine()
            p2.removeExpression("e2", true)
            expect(engine.hasExpression("e2")).toBe(false)
            expect(engine.hasExpression("e3")).toBe(true)
        })

        it("tracks premise removal", () => {
            const { engine } = setupEngine()
            engine.removePremise("p1")
            expect(engine.hasExpression("e1")).toBe(false)
        })

        it("tracks cascade variable removal", () => {
            const { engine } = setupEngine()
            engine.removeVariable("v1")
            expect(engine.hasExpression("e1")).toBe(false)
            expect(engine.hasExpression("e2")).toBe(false)
        })

        it("survives snapshot round-trip", () => {
            const { engine } = setupEngine()
            const snap = engine.snapshot()
            const restored = ArgumentEngine.fromSnapshot(snap)
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives fromData round-trip", () => {
            const { engine } = setupEngine()
            const vars = engine.getVariables()
            const premises = engine
                .listPremises()
                .map((pe) => pe.toPremiseData())
            const expressions = engine.getAllExpressions()
            const roles = engine.getRoleState()
            const restored = ArgumentEngine.fromData(
                engine.getArgument(),
                vars,
                premises,
                expressions,
                roles
            )
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives rollback", () => {
            const { engine, p1 } = setupEngine()
            const snap = engine.snapshot()
            p1.addExpression({
                id: "e99",
                type: "variable" as const,
                variableId: "v2",
                parentId: "e1",
                position: 0,
                argumentId: "arg-1",
                argumentVersion: 0,
                premiseId: "p1",
            })
            expect(engine.hasExpression("e99")).toBe(true)
            engine.rollback(snap)
            expect(engine.hasExpression("e99")).toBe(false)
            expect(engine.hasExpression("e1")).toBe(true)
        })
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ArgumentEngine — lookup methods"`
Expected: FAIL — methods do not exist

**Step 3: Implement all methods in ArgumentEngine**

In `src/lib/core/ArgumentEngine.ts`:

1. Add the shared expression index field (after line 75):

    ```typescript
    private expressionIndex: Map<string, string>
    ```

2. Initialize it in the constructor (after line 86):

    ```typescript
    this.expressionIndex = new Map()
    ```

3. Pass the index when creating PremiseEngines — update `createPremiseWithId` (line 169):

    ```typescript
    const pm = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
        premiseData,
        {
            argument: this.argument,
            variables: this.variables,
            expressionIndex: this.expressionIndex,
        },
        {
            checksumConfig: this.checksumConfig,
            positionConfig: this.positionConfig,
        }
    )
    ```

4. In `removePremise` (around line 200), after `this.premises.delete(premiseId)`, clear the expression index entries for the removed premise:

    ```typescript
    // Clean up expression index for all expressions in the removed premise
    for (const expr of pm.getExpressions()) {
        this.expressionIndex.delete(expr.id)
    }
    ```

5. In `fromSnapshot` (line 448), create and pass the expression index:

    ```typescript
    // After creating the engine (line 457):
    // The expressionIndex is already initialized in the constructor.
    // Pass it when restoring premises:
    for (const premiseSnap of snapshot.premises) {
        const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
            premiseSnap,
            snapshot.argument,
            engine.variables,
            engine.expressionIndex
        )
        engine.premises.set(pe.getId(), pe)
    }
    ```

6. In `fromData` (line 498), the expression index is already initialized in the constructor. Pass it when creating premises. Update the `createPremiseWithId` call — since it already uses `engine.createPremiseWithId`, and that method now passes the index, this should work automatically. But verify that expressions added via `pe.addExpression` go through the PremiseEngine that has the index.

7. In `rollback` (line 578), rebuild the expression index:

    ```typescript
    this.expressionIndex = new Map()
    // Then in the loop where PremiseEngine.fromSnapshot is called, pass this.expressionIndex:
    for (const premiseSnap of snapshot.premises) {
        const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
            premiseSnap,
            this.argument,
            this.variables,
            this.expressionIndex
        )
        this.premises.set(pe.getId(), pe)
    }
    ```

8. Add the new public methods (after `getVariables`, around line 347):

    ```typescript
    /** Returns the variable with the given ID, or `undefined` if not found. */
    public getVariable(variableId: string): TVar | undefined {
        return this.variables.getVariable(variableId)
    }

    /** Returns `true` if a variable with the given ID exists. */
    public hasVariable(variableId: string): boolean {
        return this.variables.hasVariable(variableId)
    }

    /** Returns the variable with the given symbol, or `undefined` if not found. */
    public getVariableBySymbol(symbol: string): TVar | undefined {
        return this.variables.getVariableBySymbol(symbol)
    }

    /**
     * Builds a Map keyed by a caller-supplied function over all variables.
     * Useful for indexing by extension fields (e.g. statementId).
     * The caller should cache the result — this is O(n) per call.
     */
    public buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar> {
        const map = new Map<K, TVar>()
        for (const v of this.variables.toArray()) {
            map.set(keyFn(v), v)
        }
        return map
    }

    /** Returns an expression by ID from any premise, or `undefined` if not found. */
    public getExpression(expressionId: string): TExpr | undefined {
        const premiseId = this.expressionIndex.get(expressionId)
        if (premiseId === undefined) return undefined
        return this.premises.get(premiseId)?.getExpression(expressionId)
    }

    /** Returns `true` if an expression with the given ID exists in any premise. */
    public hasExpression(expressionId: string): boolean {
        return this.expressionIndex.has(expressionId)
    }

    /** Returns the premise ID that contains the given expression, or `undefined`. */
    public getExpressionPremiseId(expressionId: string): string | undefined {
        return this.expressionIndex.get(expressionId)
    }

    /** Returns the PremiseEngine containing the given expression, or `undefined`. */
    public findPremiseByExpressionId(
        expressionId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined {
        const premiseId = this.expressionIndex.get(expressionId)
        if (premiseId === undefined) return undefined
        return this.premises.get(premiseId)
    }

    /** Returns all expressions across all premises, sorted by ID. */
    public getAllExpressions(): TExpr[] {
        const all: TExpr[] = []
        for (const pe of this.listPremises()) {
            all.push(...pe.getExpressions())
        }
        return all.sort((a, b) => a.id.localeCompare(b.id))
    }

    /**
     * Returns all expressions that reference the given variable ID,
     * across all premises.
     */
    public getExpressionsByVariableId(variableId: string): TExpr[] {
        const result: TExpr[] = []
        for (const pe of this.listPremises()) {
            const refIds = pe.getReferencedVariableIds()
            if (!refIds.has(variableId)) continue
            for (const expr of pe.getExpressions()) {
                if (expr.type === "variable" && expr.variableId === variableId) {
                    result.push(expr)
                }
            }
        }
        return result
    }

    /** Returns the root expression from each premise that has one. */
    public listRootExpressions(): TExpr[] {
        const roots: TExpr[] = []
        for (const pe of this.listPremises()) {
            const root = pe.getRootExpression()
            if (root) roots.push(root)
        }
        return roots
    }
    ```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ArgumentEngine — lookup methods"`
Expected: PASS

**Step 5: Run full test suite and typecheck**

Run: `pnpm run check`
Expected: All pass

**Step 6: Commit**

```bash
git add src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Add lookup methods to ArgumentEngine with shared expression index"
```

---

### Task 4: Documentation sync

**Files:**

- Modify: `CLAUDE.md` — add new methods to the Architecture and Types sections
- Modify: `README.md` — add lookup methods to the API reference
- Delete: `docs/proposit-core-gaps.md`

**Step 1: Update CLAUDE.md**

Add the new public methods to the `ArgumentEngine` description in the Architecture section. Update the `VariableManager` description to mention `getVariableBySymbol`. Add `PremiseEngine` deps update mentioning `expressionIndex`.

**Step 2: Update README.md**

Add a "Lookup Methods" subsection to the API reference covering all new methods.

**Step 3: Delete the gaps file**

```bash
rm docs/proposit-core-gaps.md
```

**Step 4: Commit**

```bash
git add CLAUDE.md README.md
git rm docs/proposit-core-gaps.md
git commit -m "Update docs for lookup API; remove gaps analysis"
```
