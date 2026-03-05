# Snapshot/Rollback and Engine Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add hierarchical snapshot/restore, fix naming inconsistencies, normalize checksums, add schema fields, restructure constructors, and add bulk loading.

**Architecture:** Each class in the hierarchy (ExpressionManager, VariableManager, PremiseEngine, ArgumentEngine) gets `snapshot()` and `static fromSnapshot()`. Snapshots capture only owned state + config. Dependencies are passed in by the parent during restore. A separate `fromData()` static method on ArgumentEngine handles bulk loading from flat DB arrays.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

---

## Dependency graph

Tasks must be done in order. Each task builds on the previous. The plan is structured bottom-up: schema changes first, then leaf classes, then engines.

---

### Task 1: Rename PremiseManager to PremiseEngine

This is a pure rename with no behavioral changes. Do it first to avoid merge conflicts with later tasks.

**Files:**
- Modify: `src/lib/core/PremiseManager.ts` (rename class, keep filename for now)
- Modify: `src/lib/core/ArgumentEngine.ts` (update references)
- Modify: `src/lib/core/diff.ts` (update references)
- Modify: `src/lib/core/relationships.ts` (update references)
- Modify: `src/lib/index.ts` (update export)
- Modify: `src/index.ts` (update export)
- Modify: `src/cli/engine.ts` (update import/usage)
- Modify: `src/cli/commands/premises.ts` (update import/usage)
- Modify: `test/ExpressionManager.test.ts` (update import and all references)

**Step 1: Rename the class in PremiseManager.ts**

In `src/lib/core/PremiseManager.ts`, change the class declaration:

```typescript
// Before:
export class PremiseManager<
// After:
export class PremiseEngine<
```

Keep the filename as `PremiseManager.ts` for now (renaming files is a separate step to keep diffs clean).

**Step 2: Update all imports and references across the codebase**

Every file that imports `PremiseManager` needs to import `PremiseEngine` instead. Key files:

- `src/lib/core/ArgumentEngine.ts`: import and all type annotations (`PremiseManager<...>` -> `PremiseEngine<...>`)
- `src/lib/core/diff.ts`: import and type annotations
- `src/lib/core/relationships.ts`: import and type annotations (functions like `buildPremiseProfile(premise: PremiseManager)` -> `buildPremiseProfile(premise: PremiseEngine)`)
- `src/lib/index.ts`: re-export `PremiseEngine` instead of `PremiseManager`
- `src/index.ts`: re-export `PremiseEngine` instead of `PremiseManager`
- `src/cli/engine.ts`: import and usage
- `src/cli/commands/premises.ts`: import and usage
- `test/ExpressionManager.test.ts`: import at top, every `new PremiseManager(...)` -> `new PremiseEngine(...)`, every type annotation

**Step 3: Rename the file**

Rename `src/lib/core/PremiseManager.ts` to `src/lib/core/PremiseEngine.ts`. Update all import paths that reference `./PremiseManager.js` to `./PremiseEngine.js`.

Files with import paths to update:
- `src/lib/core/ArgumentEngine.ts`
- `src/lib/index.ts`
- `src/cli/engine.ts`
- `src/cli/commands/premises.ts`
- `test/ExpressionManager.test.ts`

**Step 4: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

Expected: All 469 tests pass, no type errors.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename PremiseManager to PremiseEngine"
```

---

### Task 2: Rename TArgumentEngineOptions to TLogicEngineOptions

**Files:**
- Modify: `src/lib/core/ArgumentEngine.ts` (rename type, update usage)
- Modify: `src/index.ts` (update re-export)
- Modify: `test/ExpressionManager.test.ts` (if referenced)

**Step 1: Rename the type in ArgumentEngine.ts**

```typescript
// Before:
export type TArgumentEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
}
// After:
export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
}
```

Update constructor signature: `options?: TArgumentEngineOptions` -> `options?: TLogicEngineOptions`.

**Step 2: Update re-export in src/index.ts**

Change `TArgumentEngineOptions` to `TLogicEngineOptions` in the export.

**Step 3: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: rename TArgumentEngineOptions to TLogicEngineOptions"
```

---

### Task 3: Add premiseId to expression schema and argumentId/argumentVersion to premise schema

**Files:**
- Modify: `src/lib/schemata/propositional.ts` (add fields)
- Modify: `src/lib/consts.ts` (add `premiseId` to DEFAULT_CHECKSUM_CONFIG.expressionFields, add `argumentId`/`argumentVersion` to premiseFields)
- Modify: `test/ExpressionManager.test.ts` (update all expression and premise fixtures)

**Step 1: Add premiseId to BasePropositionalExpressionSchema**

In `src/lib/schemata/propositional.ts`, add to `BasePropositionalExpressionSchema`:

```typescript
const BasePropositionalExpressionSchema = Type.Object({
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    premiseId: UUID,  // NEW
    parentId: Nullable(UUID, {
        description:
            "The ID of the parent operator expression, or null if this is a top-level expression.",
    }),
    position: Type.Number({
        description:
            "The ordering of this expression among its siblings under the same parent. Must be unique within (parentId, argumentId, argumentVersion).",
    }),
    checksum: Type.String({
        description: "Entity-level checksum for sync detection.",
    }),
})
```

**Step 2: Add argumentId and argumentVersion to CorePremiseSchema**

```typescript
export const CorePremiseSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,          // NEW
        argumentVersion: Type.Number(), // NEW
        rootExpressionId: Type.Optional(
            Type.String({
                description:
                    "ID of the root expression, if the premise has expressions.",
            })
        ),
        variables: Type.Array(UUID, {
            description: "IDs of all variables referenced in this premise.",
        }),
        expressions: Type.Array(CorePropositionalExpressionSchema, {
            description:
                "All expressions in this premise. The root has a null parentId.",
        }),
        checksum: Type.String({
            description: "Premise-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A premise containing an expression tree and variable references.",
    }
)
```

**Step 3: Update DEFAULT_CHECKSUM_CONFIG in consts.ts**

Add `premiseId` to expression fields, and `argumentId`/`argumentVersion` to premise fields:

```typescript
export const DEFAULT_CHECKSUM_CONFIG: Readonly<TCoreChecksumConfig> = {
    expressionFields: new Set([
        "id",
        "type",
        "parentId",
        "premiseId",          // NEW
        "position",
        "argumentId",
        "argumentVersion",
        "variableId",
        "operator",
    ]),
    variableFields: new Set(["id", "symbol", "argumentId", "argumentVersion"]),
    premiseFields: new Set([
        "id",
        "argumentId",        // NEW
        "argumentVersion",   // NEW
        "rootExpressionId",
    ]),
    argumentFields: new Set(["id", "version"]),
    roleFields: new Set(["conclusionPremiseId"]),
}
```

**Step 4: Update test fixtures**

Every expression fixture in `test/ExpressionManager.test.ts` needs a `premiseId` field. Every premise fixture needs `argumentId` and `argumentVersion`.

Search for all expression objects in the test that have `argumentId` and `argumentVersion` — they all need a `premiseId` added. The value should match the premise they belong to. For standalone expression tests (ExpressionManager tests), use a fixed value like `"premise-1"`.

Similarly, any test that directly constructs `TCorePremise` objects (e.g. in diff tests or schema shape tests) needs `argumentId` and `argumentVersion`.

This is a large mechanical change. Use find-and-replace patterns:
- For expressions: add `premiseId: "premise-1"` (or the appropriate premise ID) after `argumentVersion: 1,` lines
- For premises: add `argumentId: "arg-1", argumentVersion: 1,` after `id:` lines

**Step 5: Update PremiseEngine to pass premiseId when creating expressions**

In `src/lib/core/PremiseEngine.ts` (formerly PremiseManager.ts), anywhere expressions are created or returned, ensure `premiseId` is set to `this.premise.id` (or `this.id` depending on current state of the refactor — see Task 5). For now, the `addExpression` input from callers will need to include `premiseId`.

**Step 6: Update CLI code that constructs expressions**

- `src/cli/engine.ts`: `hydrateEngine` already spreads expression data from disk, so if the stored data has `premiseId` it will be preserved. For newly created expressions, add `premiseId` to the spread.
- `src/cli/commands/expressions.ts`: expression creation commands need to include `premiseId` in the expression object.
- `src/cli/import.ts`: YAML import builds expressions — add `premiseId` to the expression objects.

**Step 7: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

Fix any remaining type errors from the schema changes. Expect many test fixtures to need updating.

**Step 8: Commit**

```bash
git add -A && git commit -m "feat: add premiseId to expressions, argumentId/Version to premises"
```

---

### Task 4: Pass TLogicEngineOptions to ExpressionManager and VariableManager

Currently ExpressionManager takes `positionConfig?: TCorePositionConfig` and VariableManager takes no config. Change both to accept `TLogicEngineOptions`.

**Files:**
- Modify: `src/lib/core/ExpressionManager.ts`
- Modify: `src/lib/core/VariableManager.ts`
- Modify: `src/lib/core/PremiseEngine.ts` (update how it constructs ExpressionManager)
- Modify: `test/ExpressionManager.test.ts` (update any direct construction)

**Step 1: Update ExpressionManager constructor**

```typescript
import type { TLogicEngineOptions } from "./ArgumentEngine.js"

export class ExpressionManager<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    private positionConfig: TCorePositionConfig
    private checksumConfig?: TCoreChecksumConfig

    constructor(config?: TLogicEngineOptions) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()
        this.positionConfig = config?.positionConfig ?? DEFAULT_POSITION_CONFIG
        this.checksumConfig = config?.checksumConfig
    }
```

Remove `initialExpressions` from the constructor. Initial data loading will be handled by `fromSnapshot()` (Task 8) and individual `addExpression` calls.

**Step 2: Update VariableManager constructor**

```typescript
import type { TLogicEngineOptions } from "./ArgumentEngine.js"

export class VariableManager<
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    private config?: TLogicEngineOptions

    constructor(config?: TLogicEngineOptions) {
        this.variables = new Map()
        this.variableSymbols = new Set()
        this.config = config
    }
```

Remove `initialVariables` from the constructor. Data loading will be via `fromSnapshot()` or individual `addVariable` calls.

**Step 3: Update PremiseEngine to pass config to ExpressionManager**

```typescript
this.expressions = new ExpressionManager<TExpr>(config)
```

Instead of `new ExpressionManager<TExpr>([], positionConfig)`.

**Step 4: Update all direct constructions in tests and CLI**

- Test code that does `new VariableManager(variables)` needs to change to `new VariableManager()` followed by individual `addVariable()` calls, or use `fromSnapshot()` once available (Task 8).
- Test code that does `new ExpressionManager(expressions, config)` needs to change similarly.
- CLI code in `premises.ts` that constructs `new VariableManager(allVariables.map(...))` needs updating.

**Step 5: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: pass TLogicEngineOptions to all managers"
```

---

### Task 5: Restructure PremiseEngine constructor

Change PremiseEngine to accept `premise: TOptionalChecksum<TPremise>` instead of `(id, argument, variables, extras?, checksumConfig?, positionConfig?)`.

**Files:**
- Modify: `src/lib/core/PremiseEngine.ts`
- Modify: `src/lib/core/ArgumentEngine.ts` (update `createPremiseWithId`)
- Modify: `src/cli/commands/premises.ts` (update direct construction)
- Modify: `test/ExpressionManager.test.ts` (update direct construction)

**Step 1: Update PremiseEngine constructor**

```typescript
export class PremiseEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    private premise: TOptionalChecksum<TPremise>
    private rootExpressionId: string | undefined
    private variables: VariableManager<TVar>
    private expressions: ExpressionManager<TExpr>
    private expressionsByVariableId: DefaultMap<string, Set<string>>
    private argument: TOptionalChecksum<TArg>
    private checksumConfig?: TCoreChecksumConfig
    private checksumDirty = true
    private cachedChecksum: string | undefined

    constructor(
        premise: TOptionalChecksum<TPremise>,
        deps: { argument: TOptionalChecksum<TArg>; variables: VariableManager<TVar> },
        config?: TLogicEngineOptions
    ) {
        this.premise = { ...premise }
        this.argument = deps.argument
        this.checksumConfig = config?.checksumConfig
        this.rootExpressionId = undefined
        this.variables = deps.variables
        this.expressions = new ExpressionManager<TExpr>(config)
        this.expressionsByVariableId = new DefaultMap(() => new Set())
    }
```

Update `getId()` to read from `this.premise.id`. Update `getExtras()` to extract non-core fields from `this.premise`. The `setExtras` method should update `this.premise` with the merged extras.

**Step 2: Update ArgumentEngine.createPremiseWithId**

```typescript
public createPremiseWithId(
    id: string,
    extras?: Record<string, unknown>
): TCoreMutationResult<...> {
    if (this.premises.has(id)) {
        throw new Error(`Premise "${id}" already exists.`)
    }
    const premiseData = {
        ...extras,
        id,
        argumentId: this.argument.id,
        argumentVersion: this.argument.version,
    } as TOptionalChecksum<TPremise>
    const pe = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
        premiseData,
        { argument: this.argument, variables: this.variables },
        { checksumConfig: this.checksumConfig, positionConfig: this.positionConfig }
    )
    // ... rest unchanged
}
```

**Step 3: Update CLI premises.ts direct construction**

```typescript
// Before:
const pm = new PremiseManager(pid, argument, vm, premiseExtras)
// After:
const pe = new PremiseEngine(
    { id: pid, argumentId: argument.id, argumentVersion: version, ...premiseExtras } as TCorePremise,
    { argument, variables: vm }
)
```

**Step 4: Update test direct construction**

All `new PremiseManager("id", ARG, vm, extras?)` calls become:

```typescript
new PremiseEngine(
    { id: "id", argumentId: ARG.id, argumentVersion: ARG.version, ...extras } as TCorePremise,
    { argument: ARG, variables: vm }
)
```

**Step 5: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: restructure PremiseEngine constructor to accept premise entity"
```

---

### Task 6: Normalize expression checksums (store with checksums in ExpressionManager)

Currently ExpressionManager stores expressions without checksums (`TExpressionInput<TExpr>`) and PremiseEngine attaches them lazily. Change ExpressionManager to store expressions **with** checksums (as full `TExpr`), computing the checksum on add/update.

**Files:**
- Modify: `src/lib/core/ExpressionManager.ts`
- Modify: `src/lib/core/PremiseEngine.ts` (remove `attachExpressionChecksum`, `attachChangesetChecksums`)
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Update ExpressionManager internal storage**

Change the expressions map type:

```typescript
// Before:
private expressions: Map<string, TExpressionInput<TExpr>>
// After:
private expressions: Map<string, TExpr>
```

Add a private method to compute and attach the checksum:

```typescript
private attachChecksum(expr: TExpressionInput<TExpr>): TExpr {
    const fields = this.checksumConfig?.expressionFields
        ?? DEFAULT_CHECKSUM_CONFIG.expressionFields!
    return {
        ...expr,
        checksum: entityChecksum(
            expr as unknown as Record<string, unknown>,
            fields
        ),
    } as TExpr
}
```

**Step 2: Update addExpression to store with checksum**

In `addExpression()`, after validation passes, store the expression with its checksum:

```typescript
const withChecksum = this.attachChecksum(expression)
this.expressions.set(expression.id, withChecksum)
```

The collector should emit the checksummed expression. Update `updateExpression` similarly.

**Step 3: Update all return types**

Methods like `getExpression()`, `getChildExpressions()`, `toArray()` now return `TExpr` (with checksum) instead of `TExpressionInput<TExpr>`.

The `removeExpression` and `removeSubtree` methods return `TExpr` instead of `TExpressionInput<TExpr>`.

**Step 4: Remove lazy checksum attachment from PremiseEngine**

Delete `attachExpressionChecksum()` and `attachChangesetChecksums()` from PremiseEngine. Methods like `getExpression()`, `getExpressions()`, `addExpression()`, `removeExpression()` no longer need to wrap results with checksum attachment — ExpressionManager already provides checksummed expressions.

**Step 5: Update input types**

The public API methods on PremiseEngine (`addExpression`, `appendExpression`, `addExpressionRelative`) should still accept `TExpressionInput<TExpr>` (without checksum) as input — the checksum is computed internally.

**Step 6: Update TExpressionInput and TExpressionWithoutPosition**

These types remain as input types. They are still needed for the public API surface where callers provide expressions without checksums.

**Step 7: Run typecheck and tests**

```bash
pnpm run typecheck && pnpm run test
```

Expect some test assertions to change since expressions from `getExpression()` now have `checksum` fields. Tests that compare expression objects may need to account for the checksum.

**Step 8: Commit**

```bash
git add -A && git commit -m "refactor: store expressions with checksums in ExpressionManager"
```

---

### Task 7: Cumulative checksums on engines

Replace the ad-hoc checksum computation in ArgumentEngine and PremiseEngine with a `Record<string, string>` (entity_id -> entity_checksum) approach.

**Files:**
- Modify: `src/lib/core/PremiseEngine.ts` (new cumulative checksum)
- Modify: `src/lib/core/ArgumentEngine.ts` (new cumulative checksum)
- Modify: `test/ExpressionManager.test.ts` (update checksum tests if values change)

**Step 1: Update PremiseEngine.computeChecksum()**

Replace the current implementation with one that builds a `Record<string, string>` from all owned expression checksums, then hashes that:

```typescript
private computeChecksum(): string {
    const config = this.checksumConfig
    const checksumMap: Record<string, string> = {}

    // Premise's own entity checksum
    const premiseFields = config?.premiseFields
        ?? DEFAULT_CHECKSUM_CONFIG.premiseFields!
    checksumMap[this.premise.id] = entityChecksum(
        { ...this.premise, rootExpressionId: this.rootExpressionId } as unknown as Record<string, unknown>,
        premiseFields
    )

    // All owned expression checksums
    for (const expr of this.expressions.toArray()) {
        checksumMap[expr.id] = expr.checksum
    }

    return computeHash(canonicalSerialize(checksumMap))
}
```

**Step 2: Update ArgumentEngine.computeChecksum()**

```typescript
private computeChecksum(): string {
    const config = this.checksumConfig
    const checksumMap: Record<string, string> = {}

    // Argument entity checksum
    checksumMap[this.argument.id as string] = entityChecksum(
        this.argument as unknown as Record<string, unknown>,
        config?.argumentFields ?? DEFAULT_CHECKSUM_CONFIG.argumentFields!
    )

    // Role state checksum (use a fixed key since roles have no ID)
    checksumMap["__roles__"] = entityChecksum(
        this.getRoleState() as unknown as Record<string, unknown>,
        config?.roleFields ?? DEFAULT_CHECKSUM_CONFIG.roleFields!
    )

    // Variable checksums
    for (const v of this.variables.toArray()) {
        checksumMap[v.id] = v.checksum
    }

    // Premise checksums
    for (const pm of this.listPremises()) {
        checksumMap[pm.getId()] = pm.checksum()
    }

    return computeHash(canonicalSerialize(checksumMap))
}
```

**Step 3: Run tests**

```bash
pnpm run typecheck && pnpm run test
```

Checksum values will change since the computation method changed. Update any test assertions that check exact checksum strings. Tests that check "checksum changes when X mutates" should still pass since the dirty-flag logic is unchanged.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: cumulative checksums using entity ID->checksum maps"
```

---

### Task 8: Add snapshot() and fromSnapshot() to ExpressionManager and VariableManager

**Files:**
- Modify: `src/lib/core/ExpressionManager.ts`
- Modify: `src/lib/core/VariableManager.ts`
- Modify: `test/ExpressionManager.test.ts` (new describe blocks)

**Step 1: Define snapshot types**

In `ExpressionManager.ts`:

```typescript
export type TExpressionManagerSnapshot<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = {
    expressions: TExpr[]
    config?: TLogicEngineOptions
}
```

In `VariableManager.ts`:

```typescript
export type TVariableManagerSnapshot<
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    variables: TVar[]
    config?: TLogicEngineOptions
}
```

**Step 2: Implement snapshot() on ExpressionManager**

```typescript
public snapshot(): TExpressionManagerSnapshot<TExpr> {
    return {
        expressions: this.toArray(),
        ...(this.positionConfig !== DEFAULT_POSITION_CONFIG
            ? { config: { positionConfig: this.positionConfig } }
            : {}),
    }
}
```

Wait -- the design says config is always included. Simplify:

```typescript
public snapshot(): TExpressionManagerSnapshot<TExpr> {
    return {
        expressions: this.toArray(),
        config: {
            positionConfig: this.positionConfig,
            checksumConfig: this.checksumConfig,
        },
    }
}
```

**Step 3: Implement fromSnapshot() on ExpressionManager**

```typescript
public static fromSnapshot<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
>(snapshot: TExpressionManagerSnapshot<TExpr>): ExpressionManager<TExpr> {
    const em = new ExpressionManager<TExpr>(snapshot.config)
    for (const expr of snapshot.expressions) {
        // Expressions already have checksums; load them directly
        em.loadExpression(expr)
    }
    return em
}
```

Add a `loadExpression(expr: TExpr)` private method that stores directly into the map without recomputing checksums (since snapshot data already has correct checksums). This method still validates structure (parent existence, position uniqueness, etc.) but skips checksum computation. Alternatively, use the existing BFS load approach from the old constructor.

Actually, simpler: reuse the existing `loadInitialExpressions` private method. Just call it from `fromSnapshot`:

```typescript
public static fromSnapshot<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
>(snapshot: TExpressionManagerSnapshot<TExpr>): ExpressionManager<TExpr> {
    const em = new ExpressionManager<TExpr>(snapshot.config)
    em.loadInitialExpressions(snapshot.expressions as TExpressionInput<TExpr>[])
    return em
}
```

Note: `loadInitialExpressions` calls `addExpression` which recomputes checksums. This is acceptable -- restoring from snapshot recomputes checksums from the data, ensuring consistency.

**Step 4: Implement snapshot() and fromSnapshot() on VariableManager**

```typescript
public snapshot(): TVariableManagerSnapshot<TVar> {
    return {
        variables: this.toArray(),
        config: this.config,
    }
}

public static fromSnapshot<
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(snapshot: TVariableManagerSnapshot<TVar>): VariableManager<TVar> {
    const vm = new VariableManager<TVar>(snapshot.config)
    for (const v of snapshot.variables) {
        vm.addVariable(v)
    }
    return vm
}
```

**Step 5: Write tests**

Add a new describe block `"ExpressionManager — snapshot and fromSnapshot"` at the bottom of the test file:

```typescript
describe("ExpressionManager — snapshot and fromSnapshot", () => {
    it("round-trips an empty manager", () => {
        const em = new ExpressionManager()
        const snap = em.snapshot()
        const restored = ExpressionManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual([])
    })

    it("round-trips a manager with expressions", () => {
        const em = new ExpressionManager()
        em.addExpression({ id: "e1", type: "variable", variableId: "v1",
            argumentId: "arg-1", argumentVersion: 1, premiseId: "p1",
            parentId: null, position: 0 })
        const snap = em.snapshot()
        const restored = ExpressionManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual(em.toArray())
    })

    it("preserves position config in snapshot", () => {
        const config = { positionConfig: { min: -100, max: 100, initial: 0 } }
        const em = new ExpressionManager(config)
        const snap = em.snapshot()
        expect(snap.config?.positionConfig).toEqual(config.positionConfig)
    })
})
```

Add a new describe block `"VariableManager — snapshot and fromSnapshot"`:

```typescript
describe("VariableManager — snapshot and fromSnapshot", () => {
    it("round-trips an empty manager", () => {
        const vm = new VariableManager()
        const snap = vm.snapshot()
        const restored = VariableManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual([])
    })

    it("round-trips a manager with variables", () => {
        const vm = new VariableManager()
        vm.addVariable({ id: "v1", symbol: "P", argumentId: "arg-1",
            argumentVersion: 1, checksum: "abc" })
        const snap = vm.snapshot()
        const restored = VariableManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual(vm.toArray())
    })
})
```

**Step 6: Run tests**

```bash
pnpm run test
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add snapshot/fromSnapshot to ExpressionManager and VariableManager"
```

---

### Task 9: Add snapshot() and fromSnapshot() to PremiseEngine

**Files:**
- Modify: `src/lib/core/PremiseEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Define snapshot type**

In `PremiseEngine.ts` (or a new types file if preferred):

```typescript
export type TPremiseEngineSnapshot<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = {
    premise: TOptionalChecksum<TPremise>
    expressions: TExpressionManagerSnapshot<TExpr>
    config?: TLogicEngineOptions
}
```

**Step 2: Implement snapshot()**

```typescript
public snapshot(): TPremiseEngineSnapshot<TPremise, TExpr> {
    return {
        premise: { ...this.premise, rootExpressionId: this.rootExpressionId },
        expressions: this.expressions.snapshot(),
        config: {
            checksumConfig: this.checksumConfig,
            positionConfig: this.expressions.snapshot().config?.positionConfig,
        },
    }
}
```

Note: The premise snapshot does NOT include variables or argument — those are dependencies owned by ArgumentEngine.

**Step 3: Implement fromSnapshot()**

```typescript
public static fromSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    snapshot: TPremiseEngineSnapshot<TPremise, TExpr>,
    argument: TOptionalChecksum<TArg>,
    variables: VariableManager<TVar>
): PremiseEngine<TArg, TPremise, TExpr, TVar> {
    const pe = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
        snapshot.premise,
        { argument, variables },
        snapshot.config
    )
    // Restore expressions from the expression snapshot
    const restoredExpressions = ExpressionManager.fromSnapshot(snapshot.expressions)
    pe.expressions = restoredExpressions
    // Rebuild expressionsByVariableId index
    pe.rebuildVariableIndex()
    // Restore rootExpressionId
    pe.rootExpressionId = snapshot.premise.rootExpressionId
    return pe
}
```

Add a `rebuildVariableIndex()` private method that iterates all expressions and populates `expressionsByVariableId`.

**Step 4: Write tests**

New describe block `"PremiseEngine — snapshot and fromSnapshot"`:

```typescript
describe("PremiseEngine — snapshot and fromSnapshot", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("round-trips an empty premise", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 } as TCorePremise,
            { argument: ARG, variables: vm }
        )
        const snap = pe.snapshot()
        const restored = PremiseEngine.fromSnapshot(snap, ARG, vm)
        expect(restored.getId()).toBe("p1")
        expect(restored.getExpressions()).toEqual([])
    })

    it("round-trips a premise with expressions", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable({ id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1 })
        const { result: pe } = eng.createPremise()
        pe.appendExpression(null, {
            id: "e1", type: "variable", variableId: "v1",
            argumentId: "arg-1", argumentVersion: 1, premiseId: pe.getId(),
            parentId: null,
        })
        const snap = pe.snapshot()
        const vm = new VariableManager()
        vm.addVariable({ id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1, checksum: "x" })
        const restored = PremiseEngine.fromSnapshot(snap, ARG, vm)
        expect(restored.getExpressions().length).toBe(1)
        expect(restored.toDisplayString()).toBe(pe.toDisplayString())
    })

    it("snapshot excludes variables and argument (owned by engine)", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 } as TCorePremise,
            { argument: ARG, variables: vm }
        )
        const snap = pe.snapshot()
        expect(snap).not.toHaveProperty("variables")
        expect(snap).not.toHaveProperty("argument")
    })
})
```

**Step 5: Run tests**

```bash
pnpm run test
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add snapshot/fromSnapshot to PremiseEngine"
```

---

### Task 10: Add snapshot(), fromSnapshot(), and rollback() to ArgumentEngine

**Files:**
- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Define snapshot type**

```typescript
export type TArgumentEngineSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    argument: TOptionalChecksum<TArg>
    variables: TVariableManagerSnapshot<TVar>
    premises: TPremiseEngineSnapshot<TPremise, TExpr>[]
    conclusionPremiseId?: string
    config?: TLogicEngineOptions
}
```

**Step 2: Implement snapshot()**

Replaces `toData()` and `exportState()`.

```typescript
public snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar> {
    return {
        argument: { ...this.argument },
        variables: this.variables.snapshot(),
        premises: this.listPremises().map((pe) => pe.snapshot()),
        ...(this.conclusionPremiseId !== undefined
            ? { conclusionPremiseId: this.conclusionPremiseId }
            : {}),
        config: {
            checksumConfig: this.checksumConfig,
            positionConfig: this.positionConfig,
        },
    }
}
```

**Step 3: Implement fromSnapshot()**

```typescript
public static fromSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
): ArgumentEngine<TArg, TPremise, TExpr, TVar> {
    const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar>(
        snapshot.argument,
        snapshot.config
    )
    // Restore variables
    for (const v of snapshot.variables.variables) {
        engine.addVariable(v)
    }
    // Restore premises
    for (const premiseSnap of snapshot.premises) {
        const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
            premiseSnap,
            snapshot.argument,
            engine.variables
        )
        engine.premises.set(pe.getId(), pe)
    }
    // Restore roles
    if (snapshot.conclusionPremiseId !== undefined) {
        engine.conclusionPremiseId = snapshot.conclusionPremiseId
    }
    return engine
}
```

Note: `fromSnapshot` accesses `engine.variables` (private) and `engine.premises` (private). Since this is a static method on the same class, it has access to private fields.

**Step 4: Implement rollback()**

```typescript
public rollback(snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>): void {
    // Restore argument metadata
    this.argument = { ...snapshot.argument }
    // Restore config
    this.checksumConfig = snapshot.config?.checksumConfig
    this.positionConfig = snapshot.config?.positionConfig
    // Clear and restore variables
    this.variables = VariableManager.fromSnapshot<TVar>(snapshot.variables)
    // Clear and restore premises
    this.premises = new Map()
    for (const premiseSnap of snapshot.premises) {
        const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
            premiseSnap,
            this.argument,
            this.variables
        )
        this.premises.set(pe.getId(), pe)
    }
    // Restore roles
    this.conclusionPremiseId = snapshot.conclusionPremiseId
    this.markDirty()
}
```

**Step 5: Remove toData() and exportState()**

Delete both methods. Update any code that calls them:

- `src/lib/core/diff.ts`: `diffArguments` calls `pm.toData()` — change to use `pm.snapshot().premise` (the serialized premise data) plus `pm.getExpressions()` for expressions. Or adjust the diff to work with snapshots directly.
- `src/cli/engine.ts`: `persistEngine` calls `pm.toData()` — update to use `pm.snapshot()`.
- `src/cli/commands/expressions.ts`: calls `pm.toData()` after mutations — update to use `pm.snapshot()`.
- `src/cli/commands/analysis.ts`: calls `engine.exportState()` — update to use `engine.snapshot()`.
- `test/ExpressionManager.test.ts`: 44 calls to `.toData()` — update all to use `.snapshot()` and adjust assertions for the new snapshot shape.

**Step 6: Write tests**

New describe block `"ArgumentEngine — snapshot, fromSnapshot, and rollback"`:

```typescript
describe("ArgumentEngine — snapshot, fromSnapshot, and rollback", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("round-trips an empty engine", () => {
        const eng = new ArgumentEngine(ARG)
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)
        expect(restored.getArgument().id).toBe("arg-1")
        expect(restored.listPremiseIds()).toEqual([])
    })

    it("round-trips an engine with premises and variables", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable({ id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1 })
        const { result: pe } = eng.createPremise()
        pe.appendExpression(null, {
            id: "e1", type: "variable", variableId: "v1",
            argumentId: "arg-1", argumentVersion: 1, premiseId: pe.getId(),
            parentId: null,
        })
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)
        expect(restored.getVariables().length).toBe(1)
        expect(restored.listPremiseIds()).toEqual(eng.listPremiseIds())
    })

    it("rollback restores previous state", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable({ id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1 })
        const snap = eng.snapshot()
        // Mutate
        eng.addVariable({ id: "v2", symbol: "Q", argumentId: "arg-1", argumentVersion: 1 })
        eng.createPremise()
        expect(eng.getVariables().length).toBe(2)
        expect(eng.listPremiseIds().length).toBe(1)
        // Rollback
        eng.rollback(snap)
        expect(eng.getVariables().length).toBe(1)
        expect(eng.listPremiseIds()).toEqual([])
    })

    it("preserves conclusion role through round-trip", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: p1 } = eng.createPremise()
        const { result: p2 } = eng.createPremise()
        eng.setConclusionPremise(p2.getId())
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)
        expect(restored.getRoleState().conclusionPremiseId).toBe(p2.getId())
    })

    it("snapshot includes config", () => {
        const config = {
            positionConfig: { min: -100, max: 100, initial: 0 },
        }
        const eng = new ArgumentEngine(ARG, config)
        const snap = eng.snapshot()
        expect(snap.config?.positionConfig).toEqual(config.positionConfig)
    })
})
```

**Step 7: Run tests**

```bash
pnpm run typecheck && pnpm run test
```

**Step 8: Commit**

```bash
git add -A && git commit -m "feat: add snapshot/fromSnapshot/rollback to ArgumentEngine, remove toData/exportState"
```

---

### Task 11: Add ArgumentEngine.fromData() for bulk loading

**Files:**
- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Implement fromData()**

```typescript
public static fromData<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    argument: TOptionalChecksum<TArg>,
    variables: TOptionalChecksum<TVar>[],
    premises: TOptionalChecksum<TPremise>[],
    expressions: TExpressionInput<TExpr>[],
    roles: TCoreArgumentRoleState,
    config?: TLogicEngineOptions
): ArgumentEngine<TArg, TPremise, TExpr, TVar> {
    const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar>(argument, config)

    // Register variables
    for (const v of variables) {
        engine.addVariable(v)
    }

    // Group expressions by premiseId
    const exprsByPremise = new Map<string, TExpressionInput<TExpr>[]>()
    for (const expr of expressions) {
        const premiseId = (expr as unknown as { premiseId: string }).premiseId
        let group = exprsByPremise.get(premiseId)
        if (!group) {
            group = []
            exprsByPremise.set(premiseId, group)
        }
        group.push(expr)
    }

    // Create premises and load their expressions
    for (const premise of premises) {
        const { result: pe } = engine.createPremiseWithId(
            premise.id,
            // Extract extras (non-core fields) from the premise
            Object.fromEntries(
                Object.entries(premise).filter(
                    ([k]) => !["id", "argumentId", "argumentVersion",
                        "rootExpressionId", "variables", "expressions", "checksum"].includes(k)
                )
            )
        )
        // Add expressions in BFS order
        const premiseExprs = exprsByPremise.get(premise.id) ?? []
        const pending = new Map(premiseExprs.map((e) => [e.id, e]))
        let progressed = true
        while (pending.size > 0 && progressed) {
            progressed = false
            for (const [id, expr] of Array.from(pending.entries())) {
                if (expr.parentId !== null && !pe.getExpression(expr.parentId)) {
                    continue
                }
                pe.addExpression(expr)
                pending.delete(id)
                progressed = true
            }
        }
        if (pending.size > 0) {
            throw new Error(
                `Could not resolve parent relationships for expressions: ${Array.from(pending.keys()).join(", ")}`
            )
        }
    }

    // Set roles
    if (roles.conclusionPremiseId !== undefined) {
        engine.setConclusionPremise(roles.conclusionPremiseId)
    }

    return engine
}
```

**Step 2: Write tests**

New describe block `"ArgumentEngine — fromData bulk loading"`:

```typescript
describe("ArgumentEngine — fromData bulk loading", () => {
    it("loads an engine from flat arrays", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            { id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1 },
            { id: "v2", symbol: "Q", argumentId: "arg-1", argumentVersion: 1 },
        ]
        const premises = [
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
            { id: "p2", argumentId: "arg-1", argumentVersion: 1 },
        ]
        const expressions = [
            { id: "e1", type: "variable" as const, variableId: "v1",
              argumentId: "arg-1", argumentVersion: 1, premiseId: "p1",
              parentId: null, position: 0 },
            { id: "e2", type: "variable" as const, variableId: "v2",
              argumentId: "arg-1", argumentVersion: 1, premiseId: "p2",
              parentId: null, position: 0 },
        ]
        const roles = { conclusionPremiseId: "p2" }

        const engine = ArgumentEngine.fromData(arg, variables, premises, expressions, roles)
        expect(engine.getVariables().length).toBe(2)
        expect(engine.listPremiseIds()).toEqual(["p1", "p2"])
        expect(engine.getRoleState().conclusionPremiseId).toBe("p2")
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(1)
    })

    it("handles premises with no expressions", () => {
        const arg = { id: "arg-1", version: 1 }
        const engine = ArgumentEngine.fromData(arg, [], [{ id: "p1", argumentId: "arg-1", argumentVersion: 1 }], [], {})
        expect(engine.listPremiseIds()).toEqual(["p1"])
    })

    it("groups expressions by premiseId correctly", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            { id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1 },
        ]
        const premises = [
            { id: "p1", argumentId: "arg-1", argumentVersion: 1 },
            { id: "p2", argumentId: "arg-1", argumentVersion: 1 },
        ]
        const expressions = [
            { id: "e1", type: "variable" as const, variableId: "v1",
              argumentId: "arg-1", argumentVersion: 1, premiseId: "p1",
              parentId: null, position: 0 },
            { id: "e2", type: "variable" as const, variableId: "v1",
              argumentId: "arg-1", argumentVersion: 1, premiseId: "p2",
              parentId: null, position: 0 },
        ]
        const engine = ArgumentEngine.fromData(arg, variables, premises, expressions, {})
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(1)
        expect(engine.getPremise("p2")?.getExpressions().length).toBe(1)
    })

    it("infers generic types from parameters", () => {
        type MyArg = TCoreArgument & { customField: string }
        const arg: MyArg = { id: "arg-1", version: 1, checksum: "x", customField: "hello" }
        const engine = ArgumentEngine.fromData(arg, [], [], [], {})
        // TypeScript should infer ArgumentEngine<MyArg, ...>
        const result = engine.getArgument()
        expect(result.customField).toBe("hello")
    })
})
```

**Step 3: Run tests**

```bash
pnpm run test
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add ArgumentEngine.fromData for bulk loading from flat arrays"
```

---

### Task 12: Add toDisplayString() to ArgumentEngine

**Files:**
- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `test/ExpressionManager.test.ts`

**Step 1: Implement toDisplayString()**

```typescript
public toDisplayString(): string {
    const lines: string[] = []
    const arg = this.getArgument()
    lines.push(`Argument: ${arg.id} (v${arg.version})`)
    lines.push("")

    const conclusion = this.getConclusionPremise()
    const supportingPremises = this.listSupportingPremises()
    const supportingIds = new Set(supportingPremises.map((pe) => pe.getId()))

    for (const pe of this.listPremises()) {
        let role: string
        if (pe.getId() === this.conclusionPremiseId) {
            role = "Conclusion"
        } else if (supportingIds.has(pe.getId())) {
            role = "Supporting"
        } else {
            role = "Constraint"
        }
        const display = pe.toDisplayString() || "(empty)"
        lines.push(`[${role}] ${display}`)
    }

    return lines.join("\n")
}
```

**Step 2: Write tests**

New describe block `"ArgumentEngine — toDisplayString"`:

```typescript
describe("ArgumentEngine — toDisplayString", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("renders an empty argument", () => {
        const eng = new ArgumentEngine(ARG)
        const display = eng.toDisplayString()
        expect(display).toContain("Argument: arg-1 (v1)")
    })

    it("labels premise roles correctly", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable({ id: "v1", symbol: "P", argumentId: "arg-1", argumentVersion: 1 })
        eng.addVariable({ id: "v2", symbol: "Q", argumentId: "arg-1", argumentVersion: 1 })

        // Create conclusion (inference: P => Q)
        const { result: p1 } = eng.createPremise()
        p1.appendExpression(null, {
            id: "op1", type: "operator", operator: "implies",
            argumentId: "arg-1", argumentVersion: 1, premiseId: p1.getId(),
            parentId: null,
        })
        p1.appendExpression("op1", {
            id: "e1", type: "variable", variableId: "v1",
            argumentId: "arg-1", argumentVersion: 1, premiseId: p1.getId(),
        })
        p1.appendExpression("op1", {
            id: "e2", type: "variable", variableId: "v2",
            argumentId: "arg-1", argumentVersion: 1, premiseId: p1.getId(),
        })

        // Create constraint (just P)
        const { result: p2 } = eng.createPremise()
        p2.appendExpression(null, {
            id: "e3", type: "variable", variableId: "v1",
            argumentId: "arg-1", argumentVersion: 1, premiseId: p2.getId(),
            parentId: null,
        })

        const display = eng.toDisplayString()
        expect(display).toContain("[Conclusion]")
        expect(display).toContain("[Constraint]")
    })
})
```

**Step 3: Run tests**

```bash
pnpm run test
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add toDisplayString to ArgumentEngine"
```

---

### Task 13: Update diff module for PremiseEngine and snapshot

**Files:**
- Modify: `src/lib/core/diff.ts` (update for PremiseEngine, replace toData calls)
- Modify: `test/ExpressionManager.test.ts` (update diff tests if needed)

**Step 1: Update imports and type references**

Replace all `PremiseManager` references with `PremiseEngine`. Replace `pm.toData()` calls with snapshot-based data extraction.

In `diffArguments`:

```typescript
// Before:
const premisesA = engineA.listPremises().map((pm) => pm.toData())
const premisesB = engineB.listPremises().map((pm) => pm.toData())
// After:
const premisesA = engineA.listPremises().map((pe) => {
    const snap = pe.snapshot()
    return { ...snap.premise, expressions: snap.expressions.expressions } as TPremise
})
```

Or simpler: add a convenience method to PremiseEngine that returns the serialized premise data (essentially what `toData()` did). Actually, since `snapshot()` already has all the data, and the diff module needs `TCorePremise[]` (which has `expressions` embedded), we can reconstruct it from the snapshot.

Alternatively, keep a `toPremiseData()` method that builds the `TPremise` shape from the snapshot for backward compatibility with consumers that need the flattened premise format. But this goes against removing `toData()`. Let the diff module use `snapshot()` and extract what it needs.

**Step 2: Run tests**

```bash
pnpm run typecheck && pnpm run test
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: update diff module for PremiseEngine and snapshot API"
```

---

### Task 14: Update CLI for all changes

**Files:**
- Modify: `src/cli/engine.ts` (update hydrateEngine and persistEngine)
- Modify: `src/cli/commands/premises.ts` (update PremiseManager -> PremiseEngine)
- Modify: `src/cli/commands/expressions.ts` (update toData -> snapshot)
- Modify: `src/cli/commands/analysis.ts` (update exportState -> snapshot)
- Modify: `src/cli/import.ts` (update for new schema fields)

**Step 1: Update engine.ts**

`hydrateEngine`: Could now use `ArgumentEngine.fromData()` instead of manually constructing everything. The flat arrays from disk reads map directly to `fromData` parameters. However, expression data on disk may not yet have `premiseId` (backward compatibility). Add `premiseId` during hydration if missing.

`persistEngine`: Replace `pm.toData()` with `pm.snapshot()` and extract the premise data for disk writes.

**Step 2: Update all command files**

Replace `PremiseManager` imports with `PremiseEngine`. Replace `.toData()` calls with `.snapshot()` and extract needed fields. Replace `.exportState()` with `.snapshot()`.

**Step 3: Update import.ts**

Add `premiseId` to expression objects created during YAML import. Add `argumentId`/`argumentVersion` to premise objects.

**Step 4: Run full check**

```bash
pnpm run check
```

**Step 5: Run smoke test**

```bash
pnpm run build && bash scripts/smoke-test.sh
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: update CLI for PremiseEngine rename and snapshot API"
```

---

### Task 15: Update exports and re-export snapshot types

**Files:**
- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`
- Modify: `src/lib/types/evaluation.ts` (remove TCoreArgumentEngineData if fully replaced)

**Step 1: Export new snapshot types**

Add exports for:
- `TExpressionManagerSnapshot` from `ExpressionManager.ts`
- `TVariableManagerSnapshot` from `VariableManager.ts`
- `TPremiseEngineSnapshot` from `PremiseEngine.ts`
- `TArgumentEngineSnapshot` from `ArgumentEngine.ts`
- `TLogicEngineOptions` from `ArgumentEngine.ts`

**Step 2: Remove deprecated exports**

- Remove `TCoreArgumentEngineData` export (if no longer used anywhere)
- Remove `TArgumentEngineOptions` export

**Step 3: Run typecheck**

```bash
pnpm run typecheck
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: export snapshot types, remove deprecated TCoreArgumentEngineData"
```

---

### Task 16: Final cleanup and lint

**Step 1: Run full lint and fix**

```bash
pnpm eslint . --fix && pnpm run prettify
```

**Step 2: Run full check**

```bash
pnpm run check
```

This runs typecheck, lint, test, and build in sequence. All must pass.

**Step 3: Run smoke test**

```bash
bash scripts/smoke-test.sh
```

**Step 4: Commit any lint fixes**

```bash
git add -A && git commit -m "chore: lint and format fixes"
```

---

### Task 17: Update documentation and generate release notes

**Files:**
- Modify: `README.md` — update API reference for renamed classes/types, new snapshot/rollback API, fromData, toDisplayString, removed toData/exportState
- Modify: `CLAUDE.md` — update architecture section, class hierarchy, types section, key design decisions (snapshot types, cumulative checksums, constructor parameter groups, schema changes)
- Modify: `CLI_EXAMPLES.md` — update any references to toData/exportState/PremiseManager
- Modify: `scripts/smoke-test.sh` — add coverage for `export` command using snapshot instead of exportState
- Create: `release_notes.md` — patch notes for consumers of this package

**Step 1: Update README.md**

- Rename all `PremiseManager` references to `PremiseEngine`
- Replace `TArgumentEngineOptions` with `TLogicEngineOptions`
- Document new methods: `snapshot()`, `fromSnapshot()`, `rollback()`, `fromData()`, `toDisplayString()`
- Remove documentation for `toData()`, `exportState()`, `TCoreArgumentEngineData`
- Document new schema fields: `premiseId` on expressions, `argumentId`/`argumentVersion` on premises
- Document constructor changes (entity data, dependencies, config grouping)

**Step 2: Update CLAUDE.md**

- Update class hierarchy section
- Update constructor signatures in architecture section
- Update types section with snapshot types
- Update key design decisions (cumulative checksums, expression checksum normalization)
- Add snapshot/rollback design decision section
- Update `describe` block list in testing section
- Rename PremiseManager -> PremiseEngine throughout

**Step 3: Update CLI_EXAMPLES.md**

- Replace any `PremiseManager` references with `PremiseEngine`
- Update `export` command output to reflect snapshot format

**Step 4: Update smoke-test.sh**

- If the smoke test uses the `export` command, update expected output format

**Step 5: Generate release_notes.md**

Create `release_notes.md` at the project root with the following structure:

```markdown
# Release Notes — proposit-core vX.Y.Z

## Breaking Changes

### Class renamed: PremiseManager -> PremiseEngine
All imports of `PremiseManager` must be updated to `PremiseEngine`. The class is functionally identical but renamed for consistency — it operates on a single premise (like `ArgumentEngine` operates on a single argument), not a collection.

### Type renamed: TArgumentEngineOptions -> TLogicEngineOptions
Identical shape, new name. Now used across all classes in the hierarchy.

### Removed: toData(), exportState(), TCoreArgumentEngineData
Replaced by `snapshot()` which returns a hierarchical `TArgumentEngineSnapshot` (or `TPremiseEngineSnapshot` at the premise level). The snapshot captures owned state + config. See migration guide below.

### Constructor changes
- **PremiseEngine** now takes `(premise: TOptionalChecksum<TPremise>, deps: { argument, variables }, config?)` instead of `(id, argument, variables, extras?, checksumConfig?, positionConfig?)`.
- **ExpressionManager** constructor no longer accepts initial expressions. Use `fromSnapshot()` or individual `addExpression()` calls.
- **VariableManager** constructor no longer accepts initial variables. Use `fromSnapshot()` or individual `addVariable()` calls.

### Schema changes
- **Expressions** now have a required `premiseId: string` field
- **Premises** now have required `argumentId: string` and `argumentVersion: number` fields
- Existing serialized data missing these fields will need migration

### Checksum values changed
Checksum computation now uses cumulative `{entity_id: entity_checksum}` maps instead of concatenated strings. All checksum values will differ from previous versions. Expression checksums now include `premiseId`. Premise checksums now include `argumentId` and `argumentVersion`.

## New Features

### Snapshot/Restore
- `engine.snapshot()` — captures full engine state as a plain object
- `ArgumentEngine.fromSnapshot(snapshot)` — reconstructs engine from snapshot
- `engine.rollback(snapshot)` — restores engine state in place
- Each class in the hierarchy (`ExpressionManager`, `VariableManager`, `PremiseEngine`, `ArgumentEngine`) has its own `snapshot()` and `static fromSnapshot()`

### Bulk loading
- `ArgumentEngine.fromData(argument, variables[], premises[], expressions[], roles, config?)` — loads from flat arrays (DB-friendly). Groups expressions by `premiseId`. Generic types inferred from parameters.

### ArgumentEngine.toDisplayString()
Renders the full argument as a multi-line string with role labels (Conclusion, Supporting, Constraint).

## Migration Guide

### toData() -> snapshot()
```typescript
// Before
const data = engine.toData()  // TCoreArgumentEngineData
const premiseData = premise.toData()  // TCorePremise

// After
const snap = engine.snapshot()  // TArgumentEngineSnapshot
const premiseSnap = premise.snapshot()  // TPremiseEngineSnapshot
```

### PremiseManager -> PremiseEngine
```typescript
// Before
import { PremiseManager } from "proposit-core"
const pm = new PremiseManager(id, argument, variables, extras)

// After
import { PremiseEngine } from "proposit-core"
const pe = new PremiseEngine(
    { id, argumentId: argument.id, argumentVersion: argument.version, ...extras },
    { argument, variables },
    config
)
```

### Expression objects
```typescript
// Before
const expr = { id: "e1", type: "variable", variableId: "v1",
    argumentId: "arg-1", argumentVersion: 1,
    parentId: null, position: 0 }

// After (add premiseId)
const expr = { id: "e1", type: "variable", variableId: "v1",
    argumentId: "arg-1", argumentVersion: 1, premiseId: "p1",
    parentId: null, position: 0 }
```
```

**Step 6: Run full check one final time**

```bash
pnpm run check
```

**Step 7: Commit**

```bash
git add -A && git commit -m "docs: update documentation and generate release notes"
```
