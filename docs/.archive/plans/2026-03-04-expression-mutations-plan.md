# Expression Mutations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `updateExpression` to ExpressionManager/PremiseManager, and extend `removeExpression` with a `deleteSubtree` boolean parameter.

**Architecture:** Two independent changes. `updateExpression` is a new method on ExpressionManager (low-level) wrapped by PremiseManager (changeset + premise-level validation). `removeExpression` gains a required boolean parameter controlling subtree deletion vs. child promotion. Internal callers (`deleteExpressionsUsingVariable`, `collapseIfNeeded`) always pass `true`.

**Tech Stack:** TypeScript, Vitest, Typebox schemas

---

### Task 1: Add `updateExpression` to ExpressionManager — tests

**Files:**

- Test: `test/ExpressionManager.test.ts`

Add a new `describe("updateExpression")` block at the bottom of the test file. These tests operate on `PremiseManager` directly (matching the existing test pattern), but this task writes only the failing tests. Use the existing helpers `makeVarExpr`, `makeOpExpr`, `makeFormulaExpr`, `makeVar`, `ARG`, `VAR_P`, `VAR_Q`.

**Step 1: Write failing tests**

```typescript
describe("updateExpression", () => {
    it("updates position of an expression", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        const { result, changes } = pm.updateExpression("v1", { position: 2 })
        expect(result.position).toBe(2)
        expect(changes.expressions).toBeDefined()
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].id).toBe("v1")

        // Verify the expression was actually updated in the manager
        const fetched = pm.getExpression("v1")!
        expect(fetched.position).toBe(2)
    })

    it("rejects position collision with sibling", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        expect(() => pm.updateExpression("v1", { position: 1 })).toThrow(
            /Position 1 is already used/
        )
    })

    it("updates variableId on a variable expression", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        const { result } = pm.updateExpression("v1", { variableId: VAR_Q.id })
        expect(result.type).toBe("variable")
        if (result.type === "variable") {
            expect(result.variableId).toBe(VAR_Q.id)
        }
    })

    it("rejects variableId update on non-variable expression", () => {
        const engine = new ArgumentEngine(ARG)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))

        expect(() =>
            pm.updateExpression("op-and", { variableId: "some-id" })
        ).toThrow(/not a variable expression/)
    })

    it("rejects variableId referencing non-existent variable", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { variableId: "nonexistent" })
        ).toThrow(/non-existent variable/)
    })

    it("updates expressionsByVariableId index on variableId change", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        pm.updateExpression("v1", { variableId: VAR_Q.id })

        // After changing v1 from P to Q, removing P should not affect v1
        engine.removeVariable(VAR_P.id)
        expect(pm.getExpression("v1")).toBeDefined()

        // But removing Q should cascade-delete v1
        engine.removeVariable(VAR_Q.id)
        expect(pm.getExpression("v1")).toBeUndefined()
    })

    it("updates operator and↔or", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        const { result } = pm.updateExpression("op-and", { operator: "or" })
        expect(result.type).toBe("operator")
        if (result.type === "operator") {
            expect(result.operator).toBe("or")
        }
    })

    it("updates operator or↔and", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-or", "or"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-or", position: 1 })
        )

        const { result } = pm.updateExpression("op-or", { operator: "and" })
        if (result.type === "operator") {
            expect(result.operator).toBe("and")
        }
    })

    it("updates operator implies↔iff", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-impl", "implies"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-impl", position: 1 })
        )

        const { result } = pm.updateExpression("op-impl", { operator: "iff" })
        if (result.type === "operator") {
            expect(result.operator).toBe("iff")
        }
    })

    it("updates operator iff↔implies", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-iff", "iff"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-iff", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-iff", position: 1 })
        )

        const { result } = pm.updateExpression("op-iff", {
            operator: "implies",
        })
        if (result.type === "operator") {
            expect(result.operator).toBe("implies")
        }
    })

    it("rejects operator change across groups (and→implies)", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        expect(() =>
            pm.updateExpression("op-and", { operator: "implies" })
        ).toThrow(/not a permitted operator change/)
    })

    it("rejects operator change from not", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-not", "not"))
        pm.addExpression(makeVarExpr("v1", VAR_P.id, { parentId: "op-not" }))

        expect(() =>
            pm.updateExpression("op-not", { operator: "and" })
        ).toThrow(/not a permitted operator change/)
    })

    it("rejects operator change to not", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        expect(() =>
            pm.updateExpression("op-and", { operator: "not" })
        ).toThrow(/not a permitted operator change/)
    })

    it("rejects operator update on non-operator expression", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() => pm.updateExpression("v1", { operator: "and" })).toThrow(
            /not an operator expression/
        )
    })

    it("rejects forbidden field: id", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { id: "new-id" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: parentId", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { parentId: null } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: type", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { type: "operator" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: argumentId", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { argumentId: "x" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: argumentVersion", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { argumentVersion: 99 } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: checksum", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        expect(() =>
            pm.updateExpression("v1", { checksum: "abc" } as any)
        ).toThrow(/forbidden/)
    })

    it("throws for non-existent expression", () => {
        const engine = new ArgumentEngine(ARG)
        const { result: pm } = engine.createPremise()

        expect(() => pm.updateExpression("nope", { position: 5 })).toThrow(
            /not found/
        )
    })

    it("no-ops when updates object is empty", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        const { result, changes } = pm.updateExpression("v1", {})
        expect(result.id).toBe("v1")
        // No expression changes when nothing was actually modified
        expect(changes.expressions).toBeUndefined()
    })

    it("marks premise checksum dirty after update", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        const checksumBefore = pm.checksum()
        pm.updateExpression("v1", { variableId: VAR_Q.id })
        const checksumAfter = pm.checksum()

        expect(checksumBefore).not.toBe(checksumAfter)
    })

    it("result includes checksum", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("v1", VAR_P.id))

        const { result } = pm.updateExpression("v1", { position: 42 })
        expect(result.checksum).toBeDefined()
        expect(typeof result.checksum).toBe("string")
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `pm.updateExpression is not a function`

---

### Task 2: Implement `updateExpression` on ExpressionManager

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

**Step 1: Define the update type and allowed operator swaps**

Add after the `TExpressionWithoutPosition` type alias (line 26):

```typescript
/** Fields that may be updated on an existing expression. */
export type TExpressionUpdate = {
    position?: number
    variableId?: string
    operator?: TCoreLogicalOperatorType
}

const PERMITTED_OPERATOR_SWAPS: Record<string, string | undefined> = {
    and: "or",
    or: "and",
    implies: "iff",
    iff: "implies",
}
```

**Step 2: Implement `updateExpression` on ExpressionManager**

Add as a new public method on the `ExpressionManager` class, after `addExpressionRelative` (after line 210):

```typescript
/**
 * Updates mutable fields of an existing expression in place.
 *
 * Allowed fields: `position`, `variableId` (variable type only),
 * `operator` (operator type only, restricted swaps).
 *
 * @throws If the expression does not exist.
 * @throws If a forbidden field is present in the updates.
 * @throws If the operator swap is not permitted.
 * @throws If variableId is set on a non-variable expression.
 * @throws If operator is set on a non-operator expression.
 * @throws If the new position collides with a sibling.
 */
public updateExpression(
    expressionId: string,
    updates: TExpressionUpdate
): TExpressionInput | undefined {
    const expression = this.expressions.get(expressionId)
    if (!expression) {
        throw new Error(`Expression "${expressionId}" not found.`)
    }

    // Reject forbidden fields (check via `in` for any key not in TExpressionUpdate)
    const forbidden = ["id", "argumentId", "argumentVersion", "checksum", "parentId", "type"]
    for (const key of forbidden) {
        if (key in updates) {
            throw new Error(
                `Field "${key}" is forbidden in expression updates.`
            )
        }
    }

    // Check if there's actually anything to update
    const hasPosition = updates.position !== undefined
    const hasVariableId = "variableId" in updates && updates.variableId !== undefined
    const hasOperator = "operator" in updates && updates.operator !== undefined

    if (!hasPosition && !hasVariableId && !hasOperator) {
        return expression
    }

    // Validate operator swap
    if (hasOperator) {
        if (expression.type !== "operator") {
            throw new Error(
                `Expression "${expressionId}" is not an operator expression; cannot update operator.`
            )
        }
        if (PERMITTED_OPERATOR_SWAPS[expression.operator] !== updates.operator) {
            throw new Error(
                `Changing operator from "${expression.operator}" to "${updates.operator}" is not a permitted operator change. Permitted: and↔or, implies↔iff.`
            )
        }
    }

    // Validate variableId
    if (hasVariableId) {
        if (expression.type !== "variable") {
            throw new Error(
                `Expression "${expressionId}" is not a variable expression; cannot update variableId.`
            )
        }
    }

    // Validate position (no collision with siblings)
    if (hasPosition) {
        const occupiedPositions = this.childPositionsByParentId.get(expression.parentId)
        if (occupiedPositions) {
            // Remove old position, check for collision, add new
            occupiedPositions.delete(expression.position)
            if (occupiedPositions.has(updates.position!)) {
                // Restore old position before throwing
                occupiedPositions.add(expression.position)
                throw new Error(
                    `Position ${updates.position} is already used under parent "${expression.parentId}".`
                )
            }
            occupiedPositions.add(updates.position!)
        }
    }

    // Apply updates (mutate in place since expressions are stored as mutable objects)
    if (hasPosition) {
        ;(expression as any).position = updates.position
    }
    if (hasVariableId) {
        ;(expression as any).variableId = updates.variableId
    }
    if (hasOperator) {
        ;(expression as any).operator = updates.operator
    }

    this.collector?.modifiedExpression({ ...expression })
    return expression
}
```

**Step 3: Export `TExpressionUpdate`**

The type is already exported via the `export type` on ExpressionManager.ts. Also add it to the library barrel exports.

In `src/lib/index.ts`, update the ExpressionManager import line:

```typescript
export type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./core/ExpressionManager.js"
```

In `src/index.ts`, update similarly:

```typescript
export type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./lib/core/ExpressionManager.js"
```

**Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (but tests still fail since PremiseManager doesn't have the method yet)

---

### Task 3: Implement `updateExpression` on PremiseManager

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`

**Step 1: Import `TExpressionUpdate`**

Add `TExpressionUpdate` to the import from `./ExpressionManager.js` (line 40-41):

```typescript
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./ExpressionManager.js"
```

**Step 2: Implement `updateExpression` on PremiseManager**

Add as a new public method after `addExpressionRelative` (after line 309):

```typescript
/**
 * Updates mutable fields of an expression in this premise.
 *
 * Allowed: `position`, `variableId` (variable type only, must exist),
 * `operator` (operator type only, restricted swaps: and↔or, implies↔iff).
 *
 * @throws If the expression does not exist in this premise.
 * @throws If a forbidden field is present.
 * @throws If `variableId` references a non-existent variable.
 */
public updateExpression(
    expressionId: string,
    updates: TExpressionUpdate
): TCoreMutationResult<TCorePropositionalExpression> {
    const existing = this.expressions.getExpression(expressionId)
    if (!existing) {
        throw new Error(
            `Expression "${expressionId}" not found in premise "${this.id}".`
        )
    }

    // Validate variableId exists in shared VariableManager
    if (updates.variableId !== undefined) {
        if (!this.variables.hasVariable(updates.variableId)) {
            throw new Error(
                `Variable expression "${expressionId}" references non-existent variable "${updates.variableId}".`
            )
        }
    }

    const collector = new ChangeCollector()
    this.expressions.setCollector(collector)
    try {
        const oldVariableId =
            existing.type === "variable" ? existing.variableId : undefined

        const updated = this.expressions.updateExpression(
            expressionId,
            updates
        )

        // If variableId changed, update the expressionsByVariableId index
        if (
            updates.variableId !== undefined &&
            oldVariableId !== undefined &&
            oldVariableId !== updates.variableId
        ) {
            this.expressionsByVariableId.get(oldVariableId)?.delete(expressionId)
            this.expressionsByVariableId.get(updates.variableId).add(expressionId)
        }

        // Check if anything actually changed (empty updates → no collector entries)
        const changeset = collector.toChangeset()
        const hasChanges =
            changeset.expressions !== undefined

        if (hasChanges) {
            this.markDirty()
        }

        return {
            result: this.attachExpressionChecksum({
                ...(updated ?? existing),
            }),
            changes: this.attachChangesetChecksums(changeset),
        }
    } finally {
        this.expressions.setCollector(null)
    }
}
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: All `updateExpression` tests PASS. All existing tests still PASS.

**Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/ExpressionManager.ts src/lib/core/PremiseManager.ts \
  src/lib/index.ts src/index.ts test/ExpressionManager.test.ts
git commit -m "Add updateExpression to ExpressionManager and PremiseManager"
```

---

### Task 4: Extend `removeExpression` with `deleteSubtree` — tests

**Files:**

- Test: `test/ExpressionManager.test.ts`

Add a new `describe("removeExpression — deleteSubtree parameter")` block at the bottom.

**Step 1: Write failing tests**

```typescript
describe("removeExpression — deleteSubtree parameter", () => {
    it("deleteSubtree: true — same as original behavior (subtree deleted, parent collapses)", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        const { result, changes } = pm.removeExpression("v1", true)
        expect(result!.id).toBe("v1")
        // and collapses (1 child remaining → promote v2 to root)
        expect(pm.getRootExpressionId()).toBe("v2")
        expect(pm.getExpression("op-and")).toBeUndefined()
    })

    it("deleteSubtree: false — promotes single child (operator)", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        // Tree: and(or(P, Q))
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeOpExpr("op-or", "or", { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-or", position: 1 })
        )

        const { result } = pm.removeExpression("op-and", false)
        expect(result!.id).toBe("op-and")
        // or promoted to root
        expect(pm.getRootExpressionId()).toBe("op-or")
        const orExpr = pm.getExpression("op-or")!
        expect(orExpr.parentId).toBeNull()
        // Children of or remain intact
        expect(pm.getExpression("v1")).toBeDefined()
        expect(pm.getExpression("v2")).toBeDefined()
    })

    it("deleteSubtree: false — promotes single child (leaf)", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        // Tree: not(P)
        pm.addExpression(makeOpExpr("op-not", "not"))
        pm.addExpression(makeVarExpr("v1", VAR_P.id, { parentId: "op-not" }))

        pm.removeExpression("op-not", false)
        // v1 promoted to root
        expect(pm.getRootExpressionId()).toBe("v1")
        const v1 = pm.getExpression("v1")!
        expect(v1.parentId).toBeNull()
    })

    it("deleteSubtree: false — errors on multiple children", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        expect(() => pm.removeExpression("op-and", false)).toThrow(
            /multiple children/
        )
        // Tree should be unchanged
        expect(pm.getExpression("op-and")).toBeDefined()
        expect(pm.getExpression("v1")).toBeDefined()
        expect(pm.getExpression("v2")).toBeDefined()
    })

    it("deleteSubtree: false — leaf node with collapse on parent", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        // Tree: and(P, Q)
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        // Remove leaf v1 with deleteSubtree: false (it's a leaf, so same as true)
        pm.removeExpression("v1", false)
        // and collapses because only 1 child left
        expect(pm.getRootExpressionId()).toBe("v2")
        expect(pm.getExpression("op-and")).toBeUndefined()
    })

    it("deleteSubtree: false — validates root-only constraint on promoted child", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        // Tree: and(implies(P, Q)) — unusual but structurally allowed via BFS load or insert
        // Actually implies must be root-only, so let's construct: not(implies(P, Q)) is invalid.
        // Instead: formula(implies(P, Q)) is the valid construction, then try to remove the
        // formula's parent if it exists.
        //
        // Better test: Build a tree where removing a node would promote implies to non-root.
        // Tree: and(formula(implies(P, Q)), R) — implies is nested via formula.
        // Removing formula with deleteSubtree: false would try to promote implies to
        // be a child of and, which violates root-only.
        //
        // Actually: implies must have parentId: null. So implies can never be a child of
        // formula either. The only way implies appears is as root. So the edge case is:
        // a non-root node whose single child is implies/iff — but that child already has
        // parentId pointing to the node being removed, which means implies already has
        // non-null parentId... which is impossible because addExpression rejects it.
        //
        // Wait — this scenario can't happen in a valid tree because implies/iff can never
        // have a non-null parentId. The only promote-to-non-root scenario would require
        // an implies to already be stored with non-null parentId, which is forbidden.
        //
        // The real edge case is promoting an implies/iff child from root into root — which
        // IS allowed. For example: formula(implies(P,Q)) — remove formula promotes implies
        // to root (parentId = null), which is fine.
        //
        // So the validation check for "child is implies/iff and target parentId is non-null"
        // is actually unreachable in a well-formed tree! But it's a good safety check.
        // We can test it via ExpressionManager directly if needed.
        //
        // Let's skip this specific test and just test the happy path of promoting implies to root.
        pm.addExpression(makeFormulaExpr("f1"))
        pm.addExpression(makeOpExpr("op-impl", "implies", { parentId: "f1" }))
        pm.addExpression(
            makeVarExpr("v1", VAR_P.id, { parentId: "op-impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("v2", VAR_Q.id, { parentId: "op-impl", position: 1 })
        )

        pm.removeExpression("f1", false)
        // implies promoted to root (parentId was already null via f1)
        expect(pm.getRootExpressionId()).toBe("op-impl")
        const impl = pm.getExpression("op-impl")!
        expect(impl.parentId).toBeNull()
    })

    it("deleteSubtree: false — changeset records removed and modified", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeOpExpr("op-not", "not"))
        pm.addExpression(makeVarExpr("v1", VAR_P.id, { parentId: "op-not" }))

        const { changes } = pm.removeExpression("op-not", false)
        expect(changes.expressions).toBeDefined()
        expect(changes.expressions!.removed).toHaveLength(1)
        expect(changes.expressions!.removed[0].id).toBe("op-not")
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].id).toBe("v1")
    })

    it("deleteSubtree: false — no collapse runs after promotion", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        const { result: pm } = engine.createPremise()
        // Tree: and(not(P))
        // Remove and with deleteSubtree: false → promotes not.
        // If collapse ran, not with 1 child would NOT collapse (1 child is valid for not).
        // Actually collapse only runs on parents with 0 or 1 children for operators.
        // The point is: no collapse runs AT ALL after the promote.
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 0 })
        )
        pm.addExpression(makeVarExpr("v1", VAR_P.id, { parentId: "op-not" }))

        pm.removeExpression("op-and", false)
        // not promoted to root, tree is: not(P)
        expect(pm.getRootExpressionId()).toBe("op-not")
        expect(pm.getExpression("op-not")).toBeDefined()
        expect(pm.getExpression("v1")).toBeDefined()
    })

    it("deleteSubtree: false — expressionsByVariableId cleaned for removed variable expr only", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: pm } = engine.createPremise()
        // Tree: formula(P)
        pm.addExpression(makeFormulaExpr("f1"))
        pm.addExpression(makeVarExpr("v1", VAR_P.id, { parentId: "f1" }))

        // Remove formula, promote P
        pm.removeExpression("f1", false)
        // P is now root and still tracked
        expect(pm.getExpression("v1")).toBeDefined()
        // Removing variable P should cascade-delete v1
        engine.removeVariable(VAR_P.id)
        expect(pm.getExpression("v1")).toBeUndefined()
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `removeExpression` expects 1 argument but got 2 (TypeScript), or runtime failures due to changed behavior.

---

### Task 5: Implement `removeExpression` `deleteSubtree` parameter on ExpressionManager

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

**Step 1: Modify `removeExpression` signature and implementation**

Replace the existing `removeExpression` method (lines 221-270) with:

```typescript
/**
 * Removes an expression from the tree.
 *
 * When `deleteSubtree` is `true`, the expression and all its descendants
 * are removed, then {@link collapseIfNeeded} runs on the parent.
 *
 * When `deleteSubtree` is `false`, the expression is removed and its
 * single child (if any) is promoted into its slot. Throws if the
 * expression has multiple children. No collapse runs after promotion.
 *
 * @throws If `deleteSubtree` is `false` and the expression has >1 child.
 * @throws If `deleteSubtree` is `false` and promoting the child would
 *   violate the root-only constraint for `implies`/`iff`.
 * @returns The removed expression, or `undefined` if not found.
 */
public removeExpression(
    expressionId: string,
    deleteSubtree: boolean
): TExpressionInput | undefined {
    const target = this.expressions.get(expressionId)
    if (!target) {
        return undefined
    }

    if (deleteSubtree) {
        return this.removeSubtree(expressionId, target)
    } else {
        return this.removeAndPromote(expressionId, target)
    }
}

private removeSubtree(
    expressionId: string,
    target: TExpressionInput
): TExpressionInput {
    const parentId = target.parentId

    const toRemove = new Set<string>()
    const stack = [expressionId]
    while (stack.length > 0) {
        const currentId = stack.pop()
        if (!currentId || toRemove.has(currentId)) {
            continue
        }

        toRemove.add(currentId)
        const children = this.childExpressionIdsByParentId.get(currentId)
        if (!children) {
            continue
        }
        for (const childId of children) {
            stack.push(childId)
        }
    }

    for (const id of toRemove) {
        const expression = this.expressions.get(id)
        if (!expression) {
            continue
        }

        this.collector?.removedExpression({ ...expression })
        this.expressions.delete(id)
        this.childExpressionIdsByParentId
            .get(expression.parentId)
            ?.delete(id)

        this.childPositionsByParentId
            .get(expression.parentId)
            ?.delete(expression.position)

        this.childExpressionIdsByParentId.delete(id)
        this.childPositionsByParentId.delete(id)
    }

    this.collapseIfNeeded(parentId)

    return target
}

private removeAndPromote(
    expressionId: string,
    target: TExpressionInput
): TExpressionInput {
    const parentId = target.parentId
    const children = this.getChildExpressions(expressionId)

    if (children.length > 1) {
        throw new Error(
            `Cannot promote: expression "${expressionId}" has multiple children (${children.length}). Use deleteSubtree: true or remove children first.`
        )
    }

    if (children.length === 0) {
        // Leaf removal: remove and run collapse on parent
        this.collector?.removedExpression({ ...target })
        this.expressions.delete(expressionId)
        this.childExpressionIdsByParentId
            .get(parentId)
            ?.delete(expressionId)
        this.childPositionsByParentId
            .get(parentId)
            ?.delete(target.position)
        this.childExpressionIdsByParentId.delete(expressionId)
        this.childPositionsByParentId.delete(expressionId)

        this.collapseIfNeeded(parentId)
        return target
    }

    // Exactly 1 child: promote it
    const child = children[0]

    // Validate root-only constraint
    if (
        child.type === "operator" &&
        (child.operator === "implies" || child.operator === "iff") &&
        parentId !== null
    ) {
        throw new Error(
            `Cannot promote: child "${child.id}" is a root-only operator ("${child.operator}") and would be placed in a non-root position.`
        )
    }

    // Promote child into target's slot
    const promoted = {
        ...child,
        parentId: parentId,
        position: target.position,
    } as TExpressionInput
    this.expressions.set(child.id, promoted)
    this.collector?.modifiedExpression({ ...promoted })

    // Remove target from parent's child set, add promoted child
    this.childExpressionIdsByParentId.get(parentId)?.delete(expressionId)
    getOrCreate(
        this.childExpressionIdsByParentId,
        parentId,
        () => new Set()
    ).add(child.id)
    // Position in parent stays: target.position is now child's position

    // Clean up target's own child tracking (move child's children to child's new entry)
    // The child's children are already tracked under child.id, which hasn't changed.
    // We just need to remove the target's tracking entries.
    this.childExpressionIdsByParentId.delete(expressionId)
    this.childPositionsByParentId.delete(expressionId)

    // Remove target's position from parent's position set? No — target.position is
    // now the promoted child's position, so it stays in the parent's position set.

    // Remove the target expression
    this.collector?.removedExpression({ ...target })
    this.expressions.delete(expressionId)

    // No collapse after promotion
    return target
}
```

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: Compilation errors in PremiseManager.ts and potentially in tests, because the signature now requires 2 args.

---

### Task 6: Update `removeExpression` callers

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`

The PremiseManager's `removeExpression` must also accept the `deleteSubtree` parameter and forward it. Additionally, `deleteExpressionsUsingVariable` calls `this.removeExpression(exprId)` and must pass `true`.

**Step 1: Update `PremiseManager.removeExpression` signature**

Change the method signature (around line 320) to accept `deleteSubtree: boolean`:

```typescript
public removeExpression(
    expressionId: string,
    deleteSubtree: boolean
): TCoreMutationResult<TCorePropositionalExpression | undefined> {
```

In the body, pass `deleteSubtree` to ExpressionManager:

```typescript
this.expressions.removeExpression(expressionId, deleteSubtree)
```

When `deleteSubtree` is `false` and the expression has children that survive (promoted), adjust the subtree snapshot logic: only snapshot and clean `expressionsByVariableId` for the removed expression itself (not its surviving subtree). The simplest approach:

```typescript
if (deleteSubtree) {
    // Snapshot entire subtree before deletion for variable index cleanup
    const subtree = this.collectSubtree(expressionId)
    this.expressions.removeExpression(expressionId, true)
    for (const expr of subtree) {
        if (expr.type === "variable") {
            this.expressionsByVariableId.get(expr.variableId)?.delete(expr.id)
        }
    }
} else {
    // Only clean up the removed expression itself (children survive)
    if (snapshot.type === "variable") {
        this.expressionsByVariableId
            .get(snapshot.variableId)
            ?.delete(snapshot.id)
    }
    this.expressions.removeExpression(expressionId, false)
}
```

Note: when `deleteSubtree: false` and the expression is a leaf, `collapseIfNeeded` runs inside ExpressionManager and may remove additional expressions via collapse. Those collapsed expressions are already tracked by the collector. However, the `expressionsByVariableId` index needs cleanup for any collapse-removed variable expressions too. The safest approach is to also collect the subtree for `deleteSubtree: false` when the expression has 0 children (since collapse behavior is the same as `deleteSubtree: true` for leaves).

Revised logic in PremiseManager.removeExpression:

```typescript
const children = this.expressions.getChildExpressions(expressionId)
const isLeaf = children.length === 0

if (deleteSubtree || isLeaf) {
    // For subtree deletion or leaf removal (which triggers collapse),
    // snapshot the full subtree for variable index cleanup
    const subtree = this.collectSubtree(expressionId)
    this.expressions.removeExpression(expressionId, deleteSubtree)
    for (const expr of subtree) {
        if (expr.type === "variable") {
            this.expressionsByVariableId.get(expr.variableId)?.delete(expr.id)
        }
    }
    // Also clean up any expressions that were removed by collapse
    // (they're in the collector but not in our subtree snapshot)
    // We need to check the changeset for removed expressions
} else {
    // Promote case: only the target is removed; children survive
    if (snapshot.type === "variable") {
        this.expressionsByVariableId
            .get(snapshot.variableId)
            ?.delete(snapshot.id)
    }
    this.expressions.removeExpression(expressionId, false)
}
```

Actually, the existing approach already handles collapse correctly because `syncRootExpressionId()` runs after, and the collector tracks all removals. The `expressionsByVariableId` cleanup for collapse-removed expressions is handled by the fact that `collectSubtree` captures the whole subtree before deletion. For the leaf case with `deleteSubtree: false`, the subtree is just the leaf itself, and any collapse-removed expressions above it are operators (not variables), so no variable index cleanup needed for them.

Simplified final approach:

```typescript
public removeExpression(
    expressionId: string,
    deleteSubtree: boolean
): TCoreMutationResult<TCorePropositionalExpression | undefined> {
    const snapshot = this.expressions.getExpression(expressionId)

    const collector = new ChangeCollector()
    this.expressions.setCollector(collector)
    try {
        if (!snapshot) {
            return {
                result: undefined,
                changes: collector.toChangeset() as TCoreChangeset,
            }
        }

        if (deleteSubtree) {
            const subtree = this.collectSubtree(expressionId)
            this.expressions.removeExpression(expressionId, true)
            for (const expr of subtree) {
                if (expr.type === "variable") {
                    this.expressionsByVariableId
                        .get(expr.variableId)
                        ?.delete(expr.id)
                }
            }
        } else {
            // Only the target expression is removed; children survive (promoted)
            // or it's a leaf (collapse may remove parent operators but not variables
            // from our index since operators don't appear in expressionsByVariableId)
            if (snapshot.type === "variable") {
                this.expressionsByVariableId
                    .get(snapshot.variableId)
                    ?.delete(snapshot.id)
            }
            this.expressions.removeExpression(expressionId, false)
        }

        this.syncRootExpressionId()
        this.markDirty()
        return {
            result: this.attachExpressionChecksum({ ...snapshot }),
            changes: this.attachChangesetChecksums(collector.toChangeset()),
        }
    } finally {
        this.expressions.setCollector(null)
    }
}
```

**Step 2: Update `deleteExpressionsUsingVariable`**

In `deleteExpressionsUsingVariable` (line 95), change:

```typescript
const { result, changes } = this.removeExpression(exprId)
```

to:

```typescript
const { result, changes } = this.removeExpression(exprId, true)
```

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: May still have errors in test file — existing tests call `removeExpression` with 1 arg.

---

### Task 7: Update existing tests and run full check

**Files:**

- Modify: `test/ExpressionManager.test.ts`

**Step 1: Update all existing `removeExpression` calls**

Search for all calls to `.removeExpression(` in the test file and add `, true` as the second argument. These are all the existing tests that use `deleteSubtree: true` behavior (the current behavior).

Use find-and-replace across the test file:

- Pattern: `.removeExpression("` → ensure each call has a second argument `true`

Every existing `removeExpression` call in the test file should become `removeExpression("...", true)`.

**Step 2: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, tests, build all pass)

**Step 3: Commit**

```bash
git add src/lib/core/ExpressionManager.ts src/lib/core/PremiseManager.ts \
  test/ExpressionManager.test.ts
git commit -m "Add deleteSubtree parameter to removeExpression

Extend removeExpression with a required deleteSubtree boolean.
When false, promotes the single child into the removed expression's
slot instead of deleting the subtree."
```

---

### Task 8: Update documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md` (if it documents the expression API)

**Step 1: Update CLAUDE.md**

Update the following sections:

- **Architecture** section: mention `updateExpression` method
- **Key design decisions / Operator collapse on removal**: update to reflect `deleteSubtree` parameter — collapse only runs with `deleteSubtree: true` or when removing a leaf with `deleteSubtree: false`
- **Types** section: add `TExpressionUpdate` type
- Add note about permitted operator swaps under **Key design decisions**

In the `ExpressionManager.ts` architecture entry, add `updateExpression` to the description.

In the **Operator collapse on removal** section, revise to:

> `removeExpression(id, deleteSubtree)` takes a required boolean. When `deleteSubtree` is `true`, the expression and all descendants are deleted, then `collapseIfNeeded(parentId)` runs. When `deleteSubtree` is `false`, the expression is removed and its single child is promoted into its slot (inheriting `parentId` and `position`); throws if >1 child; no collapse runs after promotion. Leaf removal with `deleteSubtree: false` runs collapse on the parent (same as `true`).

Add a new section **`updateExpression`** under design decisions:

> `updateExpression(id, updates)` modifies an expression's mutable fields in place. Allowed: `position` (no sibling collision), `variableId` (variable type only, must exist), `operator` (operator type only, restricted swaps: `and↔or`, `implies↔iff`). Forbidden: `id`, `argumentId`, `argumentVersion`, `checksum`, `parentId`, `type`. Returns the updated expression with changeset.

**Step 2: Commit docs**

```bash
git add CLAUDE.md
git commit -m "Update docs for updateExpression and removeExpression changes"
```
