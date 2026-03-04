# Variable Management Uplift Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move variable CRUD from PremiseManager to ArgumentEngine via a shared VariableManager, cascade-delete expressions on variable removal, refactor checksum config to use Set\<string\> with exported defaults.

**Architecture:** ArgumentEngine owns a single VariableManager instance shared by reference with all PremiseManagers. Variable mutations go through ArgumentEngine, which coordinates cascade deletion across premises. Checksum config uses Set\<string\> fields with a single exported DEFAULT_CHECKSUM_CONFIG constant and a createChecksumConfig merge utility.

**Tech Stack:** TypeScript, Vitest, Typebox schemata

---

### Task 1: Checksum config — change TCoreChecksumConfig to use Set\<string\>

**Files:**

- Modify: `src/lib/types/checksum.ts`
- Modify: `src/lib/core/checksum.ts:36-47` (entityChecksum)

**Step 1: Update TCoreChecksumConfig type**

In `src/lib/types/checksum.ts`, change all `string[]` fields to `Set<string>`:

```typescript
/** Configuration for which fields to include in entity checksums. */
export interface TCoreChecksumConfig {
    /** Fields to hash for expression entities. Defaults to all base expression fields. */
    expressionFields?: Set<string>
    /** Fields to hash for variable entities. Defaults to all variable fields. */
    variableFields?: Set<string>
    /** Fields to hash for premise metadata. Defaults to ["id", "rootExpressionId"]. */
    premiseFields?: Set<string>
    /** Fields to hash for argument metadata. Defaults to ["id", "version"]. */
    argumentFields?: Set<string>
    /** Fields to hash for role state. Defaults to ["conclusionPremiseId"]. */
    roleFields?: Set<string>
}
```

**Step 2: Update entityChecksum to accept Set\<string\>**

In `src/lib/core/checksum.ts`, change `fields: string[]` → `fields: Iterable<string>`:

```typescript
export function entityChecksum(
    entity: Record<string, unknown>,
    fields: Iterable<string>
): string {
    const picked: Record<string, unknown> = {}
    for (const field of [...fields].sort()) {
        if (field in entity) {
            picked[field] = entity[field]
        }
    }
    return computeHash(canonicalSerialize(picked))
}
```

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: FAIL — PremiseManager and ArgumentEngine pass `string[]` literals. These will be fixed in Task 2.

**Step 4: Commit**

```
Refactor TCoreChecksumConfig fields from string[] to Set<string>
```

---

### Task 2: Create DEFAULT_CHECKSUM_CONFIG and createChecksumConfig

**Files:**

- Create: `src/lib/consts.ts`
- Modify: `src/lib/core/PremiseManager.ts:36-52` (remove DEFAULT\_\*\_FIELDS)
- Modify: `src/lib/core/PremiseManager.ts:482,496,938,952,998-1039` (use DEFAULT_CHECKSUM_CONFIG)
- Modify: `src/lib/core/ArgumentEngine.ts:237,245` (use DEFAULT_CHECKSUM_CONFIG)
- Modify: `src/lib/index.ts` (add exports)
- Modify: `src/index.ts` (add exports)

**Step 1: Create src/lib/consts.ts**

```typescript
import type { TCoreChecksumConfig } from "./types/checksum.js"

export const DEFAULT_CHECKSUM_CONFIG: Readonly<TCoreChecksumConfig> = {
    expressionFields: new Set([
        "id",
        "type",
        "parentId",
        "position",
        "argumentId",
        "argumentVersion",
        "variableId",
        "operator",
    ]),
    variableFields: new Set(["id", "symbol", "argumentId", "argumentVersion"]),
    premiseFields: new Set(["id", "rootExpressionId"]),
    argumentFields: new Set(["id", "version"]),
    roleFields: new Set(["conclusionPremiseId"]),
}

/**
 * Creates a checksum config by merging additional fields into the defaults.
 * Omitted fields in `additional` inherit defaults. Fields are unioned, not replaced.
 */
export function createChecksumConfig(
    additional: TCoreChecksumConfig
): TCoreChecksumConfig {
    const keys = [
        "expressionFields",
        "variableFields",
        "premiseFields",
        "argumentFields",
        "roleFields",
    ] as const
    const result: TCoreChecksumConfig = {}
    for (const key of keys) {
        const base = DEFAULT_CHECKSUM_CONFIG[key]!
        const extra = additional[key]
        result[key] = extra ? new Set([...base, ...extra]) : new Set(base)
    }
    return result
}
```

**Step 2: Update PremiseManager to use DEFAULT_CHECKSUM_CONFIG**

Remove lines 36-52 (the `DEFAULT_EXPRESSION_FIELDS` and `DEFAULT_VARIABLE_FIELDS` constants).

Add import at top:

```typescript
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
```

Replace all uses of `DEFAULT_EXPRESSION_FIELDS` with `DEFAULT_CHECKSUM_CONFIG.expressionFields!` and `DEFAULT_VARIABLE_FIELDS` with `DEFAULT_CHECKSUM_CONFIG.variableFields!`. Specifically:

- `getVariables()` (~line 482): `this.checksumConfig?.variableFields ?? DEFAULT_CHECKSUM_CONFIG.variableFields!`
- `getExpressions()` (~line 496): `this.checksumConfig?.expressionFields ?? DEFAULT_CHECKSUM_CONFIG.expressionFields!`
- `attachExpressionChecksum()` (~line 938): same pattern
- `attachVariableChecksum()` (~line 952): same pattern
- `computeChecksum()` (~lines 998-1039): replace all inline arrays with `DEFAULT_CHECKSUM_CONFIG.*!` references

**Step 3: Update ArgumentEngine to use DEFAULT_CHECKSUM_CONFIG**

Add import:

```typescript
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
```

In `computeChecksum()` (~lines 237, 245):

- Replace `config?.argumentFields ?? ["id", "version"]` with `config?.argumentFields ?? DEFAULT_CHECKSUM_CONFIG.argumentFields!`
- Replace `config?.roleFields ?? ["conclusionPremiseId"]` with `config?.roleFields ?? DEFAULT_CHECKSUM_CONFIG.roleFields!`

**Step 4: Export from barrel files**

In `src/lib/index.ts`, add:

```typescript
export { DEFAULT_CHECKSUM_CONFIG, createChecksumConfig } from "./consts.js"
```

In `src/index.ts`, add:

```typescript
export { DEFAULT_CHECKSUM_CONFIG, createChecksumConfig } from "./lib/consts.js"
```

**Step 5: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS — all existing tests should pass since defaults are identical.

**Step 6: Commit**

```
Add DEFAULT_CHECKSUM_CONFIG and createChecksumConfig, remove inline defaults
```

---

### Task 3: Write tests for checksum config changes

**Files:**

- Modify: `test/ExpressionManager.test.ts` (add tests at end)

**Step 1: Write tests for createChecksumConfig**

Add a new `describe` block at the end of the test file:

```typescript
describe("createChecksumConfig", () => {
    it("returns defaults when given empty config", () => {
        const config = createChecksumConfig({})
        expect(config.expressionFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.expressionFields
        )
        expect(config.variableFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.variableFields
        )
        expect(config.premiseFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.premiseFields
        )
        expect(config.argumentFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.argumentFields
        )
        expect(config.roleFields).toEqual(DEFAULT_CHECKSUM_CONFIG.roleFields)
    })

    it("merges additional fields into defaults", () => {
        const config = createChecksumConfig({
            expressionFields: new Set(["customField"]),
        })
        expect(config.expressionFields!.has("id")).toBe(true)
        expect(config.expressionFields!.has("customField")).toBe(true)
    })

    it("does not duplicate fields already in defaults", () => {
        const config = createChecksumConfig({
            variableFields: new Set(["id", "extra"]),
        })
        const arr = [...config.variableFields!]
        expect(arr.filter((f) => f === "id")).toHaveLength(1)
        expect(config.variableFields!.has("extra")).toBe(true)
    })

    it("returns a new Set instance (not the same reference as defaults)", () => {
        const config = createChecksumConfig({})
        expect(config.expressionFields).not.toBe(
            DEFAULT_CHECKSUM_CONFIG.expressionFields
        )
    })
})
```

Add imports for `DEFAULT_CHECKSUM_CONFIG` and `createChecksumConfig` at the top of the test file:

```typescript
import {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
} from "../src/lib/consts"
```

**Step 2: Run the new tests**

Run: `pnpm run test`
Expected: PASS

**Step 3: Commit**

```
Add tests for createChecksumConfig
```

---

### Task 4: Update VariableManager — add updateVariable method

**Files:**

- Modify: `src/lib/core/VariableManager.ts`

**Step 1: Write failing test**

Add a new `describe` block at the end of `test/ExpressionManager.test.ts`:

```typescript
describe("VariableManager — updateVariable via ArgumentEngine", () => {
    it("updates a variable symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result } = eng.updateVariable(VAR_P.id, { symbol: "P_new" })
        expect(result?.symbol).toBe("P_new")
    })

    it("throws when new symbol conflicts", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        expect(() => eng.updateVariable(VAR_P.id, { symbol: "Q" })).toThrow(
            /already in use/
        )
    })

    it("returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG)
        const { result } = eng.updateVariable("nonexistent", { symbol: "X" })
        expect(result).toBeUndefined()
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm run test`
Expected: FAIL — `eng.addVariable` and `eng.updateVariable` don't exist yet.

**Step 3: Add updateVariable to VariableManager**

VariableManager already has `renameVariable()`. We need a more general `updateVariable` that accepts an updates object. Add after `renameVariable()` (~line 97):

```typescript
/**
 * Updates fields on an existing variable.
 * Currently supports `symbol` updates.
 *
 * @throws If the new symbol is already in use by a different variable.
 * @returns The updated variable, or `undefined` if not found.
 */
public updateVariable(
    variableId: string,
    updates: { symbol?: string }
): TCorePropositionalVariable | undefined {
    const variable = this.variables.get(variableId)
    if (!variable) return undefined

    if (updates.symbol !== undefined) {
        this.renameVariable(variableId, updates.symbol)
    }

    return this.variables.get(variableId)
}
```

**Step 4: Commit (test still fails — engine methods needed in Task 5)**

```
Add updateVariable to VariableManager
```

---

### Task 5: Move variable CRUD to ArgumentEngine

This is the core task. ArgumentEngine gets `addVariable`, `updateVariable`, `removeVariable`, and owns the shared VariableManager.

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`
- Modify: `src/lib/core/PremiseManager.ts`

**Step 1: Update ArgumentEngine — add VariableManager and variable methods**

Add import at top of `ArgumentEngine.ts`:

```typescript
import { VariableManager } from "./VariableManager.js"
import type { TCorePropositionalVariable } from "../schemata/index.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
```

Add `variables` field to class (after `private premises`):

```typescript
private variables: VariableManager
```

Initialize in constructor (after `this.premises = new Map()`):

```typescript
this.variables = new VariableManager()
```

Pass shared VariableManager to `createPremiseWithId()` — change the PremiseManager constructor call (~line 87-92):

```typescript
const pm = new PremiseManager(
    id,
    this.argument,
    this.variables,
    extras,
    this.checksumConfig
)
```

Add three public methods after `listPremises()` (before `getRoleState()`):

```typescript
/**
 * Registers a propositional variable for use across all premises.
 *
 * @throws If `variable.symbol` is already in use.
 * @throws If `variable.id` already exists.
 * @throws If the variable does not belong to this argument.
 */
public addVariable(
    variable: TCorePropositionalVariable
): TCoreMutationResult<TCorePropositionalVariable> {
    if (variable.argumentId !== this.argument.id) {
        throw new Error(
            `Variable argumentId "${variable.argumentId}" does not match engine argument ID "${this.argument.id}".`
        )
    }
    if (variable.argumentVersion !== this.argument.version) {
        throw new Error(
            `Variable argumentVersion "${variable.argumentVersion}" does not match engine argument version "${this.argument.version}".`
        )
    }
    this.variables.addVariable(variable)
    const collector = new ChangeCollector()
    collector.addedVariable({ ...variable })
    this.markDirty()
    return {
        result: this.attachVariableChecksum({ ...variable }),
        changes: collector.toChangeset(),
    }
}

/**
 * Updates fields on an existing variable. Since all premises share the
 * same VariableManager, the update is immediately visible everywhere.
 *
 * @throws If the new symbol is already in use by a different variable.
 */
public updateVariable(
    variableId: string,
    updates: { symbol?: string }
): TCoreMutationResult<TCorePropositionalVariable | undefined> {
    const updated = this.variables.updateVariable(variableId, updates)
    const collector = new ChangeCollector()
    if (updated) {
        collector.modifiedVariable({ ...updated })
        this.markDirty()
    }
    return {
        result: updated ? this.attachVariableChecksum({ ...updated }) : undefined,
        changes: collector.toChangeset(),
    }
}

/**
 * Removes a variable and cascade-deletes all expressions referencing it
 * across every premise (including subtrees and operator collapse).
 */
public removeVariable(
    variableId: string
): TCoreMutationResult<TCorePropositionalVariable | undefined> {
    const variable = this.variables.getVariable(variableId)
    if (!variable) {
        return { result: undefined, changes: {} }
    }

    const collector = new ChangeCollector()

    // Cascade: delete referencing expressions in every premise
    for (const pm of this.listPremises()) {
        const { changes } = pm.deleteExpressionsUsingVariable(variableId)
        if (changes.expressions) {
            for (const e of changes.expressions.removed) {
                collector.removedExpression(e)
            }
        }
    }

    this.variables.removeVariable(variableId)
    collector.removedVariable({ ...variable })
    this.markDirty()
    return {
        result: this.attachVariableChecksum({ ...variable }),
        changes: collector.toChangeset(),
    }
}

/** Returns all registered variables sorted by ID. */
public getVariables(): TCorePropositionalVariable[] {
    const fields =
        this.checksumConfig?.variableFields ??
        DEFAULT_CHECKSUM_CONFIG.variableFields!
    return this.variables.toArray().map((v) => ({
        ...v,
        checksum: entityChecksum(
            v as unknown as Record<string, unknown>,
            fields
        ),
    }))
}
```

Add private helper for variable checksums (near the other private helpers):

```typescript
private attachVariableChecksum(
    v: TCorePropositionalVariable
): TCorePropositionalVariable {
    const fields =
        this.checksumConfig?.variableFields ??
        DEFAULT_CHECKSUM_CONFIG.variableFields!
    return {
        ...v,
        checksum: entityChecksum(
            v as unknown as Record<string, unknown>,
            fields
        ),
    }
}
```

Add `modifiedVariable` to ChangeCollector (it currently lacks one):

In `src/lib/core/ChangeCollector.ts`, add after `removedVariable`:

```typescript
modifiedVariable(variable: TCorePropositionalVariable): void {
    this.variables.modified.push(variable)
}
```

**Step 2: Update PremiseManager — accept shared VariableManager, remove addVariable/removeVariable, add deleteExpressionsUsingVariable**

Change constructor signature to accept `VariableManager`:

```typescript
constructor(
    id: string,
    argument: TCoreArgument,
    variables: VariableManager,
    extras?: Record<string, unknown>,
    checksumConfig?: TCoreChecksumConfig
) {
    this.id = id
    this.argument = argument
    this.extras = extras ?? {}
    this.checksumConfig = checksumConfig
    this.rootExpressionId = undefined
    this.variables = variables
    this.expressions = new ExpressionManager()
    this.expressionsByVariableId = new DefaultMap(() => new Set())
}
```

Remove `addVariable()` method (lines 89-104).

Remove `removeVariable()` method (lines 112-132).

Add `deleteExpressionsUsingVariable()`:

```typescript
/**
 * Deletes all expressions that reference the given variable ID,
 * including their subtrees. Operator collapse runs after each removal.
 * Returns all removed expressions in the changeset.
 */
public deleteExpressionsUsingVariable(
    variableId: string
): TCoreMutationResult<TCorePropositionalExpression[]> {
    const expressionIds = this.expressionsByVariableId.get(variableId)
    if (expressionIds.size === 0) {
        return { result: [], changes: {} }
    }

    const removed: TCorePropositionalExpression[] = []
    const collector = new ChangeCollector()

    // Copy the set since removeExpression mutates expressionsByVariableId
    for (const exprId of [...expressionIds]) {
        // The expression may already have been removed as part of a
        // prior subtree deletion or operator collapse in this loop.
        if (!this.expressions.getExpression(exprId)) continue

        const { result, changes } = this.removeExpression(exprId)
        if (result) removed.push(result)
        if (changes.expressions) {
            for (const e of changes.expressions.removed) {
                collector.removedExpression(e)
            }
        }
    }

    return {
        result: removed,
        changes: collector.toChangeset(),
    }
}
```

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: FAIL — tests and CLI still reference `pm.addVariable()`. Fix in later tasks.

**Step 4: Commit**

```
Move variable CRUD to ArgumentEngine, add deleteExpressionsUsingVariable
```

---

### Task 6: Update existing tests for new variable API

All tests that call `pm.addVariable()` must be changed to `eng.addVariable()`. Tests that call `pm.removeVariable()` must use `eng.removeVariable()`. The `premiseWithVars()` and `makePremise()` helpers need updating too.

**Files:**

- Modify: `test/ExpressionManager.test.ts`

**Step 1: Update test helpers**

The `premiseWithVars()` helper (line 118-125) creates an engine internally but only returns the premise. It now needs to call `eng.addVariable()` instead of `pm.addVariable()`:

```typescript
function premiseWithVars(): PremiseManager {
    const eng = new ArgumentEngine(ARG)
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}
```

Note: `addVariable` is called on the engine BEFORE `createPremise`, because the shared VariableManager is passed by reference. Alternatively, order doesn't matter since the VariableManager is shared. But adding variables first is more natural.

The `makePremise()` helper (line 128-130) creates a PremiseManager directly. Since PremiseManager now requires a VariableManager argument, update it:

```typescript
function makePremise(extras?: Record<string, unknown>): PremiseManager {
    const vm = new VariableManager()
    return new PremiseManager("premise-1", ARG, vm, extras)
}
```

Add import for VariableManager:

```typescript
import { VariableManager } from "../src/lib/core/VariableManager"
```

**Step 2: Update all pm.addVariable() calls**

Search for `pm.addVariable(` and `.addVariable(` across the test file. These broadly fall into:

1. **Tests that use `premiseWithVars()`** — already handled by the helper update.
2. **Tests that create their own engine + premise** — change `pm.addVariable(VAR_P)` to `eng.addVariable(VAR_P)`. In many of these tests, the engine is created inline and the premise returned. These need refactoring to keep a reference to the engine.
3. **Multi-premise tests** (ArgumentEngine roles/evaluation) — the helpers like `buildPremiseP`, `buildPremiseQ`, `buildPremiseImplies`, and `addVars` currently call `pm.addVariable()`. These must be changed to accept and use the engine instead.

Key patterns to update:

For the `buildPremise*` helpers (~lines 1714-1743), change to accept engine:

```typescript
function buildPremiseP(eng: ArgumentEngine, pm: PremiseManager) {
    pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
}

function buildPremiseQ(eng: ArgumentEngine, pm: PremiseManager) {
    pm.addExpression(makeVarExpr(`${pm.getId()}-q`, VAR_Q.id))
}

function buildPremiseImplies(eng: ArgumentEngine, pm: PremiseManager) {
    const rootId = `${pm.getId()}-impl`
    pm.addExpression(makeOpExpr(rootId, "implies"))
    pm.addExpression(
        makeVarExpr(`${rootId}-p`, VAR_P.id, {
            parentId: rootId,
            position: 0,
        })
    )
    pm.addExpression(
        makeVarExpr(`${rootId}-q`, VAR_Q.id, {
            parentId: rootId,
            position: 1,
        })
    )
}
```

And the callers register variables on the engine once, before building premises.

For the `addVars` helper (~line 1857-1862), change to use engine:

```typescript
// No longer needed — variables are registered once on the engine
```

For individual tests that do `pm.addVariable(VAR_P)`:

- Change to `eng.addVariable(VAR_P)` where `eng` is the ArgumentEngine.
- Some tests create premises directly via `new PremiseManager(...)` with no engine — these need a VariableManager passed in, and variable registration done on that VariableManager (or use an engine instead).

**Step 3: Update pm.removeVariable() calls**

The `removeVariable` describe block (lines 782-806) and the `PremiseManager — addVariable / removeVariable` block (lines 1364-1412) need rewriting:

- Tests for `removeVariable` behavior move to engine-level tests.
- The "throws when removing referenced variable" test changes to "cascade-deletes referencing expressions".
- The "throws when adding expression that references unregistered variable" test stays (PremiseManager still validates).

**Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS — all existing tests pass with new API.

**Step 5: Commit**

```
Update tests for argument-level variable management
```

---

### Task 7: Write new tests for variable cascade deletion and engine-level variable methods

**Files:**

- Modify: `test/ExpressionManager.test.ts`

**Step 1: Write tests for ArgumentEngine variable CRUD**

Add a new `describe` block at the end:

```typescript
describe("ArgumentEngine — variable management", () => {
    it("addVariable registers a variable accessible from all premises", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm1 } = eng.createPremise()
        const { result: pm2 } = eng.createPremise()
        // Both premises can reference the variable
        pm1.addExpression(makeVarExpr("e1", VAR_P.id))
        pm2.addExpression(makeVarExpr("e2", VAR_P.id))
        expect(pm1.getVariables()).toHaveLength(1)
        expect(pm2.getVariables()).toHaveLength(1)
    })

    it("addVariable throws for duplicate symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(makeVar("var-p2", "P"))).toThrow(
            /already exists/
        )
    })

    it("addVariable throws for duplicate id", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(VAR_P)).toThrow(/already exists/)
    })

    it("addVariable throws for wrong argumentId", () => {
        const eng = new ArgumentEngine(ARG)
        expect(() =>
            eng.addVariable({ ...VAR_P, argumentId: "other" })
        ).toThrow(/does not match/)
    })

    it("addVariable throws for wrong argumentVersion", () => {
        const eng = new ArgumentEngine(ARG)
        expect(() =>
            eng.addVariable({ ...VAR_P, argumentVersion: 99 })
        ).toThrow(/does not match/)
    })

    it("addVariable returns mutation result with changeset", () => {
        const eng = new ArgumentEngine(ARG)
        const { result, changes } = eng.addVariable(VAR_P)
        expect(result.id).toBe(VAR_P.id)
        expect(result.checksum).toBeDefined()
        expect(changes.variables?.added).toHaveLength(1)
    })

    it("updateVariable renames a symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result } = eng.updateVariable(VAR_P.id, { symbol: "P_new" })
        expect(result?.symbol).toBe("P_new")
        // All premises see the update
        const { result: pm } = eng.createPremise()
        expect(pm.getVariables()[0].symbol).toBe("P_new")
    })

    it("updateVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG)
        const { result } = eng.updateVariable("nope", { symbol: "X" })
        expect(result).toBeUndefined()
    })

    it("updateVariable throws for conflicting symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        expect(() => eng.updateVariable(VAR_P.id, { symbol: "Q" })).toThrow(
            /already in use/
        )
    })

    it("updateVariable returns changeset with modified variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { changes } = eng.updateVariable(VAR_P.id, { symbol: "X" })
        expect(changes.variables?.modified).toHaveLength(1)
        expect(changes.variables?.modified[0].symbol).toBe("X")
    })

    it("getVariables returns all variables with checksums", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const vars = eng.getVariables()
        expect(vars).toHaveLength(2)
        expect(vars[0].checksum).toBeDefined()
        expect(vars[1].checksum).toBeDefined()
    })

    it("removeVariable with no references removes cleanly", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result, changes } = eng.removeVariable(VAR_P.id)
        expect(result?.id).toBe(VAR_P.id)
        expect(changes.variables?.removed).toHaveLength(1)
        expect(eng.getVariables()).toHaveLength(0)
    })

    it("removeVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG)
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("removeVariable cascade-deletes referencing expressions in one premise", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", VAR_P.id))
        pm.addExpression(makeVarExpr("e-q", VAR_Q.id))

        const { changes } = eng.removeVariable(VAR_P.id)
        expect(changes.expressions?.removed.length).toBeGreaterThan(0)
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(pm.getExpression("e-q")).toBeDefined()
    })

    it("removeVariable cascade-deletes across multiple premises", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm1 } = eng.createPremise()
        const { result: pm2 } = eng.createPremise()
        pm1.addExpression(makeVarExpr("e1-p", VAR_P.id))
        pm2.addExpression(makeVarExpr("e2-p", VAR_P.id))

        eng.removeVariable(VAR_P.id)
        expect(pm1.getExpression("e1-p")).toBeUndefined()
        expect(pm2.getExpression("e2-p")).toBeUndefined()
    })

    it("removeVariable triggers operator collapse", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // Build: (P ∧ Q)
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        // Remove P — leaves `and` with 1 child → collapse promotes Q to root
        eng.removeVariable(VAR_P.id)
        expect(pm.getExpression("op-and")).toBeUndefined()
        expect(pm.getRootExpression()?.id).toBe("e-q")
    })

    it("removeVariable deletes subtrees when a parent expression references the variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // Build: P → Q (root is implies with P at pos 0, Q at pos 1)
        pm.addExpression(makeOpExpr("op-impl", "implies"))
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-impl", position: 1 })
        )

        // Remove P — implies left with 1 child → collapse promotes Q to root
        // The implies operator itself is deleted
        eng.removeVariable(VAR_P.id)
        expect(pm.getExpression("op-impl")).toBeUndefined()
        expect(pm.getExpression("e-p")).toBeUndefined()
        // Q survives as root
        expect(pm.getRootExpression()?.id).toBe("e-q")
    })
})
```

**Step 2: Write tests for deleteExpressionsUsingVariable**

```typescript
describe("PremiseManager — deleteExpressionsUsingVariable", () => {
    it("returns empty result when variable has no expressions", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        const { result, changes } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(0)
        expect(changes).toEqual({})
    })

    it("deletes a single variable expression", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", VAR_P.id))
        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(1)
        expect(pm.getExpression("e-p")).toBeUndefined()
    })

    it("deletes multiple expressions referencing the same variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("e-p1", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-p2", VAR_P.id, { parentId: "op-and", position: 1 })
        )

        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        // Both P expressions removed, and operator collapsed (0 children)
        expect(result.length).toBeGreaterThanOrEqual(2)
        expect(pm.getExpressions()).toHaveLength(0)
    })

    it("handles already-removed expressions from subtree cascade", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // Build: not(P)
        pm.addExpression(makeOpExpr("op-not", "not"))
        pm.addExpression(makeVarExpr("e-p", VAR_P.id, { parentId: "op-not" }))
        // Removing P: e-p is deleted, op-not collapses (0 children → deleted)
        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(1)
        expect(pm.getExpressions()).toHaveLength(0)
    })
})
```

**Step 2: Run tests**

Run: `pnpm run test`
Expected: PASS

**Step 3: Commit**

```
Add tests for ArgumentEngine variable management and cascade deletion
```

---

### Task 8: Update CLI — hydration and variable commands

**Files:**

- Modify: `src/cli/engine.ts:59-61` (hydration)
- Modify: `src/cli/commands/variables.ts`

**Step 1: Update hydrateEngine**

In `src/cli/engine.ts`, replace the per-premise variable registration loop (lines 59-61):

```typescript
for (const variable of allVariables) {
    pm.addVariable({ ...variable, argumentVersion: version })
}
```

Move variable registration above the premise loop, calling `engine.addVariable()` once per variable:

```typescript
for (const variable of allVariables) {
    engine.addVariable({ ...variable, argumentVersion: version })
}
```

This goes between the engine creation (line 46) and the premise loop (line 48).

**Step 2: Update variable commands**

In `src/cli/commands/variables.ts`:

**`create` action:** Replace the manual variable array manipulation with engine-based approach. The command needs to hydrate the engine, add the variable, and persist:

```typescript
.action(async (symbol: string, opts: { id?: string }) => {
    await assertNotPublished(argumentId, version)
    const engine = await hydrateEngine(argumentId, version)
    const newId = opts.id ?? randomUUID()
    const variable = {
        id: newId,
        argumentId,
        argumentVersion: version,
        symbol,
    }
    engine.addVariable(variable)
    await persistEngine(engine)
    printLine(newId)
})
```

**`update` action:** Use `engine.updateVariable()`:

```typescript
.action(async (variableId: string, opts: { symbol?: string }) => {
    await assertNotPublished(argumentId, version)
    const engine = await hydrateEngine(argumentId, version)
    if (!engine.getVariables().some((v) => v.id === variableId)) {
        errorExit(`Variable "${variableId}" not found.`)
    }
    if (opts.symbol !== undefined) {
        engine.updateVariable(variableId, { symbol: opts.symbol })
    }
    await persistEngine(engine)
    printLine("success")
})
```

**`delete` action:** Use `engine.removeVariable()` (cascade handled automatically):

```typescript
.description("Remove a variable (cascade-deletes referencing expressions)")
.action(async (variableId: string) => {
    await assertNotPublished(argumentId, version)
    const engine = await hydrateEngine(argumentId, version)
    if (!engine.getVariables().some((v) => v.id === variableId)) {
        errorExit(`Variable "${variableId}" not found.`)
    }
    engine.removeVariable(variableId)
    await persistEngine(engine)
    printLine("success")
})
```

**`list` and `show` actions:** Use `engine.getVariables()`:

```typescript
// list
.action(async (opts: { json?: boolean }) => {
    const engine = await hydrateEngine(argumentId, version)
    const sorted = engine.getVariables()
    if (opts.json) {
        printJson(sorted)
    } else {
        for (const v of sorted) {
            printLine(`${v.id} | ${v.symbol}`)
        }
    }
})
```

**`list-unused`:** Use engine's `collectReferencedVariables()` and `getVariables()`:

```typescript
.action(async (opts: { json?: boolean }) => {
    const engine = await hydrateEngine(argumentId, version)
    const all = engine.getVariables()
    const referenced = engine.collectReferencedVariables()
    const referencedIds = new Set(referenced.variableIds)
    const unused = all.filter((v) => !referencedIds.has(v.id))
    if (opts.json) {
        printJson(unused)
    } else {
        for (const v of unused) {
            printLine(`${v.id} | ${v.symbol}`)
        }
    }
})
```

**`delete-unused`:** Same but call `engine.removeVariable()` for each:

```typescript
.action(async (opts: { confirm?: boolean; json?: boolean }) => {
    await assertNotPublished(argumentId, version)
    const engine = await hydrateEngine(argumentId, version)
    const all = engine.getVariables()
    const referenced = engine.collectReferencedVariables()
    const referencedIds = new Set(referenced.variableIds)
    const unused = all.filter((v) => !referencedIds.has(v.id))

    if (unused.length === 0) {
        if (opts.json) {
            printJson({ deleted: 0, deletedIds: [] })
        } else {
            printLine("0 variable(s) deleted")
        }
        return
    }

    if (!opts.confirm) {
        await requireConfirmation(
            `Delete ${unused.length} unused variable(s)?`
        )
    }

    for (const v of unused) {
        engine.removeVariable(v.id)
    }
    await persistEngine(engine)

    if (opts.json) {
        printJson({
            deleted: unused.length,
            deletedIds: unused.map((v) => v.id),
        })
    } else {
        printLine(`${unused.length} variable(s) deleted`)
    }
})
```

Add imports for `hydrateEngine` and `persistEngine`:

```typescript
import { hydrateEngine, persistEngine } from "../engine.js"
```

Remove imports no longer needed: `readVariables`, `writeVariables`, `listPremiseIds`, `readPremiseData`. Remove the `referencedVariableIds` helper function.

**Step 3: Update persistEngine**

In `src/cli/engine.ts`, line 124, update how variables are extracted since the engine now owns them:

```typescript
const variables = engine.getVariables()
```

(Instead of `engine.listPremises()[0]?.getVariables() ?? []`)

**Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS

**Step 5: Commit**

```
Update CLI to use ArgumentEngine variable management
```

---

### Task 9: Update documentation — CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Update class hierarchy**

Replace the class hierarchy section with:

```
ArgumentEngine
  ├─ VariableManager (shared, owned by engine)
  └─ PremiseManager (one per premise, receives shared VariableManager)
       └─ ExpressionManager (expression tree)
```

**Step 2: Update Architecture section**

Add `consts.ts` to the `src/lib/` tree:

```
consts.ts            # DEFAULT_CHECKSUM_CONFIG, createChecksumConfig
```

**Step 3: Update key design decisions**

Add a "Variable management" subsection explaining:

- Variables are argument-scoped, managed by `ArgumentEngine.addVariable/updateVariable/removeVariable`
- `VariableManager` owned by `ArgumentEngine`, shared by reference with all `PremiseManager` instances
- `removeVariable` cascades to `PremiseManager.deleteExpressionsUsingVariable()` in every premise
- `PremiseManager` no longer exposes `addVariable`/`removeVariable`

Update the checksum section to note `Set<string>` fields and exported `DEFAULT_CHECKSUM_CONFIG`.

**Step 4: Update Types section**

Update `TCoreChecksumConfig` to note `Set<string>` fields.

**Step 5: Commit**

```
Update CLAUDE.md for variable management uplift
```

---

### Task 10: Update documentation — README.md

**Files:**

- Modify: `README.md`

**Step 1: Update Variables concept section**

Change to describe variables as registered with `ArgumentEngine`:

> A **propositional variable** (e.g. `P`, `Q`, `Rain`) is a named atomic proposition. Variables are registered with `ArgumentEngine` via `addVariable()` and are shared across all premises in the argument. Each variable must have a unique `id` and a unique `symbol`.

**Step 2: Update usage examples**

Change `premise1.addVariable(varP)` etc. to `eng.addVariable(varP)` — called once, before creating premises.

**Step 3: Update API reference**

Move `addVariable`/`removeVariable` from PremiseManager section to ArgumentEngine section. Add `updateVariable`, `getVariables`. Document cascade deletion on `removeVariable`.

Add `deleteExpressionsUsingVariable` to PremiseManager section.

Remove `addVariable` and `removeVariable` from PremiseManager section.

Add `DEFAULT_CHECKSUM_CONFIG` and `createChecksumConfig` to Standalone Functions or a new Constants section.

**Step 4: Update CLI variables section**

Update the `delete` command description:

> `delete` cascade-deletes all expressions referencing the variable across all premises.

**Step 5: Commit**

```
Update README.md for variable management uplift
```

---

### Task 11: Update documentation — CLI_EXAMPLES.md

**Files:**

- Modify: `CLI_EXAMPLES.md`

**Step 1: Fix stale role commands**

Remove lines referencing `roles add-support` and `roles remove-support` (~lines 235-236, 246-248). Replace the roles section (section 6) with:

````markdown
## 6. Roles

Set the conclusion premise. Supporting premises are derived automatically — any inference premise (root is `implies` or `iff`) that isn't the conclusion is considered supporting.

```bash
proposit-core <argument-id> latest roles set-conclusion <premise3-id>
proposit-core <argument-id> latest roles show
proposit-core <argument-id> latest roles show --json
```
````

To undo:

```bash
proposit-core <argument-id> latest roles clear-conclusion
```

```

**Step 2: Update the complete script**

Remove `roles add-support` lines from the complete script (~lines 470-471). Only keep `roles set-conclusion`.

**Step 3: Commit**

```

Fix stale role commands and update CLI_EXAMPLES.md

```

---

### Task 12: Final verification

**Step 1: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, tests, build all pass)

**Step 2: Run lint fix if needed**

Run: `pnpm run prettify && pnpm eslint . --fix`

**Step 3: Final commit if lint fixes were needed**

```

Fix lint issues

```

```
