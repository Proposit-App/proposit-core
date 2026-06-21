# Premise-Variable Associations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow variables to bind to premises instead of claims, with semantic evaluation that resolves bound variables by evaluating their target premise's expression tree.

**Architecture:** Variable schema becomes a discriminated union (claim-bound XOR premise-bound). ArgumentEngine manages bindings internally, injects callbacks into PremiseEngine for circularity checking and evaluation resolution. Cascades flow from premise removal → variable removal → expression removal.

**Tech Stack:** TypeScript, TypeBox schemas, Vitest

**Spec:** `docs/plans/2026-03-15-premise-variable-associations-design.md`

---

## Chunk 1: Schema, Type Guards, and Checksum Config

### Task 1: Variable Schema — Discriminated Union

**Files:**

- Modify: `src/lib/schemata/propositional.ts:93-119`
- Modify: `src/lib/consts.ts:3-35`
- Modify: `src/lib/schemata/index.ts` (re-export new types)

- [ ] **Step 1: Write failing tests for type guards**

In `test/core.test.ts`, add imports for the new type guards and types. In the existing schemata import block (lines 11-20), add `isClaimBound`, `isPremiseBound`, `type TClaimBoundVariable`, `type TPremiseBoundVariable`:

```typescript
import {
    CoreArgumentSchema,
    CorePropositionalVariableSchema,
    CorePropositionalExpressionSchema,
    CorePremiseSchema,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
} from "../src/lib/schemata"
```

Then add a new describe block at the end of the file:

```typescript
describe("Premise-variable associations — type guards", () => {
    it("isClaimBound returns true for claim-bound variable", () => {
        const v: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        }
        expect(isClaimBound(v)).toBe(true)
        expect(isPremiseBound(v)).toBe(false)
    })

    it("isPremiseBound returns true for premise-bound variable", () => {
        const v: TCorePropositionalVariable = {
            id: "v2",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        expect(isPremiseBound(v)).toBe(true)
        expect(isClaimBound(v)).toBe(false)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: Compilation errors — `isClaimBound` and `isPremiseBound` do not exist yet.

- [ ] **Step 3: Implement schema changes**

In `src/lib/schemata/propositional.ts`, replace the single `CorePropositionalVariableSchema` with two schemas and a union:

```typescript
// Shared base fields for both variable types
const CoreVariableBaseFields = {
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    symbol: Type.String({
        description: 'Human-readable symbol for this variable (e.g. "P", "Q").',
    }),
    checksum: Type.String({
        description: "Entity-level checksum for sync detection.",
    }),
}

// Claim-bound variable: references a claim in ClaimLibrary
export const CoreClaimBoundVariableSchema = Type.Object(
    {
        ...CoreVariableBaseFields,
        claimId: UUID,
        claimVersion: Type.Number({
            description: "The version of the claim this variable references.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A claim-bound propositional variable referencing a global claim.",
    }
)

export type TClaimBoundVariable = Static<typeof CoreClaimBoundVariableSchema>

// Premise-bound variable: references a premise in this (or future: another) argument
export const CorePremiseBoundVariableSchema = Type.Object(
    {
        ...CoreVariableBaseFields,
        boundPremiseId: UUID,
        boundArgumentId: UUID,
        boundArgumentVersion: Type.Number({
            description:
                "The version of the argument containing the bound premise.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A premise-bound propositional variable whose value is derived from the bound premise's expression tree.",
    }
)

export type TPremiseBoundVariable = Static<
    typeof CorePremiseBoundVariableSchema
>

// Union type — the public-facing variable type
export const CorePropositionalVariableSchema = Type.Union([
    CoreClaimBoundVariableSchema,
    CorePremiseBoundVariableSchema,
])

export type TCorePropositionalVariable = Static<
    typeof CorePropositionalVariableSchema
>

// Type guards
export function isClaimBound(
    v: TCorePropositionalVariable
): v is TClaimBoundVariable {
    return "claimId" in v
}

export function isPremiseBound(
    v: TCorePropositionalVariable
): v is TPremiseBoundVariable {
    return "boundPremiseId" in v
}
```

Keep `CorePropositionalVariableSchema` as the export name so existing imports continue to work.

- [ ] **Step 4: Update checksum config**

In `src/lib/consts.ts`, add the three new fields to `variableFields`:

```typescript
variableFields: new Set([
  "id",
  "symbol",
  "argumentId",
  "argumentVersion",
  "claimId",
  "claimVersion",
  "boundPremiseId",
  "boundArgumentId",
  "boundArgumentVersion",
]),
```

- [ ] **Step 5: Update barrel exports**

In `src/lib/schemata/index.ts`, verify that the re-export from `propositional.js` already picks up the new types. If not, add explicit re-exports for `TClaimBoundVariable`, `TPremiseBoundVariable`, `isClaimBound`, `isPremiseBound`, `CoreClaimBoundVariableSchema`, `CorePremiseBoundVariableSchema`.

In `src/lib/index.ts`, add re-exports for the new types and type guards if they aren't already covered by the schemata barrel.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS — type guard tests pass.

- [ ] **Step 7: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: The typecheck will fail at these locations (fixed in later tasks):

- `src/lib/core/argument-engine.ts:480` — `addVariable` accesses `variable.claimId` unconditionally (fixed in Task 3)
- `src/lib/core/diff.ts:41-52` — `defaultCompareVariable` accesses `before.claimId`/`after.claimId` unconditionally (fixed in Task 12)
- Possibly other locations accessing claim fields without type guards

Note these failures — they are expected and will be resolved in subsequent tasks.

- [ ] **Step 8: Commit**

```bash
git add src/lib/schemata/propositional.ts src/lib/consts.ts src/lib/schemata/index.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: variable schema discriminated union with type guards"
```

---

### Task 2: Fix VariableManager.updateVariable Pre-Existing Bug

The current `VariableManager.updateVariable` only handles `symbol` updates. It needs to apply all provided fields so that `claimId`/`claimVersion` and `boundPremiseId` updates persist.

**Files:**

- Modify: `src/lib/core/variable-manager.ts:123-135`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

Two tests — one direct VariableManager unit test, and one through ArgumentEngine:

```typescript
describe("Premise-variable associations — VariableManager.updateVariable generalized", () => {
    it("applies non-symbol fields via VariableManager directly", () => {
        const vm = new VariableManager<TCorePropositionalVariable>()
        vm.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        })

        const updated = vm.updateVariable("v1", { claimId: "c2" } as any)
        expect(updated).toBeDefined()
        expect((updated as TClaimBoundVariable).claimId).toBe("c2")
    })

    it("applies non-symbol fields through ArgumentEngine", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        claimLibrary.create({ id: "c2" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )

        engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
        })

        const result = engine.updateVariable("v1", {
            claimId: "c2",
            claimVersion: 0,
        })

        expect(result).toBeDefined()
        const updated = engine.getVariable("v1")! as TClaimBoundVariable
        expect(updated.claimId).toBe("c2")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "updates non-symbol fields" 2>&1 | tail -20`
Expected: FAIL — `updated.claimId` is still `"c1"` because `VariableManager.updateVariable` ignores non-symbol fields.

- [ ] **Step 3: Fix VariableManager.updateVariable**

In `src/lib/core/variable-manager.ts`, modify `updateVariable` to apply all provided fields, not just `symbol`:

```typescript
public updateVariable(
  variableId: string,
  updates: Partial<TVar>,
): TVar | undefined {
  const variable = this.variables.get(variableId);
  if (!variable) return undefined;

  // Handle symbol rename separately (updates index)
  if (updates.symbol !== undefined && updates.symbol !== variable.symbol) {
    this.renameVariable(variableId, updates.symbol);
  }

  // Apply all other fields
  const current = this.variables.get(variableId)!;
  const updated = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (key !== "symbol" && value !== undefined) {
      (updated as Record<string, unknown>)[key] = value;
    }
  }
  this.variables.set(variableId, updated);

  return updated;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "updates non-symbol fields" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All existing tests pass (this change is backward-compatible).

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/variable-manager.ts test/core.test.ts
git commit -m "fix: VariableManager.updateVariable applies all provided fields"
```

---

### Task 3: Fix ArgumentEngine.addVariable Type Guard

With the union type, `addVariable` must guard against premise-bound variables being passed.

**Files:**

- Modify: `src/lib/core/argument-engine.ts:466-498`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — addVariable type guard", () => {
    it("rejects premise-bound variable passed to addVariable", () => {
        const claimLibrary = new ClaimLibrary()
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")

        expect(() =>
            engine.addVariable({
                id: "v1",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "p1",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            } as TCorePropositionalVariable)
        ).toThrow()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "rejects premise-bound variable passed to addVariable" 2>&1 | tail -20`
Expected: FAIL — currently `addVariable` tries to access `claimId` on a premise-bound variable without guarding.

- [ ] **Step 3: Add type guard to addVariable**

In `src/lib/core/argument-engine.ts`, add the import at the top of the file (this is a runtime value import, not just a type import):

```typescript
import {
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
} from "../schemata/index.js"
```

Then at the start of `addVariable`, add:

```typescript
if (!isClaimBound(variable as TCorePropositionalVariable)) {
    throw new Error(
        "addVariable only accepts claim-bound variables. Use bindVariableToPremise for premise-bound variables."
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "rejects premise-bound variable passed to addVariable" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite and typecheck**

Run: `pnpm run test && pnpm run typecheck`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: addVariable rejects premise-bound variables with type guard"
```

## Chunk 2: Core Binding — bindVariableToPremise, getVariablesBoundToPremise, Cascade

### Task 4: Implement bindVariableToPremise

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts` (add method to interface)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("Premise-variable associations — bindVariableToPremise", () => {
    function makeEngine() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        return engine
    }

    it("creates a premise-bound variable", () => {
        const engine = makeEngine()
        const result = engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        expect(result).toBeDefined()
        const v = engine.getVariable("vQ")
        expect(v).toBeDefined()
        expect(isPremiseBound(v!)).toBe(true)
    })

    it("rejects binding to non-existent premise", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "nonexistent",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("rejects duplicate symbol", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "A", // already taken
                boundPremiseId: "p1",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("rejects cross-argument binding", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "p1",
                boundArgumentId: "other-arg",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("allows multiple variables bound to same premise", () => {
        const engine = makeEngine()
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        expect(engine.getVariable("vQ")).toBeDefined()
        expect(engine.getVariable("vR")).toBeDefined()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "bindVariableToPremise" 2>&1 | tail -20`
Expected: FAIL — `bindVariableToPremise` does not exist.

- [ ] **Step 3: Implement bindVariableToPremise**

In `src/lib/core/argument-engine.ts`, add the method after `addVariable`. Follow the same pattern as `addVariable` (uses `ChangeCollector`, `markDirty`, `markAllPremisesDirty`, `markReactiveDirty`, `notifySubscribers`):

```typescript
public bindVariableToPremise(
  variable: TOptionalChecksum<TPremiseBoundVariable>,
): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
  this.throwIfPublished();

  if (variable.argumentId !== this.argument.id) {
    throw new Error(
      `Variable argumentId "${variable.argumentId}" does not match engine argument ID "${this.argument.id}".`,
    );
  }
  if (variable.argumentVersion !== this.argument.version) {
    throw new Error(
      `Variable argumentVersion "${variable.argumentVersion}" does not match engine argument version "${this.argument.version}".`,
    );
  }

  // Current restriction: same-argument only
  if (variable.boundArgumentId !== this.argument.id) {
    throw new Error(
      "Cross-argument bindings are not yet supported. boundArgumentId must equal argumentId.",
    );
  }

  // Validate target premise exists
  if (!this.premises.has(variable.boundPremiseId)) {
    throw new Error(
      `Premise "${variable.boundPremiseId}" does not exist in this argument.`,
    );
  }

  const withChecksum = this.attachVariableChecksum({ ...variable }) as TVar;
  this.variables.addVariable(withChecksum);

  const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>();
  collector.addedVariable(withChecksum);
  this.markDirty();
  this.markAllPremisesDirty();
  const changes = collector.toChangeset();
  this.markReactiveDirty(changes);
  this.notifySubscribers();
  return { result: withChecksum, changes };
}
```

Import `TPremiseBoundVariable` and `entityChecksum` as needed.

- [ ] **Step 4: Add to interface**

In `src/lib/core/interfaces/argument-engine.interfaces.ts`, add the method signature to the `TArgumentEngine` interface.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "bindVariableToPremise" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts test/core.test.ts
git commit -m "feat: implement bindVariableToPremise on ArgumentEngine"
```

---

### Task 5: Implement getVariablesBoundToPremise

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — getVariablesBoundToPremise", () => {
    it("returns variables bound to a specific premise", () => {
        // Setup engine with two premises, one claim-bound var, two premise-bound vars
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const bound = engine.getVariablesBoundToPremise("p1")
        expect(bound).toHaveLength(2)
        expect(bound.map((v) => v.id).sort()).toEqual(["vQ", "vR"])

        expect(engine.getVariablesBoundToPremise("p2")).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "getVariablesBoundToPremise" 2>&1 | tail -20`
Expected: FAIL — method does not exist.

- [ ] **Step 3: Implement**

In `src/lib/core/argument-engine.ts`:

```typescript
public getVariablesBoundToPremise(premiseId: string): TVar[] {
  return this.variables
    .getVariables()
    .filter(
      (v) =>
        isPremiseBound(v as TCorePropositionalVariable) &&
        (v as TPremiseBoundVariable).boundPremiseId === premiseId,
    );
}
```

Add to interface as well.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "getVariablesBoundToPremise" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts test/core.test.ts
git commit -m "feat: implement getVariablesBoundToPremise query"
```

---

### Task 6: Premise Removal Cascade to Bound Variables

**Files:**

- Modify: `src/lib/core/argument-engine.ts:414-439` (`removePremise`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — removePremise cascade", () => {
    it("removes bound variables when their target premise is removed", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to premise 2's expression tree
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            type: "variable",
            variableId: "vQ",
        })

        // Remove p1 — should cascade: remove vQ, which cascades to remove e1 from p2
        engine.removePremise("p1")

        expect(engine.getVariable("vQ")).toBeUndefined()
        expect(p2.getExpressions()).toHaveLength(0)
        // Claim-bound variable should still exist
        expect(engine.getVariable("vA")).toBeDefined()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "removes bound variables when their target premise is removed" 2>&1 | tail -20`
Expected: FAIL — `vQ` still exists after `removePremise("p1")`.

- [ ] **Step 3: Modify removePremise**

In `src/lib/core/argument-engine.ts`, in the `removePremise` method, after `this.premises.delete(premiseId)` and `collector.removedPremise(data)`, add cascade logic before `this.markDirty()`:

```typescript
// Cascade: remove variables bound to this premise
const boundVars = this.getVariablesBoundToPremise(premiseId)
for (const v of boundVars) {
    const removeResult = this.removeVariable(v.id)
    if (removeResult.changes.variables) {
        for (const rv of removeResult.changes.variables.removed) {
            collector.removedVariable(rv)
        }
    }
    if (removeResult.changes.expressions) {
        for (const re of removeResult.changes.expressions.removed) {
            collector.removedExpression(re)
        }
    }
}
```

Note: `removePremise` uses a `ChangeCollector`, not a plain changes object. The cascade results are accumulated into the same collector before `toChangeset()` is called.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "removes bound variables when their target premise is removed" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: removePremise cascades to bound variables"
```

## Chunk 3: Circularity Prevention

### Task 7: Direct Circularity Check in PremiseEngine

**Files:**

- Modify: `src/lib/core/premise-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — circularity prevention", () => {
    function makeEngineWithBinding() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        // Q is bound to p1
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        return engine
    }

    it("rejects adding a variable expression to the premise it is bound to", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!

        // Try to add Q (bound to p1) as an expression in p1 — direct cycle
        expect(() =>
            p1.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p1",
                type: "variable",
                variableId: "vQ",
            })
        ).toThrow(/circular/i)
    })

    it("allows adding a variable expression to a different premise", () => {
        const engine = makeEngineWithBinding()
        const p2 = engine.getPremise("p2")!

        // Adding Q (bound to p1) to p2 is fine
        expect(() =>
            p2.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p2",
                type: "variable",
                variableId: "vQ",
            })
        ).not.toThrow()
    })

    it("allows adding a claim-bound variable expression to any premise", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!

        // Adding A (claim-bound) to p1 is fine
        expect(() =>
            p1.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p1",
                type: "variable",
                variableId: "vA",
            })
        ).not.toThrow()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "circularity prevention" 2>&1 | tail -20`
Expected: FAIL — no circularity check exists.

- [ ] **Step 3: Add circularity callback to PremiseEngine**

In `src/lib/core/premise-engine.ts`, add a callback property:

```typescript
private circularityCheck?: (variableId: string, premiseId: string) => boolean;

public setCircularityCheck(
  check: (variableId: string, premiseId: string) => boolean,
): void {
  this.circularityCheck = check;
}
```

In each expression-add method (`addExpression`, `appendExpression`, `addExpressionRelative`, `insertExpression`), after the existing variable validation block (where it checks `this.variables.hasVariable(...)`), add:

```typescript
if (expression.type === "variable" && this.circularityCheck) {
    if (this.circularityCheck(expression.variableId, this.premise.id)) {
        throw new Error(
            `Circular binding: variable "${expression.variableId}" is bound to this premise (directly or transitively)`
        )
    }
}
```

- [ ] **Step 4: Wire up callback in ArgumentEngine**

In `src/lib/core/argument-engine.ts`, where `PremiseEngine` instances are created (in `addPremise`, `fromSnapshot`, `fromData`), inject the circularity check callback:

```typescript
private createCircularityCheck(): (
  variableId: string,
  premiseId: string,
) => boolean {
  return (variableId: string, premiseId: string): boolean => {
    const variable = this.variables.getVariable(variableId);
    if (!variable || !isPremiseBound(variable as TCorePropositionalVariable)) {
      return false;
    }
    return this.wouldCreateCycle(
      variableId,
      premiseId,
      new Set(),
    );
  };
}

private wouldCreateCycle(
  variableId: string,
  targetPremiseId: string,
  visited: Set<string>,
): boolean {
  const variable = this.variables.getVariable(variableId);
  if (!variable || !isPremiseBound(variable as TCorePropositionalVariable)) {
    return false;
  }
  const boundPremiseId = (variable as TPremiseBoundVariable).boundPremiseId;

  // Direct cycle: variable is bound to the premise we're adding it to
  if (boundPremiseId === targetPremiseId) return true;

  // Depth limit
  if (visited.size >= this.premises.size) {
    throw new Error("Circularity check exceeded depth limit");
  }
  if (visited.has(variableId)) return false;
  visited.add(variableId);

  // Transitive: check variables in the bound premise's expression tree
  const boundPremise = this.premises.get(boundPremiseId);
  if (!boundPremise) return false;

  for (const expr of boundPremise.getExpressions()) {
    if (expr.type === "variable") {
      if (this.wouldCreateCycle(expr.variableId, targetPremiseId, visited)) {
        return true;
      }
    }
  }
  return false;
}
```

Call `premiseEngine.setCircularityCheck(this.createCircularityCheck())` on each `PremiseEngine` instance after creation. The wiring points are: `createPremiseWithId`, `fromSnapshot` (after `PremiseEngine.fromSnapshot`), and `fromData`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "circularity prevention" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: circularity prevention for premise-bound variables"
```

---

### Task 8: Transitive Circularity Check

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test for transitive cycle**

```typescript
describe("Premise-variable associations — transitive circularity", () => {
    it("rejects indirect cycles through binding chain", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })

        // Q bound to p1, R bound to p2
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p2",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add R to p1's expression tree (R is bound to p2, fine)
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "variable",
            variableId: "vR",
        })

        // Now try to add Q to p2 — Q bound to p1, which contains R, which is bound to p2
        // This is a transitive cycle: p2 → R → p2 (through Q → p1 → R → p2)
        const p2 = engine.getPremise("p2")!
        expect(() =>
            p2.appendExpression(null, {
                id: "e2",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p2",
                type: "variable",
                variableId: "vQ",
            })
        ).toThrow(/circular/i)
    })
})
```

- [ ] **Step 2: Run test to verify it passes (or fails and needs fix)**

Run: `pnpm run test -- --reporter=verbose -t "rejects indirect cycles" 2>&1 | tail -20`
Expected: PASS — the `wouldCreateCycle` from Task 7 should already handle this transitively. If it fails, debug and fix the recursive walk.

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test: transitive circularity prevention"
```

## Chunk 4: Evaluation Changes

### Task 9: Filter Premise-Bound Variables from Assignment Generation

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (`evaluate`, `checkValidity`)
- Modify: `src/lib/core/premise-engine.ts` (`evaluate`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — evaluation filtering", () => {
    it("excludes premise-bound variables from truth table columns", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        claimLibrary.create({ id: "c2" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )

        // Premise 1: A implies B (the sub-argument)
        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "c2",
            claimVersion: 0,
        })
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "operator",
            operator: "implies",
        })
        p1.appendExpression("op1", {
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "variable",
            variableId: "vA",
        })
        p1.appendExpression("op1", {
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "variable",
            variableId: "vB",
        })

        // Premise 2: P implies Q, where Q is bound to p1
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // checkValidity should only generate assignments for A, B, P (not Q)
        const result = engine.checkValidity()
        expect(result).toBeDefined()
        // 3 claim-bound variables → 2^3 = 8 assignments
        expect(result!.numAssignmentsChecked).toBe(8)
    })
})
```

**Note:** This task only validates assignment count, not evaluation correctness. The evaluation values for premise-bound variables will be `null` (unresolved) until Task 10 wires up the resolver callback.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "excludes premise-bound variables from truth table columns" 2>&1 | tail -20`
Expected: FAIL — Q is included as a regular variable, giving 2^4 = 16 assignments.

- [ ] **Step 3: Filter premise-bound variables in checkValidity and evaluate**

In `src/lib/core/argument-engine.ts`, where `checkedVariableIds` and `referencedVariableIds` are collected by scanning expressions, add a filter:

```typescript
// After collecting variable IDs from expressions, filter out premise-bound
const claimBoundVariableIds = new Set(
    [...collectedVariableIds].filter((vid) => {
        const v = this.variables.getVariable(vid)
        return v && isClaimBound(v as TCorePropositionalVariable)
    })
)
```

Use `claimBoundVariableIds` instead of the unfiltered set for assignment generation and `referencedVariableIds` in the result.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "excludes premise-bound variables from truth table columns" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: filter premise-bound variables from truth table assignment generation"
```

---

### Task 10: Resolver Callback and Lazy Evaluation

**Files:**

- Modify: `src/lib/core/premise-engine.ts:856-962` (`evaluate`)
- Modify: `src/lib/core/argument-engine.ts` (`evaluate`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — lazy evaluation", () => {
    function makeImplicationEngine() {
        // "P implies (A implies B)" via two premises:
        // Premise 1 (p1): A implies B
        // Premise 2 (p2): P implies Q, where Q bound to p1
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA" })
        claimLibrary.create({ id: "cB" })
        claimLibrary.create({ id: "cP" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )

        // Variables
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        })
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        })
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        })

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "operator",
            operator: "implies",
        })
        p1.appendExpression("op1", {
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "variable",
            variableId: "vA",
        })
        p1.appendExpression("op1", {
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            type: "variable",
            variableId: "vB",
        })

        // Q bound to p1
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P implies Q (this is the conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            type: "operator",
            operator: "implies",
        })
        p2.appendExpression("op2", {
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            type: "variable",
            variableId: "vP",
        })
        p2.appendExpression("op2", {
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            type: "variable",
            variableId: "vQ",
        })

        // p2 is conclusion, p1 is supporting
        engine.setConclusionPremise("p2")

        return engine
    }

    it("evaluates premise-bound variable Q by resolving p1's tree", () => {
        const engine = makeImplicationEngine()

        // A=true, B=true, P=true → Q = (A implies B) = true → P implies Q = true
        const result = engine.evaluate({
            variables: { vA: true, vB: true, vP: true },
            rejectedExpressionIds: [],
        })
        expect(result).toBeDefined()
        // Conclusion: P implies Q = true implies true = true
        expect(result!.conclusion!.rootValue).toBe(true)
    })

    it("evaluates Q as false when A=true, B=false", () => {
        const engine = makeImplicationEngine()

        // A=true, B=false → Q = (A implies B) = false
        // P=true → P implies Q = true implies false = false
        const result = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            rejectedExpressionIds: [],
        })
        expect(result).toBeDefined()
        expect(result!.conclusion!.rootValue).toBe(false)
    })

    it("evaluates Q as true when A=false (vacuous truth)", () => {
        const engine = makeImplicationEngine()

        // A=false, B=false → Q = (A implies B) = true (vacuous)
        // P=true → P implies Q = true implies true = true
        const result = engine.evaluate({
            variables: { vA: false, vB: false, vP: true },
            rejectedExpressionIds: [],
        })
        expect(result).toBeDefined()
        expect(result!.conclusion!.rootValue).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "lazy evaluation" 2>&1 | tail -20`
Expected: FAIL — Q is looked up in the assignment map (where it doesn't exist), returning `undefined`/`null`.

- [ ] **Step 3: Add resolver callback to PremiseEngine.evaluate**

In `src/lib/core/premise-engine.ts`, add an optional resolver parameter to `evaluate`:

```typescript
public evaluate(
  assignment: TCoreExpressionAssignment,
  options?: {
    strictUnknownKeys?: boolean;
    requireExactCoverage?: boolean;
    resolver?: (variableId: string) => boolean | null;
  },
): TEvaluationResult | undefined {
```

In the `evaluateExpression` inner function, where variable-type expressions are handled (around line 913-917), change:

```typescript
if (expression.type === "variable") {
    if (options?.resolver) {
        const variable = this.variables.getVariable(expression.variableId)
        if (
            variable &&
            isPremiseBound(variable as TCorePropositionalVariable)
        ) {
            return options.resolver(expression.variableId)
        }
    }
    return assignment.variables[expression.variableId] ?? null
}
```

- [ ] **Step 4: Wire up resolver in ArgumentEngine.evaluate**

In `src/lib/core/argument-engine.ts`, in the `evaluate` method, create a resolver with caching:

```typescript
const resolverCache = new Map<string, boolean | null>()
const resolver = (variableId: string): boolean | null => {
    if (resolverCache.has(variableId)) {
        return resolverCache.get(variableId)!
    }
    const variable = this.variables.getVariable(variableId)
    if (!variable || !isPremiseBound(variable as TCorePropositionalVariable)) {
        return assignment.variables[variableId] ?? null
    }
    const boundPremiseId = (variable as TPremiseBoundVariable).boundPremiseId
    const boundPremise = this.premises.get(boundPremiseId)
    if (!boundPremise) {
        resolverCache.set(variableId, null)
        return null
    }
    const premiseResult = boundPremise.evaluate(assignment, {
        ...evalOptions,
        resolver,
    })
    const value = premiseResult?.rootValue ?? null
    resolverCache.set(variableId, value)
    return value
}
```

Pass `{ resolver }` into each `PremiseEngine.evaluate` call.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "lazy evaluation" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: lazy evaluation resolver for premise-bound variables"
```

## Chunk 5: updateVariable, Diff, Snapshot Restoration

### Task 11: updateVariable for Both Variants

**Files:**

- Modify: `src/lib/core/argument-engine.ts:500-549`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("Premise-variable associations — updateVariable", () => {
    function makeEngine() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        claimLibrary.create({ id: "c2" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        return engine
    }

    it("updates symbol on premise-bound variable", () => {
        const engine = makeEngine()
        engine.updateVariable("vQ", { symbol: "R" })
        expect(engine.getVariable("vQ")!.symbol).toBe("R")
    })

    it("rebinds premise-bound variable to different premise", () => {
        const engine = makeEngine()
        engine.updateVariable("vQ", { boundPremiseId: "p2" } as any)
        const v = engine.getVariable("vQ")! as TPremiseBoundVariable
        expect(v.boundPremiseId).toBe("p2")
    })

    it("rejects binding-type conversion on claim-bound variable", () => {
        const engine = makeEngine()
        expect(() =>
            engine.updateVariable("vA", { boundPremiseId: "p1" } as any)
        ).toThrow()
    })

    it("rejects binding-type conversion on premise-bound variable", () => {
        const engine = makeEngine()
        expect(() =>
            engine.updateVariable("vQ", { claimId: "c1" } as any)
        ).toThrow()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "Premise-variable associations — updateVariable" 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Update ArgumentEngine.updateVariable**

In `src/lib/core/argument-engine.ts`, rewrite `updateVariable` to handle both variants. Follow the existing pattern (ChangeCollector, markDirty, etc.):

```typescript
public updateVariable(
  variableId: string,
  updates: Partial<TVar>,
): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg> {
  this.throwIfPublished();
  const variable = this.variables.getVariable(variableId);
  if (!variable) return { result: undefined, changes: {} };

  const varAsPropositional = variable as TCorePropositionalVariable;

  // Reject binding-type conversion
  if (isClaimBound(varAsPropositional)) {
    if ("boundPremiseId" in updates || "boundArgumentId" in updates || "boundArgumentVersion" in updates) {
      throw new Error("Cannot convert claim-bound variable to premise-bound. Delete and recreate.");
    }
    // Validate claim updates if provided
    const u = updates as Partial<TClaimBoundVariable>;
    if (u.claimId !== undefined || u.claimVersion !== undefined) {
      const newClaimId = u.claimId ?? (varAsPropositional as TClaimBoundVariable).claimId;
      const newClaimVersion = u.claimVersion ?? (varAsPropositional as TClaimBoundVariable).claimVersion;
      if (!this.claimLibrary.get(newClaimId, newClaimVersion)) {
        throw new Error(`Claim "${newClaimId}" version ${newClaimVersion} not found in the claim library.`);
      }
    }
  } else if (isPremiseBound(varAsPropositional)) {
    if ("claimId" in updates || "claimVersion" in updates) {
      throw new Error("Cannot convert premise-bound variable to claim-bound. Delete and recreate.");
    }
    const u = updates as Partial<TPremiseBoundVariable>;
    if (u.boundPremiseId !== undefined) {
      if (!this.premises.has(u.boundPremiseId)) {
        throw new Error(`Premise "${u.boundPremiseId}" does not exist in this argument.`);
      }
      // TODO: circularity check for rebinding
    }
  }

  const updated = this.variables.updateVariable(variableId, updates);
  if (!updated) return { result: undefined, changes: {} };

  // Re-checksum
  const withChecksum = this.attachVariableChecksum({ ...updated }) as TVar;
  this.variables.removeVariable(variableId);
  this.variables.addVariable(withChecksum);

  const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>();
  collector.modifiedVariable(withChecksum);
  this.markDirty();
  this.markAllPremisesDirty();
  const changes = collector.toChangeset();
  this.markReactiveDirty(changes);
  this.notifySubscribers();
  return { result: withChecksum, changes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "Premise-variable associations — updateVariable" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: updateVariable handles both claim-bound and premise-bound variants"
```

---

### Task 12: defaultCompareVariable for Union Type

**Files:**

- Modify: `src/lib/core/diff.ts:29-56`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — diff", () => {
    it("detects changes on premise-bound variable fields", () => {
        const before: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const after: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p2", // changed
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const changes = defaultCompareVariable(before, after)
        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("boundPremiseId")
    })

    it("detects cross-variant change", () => {
        const before: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        }
        const after: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const changes = defaultCompareVariable(before, after)
        // Should report changes on all 5 binding fields
        const fields = changes.map((c) => c.field).sort()
        expect(fields).toEqual([
            "boundArgumentId",
            "boundArgumentVersion",
            "boundPremiseId",
            "claimId",
            "claimVersion",
        ])
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose -t "Premise-variable associations — diff" 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Rewrite defaultCompareVariable**

In `src/lib/core/diff.ts`:

```typescript
export function defaultCompareVariable<TVar extends TCorePropositionalVariable>(
    before: TVar,
    after: TVar
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []

    if (before.symbol !== after.symbol) {
        changes.push({
            field: "symbol",
            before: before.symbol,
            after: after.symbol,
        })
    }

    // All possible binding fields — compare with optional chaining
    const bindingFields = [
        "claimId",
        "claimVersion",
        "boundPremiseId",
        "boundArgumentId",
        "boundArgumentVersion",
    ] as const

    for (const field of bindingFields) {
        const bVal = (before as Record<string, unknown>)[field]
        const aVal = (after as Record<string, unknown>)[field]
        if (bVal !== aVal) {
            changes.push({ field, before: bVal, after: aVal })
        }
    }

    return changes
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "Premise-variable associations — diff" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/diff.ts test/core.test.ts
git commit -m "feat: defaultCompareVariable handles discriminated union"
```

---

### Task 13: Snapshot Restoration Order

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (`fromSnapshot`, `fromData`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — snapshot round-trip", () => {
    it("restores premise-bound variables from snapshot", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const snapshot = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(
            snapshot,
            claimLibrary,
            sourceLibrary,
            csLibrary
        )

        const vQ = restored.getVariable("vQ")
        expect(vQ).toBeDefined()
        expect(isPremiseBound(vQ!)).toBe(true)
        expect((vQ as TPremiseBoundVariable).boundPremiseId).toBe("p1")

        const vA = restored.getVariable("vA")
        expect(vA).toBeDefined()
        expect(isClaimBound(vA!)).toBe(true)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "restores premise-bound variables from snapshot" 2>&1 | tail -20`
Expected: FAIL — `fromSnapshot` calls `addVariable` which rejects premise-bound variables.

- [ ] **Step 3: Update fromSnapshot and fromData**

In `src/lib/core/argument-engine.ts`, modify `fromSnapshot`:

```typescript
// Change restoration order: premises first, then variables
// 1. Restore premises
for (const premiseSnap of snapshot.premises) { ... }

// 2. Restore claim-bound variables
for (const v of snapshot.variables.variables) {
  if (isClaimBound(v as TCorePropositionalVariable)) {
    engine.addVariable(v);
  }
}

// 3. Restore premise-bound variables
for (const v of snapshot.variables.variables) {
  if (isPremiseBound(v as TCorePropositionalVariable)) {
    engine.bindVariableToPremise(v as TPremiseBoundVariable);
  }
}
```

Apply the same pattern to `fromData`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "restores premise-bound variables from snapshot" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: snapshot restoration handles premise-bound variables"
```

## Chunk 6: Validation, CLI, Documentation

### Task 14: validateEvaluability for Premise-Bound Variables

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (`validateEvaluability`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("Premise-variable associations — validateEvaluability", () => {
    it("warns when premise-bound variable targets an empty premise", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1" })
        const sourceLibrary = new SourceLibrary()
        const csLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            sourceLibrary,
            csLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        // Q bound to p1, but p1 has no expressions (empty tree)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to p2's tree so it gets evaluated
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        // Should have a warning about empty bound premise
        expect(
            validation.issues.some(
                (i) => i.code.includes("EMPTY") || i.code.includes("BOUND")
            )
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "warns when premise-bound variable targets an empty premise" 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement validation**

In `src/lib/core/premise-engine.ts`, in `validateEvaluability`, after the existing undeclared variable check, add a check for premise-bound variables with empty targets. This requires access to the argument's premises — add an optional callback similar to the circularity check:

```typescript
private emptyBoundPremiseCheck?: (variableId: string) => boolean;

public setEmptyBoundPremiseCheck(
  check: (variableId: string) => boolean,
): void {
  this.emptyBoundPremiseCheck = check;
}
```

First, add `"EXPR_BOUND_PREMISE_EMPTY"` to the `TCoreValidationCode` union type in `src/lib/types/evaluation.ts`.

Then in `validateEvaluability`, after the undeclared variable check:

```typescript
if (
    expr.type === "variable" &&
    this.emptyBoundPremiseCheck?.(expr.variableId)
) {
    issues.push({
        code: "EXPR_BOUND_PREMISE_EMPTY" as TCoreValidationCode,
        message: `Variable "${expr.variableId}" is bound to a premise with no expression tree`,
        expressionId: expr.id,
        severity: "warning",
    })
}
```

Note: Use `severity: "warning"` (not error) — this should not block evaluation per the spec. The bound variable will evaluate to `null`/unknown under Kleene logic.

Wire up in `ArgumentEngine` when creating `PremiseEngine` instances.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "warns when premise-bound variable targets an empty premise" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: validateEvaluability warns on empty bound premises"
```

---

### Task 15: CLI — variables bind Command

**Files:**

- Modify: `src/cli/commands/variables.ts`
- Test: `scripts/smoke-test.sh` (add smoke test coverage)

- [ ] **Step 1: Add `variables bind` command**

In `src/cli/commands/variables.ts`, add a new command:

```typescript
.command("bind <symbol>")
.description("Create a premise-bound variable")
.requiredOption("--premiseId <id>", "ID of the premise to bind to")
.action(async (symbol: string, opts: { premiseId: string }) => {
  // Load engine context
  // Create premise-bound variable via engine.bindVariableToPremise
  // Save and display result
})
```

Follow the pattern of the existing `create` command for loading the engine context and saving.

- [ ] **Step 2: Update `variables list` to show binding type**

In the list command's output formatting, check variable type and display:

- Claim-bound: `P (claim: c1@0)`
- Premise-bound: `Q (bound to premise: p1)`

- [ ] **Step 3: Build and smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: Existing smoke tests pass. New `variables bind` command is available.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/variables.ts
git commit -m "feat: CLI variables bind command and list display"
```

---

### Task 16: Update Barrel Exports and Documentation

**Files:**

- Modify: `src/lib/index.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/api-reference.md`

- [ ] **Step 1: Verify all new public types are exported**

Check that these are accessible from `src/lib/index.ts`:

- `TClaimBoundVariable`, `TPremiseBoundVariable`
- `isClaimBound`, `isPremiseBound`
- `CoreClaimBoundVariableSchema`, `CorePremiseBoundVariableSchema`

- [ ] **Step 2: Update interface JSDoc**

Update `argument-engine.interfaces.ts` with JSDoc for:

- `bindVariableToPremise`
- `getVariablesBoundToPremise`

Update `premise-engine.interfaces.ts` with JSDoc for:

- `evaluate` resolver parameter

- [ ] **Step 3: Update CLAUDE.md design rule**

Change "Variables require claim references" to:

> **Variables require either claim or premise references:** Every variable must reference either a claim (via `claimId`/`claimVersion`) or a premise (via `boundPremiseId`/`boundArgumentId`/`boundArgumentVersion`), but not both. Claim-bound variables represent atomic propositions; premise-bound variables represent the proposition expressed by the bound premise's expression tree, and are resolved during evaluation.

- [ ] **Step 4: Update docs/api-reference.md**

Add documentation for:

- `bindVariableToPremise` method
- `getVariablesBoundToPremise` method
- Premise-bound variable evaluation behavior
- Circularity prevention

- [ ] **Step 5: Run all checks**

Run: `pnpm run check`
Expected: All pass (typecheck, lint, test, build).

- [ ] **Step 6: Commit**

```bash
git add src/lib/index.ts src/lib/core/interfaces/ CLAUDE.md docs/api-reference.md
git commit -m "docs: update exports, interfaces, and documentation for premise-variable associations"
```

---

### Task 17: Final Integration Test

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write comprehensive integration test**

```typescript
describe("Premise-variable associations — integration", () => {
    it("full round-trip: create, evaluate, snapshot, restore, re-evaluate", () => {
        // Build "P implies (A implies B)" argument
        // Evaluate with multiple assignments
        // Take snapshot
        // Restore from snapshot
        // Re-evaluate and confirm same results
        // Remove target premise and confirm cascade
    })

    it("checkValidity produces correct result for nested implication", () => {
        // Build "P implies (A implies B)" with p2 as conclusion
        // Run checkValidity
        // Verify correct validity assessment
    })
})
```

Fill in the full test bodies following the patterns from Task 10.

- [ ] **Step 2: Run the integration tests**

Run: `pnpm run test -- --reporter=verbose -t "Premise-variable associations — integration" 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 3: Run all checks**

Run: `pnpm run check`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts
git commit -m "test: comprehensive integration tests for premise-variable associations"
```
