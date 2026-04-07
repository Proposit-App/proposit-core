# Auto-Normalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate operator collapse on `autoNormalize`, add formula collapse for formulas without binary operator descendants, expose a public `normalize()` API, and add post-load normalization.

**Architecture:** Extend `collapseIfNeeded` in `ExpressionManager` to (a) early-return when `autoNormalize` is false and (b) handle formulas whose bounded subtree has no `and`/`or`. Add recursion after operator promotion so formula collapse cascades correctly. Expose `normalize()` through `ExpressionManager` → `PremiseEngine` → `ArgumentEngine`. Post-load normalization runs as a deferred sweep after `fromSnapshot`/`fromData` finishes loading.

**Tech Stack:** TypeScript, Vitest

---

## File Map

- **Modify:** `src/lib/types/grammar.ts` — change `DEFAULT_GRAMMAR_CONFIG.autoNormalize` to `true`, update JSDoc
- **Modify:** `src/lib/core/expression-manager.ts` — gate `collapseIfNeeded`, add `hasBinaryOperatorInBoundedSubtree`, extend formula branch, add recursion after operator promotion, gate `simulateCollapseChain`, add `normalize()`, add `promoteChild()`, add `simulatePostPromotionCollapse()`
- **Modify:** `src/lib/core/premise-engine.ts` — add `normalizeExpressions()` public method
- **Modify:** `src/lib/core/argument-engine.ts` — add `normalizeAllExpressions()` public method, add post-load normalization in `fromSnapshot`/`fromData`
- **Modify:** `test/core.test.ts` — new test cases + updates to existing tests

---

### Task 1: Gate `collapseIfNeeded` on `autoNormalize` and change default

**Files:**
- Modify: `src/lib/types/grammar.ts:31-34`
- Modify: `src/lib/core/expression-manager.ts:819` (`collapseIfNeeded`)
- Modify: `src/lib/core/expression-manager.ts:1074` (`simulateCollapseChain`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write tests for gated collapse behavior**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("autoNormalize gating", () => {
    it("does not collapse operator with 0 children when autoNormalize is false", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: false,
                autoNormalize: false,
            },
        })
        em.addExpression({
            id: "op-not",
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p",
            type: "variable",
            variableId: VAR_P.id,
            parentId: "op-not",
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)

        em.removeExpression("v-p", true)

        // op-not has 0 children but survives because autoNormalize is false
        expect(em.getExpression("op-not")).toBeDefined()
    })

    it("does not promote sole child of operator when autoNormalize is false", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: false,
                autoNormalize: false,
            },
        })
        em.addExpression({
            id: "op-and",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p",
            type: "variable",
            variableId: VAR_P.id,
            parentId: "op-and",
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-q",
            type: "variable",
            variableId: VAR_Q.id,
            parentId: "op-and",
            position: 1,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)

        em.removeExpression("v-p", true)

        // op-and has 1 child but is NOT collapsed because autoNormalize is false
        expect(em.getExpression("op-and")).toBeDefined()
        expect(em.getExpression("v-q")!.parentId).toBe("op-and")
    })

    it("collapse still works with autoNormalize true (default)", () => {
        const em = new ExpressionManager()  // uses DEFAULT_GRAMMAR_CONFIG
        em.addExpression({
            id: "op-and",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p",
            type: "variable",
            variableId: VAR_P.id,
            parentId: "op-and",
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-q",
            type: "variable",
            variableId: VAR_Q.id,
            parentId: "op-and",
            position: 1,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
        } as TExpressionInput)

        em.removeExpression("v-p", true)

        // op-and collapses: v-q promoted to root
        expect(em.getExpression("op-and")).toBeUndefined()
        expect(em.getExpression("v-q")!.parentId).toBeNull()
    })

    it("simulateCollapseChain is skipped when autoNormalize is false", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: false,
            },
        })
        // Build: and → [formula → or → [P, Q], R]
        em.addExpression({
            id: "op-and", type: "operator", operator: "and",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "formula-1", type: "formula",
            parentId: "op-and", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "op-or", type: "operator", operator: "or",
            parentId: "formula-1", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p", type: "variable", variableId: VAR_P.id,
            parentId: "op-or", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-q", type: "variable", variableId: VAR_Q.id,
            parentId: "op-or", position: 1,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-r", type: "variable", variableId: VAR_R.id,
            parentId: "op-and", position: 1,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        // With autoNormalize:false, removing formula-1 (deleteSubtree:false) does
        // NOT trigger collapse simulation, so the promotion safety check that would
        // normally throw is never reached. The expression just gets removed.
        // However, removeAndPromote promotion validation is independent and still throws.
        expect(() => em.removeExpression("formula-1", false)).toThrowError(
            /would promote a non-not operator/
        )
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "autoNormalize gating"`
Expected: First two tests fail (collapse still happens unconditionally), third passes, fourth passes.

- [ ] **Step 3: Change `DEFAULT_GRAMMAR_CONFIG` and gate `collapseIfNeeded`**

In `src/lib/types/grammar.ts`, change the default and update JSDoc:

```typescript
/** Default config: all rules enforced, auto-normalize on. */
export const DEFAULT_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: true,
    autoNormalize: true,
}
```

In `src/lib/core/expression-manager.ts`, add early return at the top of `collapseIfNeeded` (line 819):

```typescript
private collapseIfNeeded(operatorId: string | null): void {
    if (!this.grammarConfig.autoNormalize) return
    if (operatorId === null) return
    // ... rest unchanged
```

In `src/lib/core/expression-manager.ts`, add early return at the top of `simulateCollapseChain` (line 1074):

```typescript
private simulateCollapseChain(
    operatorId: string | null,
    removedChildId: string
): void {
    if (!this.grammarConfig.autoNormalize) return
    if (operatorId === null) return
    // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "autoNormalize gating"`
Expected: All 4 tests PASS.

- [ ] **Step 5: Update existing tests broken by default change**

The test "fromSnapshot with default config rejects operator-under-operator" (line ~15498) now auto-normalizes instead of throwing. Update it:

```typescript
it("fromSnapshot with default config auto-normalizes operator-under-operator", () => {
    const em = ExpressionManager.fromSnapshot({
        expressions: [
            {
                id: "op-and",
                type: "operator",
                operator: "and",
                parentId: null,
                position: 0,
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: "premise-1",
                checksum: "",
            },
            {
                id: "op-or",
                type: "operator",
                operator: "or",
                parentId: "op-and",
                position: 0,
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: "premise-1",
                checksum: "",
            },
        ] as TCorePropositionalExpression[],
    })
    // Default config now has autoNormalize: true — formula buffer auto-inserted
    const orExpr = em.getExpression("op-or")!
    expect(orExpr).toBeDefined()
    expect(orExpr.parentId).not.toBe("op-and")
    const formulaExpr = em.getExpression(orExpr.parentId!)!
    expect(formulaExpr.type).toBe("formula")
    expect(formulaExpr.parentId).toBe("op-and")
})
```

The test "fromData with no grammar config defaults to strict enforcement" (line ~15600) also needs updating. The first assertion (expects throw) should now expect success with auto-normalization:

```typescript
it("fromData with no grammar config defaults to auto-normalize", () => {
    // ... same setup ...
    // Default config now has autoNormalize: true — auto-normalizes instead of throwing
    const engine = ArgumentEngine.fromData(
        arg, aLib(), sLib(), csLib(),
        variables, premises, expressions,
        { conclusionPremiseId: "p1" }
    )
    // or is now wrapped in an auto-inserted formula under and
    const pe = engine.findPremiseByExpressionId("e-or")!
    const orExpr = pe.getExpression("e-or")!
    expect(orExpr.parentId).not.toBe("e-and")
    const formulaExpr = pe.getExpression(orExpr.parentId!)!
    expect(formulaExpr.type).toBe("formula")
    expect(formulaExpr.parentId).toBe("e-and")
    // Explicit permissive config still allows bare operator-under-operator
    expect(() =>
        ArgumentEngine.fromData(
            arg, aLib(), sLib(), csLib(),
            variables, premises, expressions,
            { conclusionPremiseId: "p1" },
            { grammarConfig: PERMISSIVE_GRAMMAR_CONFIG },
            PERMISSIVE_GRAMMAR_CONFIG
        )
    ).not.toThrow()
})
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/grammar.ts src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "refactor: gate collapseIfNeeded on autoNormalize, change default to true"
```

---

### Task 2: Add `hasBinaryOperatorInBoundedSubtree` helper and formula collapse

**Files:**
- Modify: `src/lib/core/expression-manager.ts:819-843` (`collapseIfNeeded` formula branch)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write tests for formula collapse**

Add to the "autoNormalize gating" describe block:

```typescript
it("collapses formula whose sole child is a variable", () => {
    const em = new ExpressionManager()
    // Build: or → [formula → and → [P, Q], R]
    em.addExpression({
        id: "op-or", type: "operator", operator: "or",
        parentId: null, position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "formula-1", type: "formula",
        parentId: "op-or", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-and", type: "operator", operator: "and",
        parentId: "formula-1", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-p", type: "variable", variableId: VAR_P.id,
        parentId: "op-and", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-q", type: "variable", variableId: VAR_Q.id,
        parentId: "op-and", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-r", type: "variable", variableId: VAR_R.id,
        parentId: "op-or", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)

    // Remove v-p: and has 1 child (v-q) → operator collapse promotes v-q into formula
    // formula now has v-q (a variable, no binary operator) → formula collapses
    // v-q promoted into op-or at position 0
    em.removeExpression("v-p", true)

    expect(em.getExpression("op-and")).toBeUndefined()
    expect(em.getExpression("formula-1")).toBeUndefined()
    expect(em.getExpression("v-q")!.parentId).toBe("op-or")
})

it("does not collapse formula whose child is a binary operator", () => {
    const em = new ExpressionManager()
    // Build: or → [formula → and → [P, Q, R], S]
    em.addExpression({
        id: "op-or", type: "operator", operator: "or",
        parentId: null, position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "formula-1", type: "formula",
        parentId: "op-or", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-and", type: "operator", operator: "and",
        parentId: "formula-1", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-p", type: "variable", variableId: VAR_P.id,
        parentId: "op-and", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-q", type: "variable", variableId: VAR_Q.id,
        parentId: "op-and", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-r", type: "variable", variableId: VAR_R.id,
        parentId: "op-and", position: 2,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-s", type: "variable", variableId: VAR_P.id,
        parentId: "op-or", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)

    // Remove v-p: and has 2 children (v-q, v-r) → no operator collapse
    // formula still wraps and (a binary operator) → no formula collapse
    em.removeExpression("v-p", true)

    expect(em.getExpression("formula-1")).toBeDefined()
    expect(em.getExpression("op-and")).toBeDefined()
})

it("collapses formula whose child is not → variable (no binary op)", () => {
    const em = new ExpressionManager({
        grammarConfig: {
            enforceFormulaBetweenOperators: false,
            autoNormalize: true,
        },
    })
    // Build: and → [formula → not → P, Q]
    em.addExpression({
        id: "op-and", type: "operator", operator: "and",
        parentId: null, position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "formula-1", type: "formula",
        parentId: "op-and", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-not", type: "operator", operator: "not",
        parentId: "formula-1", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-p", type: "variable", variableId: VAR_P.id,
        parentId: "op-not", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-q", type: "variable", variableId: VAR_Q.id,
        parentId: "op-and", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)

    // Formula's bounded subtree: not → P. No binary operator. Formula should collapse.
    // Trigger by removing v-p → not collapses (0 children) → formula has 0 children → formula collapses
    em.removeExpression("v-p", true)

    expect(em.getExpression("formula-1")).toBeUndefined()
    expect(em.getExpression("op-not")).toBeUndefined()
})

it("stops bounded subtree check at nested formula", () => {
    const em = new ExpressionManager({
        grammarConfig: {
            enforceFormulaBetweenOperators: false,
            autoNormalize: true,
        },
    })
    // Build: outer-formula → not → inner-formula → and → [P, Q]
    em.addExpression({
        id: "outer-formula", type: "formula",
        parentId: null, position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-not", type: "operator", operator: "not",
        parentId: "outer-formula", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "inner-formula", type: "formula",
        parentId: "op-not", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-and", type: "operator", operator: "and",
        parentId: "inner-formula", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-p", type: "variable", variableId: VAR_P.id,
        parentId: "op-and", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-q", type: "variable", variableId: VAR_Q.id,
        parentId: "op-and", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)

    // outer-formula's bounded subtree is: not → inner-formula (stop). No binary op found.
    // inner-formula's bounded subtree is: and → [P, Q]. Has binary op.
    // So outer-formula is unjustified but inner-formula is justified.
    // We can't test this via removal easily — use normalize() (Task 6) or
    // verify it doesn't collapse during removal of something else.
    // For now, remove v-p: and collapses (1 child v-q), inner-formula now has v-q (no binary op)
    // inner-formula collapses, not now has v-q, outer-formula now has not → v-q (no binary op)
    // outer-formula collapses, not promoted to root.
    em.removeExpression("v-p", true)

    expect(em.getExpression("outer-formula")).toBeUndefined()
    expect(em.getExpression("inner-formula")).toBeUndefined()
    expect(em.getExpression("op-and")).toBeUndefined()
    expect(em.getExpression("op-not")!.parentId).toBeNull()
    expect(em.getExpression("v-q")!.parentId).toBe("op-not")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "autoNormalize gating"`
Expected: New formula collapse tests fail (formula still survives with 1 child).

- [ ] **Step 3: Implement `hasBinaryOperatorInBoundedSubtree` and extend formula branch**

In `src/lib/core/expression-manager.ts`, add the helper method (after `collapseIfNeeded`):

```typescript
/**
 * Checks whether the subtree rooted at `expressionId` contains a binary
 * operator (`and` or `or`). Traversal stops at formula boundaries — a
 * nested formula owns its own subtree and is not inspected.
 */
private hasBinaryOperatorInBoundedSubtree(expressionId: string): boolean {
    const expr = this.expressions.get(expressionId)
    if (!expr) return false
    if (expr.type === "formula") return false
    if (expr.type === "variable") return false
    if (
        expr.type === "operator" &&
        (expr.operator === "and" || expr.operator === "or")
    ) {
        return true
    }
    // expr.type === "operator" && expr.operator is "not" (or implies/iff which shouldn't appear here)
    const children = this.getChildExpressions(expressionId)
    return children.some((child) =>
        this.hasBinaryOperatorInBoundedSubtree(child.id)
    )
}
```

Extend the formula branch in `collapseIfNeeded`. Replace the existing formula block (lines ~825-843):

```typescript
if (operator.type === "formula") {
    const children = this.getChildExpressions(operatorId)
    if (children.length === 0) {
        const grandparentId = operator.parentId
        this.collector?.removedExpression({
            ...operator,
        } as unknown as TCorePropositionalExpression)
        this.detachExpression(operatorId, operator)

        this.dirtyExpressionIds.delete(operatorId)
        if (grandparentId !== null) {
            this.markExpressionDirty(grandparentId)
        }

        this.collapseIfNeeded(grandparentId)
        return
    }

    // 1-child formula: collapse if no binary operator in bounded subtree.
    if (
        children.length === 1 &&
        !this.hasBinaryOperatorInBoundedSubtree(children[0].id)
    ) {
        const child = children[0]
        const grandparentId = operator.parentId
        const grandparentPosition = operator.position

        // Promote child into the formula's slot.
        const promoted = this.attachChecksum({
            ...child,
            parentId: grandparentId,
            position: grandparentPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(child.id, promoted)
        this.collector?.modifiedExpression({
            ...promoted,
        } as unknown as TCorePropositionalExpression)

        // Replace formula with promoted child in grandparent's child-id set.
        this.childExpressionIdsByParentId
            .get(grandparentId)
            ?.delete(operatorId)
        getOrCreate(
            this.childExpressionIdsByParentId,
            grandparentId,
            () => new Set()
        ).add(child.id)

        // Remove formula's own tracking entries.
        this.childExpressionIdsByParentId.delete(operatorId)
        this.childPositionsByParentId.delete(operatorId)
        this.collector?.removedExpression({
            ...operator,
        } as unknown as TCorePropositionalExpression)
        this.expressions.delete(operatorId)

        // Prune formula from dirty set and mark promoted child dirty.
        this.dirtyExpressionIds.delete(operatorId)
        this.markExpressionDirty(child.id)

        // Grandparent may also be a formula that now needs collapsing.
        this.collapseIfNeeded(grandparentId)
    }

    return
}
```

- [ ] **Step 4: Add recursion after operator promotion**

In the operator-with-1-child branch of `collapseIfNeeded` (around line ~930), replace the comment "no further recursion" with a recursive call:

```typescript
// Mark promoted child dirty (its parentId changed) which also propagates to ancestors.
this.dirtyExpressionIds.delete(operatorId)
this.markExpressionDirty(child.id)

// Grandparent may be a formula that now needs collapsing after the
// promoted child replaced the operator.
this.collapseIfNeeded(grandparentId)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "autoNormalize gating"`
Expected: All tests PASS.

- [ ] **Step 6: Update existing test that now cascades through formula**

The test at line ~882 ("promotes the surviving child to a non-root slot (nested collapse)") previously expected `formula-1` to survive wrapping `expr-q`. Now the cascade continues: operator collapse promotes `v-q` into `formula-1`, then `formula-1` (wrapping a variable) collapses, promoting `v-q` into `op-root`.

Update the test:

```typescript
it("promotes the surviving child to a non-root slot (nested collapse)", () => {
    const premise = premiseWithVars()
    // op-root (or, root) → [formula-1 (pos 0) → op-and → [expr-p (pos 0), expr-q (pos 1)], expr-r (pos 1)]
    premise.addExpression(makeOpExpr("op-root", "or"))
    premise.addExpression(
        makeFormulaExpr("formula-1", {
            parentId: "op-root",
            position: 0,
        })
    )
    premise.addExpression(
        makeOpExpr("op-and", "and", {
            parentId: "formula-1",
            position: 0,
        })
    )
    premise.addExpression(
        makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
    )
    premise.addExpression(
        makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
    )
    premise.addExpression(
        makeVarExpr("expr-r", VAR_R.id, {
            parentId: "op-root",
            position: 1,
        })
    )

    // Remove expr-p → op-and has 1 child (expr-q)
    // op-and collapses; expr-q promoted into formula-1 (pos 0)
    // formula-1 now wraps expr-q (a variable, no binary op) → formula collapses
    // expr-q promoted into op-root at position 0
    premise.removeExpression("expr-p", true)

    expect(premise.removeExpression("op-and", true).result).toBeUndefined()
    expect(premise.removeExpression("formula-1", true).result).toBeUndefined()
    // op-root has two children: expr-q (pos 0) and expr-r (pos 1)
    expect(premise.toDisplayString()).toBe("(Q ∨ R)")
})
```

- [ ] **Step 7: Run full test suite and fix remaining breakage**

Run: `pnpm run test`

The following existing tests may also break because they construct trees with unjustified formulas and expect them to survive:

- Tests in "removeExpression — operator collapse" that build `formula → variable` after operator promotion (the test at line ~882 is the primary one, already handled in Step 6)
- Tests in "changeset" sections that assert formula survival after operator collapse (e.g., line ~5881 "changeset modified expressions include checksums after collapse")

For each broken test, apply the same pattern as Step 6: update the expected outcome to include formula collapse in the cascade. The formula is removed, its child promoted to the formula's parent.

Expected: All tests PASS after fixes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: add formula collapse for formulas without binary operator descendants"
```

---

### Task 3: Extend `simulateCollapseChain` for new collapse cascades

**Files:**
- Modify: `src/lib/core/expression-manager.ts:1074-1104` (`simulateCollapseChain`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write test for extended simulation**

Add to the "autoNormalize gating" describe block:

```typescript
it("assertRemovalSafe accounts for formula collapse after operator promotion", () => {
    const em = new ExpressionManager()
    // Build: and → [formula → or → [not → P, Q], R]
    // Removing P: not collapses (0 children) → or has 1 child (Q) → or collapses,
    // Q promoted into formula → formula has Q (variable, no binary op) → formula collapses,
    // Q promoted into and. This is all safe — no root-only or nesting violations.
    em.addExpression({
        id: "op-and", type: "operator", operator: "and",
        parentId: null, position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "formula-1", type: "formula",
        parentId: "op-and", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-or", type: "operator", operator: "or",
        parentId: "formula-1", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "op-not", type: "operator", operator: "not",
        parentId: "op-or", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-p", type: "variable", variableId: VAR_P.id,
        parentId: "op-not", position: 0,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-q", type: "variable", variableId: VAR_Q.id,
        parentId: "op-or", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)
    em.addExpression({
        id: "v-r", type: "variable", variableId: VAR_R.id,
        parentId: "op-and", position: 1,
        argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
    } as TExpressionInput)

    // Should not throw — entire cascade is safe
    expect(() => em.removeExpression("v-p", true)).not.toThrow()
    // Verify the cascade happened correctly
    expect(em.getExpression("op-not")).toBeUndefined()
    expect(em.getExpression("op-or")).toBeUndefined()
    expect(em.getExpression("formula-1")).toBeUndefined()
    expect(em.getExpression("v-q")!.parentId).toBe("op-and")
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "assertRemovalSafe accounts for formula collapse"`
Expected: PASS — the simulation from Task 2 already handles the basic case. If it fails due to the simulation not accounting for post-promotion cascade, proceed to Step 3.

- [ ] **Step 3: Extend `simulateCollapseChain` and add `simulatePostPromotionCollapse`**

Update `simulateCollapseChain` to account for the new cascades. The formula-with-1-child case and operator post-promotion recursion need simulation:

```typescript
private simulateCollapseChain(
    operatorId: string | null,
    removedChildId: string
): void {
    if (!this.grammarConfig.autoNormalize) return
    if (operatorId === null) return

    const operator = this.expressions.get(operatorId)
    if (!operator) return

    if (operator.type !== "operator" && operator.type !== "formula") return

    const children = this.getChildExpressions(operatorId)
    const remainingChildren = children.filter(
        (c) => c.id !== removedChildId
    )

    if (operator.type === "formula") {
        if (remainingChildren.length === 0) {
            // Formula deleted, recurse up.
            this.simulateCollapseChain(operator.parentId, operatorId)
        } else if (
            remainingChildren.length === 1 &&
            !this.hasBinaryOperatorInBoundedSubtree(remainingChildren[0].id)
        ) {
            // Formula would collapse — child promoted.
            // Formula collapse promotion is always safe (child is variable, not, or formula).
            // Continue simulating from the grandparent.
            this.simulateCollapseChain(operator.parentId, operatorId)
        }
        return
    }

    // operator.type === "operator"
    if (remainingChildren.length === 0) {
        this.simulateCollapseChain(operator.parentId, operatorId)
    } else if (remainingChildren.length === 1) {
        this.assertPromotionSafe(remainingChildren[0], operator.parentId)
        // After promotion, simulate further collapse on grandparent.
        // The promoted child replaces the operator — grandparent's child count is unchanged,
        // but if grandparent is a formula, its child identity changed and it may collapse.
        this.simulatePostPromotionCollapse(
            operator.parentId,
            remainingChildren[0]
        )
    }
}

/**
 * After an operator promotion places `promotedChild` into `parentId`'s child set,
 * check whether the parent (if a formula) would itself collapse. Formula collapse
 * promotion is always safe (the child can't be a binary operator or root-only operator),
 * but we need to continue the simulation chain.
 */
private simulatePostPromotionCollapse(
    parentId: string | null,
    promotedChild: TExpr
): void {
    if (parentId === null) return
    const parent = this.expressions.get(parentId)
    if (!parent) return

    if (parent.type === "formula") {
        if (!this.hasBinaryOperatorInBoundedSubtree(promotedChild.id)) {
            // Formula would collapse. The promotedChild takes formula's slot.
            // This is always safe. Continue simulation from formula's parent.
            this.simulatePostPromotionCollapse(parent.parentId, promotedChild)
        }
    }
    // Operator parents: child count unchanged, no further collapse.
}
```

Also update `assertRemovalSafe` (line ~1013) to use `simulatePostPromotionCollapse` in the `!deleteSubtree && children.length === 1` case. In that method, after the existing `assertPromotionSafe` call, add the post-promotion simulation:

```typescript
private assertRemovalSafe(
    expressionId: string,
    deleteSubtree: boolean
): void {
    const target = this.expressions.get(expressionId)
    if (!target) return

    if (!deleteSubtree) {
        const children = this.getChildExpressions(expressionId)
        if (children.length === 1) {
            this.assertPromotionSafe(children[0], target.parentId)
            // Simulate post-promotion cascade (formula collapse after promotion).
            if (this.grammarConfig.autoNormalize) {
                this.simulatePostPromotionCollapse(
                    target.parentId,
                    children[0]
                )
            }
        }
        if (children.length === 0) {
            this.simulateCollapseChain(target.parentId, expressionId)
        }
        return
    }

    this.simulateCollapseChain(target.parentId, expressionId)
}
```

- [ ] **Step 4: Add `collapseIfNeeded` call after `removeAndPromote`**

In `removeAndPromote`, replace the comment "No collapseIfNeeded after promotion." (line ~814) with:

```typescript
// After promotion, the target's parent may be a formula that now needs collapsing
// (e.g., if the promoted child has no binary operator in its bounded subtree).
this.collapseIfNeeded(target.parentId)
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: extend collapse simulation for formula collapse and post-promotion cascades"
```

---

### Task 4: Public `normalize()` on `ExpressionManager`

**Files:**
- Modify: `src/lib/core/expression-manager.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write tests for `normalize()`**

Add a new `describe` block:

```typescript
describe("ExpressionManager.normalize", () => {
    it("collapses unjustified formulas", () => {
        const em = new ExpressionManager({
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        // Build: and → [formula → P, Q] (formula wrapping a variable is unjustified)
        em.addExpression({
            id: "op-and", type: "operator", operator: "and",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "formula-1", type: "formula",
            parentId: "op-and", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p", type: "variable", variableId: VAR_P.id,
            parentId: "formula-1", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-q", type: "variable", variableId: VAR_Q.id,
            parentId: "op-and", position: 1,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        em.normalize()

        expect(em.getExpression("formula-1")).toBeUndefined()
        expect(em.getExpression("v-p")!.parentId).toBe("op-and")
    })

    it("collapses operators with 0 children", () => {
        const em = new ExpressionManager({
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        em.addExpression({
            id: "op-not", type: "operator", operator: "not",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        em.normalize()

        expect(em.getExpression("op-not")).toBeUndefined()
    })

    it("collapses operators with 1 child", () => {
        const em = new ExpressionManager({
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        em.addExpression({
            id: "op-and", type: "operator", operator: "and",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p", type: "variable", variableId: VAR_P.id,
            parentId: "op-and", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        em.normalize()

        expect(em.getExpression("op-and")).toBeUndefined()
        expect(em.getExpression("v-p")!.parentId).toBeNull()
    })

    it("inserts formula buffers for operator-under-operator violations", () => {
        const em = new ExpressionManager({
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        // Build: and → or (missing formula buffer)
        em.addExpression({
            id: "op-and", type: "operator", operator: "and",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "op-or", type: "operator", operator: "or",
            parentId: "op-and", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        em.normalize()

        const orExpr = em.getExpression("op-or")!
        expect(orExpr.parentId).not.toBe("op-and")
        const formulaExpr = em.getExpression(orExpr.parentId!)!
        expect(formulaExpr.type).toBe("formula")
        expect(formulaExpr.parentId).toBe("op-and")
    })

    it("handles cascading normalization (collapse + insert)", () => {
        const em = new ExpressionManager({
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        // Build: and → [formula → not → P, Q]
        // Formula wraps not (no binary op) → should collapse.
        // After collapse, not is direct child of and → needs formula buffer.
        // Wait — not is exempt from the nesting rule, so no formula buffer needed.
        em.addExpression({
            id: "op-and", type: "operator", operator: "and",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "formula-1", type: "formula",
            parentId: "op-and", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "op-not", type: "operator", operator: "not",
            parentId: "formula-1", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p", type: "variable", variableId: VAR_P.id,
            parentId: "op-not", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-q", type: "variable", variableId: VAR_Q.id,
            parentId: "op-and", position: 1,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        em.normalize()

        // Formula collapsed, not is direct child of and (exempt from nesting rule)
        expect(em.getExpression("formula-1")).toBeUndefined()
        expect(em.getExpression("op-not")!.parentId).toBe("op-and")
    })

    it("is idempotent on an already-normalized tree", () => {
        const em = new ExpressionManager()
        // Build a valid tree: and → [formula → or → [P, Q], R]
        em.addExpression({
            id: "op-and", type: "operator", operator: "and",
            parentId: null, position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "formula-1", type: "formula",
            parentId: "op-and", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "op-or", type: "operator", operator: "or",
            parentId: "formula-1", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-p", type: "variable", variableId: VAR_P.id,
            parentId: "op-or", position: 0,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-q", type: "variable", variableId: VAR_Q.id,
            parentId: "op-or", position: 1,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)
        em.addExpression({
            id: "v-r", type: "variable", variableId: VAR_R.id,
            parentId: "op-and", position: 1,
            argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
        } as TExpressionInput)

        em.normalize()

        // Nothing changes — tree was already valid
        expect(em.getExpression("formula-1")).toBeDefined()
        expect(em.getExpression("op-or")!.parentId).toBe("formula-1")
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "ExpressionManager.normalize"`
Expected: FAIL — `normalize` method doesn't exist yet.

- [ ] **Step 3: Implement `normalize()`**

Add to `ExpressionManager`:

```typescript
/**
 * Performs a full normalization sweep on the expression tree:
 * 1. Collapses operators with 0 or 1 children.
 * 2. Collapses formulas whose bounded subtree has no binary operator.
 * 3. Inserts formula buffers where `enforceFormulaBetweenOperators` requires them.
 * 4. Repeats until stable.
 *
 * Works regardless of the current `autoNormalize` setting — this is an
 * explicit on-demand normalization.
 */
public normalize(): void {
    let changed = true
    while (changed) {
        changed = false

        // Pass 1: Collapse operators with 0 or 1 children (bottom-up).
        for (const expr of this.toArray()) {
            if (expr.type !== "operator") continue
            if (!this.expressions.has(expr.id)) continue
            const children = this.getChildExpressions(expr.id)
            if (children.length === 0) {
                const grandparentId = expr.parentId
                this.collector?.removedExpression({
                    ...expr,
                } as unknown as TCorePropositionalExpression)
                this.detachExpression(expr.id, expr)
                this.dirtyExpressionIds.delete(expr.id)
                if (grandparentId !== null) {
                    this.markExpressionDirty(grandparentId)
                }
                changed = true
            } else if (children.length === 1) {
                this.promoteChild(expr.id, expr, children[0])
                changed = true
            }
        }

        // Pass 2: Collapse unjustified formulas (bottom-up).
        for (const expr of this.toArray()) {
            if (expr.type !== "formula") continue
            if (!this.expressions.has(expr.id)) continue
            const children = this.getChildExpressions(expr.id)
            if (children.length === 0) {
                const grandparentId = expr.parentId
                this.collector?.removedExpression({
                    ...expr,
                } as unknown as TCorePropositionalExpression)
                this.detachExpression(expr.id, expr)
                this.dirtyExpressionIds.delete(expr.id)
                if (grandparentId !== null) {
                    this.markExpressionDirty(grandparentId)
                }
                changed = true
            } else if (
                children.length === 1 &&
                !this.hasBinaryOperatorInBoundedSubtree(children[0].id)
            ) {
                this.promoteChild(expr.id, expr, children[0])
                changed = true
            }
        }

        // Pass 3: Insert formula buffers for operator-under-operator violations.
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            for (const expr of this.toArray()) {
                if (expr.type !== "operator" || expr.operator === "not") continue
                if (!this.expressions.has(expr.id)) continue
                if (expr.parentId === null) continue
                const parent = this.expressions.get(expr.parentId)
                if (!parent || parent.type !== "operator") continue

                // Non-not operator is direct child of operator — insert formula buffer.
                const formulaId = this.registerFormulaBuffer(
                    expr as unknown as TExpr,
                    expr.parentId,
                    expr.position
                )
                // Reparent the operator under the formula.
                this.reparent(expr.id, formulaId, 0)
                changed = true
            }
        }
    }
}
```

Also extract a shared `promoteChild` helper from the duplicated promotion logic in `collapseIfNeeded` (used by both the operator-1-child and formula-1-child branches):

```typescript
/**
 * Promotes `child` into the slot occupied by `parent` and removes `parent`.
 * Used by `collapseIfNeeded` and `normalize()`.
 */
private promoteChild(parentId: string, parent: TExpr, child: TExpr): void {
    const grandparentId = parent.parentId
    const grandparentPosition = parent.position

    const promoted = this.attachChecksum({
        ...child,
        parentId: grandparentId,
        position: grandparentPosition,
    } as TExpressionInput<TExpr>)
    this.expressions.set(child.id, promoted)
    this.collector?.modifiedExpression({
        ...promoted,
    } as unknown as TCorePropositionalExpression)

    this.childExpressionIdsByParentId
        .get(grandparentId)
        ?.delete(parentId)
    getOrCreate(
        this.childExpressionIdsByParentId,
        grandparentId,
        () => new Set()
    ).add(child.id)

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

Then refactor `collapseIfNeeded` to use `promoteChild` in both its operator-1-child and formula-1-child branches (reducing duplication).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "ExpressionManager.normalize"`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: add ExpressionManager.normalize() for on-demand normalization"
```

---

### Task 5: `normalizeExpressions()` on `PremiseEngine` and `normalizeAllExpressions()` on `ArgumentEngine`

**Files:**
- Modify: `src/lib/core/premise-engine.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe("PremiseEngine.normalizeExpressions", () => {
    it("normalizes unjustified formulas and returns changeset", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pe } = eng.createPremise()

        // Build: and → [formula → P, Q]
        pe.addExpression(makeOpExpr("op-and", "and"))
        pe.addExpression(
            makeFormulaExpr("formula-1", { parentId: "op-and", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("v-p", VAR_P.id, { parentId: "formula-1", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("v-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        const { changes } = pe.normalizeExpressions()

        // formula-1 collapsed, v-p promoted
        expect(pe.getExpression("formula-1")).toBeUndefined()
        expect(pe.getExpression("v-p")!.parentId).toBe("op-and")
        // Changeset reflects the changes
        expect(changes.expressions!.removed.some((e) => e.id === "formula-1")).toBe(true)
        expect(changes.expressions!.modified.some((e) => e.id === "v-p")).toBe(true)
    })
})

describe("ArgumentEngine.normalizeAllExpressions", () => {
    it("normalizes all premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pe1 } = eng.createPremise()
        const { result: pe2 } = eng.createPremise()

        // pe1: and → [formula → P, Q]
        pe1.addExpression(makeOpExpr("op-and-1", "and", { premiseId: pe1.getId() }))
        pe1.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-and-1", position: 0, premiseId: pe1.getId(),
            })
        )
        pe1.addExpression(
            makeVarExpr("v-p-1", VAR_P.id, {
                parentId: "formula-1", position: 0, premiseId: pe1.getId(),
            })
        )
        pe1.addExpression(
            makeVarExpr("v-q-1", VAR_Q.id, {
                parentId: "op-and-1", position: 1, premiseId: pe1.getId(),
            })
        )

        // pe2: formula → Q (unjustified root formula)
        pe2.addExpression(
            makeFormulaExpr("formula-2", { premiseId: pe2.getId() })
        )
        pe2.addExpression(
            makeVarExpr("v-q-2", VAR_Q.id, {
                parentId: "formula-2", position: 0, premiseId: pe2.getId(),
            })
        )

        const { changes } = eng.normalizeAllExpressions()

        // Both premises normalized
        expect(pe1.getExpression("formula-1")).toBeUndefined()
        expect(pe2.getExpression("formula-2")).toBeUndefined()
        expect(changes.expressions!.removed.length).toBe(2)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "normalizeExpressions|normalizeAllExpressions"`
Expected: FAIL — methods don't exist yet.

- [ ] **Step 3: Implement `normalizeExpressions()` on `PremiseEngine`**

Add to `PremiseEngine`:

```typescript
/**
 * Performs a full normalization sweep on this premise's expression tree.
 * Collapses unjustified formulas, operators with 0/1 children, and inserts
 * formula buffers where needed. Works regardless of `autoNormalize` setting.
 */
public normalizeExpressions(): TCoreMutationResult<
    void,
    TExpr,
    TVar,
    TPremise,
    TArg
> {
    return this.withValidation(() => {
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        this.expressions.setCollector(collector)
        try {
            this.expressions.normalize()
            const changes = this.finalizeExpressionMutation(collector)
            return { result: undefined, changes }
        } finally {
            this.expressions.setCollector(null)
        }
    })
}
```

- [ ] **Step 4: Implement `normalizeAllExpressions()` on `ArgumentEngine`**

Add to `ArgumentEngine`:

```typescript
/**
 * Normalizes expression trees across all premises. Collapses unjustified
 * formulas, operators with 0/1 children, and inserts formula buffers where
 * needed. Works regardless of `autoNormalize` setting.
 */
public normalizeAllExpressions(): TCoreMutationResult<
    void,
    TExpr,
    TVar,
    TPremise,
    TArg
> {
    const merged: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
    for (const pe of this.premises.values()) {
        const { changes } = pe.normalizeExpressions()
        if (changes.expressions) {
            merged.expressions ??= { added: [], modified: [], removed: [] }
            merged.expressions.added.push(...changes.expressions.added)
            merged.expressions.modified.push(...changes.expressions.modified)
            merged.expressions.removed.push(...changes.expressions.removed)
        }
        if (changes.premises) {
            merged.premises ??= { added: [], modified: [], removed: [] }
            merged.premises.modified.push(...changes.premises.modified)
        }
    }
    return { result: undefined, changes: merged }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "normalizeExpressions|normalizeAllExpressions"`
Expected: All tests PASS.

- [ ] **Step 6: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add normalizeExpressions() and normalizeAllExpressions() public API"
```

---

### Task 6: Post-load normalization in `fromSnapshot` and `fromData`

**Files:**
- Modify: `src/lib/core/argument-engine.ts:1161-1270` (`fromSnapshot`)
- Modify: `src/lib/core/argument-engine.ts:1278-1430` (`fromData`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe("post-load normalization", () => {
    it("fromData normalizes unjustified formulas when autoNormalize is true", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            { id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1, claimId: "claim-default", claimVersion: 0 },
            { id: "v2", symbol: "Q", argumentId: "arg-1", argumentVersion: 1, claimId: "claim-default", claimVersion: 0 },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
        ]
        // Tree: and → [formula → P, Q] (formula wrapping a variable is unjustified)
        const expressions = [
            { id: "e-and", type: "operator" as const, operator: "and" as const, argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: null, position: 0 },
            { id: "e-formula", type: "formula" as const, argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-and", position: 0 },
            { id: "e-v1", type: "variable" as const, variableId: "v1", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-formula", position: 0 },
            { id: "e-v2", type: "variable" as const, variableId: "v2", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-and", position: 1 },
        ]
        const engine = ArgumentEngine.fromData(
            arg, aLib(), sLib(), csLib(),
            variables, premises, expressions,
            { conclusionPremiseId: "p1" },
            undefined, // config — uses DEFAULT_GRAMMAR_CONFIG (autoNormalize: true)
        )

        // formula was collapsed during post-load normalization
        const pe = engine.findPremiseByExpressionId("e-v1")!
        expect(pe.getExpression("e-formula")).toBeUndefined()
        expect(pe.getExpression("e-v1")!.parentId).toBe("e-and")
    })

    it("fromData does not normalize when autoNormalize is false", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            { id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1, claimId: "claim-default", claimVersion: 0 },
            { id: "v2", symbol: "Q", argumentId: "arg-1", argumentVersion: 1, claimId: "claim-default", claimVersion: 0 },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
        ]
        const expressions = [
            { id: "e-and", type: "operator" as const, operator: "and" as const, argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: null, position: 0 },
            { id: "e-formula", type: "formula" as const, argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-and", position: 0 },
            { id: "e-v1", type: "variable" as const, variableId: "v1", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-formula", position: 0 },
            { id: "e-v2", type: "variable" as const, variableId: "v2", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-and", position: 1 },
        ]
        const engine = ArgumentEngine.fromData(
            arg, aLib(), sLib(), csLib(),
            variables, premises, expressions,
            { conclusionPremiseId: "p1" },
            { grammarConfig: PERMISSIVE_GRAMMAR_CONFIG },
            PERMISSIVE_GRAMMAR_CONFIG,
        )

        // formula survives — no normalization
        const pe = engine.findPremiseByExpressionId("e-formula")!
        expect(pe.getExpression("e-formula")).toBeDefined()
        expect(pe.getExpression("e-v1")!.parentId).toBe("e-formula")
    })

    it("fromSnapshot normalizes unjustified formulas when autoNormalize is true", () => {
        // Build a snapshot with an unjustified formula using permissive config
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pe } = eng.createPremise()
        pe.addExpression(makeOpExpr("op-and", "and", { premiseId: pe.getId() }))
        pe.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-and", position: 0, premiseId: pe.getId(),
            })
        )
        pe.addExpression(
            makeVarExpr("v-p", VAR_P.id, {
                parentId: "formula-1", position: 0, premiseId: pe.getId(),
            })
        )
        pe.addExpression(
            makeVarExpr("v-q", VAR_Q.id, {
                parentId: "op-and", position: 1, premiseId: pe.getId(),
            })
        )
        const snapshot = eng.snapshot()

        // Restore with auto-normalize on (default)
        const restored = ArgumentEngine.fromSnapshot(
            snapshot, aLib(), sLib(), csLib(),
        )

        const restoredPe = restored.findPremiseByExpressionId("v-p")!
        expect(restoredPe.getExpression("formula-1")).toBeUndefined()
        expect(restoredPe.getExpression("v-p")!.parentId).toBe("op-and")
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "post-load normalization"`
Expected: FAIL — post-load normalization not implemented yet.

- [ ] **Step 3: Add post-load normalization to `fromData`**

In `ArgumentEngine.fromData`, after `engine.restoringFromSnapshot = false` (line ~1404) and before the validation step, add:

```typescript
engine.restoringFromSnapshot = false

// Post-load normalization: collapse unjustified formulas and apply
// grammar rules to loaded data. Runs after all expressions are in place.
const restoredGrammarConfig =
    config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
if (restoredGrammarConfig.autoNormalize) {
    for (const pe of engine.premises.values()) {
        pe.normalizeExpressions()
    }
}
```

- [ ] **Step 4: Add post-load normalization to `fromSnapshot`**

In `ArgumentEngine.fromSnapshot`, after `engine.restoringFromSnapshot = false` (line ~1257) and before the checksum verification/validation steps, add:

```typescript
engine.restoringFromSnapshot = false

// Post-load normalization: collapse unjustified formulas if the
// caller's grammar config requests it.
const restoredGrammarConfig =
    grammarConfig ?? engine.config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
if (restoredGrammarConfig.autoNormalize) {
    for (const pe of engine.premises.values()) {
        pe.normalizeExpressions()
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "post-load normalization"`
Expected: All tests PASS.

- [ ] **Step 6: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add post-load normalization in fromSnapshot and fromData"
```

---

### Task 7: Update JSDoc and grammar type documentation

**Files:**
- Modify: `src/lib/types/grammar.ts`
- Modify: `src/lib/core/expression-manager.ts` (class-level JSDoc)

- [ ] **Step 1: Update `TGrammarConfig` JSDoc**

In `src/lib/types/grammar.ts`, update the docblock on `TGrammarConfig`:

```typescript
/**
 * Grammar enforcement configuration for expression trees.
 *
 * Controls which structural rules are enforced and whether violations are
 * automatically corrected.
 *
 * **`autoNormalize` scope:** When `true`, expression mutation operations
 * (`addExpression`, `insertExpression`, `wrapExpression`) auto-insert formula
 * buffers. `removeExpression` auto-collapses operators with 0 or 1 children
 * and collapses formulas whose bounded subtree has no binary operator
 * (`and`/`or`). When `false`, no automatic structural changes occur — the
 * tree can be in any state including incomplete or grammar-violating.
 *
 * **Formula collapse rule:** A formula node is only justified if its bounded
 * subtree (stopping at the next nested formula) contains a binary operator
 * (`and` or `or`). Formulas wrapping only variables, `not` chains, or other
 * non-binary subtrees are automatically collapsed when `autoNormalize` is `true`.
 */
export type TGrammarConfig = TGrammarOptions & {
    /** When `true`, auto-fix violations where possible instead of throwing. */
    autoNormalize: boolean
}

/** Default config: all rules enforced, auto-normalize on. */
export const DEFAULT_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: true,
    autoNormalize: true,
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/grammar.ts src/lib/core/expression-manager.ts
git commit -m "docs: update grammar config JSDoc for autoNormalize and formula collapse"
```

---

### Task 8: Export new public API and update CLAUDE.md

**Files:**
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` (if interface exists for PremiseEngine)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `normalizeExpressions()` to `TPremiseEngineExpressionManagement` interface**

The file `src/lib/core/interfaces/premise-engine.interfaces.ts` defines the public API interface. Add the `normalizeExpressions()` method signature with JSDoc. Also update the JSDoc at the top of the interface to mention auto-normalization scope.

Add to `src/lib/core/interfaces/argument-engine.interfaces.ts` if it defines expression-related methods — add `normalizeAllExpressions()` with JSDoc.

- [ ] **Step 2: Update CLAUDE.md design rules**

Add to the "Key design rules" section in `CLAUDE.md`:

```markdown
- **Formula collapse rule:** When `autoNormalize` is `true`, a formula node is only justified if its bounded subtree (stopping at the next nested formula) contains a binary operator (`and`/`or`). Formulas without binary operator descendants are automatically collapsed by promoting their child. This applies during `removeExpression` (via `collapseIfNeeded`), during loading (`fromSnapshot`/`fromData`), and via explicit `normalize()` calls.
- **Operator collapse gated on `autoNormalize`:** Operator collapse (0 or 1 children after removal) only runs when `grammarConfig.autoNormalize` is `true`. When `false`, the tree is free-form — incomplete or grammar-violating states are allowed.
```

- [ ] **Step 3: Run full check suite**

Run: `pnpm run check`
Expected: All checks PASS (typecheck, lint, test, build).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/lib/core/interfaces/
git commit -m "docs: update CLAUDE.md and interfaces for formula collapse and autoNormalize gating"
```
