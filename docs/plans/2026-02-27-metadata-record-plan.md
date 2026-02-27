# Metadata Record Restructuring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move descriptive fields (`title`, `description`) into a unified `metadata: Record<string, string>` field on arguments, premises, and variables.

**Architecture:** Each object type gets a per-type metadata schema with known base keys + `additionalProperties: Type.String()` for open extension. Variable `symbol` stays top-level. This is a breaking disk-format change with no migration.

**Tech Stack:** Typebox schemas, Vitest tests, Commander CLI

---

### Task 1: Update Argument Schema

**Files:**

- Modify: `src/lib/schemata/argument.ts:4-15`

**Step 1: Write the failing test**

Add to `test/ExpressionManager.test.ts` at the bottom:

```typescript
describe("metadata record — argument schema", () => {
    it("argument metadata has title and description under metadata field", () => {
        const arg: TCoreArgument = {
            id: "arg-1",
            version: 1,
            metadata: { title: "Test" },
            createdAt: Date.now(),
            published: false,
        }
        expect(arg.metadata.title).toBe("Test")
        expect(arg.metadata.description).toBeUndefined()
    })

    it("argument metadata accepts additional string keys", () => {
        const arg: TCoreArgument = {
            id: "arg-1",
            version: 1,
            metadata: { title: "Test", custom: "value" },
            createdAt: Date.now(),
            published: false,
        }
        expect(arg.metadata.custom).toBe("value")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run test/ExpressionManager.test.ts -t "metadata record"`
Expected: FAIL — `metadata` property does not exist on `TCoreArgument`

**Step 3: Update the schema**

In `src/lib/schemata/argument.ts`, replace `CoreArgumentMetaSchema`:

```typescript
export const CoreArgumentMetadataSchema = Type.Object(
    {
        title: Type.String(),
        description: Type.Optional(Type.String()),
    },
    {
        additionalProperties: Type.String(),
        description: "User-facing descriptive metadata for an argument.",
    }
)
export type TCoreArgumentMetadata = Static<typeof CoreArgumentMetadataSchema>

export const CoreArgumentMetaSchema = Type.Object(
    {
        id: UUID,
        metadata: CoreArgumentMetadataSchema,
    },
    {
        description:
            "Metadata for an argument that does not change for different versions of the same argument.",
    }
)
export type TCoreArgumentMeta = Static<typeof CoreArgumentMetaSchema>
```

**Step 4: Fix the test helper `ARG` in `test/ExpressionManager.test.ts`**

Change lines 28-35 from:

```typescript
const ARG: TCoreArgument = {
    id: "arg-1",
    version: 1,
    title: "Test Argument",
    description: "",
    createdAt: Date.now(),
    published: false,
}
```

to:

```typescript
const ARG: TCoreArgument = {
    id: "arg-1",
    version: 1,
    metadata: { title: "Test Argument" },
    createdAt: Date.now(),
    published: false,
}
```

**Step 5: Run the new test to verify it passes**

Run: `pnpm run test -- --run test/ExpressionManager.test.ts -t "metadata record"`
Expected: PASS

**Step 6: Run typecheck to see remaining type errors**

Run: `pnpm run typecheck`
Expected: FAIL — many files still reference `arg.title` and `arg.description` directly. This is expected; we'll fix them in subsequent tasks.

**Step 7: Commit**

```bash
git add src/lib/schemata/argument.ts test/ExpressionManager.test.ts
git commit -m "Add metadata record to argument schema"
```

---

### Task 2: Update Premise and Variable Schemas

**Files:**

- Modify: `src/lib/schemata/propositional.ts:91-109,111-125`

**Step 1: Write the failing test**

Add to the `metadata record` describe block in `test/ExpressionManager.test.ts`:

```typescript
it("premise metadata has optional title under metadata field", () => {
    const data: TCorePremiseMeta = {
        id: "p-1",
        metadata: { title: "My Premise" },
    }
    expect(data.metadata.title).toBe("My Premise")
})

it("premise metadata accepts additional string keys", () => {
    const data: TCorePremiseMeta = {
        id: "p-1",
        metadata: { custom: "val" },
    }
    expect(data.metadata.custom).toBe("val")
})

it("variable has metadata record with arbitrary keys", () => {
    const v: TCorePropositionalVariable = {
        id: "v-1",
        argumentId: "a-1",
        argumentVersion: 0,
        symbol: "P",
        metadata: {},
    }
    expect(v.metadata).toEqual({})
})

it("variable metadata accepts arbitrary string keys", () => {
    const v: TCorePropositionalVariable = {
        id: "v-1",
        argumentId: "a-1",
        argumentVersion: 0,
        symbol: "P",
        metadata: { label: "Proposition P" },
    }
    expect(v.metadata.label).toBe("Proposition P")
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run test/ExpressionManager.test.ts -t "premise metadata has optional title"`
Expected: FAIL — `metadata` property does not exist

**Step 3: Update the schemas**

In `src/lib/schemata/propositional.ts`, add premise metadata schema and update `CorePremiseMetaSchema`:

```typescript
export const CorePremiseMetadataSchema = Type.Object(
    {
        title: Type.Optional(
            Type.String({
                description:
                    "An optional title for this premise, for display purposes.",
            })
        ),
    },
    {
        additionalProperties: Type.String(),
        description: "User-facing descriptive metadata for a premise.",
    }
)
export type TCorePremiseMetadata = Static<typeof CorePremiseMetadataSchema>

export const CorePremiseMetaSchema = Type.Object(
    {
        id: UUID,
        metadata: CorePremiseMetadataSchema,
    },
    {
        description: "Identity and display metadata for a premise.",
    }
)
export type TCorePremiseMeta = Static<typeof CorePremiseMetaSchema>
```

Add variable metadata schema and update `CorePropositionalVariableSchema`:

```typescript
export const CoreVariableMetadataSchema = Type.Record(
    Type.String(),
    Type.String(),
    {
        description: "User-facing descriptive metadata for a variable.",
    }
)
export type TCoreVariableMetadata = Static<typeof CoreVariableMetadataSchema>

export const CorePropositionalVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String({
            description:
                'Human-readable symbol for this variable (e.g. "P", "Q").',
        }),
        metadata: CoreVariableMetadataSchema,
    },
    {
        description:
            "A named propositional variable belonging to a specific argument version.",
    }
)
```

**Step 4: Run the new tests to verify they pass**

Run: `pnpm run test -- --run test/ExpressionManager.test.ts -t "metadata record"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/schemata/propositional.ts test/ExpressionManager.test.ts
git commit -m "Add metadata record to premise and variable schemas"
```

---

### Task 3: Update YAML Import Schema

**Files:**

- Modify: `src/lib/schemata/import.ts`

**Step 1: Update the schema**

Replace the content of `src/lib/schemata/import.ts`:

```typescript
import Type, { type Static } from "typebox"

export const CoreYamlPremiseMetadataSchema = Type.Object(
    {
        title: Type.Optional(Type.String()),
    },
    { additionalProperties: Type.String() }
)
export type TCoreYamlPremiseMetadata = Static<
    typeof CoreYamlPremiseMetadataSchema
>

export const CoreYamlPremiseSchema = Type.Object({
    metadata: Type.Optional(CoreYamlPremiseMetadataSchema),
    role: Type.Optional(
        Type.Union([Type.Literal("conclusion"), Type.Literal("supporting")])
    ),
    formula: Type.String(),
})

export type TCoreYamlPremise = Static<typeof CoreYamlPremiseSchema>

export const CoreYamlArgumentMetadataSchema = Type.Object(
    {
        title: Type.String(),
        description: Type.Optional(Type.String({ default: "" })),
    },
    { additionalProperties: Type.String() }
)
export type TCoreYamlArgumentMetadata = Static<
    typeof CoreYamlArgumentMetadataSchema
>

export const CoreYamlArgumentSchema = Type.Object({
    metadata: CoreYamlArgumentMetadataSchema,
    premises: Type.Array(CoreYamlPremiseSchema, { minItems: 1 }),
})

export type TCoreYamlArgument = Static<typeof CoreYamlArgumentSchema>
```

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: FAIL — `import.ts` references `input.title` etc. We'll fix that in Task 5.

**Step 3: Commit**

```bash
git add src/lib/schemata/import.ts
git commit -m "Add metadata record to YAML import schema"
```

---

### Task 4: Update PremiseManager and ArgumentEngine

**Files:**

- Modify: `src/lib/core/PremiseManager.ts:33,40,43,229-235,657-659`
- Modify: `src/lib/core/ArgumentEngine.ts:58,60,71,75`

**Step 1: Update PremiseManager**

Change the `title` property and constructor to use `metadata`:

```typescript
// Line 33: Replace
private title: string | undefined
// With
private metadata: Record<string, string>

// Line 40: Replace constructor signature
constructor(id: string, argument: TCoreArgument, title?: string)
// With
constructor(id: string, argument: TCoreArgument, metadata?: Record<string, string>)

// Line 43: Replace
this.title = title
// With
this.metadata = metadata ?? {}
```

Replace the `getTitle`/`setTitle` methods (lines 229-235):

```typescript
public getTitle(): string | undefined {
    return this.metadata.title
}

public setTitle(title: string | undefined): void {
    if (title === undefined) {
        delete this.metadata.title
    } else {
        this.metadata.title = title
    }
}

public getMetadata(): Record<string, string> {
    return { ...this.metadata }
}

public setMetadata(metadata: Record<string, string>): void {
    this.metadata = { ...metadata }
}
```

Update `toData()` (line 657-659) — replace `title: this.title` with `metadata: { ...this.metadata }`:

```typescript
return {
    id: this.id,
    metadata: { ...this.metadata },
    rootExpressionId: this.rootExpressionId,
    variables,
    expressions,
}
```

**Step 2: Update ArgumentEngine**

Change `createPremise` and `createPremiseWithId` to accept `metadata` instead of `title`:

```typescript
// Line 58
public createPremise(metadata?: Record<string, string>): PremiseManager {
    const id = randomUUID()
    const pm = new PremiseManager(id, this.argument, metadata)
    this.premises.set(id, pm)
    return pm
}

// Line 71
public createPremiseWithId(id: string, metadata?: Record<string, string>): PremiseManager {
    if (this.premises.has(id)) {
        throw new Error(`Premise "${id}" already exists.`)
    }
    const pm = new PremiseManager(id, this.argument, metadata)
    this.premises.set(id, pm)
    return pm
}
```

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: Still errors in CLI layer and tests referencing old field names. Core library should be mostly clean.

**Step 4: Commit**

```bash
git add src/lib/core/PremiseManager.ts src/lib/core/ArgumentEngine.ts
git commit -m "Update PremiseManager and ArgumentEngine to use metadata record"
```

---

### Task 5: Update Import Function and Diff Comparators

**Files:**

- Modify: `src/lib/core/import.ts:22-27,206-212,234-238,260`
- Modify: `src/lib/core/diff.ts:20-41,59-80`

**Step 1: Update import.ts**

In `validateRootOnly` (line 22), change `premiseTitle: string | undefined` references to use `premise.metadata?.title`:

```typescript
function validateRootOnly(
    ast: FormulaAST,
    isRoot: boolean,
    premiseIndex: number,
    premiseTitle: string | undefined
): void {
```

This function signature stays the same, but callers must pass `premise.metadata?.title`.

In the main function (lines 206-212), update label construction:

```typescript
const label = premise.metadata?.title
    ? `premise "${premise.metadata.title}" (index ${i})`
    : `premise at index ${i}`
```

Update argument construction (lines 234-238):

```typescript
const argument = {
    id: argumentId,
    version: 0,
    metadata: {
        title: input.metadata.title,
        ...(input.metadata.description !== undefined
            ? { description: input.metadata.description }
            : {}),
    },
    createdAt: Date.now(),
    published: false,
}
```

Update premise creation (line 260):

```typescript
const pm = engine.createPremise(
    premiseDef.metadata ? { ...premiseDef.metadata } : undefined
)
```

Update `validateRootOnly` call (line 212):

```typescript
validateRootOnly(ast, true, i, premise.metadata?.title)
```

**Step 2: Update diff.ts comparators**

Replace `defaultCompareArgument` (lines 20-41):

```typescript
export function defaultCompareArgument(
    before: TCoreArgument,
    after: TCoreArgument
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.metadata.title !== after.metadata.title) {
        changes.push({
            field: "metadata.title",
            before: before.metadata.title,
            after: after.metadata.title,
        })
    }
    if (before.metadata.description !== after.metadata.description) {
        changes.push({
            field: "metadata.description",
            before: before.metadata.description,
            after: after.metadata.description,
        })
    }
    return changes
}
```

Replace `defaultComparePremise` (lines 59-80):

```typescript
export function defaultComparePremise(
    before: TCorePremise,
    after: TCorePremise
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.metadata.title !== after.metadata.title) {
        changes.push({
            field: "metadata.title",
            before: before.metadata.title,
            after: after.metadata.title,
        })
    }
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

**Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: Remaining errors in CLI layer and tests only.

**Step 4: Commit**

```bash
git add src/lib/core/import.ts src/lib/core/diff.ts
git commit -m "Update import function and diff comparators for metadata record"
```

---

### Task 6: Update CLI Engine and Storage

**Files:**

- Modify: `src/cli/engine.ts:53,107,109,124-127`
- Modify: `src/cli/commands/arguments.ts:33-39,95-98,107`
- Modify: `src/cli/commands/premises.ts:63-66,91,206-210,265`
- Modify: `src/cli/commands/versionShow.ts:24-26`

**Step 1: Update engine.ts**

`hydrateEngine` line 53 — pass metadata instead of title:

```typescript
const pm = engine.createPremiseWithId(premiseId, meta.metadata)
```

`persistEngine` lines 107-109 — write metadata field:

```typescript
const arg = engine.getArgument()
const { id, metadata } = arg
await writeArgumentMeta({ id, metadata })
```

Lines 124-127 — write premise metadata:

```typescript
await writePremiseMeta(id, arg.version, {
    id: data.id,
    metadata: data.metadata,
})
```

**Step 2: Update commands/arguments.ts**

Line 39 — create command writes metadata:

```typescript
await writeArgumentMeta({ id, metadata: { title, description } })
```

Lines 95-98 — list JSON output:

```typescript
id: meta.id,
title: meta.metadata.title,
description: meta.metadata.description,
```

Line 107 — list text output:

```typescript
;`${meta.id} | ${meta.metadata.title} (created ${new Date(vMeta.createdAt).toLocaleString()})`
```

**Step 3: Update commands/premises.ts**

Lines 63-66 — create command:

```typescript
await writePremiseMeta(argumentId, version, {
    id,
    metadata: opts.title ? { title: opts.title } : {},
})
```

Line 91 — hydrate PremiseManager:

```typescript
const pm = new PremiseManager(pid, argument, meta.metadata)
```

Lines 206-210 — update command:

```typescript
if (opts.clearTitle) {
    delete meta.metadata.title
} else if (opts.title !== undefined) {
    meta.metadata.title = opts.title
}
```

Line 243 — show text output:

```typescript
printLine(`title:        ${meta.metadata.title ?? "(untitled)"}`)
```

Line 265 — render command:

```typescript
const pm = new PremiseManager(premiseId, argument, meta.metadata)
```

**Step 4: Update commands/versionShow.ts**

Lines 24-26:

```typescript
printLine(`title:       ${argMeta.metadata.title}`)
printLine(`description: ${argMeta.metadata.description ?? ""}`)
```

**Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS for src/. Test files will still have errors.

**Step 6: Commit**

```bash
git add src/cli/engine.ts src/cli/commands/arguments.ts src/cli/commands/premises.ts src/cli/commands/versionShow.ts
git commit -m "Update CLI layer for metadata record"
```

---

### Task 7: Update Variable Construction in Import

**Files:**

- Modify: `src/lib/core/import.ts:248-254`

**Step 1: Add metadata field to variable construction**

Lines 248-254 — add `metadata: {}`:

```typescript
const variable: TCorePropositionalVariable = {
    id: randomUUID(),
    argumentId,
    argumentVersion: 0,
    symbol: name,
    metadata: {},
}
```

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: src/ should be clean. Test errors remain.

**Step 3: Commit**

```bash
git add src/lib/core/import.ts
git commit -m "Add metadata field to variable construction in import"
```

---

### Task 8: Update Example YAML Files

**Files:**

- Modify: `examples/arguments/monopoly-regulation.yaml`
- Modify: `examples/arguments/education-reform.yaml`
- Modify: `examples/arguments/exam-performance.yaml`
- Modify: `examples/arguments/free-speech-misinformation.yaml`

**Step 1: Update all YAML files to use `metadata` wrapper**

Each file follows the same pattern. Example for `monopoly-regulation.yaml`:

```yaml
metadata:
    title: "The Case for Monopoly Regulation"
    description: >
        When a firm achieves market dominance in the absence of competition,
        consumers are harmed through unfair pricing and reduced choice.
        This harm justifies regulatory intervention.
premises:
    - metadata:
          title: "The firm has market dominance"
      formula: "MarketDominance"
    - metadata:
          title: "There is no meaningful competition"
      formula: "¬Competition"
    - metadata:
          title: "Market dominance without competition causes consumer harm"
      formula: "MarketDominance ∧ ¬Competition → ConsumerHarm"
    - metadata:
          title: "Consumer harm justifies regulatory intervention"
      formula: "ConsumerHarm → RegulatoryIntervention"
    - metadata:
          title: "Market dominance without competition justifies regulation"
      role: "conclusion"
      formula: "MarketDominance ∧ ¬Competition → RegulatoryIntervention"
```

Apply the same pattern to all 4 files: wrap top-level `title`/`description` under `metadata:`, and wrap each premise's `title` under `metadata:`.

**Step 2: Commit**

```bash
git add examples/arguments/
git commit -m "Update YAML examples to use metadata record structure"
```

---

### Task 9: Update All Tests

**Files:**

- Modify: `test/ExpressionManager.test.ts` — ARG helper (done in Task 1), lines 1257-1261, 1494-1497, 2391, 2552, 2576, and all `new PremiseManager(...)` calls with title arg
- Modify: `test/import.test.ts` — all YAML strings and assertions referencing `.title`/`.description`
- Modify: `test/examples.test.ts` — assertions referencing `.title`/`.description`/`.getTitle()`
- Modify: `test/diffRenderer.test.ts` — `makeArg()` helper and all premise/argument fixture data

**Step 1: Update test/ExpressionManager.test.ts**

The `ARG` helper was already updated in Task 1. Now fix remaining references:

Line 1257: `eng.createPremise("test")` → `eng.createPremise({ title: "test" })`

Line 1261: `expect(pm.toData().title).toBe("test")` → `expect(pm.toData().metadata.title).toBe("test")`

Line 1494: `new PremiseManager("my-id", ARG, "My Premise")` → `new PremiseManager("my-id", ARG, { title: "My Premise" })`

Line 1497: `expect(data.title).toBe("My Premise")` → `expect(data.metadata.title).toBe("My Premise")`

Lines 2391, 2552, 2576: `setTitle("Updated title")` → stays as `setTitle(...)` (method signature unchanged)

Search for all `makePremise()` or `new PremiseManager(` calls that pass a title string and update them.

**Step 2: Update test/import.test.ts**

All inline YAML strings: wrap `title`/`description` under `metadata:`. Update assertions:

```typescript
// Before
expect(arg.title).toBe("Simple Argument")
expect(arg.description).toBe("A basic test")
// After
expect(arg.metadata.title).toBe("Simple Argument")
expect(arg.metadata.description).toBe("A basic test")
```

For `defaults description` test:

```typescript
// Before
expect(engine.getArgument().description).toBe("")
// After
expect(engine.getArgument().metadata.description).toBe("")
```

`getTitle()` calls remain unchanged since the method still exists.

**Step 3: Update test/examples.test.ts**

```typescript
// Before
expect(arg.title).toBe("The Case for Monopoly Regulation")
expect(arg.description).toContain("market dominance")
// After
expect(arg.metadata.title).toBe("The Case for Monopoly Regulation")
expect(arg.metadata.description).toContain("market dominance")
```

Same pattern for all other `.title` references in this file.

**Step 4: Update test/diffRenderer.test.ts**

Update `makeArg()` helper:

```typescript
function makeArg(
    overrides: Partial<{
        id: string
        metadata: Record<string, string>
        version: number
        createdAt: number
        published: boolean
    }> = {}
) {
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

Update all test fixtures that reference premise `title` at top level — move them under `metadata`:

```typescript
// Before
{ id: "p2", title: "New Premise", variables: [], expressions: [] }
// After
{ id: "p2", metadata: { title: "New Premise" }, variables: [], expressions: [] }
```

Update field change assertions from `"title"` to `"metadata.title"`:

```typescript
// Before
changes: [{ field: "title", before: "Old Title", after: "New Title" }]
// After
changes: [{ field: "metadata.title", before: "Old Title", after: "New Title" }]
```

**Step 5: Run all tests**

Run: `pnpm run test`
Expected: PASS (all tests)

**Step 6: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add test/
git commit -m "Update all tests for metadata record structure"
```

---

### Task 10: Final Verification

**Step 1: Run full check suite**

Run: `pnpm run check`
Expected: PASS (typecheck + lint + tests + build)

**Step 2: Fix any lint issues**

Run: `pnpm eslint . --fix && pnpm run prettify`

**Step 3: Run check again**

Run: `pnpm run check`
Expected: PASS

**Step 4: Commit if any formatting changes**

```bash
git add -A
git commit -m "Fix lint and formatting"
```
