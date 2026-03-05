# Configurable Position Range Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the position range configurable via `ArgumentEngine` options so consumers can use ranges that fit their storage backend (e.g., Postgres signed int32).

**Architecture:** Add a `TCorePositionConfig` type holding `min`, `max`, and `initial`. Thread it from `ArgumentEngine` → `PremiseManager` → `ExpressionManager`. Consolidate `ArgumentEngine`'s constructor options into a `TArgumentEngineOptions` type. Update defaults from `[0, MAX_SAFE_INTEGER]` to signed int32 range `[-2147483647, 2147483647]` with initial `0`.

**Tech Stack:** TypeScript, Vitest, Typebox schemas

---

### Task 1: Update position.ts — new defaults, type, and DEFAULT_POSITION_CONFIG

**Files:**

- Modify: `src/lib/utils/position.ts`

**Step 1: Write the failing test**

Add a new describe block at the bottom of `test/ExpressionManager.test.ts`:

```typescript
describe("configurable position range", () => {
    it("DEFAULT_POSITION_CONFIG has signed int32 range", () => {
        expect(DEFAULT_POSITION_CONFIG).toEqual({
            min: -2147483647,
            max: 2147483647,
            initial: 0,
        })
    })

    it("POSITION_MIN is -(2^31-1)", () => {
        expect(POSITION_MIN).toBe(-2147483647)
    })

    it("POSITION_MAX is 2^31-1", () => {
        expect(POSITION_MAX).toBe(2147483647)
    })

    it("POSITION_INITIAL is 0", () => {
        expect(POSITION_INITIAL).toBe(0)
    })
})
```

Also update the import at the top of the test file to include `DEFAULT_POSITION_CONFIG` from `../src/lib/utils/position`.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "configurable position range"`
Expected: FAIL — `DEFAULT_POSITION_CONFIG` does not exist, old constants have wrong values.

**Step 3: Write minimal implementation**

In `src/lib/utils/position.ts`, replace the entire file:

```typescript
export type TCorePositionConfig = {
    min: number
    max: number
    initial: number
}

export const POSITION_MIN = -2147483647
export const POSITION_MAX = 2147483647
export const POSITION_INITIAL = 0

export const DEFAULT_POSITION_CONFIG: TCorePositionConfig = {
    min: POSITION_MIN,
    max: POSITION_MAX,
    initial: POSITION_INITIAL,
}

export function midpoint(a: number, b: number): number {
    return a + (b - a) / 2
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "configurable position range"`
Expected: PASS

**Step 5: Fix the old position utilities tests**

The existing `describe("position utilities")` block has three tests that assert the old values. Update them:

- `"POSITION_INITIAL is midpoint of range"` → change expected to `0` and update description to `"POSITION_INITIAL is 0"`
- `"POSITION_MIN is 0"` → change expected to `-2147483647` and update description to `"POSITION_MIN is -(2^31-1)"`
- `"POSITION_MAX is MAX_SAFE_INTEGER"` → change expected to `2147483647` and update description to `"POSITION_MAX is 2^31-1"`

**Step 6: Run full test suite**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: PASS (all tests). Position changes are backward-compatible since the position value is opaque — tests that use `POSITION_INITIAL` as a constant will still work because they reference the constant, not a hardcoded number. The only tests that hardcode values are the three updated above plus the new ones.

**Step 7: Commit**

```
feat: update position defaults to signed int32 range and add TCorePositionConfig
```

---

### Task 2: Update propositional.ts schema — allow negative positions

**Files:**

- Modify: `src/lib/schemata/propositional.ts`

**Step 1: Write the failing test**

Add to the `"configurable position range"` describe block:

```typescript
it("schema allows negative positions", () => {
    const expr = {
        id: "e1",
        argumentId: "arg-1",
        argumentVersion: 1,
        parentId: null,
        position: -100,
        checksum: "x",
        type: "variable" as const,
        variableId: "v1",
    }
    expect(Value.Check(CorePropositionalExpressionSchema, expr)).toBe(true)
})
```

Also add `CorePropositionalExpressionSchema` to the existing import from `../src/lib/schemata` in the test file (it's already imported via the barrel but verify the exact import — it comes from `../src/lib/schemata`).

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "schema allows negative positions"`
Expected: FAIL — `minimum: 0` rejects `-100`.

**Step 3: Write minimal implementation**

In `src/lib/schemata/propositional.ts`, change the `position` field in `BasePropositionalExpressionSchema`:

```typescript
position: Type.Number({
    description:
        "The ordering of this expression among its siblings under the same parent. Must be unique within (parentId, argumentId, argumentVersion).",
}),
```

Remove the `minimum: 0` option.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "schema allows negative positions"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: allow negative positions in expression schema
```

---

### Task 3: Thread positionConfig through ExpressionManager

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

**Step 1: Write the failing test**

Add to the `"configurable position range"` describe block:

```typescript
it("ExpressionManager uses custom positionConfig in appendExpression", () => {
    const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
    const em = new ExpressionManager([], config)

    em.appendExpression(null, {
        id: "root",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "operator",
        operator: "and",
        parentId: null,
    })
    const root = em.getExpression("root")!
    expect(root.position).toBe(200) // initial

    em.appendExpression("root", {
        id: "c1",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "variable",
        variableId: "v1",
        parentId: "root",
    })
    const c1 = em.getExpression("c1")!
    expect(c1.position).toBe(200) // first child gets initial

    em.appendExpression("root", {
        id: "c2",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "variable",
        variableId: "v2",
        parentId: "root",
    })
    const c2 = em.getExpression("c2")!
    expect(c2.position).toBe(midpoint(200, 300)) // midpoint(c1.pos, max)
})

it("ExpressionManager uses custom positionConfig in addExpressionRelative before", () => {
    const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
    const em = new ExpressionManager([], config)

    em.addExpression({
        id: "root",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "operator",
        operator: "and",
        parentId: null,
        position: 200,
    })
    em.appendExpression("root", {
        id: "c1",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "variable",
        variableId: "v1",
        parentId: "root",
    })

    em.addExpressionRelative("c1", "before", {
        id: "c0",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "variable",
        variableId: "v2",
        parentId: "root",
    })
    const c0 = em.getExpression("c0")!
    expect(c0.position).toBe(midpoint(100, 200)) // midpoint(min, c1.pos)
})
```

Import `TCorePositionConfig` from `../src/lib/utils/position` at the top of the test file (add to the existing import).

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ExpressionManager uses custom positionConfig"`
Expected: FAIL — `ExpressionManager` constructor doesn't accept a second argument.

**Step 3: Write minimal implementation**

In `src/lib/core/ExpressionManager.ts`:

1. Add to the imports from `../utils/position.js`:

    ```typescript
    import {
        DEFAULT_POSITION_CONFIG,
        type TCorePositionConfig,
        midpoint,
    } from "../utils/position.js"
    ```

    Remove `POSITION_INITIAL`, `POSITION_MAX`, `POSITION_MIN` from the import (they are no longer used directly — the config provides them).

2. Add a private field and update the constructor:

    ```typescript
    private positionConfig: TCorePositionConfig

    constructor(
        initialExpressions: TExpressionInput<TExpr>[] = [],
        positionConfig?: TCorePositionConfig
    ) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()
        this.positionConfig = positionConfig ?? DEFAULT_POSITION_CONFIG

        this.loadInitialExpressions(initialExpressions)
    }
    ```

3. In `appendExpression`, replace the constants:

    ```typescript
    const position =
        children.length === 0
            ? this.positionConfig.initial
            : midpoint(
                  children[children.length - 1].position,
                  this.positionConfig.max
              )
    ```

4. In `addExpressionRelative`, replace the constants:
    ```typescript
    if (relativePosition === "before") {
        const prevPosition =
            siblingIndex > 0
                ? children[siblingIndex - 1].position
                : this.positionConfig.min
        position = midpoint(prevPosition, sibling.position)
    } else {
        const nextPosition =
            siblingIndex < children.length - 1
                ? children[siblingIndex + 1].position
                : this.positionConfig.max
        position = midpoint(sibling.position, nextPosition)
    }
    ```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ExpressionManager uses custom positionConfig"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: thread positionConfig through ExpressionManager
```

---

### Task 4: Thread positionConfig through PremiseManager

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`

**Step 1: Write the failing test**

Add to the `"configurable position range"` describe block:

```typescript
it("PremiseManager forwards positionConfig to ExpressionManager", () => {
    const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
    const vm = new VariableManager()
    vm.addVariable({
        id: "v1",
        argumentId: "arg-1",
        argumentVersion: 1,
        symbol: "P",
    })
    const pm = new PremiseManager("p1", ARG, vm, undefined, undefined, config)

    pm.appendExpression(null, {
        id: "root",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "operator",
        operator: "and",
        parentId: null,
    })
    const root = pm.getExpression("root")!
    expect(root.position).toBe(200)
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "PremiseManager forwards positionConfig"`
Expected: FAIL — `PremiseManager` constructor doesn't accept a 6th argument.

**Step 3: Write minimal implementation**

In `src/lib/core/PremiseManager.ts`:

1. Add to the imports:

    ```typescript
    import type { TCorePositionConfig } from "../utils/position.js"
    ```

2. Update the constructor signature and body:
    ```typescript
    constructor(
        id: string,
        argument: TOptionalChecksum<TArg>,
        variables: VariableManager<TVar>,
        extras?: Record<string, unknown>,
        checksumConfig?: TCoreChecksumConfig,
        positionConfig?: TCorePositionConfig
    ) {
        this.id = id
        this.argument = argument
        this.extras = extras ?? {}
        this.checksumConfig = checksumConfig
        this.rootExpressionId = undefined
        this.variables = variables
        this.expressions = new ExpressionManager<TExpr>([], positionConfig)
        this.expressionsByVariableId = new DefaultMap(() => new Set())
    }
    ```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "PremiseManager forwards positionConfig"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: thread positionConfig through PremiseManager
```

---

### Task 5: Add TArgumentEngineOptions and thread positionConfig through ArgumentEngine

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`

**Step 1: Write the failing test**

Add to the `"configurable position range"` describe block:

```typescript
it("ArgumentEngine passes positionConfig to premises", () => {
    const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
    const eng = new ArgumentEngine(ARG, { positionConfig: config })
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    const { result: pm } = eng.createPremise()

    pm.appendExpression(null, {
        id: "root",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "operator",
        operator: "and",
        parentId: null,
    })
    const root = pm.getExpression("root")!
    expect(root.position).toBe(200)

    pm.appendExpression("root", {
        id: "c1",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId: "var-p",
        parentId: "root",
    })
    pm.appendExpression("root", {
        id: "c2",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId: "var-q",
        parentId: "root",
    })
    const children = pm.getChildExpressions("root")
    expect(children[0].position).toBe(200)
    expect(children[1].position).toBe(midpoint(200, 300))
})

it("ArgumentEngine defaults work without positionConfig", () => {
    const eng = new ArgumentEngine(ARG)
    eng.addVariable(VAR_P)
    const { result: pm } = eng.createPremise()

    pm.appendExpression(null, {
        id: "root",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId: "var-p",
        parentId: null,
    })
    const root = pm.getExpression("root")!
    expect(root.position).toBe(POSITION_INITIAL)
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ArgumentEngine passes positionConfig"`
Expected: FAIL — `positionConfig` is not recognized in the options object (the constructor currently expects `{ checksumConfig?: TCoreChecksumConfig }`).

**Step 3: Write minimal implementation**

In `src/lib/core/ArgumentEngine.ts`:

1. Add to imports:

    ```typescript
    import type { TCorePositionConfig } from "../utils/position.js"
    ```

2. Add a type alias above the class (or inline in the file):

    ```typescript
    export type TArgumentEngineOptions = {
        checksumConfig?: TCoreChecksumConfig
        positionConfig?: TCorePositionConfig
    }
    ```

3. Add a private field:

    ```typescript
    private positionConfig?: TCorePositionConfig
    ```

4. Update the constructor:

    ```typescript
    constructor(
        argument: TOptionalChecksum<TArg>,
        options?: TArgumentEngineOptions
    ) {
        this.argument = { ...argument }
        this.premises = new Map()
        this.variables = new VariableManager<TVar>()
        this.conclusionPremiseId = undefined
        this.checksumConfig = options?.checksumConfig
        this.positionConfig = options?.positionConfig
    }
    ```

5. In `createPremiseWithId`, pass `positionConfig` to `PremiseManager`:
    ```typescript
    const pm = new PremiseManager<TArg, TPremise, TExpr, TVar>(
        id,
        this.argument,
        this.variables,
        extras,
        this.checksumConfig,
        this.positionConfig
    )
    ```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "ArgumentEngine passes positionConfig"`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: add TArgumentEngineOptions and thread positionConfig through ArgumentEngine
```

---

### Task 6: Update exports

**Files:**

- Modify: `src/index.ts`
- Modify: `src/lib/index.ts`

**Step 1: Update `src/lib/index.ts`**

No changes needed — position types are exported from `src/index.ts` directly.

**Step 2: Update `src/index.ts`**

Add to the existing position exports:

```typescript
export {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    DEFAULT_POSITION_CONFIG,
    midpoint,
} from "./lib/utils/position.js"
export type { TCorePositionConfig } from "./lib/utils/position.js"
```

Add a new export for the options type:

```typescript
export type { TArgumentEngineOptions } from "./lib/core/ArgumentEngine.js"
```

**Step 3: Run typecheck and full tests**

Run: `pnpm run typecheck && pnpm vitest run test/ExpressionManager.test.ts`
Expected: PASS

**Step 4: Commit**

```
feat: export TCorePositionConfig, DEFAULT_POSITION_CONFIG, and TArgumentEngineOptions
```

---

### Task 7: Run full checks, update docs

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md` (if it documents position constants or engine options)

**Step 1: Run full check suite**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, prettier, test, build)

**Step 2: Fix any lint/prettier issues**

Run: `pnpm run prettify && pnpm eslint . --fix`

**Step 3: Update CLAUDE.md**

Key sections to update:

- **Position and input types** section: update `POSITION_MIN`, `POSITION_MAX`, `POSITION_INITIAL` descriptions to reflect new signed int32 defaults.
- **Class hierarchy** section: note that `ArgumentEngine` now accepts `TArgumentEngineOptions` (not `{ checksumConfig?: TCoreChecksumConfig }`).
- **Key design decisions → Midpoint-based positions** section: update the constants table and note configurable range.
- **Types** section: add `TCorePositionConfig` and `TArgumentEngineOptions` entries.

In the **Midpoint-based positions** table, update:

| Scenario                       | Position                                  |
| ------------------------------ | ----------------------------------------- |
| First child (no siblings)      | `config.initial` (default `0`)            |
| Append (after last sibling)    | `midpoint(last.position, config.max)`     |
| Prepend (before first sibling) | `midpoint(config.min, first.position)`    |
| Between two siblings           | `midpoint(left.position, right.position)` |

**Step 4: Update README.md**

Search for references to position constants or engine constructor options and update accordingly.

**Step 5: Run full check suite again**

Run: `pnpm run check`
Expected: PASS

**Step 6: Commit**

```
docs: update CLAUDE.md and README.md for configurable position range
```
