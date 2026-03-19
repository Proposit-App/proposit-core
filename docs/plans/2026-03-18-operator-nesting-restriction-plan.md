# Operator Nesting Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent non-`not` operator expressions from being direct children of operator expressions, requiring a `formula` node buffer between them.

**Architecture:** Add a guard check (`child.type === "operator" && child.operator !== "not" && parent.type === "operator" → throw`) in `addExpression`, `insertExpression`, `wrapExpression`, and a pre-flight simulation in `removeExpression`. Bypass the check during snapshot/data restoration. Add defense-in-depth guards in `collapseIfNeeded`.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/plans/2026-03-18-operator-nesting-restriction-design.md`

**Note:** All line number references are approximate and relative to the original file state. As earlier tasks add code, subsequent line numbers shift. Use surrounding code context to locate insertion points.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/core/expression-manager.ts` | Modify | Add nesting guard to `addExpression`, `insertExpression`, `wrapExpression`; add pre-flight validation for `removeExpression`; add defense-in-depth to `collapseIfNeeded`; expose `loadExpressions` method; add `skipNestingCheck` flag |
| `src/lib/core/premise-engine.ts` | Modify | Expose `loadExpressions` method delegating to `ExpressionManager` |
| `src/lib/core/argument-engine.ts` | Modify | Use `pe.loadExpressions()` in `fromData` instead of `pe.addExpression` loop |
| `test/core.test.ts` | Modify | Add new `describe("operator nesting restriction", ...)` block |
| `CLAUDE.md` | Modify | Add nesting restriction to key design rules |

---

### Task 1: `addExpression` — nesting guard and tests

**Files:**
- Modify: `test/core.test.ts` (append new describe block at end of file, before final `})` — actually at the very end since each describe is top-level)
- Modify: `src/lib/core/expression-manager.ts:140-165` (inside the `parentId !== null` block)

- [ ] **Step 1: Write failing tests for `addExpression` nesting restriction**

Add a new top-level `describe` block at the end of `test/core.test.ts`:

```typescript
describe("operator nesting restriction", () => {
    describe("addExpression", () => {
        it("throws when and operator is added as child of and operator", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            expect(() =>
                premise.addExpression(
                    makeOpExpr("op-child", "and", { parentId: "op-root", position: 0 })
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("throws when or operator is added as child of not operator", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeOpExpr("op-not", "not", { parentId: "op-root", position: 0 })
            )
            expect(() =>
                premise.addExpression(
                    makeOpExpr("op-child", "or", { parentId: "op-not", position: 0 })
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("allows not operator as child of and operator", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            expect(() =>
                premise.addExpression(
                    makeOpExpr("op-not", "not", { parentId: "op-root", position: 0 })
                )
            ).not.toThrow()
        })

        it("allows not operator as child of not operator", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeOpExpr("op-not1", "not", { parentId: "op-root", position: 0 })
            )
            expect(() =>
                premise.addExpression(
                    makeOpExpr("op-not2", "not", { parentId: "op-not1", position: 0 })
                )
            ).not.toThrow()
        })

        it("allows and operator as child of formula (formula is the buffer)", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "or"))
            premise.addExpression(
                makeFormulaExpr("formula-1", { parentId: "op-root", position: 0 })
            )
            expect(() =>
                premise.addExpression(
                    makeOpExpr("op-child", "and", { parentId: "formula-1", position: 0 })
                )
            ).not.toThrow()
        })

        it("allows formula → and chain as child of or (formula buffer between operators)", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "or"))
            premise.addExpression(
                makeFormulaExpr("formula-1", { parentId: "op-root", position: 0 })
            )
            premise.addExpression(
                makeOpExpr("op-child", "and", { parentId: "formula-1", position: 0 })
            )
            // Verify the tree is valid by checking expressions exist
            expect(premise.getExpression("op-child")).toBeDefined()
            expect(premise.getExpression("formula-1")).toBeDefined()
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction"`

Expected: 2 tests FAIL (the "throws" tests), 4 tests PASS (the "allows" tests).

- [ ] **Step 3: Implement the nesting guard in `addExpression`**

In `src/lib/core/expression-manager.ts`, add the nesting check inside the `if (expression.parentId !== null)` block, after the parent type validation (after line 151) and before the child limit check (line 153). Also add the `skipNestingCheck` private field.

Add the private field at line 73 (after `private collector`):

```typescript
private skipNestingCheck = false
```

Add the guard after line 151 (after the `parent.type !== "operator" && parent.type !== "formula"` check):

```typescript
            // Non-not operators cannot be direct children of operators.
            if (
                !this.skipNestingCheck &&
                parent.type === "operator" &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction"`

Expected: All 6 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`

Expected: Some existing tests may fail if they create operator-under-operator trees. Check and fix any failures — these would be tests that relied on the previously-allowed behavior and need `formula` buffers inserted.

- [ ] **Step 6: Commit**

```bash
git add test/core.test.ts src/lib/core/expression-manager.ts
git commit -m "feat: add operator nesting restriction to addExpression"
```

---

### Task 2: `insertExpression` — nesting guard and tests

**Files:**
- Modify: `test/core.test.ts` (add to the `operator nesting restriction` describe block)
- Modify: `src/lib/core/expression-manager.ts:838-901` (inside `insertExpression`)

- [ ] **Step 1: Write failing tests for `insertExpression` nesting restriction**

Add inside the `describe("operator nesting restriction", ...)` block:

```typescript
    describe("insertExpression", () => {
        it("throws when inserting non-not operator between operator parent and its child", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-root", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-root", position: 1 })
            )
            // Inserting an `or` between `and` (parent) and `v1` (child)
            // → the `or` would become a child of `and` → violation
            expect(() =>
                premise.insertExpression(
                    makeOpExpr("op-new", "or"),
                    "v1"
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("throws when inserting non-not operator under not parent", () => {
            // Build: and(root) → [not → P, Q]
            // Insert or between not and P → or becomes child of not (which is an operator) → violation
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeOpExpr("op-not", "not", { parentId: "op-root", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-not", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-root", position: 1 })
            )
            // Inserting `or` between `not` and `v1` — or becomes child of not → violation
            expect(() =>
                premise.insertExpression(
                    makeOpExpr("op-new", "or"),
                    "v1"
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("throws when inserted operator would receive non-not operator children", () => {
            // Load legacy tree via snapshot: and(root) → [or → [P, Q], R]
            // Insert new and between or and P — and would receive or (non-not) as child → violation
            // Note: uses fromSnapshot to create the legacy tree since addExpression now rejects it
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
                    {
                        id: "v-p",
                        type: "variable",
                        variableId: VAR_P.id,
                        parentId: "op-or",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-q",
                        type: "variable",
                        variableId: VAR_Q.id,
                        parentId: "op-or",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-r",
                        type: "variable",
                        variableId: VAR_R.id,
                        parentId: "op-and",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                ] as TCorePropositionalExpression[],
            })
            // Insert new and2 between and(root) and or — and2 becomes child of and (Check 1)
            // AND or becomes child of and2 (Check 2) — both violate
            expect(() =>
                em.insertExpression(
                    {
                        id: "op-and2",
                        type: "operator",
                        operator: "and",
                        parentId: null,
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                    } as TExpressionInput,
                    "op-or"
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("allows inserting not between operator and its child", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-root", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-root", position: 1 })
            )
            expect(() =>
                premise.insertExpression(
                    makeOpExpr("op-not", "not"),
                    "v1"
                )
            ).not.toThrow()
        })

        it("allows inserting formula between operator and its child", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeOpExpr("op-not", "not", { parentId: "op-root", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-not", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-root", position: 1 })
            )
            expect(() =>
                premise.insertExpression(
                    makeFormulaExpr("formula-new"),
                    "op-not"
                )
            ).not.toThrow()
        })
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > insertExpression"`

Expected: 2 "throws" tests FAIL, 2 "allows" tests PASS.

- [ ] **Step 3: Implement the nesting guard in `insertExpression`**

In `src/lib/core/expression-manager.ts`, add two checks after the existing `implies`/`iff` root-only check (after line 901, before the anchor computation at line 903):

```typescript
        // 10a. Non-not operators cannot be direct children of operators.
        // Check 1: new expression as child of anchor's parent.
        const anchorForCheck = (leftNode ?? rightNode)!
        if (
            anchorForCheck.parentId !== null &&
            expression.type === "operator" &&
            expression.operator !== "not"
        ) {
            const anchorParent = this.expressions.get(anchorForCheck.parentId)
            if (anchorParent && anchorParent.type === "operator") {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
        }

        // Check 2: left/right nodes as children of the new expression.
        if (expression.type === "operator") {
            if (
                leftNode &&
                leftNode.type === "operator" &&
                leftNode.operator !== "not"
            ) {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
            if (
                rightNode &&
                rightNode.type === "operator" &&
                rightNode.operator !== "not"
            ) {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > insertExpression"`

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`

Expected: PASS (fix any existing tests that break).

- [ ] **Step 6: Commit**

```bash
git add test/core.test.ts src/lib/core/expression-manager.ts
git commit -m "feat: add operator nesting restriction to insertExpression"
```

---

### Task 3: `wrapExpression` — nesting guard and tests

**Files:**
- Modify: `test/core.test.ts` (add to the `operator nesting restriction` describe block)
- Modify: `src/lib/core/expression-manager.ts:1028-1047` (inside `wrapExpression`)

- [ ] **Step 1: Write failing tests for `wrapExpression` nesting restriction**

Add inside the `describe("operator nesting restriction", ...)` block:

```typescript
    describe("wrapExpression", () => {
        it("throws when wrapping with non-not operator under an operator parent", () => {
            // Build: and(root) → [P, Q]
            // Wrap P with or → or becomes child of and → violation
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-root", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-root", position: 1 })
            )
            expect(() =>
                premise.wrapExpression(
                    makeOpExpr("op-wrap", "or") as TExpressionWithoutPosition,
                    makeVarExpr("v3", VAR_R.id) as TExpressionWithoutPosition,
                    "v1"
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("throws when existing node is a non-not operator being wrapped by a new non-not operator", () => {
            // Build: formula(root) → or → [P, Q]
            // Wrap or with and → or becomes child of and → violation
            const premise = premiseWithVars()
            premise.addExpression(makeFormulaExpr("formula-root"))
            premise.addExpression(
                makeOpExpr("op-or", "or", { parentId: "formula-root", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-or", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-or", position: 1 })
            )
            expect(() =>
                premise.wrapExpression(
                    makeOpExpr("op-wrap", "and") as TExpressionWithoutPosition,
                    makeVarExpr("v3", VAR_R.id) as TExpressionWithoutPosition,
                    "op-or"
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("throws when new sibling is a non-not operator", () => {
            // Build: P (root variable)
            // Wrap P with and, sibling is or → or as child of and → violation
            const premise = premiseWithVars()
            premise.addExpression(makeVarExpr("v1", VAR_P.id))
            expect(() =>
                premise.wrapExpression(
                    makeOpExpr("op-wrap", "and") as TExpressionWithoutPosition,
                    makeOpExpr("sib-or", "or") as TExpressionWithoutPosition,
                    "v1"
                )
            ).toThrowError(
                /cannot be direct children of operator expressions/
            )
        })

        it("allows wrapping with non-not operator at root", () => {
            // Build: P (root variable)
            // Wrap P with and, sibling is Q → and at root, children are variables → OK
            const premise = premiseWithVars()
            premise.addExpression(makeVarExpr("v1", VAR_P.id))
            expect(() =>
                premise.wrapExpression(
                    makeOpExpr("op-wrap", "and") as TExpressionWithoutPosition,
                    makeVarExpr("v2", VAR_Q.id) as TExpressionWithoutPosition,
                    "v1"
                )
            ).not.toThrow()
        })
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > wrapExpression"`

Expected: 3 "throws" tests FAIL, 1 "allows" test PASS.

- [ ] **Step 3: Implement the nesting guard in `wrapExpression`**

In `src/lib/core/expression-manager.ts`, add two checks after the existing sibling `implies`/`iff` check (after line 1047, before `const anchorParentId` at line 1050):

```typescript
        // 10a. Non-not operators cannot be direct children of operators.
        // Check 1: new operator as child of existing node's parent.
        if (
            existingNode.parentId !== null &&
            operator.operator !== "not"
        ) {
            const existingParent = this.expressions.get(existingNode.parentId)
            if (existingParent && existingParent.type === "operator") {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
        }

        // Check 2: existing node and new sibling as children of the new operator.
        if (
            existingNode.type === "operator" &&
            existingNode.operator !== "not"
        ) {
            throw new Error(
                `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
            )
        }
        if (
            newSibling.type === "operator" &&
            newSibling.operator !== "not"
        ) {
            throw new Error(
                `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
            )
        }
```

Note: the `operator.operator !== "not"` check in Check 1 is technically redundant since `wrapExpression` already rejects `not` at step 7 (line 1012). But it's correct to include for clarity — the nesting rule itself only triggers for non-`not` operators as children.

Wait — actually `not` is already rejected by the existing step 7 check, so the new operator in `wrapExpression` is always non-`not`. The check in step 10a for the parent direction is therefore just: "is existingNode.parentId an operator?" But we should still guard `operator.operator !== "not"` for defensive correctness.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > wrapExpression"`

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`

Expected: PASS (fix any existing tests that break).

- [ ] **Step 6: Commit**

```bash
git add test/core.test.ts src/lib/core/expression-manager.ts
git commit -m "feat: add operator nesting restriction to wrapExpression"
```

---

### Task 4: `removeExpression` — pre-flight validation and defense-in-depth

**Files:**
- Modify: `test/core.test.ts` (add to the `operator nesting restriction` describe block)
- Modify: `src/lib/core/expression-manager.ts:391-405` (`removeExpression`), `:455-537` (`removeAndPromote`), `:539-628` (`collapseIfNeeded`)

This is the most complex task. It has three parts:
1. Add nesting guard to `removeAndPromote` (direct promotion path)
2. Add defense-in-depth guards to `collapseIfNeeded`
3. Add pre-flight simulation to `removeExpression` for cascade scenarios

- [ ] **Step 1: Write failing tests for direct promotion**

Add inside the `describe("operator nesting restriction", ...)` block:

```typescript
    describe("removeExpression — promotion", () => {
        it("throws when direct promotion would place non-not operator under operator", () => {
            // Build: and → formula → or → [P, Q]
            // Remove formula (deleteSubtree: false) → or would promote under and → violation
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-and", "and"))
            premise.addExpression(
                makeFormulaExpr("formula-1", { parentId: "op-and", position: 0 })
            )
            premise.addExpression(
                makeOpExpr("op-or", "or", { parentId: "formula-1", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-or", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-or", position: 1 })
            )
            // Need a second child for and so formula removal doesn't trigger collapse
            premise.addExpression(
                makeVarExpr("v3", VAR_R.id, { parentId: "op-and", position: 1 })
            )
            expect(() =>
                premise.removeExpression("formula-1", false)
            ).toThrowError(
                /would promote a non-not operator as a direct child of another operator/
            )
        })

        it("allows direct promotion of not under operator", () => {
            // Build: and → formula → not → P
            // Remove formula → not promotes under and → OK (not is exempt)
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-and", "and"))
            premise.addExpression(
                makeFormulaExpr("formula-1", { parentId: "op-and", position: 0 })
            )
            premise.addExpression(
                makeOpExpr("op-not", "not", { parentId: "formula-1", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-not", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-and", position: 1 })
            )
            expect(() =>
                premise.removeExpression("formula-1", false)
            ).not.toThrow()
        })

        it("throws when collapse promotion would place non-not operator under operator", () => {
            // Collapse violations require legacy trees (validly-constructed trees always have
            // formula buffers that prevent operator-under-operator after collapse).
            // Legacy tree: and → [or → [and2 → [P, Q], R], S]
            // Remove R → or has 1 child and2 → collapse: and2 promoted into and slot → VIOLATION
            const em2 = ExpressionManager.fromSnapshot({
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
                    {
                        id: "op-and2",
                        type: "operator",
                        operator: "and",
                        parentId: "op-or",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-p",
                        type: "variable",
                        variableId: VAR_P.id,
                        parentId: "op-and2",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-q",
                        type: "variable",
                        variableId: VAR_Q.id,
                        parentId: "op-and2",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-r",
                        type: "variable",
                        variableId: VAR_R.id,
                        parentId: "op-or",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-s",
                        type: "variable",
                        variableId: VAR_P.id,
                        parentId: "op-and",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                ] as TCorePropositionalExpression[],
            })
            // Legacy tree: and → [or → [and2 → [P, Q], R], S]
            // Remove R (subtree) → or has 1 child and2 → collapse: and2 promoted into and slot → VIOLATION
            expect(() => em2.removeExpression("v-r", true)).toThrowError(
                /would promote a non-not operator as a direct child of another operator/
            )
        })

        it("allows collapse promotion of not under operator", () => {
            // Legacy tree via snapshot: and → [or → [not → P, Q], R]
            // Remove Q → or has 1 child not → collapse: not promoted into and slot → OK
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
                    {
                        id: "op-not",
                        type: "operator",
                        operator: "not",
                        parentId: "op-or",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-p",
                        type: "variable",
                        variableId: VAR_P.id,
                        parentId: "op-not",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-q",
                        type: "variable",
                        variableId: VAR_Q.id,
                        parentId: "op-or",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-r",
                        type: "variable",
                        variableId: VAR_R.id,
                        parentId: "op-and",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                ] as TCorePropositionalExpression[],
            })
            // Remove Q → or has 1 child not → collapse: not promoted under and → OK
            expect(() => em.removeExpression("v-q", true)).not.toThrow()
        })

        it("allows cascading collapse where final promotion is safe", () => {
            // and → [not → formula → or → [P, Q], R]
            // This is constructible under new rules.
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-and", "and"))
            premise.addExpression(
                makeOpExpr("op-not", "not", { parentId: "op-and", position: 0 })
            )
            premise.addExpression(
                makeFormulaExpr("formula-1", { parentId: "op-not", position: 0 })
            )
            premise.addExpression(
                makeOpExpr("op-or", "or", { parentId: "formula-1", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v1", VAR_P.id, { parentId: "op-or", position: 0 })
            )
            premise.addExpression(
                makeVarExpr("v2", VAR_Q.id, { parentId: "op-or", position: 1 })
            )
            premise.addExpression(
                makeVarExpr("v3", VAR_R.id, { parentId: "op-and", position: 1 })
            )
            // Remove or (subtree) → formula has 0 children → formula deleted →
            //   not has 0 children → not deleted → and has 1 child R →
            //   R promoted to root → OK (R is variable at root)
            expect(() => premise.removeExpression("op-or", true)).not.toThrow()
        })

        it("throws on cascading collapse where final promotion violates nesting rule", () => {
            // Legacy tree: and → [or → [not → P, and2 → [Q, R]], S]
            // Remove P → not(0 children) deleted → or(1 child: and2) collapses →
            //   and2 promoted into and slot → and2 under and → VIOLATION
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
                    {
                        id: "op-not",
                        type: "operator",
                        operator: "not",
                        parentId: "op-or",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-p",
                        type: "variable",
                        variableId: VAR_P.id,
                        parentId: "op-not",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "op-and2",
                        type: "operator",
                        operator: "and",
                        parentId: "op-or",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-q",
                        type: "variable",
                        variableId: VAR_Q.id,
                        parentId: "op-and2",
                        position: 0,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-r",
                        type: "variable",
                        variableId: VAR_R.id,
                        parentId: "op-and2",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                    {
                        id: "v-s",
                        type: "variable",
                        variableId: VAR_P.id,
                        parentId: "op-and",
                        position: 1,
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: "premise-1",
                        checksum: "",
                    },
                ] as TCorePropositionalExpression[],
            })
            // Legacy: and → [or → [not → P, and2 → [Q, R]], S]
            // Remove P (subtree) → not(0 children) deleted → or(1 child: and2) collapses →
            //   and2 promoted into and slot → and2 under and → VIOLATION
            expect(() => em.removeExpression("v-p", true)).toThrowError(
                /would promote a non-not operator as a direct child of another operator/
            )
        })
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > removeExpression"`

Expected: 3 "throws" tests FAIL, 2 "allows" tests PASS.

- [ ] **Step 3: Implement the nesting guard in `removeAndPromote`**

In `src/lib/core/expression-manager.ts`, in the `removeAndPromote` method, add the nesting check alongside the existing root-only check. After line 486 (the comment `// Validate: root-only operators...`), extend the guard block:

```typescript
        // Validate: non-not operators cannot be promoted into an operator parent.
        if (
            child.type === "operator" &&
            child.operator !== "not" &&
            target.parentId !== null
        ) {
            const grandparent = this.expressions.get(target.parentId)
            if (grandparent && grandparent.type === "operator") {
                throw new Error(
                    `Cannot remove expression — would promote a non-not operator as a direct child of another operator`
                )
            }
        }
```

- [ ] **Step 4: Implement defense-in-depth in `collapseIfNeeded`**

In the `collapseIfNeeded` method, in the `children.length === 1` branch (after line 590, where `const grandparentId = operator.parentId`), add:

```typescript
            // Defense-in-depth: validate that promotion doesn't violate nesting or root-only rules.
            if (child.type === "operator") {
                if (
                    (child.operator === "implies" || child.operator === "iff") &&
                    grandparentId !== null
                ) {
                    throw new Error(
                        `Cannot promote: child "${child.id}" is a root-only operator ("${child.operator}") and would be placed in a non-root position.`
                    )
                }
                if (child.operator !== "not" && grandparentId !== null) {
                    const grandparent = this.expressions.get(grandparentId)
                    if (grandparent && grandparent.type === "operator") {
                        throw new Error(
                            `Cannot remove expression — would promote a non-not operator as a direct child of another operator`
                        )
                    }
                }
            }
```

- [ ] **Step 5: Implement the pre-flight simulation in `removeExpression`**

In `removeExpression`, before the `if (deleteSubtree)` branch (after line 398, before line 400), add the pre-flight check:

```typescript
        // Pre-flight: simulate collapse chain to detect nesting/root-only violations.
        this.assertRemovalSafe(expressionId, deleteSubtree)
```

Add a new private method `assertRemovalSafe`:

```typescript
    /**
     * Simulates the collapse chain that would result from removing an expression.
     * Throws if any promotion in the chain would violate the nesting rule or
     * the root-only rule for implies/iff.
     */
    private assertRemovalSafe(
        expressionId: string,
        deleteSubtree: boolean
    ): void {
        const target = this.expressions.get(expressionId)
        if (!target) return

        if (!deleteSubtree) {
            const children = this.getChildExpressions(expressionId)
            // >1 children: removeAndPromote throws "has multiple children" before
            // any mutation occurs, so no nesting concern.
            if (children.length === 1) {
                this.assertPromotionSafe(children[0], target.parentId)
            }
            if (children.length === 0) {
                // Leaf removal triggers collapse on parent.
                this.simulateCollapseChain(target.parentId, expressionId)
            }
            return
        }

        // deleteSubtree: the entire subtree is removed, then collapse runs on parent.
        this.simulateCollapseChain(target.parentId, expressionId)
    }

    /**
     * Checks whether promoting `child` into a slot with the given `newParentId`
     * would violate the nesting rule or root-only rule.
     */
    private assertPromotionSafe(
        child: TExpr,
        newParentId: string | null
    ): void {
        if (child.type !== "operator") return

        // Root-only check
        if (
            (child.operator === "implies" || child.operator === "iff") &&
            newParentId !== null
        ) {
            throw new Error(
                `Cannot remove expression — would promote a root-only operator ("${child.operator}") to a non-root position`
            )
        }

        // Nesting check
        if (child.operator !== "not" && newParentId !== null) {
            const newParent = this.expressions.get(newParentId)
            if (newParent && newParent.type === "operator") {
                throw new Error(
                    `Cannot remove expression — would promote a non-not operator as a direct child of another operator`
                )
            }
        }
    }

    /**
     * Walks the collapse chain starting from `operatorId` after `removedChildId`
     * is removed. At each level: compute resulting child count. If 0, the
     * operator/formula is deleted and the chain continues to its parent. If 1,
     * check whether the surviving child can be promoted safely.
     */
    private simulateCollapseChain(
        operatorId: string | null,
        removedChildId: string
    ): void {
        if (operatorId === null) return

        const operator = this.expressions.get(operatorId)
        if (!operator) return

        // Only operators and formulas collapse.
        if (operator.type !== "operator" && operator.type !== "formula") return

        const children = this.getChildExpressions(operatorId)
        const remainingChildren = children.filter(
            (c) => c.id !== removedChildId
        )

        if (operator.type === "formula") {
            // Formula only handles 0-child case (deleted and recurse up).
            if (remainingChildren.length === 0) {
                this.simulateCollapseChain(operator.parentId, operatorId)
            }
            return
        }

        // operator.type === "operator"
        if (remainingChildren.length === 0) {
            // Operator deleted, recurse up.
            this.simulateCollapseChain(operator.parentId, operatorId)
        } else if (remainingChildren.length === 1) {
            // Surviving child would be promoted into operator's slot.
            this.assertPromotionSafe(remainingChildren[0], operator.parentId)
        }
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > removeExpression"`

Expected: All 6 tests PASS.

- [ ] **Step 7: Run full test suite**

Run: `pnpm run test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add test/core.test.ts src/lib/core/expression-manager.ts
git commit -m "feat: add operator nesting restriction to removeExpression with pre-flight validation"
```

---

### Task 5: Restoration bypass — `loadExpressions` and `fromData` refactor

**Files:**
- Modify: `test/core.test.ts` (add restoration tests to the `operator nesting restriction` describe block)
- Modify: `src/lib/core/expression-manager.ts:666-701` (`loadInitialExpressions`)
- Modify: `src/lib/core/premise-engine.ts` (add `loadExpressions` method)
- Modify: `src/lib/core/argument-engine.ts:1109-1138` (`fromData` expression loading)

- [ ] **Step 1: Write failing tests for restoration bypass**

Add inside the `describe("operator nesting restriction", ...)` block:

```typescript
    describe("restoration bypass", () => {
        it("fromSnapshot can restore a tree with operator-under-operator", () => {
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
            expect(em.getExpression("op-or")).toBeDefined()
        })

        it("fromData can reconstruct a tree with operator-under-operator", () => {
            const arg = { id: "arg-1", version: 1 }
            const variables = [
                {
                    id: "v1",
                    symbol: "P",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    claimId: "claim-default",
                    claimVersion: 0,
                },
            ]
            const premises: TOptionalChecksum<TCorePremise>[] = [
                { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
            ]
            const expressions = [
                {
                    id: "e-and",
                    type: "operator" as const,
                    operator: "and" as const,
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: "p1",
                    parentId: null,
                    position: 0,
                },
                {
                    id: "e-or",
                    type: "operator" as const,
                    operator: "or" as const,
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: "p1",
                    parentId: "e-and",
                    position: 0,
                },
                {
                    id: "e-v1",
                    type: "variable" as const,
                    variableId: "v1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: "p1",
                    parentId: "e-or",
                    position: 0,
                },
                {
                    id: "e-v2",
                    type: "variable" as const,
                    variableId: "v1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: "p1",
                    parentId: "e-or",
                    position: 1,
                },
                {
                    id: "e-v3",
                    type: "variable" as const,
                    variableId: "v1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: "p1",
                    parentId: "e-and",
                    position: 1,
                },
            ]
            const roles = { conclusionPremiseId: "p1" }
            expect(() =>
                ArgumentEngine.fromData(
                    arg,
                    aLib(),
                    sLib(),
                    csLib(),
                    variables,
                    premises,
                    expressions,
                    roles
                )
            ).not.toThrow()
        })

        it("rollback can restore a tree with operator-under-operator", () => {
            // Create a valid engine, take snapshot, modify, then rollback
            // to a snapshot that was captured BEFORE (with legacy data via fromSnapshot)
            const arg = { id: "arg-1", version: 1 }
            const engine = new ArgumentEngine(
                arg,
                aLib(),
                sLib(),
                csLib()
            )
            engine.addVariable({
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            })
            const { result: pm } = engine.createPremise()

            // Build a legacy snapshot with operator-under-operator
            const snapshot = engine.snapshot()
            const premSnap = snapshot.premises[0]
            premSnap.expressions.expressions = [
                {
                    id: "op-and",
                    type: "operator",
                    operator: "and",
                    parentId: null,
                    position: 0,
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: pm.getId(),
                    checksum: "",
                },
                {
                    id: "op-or",
                    type: "operator",
                    operator: "or",
                    parentId: "op-and",
                    position: 0,
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    premiseId: pm.getId(),
                    checksum: "",
                },
            ] as TCorePropositionalExpression[]
            premSnap.rootExpressionId = "op-and"

            expect(() => engine.rollback(snapshot)).not.toThrow()
        })
    })
```

- [ ] **Step 2: Run tests to verify the `fromSnapshot` test passes and `fromData` test fails**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > restoration bypass"`

Expected: `fromSnapshot` test PASSES (already uses `loadInitialExpressions` with `skipNestingCheck`). `fromData` test FAILS (calls `pe.addExpression` directly). `rollback` test PASSES (uses `fromSnapshot` path).

- [ ] **Step 3: Add `skipNestingCheck` to `loadInitialExpressions`**

In `src/lib/core/expression-manager.ts`, modify `loadInitialExpressions` (line 666) to wrap the body in the skip flag:

```typescript
    private loadInitialExpressions(
        initialExpressions: TExpressionInput<TExpr>[]
    ) {
        if (initialExpressions.length === 0) {
            return
        }

        this.skipNestingCheck = true
        try {
            const pending = new Map<string, TExpressionInput<TExpr>>(
                initialExpressions.map((expression) => [expression.id, expression])
            )

            let progressed = true
            while (pending.size > 0 && progressed) {
                progressed = false

                for (const [id, expression] of Array.from(pending.entries())) {
                    if (
                        expression.parentId !== null &&
                        !this.expressions.has(expression.parentId)
                    ) {
                        continue
                    }

                    this.addExpression(expression)
                    pending.delete(id)
                    progressed = true
                }
            }

            if (pending.size > 0) {
                const unresolved = Array.from(pending.keys()).join(", ")
                throw new Error(
                    `Could not resolve parent relationships for expressions: ${unresolved}.`
                )
            }
        } finally {
            this.skipNestingCheck = false
        }
    }
```

- [ ] **Step 4: Expose `loadExpressions` on `ExpressionManager`**

Add a new public method to `ExpressionManager` that delegates to `loadInitialExpressions`:

```typescript
    /**
     * Loads expressions in BFS order with the nesting check bypassed.
     * Used by restoration paths (fromData, rollback) that load existing data.
     */
    public loadExpressions(
        expressions: TExpressionInput<TExpr>[]
    ): void {
        this.loadInitialExpressions(expressions)
    }
```

- [ ] **Step 5: Expose `loadExpressions` on `PremiseEngine`**

In `src/lib/core/premise-engine.ts`, add a method that delegates to `ExpressionManager.loadExpressions` and handles the premise-level bookkeeping (root tracking, variable index, expression index):

```typescript
    /**
     * Loads expressions in BFS order with the nesting check bypassed.
     * Used by ArgumentEngine.fromData to load existing data without
     * triggering the operator nesting restriction.
     */
    public loadExpressions(
        expressions: TExpressionInput<TExpr>[]
    ): void {
        this.expressions.loadExpressions(expressions)

        // Rebuild root and variable tracking after bulk load.
        for (const expr of this.expressions.toArray()) {
            if (expr.parentId === null) {
                this.rootExpressionId = expr.id
            }
            if (expr.type === "variable") {
                this.expressionsByVariableId
                    .get(expr.variableId)
                    .add(expr.id)
            }
            if (this.expressionIndex) {
                this.expressionIndex.set(expr.id, this.premise.id)
            }
        }
        this.markDirty()
    }
```

Note: Check the exact fields and methods available on `PremiseEngine`. The `expressionsByVariableId` uses a `DefaultMap`, and `this.expressionIndex` is the shared index. `markDirty` updates the premise checksum. Adjust this implementation based on the actual PremiseEngine internals.

**Important:** `loadExpressions` bypasses not only the nesting check but also `PremiseEngine.addExpression`'s other validation (argument ownership, variable existence, circularity). This is intentionally broader — restoration paths trust existing data completely. The nesting restriction bypass is just one aspect of this. The method intentionally does NOT call `this.onMutate?.()` since restoration is not a user mutation.

- [ ] **Step 6: Refactor `ArgumentEngine.fromData` to use `pe.loadExpressions`**

In `src/lib/core/argument-engine.ts`, replace the expression-loading loop (lines 1109-1138) with:

```typescript
        // Add expressions via loadExpressions (bypasses nesting check for legacy data)
        for (const [premiseId, pe] of premiseEngines) {
            const premiseExprs = exprsByPremise.get(premiseId) ?? []
            pe.loadExpressions(premiseExprs)
        }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "operator nesting restriction > restoration bypass"`

Expected: All 3 tests PASS.

- [ ] **Step 8: Run full test suite**

Run: `pnpm run test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/core/expression-manager.ts src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add restoration bypass for operator nesting restriction"
```

---

### Task 6: Fix any existing test failures and update CLAUDE.md

**Files:**
- Modify: `test/core.test.ts` (fix any tests that construct operator-under-operator trees)
- Modify: `CLAUDE.md` (add nesting restriction to key design rules)

- [ ] **Step 1: Run full test suite and identify failures**

Run: `pnpm run test`

The following existing tests construct operator-under-operator trees and will fail:

1. **Line ~813** — `"promotes the surviving child to a non-root slot (nested collapse)"` in `describe("removeExpression — operator collapse")`: constructs `or → and → [P, Q]`. Fix: insert formula buffer between `or` and `and`.
2. **Lines ~3624, ~3633** — `"profiles compound antecedent and consequent"` in `describe("buildPremiseProfile")`: constructs `implies → and`. Fix: insert formula buffers between `implies` and each `and` child.
3. **Line ~6704** — `"deleteSubtree: false — promotes single child (operator)"` in `describe("removeExpression — deleteSubtree parameter")`: constructs `and → or`. Fix: insert formula buffer between `and` and `or`.
4. **Line ~6804** — `"deleteSubtree: false — promotes child into non-root slot"` in same describe: constructs `not → or`. Fix: insert formula buffer between `not` and `or`.

- [ ] **Step 2: Fix failing tests**

For each failing test, insert `formula` expressions between operator parents and non-`not` operator children. The pattern is:

```typescript
// Before (operator under operator):
premise.addExpression(makeOpExpr("op-child", "or", { parentId: "op-parent" }))

// After (formula buffer):
premise.addExpression(makeFormulaExpr("formula-N", { parentId: "op-parent" }))
premise.addExpression(makeOpExpr("op-child", "or", { parentId: "formula-N" }))
```

- [ ] **Step 3: Update CLAUDE.md design rules**

Add to the "Key design rules" section in `CLAUDE.md`:

```markdown
- **Operator nesting restriction:** Non-`not` operator expressions (`and`, `or`, `implies`, `iff`) cannot be direct children of any operator expression. A `formula` node must sit between them. `not` is exempt as a child. Enforced in `addExpression`, `insertExpression`, `wrapExpression`, and `removeExpression` (pre-flight check). Bypassed during `fromSnapshot`/`fromData`/`rollback` restoration.
```

- [ ] **Step 4: Run full check**

Run: `pnpm run check`

Expected: All checks pass (typecheck, lint, test, build).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: update existing tests for operator nesting restriction and document design rule"
```

---

### Task 7: Documentation sync

**Files:**
- Check: `docs/api-reference.md` — update if `addExpression`/`insertExpression`/`wrapExpression`/`removeExpression` docs mention thrown errors
- Check: `src/lib/core/interfaces/premise-engine.interfaces.ts` — update JSDoc for affected methods
- Check: `src/lib/core/interfaces/argument-engine.interfaces.ts` — update JSDoc if applicable

- [ ] **Step 1: Update interface JSDoc for affected PremiseEngine methods**

In `src/lib/core/interfaces/premise-engine.interfaces.ts`, add `@throws` documentation for the nesting restriction to `addExpression`, `insertExpression`, `wrapExpression`, and `removeExpression`.

- [ ] **Step 2: Update API reference if applicable**

Check `docs/api-reference.md` for references to the affected methods and update their error documentation.

- [ ] **Step 3: Run full check**

Run: `pnpm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: update API documentation for operator nesting restriction"
```
