# Midpoint Positions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace nullable integer positions with non-nullable float positions using midpoint bisection, and add intent-based insertion methods (`addExpressionRelative`, `appendExpression`).

**Architecture:** Position becomes a required `number` on every expression. New utility constants (`POSITION_MIN`, `POSITION_MAX`, `POSITION_INITIAL`) and a `midpoint()` helper drive auto-computed positions. `ExpressionManager` gains `addExpressionRelative` and `appendExpression`; `PremiseManager` mirrors them with validation. The existing `addExpression` keeps explicit position as a low-level escape hatch. Binary ops (implies/iff) keep hardcoded 0/1 positions.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

---

### Task 1: Position Utilities

**Files:**

- Create: `src/lib/utils/position.ts`
- Test: `test/ExpressionManager.test.ts` (new describe block at bottom)

**Step 1: Write the failing tests**

Add to the bottom of `test/ExpressionManager.test.ts`:

```typescript
import {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    midpoint,
} from "../src/lib/utils/position"

describe("position utilities", () => {
    it("POSITION_INITIAL is midpoint of range", () => {
        expect(POSITION_INITIAL).toBe(Math.floor(Number.MAX_SAFE_INTEGER / 2))
    })

    it("POSITION_MIN is 0", () => {
        expect(POSITION_MIN).toBe(0)
    })

    it("POSITION_MAX is MAX_SAFE_INTEGER", () => {
        expect(POSITION_MAX).toBe(Number.MAX_SAFE_INTEGER)
    })

    it("midpoint computes average of two numbers", () => {
        expect(midpoint(0, 100)).toBe(50)
        expect(midpoint(10, 20)).toBe(15)
    })

    it("midpoint works with large numbers", () => {
        const a = POSITION_INITIAL
        const b = POSITION_MAX
        const m = midpoint(a, b)
        expect(m).toBeGreaterThan(a)
        expect(m).toBeLessThan(b)
    })

    it("midpoint of equal values returns that value", () => {
        expect(midpoint(50, 50)).toBe(50)
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "position utilities"`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/lib/utils/position.ts`:

```typescript
export const POSITION_MIN = 0
export const POSITION_MAX = Number.MAX_SAFE_INTEGER
export const POSITION_INITIAL = Math.floor(POSITION_MAX / 2)

export function midpoint(a: number, b: number): number {
    return (a + b) / 2
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "position utilities"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/utils/position.ts test/ExpressionManager.test.ts
git commit -m "Add position utility constants and midpoint helper"
```

---

### Task 2: Schema Change — Make Position Non-Nullable

**Files:**

- Modify: `src/lib/schemata/propositional.ts:26-32` (position field)
- Test: `test/ExpressionManager.test.ts:50-93` (helper functions)

**Step 1: Update the schema**

In `src/lib/schemata/propositional.ts`, change lines 26-32 from:

```typescript
    position: Nullable(
        Type.Integer({
            minimum: 0,
            description:
                "The ordering of this expression among its siblings under the same parent. Must be unique within (parentId, argumentId, argumentVersion).",
        })
    ),
```

to:

```typescript
    position: Type.Number({
        minimum: 0,
        description:
            "The ordering of this expression among its siblings under the same parent. Must be unique within (parentId, argumentId, argumentVersion).",
    }),
```

Also remove the `Nullable` import if it's no longer used elsewhere in this file. Check first — `parentId` still uses `Nullable`, so it stays.

**Step 2: Update test helper functions**

In `test/ExpressionManager.test.ts`, update the three helper functions so they default to `POSITION_INITIAL` instead of `null`:

`makeVarExpr` (lines 50-64): Change the opts type and default:

```typescript
function makeVarExpr(
    id: string,
    variableId: string,
    opts: { parentId?: string | null; position?: number } = {}
): TCorePropositionalExpression {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId,
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}
```

`makeOpExpr` (lines 66-80): Same pattern:

```typescript
function makeOpExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    opts: { parentId?: string | null; position?: number } = {}
): TCorePropositionalExpression {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "operator",
        operator,
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}
```

`makeFormulaExpr` (lines 82-94): Same pattern:

```typescript
function makeFormulaExpr(
    id: string,
    opts: { parentId?: string | null; position?: number } = {}
): TCorePropositionalExpression {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "formula",
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}
```

Add the `POSITION_INITIAL` import to the existing import from `../src/lib/utils/position` (added in Task 1).

**Step 3: Fix the 14 explicit `position: null` occurrences in tests**

All 14 are in the `diffArguments` describe block and `buildSimpleEngine` helper. Replace every `position: null` with `position: POSITION_INITIAL`. These are at lines: 2192, 2196, 2206, 2210, 2220, 2224, 2249, 2319, 2355, 2385, 2424, 2459, 2511, 2545.

**Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (or reveals further `position: null` references in source code)

**Step 5: Run full test suite**

Run: `pnpm run test`
Expected: Some tests may fail if ExpressionManager internals still check `position !== null`. That's expected — Task 3 fixes those.

**Step 6: Commit**

```bash
git add src/lib/schemata/propositional.ts test/ExpressionManager.test.ts
git commit -m "Make position non-nullable in expression schema"
```

---

### Task 3: Update ExpressionManager Internals

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

All changes are mechanical null-check removals now that position is always a number.

**Step 1: Update `addExpression`** (lines 96-108)

Change from:

```typescript
if (expression.position !== null) {
    const occupiedPositions = getOrCreate(
        this.childPositionsByParentId,
        expression.parentId,
        () => new Set()
    )
    if (occupiedPositions.has(expression.position)) {
        throw new Error(
            `Position ${expression.position} is already used under parent "${expression.parentId}".`
        )
    }
    occupiedPositions.add(expression.position)
}
```

to:

```typescript
const occupiedPositions = getOrCreate(
    this.childPositionsByParentId,
    expression.parentId,
    () => new Set()
)
if (occupiedPositions.has(expression.position)) {
    throw new Error(
        `Position ${expression.position} is already used under parent "${expression.parentId}".`
    )
}
occupiedPositions.add(expression.position)
```

**Step 2: Update `removeExpression`** (lines 164-168)

Change from:

```typescript
if (expression.position !== null) {
    this.childPositionsByParentId
        .get(expression.parentId)
        ?.delete(expression.position)
}
```

to:

```typescript
this.childPositionsByParentId
    .get(expression.parentId)
    ?.delete(expression.position)
```

**Step 3: Update `collapseIfNeeded`** — formula branch (lines 193-197)

Change from:

```typescript
if (operator.position !== null) {
    this.childPositionsByParentId.get(grandparentId)?.delete(operator.position)
}
```

to:

```typescript
this.childPositionsByParentId.get(grandparentId)?.delete(operator.position)
```

**Step 4: Update `collapseIfNeeded`** — operator 0-children branch (lines 217-221)

Change from:

```typescript
if (grandparentPosition !== null) {
    this.childPositionsByParentId
        .get(grandparentId)
        ?.delete(grandparentPosition)
}
```

to:

```typescript
this.childPositionsByParentId.get(grandparentId)?.delete(grandparentPosition)
```

**Step 5: Update `getChildExpressions`** (lines 299-310)

Change from:

```typescript
return children.sort((a, b) => {
    if (a.position === null && b.position === null) {
        return a.id.localeCompare(b.id)
    }
    if (a.position === null) {
        return 1
    }
    if (b.position === null) {
        return -1
    }
    return a.position - b.position
})
```

to:

```typescript
return children.sort((a, b) => a.position - b.position)
```

**Step 6: Update `reparent`** (lines 369-407)

Change the signature from `newPosition: number | null` to `newPosition: number`.

Remove the null checks on position in both detach and attach phases:

Detach (lines 380-384): Change from:

```typescript
if (expression.position !== null) {
    this.childPositionsByParentId
        .get(expression.parentId)
        ?.delete(expression.position)
}
```

to:

```typescript
this.childPositionsByParentId
    .get(expression.parentId)
    ?.delete(expression.position)
```

Attach (lines 400-406): Change from:

```typescript
if (newPosition !== null) {
    getOrCreate(
        this.childPositionsByParentId,
        newParentId,
        () => new Set()
    ).add(newPosition)
}
```

to:

```typescript
getOrCreate(this.childPositionsByParentId, newParentId, () => new Set()).add(
    newPosition
)
```

**Step 7: Update `insertExpression`** (lines 561-567)

Change from:

```typescript
if (anchorPosition !== null) {
    getOrCreate(
        this.childPositionsByParentId,
        anchorParentId,
        () => new Set()
    ).add(anchorPosition)
}
```

to:

```typescript
getOrCreate(this.childPositionsByParentId, anchorParentId, () => new Set()).add(
    anchorPosition
)
```

**Step 8: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 9: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 10: Commit**

```bash
git add src/lib/core/ExpressionManager.ts
git commit -m "Remove nullable position handling from ExpressionManager"
```

---

### Task 4: Add `appendExpression` and `addExpressionRelative` to ExpressionManager

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`
- Test: `test/ExpressionManager.test.ts` (new describe block)

**Step 1: Write failing tests**

Add a new describe block at the bottom of `test/ExpressionManager.test.ts`. These tests use `PremiseManager` since `ExpressionManager` is internal:

```typescript
describe("ExpressionManager — appendExpression and addExpressionRelative", () => {
    it("appendExpression assigns POSITION_INITIAL to first child", () => {
        const pm = premiseWithVars()
        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(POSITION_INITIAL)
    })

    it("appendExpression appends after last child", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
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
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[0].position).toBeLessThan(children[1].position)
    })

    it("addExpressionRelative before inserts before sibling", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "before", {
            id: "c0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c0")
        expect(children[1].id).toBe("c1")
    })

    it("addExpressionRelative after inserts after sibling", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-r",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(3)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[2].id).toBe("c3")
    })

    it("addExpressionRelative after last child appends", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[0].position).toBeLessThan(children[1].position)
    })

    it("addExpressionRelative throws if sibling not found", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpressionRelative("nonexistent", "before", {
                id: "c1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                type: "variable",
                variableId: "var-p",
                parentId: null,
            })
        ).toThrow(/not found/)
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "appendExpression and addExpressionRelative"`
Expected: FAIL — methods don't exist

**Step 3: Define the input type**

At the top of `src/lib/core/ExpressionManager.ts`, add:

```typescript
export type TExpressionWithoutPosition = Omit<
    TCorePropositionalExpression,
    "position"
>
```

**Step 4: Implement `appendExpression` on ExpressionManager**

Add after `addExpression` in `ExpressionManager`:

```typescript
    /**
     * Adds an expression as the last child of the given parent.
     *
     * If the parent has no children, the expression gets `POSITION_INITIAL`.
     * Otherwise it gets a midpoint between the last child's position and
     * `POSITION_MAX`.
     */
    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition
    ): void {
        const children = this.getChildExpressions(parentId)
        const position =
            children.length === 0
                ? POSITION_INITIAL
                : midpoint(children[children.length - 1].position, POSITION_MAX)
        this.addExpression({
            ...expression,
            parentId,
            position,
        } as TCorePropositionalExpression)
    }
```

Add import at top of file:

```typescript
import {
    POSITION_INITIAL,
    POSITION_MAX,
    POSITION_MIN,
    midpoint,
} from "../utils/position.js"
```

**Step 5: Implement `addExpressionRelative` on ExpressionManager**

Add after `appendExpression`:

```typescript
    /**
     * Adds an expression immediately before or after an existing sibling.
     *
     * @throws If the sibling does not exist.
     */
    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition
    ): void {
        const sibling = this.expressions.get(siblingId)
        if (!sibling) {
            throw new Error(`Expression "${siblingId}" not found.`)
        }

        const children = this.getChildExpressions(sibling.parentId)
        const siblingIndex = children.findIndex((c) => c.id === siblingId)

        let position: number
        if (relativePosition === "before") {
            const prev = siblingIndex > 0 ? children[siblingIndex - 1] : undefined
            position = midpoint(
                prev?.position ?? POSITION_MIN,
                sibling.position
            )
        } else {
            const next =
                siblingIndex < children.length - 1
                    ? children[siblingIndex + 1]
                    : undefined
            position = midpoint(
                sibling.position,
                next?.position ?? POSITION_MAX
            )
        }

        this.addExpression({
            ...expression,
            parentId: sibling.parentId,
            position,
        } as TCorePropositionalExpression)
    }
```

**Step 6: Run tests**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "appendExpression and addExpressionRelative"`
Expected: FAIL — PremiseManager doesn't expose these methods yet. Proceed to Task 5.

**Step 7: Commit**

```bash
git add src/lib/core/ExpressionManager.ts test/ExpressionManager.test.ts
git commit -m "Add appendExpression and addExpressionRelative to ExpressionManager"
```

---

### Task 5: Add `appendExpression` and `addExpressionRelative` to PremiseManager

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`

**Step 1: Implement `appendExpression` on PremiseManager**

Add the import for the type at the top of `PremiseManager.ts`:

```typescript
import type { TExpressionWithoutPosition } from "./ExpressionManager.js"
```

Add after the existing `addExpression` method (after line 142):

```typescript
    /**
     * Adds an expression as the last child of the given parent, with
     * position computed automatically.
     *
     * If `parentId` is `null`, the expression becomes the root.
     *
     * @throws If the premise already has a root and parentId is null.
     * @throws If the expression does not belong to this argument.
     * @throws If the expression is a variable reference and the variable has not been registered.
     */
    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition
    ): void {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )

        if (
            expression.type === "variable" &&
            !this.variables.hasVariable(expression.variableId)
        ) {
            throw new Error(
                `Variable expression "${expression.id}" references non-existent variable "${expression.variableId}".`
            )
        }

        if (parentId === null) {
            if (this.rootExpressionId !== undefined) {
                throw new Error(
                    `Premise "${this.id}" already has a root expression.`
                )
            }
        } else {
            if (!this.expressions.getExpression(parentId)) {
                throw new Error(
                    `Parent expression "${parentId}" does not exist in this premise.`
                )
            }
        }

        this.expressions.appendExpression(parentId, expression)

        if (parentId === null) {
            this.syncRootExpressionId()
        }
        if (expression.type === "variable") {
            this.expressionsByVariableId
                .get(expression.variableId)
                .add(expression.id)
        }
    }
```

**Step 2: Implement `addExpressionRelative` on PremiseManager**

Add after `appendExpression`:

```typescript
    /**
     * Adds an expression immediately before or after an existing sibling,
     * with position computed automatically.
     *
     * @throws If the sibling does not exist in this premise.
     * @throws If the expression does not belong to this argument.
     * @throws If the expression is a variable reference and the variable has not been registered.
     */
    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition
    ): void {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )

        if (
            expression.type === "variable" &&
            !this.variables.hasVariable(expression.variableId)
        ) {
            throw new Error(
                `Variable expression "${expression.id}" references non-existent variable "${expression.variableId}".`
            )
        }

        if (!this.expressions.getExpression(siblingId)) {
            throw new Error(
                `Expression "${siblingId}" not found in this premise.`
            )
        }

        this.expressions.addExpressionRelative(
            siblingId,
            relativePosition,
            expression
        )

        if (expression.type === "variable") {
            this.expressionsByVariableId
                .get(expression.variableId)
                .add(expression.id)
        }
    }
```

**Step 3: Run the tests from Task 4**

Run: `pnpm vitest run test/ExpressionManager.test.ts -t "appendExpression and addExpressionRelative"`
Expected: PASS

**Step 4: Run full test suite**

Run: `pnpm run test`
Expected: PASS

**Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/core/PremiseManager.ts
git commit -m "Add appendExpression and addExpressionRelative to PremiseManager"
```

---

### Task 6: Export New Types

**Files:**

- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Export `TExpressionWithoutPosition` from lib barrel**

In `src/lib/index.ts`, add the type export:

```typescript
export type { TExpressionWithoutPosition } from "./core/ExpressionManager.js"
```

**Step 2: Export position utilities from lib barrel**

In `src/lib/index.ts`, add:

```typescript
export {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    midpoint,
} from "./utils/position.js"
```

**Step 3: Mirror exports in package entry point**

In `src/index.ts`, add:

```typescript
export type { TExpressionWithoutPosition } from "./lib/core/ExpressionManager.js"
export {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    midpoint,
} from "./lib/utils/position.js"
```

**Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/index.ts src/index.ts
git commit -m "Export position utilities and TExpressionWithoutPosition"
```

---

### Task 7: CLI Updates

**Files:**

- Modify: `src/cli/commands/expressions.ts`

**Step 1: Update `expressions create` command**

Add new options (after the existing `--position` option, around line 55):

```typescript
        .option("--before <sibling_id>", "Insert before this sibling expression")
        .option("--after <sibling_id>", "Insert after this sibling expression")
```

Update the action's opts type to include `before?: string` and `after?: string`.

Update the action body. After constructing the expression object, replace the `pm.addExpression(expression)` call (lines 131-139) with routing logic:

```typescript
const hasBefore = opts.before !== undefined
const hasAfter = opts.after !== undefined
const hasPosition = opts.position !== undefined

if ((hasBefore || hasAfter) && hasPosition) {
    errorExit("Cannot combine --before/--after with --position.")
}
if (hasBefore && hasAfter) {
    errorExit("Cannot combine --before and --after.")
}

try {
    if (hasBefore) {
        const { position: _p, ...exprWithoutPosition } = expression
        pm.addExpressionRelative(opts.before!, "before", exprWithoutPosition)
    } else if (hasAfter) {
        const { position: _p, ...exprWithoutPosition } = expression
        pm.addExpressionRelative(opts.after!, "after", exprWithoutPosition)
    } else if (hasPosition) {
        pm.addExpression(expression)
    } else {
        const { position: _p, ...exprWithoutPosition } = expression
        pm.appendExpression(parentId, exprWithoutPosition)
    }
} catch (e) {
    errorExit(e instanceof Error ? e.message : "Failed to add expression.")
}
```

Also update the position default (line 88-89). When using `--position`, parse it as a number. When not using `--position`, set a placeholder value (this value gets ignored for before/after/append paths, but `addExpression` still needs it for the escape hatch path):

```typescript
const position =
    opts.position !== undefined ? Number(opts.position) : POSITION_INITIAL
```

Add import at top of file:

```typescript
import { POSITION_INITIAL } from "../../lib/utils/position.js"
```

**Step 2: Update the `expressions insert` command**

In the insert command (around line 199-200), update the position default from `null` to `POSITION_INITIAL`:

```typescript
const position =
    opts.position !== undefined ? Number(opts.position) : POSITION_INITIAL
```

Note: `insertExpression` overrides the position anyway (it inherits the anchor's position), so this value is just a placeholder. But it must be a valid number now.

**Step 3: Update `expressions list` display**

In the list command (line 302), remove the `?? "null"` fallback since position is always a number:

```typescript
printLine(
    `${expr.id} | ${expr.type} | parent=${expr.parentId ?? "null"} | position=${expr.position}${extra ? ` | ${extra}` : ""}`
)
```

**Step 4: Update `expressions show` display**

In the show command (line 334), same change:

```typescript
printLine(`position:   ${expr.position}`)
```

**Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 6: Run lint and auto-fix**

Run: `pnpm eslint . --fix && pnpm run lint`
Expected: PASS

**Step 7: Commit**

```bash
git add src/cli/commands/expressions.ts
git commit -m "Add --before/--after options to CLI expressions create"
```

---

### Task 8: Final Verification

**Step 1: Run full check suite**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build all succeed)

**Step 2: Verify build output**

Run: `ls dist/lib/utils/position.js`
Expected: File exists

**Step 3: Commit if any lint/format fixes were needed**

```bash
git add -A
git commit -m "Fix lint/format issues"
```

(Skip if no changes.)
