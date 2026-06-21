# API Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign proposit-core's public API to support dual-instance synchronization with entity-typed changesets, per-entity checksums, and derived supporting premises.

**Architecture:** Keep current class hierarchy (ArgumentEngine → PremiseManager → ExpressionManager). Augment mutating methods with `TCoreMutationResult<T>` return types. Add internal `ChangeCollector` that helpers record to during mutations. Simplify role state to conclusion-only, deriving supporting premises from expression type. Add lazy hierarchical checksum system with configurable fields.

**Tech Stack:** TypeScript 5.9, Typebox 1.1, Vitest, pnpm

**Design doc:** `docs/plans/2026-03-03-api-redesign-design.md`

---

## Phase 1: Foundation Types

### Task 1: Add Mutation Result Types

**Files:**

- Create: `src/lib/types/mutation.ts`
- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Create the types file**

Create `src/lib/types/mutation.ts`:

```typescript
import type { TCorePropositionalExpression } from "../schemata/propositional.js"
import type { TCorePropositionalVariable } from "../schemata/propositional.js"
import type { TCorePremise } from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"

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
export interface TCoreChangeset {
    expressions?: TCoreEntityChanges<TCorePropositionalExpression>
    variables?: TCoreEntityChanges<TCorePropositionalVariable>
    premises?: TCoreEntityChanges<TCorePremise>
    /** New role state, present only when roles changed. */
    roles?: TCoreArgumentRoleState
    /** New argument metadata, present only when argument changed. */
    argument?: TCoreArgument
}

/**
 * Every mutating method returns this wrapper.
 * `result` is the direct answer (e.g. the removed expression).
 * `changes` is the full set of DB-level side effects.
 */
export interface TCoreMutationResult<T> {
    result: T
    changes: TCoreChangeset
}
```

**Step 2: Export from lib and public index**

Add to `src/lib/index.ts` after the existing diff export:

```typescript
export * from "./types/mutation.js"
```

Add to `src/index.ts`:

```typescript
export * from "./lib/types/mutation.js"
```

**Step 3: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS (pure additions, nothing references these yet)

**Step 4: Commit**

```
git add src/lib/types/mutation.ts src/lib/index.ts src/index.ts
git commit -m "Add mutation result types (TCoreEntityChanges, TCoreChangeset, TCoreMutationResult)"
```

---

### Task 2: Implement ChangeCollector

**Files:**

- Create: `src/lib/core/ChangeCollector.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests for ChangeCollector**

Add a new describe block at the bottom of `test/ExpressionManager.test.ts`:

```typescript
describe("ChangeCollector", () => {
    it("starts with an empty changeset", () => {
        const collector = new ChangeCollector()
        const cs = collector.toChangeset()
        expect(cs).toEqual({})
    })

    it("collects added expressions", () => {
        const collector = new ChangeCollector()
        const expr = {
            id: "e1",
            type: "variable",
        } as TCorePropositionalExpression
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.expressions?.added).toEqual([expr])
        expect(cs.expressions?.modified).toEqual([])
        expect(cs.expressions?.removed).toEqual([])
    })

    it("collects modified and removed expressions", () => {
        const collector = new ChangeCollector()
        const modified = {
            id: "e1",
            type: "variable",
        } as TCorePropositionalExpression
        const removed = {
            id: "e2",
            type: "operator",
        } as TCorePropositionalExpression
        collector.modifiedExpression(modified)
        collector.removedExpression(removed)
        const cs = collector.toChangeset()
        expect(cs.expressions?.added).toEqual([])
        expect(cs.expressions?.modified).toEqual([modified])
        expect(cs.expressions?.removed).toEqual([removed])
    })

    it("collects variable changes", () => {
        const collector = new ChangeCollector()
        const v = { id: "v1", symbol: "P" } as TCorePropositionalVariable
        collector.addedVariable(v)
        const cs = collector.toChangeset()
        expect(cs.variables?.added).toEqual([v])
        expect(cs.expressions).toBeUndefined()
    })

    it("collects premise changes", () => {
        const collector = new ChangeCollector()
        const p = { id: "p1" } as TCorePremise
        collector.addedPremise(p)
        const cs = collector.toChangeset()
        expect(cs.premises?.added).toEqual([p])
    })

    it("records role state changes", () => {
        const collector = new ChangeCollector()
        const roles = { conclusionPremiseId: "p1" }
        collector.setRoles(roles)
        const cs = collector.toChangeset()
        expect(cs.roles).toEqual(roles)
    })

    it("omits unchanged categories from changeset", () => {
        const collector = new ChangeCollector()
        const expr = { id: "e1" } as TCorePropositionalExpression
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.variables).toBeUndefined()
        expect(cs.premises).toBeUndefined()
        expect(cs.roles).toBeUndefined()
        expect(cs.argument).toBeUndefined()
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — ChangeCollector not found

**Step 3: Implement ChangeCollector**

Create `src/lib/core/ChangeCollector.ts`:

```typescript
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/index.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
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

/**
 * Internal collector used during a single mutation to accumulate all
 * side-effect changes. Created at the start of a public mutating method,
 * populated by internal helpers, and consumed via toChangeset().
 */
export class ChangeCollector {
    private expressions: TCoreEntityChanges<TCorePropositionalExpression> =
        emptyEntityChanges()
    private variables: TCoreEntityChanges<TCorePropositionalVariable> =
        emptyEntityChanges()
    private premises: TCoreEntityChanges<TCorePremise> = emptyEntityChanges()
    private roles: TCoreArgumentRoleState | undefined = undefined
    private argument: TCoreArgument | undefined = undefined

    addedExpression(expr: TCorePropositionalExpression): void {
        this.expressions.added.push(expr)
    }
    modifiedExpression(expr: TCorePropositionalExpression): void {
        this.expressions.modified.push(expr)
    }
    removedExpression(expr: TCorePropositionalExpression): void {
        this.expressions.removed.push(expr)
    }

    addedVariable(variable: TCorePropositionalVariable): void {
        this.variables.added.push(variable)
    }
    removedVariable(variable: TCorePropositionalVariable): void {
        this.variables.removed.push(variable)
    }

    addedPremise(premise: TCorePremise): void {
        this.premises.added.push(premise)
    }
    removedPremise(premise: TCorePremise): void {
        this.premises.removed.push(premise)
    }

    setRoles(roles: TCoreArgumentRoleState): void {
        this.roles = roles
    }

    setArgument(argument: TCoreArgument): void {
        this.argument = argument
    }

    toChangeset(): TCoreChangeset {
        const cs: TCoreChangeset = {}
        if (!isEntityChangesEmpty(this.expressions))
            cs.expressions = this.expressions
        if (!isEntityChangesEmpty(this.variables)) cs.variables = this.variables
        if (!isEntityChangesEmpty(this.premises)) cs.premises = this.premises
        if (this.roles !== undefined) cs.roles = this.roles
        if (this.argument !== undefined) cs.argument = this.argument
        return cs
    }
}
```

**Step 4: Add import to test file and run tests**

Import `ChangeCollector` in the test file and run:

Run: `pnpm run test`
Expected: PASS — all new tests green, all existing tests still pass

**Step 5: Commit**

```
git add src/lib/core/ChangeCollector.ts test/ExpressionManager.test.ts
git commit -m "Implement ChangeCollector for mutation change tracking"
```

---

## Phase 2: Role State Simplification

### Task 3: Simplify TCoreArgumentRoleState Schema

**Files:**

- Modify: `src/lib/schemata/argument.ts:16-25`
- Modify: `src/lib/types/evaluation.ts:8` (TCorePremiseRole type)

**Step 1: Update the schema**

In `src/lib/schemata/argument.ts`, change `CoreArgumentRoleStateSchema` (lines 16-25) from:

```typescript
export const CoreArgumentRoleStateSchema = Type.Object(
    {
        conclusionPremiseId: Type.Optional(UUID),
        supportingPremiseIds: Type.Array(UUID),
    },
    ...
)
```

To:

```typescript
export const CoreArgumentRoleStateSchema = Type.Object(
    {
        conclusionPremiseId: Type.Optional(UUID),
    },
    {
        description:
            "Tracks which premise serves as the conclusion. Supporting premises are derived from expression type.",
    }
)
```

**Step 2: Remove TCorePremiseRole type from evaluation types**

In `src/lib/types/evaluation.ts`, remove line 8:

```typescript
export type TCorePremiseRole = "supporting" | "conclusion"
```

This type is no longer meaningful since "supporting" is derived, not assigned.

**Step 3: Verify typecheck to see what breaks**

Run: `pnpm run typecheck`
Expected: FAIL — references to `supportingPremiseIds` throughout codebase. Note all errors for the next task.

**Step 4: Commit (schema change only, rest follows)**

```
git add src/lib/schemata/argument.ts src/lib/types/evaluation.ts
git commit -m "Simplify TCoreArgumentRoleState to conclusion-only (supporting is now derived)"
```

---

### Task 4: Update ArgumentEngine for Derived Supporting Premises

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Rewrite ArgumentEngine role management**

In `src/lib/core/ArgumentEngine.ts`:

1. **Remove** the `supportingPremiseIds: Set<string>` field (around constructor area).

2. **Remove** methods:
    - `addSupportingPremise()` (lines 164-174)
    - `removeSupportingPremise()` (lines 177-179)

3. **Update** `removePremise()` (lines 87-93): Remove the line that deletes from `supportingPremiseIds`:

    ```typescript
    public removePremise(premiseId: string): void {
        this.premises.delete(premiseId)
        if (this.conclusionPremiseId === premiseId) {
            this.conclusionPremiseId = undefined
        }
    }
    ```

4. **Update** `setConclusionPremise()` (lines 133-143): Remove the check for supporting overlap:

    ```typescript
    public setConclusionPremise(premiseId: string): void {
        const premise = this.premises.get(premiseId)
        if (!premise) throw new Error(`Premise "${premiseId}" does not exist.`)
        this.conclusionPremiseId = premiseId
    }
    ```

5. **Update** `getRoleState()` (lines 120-125):

    ```typescript
    public getRoleState(): TCoreArgumentRoleState {
        return {
            ...(this.conclusionPremiseId !== undefined
                ? { conclusionPremiseId: this.conclusionPremiseId }
                : {}),
        }
    }
    ```

6. **Update** `listSupportingPremises()` (lines 182-186) to derive from premise type:

    ```typescript
    public listSupportingPremises(): PremiseManager[] {
        return this.listPremises().filter(
            (pm) =>
                pm.isInference() && pm.getId() !== this.conclusionPremiseId
        )
    }
    ```

7. **Update** premise classification in `evaluate()` (around lines 427-434). Replace the explicit supportingPremiseIds lookup with the derived list:

    ```typescript
    const conclusionPm = this.getConclusionPremise()!
    const supportingPms = this.listSupportingPremises()
    const supportingIds = new Set(supportingPms.map((pm) => pm.getId()))
    const constraintPms = this.listPremises().filter(
        (pm) =>
            pm.getId() !== this.conclusionPremiseId &&
            !supportingIds.has(pm.getId()) &&
            pm.isConstraint()
    )
    ```

    Apply the same pattern in `checkValidity()` (around lines 575-582).

8. **Update** `validateEvaluability()`: Remove the check for `ARGUMENT_SUPPORTING_PREMISE_NOT_FOUND` (this was checking if IDs in supportingPremiseIds actually exist — no longer needed since the list is derived). Remove `ARGUMENT_ROLE_OVERLAP` check (no longer possible).

**Step 2: Update tests for role simplification**

In `test/ExpressionManager.test.ts`, update the "ArgumentEngine — roles and evaluation" describe block (lines 1700-1839):

- Replace `eng.addSupportingPremise(id)` calls → remove them (supporting is now automatic for inference premises)
- Update `getRoleState()` assertions to not include `supportingPremiseIds`
- The test "supports role APIs and removes roles when a premise is deleted" (lines 1732-1749) needs significant rewrite since addSupportingPremise is gone

Also update any diff tests (around lines 2576-2595) that reference `addSupportingPremise`/`removeSupportingPremise`.

**Step 3: Run tests**

Run: `pnpm run test`
Expected: PASS — all tests updated

**Step 4: Run full checks**

Run: `pnpm run check`
Expected: PASS

**Step 5: Commit**

```
git add src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Derive supporting premises from expression type, remove explicit support-role methods"
```

---

### Task 5: Update CLI for Role Simplification

**Files:**

- Modify: `src/cli/commands/roles.ts`
- Modify: `src/cli/storage/roles.ts`
- Modify: `src/cli/engine.ts`

**Step 1: Remove CLI support-role commands**

In `src/cli/commands/roles.ts`:

- Remove the `roles add-support` command (lines 81-102)
- Remove the `roles remove-support` command (lines 104-117)
- Update `roles show` (lines 19-44) to derive supporting premises instead of reading from stored state. The show command should hydrate the engine and call `engine.listSupportingPremises()` to display derived supporting premises.

**Step 2: Simplify roles storage**

In `src/cli/storage/roles.ts`:

- The `readRoles()` function reads `CoreArgumentRoleStateSchema` which now only has `conclusionPremiseId`. No code change needed since the schema changed — but verify it handles old files that may still have `supportingPremiseIds` (Typebox with `additionalProperties: false` would strip it; check the schema config).

**Step 3: Update engine hydration**

In `src/cli/engine.ts` (lines 92-97):

- Remove the loop that calls `engine.addSupportingPremise(id)` for each supporting premise ID
- Keep the `setConclusionPremise` call

```typescript
// Before:
if (roles.conclusionPremiseId) {
    engine.setConclusionPremise(roles.conclusionPremiseId)
}
for (const id of roles.supportingPremiseIds) {
    engine.addSupportingPremise(id)
}

// After:
if (roles.conclusionPremiseId) {
    engine.setConclusionPremise(roles.conclusionPremiseId)
}
```

**Step 4: Run checks**

Run: `pnpm run check`
Expected: PASS

**Step 5: Commit**

```
git add src/cli/commands/roles.ts src/cli/storage/roles.ts src/cli/engine.ts
git commit -m "Remove CLI support-role commands, simplify role storage and hydration"
```

---

## Phase 3: Mutation Result Wrapping

### Task 6: Add Change Tracking to ExpressionManager

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

This task makes ExpressionManager aware of the ChangeCollector without changing any public API signatures yet. The collector is optional — when absent, behavior is unchanged.

**Step 1: Add collector support to ExpressionManager**

Add to `ExpressionManager`:

```typescript
import { ChangeCollector } from "./ChangeCollector.js"

// Add as private field
private collector: ChangeCollector | null = null

// Add accessor
setCollector(collector: ChangeCollector | null): void {
    this.collector = collector
}
```

**Step 2: Record changes in addExpression**

After line 122 (`this.expressions.set(expression.id, expression)`), add:

```typescript
this.collector?.addedExpression(expression)
```

**Step 3: Record changes in removeExpression**

In the removal loop (lines 232-249), after each `this.expressions.delete(id)`:

```typescript
this.collector?.removedExpression(expression)
```

**Step 4: Record changes in collapseIfNeeded**

In the zero-children formula case (lines 266-274), after deleting the operator:

```typescript
this.collector?.removedExpression(operator)
```

In the zero-children operator case (lines 288-296):

```typescript
this.collector?.removedExpression(operator)
```

In the one-child operator case (lines 299-332), after promoting the child:

```typescript
this.collector?.modifiedExpression(promoted) // child got new parentId/position
this.collector?.removedExpression(operator)
```

**Step 5: Record changes in reparent**

After line 452 (`this.expressions.set(expressionId, updated)`):

```typescript
this.collector?.modifiedExpression(updated)
```

**Step 6: Record changes in insertExpression**

After line 616 (`this.expressions.set(expression.id, stored)`):

```typescript
this.collector?.addedExpression(stored)
```

**Step 7: Run tests**

Run: `pnpm run test`
Expected: PASS — no API changes, collector is null by default so no behavior change

**Step 8: Commit**

```
git add src/lib/core/ExpressionManager.ts
git commit -m "Add optional ChangeCollector recording to ExpressionManager internals"
```

---

### Task 7: Wrap PremiseManager Expression Methods with TCoreMutationResult

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests for changeset behavior**

Add a new describe block at the bottom of the test file:

```typescript
describe("PremiseManager — mutation changesets", () => {
    it("addExpression returns the added expression in result and changes", () => {
        // Setup: create engine, premise, variable, expression
        // Call addExpression
        // Assert: result is the added expression
        // Assert: changes.expressions.added contains the expression
        // Assert: changes.expressions.modified and removed are empty
    })

    it("removeExpression returns removed expression and collapse side effects", () => {
        // Setup: create an operator with two children
        // Remove one child
        // Assert: result is the removed child
        // Assert: changes.expressions.removed contains the child AND the collapsed operator
        // Assert: changes.expressions.modified contains the surviving child (reparented)
    })

    it("insertExpression returns added expression and reparented children", () => {
        // Setup: create expressions
        // Insert new operator between them
        // Assert: result is the new operator
        // Assert: changes.expressions.added contains the operator
        // Assert: changes.expressions.modified contains reparented children
    })

    it("appendExpression returns the expression with computed position", () => {
        // Setup: create premise with existing children
        // Append new child
        // Assert: result has a computed position
        // Assert: changes.expressions.added contains it
    })

    it("addExpressionRelative returns the expression with relative position", () => {
        // Similar to appendExpression but with sibling reference
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — PremiseManager methods still return void/expression

**Step 3: Update PremiseManager expression methods**

For each of `addExpression`, `appendExpression`, `addExpressionRelative`, `removeExpression`, `insertExpression`:

1. Import `ChangeCollector` and `TCoreMutationResult`
2. Change return type to `TCoreMutationResult<T>`
3. Create collector, set it on ExpressionManager, run operation, return result + changeset

Example for `addExpression()`:

```typescript
public addExpression(
    expression: TCorePropositionalExpression
): TCoreMutationResult<TCorePropositionalExpression> {
    const collector = new ChangeCollector()
    this.expressions.setCollector(collector)
    try {
        // ... existing validation logic ...
        this.expressions.addExpression(expression)
        // ... existing post-delegation logic ...
        return { result: expression, changes: collector.toChangeset() }
    } finally {
        this.expressions.setCollector(null)
    }
}
```

Example for `removeExpression()`:

```typescript
public removeExpression(
    expressionId: string
): TCoreMutationResult<TCorePropositionalExpression | undefined> {
    const collector = new ChangeCollector()
    this.expressions.setCollector(collector)
    try {
        const snapshot = this.expressions.getExpression(expressionId)
        if (!snapshot) return { result: undefined, changes: collector.toChangeset() }
        // ... existing subtree collection and removal ...
        this.expressions.removeExpression(expressionId)
        // ... existing cleanup ...
        return { result: snapshot, changes: collector.toChangeset() }
    } finally {
        this.expressions.setCollector(null)
    }
}
```

**Step 4: Update existing tests**

Many existing tests call `pm.removeExpression(id)` and check the return value directly. Update these to destructure:

```typescript
// Before:
const removed = pm.removeExpression(id)
expect(removed).toBeDefined()

// After:
const { result: removed } = pm.removeExpression(id)
expect(removed).toBeDefined()
```

For methods that previously returned void (`addExpression`, `appendExpression`, etc.), existing tests that ignore the return value don't need changes.

**Step 5: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 6: Commit**

```
git add src/lib/core/PremiseManager.ts test/ExpressionManager.test.ts
git commit -m "Wrap PremiseManager expression methods with TCoreMutationResult"
```

---

### Task 8: Wrap PremiseManager Variable and Extras Methods

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests for variable changeset behavior**

```typescript
it("addVariable returns the variable in result and changes", () => {
    // Assert result is the added variable
    // Assert changes.variables.added contains it
})

it("removeVariable returns removed variable in result and changes", () => {
    // Assert result is the removed variable
    // Assert changes.variables.removed contains it
})

it("setExtras returns the new extras in result", () => {
    // Assert result is the new extras object
    // Assert changes is empty (extras is metadata on the premise, not a tracked entity)
    // OR: assert changes.premises.modified contains the premise?
    // Decision: setExtras doesn't produce entity-level changes — it modifies premise metadata.
    // The caller already knows what they set. changes should be empty.
})
```

**Step 2: Implement**

`addVariable()`:

```typescript
public addVariable(
    variable: TCorePropositionalVariable
): TCoreMutationResult<TCorePropositionalVariable> {
    this.assertBelongsToArgument(variable)
    this.variables.addVariable(variable)
    const collector = new ChangeCollector()
    collector.addedVariable(variable)
    return { result: variable, changes: collector.toChangeset() }
}
```

`removeVariable()`:

```typescript
public removeVariable(
    variableId: string
): TCoreMutationResult<TCorePropositionalVariable | undefined> {
    // ... existing guard for referenced variables ...
    const removed = this.variables.removeVariable(variableId)
    const collector = new ChangeCollector()
    if (removed) collector.removedVariable(removed)
    return { result: removed, changes: collector.toChangeset() }
}
```

`setExtras()`:

```typescript
public setExtras(
    extras: Record<string, unknown>
): TCoreMutationResult<Record<string, unknown>> {
    this.extras = { ...extras }
    return { result: this.extras, changes: {} }
}
```

**Step 3: Update existing tests that check removeVariable return value**

**Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 5: Commit**

```
git add src/lib/core/PremiseManager.ts test/ExpressionManager.test.ts
git commit -m "Wrap PremiseManager variable and extras methods with TCoreMutationResult"
```

---

### Task 9: Wrap ArgumentEngine Mutating Methods

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests for ArgumentEngine changesets**

```typescript
describe("ArgumentEngine — mutation changesets", () => {
    it("createPremise returns PremiseManager and premise in changes", () => {
        // Assert result is a PremiseManager
        // Assert changes.premises.added has one entry with matching ID
    })

    it("createPremiseWithId returns PremiseManager and premise in changes", () => {
        // Same, but with caller-supplied ID
    })

    it("removePremise returns premise data and records removal", () => {
        // Assert result is the serialized premise (toData())
        // Assert changes.premises.removed has one entry
        // Assert changes.roles present if conclusion was cleared
    })

    it("removePremise that was conclusion also changes roles", () => {
        // Set conclusion, then remove that premise
        // Assert changes.roles is the new (empty) role state
    })

    it("setConclusionPremise returns new role state", () => {
        // Assert result is the new TCoreArgumentRoleState
        // Assert changes.roles matches
    })

    it("clearConclusionPremise returns new role state", () => {
        // Assert result is the new (empty) TCoreArgumentRoleState
        // Assert changes.roles matches
    })
})
```

**Step 2: Implement**

`createPremise()`:

```typescript
public createPremise(
    extras?: Record<string, unknown>
): TCoreMutationResult<PremiseManager> {
    const id = crypto.randomUUID()
    return this.createPremiseWithId(id, extras)
}
```

`createPremiseWithId()`:

```typescript
public createPremiseWithId(
    id: string,
    extras?: Record<string, unknown>
): TCoreMutationResult<PremiseManager> {
    if (this.premises.has(id))
        throw new Error(`Premise "${id}" already exists.`)
    const pm = new PremiseManager(id, this.argument, extras)
    this.premises.set(id, pm)
    const collector = new ChangeCollector()
    collector.addedPremise(pm.toData())
    return { result: pm, changes: collector.toChangeset() }
}
```

`removePremise()`:

```typescript
public removePremise(premiseId: string): TCoreMutationResult<TCorePremise | undefined> {
    const pm = this.premises.get(premiseId)
    if (!pm) return { result: undefined, changes: {} }
    const data = pm.toData()
    this.premises.delete(premiseId)
    const collector = new ChangeCollector()
    collector.removedPremise(data)
    if (this.conclusionPremiseId === premiseId) {
        this.conclusionPremiseId = undefined
        collector.setRoles(this.getRoleState())
    }
    return { result: data, changes: collector.toChangeset() }
}
```

`setConclusionPremise()`:

```typescript
public setConclusionPremise(
    premiseId: string
): TCoreMutationResult<TCoreArgumentRoleState> {
    const premise = this.premises.get(premiseId)
    if (!premise) throw new Error(`Premise "${premiseId}" does not exist.`)
    this.conclusionPremiseId = premiseId
    const roles = this.getRoleState()
    const collector = new ChangeCollector()
    collector.setRoles(roles)
    return { result: roles, changes: collector.toChangeset() }
}
```

`clearConclusionPremise()`:

```typescript
public clearConclusionPremise(): TCoreMutationResult<TCoreArgumentRoleState> {
    this.conclusionPremiseId = undefined
    const roles = this.getRoleState()
    const collector = new ChangeCollector()
    collector.setRoles(roles)
    return { result: roles, changes: collector.toChangeset() }
}
```

**Step 3: Update existing tests**

Update all test calls that use return values from these methods. Most `createPremise` calls are used directly — destructure to `{ result: pm }`.

**Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 5: Commit**

```
git add src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Wrap ArgumentEngine mutating methods with TCoreMutationResult"
```

---

## Phase 4: Checksum System

### Task 10: Implement Hash Function and Deterministic Serialization

**Files:**

- Create: `src/lib/core/checksum.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests**

```typescript
describe("checksum utilities", () => {
    it("produces consistent hash for same input", () => {
        const hash1 = computeHash("hello")
        const hash2 = computeHash("hello")
        expect(hash1).toBe(hash2)
    })

    it("produces different hash for different input", () => {
        expect(computeHash("a")).not.toBe(computeHash("b"))
    })

    it("canonicalSerialize sorts object keys", () => {
        const a = canonicalSerialize({ b: 2, a: 1 })
        const b = canonicalSerialize({ a: 1, b: 2 })
        expect(a).toBe(b)
    })

    it("canonicalSerialize handles nested objects", () => {
        const a = canonicalSerialize({ z: { b: 2, a: 1 }, a: 0 })
        const b = canonicalSerialize({ a: 0, z: { a: 1, b: 2 } })
        expect(a).toBe(b)
    })

    it("entityChecksum uses only specified fields", () => {
        const entity = { id: "1", symbol: "P", extra: "ignored" }
        const cs1 = entityChecksum(entity, ["id", "symbol"])
        const cs2 = entityChecksum(
            { id: "1", symbol: "P", extra: "different" },
            ["id", "symbol"]
        )
        expect(cs1).toBe(cs2)
    })

    it("entityChecksum differs when included fields differ", () => {
        const cs1 = entityChecksum({ id: "1", symbol: "P" }, ["id", "symbol"])
        const cs2 = entityChecksum({ id: "1", symbol: "Q" }, ["id", "symbol"])
        expect(cs1).not.toBe(cs2)
    })
})
```

**Step 2: Implement**

Create `src/lib/core/checksum.ts`:

```typescript
/**
 * FNV-1a 32-bit hash. Fast, non-cryptographic, browser-compatible.
 */
export function computeHash(input: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Deterministic JSON serialization with sorted keys.
 */
export function canonicalSerialize(value: unknown): string {
    return JSON.stringify(value, (_, v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            return Object.keys(v)
                .sort()
                .reduce<Record<string, unknown>>((sorted, key) => {
                    sorted[key] = (v as Record<string, unknown>)[key]
                    return sorted
                }, {})
        }
        return v
    })
}

/**
 * Compute checksum for an entity using only the specified fields.
 */
export function entityChecksum<T extends Record<string, unknown>>(
    entity: T,
    fields: string[]
): string {
    const picked: Record<string, unknown> = {}
    for (const field of fields.sort()) {
        if (field in entity) {
            picked[field] = entity[field]
        }
    }
    return computeHash(canonicalSerialize(picked))
}
```

**Step 3: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 4: Commit**

```
git add src/lib/core/checksum.ts test/ExpressionManager.test.ts
git commit -m "Add hash function, deterministic serialization, and entityChecksum utility"
```

---

### Task 11: Add Checksum Config and Engine/Premise Checksum Methods

**Files:**

- Create: `src/lib/types/checksum.ts`
- Modify: `src/lib/core/PremiseManager.ts`
- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Define config type**

Create `src/lib/types/checksum.ts`:

```typescript
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"

export interface TCoreChecksumConfig {
    expressionFields?: (keyof TCorePropositionalExpression)[]
    variableFields?: (keyof TCorePropositionalVariable)[]
    premiseFields?: string[]
    argumentFields?: (keyof TCoreArgument)[]
    roleFields?: (keyof TCoreArgumentRoleState)[]
}

export const DEFAULT_EXPRESSION_CHECKSUM_FIELDS: (keyof TCorePropositionalExpression)[] =
    [
        "id",
        "type",
        "parentId",
        "position",
        "argumentId",
        "argumentVersion",
        // "variableId" and "operator" are type-specific — handled by entityChecksum picking only fields that exist
    ]

export const DEFAULT_VARIABLE_CHECKSUM_FIELDS: (keyof TCorePropositionalVariable)[] =
    ["id", "symbol", "argumentId", "argumentVersion"]
```

Note: The exact default fields for each entity type need to be determined by reading the schema. The key point is that `variableId` (on variable expressions) and `operator` (on operator expressions) should also be included — `entityChecksum` picks only fields that exist on the object, so listing them is safe.

**Step 2: Write tests**

```typescript
describe("PremiseManager — checksum", () => {
    it("returns a consistent checksum for the same state", () => {
        // Build identical premises in two different engines
        // Assert checksums match
    })

    it("checksum changes when an expression is added", () => {
        const before = pm.checksum()
        pm.addExpression(...)
        const after = pm.checksum()
        expect(before).not.toBe(after)
    })

    it("checksum is identical for same content built in same order", () => {
        // Two premises built identically
        // Assert checksums match
    })
})

describe("ArgumentEngine — checksum", () => {
    it("returns a consistent checksum for the same state", () => { ... })
    it("checksum changes when a premise is added", () => { ... })
    it("checksum changes when conclusion is set", () => { ... })
})
```

**Step 3: Implement lazy checksum on PremiseManager**

Add to PremiseManager:

```typescript
private checksumDirty = true
private cachedChecksum: string | undefined

public checksum(): string {
    if (this.checksumDirty || this.cachedChecksum === undefined) {
        this.cachedChecksum = this.computeChecksum()
        this.checksumDirty = false
    }
    return this.cachedChecksum
}

private computeChecksum(): string {
    const config = this.checksumConfig
    const parts: string[] = []

    // Premise metadata checksum
    parts.push(entityChecksum(
        { id: this.id, rootExpressionId: this.rootExpressionId },
        config?.premiseFields ?? ["id", "rootExpressionId"]
    ))

    // Variable checksums (sorted by ID for determinism)
    for (const v of this.getVariables()) {
        parts.push(entityChecksum(v, config?.variableFields ?? DEFAULT_VARIABLE_CHECKSUM_FIELDS))
    }

    // Expression checksums (sorted by ID for determinism)
    for (const e of this.getExpressions()) {
        parts.push(entityChecksum(e, config?.expressionFields ?? DEFAULT_EXPRESSION_CHECKSUM_FIELDS))
    }

    return computeHash(parts.join(":"))
}

private markDirty(): void {
    this.checksumDirty = true
}
```

Call `this.markDirty()` at the end of every mutating method.

**Step 4: Implement lazy checksum on ArgumentEngine**

```typescript
private checksumDirty = true
private cachedChecksum: string | undefined

public checksum(): string {
    if (this.checksumDirty || this.cachedChecksum === undefined) {
        this.cachedChecksum = this.computeChecksum()
        this.checksumDirty = false
    }
    return this.cachedChecksum
}

private computeChecksum(): string {
    const parts: string[] = []

    // Argument metadata checksum
    parts.push(entityChecksum(
        this.argument,
        this.checksumConfig?.argumentFields ?? ["id", "version"]
    ))

    // Role state checksum
    parts.push(entityChecksum(
        this.getRoleState(),
        this.checksumConfig?.roleFields ?? ["conclusionPremiseId"]
    ))

    // Premise checksums (sorted by ID for determinism)
    for (const pm of this.listPremises()) {
        parts.push(pm.checksum())
    }

    return computeHash(parts.join(":"))
}

private markDirty(): void {
    this.checksumDirty = true
}
```

Call `this.markDirty()` at the end of every mutating method.

**Step 5: Accept config in constructors**

Add optional `checksumConfig` parameter to both `ArgumentEngine` and `PremiseManager` constructors. `ArgumentEngine` passes its config down when creating `PremiseManager` instances.

```typescript
// ArgumentEngine constructor
constructor(argument: TCoreArgument, options?: { checksumConfig?: TCoreChecksumConfig })

// PremiseManager constructor
constructor(id: string, argument: TCoreArgument, extras?: Record<string, unknown>,
            checksumConfig?: TCoreChecksumConfig)
```

**Step 6: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 7: Commit**

```
git add src/lib/types/checksum.ts src/lib/core/checksum.ts src/lib/core/PremiseManager.ts src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Add lazy hierarchical checksum system with configurable fields"
```

---

### Task 12: Add Checksum Field to Entity Types

**Files:**

- Modify: `src/lib/schemata/propositional.ts`
- Modify: `src/lib/schemata/argument.ts`
- Modify: `src/lib/core/PremiseManager.ts` (populate checksum on returned entities)
- Modify: `src/lib/core/ArgumentEngine.ts` (populate checksum on returned entities)
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Add optional checksum field to schemas**

In `src/lib/schemata/propositional.ts`, add to `BasePropositionalExpressionSchema`:

```typescript
checksum: Type.Optional(Type.String({ description: "Entity-level checksum for sync detection." })),
```

Add to `CorePropositionalVariableSchema`:

```typescript
checksum: Type.Optional(Type.String({ description: "Entity-level checksum for sync detection." })),
```

Add to `CorePremiseSchema`:

```typescript
checksum: Type.Optional(Type.String({ description: "Premise-level checksum for sync detection." })),
```

In `src/lib/schemata/argument.ts`, add to `CoreArgumentSchema`:

```typescript
checksum: Type.Optional(Type.String({ description: "Argument-level checksum for sync detection." })),
```

**Step 2: Populate checksums in getters and changesets**

In `PremiseManager.toData()` and `PremiseManager.getExpressions()`, compute and attach entity checksums.

In `ArgumentEngine.toData()`, attach the argument-level checksum.

In the changeset entities (within the ChangeCollector flow), attach checksums to each entity in `added`/`modified`/`removed`.

**Step 3: Write tests**

```typescript
it("entities returned by getExpressions include checksum", () => {
    // Build a premise with expressions
    const exprs = pm.getExpressions()
    for (const e of exprs) {
        expect(e.checksum).toBeDefined()
        expect(typeof e.checksum).toBe("string")
    }
})

it("changeset entities include checksums", () => {
    const { changes } = pm.addExpression(...)
    expect(changes.expressions?.added[0].checksum).toBeDefined()
})
```

**Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 5: Commit**

```
git add src/lib/schemata/propositional.ts src/lib/schemata/argument.ts src/lib/core/PremiseManager.ts src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Add optional checksum field to entity types, populate in getters and changesets"
```

---

## Phase 5: Polish

### Task 13: Determinism Audit

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts` (if needed)
- Modify: `src/lib/core/PremiseManager.ts` (if needed)
- Modify: `src/lib/core/ArgumentEngine.ts` (if needed)

**Step 1: Audit all methods that return arrays derived from Maps**

Search for patterns like `Array.from(map.values())`, `[...map.values()]`, `[...set]` in all three core files. Ensure every such array is explicitly sorted before being returned or used in output.

Key methods to check:

- `ExpressionManager.toArray()` — returns `Array.from(this.expressions.values())`
- `ExpressionManager.getChildExpressions()` — already sorts by position
- `PremiseManager.getVariables()` — calls `this.variables.toArray()`, sorts by ID
- `PremiseManager.getExpressions()` — calls `this.expressions.toArray()`, sorts by ID
- `ArgumentEngine.listPremiseIds()` — already sorts
- `ArgumentEngine.listPremises()` — already sorts
- `ArgumentEngine.listSupportingPremises()` — filters sorted list, should be fine

**Step 2: Add explicit sorts where missing**

For any array derived from Map/Set that's returned or used in checksum computation, add `.sort()` with appropriate comparator.

**Step 3: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 4: Commit**

```
git add -u
git commit -m "Enforce explicit sort on all Map/Set-derived arrays for determinism"
```

---

### Task 14: Update Exports

**Files:**

- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Export new types**

Ensure these are exported:

- `TCoreEntityChanges`, `TCoreChangeset`, `TCoreMutationResult` (from `types/mutation.ts`)
- `TCoreChecksumConfig` (from `types/checksum.ts`)
- `computeHash`, `canonicalSerialize`, `entityChecksum` (from `core/checksum.ts` — useful for consumers computing custom checksums)

Check that removed type `TCorePremiseRole` is no longer exported.

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 3: Run full checks**

Run: `pnpm run check`
Expected: PASS

**Step 4: Commit**

```
git add src/lib/index.ts src/index.ts
git commit -m "Export new mutation, checksum types and utilities"
```

---

### Task 15: Update CLI for New Return Types

**Files:**

- Modify: `src/cli/commands/variables.ts`
- Modify: `src/cli/commands/premises.ts`
- Modify: `src/cli/commands/expressions.ts`
- Modify: `src/cli/commands/roles.ts`
- Modify: `src/cli/commands/analysis.ts`
- Modify: `src/cli/engine.ts`

**Step 1: Update CLI command handlers**

CLI commands that call mutating engine/premise methods need to destructure the new return type. For example:

```typescript
// Before:
const pm = engine.createPremise()

// After:
const { result: pm } = engine.createPremise()
```

Go through each CLI command file and update all calls to mutating methods.

**Step 2: Update engine persistence**

In `src/cli/engine.ts`, `persistEngine()` and `hydrateEngine()` may need adjustments for the new return types from `setConclusionPremise()`, `createPremiseWithId()`, `addExpression()`, etc.

**Step 3: Run CLI smoke test**

Run: `pnpm cli -- --help`
Expected: Help output displays correctly

Run: `pnpm run check`
Expected: PASS

**Step 4: Commit**

```
git add src/cli/
git commit -m "Update CLI commands for TCoreMutationResult return types"
```

---

### Task 16: Update Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md` (if it exists and documents the API)
- Modify: CLI examples documentation (if it exists)

**Step 1: Update CLAUDE.md**

Update these sections:

- **Class hierarchy**: Note that supporting premises are derived
- **Key design decisions**: Add sections on mutation changesets and checksums
- **Types**: Add TCoreMutationResult, TCoreChangeset, TCoreEntityChanges, TCoreChecksumConfig
- **CLI routing**: Remove references to `add-support`/`remove-support`
- **CLI state storage layout**: Update `roles.json` description (no more supportingPremiseIds)
- **Architecture section**: Note ChangeCollector as internal class
- **Testing section**: Note new describe blocks

**Step 2: Update README if needed**

If README documents the public API, update method signatures and add examples for mutation results and checksums.

**Step 3: Update CLI examples if present**

Remove examples for `roles add-support` and `roles remove-support`. Add note about derived supporting premises.

**Step 4: Run checks**

Run: `pnpm run check`
Expected: PASS

**Step 5: Commit**

```
git add CLAUDE.md README.md
git commit -m "Update documentation for API redesign"
```
