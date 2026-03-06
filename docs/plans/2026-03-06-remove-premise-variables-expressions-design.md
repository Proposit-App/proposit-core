# Remove `variables` and `expressions` from `CorePremiseSchema` — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant `variables` and `expressions` fields from `CorePremiseSchema`, since variables are argument-scoped and expressions are managed by `PremiseEngine`'s `ExpressionManager`.

**Architecture:** The core `TCorePremise` type loses two fields. Callers that need expressions or referenced variables use `PremiseEngine` methods (`getExpressions()`, `getReferencedVariableIds()`) instead of reading them off the premise entity. The CLI disk schema (`CliPremiseDataSchema`) is unchanged — it's a storage concern.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

---

### Task 1: Remove fields from `CorePremiseSchema`

**Files:**

- Modify: `src/lib/schemata/propositional.ts:117-146`

**Step 1: Update the schema**

Remove the `variables` and `expressions` fields from `CorePremiseSchema`. The `CorePropositionalExpressionSchema` import may become unused (check if other code in the file still uses it — it will, since it's exported and used by `CliPremiseDataSchema` and others).

```typescript
export const CorePremiseSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        rootExpressionId: Type.Optional(
            Type.String({
                description:
                    "ID of the root expression, if the premise has expressions.",
            })
        ),
        checksum: Type.String({
            description: "Premise-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A premise containing an expression tree and variable references.",
    }
)
```

**Step 2: Run typecheck to see all downstream breakages**

Run: `pnpm run typecheck`
Expected: Type errors in PremiseEngine, ArgumentEngine, diff.ts, and tests where `.variables` or `.expressions` are accessed on `TCorePremise`.

**Step 3: Commit**

```
Remove variables and expressions fields from CorePremiseSchema
```

---

### Task 2: Update `PremiseEngine`

**Files:**

- Modify: `src/lib/core/PremiseEngine.ts`

**Step 1: Update `getExtras()` (~line 545)**

Remove `variables: _variables` and `expressions: _expressions` from the destructuring:

```typescript
public getExtras(): Record<string, unknown> {
    const {
        id: _id,
        argumentId: _argumentId,
        argumentVersion: _argumentVersion,
        rootExpressionId: _rootExpressionId,
        checksum: _checksum,
        ...extras
    } = this.premise as Record<string, unknown>
    return { ...extras }
}
```

**Step 2: Update `toPremiseData()` (~line 1021)**

Remove `expressions` and `variables` from the return value:

```typescript
public toPremiseData(): TPremise {
    const snap = this.snapshot()
    return {
        ...snap.premise,
        checksum: this.checksum(),
    } as TPremise
}
```

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: Remaining errors in ArgumentEngine, diff.ts, CLI engine.ts, and tests.

**Step 4: Commit**

```
Update PremiseEngine to remove variables/expressions from toPremiseData and getExtras
```

---

### Task 3: Update `ArgumentEngine.fromData()`

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts:628-638`

**Step 1: Remove `variables` and `expressions` from premise destructuring**

In `fromData()`, the premise extras extraction currently strips `variables` and `expressions`. Remove those:

```typescript
const {
    id: _id,
    argumentId: _argumentId,
    argumentVersion: _argumentVersion,
    rootExpressionId: _rootExpressionId,
    checksum: _checksum,
    ...extras
} = premise as unknown as Record<string, unknown>
```

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: Remaining errors only in diff.ts, CLI engine.ts, and tests.

**Step 3: Commit**

```
Update ArgumentEngine.fromData to match simplified CorePremiseSchema
```

---

### Task 4: Update `diffPremiseSet` in `diff.ts`

**Files:**

- Modify: `src/lib/core/diff.ts:145-194` (diffPremiseSet) and `235-289` (diffArguments)

**Step 1: Change `diffPremiseSet` to accept expression maps**

The function currently reads `.expressions` off each premise. Change it to accept before/after expression maps keyed by premise ID:

```typescript
function diffPremiseSet<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
>(
    beforePremises: TPremise[],
    afterPremises: TPremise[],
    beforeExpressions: Map<string, TExpr[]>,
    afterExpressions: Map<string, TExpr[]>,
    comparePremise: TCoreFieldComparator<TPremise>,
    compareExpression: TCoreFieldComparator<TExpr>
): TCorePremiseSetDiff<TPremise, TExpr> {
    const beforeById = new Map(beforePremises.map((p) => [p.id, p]))
    const afterById = new Map(afterPremises.map((p) => [p.id, p]))

    const added: TPremise[] = []
    const removed: TPremise[] = []
    const modified: TCorePremiseDiff<TPremise, TExpr>[] = []

    for (const [id, beforePremise] of beforeById) {
        const afterPremise = afterById.get(id)
        if (!afterPremise) {
            removed.push(beforePremise)
            continue
        }
        const premiseChanges = comparePremise(beforePremise, afterPremise)
        const expressionsDiff = diffEntitySet(
            beforeExpressions.get(id) ?? [],
            afterExpressions.get(id) ?? [],
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
```

**Step 2: Update `diffArguments` to collect expression maps**

```typescript
const premisesA = engineA.listPremises()
const premisesB = engineB.listPremises()
const premiseDataA = premisesA.map((pe) => pe.toPremiseData())
const premiseDataB = premisesB.map((pe) => pe.toPremiseData())
const expressionsA = new Map(
    premisesA.map((pe) => [pe.getId(), pe.getExpressions() as TExpr[]])
)
const expressionsB = new Map(
    premisesB.map((pe) => [pe.getId(), pe.getExpressions() as TExpr[]])
)
```

And pass them to `diffPremiseSet`:

```typescript
premises: diffPremiseSet(
    premiseDataA,
    premiseDataB,
    expressionsA,
    expressionsB,
    comparePrem,
    compareExpr
),
```

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: Remaining errors only in CLI engine.ts and tests.

**Step 4: Commit**

```
Update diffPremiseSet to accept expression maps instead of reading from premise
```

---

### Task 5: Update CLI `persistEngine`

**Files:**

- Modify: `src/cli/engine.ts:146-167`

**Step 1: Get expressions and variables from the engine instead of premise data**

Change `persistEngine` to use `PremiseEngine` methods directly:

```typescript
for (const pm of engine.listPremises()) {
    const data = pm.toPremiseData()
    const {
        id: premiseId,
        argumentId: _a,
        argumentVersion: _av,
        checksum: _c,
        rootExpressionId: _r,
        ...premiseMeta
    } = data as Record<string, unknown>
    await writePremiseMeta(id, arg.version, {
        id: data.id,
        ...premiseMeta,
    } as import("./schemata.js").TCliPremiseMeta)
    await writePremiseData(id, arg.version, data.id, {
        rootExpressionId: data.rootExpressionId,
        variables: [...pm.getReferencedVariableIds()].sort(),
        expressions: pm.getExpressions(),
    })
}
```

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: Remaining errors only in tests.

**Step 3: Commit**

```
Update CLI persistEngine to get expressions/variables from PremiseEngine
```

---

### Task 6: Update tests

**Files:**

- Modify: `test/ExpressionManager.test.ts`

**Step 1: Update `stress test` block (~lines 1152, 1163)**

Replace `pm.toPremiseData().variables` with `pm.getReferencedVariableIds()`:

- Line ~1152: `pm.toPremiseData().variables.includes(referencedVar.id)` → `pm.getReferencedVariableIds().has(referencedVar.id)`
- Line ~1163: `pm.toPremiseData().variables` → `[...pm.getReferencedVariableIds()]`

**Step 2: Update `toArray behaviour` block (~line 917)**

Replace `pm.toPremiseData().expressions.map(...)` with `pm.getExpressions().map(...)`.

**Step 3: Update `PremiseEngine — toData` block (~line 1737)**

Replace `pm.toPremiseData().expressions.map(...)` with `pm.getExpressions().map(...)`.

**Step 4: Update `checksum utilities` block (~line 5357)**

Replace `data.expressions` assertions with `pm.getExpressions()`:

```typescript
const exprs = pm.getExpressions()
expect(exprs).toHaveLength(1)
expect(exprs[0].checksum).toBeDefined()
```

**Step 5: Update `removeExpression — deleteSubtree parameter` block (~lines 6391-6524)**

All `data.expressions` references → `pm.getExpressions()`. Multiple assertions in this block:

- `expect(data.expressions).toHaveLength(N)` → `expect(pm.getExpressions()).toHaveLength(N)`
- `data.expressions.find(...)` → `pm.getExpressions().find(...)`
- `data.expressions[0].id` → `pm.getExpressions()[0].id`

**Step 6: Run all tests**

Run: `pnpm run test`
Expected: All tests pass.

**Step 7: Commit**

```
Update tests to use PremiseEngine methods instead of toPremiseData fields
```

---

### Task 7: Update `fromData` tests (if any construct premises with variables/expressions)

**Files:**

- Modify: `test/ExpressionManager.test.ts`

**Step 1: Check `ArgumentEngine — fromData` describe block**

Search for any test that constructs `TCorePremise` objects with `variables` or `expressions` fields for `fromData()` input. These fields should be removed from the test objects since `TCorePremise` no longer has them. The `fromData()` method receives expressions as a separate parameter, so the test premises just need `{ id, argumentId, argumentVersion, rootExpressionId, checksum }`.

**Step 2: Run all tests**

Run: `pnpm run test`
Expected: All tests pass.

**Step 3: Run full check**

Run: `pnpm run check`
Expected: Typecheck, lint, tests, and build all pass.

**Step 4: Commit**

```
Fix fromData test premises to match simplified CorePremiseSchema
```

---

### Task 8: Update documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md` (if it references premise schema fields)

**Step 1: Update CLAUDE.md**

- Update the `CorePremiseSchema` description in the Architecture section and schemata description to remove mentions of `variables` and `expressions` fields.
- Update `toPremiseData()` description to note it returns premise metadata without variables/expressions.
- Update `fromData()` documentation if it mentions stripping `variables`/`expressions` from premises.

**Step 2: Commit**

```
Update docs for simplified CorePremiseSchema
```
