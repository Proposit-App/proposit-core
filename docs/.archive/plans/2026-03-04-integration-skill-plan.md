# Integration Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a self-contained, multi-file Claude Skill that ships with the `@polintpro/proposit-core` npm package, providing context-aware documentation for both developers working on the codebase and external consumers integrating the library.

**Architecture:** A `skills/proposit-core/` directory at repo root containing a `SKILL.md` routing file and five topic-specific docs in `docs/`. The SKILL.md acts as a router, directing Claude to load only the relevant doc(s) based on the task at hand. The `skills` directory is added to the package.json `files` array so it ships with npm.

**Tech Stack:** Markdown, Claude Skill YAML frontmatter

---

### Task 1: Create SKILL.md

**Files:**

- Create: `skills/proposit-core/SKILL.md`

**Step 1: Create the directory**

```bash
mkdir -p skills/proposit-core/docs
```

**Step 2: Write SKILL.md**

Write `skills/proposit-core/SKILL.md` with:

- YAML frontmatter:
    ```yaml
    ---
    name: proposit-core
    description: Use when working with the proposit-core library — building propositional logic arguments, managing premises/variables/expressions, evaluating with Kleene three-valued logic, or using the proposit-core CLI.
    ---
    ```
- `# proposit-core` heading with one-paragraph overview
- `## When to Use` bullet list of triggering conditions
- `## Key Patterns` quick reference of the most important conventions:
    - All mutating methods return `TCoreMutationResult<T>` — destructure `{ result, changes }`
    - Intent-based expression insertion: prefer `appendExpression`/`addExpressionRelative` over `addExpression`
    - Supporting premises derived from expression type (no explicit assignment)
    - Per-entity checksums are lazy (computed on read)
    - ESM with `.js` extensions on all relative imports
    - Typebox schemas with `Value.Parse()` for runtime validation
- `## Reference` routing table with one entry per doc:
    - **API Usage** — `docs/api-usage.md` — Creating arguments, managing premises/variables/expressions, evaluation, validity, diffing, relationship analysis.
    - **Architecture & Design** — `docs/architecture.md` — Class hierarchy, expression tree internals, midpoint positions, operator collapse, mutation changesets, checksums.
    - **Types & Schemas** — `docs/types-schemas.md` — All exported types: expression unions, evaluation, mutation, diff, relationship, checksum types.
    - **Testing** — `docs/testing.md` — Test file structure, describe block conventions, fixture patterns, adding new tests.
    - **CLI** — `docs/cli.md` — CLI routing, state storage layout, engine hydration, version resolution, command reference.

**Step 3: Commit**

```bash
git add skills/proposit-core/SKILL.md
git commit -m "Add proposit-core skill SKILL.md with routing table"
```

---

### Task 2: Create docs/api-usage.md

**Files:**

- Create: `skills/proposit-core/docs/api-usage.md`

**Step 1: Write docs/api-usage.md**

This is the largest doc. Include these sections with brief code examples for each:

**1. Creating an Argument**

```typescript
const engine = new ArgumentEngine({
    id: "arg-1",
    version: 0,
    title: "My Argument", // extra field, preserved via additionalProperties
    description: "Description", // extra field
})
```

Note: constructor accepts `Omit<TCoreArgument, "checksum">` plus any extra fields. Optional second parameter: `{ checksumConfig?: TCoreChecksumConfig }`.

**2. Variable Management**

- `engine.addVariable({ id, argumentId, argumentVersion, symbol })` — returns `TCoreMutationResult<TCorePropositionalVariable>`
- `engine.updateVariable(variableId, { symbol })` — rename
- `engine.removeVariable(variableId)` — cascades: removes all referencing expressions across all premises (with operator collapse), returns combined changeset
- `engine.getVariables()` — returns all argument-level variables with checksums
- Variables are argument-scoped, shared across all premises via a single `VariableManager`

**3. Premise CRUD**

- `engine.createPremise(extras?)` — returns `TCoreMutationResult<PremiseManager>`. First premise auto-assigned as conclusion.
- `engine.createPremiseWithId(id, extras?)` — same but with explicit ID
- `engine.removePremise(premiseId)` — returns removed premise data
- `engine.getPremise(premiseId)`, `engine.hasPremise(premiseId)`, `engine.listPremiseIds()`, `engine.listPremises()`
- `extras` is `Record<string, unknown>` — preserved via `additionalProperties` on the schema

**4. Expression Tree**

Three insertion APIs (prefer top two):

- `pm.appendExpression(parentId, expr)` — appends as last child, position auto-computed. Input: `TExpressionWithoutPosition`.
- `pm.addExpressionRelative(siblingId, "before" | "after", expr)` — inserts relative to sibling. Input: `TExpressionWithoutPosition`.
- `pm.addExpression(expr)` — low-level, explicit position required. Input: `TExpressionInput`.

Other mutations:

- `pm.insertExpression(expr, leftNodeId?, rightNodeId?)` — wraps existing nodes under a new operator
- `pm.updateExpression(id, { position?, variableId?, operator? })` — in-place update, restricted swaps (`and↔or`, `implies↔iff`)
- `pm.removeExpression(id, deleteSubtree)` — `true`: delete subtree + collapse. `false`: promote single child.

All return `TCoreMutationResult`.

**5. Roles**

- `engine.setConclusionPremise(premiseId)` — designate conclusion
- `engine.clearConclusionPremise()` — remove designation
- `engine.getConclusionPremise()` — returns PremiseManager or undefined
- `engine.listSupportingPremises()` — derived: all inference premises not the conclusion
- `engine.getRoleState()` — returns `TCoreArgumentRoleState`

**6. Evaluation**

- `pm.evaluate(assignment)` — evaluates one premise. Input: `TCoreExpressionAssignment`. Returns `TCorePremiseEvaluationResult`.
- `engine.evaluate(assignment, options?)` — evaluates full argument. Returns `TCoreArgumentEvaluationResult` with three-valued flags: `isAdmissibleAssignment`, `isCounterexample`, `preservesTruthUnderAssignment`.
- `engine.checkValidity(options?)` — enumerates all 2^n assignments. Returns `TCoreValidityCheckResult` with `isValid`, `counterexamples[]`.
- `engine.validateEvaluability()` — structural validation before evaluation. Returns `TCoreValidationResult`.

**7. Diffing**

```typescript
const diff = diffArguments(engineA, engineB, {
    compareArgument: defaultCompareArgument, // optional overrides
    compareVariable: defaultCompareVariable,
    comparePremise: defaultComparePremise,
    compareExpression: defaultCompareExpression,
})
```

Returns `TCoreArgumentDiff`. Standalone function, pluggable comparators.

**8. Relationship Analysis**

```typescript
const analysis = analyzePremiseRelationships(engine, focusedPremiseId)
const profile = buildPremiseProfile(premiseManager)
```

Both standalone functions. Analysis classifies each premise as supporting/contradicting/restricting/downstream/unrelated relative to focused premise.

**9. Formula Parsing**

```typescript
const ast = parseFormula("P → (Q ∧ R)")
```

Returns `FormulaAST`. Standalone function.

**10. Mutation Result Pattern**

```typescript
const { result: premise, changes } = engine.createPremise()
// changes.premises?.added — newly added premise
// changes.roles — new role state (if changed)
// changes.expressions?.removed — cascaded removals
```

Every mutating method returns `TCoreMutationResult<T>`. Changeset fields are optional — only present when that entity type was affected.

**11. Serialization**

- `pm.toData()` — returns `TCorePremise` snapshot
- `pm.toDisplayString()` — human-readable formula string
- `pm.isInference()` / `pm.isConstraint()` — premise type classification
- `engine.toData()` / `engine.exportState()` — full engine snapshot as `TCoreArgumentEngineData`
- `engine.getArgument()` — argument metadata with checksum

**Step 2: Commit**

```bash
git add skills/proposit-core/docs/api-usage.md
git commit -m "Add proposit-core skill API usage doc"
```

---

### Task 3: Create docs/architecture.md

**Files:**

- Create: `skills/proposit-core/docs/architecture.md`

**Step 1: Write docs/architecture.md**

Include these sections:

**1. Class Hierarchy**

```
ArgumentEngine
  ├─ VariableManager (shared, owned by engine)
  └─ PremiseManager (one per premise, receives shared VariableManager)
       └─ ExpressionManager (expression tree)
```

- `ArgumentEngine` owns a single `VariableManager`, passed by reference to every `PremiseManager`
- `ExpressionManager` and `VariableManager` are internal — not exported in public API
- File locations: `src/lib/core/ArgumentEngine.ts`, `PremiseManager.ts`, `ExpressionManager.ts`, `VariableManager.ts`

**2. Expression Tree Representation**

Three internal maps in `ExpressionManager`:

- `expressions: Map<string, TExpressionInput>` — main store (without checksums)
- `childExpressionIdsByParentId: Map<string | null, Set<string>>` — child lookup, `null` key = roots
- `childPositionsByParentId: Map<string | null, Set<number>>` — occupied positions per parent

Expressions are immutable value objects.

**3. Midpoint-Based Positions**

Constants from `src/lib/utils/position.ts`:

- `POSITION_MIN = 0`
- `POSITION_MAX = Number.MAX_SAFE_INTEGER`
- `POSITION_INITIAL = Math.floor(POSITION_MAX / 2)`
- `midpoint(a, b) = a + (b - a) / 2` (overflow-safe)

Table:
| Scenario | Position |
|---|---|
| First child (no siblings) | `POSITION_INITIAL` |
| Append (after last) | `midpoint(last.position, POSITION_MAX)` |
| Prepend (before first) | `midpoint(POSITION_MIN, first.position)` |
| Between siblings | `midpoint(left.position, right.position)` |

~52 bisections before floating-point precision loss.

**4. Root-Only Operators**

`implies` and `iff` must have `parentId: null`. Enforced in `addExpression` and `insertExpression`. Cannot be nested.

**5. Formula Nodes**

`formula` type is a transparent unary wrapper (like parentheses). Exactly one child. Same collapse rules as operators.

**6. Operator Collapse**

Triggered by `removeExpression`. `collapseIfNeeded(parentId)` runs after removal:

- **0 children** → delete operator/formula, recurse to grandparent
- **1 child** → delete operator/formula, promote child (inherits parentId + position). No recursion.
- **2+ children** → no action

**7. insertExpression Mutation Order**

`reparent(rightNodeId)` runs before `reparent(leftNodeId)`. Handles case where right node is a descendant of left node's subtree.

**8. Premise Types**

Derived dynamically, not stored:

- `isInference()` — root is `implies` or `iff`
- `isConstraint()` — anything else (variable, `not`, `and`, `or`, empty)

**9. Derived Supporting Premises**

Any inference premise that is not the conclusion is automatically supporting. No explicit management methods. `listSupportingPremises()` derives the list on each call.

**10. Auto-Conclusion**

When the first premise is added to an engine with no conclusion set, it is automatically designated as the conclusion. `setConclusionPremise()` overrides. Removing/clearing the conclusion re-enables auto-assignment.

**11. Mutation Changesets**

Internal `ChangeCollector` (not exported) accumulates changes. `toChangeset()` produces `TCoreRawChangeset` (without checksums). `attachChangesetChecksums()` converts to `TCoreChangeset` before returning.

**12. Checksum System**

- Per-entity checksums: lazy computation with dirty flags
- Configurable via `TCoreChecksumConfig` (which fields to hash per entity type)
- `DEFAULT_CHECKSUM_CONFIG` and `createChecksumConfig()` exported from `src/lib/consts.ts`
- Standalone utilities: `computeHash(input)` (FNV-1a 32-bit), `canonicalSerialize(obj, fields)`, `entityChecksum(entity, fields)` in `src/lib/core/checksum.ts`
- Getters attach checksums on read; input types lack checksums

**13. ESM Import Requirements**

All relative imports must end in `.js`. Directory imports must use explicit index path (e.g., `schemata/index.js` not `schemata/`). Critical because `src/lib/utils/` (directory) and `src/lib/utils.ts` (file) both compile to `dist/lib/`.

**Step 2: Commit**

```bash
git add skills/proposit-core/docs/architecture.md
git commit -m "Add proposit-core skill architecture doc"
```

---

### Task 4: Create docs/types-schemas.md

**Files:**

- Create: `skills/proposit-core/docs/types-schemas.md`

**Step 1: Write docs/types-schemas.md**

Include each type with its key fields (not full definitions — just the shape an agent needs to use the API). Source file references for deep dives.

**1. Expression Types** (`src/lib/schemata/propositional.ts`, `src/lib/core/ExpressionManager.ts`)

- `TCorePropositionalExpression<T>` — discriminated union on `type`:
    - `"variable"`: has `variableId`
    - `"operator"`: has `operator` (`"not" | "and" | "or" | "implies" | "iff"`)
    - `"formula"`: no extra fields (transparent wrapper)
- Common fields: `id`, `argumentId`, `argumentVersion`, `parentId` (null for root), `position`, `checksum`
- `TExpressionInput` — same but without `checksum`
- `TExpressionWithoutPosition` — without `checksum` and `position` (for `appendExpression`/`addExpressionRelative`)
- `TExpressionUpdate` — `{ position?, variableId?, operator? }` (for `updateExpression`)

**2. Variable Type** (`src/lib/schemata/propositional.ts`)

- `TCorePropositionalVariable`: `{ id, argumentId, argumentVersion, symbol, checksum }`
- `TVariableInput`: same without `checksum`

**3. Premise Type** (`src/lib/schemata/propositional.ts`)

- `TCorePremise`: `{ id, rootExpressionId?, variables: string[], expressions: TCorePropositionalExpression[], checksum }`
- Schema has `additionalProperties: true`

**4. Argument Types** (`src/lib/schemata/argument.ts`)

- `TCoreArgument`: `{ id, version, checksum }` — `additionalProperties: true`
- `TCoreArgumentRoleState`: `{ conclusionPremiseId? }`

**5. Logical Operators** (`src/lib/schemata/propositional.ts`)

- `TCoreLogicalOperatorType`: `"not" | "and" | "or" | "implies" | "iff"`
- `not` — unary
- `and`, `or` — variadic (2+ children)
- `implies`, `iff` — binary, root-only (`parentId` must be `null`)

**6. Evaluation Types** (`src/lib/types/evaluation.ts`)

- `TCoreTrivalentValue` — `boolean | null` (null = unknown)
- `TCoreVariableAssignment` — `Record<string, TCoreTrivalentValue>`
- `TCoreExpressionAssignment` — `{ variables: TCoreVariableAssignment, rejectedExpressionIds: string[] }`
- `TCorePremiseEvaluationResult` — per-premise: `premiseId`, `premiseType`, `rootValue?`, `expressionValues`, `variableValues`, `inferenceDiagnostic?`
- `TCoreArgumentEvaluationResult` — `ok`, `conclusion?`, `supportingPremises?`, `constraintPremises?`, `isAdmissibleAssignment?`, `isCounterexample?`, `preservesTruthUnderAssignment?`
- `TCoreValidityCheckResult` — `ok`, `isValid?`, `counterexamples?`, `truncated?`, `numAssignmentsChecked?`
- `TCoreValidationResult` — `{ ok, issues: TCoreValidationIssue[] }`
- `TCoreValidationCode` — machine-readable strings like `"ARGUMENT_NO_CONCLUSION"`, `"PREMISE_EMPTY"`, etc.
- `TCoreArgumentEngineData` — `{ argument, premises, roles }` for serialization

**7. Mutation Types** (`src/lib/types/mutation.ts`)

- `TCoreMutationResult<T>` — `{ result: T, changes: TCoreChangeset }`
- `TCoreChangeset` — `{ expressions?, variables?, premises?, roles?, argument? }` — each entity field is `TCoreEntityChanges<T>`
- `TCoreEntityChanges<T>` — `{ added: T[], modified: T[], removed: T[] }`
- `TCoreRawChangeset` — internal variant with input types (no checksums)

**8. Diff Types** (`src/lib/types/diff.ts`)

- `TCoreArgumentDiff` — `{ argument, variables, premises, roles }`
- `TCoreFieldChange` — `{ field, before, after }`
- `TCoreEntityFieldDiff<T>` — `{ before, after, changes: TCoreFieldChange[] }`
- `TCoreEntitySetDiff<T>` — `{ added, removed, modified: TCoreEntityFieldDiff<T>[] }`
- `TCorePremiseDiff` — extends `TCoreEntityFieldDiff<TCorePremise>` with `expressions: TCoreEntitySetDiff`
- `TCoreDiffOptions` — `{ compareArgument?, compareVariable?, comparePremise?, compareExpression? }`
- `TCoreFieldComparator<T>` — `(before: T, after: T) => TCoreFieldChange[]`

**9. Relationship Types** (`src/lib/types/relationships.ts`)

- `TCoreVariableAppearance` — `{ variableId, side: "antecedent"|"consequent", polarity: "positive"|"negative" }`
- `TCorePremiseProfile` — `{ premiseId, isInference, appearances }`
- `TCorePremiseRelationshipType` — `"supporting" | "contradicting" | "restricting" | "downstream" | "unrelated"`
- `TCorePremiseRelationResult` — `{ premiseId, relationship, variableDetails, transitive }`
- `TCorePremiseRelationshipAnalysis` — `{ focusedPremiseId, premises: TCorePremiseRelationResult[] }`

**10. Checksum Types** (`src/lib/types/checksum.ts`)

- `TCoreChecksumConfig` — `{ expressionFields?, variableFields?, premiseFields?, argumentFields?, roleFields? }` — each a `Set<string>`

**11. Schema System**

- Schemas are Typebox objects (`Type.Object(...)`, `Type.Union(...)`)
- Runtime validation: `Value.Parse(Schema, raw)` — throws on invalid data
- Type inference: `type T = Static<typeof Schema>`
- Many schemas use `additionalProperties: true` — extra fields survive round-trips

**Step 2: Commit**

```bash
git add skills/proposit-core/docs/types-schemas.md
git commit -m "Add proposit-core skill types and schemas doc"
```

---

### Task 5: Create docs/testing.md

**Files:**

- Create: `skills/proposit-core/docs/testing.md`

**Step 1: Write docs/testing.md**

**1. Test File**

Single file: `test/ExpressionManager.test.ts` (~6500 lines, Vitest). Run with `pnpm run test`.

**2. Structure**

Each `describe` block corresponds to a method or logical grouping. New features get a new `describe` at the bottom. Don't modify existing blocks unless fixing them.

**3. Fixture Convention**

No shared `beforeEach`. Every test builds fixtures inline using helpers defined at the top of the test file:

```typescript
const ARG: Omit<TCoreArgument, "checksum"> = { id: "arg-1", version: 1 }

function makeVar(id: string, symbol: string): TVariableInput {
    return { id, argumentId: ARG.id, argumentVersion: ARG.version, symbol }
}

function makeVarExpr(
    id: string,
    variableId: string,
    opts?: { parentId?: string | null; position?: number }
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId,
        parentId: opts?.parentId ?? null,
        position: opts?.position ?? POSITION_INITIAL,
    }
}

function makeOpExpr(
    id: string,
    operator: TCoreLogicalOperatorType,
    opts?: { parentId?: string | null; position?: number }
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "operator",
        operator,
        parentId: opts?.parentId ?? null,
        position: opts?.position ?? POSITION_INITIAL,
    }
}
```

Typical test setup: create an `ArgumentEngine` or `PremiseManager`, add variables, create premises, add expressions, then assert.

**4. Adding a New Test**

1. Add a new `describe` block at the bottom of the file
2. Build fixtures inline using the helpers above
3. Destructure mutation results: `const { result, changes } = ...`
4. Assert on both the return value and changeset side effects
5. Run `pnpm run test` to verify

**5. Existing Describe Blocks**

Full ordered list (40 blocks):

1. `addExpression`
2. `insertExpression`
3. `removeExpression`
4. `removeExpression — operator collapse`
5. `removeVariable`
6. `addExpression ordering`
7. `toArray behaviour (via toData().expressions)`
8. `stress test`
9. `formula`
10. `ArgumentEngine premise CRUD`
11. `ArgumentEngine — addVariable / removeVariable`
12. `PremiseManager — single-root enforcement`
13. `PremiseManager — addExpression / removeExpression / insertExpression`
14. `PremiseManager — toDisplayString`
15. `PremiseManager — toData`
16. `PremiseManager — validation and evaluation`
17. `ArgumentEngine — roles and evaluation`
18. `ArgumentEngine — complex argument scenarios across multiple evaluations`
19. `diffArguments`
20. `Kleene three-valued logic helpers`
21. `PremiseManager — three-valued evaluation`
22. `ArgumentEngine — three-valued evaluation`
23. `schema shapes with additionalProperties`
24. `field preservation — unknown fields survive round-trips`
25. `buildPremiseProfile`
26. `analyzePremiseRelationships — direct relationships`
27. `analyzePremiseRelationships — transitive relationships`
28. `analyzePremiseRelationships — precedence and edge cases`
29. `position utilities`
30. `PremiseManager — appendExpression and addExpressionRelative`
31. `ChangeCollector`
32. `PremiseManager — mutation changesets`
33. `ArgumentEngine — mutation changesets`
34. `checksum utilities`
35. `entity checksum fields`
36. `createChecksumConfig`
37. `ArgumentEngine — variable management`
38. `PremiseManager — deleteExpressionsUsingVariable`
39. `variable expressions cannot have children`
40. `ArgumentEngine — auto-conclusion on first premise`

**6. Key Testing Patterns**

- Always destructure mutation results and assert on both `result` and `changes`
- For operator collapse: assert parent/child state after removal (check `getExpression`, `getChildExpressions`)
- For cascade operations (e.g. `removeVariable`): check that all affected expressions are in `changes.expressions.removed`
- Use `pm.toData().expressions` to verify tree structure
- Use `pm.toDisplayString()` to verify rendered formula

**7. Commands**

- `pnpm run test` — run all tests (vitest run)
- `pnpm run check` — typecheck + lint + test + build (full CI)
- `pnpm run typecheck` — tsc --noEmit
- `pnpm run lint` — prettier --check + eslint

**Step 2: Commit**

```bash
git add skills/proposit-core/docs/testing.md
git commit -m "Add proposit-core skill testing doc"
```

---

### Task 6: Create docs/cli.md

**Files:**

- Create: `skills/proposit-core/docs/cli.md`

**Step 1: Write docs/cli.md**

**1. Running the CLI**

- Local dev: `pnpm cli -- --help` (runs from local build)
- Installed: `proposit-core --help`
- Build first: `pnpm run build`

**2. Routing** (`src/cli.ts`, `src/cli/router.ts`)

`argv[2]` is inspected:

- Named commands: `help`, `--help`, `-h`, `version`, `--version`, `-V`, `arguments`, `diff`
- Everything else: treated as `<argument_id>`, then `argv[3]` is the version selector

For version-scoped commands, after `resolveVersion()`, a sub-Commander program is built with versioned command groups.

**3. Version Selectors** (`src/cli/router.ts`)

- `"latest"` → max version number
- `"last-published"` → highest published version (exits 1 if none)
- Integer string → exact version (must exist)

**4. State Storage Layout** (`src/cli/config.ts`)

```
$PROPOSIT_HOME/   (default: ~/.proposit-core)
  arguments/
    <argument-id>/
      meta.json            # { id, title, description }
      <version>/           # 0, 1, 2, ...
        meta.json          # { version, createdAt, published, publishedAt? }
        variables.json     # TCorePropositionalVariable[]
        roles.json         # { conclusionPremiseId? }
        premises/
          <premise-id>/
            meta.json      # { id, title? }
            data.json      # { rootExpressionId?, variables: id[], expressions[] }
        <analysis>.json    # { argumentId, argumentVersion, assignments, rejectedExpressionIds }
```

Reserved filenames: `meta.json`, `variables.json`, `roles.json`. Analysis files default to `analysis.json`.

**5. Engine Hydration** (`src/cli/engine.ts`)

`hydrateEngine(argumentId, version)`:

1. Parallel read: argument meta, version meta, variables, roles, premise IDs
2. Construct `Omit<TCoreArgument, "checksum">` from merged meta
3. Create `ArgumentEngine`
4. Register all argument variables via `engine.addVariable()`
5. For each premise: read meta + data, `engine.createPremiseWithId(id, extras)`
6. Add expressions in BFS order (roots first, then children of added nodes)
7. Set conclusion role last via `engine.setConclusionPremise()`

`persistEngine(engine)` is the inverse — writes all state back to disk.

**6. Publish Semantics** (`src/cli/commands/arguments.ts`)

`arguments publish <id>`:

1. Marks current latest version `published: true, publishedAt: Date.now()`
2. Copies directory to `version + 1`
3. Writes fresh unpublished meta for new version

All mutating CLI commands call `assertNotPublished` and exit 1 if already published.

**7. Command Reference**

**Top-level commands:**
| Command | Subcommands |
|---|---|
| `version` | (prints version) |
| `arguments` | `create <title> <description>`, `import <yaml>`, `list [--json]`, `delete <id> [--confirm] [--all]`, `publish <id>` |
| `diff` | `<args...>` (version or cross-argument comparison, `--json`) |

**Version-scoped commands** (`proposit-core <id> <version> ...`):
| Command | Subcommands |
|---|---|
| `show` | `[--json]` |
| `render` | (renders argument) |
| `roles` | `show [--json]`, `set-conclusion <premise_id>`, `clear-conclusion` |
| `variables` | `create <symbol> [--id]`, `list [--json]`, `show <id> [--json]`, `update <id> [--symbol]`, `delete <id>`, `list-unused [--json]`, `delete-unused [--confirm] [--json]` |
| `premises` | `create [--title]`, `list [--json]`, `show <id> [--json]`, `update <id> [--title] [--clear-title]`, `delete <id> [--confirm]`, `render <id>` |
| `expressions` | `create <premise_id> [--type] [--id] [--parent-id] [--position] [--before] [--after] [--variable-id] [--operator]`, `insert <premise_id> [--type] [--id] [--parent-id] [--position] [--variable-id] [--operator] [--left-node-id] [--right-node-id]`, `delete <premise_id> <expr_id>`, `list <premise_id> [--json]`, `show <premise_id> <expr_id> [--json]` |
| `analysis` | `create [filename] [--default]`, `list [--json]`, `show [--file] [--json]`, `set <symbol> <value> [--file]`, `reset [--file] [--value]`, `reject <expr_id> [--file]`, `accept <expr_id> [--file]`, `validate-assignments [--file] [--json]`, `delete [--file] [--confirm]`, `evaluate [--file] [--json] [flags...]`, `check-validity [--mode] [--json] [flags...]`, `validate-argument [--json]`, `refs [--json]`, `export [--json]` |

**8. Storage Utilities** (`src/cli/storage/`)

| File           | Key Functions                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arguments.ts` | `readArgumentMeta`, `writeArgumentMeta`, `readVersionMeta`, `writeVersionMeta`, `listArgumentIds`, `listVersionNumbers`, `latestVersionNumber`, `deleteVersionDir`, `deleteArgumentDir`, `copyVersionDir` |
| `variables.ts` | `readVariables`, `writeVariables`                                                                                                                                                                         |
| `roles.ts`     | `readRoles`, `writeRoles`                                                                                                                                                                                 |
| `premises.ts`  | `readPremiseMeta`, `writePremiseMeta`, `readPremiseData`, `writePremiseData`, `listPremiseIds`, `deletePremiseDir`, `premiseExists`                                                                       |
| `analysis.ts`  | `readAnalysis`, `writeAnalysis`, `listAnalysisFiles`, `deleteAnalysisFile`, `analysisFileExists`, `resolveAnalysisFilename`                                                                               |

**9. Output Helpers** (`src/cli/output.ts`)

- `printJson(value)` — `JSON.stringify(value, null, 2)` to stdout
- `printLine(text)` — text + newline to stdout
- `errorExit(message, code=1)` — message to stderr, `process.exit(code)`
- `requireConfirmation(prompt)` — reads from `/dev/tty`, expects "confirm"

**Step 2: Commit**

```bash
git add skills/proposit-core/docs/cli.md
git commit -m "Add proposit-core skill CLI doc"
```

---

### Task 7: Update package.json

**Files:**

- Modify: `package.json`

**Step 1: Add skills to files array**

In `package.json`, change:

```json
"files": [
    "dist"
]
```

to:

```json
"files": [
    "dist",
    "skills"
]
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "Include skills directory in npm package"
```
