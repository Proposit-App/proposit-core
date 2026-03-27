# Cross-Argument Variable Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-argument variable binding, automatic premise-variable creation, and evaluator-assigned semantics for external bindings.

**Architecture:** Lift the same-argument constraint on premise-bound variables by adding a separate `bindVariableToExternalPremise` method. Auto-create a premise-bound variable in `createPremise`/`createPremiseWithId`. Update evaluation to treat external bindings as evaluator-assigned (like claims) while preserving lazy resolution for internal bindings.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

---

### Task 1: Add `isExternallyBound` Utility Function

**Files:**

- Modify: `src/lib/schemata/propositional.ts`
- Modify: `src/lib/index.ts` (if needed — check if schemata barrel re-exports)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe("cross-argument variable binding", ...)` block at the bottom of `test/core.test.ts`:

```typescript
describe("cross-argument variable binding", () => {
    it("isExternallyBound returns true when boundArgumentId differs", () => {
        const variable: TPremiseBoundVariable = {
            id: "v-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "",
            boundPremiseId: "p-1",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 1,
        }
        expect(isExternallyBound(variable, "arg-1")).toBe(true)
    })

    it("isExternallyBound returns false when boundArgumentId matches", () => {
        const variable: TPremiseBoundVariable = {
            id: "v-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "",
            boundPremiseId: "p-1",
            boundArgumentId: "arg-1",
            boundArgumentVersion: 0,
        }
        expect(isExternallyBound(variable, "arg-1")).toBe(false)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `isExternallyBound` is not defined

- [ ] **Step 3: Implement `isExternallyBound`**

Add to `src/lib/schemata/propositional.ts` after the existing `isPremiseBound` function:

```typescript
/** Returns `true` if the premise-bound variable references a premise in a different argument. */
export function isExternallyBound(
    v: TPremiseBoundVariable,
    argumentId: string
): boolean {
    return v.boundArgumentId !== argumentId
}
```

Add `isExternallyBound` to the import in the test file (it should already be re-exported via the schemata barrel).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemata/propositional.ts test/core.test.ts
git commit -m "feat(variables): add isExternallyBound utility function"
```

---

### Task 2: Auto-Variable Creation in `createPremiseWithId`

**Files:**

- Modify: `src/lib/core/argument-engine.ts:452-520`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `cross-argument variable binding` describe block:

```typescript
it("createPremise auto-creates a premise-bound variable", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    const { result: pm, changes } = eng.createPremise()

    // Changeset includes a variable addition
    expect(changes.variables?.added).toHaveLength(1)
    const autoVar = changes.variables!.added[0]!
    expect(isPremiseBound(autoVar)).toBe(true)

    // Variable is bound to the new premise
    const pmVar = autoVar as TPremiseBoundVariable
    expect(pmVar.boundPremiseId).toBe(pm.getId())
    expect(pmVar.boundArgumentId).toBe(ARG.id)
    expect(pmVar.boundArgumentVersion).toBe(ARG.version)

    // Auto-generated symbol
    expect(pmVar.symbol).toBe("P0")
})

it("createPremise accepts a custom symbol for the auto-variable", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    const { changes } = eng.createPremise(undefined, "MyPremise")
    const autoVar = changes.variables!.added[0]!
    expect(autoVar.symbol).toBe("MyPremise")
})

it("createPremise auto-generates unique symbols on collision", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    const { changes: c1 } = eng.createPremise()
    const { changes: c2 } = eng.createPremise()
    const sym1 = c1.variables!.added[0]!.symbol
    const sym2 = c2.variables!.added[0]!.symbol
    expect(sym1).not.toBe(sym2)
    expect(sym1).toBe("P0")
    expect(sym2).toBe("P1")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "auto-creates|custom symbol|unique symbols" 2>&1 | tail -20`
Expected: FAIL — changeset has no `variables` entry

- [ ] **Step 3: Implement auto-variable creation**

In `src/lib/core/argument-engine.ts`, modify `createPremise` and `createPremiseWithId`:

Update `createPremise` signature (around line 452):

```typescript
public createPremise(
    extras?: Record<string, unknown>,
    symbol?: string
): TCoreMutationResult<
    PremiseEngine<TArg, TPremise, TExpr, TVar>,
    TExpr,
    TVar,
    TPremise,
    TArg
> {
    return this.createPremiseWithId(randomUUID(), extras, symbol)
}
```

Update `createPremiseWithId` signature (around line 464):

```typescript
public createPremiseWithId(
    id: string,
    extras?: Record<string, unknown>,
    symbol?: string
): TCoreMutationResult<
    PremiseEngine<TArg, TPremise, TExpr, TVar>,
    TExpr,
    TVar,
    TPremise,
    TArg
> {
```

After the existing premise creation logic and before `return` (after the conclusion auto-assign block, around line 511), add auto-variable creation:

```typescript
// Auto-create a premise-bound variable for this premise
if (!this.restoringFromSnapshot) {
    const autoSymbol = symbol ?? this.generateUniqueSymbol()
    const autoVariable = {
        id: randomUUID(),
        argumentId: this.argument.id,
        argumentVersion: this.argument.version as number,
        symbol: autoSymbol,
        boundPremiseId: id,
        boundArgumentId: this.argument.id,
        boundArgumentVersion: this.argument.version as number,
    } as TOptionalChecksum<TPremiseBoundVariable>
    const withChecksum = this.attachVariableChecksum({
        ...autoVariable,
    } as unknown as TOptionalChecksum<TVar>)
    this.variables.addVariable(withChecksum)
    collector.addedVariable(withChecksum)
    this.markAllPremisesDirty()
}
```

Add a private helper for symbol generation:

```typescript
private generateUniqueSymbol(): string {
    let n = this.premises.size - 1 // -1 because the premise was just added
    let candidate = `P${n}`
    while (this.variables.getVariableBySymbol(candidate) !== undefined) {
        n++
        candidate = `P${n}`
    }
    return candidate
}
```

Add a private flag for restoration:

```typescript
private restoringFromSnapshot = false
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "auto-creates|custom symbol|unique symbols" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test 2>&1 | tail -20`
Expected: Some existing tests may fail due to unexpected variables in changesets. Note which tests fail — they will need updating in the next step.

- [ ] **Step 6: Fix broken existing tests**

Existing tests that call `createPremise` and assert exact changeset contents will now see an extra `variables.added` entry. Update these tests to account for the auto-created variable. Tests that don't inspect changesets should be unaffected.

Also, tests using `fromSnapshot` and `fromData` may create duplicates if auto-creation fires during restoration. Set `this.restoringFromSnapshot = true` at the start of `fromSnapshot` and `fromData`, and `false` at the end (before checksum verification). In `fromSnapshot`, set it on the engine instance after construction (around line 1001):

```typescript
engine.restoringFromSnapshot = true
```

And reset before return (around line 1065):

```typescript
engine.restoringFromSnapshot = false
```

Similarly in `fromData`, set the flag after engine construction and reset before returning.

- [ ] **Step 7: Run full test suite again**

Run: `pnpm run test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(variables): auto-create premise-bound variable on createPremise"
```

---

### Task 3: Add `canBind` Protected Method

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `cross-argument variable binding` describe block:

```typescript
it("canBind rejects when overridden to return false", () => {
    class RestrictedEngine extends ArgumentEngine {
        protected override canBind(
            _boundArgumentId: string,
            _boundArgumentVersion: number
        ): boolean {
            return false
        }
    }
    const eng = new RestrictedEngine(ARG, aLib(), sLib(), csLib())
    expect(() =>
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Ext",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })
    ).toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "canBind rejects" 2>&1 | tail -20`
Expected: FAIL — `bindVariableToExternalPremise` is not a function

- [ ] **Step 3: Implement `canBind` and `bindVariableToExternalPremise` stub**

In `src/lib/core/argument-engine.ts`, add after `canFork` method:

```typescript
/**
 * Override in subclasses to restrict which external arguments can be
 * bound to. Called by `bindVariableToExternalPremise` before registration.
 * Return `false` to reject.
 */
protected canBind(
    _boundArgumentId: string,
    _boundArgumentVersion: number
): boolean {
    return true
}

/**
 * Creates a variable bound to a premise in another argument.
 * The binding is navigational — the variable is evaluator-assigned
 * during evaluation (not lazily resolved like internal bindings).
 */
public bindVariableToExternalPremise(
    variable: TOptionalChecksum<TPremiseBoundVariable> &
        Record<string, unknown>
): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
    if (!this.canBind(variable.boundArgumentId, variable.boundArgumentVersion)) {
        throw new Error(
            `Binding to argument "${variable.boundArgumentId}" version ${variable.boundArgumentVersion} is not allowed.`
        )
    }
    throw new Error("Not yet implemented")
}
```

- [ ] **Step 4: Run test to verify canBind rejection passes**

Run: `pnpm run test -- --reporter=verbose -t "canBind rejects" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(engine): add canBind protected method and bindVariableToExternalPremise stub"
```

---

### Task 4: Implement `bindVariableToExternalPremise`

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `cross-argument variable binding` describe block:

```typescript
it("bindVariableToExternalPremise registers an externally bound variable", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    const { result: varResult } = eng.bindVariableToExternalPremise({
        id: "v-ext",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "ExtVar",
        boundPremiseId: "p-in-other-arg",
        boundArgumentId: "arg-other",
        boundArgumentVersion: 2,
    })

    expect(varResult.id).toBe("v-ext")
    expect(varResult.symbol).toBe("ExtVar")

    // Variable is retrievable
    const retrieved = eng.getVariable("v-ext")
    expect(retrieved).toBeDefined()
    expect(isPremiseBound(retrieved!)).toBe(true)
    const pv = retrieved! as TPremiseBoundVariable
    expect(pv.boundArgumentId).toBe("arg-other")
    expect(pv.boundArgumentVersion).toBe(2)
    expect(pv.boundPremiseId).toBe("p-in-other-arg")
})

it("bindVariableToExternalPremise rejects internal binding", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    eng.createPremiseWithId("p1")
    expect(() =>
        eng.bindVariableToExternalPremise({
            id: "v-int",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "IntVar",
            boundPremiseId: "p1",
            boundArgumentId: ARG.id,
            boundArgumentVersion: ARG.version,
        })
    ).toThrow(/internal/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "registers an externally|rejects internal" 2>&1 | tail -20`
Expected: FAIL — "Not yet implemented"

- [ ] **Step 3: Implement `bindVariableToExternalPremise`**

Replace the stub with the full implementation:

```typescript
public bindVariableToExternalPremise(
    variable: TOptionalChecksum<TPremiseBoundVariable> &
        Record<string, unknown>
): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
    if (variable.argumentId !== this.argument.id) {
        throw new Error(
            `Variable argumentId "${variable.argumentId}" does not match engine argument ID "${this.argument.id}".`
        )
    }
    if (variable.argumentVersion !== this.argument.version) {
        throw new Error(
            `Variable argumentVersion "${variable.argumentVersion}" does not match engine argument version "${this.argument.version}".`
        )
    }
    if (variable.boundArgumentId === this.argument.id) {
        throw new Error(
            `boundArgumentId matches this engine's argument — use bindVariableToPremise for internal bindings.`
        )
    }
    if (
        !this.canBind(
            variable.boundArgumentId,
            variable.boundArgumentVersion
        )
    ) {
        throw new Error(
            `Binding to argument "${variable.boundArgumentId}" version ${variable.boundArgumentVersion} is not allowed.`
        )
    }
    const withChecksum = this.attachVariableChecksum({
        ...variable,
    } as unknown as TOptionalChecksum<TVar>)
    this.variables.addVariable(withChecksum)
    const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
    collector.addedVariable(withChecksum)
    this.markDirty()
    this.markAllPremisesDirty()
    const changes = collector.toChangeset()
    this.markReactiveDirty(changes)
    this.notifySubscribers()
    return {
        result: withChecksum,
        changes,
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "registers an externally|rejects internal" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(engine): implement bindVariableToExternalPremise"
```

---

### Task 5: Implement `bindVariableToArgument`

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `cross-argument variable binding` describe block:

```typescript
it("bindVariableToArgument sets boundPremiseId to conclusionPremiseId", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    const { result: varResult } = eng.bindVariableToArgument(
        {
            id: "v-arg",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ArgRef",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 3,
        },
        "conclusion-premise-in-other-arg"
    )

    const retrieved = eng.getVariable("v-arg")!
    const pv = retrieved as TPremiseBoundVariable
    expect(pv.boundPremiseId).toBe("conclusion-premise-in-other-arg")
    expect(pv.boundArgumentId).toBe("arg-other")
    expect(pv.boundArgumentVersion).toBe(3)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "bindVariableToArgument sets" 2>&1 | tail -20`
Expected: FAIL — `bindVariableToArgument` is not a function

- [ ] **Step 3: Implement `bindVariableToArgument`**

Add to `ArgumentEngine` after `bindVariableToExternalPremise`:

```typescript
/**
 * Convenience method for binding a variable to another argument's conclusion.
 * The caller provides the conclusion premise ID; the method delegates to
 * `bindVariableToExternalPremise` with `boundPremiseId` set.
 */
public bindVariableToArgument(
    variable: Omit<
        TOptionalChecksum<TPremiseBoundVariable>,
        "boundPremiseId"
    > &
        Record<string, unknown>,
    conclusionPremiseId: string
): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
    return this.bindVariableToExternalPremise({
        ...variable,
        boundPremiseId: conclusionPremiseId,
    } as TOptionalChecksum<TPremiseBoundVariable> & Record<string, unknown>)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "bindVariableToArgument sets" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(engine): add bindVariableToArgument convenience method"
```

---

### Task 6: Evaluation Changes — External Bindings as Evaluator-Assigned

**Files:**

- Modify: `src/lib/core/argument-engine.ts:1773-1805`
- Modify: `src/lib/core/premise-engine.ts:1318-1335`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `cross-argument variable binding` describe block:

```typescript
it("evaluation: internal binding is still lazily resolved", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    eng.addVariable(makeVar("v-p", "P"))
    const { result: pm1 } = eng.createPremiseWithId("p1")
    pm1.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v-p",
        parentId: null,
        position: 0,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "p1",
    })

    // pm1's auto-variable is bound to pm1 (internal)
    // Create pm2 that uses pm1's auto-variable
    const autoVarId = eng
        .getVariables()
        .find(
            (v) =>
                isPremiseBound(v) &&
                (v as TPremiseBoundVariable).boundPremiseId === "p1"
        )!.id

    const { result: pm2 } = eng.createPremiseWithId("p2")
    pm2.addExpression({
        id: "e2",
        type: "variable",
        variableId: autoVarId,
        parentId: null,
        position: 0,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "p2",
    })

    // Evaluate: P = true → pm1 evaluates to true → pm1's auto-variable resolves to true → pm2 = true
    const result = eng.evaluate({ variables: { "v-p": true } })
    expect(result).toBeDefined()
})

it("evaluation: external binding is evaluator-assigned", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    eng.bindVariableToExternalPremise({
        id: "v-ext",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "ExtVar",
        boundPremiseId: "p-other",
        boundArgumentId: "arg-other",
        boundArgumentVersion: 0,
    })

    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v-ext",
        parentId: null,
        position: 0,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "p1",
    })

    // External variable is evaluator-assigned — provide its value in the assignment
    const result = eng.evaluate({ variables: { "v-ext": true } })
    expect(result).toBeDefined()
    // The premise should evaluate to true (single variable expression = true)
    const premiseResult = result!.premises.find((p) => p.premiseId === "p1")
    expect(premiseResult?.rootValue).toBe(true)
})

it("truth table: external binding included in columns", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    eng.bindVariableToExternalPremise({
        id: "v-ext",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "ExtVar",
        boundPremiseId: "p-other",
        boundArgumentId: "arg-other",
        boundArgumentVersion: 0,
    })

    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v-ext",
        parentId: null,
        position: 0,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "p1",
    })
    eng.setConclusionPremise("p1")

    // checkValidity should generate assignments for the external variable
    const validity = eng.checkValidity()
    expect(validity.assignments.length).toBeGreaterThan(0)
    // Each assignment should include v-ext
    for (const a of validity.assignments) {
        expect("v-ext" in a.assignment.variables).toBe(true)
    }
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm run test -- --reporter=verbose -t "internal binding is still|external binding is evaluator|external binding included" 2>&1 | tail -30`
Expected: The external binding tests may fail because the evaluation code currently does not include external variables in truth-table columns and the resolver still tries to lazily resolve them.

- [ ] **Step 3: Update truth-table column filtering in ArgumentEngine.evaluate**

In `src/lib/core/argument-engine.ts`, update the variable filtering (around line 1773-1778):

```typescript
// Claim-bound and externally-bound premise variables get truth-table columns;
// internally-bound premise variables are resolved lazily.
const referencedVariableIds = allVariableIds.filter((vid) => {
    const v = this.variables.getVariable(vid)
    if (v == null) return false
    if (isClaimBound(v)) return true
    if (isPremiseBound(v) && v.boundArgumentId !== this.argument.id) return true
    return false
})
```

- [ ] **Step 4: Update resolver in ArgumentEngine.evaluate**

In `src/lib/core/argument-engine.ts`, update the resolver function (around line 1785-1805). The resolver should only lazily resolve INTERNAL premise-bound variables:

```typescript
const resolver = (variableId: string): boolean | null => {
    if (resolverCache.has(variableId)) {
        return resolverCache.get(variableId)!
    }
    const variable = this.variables.getVariable(variableId)
    if (
        !variable ||
        !isPremiseBound(variable) ||
        variable.boundArgumentId !== this.argument.id
    ) {
        // Claim-bound or externally-bound: read from assignment
        return assignment.variables[variableId] ?? null
    }
    // Internal premise-bound: lazy resolution
    const boundPremiseId = variable.boundPremiseId
    const boundPremise = this.premises.get(boundPremiseId)
    if (!boundPremise) {
        resolverCache.set(variableId, null)
        return null
    }
    const premiseResult = boundPremise.evaluate(assignment, {
        resolver,
    })
    const value = premiseResult?.rootValue ?? null
    resolverCache.set(variableId, value)
    return value
}
```

- [ ] **Step 5: Update PremiseEngine evaluation resolver decision**

In `src/lib/core/premise-engine.ts`, update the variable evaluation block (around line 1318-1335). The resolver should only be used for INTERNAL premise-bound variables:

```typescript
if (expression.type === "variable") {
    let value: TCoreTrivalentValue
    if (options?.resolver) {
        const variable = this.variables.getVariable(expression.variableId)
        if (
            variable &&
            isPremiseBound(variable) &&
            !isExternallyBound(variable, this.argument.id as string)
        ) {
            value = options.resolver(expression.variableId)
        } else {
            value = assignment.variables[expression.variableId] ?? null
        }
    } else {
        value = assignment.variables[expression.variableId] ?? null
    }
    expressionValues[expression.id] = value
    return value
}
```

This requires importing `isExternallyBound` in `premise-engine.ts`. The `this.argument` field on PremiseEngine stores the parent argument reference — verify this field exists and has an `id` property. (PremiseEngine receives it via constructor as part of its context.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "internal binding is still|external binding is evaluator|external binding included" 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `pnpm run test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/premise-engine.ts test/core.test.ts
git commit -m "feat(evaluation): external bindings are evaluator-assigned, included in truth-table columns"
```

---

### Task 7: Snapshot Restoration for External Bindings

**Files:**

- Modify: `src/lib/core/argument-engine.ts:1047-1061` and `1131-1167`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `cross-argument variable binding` describe block:

```typescript
it("fromSnapshot restores both internal and external bound variables", () => {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
    eng.addVariable(makeVar("v-claim", "Claim"))
    eng.bindVariableToExternalPremise({
        id: "v-ext",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "ExtVar",
        boundPremiseId: "p-other",
        boundArgumentId: "arg-other",
        boundArgumentVersion: 2,
    })

    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v-ext",
        parentId: null,
        position: 0,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "p1",
    })

    const snap = eng.snapshot()
    const restored = ArgumentEngine.fromSnapshot(snap, aLib(), sLib(), csLib())

    // All variables restored
    const vars = restored.getVariables()
    const claimVars = vars.filter((v) => isClaimBound(v))
    const premiseVars = vars.filter((v) => isPremiseBound(v))

    expect(claimVars).toHaveLength(1)
    // Internal auto-variable + external variable
    expect(premiseVars.length).toBeGreaterThanOrEqual(2)

    // External variable is present
    const extVar = vars.find((v) => v.id === "v-ext")
    expect(extVar).toBeDefined()
    expect(isPremiseBound(extVar!)).toBe(true)
    const pv = extVar! as TPremiseBoundVariable
    expect(pv.boundArgumentId).toBe("arg-other")

    // Evaluation still works: external var is evaluator-assigned
    const result = restored.evaluate({
        variables: { "v-ext": true, "v-claim": false },
    })
    expect(result).toBeDefined()
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm run test -- --reporter=verbose -t "fromSnapshot restores both" 2>&1 | tail -20`

If this test passes already (because the restoration code correctly routes external variables through `bindVariableToExternalPremise` or a compatible path), great. If it fails, we need to update the restoration logic.

- [ ] **Step 3: Update `fromSnapshot` restoration if needed**

In `src/lib/core/argument-engine.ts`, the current restoration calls `bindVariableToPremise` for all premise-bound variables. This will throw for external variables (since `boundArgumentId !== this.argumentId`). Split the loop:

```typescript
// Restore premise-bound variables: internal first, then external
for (const v of snapshot.variables.variables) {
    if (isPremiseBound(v as unknown as TCorePropositionalVariable)) {
        const pbv = v as unknown as TPremiseBoundVariable
        if (pbv.boundArgumentId === engine.argument.id) {
            engine.bindVariableToPremise(
                v as unknown as TOptionalChecksum<TPremiseBoundVariable>
            )
        } else {
            engine.bindVariableToExternalPremise(
                v as unknown as TOptionalChecksum<TPremiseBoundVariable>
            )
        }
    }
}
```

Apply the same pattern in `fromData`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "fromSnapshot restores both" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(restoration): support external bindings in fromSnapshot and fromData"
```

---

### Task 8: Full Suite Validation and Lint

**Files:**

- All modified files

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 3: Run lint and fix**

Run: `pnpm eslint . --fix 2>&1 | tail -20`
Then: `pnpm run prettify 2>&1 | tail -10`

- [ ] **Step 4: Run full check**

Run: `pnpm run check 2>&1 | tail -30`
Expected: All checks pass

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "style: lint and format fixes"
```

---

### Task 9: Update Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Update CLAUDE.md design rules**

Update the existing "Variables require either claim or premise references" bullet to mention cross-argument bindings:

```markdown
- **Variables require either claim or premise references:** Every variable must reference either a claim (via `claimId`/`claimVersion`) or a premise (via `boundPremiseId`/`boundArgumentId`/`boundArgumentVersion`), but not both. Claim-bound variables represent atomic propositions; premise-bound variables represent the proposition expressed by the bound premise's expression tree. Internal bindings (`boundArgumentId` matches the engine's argument) are resolved lazily during evaluation. External bindings (different `boundArgumentId`) are evaluator-assigned like claims. `createPremise` auto-creates a premise-bound variable for each new premise.
```

- [ ] **Step 2: Update API reference**

Add entries for `bindVariableToExternalPremise`, `bindVariableToArgument`, `canBind`, and `isExternallyBound`. Update `createPremise` entry to mention the `symbol` parameter and auto-variable creation. Update `evaluate`/`checkValidity` entries to mention external binding evaluation semantics.

- [ ] **Step 3: Update release notes and changelog**

Append to `docs/release-notes/upcoming.md` and `docs/changelogs/upcoming.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/api-reference.md docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: add cross-argument binding documentation"
```
