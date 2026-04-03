# Extract Argument Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `validate()`, `validateAfterPremiseMutation()`, `validateEvaluability()`, and `collectReferencedVariables()` from `ArgumentEngine` into standalone functions in a new `src/lib/core/argument-validation.ts` module, reducing ArgumentEngine by ~360 lines.

**Architecture:** The four methods become standalone functions that accept the engine's state through a narrow read-only interface (`TArgumentValidationContext`). `ArgumentEngine` delegates to these functions. No public API changes — `validate()` and `validateEvaluability()` remain instance methods, and existing interfaces are unchanged. The standalone functions are additionally exported from `src/lib/index.ts` for direct use. `collectReferencedVariables` is already on the `TArgumentExpressionQueries` interface and remains there; it just moves implementation-wise.

**Tech Stack:** TypeScript, Vitest

**Dependency:** This plan should execute AFTER the evaluation extraction plan, since both modify argument-engine.ts. If run concurrently, merge conflicts will arise.

---

## File Structure

| File                                  | Action | Responsibility                                                                                                                           |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/core/argument-validation.ts` | Create | `validateArgument()`, `validateArgumentAfterPremiseMutation()`, `validateArgumentEvaluability()`, `collectArgumentReferencedVariables()` |
| `src/lib/core/argument-engine.ts`     | Modify | Delegate 4 methods to standalone functions                                                                                               |
| `src/lib/index.ts`                    | Modify | Re-export standalone functions                                                                                                           |
| `test/core.test.ts`                   | Modify | Add standalone function tests                                                                                                            |

---

### Task 1: Create the validation module with context type and stubs

**Files:**

- Create: `src/lib/core/argument-validation.ts`
- Modify: `src/lib/index.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `test/core.test.ts`:

```typescript
describe("validateArgument (standalone)", () => {
    it("is exported from the library", async () => {
        const mod = await import("../src/lib/index.js")
        expect(typeof mod.validateArgument).toBe("function")
        expect(typeof mod.validateArgumentEvaluability).toBe("function")
        expect(typeof mod.collectArgumentReferencedVariables).toBe("function")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "validateArgument (standalone)"`
Expected: FAIL — functions not exported

- [ ] **Step 3: Create the module**

Create `src/lib/core/argument-validation.ts`:

```typescript
import { Value } from "typebox/value"
import {
    CoreArgumentSchema,
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../schemata/index.js"
import type {
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../types/evaluation.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    ARG_SCHEMA_INVALID,
    ARG_OWNERSHIP_MISMATCH,
    ARG_CLAIM_REF_NOT_FOUND,
    ARG_PREMISE_REF_NOT_FOUND,
    ARG_CIRCULARITY_DETECTED,
    ARG_CONCLUSION_NOT_FOUND,
    ARG_CHECKSUM_MISMATCH,
} from "../types/validation.js"
import {
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"
import { getOrCreate, sortedUnique } from "../utils/collections.js"
import type { TClaimLookup } from "./interfaces/index.js"
import type { TCoreClaim } from "../schemata/index.js"

/**
 * Read-only interface providing the data validation needs from an
 * argument engine.
 */
export interface TArgumentValidationContext {
    /** The argument entity (with checksums attached). */
    getArgument(): TCoreArgument
    /** The argument ID. */
    argumentId: string
    /** The argument version. */
    argumentVersion: number
    /** The conclusion premise ID, if set. */
    conclusionPremiseId: string | undefined
    /** All variables as an array. */
    getVariables(): TCorePropositionalVariable[]
    /** All premises. */
    listPremises(): TValidatablePremise[]
    /** Check if a premise ID exists. */
    hasPremise(premiseId: string): boolean
    /** Look up a claim in the library. */
    lookupClaim(claimId: string, claimVersion: number): unknown | undefined
    /** Flush checksums and return the pre-flush values for stability check. */
    flushAndGetChecksumDeltas(): {
        savedMeta: string | undefined
        savedDescendant: string | null | undefined
        savedCombined: string | undefined
        currentMeta: string | undefined
        currentDescendant: string | null | undefined
        currentCombined: string | undefined
    }
    /** Delegate variable-manager-level validation. */
    validateVariables(): TInvariantValidationResult
    /** Test if a variable binding would create a cycle. */
    wouldCreateCycle(
        variableId: string,
        premiseId: string,
        visited: Set<string>
    ): boolean
}

/**
 * Narrow view of a PremiseEngine needed for validation.
 */
export interface TValidatablePremise {
    getId(): string
    validate(): TInvariantValidationResult
    validateEvaluability(): TCoreValidationResult
    getExpressions(): TCorePropositionalExpression[]
    getVariables(): TCorePropositionalVariable[]
}

/**
 * Comprehensive invariant validation of an argument engine.
 * Checks schema conformance, ownership, references, circularity,
 * conclusion, and checksum stability.
 */
export function validateArgument(
    ctx: TArgumentValidationContext
): TInvariantValidationResult {
    throw new Error("Not implemented")
}

/**
 * Lightweight validation after a premise mutation. Only checks
 * cross-references that a premise mutation could affect.
 */
export function validateArgumentAfterPremiseMutation(
    ctx: TArgumentValidationContext
): TInvariantValidationResult {
    throw new Error("Not implemented")
}

/**
 * Pre-evaluation structural validation: conclusion must be set,
 * variable ID/symbol mappings must be consistent, and every
 * premise must be individually evaluable.
 */
export function validateArgumentEvaluability(
    ctx: TArgumentValidationContext
): TCoreValidationResult {
    throw new Error("Not implemented")
}

/**
 * Collects all variables referenced by expressions across all
 * premises, indexed both by variable ID and by symbol.
 */
export function collectArgumentReferencedVariables(
    ctx: TArgumentValidationContext
): {
    variableIds: string[]
    byId: Record<string, { symbol: string; premiseIds: string[] }>
    bySymbol: Record<string, { variableIds: string[]; premiseIds: string[] }>
} {
    throw new Error("Not implemented")
}
```

Add exports to `src/lib/index.ts`:

```typescript
export {
    validateArgument,
    validateArgumentAfterPremiseMutation,
    validateArgumentEvaluability,
    collectArgumentReferencedVariables,
} from "./core/argument-validation.js"
export type {
    TArgumentValidationContext,
    TValidatablePremise,
} from "./core/argument-validation.js"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "validateArgument (standalone)"`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-validation.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add argument validation module with type stubs"
```

---

### Task 2: Move collectReferencedVariables

**Files:**

- Modify: `src/lib/core/argument-validation.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `validateArgument (standalone)` describe block:

```typescript
it("collectArgumentReferencedVariables indexes variables by ID and symbol", () => {
    const { collectArgumentReferencedVariables } =
        await import("../src/lib/core/argument-validation.js")

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
        id: "e-p",
        type: "variable",
        variableId: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
    })

    const ctx = {
        argumentId: "arg1",
        argumentVersion: 1,
        conclusionPremiseId: undefined,
        getArgument: () => engine.getArgument(),
        getVariables: () => engine.getVariables(),
        listPremises: () => engine.listPremises(),
        hasPremise: (id: string) => engine.hasPremise(id),
        lookupClaim: () => undefined,
        flushAndGetChecksumDeltas: () => ({
            savedMeta: undefined,
            savedDescendant: undefined,
            savedCombined: undefined,
            currentMeta: undefined,
            currentDescendant: undefined,
            currentCombined: undefined,
        }),
        validateVariables: () => ({ ok: true, violations: [] }),
        wouldCreateCycle: () => false,
    }

    const result = collectArgumentReferencedVariables(ctx)
    expect(result.variableIds).toContain("vp")
    expect(result.byId["vp"]).toBeDefined()
    expect(result.byId["vp"].symbol).toBe("P")
    expect(result.bySymbol["P"]).toBeDefined()
    expect(result.bySymbol["P"].variableIds).toContain("vp")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "collectArgumentReferencedVariables indexes"`
Expected: FAIL — "Not implemented"

- [ ] **Step 3: Move the implementation**

Copy the body of `ArgumentEngine.collectReferencedVariables()` (lines 1820-1896) into `collectArgumentReferencedVariables()`.

Key changes:

- Replace `this.listPremises()` with `ctx.listPremises()`
- The inner logic (building `byIdTmp`, `bySymbolTmp` maps) is identical

In `argument-engine.ts`, replace `collectReferencedVariables()` body:

```typescript
public collectReferencedVariables(): {
    variableIds: string[]
    byId: Record<string, { symbol: string; premiseIds: string[] }>
    bySymbol: Record<string, { variableIds: string[]; premiseIds: string[] }>
} {
    return collectArgumentReferencedVariablesStandalone(this.asValidationContext())
}
```

Add a private `asValidationContext()` helper to ArgumentEngine:

```typescript
private asValidationContext(): TArgumentValidationContext {
    return {
        argumentId: this.argument.id,
        argumentVersion: this.argument.version,
        conclusionPremiseId: this.conclusionPremiseId,
        getArgument: () => this.getArgument() as unknown as TCoreArgument,
        getVariables: () => this.variables.toArray() as unknown as TCorePropositionalVariable[],
        listPremises: () => this.listPremises() as unknown as TValidatablePremise[],
        hasPremise: (id) => this.premises.has(id),
        lookupClaim: (claimId, claimVersion) => this.claimLibrary.get(claimId, claimVersion),
        flushAndGetChecksumDeltas: () => {
            const savedMeta = this.cachedMetaChecksum
            const savedDescendant = this.cachedDescendantChecksum
            const savedCombined = this.cachedCombinedChecksum
            this.flushChecksums()
            return {
                savedMeta,
                savedDescendant,
                savedCombined,
                currentMeta: this.cachedMetaChecksum,
                currentDescendant: this.cachedDescendantChecksum,
                currentCombined: this.cachedCombinedChecksum,
            }
        },
        validateVariables: () => this.variables.validate(),
        wouldCreateCycle: (variableId, premiseId, visited) =>
            this.wouldCreateCycle(variableId, premiseId, visited),
    }
}
```

Add the import at the top of argument-engine.ts:

```typescript
import {
    validateArgument as validateArgumentStandalone,
    validateArgumentAfterPremiseMutation as validateAfterPremiseMutationStandalone,
    validateArgumentEvaluability as validateArgumentEvaluabilityStandalone,
    collectArgumentReferencedVariables as collectArgumentReferencedVariablesStandalone,
    type TArgumentValidationContext,
    type TValidatablePremise,
} from "./argument-validation.js"
```

- [ ] **Step 4: Run test and full suite**

Run: `pnpm vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-validation.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "refactor: extract collectReferencedVariables to standalone function"
```

---

### Task 3: Move validateAfterPremiseMutation

**Files:**

- Modify: `src/lib/core/argument-validation.ts`
- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Run full suite to establish baseline**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 2: Move the implementation**

Copy the body of `ArgumentEngine.validateAfterPremiseMutation()` (lines 1911-1951) into `validateArgumentAfterPremiseMutation()`.

Key changes:

- Replace `this.variables.toArray()` with `ctx.getVariables()`
- Replace `this.argument.id` with `ctx.argumentId`
- Replace `this.premises.has(...)` with `ctx.hasPremise(...)`
- Replace `this.conclusionPremiseId` with `ctx.conclusionPremiseId`

In `argument-engine.ts`, replace the method body:

```typescript
private validateAfterPremiseMutation(): TInvariantValidationResult {
    return validateAfterPremiseMutationStandalone(this.asValidationContext())
}
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS (all tests — this method is called internally after every premise mutation, so all existing mutation tests exercise it)

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/argument-validation.ts src/lib/core/argument-engine.ts
git commit -m "refactor: extract validateAfterPremiseMutation to standalone function"
```

---

### Task 4: Move validate

**Files:**

- Modify: `src/lib/core/argument-validation.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `validateArgument (standalone)` describe block:

```typescript
it("validateArgument detects ownership mismatch", () => {
    const { validateArgument } =
        await import("../src/lib/core/argument-validation.js")

    const engine = new ArgumentEngine(
        { id: "arg1", version: 1 },
        EMPTY_CLAIM_LOOKUP,
        EMPTY_SOURCE_LOOKUP,
        EMPTY_CLAIM_SOURCE_LOOKUP
    )
    // Add a variable with mismatched argumentVersion directly via the
    // validation context to test the standalone function
    engine.addVariable({
        id: "vp",
        argumentId: "arg1",
        argumentVersion: 1,
        symbol: "P",
        claimId: "c1",
        claimVersion: 1,
    })

    // The engine's own validate() should pass (variable matches)
    const baseline = engine.validate()
    expect(baseline.ok).toBe(true)

    // Now test standalone with a rigged context that reports wrong version
    const ctx = {
        argumentId: "arg1",
        argumentVersion: 1,
        conclusionPremiseId: undefined,
        getArgument: () => engine.getArgument(),
        getVariables: () => {
            const vars = engine.getVariables()
            // Rig one variable to have wrong version
            return vars.map((v) => ({ ...v, argumentVersion: 999 }))
        },
        listPremises: () => engine.listPremises(),
        hasPremise: (id: string) => engine.hasPremise(id),
        lookupClaim: () => ({ id: "c1", version: 1 }),
        flushAndGetChecksumDeltas: () => ({
            savedMeta: undefined,
            savedDescendant: undefined,
            savedCombined: undefined,
            currentMeta: undefined,
            currentDescendant: undefined,
            currentCombined: undefined,
        }),
        validateVariables: () => ({ ok: true, violations: [] }),
        wouldCreateCycle: () => false,
    }

    const result = validateArgument(ctx)
    expect(result.ok).toBe(false)
    expect(
        result.violations.some((v) => v.code === "ARG_OWNERSHIP_MISMATCH")
    ).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "validateArgument detects ownership"`
Expected: FAIL — "Not implemented"

- [ ] **Step 3: Move the implementation**

Copy the body of `ArgumentEngine.validate()` (lines 1953-2127) into `validateArgument()`.

Key changes:

- Replace checksum flush/compare with `ctx.flushAndGetChecksumDeltas()`
- Replace `this.getArgument()` with `ctx.getArgument()`
- Replace `this.variables.validate()` with `ctx.validateVariables()`
- Replace `this.listPremises()` with `ctx.listPremises()`
- Replace `this.variables.toArray()` with `ctx.getVariables()`
- Replace `this.argument.id`/`.version` with `ctx.argumentId`/`ctx.argumentVersion`
- Replace `this.claimLibrary.get(...)` with `ctx.lookupClaim(...)`
- Replace `this.premises.has(...)` with `ctx.hasPremise(...)`
- Replace `this.wouldCreateCycle(...)` with `ctx.wouldCreateCycle(...)`
- Replace `this.conclusionPremiseId` with `ctx.conclusionPremiseId`
- Replace `this.cachedMetaChecksum` etc. with the delta values from `flushAndGetChecksumDeltas()`

In `argument-engine.ts`, replace `validate()` body:

```typescript
public validate(): TInvariantValidationResult {
    return validateArgumentStandalone(this.asValidationContext())
}
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-validation.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "refactor: extract validate to standalone validateArgument function"
```

---

### Task 5: Move validateEvaluability

**Files:**

- Modify: `src/lib/core/argument-validation.ts`
- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Move the implementation**

Copy the body of `ArgumentEngine.validateEvaluability()` (lines 2129-2197) into `validateArgumentEvaluability()`.

Key changes:

- Replace `this.conclusionPremiseId` with `ctx.conclusionPremiseId`
- Replace `this.premises.has(...)` with `ctx.hasPremise(...)`
- Replace `this.listPremises()` with `ctx.listPremises()`

In `argument-engine.ts`, replace `validateEvaluability()` body:

```typescript
public validateEvaluability(): TCoreValidationResult {
    return validateArgumentEvaluabilityStandalone(this.asValidationContext())
}
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS (all tests — validateEvaluability is called by evaluate() and checkValidity(), so all evaluation tests exercise it)

- [ ] **Step 3: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/argument-validation.ts src/lib/core/argument-engine.ts
git commit -m "refactor: extract validateEvaluability to standalone function"
```

---

### Task 6: Clean up and verify reduction

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Remove unused imports from argument-engine.ts**

After extracting all four functions, check for imports that are now only used by the standalone module:

- `Value` from `typebox/value` — check if only `validate()` used it
- `CoreArgumentSchema` — same
- `ARG_SCHEMA_INVALID`, `ARG_OWNERSHIP_MISMATCH`, etc. — same
- `getOrCreate`, `sortedUnique` — check if only `collectReferencedVariables` and `validateEvaluability` used them

Run typecheck to identify unused imports. Remove any that the compiler flags.

- [ ] **Step 2: Verify line count reduction**

Run: `wc -l src/lib/core/argument-engine.ts`
Expected: ~1850 lines (down from ~2200 after evaluation extraction, or ~2915 from original)

Run: `wc -l src/lib/core/argument-validation.ts`
Expected: ~250-300 lines

Combined reduction from both plans: ~1050 lines removed from argument-engine.ts.

- [ ] **Step 3: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "chore: clean up unused imports after validation extraction"
```

---

### Task 7: Update the TArgumentEvaluation interface context

**Files:**

- Modify: `src/lib/core/evaluation/argument-evaluation.ts` (from evaluation plan)

After both plans are complete, update the evaluation module to use `TArgumentValidationContext.validateEvaluability` reference if the `TArgumentEvaluationContext.validateEvaluability` method signature matches. If both context types need the same `validateEvaluability` method, consider whether `TArgumentEvaluationContext` should extend or compose `TArgumentValidationContext` to avoid duplication.

- [ ] **Step 1: Check if the two context types share methods**

Compare `TArgumentEvaluationContext.validateEvaluability` with `TArgumentValidationContext`. If evaluation context needs validation, it can extend:

```typescript
export interface TArgumentEvaluationContext extends Pick<
    TArgumentValidationContext,
    "conclusionPremiseId" | "hasPremise"
> {
    // evaluation-specific methods...
}
```

Only do this if it reduces duplication without creating unnecessary coupling.

- [ ] **Step 2: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 3: Commit if changes were made**

```bash
git add src/lib/core/evaluation/argument-evaluation.ts src/lib/core/argument-validation.ts
git commit -m "refactor: align evaluation and validation context types"
```
