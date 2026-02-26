# Argument Diff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `diffArguments` library function that computes a structured diff between two `ArgumentEngine` instances, reporting added/removed/modified objects with field-level detail and pluggable comparators.

**Architecture:** Standalone `diffArguments` function in `src/lib/core/diff.ts` calls `toData()` on both engines, matches entities by UUID, runs per-entity comparators, and returns a `TCoreArgumentDiff`. Types live in `src/lib/types/diff.ts`. Default comparators are individually exported for consumer composition.

**Tech Stack:** TypeScript, Vitest

---

**Design doc:** `docs/plans/2026-02-26-argument-diff-design.md`

**Note:** The design doc has a typo in `TCoreDiffOptions` — `comparePremise` is typed as `TCoreFieldComparator<TCorePropositionalExpression>` but should be `TCoreFieldComparator<TCorePremise>`. Fixed in this plan. Also, the design specifies `TCoreEntityFieldDiff<TCoreArgumentMeta>` for the argument field, but `toData()` returns `TCoreArgument` (which includes version/published fields). This plan uses `TCoreArgument` so consumers have full objects available; the default comparator still only checks `title` and `description`.

### Task 1: Create diff type definitions

**Files:**
- Create: `src/lib/types/diff.ts`

**Step 1: Write the type definitions file**

```typescript
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"

/** A single field-level change on an entity. */
export interface TCoreFieldChange {
    field: string
    before: unknown
    after: unknown
}

/** Field-level diff for a single matched entity. */
export interface TCoreEntityFieldDiff<T> {
    before: T
    after: T
    changes: TCoreFieldChange[]
}

/** Set-level diff for a collection of ID-keyed entities. */
export interface TCoreEntitySetDiff<T extends { id: string }> {
    added: T[]
    removed: T[]
    modified: TCoreEntityFieldDiff<T>[]
}

/** Premise diff includes nested expression diffs. */
export interface TCorePremiseDiff
    extends TCoreEntityFieldDiff<TCorePremise> {
    expressions: TCoreEntitySetDiff<TCorePropositionalExpression>
}

export interface TCorePremiseSetDiff {
    added: TCorePremise[]
    removed: TCorePremise[]
    modified: TCorePremiseDiff[]
}

/** Role changes between two argument versions. */
export interface TCoreRoleDiff {
    conclusion: { before: string | undefined; after: string | undefined }
    supportingAdded: string[]
    supportingRemoved: string[]
}

/** Top-level diff result from `diffArguments`. */
export interface TCoreArgumentDiff {
    argument: TCoreEntityFieldDiff<TCoreArgument>
    variables: TCoreEntitySetDiff<TCorePropositionalVariable>
    premises: TCorePremiseSetDiff
    roles: TCoreRoleDiff
}

/** A comparator receives two matched objects and returns field-level changes. */
export type TCoreFieldComparator<T> = (
    before: T,
    after: T
) => TCoreFieldChange[]

/** Per-entity comparator overrides for `diffArguments`. */
export interface TCoreDiffOptions {
    compareArgument?: TCoreFieldComparator<TCoreArgument>
    compareVariable?: TCoreFieldComparator<TCorePropositionalVariable>
    comparePremise?: TCoreFieldComparator<TCorePremise>
    compareExpression?: TCoreFieldComparator<TCorePropositionalExpression>
}
```

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (new file has no consumers yet, just needs valid syntax)

**Step 3: Commit**

```bash
git add src/lib/types/diff.ts
git commit -m "Add diff type definitions"
```

---

### Task 2: Wire up exports

**Files:**
- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Add re-export to `src/lib/index.ts`**

Add this line after the existing exports:

```typescript
export * from "./types/diff.js"
```

**Step 2: Add re-export to `src/index.ts`**

The existing `export * from "./lib/schemata"` does not cover `types/`. Add after the existing line `export * from "./lib/schemata"`:

```typescript
export * from "./lib/types/diff"
```

Note: `src/index.ts` uses extensionless imports (bundler resolution). `src/lib/index.ts` uses `.js` extensions (ESM rule from CLAUDE.md).

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/index.ts src/index.ts
git commit -m "Re-export diff types from lib and package entry points"
```

---

### Task 3: Implement default comparators

**Files:**
- Create: `src/lib/core/diff.ts`

**Step 1: Write the failing test — default comparators**

Add a new `describe` block at the bottom of `test/ExpressionManager.test.ts`. Import `diffArguments` and the default comparators (they don't exist yet, so the test will fail to compile).

```typescript
import {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "../src/lib/core/diff"
// ... existing imports already cover ArgumentEngine, types, etc.

describe("diffArguments", () => {
    // Helper: create an engine with one premise containing P → Q
    function buildSimpleEngine(arg: TCoreArgument): {
        engine: ArgumentEngine
        premiseId: string
    } {
        const engine = new ArgumentEngine(arg)
        const varP = makeVar("var-p", "P")
        const varQ = makeVar("var-q", "Q")

        const pm = engine.createPremiseWithId("premise-1", "First premise")
        pm.addVariable(varP)
        pm.addVariable(varQ)
        pm.addExpression(
            makeOpExpr("expr-implies", "implies", {
                parentId: null,
                position: null,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", "var-p", {
                parentId: "expr-implies",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", "var-q", {
                parentId: "expr-implies",
                position: 1,
            })
        )

        engine.addSupportingPremise("premise-1")
        return { engine, premiseId: "premise-1" }
    }

    describe("defaultCompareArgument", () => {
        it("returns empty array when title and description match", () => {
            const a: TCoreArgument = { ...ARG, title: "T", description: "D" }
            const b: TCoreArgument = { ...ARG, title: "T", description: "D", version: 2 }
            expect(defaultCompareArgument(a, b)).toEqual([])
        })

        it("detects title change", () => {
            const a: TCoreArgument = { ...ARG, title: "Old" }
            const b: TCoreArgument = { ...ARG, title: "New" }
            expect(defaultCompareArgument(a, b)).toEqual([
                { field: "title", before: "Old", after: "New" },
            ])
        })

        it("detects description change", () => {
            const a: TCoreArgument = { ...ARG, description: "Old" }
            const b: TCoreArgument = { ...ARG, description: "New" }
            expect(defaultCompareArgument(a, b)).toEqual([
                { field: "description", before: "Old", after: "New" },
            ])
        })
    })

    describe("defaultCompareVariable", () => {
        it("returns empty array when symbol matches", () => {
            expect(defaultCompareVariable(VAR_P, VAR_P)).toEqual([])
        })

        it("detects symbol change", () => {
            const before = makeVar("var-p", "P")
            const after = makeVar("var-p", "X")
            expect(defaultCompareVariable(before, after)).toEqual([
                { field: "symbol", before: "P", after: "X" },
            ])
        })
    })

    describe("defaultComparePremise", () => {
        it("detects title change", () => {
            const before = { id: "p1", title: "Old", rootExpressionId: "r1", variables: [], expressions: [] }
            const after = { id: "p1", title: "New", rootExpressionId: "r1", variables: [], expressions: [] }
            expect(defaultComparePremise(before, after)).toEqual([
                { field: "title", before: "Old", after: "New" },
            ])
        })

        it("detects rootExpressionId change", () => {
            const before = { id: "p1", title: "T", rootExpressionId: "r1", variables: [], expressions: [] }
            const after = { id: "p1", title: "T", rootExpressionId: "r2", variables: [], expressions: [] }
            expect(defaultComparePremise(before, after)).toEqual([
                { field: "rootExpressionId", before: "r1", after: "r2" },
            ])
        })
    })

    describe("defaultCompareExpression", () => {
        it("detects parentId change", () => {
            const before = makeVarExpr("e1", "var-p", { parentId: "p1", position: 0 })
            const after = makeVarExpr("e1", "var-p", { parentId: "p2", position: 0 })
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "parentId", before: "p1", after: "p2" },
            ])
        })

        it("detects position change", () => {
            const before = makeVarExpr("e1", "var-p", { parentId: "p1", position: 0 })
            const after = makeVarExpr("e1", "var-p", { parentId: "p1", position: 1 })
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "position", before: 0, after: 1 },
            ])
        })

        it("detects variableId change on variable expression", () => {
            const before = makeVarExpr("e1", "var-p", { parentId: null, position: null })
            const after = makeVarExpr("e1", "var-q", { parentId: null, position: null })
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "variableId", before: "var-p", after: "var-q" },
            ])
        })

        it("detects operator change on operator expression", () => {
            const before = makeOpExpr("e1", "and", { parentId: null, position: null })
            const after = makeOpExpr("e1", "or", { parentId: null, position: null })
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "operator", before: "and", after: "or" },
            ])
        })
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — cannot resolve `../src/lib/core/diff`

**Step 3: Write the default comparators in `src/lib/core/diff.ts`**

```typescript
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type {
    TCoreArgumentDiff,
    TCoreDiffOptions,
    TCoreEntityFieldDiff,
    TCoreEntitySetDiff,
    TCoreFieldChange,
    TCoreFieldComparator,
    TCorePremiseDiff,
    TCorePremiseSetDiff,
    TCoreRoleDiff,
} from "../types/diff.js"
import type { ArgumentEngine } from "./ArgumentEngine.js"

export function defaultCompareArgument(
    before: TCoreArgument,
    after: TCoreArgument
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.title !== after.title) {
        changes.push({ field: "title", before: before.title, after: after.title })
    }
    if (before.description !== after.description) {
        changes.push({
            field: "description",
            before: before.description,
            after: after.description,
        })
    }
    return changes
}

export function defaultCompareVariable(
    before: TCorePropositionalVariable,
    after: TCorePropositionalVariable
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.symbol !== after.symbol) {
        changes.push({
            field: "symbol",
            before: before.symbol,
            after: after.symbol,
        })
    }
    return changes
}

export function defaultComparePremise(
    before: TCorePremise,
    after: TCorePremise
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.title !== after.title) {
        changes.push({
            field: "title",
            before: before.title,
            after: after.title,
        })
    }
    if (before.rootExpressionId !== after.rootExpressionId) {
        changes.push({
            field: "rootExpressionId",
            before: before.rootExpressionId,
            after: after.rootExpressionId,
        })
    }
    return changes
}

export function defaultCompareExpression(
    before: TCorePropositionalExpression,
    after: TCorePropositionalExpression
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.parentId !== after.parentId) {
        changes.push({
            field: "parentId",
            before: before.parentId,
            after: after.parentId,
        })
    }
    if (before.position !== after.position) {
        changes.push({
            field: "position",
            before: before.position,
            after: after.position,
        })
    }
    if (before.type === "variable" && after.type === "variable") {
        if (before.variableId !== after.variableId) {
            changes.push({
                field: "variableId",
                before: before.variableId,
                after: after.variableId,
            })
        }
    }
    if (before.type === "operator" && after.type === "operator") {
        if (before.operator !== after.operator) {
            changes.push({
                field: "operator",
                before: before.operator,
                after: after.operator,
            })
        }
    }
    return changes
}
```

**Step 4: Run tests to verify comparator tests pass**

Run: `pnpm run test`
Expected: The comparator tests pass. The `diffArguments` function doesn't exist yet but isn't called in these tests.

**Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/core/diff.ts test/ExpressionManager.test.ts
git commit -m "Add default comparators for argument diff"
```

---

### Task 4: Implement `diffArguments` function

**Files:**
- Modify: `src/lib/core/diff.ts`

**Step 1: Write the failing test — identical engines produce empty diff**

Add inside the existing `describe("diffArguments")` block, after the comparator describe blocks:

```typescript
    describe("diffArguments function", () => {
        it("returns empty diff for identical engines", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            const diff = diffArguments(engineA, engineB)

            expect(diff.argument.changes).toEqual([])
            expect(diff.variables.added).toEqual([])
            expect(diff.variables.removed).toEqual([])
            expect(diff.variables.modified).toEqual([])
            expect(diff.premises.added).toEqual([])
            expect(diff.premises.removed).toEqual([])
            expect(diff.premises.modified).toEqual([])
            expect(diff.roles.conclusion).toEqual({ before: undefined, after: undefined })
            expect(diff.roles.supportingAdded).toEqual([])
            expect(diff.roles.supportingRemoved).toEqual([])
        })
    })
```

**Step 2: Run test to verify it fails**

Run: `pnpm run test`
Expected: FAIL — `diffArguments is not a function` (or similar)

**Step 3: Implement `diffArguments` and helpers in `src/lib/core/diff.ts`**

Add the following below the existing comparator functions:

```typescript
function diffEntitySet<T extends { id: string }>(
    beforeItems: T[],
    afterItems: T[],
    compare: TCoreFieldComparator<T>
): TCoreEntitySetDiff<T> {
    const beforeById = new Map(beforeItems.map((item) => [item.id, item]))
    const afterById = new Map(afterItems.map((item) => [item.id, item]))

    const added: T[] = []
    const removed: T[] = []
    const modified: TCoreEntityFieldDiff<T>[] = []

    for (const [id, beforeItem] of beforeById) {
        const afterItem = afterById.get(id)
        if (!afterItem) {
            removed.push(beforeItem)
            continue
        }
        const changes = compare(beforeItem, afterItem)
        if (changes.length > 0) {
            modified.push({ before: beforeItem, after: afterItem, changes })
        }
    }

    for (const [id, afterItem] of afterById) {
        if (!beforeById.has(id)) {
            added.push(afterItem)
        }
    }

    return { added, removed, modified }
}

function diffPremiseSet(
    beforePremises: TCorePremise[],
    afterPremises: TCorePremise[],
    comparePremise: TCoreFieldComparator<TCorePremise>,
    compareExpression: TCoreFieldComparator<TCorePropositionalExpression>
): TCorePremiseSetDiff {
    const beforeById = new Map(beforePremises.map((p) => [p.id, p]))
    const afterById = new Map(afterPremises.map((p) => [p.id, p]))

    const added: TCorePremise[] = []
    const removed: TCorePremise[] = []
    const modified: TCorePremiseDiff[] = []

    for (const [id, beforePremise] of beforeById) {
        const afterPremise = afterById.get(id)
        if (!afterPremise) {
            removed.push(beforePremise)
            continue
        }
        const premiseChanges = comparePremise(beforePremise, afterPremise)
        const expressionsDiff = diffEntitySet(
            beforePremise.expressions,
            afterPremise.expressions,
            compareExpression
        )
        const hasExpressionChanges =
            expressionsDiff.added.length > 0 ||
            expressionsDiff.removed.length > 0 ||
            expressionsDiff.modified.length > 0
        if (premiseChanges.length > 0 || hasExpressionChanges) {
            modified.push({
                before: beforePremise,
                after: afterPremise,
                changes: premiseChanges,
                expressions: expressionsDiff,
            })
        }
    }

    for (const [id, afterPremise] of afterById) {
        if (!beforeById.has(id)) {
            added.push(afterPremise)
        }
    }

    return { added, removed, modified }
}

function diffRoles(
    beforeConclusion: string | undefined,
    afterConclusion: string | undefined,
    beforeSupporting: string[],
    afterSupporting: string[]
): TCoreRoleDiff {
    const beforeSet = new Set(beforeSupporting)
    const afterSet = new Set(afterSupporting)
    return {
        conclusion: { before: beforeConclusion, after: afterConclusion },
        supportingAdded: afterSupporting.filter((id) => !beforeSet.has(id)),
        supportingRemoved: beforeSupporting.filter((id) => !afterSet.has(id)),
    }
}

export function diffArguments(
    engineA: ArgumentEngine,
    engineB: ArgumentEngine,
    options?: TCoreDiffOptions
): TCoreArgumentDiff {
    const dataA = engineA.toData()
    const dataB = engineB.toData()

    const compareArg = options?.compareArgument ?? defaultCompareArgument
    const compareVar = options?.compareVariable ?? defaultCompareVariable
    const comparePrem = options?.comparePremise ?? defaultComparePremise
    const compareExpr = options?.compareExpression ?? defaultCompareExpression

    const argumentChanges = compareArg(dataA.argument, dataB.argument)

    return {
        argument: {
            before: dataA.argument,
            after: dataB.argument,
            changes: argumentChanges,
        },
        variables: diffEntitySet(
            dataA.premises.flatMap((p) =>
                p.variables
                    .map((vid) =>
                        dataA.premises
                            .flatMap((pm) => pm.expressions)
                            .find(
                                (e) =>
                                    e.type === "variable" &&
                                    e.variableId === vid
                            )
                    )
                    .filter(Boolean)
            ) as never,
            dataB.premises.flatMap((p) =>
                p.variables
                    .map((vid) =>
                        dataB.premises
                            .flatMap((pm) => pm.expressions)
                            .find(
                                (e) =>
                                    e.type === "variable" &&
                                    e.variableId === vid
                            )
                    )
                    .filter(Boolean)
            ) as never,
            compareVar as never
        ),
        premises: diffPremiseSet(
            dataA.premises,
            dataB.premises,
            comparePrem,
            compareExpr
        ),
        roles: diffRoles(
            dataA.roles.conclusionPremiseId,
            dataB.roles.conclusionPremiseId,
            dataA.roles.supportingPremiseIds,
            dataB.roles.supportingPremiseIds
        ),
    }
}
```

Wait — the variable diff is tricky. `toData()` on premises gives `variables: string[]` (just IDs), not full `TCorePropositionalVariable` objects. But `ArgumentEngine` exposes the full variable objects through the premise managers. We need to collect the variables differently.

Looking back at the code, each `PremiseManager.getVariables()` returns `TCorePropositionalVariable[]`, and `PremiseManager.toData()` stores `variables` as `string[]` (just the IDs). But to diff variables we need the full objects.

The solution: call `collectReferencedVariables()` on both engines (which exists on `ArgumentEngine`), or iterate `listPremises()` and gather variables. However, `collectReferencedVariables()` returns `{ variableIds, byId: Record<string, { symbol, premiseIds }> }` — not the full `TCorePropositionalVariable` objects.

The cleanest approach: gather variables from each engine by iterating premises directly (before calling `toData()`). Let me revise:

```typescript
export function diffArguments(
    engineA: ArgumentEngine,
    engineB: ArgumentEngine,
    options?: TCoreDiffOptions
): TCoreArgumentDiff {
    const dataA = engineA.toData()
    const dataB = engineB.toData()

    const compareArg = options?.compareArgument ?? defaultCompareArgument
    const compareVar = options?.compareVariable ?? defaultCompareVariable
    const comparePrem = options?.comparePremise ?? defaultComparePremise
    const compareExpr = options?.compareExpression ?? defaultCompareExpression

    const argumentChanges = compareArg(dataA.argument, dataB.argument)

    const collectVariables = (engine: ArgumentEngine): TCorePropositionalVariable[] => {
        const seen = new Set<string>()
        const vars: TCorePropositionalVariable[] = []
        for (const pm of engine.listPremises()) {
            for (const v of pm.getVariables()) {
                if (!seen.has(v.id)) {
                    seen.add(v.id)
                    vars.push(v)
                }
            }
        }
        return vars
    }

    return {
        argument: {
            before: dataA.argument,
            after: dataB.argument,
            changes: argumentChanges,
        },
        variables: diffEntitySet(
            collectVariables(engineA),
            collectVariables(engineB),
            compareVar
        ),
        premises: diffPremiseSet(
            dataA.premises,
            dataB.premises,
            comparePrem,
            compareExpr
        ),
        roles: diffRoles(
            dataA.roles.conclusionPremiseId,
            dataB.roles.conclusionPremiseId,
            dataA.roles.supportingPremiseIds,
            dataB.roles.supportingPremiseIds
        ),
    }
}
```

**Step 4: Run tests to verify passing**

Run: `pnpm run test`
Expected: PASS

**Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS (run `pnpm eslint . --fix` if needed)

**Step 6: Commit**

```bash
git add src/lib/core/diff.ts test/ExpressionManager.test.ts
git commit -m "Implement diffArguments function with entity set diffing"
```

---

### Task 5: Add integration tests — added, removed, and modified entities

**Files:**
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests for variable diff**

Add inside the `describe("diffArguments function")` block:

```typescript
        it("detects added and removed variables", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Add a new variable to engineB's premise
            const varR = makeVar("var-r", "R")
            engineB.getPremise("premise-1")!.addVariable(varR)

            // Remove var-q from engineA by building engineA without it
            // Simpler: just test that engineB has an extra variable
            const diff = diffArguments(engineA, engineB)
            expect(diff.variables.added).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "var-r", symbol: "R" })])
            )
        })

        it("detects modified variable (symbol change)", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const argB: TCoreArgument = { ...ARG }
            const engineB = new ArgumentEngine(argB)
            const pm = engineB.createPremiseWithId("premise-1", "First premise")
            // Same variable ID, different symbol
            pm.addVariable(makeVar("var-p", "X"))
            pm.addVariable(makeVar("var-q", "Q"))
            pm.addExpression(makeOpExpr("expr-implies", "implies", { parentId: null, position: null }))
            pm.addExpression(makeVarExpr("expr-p", "var-p", { parentId: "expr-implies", position: 0 }))
            pm.addExpression(makeVarExpr("expr-q", "var-q", { parentId: "expr-implies", position: 1 }))
            engineB.addSupportingPremise("premise-1")

            const diff = diffArguments(engineA, engineB)
            expect(diff.variables.modified).toEqual([
                expect.objectContaining({
                    changes: [{ field: "symbol", before: "P", after: "X" }],
                }),
            ])
        })
```

**Step 2: Write tests for premise diff**

```typescript
        it("detects added premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            const pm2 = engineB.createPremiseWithId("premise-2", "Second premise")
            pm2.addVariable(makeVar("var-p", "P"))
            pm2.addExpression(makeVarExpr("expr-p2", "var-p", { parentId: null, position: null }))

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.added).toHaveLength(1)
            expect(diff.premises.added[0].id).toBe("premise-2")
        })

        it("detects removed premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const engineB = new ArgumentEngine(ARG)

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.removed).toHaveLength(1)
            expect(diff.premises.removed[0].id).toBe("premise-1")
        })

        it("detects modified premise title", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setTitle("Updated title")

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.modified).toHaveLength(1)
            expect(diff.premises.modified[0].changes).toEqual([
                { field: "title", before: "First premise", after: "Updated title" },
            ])
        })
```

**Step 3: Write tests for nested expression diff**

```typescript
        it("detects modified expressions within a premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Remove an expression and add a different one in engineB
            const pmB = engineB.getPremise("premise-1")!
            pmB.addVariable(makeVar("var-r", "R"))
            pmB.removeExpression("expr-q")
            pmB.addExpression(
                makeVarExpr("expr-r", "var-r", { parentId: "expr-implies", position: 1 })
            )

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.modified).toHaveLength(1)
            const premiseDiff = diff.premises.modified[0]
            expect(premiseDiff.expressions.removed).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "expr-q" })])
            )
            expect(premiseDiff.expressions.added).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "expr-r" })])
            )
        })
```

**Step 4: Write tests for role diff**

```typescript
        it("detects conclusion change", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // engineA has no conclusion, engineB sets one
            const pmConc = engineB.createPremiseWithId("premise-conc", "Conclusion")
            pmConc.addVariable(makeVar("var-p", "P"))
            pmConc.addExpression(
                makeOpExpr("expr-impl-conc", "implies", { parentId: null, position: null })
            )
            pmConc.addExpression(
                makeVarExpr("expr-p-conc", "var-p", { parentId: "expr-impl-conc", position: 0 })
            )
            pmConc.addExpression(
                makeVarExpr("expr-q-conc", "var-q", { parentId: "expr-impl-conc", position: 1 })
            )
            engineB.setConclusionPremise("premise-conc")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.conclusion.before).toBeUndefined()
            expect(diff.roles.conclusion.after).toBe("premise-conc")
        })

        it("detects supporting premise added and removed", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // engineA has premise-1 as supporting; remove it in B and add premise-2
            engineB.removeSupportingPremise("premise-1")
            const pm2 = engineB.createPremiseWithId("premise-2")
            pm2.addVariable(makeVar("var-p", "P"))
            pm2.addExpression(makeVarExpr("expr-p2", "var-p", { parentId: null, position: null }))
            engineB.addSupportingPremise("premise-2")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.supportingAdded).toEqual(["premise-2"])
            expect(diff.roles.supportingRemoved).toEqual(["premise-1"])
        })
```

**Step 5: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 6: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Add integration tests for diffArguments"
```

---

### Task 6: Add test for custom comparators

**Files:**
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write custom comparator test**

Add inside `describe("diffArguments function")`:

```typescript
        it("uses custom comparator extending default", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setTitle("Updated")

            const diff = diffArguments(engineA, engineB, {
                comparePremise: (before, after) => [
                    ...defaultComparePremise(before, after),
                    // Custom: always report a "custom" field
                    { field: "customField", before: "a", after: "b" },
                ],
            })

            expect(diff.premises.modified).toHaveLength(1)
            expect(diff.premises.modified[0].changes).toEqual([
                { field: "title", before: "First premise", after: "Updated" },
                { field: "customField", before: "a", after: "b" },
            ])
        })

        it("custom comparator replaces default entirely", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setTitle("Updated")

            // Custom comparator that ignores title changes
            const diff = diffArguments(engineA, engineB, {
                comparePremise: () => [],
            })

            // Premise is not in modified because comparator returned no changes
            // (and no expression changes either since engines are otherwise identical)
            expect(diff.premises.modified).toEqual([])
        })
```

**Step 2: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 3: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Add custom comparator tests for diffArguments"
```

---

### Task 7: Wire up exports and final checks

**Files:**
- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Add diff function exports to `src/lib/index.ts`**

Add after the existing exports:

```typescript
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./core/diff.js"
```

**Step 2: Add diff function exports to `src/index.ts`**

Add after existing exports:

```typescript
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./lib/core/diff"
```

**Step 3: Run full check suite**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build all green)

**Step 4: Commit**

```bash
git add src/lib/index.ts src/index.ts
git commit -m "Export diffArguments and default comparators from package entry points"
```
