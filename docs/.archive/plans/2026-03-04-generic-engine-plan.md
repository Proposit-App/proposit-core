# Generic ArgumentEngine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ArgumentEngine, PremiseManager, ExpressionManager, and VariableManager generic so extended entity types flow through all operations with extra fields preserved.

**Architecture:** Each class gets type parameters with defaults (backward-compatible). Internal storage uses `TOptionalChecksum<T>` where checksums aren't yet attached. `as T` assertions are used at ~15 reconstruction points where TypeScript can't prove spread + override equals the generic type. `ChangeCollector`, `TCoreChangeset`, `TCoreMutationResult`, and diff types all become generic.

**Tech Stack:** TypeScript generics, Vitest

---

### Task 1: Revert working tree to clean state

The user has partial/broken changes in the working tree. Start fresh from HEAD.

**Files:**

- Revert: `src/lib/core/ArgumentEngine.ts`
- Revert: `src/lib/core/ExpressionManager.ts`
- Revert: `src/lib/core/PremiseManager.ts`
- Revert: `src/lib/core/VariableManager.ts`
- Revert: `src/lib/schemata/shared.ts`
- Revert: `src/lib/types/mutation.ts`

**Step 1: Revert all unstaged changes**

Run: `git checkout -- src/lib/core/ArgumentEngine.ts src/lib/core/ExpressionManager.ts src/lib/core/PremiseManager.ts src/lib/core/VariableManager.ts src/lib/schemata/shared.ts src/lib/types/mutation.ts`

**Step 2: Verify clean state**

Run: `pnpm run typecheck`
Expected: PASS (no errors)

---

### Task 2: Add TOptionalChecksum utility type

**Files:**

- Modify: `src/lib/schemata/shared.ts`
- Modify: `src/lib/schemata/index.ts` (if not already re-exported)

**Step 1: Add the type to shared.ts**

Add at the end of `src/lib/schemata/shared.ts`:

```typescript
export type TOptionalChecksum<T extends { checksum?: unknown }> = Omit<
    T,
    "checksum"
> &
    Partial<Pick<T, "checksum">>
```

**Step 2: Verify re-export**

Check `src/lib/schemata/index.ts` re-exports `TOptionalChecksum`. If not, add it.

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/schemata/shared.ts src/lib/schemata/index.ts
git commit -m "Add TOptionalChecksum utility type"
```

---

### Task 3: Make VariableManager generic

**Files:**

- Modify: `src/lib/core/VariableManager.ts`

**Step 1: Write a failing test**

Add a new `describe` block at the end of `test/ExpressionManager.test.ts`:

```typescript
describe("VariableManager — generic type parameter", () => {
    it("accepts and returns an extended variable type", () => {
        type ExtendedVar = TCorePropositionalVariable & { color: string }
        const vm = new VariableManager<ExtendedVar>()
        const v: ExtendedVar = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "abc",
            color: "red",
        }
        vm.addVariable(v)
        const retrieved = vm.getVariable("v1")!
        expect(retrieved.color).toBe("red")
        expect(retrieved.symbol).toBe("P")

        // toArray preserves extended type
        const all = vm.toArray()
        expect(all[0].color).toBe("red")

        // updateVariable preserves extended fields
        const updated = vm.updateVariable("v1", { symbol: "Q" })!
        expect(updated.color).toBe("red")
        expect(updated.symbol).toBe("Q")

        // removeVariable returns extended type
        const removed = vm.removeVariable("v1")!
        expect(removed.color).toBe("red")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "VariableManager — generic type parameter"`
Expected: FAIL — `VariableManager` doesn't accept the generic parameter / `color` property doesn't exist

**Step 3: Implement generic VariableManager**

In `src/lib/core/VariableManager.ts`:

1. Remove the `TVariableInput` type export.
2. Change the class declaration to:
    ```typescript
    export class VariableManager<TVar extends TCorePropositionalVariable = TCorePropositionalVariable> {
    ```
3. Change `private variables: Map<string, TVariableInput>` to `private variables: Map<string, TVar>`
4. Change constructor parameter from `TVariableInput[]` to `TVar[]`
5. Change `toArray()` return type to `TVar[]`
6. Change `addVariable` parameter to `TVar`
7. Change `removeVariable` return type to `TVar | undefined`
8. Change `getVariable` return type to `TVar | undefined`
9. Change `updateVariable` return type to `TVar | undefined`
10. In `renameVariable`, the spread `{ ...variable, symbol: newSymbol }` needs `as TVar`
11. Import `TCorePropositionalVariable` (already imported)

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "VariableManager — generic type parameter"`
Expected: PASS

**Step 5: Fix TVariableInput references**

`TVariableInput` was exported from `VariableManager.ts` and imported in:

- `src/lib/core/ChangeCollector.ts` — will be updated in Task 5
- `src/lib/types/mutation.ts` — will be updated in Task 4
- `test/ExpressionManager.test.ts` — change to use `Omit<TCorePropositionalVariable, "checksum">`

For now, re-export `TVariableInput` as a type alias for backward compatibility:

```typescript
/** @deprecated Use TVar generic parameter or Omit<TCorePropositionalVariable, "checksum"> directly */
export type TVariableInput = Omit<TCorePropositionalVariable, "checksum">
```

**Step 6: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/core/VariableManager.ts test/ExpressionManager.test.ts
git commit -m "Make VariableManager generic over TVar"
```

---

### Task 4: Make mutation types generic

**Files:**

- Modify: `src/lib/types/mutation.ts`

**Step 1: Write a failing test**

Add to `test/ExpressionManager.test.ts`:

```typescript
describe("mutation types — generic changesets", () => {
    it("TCoreChangeset accepts extended entity types", () => {
        type ExtVar = TCorePropositionalVariable & { color: string }
        type ExtExpr = TCorePropositionalExpression & { tag: string }

        const changeset: TCoreChangeset<ExtExpr, ExtVar> = {
            variables: {
                added: [
                    {
                        id: "v1",
                        argumentId: "a1",
                        argumentVersion: 0,
                        symbol: "P",
                        checksum: "abc",
                        color: "red",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        expect(changeset.variables!.added[0].color).toBe("red")
    })
})
```

(Import `TCoreChangeset` from `../src/lib/types/mutation` in the test file's imports.)

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "mutation types — generic changesets"`
Expected: FAIL — `TCoreChangeset` doesn't accept type arguments

**Step 3: Make mutation types generic**

In `src/lib/types/mutation.ts`:

1. Remove the `TVariableInput` import (it's being removed).
2. Remove the `TExpressionInput` import.
3. Remove `TCoreRawChangeset` entirely.
4. Make `TCoreChangeset` generic:

```typescript
export interface TCoreChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    roles?: TCoreArgumentRoleState
    argument?: TArg
}
```

5. Make `TCoreMutationResult` generic on changeset types:

```typescript
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

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "mutation types — generic changesets"`
Expected: PASS

**Step 5: Fix downstream imports**

Any file importing `TCoreRawChangeset` needs updating:

- `src/lib/core/PremiseManager.ts` — remove `TCoreRawChangeset` import (will be fixed in Task 7)
- `src/lib/core/ChangeCollector.ts` — will be fixed in Task 5

For now, temporarily re-export `TCoreRawChangeset` as an alias:

```typescript
/** @deprecated Use TCoreChangeset directly */
export type TCoreRawChangeset = TCoreChangeset
```

**Step 6: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/types/mutation.ts test/ExpressionManager.test.ts
git commit -m "Make TCoreChangeset and TCoreMutationResult generic"
```

---

### Task 5: Make ChangeCollector generic

**Files:**

- Modify: `src/lib/core/ChangeCollector.ts`

**Step 1: Implement generic ChangeCollector**

Replace the entire class in `src/lib/core/ChangeCollector.ts`:

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

    toChangeset(): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        const cs: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
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

**Step 2: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS (existing tests use `ChangeCollector` without type args, which defaults to base types)

**Step 3: Commit**

```bash
git add src/lib/core/ChangeCollector.ts
git commit -m "Make ChangeCollector generic"
```

---

### Task 6: Make ExpressionManager generic (TExpr only)

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

**Step 1: Write a failing test**

Add to `test/ExpressionManager.test.ts`:

```typescript
describe("ExpressionManager — generic type parameter", () => {
    it("stores and returns extended expression types", () => {
        type ExtExpr = TCorePropositionalExpression & { tag: string }
        const {
            ExpressionManager,
        } = require("../src/lib/core/ExpressionManager")
        const em = new ExpressionManager<ExtExpr>()

        const expr: Omit<ExtExpr, "checksum"> = {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            parentId: null,
            position: 1000,
            type: "variable" as const,
            variableId: "v1",
            tag: "custom",
        }
        em.addExpression(expr)

        const retrieved = em.getExpression("e1")!
        expect(retrieved.tag).toBe("custom")

        const all = em.toArray()
        expect(all[0].tag).toBe("custom")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ExpressionManager — generic type parameter"`
Expected: FAIL

**Step 3: Implement generic ExpressionManager**

In `src/lib/core/ExpressionManager.ts`:

1. Make `TExpressionInput` generic:

    ```typescript
    export type TExpressionInput<
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    > = TExpr extends infer U
        ? U extends TCorePropositionalExpression
            ? Omit<U, "checksum">
            : never
        : never
    ```

2. Make `TExpressionWithoutPosition` generic:

    ```typescript
    export type TExpressionWithoutPosition<
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    > = TExpr extends infer U
        ? U extends TCorePropositionalExpression
            ? Omit<U, "position" | "checksum">
            : never
        : never
    ```

3. Change the class declaration to only use `TExpr`:

    ```typescript
    export class ExpressionManager<TExpr extends TCorePropositionalExpression = TCorePropositionalExpression> {
    ```

4. Remove unused imports (`TCoreArgument`, `TCorePremise`, `TCorePropositionalVariable`, `TOptionalChecksum`).

5. Change internal storage: `private expressions: Map<string, TExpressionInput<TExpr>>`

6. Change `collector` type to `ChangeCollector<TExpr> | null` and import generically.

7. Change constructor to accept `TExpressionInput<TExpr>[]`.

8. Change `toArray()` return to `TExpressionInput<TExpr>[]`.

9. Change all method signatures to use `TExpressionInput<TExpr>` instead of `TExpressionInput`:
    - `addExpression(expression: TExpressionInput<TExpr>)`
    - `getExpression(id): TExpressionInput<TExpr> | undefined`
    - `getChildExpressions(parentId): TExpressionInput<TExpr>[]`
    - `removeExpression(id, deleteSubtree): TExpressionInput<TExpr> | undefined`
    - `updateExpression(id, updates): TExpressionInput<TExpr>`
    - `insertExpression(expression: TExpressionInput<TExpr>, ...)`
    - `appendExpression(parentId, expression: TExpressionWithoutPosition<TExpr>)`
    - `addExpressionRelative(siblingId, direction, expression: TExpressionWithoutPosition<TExpr>)`

10. Private methods also change signatures:
    - `removeSubtree`, `removeAndPromote`: parameters and returns use `TExpressionInput<TExpr>`
    - `reparent`: uses `as TExpressionInput<TExpr>` on the spread
    - `collapseIfNeeded`: uses `as TExpressionInput<TExpr>` on the promoted child spread
    - `loadInitialExpressions`: `TExpressionInput<TExpr>[]`

11. All `as TExpressionInput` casts become `as TExpressionInput<TExpr>`.

12. Collector calls: change `this.collector?.addedExpression({ ...expression })` — the spread already preserves extra fields, and the collector is `ChangeCollector<TExpr>`. Since expressions in the map are `TExpressionInput<TExpr>` (without checksum) and the collector expects `TExpr` (with checksum), we need to cast: `this.collector?.addedExpression({ ...expression } as unknown as TExpr)`. Actually — wait. The `ChangeCollector` now expects full `TExpr`. But `ExpressionManager` stores `TExpressionInput<TExpr>` (without checksum). The collector must accept `TExpressionInput<TExpr>` for expressions.

    **Revised approach for collector in ExpressionManager:** The `ChangeCollector` should accept `TExpressionInput<TExpr>` for expression methods since ExpressionManager doesn't have checksums. But PremiseManager will attach checksums to collector entries before returning to callers. So we need the collector's expression type to be `TExpressionInput<TExpr>`.

    Actually, let's simplify: keep the ChangeCollector accepting full entity types, and in ExpressionManager, set the collector to `ChangeCollector<any>` or pass expressions with a placeholder checksum. Better yet: have ExpressionManager's `setCollector` accept `ChangeCollector` without constraining the expression type, and cast when pushing.

    **Simplest approach:** ExpressionManager uses a raw `ChangeCollector` (base types) and PremiseManager's `attachChangesetChecksums` handles the transformation. This matches the current architecture most closely. ExpressionManager doesn't need to know about extended types in its collector — it passes `TExpressionInput` entries that will get checksums attached later.

    Wait, but we're eliminating `TCoreRawChangeset`. Let me reconsider.

    The cleanest approach: `ExpressionManager` continues to use `ChangeCollector` with default types. The collector stores base `TCorePropositionalExpression` entries (the spread of a `TExpressionInput<TExpr>` is assignable to a `TCorePropositionalExpression` when TExpr extends it). Then PremiseManager transforms the changeset, attaching checksums and casting to the right types.

    Actually even simpler: since the ChangeCollector is set by PremiseManager and consumed by PremiseManager, we can just keep it as `ChangeCollector` (default types) within ExpressionManager, and have PremiseManager's `attachChangesetChecksums` do the transformation. This means ExpressionManager's collector methods push expressions without checksums (as before), and PremiseManager transforms them into full types with checksums before returning.

    But wait — we eliminated `TCoreRawChangeset`. That means `ChangeCollector.toChangeset()` now returns `TCoreChangeset` directly. So the collector needs to accept the same types as the changeset.

    **Final resolution:** The ChangeCollector in ExpressionManager operates on base types (`ChangeCollector` with defaults). This works because `TExpressionInput<TExpr>` spreads are structurally compatible with `TCorePropositionalExpression` (missing only checksum, but the collector doesn't validate that). PremiseManager calls `attachChangesetChecksums` which maps over the changeset and attaches checksums, casting to the extended types. The `attachChangesetChecksums` method accepts `TCoreChangeset` (base types) and returns `TCoreChangeset<TExpr, TVar, TPremise, TArg>`.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ExpressionManager — generic type parameter"`
Expected: PASS

**Step 5: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/core/ExpressionManager.ts test/ExpressionManager.test.ts
git commit -m "Make ExpressionManager generic over TExpr"
```

---

### Task 7: Make PremiseManager generic

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`

**Step 1: Write a failing test**

Add to `test/ExpressionManager.test.ts`:

```typescript
describe("PremiseManager — generic type parameters", () => {
    it("preserves extended premise type in toData()", () => {
        type ExtPremise = TCorePremise & { color: string }
        const arg = { id: "a1", version: 0 }
        const vm = new VariableManager()
        const pm = new PremiseManager<
            typeof arg & { checksum: string },
            ExtPremise
        >("p1", arg, vm, { color: "blue" })
        const data = pm.toData()
        expect((data as ExtPremise).color).toBe("blue")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "PremiseManager — generic type parameters"`
Expected: FAIL

**Step 3: Implement generic PremiseManager**

In `src/lib/core/PremiseManager.ts`:

1. Change class declaration:

    ```typescript
    export class PremiseManager<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable
    > {
    ```

2. Change internal types:
    - `private variables: VariableManager<TVar>`
    - `private expressions: ExpressionManager<TExpr>`
    - `private argument: TOptionalChecksum<TArg>`

3. Change constructor:

    ```typescript
    constructor(
        id: string,
        argument: TOptionalChecksum<TArg>,
        variables: VariableManager<TVar>,
        extras?: Record<string, unknown>,
        checksumConfig?: TCoreChecksumConfig
    )
    ```

    - In constructor body, `new ExpressionManager<TExpr>()`

4. Update return types on public methods to use generics:
    - `getExpression(id): TExpr | undefined` — `attachExpressionChecksum` returns `TExpr`
    - `getRootExpression(): TExpr | undefined`
    - `getVariables(): TVar[]`
    - `getExpressions(): TExpr[]`
    - `getChildExpressions(parentId): TExpr[]`
    - `toData(): TPremise` — the spread `{ ...this.extras, id, ... } as TPremise`
    - All mutation methods return `TCoreMutationResult<TExpr, ...>` or `TCoreMutationResult<TPremise, ...>`

5. Update `addExpression` and `insertExpression` parameter types:
    - `addExpression(expression: TExpressionInput<TExpr>): TCoreMutationResult<TExpr>`
    - `insertExpression(expression: TExpressionInput<TExpr>, ...): TCoreMutationResult<TExpr>`
    - `appendExpression(parentId, expression: TExpressionWithoutPosition<TExpr>): TCoreMutationResult<TExpr>`
    - `addExpressionRelative(..., expression: TExpressionWithoutPosition<TExpr>): TCoreMutationResult<TExpr>`

6. Update private helpers:
    - `attachExpressionChecksum(expr: TExpressionInput<TExpr>): TExpr` — `as TExpr` on the return
    - `attachVariableChecksum(v: TOptionalChecksum<TVar>): TVar` — `as TVar` on the return (or remove if not needed, since VariableManager now stores `TVar` directly)
    - `attachChangesetChecksums(changes: TCoreChangeset): TCoreChangeset<TExpr, TVar, TPremise, TArg>` — maps expressions and variables through the attach functions, casts the result
    - `collectSubtree(rootId): TExpressionInput<TExpr>[]`

7. Remove `TCoreRawChangeset` import; change all `collector.toChangeset() as TCoreChangeset` to use `attachChangesetChecksums(collector.toChangeset())` or appropriate casting.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "PremiseManager — generic type parameters"`
Expected: PASS

**Step 5: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/core/PremiseManager.ts test/ExpressionManager.test.ts
git commit -m "Make PremiseManager generic over TArg, TPremise, TExpr, TVar"
```

---

### Task 8: Make ArgumentEngine generic

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`

**Step 1: Write a failing test**

Add to `test/ExpressionManager.test.ts`:

```typescript
describe("ArgumentEngine — generic type parameters", () => {
    it("preserves extended argument type", () => {
        type ExtArg = TCoreArgument & { projectId: string }
        const arg: Omit<ExtArg, "checksum"> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const engine = new ArgumentEngine<ExtArg>(arg)
        const retrieved = engine.getArgument()
        expect(retrieved.projectId).toBe("proj-1")
        expect(typeof retrieved.checksum).toBe("string")
    })

    it("preserves extended variable type through addVariable", () => {
        type ExtVar = TCorePropositionalVariable & { color: string }
        const engine = new ArgumentEngine<
            TCoreArgument,
            TCorePremise,
            TCorePropositionalExpression,
            ExtVar
        >({ id: "a1", version: 0 })
        const { result } = engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            color: "red",
        })
        expect(result.color).toBe("red")
        expect(typeof result.checksum).toBe("string")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ArgumentEngine — generic type parameters"`
Expected: FAIL

**Step 3: Implement generic ArgumentEngine**

In `src/lib/core/ArgumentEngine.ts`:

1. Change class declaration:

    ```typescript
    export class ArgumentEngine<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable
    > {
    ```

2. Change internal types:
    - `private argument: TOptionalChecksum<TArg>`
    - `private premises: Map<string, PremiseManager<TArg, TPremise, TExpr, TVar>>`
    - `private variables: VariableManager<TVar>`

3. Constructor:

    ```typescript
    constructor(
        argument: TOptionalChecksum<TArg>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    )
    ```

    - Body: `this.variables = new VariableManager<TVar>()`

4. Update method signatures:
    - `getArgument(): TArg` — `{ ...this.argument, checksum: this.checksum() } as TArg`
    - `createPremise(extras?): TCoreMutationResult<PremiseManager<TArg, TPremise, TExpr, TVar>>`
    - `createPremiseWithId(id, extras?): TCoreMutationResult<PremiseManager<TArg, TPremise, TExpr, TVar>>`
        - Body: `new PremiseManager<TArg, TPremise, TExpr, TVar>(id, this.argument, this.variables, extras, this.checksumConfig)`
    - `removePremise(id): TCoreMutationResult<TPremise | undefined>`
    - `getPremise(id): PremiseManager<TArg, TPremise, TExpr, TVar> | undefined`
    - `listPremises(): PremiseManager<TArg, TPremise, TExpr, TVar>[]`
    - `addVariable(variable: TOptionalChecksum<TVar>): TCoreMutationResult<TVar>`
        - Attach checksum first, then pass to `this.variables.addVariable(withChecksum)`
    - `updateVariable(id, updates): TCoreMutationResult<TVar | undefined>`
    - `removeVariable(id): TCoreMutationResult<TVar | undefined>`
    - `getVariables(): TVar[]`
    - `getConclusionPremise(): PremiseManager<TArg, TPremise, TExpr, TVar> | undefined`
    - `listSupportingPremises(): PremiseManager<TArg, TPremise, TExpr, TVar>[]`

5. Private helpers:
    - `attachVariableChecksum(v: TOptionalChecksum<TVar>): TVar` — `as TVar`

6. For `addVariable`: attach checksum, then call `this.variables.addVariable(withChecksum)` (VariableManager now stores `TVar` directly).

7. The `ChangeCollector` usages: use default types. Cast `collector.toChangeset()` to the appropriate generic changeset type: `collector.toChangeset() as TCoreChangeset<TExpr, TVar, TPremise, TArg>`.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ArgumentEngine — generic type parameters"`
Expected: PASS

**Step 5: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Make ArgumentEngine generic over TArg, TPremise, TExpr, TVar"
```

---

### Task 9: Make diff types and diffArguments generic

**Files:**

- Modify: `src/lib/types/diff.ts`
- Modify: `src/lib/core/diff.ts`

**Step 1: Write a failing test**

Add to `test/ExpressionManager.test.ts`:

```typescript
describe("diffArguments — generic type parameters", () => {
    it("accepts and returns extended types", () => {
        type ExtArg = TCoreArgument & { projectId: string }
        const argA: Omit<ExtArg, "checksum"> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const argB: Omit<ExtArg, "checksum"> = {
            id: "a1",
            version: 1,
            projectId: "proj-1",
        }
        const engineA = new ArgumentEngine<ExtArg>(argA)
        const engineB = new ArgumentEngine<ExtArg>(argB)

        const diff = diffArguments(engineA, engineB)
        expect(diff.argument.before.projectId).toBe("proj-1")
        expect(diff.argument.after.projectId).toBe("proj-1")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "diffArguments — generic type parameters"`
Expected: FAIL

**Step 3: Make diff types generic**

In `src/lib/types/diff.ts`:

1. Make `TCorePremiseDiff` generic:

    ```typescript
    export interface TCorePremiseDiff<
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    > extends TCoreEntityFieldDiff<TPremise> {
        expressions: TCoreEntitySetDiff<TExpr>
    }
    ```

2. Make `TCorePremiseSetDiff` generic:

    ```typescript
    export interface TCorePremiseSetDiff<
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    > {
        added: TPremise[]
        removed: TPremise[]
        modified: TCorePremiseDiff<TPremise, TExpr>[]
    }
    ```

3. Make `TCoreArgumentDiff` generic:

    ```typescript
    export interface TCoreArgumentDiff<
        TArg extends TCoreArgument = TCoreArgument,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    > {
        argument: TCoreEntityFieldDiff<TArg>
        variables: TCoreEntitySetDiff<TVar>
        premises: TCorePremiseSetDiff<TPremise, TExpr>
        roles: TCoreRoleDiff
    }
    ```

4. Make `TCoreDiffOptions` generic:
    ```typescript
    export interface TCoreDiffOptions<
        TArg extends TCoreArgument = TCoreArgument,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    > {
        compareArgument?: TCoreFieldComparator<TArg>
        compareVariable?: TCoreFieldComparator<TVar>
        comparePremise?: TCoreFieldComparator<TPremise>
        compareExpression?: TCoreFieldComparator<TExpr>
    }
    ```

**Step 4: Make diffArguments generic**

In `src/lib/core/diff.ts`:

1. Make `diffPremiseSet` generic on `TPremise` and `TExpr`.
2. Make `collectVariables` generic on `TArg, TPremise, TExpr, TVar`.
3. Make `diffArguments` generic:

```typescript
export function diffArguments<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable
>(
    engineA: ArgumentEngine<TArg, TPremise, TExpr, TVar>,
    engineB: ArgumentEngine<TArg, TPremise, TExpr, TVar>,
    options?: TCoreDiffOptions<TArg, TVar, TPremise, TExpr>
): TCoreArgumentDiff<TArg, TVar, TPremise, TExpr> {
```

The default comparators (`defaultCompareArgument`, etc.) accept base types. Since extended types extend base types, they're compatible via contravariance. The `options ?? defaultCompare*` pattern still works because comparators are contravariant in their parameter.

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "diffArguments — generic type parameters"`
Expected: PASS

**Step 6: Run full typecheck and tests**

Run: `pnpm run check`
Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/types/diff.ts src/lib/core/diff.ts test/ExpressionManager.test.ts
git commit -m "Make diff types and diffArguments generic"
```

---

### Task 10: Remove deprecated aliases and clean up

**Files:**

- Modify: `src/lib/core/VariableManager.ts` — remove `TVariableInput` re-export
- Modify: `src/lib/types/mutation.ts` — remove `TCoreRawChangeset` alias
- Modify: `test/ExpressionManager.test.ts` — update `TVariableInput` imports
- Modify: `src/index.ts` — ensure generic types are re-exported properly

**Step 1: Remove TVariableInput**

In `src/lib/core/VariableManager.ts`, remove the `TVariableInput` type alias.

In `test/ExpressionManager.test.ts`, replace `import type { TVariableInput } from "../src/lib/core/VariableManager"` with a local type alias:

```typescript
type TVariableInput = Omit<TCorePropositionalVariable, "checksum">
```

**Step 2: Remove TCoreRawChangeset**

In `src/lib/types/mutation.ts`, remove the `TCoreRawChangeset` alias.

Update any remaining imports of `TCoreRawChangeset` (should only be in PremiseManager at this point — remove the import).

**Step 3: Verify exports**

Ensure `src/index.ts` re-exports `TOptionalChecksum` from `shared.ts`. Check that `TExpressionInput` and `TExpressionWithoutPosition` exports still work (they're now generic with defaults, so existing consumers are fine).

**Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "Remove deprecated TVariableInput and TCoreRawChangeset aliases"
```

---

### Task 11: Update documentation

**Files:**

- Modify: `CLAUDE.md` — update type parameter documentation
- Modify: `README.md` — update API reference if it covers class constructors

**Step 1: Update CLAUDE.md**

Update the "Class hierarchy" section to show generic parameters:

```
ArgumentEngine<TArg, TPremise, TExpr, TVar>
  ├─ VariableManager<TVar> (shared, owned by engine)
  └─ PremiseManager<TArg, TPremise, TExpr, TVar> (one per premise)
       └─ ExpressionManager<TExpr> (expression tree)
```

Update the "Types" section to document:

- `TOptionalChecksum<T>` utility type
- Generic parameters on `TCoreChangeset`, `TCoreMutationResult`, diff types
- Removal of `TVariableInput` and `TCoreRawChangeset`

**Step 2: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Update docs for generic engine types"
```

---

### Task 12: Final verification

**Step 1: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build all pass)

**Step 2: Run smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: PASS

**Step 3: Verify backward compatibility**

Confirm that no existing code needed to change its usage of `ArgumentEngine`, `PremiseManager`, etc. — all type parameters have defaults matching the base types.
