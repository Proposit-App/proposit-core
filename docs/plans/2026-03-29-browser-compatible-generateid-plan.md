# Browser-Compatible `generateId` Injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all direct `randomUUID` imports from `node:crypto` in library files with an injectable `generateId` option, making the library browser-compatible.

**Architecture:** Add `generateId?: () => string` to `TLogicEngineOptions` (and `TPropositCoreConfig`), thread it bottom-up through ExpressionManager → PremiseEngine → ArgumentEngine → ArgumentLibrary → PropositCore, and separately through ArgumentParser and fork.ts. Default to `globalThis.crypto.randomUUID()` which works in all modern runtimes. CLI files are Node.js-only and keep their `node:crypto` imports.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| Action | File                                            | Responsibility                                                                                 |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Modify | `src/lib/core/argument-engine.ts`               | Add `generateId` to `TLogicEngineOptions`, export `defaultGenerateId`, store and use in engine |
| Modify | `src/lib/core/expression-manager.ts`            | Store and use `generateId` for auto-formula buffer IDs (6 sites)                               |
| Modify | `src/lib/core/premise-engine.ts`                | Store and use `generateId` for toggleNegation/changeOperator IDs (5 sites)                     |
| Modify | `src/lib/core/variable-manager.ts`              | No `randomUUID` calls — just remove unused import                                              |
| Modify | `src/lib/core/argument-library.ts`              | Thread `generateId` through `fromSnapshot`                                                     |
| Modify | `src/lib/core/proposit-core.ts`                 | Store `generateId`, use in `forkArgument`, thread to `ArgumentLibrary`                         |
| Modify | `src/lib/core/interfaces/library.interfaces.ts` | Add `generateId` to `TPropositCoreConfig`                                                      |
| Modify | `src/lib/parsing/argument-parser.ts`            | Accept `generateId` in build options, use for all entity IDs                                   |
| Modify | `src/lib/parsing/types.ts`                      | Add `generateId` to `TParserBuildOptions`                                                      |
| Modify | `src/lib/core/fork.ts`                          | Change default from `node:crypto` to `defaultGenerateId`                                       |
| Modify | `test/core.test.ts`                             | Add tests for `generateId` injection at every level                                            |

---

## Mock ID Generator (used across all tests)

```typescript
function mockIdGenerator() {
    let counter = 0
    return () => `mock-id-${++counter}`
}
```

---

### Task 1: Add `generateId` to type definitions

**Files:**

- Modify: `src/lib/core/argument-engine.ts:90-94` — `TLogicEngineOptions` type + `defaultGenerateId` export
- Modify: `src/lib/core/interfaces/library.interfaces.ts:432-439` — `TPropositCoreConfig` type
- Modify: `src/lib/parsing/types.ts:30-32` — `TParserBuildOptions` type

- [ ] **Step 1: Add `generateId` to `TLogicEngineOptions` and export `defaultGenerateId`**

In `src/lib/core/argument-engine.ts`, remove the `import { randomUUID } from "node:crypto"` on line 1 and add the default + field:

```typescript
/** Default ID generator using the Web Crypto API (Node.js 20+, all modern browsers). */
export const defaultGenerateId = (): string => globalThis.crypto.randomUUID()

export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
    grammarConfig?: TGrammarConfig
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}
```

- [ ] **Step 2: Add `generateId` to `TPropositCoreConfig`**

In `src/lib/core/interfaces/library.interfaces.ts:432-439`:

```typescript
export type TPropositCoreConfig = {
    /** Checksum config shared across all libraries and engines. */
    checksumConfig?: TCoreChecksumConfig
    /** Position config for argument engines. */
    positionConfig?: TCorePositionConfig
    /** Grammar config for argument engines. */
    grammarConfig?: TGrammarConfig
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}
```

- [ ] **Step 3: Add `generateId` to `TParserBuildOptions`**

In `src/lib/parsing/types.ts`:

```typescript
export type TParserBuildOptions = {
    strict?: boolean
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm run typecheck`
Expected: PASS (no breaking changes yet — all additions are optional)

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/interfaces/library.interfaces.ts src/lib/parsing/types.ts
git commit -m "feat: add generateId to TLogicEngineOptions, TPropositCoreConfig, and TParserBuildOptions"
```

---

### Task 2: ExpressionManager — inject and use `generateId`

**Files:**

- Modify: `src/lib/core/expression-manager.ts` — store `generateId`, replace 6 call sites
- Test: `test/core.test.ts` — new describe block

ExpressionManager uses `randomUUID()` in 6 places — all for auto-inserting formula buffer expressions in `addExpression`, `insertExpression`, and `wrapExpression`. The `config` property already stores `TLogicEngineOptions`, so we extract `generateId` from it.

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts` (before the final `})`):

```typescript
// ---------------------------------------------------------------------------
// generateId injection — ExpressionManager
// ---------------------------------------------------------------------------

describe("generateId injection — ExpressionManager", () => {
    it("uses injected generateId for auto-formula buffers in addExpression", () => {
        let counter = 0
        const generateId = () => `em-id-${++counter}`

        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: true,
            },
            generateId,
        })

        // Root AND
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        // Add nested OR — should auto-insert a formula buffer
        em.addExpression(
            makeOpExpr("op-or", "or", { parentId: "op-and", position: 0 })
        )

        const allExprs = em.toArray()
        const formulaExpr = allExprs.find((e) => e.type === "formula")
        expect(formulaExpr).toBeDefined()
        expect(formulaExpr!.id).toMatch(/^em-id-/)
    })

    it("uses default generateId when none provided", () => {
        const em = new ExpressionManager({
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: true,
            },
        })

        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeOpExpr("op-or", "or", { parentId: "op-and", position: 0 })
        )

        const allExprs = em.toArray()
        const formulaExpr = allExprs.find((e) => e.type === "formula")
        expect(formulaExpr).toBeDefined()
        // Default produces a valid UUID-format string
        expect(formulaExpr!.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ExpressionManager"`
Expected: FAIL — `generateId` is not read from config yet

- [ ] **Step 3: Implement — store and use `generateId` in ExpressionManager**

In `src/lib/core/expression-manager.ts`:

1. Remove line 1: `import { randomUUID } from "node:crypto"`
2. Add import: `import { defaultGenerateId } from "./argument-engine.js"`
3. Add private field after `private config?: TLogicEngineOptions`:

```typescript
private generateId: () => string
```

4. In constructor, after `this.config = config`:

```typescript
this.generateId = config?.generateId ?? defaultGenerateId
```

5. Replace all 6 occurrences of `randomUUID()` with `this.generateId()`:
    - Line 315: `const formulaId = this.generateId()`
    - Line 1369: `const formulaId = this.generateId()`
    - Line 1426: `const formulaId = this.generateId()`
    - Line 1675: `const formulaId = this.generateId()`
    - Line 1731: `const formulaId = this.generateId()`
    - Line 1768: `const formulaId = this.generateId()`

6. In `fromSnapshot`, ensure `generateId` is preserved through config normalization. The existing code creates `normalizedConfig` from `snapshot.config` — `generateId` (a function) won't survive JSON serialization but that's expected. After restoration, the default is used. No code change needed here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ExpressionManager"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass (existing tests use default, which now calls `globalThis.crypto.randomUUID()`)

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/expression-manager.ts test/core.test.ts
git commit -m "feat(expression-manager): use injected generateId for formula buffer IDs"
```

---

### Task 3: PremiseEngine — inject and use `generateId`

**Files:**

- Modify: `src/lib/core/premise-engine.ts` — store `generateId`, replace 5 call sites
- Test: `test/core.test.ts` — new describe block

PremiseEngine uses `randomUUID()` in 5 places: 3 in `toggleNegation` (formula + not expressions when wrapping operators) and 2 in `changeOperator` (formula + new operator for sub-expression grouping).

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// generateId injection — PremiseEngine
// ---------------------------------------------------------------------------

describe("generateId injection — PremiseEngine", () => {
    it("uses injected generateId for toggleNegation wrapper IDs", () => {
        let counter = 0
        const generateId = () => `pe-id-${++counter}`

        const vm = new VariableManager<TCorePropositionalVariable>()
        vm.addVariable(VAR_P)

        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
            } as TCorePremise,
            { argument: ARG, variables: vm },
            { generateId }
        )

        // Add a single variable expression
        pe.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )

        // Toggle negation wraps it with a NOT — the NOT's ID should use generateId
        pe.toggleNegation("v-p")

        const allExprs = pe.getExpressions()
        const notExpr = allExprs.find(
            (e) => e.type === "operator" && e.operator === "not"
        )
        expect(notExpr).toBeDefined()
        expect(notExpr!.id).toMatch(/^pe-id-/)
    })

    it("uses injected generateId for changeOperator sub-expression IDs", () => {
        let counter = 0
        const generateId = () => `pe-id-${++counter}`

        const vm = new VariableManager<TCorePropositionalVariable>()
        vm.addVariable(VAR_P)
        vm.addVariable(VAR_Q)
        vm.addVariable(VAR_R)

        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
            } as TCorePremise,
            { argument: ARG, variables: vm },
            {
                generateId,
                grammarConfig: {
                    enforceFormulaBetweenOperators: true,
                    autoNormalize: true,
                },
            }
        )

        // Build: AND(P, Q, R) — 3 children
        pe.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        pe.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("v-q", "var-q", { parentId: "op-and", position: 1 })
        )
        pe.addExpression(
            makeVarExpr("v-r", "var-r", { parentId: "op-and", position: 2 })
        )

        // changeOperator groups two siblings under a new sub-operator
        // This creates new formula + operator IDs
        pe.changeOperator("v-p", "v-q", "or")

        const allExprs = pe.getExpressions()
        const generatedExprs = allExprs.filter((e) => e.id.startsWith("pe-id-"))
        // Should have generated at least the sub-operator + formula buffer IDs
        expect(generatedExprs.length).toBeGreaterThanOrEqual(2)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — PremiseEngine"`
Expected: FAIL — PremiseEngine doesn't extract `generateId` from config yet

- [ ] **Step 3: Implement — store and use `generateId` in PremiseEngine**

In `src/lib/core/premise-engine.ts`:

1. Remove line 1: `import { randomUUID } from "node:crypto"`
2. Add import: `import { defaultGenerateId } from "./argument-engine.js"`
3. Add private field after `private expressionIndex?: Map<string, string>`:

```typescript
private generateId: () => string
```

4. In constructor (around line 140), after `this.expressionIndex = deps.expressionIndex`:

```typescript
this.generateId = config?.generateId ?? defaultGenerateId
```

5. Replace all 5 occurrences of `randomUUID()` with `this.generateId()`:
    - Line 839: `id: this.generateId(),` (toggleNegation — formula when wrapping non-not operator)
    - Line 854: `id: this.generateId(),` (toggleNegation — not operator when wrapping non-not operator)
    - Line 872: `id: this.generateId(),` (toggleNegation — not operator in simple case)
    - Line 1086: `const formulaId = this.generateId()` (changeOperator — formula)
    - Line 1087: `const newOpId = this.generateId()` (changeOperator — new sub-operator)

6. In `fromSnapshot` (around line 1960), ensure `generateId` from the normalized config flows through to the new PremiseEngine. The existing code already passes `normalizedConfig` or `loadingConfig` to the constructor, so no additional change is needed — the constructor picks up `generateId` if present in the config.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — PremiseEngine"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/premise-engine.ts test/core.test.ts
git commit -m "feat(premise-engine): use injected generateId for toggleNegation and changeOperator IDs"
```

---

### Task 4: ArgumentEngine — inject and use `generateId`, thread to children

**Files:**

- Modify: `src/lib/core/argument-engine.ts` — store `generateId`, use in `createPremise` + auto-variable, pass to children
- Test: `test/core.test.ts` — new describe block

ArgumentEngine uses `randomUUID()` in 2 places: `createPremise` (line 532, to generate premise ID) and auto-variable creation inside `createPremiseWithId` (line 596, to generate variable ID). It also creates PremiseEngine instances and VariableManager, which need the `generateId` threaded through.

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// generateId injection — ArgumentEngine
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentEngine", () => {
    it("uses injected generateId for createPremise and auto-variable IDs", () => {
        let counter = 0
        const generateId = () => `ae-id-${++counter}`

        const engine = new ArgumentEngine(ARG, aLib(), sLib(), csLib(), {
            generateId,
        })

        const { result: pm } = engine.createPremise()

        // Premise ID should come from generateId
        expect(pm.getId()).toBe("ae-id-1")

        // Auto-created premise-bound variable should also use generateId
        const vars = engine.getVariables()
        expect(vars.length).toBe(1)
        expect(vars[0].id).toBe("ae-id-2")
    })

    it("threads generateId to PremiseEngine for formula buffer creation", () => {
        let counter = 0
        const generateId = () => `ae-id-${++counter}`

        const claimLib = aLib()
        const engine = new ArgumentEngine(ARG, claimLib, sLib(), csLib(), {
            generateId,
            grammarConfig: {
                enforceFormulaBetweenOperators: true,
                autoNormalize: true,
            },
        })

        engine.addVariable(makeVar("var-p", "P"))
        engine.addVariable(makeVar("var-q", "Q"))

        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build AND(P, Q) — needs no formula buffer
        pm.addExpression(
            makeOpExpr("op-and", "and", {
                parentId: null,
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("v-p", "var-p", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("v-q", "var-q", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        // Add nested OR under AND — should auto-insert formula buffer with generateId
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "op-and",
                position: 2,
                premiseId,
            })
        )

        const allExprs = pm.getExpressions()
        const formulaExpr = allExprs.find((e) => e.type === "formula")
        expect(formulaExpr).toBeDefined()
        expect(formulaExpr!.id).toMatch(/^ae-id-/)
    })

    it("falls back to default generateId when none provided", () => {
        const engine = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        const { result: pm } = engine.createPremise()

        // Default generates valid UUIDs
        expect(pm.getId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ArgumentEngine"`
Expected: FAIL — ArgumentEngine doesn't use `generateId` from options yet

- [ ] **Step 3: Implement — store `generateId` and thread through**

In `src/lib/core/argument-engine.ts`:

1. The `import { randomUUID } from "node:crypto"` on line 1 has already been removed in Task 1 (when we added `defaultGenerateId`). Verify it's gone.

2. Add private field after `private grammarConfig?: TGrammarConfig` (around line 145):

```typescript
private generateId: () => string
```

3. In constructor (around line 180), after `this.grammarConfig = options?.grammarConfig`:

```typescript
this.generateId = options?.generateId ?? defaultGenerateId
```

4. Thread `generateId` to VariableManager — update the constructor call (around line 181):

```typescript
this.variables = new VariableManager<TVar>({
    checksumConfig: this.checksumConfig,
    positionConfig: this.positionConfig,
    generateId: this.generateId,
})
```

(VariableManager stores config but doesn't use `randomUUID` — this is for config completeness.)

5. Thread `generateId` to PremiseEngine in `createPremiseWithId` (around line 563):

```typescript
{
    checksumConfig: this.checksumConfig,
    positionConfig: this.positionConfig,
    grammarConfig: this.grammarConfig,
    generateId: this.generateId,
}
```

6. Replace `randomUUID()` in `createPremise` (line 532):

```typescript
return this.createPremiseWithId(this.generateId(), extras, symbol)
```

7. Replace `randomUUID()` in auto-variable creation (line 596):

```typescript
id: this.generateId(),
```

8. Thread `generateId` to PremiseEngine in `fromSnapshot` (around line 1220). The `fromSnapshot` creates PremiseEngine via `PremiseEngine.fromSnapshot` which reads config from the snapshot. Since `generateId` is lost during JSON serialization, we need to merge it in. Update `fromSnapshot` to accept `generateId` and thread it:

Add a new parameter to `fromSnapshot`:

```typescript
public static fromSnapshot<...>(
    snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>,
    claimLibrary: TClaimLookup<TClaim>,
    sourceLibrary: TSourceLookup<TSource>,
    claimSourceLibrary: TClaimSourceLookup<TAssoc>,
    grammarConfig?: TGrammarConfig,
    checksumVerification?: "ignore" | "strict",
    generateId?: () => string
): ArgumentEngine<...> {
```

When constructing the engine, merge `generateId` into the options:

```typescript
const engine = new ArgumentEngine<...>(
    snapshot.argument,
    claimLibrary,
    sourceLibrary,
    claimSourceLibrary,
    snapshot.config
        ? {
              ...snapshot.config,
              checksumConfig: normalizeChecksumConfig(
                  snapshot.config.checksumConfig
              ),
              generateId: generateId ?? snapshot.config.generateId,
          }
        : generateId
          ? { generateId }
          : undefined
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ArgumentEngine"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(argument-engine): use injected generateId for premise and auto-variable IDs"
```

---

### Task 5: ArgumentLibrary — thread `generateId` through `fromSnapshot`

**Files:**

- Modify: `src/lib/core/argument-library.ts:230-244` — pass `generateId` from options to engine `fromSnapshot`
- Test: `test/core.test.ts` — new describe block

ArgumentLibrary creates engines and restores them from snapshots. It already passes `TLogicEngineOptions` to engine constructors via `create()`. For `fromSnapshot`, it needs to forward `generateId` to `ArgumentEngine.fromSnapshot`.

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// generateId injection — ArgumentLibrary
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentLibrary", () => {
    it("threads generateId to engines created via create()", () => {
        let counter = 0
        const generateId = () => `al-id-${++counter}`

        const lib = new ArgumentLibrary(
            {
                claimLibrary: aLib(),
                sourceLibrary: sLib(),
                claimSourceLibrary: csLib(),
            },
            { generateId }
        )

        const engine = lib.create({ id: "arg-1", version: 0 })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toBe("al-id-1")
    })

    it("threads generateId through fromSnapshot restoration", () => {
        let counter = 0
        const generateId = () => `al-snap-id-${++counter}`

        // Create library with one engine + one premise
        const origLib = new ArgumentLibrary(
            {
                claimLibrary: aLib(),
                sourceLibrary: sLib(),
                claimSourceLibrary: csLib(),
            },
            { generateId }
        )
        const origEngine = origLib.create({ id: "arg-1", version: 0 })
        origEngine.createPremise()

        // Snapshot, then restore with a NEW generateId
        const snap = origLib.snapshot()
        let restoreCounter = 0
        const restoreGenerateId = () => `restored-id-${++restoreCounter}`

        const restoredLib = ArgumentLibrary.fromSnapshot(
            snap,
            {
                claimLibrary: aLib(),
                sourceLibrary: sLib(),
                claimSourceLibrary: csLib(),
            },
            { generateId: restoreGenerateId }
        )

        // New mutations on the restored engine should use the new generateId
        const restoredEngine = restoredLib.get("arg-1")!
        const { result: newPm } = restoredEngine.createPremise()
        expect(newPm.getId()).toBe("restored-id-1")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ArgumentLibrary"`
Expected: FAIL — `fromSnapshot` doesn't forward `generateId` to restored engines

- [ ] **Step 3: Implement — thread `generateId` through `fromSnapshot`**

In `src/lib/core/argument-library.ts`, update the `fromSnapshot` method (around line 229-249):

Pass `options?.generateId` as the last argument to `ArgumentEngine.fromSnapshot`:

```typescript
const engine = ArgumentEngine.fromSnapshot<
    TArg,
    TPremise,
    TExpr,
    TVar,
    TSource,
    TClaim,
    TAssoc
>(
    engineSnap,
    libraries.claimLibrary,
    libraries.sourceLibrary,
    libraries.claimSourceLibrary,
    undefined,
    "ignore",
    options?.generateId
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ArgumentLibrary"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-library.ts test/core.test.ts
git commit -m "feat(argument-library): thread generateId through fromSnapshot"
```

---

### Task 6: PropositCore — store `generateId`, thread through, use in `forkArgument`

**Files:**

- Modify: `src/lib/core/proposit-core.ts` — store `generateId`, thread to `ArgumentLibrary`, use in `forkArgument`
- Test: `test/core.test.ts` — new describe block

PropositCore uses `randomUUID()` in 4 places inside `forkArgument`: forkId (line 444), claim cloning (line 473), source cloning (line 506), and association cloning (line 529).

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// generateId injection — PropositCore
// ---------------------------------------------------------------------------

describe("generateId injection — PropositCore", () => {
    it("threads generateId to ArgumentLibrary for engine creation", () => {
        let counter = 0
        const generateId = () => `pc-id-${++counter}`

        const core = new PropositCore({ generateId })
        const engine = core.arguments.create({ id: "arg-1", version: 0 })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toBe("pc-id-1")
    })

    it("uses generateId in forkArgument for library-level entities", () => {
        let counter = 0
        const generateId = () => `pc-id-${++counter}`

        const core = new PropositCore({ generateId })
        const engine = core.arguments.create({
            id: "pc-id-1",
            version: 0,
        })

        // Add a claim-bound variable and a premise with a formula
        const claim = core.claims.create({ id: "pc-id-2" })
        engine.addVariable({
            id: "pc-id-3",
            argumentId: "pc-id-1",
            argumentVersion: 0,
            symbol: "P",
            claimId: claim.id,
            claimVersion: claim.version,
        })
        engine.createPremise()

        // Fork — should use generateId for new claim, source, and fork IDs
        const result = core.forkArgument("pc-id-1")

        // All generated IDs should match our pattern
        expect(result.engine.getArgument().id).toMatch(/^pc-id-/)
        expect(result.claimRemap.size).toBeGreaterThanOrEqual(1)
        for (const newClaimId of result.claimRemap.values()) {
            expect(newClaimId).toMatch(/^pc-id-/)
        }
    })

    it("falls back to default generateId", () => {
        const core = new PropositCore()
        const engine = core.arguments.create({
            id: crypto.randomUUID(),
            version: 0,
        })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — PropositCore"`
Expected: FAIL — PropositCore doesn't store or use `generateId` yet

- [ ] **Step 3: Implement — store and use `generateId` in PropositCore**

In `src/lib/core/proposit-core.ts`:

1. Remove line 1: `import { randomUUID } from "node:crypto"`
2. Add import: `import { defaultGenerateId } from "./argument-engine.js"`
3. Add protected field (alongside the other library fields, around line 128):

```typescript
protected generateId: () => string
```

4. In constructor (around line 149), before the library creation:

```typescript
this.generateId = options?.generateId ?? defaultGenerateId
```

5. Thread `generateId` to `ArgumentLibrary` (around line 196-200):

```typescript
{
    checksumConfig: options?.checksumConfig,
    positionConfig: options?.positionConfig,
    grammarConfig: options?.grammarConfig,
    generateId: this.generateId,
}
```

6. Replace `randomUUID()` calls in `forkArgument`:
    - Line 444: `const forkId = options?.forkId ?? this.generateId()`
    - Line 473: `const newClaimId = this.generateId()`
    - Line 506: `const newSourceId = this.generateId()`
    - Line 529: `id: this.generateId(),`

7. Pass `generateId` as the default for `forkArgumentEngine` when the caller didn't provide one (around the call to `forkArgumentEngine`). Find the call and ensure `generateId` is defaulted:

```typescript
const forkResult = forkArgumentEngine<...>(engine, {
    ...options,
    generateId: options?.generateId ?? this.generateId,
})
```

(If the existing code already passes `options` directly, wrap it to merge the default.)

8. In `fromSnapshot` (static method around line 273), thread `generateId` from the `config` parameter to the `ArgumentLibrary` restoration. Update the call to `ArgumentLibrary.fromSnapshot` to include `generateId` from `config`:

The `config?: TPropositCoreConfig` parameter already has `generateId` (from Task 1). Thread it:

```typescript
const argLib = ArgumentLibrary.fromSnapshot(
    snapshot.arguments,
    {
        claimLibrary: claimLib,
        sourceLibrary: sourceLib,
        claimSourceLibrary: csLib,
    },
    {
        checksumConfig: config?.checksumConfig,
        positionConfig: config?.positionConfig,
        grammarConfig: config?.grammarConfig,
        generateId: config?.generateId,
    }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — PropositCore"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/proposit-core.ts test/core.test.ts
git commit -m "feat(proposit-core): use injected generateId for fork and library operations"
```

---

### Task 7: ArgumentParser — accept and use `generateId`

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts` — read `generateId` from options, pass to helper and engine
- Test: `test/core.test.ts` — new describe block

ArgumentParser uses `randomUUID()` in 6 places inside `build()`: expression IDs (via `buildExpressions` helper), argument ID, claim IDs, source IDs, association IDs, and variable IDs.

- [ ] **Step 1: Write the failing test**

Add to `test/core.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// generateId injection — ArgumentParser
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentParser", () => {
    it("uses injected generateId for all entity IDs", () => {
        let counter = 0
        const generateId = () => `parser-id-${++counter}`

        const parser = new ArgumentParser()

        const response: TParsedArgumentResponse = {
            argument: {
                title: "Test argument",
                description: "Test",
                claims: [
                    {
                        miniId: "C1",
                        text: "Claim one",
                        sourceMiniIds: [],
                    },
                ],
                variables: [
                    {
                        miniId: "V1",
                        symbol: "P",
                        claimMiniId: "C1",
                    },
                ],
                sources: [],
                premises: [
                    {
                        miniId: "P1",
                        formula: "P",
                        text: "Premise one",
                    },
                ],
                conclusionMiniId: "P1",
            },
        }

        const result = parser.build(response, { generateId })

        // Argument ID
        expect(result.engine.getArgument().id).toMatch(/^parser-id-/)

        // Variable IDs
        const vars = result.engine.getVariables()
        expect(vars.length).toBe(1)
        expect(vars[0].id).toMatch(/^parser-id-/)

        // Claim IDs
        const claims = result.claimLibrary.getAll()
        expect(claims.length).toBe(1)
        expect(claims[0].id).toMatch(/^parser-id-/)

        // Expression IDs
        const premises = result.engine.getPremises()
        expect(premises.length).toBe(1)
        const exprs = premises[0].getExpressions()
        for (const expr of exprs) {
            expect(expr.id).toMatch(/^parser-id-/)
        }
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ArgumentParser"`
Expected: FAIL — parser doesn't read `generateId` from options

- [ ] **Step 3: Implement — thread `generateId` through ArgumentParser**

In `src/lib/parsing/argument-parser.ts`:

1. Remove line 1: `import { randomUUID } from "node:crypto"`
2. Add import: `import { defaultGenerateId } from "../core/argument-engine.js"`

3. Update the `buildExpressions` helper function signature (around line 116) to accept `generateId`:

```typescript
function buildExpressions(
    ast: TFormulaAST,
    parentId: string | null,
    position: number,
    argumentId: string,
    argumentVersion: number,
    premiseId: string,
    variablesBySymbol: Map<string, Omit<TClaimBoundVariable, "checksum">>,
    addExpression: (expr: TExpressionInput) => void,
    generateId: () => string
): string {
    const id = generateId()
```

4. Update all recursive calls to `buildExpressions` (inside the function) to pass `generateId` as the last argument. There are recursive calls for `not`, `and`/`or`, and `implies`/`iff` branches.

5. In the `build` method (around line 271), extract `generateId` from options:

```typescript
const genId = options?.generateId ?? defaultGenerateId
```

6. Replace all `randomUUID()` calls in `build` with `genId()`:
    - Line 342: `const argumentId = genId()`
    - Line 360: `const claimId = genId()`
    - Line 380: `const sourceId = genId()`
    - Line 424: `id: genId(),`
    - Line 478: `id: genId(),`

7. Pass `genId` to the `buildExpressions` call (around line 530+, where formulas are built into expressions):

```typescript
buildExpressions(
    entry.ast,
    null,
    POSITION_INITIAL,
    argumentId,
    argumentVersion,
    premiseId,
    variablesBySymbol,
    (expr) => premiseEngine.addExpression(expr),
    genId
)
```

8. Pass `generateId` to the `ArgumentEngine` constructor (around line 442):

```typescript
const engine = new ArgumentEngine<...>(
    argument, claimLibrary, sourceLibrary, claimSourceLibrary, {
        grammarConfig: {
            enforceFormulaBetweenOperators: true,
            autoNormalize: true,
        },
        generateId: genId,
    }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/core.test.ts -t "generateId injection — ArgumentParser"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/argument-parser.ts src/lib/parsing/types.ts test/core.test.ts
git commit -m "feat(argument-parser): use injected generateId for all entity IDs"
```

---

### Task 8: fork.ts — align default with `defaultGenerateId`

**Files:**

- Modify: `src/lib/core/fork.ts` — replace `node:crypto` import with `defaultGenerateId`

- [ ] **Step 1: Verify existing fork tests pass**

Run: `pnpm vitest run test/core.test.ts -t "forkArgument"`
Expected: PASS

- [ ] **Step 2: Implement — replace import**

In `src/lib/core/fork.ts`:

1. Remove line 1: `import { randomUUID } from "node:crypto"`
2. Add import: `import { defaultGenerateId } from "./argument-engine.js"`
3. Update line 69:

```typescript
const generateId = options?.generateId ?? defaultGenerateId
```

- [ ] **Step 3: Run fork tests to verify**

Run: `pnpm vitest run test/core.test.ts -t "forkArgument"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/fork.ts
git commit -m "refactor(fork): use defaultGenerateId instead of node:crypto"
```

---

### Task 9: Remove unused `node:crypto` imports from `variable-manager.ts`

**Files:**

- Modify: `src/lib/core/variable-manager.ts` — remove unused import

VariableManager imports `randomUUID` from `node:crypto` but never calls it.

- [ ] **Step 1: Remove the import**

In `src/lib/core/variable-manager.ts`, remove line 1 if it is:

```typescript
import { randomUUID } from "node:crypto"
```

(If VariableManager does not actually import `randomUUID`, skip this step — double-check first.)

- [ ] **Step 2: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 3: Run full check suite**

Run: `pnpm run check`
Expected: All checks pass (typecheck, lint, test, build)

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/variable-manager.ts
git commit -m "chore: remove unused node:crypto import from variable-manager"
```

---

### Task 10: Verify no `node:crypto` imports remain in library files

- [ ] **Step 1: Search for remaining `node:crypto` imports in `src/lib/`**

Run: `grep -r "node:crypto" src/lib/`
Expected: No results. All library files should now use `defaultGenerateId` instead.

- [ ] **Step 2: Verify CLI files still have their imports**

Run: `grep -r "node:crypto" src/cli/`
Expected: `src/cli/import.ts`, `src/cli/commands/expressions.ts`, `src/cli/commands/sources.ts` still import from `node:crypto` (CLI is Node.js only — no change needed).

- [ ] **Step 3: Run `pnpm run check`**

Run: `pnpm run check`
Expected: All checks pass (typecheck, lint, prettier, test, build)

- [ ] **Step 4: Verify `defaultGenerateId` is exported from barrel**

Run: `grep "defaultGenerateId" src/lib/index.ts src/index.ts`
Expected: Exported (if not, add the re-export from `src/lib/index.ts`).

- [ ] **Step 5: Commit (if any re-exports were added)**

```bash
git add src/lib/index.ts
git commit -m "chore: export defaultGenerateId from library barrel"
```

---

### Task 11: Update documentation

**Files:**

- Modify: `CLAUDE.md` — update design rules
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`
- Delete: `docs/change-requests/2026-03-29-browser-compatible-randomuuid.md`

- [ ] **Step 1: Update CLAUDE.md**

Add a new design rule entry (in the "Key design rules" section):

> **`generateId` injection:** All entity ID generation in library files uses `generateId` from `TLogicEngineOptions` (or `TPropositCoreConfig` / `TParserBuildOptions`). Default is `globalThis.crypto.randomUUID()`. CLI files use `randomUUID` from `node:crypto` directly. Never add `import { randomUUID } from "node:crypto"` to `src/lib/` files.

- [ ] **Step 2: Update release notes**

Append to `docs/release-notes/upcoming.md`:

```markdown
## New: Browser-compatible ID generation

The library no longer imports from `node:crypto`. All entity ID generation now uses a pluggable `generateId` option, defaulting to `globalThis.crypto.randomUUID()` which works in Node.js 20+ and all modern browsers.

Pass a custom `generateId` function through `TLogicEngineOptions`, `TPropositCoreConfig`, or `TParserBuildOptions` to control how entity IDs are generated.
```

- [ ] **Step 3: Update changelog**

Append to `docs/changelogs/upcoming.md`:

```markdown
- `generateId` option added to `TLogicEngineOptions`, `TPropositCoreConfig`, and `TParserBuildOptions`
- `defaultGenerateId` exported from library barrel — uses `globalThis.crypto.randomUUID()`
- Removed `node:crypto` import from all `src/lib/` files (argument-engine, premise-engine, expression-manager, proposit-core, argument-parser, fork)
- `ArgumentEngine.fromSnapshot` accepts optional `generateId` parameter for post-restoration mutations
```

- [ ] **Step 4: Delete the change request**

```bash
rm docs/change-requests/2026-03-29-browser-compatible-randomuuid.md
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git rm docs/change-requests/2026-03-29-browser-compatible-randomuuid.md
git commit -m "docs: update for browser-compatible generateId injection"
```
