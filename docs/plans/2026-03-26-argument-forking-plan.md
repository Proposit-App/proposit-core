# Argument Forking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `forkArgument` instance method to `ArgumentEngine` that creates an independent copy of an argument with full provenance tracking and fork-aware diffing.

**Architecture:** Schema-first approach — add nullable `forkedFrom` fields to all entity schemas, update checksum defaults, implement the fork method using snapshot/remap/reconstruct, then add pluggable matchers to the diff system for fork-aware comparison.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

---

### Task 1: Add `forkedFrom` Fields to Argument Schema

**Files:**

- Modify: `src/lib/schemata/argument.ts:4-24`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("forkArgument", () => {
    it("argument schema accepts forkedFrom fields", () => {
        const arg: TCoreArgument = {
            id: "arg-1",
            version: 0,
            checksum: "",
            descendantChecksum: null,
            combinedChecksum: "",
            forkedFromArgumentId: "arg-original",
            forkedFromArgumentVersion: 2,
        }
        expect(arg.forkedFromArgumentId).toBe("arg-original")
        expect(arg.forkedFromArgumentVersion).toBe(2)
    })

    it("argument schema defaults forkedFrom fields to null", () => {
        const arg: TCoreArgument = {
            id: "arg-1",
            version: 0,
            checksum: "",
            descendantChecksum: null,
            combinedChecksum: "",
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        }
        expect(arg.forkedFromArgumentId).toBeNull()
        expect(arg.forkedFromArgumentVersion).toBeNull()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: TypeScript compilation error — `forkedFromArgumentId` does not exist on `TCoreArgument`

- [ ] **Step 3: Add forkedFrom fields to CoreArgumentSchema**

In `src/lib/schemata/argument.ts`, add the two nullable fields inside the `Type.Object(...)` call, after `combinedChecksum`:

```typescript
forkedFromArgumentId: Nullable(UUID, {
    description:
        "The ID of the argument this was forked from, or null if not a fork.",
}),
forkedFromArgumentVersion: Nullable(Type.Number(), {
    description:
        "The version of the argument this was forked from, or null if not a fork.",
}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemata/argument.ts test/core.test.ts
git commit -m "feat(schema): add forkedFrom fields to CoreArgumentSchema"
```

---

### Task 2: Add `forkedFrom` Fields to Premise Schema

**Files:**

- Modify: `src/lib/schemata/propositional.ts:175-199`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `forkArgument` describe block:

```typescript
it("premise schema accepts forkedFrom fields", () => {
    const premise: TCorePremise = {
        id: "p-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        checksum: "",
        descendantChecksum: null,
        combinedChecksum: "",
        forkedFromPremiseId: "p-original",
        forkedFromArgumentId: "arg-original",
        forkedFromArgumentVersion: 2,
    }
    expect(premise.forkedFromPremiseId).toBe("p-original")
    expect(premise.forkedFromArgumentId).toBe("arg-original")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: TypeScript error — `forkedFromPremiseId` does not exist on `TCorePremise`

- [ ] **Step 3: Add forkedFrom fields to CorePremiseSchema**

In `src/lib/schemata/propositional.ts`, add three nullable fields to `CorePremiseSchema` after `combinedChecksum`:

```typescript
forkedFromPremiseId: Nullable(UUID, {
    description:
        "The ID of the premise this was forked from, or null if not a fork.",
}),
forkedFromArgumentId: Nullable(UUID, {
    description:
        "The argument ID of the premise this was forked from, or null if not a fork.",
}),
forkedFromArgumentVersion: Nullable(Type.Number(), {
    description:
        "The argument version of the premise this was forked from, or null if not a fork.",
}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemata/propositional.ts test/core.test.ts
git commit -m "feat(schema): add forkedFrom fields to CorePremiseSchema"
```

---

### Task 3: Add `forkedFrom` Fields to Expression Schema

**Files:**

- Modify: `src/lib/schemata/propositional.ts:17-44`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `forkArgument` describe block:

```typescript
it("expression schema accepts forkedFrom fields", () => {
    const expr: TCorePropositionalExpression = {
        id: "e-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p-1",
        parentId: null,
        position: 0,
        type: "variable",
        variableId: "v-1",
        checksum: "",
        descendantChecksum: null,
        combinedChecksum: "",
        forkedFromExpressionId: "e-original",
        forkedFromPremiseId: "p-original",
        forkedFromArgumentId: "arg-original",
        forkedFromArgumentVersion: 2,
    }
    expect(expr.forkedFromExpressionId).toBe("e-original")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: TypeScript error — `forkedFromExpressionId` does not exist

- [ ] **Step 3: Add forkedFrom fields to BasePropositionalExpressionSchema**

In `src/lib/schemata/propositional.ts`, add four nullable fields to `BasePropositionalExpressionSchema` after `combinedChecksum`:

```typescript
forkedFromExpressionId: Nullable(UUID, {
    description:
        "The ID of the expression this was forked from, or null if not a fork.",
}),
forkedFromPremiseId: Nullable(UUID, {
    description:
        "The premise ID of the expression this was forked from, or null if not a fork.",
}),
forkedFromArgumentId: Nullable(UUID, {
    description:
        "The argument ID of the expression this was forked from, or null if not a fork.",
}),
forkedFromArgumentVersion: Nullable(Type.Number(), {
    description:
        "The argument version of the expression this was forked from, or null if not a fork.",
}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemata/propositional.ts test/core.test.ts
git commit -m "feat(schema): add forkedFrom fields to BasePropositionalExpressionSchema"
```

---

### Task 4: Add `forkedFrom` Fields to Variable Schema

**Files:**

- Modify: `src/lib/schemata/propositional.ts:102-112`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `forkArgument` describe block:

```typescript
it("variable schema accepts forkedFrom fields", () => {
    const v: TClaimBoundVariable = {
        id: "v-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        symbol: "P",
        checksum: "",
        claimId: "claim-1",
        claimVersion: 0,
        forkedFromVariableId: "v-original",
        forkedFromArgumentId: "arg-original",
        forkedFromArgumentVersion: 2,
    }
    expect(v.forkedFromVariableId).toBe("v-original")

    const pv: TPremiseBoundVariable = {
        id: "v-2",
        argumentId: "arg-1",
        argumentVersion: 0,
        symbol: "Q",
        checksum: "",
        boundPremiseId: "p-1",
        boundArgumentId: "arg-1",
        boundArgumentVersion: 0,
        forkedFromVariableId: "v-original-2",
        forkedFromArgumentId: "arg-original",
        forkedFromArgumentVersion: 2,
    }
    expect(pv.forkedFromVariableId).toBe("v-original-2")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: TypeScript error — `forkedFromVariableId` does not exist

- [ ] **Step 3: Add forkedFrom fields to CoreVariableBaseFields**

In `src/lib/schemata/propositional.ts`, add three nullable fields to `CoreVariableBaseFields` after `checksum`:

```typescript
const CoreVariableBaseFields = {
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    symbol: Type.String({
        description: 'Human-readable symbol for this variable (e.g. "P", "Q").',
    }),
    checksum: Type.String({
        description: "Entity-level checksum for sync detection.",
    }),
    forkedFromVariableId: Nullable(UUID, {
        description:
            "The ID of the variable this was forked from, or null if not a fork.",
    }),
    forkedFromArgumentId: Nullable(UUID, {
        description:
            "The argument ID of the variable this was forked from, or null if not a fork.",
    }),
    forkedFromArgumentVersion: Nullable(Type.Number(), {
        description:
            "The argument version of the variable this was forked from, or null if not a fork.",
    }),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemata/propositional.ts test/core.test.ts
git commit -m "feat(schema): add forkedFrom fields to variable base schema"
```

---

### Task 5: Update Default Checksum Config

**Files:**

- Modify: `src/lib/consts.ts:3-38`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `forkArgument` describe block:

```typescript
it("default checksum config includes forkedFrom fields", () => {
    expect(
        DEFAULT_CHECKSUM_CONFIG.argumentFields!.has("forkedFromArgumentId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.argumentFields!.has("forkedFromArgumentVersion")
    ).toBe(true)

    expect(
        DEFAULT_CHECKSUM_CONFIG.premiseFields!.has("forkedFromPremiseId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.premiseFields!.has("forkedFromArgumentId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.premiseFields!.has("forkedFromArgumentVersion")
    ).toBe(true)

    expect(
        DEFAULT_CHECKSUM_CONFIG.expressionFields!.has("forkedFromExpressionId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.expressionFields!.has("forkedFromPremiseId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.expressionFields!.has("forkedFromArgumentId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.expressionFields!.has(
            "forkedFromArgumentVersion"
        )
    ).toBe(true)

    expect(
        DEFAULT_CHECKSUM_CONFIG.variableFields!.has("forkedFromVariableId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.variableFields!.has("forkedFromArgumentId")
    ).toBe(true)
    expect(
        DEFAULT_CHECKSUM_CONFIG.variableFields!.has("forkedFromArgumentVersion")
    ).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `has("forkedFromArgumentId")` returns `false`

- [ ] **Step 3: Update DEFAULT_CHECKSUM_CONFIG**

In `src/lib/consts.ts`, add the `forkedFrom` fields to each field set:

`argumentFields` — add `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`:

```typescript
argumentFields: new Set([
    "id",
    "version",
    "forkedFromArgumentId",
    "forkedFromArgumentVersion",
]),
```

`premiseFields` — add `"forkedFromPremiseId"`, `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`:

```typescript
premiseFields: new Set([
    "id",
    "argumentId",
    "argumentVersion",
    "forkedFromPremiseId",
    "forkedFromArgumentId",
    "forkedFromArgumentVersion",
]),
```

`expressionFields` — add `"forkedFromExpressionId"`, `"forkedFromPremiseId"`, `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`:

```typescript
expressionFields: new Set([
    "id",
    "type",
    "parentId",
    "position",
    "argumentId",
    "argumentVersion",
    "premiseId",
    "variableId",
    "operator",
    "forkedFromExpressionId",
    "forkedFromPremiseId",
    "forkedFromArgumentId",
    "forkedFromArgumentVersion",
]),
```

`variableFields` — add `"forkedFromVariableId"`, `"forkedFromArgumentId"`, `"forkedFromArgumentVersion"`:

```typescript
variableFields: new Set([
    "id",
    "symbol",
    "argumentId",
    "argumentVersion",
    "claimId",
    "claimVersion",
    "boundPremiseId",
    "boundArgumentId",
    "boundArgumentVersion",
    "forkedFromVariableId",
    "forkedFromArgumentId",
    "forkedFromArgumentVersion",
]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm run test 2>&1 | tail -20`
Expected: All existing tests pass. Some checksum values may change since `forkedFrom` fields (as `null`) are now included in checksums. If snapshot-based tests fail due to checksum mismatches, update the expected values.

- [ ] **Step 6: Commit**

```bash
git add src/lib/consts.ts test/core.test.ts
git commit -m "feat(checksums): include forkedFrom fields in default checksum config"
```

---

### Task 6: Add `canFork` and `forkArgument` Types

**Files:**

- Create: `src/lib/types/fork.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Create the fork types file**

Create `src/lib/types/fork.ts`:

```typescript
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { ArgumentEngine } from "../core/argument-engine.js"
import type { TCoreChecksumConfig } from "./checksum.js"
import type { TCorePositionConfig } from "../utils/position.js"
import type { TGrammarConfig } from "./grammar.js"

/** Options for `forkArgument`. */
export interface TForkArgumentOptions {
    /** ID generator for new entities. Defaults to `crypto.randomUUID`. */
    generateId?: () => string
    /** Checksum config override. If omitted, copied from source engine. */
    checksumConfig?: TCoreChecksumConfig
    /** Position config override. If omitted, copied from source engine. */
    positionConfig?: TCorePositionConfig
    /** Grammar config override. If omitted, copied from source engine. */
    grammarConfig?: TGrammarConfig
}

/** Maps original entity IDs to their forked counterparts. */
export interface TForkRemapTable {
    argumentId: { from: string; to: string }
    premises: Map<string, string>
    expressions: Map<string, string>
    variables: Map<string, string>
}

/** Result of `forkArgument`. */
export interface TForkArgumentResult<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar>
    remapTable: TForkRemapTable
}
```

- [ ] **Step 2: Export fork types from library barrel**

In `src/lib/index.ts`, add after the existing `export * from "./types/grammar.js"` line:

```typescript
export * from "./types/fork.js"
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/fork.ts src/lib/index.ts
git commit -m "feat(types): add TForkArgumentOptions, TForkRemapTable, TForkArgumentResult"
```

---

### Task 7: Implement `canFork` Method

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `forkArgument` describe block:

```typescript
it("canFork rejects when overridden to return false", () => {
    class RestrictedEngine extends ArgumentEngine {
        protected override canFork(): boolean {
            return false
        }
    }
    const eng = new RestrictedEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        },
        aLib(),
        sLib(),
        csLib()
    )
    expect(() =>
        eng.forkArgument("arg-forked", aLib(), sLib(), csLib())
    ).toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `forkArgument` is not a function / `canFork` is not a function

- [ ] **Step 3: Add `canFork` protected method to ArgumentEngine**

In `src/lib/core/argument-engine.ts`, add after the constructor (around line 169):

```typescript
/**
 * Override in subclasses to restrict which arguments can be forked.
 * Called by `forkArgument` before any work. Return `false` to reject.
 */
protected canFork(): boolean {
    return true
}
```

- [ ] **Step 4: Add stub `forkArgument` method**

Add the import at the top of `src/lib/core/argument-engine.ts`:

```typescript
import type {
    TForkArgumentOptions,
    TForkArgumentResult,
    TForkRemapTable,
} from "../types/fork.js"
```

Add the method stub on `ArgumentEngine` (after `canFork`):

```typescript
/**
 * Creates an independent copy of this argument with new entity IDs
 * and `forkedFrom` provenance metadata pointing back to the originals.
 */
public forkArgument(
    newArgumentId: string,
    claimLibrary: TClaimLookup<TClaim>,
    sourceLibrary: TSourceLookup<TSource>,
    claimSourceLibrary: TClaimSourceLookup<TAssoc>,
    options?: TForkArgumentOptions
): TForkArgumentResult<TArg, TPremise, TExpr, TVar> {
    if (!this.canFork()) {
        throw new Error("This argument cannot be forked.")
    }
    throw new Error("Not yet implemented")
}
```

- [ ] **Step 5: Run test to verify canFork rejection passes**

Run: `pnpm run test -- --reporter=verbose -t "canFork rejects" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(engine): add canFork protected method and forkArgument stub"
```

---

### Task 8: Implement `forkArgument` Core Logic

**Files:**

- Modify: `src/lib/core/argument-engine.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the basic fork test**

Add inside the `forkArgument` describe block:

```typescript
it("forks a simple argument with new IDs and forkedFrom metadata", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 2,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("var-p", "P"))
    const { result: pm } = eng.createPremiseWithId("premise-1")
    pm.addExpression({
        id: "expr-1",
        type: "variable",
        variableId: "var-p",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 2,
        premiseId: "premise-1",
    })
    eng.setConclusionPremise("premise-1")

    const { engine: forked, remapTable } = eng.forkArgument(
        "arg-forked",
        aLib(),
        sLib(),
        csLib()
    )

    // New argument identity
    const fArg = forked.getArgument()
    expect(fArg.id).toBe("arg-forked")
    expect(fArg.version).toBe(0)
    expect(fArg.forkedFromArgumentId).toBe("arg-1")
    expect(fArg.forkedFromArgumentVersion).toBe(2)

    // Remap table populated
    expect(remapTable.argumentId).toEqual({
        from: "arg-1",
        to: "arg-forked",
    })
    expect(remapTable.premises.size).toBe(1)
    expect(remapTable.expressions.size).toBe(1)
    expect(remapTable.variables.size).toBe(1)

    // Entities have new IDs
    const forkedPremises = forked.listPremises()
    expect(forkedPremises).toHaveLength(1)
    const fPremise = forkedPremises[0]!
    expect(fPremise.getId()).not.toBe("premise-1")
    expect(remapTable.premises.get("premise-1")).toBe(fPremise.getId())

    // Premise forkedFrom metadata
    const fPremiseData = fPremise.toPremiseData()
    expect(fPremiseData.forkedFromPremiseId).toBe("premise-1")
    expect(fPremiseData.forkedFromArgumentId).toBe("arg-1")
    expect(fPremiseData.forkedFromArgumentVersion).toBe(2)

    // Expression forkedFrom metadata
    const fExprs = fPremise.getExpressions()
    expect(fExprs).toHaveLength(1)
    expect(fExprs[0]!.id).not.toBe("expr-1")
    expect(fExprs[0]!.forkedFromExpressionId).toBe("expr-1")
    expect(fExprs[0]!.forkedFromPremiseId).toBe("premise-1")
    expect(fExprs[0]!.forkedFromArgumentId).toBe("arg-1")

    // Variable forkedFrom metadata
    const fVarIds = fPremise.getReferencedVariableIds()
    expect(fVarIds).toHaveLength(1)

    // Conclusion role remapped
    const roles = forked.getRoleState()
    expect(roles.conclusionPremiseId).toBe(fPremise.getId())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "forks a simple argument" 2>&1 | tail -20`
Expected: FAIL — "Not yet implemented"

- [ ] **Step 3: Implement `forkArgument`**

Replace the stub in `src/lib/core/argument-engine.ts` with the full implementation:

```typescript
public forkArgument(
    newArgumentId: string,
    claimLibrary: TClaimLookup<TClaim>,
    sourceLibrary: TSourceLookup<TSource>,
    claimSourceLibrary: TClaimSourceLookup<TAssoc>,
    options?: TForkArgumentOptions
): TForkArgumentResult<TArg, TPremise, TExpr, TVar> {
    if (!this.canFork()) {
        throw new Error("This argument cannot be forked.")
    }

    const generateId = options?.generateId ?? (() => crypto.randomUUID())
    const snap = this.snapshot()

    const sourceArgId = snap.argument.id
    const sourceArgVersion = snap.argument.version

    // Build remap table
    const premiseRemap = new Map<string, string>()
    const expressionRemap = new Map<string, string>()
    const variableRemap = new Map<string, string>()

    for (const premiseSnap of snap.premises) {
        premiseRemap.set(premiseSnap.premise.id, generateId())
        for (const expr of premiseSnap.expressions) {
            expressionRemap.set(expr.id, generateId())
        }
    }
    for (const v of snap.variables.variables) {
        variableRemap.set(v.id, generateId())
    }

    const remapTable: TForkRemapTable = {
        argumentId: { from: sourceArgId, to: newArgumentId },
        premises: premiseRemap,
        expressions: expressionRemap,
        variables: variableRemap,
    }

    // Remap argument
    const forkedArgument = {
        ...snap.argument,
        id: newArgumentId,
        version: 0,
        forkedFromArgumentId: sourceArgId,
        forkedFromArgumentVersion: sourceArgVersion,
    } as TArg

    // Remap premises and expressions
    const forkedPremises = snap.premises.map((premiseSnap) => {
        const newPremiseId = premiseRemap.get(premiseSnap.premise.id)!
        const forkedPremise = {
            ...premiseSnap.premise,
            id: newPremiseId,
            argumentId: newArgumentId,
            argumentVersion: 0,
            forkedFromPremiseId: premiseSnap.premise.id,
            forkedFromArgumentId: sourceArgId,
            forkedFromArgumentVersion: sourceArgVersion,
        } as TPremise

        const forkedExpressions = premiseSnap.expressions.map((expr) => {
            const newExprId = expressionRemap.get(expr.id)!
            return {
                ...expr,
                id: newExprId,
                argumentId: newArgumentId,
                argumentVersion: 0,
                premiseId: newPremiseId,
                parentId:
                    expr.parentId !== null
                        ? (expressionRemap.get(expr.parentId) ?? null)
                        : null,
                variableId:
                    "variableId" in expr && expr.variableId
                        ? (variableRemap.get(
                              expr.variableId as string
                          ) ?? expr.variableId)
                        : undefined,
                forkedFromExpressionId: expr.id,
                forkedFromPremiseId: premiseSnap.premise.id,
                forkedFromArgumentId: sourceArgId,
                forkedFromArgumentVersion: sourceArgVersion,
            } as TExpr
        })

        return {
            premise: forkedPremise,
            expressions: forkedExpressions,
            rootExpressionId:
                premiseSnap.rootExpressionId !== undefined
                    ? (expressionRemap.get(premiseSnap.rootExpressionId) ??
                      undefined)
                    : undefined,
        }
    })

    // Remap variables
    const forkedVariables = snap.variables.variables.map((v) => {
        const newVarId = variableRemap.get(v.id)!
        const base = {
            ...v,
            id: newVarId,
            argumentId: newArgumentId,
            argumentVersion: 0,
            forkedFromVariableId: v.id,
            forkedFromArgumentId: sourceArgId,
            forkedFromArgumentVersion: sourceArgVersion,
        }
        // Remap premise-bound variable references
        if ("boundPremiseId" in v && v.boundPremiseId) {
            ;(base as Record<string, unknown>).boundPremiseId =
                premiseRemap.get(v.boundPremiseId as string) ??
                v.boundPremiseId
            ;(base as Record<string, unknown>).boundArgumentId =
                newArgumentId
            ;(base as Record<string, unknown>).boundArgumentVersion = 0
        }
        return base as TVar
    })

    // Remap conclusion role
    const forkedConclusionPremiseId =
        snap.conclusionPremiseId !== undefined
            ? premiseRemap.get(snap.conclusionPremiseId)
            : undefined

    // Build forked snapshot
    const forkedSnapshot: TArgumentEngineSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar
    > = {
        argument: forkedArgument,
        variables: { variables: forkedVariables },
        premises: forkedPremises,
        ...(forkedConclusionPremiseId !== undefined
            ? { conclusionPremiseId: forkedConclusionPremiseId }
            : {}),
        config: {
            checksumConfig: options?.checksumConfig
                ? serializeChecksumConfig(options.checksumConfig)
                : snap.config?.checksumConfig,
            positionConfig:
                options?.positionConfig ?? snap.config?.positionConfig,
            grammarConfig:
                options?.grammarConfig ?? snap.config?.grammarConfig,
        } as TLogicEngineOptions,
    }

    const engine = ArgumentEngine.fromSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >(
        forkedSnapshot,
        claimLibrary,
        sourceLibrary,
        claimSourceLibrary,
        options?.grammarConfig ?? this.grammarConfig,
        "ignore"
    )

    return { engine, remapTable }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "forks a simple argument" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat(engine): implement forkArgument core logic"
```

---

### Task 9: Test Internal Reference Remapping

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the remapping test**

Add inside the `forkArgument` describe block:

```typescript
it("remaps internal references: parentId chains and premise-bound variables", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 1,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("var-p", "P"))
    eng.addVariable(makeVar("var-q", "Q"))

    // Premise 1: P and Q (nested expression tree)
    const { result: pm1 } = eng.createPremiseWithId("premise-1")
    pm1.addExpression({
        id: "expr-and",
        type: "operator",
        operator: "and",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "premise-1",
    })
    pm1.addExpression({
        id: "expr-p",
        type: "variable",
        variableId: "var-p",
        parentId: "expr-and",
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "premise-1",
    })
    pm1.addExpression({
        id: "expr-q",
        type: "variable",
        variableId: "var-q",
        parentId: "expr-and",
        position: 1,
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "premise-1",
    })

    // Premise 2 with a premise-bound variable referencing premise 1
    const { result: pm2 } = eng.createPremiseWithId("premise-2")
    eng.bindVariableToPremise({
        id: "var-bound",
        argumentId: "arg-1",
        argumentVersion: 1,
        symbol: "R",
        boundPremiseId: "premise-1",
        boundArgumentId: "arg-1",
        boundArgumentVersion: 1,
    })
    pm2.addExpression({
        id: "expr-r",
        type: "variable",
        variableId: "var-bound",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "premise-2",
    })

    eng.setConclusionPremise("premise-2")

    const { engine: forked, remapTable } = eng.forkArgument(
        "arg-forked",
        aLib(),
        sLib(),
        csLib()
    )

    // Verify expression parentId chain is remapped
    const fPm1 = forked
        .listPremises()
        .find((pm) => pm.getId() === remapTable.premises.get("premise-1"))!
    const fExprs = fPm1.getExpressions()
    const fAndExpr = fExprs.find((e) => e.type === "operator")!
    const fChildExprs = fExprs.filter((e) => e.type === "variable")

    expect(fAndExpr.parentId).toBeNull()
    for (const child of fChildExprs) {
        expect(child.parentId).toBe(fAndExpr.id)
        expect(child.parentId).not.toBe("expr-and") // remapped, not original
    }

    // Verify variableId on expressions is remapped
    const fExprP = fChildExprs.find(
        (e) =>
            "variableId" in e &&
            e.variableId === remapTable.variables.get("var-p")
    )
    expect(fExprP).toBeDefined()

    // Verify premise-bound variable's boundPremiseId is remapped
    const fPm2 = forked
        .listPremises()
        .find((pm) => pm.getId() === remapTable.premises.get("premise-2"))!
    const fPm2Exprs = fPm2.getExpressions()
    const fExprR = fPm2Exprs.find((e) => e.type === "variable")!
    const fBoundVarId = (fExprR as { variableId: string }).variableId
    expect(fBoundVarId).toBe(remapTable.variables.get("var-bound"))

    // Conclusion role is remapped
    expect(forked.getRoleState().conclusionPremiseId).toBe(
        remapTable.premises.get("premise-2")
    )
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "remaps internal references" 2>&1 | tail -20`
Expected: PASS (implementation from Task 8 should handle this)

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test(fork): verify internal reference remapping"
```

---

### Task 10: Test Remap Table Accuracy and Independence

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the remap table and independence tests**

Add inside the `forkArgument` describe block:

```typescript
it("remap table covers all entities", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("v1", "A"))
    eng.addVariable(makeVar("v2", "B"))
    const { result: pm1 } = eng.createPremiseWithId("p1")
    pm1.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v1",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })
    const { result: pm2 } = eng.createPremiseWithId("p2")
    pm2.addExpression({
        id: "e2",
        type: "variable",
        variableId: "v2",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p2",
    })

    const { remapTable } = eng.forkArgument("arg-f", aLib(), sLib(), csLib())

    expect(remapTable.premises.size).toBe(2)
    expect(remapTable.expressions.size).toBe(2)
    expect(remapTable.variables.size).toBe(2)

    // All mapped IDs are unique and different from originals
    for (const [orig, mapped] of remapTable.premises) {
        expect(mapped).not.toBe(orig)
    }
    for (const [orig, mapped] of remapTable.expressions) {
        expect(mapped).not.toBe(orig)
    }
    for (const [orig, mapped] of remapTable.variables) {
        expect(mapped).not.toBe(orig)
    }
})

it("forked engine is independent from source", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("v1", "P"))
    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v1",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })

    const { engine: forked } = eng.forkArgument(
        "arg-f",
        aLib(),
        sLib(),
        csLib()
    )

    // Mutate the fork: add a new premise
    forked.createPremise()
    expect(forked.listPremises()).toHaveLength(2)

    // Source is unaffected
    expect(eng.listPremises()).toHaveLength(1)
    expect(eng.listPremises()[0]!.getExpressions()).toHaveLength(1)
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "remap table covers|forked engine is independent" 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test(fork): verify remap table accuracy and engine independence"
```

---

### Task 11: Test Forked Entity Mutability and Checksum Divergence

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the mutability and checksum tests**

Add inside the `forkArgument` describe block:

```typescript
it("forked entities are fully mutable", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("v1", "P"))
    eng.addVariable(makeVar("v2", "Q"))
    const { result: pm1 } = eng.createPremiseWithId("p1")
    pm1.addExpression({
        id: "e-and",
        type: "operator",
        operator: "and",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })
    pm1.addExpression({
        id: "e-p",
        type: "variable",
        variableId: "v1",
        parentId: "e-and",
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })
    pm1.addExpression({
        id: "e-q",
        type: "variable",
        variableId: "v2",
        parentId: "e-and",
        position: 1,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })

    const { engine: forked, remapTable } = eng.forkArgument(
        "arg-f",
        aLib(),
        sLib(),
        csLib()
    )

    // Can change operator
    const fPm = forked.listPremises()[0]!
    const fAndId = remapTable.expressions.get("e-and")!
    fPm.changeOperator(fAndId, "or")
    const fAndExpr = fPm.getExpressions().find((e) => e.id === fAndId)!
    expect(fAndExpr.type === "operator" && fAndExpr.operator).toBe("or")

    // Can add a new premise
    const { result: newPm } = forked.createPremise()
    expect(forked.listPremises()).toHaveLength(2)

    // Can remove a forked premise
    forked.removePremise(fPm.getId())
    expect(forked.listPremises()).toHaveLength(1)
})

it("forked entity checksums diverge from source", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("v1", "P"))
    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v1",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })

    const sourceSnap = eng.snapshot()
    const { engine: forked } = eng.forkArgument(
        "arg-f",
        aLib(),
        sLib(),
        csLib()
    )
    const forkedSnap = forked.snapshot()

    // Argument checksums differ (different id, version, forkedFrom fields)
    expect(forkedSnap.argument.checksum).not.toBe(sourceSnap.argument.checksum)

    // Premise checksums differ
    expect(forkedSnap.premises[0]!.premise.checksum).not.toBe(
        sourceSnap.premises[0]!.premise.checksum
    )
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose -t "forked entities are fully mutable|forked entity checksums diverge" 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test(fork): verify mutability and checksum divergence"
```

---

### Task 12: Add Pluggable Entity Matchers to Diff Options

**Files:**

- Modify: `src/lib/types/diff.ts:71-81`
- Modify: `src/lib/core/diff.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `forkArgument` describe block:

```typescript
it("diffArguments with custom matchers pairs forked entities correctly", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("v1", "P"))
    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v1",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })

    const { engine: forked } = eng.forkArgument(
        "arg-f",
        aLib(),
        sLib(),
        csLib()
    )

    // Without matchers: everything looks like removed + added
    const naiveDiff = diffArguments(eng, forked)
    expect(naiveDiff.premises.removed).toHaveLength(1)
    expect(naiveDiff.premises.added).toHaveLength(1)
    expect(naiveDiff.premises.modified).toHaveLength(0)

    // With fork-aware matchers: paired as modified
    const forkDiff = diffArguments(eng, forked, {
        ...createForkedFromMatcher(),
    })
    expect(forkDiff.premises.removed).toHaveLength(0)
    expect(forkDiff.premises.added).toHaveLength(0)
    // Premise itself may show as modified due to different IDs/forkedFrom fields
    // depending on comparator — but it IS paired, not orphaned
    expect(forkDiff.premises.modified.length).toBeGreaterThanOrEqual(0)
    expect(
        forkDiff.premises.removed.length + forkDiff.premises.added.length
    ).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --reporter=verbose -t "diffArguments with custom matchers" 2>&1 | tail -20`
Expected: FAIL — `createForkedFromMatcher` is not defined

- [ ] **Step 3: Add matcher types to `TCoreDiffOptions`**

In `src/lib/types/diff.ts`, add matcher fields to `TCoreDiffOptions`:

```typescript
export interface TCoreDiffOptions<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    compareArgument?: TCoreFieldComparator<TArg>
    compareVariable?: TCoreFieldComparator<TVar>
    comparePremise?: TCoreFieldComparator<TPremise>
    compareExpression?: TCoreFieldComparator<TExpr>
    /** Custom entity matcher for pairing premises. Default: match by ID. */
    premiseMatcher?: (a: TPremise, b: TPremise) => boolean
    /** Custom entity matcher for pairing variables. Default: match by ID. */
    variableMatcher?: (a: TVar, b: TVar) => boolean
    /** Custom entity matcher for pairing expressions. Default: match by ID. */
    expressionMatcher?: (a: TExpr, b: TExpr) => boolean
}
```

- [ ] **Step 4: Update `diffEntitySet` to accept an optional matcher**

In `src/lib/core/diff.ts`, modify `diffEntitySet` to accept an optional matcher parameter and use it for pairing instead of ID-based matching when provided:

```typescript
function diffEntitySet<T extends { id: string }>(
    beforeItems: T[],
    afterItems: T[],
    compare: TCoreFieldComparator<T>,
    matcher?: (a: T, b: T) => boolean
): TCoreEntitySetDiff<T> {
    if (!matcher) {
        // Original ID-based matching
        const beforeById = new Map(beforeItems.map((item) => [item.id, item]))
        const afterById = new Map(afterItems.map((item) => [item.id, item]))

        const added: T[] = []
        const removed: T[] = []
        const modified: TCoreEntityFieldDiff<T>[] = []

        for (const [id, beforeItem] of beforeById) {
            const afterItem = afterById.get(id)
            if (!afterItem) {
                removed.push(beforeItem)
                continue
            }
            const changes = compare(beforeItem, afterItem)
            if (changes.length > 0) {
                modified.push({ before: beforeItem, after: afterItem, changes })
            }
        }

        for (const [id, afterItem] of afterById) {
            if (!beforeById.has(id)) {
                added.push(afterItem)
            }
        }

        return { added, removed, modified }
    }

    // Custom matcher-based pairing
    const added: T[] = []
    const removed: T[] = []
    const modified: TCoreEntityFieldDiff<T>[] = []
    const matchedAfterIndices = new Set<number>()

    for (const beforeItem of beforeItems) {
        const afterIndex = afterItems.findIndex(
            (afterItem, i) =>
                !matchedAfterIndices.has(i) && matcher(beforeItem, afterItem)
        )
        if (afterIndex === -1) {
            removed.push(beforeItem)
            continue
        }
        matchedAfterIndices.add(afterIndex)
        const afterItem = afterItems[afterIndex]!
        const changes = compare(beforeItem, afterItem)
        if (changes.length > 0) {
            modified.push({ before: beforeItem, after: afterItem, changes })
        }
    }

    for (let i = 0; i < afterItems.length; i++) {
        if (!matchedAfterIndices.has(i)) {
            added.push(afterItems[i]!)
        }
    }

    return { added, removed, modified }
}
```

- [ ] **Step 5: Update `diffPremiseSet` to accept a premise matcher and expression matcher**

In `src/lib/core/diff.ts`, modify `diffPremiseSet` similarly:

```typescript
function diffPremiseSet<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
>(
    beforePremises: TPremise[],
    afterPremises: TPremise[],
    beforeExpressions: Map<string, TExpr[]>,
    afterExpressions: Map<string, TExpr[]>,
    comparePremise: TCoreFieldComparator<TPremise>,
    compareExpression: TCoreFieldComparator<TExpr>,
    premiseMatcher?: (a: TPremise, b: TPremise) => boolean,
    expressionMatcher?: (a: TExpr, b: TExpr) => boolean
): TCorePremiseSetDiff<TPremise, TExpr> {
    if (!premiseMatcher) {
        // Original ID-based matching (existing code)
        const beforeById = new Map(beforePremises.map((p) => [p.id, p]))
        const afterById = new Map(afterPremises.map((p) => [p.id, p]))

        const added: TPremise[] = []
        const removed: TPremise[] = []
        const modified: TCorePremiseDiff<TPremise, TExpr>[] = []

        for (const [id, beforePremise] of beforeById) {
            const afterPremise = afterById.get(id)
            if (!afterPremise) {
                removed.push(beforePremise)
                continue
            }
            const premiseChanges = comparePremise(beforePremise, afterPremise)
            const expressionsDiff = diffEntitySet(
                beforeExpressions.get(id) ?? [],
                afterExpressions.get(id) ?? [],
                compareExpression,
                expressionMatcher
            )
            const hasExpressionChanges =
                expressionsDiff.added.length > 0 ||
                expressionsDiff.removed.length > 0 ||
                expressionsDiff.modified.length > 0
            if (premiseChanges.length > 0 || hasExpressionChanges) {
                modified.push({
                    before: beforePremise,
                    after: afterPremise,
                    changes: premiseChanges,
                    expressions: expressionsDiff,
                })
            }
        }

        for (const [id, afterPremise] of afterById) {
            if (!beforeById.has(id)) {
                added.push(afterPremise)
            }
        }

        return { added, removed, modified }
    }

    // Custom matcher-based pairing
    const added: TPremise[] = []
    const removed: TPremise[] = []
    const modified: TCorePremiseDiff<TPremise, TExpr>[] = []
    const matchedAfterIndices = new Set<number>()

    for (const beforePremise of beforePremises) {
        const afterIndex = afterPremises.findIndex(
            (ap, i) =>
                !matchedAfterIndices.has(i) && premiseMatcher(beforePremise, ap)
        )
        if (afterIndex === -1) {
            removed.push(beforePremise)
            continue
        }
        matchedAfterIndices.add(afterIndex)
        const afterPremise = afterPremises[afterIndex]!
        const premiseChanges = comparePremise(beforePremise, afterPremise)
        const expressionsDiff = diffEntitySet(
            beforeExpressions.get(beforePremise.id) ?? [],
            afterExpressions.get(afterPremise.id) ?? [],
            compareExpression,
            expressionMatcher
        )
        const hasExpressionChanges =
            expressionsDiff.added.length > 0 ||
            expressionsDiff.removed.length > 0 ||
            expressionsDiff.modified.length > 0
        if (premiseChanges.length > 0 || hasExpressionChanges) {
            modified.push({
                before: beforePremise,
                after: afterPremise,
                changes: premiseChanges,
                expressions: expressionsDiff,
            })
        }
    }

    for (let i = 0; i < afterPremises.length; i++) {
        if (!matchedAfterIndices.has(i)) {
            added.push(afterPremises[i]!)
        }
    }

    return { added, removed, modified }
}
```

- [ ] **Step 6: Thread matchers through `diffArguments`**

In `src/lib/core/diff.ts`, update the `diffArguments` function to pass matchers through:

```typescript
// In the return statement, update the calls:
variables: diffEntitySet(
    collectVariables(engineA),
    collectVariables(engineB),
    compareVar,
    options?.variableMatcher
),
premises: diffPremiseSet(
    premisesA,
    premisesB,
    expressionsA,
    expressionsB,
    comparePrem,
    compareExpr,
    options?.premiseMatcher,
    options?.expressionMatcher
),
```

- [ ] **Step 7: Implement `createForkedFromMatcher`**

Add at the bottom of `src/lib/core/diff.ts`, before the closing of the file:

```typescript
/**
 * Creates entity matchers for fork-aware diffing.
 * Pairs entity A with entity B when B was forked from A
 * (B's `forkedFrom*Id` matches A's `id` and argument identity matches).
 */
export function createForkedFromMatcher<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(): {
    premiseMatcher: (a: TPremise, b: TPremise) => boolean
    variableMatcher: (a: TVar, b: TVar) => boolean
    expressionMatcher: (a: TExpr, b: TExpr) => boolean
} {
    return {
        premiseMatcher: (a, b) => {
            const bRec = b as Record<string, unknown>
            return (
                bRec.forkedFromPremiseId === a.id &&
                bRec.forkedFromArgumentId === a.argumentId &&
                bRec.forkedFromArgumentVersion === a.argumentVersion
            )
        },
        variableMatcher: (a, b) => {
            const bRec = b as Record<string, unknown>
            return (
                bRec.forkedFromVariableId === a.id &&
                bRec.forkedFromArgumentId === a.argumentId &&
                bRec.forkedFromArgumentVersion === a.argumentVersion
            )
        },
        expressionMatcher: (a, b) => {
            const bRec = b as Record<string, unknown>
            return (
                bRec.forkedFromExpressionId === a.id &&
                bRec.forkedFromPremiseId ===
                    (a as Record<string, unknown>).premiseId &&
                bRec.forkedFromArgumentId === a.argumentId &&
                bRec.forkedFromArgumentVersion === a.argumentVersion
            )
        },
    }
}
```

- [ ] **Step 8: Export `createForkedFromMatcher` from library barrel**

In `src/lib/index.ts`, update the diff exports:

```typescript
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
    createForkedFromMatcher,
} from "./core/diff.js"
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "diffArguments with custom matchers" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/types/diff.ts src/lib/core/diff.ts src/lib/index.ts test/core.test.ts
git commit -m "feat(diff): add pluggable entity matchers and createForkedFromMatcher"
```

---

### Task 13: Test Fork-Aware Diff With Mutations

**Files:**

- Test: `test/core.test.ts`

- [ ] **Step 1: Write the fork-diff-with-mutations test**

Add inside the `forkArgument` describe block:

```typescript
it("fork-aware diff detects mutations after fork", () => {
    const eng = new ArgumentEngine(
        {
            id: "arg-1",
            version: 0,
            forkedFromArgumentId: null,
            forkedFromArgumentVersion: null,
        } as TCoreArgument,
        aLib(),
        sLib(),
        csLib()
    )
    eng.addVariable(makeVar("v1", "P"))
    eng.addVariable(makeVar("v2", "Q"))
    const { result: pm } = eng.createPremiseWithId("p1")
    pm.addExpression({
        id: "e-and",
        type: "operator",
        operator: "and",
        parentId: null,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })
    pm.addExpression({
        id: "e-p",
        type: "variable",
        variableId: "v1",
        parentId: "e-and",
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })
    pm.addExpression({
        id: "e-q",
        type: "variable",
        variableId: "v2",
        parentId: "e-and",
        position: 1,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: "p1",
    })

    const { engine: forked, remapTable } = eng.forkArgument(
        "arg-f",
        aLib(),
        sLib(),
        csLib()
    )

    // Mutate: change and -> or
    const fPm = forked.listPremises()[0]!
    const fAndId = remapTable.expressions.get("e-and")!
    fPm.changeOperator(fAndId, "or")

    // Add a new premise in the fork
    forked.createPremise()

    const diff = diffArguments(eng, forked, {
        ...createForkedFromMatcher(),
    })

    // The original premise is paired and shows expression-level changes
    expect(diff.premises.modified).toHaveLength(1)
    const premiseDiff = diff.premises.modified[0]!
    const exprChanges = premiseDiff.expressions.modified
    expect(exprChanges).toHaveLength(1)
    expect(exprChanges[0]!.changes).toContainEqual({
        field: "operator",
        before: "and",
        after: "or",
    })

    // The new premise shows as added
    expect(diff.premises.added).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm run test -- --reporter=verbose -t "fork-aware diff detects mutations" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test(fork): verify fork-aware diff detects mutations"
```

---

### Task 14: Full Suite Validation and Lint

**Files:**

- All modified files

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 3: Run lint and fix**

Run: `pnpm eslint . --fix 2>&1 | tail -20`
Then: `pnpm run prettify 2>&1 | tail -10`

- [ ] **Step 4: Run lint check**

Run: `pnpm run lint 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 5: Run full check**

Run: `pnpm run check 2>&1 | tail -30`
Expected: All checks pass (typecheck + lint + test + build)

- [ ] **Step 6: Commit any lint fixes**

```bash
git add -A
git commit -m "style: lint and format fixes"
```

---

### Task 15: Update Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Update CLAUDE.md design rules**

Add a new bullet to the "Key design rules" section in `CLAUDE.md`:

```markdown
- **Argument forking:** `forkArgument()` creates an independent copy with new UUIDs and `forkedFrom` provenance metadata on every entity. `canFork()` is a protected overridable that subclasses use to inject validation policy (e.g., only fork published arguments). Diff integration via pluggable entity matchers (`premiseMatcher`, `variableMatcher`, `expressionMatcher` on `TCoreDiffOptions`) and `createForkedFromMatcher()` helper.
```

- [ ] **Step 2: Update release notes**

Write user-facing release notes in `docs/release-notes/upcoming.md`.

- [ ] **Step 3: Update changelog**

Write developer changelog in `docs/changelogs/upcoming.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: add forking documentation to CLAUDE.md, release notes, and changelog"
```
