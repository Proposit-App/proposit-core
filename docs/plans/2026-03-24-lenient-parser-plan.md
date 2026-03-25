# Lenient Parser Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lenient build mode to `ArgumentParser.build()` that drops invalid references with warnings instead of throwing, and add miniId prefix guidance to the LLM prompt.

**Architecture:** `build()` gets an optional `TParserBuildOptions` parameter. In lenient mode, each validation point catches errors and pushes a `TParserWarning` to a warnings array instead of throwing. `TArgumentParserResult` gains a `warnings` field (always present). The prompt gains a "MiniId Conventions" section.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/plans/2026-03-24-lenient-parser-design.md`

---

### Task 1: Add new types

**Files:**

- Modify: `src/lib/parsing/types.ts`
- Modify: `src/lib/parsing/index.ts`

- [ ] **Step 1: Add warning and options types to `types.ts`**

Append to `src/lib/parsing/types.ts`:

```typescript
export type TParserWarningCode =
    | "UNRESOLVED_SOURCE_MINIID"
    | "UNRESOLVED_CLAIM_MINIID"
    | "UNRESOLVED_CONCLUSION_MINIID"
    | "UNDECLARED_VARIABLE_SYMBOL"
    | "FORMULA_PARSE_ERROR"
    | "FORMULA_STRUCTURE_ERROR"

export type TParserWarning = {
    code: TParserWarningCode
    message: string
    context: Record<string, string>
}

export type TParserBuildOptions = {
    strict?: boolean
}
```

- [ ] **Step 2: Export new types from `index.ts`**

In `src/lib/parsing/index.ts`, update the types import line to also export `TParserWarningCode`, `TParserWarning`, and `TParserBuildOptions`:

```typescript
export type {
    TPromptOptions,
    TParsingSchemaOptions,
    TParserWarningCode,
    TParserWarning,
    TParserBuildOptions,
} from "./types.js"
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no consumers of new types yet)

- [ ] **Step 4: Commit**

```bash
git add src/lib/parsing/types.ts src/lib/parsing/index.ts
git commit -m "feat(parser): add TParserWarning and TParserBuildOptions types"
```

---

### Task 2: Add `warnings` to result type and update `build()` signature

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts:35-48` (TArgumentParserResult)
- Modify: `src/lib/parsing/argument-parser.ts:267-277` (build signature)
- Modify: `src/lib/parsing/argument-parser.ts:466` (return statement)

- [ ] **Step 1: Write the failing test — `warnings` field exists on strict success**

In `test/core.test.ts`, inside the existing `describe("build", ...)` block (after the last `it` at line 12876), add:

```typescript
it("includes empty warnings array on successful strict build", () => {
    const parser = new ArgumentParser()
    const result = parser.build(validResponse())
    expect(result.warnings).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "includes empty warnings array"`
Expected: FAIL — `result.warnings` is `undefined`

- [ ] **Step 3: Import `TParserWarning` and `TParserBuildOptions` in `argument-parser.ts`**

At the top of `src/lib/parsing/argument-parser.ts`, add to imports:

```typescript
import type { TParserWarning, TParserBuildOptions } from "./types.js"
```

- [ ] **Step 4: Add `warnings` to `TArgumentParserResult`**

In `src/lib/parsing/argument-parser.ts`, update the result type (lines 43-48) from:

```typescript
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    claimLibrary: ClaimLibrary<TClaim>
    sourceLibrary: SourceLibrary<TSource>
    claimSourceLibrary: ClaimSourceLibrary<TAssoc>
}
```

to:

```typescript
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    claimLibrary: ClaimLibrary<TClaim>
    sourceLibrary: SourceLibrary<TSource>
    claimSourceLibrary: ClaimSourceLibrary<TAssoc>
    warnings: TParserWarning[]
}
```

- [ ] **Step 5: Update `build()` signature to accept options**

Change the `build()` method signature (lines 267-277) from:

```typescript
public build(
    response: TParsedArgumentResponse
): TArgumentParserResult<...> {
```

to:

```typescript
public build(
    response: TParsedArgumentResponse,
    options?: TParserBuildOptions
): TArgumentParserResult<...> {
```

- [ ] **Step 6: Initialize warnings array and include in return**

At the top of `build()`, after the `const arg = response.argument` line (line 278), add:

```typescript
const warnings: TParserWarning[] = []
const strict = options?.strict ?? true
```

Update the return statement (line 466) from:

```typescript
return { engine, claimLibrary, sourceLibrary, claimSourceLibrary }
```

to:

```typescript
return { engine, claimLibrary, sourceLibrary, claimSourceLibrary, warnings }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "includes empty warnings array"`
Expected: PASS

- [ ] **Step 8: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS (no behavioral change yet; `strict` variable is unused — that's fine, we use it in the next tasks)

- [ ] **Step 9: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parser): add warnings to TArgumentParserResult and options to build()"
```

---

### Task 3: Lenient handling for `FORMULA_PARSE_ERROR`

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts:288-298` (formula parsing loop)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test — lenient formula parse error**

In `test/core.test.ts`, after the existing `describe("build", ...)` block's closing `})` (line 12877) but still inside the `describe("Parsing — ArgumentParser", ...)` block, add a new describe:

```typescript
describe("build lenient mode", () => {
    function validResponse(): TParsedArgumentResponse {
        return {
            argument: {
                claims: [
                    { miniId: "C1", role: "premise", sourceMiniIds: [] },
                    { miniId: "C2", role: "conclusion", sourceMiniIds: [] },
                ],
                variables: [
                    { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                    { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                ],
                sources: [],
                premises: [
                    { miniId: "P1", formula: "P implies Q" },
                    { miniId: "P2", formula: "P" },
                ],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
    }

    it("skips premise with malformed formula and emits FORMULA_PARSE_ERROR", () => {
        const parser = new ArgumentParser()
        const resp = validResponse()
        resp.argument!.premises.push({ miniId: "P3", formula: "P &&& Q" })
        const result = parser.build(resp, { strict: false })
        // P1 and P2 survive, P3 skipped
        const snap = result.engine.snapshot()
        expect(snap.premises).toHaveLength(2)
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0].code).toBe("FORMULA_PARSE_ERROR")
        expect(result.warnings[0].context.premiseMiniId).toBe("P3")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "skips premise with malformed formula"`
Expected: FAIL — throws instead of collecting warning

- [ ] **Step 3: Implement lenient formula parse error handling**

In `src/lib/parsing/argument-parser.ts`, replace the formula parsing `try/catch` block (lines 288-298) with:

```typescript
for (const premise of arg.premises) {
    let ast: TFormulaAST
    try {
        ast = parseFormula(premise.formula)
    } catch (error) {
        const msg =
            error instanceof Error ? error.message : String(error)
        if (strict) {
            throw new Error(
                `Failed to parse formula for premise "${premise.miniId}": ${msg}`
            )
        }
        warnings.push({
            code: "FORMULA_PARSE_ERROR",
            message: `Failed to parse formula for premise "${premise.miniId}": ${msg}`,
            context: { premiseMiniId: premise.miniId, formula: premise.formula },
        })
        continue
    }
```

This replaces only the `try/catch` block inside the loop. The rest of the loop body (root-only validation, variable name checking, `parsedFormulas.push`) stays unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "skips premise with malformed formula"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS (strict mode paths unchanged)

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parser): lenient handling for FORMULA_PARSE_ERROR"
```

---

### Task 4: Lenient handling for `FORMULA_STRUCTURE_ERROR`

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts:300-301` (root-only validation)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe("build lenient mode", ...)` block:

```typescript
it("skips premise with nested implies and emits FORMULA_STRUCTURE_ERROR", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    resp.argument!.premises.push({
        miniId: "P3",
        formula: "(P implies Q) and P",
    })
    const result = parser.build(resp, { strict: false })
    const snap = result.engine.snapshot()
    expect(snap.premises).toHaveLength(2)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe("FORMULA_STRUCTURE_ERROR")
    expect(result.warnings[0].context.premiseMiniId).toBe("P3")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "skips premise with nested implies"`
Expected: FAIL — throws instead of collecting warning

- [ ] **Step 3: Implement lenient structure error handling**

In `src/lib/parsing/argument-parser.ts`, wrap the `validateRootOnly` call (line 301) with a try/catch:

```typescript
// Validate root-only constraint
try {
    validateRootOnly(ast, true, premise.miniId)
} catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (strict) {
        throw error
    }
    warnings.push({
        code: "FORMULA_STRUCTURE_ERROR",
        message: msg,
        context: { premiseMiniId: premise.miniId, formula: premise.formula },
    })
    continue
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "skips premise with nested implies"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parser): lenient handling for FORMULA_STRUCTURE_ERROR"
```

---

### Task 5: Lenient handling for `UNRESOLVED_SOURCE_MINIID`

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts:376-381` (source resolution in association wiring)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test — lenient skips bad source association**

Add to the `describe("build lenient mode", ...)` block:

```typescript
it("skips bad source association and emits UNRESOLVED_SOURCE_MINIID", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    resp.argument!.sources = [{ miniId: "S1", text: "Real source" }]
    resp.argument!.claims[0].sourceMiniIds = ["S1", "BOGUS"]
    const result = parser.build(resp, { strict: false })
    // Claim still created, one association wired, one skipped
    expect(result.claimLibrary.getAll()).toHaveLength(2)
    const assocs = result.claimSourceLibrary.getAll()
    expect(assocs).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe("UNRESOLVED_SOURCE_MINIID")
    expect(result.warnings[0].context.claimMiniId).toBe("C1")
    expect(result.warnings[0].context.sourceMiniId).toBe("BOGUS")
})
```

- [ ] **Step 2: Write the failing test — strict still throws on bad source**

Also add to the existing strict `describe("build", ...)` block (this is the previously missing test):

```typescript
it("throws on claim referencing undeclared source miniId", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    resp.argument!.claims[0].sourceMiniIds = ["BOGUS"]
    expect(() => parser.build(resp)).toThrow(/BOGUS/)
})
```

- [ ] **Step 3: Run tests to verify they fail/pass as expected**

Run: `pnpm vitest run test/core.test.ts -t "skips bad source association"`
Expected: FAIL — throws instead of collecting warning

Run: `pnpm vitest run test/core.test.ts -t "throws on claim referencing undeclared source"`
Expected: PASS — this is existing behavior, just adding the test

- [ ] **Step 4: Implement lenient source resolution**

In `src/lib/parsing/argument-parser.ts`, replace the source resolution error (lines 376-381) with:

```typescript
const sourceRef = sourceMiniIdToId.get(sourceMiniId)
if (!sourceRef) {
    if (strict) {
        throw new Error(
            `Claim "${parsedClaim.miniId}" references undeclared source "${sourceMiniId}".`
        )
    }
    warnings.push({
        code: "UNRESOLVED_SOURCE_MINIID",
        message: `Claim "${parsedClaim.miniId}" references undeclared source "${sourceMiniId}".`,
        context: { claimMiniId: parsedClaim.miniId, sourceMiniId },
    })
    continue
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "skips bad source association"`
Expected: PASS

Run: `pnpm run test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parser): lenient handling for UNRESOLVED_SOURCE_MINIID"
```

---

### Task 6: Lenient handling for `UNRESOLVED_CLAIM_MINIID` and `UNDECLARED_VARIABLE_SYMBOL`

This task handles both warning codes together because they require restructuring the undeclared-symbol check. Currently, the symbol check runs in the formula-parsing loop _before_ variable creation. But when a variable is skipped (bad claim ref), its symbol must be removed from `declaredSymbols` so downstream formulas are also caught. This requires moving the undeclared-symbol check to _after_ variable creation.

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts:303-314` (remove undeclared symbol check from formula loop)
- Modify: `src/lib/parsing/argument-parser.ts:416-421` (claim resolution in variable creation)
- Modify: `src/lib/parsing/argument-parser.ts:440` (add post-variable formula filter, use `survivingFormulas`)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe("build lenient mode", ...)` block:

```typescript
it("skips variable with bad claim ref and emits UNRESOLVED_CLAIM_MINIID", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    // V2 references nonexistent claim C99
    resp.argument!.variables[1] = {
        miniId: "V2",
        symbol: "Q",
        claimMiniId: "C99",
    }
    // Remove premise P1 that uses Q, keep P2 that uses only P
    resp.argument!.premises = [{ miniId: "P2", formula: "P" }]
    resp.argument!.conclusionPremiseMiniId = "P2"
    const result = parser.build(resp, { strict: false })
    const snap = result.engine.snapshot()
    // Only P survives as a variable
    expect(snap.variables.variables).toHaveLength(1)
    expect(snap.variables.variables[0].symbol).toBe("P")
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe("UNRESOLVED_CLAIM_MINIID")
    expect(result.warnings[0].context.variableMiniId).toBe("V2")
    expect(result.warnings[0].context.claimMiniId).toBe("C99")
})

it("skips premise with undeclared variable symbol and emits UNDECLARED_VARIABLE_SYMBOL", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    resp.argument!.premises.push({ miniId: "P3", formula: "X" })
    const result = parser.build(resp, { strict: false })
    const snap = result.engine.snapshot()
    expect(snap.premises).toHaveLength(2)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe("UNDECLARED_VARIABLE_SYMBOL")
    expect(result.warnings[0].context.premiseMiniId).toBe("P3")
    expect(result.warnings[0].context.symbol).toBe("X")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "skips variable with bad claim ref"`
Expected: FAIL — throws instead of collecting warning

Run: `pnpm vitest run test/core.test.ts -t "skips premise with undeclared variable symbol"`
Expected: FAIL — throws instead of collecting warning

- [ ] **Step 3: Remove undeclared-symbol check from formula parsing loop**

In `src/lib/parsing/argument-parser.ts`, remove the undeclared variable check from the formula parsing loop (lines 303-312). After this change, the loop body after `validateRootOnly` should go straight to `parsedFormulas.push({ ast, premise })` — no `collectVariableNames` / `declaredSymbols` check. Keep `declaredSymbols` initialized at line 284.

- [ ] **Step 4: Add lenient handling in variable creation loop**

Replace the claim resolution error (lines 416-421) with:

```typescript
const claimRef = claimMiniIdToId.get(parsedVar.claimMiniId)
if (!claimRef) {
    if (strict) {
        throw new Error(
            `Variable "${parsedVar.miniId}" references undeclared claim miniId "${parsedVar.claimMiniId}".`
        )
    }
    warnings.push({
        code: "UNRESOLVED_CLAIM_MINIID",
        message: `Variable "${parsedVar.miniId}" references undeclared claim miniId "${parsedVar.claimMiniId}".`,
        context: {
            variableMiniId: parsedVar.miniId,
            claimMiniId: parsedVar.claimMiniId,
        },
    })
    declaredSymbols.delete(parsedVar.symbol)
    continue
}
```

- [ ] **Step 5: Add post-variable formula filter with undeclared symbol check**

After the variable creation loop (after `engine.addVariable`), insert:

```typescript
// 7b. Filter formulas against surviving declared symbols
const survivingFormulas: typeof parsedFormulas = []
for (const entry of parsedFormulas) {
    const formulaVarNames = new Set<string>()
    collectVariableNames(entry.ast, formulaVarNames)
    let hasUndeclared = false
    for (const name of formulaVarNames) {
        if (!declaredSymbols.has(name)) {
            if (strict) {
                throw new Error(
                    `Formula for premise "${entry.premise.miniId}" references undeclared variable symbol "${name}". Declared symbols: ${[...declaredSymbols].join(", ")}.`
                )
            }
            warnings.push({
                code: "UNDECLARED_VARIABLE_SYMBOL",
                message: `Formula for premise "${entry.premise.miniId}" references undeclared variable symbol "${name}". Declared symbols: ${[...declaredSymbols].join(", ")}.`,
                context: { premiseMiniId: entry.premise.miniId, symbol: name },
            })
            hasUndeclared = true
            break
        }
    }
    if (!hasUndeclared) survivingFormulas.push(entry)
}
```

- [ ] **Step 6: Update premise creation to use `survivingFormulas`**

Change the premise creation loop from `for (const { ast, premise: parsedPremise } of parsedFormulas)` to:

```typescript
for (const { ast, premise: parsedPremise } of survivingFormulas) {
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "skips variable with bad claim ref"`
Expected: PASS

Run: `pnpm vitest run test/core.test.ts -t "skips premise with undeclared variable symbol"`
Expected: PASS

- [ ] **Step 8: Run full test suite to confirm no regressions**

Run: `pnpm run test`
Expected: All PASS (strict behavior preserved — undeclared symbol check moved but still throws in strict mode)

- [ ] **Step 9: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parser): lenient handling for UNRESOLVED_CLAIM_MINIID and UNDECLARED_VARIABLE_SYMBOL"
```

---

### Task 7: Lenient handling for `UNRESOLVED_CONCLUSION_MINIID`

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts:458-464` (conclusion resolution)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe("build lenient mode", ...)` block:

```typescript
it("skips conclusion assignment and emits UNRESOLVED_CONCLUSION_MINIID", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    resp.argument!.conclusionPremiseMiniId = "P99"
    const result = parser.build(resp, { strict: false })
    const snap = result.engine.snapshot()
    // Premises still created, but conclusion was auto-assigned to first premise
    expect(snap.premises).toHaveLength(2)
    expect(snap.conclusionPremiseId).toBeDefined() // auto-conclusion on first added premise
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe("UNRESOLVED_CONCLUSION_MINIID")
    expect(result.warnings[0].context.conclusionPremiseMiniId).toBe("P99")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "skips conclusion assignment"`
Expected: FAIL — throws instead of collecting warning

- [ ] **Step 3: Implement lenient conclusion resolution**

In `src/lib/parsing/argument-parser.ts`, replace the conclusion error (lines 458-464) with:

```typescript
// 9. Set conclusion
const conclusionId = premiseMiniIdToId.get(arg.conclusionPremiseMiniId)
if (!conclusionId) {
    if (strict) {
        throw new Error(
            `Conclusion premise miniId "${arg.conclusionPremiseMiniId}" could not be resolved to a premise.`
        )
    }
    warnings.push({
        code: "UNRESOLVED_CONCLUSION_MINIID",
        message: `Conclusion premise miniId "${arg.conclusionPremiseMiniId}" could not be resolved to a premise.`,
        context: { conclusionPremiseMiniId: arg.conclusionPremiseMiniId },
    })
} else {
    engine.setConclusionPremise(conclusionId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "skips conclusion assignment"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parser): lenient handling for UNRESOLVED_CONCLUSION_MINIID"
```

---

### Task 8: Cascade and edge case tests

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write cascade test — variable skip cascades to premise skip**

Add to the `describe("build lenient mode", ...)` block:

```typescript
it("cascade: skipped variable causes premise skip with both warnings", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    // Make V2 (symbol Q) reference a bad claim
    resp.argument!.variables[1] = {
        miniId: "V2",
        symbol: "Q",
        claimMiniId: "C99",
    }
    // P1 is "P implies Q" — Q is now undeclared, so P1 gets skipped
    // P2 is "P" — still valid; set it as conclusion so we don't also trigger UNRESOLVED_CONCLUSION_MINIID
    resp.argument!.conclusionPremiseMiniId = "P2"
    const result = parser.build(resp, { strict: false })
    const snap = result.engine.snapshot()
    expect(snap.premises).toHaveLength(1)
    expect(snap.variables.variables).toHaveLength(1)
    expect(snap.variables.variables[0].symbol).toBe("P")
    expect(result.warnings).toHaveLength(2)
    const codes = result.warnings.map((w) => w.code)
    expect(codes).toContain("UNRESOLVED_CLAIM_MINIID")
    expect(codes).toContain("UNDECLARED_VARIABLE_SYMBOL")
})
```

- [ ] **Step 2: Write no-issues lenient test**

```typescript
it("returns identical result with empty warnings when lenient and no issues", () => {
    const parser = new ArgumentParser()
    const resp = validResponse()
    const strict = parser.build(resp)
    const lenient = parser.build(resp, { strict: false })
    // Both should produce same structure (different UUIDs, so compare shape)
    const strictSnap = strict.engine.snapshot()
    const lenientSnap = lenient.engine.snapshot()
    expect(lenientSnap.premises).toHaveLength(strictSnap.premises.length)
    expect(lenientSnap.variables.variables).toHaveLength(
        strictSnap.variables.variables.length
    )
    expect(lenient.warnings).toEqual([])
})
```

- [ ] **Step 3: Write strict-mode regression tests — confirm all 6 cases still throw**

```typescript
it("strict mode still throws on all error types", () => {
    const parser = new ArgumentParser()

    // FORMULA_PARSE_ERROR
    const r1 = validResponse()
    r1.argument!.premises = [{ miniId: "P1", formula: "P &&& Q" }]
    expect(() => parser.build(r1)).toThrow(/P1/)

    // FORMULA_STRUCTURE_ERROR
    const r2 = validResponse()
    r2.argument!.premises = [{ miniId: "P1", formula: "(P implies Q) and P" }]
    expect(() => parser.build(r2)).toThrow(/implication/i)

    // UNDECLARED_VARIABLE_SYMBOL
    const r3 = validResponse()
    r3.argument!.premises.push({ miniId: "P3", formula: "X" })
    expect(() => parser.build(r3)).toThrow(/X/)

    // UNRESOLVED_CLAIM_MINIID
    const r4 = validResponse()
    r4.argument!.variables = [{ miniId: "V1", symbol: "P", claimMiniId: "C99" }]
    r4.argument!.premises = [{ miniId: "P1", formula: "P" }]
    r4.argument!.conclusionPremiseMiniId = "P1"
    expect(() => parser.build(r4)).toThrow(/C99/)

    // UNRESOLVED_SOURCE_MINIID
    const r5 = validResponse()
    r5.argument!.claims[0].sourceMiniIds = ["BOGUS"]
    expect(() => parser.build(r5)).toThrow(/BOGUS/)

    // UNRESOLVED_CONCLUSION_MINIID
    const r6 = validResponse()
    r6.argument!.conclusionPremiseMiniId = "P99"
    expect(() => parser.build(r6)).toThrow(/P99/)
})
```

- [ ] **Step 4: Run all new tests**

Run: `pnpm vitest run test/core.test.ts -t "build lenient mode"`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add test/core.test.ts
git commit -m "test(parser): cascade, edge case, and strict regression tests for lenient mode"
```

---

### Task 9: MiniId prompt guidance

**Files:**

- Modify: `src/lib/parsing/prompt-builder.ts:26-87` (CORE_PROMPT)
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("Parsing — prompt builder", ...)` block in `test/core.test.ts`:

```typescript
it("includes miniId prefix conventions", () => {
    const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
    expect(prompt).toContain("MiniId Conventions")
    expect(prompt).toContain("c1")
    expect(prompt).toContain("s1")
    expect(prompt).toContain("v1")
    expect(prompt).toContain("p1")
    expect(prompt).toContain("sourceMiniIds")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "includes miniId prefix conventions"`
Expected: FAIL — prompt doesn't contain "MiniId Conventions"

- [ ] **Step 3: Add conventions section to CORE_PROMPT**

In `src/lib/parsing/prompt-builder.ts`, insert the following section into `CORE_PROMPT` after the "Writing Style" section (before the closing backtick on line 87):

```

## MiniId Conventions

Each entity type uses a distinct prefix for its miniId to avoid cross-reference confusion:

- Claims: \`c1\`, \`c2\`, \`c3\`, ...
- Sources: \`s1\`, \`s2\`, \`s3\`, ...
- Variables: \`v1\`, \`v2\`, \`v3\`, ...
- Premises: \`p1\`, \`p2\`, \`p3\`, ...

Always use the correct prefix when referencing entities. For example, a claim's sourceMiniIds array should contain source miniIds (e.g., ["s1", "s2"]), not claim miniIds.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "includes miniId prefix conventions"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsing/prompt-builder.ts test/core.test.ts
git commit -m "feat(parser): add miniId prefix conventions to LLM prompt"
```

---

### Task 10: CLI integration

**Files:**

- Modify: `src/cli/output.ts` (add `printWarning`)
- Modify: `src/cli/commands/parse.ts:164-173` (build call and warning display)

- [ ] **Step 1: Add `printWarning` to `src/cli/output.ts`**

The CLI's `output.ts` has `printLine` (stdout), `printJson` (stdout), and `errorExit` (stderr + exit). Add a non-exiting stderr function:

```typescript
export function printWarning(message: string): void {
    process.stderr.write(message + "\n")
}
```

- [ ] **Step 2: Update CLI parse command to use lenient mode**

In `src/cli/commands/parse.ts`, change the build call (line 167) from:

```typescript
built = parser.build(response)
```

to:

```typescript
built = parser.build(response, { strict: false })
```

- [ ] **Step 3: Import and display warnings after build**

Add `printWarning` to the import from `../output.js` (line 13). After the build `try/catch` block (after line 173), add:

```typescript
if (built.warnings.length > 0) {
    for (const w of built.warnings) {
        printWarning(`[${w.code}] ${w.message}`)
    }
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/output.ts src/cli/commands/parse.ts
git commit -m "feat(cli): use lenient parser mode and display warnings"
```

---

### Task 11: Final checks and documentation sync

**Files:**

- Check: `pnpm run check`
- Check: docs per CLAUDE.md Documentation Sync section

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, prettier, tests, build all PASS

- [ ] **Step 2: Fix any lint issues**

Run: `pnpm eslint . --fix` if needed, then `pnpm run prettify`.

- [ ] **Step 3: Check documentation sync triggers**

Per CLAUDE.md Documentation Sync, check:

- `docs/api-reference.md` [Public-API] — update if `TArgumentParserResult`, `build()` signature, or new types are documented there
- `src/lib/core/interfaces/argument-engine.interfaces.ts` — no change needed (parser is not engine)
- `CLAUDE.md` — no design rule changes needed

- [ ] **Step 4: Update `docs/api-reference.md` if needed**

If the API reference documents `ArgumentParser.build()` or `TArgumentParserResult`, add the `options` parameter and `warnings` field. Add entries for `TParserWarning`, `TParserWarningCode`, `TParserBuildOptions`.

- [ ] **Step 5: Commit any doc updates**

```bash
git add -A
git commit -m "docs: update API reference for lenient parser mode"
```

- [ ] **Step 6: Final full check**

Run: `pnpm run check`
Expected: All PASS
