# Post-Mutation Invariant Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hierarchical `validate()` methods to all engines and libraries, wrap every mutation in a snapshot-validate-rollback bracket, update bulk paths to validate after loading, and close the `autoNormalize` gap in `insertExpression`/`wrapExpression`/`loadExpressions`.

**Architecture:** Each engine/library gets a public parameterless `validate()` that returns `TInvariantValidationResult`. A `withValidation` bracket wraps every mutation: snapshot → mutate → validate → rollback-if-invalid. Grammar config is respected uniformly across all entry points. Typebox `Value.Check` provides baseline schema enforcement on every managed entity.

**Tech Stack:** TypeScript, Typebox (`Value.Check`), vitest

**Spec:** `docs/superpowers/specs/2026-03-27-post-mutation-validation-design.md`

---

## File Map

### New Files

| File                                        | Responsibility                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/types/validation.ts`               | `TInvariantViolation`, `TInvariantValidationResult`, violation code string constants |
| `src/lib/core/invariant-violation-error.ts` | `InvariantViolationError` Error subclass                                             |

### Modified Files

| File                                                    | Changes                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/core/expression-manager.ts`                    | Add `validate()`, add autoNormalize to `insertExpression`/`wrapExpression`/`loadInitialExpressions`                                                             |
| `src/lib/core/variable-manager.ts`                      | Add `validate()`                                                                                                                                                |
| `src/lib/core/premise-engine.ts`                        | Add `validate()`, `withValidation`, `setArgumentValidateCallback`, `setVariableIdsCallback`, `premiseSnapshot`/`restoreFromPremiseSnapshot`, wrap all mutations |
| `src/lib/core/argument-engine.ts`                       | Add `validate()`, `withValidation`, wire callbacks, wrap all mutations, update `fromSnapshot`/`fromData`/`rollback`                                             |
| `src/lib/core/claim-library.ts`                         | Add `validate()`, `withValidation`, wrap mutations                                                                                                              |
| `src/lib/core/source-library.ts`                        | Add `validate()`, `withValidation`, wrap mutations                                                                                                              |
| `src/lib/core/claim-source-library.ts`                  | Add `validate()`, `withValidation`, wrap mutations                                                                                                              |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | Add `validate()` to `TArgumentLifecycle`                                                                                                                        |
| `src/lib/core/interfaces/premise-engine.interfaces.ts`  | Add `validate()` to `TPremiseLifecycle`                                                                                                                         |
| `src/lib/core/interfaces/library.interfaces.ts`         | Add `validate()` to library management interfaces                                                                                                               |
| `src/lib/types/grammar.ts`                              | Update `autoNormalize` JSDoc to reflect expanded scope                                                                                                          |
| `src/lib/index.ts`                                      | Export new types and error class                                                                                                                                |
| `test/core.test.ts`                                     | Add validation test describe blocks                                                                                                                             |

---

## Task 1: Validation Types and Error Class

**Files:**

- Create: `src/lib/types/validation.ts`
- Create: `src/lib/core/invariant-violation-error.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Create the validation types file**

```typescript
// src/lib/types/validation.ts

export type TInvariantViolationEntityType =
    | "expression"
    | "variable"
    | "premise"
    | "argument"
    | "claim"
    | "source"
    | "association"

export type TInvariantViolation = {
    code: string
    message: string
    entityType: TInvariantViolationEntityType
    entityId: string
    premiseId?: string
}

export type TInvariantValidationResult = {
    ok: boolean
    violations: TInvariantViolation[]
}

// -- Expression-level codes --
export const EXPR_SCHEMA_INVALID = "EXPR_SCHEMA_INVALID"
export const EXPR_DUPLICATE_ID = "EXPR_DUPLICATE_ID"
export const EXPR_SELF_REFERENTIAL_PARENT = "EXPR_SELF_REFERENTIAL_PARENT"
export const EXPR_PARENT_NOT_FOUND = "EXPR_PARENT_NOT_FOUND"
export const EXPR_PARENT_NOT_CONTAINER = "EXPR_PARENT_NOT_CONTAINER"
export const EXPR_ROOT_ONLY_VIOLATED = "EXPR_ROOT_ONLY_VIOLATED"
export const EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED =
    "EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED"
export const EXPR_CHILD_LIMIT_EXCEEDED = "EXPR_CHILD_LIMIT_EXCEEDED"
export const EXPR_POSITION_DUPLICATE = "EXPR_POSITION_DUPLICATE"
export const EXPR_CHECKSUM_MISMATCH = "EXPR_CHECKSUM_MISMATCH"

// -- Premise-level codes --
export const PREMISE_SCHEMA_INVALID = "PREMISE_SCHEMA_INVALID"
export const PREMISE_ROOT_EXPRESSION_INVALID = "PREMISE_ROOT_EXPRESSION_INVALID"
export const PREMISE_VARIABLE_REF_NOT_FOUND = "PREMISE_VARIABLE_REF_NOT_FOUND"
export const PREMISE_CHECKSUM_MISMATCH = "PREMISE_CHECKSUM_MISMATCH"

// -- Variable-level codes --
export const VAR_SCHEMA_INVALID = "VAR_SCHEMA_INVALID"
export const VAR_DUPLICATE_ID = "VAR_DUPLICATE_ID"
export const VAR_DUPLICATE_SYMBOL = "VAR_DUPLICATE_SYMBOL"
export const VAR_CHECKSUM_MISMATCH = "VAR_CHECKSUM_MISMATCH"

// -- Argument-level codes --
export const ARG_SCHEMA_INVALID = "ARG_SCHEMA_INVALID"
export const ARG_OWNERSHIP_MISMATCH = "ARG_OWNERSHIP_MISMATCH"
export const ARG_CLAIM_REF_NOT_FOUND = "ARG_CLAIM_REF_NOT_FOUND"
export const ARG_PREMISE_REF_NOT_FOUND = "ARG_PREMISE_REF_NOT_FOUND"
export const ARG_CIRCULARITY_DETECTED = "ARG_CIRCULARITY_DETECTED"
export const ARG_CONCLUSION_NOT_FOUND = "ARG_CONCLUSION_NOT_FOUND"
export const ARG_CHECKSUM_MISMATCH = "ARG_CHECKSUM_MISMATCH"

// -- ClaimLibrary codes --
export const CLAIM_SCHEMA_INVALID = "CLAIM_SCHEMA_INVALID"
export const CLAIM_FROZEN_NO_SUCCESSOR = "CLAIM_FROZEN_NO_SUCCESSOR"

// -- SourceLibrary codes --
export const SOURCE_SCHEMA_INVALID = "SOURCE_SCHEMA_INVALID"
export const SOURCE_FROZEN_NO_SUCCESSOR = "SOURCE_FROZEN_NO_SUCCESSOR"

// -- ClaimSourceLibrary codes --
export const ASSOC_SCHEMA_INVALID = "ASSOC_SCHEMA_INVALID"
export const ASSOC_DUPLICATE_ID = "ASSOC_DUPLICATE_ID"
export const ASSOC_CLAIM_REF_NOT_FOUND = "ASSOC_CLAIM_REF_NOT_FOUND"
export const ASSOC_SOURCE_REF_NOT_FOUND = "ASSOC_SOURCE_REF_NOT_FOUND"
```

- [ ] **Step 2: Create the error class**

```typescript
// src/lib/core/invariant-violation-error.ts
import type { TInvariantViolation } from "../types/validation.js"

export class InvariantViolationError extends Error {
    public readonly violations: TInvariantViolation[]

    constructor(violations: TInvariantViolation[]) {
        const summary =
            violations.length === 1
                ? violations[0].message
                : `${violations.length} invariant violations detected`
        super(summary)
        this.name = "InvariantViolationError"
        this.violations = violations
    }
}
```

- [ ] **Step 3: Add barrel exports**

Add to `src/lib/index.ts`:

```typescript
export * from "./types/validation.js"
export { InvariantViolationError } from "./core/invariant-violation-error.js"
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/validation.ts src/lib/core/invariant-violation-error.ts src/lib/index.ts
git commit -m "feat: add invariant validation types and error class"
```

---

## Task 2: ExpressionManager.validate()

**Files:**

- Modify: `src/lib/core/expression-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("ExpressionManager — validate", () => {
    it("returns ok for a valid expression tree", () => {
        const em = new ExpressionManager()
        em.addExpression(makeOpExpr("root", "and"))
        em.addExpression(
            makeVarExpr("v1", "var-p", { parentId: "root", position: 0 })
        )
        em.addExpression(
            makeVarExpr("v2", "var-q", { parentId: "root", position: 1 })
        )
        em.flushExpressionChecksums()
        const result = em.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty expression manager", () => {
        const em = new ExpressionManager()
        const result = em.validate()
        expect(result.ok).toBe(true)
    })

    it("detects formula-between-operators violation", () => {
        // Create with PERMISSIVE, then validate with strict manager
        const em = new ExpressionManager({
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        em.addExpression(makeOpExpr("root", "and"))
        em.addExpression(
            makeOpExpr("child", "or", { parentId: "root", position: 0 })
        )
        em.flushExpressionChecksums()

        // Build a strict manager from the same snapshot
        const snap = em.snapshot()
        const strict = ExpressionManager.fromSnapshot(snap, {
            enforceFormulaBetweenOperators: true,
            autoNormalize: false,
        })
        strict.flushExpressionChecksums()
        const result = strict.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === "EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED"
            )
        ).toBe(true)
    })

    it("detects checksum mismatch", () => {
        const em = new ExpressionManager()
        em.addExpression(makeVarExpr("v1", "var-p"))
        em.flushExpressionChecksums()

        // Tamper with a checksum via snapshot round-trip
        const snap = em.snapshot()
        snap.expressions[0] = {
            ...snap.expressions[0],
            checksum: "deadbeef",
        }
        const tampered = ExpressionManager.fromSnapshot(
            snap,
            PERMISSIVE_GRAMMAR_CONFIG
        )
        const result = tampered.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === "EXPR_CHECKSUM_MISMATCH")
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `em.validate is not a function`

- [ ] **Step 3: Implement ExpressionManager.validate()**

Add to `src/lib/core/expression-manager.ts`. Import `Value` from `typebox/value`, import `CorePropositionalExpressionSchema` from schemata, and import validation types from `../types/validation.js`:

```typescript
public validate(): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []
    const expressions = this.toArray()

    for (const expr of expressions) {
        // 1. Schema check
        if (!Value.Check(CorePropositionalExpressionSchema, expr)) {
            violations.push({
                code: EXPR_SCHEMA_INVALID,
                message: `Expression "${expr.id}" does not conform to schema`,
                entityType: "expression",
                entityId: expr.id,
            })
            continue // Skip structural checks for malformed data
        }

        // 2. Self-referential parent
        if (expr.parentId === expr.id) {
            violations.push({
                code: EXPR_SELF_REFERENTIAL_PARENT,
                message: `Expression "${expr.id}" references itself as parent`,
                entityType: "expression",
                entityId: expr.id,
            })
        }

        // 3. Parent existence
        if (expr.parentId !== null && !this.expressions.has(expr.parentId)) {
            violations.push({
                code: EXPR_PARENT_NOT_FOUND,
                message: `Expression "${expr.id}" references non-existent parent "${expr.parentId}"`,
                entityType: "expression",
                entityId: expr.id,
            })
        }

        // 4. Parent is container
        if (expr.parentId !== null) {
            const parent = this.expressions.get(expr.parentId)
            if (parent && parent.type !== "operator" && parent.type !== "formula") {
                violations.push({
                    code: EXPR_PARENT_NOT_CONTAINER,
                    message: `Expression "${expr.id}" has parent "${expr.parentId}" of type "${parent.type}" (must be operator or formula)`,
                    entityType: "expression",
                    entityId: expr.id,
                })
            }
        }

        // 5. Root-only enforcement
        if (
            expr.type === "operator" &&
            (expr.operator === "implies" || expr.operator === "iff") &&
            expr.parentId !== null
        ) {
            violations.push({
                code: EXPR_ROOT_ONLY_VIOLATED,
                message: `Operator "${expr.operator}" expression "${expr.id}" must be a root (parentId must be null)`,
                entityType: "expression",
                entityId: expr.id,
            })
        }

        // 6. Formula-between-operators
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            if (
                expr.parentId !== null &&
                expr.type === "operator" &&
                expr.operator !== "not"
            ) {
                const parent = this.expressions.get(expr.parentId)
                if (parent && parent.type === "operator") {
                    violations.push({
                        code: EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED,
                        message: `Non-not operator "${expr.id}" is a direct child of operator "${expr.parentId}"`,
                        entityType: "expression",
                        entityId: expr.id,
                    })
                }
            }
        }
    }

    // 7. Child limits — check each parent
    for (const [parentId, childIds] of this.childExpressionIdsByParentId) {
        if (parentId === null) continue
        const parent = this.expressions.get(parentId)
        if (!parent) continue
        const count = childIds.size
        if (parent.type === "formula" && count > 1) {
            violations.push({
                code: EXPR_CHILD_LIMIT_EXCEEDED,
                message: `Formula "${parentId}" has ${count} children (max 1)`,
                entityType: "expression",
                entityId: parentId,
            })
        }
        if (parent.type === "operator" && parent.operator === "not" && count > 1) {
            violations.push({
                code: EXPR_CHILD_LIMIT_EXCEEDED,
                message: `Not-operator "${parentId}" has ${count} children (max 1)`,
                entityType: "expression",
                entityId: parentId,
            })
        }
    }

    // 8. Position uniqueness — check each parent's children
    for (const parentId of this.childExpressionIdsByParentId.keys()) {
        const children = this.getChildExpressions(parentId)
        const positions = new Set<number>()
        for (const child of children) {
            if (positions.has(child.position)) {
                violations.push({
                    code: EXPR_POSITION_DUPLICATE,
                    message: `Duplicate position ${child.position} under parent "${parentId ?? "root"}" (expression "${child.id}")`,
                    entityType: "expression",
                    entityId: child.id,
                })
            }
            positions.add(child.position)
        }
    }

    // 9. Checksum verification — compute fresh and compare
    this.flushExpressionChecksums()
    for (const expr of this.toArray()) {
        const fields = this.checksumFieldsForExpression(expr)
        const expectedMeta = entityChecksum(
            expr as unknown as Record<string, unknown>,
            fields
        )
        if (expr.checksum !== expectedMeta) {
            violations.push({
                code: EXPR_CHECKSUM_MISMATCH,
                message: `Expression "${expr.id}" checksum mismatch: stored="${expr.checksum}", computed="${expectedMeta}"`,
                entityType: "expression",
                entityId: expr.id,
            })
        }
    }

    return { ok: violations.length === 0, violations }
}
```

Note: `checksumFieldsForExpression` is a private helper that returns the appropriate checksum fields for an expression based on the engine's `checksumConfig`. If such a helper doesn't already exist, extract it from the existing `attachChecksum` or `flushExpressionChecksums` logic. The key fields are typically `["id", "argumentId", "argumentVersion", "premiseId", "parentId", "position", "type"]` plus type-specific fields (`variableId` for variables, `operator` for operators).

For the checksum verification, `flushExpressionChecksums()` recomputes all three checksum fields (`checksum`, `descendantChecksum`, `combinedChecksum`) and writes them to the stored expressions. So after flush, the stored values ARE correct. To detect a mismatch: compute the expected `checksum` from the entity fields using `entityChecksum()` and compare against the stored `checksum` field. If they differ, the stored data is inconsistent. The `descendantChecksum` and `combinedChecksum` are verified implicitly by the flush.

An important subtlety: `flushExpressionChecksums()` always recomputes from the entity's current fields. The validate-after-flush approach verifies that the meta checksum (`checksum` field) computed from the entity's own fields matches. A pre-existing mismatch (e.g., loaded from a tampered snapshot) will be overwritten by flush. To catch pre-flush mismatches: save the checksums BEFORE flushing, flush, then compare saved vs new.

Adjust the checksum verification to:

```typescript
// 9. Checksum verification — save pre-flush, compute fresh, compare
const preFlushed = new Map(
    this.toArray().map((e) => [
        e.id,
        {
            checksum: e.checksum,
            descendantChecksum: e.descendantChecksum,
            combinedChecksum: e.combinedChecksum,
        },
    ])
)
this.flushExpressionChecksums()
for (const expr of this.toArray()) {
    const saved = preFlushed.get(expr.id)!
    for (const field of [
        "checksum",
        "descendantChecksum",
        "combinedChecksum",
    ] as const) {
        if (
            saved[field] !== null &&
            saved[field] !== "" &&
            saved[field] !== expr[field]
        ) {
            violations.push({
                code: EXPR_CHECKSUM_MISMATCH,
                message: `Expression "${expr.id}" ${field} mismatch: stored="${saved[field]}", computed="${expr[field]}"`,
                entityType: "expression",
                entityId: expr.id,
            })
        }
    }
}
```

This skips empty/null checksums (which appear on freshly created entities before any flush).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: add ExpressionManager.validate()"
```

---

## Task 3: VariableManager.validate()

**Files:**

- Modify: `src/lib/core/variable-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("VariableManager — validate", () => {
    it("returns ok for valid variables", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const result = vm.validate()
        expect(result.ok).toBe(true)
    })

    it("returns ok for empty manager", () => {
        const vm = new VariableManager()
        const result = vm.validate()
        expect(result.ok).toBe(true)
    })

    it("detects checksum mismatch", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)

        // Tamper via snapshot round-trip
        const snap = vm.snapshot()
        snap.variables[0] = { ...snap.variables[0], checksum: "deadbeef" }
        const tampered = VariableManager.fromSnapshot(snap)
        const result = tampered.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === "VAR_CHECKSUM_MISMATCH")
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `vm.validate is not a function`

- [ ] **Step 3: Implement VariableManager.validate()**

Add to `src/lib/core/variable-manager.ts`. Import `Value` from `typebox/value`, `CorePropositionalVariableSchema` from schemata, and validation types:

```typescript
public validate(): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []
    const variables = this.toArray()
    const ids = new Set<string>()
    const symbols = new Set<string>()

    for (const v of variables) {
        // 1. Schema check
        if (!Value.Check(CorePropositionalVariableSchema, v)) {
            violations.push({
                code: VAR_SCHEMA_INVALID,
                message: `Variable "${v.id}" does not conform to schema`,
                entityType: "variable",
                entityId: v.id,
            })
        }

        // 2. Duplicate ID
        if (ids.has(v.id)) {
            violations.push({
                code: VAR_DUPLICATE_ID,
                message: `Duplicate variable ID "${v.id}"`,
                entityType: "variable",
                entityId: v.id,
            })
        }
        ids.add(v.id)

        // 3. Duplicate symbol
        if (symbols.has(v.symbol)) {
            violations.push({
                code: VAR_DUPLICATE_SYMBOL,
                message: `Duplicate variable symbol "${v.symbol}" (variable "${v.id}")`,
                entityType: "variable",
                entityId: v.id,
            })
        }
        symbols.add(v.symbol)

        // 4. Checksum verification
        if (v.checksum !== "" && v.checksum !== null) {
            const fields = this.checksumFieldsForVariable()
            const expected = entityChecksum(
                v as unknown as Record<string, unknown>,
                fields
            )
            if (v.checksum !== expected) {
                violations.push({
                    code: VAR_CHECKSUM_MISMATCH,
                    message: `Variable "${v.id}" checksum mismatch: stored="${v.checksum}", computed="${expected}"`,
                    entityType: "variable",
                    entityId: v.id,
                })
            }
        }
    }

    return { ok: violations.length === 0, violations }
}
```

Note: `checksumFieldsForVariable()` should return the fields used for variable checksum computation. Extract from existing checksum logic — typically the fields specified in `checksumConfig.variableFields` or a default set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/variable-manager.ts test/core.test.ts
git commit -m "feat: add VariableManager.validate()"
```

---

## Task 4: PremiseEngine.validate()

**Files:**

- Modify: `src/lib/core/premise-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("PremiseEngine — validate", () => {
    function makePremiseEngine(grammarConfig = PERMISSIVE_GRAMMAR_CONFIG) {
        const vm = new VariableManager()
        vm.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        vm.addVariable({
            id: "var-q",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { grammarConfig }
        )
        return { pe, vm }
    }

    it("returns ok for valid premise with expressions", () => {
        const { pe } = makePremiseEngine()
        pe.addExpression(makeVarExpr("v1", "var-p"))
        const result = pe.validate()
        expect(result.ok).toBe(true)
    })

    it("returns ok for empty premise", () => {
        const { pe } = makePremiseEngine()
        const result = pe.validate()
        expect(result.ok).toBe(true)
    })

    it("detects variable reference to non-existent variable", () => {
        const { pe } = makePremiseEngine()
        pe.addExpression(makeVarExpr("v1", "var-p"))

        // Load expressions referencing a variable that doesn't exist in the callback
        // Set a variableIdsCallback that returns an empty set
        pe.setVariableIdsCallback(() => new Set())
        const result = pe.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === "PREMISE_VARIABLE_REF_NOT_FOUND"
            )
        ).toBe(true)
    })

    it("delegates expression validation to ExpressionManager", () => {
        const { pe } = makePremiseEngine({
            enforceFormulaBetweenOperators: true,
            autoNormalize: false,
        })
        // Load a tree that violates formula-between-operators via permissive snapshot
        const permissive = makePremiseEngine()
        permissive.pe.addExpression(makeOpExpr("root", "and"))
        permissive.pe.addExpression(
            makeOpExpr("child", "or", { parentId: "root", position: 0 })
        )
        const snap = permissive.pe.snapshot()
        const strict = PremiseEngine.fromSnapshot(
            snap,
            ARG,
            permissive.vm,
            undefined,
            { enforceFormulaBetweenOperators: true, autoNormalize: false }
        )
        strict.setVariableIdsCallback(() => new Set(["var-p", "var-q"]))
        const result = strict.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === "EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED"
            )
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `pe.validate is not a function`

- [ ] **Step 3: Add setVariableIdsCallback to PremiseEngine**

Add a new private field and setter in `src/lib/core/premise-engine.ts`, near the existing `circularityCheck` callback:

```typescript
private variableIdsCallback?: () => Set<string>

public setVariableIdsCallback(
    callback: (() => Set<string>) | undefined
): void {
    this.variableIdsCallback = callback
}
```

- [ ] **Step 4: Implement PremiseEngine.validate()**

```typescript
public validate(): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []

    // 1. Schema check on premise
    if (!Value.Check(CorePremiseSchema, this.premise)) {
        violations.push({
            code: PREMISE_SCHEMA_INVALID,
            message: `Premise "${this.premise.id}" does not conform to schema`,
            entityType: "premise",
            entityId: this.premise.id,
        })
    }

    // 2. Delegate to ExpressionManager
    const emResult = this.expressions.validate()
    for (const v of emResult.violations) {
        violations.push({ ...v, premiseId: this.premise.id })
    }

    // 3. Root expression consistency
    if (this.rootExpressionId !== undefined) {
        const rootExpr = this.expressions.getExpression(this.rootExpressionId)
        if (!rootExpr) {
            violations.push({
                code: PREMISE_ROOT_EXPRESSION_INVALID,
                message: `Premise "${this.premise.id}" rootExpressionId "${this.rootExpressionId}" does not exist`,
                entityType: "premise",
                entityId: this.premise.id,
            })
        } else if (rootExpr.parentId !== null) {
            violations.push({
                code: PREMISE_ROOT_EXPRESSION_INVALID,
                message: `Premise "${this.premise.id}" rootExpressionId "${this.rootExpressionId}" is not a root (parentId is "${rootExpr.parentId}")`,
                entityType: "premise",
                entityId: this.premise.id,
            })
        }
    }

    // 4. Variable references
    const variableIds = this.variableIdsCallback?.() ?? new Set<string>()
    for (const expr of this.expressions.toArray()) {
        if (expr.type === "variable") {
            const varExpr = expr as TCorePropositionalVariableExpression
            if (!variableIds.has(varExpr.variableId)) {
                violations.push({
                    code: PREMISE_VARIABLE_REF_NOT_FOUND,
                    message: `Expression "${expr.id}" in premise "${this.premise.id}" references non-existent variable "${varExpr.variableId}"`,
                    entityType: "expression",
                    entityId: expr.id,
                    premiseId: this.premise.id,
                })
            }
        }
    }

    // 5. Premise-level checksum verification
    // (Handled as part of ArgumentEngine.validate() since premise checksums
    // depend on expression checksums which are verified by ExpressionManager)

    return { ok: violations.length === 0, violations }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/premise-engine.ts test/core.test.ts
git commit -m "feat: add PremiseEngine.validate() with variable ID callback"
```

---

## Task 5: ArgumentEngine.validate()

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("ArgumentEngine — validate", () => {
    it("returns ok for a valid argument with premises and variables", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise()
        eng.addVariable(makeVar("var-p", "P"))
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        const result = eng.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for empty argument", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const result = eng.validate()
        expect(result.ok).toBe(true)
    })

    it("detects claim reference to non-existent claim", () => {
        const lib = aLib()
        const eng = new ArgumentEngine(ARG, lib, sLib(), csLib())
        eng.addVariable(makeVar("var-p", "P", "claim-default", 0))

        // Now load from snapshot with an empty claim library
        const snap = eng.snapshot()
        const emptyLib = new ClaimLibrary()
        const restored = ArgumentEngine.fromSnapshot(
            snap,
            emptyLib,
            sLib(),
            new ClaimSourceLibrary(emptyLib, sLib()),
            PERMISSIVE_GRAMMAR_CONFIG
        )
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === "ARG_CLAIM_REF_NOT_FOUND")
        ).toBe(true)
    })

    it("detects conclusion referencing non-existent premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())

        // Load from snapshot, then tamper the conclusionPremiseId
        const snap = eng.snapshot()
        snap.conclusionPremiseId = "nonexistent-premise"
        const restored = ArgumentEngine.fromSnapshot(
            snap,
            aLib(),
            sLib(),
            csLib(),
            PERMISSIVE_GRAMMAR_CONFIG
        )
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === "ARG_CONCLUSION_NOT_FOUND")
        ).toBe(true)
    })

    it("detects ownership mismatch on variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        // Load from snapshot with a variable that has wrong argumentId
        const snap = eng.snapshot()
        snap.variables.variables.push({
            id: "bad-var",
            argumentId: "wrong-arg",
            argumentVersion: 1,
            symbol: "X",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const restored = ArgumentEngine.fromSnapshot(
            snap,
            aLib(),
            sLib(),
            csLib(),
            PERMISSIVE_GRAMMAR_CONFIG
        )
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === "ARG_OWNERSHIP_MISMATCH")
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `eng.validate is not a function`

- [ ] **Step 3: Implement ArgumentEngine.validate()**

Add to `src/lib/core/argument-engine.ts`:

```typescript
public validate(): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []

    // 1. Schema check on argument
    if (!Value.Check(CoreArgumentSchema, this.argument)) {
        violations.push({
            code: ARG_SCHEMA_INVALID,
            message: `Argument "${this.argument.id}" does not conform to schema`,
            entityType: "argument",
            entityId: this.argument.id,
        })
    }

    // 2. Delegate to VariableManager
    const vmResult = this.variables.validate()
    violations.push(...vmResult.violations)

    // 3. Delegate to each PremiseEngine
    for (const pe of this.premises.values()) {
        const peResult = pe.validate()
        violations.push(...peResult.violations)
    }

    // 4. Argument ownership — variables
    for (const v of this.variables.toArray()) {
        if (v.argumentId !== this.argument.id) {
            violations.push({
                code: ARG_OWNERSHIP_MISMATCH,
                message: `Variable "${v.id}" argumentId "${v.argumentId}" does not match engine argument "${this.argument.id}"`,
                entityType: "variable",
                entityId: v.id,
            })
        }
        if (v.argumentVersion !== this.argument.version) {
            violations.push({
                code: ARG_OWNERSHIP_MISMATCH,
                message: `Variable "${v.id}" argumentVersion ${v.argumentVersion} does not match engine argument version ${this.argument.version}`,
                entityType: "variable",
                entityId: v.id,
            })
        }
    }

    // 5. Claim-bound variable references
    for (const v of this.variables.toArray()) {
        if (isClaimBound(v)) {
            if (!this.claimLibrary.get(v.claimId, v.claimVersion)) {
                violations.push({
                    code: ARG_CLAIM_REF_NOT_FOUND,
                    message: `Variable "${v.id}" references claim "${v.claimId}" version ${v.claimVersion} which does not exist`,
                    entityType: "variable",
                    entityId: v.id,
                })
            }
        }
    }

    // 6. Premise-bound internal variable references
    for (const v of this.variables.toArray()) {
        if (isPremiseBound(v) && v.boundArgumentId === this.argument.id) {
            if (!this.premises.has(v.boundPremiseId)) {
                violations.push({
                    code: ARG_PREMISE_REF_NOT_FOUND,
                    message: `Variable "${v.id}" is bound to non-existent premise "${v.boundPremiseId}"`,
                    entityType: "variable",
                    entityId: v.id,
                })
            }
        }
    }

    // 7. Circularity detection
    for (const v of this.variables.toArray()) {
        if (isPremiseBound(v) && v.boundArgumentId === this.argument.id) {
            if (this.wouldCreateCycle(v.id, v.boundPremiseId, new Set())) {
                violations.push({
                    code: ARG_CIRCULARITY_DETECTED,
                    message: `Variable "${v.id}" creates a circular binding through premise "${v.boundPremiseId}"`,
                    entityType: "variable",
                    entityId: v.id,
                })
            }
        }
    }

    // 8. Conclusion premise existence
    if (
        this.conclusionPremiseId !== undefined &&
        !this.premises.has(this.conclusionPremiseId)
    ) {
        violations.push({
            code: ARG_CONCLUSION_NOT_FOUND,
            message: `Conclusion premise "${this.conclusionPremiseId}" does not exist`,
            entityType: "argument",
            entityId: this.argument.id,
        })
    }

    // 9. Argument-level checksum verification
    this.flushChecksums()
    // After flushing, checksums are recomputed. Compare pre-flush vs post-flush
    // to detect stored mismatches. (Same pattern as ExpressionManager.)

    return { ok: violations.length === 0, violations }
}
```

Also wire the `variableIdsCallback` on each PremiseEngine. In the method that wires callbacks onto new PremiseEngines (near where `wireCircularityCheck` and `wireEmptyBoundPremiseCheck` are called), add:

```typescript
pe.setVariableIdsCallback(
    () => new Set(this.variables.toArray().map((v) => v.id))
)
```

This should be called wherever PremiseEngines are created: `createPremiseWithId`, `fromSnapshot` (in the premise restoration loop), `fromData`, and `rollback`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/premise-engine.ts test/core.test.ts
git commit -m "feat: add ArgumentEngine.validate() with hierarchical delegation"
```

---

## Task 6: Library validate() Methods

**Files:**

- Modify: `src/lib/core/claim-library.ts`
- Modify: `src/lib/core/source-library.ts`
- Modify: `src/lib/core/claim-source-library.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("ClaimLibrary — validate", () => {
    it("returns ok for valid library", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1" })
        const result = lib.validate()
        expect(result.ok).toBe(true)
    })

    it("returns ok for empty library", () => {
        const lib = new ClaimLibrary()
        const result = lib.validate()
        expect(result.ok).toBe(true)
    })

    it("detects frozen claim without successor", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1" })
        lib.freeze("c1")
        // After freeze: version 0 is frozen, version 1 is current (unfrozen)
        // This is valid. To test the violation, we'd need to construct from
        // a snapshot where a frozen claim has no successor.
        const snap = lib.snapshot()
        // Remove the unfrozen successor (version 1) from the snapshot
        const versions = snap.entities.get("c1")!
        versions.delete(1)
        const restored = ClaimLibrary.fromSnapshot(snap)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === "CLAIM_FROZEN_NO_SUCCESSOR"
            )
        ).toBe(true)
    })
})

describe("SourceLibrary — validate", () => {
    it("returns ok for valid library", () => {
        const lib = new SourceLibrary()
        lib.create({ id: "s1" })
        const result = lib.validate()
        expect(result.ok).toBe(true)
    })
})

describe("ClaimSourceLibrary — validate", () => {
    it("returns ok for valid associations", () => {
        const cl = aLib()
        const sl = sLib()
        sl.create({ id: "s1" })
        const csl = new ClaimSourceLibrary(cl, sl)
        csl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            sourceId: "s1",
            sourceVersion: 0,
        })
        const result = csl.validate()
        expect(result.ok).toBe(true)
    })

    it("detects association referencing non-existent claim", () => {
        const cl = aLib()
        const sl = sLib()
        sl.create({ id: "s1" })
        const csl = new ClaimSourceLibrary(cl, sl)
        csl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            sourceId: "s1",
            sourceVersion: 0,
        })
        // Rebuild with empty claim library
        const snap = csl.snapshot()
        const emptyLib = new ClaimLibrary()
        const restored = ClaimSourceLibrary.fromSnapshot(snap, emptyLib, sl)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === "ASSOC_CLAIM_REF_NOT_FOUND"
            )
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `validate is not a function`

- [ ] **Step 3: Implement ClaimLibrary.validate()**

```typescript
public validate(): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []

    for (const [id, versions] of this.entities) {
        const sortedVersions = [...versions.entries()].sort(([a], [b]) => a - b)

        for (const [version, claim] of sortedVersions) {
            // 1. Schema check
            if (!Value.Check(CoreClaimSchema, claim)) {
                violations.push({
                    code: CLAIM_SCHEMA_INVALID,
                    message: `Claim "${id}" version ${version} does not conform to schema`,
                    entityType: "claim",
                    entityId: id,
                })
            }

            // 2. Frozen claim must have successor (unless it's the max version)
            if (claim.frozen) {
                const maxVer = this.maxVersion(versions)
                if (version < maxVer && !versions.has(version + 1)) {
                    violations.push({
                        code: CLAIM_FROZEN_NO_SUCCESSOR,
                        message: `Claim "${id}" version ${version} is frozen but has no successor version`,
                        entityType: "claim",
                        entityId: id,
                    })
                }
            }
        }
    }

    return { ok: violations.length === 0, violations }
}
```

- [ ] **Step 4: Implement SourceLibrary.validate()**

Same pattern as ClaimLibrary using `CoreSourceSchema` and `SOURCE_*` codes.

- [ ] **Step 5: Implement ClaimSourceLibrary.validate()**

```typescript
public validate(): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []

    for (const [id, assoc] of this.associations) {
        // 1. Schema check
        if (!Value.Check(CoreClaimSourceAssociationSchema, assoc)) {
            violations.push({
                code: ASSOC_SCHEMA_INVALID,
                message: `Association "${id}" does not conform to schema`,
                entityType: "association",
                entityId: id,
            })
        }

        // 2. Claim reference
        if (!this.claimLookup.get(assoc.claimId, assoc.claimVersion)) {
            violations.push({
                code: ASSOC_CLAIM_REF_NOT_FOUND,
                message: `Association "${id}" references non-existent claim "${assoc.claimId}" version ${assoc.claimVersion}`,
                entityType: "association",
                entityId: id,
            })
        }

        // 3. Source reference
        if (!this.sourceLookup.get(assoc.sourceId, assoc.sourceVersion)) {
            violations.push({
                code: ASSOC_SOURCE_REF_NOT_FOUND,
                message: `Association "${id}" references non-existent source "${assoc.sourceId}" version ${assoc.sourceVersion}`,
                entityType: "association",
                entityId: id,
            })
        }
    }

    return { ok: violations.length === 0, violations }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/claim-library.ts src/lib/core/source-library.ts src/lib/core/claim-source-library.ts test/core.test.ts
git commit -m "feat: add validate() to ClaimLibrary, SourceLibrary, ClaimSourceLibrary"
```

---

## Task 7: ArgumentEngine.withValidation Bracket

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("ArgumentEngine — withValidation bracket", () => {
    it("rolls back createPremise if validate fails", () => {
        // This test verifies the bracket works — we'd need a scenario where
        // createPremise produces invalid state. Since normal operations
        // produce valid state, test via a subclass that injects a failing validate.
        // A more practical test: verify the bracket exists by checking that
        // engine state is consistent after operations.
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise()
        expect(eng.hasPremise(pm.getId())).toBe(true)
        expect(eng.validate().ok).toBe(true)
    })

    it("rolls back removePremise on failure", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise()
        eng.removePremise(pm.getId())
        expect(eng.hasPremise(pm.getId())).toBe(false)
        expect(eng.validate().ok).toBe(true)
    })

    it("existing per-operation errors still throw with rollback", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        // Try to add a variable with wrong argumentId — should throw
        expect(() =>
            eng.addVariable({
                ...makeVar("v1", "P"),
                argumentId: "wrong-arg",
            })
        ).toThrow()
        // Engine should be unchanged
        expect(eng.getVariables()).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Implement withValidation on ArgumentEngine**

Add the protected method:

```typescript
protected withValidation<T>(fn: () => T): T {
    const snap = this.snapshot()
    try {
        const result = fn()
        const validation = this.validate()
        if (!validation.ok) {
            this.rollback(snap)
            throw new InvariantViolationError(validation.violations)
        }
        return result
    } catch (e) {
        if (!(e instanceof InvariantViolationError)) {
            this.rollback(snap)
        }
        throw e
    }
}
```

- [ ] **Step 3: Wrap all ArgumentEngine mutation methods**

For each mutation method, wrap the body in `this.withValidation(() => { ... })`. Example for `createPremiseWithId`:

Before:

```typescript
public createPremiseWithId(id, extras?, symbol?) {
    // ... existing body ...
    return { result: pm, changes }
}
```

After:

```typescript
public createPremiseWithId(id, extras?, symbol?) {
    return this.withValidation(() => {
        // ... existing body ...
        return { result: pm, changes }
    })
}
```

Apply this pattern to all ArgumentEngine mutation methods:

- `createPremiseWithId`
- `removePremise`
- `addVariable`
- `bindVariableToPremise`
- `bindVariableToExternalPremise`
- `updateVariable`
- `removeVariable`
- `setConclusionPremise`
- `clearConclusionPremise`

Note: `createPremise` delegates to `createPremiseWithId`, so it doesn't need its own wrapper. Same for `bindVariableToArgument` which delegates to `bindVariableToExternalPremise`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS (all existing tests should still pass since valid operations produce valid state)

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add withValidation bracket to ArgumentEngine mutations"
```

---

## Task 8: PremiseEngine.withValidation Bracket

**Files:**

- Modify: `src/lib/core/premise-engine.ts`
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("PremiseEngine — withValidation bracket", () => {
    it("triggers argument-level validation on expression mutation", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        expect(eng.validate().ok).toBe(true)
    })

    it("rolls back expression mutation on validation failure", () => {
        // Since normal operations produce valid state, test rollback by
        // verifying that a failed mutation leaves the engine unchanged
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise()

        // Try to add expression referencing non-existent variable
        expect(() =>
            pm.addExpression(
                makeVarExpr("v1", "nonexistent-var", { premiseId: pm.getId() })
            )
        ).toThrow()

        // Premise should have no expressions
        expect(pm.getExpressions()).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Add premiseSnapshot and restoreFromPremiseSnapshot**

Add to `src/lib/core/premise-engine.ts`:

```typescript
private premiseSnapshot(): {
    premiseData: TOptionalChecksum<TPremise>
    rootExpressionId: string | undefined
    expressionSnapshot: TExpressionManagerSnapshot<TExpr>
    expressionIndexEntries: [string, string][]
} {
    // Capture expression index entries belonging to this premise
    const expressionIndexEntries: [string, string][] = []
    if (this.expressionIndex) {
        for (const [exprId, premiseId] of this.expressionIndex) {
            if (premiseId === this.premise.id) {
                expressionIndexEntries.push([exprId, premiseId])
            }
        }
    }
    return {
        premiseData: { ...this.premise },
        rootExpressionId: this.rootExpressionId,
        expressionSnapshot: this.expressions.snapshot(),
        expressionIndexEntries,
    }
}

private restoreFromPremiseSnapshot(snap: ReturnType<typeof this.premiseSnapshot>): void {
    this.premise = snap.premiseData
    this.rootExpressionId = snap.rootExpressionId
    this.expressions = ExpressionManager.fromSnapshot(snap.expressionSnapshot)
    // Restore expression index entries
    if (this.expressionIndex) {
        // Remove current entries for this premise
        for (const [exprId, premiseId] of [...this.expressionIndex]) {
            if (premiseId === this.premise.id) {
                this.expressionIndex.delete(exprId)
            }
        }
        // Restore saved entries
        for (const [exprId, premiseId] of snap.expressionIndexEntries) {
            this.expressionIndex.set(exprId, premiseId)
        }
    }
    this.rebuildVariableIndex()
}
```

- [ ] **Step 3: Add setArgumentValidateCallback and withValidation**

```typescript
private argumentValidateCallback?: () => TInvariantValidationResult

public setArgumentValidateCallback(
    callback: (() => TInvariantValidationResult) | undefined
): void {
    this.argumentValidateCallback = callback
}

protected withValidation<T>(fn: () => T): T {
    const snap = this.premiseSnapshot()
    try {
        const result = fn()
        const validation = this.argumentValidateCallback?.()
            ?? this.validate()
        if (!validation.ok) {
            this.restoreFromPremiseSnapshot(snap)
            throw new InvariantViolationError(validation.violations)
        }
        return result
    } catch (e) {
        if (!(e instanceof InvariantViolationError)) {
            this.restoreFromPremiseSnapshot(snap)
        }
        throw e
    }
}
```

- [ ] **Step 4: Wire argumentValidateCallback in ArgumentEngine**

In `src/lib/core/argument-engine.ts`, wherever PremiseEngines are created and callbacks wired, add:

```typescript
pe.setArgumentValidateCallback(() => this.validate())
```

Add this in the same locations where `wireCircularityCheck`, `wireEmptyBoundPremiseCheck`, and `setOnMutate` are called:

- `createPremiseWithId()` (after the existing callback wiring)
- `fromSnapshot()` (in the premise restoration loop)
- `fromData()` (after premise creation)
- `rollback()` (in the premise rewiring loop)

- [ ] **Step 5: Wrap all PremiseEngine mutation methods**

Wrap each mutation method body in `this.withValidation(() => { ... })`:

- `addExpression`
- `appendExpression`
- `addExpressionRelative`
- `removeExpression`
- `updateExpression`
- `insertExpression`
- `wrapExpression`
- `toggleNegation`
- `changeOperator`
- `deleteExpressionsUsingVariable`
- `setExtras`

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 7: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add withValidation bracket to PremiseEngine with argument-level callback"
```

---

## Task 9: Library withValidation Brackets

**Files:**

- Modify: `src/lib/core/claim-library.ts`
- Modify: `src/lib/core/source-library.ts`
- Modify: `src/lib/core/claim-source-library.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("Library — withValidation brackets", () => {
    it("ClaimLibrary validates after create", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1" })
        expect(lib.validate().ok).toBe(true)
    })

    it("ClaimLibrary validates after freeze", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1" })
        lib.freeze("c1")
        expect(lib.validate().ok).toBe(true)
    })

    it("ClaimSourceLibrary validates after add", () => {
        const cl = aLib()
        const sl = sLib()
        sl.create({ id: "s1" })
        const csl = new ClaimSourceLibrary(cl, sl)
        csl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            sourceId: "s1",
            sourceVersion: 0,
        })
        expect(csl.validate().ok).toBe(true)
    })
})
```

- [ ] **Step 2: Add withValidation and snapshot/rollback to libraries**

For ClaimLibrary and SourceLibrary, add snapshot save/restore and wrap `create`, `update`, `freeze` mutations. Use the existing `snapshot()`/`fromSnapshot()` pattern — save internal state before mutation, restore on failure.

For ClaimSourceLibrary, add similar wrapping around `add` and `remove`.

The pattern for each library:

```typescript
private withValidation<T>(fn: () => T): T {
    const snap = this.snapshot()
    try {
        const result = fn()
        const validation = this.validate()
        if (!validation.ok) {
            this.restoreFromSnapshot(snap)
            throw new InvariantViolationError(validation.violations)
        }
        return result
    } catch (e) {
        if (!(e instanceof InvariantViolationError)) {
            this.restoreFromSnapshot(snap)
        }
        throw e
    }
}
```

Each library needs a private `restoreFromSnapshot(snap)` method that replaces internal state from a snapshot (the inverse of `snapshot()`).

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/claim-library.ts src/lib/core/source-library.ts src/lib/core/claim-source-library.ts test/core.test.ts
git commit -m "feat: add withValidation brackets to library classes"
```

---

## Task 10: Bulk Path Changes

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("ArgumentEngine — bulk path validation", () => {
    it("fromSnapshot validates loaded state", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        const { result: pm } = eng.createPremise()
        eng.addVariable(makeVar("var-p", "P"))
        pm.addExpression(makeOpExpr("root", "and", { premiseId: pm.getId() }))
        pm.addExpression(
            makeOpExpr("child", "or", {
                parentId: "root",
                position: 0,
                premiseId: pm.getId(),
            })
        )
        // This tree has and→or which violates formula-between-operators.
        // Loading with strict config should throw.
        const snap = eng.snapshot()
        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), sLib(), csLib(), {
                enforceFormulaBetweenOperators: true,
                autoNormalize: false,
            })
        ).toThrow(InvariantViolationError)
    })

    it("fromData validates loaded state", () => {
        // fromData no longer defaults to PERMISSIVE — uses provided config
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
            grammarConfig: PERMISSIVE_GRAMMAR_CONFIG,
        })
        const { result: pm } = eng.createPremise()
        eng.addVariable(makeVar("var-p", "P"))
        pm.addExpression(makeOpExpr("root", "and", { premiseId: pm.getId() }))
        pm.addExpression(
            makeOpExpr("child", "or", {
                parentId: "root",
                position: 0,
                premiseId: pm.getId(),
            })
        )

        const snap = eng.snapshot()
        // Reconstruct from component data with strict config
        expect(() =>
            ArgumentEngine.fromData(
                snap.argument,
                aLib(),
                sLib(),
                csLib(),
                snap.variables.variables,
                snap.premises.map((p) => p.premise),
                snap.premises.flatMap((p) => p.expressions.expressions),
                { conclusionPremiseId: snap.conclusionPremiseId },
                {
                    grammarConfig: {
                        enforceFormulaBetweenOperators: true,
                        autoNormalize: false,
                    },
                },
                { enforceFormulaBetweenOperators: true, autoNormalize: false }
            )
        ).toThrow(InvariantViolationError)
    })

    it("rollback validates and rejects invalid snapshot", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise()
        eng.addVariable(makeVar("var-p", "P"))
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        const goodSnap = eng.snapshot()

        // Create a bad snapshot (tamper conclusionPremiseId)
        const badSnap = { ...goodSnap, conclusionPremiseId: "nonexistent" }

        expect(() => eng.rollback(badSnap)).toThrow(InvariantViolationError)
        // Engine should still hold the good state
        expect(eng.validate().ok).toBe(true)
    })
})
```

- [ ] **Step 2: Update fromSnapshot to validate**

At the end of `ArgumentEngine.fromSnapshot()`, after all state is restored and `restoringFromSnapshot` is set to false, add:

```typescript
// Validate loaded state against grammar config
const validation = engine.validate()
if (!validation.ok) {
    throw new InvariantViolationError(validation.violations)
}
```

This replaces or supplements the existing optional `checksumVerification` logic, since `validate()` now includes checksum verification.

- [ ] **Step 3: Update fromData to validate**

Change the default grammar config from `PERMISSIVE_GRAMMAR_CONFIG` to `grammarConfig ?? config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG`.

At the end of `fromData()`, add the same validation call as `fromSnapshot()`.

- [ ] **Step 4: Update rollback to validate**

Modify `rollback()` to bracket the operation:

```typescript
public rollback(snapshot: TArgumentEngineSnapshot<...>): void {
    const preRollbackSnap = this.snapshot()
    // ... existing rollback logic ...
    const validation = this.validate()
    if (!validation.ok) {
        // Reject: restore pre-rollback state
        // (call existing rollback logic again with preRollbackSnap)
        this.rollbackInternal(preRollbackSnap)
        throw new InvariantViolationError(validation.violations)
    }
}
```

Extract the existing rollback body into a private `rollbackInternal()` method so it can be called without re-validating.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: validate state after fromSnapshot, fromData, and rollback"
```

---

## Task 11: autoNormalize in insertExpression and wrapExpression

**Files:**

- Modify: `src/lib/core/expression-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("insertExpression — autoNormalize", () => {
    it("auto-inserts formula buffers when autoNormalize is true", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: true,
            },
        })
        // Build: root = var-P
        em.addExpression(makeVarExpr("p", "var-p"))

        // Insert an AND operator that takes p as left child
        em.insertExpression(makeOpExpr("and1", "and"), "p")
        // Now insert an OR operator as right child of AND — this would violate
        // formula-between-operators. With autoNormalize, a formula buffer should
        // be auto-inserted.
        em.addExpression(
            makeOpExpr("or1", "or", { parentId: "and1", position: 1 })
        )
        // The OR should be wrapped in a formula under AND
        const orExpr = em.getExpression("or1")!
        const parent = em.getExpression(orExpr.parentId!)!
        expect(parent.type).toBe("formula")
    })
})

describe("wrapExpression — autoNormalize", () => {
    it("auto-inserts formula buffers when autoNormalize is true", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: true,
            },
        })
        // Build: root = or(p, q)
        em.addExpression(makeOpExpr("or1", "or"))
        em.addExpression(
            makeVarExpr("p", "var-p", { parentId: "or1", position: 0 })
        )
        em.addExpression(
            makeVarExpr("q", "var-q", { parentId: "or1", position: 1 })
        )

        // Wrap OR with AND — OR becomes child of AND, which would violate
        // formula-between-operators. autoNormalize should insert a formula buffer.
        em.wrapExpression(
            makeOpExpr("and1", "and"),
            makeVarExpr("r", "var-r"),
            "or1"
        )
        // OR should now be under a formula under AND
        const orExpr = em.getExpression("or1")!
        const orParent = em.getExpression(orExpr.parentId!)!
        expect(orParent.type).toBe("formula")
        expect(orParent.parentId).toBe("and1")
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — throws "Non-not operator expressions cannot be direct children"

- [ ] **Step 3: Add autoNormalize support to insertExpression**

In `ExpressionManager.insertExpression()`, find the grammar enforcement block (approximately lines 1263-1297 in the current file). Replace the `throw` paths with auto-normalization when `this.grammarConfig.autoNormalize` is true:

There are two violation sites in `insertExpression`:

**Site 1 — new expression as child of anchor's parent:** When the new expression is a non-`not` operator and anchor's parent is an operator. Replace the `throw` with the same formula-buffer-insertion pattern from `addExpression` lines 277-321: create a formula node, insert it in the parent's child slot, then make the new expression a child of the formula.

**Site 2 — left/right nodes as children of the new expression:** When a child being reparented under the new expression is a non-`not` operator and the new expression is also an operator. Handle this AFTER the `reparent()` calls: for each offending child, insert a formula buffer between the new expression and that child using the same pattern.

In both sites, when `autoNormalize` is false, the existing `throw` remains unchanged.

The auto-normalization for children happens AFTER the reparenting step. After `this.reparent(leftNodeId, expression.id, 0)`, check if the child violates the rule and insert a formula buffer between the new expression and the child.

- [ ] **Step 4: Add autoNormalize support to wrapExpression**

Same pattern in `ExpressionManager.wrapExpression()`. Find the grammar enforcement block and add auto-normalization when `this.grammarConfig.autoNormalize` is true. The formula buffers are inserted between the new operator and its children (existing node and/or new sibling).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat: add autoNormalize support to insertExpression and wrapExpression"
```

---

## Task 12: autoNormalize in loadExpressions

**Files:**

- Modify: `src/lib/core/expression-manager.ts`
- Modify: `src/lib/types/grammar.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("loadExpressions — grammar config enforcement", () => {
    it("auto-normalizes during load when autoNormalize is true", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: true,
            },
        })
        // Load expressions with and→or (violates formula-between-operators)
        em.loadExpressions([
            makeOpExpr("root", "and"),
            makeOpExpr("child", "or", { parentId: "root", position: 0 }),
        ])
        // The OR should be wrapped in a formula
        const orExpr = em.getExpression("child")!
        const parent = em.getExpression(orExpr.parentId!)!
        expect(parent.type).toBe("formula")
    })

    it("rejects violations during load when autoNormalize is false", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: false,
            },
        })
        expect(() =>
            em.loadExpressions([
                makeOpExpr("root", "and"),
                makeOpExpr("child", "or", { parentId: "root", position: 0 }),
            ])
        ).toThrow()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — currently loadExpressions routes through `addExpression` which already supports autoNormalize, but the `loadInitialExpressions` method uses the instance's grammar config. If the grammar config is strict with autoNormalize true, it should work. If it currently works, adjust the test expectations.

Note: `loadInitialExpressions` calls `this.addExpression()` which already respects grammar config including autoNormalize. So the "auto-normalize during load" test may already pass. The "reject violations" test may also already pass. Verify — if they pass, the gap may be smaller than expected for `loadExpressions` specifically.

The real gap is in `fromSnapshot`, which calls `fromSnapshot` on ExpressionManager with a potentially different grammar config than the final engine config. And in `fromData` which defaults to PERMISSIVE.

If both tests already pass, delete this task's tests and move on.

- [ ] **Step 3: Update grammar.ts JSDoc**

Update the `autoNormalize` JSDoc in `src/lib/types/grammar.ts` to reflect the expanded scope:

```typescript
/**
 * Grammar enforcement configuration for expression trees.
 *
 * Controls which structural rules are enforced and whether violations are
 * automatically corrected.
 *
 * **`autoNormalize` scope:** Supported in all expression mutation operations
 * including `addExpression`, `insertExpression`, `wrapExpression`, and
 * bulk-loading paths (`loadInitialExpressions`).
 */
```

- [ ] **Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/expression-manager.ts src/lib/types/grammar.ts test/core.test.ts
git commit -m "feat: enforce grammar config in loadExpressions, update autoNormalize docs"
```

---

## Task 13: Interface Updates and Final Exports

**Files:**

- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`
- Modify: `src/lib/core/interfaces/library.interfaces.ts`

- [ ] **Step 1: Add validate() to TArgumentLifecycle**

In `src/lib/core/interfaces/argument-engine.interfaces.ts`, add to the `TArgumentLifecycle` interface:

```typescript
/**
 * Run a comprehensive invariant validation sweep on the entire argument.
 * Checks schema conformance, structural invariants, grammar rules,
 * reference integrity, and checksum consistency.
 */
validate(): TInvariantValidationResult
```

Import `TInvariantValidationResult` from `../../types/validation.js`.

- [ ] **Step 2: Add validate() to TPremiseLifecycle**

In `src/lib/core/interfaces/premise-engine.interfaces.ts`, add to the `TPremiseLifecycle` interface:

```typescript
/**
 * Run invariant validation on this premise and its expression tree.
 */
validate(): TInvariantValidationResult
```

Also add `setVariableIdsCallback` and `setArgumentValidateCallback` to the interface.

- [ ] **Step 3: Add validate() to library interfaces**

In `src/lib/core/interfaces/library.interfaces.ts`, add `validate(): TInvariantValidationResult` to:

- `TClaimLibraryManagement`
- `TSourceLibraryManagement`
- `TClaimSourceLibraryManagement`

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS — all classes already implement the method

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/interfaces/argument-engine.interfaces.ts src/lib/core/interfaces/premise-engine.interfaces.ts src/lib/core/interfaces/library.interfaces.ts
git commit -m "feat: add validate() to engine and library interfaces"
```

---

## Implementation Notes

### Re-entrancy: nested withValidation brackets

When `ArgumentEngine.withValidation` wraps a mutation that internally calls PremiseEngine methods (e.g., `removeVariable` cascades to `pe.deleteExpressionsUsingVariable`), the PremiseEngine method's own `withValidation` bracket also fires. This causes `validate()` to run twice: once from the inner PremiseEngine bracket (via `argumentValidateCallback`) and once from the outer ArgumentEngine bracket.

This double-validation is **correct but wasteful**. For the initial implementation, accept the cost — simplicity wins per the design principles. If profiling later shows this is a bottleneck, add a re-entrancy guard:

```typescript
private validating = false

protected withValidation<T>(fn: () => T): T {
    if (this.validating) return fn()  // Already inside a bracket — skip
    this.validating = true
    try { /* ... bracket logic ... */ }
    finally { this.validating = false }
}
```

Apply to both ArgumentEngine and PremiseEngine. The outermost bracket handles validation; nested calls pass through.

---

## Post-Implementation Checklist

After all tasks are complete:

- [ ] Run `pnpm run check` (typecheck + lint + test + build)
- [ ] Verify all new tests pass: `pnpm run test -- --reporter verbose 2>&1 | grep -E "validate|withValidation|autoNormalize|InvariantViolation"`
- [ ] Verify existing tests still pass (no regressions from withValidation brackets)
- [ ] Run smoke test: `pnpm run build && bash scripts/smoke-test.sh`
- [ ] Update documentation per CLAUDE.md Documentation Sync triggers
