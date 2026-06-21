# Review-helper APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new public APIs so consumers building argument-review UIs don't have to re-implement traversal the core already knows how to do: `collectArgumentReferencedClaims`, `PremiseEngine.getDecidableOperatorExpressions`, `canonicalizeOperatorAssignments`, and an opt-in `propagatedVariableValues` field on `TCoreArgumentEvaluationResult`.

**Architecture:** Two new standalone helper functions live in `src/lib/core/review-helpers.ts` (parallel to `src/lib/core/argument-validation.ts`), three new error classes live in `src/lib/core/review-errors.ts` (parallel to `invariant-violation-error.ts`), one new method is added to `PremiseEngine` (declared on `TExpressionQueries`), and the evaluation result gains one new optional field sourced from `propagateOperatorConstraints` output. No schema, persistence, or validation changes.

**Tech Stack:** TypeScript, Typebox schemata, vitest. Strict mode. ESM with `.js` import specifiers.

---

## Spec Reference

Source: `docs/change-requests/2026-04-14-review-helpers.md`

## Deviations From Spec (deliberate)

Read these before writing code — they affect all downstream tasks.

1. **Field name `operator`, not `op`.** The spec uses `expr.op` in prose; the real schema field on `TCoreOperatorExpression` is `operator`. Use `operator` everywhere.
2. **Claim iteration must not miss constraint premises.** The spec says "any variable in any premise" and then prescribes ordering as "supporting → conclusion". That misses constraint premises. Resolution: walk supporting → conclusion → constraint (any premise that is neither), so no claim is ever dropped. Document this in the JSDoc AND surface it in the changelog so the server team knows constraint-only claims are included.
3. **`propagatedVariableValues` key set = `referencedVariableIds`.** The spec says "the map's key set equals the argument's variable id set", but the existing result already defines `referencedVariableIds` (claim-bound + externally-bound). Internally-bound premise variables have no independent truth value — they are resolved via the evaluator's lazy resolver against the bound premise's expression tree, and do NOT live in the post-propagation `TCoreVariableAssignment`. Emitting `null` for them would be misleading (their value depends on the bound premise evaluation, not on propagation). Document this in the JSDoc AND in the release notes so a server taking the spec literally (spec §4 test 4) is not surprised.
4. **`collectArgumentReferencedClaims` takes `TArgumentEvaluationContext`** (per the spec) — not `TArgumentValidationContext` like `collectArgumentReferencedVariables` does. `TArgumentEvaluationContext` already exposes `listPremises`, `listSupportingPremises`, `getConclusionPremise`, `getVariable`, and premises expose `getExpressions`, `getChildExpressions(parentId)`, and `getVariables`. That's sufficient.
5. **Same-claim-different-version detection runs across ALL premises** (not just supporting + conclusion) — it's a structural error regardless of which premises surface it.
6. **Tree order = pre-order DFS via `getChildExpressions`.** `PremiseEngine.getExpressions()` returns id-sorted storage order, NOT tree order. Tree-order walks must start at a root (found by scanning `getExpressions()` for `parentId === null`, since `TEvaluablePremise` does NOT expose `getRootExpressionId()`) and recurse via `premise.getChildExpressions(id)`. Do NOT re-implement sibling position sorting — `getChildExpressions` already returns children sorted by position.
7. **`getDecidableOperatorExpressions` is added to BOTH `TExpressionQueries` and `TEvaluablePremise`.** This lets standalone helpers (like `canonicalizeOperatorAssignments`) consume it via the narrow evaluation context without casts, while `PremiseEngine` directly implements it from `TExpressionQueries`. The method is thematically an "expression query", so this widening is principled, not review-specific.
8. **Non-operator expression overrides reuse `NotOperatorNotDecidableError` with a `reason` field.** The spec covers only two cases (unknown id, `"not"` operator). If an override targets a formula or variable expression that DOES exist, it's also not decidable — but it's not "unknown". Treating it as `UnknownExpressionError` would lie about the cause. Resolution: extend `NotOperatorNotDecidableError` to carry a `reason: "is-not-operator" | "not-an-operator-type"` discriminator so callers can distinguish. Document in JSDoc.

## File Structure

- **Create** `src/lib/core/review-helpers.ts` — `collectArgumentReferencedClaims`, `canonicalizeOperatorAssignments`
- **Create** `src/lib/core/review-errors.ts` — `InvalidArgumentStructureError`, `UnknownExpressionError`, `NotOperatorNotDecidableError`
- **Modify** `src/lib/core/interfaces/premise-engine.interfaces.ts` — add `getDecidableOperatorExpressions()` to `TExpressionQueries`
- **Modify** `src/lib/core/premise-engine.ts` — implement `getDecidableOperatorExpressions()`
- **Modify** `src/lib/types/evaluation.ts` — add `propagatedVariableValues?` to `TCoreArgumentEvaluationResult`
- **Modify** `src/lib/core/evaluation/argument-evaluation.ts` — populate the new field when `includeDiagnostics` is true
- **Modify** `src/lib/index.ts` — export new helpers, errors, and types
- **Modify** `test/core.test.ts` — append new describe blocks at the bottom (per project convention)
- **Modify** `docs/release-notes/upcoming.md`, `docs/changelogs/upcoming.md`
- **Modify** `docs/api-reference.md` — add public API entries
- **Modify** `CLAUDE.md` — document the spec rationale under "Key design rules" only if needed (new APIs expose existing semantics — no new invariants — so no rule additions needed)

---

### Task 1: Error classes

**Files:**

- Create: `src/lib/core/review-errors.ts`
- Test: `test/core.test.ts` (append a new describe block)

- [ ] **Step 1: Add static imports to `test/core.test.ts`**

Add to the existing import-from-`../src/lib/index` block (around line 17 of `test/core.test.ts` — the block that currently imports `ArgumentEngine`, `PremiseEngine`, etc.):

```typescript
    InvalidArgumentStructureError,
    UnknownExpressionError,
    NotOperatorNotDecidableError,
    collectArgumentReferencedClaims,
    canonicalizeOperatorAssignments,
```

These imports will dangle until subsequent tasks land their exports — that's OK because all tests in this plan are appended in the order they compile (error classes first). If Step 3 below runs before the other exports land, TypeScript will flag the other identifiers as unused until their tests arrive; that's expected within the same feature branch.

- [ ] **Step 2: Write the failing test**

Append this block at the bottom of `test/core.test.ts`:

```typescript
describe("review helper errors", () => {
    it("InvalidArgumentStructureError carries a message and name", () => {
        const err = new InvalidArgumentStructureError("bad structure")
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("InvalidArgumentStructureError")
        expect(err.message).toBe("bad structure")
    })

    it("UnknownExpressionError carries the bad id", () => {
        const err = new UnknownExpressionError("expr-xyz")
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("UnknownExpressionError")
        expect(err.expressionId).toBe("expr-xyz")
        expect(err.message).toContain("expr-xyz")
    })

    it("NotOperatorNotDecidableError on a NOT operator carries reason and id", () => {
        const err = new NotOperatorNotDecidableError(
            "expr-not",
            "is-not-operator"
        )
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("NotOperatorNotDecidableError")
        expect(err.expressionId).toBe("expr-not")
        expect(err.reason).toBe("is-not-operator")
        expect(err.message).toContain("expr-not")
    })

    it("NotOperatorNotDecidableError on a non-operator expression carries reason", () => {
        const err = new NotOperatorNotDecidableError(
            "expr-var",
            "not-an-operator-type"
        )
        expect(err.reason).toBe("not-an-operator-type")
        expect(err.message).toContain("expr-var")
    })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "review helper errors"`
Expected: FAIL — imports do not exist yet.

- [ ] **Step 4: Create `src/lib/core/review-errors.ts`**

```typescript
/**
 * Thrown when an argument's structural invariants (beyond what
 * `validateArgument` surfaces) preclude a review-helper operation —
 * for example, two variables binding to the same claim with different
 * versions.
 */
export class InvalidArgumentStructureError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "InvalidArgumentStructureError"
    }
}

/**
 * Thrown by `canonicalizeOperatorAssignments` when an expression override
 * references an expression id that does not exist in any premise of the
 * argument.
 */
export class UnknownExpressionError extends Error {
    public readonly expressionId: string

    constructor(expressionId: string) {
        super(`Unknown expression id: "${expressionId}".`)
        this.name = "UnknownExpressionError"
        this.expressionId = expressionId
    }
}

/**
 * Reason an expression cannot be voted on:
 * - `"is-not-operator"` — the expression is the `"not"` operator (flipped
 *   by render-time negation, not voted on).
 * - `"not-an-operator-type"` — the expression exists but is a variable or
 *   formula node; only operator expressions carry accept/reject state.
 */
export type TNotOperatorNotDecidableReason =
    | "is-not-operator"
    | "not-an-operator-type"

/**
 * Thrown by `canonicalizeOperatorAssignments` when an override targets an
 * expression that cannot carry an accept/reject assignment.
 */
export class NotOperatorNotDecidableError extends Error {
    public readonly expressionId: string
    public readonly reason: TNotOperatorNotDecidableReason

    constructor(expressionId: string, reason: TNotOperatorNotDecidableReason) {
        const why =
            reason === "is-not-operator"
                ? `is a "not" operator`
                : `is not an operator expression`
        super(`Expression "${expressionId}" ${why} and is not decidable.`)
        this.name = "NotOperatorNotDecidableError"
        this.expressionId = expressionId
        this.reason = reason
    }
}
```

- [ ] **Step 5: Export from `src/lib/index.ts`**

Append after the `InvariantViolationError` export line (currently line 108):

```typescript
export {
    InvalidArgumentStructureError,
    UnknownExpressionError,
    NotOperatorNotDecidableError,
} from "./core/review-errors.js"
export type { TNotOperatorNotDecidableReason } from "./core/review-errors.js"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "review helper errors"`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/review-errors.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add review-helper error classes"
```

---

### Task 2: `PremiseEngine.getDecidableOperatorExpressions()`

**Files:**

- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` — extend `TExpressionQueries`
- Modify: `src/lib/core/evaluation/argument-evaluation.ts` — extend `TEvaluablePremise` with the same method so the standalone helper can call it without casting
- Modify: `src/lib/core/premise-engine.ts` — add the method (implements both interfaces via existing class declaration)
- Test: `test/core.test.ts` — new describe block

- [ ] **Step 1: Write failing tests**

Append at the bottom of `test/core.test.ts`:

```typescript
describe("PremiseEngine — getDecidableOperatorExpressions", () => {
    it("returns [or] for a single or(a,b)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "P or Q" })
        const orId = `${pm.getId()}-or`
        pm.addExpression(makeOpExpr(orId, "or"))
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, {
                parentId: orId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, {
                parentId: orId,
                position: 1,
            })
        )

        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([orId])
    })

    it("returns [and, or] in pre-order for and(or(a,b), c)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(makeVar("var-r", "R"))
        const { result: pm } = eng.createPremise({ title: "(P or Q) and R" })
        const andId = `${pm.getId()}-and`
        const orId = `${pm.getId()}-or`
        const formulaId = `${pm.getId()}-formula`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(orId, "or", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, {
                parentId: orId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, {
                parentId: orId,
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-r`, "var-r", {
                parentId: andId,
                position: 1,
            })
        )

        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId, orId])
    })

    it("excludes NOT inside a premise: and(not(a), b) returns [and]", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "not(P) and Q" })
        const andId = `${pm.getId()}-and`
        const notId = `${pm.getId()}-not`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeOpExpr(notId, "not", { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${notId}-p`, VAR_P.id, {
                parentId: notId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-q`, VAR_Q.id, {
                parentId: andId,
                position: 1,
            })
        )

        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId])
    })

    it("excludes wrapping NOT but keeps inner AND: not(and(a,b)) returns [and]", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "not(P and Q)" })
        const notId = `${pm.getId()}-not`
        const formulaId = `${pm.getId()}-formula`
        const andId = `${pm.getId()}-and`
        pm.addExpression(makeOpExpr(notId, "not"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: notId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(andId, "and", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-p`, VAR_P.id, {
                parentId: andId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-q`, VAR_Q.id, {
                parentId: andId,
                position: 1,
            })
        )

        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId])
    })

    it("returns [] for a single-variable premise with no operators", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))

        expect(pm.getDecidableOperatorExpressions()).toEqual([])
    })

    it("returns [] for an empty premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = eng.createPremise({ title: "empty" })
        expect(pm.getDecidableOperatorExpressions()).toEqual([])
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "getDecidableOperatorExpressions"`
Expected: FAIL — method does not exist.

- [ ] **Step 3: Extend the `TExpressionQueries` interface**

In `src/lib/core/interfaces/premise-engine.interfaces.ts`, add this method inside the `TExpressionQueries` interface (after `getChildExpressions`, currently ending at line 319):

```typescript
    /**
     * Returns the operator expressions a reviewer can accept or reject, in
     * pre-order depth-first tree order.
     *
     * Excludes `"not"` operators (NOT is flipped via a render-time flag,
     * not voted on) and skips formula nodes (they are traversed but never
     * emitted). Returns `[]` for empty premises and premises with no
     * operators.
     *
     * Order is stable across calls on the same `PremiseEngine` instance;
     * callers typically rely on index for step-queue construction.
     *
     * @returns An array of decidable operator expression entities.
     */
    getDecidableOperatorExpressions(): TExpr[]
```

- [ ] **Step 4: Extend `TEvaluablePremise`**

In `src/lib/core/evaluation/argument-evaluation.ts`, add the method to `TEvaluablePremise` (currently ends at line 67, right after `evaluate(...)`):

```typescript
    /**
     * Returns the operator expressions a reviewer can accept or reject,
     * in pre-order tree order. Excludes `"not"` operators and skips
     * formula nodes. See `TExpressionQueries.getDecidableOperatorExpressions`
     * on the full `PremiseEngine` for the authoritative contract.
     */
    getDecidableOperatorExpressions(): TCorePropositionalExpression[]
```

- [ ] **Step 5: Implement on `PremiseEngine`**

In `src/lib/core/premise-engine.ts`, add the following method right after `walkFormulaTree` (currently ends at line 1592):

```typescript
    public getDecidableOperatorExpressions(): TExpr[] {
        const result: TExpr[] = []
        const rootId = this.rootExpressionId
        if (rootId === undefined) return result

        const visit = (exprId: string): void => {
            const expr = this.expressions.getExpression(exprId)
            if (!expr) return
            if (expr.type === "operator" && expr.operator !== "not") {
                result.push(expr)
            }
            for (const child of this.expressions.getChildExpressions(
                exprId
            )) {
                visit(child.id)
            }
        }

        visit(rootId)
        return result
    }
```

Confirm `this.expressions.getExpression(id)` exists (grep for `public getExpression` in `expression-manager.ts`). `getChildExpressions` already returns children sorted by position, so no extra sort is needed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "getDecidableOperatorExpressions"`
Expected: PASS (6 tests).

- [ ] **Step 7: Run full type + lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/interfaces/premise-engine.interfaces.ts src/lib/core/evaluation/argument-evaluation.ts src/lib/core/premise-engine.ts test/core.test.ts
git commit -m "feat: add PremiseEngine.getDecidableOperatorExpressions"
```

---

### Task 3: `collectArgumentReferencedClaims`

**Files:**

- Create: `src/lib/core/review-helpers.ts`
- Modify: `src/lib/index.ts`
- Test: `test/core.test.ts` — new describe block

- [ ] **Step 1: Write failing tests**

Append at the bottom of `test/core.test.ts`:

```typescript
describe("collectArgumentReferencedClaims", () => {
    // Mirrors the ctxFrom helper in the "evaluateArgument (standalone)" block.
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    it("returns only the conclusion's claims when there are no supporting premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
        eng.setConclusionPremise(pm.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
        expect(r.byId["claim-default"].variableIds).toEqual([VAR_P.id])
        expect(r.byId["claim-default"].premiseIds).toEqual([pm.getId()])
        expect(r.byId["claim-default"].claimVersion).toBe(0)
    })

    it("emits a claim once at its first occurrence when shared across premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: support } = eng.createPremise({ title: "P (support)" })
        const { result: conclusion } = eng.createPremise({ title: "P (conc)" })
        support.addExpression(makeVarExpr(`${support.getId()}-p`, VAR_P.id))
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-p`, VAR_P.id)
        )
        eng.setConclusionPremise(conclusion.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
        expect(r.byId["claim-default"].premiseIds).toHaveLength(2)
        expect(r.byId["claim-default"].variableIds).toEqual([VAR_P.id])
    })

    it("skips premise-bound variables (no bound claim)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: inner } = eng.createPremise({ title: "inner: P" })
        inner.addExpression(makeVarExpr(`${inner.getId()}-p`, VAR_P.id))
        // createPremise auto-creates a premise-bound variable bound to this
        // premise; verify we do not emit a claim entry for it.
        const { result: outer } = eng.createPremise({ title: "outer" })
        const varsBound = eng.getVariables().filter((v) => isPremiseBound(v))
        expect(varsBound.length).toBeGreaterThan(0)
        void outer

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
    })

    it("throws InvalidArgumentStructureError when two variables bind the same claim with different versions", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-shared" })
        // freeze() leaves v0 (frozen) AND v1 (new mutable copy) both
        // present in the library; both are reachable for variable binds.
        lib.freeze("claim-shared")

        const eng = new ArgumentEngine(
            ARG,
            lib,
            sLib(),
            new ClaimSourceLibrary(lib, sLib())
        )
        eng.addVariable({
            id: "var-v0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "X",
            claimId: "claim-shared",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "var-v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Y",
            claimId: "claim-shared",
            claimVersion: 1,
        })
        const { result: pm } = eng.createPremise({ title: "pm" })
        const andId = `${pm.getId()}-and`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeVarExpr(`${andId}-x`, "var-v0", {
                parentId: andId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-y`, "var-v1", {
                parentId: andId,
                position: 1,
            })
        )
        eng.setConclusionPremise(pm.getId())

        expect(() => collectArgumentReferencedClaims(evalCtxFrom(eng))).toThrow(
            InvalidArgumentStructureError
        )
    })

    it("orders claims by supporting → conclusion → constraint, then by first tree-order reference", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-a" })
        lib.create({ id: "claim-b" })
        const eng = new ArgumentEngine(
            ARG,
            lib,
            sLib(),
            new ClaimSourceLibrary(lib, sLib())
        )
        eng.addVariable({
            id: "var-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "A",
            claimId: "claim-a",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "var-b",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "B",
            claimId: "claim-b",
            claimVersion: 0,
        })
        // Supporting premise mentions B first — it should appear before A.
        const { result: support } = eng.createPremise({ title: "B -> A" })
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-b`, "var-b", {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-a`, "var-a", {
                parentId: implId,
                position: 1,
            })
        )
        const { result: conclusion } = eng.createPremise({ title: "A" })
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-a`, "var-a")
        )
        eng.setConclusionPremise(conclusion.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-b", "claim-a"])
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "collectArgumentReferencedClaims"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Create `src/lib/core/review-helpers.ts`**

```typescript
import {
    isClaimBound,
    type TClaimBoundVariable,
    type TCorePropositionalVariable,
} from "../schemata/index.js"
import type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "./evaluation/argument-evaluation.js"
import { InvalidArgumentStructureError } from "./review-errors.js"

export interface TCollectArgumentReferencedClaimsResult {
    /** Claim IDs in first-occurrence order. */
    claimIds: string[]
    byId: Record<
        string,
        {
            claimVersion: number
            variableIds: string[]
            premiseIds: string[]
        }
    >
}

/**
 * Collects every distinct claim referenced by any variable in any premise
 * of the argument.
 *
 * Ordering: supporting premises (in `listSupportingPremises()` order), then
 * the conclusion premise, then remaining premises (constraints). Within a
 * premise, claims appear in the order their first-referencing variable
 * appears in the expression tree (pre-order DFS). A claim shared across
 * premises is emitted once at its first occurrence.
 *
 * Variables without a bound claim (e.g. premise-bound variables) are
 * skipped silently — not an error.
 *
 * @throws {InvalidArgumentStructureError} If two variables in the argument
 *   bind the same `claimId` with different `claimVersion`s.
 */
export function collectArgumentReferencedClaims(
    ctx: TArgumentEvaluationContext
): TCollectArgumentReferencedClaimsResult {
    // First pass (across ALL premises): detect structural errors —
    // same claimId referenced with differing claimVersions anywhere.
    const claimVersionsSeen = new Map<string, Map<number, string[]>>()
    for (const pm of ctx.listPremises()) {
        for (const variable of pm.getVariables()) {
            if (!isClaimBound(variable)) continue
            const cb = variable as TClaimBoundVariable
            let versions = claimVersionsSeen.get(cb.claimId)
            if (!versions) {
                versions = new Map()
                claimVersionsSeen.set(cb.claimId, versions)
            }
            let ids = versions.get(cb.claimVersion)
            if (!ids) {
                ids = []
                versions.set(cb.claimVersion, ids)
            }
            if (!ids.includes(cb.id)) ids.push(cb.id)
        }
    }
    for (const [claimId, versions] of claimVersionsSeen) {
        if (versions.size > 1) {
            const summary = Array.from(versions.entries())
                .map(
                    ([v, ids]) =>
                        `version ${v} via variables [${ids.join(", ")}]`
                )
                .join("; ")
            throw new InvalidArgumentStructureError(
                `Claim "${claimId}" is referenced with multiple versions: ${summary}.`
            )
        }
    }

    // Second pass: walk supporting → conclusion → constraint, pre-order DFS.
    type TAccumulator = {
        claimVersion: number
        variableIds: Set<string>
        premiseIds: Set<string>
    }
    const byId = new Map<string, TAccumulator>()
    const order: string[] = []

    const conclusion = ctx.getConclusionPremise()
    const supporting = ctx.listSupportingPremises()
    const supportingIds = new Set(supporting.map((p) => p.getId()))
    const conclusionId = conclusion?.getId()
    const remaining = ctx
        .listPremises()
        .filter(
            (p) => p.getId() !== conclusionId && !supportingIds.has(p.getId())
        )

    const premiseSequence: TEvaluablePremise[] = [
        ...supporting,
        ...(conclusion ? [conclusion] : []),
        ...remaining,
    ]

    for (const premise of premiseSequence) {
        const premiseId = premise.getId()
        const varsById = new Map<string, TCorePropositionalVariable>(
            premise.getVariables().map((v) => [v.id, v])
        )
        // TEvaluablePremise has no getRootExpressionId(), so build an
        // id-indexed map of expressions and find the root by scanning
        // for parentId === null. Child traversal uses
        // premise.getChildExpressions(parentId), which returns children
        // sorted by position.
        const expressions = premise.getExpressions()
        const exprById = new Map(expressions.map((e) => [e.id, e]))
        const rootExpr = expressions.find((e) => e.parentId === null)
        if (!rootExpr) continue

        const visit = (exprId: string): void => {
            const expr = exprById.get(exprId)
            if (!expr) return
            if (expr.type === "variable") {
                const variable = varsById.get(expr.variableId)
                if (variable && isClaimBound(variable)) {
                    const cb = variable as TClaimBoundVariable
                    let entry = byId.get(cb.claimId)
                    if (!entry) {
                        entry = {
                            claimVersion: cb.claimVersion,
                            variableIds: new Set(),
                            premiseIds: new Set(),
                        }
                        byId.set(cb.claimId, entry)
                        order.push(cb.claimId)
                    }
                    entry.variableIds.add(cb.id)
                    entry.premiseIds.add(premiseId)
                }
            }
            for (const child of premise.getChildExpressions(exprId)) {
                visit(child.id)
            }
        }

        visit(rootExpr.id)
    }

    const outById: TCollectArgumentReferencedClaimsResult["byId"] = {}
    for (const claimId of order) {
        const entry = byId.get(claimId)!
        outById[claimId] = {
            claimVersion: entry.claimVersion,
            variableIds: Array.from(entry.variableIds),
            premiseIds: Array.from(entry.premiseIds),
        }
    }

    return { claimIds: order, byId: outById }
}
```

- [ ] **Step 4: Export from `src/lib/index.ts`**

Add at the end of `src/lib/index.ts`:

```typescript
export { collectArgumentReferencedClaims } from "./core/review-helpers.js"
export type { TCollectArgumentReferencedClaimsResult } from "./core/review-helpers.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "collectArgumentReferencedClaims"`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/review-helpers.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add collectArgumentReferencedClaims helper"
```

---

### Task 4: `canonicalizeOperatorAssignments`

**Files:**

- Modify: `src/lib/core/review-helpers.ts` — add second function
- Modify: `src/lib/index.ts` — add export
- Test: `test/core.test.ts` — new describe block

- [ ] **Step 1: Write failing tests**

Append at the bottom of `test/core.test.ts`:

```typescript
describe("canonicalizeOperatorAssignments", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    /** Builds eng with one premise containing AND(OR(p,q), r). Returns ids. */
    function buildNested(): {
        eng: ArgumentEngine
        premiseId: string
        andId: string
        orId: string
    } {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(makeVar("var-r", "R"))
        const { result: pm } = eng.createPremise({ title: "(P or Q) and R" })
        const andId = `${pm.getId()}-and`
        const orId = `${pm.getId()}-or`
        const formulaId = `${pm.getId()}-formula`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(orId, "or", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, {
                parentId: orId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, {
                parentId: orId,
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-r`, "var-r", {
                parentId: andId,
                position: 1,
            })
        )
        eng.setConclusionPremise(pm.getId())
        return { eng, premiseId: pm.getId(), andId, orId }
    }

    it("empty input returns {}", () => {
        const { eng } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: {},
        })
        expect(r).toEqual({})
    })

    it("premiseScope fans out to every non-NOT operator in the premise", () => {
        const { eng, premiseId, andId, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: { [premiseId]: "accepted" },
        })
        expect(r).toEqual({
            [andId]: "accepted",
            [orId]: "accepted",
        })
    })

    it("expressionOverrides win over premiseScope fan-out", () => {
        const { eng, premiseId, andId, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: { [premiseId]: "accepted" },
            expressionOverrides: { [orId]: "rejected" },
        })
        expect(r).toEqual({
            [andId]: "accepted",
            [orId]: "rejected",
        })
    })

    it("expressionOverrides alone produce assignments even when parent premise is not in premiseScope", () => {
        const { eng, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: {},
            expressionOverrides: { [orId]: "rejected" },
        })
        expect(r).toEqual({ [orId]: "rejected" })
    })

    it("unknown expression id throws UnknownExpressionError", () => {
        const { eng } = buildNested()
        expect(() =>
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { "not-a-real-id": "accepted" },
            })
        ).toThrow(UnknownExpressionError)
    })

    it("NOT override throws NotOperatorNotDecidableError with reason=is-not-operator", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "not P" })
        const notId = `${pm.getId()}-not`
        pm.addExpression(makeOpExpr(notId, "not"))
        pm.addExpression(
            makeVarExpr(`${notId}-p`, VAR_P.id, {
                parentId: notId,
                position: 0,
            })
        )
        eng.setConclusionPremise(pm.getId())

        expect(() =>
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [notId]: "accepted" },
            })
        ).toThrow(NotOperatorNotDecidableError)
        try {
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [notId]: "accepted" },
            })
            expect.fail("expected throw")
        } catch (e) {
            expect(e).toBeInstanceOf(NotOperatorNotDecidableError)
            expect((e as NotOperatorNotDecidableError).reason).toBe(
                "is-not-operator"
            )
        }
    })

    it("override on a non-operator expression throws NotOperatorNotDecidableError with reason=not-an-operator-type", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        const varExprId = `${pm.getId()}-p`
        pm.addExpression(makeVarExpr(varExprId, VAR_P.id))
        eng.setConclusionPremise(pm.getId())

        try {
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [varExprId]: "accepted" },
            })
            expect.fail("expected throw")
        } catch (e) {
            expect(e).toBeInstanceOf(NotOperatorNotDecidableError)
            expect((e as NotOperatorNotDecidableError).reason).toBe(
                "not-an-operator-type"
            )
        }
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "canonicalizeOperatorAssignments"`
Expected: FAIL.

- [ ] **Step 3: Implement `canonicalizeOperatorAssignments`**

Merge these additional imports into the existing import block at the top of `src/lib/core/review-helpers.ts`:

```typescript
import type {
    TCoreOperatorAssignment,
    TCorePropositionalExpression,
} from "../types/evaluation.js"
import {
    NotOperatorNotDecidableError,
    UnknownExpressionError,
} from "./review-errors.js"
```

Append to the file:

```typescript
export interface TCanonicalizeOperatorAssignmentsInput {
    premiseScope: Record<string, TCoreOperatorAssignment>
    expressionOverrides?: Record<string, TCoreOperatorAssignment>
}

/**
 * Expands `premiseScope` decisions into per-expression operator
 * assignments via `TEvaluablePremise.getDecidableOperatorExpressions()`,
 * then layers `expressionOverrides` on top.
 *
 * **Overrides without matching premiseScope**: An override whose parent
 * premise is not listed in `premiseScope` is still applied verbatim. This
 * lets the review wizard collect expression-level decisions without
 * having to decide at premise scope first.
 *
 * Output keys are exactly those expression ids that ended up with an
 * assignment — not every expression in the argument.
 *
 * @throws {UnknownExpressionError} For any override id that does not
 *   exist in the argument.
 * @throws {NotOperatorNotDecidableError} With `reason: "is-not-operator"`
 *   for overrides targeting a `"not"` operator, or with
 *   `reason: "not-an-operator-type"` for overrides targeting a variable
 *   or formula expression.
 */
export function canonicalizeOperatorAssignments(
    ctx: TArgumentEvaluationContext,
    input: TCanonicalizeOperatorAssignmentsInput
): Record<string, TCoreOperatorAssignment> {
    const out: Record<string, TCoreOperatorAssignment> = {}

    // Expand premise-scope entries. TEvaluablePremise exposes
    // getDecidableOperatorExpressions (added in Task 2).
    for (const [premiseId, value] of Object.entries(input.premiseScope)) {
        const premise = ctx.getPremise(premiseId)
        if (!premise) continue
        for (const expr of premise.getDecidableOperatorExpressions()) {
            out[expr.id] = value
        }
    }

    // Apply expression overrides.
    const overrides = input.expressionOverrides ?? {}
    if (Object.keys(overrides).length > 0) {
        const exprById = new Map<string, TCorePropositionalExpression>()
        for (const pm of ctx.listPremises()) {
            for (const e of pm.getExpressions()) {
                exprById.set(e.id, e)
            }
        }
        for (const [exprId, value] of Object.entries(overrides)) {
            const expr = exprById.get(exprId)
            if (!expr) throw new UnknownExpressionError(exprId)
            if (expr.type !== "operator") {
                throw new NotOperatorNotDecidableError(
                    exprId,
                    "not-an-operator-type"
                )
            }
            if (expr.operator === "not") {
                throw new NotOperatorNotDecidableError(
                    exprId,
                    "is-not-operator"
                )
            }
            out[exprId] = value
        }
    }

    return out
}
```

- [ ] **Step 4: Export**

Add to `src/lib/index.ts`:

```typescript
export { canonicalizeOperatorAssignments } from "./core/review-helpers.js"
export type { TCanonicalizeOperatorAssignmentsInput } from "./core/review-helpers.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "canonicalizeOperatorAssignments"`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/review-helpers.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add canonicalizeOperatorAssignments helper"
```

---

### Task 5: `propagatedVariableValues` on `TCoreArgumentEvaluationResult`

**Files:**

- Modify: `src/lib/types/evaluation.ts`
- Modify: `src/lib/core/evaluation/argument-evaluation.ts`
- Test: `test/core.test.ts` — new describe block

- [ ] **Step 1: Write failing tests**

Append at the bottom of `test/core.test.ts`:

```typescript
describe("evaluateArgument — propagatedVariableValues", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    /**
     * Argument: P -> Q (supporting), P (constraint), Q (conclusion).
     * With P = true and the implication accepted, propagation should pin Q
     * to true even though the user did not assign Q.
     */
    function buildModusPonensEng() {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-p`, VAR_P.id, {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-q`, VAR_Q.id, {
                parentId: implId,
                position: 1,
            })
        )
        pPremise.addExpression(makeVarExpr(`${pPremise.getId()}-p`, VAR_P.id))
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
        )
        eng.setConclusionPremise(conclusion.getId())
        return { eng, implId }
    }

    it("pins unknown Q to true under accepted implies + P=true", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: null },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeDefined()
        expect(result.propagatedVariableValues![VAR_P.id]).toBe(true)
        expect(result.propagatedVariableValues![VAR_Q.id]).toBe(true)
    })

    it("is undefined when includeDiagnostics is false", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: null },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: false }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeUndefined()
    })

    it("represents still-unresolved variables as null (present in map)", () => {
        const { eng } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            { variables: {}, operatorAssignments: {} },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeDefined()
        expect(VAR_P.id in result.propagatedVariableValues!).toBe(true)
        expect(VAR_Q.id in result.propagatedVariableValues!).toBe(true)
        expect(result.propagatedVariableValues![VAR_P.id]).toBeNull()
        expect(result.propagatedVariableValues![VAR_Q.id]).toBeNull()
    })

    it("map key set equals referencedVariableIds", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        const keys = Object.keys(result.propagatedVariableValues!).sort()
        expect(keys).toEqual([...result.referencedVariableIds!].sort())
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "propagatedVariableValues"`
Expected: FAIL — field does not exist.

- [ ] **Step 3: Add the optional field to `TCoreArgumentEvaluationResult`**

In `src/lib/types/evaluation.ts`, add the field to `TCoreArgumentEvaluationResult` (after `preservesTruthUnderAssignment`, currently line 159):

```typescript
    /**
     * Evaluator's authoritative propagated variable values across the whole
     * argument. Populated only when `includeDiagnostics: true`. Key set
     * matches `referencedVariableIds`; still-unresolved variables appear
     * with value `null`.
     */
    propagatedVariableValues?: Record<string, TCoreTrivalentValue>
```

- [ ] **Step 4: Populate the field inside `evaluateArgument`**

In `src/lib/core/evaluation/argument-evaluation.ts`, modify the success-path return at the end of the `try` block (lines 530–547). Replace the return with:

```typescript
const propagatedVariableValues = includeDiagnostics
    ? Object.fromEntries(
          referencedVariableIds.map((vid) => [
              vid,
              propagatedAssignment.variables[vid] ?? null,
          ])
      )
    : undefined

return {
    ok: true,
    assignment: {
        variables: { ...propagatedAssignment.variables },
        operatorAssignments: {
            ...propagatedAssignment.operatorAssignments,
        },
    },
    referencedVariableIds,
    conclusion: strip(conclusionEvaluation),
    supportingPremises: supportingEvaluations.map(strip),
    constraintPremises: constraintEvaluations.map(strip),
    isAdmissibleAssignment,
    allSupportingPremisesTrue,
    conclusionTrue,
    isCounterexample,
    preservesTruthUnderAssignment: kleeneNot(isCounterexample),
    propagatedVariableValues,
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "propagatedVariableValues"`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full existing evaluation test block to guard regressions**

Run: `pnpm vitest run test/core.test.ts -t "evaluateArgument"`
Expected: PASS (all existing tests — new field is opt-in and does not change existing behaviour).

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types/evaluation.ts src/lib/core/evaluation/argument-evaluation.ts test/core.test.ts
git commit -m "feat: add propagatedVariableValues to argument evaluation result"
```

---

### Task 6: Documentation

**Files:**

- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`
- Modify: `docs/api-reference.md`

- [ ] **Step 1: Update `docs/release-notes/upcoming.md`**

Replace the file contents with:

```markdown
# Release Notes

## Review-helper APIs

Four new APIs make it easier to build argument-review UIs on top of `proposit-core` without duplicating traversal logic:

- `collectArgumentReferencedClaims(ctx)` — returns every distinct claim referenced by the argument, de-duped and ordered supporting → conclusion → constraint. Note: the helper includes constraint-only claims (walked after the conclusion) so they are not silently dropped.
- `PremiseEngine.getDecidableOperatorExpressions()` — returns the operator expressions a reviewer can accept or reject (excluding `"not"`), in pre-order tree order. Also available on the narrower `TEvaluablePremise` interface.
- `canonicalizeOperatorAssignments(ctx, input)` — expands `{ premiseScope, expressionOverrides }` into a flat per-expression assignment map. Expression overrides are accepted even when the containing premise is NOT in `premiseScope`. Throws `UnknownExpressionError` for unknown ids and `NotOperatorNotDecidableError` (with a `reason` of `"is-not-operator"` or `"not-an-operator-type"`) for unvotable targets.
- `TCoreArgumentEvaluationResult.propagatedVariableValues` — an opt-in map of the evaluator's authoritative propagated variable values (populated when `includeDiagnostics: true`). **The key set is `referencedVariableIds`**, i.e. claim-bound and externally-bound premise variables. Internally-bound premise variables are resolved lazily during evaluation and have no standalone truth value to surface here.

Three new error classes support the above: `InvalidArgumentStructureError`, `UnknownExpressionError`, `NotOperatorNotDecidableError` (with a `TNotOperatorNotDecidableReason` discriminator).
```

- [ ] **Step 2: Update `docs/changelogs/upcoming.md`**

Replace the file with (use real commit hashes at the end):

```markdown
# Changelog

- feat(review-helpers): add `collectArgumentReferencedClaims`, `PremiseEngine.getDecidableOperatorExpressions`, `canonicalizeOperatorAssignments`, and `TCoreArgumentEvaluationResult.propagatedVariableValues`. New errors: `InvalidArgumentStructureError`, `UnknownExpressionError`, `NotOperatorNotDecidableError`. Ordering for collected claims: supporting → conclusion → constraint (spec extended to cover constraint-only claims). `propagatedVariableValues` is gated on `includeDiagnostics: true` and keyed by `referencedVariableIds`.
```

Leave commit-hash linking for the version bump step.

- [ ] **Step 3: Update `docs/api-reference.md`**

Locate the public-API section and add entries for each new symbol. Mirror the heading style of existing entries (grep `docs/api-reference.md` for `collectArgumentReferencedVariables` to find the right spot). Sample entry:

```markdown
### `collectArgumentReferencedClaims(ctx)`

Returns every distinct claim referenced by any variable in any premise of the argument.

- **ctx**: `TArgumentEvaluationContext`
- **returns**: `TCollectArgumentReferencedClaimsResult` — `{ claimIds, byId }`

Ordering: supporting premises first, then the conclusion premise, then any remaining premises (constraints). Within a premise, claims appear in the order their first-referencing variable appears in tree order. A claim shared across premises is emitted once, at its first occurrence.

Throws `InvalidArgumentStructureError` if two variables bind the same `claimId` with different `claimVersion`s.
```

Add similar entries for `PremiseEngine.getDecidableOperatorExpressions()`, `canonicalizeOperatorAssignments`, `propagatedVariableValues`, and each error class.

- [ ] **Step 4: Run the full check**

Run: `pnpm run check`
Expected: PASS (typecheck + lint + tests + build).

- [ ] **Step 5: Delete the processed change request**

Per CLAUDE.md rule: "After a change request is fully implemented, delete its markdown file from `docs/change-requests/`."

```bash
rm docs/change-requests/2026-04-14-review-helpers.md
```

- [ ] **Step 6: Commit**

```bash
git add docs/release-notes/upcoming.md docs/changelogs/upcoming.md docs/api-reference.md docs/change-requests/2026-04-14-review-helpers.md
git commit -m "docs: document review-helper APIs and retire change request"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run everything**

Run: `pnpm run check`
Expected: PASS.

- [ ] **Step 2: Offer a version bump**

Per CLAUDE.md: "After completing a major set of changes, offer to cut a new version via `pnpm version patch|minor|major`." Ask the user whether to bump (this is a feature-add, so `minor` is likely appropriate) — do not self-decide.

---

## Self-Review Notes

- Spec coverage: ✅ four APIs, three errors (one with a `reason` discriminator), all test cases listed in the spec mapped to tasks 2–5. Extra test added for the non-operator expression override case (spec did not specify).
- Placeholder scan: No "TBD", "add error handling", or similar hand-waves. Every step has runnable code.
- Type consistency: All types used in later tasks (`TArgumentEvaluationContext`, `TEvaluablePremise`, `TCoreOperatorAssignment`, `TCorePropositionalExpression`, `TNotOperatorNotDecidableReason`) are defined in files identified in the exploration, and the imports in each new file are explicit.
- Deviation flags: See "Deviations From Spec" at the top — eight deviations. Each is traceable to a concrete constraint in the existing code and documented in both the affected API's JSDoc and the release notes. Deviation 3 (`propagatedVariableValues` keyed by `referencedVariableIds`) is surfaced prominently in release notes so the server team is not surprised.
- Review-round-1 fixes incorporated: (a) all tests use static imports — no dynamic `await import` — matching the established pattern in `test/core.test.ts`; (b) `TEvaluablePremise` is widened with `getDecidableOperatorExpressions` so `canonicalizeOperatorAssignments` calls it directly instead of casting through `unknown`; (c) `collectArgumentReferencedClaims` uses `premise.getChildExpressions` directly rather than rebuilding child groupings; (d) non-operator expression overrides throw `NotOperatorNotDecidableError` (with `reason: "not-an-operator-type"`) rather than the misleading `UnknownExpressionError`.
