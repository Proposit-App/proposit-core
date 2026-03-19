# Grammar Enforcement Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc `skipNestingCheck` flag with a first-class `TGrammarConfig` system that independently toggles structural rules and supports auto-normalization.

**Architecture:** New `TGrammarConfig` type threads through `TLogicEngineOptions` → `ArgumentEngine` → `PremiseEngine` → `ExpressionManager`. All nesting checks consult `grammarConfig.enforceFormulaBetweenOperators` instead of `skipNestingCheck`. Auto-normalization in `addExpression` inserts formula buffers in-place. Static factories gain an optional `grammarConfig` parameter for load-time enforcement control.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/plans/2026-03-19-grammar-enforcement-config-design.md`

**Note:** All line numbers are approximate. Use surrounding code context to locate insertion points.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/types/grammar.ts` | Create | `TGrammarOptions`, `TGrammarConfig`, `DEFAULT_GRAMMAR_CONFIG` |
| `src/lib/index.ts` | Modify | Re-export grammar types |
| `src/lib/core/argument-engine.ts` | Modify | Add `grammarConfig` to `TLogicEngineOptions`; update `fromSnapshot`, `fromData`, `rollback` |
| `src/lib/core/expression-manager.ts` | Modify | Replace `skipNestingCheck` with grammar config; update all checks; add auto-normalize to `addExpression` |
| `src/lib/core/premise-engine.ts` | Modify | Update `snapshot()`, `fromSnapshot`, `loadExpressions` for grammar config |
| `test/core.test.ts` | Modify | Add `describe("grammar enforcement config")` block; update existing restoration tests |

---

### Task 1: Create `TGrammarConfig` type and add to `TLogicEngineOptions`

**Files:**
- Create: `src/lib/types/grammar.ts`
- Modify: `src/lib/index.ts`
- Modify: `src/lib/core/argument-engine.ts:65-68`

- [ ] **Step 1: Write the type file**

Create `src/lib/types/grammar.ts`:

```typescript
/**
 * Individual structural rule toggles for expression tree grammar.
 *
 * Each boolean controls whether a specific structural constraint is enforced.
 * When `true`, violations throw (or auto-normalize if `TGrammarConfig.autoNormalize`
 * is also `true` — but only for operations that support it).
 */
export type TGrammarOptions = {
    /** Require a `formula` node between a parent operator and a non-`not` operator child. */
    enforceFormulaBetweenOperators: boolean
}

/**
 * Grammar enforcement configuration for expression trees.
 *
 * Controls which structural rules are enforced and whether violations are
 * automatically corrected.
 *
 * **`autoNormalize` scope:** Auto-normalization is only supported by `addExpression`
 * and bulk-loading paths (`loadInitialExpressions`). Compound operations
 * (`insertExpression`, `wrapExpression`) and `removeExpression` always throw on
 * violations regardless of this flag.
 */
export type TGrammarConfig = TGrammarOptions & {
    /** When `true`, auto-fix violations where possible instead of throwing. */
    autoNormalize: boolean
}

/** Default config: all rules enforced, auto-normalize off. */
export const DEFAULT_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: true,
    autoNormalize: false,
}

/** Permissive config: no enforcement. Used by default in `fromData`. */
export const PERMISSIVE_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: false,
    autoNormalize: false,
}
```

- [ ] **Step 2: Add re-export to `src/lib/index.ts`**

Add after the existing types re-exports (around line 22):

```typescript
export * from "./types/grammar.js"
```

- [ ] **Step 3: Update `TLogicEngineOptions` in `src/lib/core/argument-engine.ts`**

Add the import at the top:

```typescript
import type { TGrammarConfig } from "../types/grammar.js"
```

Add `grammarConfig` to the type (line 65-68):

```typescript
export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
    grammarConfig?: TGrammarConfig
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`

Expected: PASS (new type is defined but not yet used anywhere).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/grammar.ts src/lib/index.ts src/lib/core/argument-engine.ts
git commit -m "feat: add TGrammarConfig type and DEFAULT_GRAMMAR_CONFIG"
```

---

### Task 2: Replace `skipNestingCheck` with grammar config in `ExpressionManager`

**Files:**
- Modify: `src/lib/core/expression-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for config-controlled enforcement**

Add a new top-level `describe` at the end of `test/core.test.ts`:

```typescript
describe("grammar enforcement config", () => {
    describe("config toggles enforcement", () => {
        it("default config enforces nesting restriction", () => {
            const premise = premiseWithVars()
            premise.addExpression(makeOpExpr("op-root", "and"))
            expect(() =>
                premise.addExpression(
                    makeOpExpr("op-child", "or", { parentId: "op-root", position: 0 })
                )
            ).toThrowError(/cannot be direct children of operator expressions/)
        })

        it("enforcement disabled allows operator-under-operator via addExpression", () => {
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
            expect(() =>
                em.addExpression({
                    id: "op-or",
                    type: "operator",
                    operator: "or",
                    parentId: "op-and",
                    position: 0,
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    premiseId: "premise-1",
                } as TExpressionInput)
            ).not.toThrow()
        })
    })
})
```

Import `DEFAULT_GRAMMAR_CONFIG` and `PERMISSIVE_GRAMMAR_CONFIG` at the top of the test file if not already present.

- [ ] **Step 2: Run tests to verify the "enforcement disabled" test fails**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config"`

Expected: "default config enforces" PASSES, "enforcement disabled" FAILS.

- [ ] **Step 3: Implement grammar config in `ExpressionManager`**

In `src/lib/core/expression-manager.ts`:

1. Add import at top:
```typescript
import { DEFAULT_GRAMMAR_CONFIG, type TGrammarConfig } from "../types/grammar.js"
```

2. Remove `private skipNestingCheck = false` (line 74).

3. Add a private getter that reads grammar config from `this.config` (single source of truth — no separate field, no dual-storage risk):
```typescript
    private get grammarConfig(): TGrammarConfig {
        return this.config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
    }
```

The constructor stays unchanged — `this.config` is already stored.

4. Update the nesting guard in `addExpression` (lines 154-164). Replace:
```typescript
            if (
                !this.skipNestingCheck &&
                parent.type === "operator" &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
```
With:
```typescript
            if (
                this.grammarConfig.enforceFormulaBetweenOperators &&
                parent.type === "operator" &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
```

5. Update `loadInitialExpressions` (lines 728-756). Remove the `skipNestingCheck` toggle — the method already calls `addExpression` which uses `grammarConfig`. Remove the `this.skipNestingCheck = true` / `finally { this.skipNestingCheck = false }` wrapper, leaving just the BFS loop.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config"`

Expected: Both tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm run test`

Since `loadInitialExpressions` no longer bypasses and `fromSnapshot` reads grammar config from `snapshot.config` (which defaults to `DEFAULT_GRAMMAR_CONFIG` when absent), existing tests that use `ExpressionManager.fromSnapshot` to load legacy trees will now throw.

**Fix now (don't defer):** Add `config: { grammarConfig: PERMISSIVE_GRAMMAR_CONFIG }` to every `ExpressionManager.fromSnapshot` call that loads operator-under-operator trees. Import `PERMISSIVE_GRAMMAR_CONFIG` from `../src/lib/types/grammar`. These tests are in `describe("operator nesting restriction")` — the `removeExpression — promotion` and `restoration bypass` sub-describes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: replace skipNestingCheck with grammarConfig in ExpressionManager"
```

---

### Task 3: Update all nesting checks to use grammar config

**Files:**
- Modify: `src/lib/core/expression-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for disabled enforcement in other methods**

Add inside `describe("grammar enforcement config")`:

```typescript
    describe("enforcement disabled for all methods", () => {
        it("allows operator-under-operator via insertExpression", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: false,
                    autoNormalize: false,
                },
            })
            // Build: and(root) → [P, Q]
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
            em.addExpression({
                id: "v-q", type: "variable", variableId: VAR_Q.id,
                parentId: "op-and", position: 1,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)
            // Insert or between and and v-p — or becomes child of and
            expect(() =>
                em.insertExpression({
                    id: "op-or", type: "operator", operator: "or",
                    parentId: null, position: 0,
                    argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
                } as TExpressionInput, "v-p")
            ).not.toThrow()
        })

        it("allows operator-under-operator via wrapExpression", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: false,
                    autoNormalize: false,
                },
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
            em.addExpression({
                id: "v-q", type: "variable", variableId: VAR_Q.id,
                parentId: "op-and", position: 1,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)
            // Wrap v-p with or, sibling is and2 → or becomes child of and
            expect(() =>
                em.wrapExpression(
                    { id: "op-or", type: "operator", operator: "or",
                      argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
                    } as TExpressionWithoutPosition,
                    { id: "v-r", type: "variable", variableId: VAR_R.id,
                      argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
                    } as TExpressionWithoutPosition,
                    "v-p"
                )
            ).not.toThrow()
        })

        it("allows removal that would promote operator-under-operator", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: false,
                    autoNormalize: false,
                },
            })
            // Build: and → formula → or → [P, Q], and has second child R
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
            // Remove formula → or promoted under and (normally a violation)
            expect(() => em.removeExpression("formula-1", false)).not.toThrow()
        })
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config > enforcement disabled"`

Expected: All 3 FAIL (the checks don't consult grammar config yet).

- [ ] **Step 3: Update `insertExpression` nesting checks**

In `src/lib/core/expression-manager.ts`, find the two nesting check blocks in `insertExpression` (around lines 1053-1084). Wrap each in `if (this.grammarConfig.enforceFormulaBetweenOperators)`. The existing code structure:

```typescript
        // 10a. Non-not operators cannot be direct children of operators.
        // Check 1: ...
        if (anchor.parentId !== null && expression.type === "operator" && expression.operator !== "not") {
```

Becomes:

```typescript
        // 10a. Non-not operators cannot be direct children of operators.
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            // Check 1: ...
            if (anchor.parentId !== null && expression.type === "operator" && expression.operator !== "not") {
                ...
            }
            // Check 2: ...
            if (expression.type === "operator") {
                ...
            }
        }
```

- [ ] **Step 4: Update `wrapExpression` nesting checks**

Find the nesting checks in `wrapExpression` (around lines 1234-1257). Wrap them in the same `if (this.grammarConfig.enforceFormulaBetweenOperators)` guard.

- [ ] **Step 5: Update `removeExpression` pre-flight and defense-in-depth**

Update `assertPromotionSafe` (around line 806-814): wrap the nesting check (not the root-only check) in `if (this.grammarConfig.enforceFormulaBetweenOperators)`.

Update `removeAndPromote` defense-in-depth (around lines 503-515): wrap in `if (this.grammarConfig.enforceFormulaBetweenOperators)`.

Update `collapseIfNeeded` defense-in-depth (around lines 634-641): wrap in `if (this.grammarConfig.enforceFormulaBetweenOperators)`.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config"`

Expected: All tests PASS.

- [ ] **Step 7: Run full suite**

Run: `pnpm run test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: all nesting checks consult grammarConfig"
```

---

### Task 4: Auto-normalize in `addExpression`

**Files:**
- Modify: `src/lib/core/expression-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for auto-normalize**

Add inside `describe("grammar enforcement config")`:

```typescript
    describe("auto-normalize", () => {
        it("addExpression auto-inserts formula buffer when autoNormalize is true", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: true,
                },
            })
            em.addExpression({
                id: "op-and", type: "operator", operator: "and",
                parentId: null, position: 0,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)
            // This would normally throw — but autoNormalize inserts a formula
            em.addExpression({
                id: "op-or", type: "operator", operator: "or",
                parentId: "op-and", position: 0,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)

            // op-or should exist and be parented under a formula, not directly under op-and
            const orExpr = em.getExpression("op-or")!
            expect(orExpr).toBeDefined()
            expect(orExpr.parentId).not.toBe("op-and")
            expect(orExpr.position).toBe(0)

            // The auto-inserted formula should be parented under op-and
            const formulaId = orExpr.parentId!
            const formulaExpr = em.getExpression(formulaId)!
            expect(formulaExpr).toBeDefined()
            expect(formulaExpr.type).toBe("formula")
            expect(formulaExpr.parentId).toBe("op-and")
            expect(formulaExpr.argumentId).toBe(ARG.id)
            expect(formulaExpr.argumentVersion).toBe(ARG.version)
            expect((formulaExpr as any).premiseId).toBe("premise-1")
        })

        it("auto-inserted formula has correct position under parent", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: true,
                },
            })
            em.addExpression({
                id: "op-and", type: "operator", operator: "and",
                parentId: null, position: 0,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)
            em.addExpression({
                id: "op-or", type: "operator", operator: "or",
                parentId: "op-and", position: 5,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)

            const orExpr = em.getExpression("op-or")!
            const formulaExpr = em.getExpression(orExpr.parentId!)!
            // The formula takes the original position (5) under and
            expect(formulaExpr.position).toBe(5)
        })

        it("insertExpression still throws even with autoNormalize", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: true,
                },
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
            em.addExpression({
                id: "v-q", type: "variable", variableId: VAR_Q.id,
                parentId: "op-and", position: 1,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)
            expect(() =>
                em.insertExpression({
                    id: "op-or", type: "operator", operator: "or",
                    parentId: null, position: 0,
                    argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
                } as TExpressionInput, "v-p")
            ).toThrowError(/cannot be direct children of operator expressions/)
        })

        it("wrapExpression still throws even with autoNormalize", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: true,
                },
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
            em.addExpression({
                id: "v-q", type: "variable", variableId: VAR_Q.id,
                parentId: "op-and", position: 1,
                argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
            } as TExpressionInput)
            expect(() =>
                em.wrapExpression(
                    { id: "op-or", type: "operator", operator: "or",
                      argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
                    } as TExpressionWithoutPosition,
                    { id: "v-r", type: "variable", variableId: VAR_R.id,
                      argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1",
                    } as TExpressionWithoutPosition,
                    "v-p"
                )
            ).toThrowError(/cannot be direct children of operator expressions/)
        })

        it("removeExpression still throws even with autoNormalize", () => {
            const em = new ExpressionManager({
                grammarConfig: {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: true,
                },
            })
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
            // Remove formula → or would promote under and
            expect(() => em.removeExpression("formula-1", false)).toThrowError(
                /would promote a non-not operator/
            )
        })
    })
```

- [ ] **Step 2: Run tests to verify auto-normalize tests fail**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config > auto-normalize"`

Expected: First 2 tests FAIL (auto-normalize not implemented). Last 3 PASS (they expect throws).

- [ ] **Step 3: Implement auto-normalize in `addExpression`**

In `src/lib/core/expression-manager.ts`, update the nesting guard in `addExpression`. The current code throws when `enforceFormulaBetweenOperators` is true. Add an `autoNormalize` branch:

```typescript
            // Non-not operators cannot be direct children of operators.
            if (
                this.grammarConfig.enforceFormulaBetweenOperators &&
                parent.type === "operator" &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
                if (this.grammarConfig.autoNormalize) {
                    // Auto-insert a formula buffer between parent and expression.
                    const formulaId = randomUUID()
                    const formulaExpr = this.attachChecksum({
                        id: formulaId,
                        type: "formula",
                        argumentId: expression.argumentId,
                        argumentVersion: expression.argumentVersion,
                        premiseId: expression.premiseId,
                        parentId: expression.parentId,
                        position: expression.position,
                    } as TExpressionInput<TExpr>)

                    // Register formula directly in stores (no recursive addExpression).
                    this.expressions.set(formulaId, formulaExpr)
                    this.collector?.addedExpression({
                        ...formulaExpr,
                    } as unknown as TCorePropositionalExpression)
                    getOrCreate(
                        this.childExpressionIdsByParentId,
                        expression.parentId,
                        () => new Set()
                    ).add(formulaId)
                    getOrCreate(
                        this.childPositionsByParentId,
                        expression.parentId,
                        () => new Set()
                    ).add(expression.position)

                    // Rewrite expression to be child of formula.
                    expression = {
                        ...expression,
                        parentId: formulaId,
                        position: 0,
                    } as TExpressionInput<TExpr>

                    // Re-assign parent for subsequent checks (child limit, etc.)
                    // The formula is unary, and we're adding the first child, so no limit check needed.
                    // Continue with normal addExpression flow using the rewritten expression.
                } else {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
            }
```

Add `import { randomUUID } from "node:crypto"` at the top if not already imported. Check existing imports first — `expression-manager.ts` may not import it yet. If not, add it.

**Important:** The `expression` parameter needs to be `let` instead of the implicit function parameter. Since it's a parameter of `addExpression(expression: TExpressionInput<TExpr>)`, you cannot reassign it. Instead, create a `let` local:

```typescript
    public addExpression(input: TExpressionInput<TExpr>) {
        let expression = input
        // ... rest of method
```

Or use a mutable wrapper. Check the actual code to determine the cleanest approach.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config > auto-normalize"`

Expected: All 5 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `pnpm run test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: add auto-normalize for operator nesting in addExpression"
```

---

### Task 5: Update `fromSnapshot` signatures and restoration tests

**Files:**
- Modify: `src/lib/core/expression-manager.ts` (`fromSnapshot`)
- Modify: `src/lib/core/premise-engine.ts` (`fromSnapshot`, `snapshot()`)
- Modify: `src/lib/core/argument-engine.ts` (`fromSnapshot`, `fromData`, `rollback`)
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for restoration config**

Add inside `describe("grammar enforcement config")`:

```typescript
    describe("restoration paths", () => {
        it("fromSnapshot with enforcing config rejects operator-under-operator", () => {
            expect(() =>
                ExpressionManager.fromSnapshot({
                    expressions: [
                        { id: "op-and", type: "operator", operator: "and", parentId: null, position: 0, argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1", checksum: "" },
                        { id: "op-or", type: "operator", operator: "or", parentId: "op-and", position: 0, argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1", checksum: "" },
                    ] as TCorePropositionalExpression[],
                })
            ).toThrowError(/cannot be direct children of operator expressions/)
        })

        it("fromSnapshot with permissive config allows operator-under-operator", () => {
            const em = ExpressionManager.fromSnapshot(
                {
                    expressions: [
                        { id: "op-and", type: "operator", operator: "and", parentId: null, position: 0, argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1", checksum: "" },
                        { id: "op-or", type: "operator", operator: "or", parentId: "op-and", position: 0, argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1", checksum: "" },
                    ] as TCorePropositionalExpression[],
                },
                PERMISSIVE_GRAMMAR_CONFIG
            )
            expect(em.getExpression("op-or")).toBeDefined()
        })

        it("fromSnapshot with auto-normalize config normalizes legacy tree", () => {
            const em = ExpressionManager.fromSnapshot(
                {
                    expressions: [
                        { id: "op-and", type: "operator", operator: "and", parentId: null, position: 0, argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1", checksum: "" },
                        { id: "op-or", type: "operator", operator: "or", parentId: "op-and", position: 0, argumentId: ARG.id, argumentVersion: ARG.version, premiseId: "premise-1", checksum: "" },
                    ] as TCorePropositionalExpression[],
                },
                { enforceFormulaBetweenOperators: true, autoNormalize: true }
            )
            // op-or should exist but parented under a formula, not directly under op-and
            const orExpr = em.getExpression("op-or")!
            expect(orExpr).toBeDefined()
            expect(orExpr.parentId).not.toBe("op-and")
            const formulaExpr = em.getExpression(orExpr.parentId!)!
            expect(formulaExpr.type).toBe("formula")
            expect(formulaExpr.parentId).toBe("op-and")
        })

        it("fromData with no grammar config uses permissive default", () => {
            const arg = { id: "arg-1", version: 1 }
            const variables = [
                { id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1, claimId: "claim-default", claimVersion: 0 },
            ]
            const premises: TOptionalChecksum<TCorePremise>[] = [
                { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
            ]
            const expressions = [
                { id: "e-and", type: "operator" as const, operator: "and" as const, argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: null, position: 0 },
                { id: "e-or", type: "operator" as const, operator: "or" as const, argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-and", position: 0 },
                { id: "e-v1", type: "variable" as const, variableId: "v1", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-or", position: 0 },
                { id: "e-v2", type: "variable" as const, variableId: "v1", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-or", position: 1 },
                { id: "e-v3", type: "variable" as const, variableId: "v1", argumentId: "arg-1", argumentVersion: 1, premiseId: "p1", parentId: "e-and", position: 1 },
            ]
            expect(() =>
                ArgumentEngine.fromData(arg, aLib(), sLib(), csLib(), variables, premises, expressions, { conclusionPremiseId: "p1" })
            ).not.toThrow()
        })

        it("rollback to snapshot with operator-under-operator succeeds", () => {
            const arg = { id: "arg-1", version: 1 }
            const engine = new ArgumentEngine(arg, aLib(), sLib(), csLib())
            engine.addVariable({
                id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1,
                claimId: "claim-default", claimVersion: 0,
            })
            const { result: pm } = engine.createPremise()

            const snapshot = engine.snapshot()
            const premSnap = snapshot.premises[0]
            premSnap.expressions.expressions = [
                { id: "op-and", type: "operator", operator: "and", parentId: null, position: 0, argumentId: "arg-1", argumentVersion: 1, premiseId: pm.getId(), checksum: "" },
                { id: "op-or", type: "operator", operator: "or", parentId: "op-and", position: 0, argumentId: "arg-1", argumentVersion: 1, premiseId: pm.getId(), checksum: "" },
            ] as TCorePropositionalExpression[]
            premSnap.rootExpressionId = "op-and"

            expect(() => engine.rollback(snapshot)).not.toThrow()
        })
    })
```

- [ ] **Step 2: Run tests to check which fail**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config > restoration"`

Expected: Some tests fail (fromSnapshot doesn't accept grammarConfig parameter yet, fromData doesn't default to permissive, rollback doesn't use permissive during loading).

- [ ] **Step 3: Update `ExpressionManager.fromSnapshot`**

Add `grammarConfig` parameter. Since `grammarConfig` is read via a getter from `this.config`, the config swap is just updating `this.config`:

```typescript
    public static fromSnapshot<
        TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    >(
        snapshot: TExpressionManagerSnapshot<TExpr>,
        grammarConfig?: TGrammarConfig
    ): ExpressionManager<TExpr> {
        // During loading, use the explicit grammarConfig (if provided) or the snapshot's config
        const loadingConfig: TLogicEngineOptions = {
            ...snapshot.config,
            grammarConfig: grammarConfig ?? snapshot.config?.grammarConfig,
        }
        const em = new ExpressionManager<TExpr>(loadingConfig)
        em.loadInitialExpressions(
            snapshot.expressions as unknown as TExpressionInput<TExpr>[]
        )
        // After loading, restore the snapshot's config for ongoing mutations
        // (grammarConfig getter reads from this.config, so this is the only swap needed)
        em.config = snapshot.config
        return em
    }
```

- [ ] **Step 4: Fix `PremiseEngine.snapshot()` to include `grammarConfig`**

In `src/lib/core/premise-engine.ts`, update `snapshot()` (line 1374-1377) to spread `exprSnapshot.config` instead of cherry-picking fields. This ensures future config additions (like `grammarConfig`) are automatically included:

```typescript
        return {
            premise: { ...this.premise },
            rootExpressionId: this.rootExpressionId,
            expressions: exprSnapshot,
            config: {
                ...exprSnapshot.config,
                checksumConfig: this.checksumConfig,
            },
        }
```

`checksumConfig` comes from `PremiseEngine`'s own field (which may differ from `exprSnapshot.config.checksumConfig`), so it overrides the spread. `positionConfig` and `grammarConfig` come from the expression manager's config via the spread.

- [ ] **Step 4b: Update `ArgumentEngine.snapshot()` to include `grammarConfig`**

In `src/lib/core/argument-engine.ts`, update `snapshot()` (around line 945-948). The `ArgumentEngine` stores `checksumConfig` and `positionConfig` as separate fields but does NOT store `grammarConfig` separately (it lives on the `ExpressionManager`). To include it in the snapshot, read it from the first premise's expression manager config, or store the original `TLogicEngineOptions` on the engine. The simplest approach: store the full `TLogicEngineOptions` as a private field and spread it in `snapshot()`:

```typescript
            config: {
                checksumConfig: this.checksumConfig,
                positionConfig: this.positionConfig,
                grammarConfig: this.grammarConfig,
            },
```

This requires `ArgumentEngine` to store `grammarConfig` in the constructor. Add a private field:
```typescript
private grammarConfig?: TGrammarConfig
```
And in the constructor, set it from the options:
```typescript
this.grammarConfig = config?.grammarConfig
```

- [ ] **Step 5: Update `PremiseEngine.fromSnapshot`**

Add `grammarConfig` parameter, pass through:

```typescript
    public static fromSnapshot<...>(
        snapshot: TPremiseEngineSnapshot<TPremise, TExpr>,
        argument: TOptionalChecksum<TArg>,
        variables: VariableManager<TVar>,
        expressionIndex?: Map<string, string>,
        grammarConfig?: TGrammarConfig
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> {
        // ...
        pe.expressions = ExpressionManager.fromSnapshot<TExpr>(
            snapshot.expressions,
            grammarConfig
        )
        // ...
    }
```

Add import for `TGrammarConfig` at top.

- [ ] **Step 6: Update `ArgumentEngine.fromSnapshot`**

Add `grammarConfig` parameter, pass through to each `PremiseEngine.fromSnapshot`:

```typescript
    public static fromSnapshot<...>(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        claimSourceLibrary: TClaimSourceLookup<TAssoc>,
        grammarConfig?: TGrammarConfig
    ): ArgumentEngine<...> {
        // ...
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
                premiseSnap,
                snapshot.argument,
                engine.variables,
                engine.expressionIndex,
                grammarConfig
            )
            // ...
        }
        // ...
    }
```

- [ ] **Step 7: Update `ArgumentEngine.fromData`**

Add `grammarConfig` parameter with permissive default:

```typescript
    public static fromData<...>(
        argument: TOptionalChecksum<TArg>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        claimSourceLibrary: TClaimSourceLookup<TAssoc>,
        variables: TOptionalChecksum<TVar>[],
        premises: TOptionalChecksum<TPremise>[],
        expressions: TExpressionInput<TExpr>[],
        roles: TCoreArgumentRoleState,
        config?: TLogicEngineOptions,
        grammarConfig?: TGrammarConfig
    ): ArgumentEngine<...> {
```

The approach mirrors `fromSnapshot`: construct with loading config, then restore ongoing config.

`fromData` constructs an `ArgumentEngine` which creates `PremiseEngine` instances via `createPremiseWithId`. Each `PremiseEngine` creates an `ExpressionManager` that inherits the engine's config. So the engine's config during construction controls enforcement during `loadExpressions`.

```typescript
        const loadingGrammarConfig = grammarConfig ?? PERMISSIVE_GRAMMAR_CONFIG
        const loadingOptions: TLogicEngineOptions = {
            ...config,
            grammarConfig: loadingGrammarConfig,
        }
        const engine = new ArgumentEngine<...>(
            argument, claimLibrary, sourceLibrary, claimSourceLibrary, loadingOptions
        )
        // ... register variables, create premises, load expressions ...

        // After loading, restore the caller's intended config for ongoing mutations.
        // Each PremiseEngine's ExpressionManager reads grammarConfig from its config,
        // so we need to update it on each ExpressionManager.
        const ongoingConfig = config ?? {}
        for (const pe of premiseEngines.values()) {
            pe.setConfig(ongoingConfig)  // new method — sets config on PE and its ExpressionManager
        }
```

This requires a `setConfig` method on `PremiseEngine` (and transitively on `ExpressionManager`) to update `this.config` after construction. Alternatively, since `fromData` is a static factory and has private access, it can set `pe.config` directly if `config` is a non-private field. Check the actual field visibility and choose the simplest approach.

- [ ] **Step 8: Update `rollback`**

Pass permissive grammar config during `PremiseEngine.fromSnapshot` calls:

```typescript
    public rollback(snapshot: TArgumentEngineSnapshot<...>): void {
        this.argument = { ...snapshot.argument }
        this.checksumConfig = snapshot.config?.checksumConfig
        this.positionConfig = snapshot.config?.positionConfig
        // Restore grammar config from snapshot
        // (grammarConfig is stored on the ExpressionManager, restored via PremiseEngine.fromSnapshot)
        this.variables = VariableManager.fromSnapshot<TVar>(snapshot.variables)
        this.premises = new Map()
        this.expressionIndex = new Map()
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
                premiseSnap,
                this.argument,
                this.variables,
                this.expressionIndex,
                PERMISSIVE_GRAMMAR_CONFIG  // permissive during loading
            )
            this.premises.set(pe.getId(), pe)
        }
        // ... rest unchanged
```

Import `PERMISSIVE_GRAMMAR_CONFIG` at top.

- [ ] **Step 9: Run tests**

Run: `pnpm vitest run test/core.test.ts -t "grammar enforcement config > restoration"`

Expected: All 5 PASS.

- [ ] **Step 10: Update existing restoration bypass tests**

The existing tests in `describe("operator nesting restriction > restoration bypass")` used `ExpressionManager.fromSnapshot` without a grammar config (which previously bypassed via `skipNestingCheck`). Now the default config enforces. Update them to pass `PERMISSIVE_GRAMMAR_CONFIG`:

```typescript
ExpressionManager.fromSnapshot({ expressions: [...] }, PERMISSIVE_GRAMMAR_CONFIG)
```

Also update any tests in `describe("operator nesting restriction > removeExpression — promotion")` that use `ExpressionManager.fromSnapshot` for legacy trees.

- [ ] **Step 11: Run full suite**

Run: `pnpm run test`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/core/expression-manager.ts src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add grammarConfig parameter to fromSnapshot, fromData, and rollback"
```

---

### Task 6: Update CLAUDE.md, docs, and final cleanup

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/api-reference.md`
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`

- [ ] **Step 1: Update CLAUDE.md**

Update the "Operator nesting restriction" bullet in the Key design rules section to mention grammar config:

```markdown
- **Operator nesting restriction:** Non-`not` operator expressions (`and`, `or`, `implies`, `iff`) cannot be direct children of any operator expression. A `formula` node must sit between them. `not` is exempt as a child. Controlled by `grammarConfig.enforceFormulaBetweenOperators` (default: `true`). When `autoNormalize` is `true`, `addExpression` auto-inserts formula buffers. `fromSnapshot` and `fromData` accept a `grammarConfig` parameter for load-time enforcement control.
```

- [ ] **Step 2: Update API reference and interface JSDoc**

Update `docs/api-reference.md` to document:
- `TGrammarConfig`, `TGrammarOptions`, `DEFAULT_GRAMMAR_CONFIG`, `PERMISSIVE_GRAMMAR_CONFIG`
- The `grammarConfig` parameter on `fromSnapshot`, `fromData`
- Auto-normalize behavior

Update `src/lib/core/interfaces/premise-engine.interfaces.ts` for `loadExpressions` behavior change.

- [ ] **Step 3: Run full check**

Run: `pnpm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: update documentation for grammar enforcement config"
```
