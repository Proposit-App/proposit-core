# PremiseEngine Mutation De-duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All TypeScript edits must follow the `brain-style` skill and be verified with the LSP tool.

**Goal:** Remove the repeated `ChangeCollector` lifecycle + variable-indexing boilerplate from `PremiseEngine`'s mutation methods by extracting two private helpers — no behavior change, no new files, no class split.

**Architecture:** A `withExpressionMutation(body)` wrapper absorbs the identical `new ChangeCollector` → `setCollector` → `try`/`finally` → `finalizeExpressionMutation` skeleton that today appears verbatim in five mutation methods. A `indexVariableExpression(expr)` helper absorbs the identical 5-line "if variable, add to `expressionsByVariableId`" block copied across the same five. The existing `test/core.test.ts` suite (1925 passing) is the safety net — every step keeps it green.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, pnpm.

**Why only five methods:** Closer inspection (the reason this item was deferred) shows only `addExpression`, `appendExpression`, `addExpressionRelative`, `insertExpression`, `wrapExpression` share the _identical_ shape. `updateExpression` and `removeExpression` deliberately diverge (conditional finalize / early no-op return), and the bundled-composite methods (`reparentExpression`, `wrapInFormula`, `toggleNegation`, `changeOperator`) have bespoke shapes. Those are **out of scope** — see "Scope decisions" at the bottom.

---

## File structure

Single file touched: `src/lib/core/premise-engine.ts`. Two new private methods added; five existing public method bodies shortened. No exports change, no public surface changes, so `[Public-Engine-API]` JSDoc and interface files are untouched.

---

## Baseline (already confirmed)

`pnpm run test` → **1925 passed, 15 skipped, 54 files**. This is the green baseline every task below must preserve. If a task ever drops a test, revert that task's edit and stop.

---

### Task 1: Extract the `withExpressionMutation` wrapper and migrate `addExpression`

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (add helper after `withValidation`, ends line 261; rewrite `addExpression`, lines 319–382)

- [ ] **Step 1: Add the `withExpressionMutation` helper immediately after `withValidation` (after line 261)**

```typescript
    /**
     * Wraps a single expression mutation: opens a ChangeCollector, binds it
     * to the ExpressionManager for the duration of `body`, then finalizes
     * (checksum flush + index sync + onMutate) and returns the standard
     * `{ result, changes }` shape. The whole thing runs inside
     * `withValidation`, so Structural violations roll back and throw while
     * higher-tier issues surface via `validate(tier)`.
     */
    private withExpressionMutation<TResult>(
        body: () => TResult
    ): TCoreMutationResult<TResult, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                const result = body()
                const changes = this.finalizeExpressionMutation(collector)
                return { result, changes }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }
```

- [ ] **Step 2: Verify the helper types with the LSP**

Use the LSP tool on `withExpressionMutation` — confirm `TCoreMutationResult<TResult, TExpr, TVar, TPremise, TArg>` resolves (first type param is the result type; remaining four are the changeset entity types, as in the existing `TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>` signatures).

- [ ] **Step 3: Rewrite `addExpression` (lines 319–382) to use the wrapper** (keep the inline variable-index block for now — Task 2 replaces it)

```typescript
    public addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            if (expression.parentId === null) {
                if (this.rootExpressionId !== undefined) {
                    throw new Error(
                        `Premise "${this.premise.id}" already has a root expression.`
                    )
                }
                // S-14: derivation premise root must be one of variable,
                // implies, or iff. Enforced at mutation time regardless
                // of engine `behavior` — Structural rules throw in both
                // modes (spec §4).
                if (
                    (this.premise as TCorePremise).type === "derivation" &&
                    expression.type === "operator" &&
                    expression.operator !== "implies" &&
                    expression.operator !== "iff"
                ) {
                    throw new Error(
                        `S-14: derivation premise "${this.premise.id}" root must be variable, implies, or iff (got operator "${expression.operator}").`
                    )
                }
            } else {
                if (!this.expressions.getExpression(expression.parentId)) {
                    throw new Error(
                        `Parent expression "${expression.parentId}" does not exist in this premise.`
                    )
                }
            }

            this.expressions.addExpression(expression)
            if (expression.parentId === null) {
                this.rootExpressionId = expression.id
            }
            if (expression.type === "variable") {
                this.expressionsByVariableId
                    .get(expression.variableId)
                    .add(expression.id)
            }
            return this.expressions.getExpression(expression.id)!
        })
    }
```

- [ ] **Step 4: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: typecheck clean; **1925 passed, 15 skipped**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "refactor(premise-engine): extract withExpressionMutation wrapper"
```

---

### Task 2: Extract `indexVariableExpression` and apply it to `addExpression`

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (add helper near `rebuildVariableIndex`, ~line 2276; edit `addExpression`)

- [ ] **Step 1: Add the `indexVariableExpression` helper just above `rebuildVariableIndex` (~line 2276)**

```typescript
    /**
     * Records a newly-added variable expression in the by-variable index.
     * No-op for non-variable expressions. Mirrors the per-variable entry
     * that `rebuildVariableIndex` produces on bulk load.
     */
    private indexVariableExpression(
        expression: TExpressionInput<TExpr> | TExpressionWithoutPosition<TExpr>
    ): void {
        if (expression.type === "variable") {
            this.expressionsByVariableId
                .get(expression.variableId)
                .add(expression.id)
        }
    }
```

- [ ] **Step 2: Verify narrowing with the LSP**

Confirm that inside the `if (expression.type === "variable")` block, `expression.variableId` and `expression.id` resolve without error (discriminated-union narrowing on the `type` tag). If the union does **not** narrow `variableId`, change the parameter type to the variable variant of `TExpr` directly and re-verify — do not cast.

- [ ] **Step 3: Replace the inline index block in `addExpression` with the helper**

In `addExpression`, replace:

```typescript
if (expression.type === "variable") {
    this.expressionsByVariableId.get(expression.variableId).add(expression.id)
}
```

with:

```typescript
this.indexVariableExpression(expression)
```

- [ ] **Step 4: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: typecheck clean; **1925 passed, 15 skipped**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "refactor(premise-engine): extract indexVariableExpression helper"
```

---

### Task 3: Migrate `appendExpression` and `addExpressionRelative`

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (`appendExpression` lines 384–429; `addExpressionRelative` lines 431–473)

- [ ] **Step 1: Rewrite `appendExpression`**

```typescript
    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            if (parentId === null) {
                if (this.rootExpressionId !== undefined) {
                    throw new Error(
                        `Premise "${this.premise.id}" already has a root expression.`
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
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }
```

(Note: `appendExpression` does **not** explicitly set `rootExpressionId` — it relies on `finalizeExpressionMutation`'s `syncRootExpressionId()`. Preserve that; do not add a root assignment.)

- [ ] **Step 2: Rewrite `addExpressionRelative`**

```typescript
    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

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
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }
```

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: typecheck clean; **1925 passed, 15 skipped**.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "refactor(premise-engine): migrate append/addRelative to mutation wrapper"
```

---

### Task 4: Migrate `insertExpression` and `wrapExpression`

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (`insertExpression` lines 594–630; `wrapExpression` lines 632–674)

- [ ] **Step 1: Rewrite `insertExpression`**

```typescript
    public insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            this.expressions.insertExpression(
                expression,
                leftNodeId,
                rightNodeId
            )
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }
```

- [ ] **Step 2: Rewrite `wrapExpression`** (indexes `newSibling`, returns `operator` — preserve both)

```typescript
    public wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                operator.argumentId,
                operator.argumentVersion
            )
            this.assertBelongsToArgument(
                newSibling.argumentId,
                newSibling.argumentVersion
            )
            this.assertVariableExpressionValid(newSibling)

            this.expressions.wrapExpression(
                operator,
                newSibling,
                leftNodeId,
                rightNodeId
            )
            this.indexVariableExpression(newSibling)
            return this.expressions.getExpression(operator.id)!
        })
    }
```

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: typecheck clean; **1925 passed, 15 skipped**.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "refactor(premise-engine): migrate insert/wrap to mutation wrapper"
```

---

### Task 5: Full check + changelog

**Files:**

- Modify: `docs/changelogs/upcoming.md` ([Any-Code-Change] per Documentation Sync)

- [ ] **Step 1: Run the full check**

Run: `pnpm run check`
Expected: typecheck + lint + tests + build all pass. (If lint flags formatting, run `pnpm run prettify` and re-run.)

- [ ] **Step 2: Add a changelog entry to `docs/changelogs/upcoming.md`**

Append under the appropriate heading (use the commit hash range from `git log` for this branch):

```markdown
- refactor(premise-engine): de-duplicate expression-mutation boilerplate via `withExpressionMutation` + `indexVariableExpression` private helpers across add/append/addRelative/insert/wrap. No behavior or public-API change.
```

- [ ] **Step 3: Commit**

```bash
git add docs/changelogs/upcoming.md
git commit -m "docs(changelog): record premise-engine mutation dedup"
```

---

## Scope decisions (closer inspection results)

This item bundled several proposed seams across `argument-engine.ts` and `premise-engine.ts`. Inspection (the prerequisite the deferral asked for) trimmed them:

**Committed (this plan):**

- PremiseEngine mutation boilerplate → `withExpressionMutation` + `indexVariableExpression`. Genuine duplication (identical skeleton ×5, identical index block ×5). Low risk — the existing suite exercises all five methods heavily.

**Deferred / optional (safe but lower value — relocation, not de-duplication):**

- ArgumentEngine checksum orchestration (`flushChecksums`, `markDirty`, `markAllPremisesDirty`, the cached-checksum fields, lines ~2362–2492) → a `checksum-orchestration.ts`. Self-contained and read-mostly, but `markDirty()` is called from dozens of mutation sites, so extraction is wide mechanical churn for a line-count win — and it touches the documented "bottom-up, depth-sorted dirty propagation must not change behavior" invariant. Pick up only if file size becomes a real obstacle.
- ArgumentEngine reactive-snapshot cache and claim-library adapter (lines ~386–537 and ~1495–1701) → own modules. Same trade-off: clean but cosmetic.
- PremiseEngine checksum methods → a module/mixin. Cohesive but coupled to `ExpressionManager` and the mutation finalize path; mixins add indirection. Marginal.

**Rejected (do not do):**

- ArgumentEngine "`change*` / `PremiseChangeBatcher`": no such methods exist — callers mutate via `getPremise()` directly. The proposal was based on a wrong assumption.
- ArgumentEngine "collapse VariableManager references": the wiring is already thin delegation to `variable-manager.ts`; nothing to collapse.
- ArgumentEngine `withValidation` extraction: it is a snapshot/rollback transaction wrapper bound to engine-wide state; extracting it is high-risk with no payoff.
- PremiseEngine expression query "veneers → QueryProxy": these are one-line getters; a proxy class adds a type and indirection without removing complexity.

**Explicitly excluded from the wrapper migration (behavior would change):**

- `updateExpression` — does not call `finalizeExpressionMutation`; has conditional `markDirty`/`onMutate` gated on `changeset.expressions !== undefined`.
- `removeExpression` — early no-op return that skips finalize; cascade index cleanup over a collected subtree.
- `reparentExpression`, `wrapInFormula`, `toggleNegation`, `changeOperator` — bundled-composite mutations with bespoke shapes.

---

## Self-review

- **Spec coverage:** The deferral asked to de-compose PremiseEngine "one method-family at a time, behind the existing test suite." Tasks 1–4 do exactly that for the one method-family with real duplication; Task 5 verifies + records. ArgumentEngine seams are triaged above with rationale.
- **Placeholder scan:** No TBDs. Every migrated method's full new body is shown. The two helpers are shown in full.
- **Type consistency:** Helper names `withExpressionMutation` / `indexVariableExpression` are used identically wherever referenced. `TCoreMutationResult<TResult, …>` first-param-is-result matches existing signatures.
- **Behavior-preservation checks:** `appendExpression` intentionally has no explicit root assignment (relies on `syncRootExpressionId`); `wrapExpression` returns `operator.id` and indexes `newSibling`; `addExpression` keeps its explicit root assignment and S-14 comment. All preserved verbatim.
