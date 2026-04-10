# Auto-Reposition on Position Collision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `repositionOnCollision` auto-normalize flag that triggers targeted sibling redistribution when midpoint-computed positions collide, and improve child spacing in `insertExpression` and `promoteChild`.

**Architecture:** New flag in `TAutoNormalizeConfig`, private `repositionSiblings` method on `ExpressionManager` that shifts only the minimal set of nodes needed. All affected operations (`addExpressionRelative`, `appendExpression`, `insertExpression`, `promoteChild`) delegate to this method when a collision is detected.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add `repositionOnCollision` flag to grammar types

**Files:**

- Modify: `src/lib/types/grammar.ts:21-30` (TAutoNormalizeConfig)

- [ ] **Step 1: Write the failing test**

Add at the bottom of `test/core.test.ts`:

```typescript
describe("repositionOnCollision auto-normalize flag", () => {
    it("resolveAutoNormalize returns true for repositionOnCollision when autoNormalize is true", () => {
        expect(
            resolveAutoNormalize(
                DEFAULT_GRAMMAR_CONFIG,
                "repositionOnCollision"
            )
        ).toBe(true)
    })

    it("resolveAutoNormalize returns false for repositionOnCollision when autoNormalize is false", () => {
        expect(
            resolveAutoNormalize(
                PERMISSIVE_GRAMMAR_CONFIG,
                "repositionOnCollision"
            )
        ).toBe(false)
    })

    it("resolveAutoNormalize returns granular repositionOnCollision value", () => {
        expect(
            resolveAutoNormalize(
                {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: {
                        wrapInsertFormula: false,
                        negationInsertFormula: false,
                        collapseDoubleNegation: false,
                        collapseEmptyFormula: false,
                        repositionOnCollision: true,
                    },
                },
                "repositionOnCollision"
            )
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: TypeScript compilation error — `repositionOnCollision` does not exist on `TAutoNormalizeConfig`.

- [ ] **Step 3: Add the flag to `TAutoNormalizeConfig`**

In `src/lib/types/grammar.ts`, add to `TAutoNormalizeConfig`:

```typescript
export type TAutoNormalizeConfig = {
    /** Insert a formula node when wrapping/inserting creates operator-under-operator. */
    wrapInsertFormula: boolean
    /** Insert a formula buffer when toggleNegation wraps a non-not operator in NOT. */
    negationInsertFormula: boolean
    /** Collapse double negation (NOT(NOT(x)) → x) during toggleNegation and normalize. */
    collapseDoubleNegation: boolean
    /** Collapse empty formulas/operators and promote single children after removal. */
    collapseEmptyFormula: boolean
    /** Auto-redistribute sibling positions when a midpoint collision is detected. */
    repositionOnCollision: boolean
}
```

- [ ] **Step 4: Fix compilation errors in test helpers**

Update `premiseWithVarsGranular` in `test/core.test.ts` to include the new flag:

```typescript
function premiseWithVarsGranular(config: {
    wrapInsertFormula?: boolean
    negationInsertFormula?: boolean
    collapseDoubleNegation?: boolean
    collapseEmptyFormula?: boolean
    repositionOnCollision?: boolean
}): PremiseEngine {
    const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
        grammarConfig: {
            enforceFormulaBetweenOperators: true,
            autoNormalize: {
                wrapInsertFormula: config.wrapInsertFormula ?? false,
                negationInsertFormula: config.negationInsertFormula ?? false,
                collapseDoubleNegation: config.collapseDoubleNegation ?? false,
                collapseEmptyFormula: config.collapseEmptyFormula ?? false,
                repositionOnCollision: config.repositionOnCollision ?? false,
            },
        },
    })
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}
```

Search the codebase for any other places that construct a `TAutoNormalizeConfig` object literal and add `repositionOnCollision` to each one. Common locations: test fixtures, CLI code, any `autoNormalize: { ... }` object literal.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: All tests pass, including the three new ones.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/grammar.ts test/core.test.ts
git commit -m "feat(grammar): add repositionOnCollision flag to TAutoNormalizeConfig"
```

---

### Task 2: Implement `repositionSiblings` on `ExpressionManager`

**Files:**

- Modify: `src/lib/core/expression-manager.ts` (add private method)

- [ ] **Step 1: Write the failing test**

This tests the redistribution via `addExpressionRelative`. Add at the bottom of `test/core.test.ts`, inside the `repositionOnCollision auto-normalize flag` describe block:

```typescript
it("addExpressionRelative redistributes on collision (consecutive positions)", () => {
    const pm = premiseWithVarsGranular({ repositionOnCollision: true })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    // Two children at consecutive positions — midpoint(0, 1) = 0 → collision.
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c2", "var-q", { parentId: "root", position: 1 })
    )

    // Insert after c1 (between positions 0 and 1).
    const { changes } = pm.addExpressionRelative("c1", "after", {
        id: "c3",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "premise-1",
        type: "variable",
        variableId: "var-r",
        parentId: "root",
    })

    // All three children should have distinct positions in sorted order.
    const children = pm.getChildExpressions("root")
    expect(children).toHaveLength(3)
    const positions = children.map((c) => c.position)
    expect(positions[0]).toBeLessThan(positions[1])
    expect(positions[1]).toBeLessThan(positions[2])

    // The changeset should include repositioned siblings in modified.
    expect(changes.expressions).toBeDefined()
    expect(changes.expressions!.modified.length).toBeGreaterThan(0)
    // c3 should be in added.
    expect(changes.expressions!.added.some((e) => e.id === "c3")).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter verbose -t "redistributes on collision" 2>&1 | tail -20`
Expected: FAIL — position collision throws `"Position 0 is already used under parent"`.

- [ ] **Step 3: Implement `repositionSiblings` private method**

Add the following private method to `ExpressionManager` (after the `promoteChild` method, around line 885):

```typescript
/**
 * Redistributes the minimal set of sibling positions to create room at
 * the insertion point. Expands from the insertion point in the direction
 * with fewer nodes until a gap > 1 is found, then evenly spaces those
 * nodes within the available range.
 *
 * @param parentId    The parent whose children are being redistributed.
 * @param leftPos     The position to the left of the insertion point
 *                    (the sibling's position, or `positionConfig.min`).
 * @param rightPos    The position to the right of the insertion point
 *                    (the next sibling's position, or `positionConfig.max`).
 * @returns           The array of modified expressions.
 */
private repositionSiblings(
    parentId: string | null,
    leftPos: number,
    rightPos: number
): TExpr[] {
    const children = this.getChildExpressions(parentId)
    if (children.length === 0) return []

    const positions = children.map((c) => c.position)

    // Find the indices of the left and right boundary nodes.
    const leftIdx = positions.indexOf(leftPos)
    const rightIdx = positions.indexOf(rightPos)

    // Scan left from leftIdx: expand while consecutive gaps <= 1.
    let scanLeft = leftIdx
    while (scanLeft > 0 && positions[scanLeft] - positions[scanLeft - 1] <= 1) {
        scanLeft--
    }
    const leftBound =
        scanLeft > 0 ? positions[scanLeft - 1] : this.positionConfig.min
    const leftCount = leftIdx - scanLeft + 1

    // Scan right from rightIdx: expand while consecutive gaps <= 1.
    let scanRight = rightIdx
    while (
        scanRight < positions.length - 1 &&
        positions[scanRight + 1] - positions[scanRight] <= 1
    ) {
        scanRight++
    }
    const rightBound =
        scanRight < positions.length - 1
            ? positions[scanRight + 1]
            : this.positionConfig.max
    const rightCount = scanRight - rightIdx + 1

    // Pick direction with fewer nodes. Tie-break: right.
    let startIdx: number
    let endIdx: number
    let lowerBound: number
    let upperBound: number

    if (leftCount < rightCount) {
        // Shift left chain: nodes from scanLeft..leftIdx, bounded by (leftBound, rightPos).
        startIdx = scanLeft
        endIdx = leftIdx
        lowerBound = leftBound
        upperBound = rightPos
    } else {
        // Shift right chain: nodes from rightIdx..scanRight, bounded by (leftPos, rightBound).
        startIdx = rightIdx
        endIdx = scanRight
        lowerBound = leftPos
        upperBound = rightBound
    }

    const count = endIdx - startIdx + 1
    const range = upperBound - lowerBound
    if (range <= count) {
        throw new Error(
            `Cannot reposition: not enough space in range (${lowerBound}, ${upperBound}) for ${count} expressions.`
        )
    }

    const modified: TExpr[] = []

    // Clear old positions from the set.
    const positionSet = this.childPositionsByParentId.get(parentId)
    for (let i = startIdx; i <= endIdx; i++) {
        positionSet?.delete(positions[i])
    }

    // Assign evenly spaced positions.
    for (let i = startIdx; i <= endIdx; i++) {
        const newPos = Math.trunc(
            lowerBound + ((upperBound - lowerBound) / (count + 1)) * (i - startIdx + 1)
        )
        const child = children[i]

        const updated = this.attachChecksum({
            ...child,
            position: newPos,
        } as TExpressionInput<TExpr>)
        this.expressions.set(child.id, updated)
        this.collector?.modifiedExpression({
            ...updated,
        } as unknown as TCorePropositionalExpression)
        positionSet?.add(newPos)
        this.markExpressionDirty(child.id)
        modified.push(updated)
    }

    return modified
}
```

- [ ] **Step 4: Update `addExpressionRelative` to use the new method**

Replace the body of `addExpressionRelative` in `src/lib/core/expression-manager.ts`:

```typescript
public addExpressionRelative(
    siblingId: string,
    relativePosition: "before" | "after",
    expression: TExpressionWithoutPosition<TExpr>
): void {
    const sibling = this.expressions.get(siblingId)
    if (!sibling) {
        throw new Error(`Expression "${siblingId}" not found.`)
    }

    const children = this.getChildExpressions(sibling.parentId)
    const siblingIndex = children.findIndex((c) => c.id === siblingId)

    let position: number
    if (relativePosition === "before") {
        const prevPosition =
            siblingIndex > 0
                ? children[siblingIndex - 1].position
                : this.positionConfig.min
        position = midpoint(prevPosition, sibling.position)

        // Collision detection.
        if (position === prevPosition || position === sibling.position) {
            if (
                resolveAutoNormalize(
                    this.grammarConfig,
                    "repositionOnCollision"
                )
            ) {
                this.repositionSiblings(
                    sibling.parentId,
                    prevPosition === this.positionConfig.min
                        ? prevPosition
                        : children[siblingIndex - 1].position,
                    sibling.position
                )
                // Re-fetch children after redistribution.
                const updated = this.getChildExpressions(sibling.parentId)
                const newSiblingIdx = updated.findIndex(
                    (c) => c.id === siblingId
                )
                const newPrevPos =
                    newSiblingIdx > 0
                        ? updated[newSiblingIdx - 1].position
                        : this.positionConfig.min
                position = midpoint(newPrevPos, updated[newSiblingIdx].position)
            }
            // If flag is off, addExpression will throw on the duplicate position.
        }
    } else {
        const nextPosition =
            siblingIndex < children.length - 1
                ? children[siblingIndex + 1].position
                : this.positionConfig.max
        position = midpoint(sibling.position, nextPosition)

        // Collision detection.
        if (position === sibling.position || position === nextPosition) {
            if (
                resolveAutoNormalize(
                    this.grammarConfig,
                    "repositionOnCollision"
                )
            ) {
                this.repositionSiblings(
                    sibling.parentId,
                    sibling.position,
                    nextPosition === this.positionConfig.max
                        ? nextPosition
                        : children[siblingIndex + 1].position
                )
                // Re-fetch children after redistribution.
                const updated = this.getChildExpressions(sibling.parentId)
                const newSiblingIdx = updated.findIndex(
                    (c) => c.id === siblingId
                )
                const newNextPos =
                    newSiblingIdx < updated.length - 1
                        ? updated[newSiblingIdx + 1].position
                        : this.positionConfig.max
                position = midpoint(
                    updated[newSiblingIdx].position,
                    newNextPos
                )
            }
            // If flag is off, addExpression will throw on the duplicate position.
        }
    }

    this.addExpression({
        ...expression,
        parentId: sibling.parentId,
        position,
    } as TExpressionInput<TExpr>)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests pass, including the new collision test.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
If lint errors, run: `pnpm eslint . --fix && pnpm run prettify`

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat(expression-manager): add repositionSiblings and collision handling in addExpressionRelative"
```

---

### Task 3: Add collision handling to `appendExpression`

**Files:**

- Modify: `src/lib/core/expression-manager.ts:485-502` (appendExpression)

- [ ] **Step 1: Write the failing test**

Add inside the `repositionOnCollision auto-normalize flag` describe block:

```typescript
it("appendExpression redistributes when last child is at POSITION_MAX - 1", () => {
    const pm = premiseWithVarsGranular({ repositionOnCollision: true })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    pm.addExpression(
        makeVarExpr("c1", "var-p", {
            parentId: "root",
            position: POSITION_MAX - 1,
        })
    )

    const { changes } = pm.appendExpression("root", {
        id: "c2",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "premise-1",
        type: "variable",
        variableId: "var-q",
        parentId: "root",
    })

    const children = pm.getChildExpressions("root")
    expect(children).toHaveLength(2)
    expect(children[0].position).toBeLessThan(children[1].position)
    // c1 should have been repositioned.
    expect(changes.expressions!.modified.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter verbose -t "appendExpression redistributes" 2>&1 | tail -20`
Expected: FAIL — position collision.

- [ ] **Step 3: Update `appendExpression` with collision handling**

Replace the `appendExpression` method:

```typescript
public appendExpression(
    parentId: string | null,
    expression: TExpressionWithoutPosition<TExpr>
): void {
    const children = this.getChildExpressions(parentId)
    if (children.length === 0) {
        this.addExpression({
            ...expression,
            parentId,
            position: this.positionConfig.initial,
        } as TExpressionInput<TExpr>)
        return
    }

    const lastChild = children[children.length - 1]
    let position = midpoint(lastChild.position, this.positionConfig.max)

    // Collision detection.
    if (position === lastChild.position) {
        if (
            resolveAutoNormalize(
                this.grammarConfig,
                "repositionOnCollision"
            )
        ) {
            this.repositionSiblings(
                parentId,
                lastChild.position,
                this.positionConfig.max
            )
            const updated = this.getChildExpressions(parentId)
            const newLast = updated[updated.length - 1]
            position = midpoint(newLast.position, this.positionConfig.max)
        }
        // If flag is off, addExpression will throw on the duplicate position.
    }

    this.addExpression({
        ...expression,
        parentId,
        position,
    } as TExpressionInput<TExpr>)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat(expression-manager): add collision handling to appendExpression"
```

---

### Task 4: Fix `insertExpression` child spacing

**Files:**

- Modify: `src/lib/core/expression-manager.ts:1635-1641` (insertExpression reparent calls)

- [ ] **Step 1: Write the failing test**

Add inside the `repositionOnCollision auto-normalize flag` describe block:

```typescript
it("insertExpression uses evenly-spaced child positions instead of 0 and 1", () => {
    const pm = premiseWithVars()
    // Two root siblings.
    pm.addExpression(
        makeVarExpr("left", "var-p", { parentId: null, position: 0 })
    )
    pm.addExpression(
        makeVarExpr("right", "var-q", { parentId: null, position: 100 })
    )

    // Insert an AND operator wrapping both.
    pm.insertExpression(
        makeOpExpr("op", "and", { parentId: null, position: 0 }),
        "left",
        "right"
    )

    const children = pm.getChildExpressions("op")
    expect(children).toHaveLength(2)
    // Should be spaced like wrapExpression: POSITION_INITIAL and midpoint(POSITION_INITIAL, POSITION_MAX).
    expect(children[0].position).toBe(POSITION_INITIAL)
    expect(children[1].position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
})

it("insertExpression with single child uses POSITION_INITIAL", () => {
    const pm = premiseWithVars()
    pm.addExpression(
        makeVarExpr("child", "var-p", { parentId: null, position: 50 })
    )

    pm.insertExpression(
        makeOpExpr("op", "not", { parentId: null, position: 0 }),
        "child"
    )

    const children = pm.getChildExpressions("op")
    expect(children).toHaveLength(1)
    expect(children[0].position).toBe(POSITION_INITIAL)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter verbose -t "insertExpression uses evenly-spaced" 2>&1 | tail -20`
Expected: FAIL — children have positions 0 and 1 instead of the midpoint-spaced values.

- [ ] **Step 3: Update `insertExpression` child positions**

In `src/lib/core/expression-manager.ts`, replace the hardcoded position logic in `insertExpression` (around line 1635-1641):

Find:

```typescript
// Reparent rightNode first in case it is a descendant of leftNode.
if (rightNodeId !== undefined) {
    this.reparent(rightNodeId, expression.id, 1)
}
if (leftNodeId !== undefined) {
    this.reparent(leftNodeId, expression.id, 0)
}
```

Replace with:

```typescript
// Compute child positions (midpoint-spaced for future bisection),
// matching the pattern used by wrapExpression.
let leftPosition: number
let rightPosition: number
if (leftNodeId !== undefined && rightNodeId !== undefined) {
    leftPosition = this.positionConfig.initial
    rightPosition = midpoint(
        this.positionConfig.initial,
        this.positionConfig.max
    )
} else if (leftNodeId !== undefined) {
    leftPosition = this.positionConfig.initial
    rightPosition = this.positionConfig.initial // unused
} else {
    leftPosition = this.positionConfig.initial // unused
    rightPosition = this.positionConfig.initial
}

// Reparent rightNode first in case it is a descendant of leftNode.
if (rightNodeId !== undefined) {
    this.reparent(rightNodeId, expression.id, rightPosition)
}
if (leftNodeId !== undefined) {
    this.reparent(leftNodeId, expression.id, leftPosition)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests pass. Existing `insertExpression` tests should still pass since they don't assert on exact child positions (verify this — if any test asserts `position: 0` or `position: 1` for reparented children, update those assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "fix(expression-manager): use midpoint-spaced positions in insertExpression instead of hardcoded 0 and 1"
```

---

### Task 5: Improve `promoteChild` positioning

**Files:**

- Modify: `src/lib/core/expression-manager.ts:855-885` (promoteChild)

- [ ] **Step 1: Write the failing test**

Add inside the `repositionOnCollision auto-normalize flag` describe block:

```typescript
it("promoteChild uses midpoint of neighbors instead of parent position", () => {
    const pm = premiseWithVarsGranular({
        repositionOnCollision: true,
        collapseEmptyFormula: true,
    })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    // Three children: 0, 1, 100.
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeFormulaExpr("mid-formula", { parentId: "root", position: 1 })
    )
    pm.addExpression(
        makeOpExpr("mid-op", "and", { parentId: "mid-formula", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("mid-child", "var-q", { parentId: "mid-op", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c3", "var-r", { parentId: "root", position: 100 })
    )

    // Remove mid-child → mid-op collapses (0 children) → mid-formula collapses →
    // mid-child gets promoted into mid-formula's slot at position 1.
    // With repositionOnCollision, it should get midpoint(0, 100) = 50 instead.
    pm.removeExpression("mid-child", true)

    // After collapse, mid-formula and mid-op are gone.
    // Only c1 and c3 remain under root (mid-child was deleted with subtree).
    const children = pm.getChildExpressions("root")
    expect(children).toHaveLength(2)
    expect(children[0].id).toBe("c1")
    expect(children[1].id).toBe("c3")
})

it("promoteChild with repositionOnCollision uses midpoint of neighbors", () => {
    const pm = premiseWithVarsGranular({
        repositionOnCollision: true,
        collapseEmptyFormula: true,
    })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    // A formula wrapping a single variable — will collapse when its child collapses.
    pm.addExpression(makeFormulaExpr("wrap", { parentId: "root", position: 1 }))
    pm.addExpression(
        makeOpExpr("inner-and", "and", { parentId: "wrap", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("inner-left", "var-q", {
            parentId: "inner-and",
            position: 0,
        })
    )
    pm.addExpression(
        makeVarExpr("inner-right", "var-r", {
            parentId: "inner-and",
            position: 100,
        })
    )
    pm.addExpression(
        makeVarExpr("c3", "var-p", { parentId: "root", position: 100 })
    )

    // Remove inner-left → inner-and has 1 child → inner-right promoted into inner-and's slot.
    // wrap still has the binary operator, so it stays (formula justified).
    // But inner-right should now be the only child of wrap.
    pm.removeExpression("inner-left", true)

    // inner-right gets promoted to inner-and's position under wrap.
    // Then formula collapse: wrap has 1 child and no binary operator → promote inner-right to root.
    // With repositionOnCollision: inner-right gets midpoint(0, 100) = 50 instead of 1.
    const children = pm.getChildExpressions("root")
    const promoted = children.find((c) => c.id === "inner-right")
    expect(promoted).toBeDefined()
    expect(promoted!.position).toBe(midpoint(0, 100))
})
```

Note: the exact test fixture may need adjustment depending on how the collapse chain behaves. The key assertion is: after promotion, the promoted child's position is `midpoint(leftNeighborPos, rightNeighborPos)` rather than the parent's old position. Write the simplest fixture that triggers a `promoteChild` where the parent has left and right siblings, and verify the promoted child lands at the midpoint.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter verbose -t "promoteChild.*midpoint" 2>&1 | tail -20`
Expected: FAIL — promoted child has position 1 (parent's old position), not 50.

- [ ] **Step 3: Update `promoteChild` to compute better position**

Replace the `promoteChild` method in `src/lib/core/expression-manager.ts`:

```typescript
private promoteChild(parentId: string, parent: TExpr, child: TExpr): void {
    const grandparentId = parent.parentId
    let promotedPosition = parent.position

    // When repositionOnCollision is enabled and the grandparent has multiple
    // children, compute the midpoint between the parent's left and right
    // neighbors for better spacing.
    if (
        grandparentId !== null &&
        resolveAutoNormalize(this.grammarConfig, "repositionOnCollision")
    ) {
        const siblings = this.getChildExpressions(grandparentId)
        if (siblings.length > 1) {
            const parentIdx = siblings.findIndex((s) => s.id === parentId)
            const leftPos =
                parentIdx > 0
                    ? siblings[parentIdx - 1].position
                    : this.positionConfig.min
            const rightPos =
                parentIdx < siblings.length - 1
                    ? siblings[parentIdx + 1].position
                    : this.positionConfig.max
            promotedPosition = midpoint(leftPos, rightPos)
        }
    }

    const promoted = this.attachChecksum({
        ...child,
        parentId: grandparentId,
        position: promotedPosition,
    } as TExpressionInput<TExpr>)
    this.expressions.set(child.id, promoted)
    this.collector?.modifiedExpression({
        ...promoted,
    } as unknown as TCorePropositionalExpression)

    this.childExpressionIdsByParentId.get(grandparentId)?.delete(parentId)
    getOrCreate(
        this.childExpressionIdsByParentId,
        grandparentId,
        () => new Set()
    ).add(child.id)

    // Update position tracking: remove parent's old position, add promoted position.
    this.childPositionsByParentId.get(grandparentId)?.delete(parent.position)
    getOrCreate(
        this.childPositionsByParentId,
        grandparentId,
        () => new Set()
    ).add(promotedPosition)

    this.childExpressionIdsByParentId.delete(parentId)
    this.childPositionsByParentId.delete(parentId)
    this.collector?.removedExpression({
        ...parent,
    } as unknown as TCorePropositionalExpression)
    this.expressions.delete(parentId)

    this.dirtyExpressionIds.delete(parentId)
    this.markExpressionDirty(child.id)
}
```

Note: the original `promoteChild` did NOT update `childPositionsByParentId` for the grandparent (it relied on inheriting the parent's exact position, which was already in the set). With the new midpoint-based position, we must remove the old position and add the new one. Even when the flag is off (position unchanged), this bookkeeping is harmless and more correct.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
If lint errors: `pnpm eslint . --fix && pnpm run prettify`

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat(expression-manager): improve promoteChild positioning with midpoint of neighbors"
```

---

### Task 6: Additional test coverage

**Files:**

- Modify: `test/core.test.ts`

- [ ] **Step 1: Add remaining test cases**

Add inside the `repositionOnCollision auto-normalize flag` describe block:

```typescript
it("no collision when gap is wide — no repositioning", () => {
    const pm = premiseWithVarsGranular({ repositionOnCollision: true })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c2", "var-q", { parentId: "root", position: 1000 })
    )

    const { changes } = pm.addExpressionRelative("c1", "after", {
        id: "c3",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "premise-1",
        type: "variable",
        variableId: "var-r",
        parentId: "root",
    })

    const children = pm.getChildExpressions("root")
    expect(children).toHaveLength(3)
    expect(children[1].id).toBe("c3")
    expect(children[1].position).toBe(midpoint(0, 1000))
    // No repositioning needed — modified should be empty or absent.
    const modifiedNonC3 = (changes.expressions?.modified ?? []).filter(
        (e) => e.id !== "c3"
    )
    expect(modifiedNonC3).toHaveLength(0)
})

it("flag disabled — collision throws", () => {
    const pm = premiseWithVarsGranular({ repositionOnCollision: false })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c2", "var-q", { parentId: "root", position: 1 })
    )

    expect(() =>
        pm.addExpressionRelative("c1", "after", {
            id: "c3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-r",
            parentId: "root",
        })
    ).toThrow(/Position.*already used/)
})

it("three consecutive children — tight chain shifts minimally", () => {
    const pm = premiseWithVarsGranular({ repositionOnCollision: true })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c2", "var-q", { parentId: "root", position: 1 })
    )
    pm.addExpression(
        makeVarExpr("c3", "var-r", { parentId: "root", position: 2 })
    )

    const { changes } = pm.addExpressionRelative("c1", "after", {
        id: "c4",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "premise-1",
        type: "variable",
        variableId: "var-p",
        parentId: "root",
    })

    const children = pm.getChildExpressions("root")
    expect(children).toHaveLength(4)
    const positions = children.map((c) => c.position)
    // All positions should be strictly increasing.
    for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
    // c1 at position 0 should NOT have been repositioned (it's outside the tight chain).
    expect(children[0].id).toBe("c1")
    expect(children[0].position).toBe(0)
    // modified should contain the repositioned siblings but NOT c1.
    expect(changes.expressions!.modified.some((e) => e.id === "c1")).toBe(false)
})

it("tight chain direction — shifts toward gap with fewer nodes", () => {
    const pm = premiseWithVarsGranular({ repositionOnCollision: true })
    pm.addExpression(makeOpExpr("root", "and", { parentId: null, position: 0 }))
    // Positions: 0, 5, 6, 7, 100
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c2", "var-q", { parentId: "root", position: 5 })
    )
    pm.addExpression(
        makeVarExpr("c3", "var-r", { parentId: "root", position: 6 })
    )
    pm.addExpression(
        makeVarExpr("c4", "var-p", { parentId: "root", position: 7 })
    )
    pm.addExpression(
        makeVarExpr("c5", "var-q", { parentId: "root", position: 100 })
    )

    // Insert between c2 (5) and c3 (6).
    pm.addExpressionRelative("c2", "after", {
        id: "new",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "premise-1",
        type: "variable",
        variableId: "var-r",
        parentId: "root",
    })

    const children = pm.getChildExpressions("root")
    expect(children).toHaveLength(6)
    // c1 at 0 and c5 at 100 should be untouched.
    expect(children.find((c) => c.id === "c1")!.position).toBe(0)
    expect(children.find((c) => c.id === "c5")!.position).toBe(100)
    // c2 at 5 should be untouched (left of insertion, not in the right chain).
    expect(children.find((c) => c.id === "c2")!.position).toBe(5)
})

it("promoteChild at root keeps parent position", () => {
    // An operator at root with a single child. Removing a sibling triggers
    // collapse → child promoted to root slot. At root (grandparentId: null)
    // the new midpoint logic is skipped — child keeps the parent's position.
    const pm = premiseWithVarsGranular({
        repositionOnCollision: true,
        collapseEmptyFormula: true,
    })
    pm.addExpression(
        makeOpExpr("root", "and", { parentId: null, position: 42 })
    )
    pm.addExpression(
        makeVarExpr("c1", "var-p", { parentId: "root", position: 0 })
    )
    pm.addExpression(
        makeVarExpr("c2", "var-q", { parentId: "root", position: 100 })
    )

    // Remove c2 → root-and has 1 child → c1 promoted into root's slot.
    pm.removeExpression("c2", true)

    // c1 should have root's old position (42), not midpoint of neighbors.
    const expressions = pm.getChildExpressions(null)
    expect(expressions).toHaveLength(1)
    expect(expressions[0].id).toBe("c1")
    expect(expressions[0].position).toBe(42)
})
```

The `promoteChild at root` test verifies the guard: when `grandparentId` is `null`, the promoted child inherits the parent's exact position regardless of the flag.

- [ ] **Step 2: Run tests to verify they all pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add comprehensive coverage for repositionOnCollision flag"
```

---

### Task 7: Documentation sync

**Files:**

- Modify: `CLAUDE.md` — update `TAutoNormalizeConfig` description in "Granular auto-normalize" design rule
- Modify: `docs/release-notes/upcoming.md` — add user-facing note
- Modify: `docs/changelogs/upcoming.md` — add developer changelog entry
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` — update JSDoc for `addExpressionRelative` to mention collision handling
- Delete: `docs/change-requests/2026-04-09-auto-reposition-on-collision.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "Granular auto-normalize" design rule, add `repositionOnCollision` to the list of flags:

Find the line listing the four flags (`wrapInsertFormula`, `negationInsertFormula`, `collapseDoubleNegation`, `collapseEmptyFormula`) and add: `repositionOnCollision` (auto-redistribute sibling positions when a midpoint collision is detected during `addExpressionRelative`, `appendExpression`, or `promoteChild`; also controls improved child spacing in `insertExpression`).

- [ ] **Step 2: Update premise-engine.interfaces.ts JSDoc**

Update the JSDoc for `addExpressionRelative` to mention that when `repositionOnCollision` is enabled, sibling positions are automatically redistributed on collision.

- [ ] **Step 3: Update release notes and changelog**

Add entries to `docs/release-notes/upcoming.md` and `docs/changelogs/upcoming.md` describing the new flag and behavior.

- [ ] **Step 4: Delete the change request**

```bash
rm docs/change-requests/2026-04-09-auto-reposition-on-collision.md
```

- [ ] **Step 5: Run full check**

```bash
pnpm run check
```

Expected: All checks pass (typecheck, lint, test, build).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/ src/lib/core/interfaces/premise-engine.interfaces.ts
git commit -m "docs: update for repositionOnCollision flag, delete change request"
```
