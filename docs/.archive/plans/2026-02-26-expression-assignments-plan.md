# Expression Assignments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace boolean-only variable assignments with three-valued (true/false/null) expression assignments that support operator/formula rejection.

**Architecture:** Introduce `TCoreExpressionAssignment` (variable assignments + rejected expression IDs) as the evaluation input, implement Kleene three-valued logic for null propagation, and update the entire evaluation pipeline from PremiseManager through ArgumentEngine to CLI.

**Tech Stack:** TypeScript, Typebox schemas, Vitest, Commander CLI

---

### Task 1: Kleene Three-Valued Logic Helpers

**Files:**

- Modify: `src/lib/core/evaluation/shared.ts`
- Test: `test/ExpressionManager.test.ts`

**Step 1: Write failing tests for Kleene helpers**

Add a new `describe` block at the end of `test/ExpressionManager.test.ts`:

```typescript
describe("Kleene three-valued logic helpers", () => {
    it("kleeneNot negates booleans and preserves null", () => {
        expect(kleeneNot(true)).toBe(false)
        expect(kleeneNot(false)).toBe(true)
        expect(kleeneNot(null)).toBe(null)
    })

    it("kleeneAnd follows Kleene truth table", () => {
        // false dominates
        expect(kleeneAnd(false, false)).toBe(false)
        expect(kleeneAnd(false, true)).toBe(false)
        expect(kleeneAnd(false, null)).toBe(false)
        expect(kleeneAnd(true, false)).toBe(false)
        expect(kleeneAnd(null, false)).toBe(false)
        // null when no false present
        expect(kleeneAnd(true, null)).toBe(null)
        expect(kleeneAnd(null, true)).toBe(null)
        expect(kleeneAnd(null, null)).toBe(null)
        // true only when both true
        expect(kleeneAnd(true, true)).toBe(true)
    })

    it("kleeneOr follows Kleene truth table", () => {
        // true dominates
        expect(kleeneOr(true, true)).toBe(true)
        expect(kleeneOr(true, false)).toBe(true)
        expect(kleeneOr(true, null)).toBe(true)
        expect(kleeneOr(false, true)).toBe(true)
        expect(kleeneOr(null, true)).toBe(true)
        // null when no true present
        expect(kleeneOr(false, null)).toBe(null)
        expect(kleeneOr(null, false)).toBe(null)
        expect(kleeneOr(null, null)).toBe(null)
        // false only when both false
        expect(kleeneOr(false, false)).toBe(false)
    })

    it("kleeneImplies follows Kleene truth table", () => {
        expect(kleeneImplies(true, true)).toBe(true)
        expect(kleeneImplies(true, false)).toBe(false)
        expect(kleeneImplies(true, null)).toBe(null)
        expect(kleeneImplies(false, true)).toBe(true)
        expect(kleeneImplies(false, false)).toBe(true)
        expect(kleeneImplies(false, null)).toBe(true)
        expect(kleeneImplies(null, true)).toBe(true)
        expect(kleeneImplies(null, false)).toBe(null)
        expect(kleeneImplies(null, null)).toBe(null)
    })

    it("kleeneIff follows Kleene truth table", () => {
        expect(kleeneIff(true, true)).toBe(true)
        expect(kleeneIff(true, false)).toBe(false)
        expect(kleeneIff(true, null)).toBe(null)
        expect(kleeneIff(false, true)).toBe(false)
        expect(kleeneIff(false, false)).toBe(true)
        expect(kleeneIff(false, null)).toBe(null)
        expect(kleeneIff(null, true)).toBe(null)
        expect(kleeneIff(null, false)).toBe(null)
        expect(kleeneIff(null, null)).toBe(null)
    })
})
```

Import the new functions at the top of the test file alongside existing imports from `../src/lib/core/evaluation/shared.js`.

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `kleeneNot`, `kleeneAnd`, `kleeneOr`, `kleeneImplies`, `kleeneIff` are not exported.

**Step 3: Implement Kleene helpers**

Add to `src/lib/core/evaluation/shared.ts`:

```typescript
import type { TCoreTrivalentValue } from "../../types/evaluation.js"

export function kleeneNot(a: TCoreTrivalentValue): TCoreTrivalentValue {
    return a === null ? null : !a
}

export function kleeneAnd(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    if (a === false || b === false) return false
    if (a === null || b === null) return null
    return true
}

export function kleeneOr(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    if (a === true || b === true) return true
    if (a === null || b === null) return null
    return false
}

export function kleeneImplies(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneOr(kleeneNot(a), b)
}

export function kleeneIff(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneAnd(kleeneImplies(a, b), kleeneImplies(b, a))
}
```

Note: `TCoreTrivalentValue` doesn't exist yet. Add it to `src/lib/types/evaluation.ts` (line 22, before the current `TCoreVariableAssignment`):

```typescript
/** Three-valued truth value: true, false, or null (unset/unknown). */
export type TCoreTrivalentValue = boolean | null
```

**Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: All Kleene tests PASS. Existing tests still pass.

**Step 5: Commit**

```bash
git add src/lib/types/evaluation.ts src/lib/core/evaluation/shared.ts test/ExpressionManager.test.ts
git commit -m "Add Kleene three-valued logic helpers"
```

---

### Task 2: Update Core Types

**Files:**

- Modify: `src/lib/types/evaluation.ts`

This task replaces `TCoreVariableAssignment` with `TCoreExpressionAssignment` and updates all result types to use `TCoreTrivalentValue`. This will cause compilation errors throughout the codebase — they are fixed in subsequent tasks.

**Step 1: Replace TCoreVariableAssignment**

In `src/lib/types/evaluation.ts`, replace line 22's `TCoreVariableAssignment`:

```typescript
/** Maps variable IDs to three-valued truth values. */
export type TCoreVariableAssignment = Record<string, TCoreTrivalentValue>

/** Full expression assignment: variable truth values and rejected expression IDs. */
export interface TCoreExpressionAssignment {
    /** Variable ID → true/false/null (null = unset/not sure). */
    variables: TCoreVariableAssignment
    /** Expression IDs the user rejects (evaluate to false, children skipped). */
    rejectedExpressionIds: string[]
}
```

Note: `TCoreVariableAssignment` is kept as a building block (now three-valued) and `TCoreExpressionAssignment` wraps it with rejections.

**Step 2: Update result types to three-valued**

In the same file, update these interfaces:

`TCoreDirectionalVacuity` (line 66): Change all `boolean` fields to `TCoreTrivalentValue`.

`TCorePremiseInferenceDiagnostic` (line 79): Change all `boolean` fields (except `kind`, `premiseId`, `rootExpressionId`) to `TCoreTrivalentValue`.

`TCorePremiseEvaluationResult` (line 106):

- `rootValue?: TCoreTrivalentValue`
- `expressionValues: Record<string, TCoreTrivalentValue>`
- `variableValues: Record<string, TCoreTrivalentValue>`

`TCoreArgumentEvaluationResult` (line 134):

- `assignment?: TCoreExpressionAssignment`
- `isAdmissibleAssignment?: TCoreTrivalentValue`
- `allSupportingPremisesTrue?: TCoreTrivalentValue`
- `conclusionTrue?: TCoreTrivalentValue`
- `isCounterexample?: TCoreTrivalentValue`
- `preservesTruthUnderAssignment?: TCoreTrivalentValue`

`TCoreCounterexample` (line 174):

- `assignment: TCoreExpressionAssignment`

**Step 3: Verify typecheck fails as expected**

Run: `pnpm run typecheck`
Expected: FAIL — compilation errors in PremiseManager.ts, ArgumentEngine.ts, CLI code, and tests. This is expected; subsequent tasks fix them.

**Step 4: Commit**

```bash
git add src/lib/types/evaluation.ts
git commit -m "Update evaluation types for three-valued expression assignments"
```

---

### Task 3: Update evaluation/shared.ts Helpers

**Files:**

- Modify: `src/lib/core/evaluation/shared.ts`

**Step 1: Update implicationValue to three-valued**

Replace the existing `implicationValue` function:

```typescript
/** Computes Kleene three-valued material implication: `!antecedent || consequent`. */
export function implicationValue(
    antecedent: TCoreTrivalentValue,
    consequent: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneImplies(antecedent, consequent)
}
```

**Step 2: Update buildDirectionalVacuity to three-valued**

Replace the existing `buildDirectionalVacuity` function:

```typescript
/** Builds a directional vacuity diagnostic for one direction of an implication. */
export function buildDirectionalVacuity(
    antecedentTrue: TCoreTrivalentValue,
    consequentTrue: TCoreTrivalentValue
): TCoreDirectionalVacuity {
    const implication = implicationValue(antecedentTrue, consequentTrue)
    return {
        antecedentTrue,
        consequentTrue,
        implicationValue: implication,
        isVacuouslyTrue: kleeneAnd(implication, kleeneNot(antecedentTrue)),
        fired: antecedentTrue,
    }
}
```

Note: `isVacuouslyTrue` is now: the implication is true AND the antecedent is not true. If either is null, the result is null.

**Step 3: Commit**

```bash
git add src/lib/core/evaluation/shared.ts
git commit -m "Update evaluation helpers for three-valued logic"
```

---

### Task 4: Update PremiseManager.evaluate

**Files:**

- Modify: `src/lib/core/PremiseManager.ts:428-600`
- Test: `test/ExpressionManager.test.ts`

**Step 1: Write failing tests for three-valued PremiseManager evaluation**

Add a new `describe` block at the end of `test/ExpressionManager.test.ts`:

```typescript
describe("PremiseManager — three-valued evaluation", () => {
    it("evaluates unset variables as null", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const v = engine.addVariable("A")
        pm.addVariable(v.id)
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: v.id,
            parentId: null,
            position: 0,
        })
        const result = pm.evaluate({
            variables: { [v.id]: null },
            rejectedExpressionIds: [],
        })
        expect(result.rootValue).toBe(null)
    })

    it("missing variables default to null", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const v = engine.addVariable("A")
        pm.addVariable(v.id)
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: v.id,
            parentId: null,
            position: 0,
        })
        const result = pm.evaluate({
            variables: {},
            rejectedExpressionIds: [],
        })
        expect(result.rootValue).toBe(null)
    })

    it("propagates null through AND (Kleene)", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const vA = engine.addVariable("A")
        const vB = engine.addVariable("B")
        pm.addVariable(vA.id)
        pm.addVariable(vB.id)
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "eA",
            type: "variable",
            variableId: vA.id,
            parentId: "op",
            position: 0,
        })
        pm.addExpression({
            id: "eB",
            type: "variable",
            variableId: vB.id,
            parentId: "op",
            position: 1,
        })

        // true AND null = null
        expect(
            pm.evaluate({
                variables: { [vA.id]: true, [vB.id]: null },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(null)

        // false AND null = false
        expect(
            pm.evaluate({
                variables: { [vA.id]: false, [vB.id]: null },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(false)
    })

    it("propagates null through OR (Kleene)", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const vA = engine.addVariable("A")
        const vB = engine.addVariable("B")
        pm.addVariable(vA.id)
        pm.addVariable(vB.id)
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "or",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "eA",
            type: "variable",
            variableId: vA.id,
            parentId: "op",
            position: 0,
        })
        pm.addExpression({
            id: "eB",
            type: "variable",
            variableId: vB.id,
            parentId: "op",
            position: 1,
        })

        // true OR null = true
        expect(
            pm.evaluate({
                variables: { [vA.id]: true, [vB.id]: null },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(true)

        // false OR null = null
        expect(
            pm.evaluate({
                variables: { [vA.id]: false, [vB.id]: null },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(null)
    })

    it("propagates null through implies (Kleene)", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const vA = engine.addVariable("A")
        const vB = engine.addVariable("B")
        pm.addVariable(vA.id)
        pm.addVariable(vB.id)
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "implies",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "eA",
            type: "variable",
            variableId: vA.id,
            parentId: "op",
            position: 0,
        })
        pm.addExpression({
            id: "eB",
            type: "variable",
            variableId: vB.id,
            parentId: "op",
            position: 1,
        })

        // false implies null = true
        expect(
            pm.evaluate({
                variables: { [vA.id]: false, [vB.id]: null },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(true)

        // null implies true = true
        expect(
            pm.evaluate({
                variables: { [vA.id]: null, [vB.id]: true },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(true)

        // true implies null = null
        expect(
            pm.evaluate({
                variables: { [vA.id]: true, [vB.id]: null },
                rejectedExpressionIds: [],
            }).rootValue
        ).toBe(null)
    })

    it("rejected operator evaluates to false and skips children", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const vA = engine.addVariable("A")
        const vB = engine.addVariable("B")
        pm.addVariable(vA.id)
        pm.addVariable(vB.id)
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "eA",
            type: "variable",
            variableId: vA.id,
            parentId: "op",
            position: 0,
        })
        pm.addExpression({
            id: "eB",
            type: "variable",
            variableId: vB.id,
            parentId: "op",
            position: 1,
        })

        const result = pm.evaluate({
            variables: { [vA.id]: true, [vB.id]: true },
            rejectedExpressionIds: ["op"],
        })
        expect(result.rootValue).toBe(false)
        // Children should not have been evaluated
        expect(result.expressionValues["eA"]).toBeUndefined()
        expect(result.expressionValues["eB"]).toBeUndefined()
    })

    it("rejected formula evaluates to false", () => {
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const vA = engine.addVariable("A")
        pm.addVariable(vA.id)
        pm.addExpression({
            id: "f1",
            type: "formula",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "eA",
            type: "variable",
            variableId: vA.id,
            parentId: "f1",
            position: 0,
        })

        const result = pm.evaluate({
            variables: { [vA.id]: true },
            rejectedExpressionIds: ["f1"],
        })
        expect(result.rootValue).toBe(false)
    })

    it("rejected nested operator forces false while parent computes normally", () => {
        // (A and B) or C — reject the "and", C=true → false or true = true
        const engine = new ArgumentEngine("arg", 0, "Test")
        const pm = engine.createPremise("p1")
        const vA = engine.addVariable("A")
        const vB = engine.addVariable("B")
        const vC = engine.addVariable("C")
        pm.addVariable(vA.id)
        pm.addVariable(vB.id)
        pm.addVariable(vC.id)
        pm.addExpression({
            id: "or",
            type: "operator",
            operator: "or",
            parentId: null,
            position: 0,
        })
        pm.addExpression({
            id: "and",
            type: "operator",
            operator: "and",
            parentId: "or",
            position: 0,
        })
        pm.addExpression({
            id: "eC",
            type: "variable",
            variableId: vC.id,
            parentId: "or",
            position: 1,
        })
        pm.addExpression({
            id: "eA",
            type: "variable",
            variableId: vA.id,
            parentId: "and",
            position: 0,
        })
        pm.addExpression({
            id: "eB",
            type: "variable",
            variableId: vB.id,
            parentId: "and",
            position: 1,
        })

        const result = pm.evaluate({
            variables: { [vA.id]: true, [vB.id]: true, [vC.id]: true },
            rejectedExpressionIds: ["and"],
        })
        // (rejected=false) or true = true
        expect(result.rootValue).toBe(true)
        expect(result.expressionValues["and"]).toBe(false)
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — PremiseManager.evaluate doesn't accept the new signature yet.

**Step 3: Update PremiseManager.evaluate implementation**

In `src/lib/core/PremiseManager.ts`, update the `evaluate` method (lines 428-600):

1. Change signature from `assignment: TCoreVariableAssignment` to `assignment: TCoreExpressionAssignment`.

2. Add import for `TCoreExpressionAssignment` and `TCoreTrivalentValue`.

3. Add imports for `kleeneNot`, `kleeneAnd`, `kleeneOr`, `kleeneImplies`, `kleeneIff` from `./evaluation/shared.js`.

4. Remove the `missingVariableIds` check (lines 455-462). Missing variables now evaluate to `null`.

5. Update `strictUnknownKeys` to check `assignment.variables` instead of `assignment`:

```typescript
if (options?.strictUnknownKeys || options?.requireExactCoverage) {
    const knownVariableIds = new Set(referencedVariableIds)
    const unknownKeys = Object.keys(assignment.variables).filter(
        (variableId) => !knownVariableIds.has(variableId)
    )
    if (unknownKeys.length > 0) {
        throw new Error(
            `Assignment contains unknown variable IDs for premise "${this.id}": ${unknownKeys.join(", ")}`
        )
    }
}
```

6. Change `expressionValues` type to `Record<string, TCoreTrivalentValue>`.

7. Change `evaluateExpression` return type to `TCoreTrivalentValue`.

8. Add rejection check at the top of `evaluateExpression`, after the expression lookup but before any child evaluation:

```typescript
if (assignment.rejectedExpressionIds.includes(expression.id)) {
    expressionValues[expression.id] = false
    return false
}
```

9. Update variable lookup:

```typescript
if (expression.type === "variable") {
    const value = assignment.variables[expression.variableId] ?? null
    expressionValues[expression.id] = value
    return value
}
```

10. Change `let value: boolean` to `let value: TCoreTrivalentValue`.

11. Update operator evaluation to use Kleene helpers:

```typescript
case "not":
    value = kleeneNot(evaluateExpression(children[0].id))
    break
case "and":
    value = children.reduce<TCoreTrivalentValue>(
        (acc, child) => kleeneAnd(acc, evaluateExpression(child.id)),
        true
    )
    break
case "or":
    value = children.reduce<TCoreTrivalentValue>(
        (acc, child) => kleeneOr(acc, evaluateExpression(child.id)),
        false
    )
    break
case "implies": {
    const left = children.find((child) => child.position === 0)
    const right = children.find((child) => child.position === 1)
    value = kleeneImplies(
        evaluateExpression(left!.id),
        evaluateExpression(right!.id)
    )
    break
}
case "iff": {
    const left = children.find((child) => child.position === 0)
    const right = children.find((child) => child.position === 1)
    value = kleeneIff(
        evaluateExpression(left!.id),
        evaluateExpression(right!.id)
    )
    break
}
```

12. Update `variableValues` to three-valued:

```typescript
const variableValues: Record<string, TCoreTrivalentValue> = {}
for (const variableId of referencedVariableIds) {
    variableValues[variableId] = assignment.variables[variableId] ?? null
}
```

13. Update inference diagnostic computation. Change `isVacuouslyTrue: !leftValue` to `isVacuouslyTrue: kleeneNot(leftValue)`, `fired: leftValue` stays as-is (already TCoreTrivalentValue), `firedAndHeld: leftValue && rightValue` to `firedAndHeld: kleeneAnd(leftValue, rightValue)`, `bothSidesTrue: leftValue && rightValue` to `bothSidesTrue: kleeneAnd(leftValue, rightValue)`, `bothSidesFalse: !leftValue && !rightValue` to `bothSidesFalse: kleeneAnd(kleeneNot(leftValue), kleeneNot(rightValue))`.

**Step 4: Run tests to verify the new tests pass**

Run: `pnpm run test`
Expected: New three-valued tests PASS. Some existing tests may fail due to changed signature — those are fixed in Task 6.

**Step 5: Commit**

```bash
git add src/lib/core/PremiseManager.ts test/ExpressionManager.test.ts
git commit -m "Update PremiseManager.evaluate for three-valued expression assignments"
```

---

### Task 5: Update ArgumentEngine.evaluate and checkValidity

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts:386-664`
- Test: `test/ExpressionManager.test.ts`

**Step 1: Write failing tests for three-valued ArgumentEngine evaluation**

Add a new `describe` block at the end of `test/ExpressionManager.test.ts`:

```typescript
describe("ArgumentEngine — three-valued evaluation", () => {
    function buildSimpleArgument() {
        // A implies B (conclusion), C implies A (supporting), with constraint D
        const engine = new ArgumentEngine("arg", 0, "Test")
        const vA = engine.addVariable("A")
        const vB = engine.addVariable("B")
        const vC = engine.addVariable("C")
        const vD = engine.addVariable("D")

        const conclusion = engine.createPremise("conclusion")
        conclusion.addVariable(vA.id)
        conclusion.addVariable(vB.id)
        conclusion.addExpression({
            id: "c-imp",
            type: "operator",
            operator: "implies",
            parentId: null,
            position: 0,
        })
        conclusion.addExpression({
            id: "c-a",
            type: "variable",
            variableId: vA.id,
            parentId: "c-imp",
            position: 0,
        })
        conclusion.addExpression({
            id: "c-b",
            type: "variable",
            variableId: vB.id,
            parentId: "c-imp",
            position: 1,
        })

        const supporting = engine.createPremise("supporting")
        supporting.addVariable(vC.id)
        supporting.addVariable(vA.id)
        supporting.addExpression({
            id: "s-imp",
            type: "operator",
            operator: "implies",
            parentId: null,
            position: 0,
        })
        supporting.addExpression({
            id: "s-c",
            type: "variable",
            variableId: vC.id,
            parentId: "s-imp",
            position: 0,
        })
        supporting.addExpression({
            id: "s-a",
            type: "variable",
            variableId: vA.id,
            parentId: "s-imp",
            position: 1,
        })

        const constraint = engine.createPremise("constraint")
        constraint.addVariable(vD.id)
        constraint.addExpression({
            id: "d-var",
            type: "variable",
            variableId: vD.id,
            parentId: null,
            position: 0,
        })

        engine.setConclusionPremise(conclusion.getId())
        engine.addSupportingPremise(supporting.getId())

        return { engine, vA, vB, vC, vD }
    }

    it("returns null for isAdmissibleAssignment when constraint is null", () => {
        const { engine, vA, vB, vC, vD } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [vA.id]: true,
                [vB.id]: true,
                [vC.id]: true,
                [vD.id]: null,
            },
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(null)
    })

    it("returns null for isCounterexample when conclusion is null", () => {
        const { engine, vA, vB, vC, vD } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [vA.id]: true,
                [vB.id]: null,
                [vC.id]: true,
                [vD.id]: true,
            },
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(true)
        expect(result.conclusionTrue).toBe(null)
        expect(result.isCounterexample).toBe(null)
    })

    it("rejected inference root makes premise false", () => {
        const { engine, vA, vB, vC, vD } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [vA.id]: true,
                [vB.id]: true,
                [vC.id]: true,
                [vD.id]: true,
            },
            rejectedExpressionIds: ["c-imp"],
        })
        expect(result.ok).toBe(true)
        expect(result.conclusionTrue).toBe(false)
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — ArgumentEngine.evaluate doesn't accept the new signature yet.

**Step 3: Update ArgumentEngine.evaluate**

In `src/lib/core/ArgumentEngine.ts`:

1. Change the `evaluate` method signature from `assignment: TCoreVariableAssignment` to `assignment: TCoreExpressionAssignment`.

2. Add imports for `TCoreExpressionAssignment`, `TCoreTrivalentValue`, `kleeneAnd`, `kleeneNot` from the relevant modules.

3. Update summary flag computation (around line 459):

```typescript
const isAdmissibleAssignment =
    constraintEvaluations.reduce<TCoreTrivalentValue>(
        (acc, result) => kleeneAnd(acc, result.rootValue ?? null),
        true
    )
const allSupportingPremisesTrue =
    supportingEvaluations.reduce<TCoreTrivalentValue>(
        (acc, result) => kleeneAnd(acc, result.rootValue ?? null),
        true
    )
const conclusionTrue: TCoreTrivalentValue =
    conclusionEvaluation.rootValue ?? null
const isCounterexample = kleeneAnd(
    isAdmissibleAssignment,
    kleeneAnd(allSupportingPremisesTrue, kleeneNot(conclusionTrue))
)
```

4. Update the assignment copy in the return value:

```typescript
assignment: {
    variables: { ...assignment.variables },
    rejectedExpressionIds: [...assignment.rejectedExpressionIds],
},
```

5. Update `preservesTruthUnderAssignment`:

```typescript
preservesTruthUnderAssignment: kleeneNot(isCounterexample),
```

**Step 4: Update ArgumentEngine.checkValidity**

In the `checkValidity` method (around line 609):

1. Change assignment construction:

```typescript
const assignment: TCoreExpressionAssignment = {
    variables: {},
    rejectedExpressionIds: [],
}
for (let i = 0; i < checkedVariableIds.length; i++) {
    assignment.variables[checkedVariableIds[i]] = Boolean(mask & (1 << i))
}
```

2. Update the admissibility and counterexample checks to use `=== true` for type safety:

```typescript
if (result.isAdmissibleAssignment === true) {
    numAdmissibleAssignments += 1
}

if (result.isCounterexample === true) {
```

**Step 5: Run tests to verify new tests pass**

Run: `pnpm run test`
Expected: New ArgumentEngine three-valued tests PASS.

**Step 6: Commit**

```bash
git add src/lib/core/ArgumentEngine.ts test/ExpressionManager.test.ts
git commit -m "Update ArgumentEngine for three-valued expression assignments"
```

---

### Task 6: Fix Existing Tests

**Files:**

- Modify: `test/ExpressionManager.test.ts`

All existing tests that call `pm.evaluate(assignment)` or `engine.evaluate(assignment)` pass a plain `Record<string, boolean>`. These must be wrapped in `{ variables: ..., rejectedExpressionIds: [] }`.

**Step 1: Find and update all existing evaluate calls**

Search `test/ExpressionManager.test.ts` for `.evaluate(` calls. Every call site that passes a plain record like `{ [v.id]: true }` needs to become `{ variables: { [v.id]: true }, rejectedExpressionIds: [] }`.

Also update any assertions that check `result.assignment` — the shape changed from `Record<string, boolean>` to `TCoreExpressionAssignment`.

Update assertions on `result.isAdmissibleAssignment`, `result.isCounterexample`, etc. that use truthy/falsy checks to use `=== true` / `=== false` comparisons.

**Step 2: Run full test suite**

Run: `pnpm run test`
Expected: ALL tests pass.

**Step 3: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: Both pass. Run `pnpm run prettify` and `pnpm eslint . --fix` if needed.

**Step 4: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Update existing tests for expression assignment format"
```

---

### Task 7: Update Analysis Schema and CLI Commands

**Files:**

- Modify: `src/lib/schemata/analysis.ts`
- Modify: `src/cli/commands/analysis.ts`

**Step 1: Update analysis schema**

Replace `src/lib/schemata/analysis.ts`:

```typescript
import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreAnalysisFileSchema = Type.Object({
    argumentId: UUID,
    argumentVersion: Type.Number(),
    assignments: Type.Record(
        Type.String(),
        Type.Union([Type.Boolean(), Type.Null()]),
        {
            description: "Variable symbol → true/false/null (unset).",
        }
    ),
    rejectedExpressionIds: Type.Array(Type.String(), {
        description: "Expression IDs rejected by the user.",
    }),
})
export type TCoreAnalysisFile = Static<typeof CoreAnalysisFileSchema>
```

**Step 2: Update `analysis create` command**

In `src/cli/commands/analysis.ts`, update the `create` command (around line 28):

- Change `--default` option description: `"Default value for all assignments (true, false, or unset)"`, default: `"unset"`
- Update default value parsing:

```typescript
const defaultValue =
    opts.default === "true" ? true : opts.default === "false" ? false : null
```

- Change assignments type: `const assignments: Record<string, boolean | null> = {}`
- Add `rejectedExpressionIds: []` to the write call.

**Step 3: Update `analysis set` command**

Around line 100, update value parsing to accept `"unset"`:

```typescript
const parsedValue =
    valueArg === "true"
        ? true
        : valueArg === "false"
          ? false
          : valueArg === "unset"
            ? null
            : errorExit(
                  `Value must be "true", "false", or "unset", got "${valueArg}".`
              )
```

Update the description: `"Update a single variable assignment (value: true, false, or unset)"`

**Step 4: Update `analysis reset` command**

Around line 145, update value parsing:

```typescript
const resetValue =
    opts.value === "true" ? true : opts.value === "false" ? false : null
```

Update `--value` option description and default to `"unset"`.

**Step 5: Update `analysis show` command**

Around line 94, update display for null values:

```typescript
for (const [symbol, value] of sorted) {
    printLine(`${symbol} = ${value === null ? "unset" : value}`)
}
```

**Step 6: Add `analysis reject` and `analysis accept` commands**

Add after the `reset` command:

```typescript
analysis
    .command("reject <expression_id>")
    .description("Reject an expression (it will evaluate to false)")
    .option("--file <filename>", "Analysis filename (default: analysis.json)")
    .action(async (expressionId: string, opts: { file?: string }) => {
        const filename = resolveAnalysisFilename(opts.file)
        if (!(await analysisFileExists(argumentId, version, filename))) {
            errorExit(`Analysis file "${filename}" does not exist.`)
        }
        const data = await readAnalysis(argumentId, version, filename)
        if (!data.rejectedExpressionIds.includes(expressionId)) {
            data.rejectedExpressionIds.push(expressionId)
        }
        await writeAnalysis(argumentId, version, filename, data)
        printLine("success")
    })

analysis
    .command("accept <expression_id>")
    .description("Accept an expression (restore normal computation)")
    .option("--file <filename>", "Analysis filename (default: analysis.json)")
    .action(async (expressionId: string, opts: { file?: string }) => {
        const filename = resolveAnalysisFilename(opts.file)
        if (!(await analysisFileExists(argumentId, version, filename))) {
            errorExit(`Analysis file "${filename}" does not exist.`)
        }
        const data = await readAnalysis(argumentId, version, filename)
        data.rejectedExpressionIds = data.rejectedExpressionIds.filter(
            (id) => id !== expressionId
        )
        await writeAnalysis(argumentId, version, filename, data)
        printLine("success")
    })
```

**Step 7: Update `analysis evaluate` command**

Around line 305, update the assignment conversion to build `TCoreExpressionAssignment`:

```typescript
const assignment: TCoreExpressionAssignment = {
    variables: {},
    rejectedExpressionIds: [...analysisData.rejectedExpressionIds],
}
for (const [sym, val] of Object.entries(analysisData.assignments)) {
    const id = symbolToId.get(sym)
    if (id !== undefined) assignment.variables[id] = val
}
```

Import `TCoreExpressionAssignment` at the top of the file.

Update the assignment type in the `Record` construction (remove the old `const assignment: Record<string, boolean> = {}`).

**Step 8: Update `analysis validate-assignments` command**

In the validate-assignments command (around line 164), add validation for `rejectedExpressionIds`. After checking missing/unknown symbols, also check that rejected expression IDs reference real expressions:

```typescript
// Validate rejected expression IDs
const engine = await hydrateEngine(argumentId, version)
const allExpressionIds = new Set(
    engine.listPremises().flatMap((pm) => pm.getExpressions().map((e) => e.id))
)
const unknownExpressionIds = data.rejectedExpressionIds.filter(
    (id) => !allExpressionIds.has(id)
)
```

Add findings for unknown expression IDs to the validation output.

**Step 9: Run full check**

Run: `pnpm run check`
Expected: typecheck, lint, test, and build all pass.

**Step 10: Commit**

```bash
git add src/lib/schemata/analysis.ts src/cli/commands/analysis.ts
git commit -m "Update analysis schema and CLI for expression assignments"
```
