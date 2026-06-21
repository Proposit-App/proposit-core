# Operator Constraint Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `rejectedExpressionIds` with three-state `operatorAssignments`, add fixed-point constraint propagation so accepted operators derive unknown variable values, update CLI commands, and auto-increment analysis filenames.

**Architecture:** The `TCoreExpressionAssignment` type changes from `rejectedExpressionIds: string[]` to `operatorAssignments: Record<string, "accepted" | "rejected">`. A new `propagateOperatorConstraints()` function runs fixed-point constraint pushing inside `ArgumentEngine.evaluate()` before Kleene evaluation. CLI commands `reject`/`accept`/`reject-all`/`accept-all` are replaced by `set-operator` and `set-all-operators`.

**Tech Stack:** TypeScript, Vitest, Commander.js

**Spec:** `docs/superpowers/specs/2026-03-30-operator-constraint-propagation-design.md`

---

### Task 1: Update `TCoreExpressionAssignment` type and `CoreAnalysisFileSchema`

**Files:**

- Modify: `src/lib/types/evaluation.ts`
- Modify: `src/lib/schemata/analysis.ts`

- [ ] **Step 1: Update the type definition**

In `src/lib/types/evaluation.ts`, replace:

```typescript
/** Full expression assignment: variable truth values and rejected expression IDs. */
export interface TCoreExpressionAssignment {
    /** Variable ID → true/false/null (null = unset/not sure). */
    variables: TCoreVariableAssignment
    /** Expression IDs the user rejects (evaluate to false, children skipped). */
    rejectedExpressionIds: string[]
}
```

with:

```typescript
/** Operator acceptance state: accepted (true), rejected (false), or unset (normal evaluation). */
export type TCoreOperatorAssignment = "accepted" | "rejected"

/** Full expression assignment: variable truth values and operator acceptance states. */
export interface TCoreExpressionAssignment {
    /** Variable ID → true/false/null (null = unset/not sure). */
    variables: TCoreVariableAssignment
    /** Operator expression ID → accepted/rejected. Unset operators evaluate normally. */
    operatorAssignments: Record<string, TCoreOperatorAssignment>
}
```

- [ ] **Step 2: Update the schema**

In `src/lib/schemata/analysis.ts`, replace:

```typescript
    rejectedExpressionIds: Type.Array(Type.String(), {
        description: "Expression IDs rejected by the user.",
    }),
```

with:

```typescript
    operatorAssignments: Type.Record(
        Type.String(),
        Type.Union([Type.Literal("accepted"), Type.Literal("rejected")]),
        {
            description:
                "Operator expression ID → accepted/rejected. Unset operators evaluate normally.",
        }
    ),
```

- [ ] **Step 3: Export the new type**

In `src/lib/types/evaluation.ts`, the `TCoreOperatorAssignment` type is already exported inline. Verify `src/lib/index.ts` re-exports from `./types/evaluation.js` (it already does via `export * from "./types/evaluation.js"`).

- [ ] **Step 4: Run typecheck to see all compilation errors**

Run: `pnpm run typecheck 2>&1 | head -80`

Expected: Compilation errors in every file that references `rejectedExpressionIds`. This is expected — subsequent tasks fix them.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/evaluation.ts src/lib/schemata/analysis.ts
git commit -m "feat: replace rejectedExpressionIds with operatorAssignments type"
```

---

### Task 2: Update `PremiseEngine.evaluate()` to use `operatorAssignments`

**Files:**

- Modify: `src/lib/core/premise-engine.ts`

- [ ] **Step 1: Update the rejection check**

In `src/lib/core/premise-engine.ts`, in the `evaluate` method's inner `evaluateExpression` function, replace:

```typescript
if (assignment.rejectedExpressionIds.includes(expression.id)) {
    expressionValues[expression.id] = false
    return false
}
```

with:

```typescript
const operatorState = assignment.operatorAssignments[expression.id]
if (operatorState === "rejected") {
    expressionValues[expression.id] = false
    return false
}
```

- [ ] **Step 2: Update the inference diagnostic guard**

In the same file, replace:

```typescript
!assignment.rejectedExpressionIds.includes(rootExpressionId)
```

with:

```typescript
assignment.operatorAssignments[rootExpressionId] !== "rejected"
```

- [ ] **Step 3: Run typecheck on premise-engine**

Run: `pnpm run typecheck 2>&1 | grep premise-engine`

Expected: No errors from `premise-engine.ts` (other files still have errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "feat: update PremiseEngine.evaluate to use operatorAssignments"
```

---

### Task 3: Update `ArgumentEngine.evaluate()` and `checkValidity()`

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Update the assignment copy in `evaluate()` result**

In `src/lib/core/argument-engine.ts`, in the `evaluate` method's return block, replace:

```typescript
                assignment: {
                    variables: { ...assignment.variables },
                    rejectedExpressionIds: [
                        ...assignment.rejectedExpressionIds,
                    ],
                },
```

with:

```typescript
                assignment: {
                    variables: { ...assignment.variables },
                    operatorAssignments: { ...assignment.operatorAssignments },
                },
```

- [ ] **Step 2: Update `checkValidity()` assignment construction**

In the `checkValidity` method, replace:

```typescript
const assignment: TCoreExpressionAssignment = {
    variables: {},
    rejectedExpressionIds: [],
}
```

with:

```typescript
const assignment: TCoreExpressionAssignment = {
    variables: {},
    operatorAssignments: {},
}
```

- [ ] **Step 3: Run typecheck on argument-engine**

Run: `pnpm run typecheck 2>&1 | grep argument-engine`

Expected: No errors from `argument-engine.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "feat: update ArgumentEngine to use operatorAssignments"
```

---

### Task 4: Update all tests to use `operatorAssignments`

**Files:**

- Modify: `test/core.test.ts`
- Modify: `test/examples.test.ts`

- [ ] **Step 1: Bulk replace in `test/core.test.ts`**

Replace all 30 instances of `rejectedExpressionIds: []` with `operatorAssignments: {}` using replace-all.

Then handle the 4 instances with non-empty rejected IDs. Search for `rejectedExpressionIds: [` (with content) and update each:

1. `rejectedExpressionIds: ["and-root"]` → `operatorAssignments: { "and-root": "rejected" }`
2. `rejectedExpressionIds: ["f-root"]` → `operatorAssignments: { "f-root": "rejected" }`
3. `rejectedExpressionIds: ["and-child"]` → `operatorAssignments: { "and-child": "rejected" }`
4. `rejectedExpressionIds: ["imp"]` → `operatorAssignments: { "imp": "rejected" }`
5. `rejectedExpressionIds: ["c-imp"]` → `operatorAssignments: { "c-imp": "rejected" }`

- [ ] **Step 2: Update `test/examples.test.ts`**

Replace:

```typescript
return { variables, rejectedExpressionIds: [] }
```

with:

```typescript
return { variables, operatorAssignments: {} }
```

- [ ] **Step 3: Run tests**

Run: `pnpm run test`

Expected: All 1071 tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts test/examples.test.ts
git commit -m "test: update all tests to use operatorAssignments"
```

---

### Task 5: Write propagation tests

**Files:**

- Modify: `test/core.test.ts`

These tests exercise the propagation algorithm that will be implemented in Task 6. Each test builds a minimal argument with one or two premises, sets operator acceptance states, and verifies that the evaluation result reflects propagated variable values.

- [ ] **Step 1: Add a test helper to build simple arguments**

At the bottom of `test/core.test.ts`, add a new `describe("operator constraint propagation", ...)` block. The tests will build inline fixtures like existing tests do.

- [ ] **Step 2: Write test — implies accepted, antecedent true, consequent derived**

```typescript
describe("operator constraint propagation", () => {
    it("propagates consequent from accepted implies when antecedent is true", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            new ClaimLibrary(),
            new SourceLibrary(),
            new ClaimSourceLibrary()
        )
        const pm = eng.addPremise({
            id: "p1",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        const vA = eng.addVariable({
            id: "vA",
            argumentId: "arg1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        })
        const vB = eng.addVariable({
            id: "vB",
            argumentId: "arg1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "c2",
            claimVersion: 0,
        })
        const imp = pm.addExpression({
            id: "imp",
            premiseId: "p1",
            argumentVersion: 0,
            type: "operator",
            operator: "implies",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "eA",
            premiseId: "p1",
            argumentVersion: 0,
            type: "variable",
            variableId: "vA",
            parentId: "imp",
            position: 0,
        })
        pm.addExpression({
            id: "eB",
            premiseId: "p1",
            argumentVersion: 0,
            type: "variable",
            variableId: "vB",
            parentId: "imp",
            position: 1,
        })
        eng.setRoleState({ conclusionPremiseId: "p1" })

        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: { imp: "accepted" },
        })

        expect(result.ok).toBe(true)
        // Propagation should have set vB = true
        expect(result.assignment!.variables.vB).toBe(true)
        // The implies evaluates to true (true → true)
        expect(result.conclusionTrue).toBe(true)
    })
})
```

- [ ] **Step 3: Write test — implies accepted, consequent false, antecedent derived false**

```typescript
it("propagates antecedent false from accepted implies when consequent is false", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })
    const imp = pm.addExpression({
        id: "imp",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "implies",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "imp",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "imp",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    const result = eng.evaluate({
        variables: { vA: null, vB: false },
        operatorAssignments: { imp: "accepted" },
    })

    expect(result.ok).toBe(true)
    expect(result.assignment!.variables.vA).toBe(false)
})
```

- [ ] **Step 4: Write test — and accepted, both children derived true**

```typescript
it("propagates both children true from accepted and", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })
    const andOp = pm.addExpression({
        id: "and1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "and",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "and1",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "and1",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    const result = eng.evaluate({
        variables: { vA: null, vB: null },
        operatorAssignments: { and1: "accepted" },
    })

    expect(result.ok).toBe(true)
    expect(result.assignment!.variables.vA).toBe(true)
    expect(result.assignment!.variables.vB).toBe(true)
})
```

- [ ] **Step 5: Write test — or accepted, one child false, other derived true**

```typescript
it("propagates remaining child true from accepted or when one child is false", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })
    const orOp = pm.addExpression({
        id: "or1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "or",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "or1",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "or1",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    const result = eng.evaluate({
        variables: { vA: false, vB: null },
        operatorAssignments: { or1: "accepted" },
    })

    expect(result.ok).toBe(true)
    expect(result.assignment!.variables.vB).toBe(true)
})
```

- [ ] **Step 6: Write test — not accepted, child derived false**

```typescript
it("propagates child false from accepted not", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    const notOp = pm.addExpression({
        id: "not1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "not",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "not1",
        position: 0,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    const result = eng.evaluate({
        variables: { vA: null },
        operatorAssignments: { not1: "accepted" },
    })

    expect(result.ok).toBe(true)
    expect(result.assignment!.variables.vA).toBe(false)
})
```

- [ ] **Step 7: Write test — iff accepted, bidirectional propagation**

```typescript
it("propagates bidirectionally from accepted iff", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })
    const iffOp = pm.addExpression({
        id: "iff1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "iff",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "iff1",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "iff1",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    const result = eng.evaluate({
        variables: { vA: true, vB: null },
        operatorAssignments: { iff1: "accepted" },
    })

    expect(result.ok).toBe(true)
    expect(result.assignment!.variables.vB).toBe(true)
})
```

- [ ] **Step 8: Write test — cross-premise fixed-point propagation**

```typescript
it("propagates across premises to fixed point", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    // Premise 1: A → B (supporting)
    const pm1 = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    // Premise 2: B → C (conclusion)
    const pm2 = eng.addPremise({
        id: "p2",
        argumentId: "arg1",
        argumentVersion: 0,
    })

    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vC",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "C",
        claimId: "c3",
        claimVersion: 0,
    })

    const imp1 = pm1.addExpression({
        id: "imp1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "implies",
        parentId: null,
        position: 0,
    })
    pm1.addExpression({
        id: "e1A",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "imp1",
        position: 0,
    })
    pm1.addExpression({
        id: "e1B",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "imp1",
        position: 1,
    })

    const imp2 = pm2.addExpression({
        id: "imp2",
        premiseId: "p2",
        argumentVersion: 0,
        type: "operator",
        operator: "implies",
        parentId: null,
        position: 0,
    })
    pm2.addExpression({
        id: "e2B",
        premiseId: "p2",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "imp2",
        position: 0,
    })
    pm2.addExpression({
        id: "e2C",
        premiseId: "p2",
        argumentVersion: 0,
        type: "variable",
        variableId: "vC",
        parentId: "imp2",
        position: 1,
    })

    eng.setRoleState({ conclusionPremiseId: "p2" })

    // A = true, both implies accepted. Should derive B = true, then C = true.
    const result = eng.evaluate({
        variables: { vA: true, vB: null, vC: null },
        operatorAssignments: { imp1: "accepted", imp2: "accepted" },
    })

    expect(result.ok).toBe(true)
    expect(result.assignment!.variables.vB).toBe(true)
    expect(result.assignment!.variables.vC).toBe(true)
    expect(result.conclusionTrue).toBe(true)
})
```

- [ ] **Step 9: Write test — user assignment wins over propagation**

```typescript
it("does not override user-assigned variables during propagation", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })

    const andOp = pm.addExpression({
        id: "and1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "and",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "and1",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "and1",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    // AND accepted but user explicitly set A = false — contradiction
    const result = eng.evaluate({
        variables: { vA: false, vB: null },
        operatorAssignments: { and1: "accepted" },
    })

    expect(result.ok).toBe(true)
    // A stays false (user wins)
    expect(result.assignment!.variables.vA).toBe(false)
    // B gets propagated to true (AND accepted = both true)
    expect(result.assignment!.variables.vB).toBe(true)
    // But the AND evaluates to false (contradiction: false AND true)
    expect(result.conclusionTrue).toBe(false)
})
```

- [ ] **Step 10: Write test — no propagation for unset operators**

```typescript
it("does not propagate through unset operators", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })

    const imp = pm.addExpression({
        id: "imp",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "implies",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "imp",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "imp",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    // No operator assignment — should NOT propagate
    const result = eng.evaluate({
        variables: { vA: true, vB: null },
        operatorAssignments: {},
    })

    expect(result.ok).toBe(true)
    // vB stays null — no propagation through unset operator
    expect(result.assignment!.variables.vB).toBeNull()
    // implies evaluates to null (true → null = null)
    expect(result.conclusionTrue).toBeNull()
})
```

- [ ] **Step 11: Write test — or accepted, both unknown, no propagation**

```typescript
it("does not propagate or when both children are unknown", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        new ClaimLibrary(),
        new SourceLibrary(),
        new ClaimSourceLibrary()
    )
    const pm = eng.addPremise({
        id: "p1",
        argumentId: "arg1",
        argumentVersion: 0,
    })
    eng.addVariable({
        id: "vA",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "A",
        claimId: "c1",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "vB",
        argumentId: "arg1",
        argumentVersion: 0,
        symbol: "B",
        claimId: "c2",
        claimVersion: 0,
    })

    const orOp = pm.addExpression({
        id: "or1",
        premiseId: "p1",
        argumentVersion: 0,
        type: "operator",
        operator: "or",
        parentId: null,
        position: 0,
    })
    pm.addExpression({
        id: "eA",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vA",
        parentId: "or1",
        position: 0,
    })
    pm.addExpression({
        id: "eB",
        premiseId: "p1",
        argumentVersion: 0,
        type: "variable",
        variableId: "vB",
        parentId: "or1",
        position: 1,
    })
    eng.setRoleState({ conclusionPremiseId: "p1" })

    const result = eng.evaluate({
        variables: { vA: null, vB: null },
        operatorAssignments: { or1: "accepted" },
    })

    expect(result.ok).toBe(true)
    // Can't determine either child from OR alone
    expect(result.assignment!.variables.vA).toBeNull()
    expect(result.assignment!.variables.vB).toBeNull()
})
```

- [ ] **Step 12: Run tests to verify they fail**

Run: `pnpm run test 2>&1 | tail -20`

Expected: The new propagation tests fail (propagation not implemented yet). Existing tests should still pass.

- [ ] **Step 13: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add operator constraint propagation tests"
```

---

### Task 6: Implement propagation in `ArgumentEngine.evaluate()`

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Write the propagation function**

Add the following private method to `ArgumentEngine`, before the `evaluate()` method:

```typescript
    /**
     * Fixed-point constraint propagation for accepted operators.
     * Fills unknown (null) variable values based on accepted operator semantics.
     * User-assigned values (true/false) are never overwritten.
     * Returns a new variables record with derived values filled in.
     */
    private propagateOperatorConstraints(
        assignment: TCoreExpressionAssignment
    ): TCoreVariableAssignment {
        const vars: TCoreVariableAssignment = { ...assignment.variables }
        const accepted = assignment.operatorAssignments

        // Collect all accepted operators across all premises
        const acceptedOps: {
            expressionId: string
            operator: TCoreLogicalOperatorType
            childExpressions: TCorePropositionalExpression[]
            premiseEngine: PremiseEngine<TArg, TPremise, TExpr, TVar>
        }[] = []

        for (const pm of this.listPremises()) {
            for (const expr of pm.getExpressions()) {
                if (
                    expr.type === "operator" &&
                    accepted[expr.id] === "accepted"
                ) {
                    acceptedOps.push({
                        expressionId: expr.id,
                        operator: (expr as TExpr & { operator: TCoreLogicalOperatorType }).operator,
                        childExpressions: pm.getChildExpressions(expr.id) as TCorePropositionalExpression[],
                        premiseEngine: pm,
                    })
                }
            }
        }

        if (acceptedOps.length === 0) return vars

        // Resolve the value of an expression given current variable state.
        // Only resolves variable leaves and formula wrappers — does not
        // recurse into nested operators (those propagate only if accepted).
        const resolveLeaf = (
            expr: TCorePropositionalExpression,
            pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
        ): TCoreTrivalentValue => {
            if (expr.type === "variable") {
                return vars[expr.variableId] ?? null
            }
            if (expr.type === "formula") {
                const children = pm.getChildExpressions(expr.id) as TCorePropositionalExpression[]
                if (children.length === 1) return resolveLeaf(children[0], pm)
                return null
            }
            // Nested operator — resolve from its current Kleene value
            // only if all its leaves are known
            return resolveOperator(expr, pm)
        }

        const resolveOperator = (
            expr: TCorePropositionalExpression,
            pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
        ): TCoreTrivalentValue => {
            if (expr.type !== "operator") return resolveLeaf(expr, pm)
            const children = pm.getChildExpressions(expr.id) as TCorePropositionalExpression[]
            const op = (expr as TExpr & { operator: TCoreLogicalOperatorType }).operator
            switch (op) {
                case "not":
                    return kleeneNot(resolveLeaf(children[0], pm))
                case "and":
                    return children.reduce<TCoreTrivalentValue>(
                        (acc, c) => kleeneAnd(acc, resolveLeaf(c, pm)),
                        true
                    )
                case "or":
                    return children.reduce<TCoreTrivalentValue>(
                        (acc, c) => kleeneOr(acc, resolveLeaf(c, pm)),
                        false
                    )
                case "implies":
                    return kleeneImplies(
                        resolveLeaf(children[0], pm),
                        resolveLeaf(children[1], pm)
                    )
                case "iff":
                    return kleeneIff(
                        resolveLeaf(children[0], pm),
                        resolveLeaf(children[1], pm)
                    )
            }
        }

        // Sets a variable to a value only if it's currently unknown.
        const trySet = (variableId: string, value: boolean): boolean => {
            if (vars[variableId] !== null && vars[variableId] !== undefined) {
                return false // Already assigned by user or previous propagation
            }
            vars[variableId] = value
            return true
        }

        // Sets a leaf expression's underlying variable. Returns true if a value changed.
        const trySetLeaf = (
            expr: TCorePropositionalExpression,
            value: boolean,
            pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
        ): boolean => {
            if (expr.type === "variable") {
                return trySet(expr.variableId, value)
            }
            if (expr.type === "formula") {
                const children = pm.getChildExpressions(expr.id) as TCorePropositionalExpression[]
                if (children.length === 1) return trySetLeaf(children[0], value, pm)
            }
            return false
        }

        // Fixed-point loop
        let changed = true
        while (changed) {
            changed = false
            for (const { operator, childExpressions, premiseEngine } of acceptedOps) {
                const children = childExpressions

                switch (operator) {
                    case "and":
                        // AND accepted = true → all children must be true
                        for (const child of children) {
                            if (trySetLeaf(child, true, premiseEngine)) changed = true
                        }
                        break

                    case "or": {
                        // OR accepted = true → if all-but-one are false, remaining must be true
                        const unknowns = children.filter(
                            (c) => resolveLeaf(c, premiseEngine) === null
                        )
                        const allKnownFalse = children
                            .filter((c) => resolveLeaf(c, premiseEngine) !== null)
                            .every((c) => resolveLeaf(c, premiseEngine) === false)
                        if (unknowns.length === 1 && allKnownFalse) {
                            if (trySetLeaf(unknowns[0], true, premiseEngine)) changed = true
                        }
                        break
                    }

                    case "not":
                        // NOT accepted = true → child must be false
                        if (children.length === 1) {
                            if (trySetLeaf(children[0], false, premiseEngine)) changed = true
                        }
                        break

                    case "implies": {
                        // IMPLIES accepted = true:
                        // If antecedent true → consequent must be true
                        // If consequent false → antecedent must be false
                        const left = children[0]
                        const right = children[1]
                        const leftVal = resolveLeaf(left, premiseEngine)
                        const rightVal = resolveLeaf(right, premiseEngine)
                        if (leftVal === true) {
                            if (trySetLeaf(right, true, premiseEngine)) changed = true
                        }
                        if (rightVal === false) {
                            if (trySetLeaf(left, false, premiseEngine)) changed = true
                        }
                        break
                    }

                    case "iff": {
                        // IFF accepted = true:
                        // If left known → right must match
                        // If right known → left must match
                        const left = children[0]
                        const right = children[1]
                        const leftVal = resolveLeaf(left, premiseEngine)
                        const rightVal = resolveLeaf(right, premiseEngine)
                        if (leftVal === true) {
                            if (trySetLeaf(right, true, premiseEngine)) changed = true
                        } else if (leftVal === false) {
                            if (trySetLeaf(right, false, premiseEngine)) changed = true
                        }
                        if (rightVal === true) {
                            if (trySetLeaf(left, true, premiseEngine)) changed = true
                        } else if (rightVal === false) {
                            if (trySetLeaf(left, false, premiseEngine)) changed = true
                        }
                        break
                    }
                }
            }
        }

        return vars
    }
```

- [ ] **Step 2: Add required imports**

At the top of `src/lib/core/argument-engine.ts`, ensure these are imported (some may already be present — only add what's missing):

```typescript
import type {
    TCoreLogicalOperatorType,
    TCorePropositionalExpression,
} from "../schemata/index.js"
import type { TCoreVariableAssignment } from "../types/evaluation.js"
import {
    kleeneNot,
    kleeneAnd,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "./evaluation/kleene.js"
```

Check existing imports first — `kleeneNot`, `kleeneAnd`, `kleeneOr` may already be imported. Only add what's missing.

- [ ] **Step 3: Call propagation in `evaluate()`**

In the `evaluate()` method, after validation succeeds and before the try/catch block that runs per-premise evaluation, insert the propagation call. Find this section (around line 2305):

```typescript
        try {
```

Insert just before it:

```typescript
// Run operator constraint propagation to fill unknown variables
const propagatedVars = this.propagateOperatorConstraints(assignment)
const propagatedAssignment: TCoreExpressionAssignment = {
    variables: propagatedVars,
    operatorAssignments: assignment.operatorAssignments,
}
```

Then in the per-premise evaluation calls that follow (conclusion, supporting, constraint evaluations), replace `assignment` with `propagatedAssignment`. There should be three calls to `.evaluate(assignment, evalOpts)` — change each to `.evaluate(propagatedAssignment, evalOpts)`.

Also update the result's `assignment` field to return `propagatedAssignment` instead of manually copying:

Replace:

```typescript
                assignment: {
                    variables: { ...assignment.variables },
                    operatorAssignments: { ...assignment.operatorAssignments },
                },
```

with:

```typescript
                assignment: {
                    variables: { ...propagatedVars },
                    operatorAssignments: { ...assignment.operatorAssignments },
                },
```

- [ ] **Step 4: Run tests**

Run: `pnpm run test`

Expected: All tests pass including the new propagation tests from Task 5.

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "feat: implement operator constraint propagation in ArgumentEngine.evaluate"
```

---

### Task 7: Update CLI analysis commands

**Files:**

- Modify: `src/cli/commands/analysis.ts`
- Modify: `src/cli/storage/analysis.ts`

- [ ] **Step 1: Update `resolveAnalysisFilename` for auto-increment**

In `src/cli/storage/analysis.ts`, add a new function and update the existing one:

```typescript
export function resolveAnalysisFilename(filename?: string): string {
    return filename ?? "analysis.json"
}
```

Replace with:

```typescript
export function resolveAnalysisFilename(filename?: string): string {
    if (filename) return filename
    return "analysis.json"
}

export async function nextAnalysisFilename(
    argumentId: string,
    version: number
): Promise<string> {
    const existing = await listAnalysisFiles(argumentId, version)
    const pattern = /^analysis-(\d+)\.json$/
    let max = 0
    for (const name of existing) {
        const match = name.match(pattern)
        if (match) {
            const n = parseInt(match[1], 10)
            if (n > max) max = n
        }
    }
    return `analysis-${max + 1}.json`
}
```

- [ ] **Step 2: Update `analysis create` to use auto-increment**

In `src/cli/commands/analysis.ts`, update the `create` command. Change the action to use `nextAnalysisFilename` when no filename is provided:

Replace the filename resolution at the start of the create action:

```typescript
const filename = resolveAnalysisFilename(filenameArg)
if (await analysisFileExists(argumentId, version, filename)) {
    errorExit(`Analysis file "${filename}" already exists.`)
}
```

with:

```typescript
const filename = filenameArg
    ? resolveAnalysisFilename(filenameArg)
    : await nextAnalysisFilename(argumentId, version)
if (await analysisFileExists(argumentId, version, filename)) {
    errorExit(`Analysis file "${filename}" already exists.`)
}
```

Update the imports to include `nextAnalysisFilename`:

```typescript
import {
    analysisFileExists,
    deleteAnalysisFile,
    listAnalysisFiles,
    nextAnalysisFilename,
    readAnalysis,
    resolveAnalysisFilename,
    writeAnalysis,
} from "../storage/analysis.js"
```

- [ ] **Step 3: Update `analysis create` to use `operatorAssignments`**

In the create action, replace:

```typescript
                    rejectedExpressionIds: [],
```

with:

```typescript
                    operatorAssignments: {},
```

- [ ] **Step 4: Remove old commands and add new ones**

Remove the `reject`, `accept`, `reject-all`, and `accept-all` command registrations entirely. Replace them with:

```typescript
analysis
    .command("set-operator <operator_expression_id> <state>")
    .description("Set an operator's state (accepted, rejected, or unset)")
    .option("--file <filename>", "Analysis filename (default: analysis.json)")
    .action(
        async (
            operatorExpressionId: string,
            state: string,
            opts: { file?: string }
        ) => {
            if (!["accepted", "rejected", "unset"].includes(state)) {
                errorExit(
                    `State must be "accepted", "rejected", or "unset", got "${state}".`
                )
            }
            const filename = resolveAnalysisFilename(opts.file)
            if (!(await analysisFileExists(argumentId, version, filename))) {
                errorExit(`Analysis file "${filename}" does not exist.`)
            }
            const data = await readAnalysis(argumentId, version, filename)
            if (state === "unset") {
                delete data.operatorAssignments[operatorExpressionId]
            } else {
                data.operatorAssignments[operatorExpressionId] = state as
                    | "accepted"
                    | "rejected"
            }
            await writeAnalysis(argumentId, version, filename, data)
            printLine("success")
        }
    )

analysis
    .command("set-all-operators <state>")
    .description(
        "Set all operator expressions to a state (accepted, rejected, or unset)"
    )
    .option("--file <filename>", "Analysis filename (default: analysis.json)")
    .action(async (state: string, opts: { file?: string }) => {
        if (!["accepted", "rejected", "unset"].includes(state)) {
            errorExit(
                `State must be "accepted", "rejected", or "unset", got "${state}".`
            )
        }
        const filename = resolveAnalysisFilename(opts.file)
        if (!(await analysisFileExists(argumentId, version, filename))) {
            errorExit(`Analysis file "${filename}" does not exist.`)
        }
        const data = await readAnalysis(argumentId, version, filename)
        if (state === "unset") {
            data.operatorAssignments = {}
        } else {
            const premiseIds = await listPremiseIds(argumentId, version)
            for (const pid of premiseIds) {
                const premiseData = await readPremiseData(
                    argumentId,
                    version,
                    pid
                )
                for (const expr of premiseData.expressions) {
                    if (expr.type === "operator") {
                        data.operatorAssignments[expr.id] = state as
                            | "accepted"
                            | "rejected"
                    }
                }
            }
        }
        await writeAnalysis(argumentId, version, filename, data)
        const count = Object.keys(data.operatorAssignments).length
        printLine(
            state === "unset"
                ? "All operator assignments cleared"
                : `${count} operator(s) set to ${state}`
        )
    })
```

- [ ] **Step 5: Update `analysis show` output**

Replace the rejected expressions display block:

```typescript
if (data.rejectedExpressionIds.length > 0) {
    printLine("")
    printLine("Rejected operators:")
    for (const id of data.rejectedExpressionIds) {
        printLine(`  ${id}`)
    }
}
```

with:

```typescript
const opEntries = Object.entries(data.operatorAssignments)
if (opEntries.length > 0) {
    printLine("")
    printLine("Operator assignments:")
    for (const [id, state] of opEntries.sort(([a], [b]) =>
        a.localeCompare(b)
    )) {
        printLine(`  ${id} = ${state}`)
    }
}
```

- [ ] **Step 6: Update `analysis validate-assignments`**

Replace the rejected expression validation block:

```typescript
            // Validate rejected operator IDs
            if (data.rejectedExpressionIds.length > 0) {
                const engine = await hydrateEngine(argumentId, version)
                const allExpressionIds = new Set(
                    engine
                        .listPremises()
                        .flatMap((pm) => pm.getExpressions().map((e) => e.id))
                )
                for (const id of data.rejectedExpressionIds) {
                    if (!allExpressionIds.has(id)) {
                        issues.push({
                            code: "UNKNOWN_REJECTED_EXPRESSION",
                            message: `Rejected operator ID "${id}" does not exist in any premise.`,
                        })
                    }
                }
```

with:

```typescript
            // Validate operator assignment IDs
            const opIds = Object.keys(data.operatorAssignments)
            if (opIds.length > 0) {
                const engine = await hydrateEngine(argumentId, version)
                const allExpressionIds = new Set(
                    engine
                        .listPremises()
                        .flatMap((pm) => pm.getExpressions().map((e) => e.id))
                )
                for (const id of opIds) {
                    if (!allExpressionIds.has(id)) {
                        issues.push({
                            code: "UNKNOWN_REJECTED_EXPRESSION",
                            message: `Operator assignment ID "${id}" does not exist in any premise.`,
                        })
                    }
                }
```

- [ ] **Step 7: Update `analysis evaluate` command**

Replace:

```typescript
                        rejectedExpressionIds: [
                            ...analysisData.rejectedExpressionIds,
                        ],
```

with:

```typescript
                        operatorAssignments: {
                            ...analysisData.operatorAssignments,
                        },
```

- [ ] **Step 8: Update `analysis operators` to show state from analysis file**

Add a `--file` option to the `operators` command and display the acceptance state when an analysis file is provided. Replace the command registration:

```typescript
    analysis
        .command("operators")
        .description("List all operator expressions across all premises")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
```

with:

```typescript
    analysis
        .command("operators")
        .description("List all operator expressions across all premises")
        .option("--json", "Output as JSON")
        .option(
            "--file <filename>",
            "Show operator states from an analysis file"
        )
        .action(async (opts: { json?: boolean; file?: string }) => {
```

Then update the body to load operator assignments when `--file` is provided. After the `operators` array is built, before the JSON/text output, add:

```typescript
let opAssignments: Record<string, string> = {}
if (opts.file) {
    const filename = resolveAnalysisFilename(opts.file)
    if (await analysisFileExists(argumentId, version, filename)) {
        const analysisData = await readAnalysis(argumentId, version, filename)
        opAssignments = analysisData.operatorAssignments
    }
}
```

Update the JSON output to include state:

```typescript
if (opts.json) {
    printJson(
        operators.map((op) => ({
            ...op,
            state: opAssignments[op.expressionId] ?? "unset",
        }))
    )
    return
}
```

And update the text output line to include state:

```typescript
const state = opAssignments[op.expressionId] ?? "unset"
printLine(`  ${op.expressionId} | ${op.operator} | ${state}`)
```

- [ ] **Step 9: Remove `requireConfirmation` import if no longer used**

After removing reject-all and accept-all, check if `requireConfirmation` is still imported. It's still used by `analysis delete`, so keep it.

- [ ] **Step 10: Run typecheck**

Run: `pnpm run typecheck`

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add src/cli/commands/analysis.ts src/cli/storage/analysis.ts
git commit -m "feat: replace reject/accept CLI commands with set-operator and set-all-operators"
```

---

### Task 8: Update graph command

**Files:**

- Modify: `src/cli/commands/graph.ts`

- [ ] **Step 1: Update `TEvaluationOverlay` interface**

Replace:

```typescript
rejectedExpressionIds: Set<string>
```

with:

```typescript
operatorAssignments: Record<string, "accepted" | "rejected">
```

- [ ] **Step 2: Update the evaluation call**

Replace:

```typescript
                        rejectedExpressionIds: [
                            ...analysisData.rejectedExpressionIds,
                        ],
```

with:

```typescript
                        operatorAssignments: {
                            ...analysisData.operatorAssignments,
                        },
```

- [ ] **Step 3: Update the overlay construction**

Replace:

```typescript
                    rejectedExpressionIds: new Set(
                        analysisData.rejectedExpressionIds
                    ),
```

with:

```typescript
                    operatorAssignments: analysisData.operatorAssignments,
```

- [ ] **Step 4: Update the rendering check**

Replace:

```typescript
if (overlay.rejectedExpressionIds.has(expr.id)) {
    attrs.push(`peripheries=2`)
    attrs.push(`color=red`)
}
```

with:

```typescript
const opState = overlay.operatorAssignments[expr.id]
if (opState === "rejected") {
    attrs.push(`peripheries=2`)
    attrs.push(`color=red`)
} else if (opState === "accepted") {
    attrs.push(`peripheries=2`)
    attrs.push(`color=green`)
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/graph.ts
git commit -m "feat: update graph command to use operatorAssignments"
```

---

### Task 9: Update smoke test

**Files:**

- Modify: `scripts/smoke-test.sh`

- [ ] **Step 1: Replace the reject/accept smoke test sections**

Find and replace the section:

```bash
section "9g. analysis — reject and accept an expression"
$CLI "$ARG" latest analysis reject "$ROOT1"
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis evaluate
$CLI "$ARG" latest analysis accept "$ROOT1"

section "9g2. analysis — operators"
$CLI "$ARG" latest analysis operators
$CLI "$ARG" latest analysis operators --json

section "9g3. analysis — reject-all and accept-all"
$CLI "$ARG" latest analysis reject-all
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis evaluate
$CLI "$ARG" latest analysis accept-all
$CLI "$ARG" latest analysis show
```

with:

```bash
section "9g. analysis — set-operator (reject and accept)"
$CLI "$ARG" latest analysis set-operator "$ROOT1" rejected
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis evaluate
$CLI "$ARG" latest analysis set-operator "$ROOT1" unset

section "9g2. analysis — operators (with state)"
$CLI "$ARG" latest analysis operators
$CLI "$ARG" latest analysis operators --json
$CLI "$ARG" latest analysis set-operator "$ROOT1" accepted
$CLI "$ARG" latest analysis operators --file analysis.json
$CLI "$ARG" latest analysis operators --file analysis.json --json
$CLI "$ARG" latest analysis set-operator "$ROOT1" unset

section "9g3. analysis — set-all-operators"
$CLI "$ARG" latest analysis set-all-operators accepted
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis evaluate
$CLI "$ARG" latest analysis set-all-operators unset
$CLI "$ARG" latest analysis show
```

- [ ] **Step 2: Update `analysis create` call for auto-increment**

The existing smoke test passes an explicit filename for the second analysis file (`scenario-b.json`), which still works. For the first `analysis create` call (no filename), it will now auto-generate `analysis-1.json`. Find:

```bash
$CLI "$ARG" latest analysis create
```

and update subsequent commands that reference the default filename. Since the first create now generates `analysis-1.json` instead of `analysis.json`, capture the filename:

Replace:

```bash
section "9b. analysis — create and show"
$CLI "$ARG" latest analysis create
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis show --json
```

with:

```bash
section "9b. analysis — create and show"
ANALYSIS_FILE=$($CLI "$ARG" latest analysis create)
echo "ANALYSIS_FILE=$ANALYSIS_FILE"
$CLI "$ARG" latest analysis show --file "$ANALYSIS_FILE"
$CLI "$ARG" latest analysis show --file "$ANALYSIS_FILE" --json
```

Then update all subsequent `analysis` commands in the smoke test that don't specify `--file` to pass `--file "$ANALYSIS_FILE"`. This affects: `analysis set`, `analysis show`, `analysis evaluate`, `analysis reset`, `analysis set-operator`, `analysis set-all-operators`, `analysis validate-assignments`, `analysis refs`, `analysis export`.

Commands that already use `--file scenario-b.json` remain unchanged.

- [ ] **Step 3: Update the `analysis delete` section for the default file**

The section that deletes `scenario-b.json` stays. For the auto-generated file, update:

```bash
section "9l. analysis — delete"
$CLI "$ARG" latest analysis delete --file scenario-b.json --confirm
$CLI "$ARG" latest analysis list
```

to also delete the auto-generated file:

```bash
section "9l. analysis — delete"
$CLI "$ARG" latest analysis delete --file scenario-b.json --confirm
$CLI "$ARG" latest analysis delete --file "$ANALYSIS_FILE" --confirm
$CLI "$ARG" latest analysis list
```

- [ ] **Step 4: Build and run smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`

Expected: "SMOKE TEST PASSED"

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "test: update smoke test for operatorAssignments and set-operator commands"
```

---

### Task 10: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/api-reference.md`
- Modify: `CLI_EXAMPLES.md`

- [ ] **Step 1: Update README.md**

Search for `rejectedExpressionIds` in README.md and replace with `operatorAssignments: {}` in code examples. There are 2 occurrences.

- [ ] **Step 2: Update docs/api-reference.md**

Search for `rejectedExpressionIds` and update the method documentation to describe `operatorAssignments`.

- [ ] **Step 3: Update CLI_EXAMPLES.md**

Replace the "Reject and accept expressions" section (around lines 390-404) with documentation for the new commands:

````markdown
### Set operator states

Set an operator expression to accepted (relationship holds), rejected (relationship doesn't hold), or unset (normal evaluation):

```bash
# Accept an operator (propagates constraints to unknown variables)
proposit-core <argument-id> latest analysis set-operator <operator-id> accepted

# Reject an operator (evaluates to false, children skipped)
proposit-core <argument-id> latest analysis set-operator <operator-id> rejected

# Clear an operator back to normal evaluation
proposit-core <argument-id> latest analysis set-operator <operator-id> unset

# Mass-set all operators
proposit-core <argument-id> latest analysis set-all-operators accepted
proposit-core <argument-id> latest analysis set-all-operators unset
```
````

````

- [ ] **Step 4: Run lint and prettify**

Run: `pnpm run prettify && pnpm run lint`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/api-reference.md CLI_EXAMPLES.md
git commit -m "docs: update documentation for operatorAssignments and set-operator commands"
````

---

### Task 11: Run full check and final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full check**

Run: `pnpm run check`

Expected: typecheck, lint, all tests, build — all pass.

- [ ] **Step 2: Run smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`

Expected: "SMOKE TEST PASSED"

- [ ] **Step 3: Verify no stale references**

Run: `grep -r "rejectedExpressionIds" src/ test/ scripts/ --include="*.ts" --include="*.sh"`

Expected: No matches in source or test files. (Docs/plans may still reference it historically — that's fine.)

- [ ] **Step 4: Update changelog**

Add entry to `docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` describing:

- `rejectedExpressionIds` replaced by `operatorAssignments` (breaking schema change)
- Operator constraint propagation (accepted operators derive unknown variable values)
- New CLI commands: `set-operator`, `set-all-operators`
- Removed CLI commands: `reject`, `accept`, `reject-all`, `accept-all`
- Auto-incrementing analysis filenames (`analysis-1.json`, `analysis-2.json`, ...)

- [ ] **Step 5: Commit**

```bash
git add docs/changelogs/upcoming.md docs/release-notes/upcoming.md
git commit -m "docs: add changelog entries for operator constraint propagation"
```
