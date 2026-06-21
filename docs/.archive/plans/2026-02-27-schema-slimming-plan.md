# Schema Slimming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip metadata fields from core schemas so the library is minimal and extensible, with consumers (like the CLI) adding their own fields via `Type.Intersect`.

**Architecture:** Core schemas define only logic-essential fields (id, version, symbol, expressions, etc.). All metadata (title, description, createdAt, published) moves to CLI-level schemas. The engine preserves unknown fields through round-trips so consumer-added fields survive `toData()` calls.

**Tech Stack:** TypeScript, Typebox v1.1.0, Vitest

**Design doc:** `docs/plans/2026-02-27-schema-slimming-design.md`

---

### Task 1: Write failing tests for field preservation

New describe block at the bottom of `test/ExpressionManager.test.ts` that verifies the engine preserves unknown fields on arguments, premises, variables, and expressions through round-trips.

**Files:**

- Modify: `test/ExpressionManager.test.ts` (append new describe block)

**Step 1: Write the failing tests**

Add at the bottom of `test/ExpressionManager.test.ts`:

```typescript
describe("field preservation — unknown fields survive round-trips", () => {
    const ARG_WITH_EXTRAS = {
        id: "arg-1",
        version: 1,
        title: "My Argument",
        customField: 42,
    }

    it("preserves unknown fields on the argument through getArgument()", () => {
        const engine = new ArgumentEngine(ARG_WITH_EXTRAS as TCoreArgument)
        const result = engine.getArgument()
        expect((result as Record<string, unknown>).title).toBe("My Argument")
        expect((result as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves unknown fields on the argument through toData()", () => {
        const engine = new ArgumentEngine(ARG_WITH_EXTRAS as TCoreArgument)
        const data = engine.toData()
        expect((data.argument as Record<string, unknown>).title).toBe(
            "My Argument"
        )
        expect((data.argument as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves extras on premises through toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        const pm = engine.createPremise({
            title: "My Premise",
            priority: "high",
        })
        const data = pm.toData()
        expect((data as Record<string, unknown>).title).toBe("My Premise")
        expect((data as Record<string, unknown>).priority).toBe("high")
    })

    it("preserves extras on premises through engine.toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        engine.createPremise({ title: "Premise One" })
        const data = engine.toData()
        expect((data.premises[0] as Record<string, unknown>).title).toBe(
            "Premise One"
        )
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: FAIL — current schemas/engine don't support this shape.

**Step 3: Commit failing tests**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Add failing tests for unknown field preservation"
```

---

### Task 2: Slim the argument schema

Strip `CoreArgumentSchema` down to `{ id, version }`. Remove all intermediate argument schemas.

**Files:**

- Modify: `src/lib/schemata/argument.ts`

**Step 1: Rewrite argument.ts**

Replace the entire file with:

```typescript
import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreArgumentSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number(),
    },
    {
        additionalProperties: true,
        description: "Core argument identity: ID and version number.",
    }
)
export type TCoreArgument = Static<typeof CoreArgumentSchema>

export const CoreArgumentRoleStateSchema = Type.Object(
    {
        conclusionPremiseId: Type.Optional(UUID),
        supportingPremiseIds: Type.Array(UUID),
    },
    {
        description:
            "Tracks which premises serve as the conclusion and which are supporting.",
    }
)
export type TCoreArgumentRoleState = Static<typeof CoreArgumentRoleStateSchema>
```

This removes: `CoreArgumentMetadataSchema`, `TCoreArgumentMetadata`, `CoreArgumentMetaSchema`, `TCoreArgumentMeta`, `CoreArgumentVersionedSchema`, `TCoreArgumentVersioned`, `CoreArgumentMutableDataSchema`, `TCoreArgumentMutableData`, `CoreArgumentVersionMetaSchema`, `TCoreArgumentVersionMeta`.

**Step 2: Verify the file compiles**

Run: `pnpm tsc -p tsconfig.json --noEmit 2>&1 | head -40`
Expected: FAIL with many errors from files that import removed types. That's expected — we fix those in subsequent tasks.

---

### Task 3: Slim premise and variable schemas

Remove metadata from premises and variables. Flatten `CorePremiseSchema` into a single schema.

**Files:**

- Modify: `src/lib/schemata/propositional.ts`

**Step 1: Update propositional.ts**

Remove `CoreVariableMetadataSchema`, `TCoreVariableMetadata`, `CorePremiseMetadataSchema`, `TCoreVariableMetadata`, `CorePremiseMetaSchema`, `TCorePremiseMeta`, `CorePremiseDataSchema`, `TCorePremiseData`.

Replace `CorePropositionalVariableSchema` with:

```typescript
export const CorePropositionalVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String({
            description:
                'Human-readable symbol for this variable (e.g. "P", "Q").',
        }),
    },
    {
        additionalProperties: true,
        description:
            "A named propositional variable belonging to a specific argument version.",
    }
)
```

Replace `CorePremiseSchema` (remove `CorePremiseMetaSchema`, `CorePremiseDataSchema`, and their `Type.Intersect`) with a single flat schema:

```typescript
export const CorePremiseSchema = Type.Object(
    {
        id: UUID,
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
    },
    {
        additionalProperties: true,
        description:
            "A premise containing an expression tree and variable references.",
    }
)
export type TCorePremise = Static<typeof CorePremiseSchema>
```

---

### Task 4: Remove import schemas from core exports

**Files:**

- Modify: `src/lib/schemata/index.ts`
- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Remove import.ts re-export from schemata/index.ts**

In `src/lib/schemata/index.ts`, remove the line:

```typescript
export * from "./import.js"
```

**Step 2: Remove importArgumentFromYaml from lib/index.ts**

In `src/lib/index.ts`, remove:

```typescript
export { importArgumentFromYaml } from "./core/import.js"
```

**Step 3: Remove importArgumentFromYaml and YAML schemas from src/index.ts**

In `src/index.ts`, remove:

```typescript
export { importArgumentFromYaml } from "./lib/core/import.js"
```

**Step 4: Remove deleted schema types from src/index.ts**

The barrel re-exports `export * from "./lib/schemata/index.js"` will automatically stop exporting the removed types since they no longer exist in the schema files. No explicit change needed here beyond what was done in step 3.

---

### Task 5: Update PremiseManager

Replace the `metadata` field with an `extras` field for generic unknown-field preservation.

**Files:**

- Modify: `src/lib/core/PremiseManager.ts`

**Step 1: Update constructor and fields**

Replace:

```typescript
private metadata: Record<string, string>
```

with:

```typescript
private extras: Record<string, unknown>
```

Update constructor:

```typescript
constructor(
    id: string,
    argument: TCoreArgument,
    extras?: Record<string, unknown>
) {
    this.id = id
    this.argument = argument
    this.extras = extras ?? {}
    // ... rest unchanged
}
```

**Step 2: Replace getTitle/setTitle/getMetadata/setMetadata with getExtras/setExtras**

Remove `getTitle()`, `setTitle()`, `getMetadata()`, `setMetadata()`.

Add:

```typescript
public getExtras(): Record<string, unknown> {
    return { ...this.extras }
}

public setExtras(extras: Record<string, unknown>): void {
    this.extras = { ...extras }
}
```

**Step 3: Update toData()**

Change the return to spread extras at the root level:

```typescript
public toData(): TCorePremise {
    const expressions = this.getExpressions()

    const referencedVariableIds = new Set<string>()
    for (const expr of expressions) {
        if (expr.type === "variable") {
            referencedVariableIds.add(expr.variableId)
        }
    }
    const variables = Array.from(referencedVariableIds).sort()

    return {
        ...this.extras,
        id: this.id,
        rootExpressionId: this.rootExpressionId,
        variables,
        expressions,
    } as TCorePremise
}
```

The `as TCorePremise` cast is needed because TypeScript doesn't know about the extras at the type level, but they're included at runtime.

**Step 4: Update ArgumentEngine createPremise/createPremiseWithId**

In `src/lib/core/ArgumentEngine.ts`, update signatures:

```typescript
public createPremise(extras?: Record<string, unknown>): PremiseManager {
    const id = randomUUID()
    const pm = new PremiseManager(id, this.argument, extras)
    this.premises.set(id, pm)
    return pm
}

public createPremiseWithId(
    id: string,
    extras?: Record<string, unknown>
): PremiseManager {
    if (this.premises.has(id)) {
        throw new Error(`Premise "${id}" already exists.`)
    }
    const pm = new PremiseManager(id, this.argument, extras)
    this.premises.set(id, pm)
    return pm
}
```

---

### Task 6: Update diff comparators

The default comparators should only compare core structural fields now. Consumers wrap them to add their own field comparisons.

**Files:**

- Modify: `src/lib/core/diff.ts`

**Step 1: Update defaultCompareArgument**

Since core argument only has `id` and `version`, and those are identity/structural fields (not worth diffing as field changes), return an empty array:

```typescript
export function defaultCompareArgument(
    _before: TCoreArgument,
    _after: TCoreArgument
): TCoreFieldChange[] {
    return []
}
```

**Step 2: Update defaultCompareVariable**

Only compare `symbol` (the one meaningful core field beyond identity):

```typescript
export function defaultCompareVariable(
    before: TCorePropositionalVariable,
    after: TCorePropositionalVariable
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.symbol !== after.symbol) {
        changes.push({
            field: "symbol",
            before: before.symbol,
            after: after.symbol,
        })
    }
    return changes
}
```

**Step 3: Update defaultComparePremise**

Only compare `rootExpressionId`:

```typescript
export function defaultComparePremise(
    before: TCorePremise,
    after: TCorePremise
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.rootExpressionId !== after.rootExpressionId) {
        changes.push({
            field: "rootExpressionId",
            before: before.rootExpressionId,
            after: after.rootExpressionId,
        })
    }
    return changes
}
```

---

### Task 7: Update existing tests — fixtures and assertions

The bulk of the work: update all test fixtures to use the new minimal shapes and adjust assertions.

**Files:**

- Modify: `test/ExpressionManager.test.ts`

**Step 1: Update the global ARG fixture**

Change:

```typescript
const ARG: TCoreArgument = {
    id: "arg-1",
    version: 1,
    metadata: { title: "Test Argument" },
    createdAt: Date.now(),
    published: false,
}
```

to:

```typescript
const ARG: TCoreArgument = {
    id: "arg-1",
    version: 1,
}
```

**Step 2: Update the makeVar helper**

Remove `metadata: {}` from the variable object:

```typescript
function makeVar(...): TCorePropositionalVariable {
    return {
        id: variableId,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol,
    }
}
```

**Step 3: Update createPremise calls**

All calls like `eng.createPremise({ title: "test" })` should become either:

- `eng.createPremise({ title: "test" })` — still works because extras accept `Record<string, unknown>`. The title is preserved as an extra.
- `eng.createPremise()` — if the title was only there for readability and isn't asserted on.

Review each call:

- In `ArgumentEngine premise CRUD` tests: `createPremise({ title: "test" })` and assertions on `pm.toData().metadata.title` — change assertion to `(pm.toData() as any).title`.
- In stress tests: `createPremise({ title: \`premise-${p}\` })`— can keep as extras or simplify to`createPremise()`.

**Step 4: Update PremiseManager toData assertions**

In `PremiseManager — toData` tests:

- Remove assertions on `data.metadata.title`
- Add assertion that extras are preserved if relevant

**Step 5: Update diff test fixtures and assertions**

In diff-related tests:

- Change `metadata: { title: "Old" }` to extras at root level where needed for test setup
- Change assertions from `{ field: "metadata.title", ... }` to testing consumer-provided comparators, or remove metadata diff assertions since default comparators no longer check metadata
- `defaultCompareArgument` test: should return `[]` since core argument has no diffable fields beyond identity
- `defaultComparePremise` test: only asserts on `rootExpressionId` changes
- `defaultCompareVariable` test: only asserts on `symbol` changes

**Step 6: Update the "metadata record" describe block**

This block tests the Typebox schema shapes. It needs a complete rewrite since the metadata schemas no longer exist. Replace it with tests that verify:

- `CoreArgumentSchema` accepts `{ id: "x", version: 0 }` with additional properties
- `CorePropositionalVariableSchema` accepts `{ id, argumentId, argumentVersion, symbol }` with additional properties
- `CorePremiseSchema` accepts the minimal shape with additional properties

**Step 7: Remove import-related type imports**

Remove any imports of `TCoreArgumentMeta`, `TCoreArgumentVersionMeta`, `TCoreArgumentMetadata`, `TCorePremiseMeta`, `TCorePremiseMetadata`, `TCoreVariableMetadata`, `CoreArgumentMetadataSchema`, `CorePremiseMetadataSchema`, `CoreVariableMetadataSchema`, etc. from the test file.

**Step 8: Run tests**

Run: `pnpm vitest run test/ExpressionManager.test.ts`
Expected: All tests pass including the new field preservation tests from Task 1.

**Step 9: Commit**

```bash
git add src/lib/schemata/ src/lib/core/ src/lib/index.ts src/index.ts test/ExpressionManager.test.ts
git commit -m "Slim core schemas: remove metadata, preserve unknown fields"
```

---

### Task 8: Update import tests and examples tests

These tests reference `importArgumentFromYaml` which is being moved to the CLI. The import tests need to be restructured.

**Files:**

- Modify: `test/import.test.ts`
- Modify: `test/examples.test.ts`

**Step 1: Update import.test.ts imports**

Change imports from `../src/index` or `../src/lib/core/import` to `../src/cli/import` (after we move it in Task 10).

Since this task runs before the CLI move, we can temporarily import from the original location. OR we can do Task 10 first and then update tests.

**Recommended order:** Do Task 10 (move import to CLI) first, then update these tests.

**Step 2: Update assertions on argument fields**

All assertions like `expect(arg.metadata.title).toBe(...)` change to `expect((arg as any).title).toBe(...)` since the import function will now produce objects with flat CLI fields.

All assertions like `expect(arg.published).toBe(false)` stay the same if the CLI import still sets `published`.

**Step 3: Update examples.test.ts**

Same pattern: `engine.getArgument().metadata.title` becomes `(engine.getArgument() as any).title`.

**Step 4: Run tests**

Run: `pnpm vitest run test/import.test.ts test/examples.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add test/import.test.ts test/examples.test.ts
git commit -m "Update import and example tests for slimmed schemas"
```

---

### Task 9: Update diff renderer tests

**Files:**

- Modify: `test/diffRenderer.test.ts`

**Step 1: Update makeArg helper**

Change from:

```typescript
function makeArg(overrides) {
    return {
        id: "a",
        metadata: { title: "T", description: "D" },
        version: 0,
        createdAt: 0,
        published: false,
        ...overrides,
    }
}
```

to:

```typescript
function makeArg(overrides) {
    return {
        id: "a",
        version: 0,
        ...overrides,
    }
}
```

**Step 2: Update variable fixtures**

Remove `metadata: {}` from variable objects.

**Step 3: Update premise fixtures**

Change `metadata: { title: "X" }` to `title: "X"` (flat at root) in premise fixtures.

**Step 4: Update diff assertions**

- Remove assertions about `metadata.title` changes from default comparators (they no longer diff metadata)
- Update rendered output assertions that expect `metadata.title: "Old" → "New"` strings

**Step 5: Run tests**

Run: `pnpm vitest run test/diffRenderer.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add test/diffRenderer.test.ts
git commit -m "Update diff renderer tests for slimmed schemas"
```

---

### Task 10: Create CLI schemas and move import

Create CLI-level extended schemas and relocate `importArgumentFromYaml`.

**Files:**

- Create: `src/cli/schemata.ts`
- Move: `src/lib/core/import.ts` → `src/cli/import.ts` (or rewrite import path)
- Delete: `src/lib/schemata/import.ts`

**Step 1: Create src/cli/schemata.ts**

```typescript
import Type, { type Static } from "typebox"
import {
    CoreArgumentSchema,
    CoreArgumentRoleStateSchema,
} from "../lib/schemata/index.js"
import {
    CorePremiseSchema,
    CorePropositionalVariableSchema,
    UUID,
} from "../lib/schemata/index.js"

export const CliArgumentMetaSchema = Type.Intersect([
    Type.Object({ id: UUID }),
    Type.Object(
        {
            title: Type.String(),
            description: Type.Optional(Type.String()),
        },
        { additionalProperties: Type.String() }
    ),
])
export type TCliArgumentMeta = Static<typeof CliArgumentMetaSchema>

export const CliArgumentVersionMetaSchema = Type.Object({
    version: Type.Number(),
    createdAt: Type.Number(),
    published: Type.Boolean(),
    publishedAt: Type.Optional(Type.Number()),
})
export type TCliArgumentVersionMeta = Static<
    typeof CliArgumentVersionMetaSchema
>

export const CliArgumentSchema = Type.Intersect([
    CoreArgumentSchema,
    Type.Object({
        title: Type.String(),
        description: Type.Optional(Type.String()),
        createdAt: Type.Number(),
        published: Type.Boolean(),
        publishedAt: Type.Optional(Type.Number()),
    }),
])
export type TCliArgument = Static<typeof CliArgumentSchema>

export const CliPremiseMetaSchema = Type.Object(
    {
        id: UUID,
        title: Type.Optional(Type.String()),
    },
    { additionalProperties: Type.String() }
)
export type TCliPremiseMeta = Static<typeof CliPremiseMetaSchema>

export const CliVariableSchema = Type.Intersect([
    CorePropositionalVariableSchema,
    Type.Object({
        metadata: Type.Record(Type.String(), Type.String()),
    }),
])
export type TCliVariable = Static<typeof CliVariableSchema>
```

Exact shapes may need adjustment during implementation — the key principle is that CLI types are `Type.Intersect([CoreSchema, CliExtensions])` with flat fields.

**Step 2: Move importArgumentFromYaml to src/cli/import.ts**

Copy `src/lib/core/import.ts` to `src/cli/import.ts`. Update its imports to point to `../lib/core/parser/formula.js` and `../lib/core/ArgumentEngine.js`. Update it to produce objects matching CLI schemas (flat fields, no `metadata` nesting).

Move YAML schemas from `src/lib/schemata/import.ts` into the same file or into `src/cli/schemata.ts`.

**Step 3: Delete src/lib/schemata/import.ts**

**Step 4: Verify**

Run: `pnpm tsc -p tsconfig.json --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/schemata.ts src/cli/import.ts
git rm src/lib/schemata/import.ts
git commit -m "Create CLI schemas and move import to CLI layer"
```

---

### Task 11: Update CLI storage files

Update CLI storage to use CLI schemas instead of removed core schemas.

**Files:**

- Modify: `src/cli/storage/arguments.ts`
- Modify: `src/cli/storage/premises.ts`
- Modify: `src/cli/storage/variables.ts`

**Step 1: Update arguments.ts**

Replace imports of `CoreArgumentMetaSchema`, `CoreArgumentVersionMetaSchema`, `TCoreArgumentMeta`, `TCoreArgumentVersionMeta` with imports from `../schemata.js`:

```typescript
import {
    CliArgumentMetaSchema,
    CliArgumentVersionMetaSchema,
    type TCliArgumentMeta,
    type TCliArgumentVersionMeta,
} from "../schemata.js"
```

Update function signatures and `Value.Parse` calls to use CLI schemas.

**Step 2: Update premises.ts**

Replace `CorePremiseMetaSchema` usage with `CliPremiseMetaSchema`. Update `readPremiseMeta` and `writePremiseMeta` to use CLI types.

**Step 3: Update variables.ts**

If variable storage currently uses `CoreVariableMetadataSchema` or metadata in validation, update to use `CliVariableSchema` or remove metadata validation.

**Step 4: Verify**

Run: `pnpm tsc -p tsconfig.json --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/storage/
git commit -m "Update CLI storage to use CLI schemas"
```

---

### Task 12: Update CLI commands for flat fields

CLI commands that reference `metadata.title`, `metadata.description`, etc. change to flat root-level field access.

**Files:**

- Modify: `src/cli/commands/arguments.ts`
- Modify: `src/cli/commands/premises.ts`
- Modify: `src/cli/commands/variables.ts`
- Modify: `src/cli/commands/versionShow.ts`
- Modify: `src/cli/engine.ts`

**Step 1: Update arguments.ts**

- `writeArgumentMeta({ id, metadata: { title, description } })` → `writeArgumentMeta({ id, title, description })`
- `meta.metadata.title` → `meta.title`
- `meta.metadata.description` → `meta.description`

**Step 2: Update premises.ts**

- `meta.metadata.title` → `meta.title`
- `meta.metadata` → access flat fields
- `engine.createPremiseWithId(premiseId, meta.metadata)` → `engine.createPremiseWithId(premiseId, { title: meta.title })`

**Step 3: Update variables.ts**

- `metadata: {}` in variable creation → remove or adjust based on CLI schema

**Step 4: Update versionShow.ts**

- `argMeta.metadata.title` → `argMeta.title`
- `argMeta.metadata.description` → `argMeta.description`

**Step 5: Update engine.ts (hydrateEngine/persistEngine)**

Update `hydrateEngine`:

- `const argument: TCoreArgument = { ...argMeta, ...versionMeta }` — this still works since CLI meta objects have flat fields that spread together. The engine receives a flat object with `{ id, title, description, version, createdAt, published, ... }` and preserves all fields.
- `engine.createPremiseWithId(premiseId, meta.metadata)` → `engine.createPremiseWithId(premiseId, { title: meta.title })` (or spread all non-core fields from meta)

Update `persistEngine`:

- `const { id, metadata } = arg` → `const { id, version, ...extras } = arg`
- `await writeArgumentMeta({ id, metadata })` → `await writeArgumentMeta({ id, title: extras.title, description: extras.description } as TCliArgumentMeta)` (or cast appropriately)

**Step 6: Verify**

Run: `pnpm tsc -p tsconfig.json --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add src/cli/
git commit -m "Update CLI commands for flat metadata fields"
```

---

### Task 13: Final verification

**Step 1: Run full check**

Run: `pnpm run check`
Expected: typecheck, lint, all tests, and build all pass.

**Step 2: Fix any remaining issues**

Address any lint errors or type issues that surface.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "Fix lint and type issues from schema slimming"
```
