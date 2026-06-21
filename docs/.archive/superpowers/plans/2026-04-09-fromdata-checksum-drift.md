# fromData Checksum Drift Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix checksum drift in `ArgumentEngine.fromData` by extracting a `registerExpression` method that bypasses grammar validation/normalization during expression loading.

**Architecture:** Extract the core registration logic (position tracking, checksum attachment, map storage, dirty marking) from `addExpression` into a private `registerExpression` method. `loadInitialExpressions` calls `registerExpression` directly (simple loop, no BFS). `addExpression` delegates to `registerExpression` after validation. Post-load grammar enforcement is preserved via existing `validate()` and `normalizeExpressions()` calls.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-09-fromdata-checksum-drift-design.md`

---

### Task 1: Write failing reproduction test

**Files:**

- Modify: `test/core.test.ts` (append new `describe` block at end of file)

This test proves the bug exists before any code changes.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("fromData checksum idempotency (registerExpression)", () => {
    const GRANULAR_GRAMMAR_CONFIG = {
        enforceFormulaBetweenOperators: true,
        autoNormalize: {
            wrapInsertFormula: true,
            negationInsertFormula: true,
            collapseDoubleNegation: true,
            collapseEmptyFormula: false,
        },
    }

    it("successive fromData calls produce identical checksums", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            makeVar("v1", "P"),
            makeVar("v2", "Q"),
            makeVar("v3", "R"),
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
        ]
        // IMPLIES(formula(AND(P, Q)), R) — well-formed with formula buffer
        const expressions = [
            {
                id: "e-implies",
                type: "operator" as const,
                operator: "implies" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
            {
                id: "e-formula",
                type: "formula" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-implies",
                position: 0,
            },
            {
                id: "e-and",
                type: "operator" as const,
                operator: "and" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-formula",
                position: 0,
            },
            {
                id: "e-vp",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-and",
                position: 0,
            },
            {
                id: "e-vq",
                type: "variable" as const,
                variableId: "v2",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-and",
                position: 1073741823,
            },
            {
                id: "e-vr",
                type: "variable" as const,
                variableId: "v3",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-implies",
                position: 500000,
            },
        ]
        const roles = { conclusionPremiseId: "p1" }
        const config = { grammarConfig: GRANULAR_GRAMMAR_CONFIG }

        const engine1 = ArgumentEngine.fromData(
            arg,
            aLib(),
            sLib(),
            csLib(),
            variables,
            premises,
            expressions,
            roles,
            config,
            GRANULAR_GRAMMAR_CONFIG,
            "ignore"
        )
        const engine2 = ArgumentEngine.fromData(
            arg,
            aLib(),
            sLib(),
            csLib(),
            variables,
            premises,
            expressions,
            roles,
            config,
            GRANULAR_GRAMMAR_CONFIG,
            "ignore"
        )

        engine1.flushChecksums()
        engine2.flushChecksums()

        const snap1 = engine1.snapshot()
        const snap2 = engine2.snapshot()

        // Compare all expression checksums
        const exprs1 = snap1.premises[0].expressions.expressions
        const exprs2 = snap2.premises[0].expressions.expressions
        for (const e1 of exprs1) {
            const e2 = exprs2.find((e) => e.id === e1.id)!
            expect(e2).toBeDefined()
            expect(e2.checksum).toBe(e1.checksum)
            expect(e2.descendantChecksum).toBe(e1.descendantChecksum)
            expect(e2.combinedChecksum).toBe(e1.combinedChecksum)
        }

        // Compare argument-level checksums
        expect(snap2.argument.combinedChecksum).toBe(
            snap1.argument.combinedChecksum
        )
    })

    it("fromData produces identical checksums regardless of expression array order", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            makeVar("v1", "P"),
            makeVar("v2", "Q"),
            makeVar("v3", "R"),
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
        ]
        const expressions = [
            {
                id: "e-implies",
                type: "operator" as const,
                operator: "implies" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
            {
                id: "e-formula",
                type: "formula" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-implies",
                position: 0,
            },
            {
                id: "e-and",
                type: "operator" as const,
                operator: "and" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-formula",
                position: 0,
            },
            {
                id: "e-vp",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-and",
                position: 0,
            },
            {
                id: "e-vq",
                type: "variable" as const,
                variableId: "v2",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-and",
                position: 1073741823,
            },
            {
                id: "e-vr",
                type: "variable" as const,
                variableId: "v3",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e-implies",
                position: 500000,
            },
        ]
        const roles = { conclusionPremiseId: "p1" }
        const config = { grammarConfig: GRANULAR_GRAMMAR_CONFIG }

        // Topological order (root first)
        const topological = [...expressions]
        // Reverse order (leaves first)
        const reversed = [...expressions].reverse()
        // Shuffled order
        const shuffled = [
            expressions[3], // e-vp
            expressions[0], // e-implies
            expressions[5], // e-vr
            expressions[2], // e-and
            expressions[1], // e-formula
            expressions[4], // e-vq
        ]

        const engines = [topological, reversed, shuffled].map((exprs) =>
            ArgumentEngine.fromData(
                arg,
                aLib(),
                sLib(),
                csLib(),
                variables,
                premises,
                exprs,
                roles,
                config,
                GRANULAR_GRAMMAR_CONFIG,
                "ignore"
            )
        )

        // All should produce the same argument-level combined checksum
        const checksums = engines.map((e) => {
            e.flushChecksums()
            return e.snapshot().argument.combinedChecksum
        })
        expect(checksums[1]).toBe(checksums[0])
        expect(checksums[2]).toBe(checksums[0])
    })
})
```

- [ ] **Step 2: Run the tests to verify the reproduction test behavior**

Run:

```bash
pnpm run test -- --reporter verbose 2>&1 | grep -E "(fromData checksum idempotency|successive|regardless|PASS|FAIL)"
```

The first test (`successive fromData calls`) may pass or fail depending on whether the drift manifests with the default `generateId`. The second test (`regardless of expression array order`) should fail because the current BFS in `loadInitialExpressions` depends on parent existence ordering — reversed/shuffled arrays will throw "Could not resolve parent relationships" because the BFS can't add children before parents when they're in the wrong order and `addExpression` requires parent existence.

If BOTH pass, that's fine — the tests still serve as regression guards for the refactoring.

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add fromData checksum idempotency reproduction tests"
```

---

### Task 2: Extract `registerExpression` and refactor `addExpression`

**Files:**

- Modify: `src/lib/core/expression-manager.ts`

- [ ] **Step 1: Add the private `registerExpression` method**

Add this method to `ExpressionManager` immediately after the `attachChecksum` method (after line 142 in `expression-manager.ts`). This is the raw registration logic extracted from the end of `addExpression` (current lines 427-451):

```typescript
    /**
     * Registers an expression in the internal data structures without any
     * grammar validation or normalization. This is the mechanical
     * bookkeeping that both `addExpression` (after validation) and
     * `loadInitialExpressions` (direct bulk load) share.
     */
    private registerExpression(expression: TExpressionInput<TExpr>): void {
        getOrCreate(
            this.childPositionsByParentId,
            expression.parentId,
            () => new Set()
        ).add(expression.position)

        const withChecksum = this.attachChecksum(expression)
        this.expressions.set(expression.id, withChecksum)
        this.collector?.addedExpression({
            ...withChecksum,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            expression.parentId,
            () => new Set()
        ).add(expression.id)

        this.markExpressionDirty(expression.id)
    }
```

- [ ] **Step 2: Refactor `addExpression` to delegate to `registerExpression`**

Replace the tail end of `addExpression` (from the position occupancy check through `markExpressionDirty`). The current code at lines 427-451 is:

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

const withChecksum = this.attachChecksum(expression)
this.expressions.set(expression.id, withChecksum)
this.collector?.addedExpression({
    ...withChecksum,
} as unknown as TCorePropositionalExpression)
getOrCreate(
    this.childExpressionIdsByParentId,
    expression.parentId,
    () => new Set()
).add(expression.id)

// Mark the new expression and its ancestors dirty for hierarchical checksum recomputation.
this.markExpressionDirty(expression.id)
```

Replace with:

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

this.registerExpression(expression)
```

Note: the position collision check stays in `addExpression` (it's a mutation-time validation). The `occupiedPositions.add(expression.position)` call that was here is now inside `registerExpression`, so remove just the `occupiedPositions.add` line and the code after it — the `getOrCreate` + `has` check remains, and `registerExpression` handles the actual `add`.

However, since `registerExpression` calls `getOrCreate` on the same key and adds the position, and `addExpression` already called `getOrCreate` to get the set for the `has` check, the position is registered once by `registerExpression`. This is correct — we just need to make sure the duplicate check reads the set BEFORE `registerExpression` adds to it. Since the `if (occupiedPositions.has(...))` check runs before `this.registerExpression(expression)`, this ordering is safe.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run:

```bash
pnpm run test
```

Expected: all existing tests pass. The `addExpression` refactoring is pure extraction — external behavior is identical.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/expression-manager.ts
git commit -m "refactor(expression-manager): extract registerExpression from addExpression"
```

---

### Task 3: Simplify `loadInitialExpressions`

**Files:**

- Modify: `src/lib/core/expression-manager.ts`

- [ ] **Step 1: Replace the BFS loop with a simple iteration**

Replace the current `loadInitialExpressions` method (lines 1164-1199) which is:

```typescript
    private loadInitialExpressions(
        initialExpressions: TExpressionInput<TExpr>[]
    ) {
        if (initialExpressions.length === 0) {
            return
        }

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
    }
```

Replace with:

```typescript
    private loadInitialExpressions(
        initialExpressions: TExpressionInput<TExpr>[]
    ) {
        for (const expression of initialExpressions) {
            this.registerExpression(expression)
        }
    }
```

No BFS loop, no parent existence requirement, no ordering constraints. Data integrity (parent existence, position uniqueness, grammar rules) is verified by the `validate()` call at the end of `fromData`/`fromSnapshot`.

- [ ] **Step 2: Run all tests**

Run:

```bash
pnpm run test
```

Expected: all tests pass, including the reproduction tests from Task 1. The order-independence test should now pass because `registerExpression` doesn't require parent existence.

- [ ] **Step 3: Run typecheck and lint**

Run:

```bash
pnpm run typecheck && pnpm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/expression-manager.ts
git commit -m "fix(expression-manager): bypass grammar normalization during expression loading

loadInitialExpressions now calls registerExpression directly instead of
addExpression, removing the BFS ordering requirement and all grammar
validation/normalization during restoration. Fixes checksum drift in
fromData when wrapInsertFormula is enabled."
```

---

### Task 4: Grammar enforcement preservation tests

**Files:**

- Modify: `test/core.test.ts` (append to the `describe` block from Task 1)

These tests verify that the grammar config is still enforced after loading — `registerExpression` only affects the loading step, not post-load validation or subsequent mutations.

- [ ] **Step 1: Write grammar enforcement tests**

Add these tests inside the `describe("fromData checksum idempotency (registerExpression)")` block:

```typescript
it("fromData rejects operator-under-operator when enforceFormulaBetweenOperators is true", () => {
    const arg = { id: "arg-1", version: 1 }
    const variables = [makeVar("v1", "P"), makeVar("v2", "Q")]
    const premises: TOptionalChecksum<TCorePremise>[] = [
        { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
    ]
    // AND(OR(P, Q)) — no formula buffer between AND and OR
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
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
            parentId: "e-or",
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
            roles,
            { grammarConfig: GRANULAR_GRAMMAR_CONFIG },
            GRANULAR_GRAMMAR_CONFIG,
            "ignore"
        )
    ).toThrow("invariant violation")
})

it("fromSnapshot rejects operator-under-operator when grammarConfig enforces it", () => {
    // Build a valid engine, take a snapshot, then tamper with it
    const claimLibrary = aLib()
    const engine = new ArgumentEngine(
        { id: "arg-1", version: 1 },
        claimLibrary,
        sLib(),
        csLib(),
        { grammarConfig: PERMISSIVE_GRAMMAR_CONFIG }
    )
    engine.addVariable(makeVar("v1", "P"))
    engine.addVariable(makeVar("v2", "Q"))
    const { result: pm } = engine.createPremise()
    const pid = pm.getId()
    pm.addExpression(makeOpExpr("e-and", "and", { premiseId: pid }))
    pm.addExpression(
        makeOpExpr("e-or", "or", {
            premiseId: pid,
            parentId: "e-and",
            position: 0,
        })
    )
    pm.addExpression(
        makeVarExpr("e-v1", "v1", {
            premiseId: pid,
            parentId: "e-or",
            position: 0,
        })
    )
    pm.addExpression(
        makeVarExpr("e-v2", "v2", {
            premiseId: pid,
            parentId: "e-or",
            position: 1,
        })
    )

    const snapshot = engine.snapshot()

    // Restoring with enforceFormulaBetweenOperators should reject it
    expect(() =>
        ArgumentEngine.fromSnapshot(
            snapshot,
            claimLibrary,
            sLib(),
            csLib(),
            GRANULAR_GRAMMAR_CONFIG,
            "ignore"
        )
    ).toThrow("invariant violation")
})

it("fromData with autoNormalize: true (boolean) still runs post-load normalization", () => {
    const arg = { id: "arg-1", version: 1 }
    const variables = [makeVar("v1", "P"), makeVar("v2", "Q")]
    const premises: TOptionalChecksum<TCorePremise>[] = [
        { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
    ]
    // AND(formula(P), Q) — formula wrapping only a variable is unjustified
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
            id: "e-formula",
            type: "formula" as const,
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
            parentId: "e-formula",
            position: 0,
        },
        {
            id: "e-v2",
            type: "variable" as const,
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
            parentId: "e-and",
            position: 1,
        },
    ]
    const roles = { conclusionPremiseId: "p1" }

    // autoNormalize: true (boolean) triggers post-load normalization
    const engine = ArgumentEngine.fromData(
        arg,
        aLib(),
        sLib(),
        csLib(),
        variables,
        premises,
        expressions,
        roles,
        undefined // uses DEFAULT_GRAMMAR_CONFIG (autoNormalize: true)
    )

    const pe = engine.findPremiseByExpressionId("e-v1")!
    // The unjustified formula should have been collapsed
    expect(pe.getExpression("e-formula")).toBeUndefined()
    expect(pe.getExpression("e-v1")!.parentId).toBe("e-and")
})

it("mutations after fromData loading still respect grammar config", () => {
    const arg = { id: "arg-1", version: 1 }
    const variables = [makeVar("v1", "P")]
    const premises: TOptionalChecksum<TCorePremise>[] = [
        { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
    ]
    // Simple tree: AND(P)
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
            id: "e-vp",
            type: "variable" as const,
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
            parentId: "e-and",
            position: 0,
        },
    ]
    const roles = { conclusionPremiseId: "p1" }

    const engine = ArgumentEngine.fromData(
        arg,
        aLib(),
        sLib(),
        csLib(),
        variables,
        premises,
        expressions,
        roles,
        { grammarConfig: GRANULAR_GRAMMAR_CONFIG },
        GRANULAR_GRAMMAR_CONFIG,
        "ignore"
    )

    // Adding a non-NOT operator as child of AND should auto-insert a formula buffer
    const pe = engine.findPremiseByExpressionId("e-and")!
    pe.addExpression(
        makeOpExpr("e-or", "or", {
            premiseId: "p1",
            parentId: "e-and",
            position: 500,
        })
    )

    // The OR should have been wrapped in a formula
    const orExpr = pe.getExpression("e-or")!
    expect(orExpr.parentId).not.toBe("e-and")
    const formulaParent = pe.getExpression(orExpr.parentId!)!
    expect(formulaParent.type).toBe("formula")
    expect(formulaParent.parentId).toBe("e-and")
})
```

- [ ] **Step 2: Run the new tests**

Run:

```bash
pnpm run test -- --reporter verbose 2>&1 | grep -E "(fromData checksum idempotency|rejects|normalization|mutations after|PASS|FAIL)"
```

Expected: all tests pass.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm run test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts
git commit -m "test: verify grammar enforcement is preserved after registerExpression refactor"
```

---

### Task 5: Full check, cleanup, and docs

**Files:**

- Modify: `docs/changelogs/upcoming.md`
- Modify: `docs/release-notes/upcoming.md`
- Delete: `docs/change-requests/2026-04-09-fromdata-wrapinsertformula-checksum-drift.md`

- [ ] **Step 1: Run full check suite**

Run:

```bash
pnpm run check
```

Expected: typecheck, lint, prettier, tests, and build all pass.

- [ ] **Step 2: Delete the change request file**

```bash
rm docs/change-requests/2026-04-09-fromdata-wrapinsertformula-checksum-drift.md
```

- [ ] **Step 3: Update changelogs**

Add to `docs/changelogs/upcoming.md`:

```markdown
### Bug Fixes

- **expression-manager:** Extract `registerExpression` to bypass grammar normalization during expression loading in `fromData`/`fromSnapshot`. `loadInitialExpressions` now calls `registerExpression` directly instead of `addExpression`, eliminating BFS ordering dependency and preventing checksum drift when `wrapInsertFormula` is enabled.
```

Add to `docs/release-notes/upcoming.md`:

```markdown
### Bug Fixes

- Fixed an issue where rebuilding an engine from stored data could produce different checksums on each rebuild when using granular auto-normalize configuration. This affected applications using checksum-based optimistic concurrency control.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: changelog and release notes for fromData checksum drift fix"
```

- [ ] **Step 5: Offer version bump**

Ask the user if they want to cut a patch version (`pnpm version patch`).
