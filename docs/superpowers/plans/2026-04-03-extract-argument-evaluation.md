# Extract Argument Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `evaluate()`, `checkValidity()`, and `propagateOperatorConstraints()` from `ArgumentEngine` into standalone functions in a new `src/lib/core/evaluation/argument-evaluation.ts` module, reducing ArgumentEngine by ~690 lines.

**Architecture:** The three methods become standalone functions that accept the engine's public API surface (premises, variables, role state) via a narrow read-only interface. `ArgumentEngine` delegates to these functions. No public API changes — `evaluate()` and `checkValidity()` remain instance methods on the engine, and the `TArgumentEvaluation` interface is unchanged. The standalone functions are additionally exported from `src/lib/index.ts` for direct use.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                                             | Action | Responsibility                                                                                               |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/core/evaluation/argument-evaluation.ts` | Create | `evaluateArgument()`, `checkArgumentValidity()`, `propagateOperatorConstraints()` standalone functions       |
| `src/lib/core/argument-engine.ts`                | Modify | Delegate `evaluate()` and `checkValidity()` to standalone functions; remove `propagateOperatorConstraints()` |
| `src/lib/index.ts`                               | Modify | Re-export standalone functions                                                                               |
| `test/core.test.ts`                              | Modify | Add standalone function tests                                                                                |

---

### Task 1: Define the read-only argument interface for evaluation

**Files:**

- Create: `src/lib/core/evaluation/argument-evaluation.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `test/core.test.ts`:

```typescript
describe("evaluateArgument (standalone)", () => {
    it("is exported from the library", async () => {
        const mod = await import("../src/lib/index.js")
        expect(typeof mod.evaluateArgument).toBe("function")
        expect(typeof mod.checkArgumentValidity).toBe("function")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "evaluateArgument (standalone)"`
Expected: FAIL — `evaluateArgument` is not exported

- [ ] **Step 3: Create the module with type definitions and stub functions**

Create `src/lib/core/evaluation/argument-evaluation.ts`:

```typescript
import {
    isClaimBound,
    isPremiseBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreCounterexample,
    TCoreExpressionAssignment,
    TCoreTrivalentValue,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
    TCoreVariableAssignment,
    TCorePremiseEvaluationResult,
} from "../../types/evaluation.js"
import {
    kleeneAnd,
    kleeneNot,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "./kleene.js"
import { makeErrorIssue, makeValidationResult } from "./validation.js"

/**
 * Read-only interface providing the data an evaluation needs from an
 * argument engine. This is intentionally narrow — evaluation should
 * not mutate anything.
 */
export interface TArgumentEvaluationContext {
    /** The argument's own ID. */
    argumentId: string
    /** Returns the conclusion PremiseEngine, or undefined. */
    getConclusionPremise(): TEvaluablePremise | undefined
    /** Returns supporting premises (inference premises minus conclusion). */
    listSupportingPremises(): TEvaluablePremise[]
    /** Returns all premises. */
    listPremises(): TEvaluablePremise[]
    /** The conclusion premise ID, if set. */
    conclusionPremiseId: string | undefined
    /** Look up a variable by ID. */
    getVariable(variableId: string): TCorePropositionalVariable | undefined
    /** Pre-evaluation structural validation. */
    validateEvaluability(): {
        ok: boolean
        issues: { severity: string; code: string; message: string }[]
    }
}

/**
 * Narrow view of a PremiseEngine needed for evaluation.
 */
export interface TEvaluablePremise {
    getId(): string
    getExpressions(): TCorePropositionalExpression[]
    getChildExpressions(parentId: string): TCorePropositionalExpression[]
    getVariables(): TCorePropositionalVariable[]
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            resolver?: (variableId: string) => boolean | null
        }
    ): TCorePremiseEvaluationResult
}

/**
 * Run fixed-point constraint propagation over accepted/rejected operators.
 * Fills unknown (null) variable values based on operator semantics.
 * Never overwrites user-assigned values (true/false).
 */
export function propagateOperatorConstraints(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment
): TCoreVariableAssignment {
    // TODO: will be moved from ArgumentEngine in Task 2
    throw new Error("Not implemented")
}

/**
 * Evaluates an argument under a three-valued expression assignment.
 */
export function evaluateArgument(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCoreArgumentEvaluationOptions
): TCoreArgumentEvaluationResult {
    // TODO: will be moved from ArgumentEngine in Task 3
    throw new Error("Not implemented")
}

/**
 * Enumerates all 2^n variable assignments and checks for counterexamples.
 */
export function checkArgumentValidity(
    ctx: TArgumentEvaluationContext,
    options?: TCoreValidityCheckOptions
): TCoreValidityCheckResult {
    // TODO: will be moved from ArgumentEngine in Task 4
    throw new Error("Not implemented")
}
```

Add exports to `src/lib/index.ts`:

```typescript
export {
    evaluateArgument,
    checkArgumentValidity,
    propagateOperatorConstraints,
} from "./core/evaluation/argument-evaluation.js"
export type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "./core/evaluation/argument-evaluation.js"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "evaluateArgument (standalone)"`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/evaluation/argument-evaluation.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add argument evaluation module with type stubs"
```

---

### Task 2: Move propagateOperatorConstraints

**Files:**

- Modify: `src/lib/core/evaluation/argument-evaluation.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts` inside the `evaluateArgument (standalone)` describe:

```typescript
it("propagateOperatorConstraints fills unknown variables from accepted operators", () => {
    const { propagateOperatorConstraints } =
        await import("../src/lib/core/evaluation/argument-evaluation.js")

    // Build a simple engine: P ∧ Q with the AND operator accepted
    const engine = new ArgumentEngine(
        { id: "arg1", version: 1 },
        EMPTY_CLAIM_LOOKUP,
        EMPTY_SOURCE_LOOKUP,
        EMPTY_CLAIM_SOURCE_LOOKUP
    )
    const { result: premise } = engine.createPremise()
    const { result: varP } = engine.addVariable({
        id: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
        symbol: "P",
        claimId: "c1",
        claimVersion: 1,
    })
    const { result: varQ } = engine.addVariable({
        id: "vq",
        argumentId: "arg1",
        argumentVersion: 1,
        symbol: "Q",
        claimId: "c2",
        claimVersion: 1,
    })
    // Build expression: P AND Q
    premise.appendExpression(null, {
        id: "e-and",
        type: "operator",
        operator: "and",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    premise.appendExpression("e-and", {
        id: "e-p",
        type: "variable",
        variableId: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    premise.appendExpression("e-and", {
        id: "e-q",
        type: "variable",
        variableId: "vq",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    engine.setConclusionPremise(premise.getId())

    // Accept the AND operator — should propagate P=true, Q=true
    const ctx = {
        argumentId: "arg1",
        conclusionPremiseId: premise.getId(),
        getConclusionPremise: () => premise,
        listSupportingPremises: () => [],
        listPremises: () => engine.listPremises(),
        getVariable: (id: string) => engine.getVariable(id),
        validateEvaluability: () => engine.validateEvaluability(),
    }

    const result = propagateOperatorConstraints(ctx, {
        variables: {},
        operatorAssignments: { "e-and": "accepted" },
    })
    expect(result["vp"]).toBe(true)
    expect(result["vq"]).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "propagateOperatorConstraints fills"`
Expected: FAIL — "Not implemented"

- [ ] **Step 3: Move the implementation**

Copy the body of `ArgumentEngine.propagateOperatorConstraints()` (lines 2204-2531 of argument-engine.ts) into the standalone `propagateOperatorConstraints()` function in `argument-evaluation.ts`.

Key changes during the move:

- Replace `this.listPremises()` with `ctx.listPremises()`
- Replace `pm.getExpressions()` and `pm.getChildExpressions()` — these are already on the `TEvaluablePremise` interface
- The inner helper functions (`resolveValue`, `resolveLeafVariableId`, `trySetChild`) stay as closures inside the function — no changes needed beyond the `this` references

In `argument-engine.ts`, replace the `propagateOperatorConstraints` method body with a delegation:

```typescript
private propagateOperatorConstraints(
    assignment: TCoreExpressionAssignment
): TCoreVariableAssignment {
    return propagateOperatorConstraints(this.asEvaluationContext(), assignment)
}
```

Add a private helper method to ArgumentEngine that builds the context:

```typescript
private asEvaluationContext(): TArgumentEvaluationContext {
    return {
        argumentId: this.argument.id,
        conclusionPremiseId: this.conclusionPremiseId,
        getConclusionPremise: () => this.getConclusionPremise() as TEvaluablePremise | undefined,
        listSupportingPremises: () => this.listSupportingPremises() as TEvaluablePremise[],
        listPremises: () => this.listPremises() as TEvaluablePremise[],
        getVariable: (id) => this.variables.getVariable(id) as TCorePropositionalVariable | undefined,
        validateEvaluability: () => this.validateEvaluability(),
    }
}
```

Add the import at the top of argument-engine.ts:

```typescript
import {
    propagateOperatorConstraints as propagateOperatorConstraintsStandalone,
    evaluateArgument as evaluateArgumentStandalone,
    checkArgumentValidity as checkArgumentValidityStandalone,
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "./evaluation/argument-evaluation.js"
```

Use the aliased import in the delegation to avoid name collision with the private method:

```typescript
private propagateOperatorConstraints(
    assignment: TCoreExpressionAssignment
): TCoreVariableAssignment {
    return propagateOperatorConstraintsStandalone(this.asEvaluationContext(), assignment)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "propagateOperatorConstraints fills"`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm vitest run`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/evaluation/argument-evaluation.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "refactor: extract propagateOperatorConstraints to standalone function"
```

---

### Task 3: Move evaluate

**Files:**

- Modify: `src/lib/core/evaluation/argument-evaluation.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `evaluateArgument (standalone)` describe block:

```typescript
it("evaluateArgument returns evaluation result via context", () => {
    const { evaluateArgument } =
        await import("../src/lib/core/evaluation/argument-evaluation.js")

    // Build: P → Q (conclusion), with P=true, Q=false → counterexample
    const engine = new ArgumentEngine(
        { id: "arg1", version: 1 },
        EMPTY_CLAIM_LOOKUP,
        EMPTY_SOURCE_LOOKUP,
        EMPTY_CLAIM_SOURCE_LOOKUP
    )
    const { result: premise } = engine.createPremise()
    engine.addVariable({
        id: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
        symbol: "P",
        claimId: "c1",
        claimVersion: 1,
    })
    engine.addVariable({
        id: "vq",
        argumentId: "arg1",
        argumentVersion: 1,
        symbol: "Q",
        claimId: "c2",
        claimVersion: 1,
    })
    premise.appendExpression(null, {
        id: "e-imp",
        type: "operator",
        operator: "implies",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    premise.appendExpression("e-imp", {
        id: "e-p",
        type: "variable",
        variableId: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    premise.appendExpression("e-imp", {
        id: "e-q",
        type: "variable",
        variableId: "vq",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    engine.setConclusionPremise(premise.getId())

    const ctx = {
        argumentId: "arg1",
        conclusionPremiseId: premise.getId(),
        getConclusionPremise: () => premise,
        listSupportingPremises: () => [],
        listPremises: () => engine.listPremises(),
        getVariable: (id: string) => engine.getVariable(id),
        validateEvaluability: () => engine.validateEvaluability(),
    }

    const result = evaluateArgument(ctx, {
        variables: { vp: true, vq: false },
        operatorAssignments: {},
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
        expect(result.conclusionTrue).toBe(false)
        expect(result.isCounterexample).toBe(true)
    }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "evaluateArgument returns evaluation"`
Expected: FAIL — "Not implemented"

- [ ] **Step 3: Move the implementation**

Copy the body of `ArgumentEngine.evaluate()` (lines 2533-2727) into the standalone `evaluateArgument()`.

Key changes:

- Replace `this.validateEvaluability()` with `ctx.validateEvaluability()`
- Replace `this.getConclusionPremise()` with `ctx.getConclusionPremise()`
- Replace `this.listSupportingPremises()` with `ctx.listSupportingPremises()`
- Replace `this.listPremises()` with `ctx.listPremises()`
- Replace `this.conclusionPremiseId` with `ctx.conclusionPremiseId`
- Replace `this.variables.getVariable(variableId)` with `ctx.getVariable(variableId)`
- Replace `this.argument.id` with `ctx.argumentId`
- Replace `this.propagateOperatorConstraints(assignment)` with `propagateOperatorConstraints(ctx, assignment)`

In `argument-engine.ts`, replace `evaluate()` body:

```typescript
public evaluate(
    assignment: TCoreExpressionAssignment,
    options?: TCoreArgumentEvaluationOptions
): TCoreArgumentEvaluationResult {
    return evaluateArgumentStandalone(this.asEvaluationContext(), assignment, options)
}
```

- [ ] **Step 4: Run test and full suite**

Run: `pnpm vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/evaluation/argument-evaluation.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "refactor: extract evaluate to standalone evaluateArgument function"
```

---

### Task 4: Move checkValidity

**Files:**

- Modify: `src/lib/core/evaluation/argument-evaluation.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `evaluateArgument (standalone)` describe block:

```typescript
it("checkArgumentValidity detects valid argument via context", () => {
    const { checkArgumentValidity } =
        await import("../src/lib/core/evaluation/argument-evaluation.js")

    // Build: P → P (tautology, always valid)
    const engine = new ArgumentEngine(
        { id: "arg1", version: 1 },
        EMPTY_CLAIM_LOOKUP,
        EMPTY_SOURCE_LOOKUP,
        EMPTY_CLAIM_SOURCE_LOOKUP
    )
    const { result: premise } = engine.createPremise()
    engine.addVariable({
        id: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
        symbol: "P",
        claimId: "c1",
        claimVersion: 1,
    })
    premise.appendExpression(null, {
        id: "e-imp",
        type: "operator",
        operator: "implies",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    premise.appendExpression("e-imp", {
        id: "e-p1",
        type: "variable",
        variableId: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    premise.appendExpression("e-imp", {
        id: "e-p2",
        type: "variable",
        variableId: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
    })
    engine.setConclusionPremise(premise.getId())

    const ctx = {
        argumentId: "arg1",
        conclusionPremiseId: premise.getId(),
        getConclusionPremise: () => premise,
        listSupportingPremises: () => [],
        listPremises: () => engine.listPremises(),
        getVariable: (id: string) => engine.getVariable(id),
        validateEvaluability: () => engine.validateEvaluability(),
    }

    const result = checkArgumentValidity(ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
        expect(result.isValid).toBe(true)
        expect(result.counterexamples).toHaveLength(0)
    }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "checkArgumentValidity detects valid"`
Expected: FAIL — "Not implemented"

- [ ] **Step 3: Move the implementation**

Copy the body of `ArgumentEngine.checkValidity()` (lines 2729-2891) into `checkArgumentValidity()`.

Key changes:

- Same `this` → `ctx` replacements as Task 3
- Replace `this.evaluate(assignment, ...)` with `evaluateArgument(ctx, assignment, ...)`

In `argument-engine.ts`, replace `checkValidity()` body:

```typescript
public checkValidity(
    options?: TCoreValidityCheckOptions
): TCoreValidityCheckResult {
    return checkArgumentValidityStandalone(this.asEvaluationContext(), options)
}
```

Now remove the original `propagateOperatorConstraints` private method entirely from argument-engine.ts (the delegation helper is no longer needed since `evaluate` also delegates now). The `asEvaluationContext()` helper remains.

- [ ] **Step 4: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build)

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/evaluation/argument-evaluation.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "refactor: extract checkValidity to standalone checkArgumentValidity function"
```

---

### Task 5: Clean up imports and verify reduction

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Remove unused imports from argument-engine.ts**

After extracting all three functions, the following imports in argument-engine.ts are likely no longer used directly (they're used by the standalone module instead):

- `kleeneAnd`, `kleeneNot`, `kleeneOr`, `kleeneImplies`, `kleeneIff` — check if `evaluate` was the only consumer
- `makeErrorIssue`, `makeValidationResult` — check if only used by evaluate/checkValidity

Run typecheck to identify unused imports. Remove any that the compiler flags.

- [ ] **Step 2: Verify line count reduction**

Run: `wc -l src/lib/core/argument-engine.ts`
Expected: ~2200 lines (down from ~2915, a reduction of ~700 lines)

Run: `wc -l src/lib/core/evaluation/argument-evaluation.ts`
Expected: ~400-450 lines

- [ ] **Step 3: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "chore: clean up unused imports after evaluation extraction"
```
