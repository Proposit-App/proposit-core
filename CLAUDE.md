# proposit-core — Claude Code Guide

## Generic instructions

- Git commit messages should not include any co-authoring content

## Commands

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # prettier --check + eslint
pnpm run prettify    # prettier --write (auto-fix formatting)
pnpm run test        # vitest run
pnpm run build       # tsc -p tsconfig.build.json → dist/
pnpm run check       # all of the above in sequence
pnpm cli -- --help   # run the local proposit-core CLI from the local build
bash scripts/smoke-test.sh  # CLI smoke test (requires build first)
```

Run `pnpm eslint . --fix` to auto-fix lint errors before checking manually.

## Architecture

```
src/
  index.ts              # Public library entry point — re-exports ArgumentEngine, PremiseEngine, and all schemata
  cli.ts                # CLI entry point — routes to named commands or version-scoped subcommands
  lib/
    index.ts            # Re-exports core classes and evaluation types
    utils.ts            # DefaultMap utility (with optional LRU limit)
    consts.ts            # DEFAULT_CHECKSUM_CONFIG, createChecksumConfig
    utils/
      collections.ts    # getOrCreate, sortedCopyById, sortedUnique
      position.ts       # POSITION_MIN, POSITION_MAX, POSITION_INITIAL, DEFAULT_POSITION_CONFIG, TCorePositionConfig, midpoint
    schemata/
      index.ts          # Re-exports all schemata
      argument.ts       # TArgument, TArgumentMeta, TArgumentVersionMeta, TCoreArgumentRoleState schemas + types
      analysis.ts       # TAnalysisFile schema + type
      propositional.ts  # TPropositionalVariable, TPropositionalExpression (variable/operator/formula),
                        #   TPremise, TLogicalOperatorType
      shared.ts         # UUID, Nullable helpers, TOptionalChecksum
    types/
      evaluation.ts     # All evaluation types: TTrivalentValue, TVariableAssignment,
                        #   TExpressionAssignment, TArgumentEvaluationResult, TValidityCheckResult, etc.
      diff.ts           # Diff types: TCoreArgumentDiff, TCoreFieldChange, TCoreEntitySetDiff, TCoreDiffOptions, etc.
      mutation.ts       # TCoreEntityChanges, TCoreChangeset, TCoreMutationResult (all generic with defaults)
      checksum.ts       # TCoreChecksumConfig
      relationships.ts  # Relationship types: TCorePremiseRelationshipAnalysis, TCorePremiseProfile,
                        #   TCoreVariableAppearance, TCorePremiseRelationResult, etc.
    core/
      ArgumentEngine.ts    # ArgumentEngine — premise CRUD, role management, evaluate, checkValidity, checksum, snapshot, fromSnapshot, rollback, fromData, toDisplayString, lookup methods (getVariable, getExpression, findPremiseByExpressionId, etc.)
      PremiseEngine.ts     # PremiseEngine — variables, expressions, evaluate, toDisplayString, toPremiseData, snapshot, isInference, isConstraint, checksum
      ExpressionManager.ts # Low-level expression tree (addExpression, appendExpression, addExpressionRelative, updateExpression, removeExpression, insertExpression)
      VariableManager.ts   # Low-level variable registry (with symbol→id reverse lookup via getVariableBySymbol)
      ChangeCollector.ts   # Internal change collector (not exported) — accumulates entity changes during mutations
      checksum.ts          # computeHash, canonicalSerialize, entityChecksum (standalone utilities)
      diff.ts              # diffArguments + default comparators (standalone function, pluggable)
      relationships.ts     # analyzePremiseRelationships + buildPremiseProfile (standalone functions)
      evaluation/
        shared.ts          # makeValidationResult, makeErrorIssue, implicationValue, buildDirectionalVacuity,
                           #   kleeneNot, kleeneAnd, kleeneOr, kleeneImplies, kleeneIff
      parser/
        formula.ts         # parseFormula — parses logical formula strings into FormulaAST
  cli/
    config.ts             # Path helpers: getStateDir, getArgumentDir, getVersionDir, getPremisesDir, getPremiseDir
    engine.ts             # hydrateEngine(argumentId, version) → ArgumentEngine (reads disk, BFS expression load)
    output.ts             # printJson, printLine, errorExit, requireConfirmation
    router.ts             # isNamedCommand(), resolveVersion() (handles "latest" / "last-published" / integer)
    storage/
      arguments.ts        # readArgumentMeta/write, readVersionMeta/write, listArgumentIds, listVersionNumbers,
                          #   latestVersionNumber, deleteVersionDir, deleteArgumentDir, copyVersionDir
      variables.ts        # readVariables, writeVariables
      roles.ts            # readRoles, writeRoles
      premises.ts         # readPremiseMeta/write, readPremiseData/write, listPremiseIds, deletePremiseDir, premiseExists
      analysis.ts         # readAnalysis, writeAnalysis, listAnalysisFiles, deleteAnalysisFile,
                          #   analysisFileExists, resolveAnalysisFilename
    commands/
      meta.ts             # version command
      arguments.ts        # arguments: create, list, delete, publish
      versionShow.ts      # <id> <ver> show
      render.ts           # <id> <ver> render
      roles.ts            # <id> <ver> roles: show, set-conclusion, clear-conclusion
      variables.ts        # <id> <ver> variables: create, list, show, update, delete, list-unused, delete-unused
      premises.ts         # <id> <ver> premises: create, list, show, update, delete, render
      expressions.ts      # <id> <ver> expressions: create, insert, delete, list, show
      analysis.ts         # <id> <ver> analysis: create, list, show, set, reset, reject, accept,
                          #   validate-assignments, delete, evaluate, check-validity, validate-argument, refs, export

test/
  ExpressionManager.test.ts   # Full test suite (538 tests, Vitest)
```

## Class hierarchy

```
ArgumentEngine<TArg, TPremise, TExpr, TVar>
  ├─ VariableManager<TVar> (shared, owned by engine)
  └─ PremiseEngine<TArg, TPremise, TExpr, TVar> (one per premise)
       └─ ExpressionManager<TExpr> (expression tree)
```

All classes accept `TLogicEngineOptions` as their config parameter. `PremiseEngine` constructor takes `(premise, deps: { argument, variables, expressionIndex? }, config?)` — the premise entity as first arg, dependencies second, config third. The optional `expressionIndex` is a shared `Map<string, string>` (expressionId → premiseId) owned by `ArgumentEngine` and kept in sync by `PremiseEngine` after every mutation.

All type parameters have `extends BaseType = BaseType` defaults, so existing code using these classes without type arguments works unchanged. Extended entity types survive all mutations via spread-based reconstruction; `as T` assertions are used at ~15 internal reconstruction points where TypeScript cannot prove that `Omit<T, K> & Pick<Base, K>` equals `T` for generic `T extends Base`.

`ArgumentEngine` manages a collection of premises and their logical roles (supporting vs. conclusion). The constructor accepts an optional `config?: TLogicEngineOptions` parameter containing `checksumConfig?: TCoreChecksumConfig` and `positionConfig?: TCorePositionConfig`. `TLogicEngineOptions` is the universal config type accepted by all engine/manager classes (renamed from `TArgumentEngineOptions`). The engine owns a single shared `VariableManager` instance and a shared expression index (`Map<string, string>`, expressionId → premiseId), both passed by reference to every `PremiseEngine` it creates. `ArgumentEngine` provides `addVariable()`, `updateVariable()`, and `removeVariable()` (with cascade deletion of referencing expressions across all premises). Each `PremiseEngine` owns the expression tree for one premise and can evaluate or serialize itself independently. `ExpressionManager` and `VariableManager` are internal building blocks not exposed in the public API.

`ArgumentEngine` exposes O(1) lookup methods for variables and expressions: `getVariable(id)`, `hasVariable(id)`, `getVariableBySymbol(symbol)`, `getExpression(id)`, `hasExpression(id)`, `getExpressionPremiseId(id)`, `findPremiseByExpressionId(id)`. It also provides `buildVariableIndex(keyFn)` for building custom-keyed maps over variables (e.g. indexing by extension fields), `getAllExpressions()`, `getExpressionsByVariableId(variableId)`, and `listRootExpressions()`. The expression index is maintained eagerly by `PremiseEngine` via `syncExpressionIndex()` after every mutation, and rebuilt during `fromSnapshot()`, `fromData()`, and `rollback()`.

When the first premise is added to an `ArgumentEngine` (via `createPremise` or `createPremiseWithId`), it is automatically designated as the conclusion premise if no conclusion is currently set. This auto-assignment is reflected in the mutation changeset. Explicit `setConclusionPremise()` overrides the auto-assignment. Removing or clearing the conclusion re-enables auto-assignment for the next premise created.

## CLI state storage layout

```
$PROPOSIT_HOME/   (default: ~/.proposit-core)
  arguments/
    <argument-id>/
      meta.json            # ArgumentMetaSchema: id, title, description
      <version>/           # one directory per version (0, 1, 2, …)
        meta.json          # ArgumentVersionMetaSchema: version, createdAt, published, publishedAt?
        variables.json     # TPropositionalVariable[]
        roles.json         # CoreArgumentRoleStateSchema: { conclusionPremiseId? }
        premises/
          <premise-id>/
            meta.json      # PremiseMetaSchema: id, title?
            data.json      # PremiseDataSchema: rootExpressionId?, variables (id[]), expressions[]
        <analysis>.json    # AnalysisFileSchema: argumentId, argumentVersion, assignments (symbol→boolean|null),
                           #   rejectedExpressionIds (string[])
```

Analysis files default to `analysis.json`. The names `meta.json`, `variables.json`, and `roles.json` are reserved.

All disk reads use `Value.Parse(Schema, raw)` from `typebox/value` (throws on invalid data). `listAnalysisFiles` uses `Value.Check` to silently skip corrupt files.

## CLI routing

`cli.ts` inspects `argv[2]`:

- If it is a **named command** (`help`, `version`, `arguments`, …), Commander handles it directly.
- Otherwise it is treated as an **argument ID** and `argv[3]` is the version selector. After `resolveVersion()`, a versioned sub-command tree is built and the remaining `argv` is re-parsed.

Version selectors: `"latest"` → max version number; `"last-published"` → highest published version; integer string → exact version (must exist).

## Key design decisions

### Premise types

Each premise has a type determined by its root expression, queried via `PremiseEngine`:

- `isInference()` returns `true` when the root is an `implies` or `iff` operator. Inference premises are used as supporting or conclusion premises.
- `isConstraint()` returns `true` when the root is anything else (e.g. a plain variable, `not`, `and`, `or`), or when the premise is empty. Constraint premises restrict admissible variable assignments but are not part of the supporting/conclusion chain.

The type is not stored on disk — it is always derived dynamically from the current expression tree.

### Expression tree representation

Expressions form a rooted tree stored flat in three maps inside `ExpressionManager`:

- `expressions: Map<string, TExpr>` — the main store (expressions stored with checksums, computed at add/update time).
- `childExpressionIdsByParentId: Map<string | null, Set<string>>` — fast child lookup. The `null` key holds root expressions.
- `childPositionsByParentId: Map<string | null, Set<number>>` — tracks which positions are occupied under each parent.

Expressions are **immutable value objects** — to "move" one, delete and re-insert or use `reparent()`.

### Midpoint-based positions

Every expression has a non-nullable numeric `position` (schema: `Type.Number()`). Only relative ordering matters — literal values are opaque to callers.

The position range is configurable via `TCorePositionConfig` (`{ min, max, initial }`), passed through `TLogicEngineOptions.positionConfig`. Defaults are signed int32: `min = -2147483647`, `max = 2147483647`, `initial = 0`. The exported constants `POSITION_MIN`, `POSITION_MAX`, `POSITION_INITIAL` match these defaults.

Position computation uses midpoint bisection from `utils/position.ts`:

| Scenario                       | Position                                  |
| ------------------------------ | ----------------------------------------- |
| First child (no siblings)      | `config.initial` (default `0`)            |
| Append (after last sibling)    | `midpoint(last.position, config.max)`     |
| Prepend (before first sibling) | `midpoint(config.min, first.position)`    |
| Between two siblings           | `midpoint(left.position, right.position)` |

The midpoint function uses `a + (b - a) / 2` (overflow-safe). ~52 bisections at the same insertion point before losing floating-point precision.

**Intent-based insertion API:**

- `appendExpression(parentId, expression)` — appends as last child, position computed automatically.
- `addExpressionRelative(siblingId, "before" | "after", expression)` — inserts relative to an existing sibling.
- `addExpression(expression)` — low-level escape hatch with explicit position.

Both `ExpressionManager` and `PremiseEngine` expose all three methods. The input type for `appendExpression` and `addExpressionRelative` is `TExpressionWithoutPosition` — a distributive Omit that preserves discriminated-union narrowing.

### Root-only operators

`implies` and `iff` must always have `parentId: null`. They cannot be nested inside another expression. This is enforced in both `addExpression` and `insertExpression`.

### `formula` expression type

A `formula` node is a transparent unary wrapper — equivalent to parentheses around its single child. It may have exactly one child. Collapse rules apply to `formula` nodes the same way they do to `operator` nodes.

### `updateExpression`

`updateExpression(id, updates)` modifies an expression's mutable fields in place. Allowed fields: `position` (no sibling collision), `variableId` (variable type only, must exist), `operator` (operator type only, restricted swaps: `and↔or`, `implies↔iff`). Forbidden: `id`, `argumentId`, `argumentVersion`, `premiseId`, `checksum`, `parentId`, `type`. Returns the updated expression with changeset. `not` operators cannot be changed (delete and re-create instead).

### `removeExpression` and operator collapse

`removeExpression(id, deleteSubtree)` takes a required boolean. When `deleteSubtree` is `true`, the expression and all descendants are deleted, then `collapseIfNeeded(parentId)` runs:

- **0 children remaining** — the operator/formula is deleted; the check recurses to the grandparent.
- **1 child remaining** — the operator/formula is deleted and the surviving child is promoted into its former slot. No recursion (grandparent's child count is unchanged).

When `deleteSubtree` is `false`, the expression is removed and its single child is promoted into its slot (inheriting `parentId` and `position`). Throws if >1 child. Validates that root-only operators (`implies`/`iff`) are not promoted into non-root positions. No collapse runs after promotion. Leaf removal with `deleteSubtree: false` runs collapse on the parent (same as `true`).

### `insertExpression` mutation order

`reparent(rightNodeId, ...)` runs **before** `reparent(leftNodeId, ...)`. This handles the case where the right node is a descendant of the left node's subtree — it must be detached first.

### Evaluation

The evaluation system uses **Kleene three-valued logic** (`true`, `false`, `null`/unknown). Assignments are represented by `TCoreExpressionAssignment`, which contains:

- `variables: Record<string, boolean | null>` — variable ID → truth value (`null` = unset/unknown)
- `rejectedExpressionIds: string[]` — expression IDs the user rejects (evaluate to `false`, children skipped)

**Kleene propagation rules:** `false` dominates AND, `true` dominates OR, `null` propagates otherwise. Helper functions `kleeneNot`, `kleeneAnd`, `kleeneOr`, `kleeneImplies`, `kleeneIff` in `evaluation/shared.ts` implement these rules.

`PremiseEngine.evaluate(assignment)` walks the expression tree recursively. Rejected expressions return `false` immediately. Missing variables default to `null`. `formula` nodes are transparent (propagate their child's value). For `implies`/`iff` roots an `inferenceDiagnostic` is computed with three-valued fields (unless the root is rejected).

`ArgumentEngine.evaluate(assignment)` orchestrates premise evaluation. All summary flags are three-valued:

- `isAdmissibleAssignment` — `null` if any constraint evaluates to `null`
- `isCounterexample` — `true` only when admissible, all supports true, conclusion definitively `false`; `null` if indeterminate
- `preservesTruthUnderAssignment` — inverse of `isCounterexample`

`ArgumentEngine.checkValidity(options?)` enumerates all 2ⁿ assignments (all variables `true`/`false`, no rejections) and reports whether the argument is **valid** (no counterexamples), **invalid** (at least one found), or `undefined` (truncated).

### Engine hydration from disk

`hydrateEngine(argumentId, version)` in `src/cli/engine.ts`:

1. Reads argument meta, version meta, variables, roles, and all premise meta+data in parallel.
2. Constructs a `TArgument` from the merged meta objects.
3. Calls `engine.createPremiseWithId(id, title)` for each premise.
4. Registers all argument variables with the engine via `engine.addVariable()`.
5. Adds expressions in BFS order (roots first, then children of already-added nodes) to satisfy `addExpression`'s parent-existence requirement.
6. Sets the conclusion role last (supporting premises are derived automatically from expression type).

### Publish semantics

`arguments publish <id>` marks the current latest version `published: true, publishedAt: Date.now()`, copies its directory to `version + 1`, and writes a fresh unpublished meta for the new version. All mutating CLI commands call `assertNotPublished` and exit 1 if the version is already published.

### Mutation changesets

Every mutating method on `PremiseEngine` and `ArgumentEngine` returns `TCoreMutationResult<T>` instead of its bare return type. The wrapper contains:

- `result: T` — the direct answer (e.g. the removed expression, the new role state).
- `changes: TCoreChangeset` — an entity-typed changeset listing all side effects of the mutation.

`TCoreChangeset` has optional fields for `expressions`, `variables`, `premises`, `roles`, and `argument`. Each entity field is a `TCoreEntityChanges<T>` with `added`, `modified`, and `removed` arrays. The `roles` field is the new `TCoreArgumentRoleState` (present only when roles changed). The `argument` field is the new `TCoreArgument` (present only when argument metadata changed).

Internally, `ChangeCollector` (not exported) accumulates changes during a mutation and produces the changeset via `toChangeset()`.

### Derived supporting premises

Supporting premises are **no longer explicitly managed**. The methods `addSupportingPremise()` and `removeSupportingPremise()` have been removed from `ArgumentEngine`. Instead, any inference premise (root is `implies` or `iff`) that is not the conclusion is automatically considered supporting.

`TCoreArgumentRoleState` now contains only `{ conclusionPremiseId?: string }` — the `supportingPremiseIds` field has been removed. `listSupportingPremises()` derives the list dynamically from the current set of premises and the conclusion assignment.

### Variable management

Variables are argument-scoped and managed by `ArgumentEngine` via `addVariable()`, `updateVariable()`, and `removeVariable()`. The engine owns a single `VariableManager` instance, passed by reference to every `PremiseEngine` it creates. All premises share the same variable registry.

`removeVariable()` cascades across all premises: for each premise, `deleteExpressionsUsingVariable()` removes every expression referencing the variable (including subtrees), with operator collapse running after each removal. The combined changeset includes all removed expressions and the removed variable.

`PremiseEngine` no longer exposes `addVariable()` or `removeVariable()`. It retains read-only access via `getVariables()` (which returns all argument-level variables) and `getReferencedVariableIds()` (which returns only the variable IDs used in its expression tree).

### Checksum system

Per-entity checksums provide a lightweight way to detect changes without deep comparison. Key points:

- All entity types (`TPropositionalExpression`, `TPropositionalVariable`, `TCorePremise`, `TCoreArgument`) carry a required `checksum: string` field in their schemas.
- `ExpressionManager` stores expressions with checksums attached at add/update time. `VariableManager` stores `TVar` directly (checksums attached by `ArgumentEngine` before registration). Checksums for other entities are attached lazily by getters and changeset outputs.
- Add/create methods accept input types without checksum (e.g. `addExpression(expr: TExpressionInput<TExpr>)`, `addVariable(v: TOptionalChecksum<TVar>)`).
- `PremiseEngine.checksum()` and `ArgumentEngine.checksum()` compute cumulative checksums lazily using `Record<string, string>` mapping entity IDs to entity checksums — dirty flags track when recomputation is needed.
- `TCoreChecksumConfig` controls which fields are hashed per entity type using `Set<string>` fields. `DEFAULT_CHECKSUM_CONFIG` and `createChecksumConfig()` are exported from `src/lib/consts.ts`.
- The `ArgumentEngine` constructor accepts `config?: TLogicEngineOptions` (containing `checksumConfig` and `positionConfig`).
- Standalone utilities: `computeHash(input)`, `canonicalSerialize(obj, fields)`, `entityChecksum(entity, fields)` in `core/checksum.ts`.
- CLI disk reads use local schemas with optional checksum for backward compatibility with older data files.

### Snapshot/rollback

All classes support hierarchical snapshot/restore. Each class snapshots only what it **owns**; dependencies are excluded and passed separately during restoration.

- `ExpressionManager.snapshot()` → `TExpressionManagerSnapshot` (expressions with checksums, config)
- `VariableManager.snapshot()` → `TVariableManagerSnapshot` (variables, config)
- `PremiseEngine.snapshot()` → `TPremiseEngineSnapshot` (premise metadata, expression snapshot, config — excludes argument/variables)
- `ArgumentEngine.snapshot()` → `TArgumentEngineSnapshot` (argument, variable snapshot, premise snapshots, conclusionPremiseId, config)

Each class has a `static fromSnapshot()` that reconstructs an instance. `PremiseEngine.fromSnapshot()` accepts argument, `VariableManager`, and an optional `expressionIndex` map as dependencies. `ArgumentEngine.fromSnapshot()` reconstructs all children from the nested snapshots and passes the shared expression index to each `PremiseEngine`.

`ArgumentEngine.rollback(snapshot)` restores state in place (preserving the instance reference).

`ArgumentEngine.fromData(argument, variables, premises, expressions, roles, config?)` bulk-loads from flat arrays (DB queries), grouping expressions by `premiseId` and loading in BFS order. Supports generic type inference from parameters.

`ArgumentEngine.toDisplayString()` renders the full argument with role labels (`[Conclusion]`, `[Supporting]`, `[Constraint]`).

`PremiseEngine.toPremiseData()` returns a `TPremise` object (premise metadata + checksum). Does not include expressions or variables — use `getExpressions()` and `getReferencedVariableIds()` for those.

### Schema additions

- `BasePropositionalExpressionSchema` now includes `premiseId: UUID` — expressions are self-describing.
- `CorePremiseSchema` now includes `argumentId: UUID` and `argumentVersion: Type.Number()` — premises are self-describing.

## Types

`TPropositionalExpression<T>` is a discriminated union narrowed by `type`:

```typescript
TPropositionalExpression<"variable"> // has variableId
TPropositionalExpression<"operator"> // has operator
TPropositionalExpression<"formula"> // transparent unary wrapper; no extra fields
TPropositionalExpression // any of the above
```

Key evaluation types (all in `src/lib/types/evaluation.ts`):

- `TTrivalentValue` — `boolean | null` three-valued truth type (`null` = unknown/unset).
- `TVariableAssignment` — `Record<string, TTrivalentValue>` mapping variable IDs to three-valued truth values.
- `TExpressionAssignment` — `{ variables: TVariableAssignment, rejectedExpressionIds: string[] }` full assignment input for evaluation.
- `TValidationResult` / `TValidationIssue` — structured findings with machine-readable `TValidationCode` strings.
- `TPremiseEvaluationResult` — per-expression truth values, root value, inference diagnostics.
- `TArgumentEvaluationResult` — full evaluation output for one assignment.
- `TValidityCheckResult` — truth-table search summary with counterexamples and truncation info.

Key mutation types (all in `src/lib/types/mutation.ts`):

- `TCoreMutationResult<T, TExpr, TVar, TPremise, TArg>` — `{ result: T, changes: TCoreChangeset<...> }` wrapper returned by all mutating methods. All type params default to base types.
- `TCoreChangeset<TExpr, TVar, TPremise, TArg>` — optional fields for `expressions`, `variables`, `premises` (each `TCoreEntityChanges<T>`), plus `roles` (`TCoreArgumentRoleState`) and `argument` (`TArg`). All entities include checksums. All type params default to base types.
- `TCoreEntityChanges<T>` — `{ added: T[], modified: T[], removed: T[] }` tracking entity-level side effects.

Key checksum types (in `src/lib/types/checksum.ts`):

- `TCoreChecksumConfig` — configurable `Set<string>` fields for each entity type (`expressionFields`, `variableFields`, `premiseFields`, `argumentFields`, `roleFields`).

All entity types carry a required `checksum: string` field. `ExpressionManager` stores expressions with checksums; other managers attach checksums lazily by getters and changeset outputs.

Key diff types (all in `src/lib/types/diff.ts`):

- `TCoreFieldChange` — single field-level change (`{ field, before, after }`).
- `TCoreEntityFieldDiff<T>` — field-level diff for a single matched entity.
- `TCoreEntitySetDiff<T>` — set-level diff (added/removed/modified).
- `TCorePremiseDiff<TPremise, TExpr>` — premise diff with nested expression diffs. Defaults to base types.
- `TCorePremiseSetDiff<TPremise, TExpr>` — premise set diff. Defaults to base types.
- `TCoreArgumentDiff<TArg, TVar, TPremise, TExpr>` — top-level diff result from `diffArguments`. Defaults to base types.
- `TCoreDiffOptions<TArg, TVar, TPremise, TExpr>` — per-entity comparator overrides for `diffArguments`. Defaults to base types.

Key relationship types (all in `src/lib/types/relationships.ts`):

- `TCoreVariableAppearance` — variable's side (`antecedent`/`consequent`) and polarity (`positive`/`negative`).
- `TCorePremiseProfile` — all variable appearances in a premise.
- `TCorePremiseRelationshipType` — `"supporting" | "contradicting" | "restricting" | "downstream" | "unrelated"`.
- `TCorePremiseRelationResult` — per-premise relationship classification with variable details and transitivity flag.
- `TCorePremiseRelationshipAnalysis` — top-level result from `analyzePremiseRelationships`.

Utility types:

- `TOptionalChecksum<T>` — `Omit<T, "checksum"> & Partial<Pick<T, "checksum">>`. Makes the `checksum` field optional. Defined in `src/lib/schemata/shared.ts`. Used for constructor inputs and internal storage where checksums are attached lazily.

Position and input types (in `src/lib/core/ExpressionManager.ts` and `src/lib/utils/position.ts`):

- `TExpressionInput<TExpr>` — `TExpr` with `checksum` omitted via distributive conditional type. Preserves discriminated-union narrowing. Generic with default. Used as input for `addExpression` and `insertExpression`.
- `TExpressionWithoutPosition<TExpr>` — `TExpr` with both `position` and `checksum` omitted via distributive conditional type. Preserves discriminated-union narrowing. Generic with default. Used as input for `appendExpression` and `addExpressionRelative`.
- `TExpressionUpdate` — `{ position?: number; variableId?: string; operator?: TCoreLogicalOperatorType }`. Used as input for `updateExpression`. Only the specified fields may be updated; all other fields are forbidden.
- `TCorePositionConfig` — `{ min: number, max: number, initial: number }`. Configures position range. Default: signed int32 (`-2147483647` to `2147483647`, initial `0`).
- `DEFAULT_POSITION_CONFIG` — the default `TCorePositionConfig` matching the exported `POSITION_MIN`/`MAX`/`INITIAL` constants.
- `TLogicEngineOptions` — `{ checksumConfig?: TCoreChecksumConfig, positionConfig?: TCorePositionConfig }`. Universal config type for all engine/manager classes.
- `TExpressionManagerSnapshot<TExpr>` — `{ expressions: TExpr[], config? }`. Snapshot of `ExpressionManager`.
- `TVariableManagerSnapshot<TVar>` — `{ variables: TVar[], config? }`. Snapshot of `VariableManager`.
- `TPremiseEngineSnapshot<TPremise, TExpr>` — `{ premise, expressions, config? }`. Snapshot of `PremiseEngine` (excludes dependencies).
- `TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>` — `{ argument, variables, premises, conclusionPremiseId?, config? }`. Full engine snapshot.
- `POSITION_MIN` / `POSITION_MAX` / `POSITION_INITIAL` — default position range constants (signed int32).
- `midpoint(a, b)` — overflow-safe midpoint helper (`a + (b - a) / 2`).

Schemata use [Typebox](https://github.com/sinclairzx81/typebox) for runtime-validatable schemas alongside TypeScript types.

## Testing

Tests live in `test/ExpressionManager.test.ts` and operate directly on `ArgumentEngine` and `PremiseEngine`. Each `describe` block corresponds to a method or logical grouping. All tests build their own fixtures inline — there is no shared `beforeEach` state.

Current describe blocks (in order):

- `addExpression`
- `insertExpression`
- `removeExpression`
- `removeExpression — operator collapse`
- `removeVariable`
- `addExpression ordering`
- `toArray behaviour (via toData().expressions)`
- `stress test`
- `formula`
- `ArgumentEngine premise CRUD`
- `PremiseEngine — addVariable / removeVariable`
- `PremiseEngine — single-root enforcement`
- `PremiseEngine — addExpression / removeExpression / insertExpression`
- `PremiseEngine — toDisplayString`
- `PremiseEngine — toData`
- `PremiseEngine — validation and evaluation`
- `ArgumentEngine — roles and evaluation`
- `ArgumentEngine — complex argument scenarios across multiple evaluations`
- `diffArguments` (with sub-describes for each default comparator and the main function)
- `Kleene three-valued logic helpers` (with sub-describes for each helper)
- `PremiseEngine — three-valued evaluation`
- `ArgumentEngine — three-valued evaluation`
- `schema shapes with additionalProperties`
- `field preservation — unknown fields survive round-trips`
- `buildPremiseProfile`
- `analyzePremiseRelationships — direct relationships`
- `analyzePremiseRelationships — transitive relationships`
- `analyzePremiseRelationships — precedence and edge cases`
- `position utilities`
- `PremiseEngine — appendExpression and addExpressionRelative`
- `ChangeCollector`
- `PremiseEngine — mutation changesets`
- `ArgumentEngine — mutation changesets`
- `checksum utilities` (with sub-describes for `computeHash`, `canonicalSerialize`, `entityChecksum`, `PremiseEngine — checksum`, `ArgumentEngine — checksum`)
- `ArgumentEngine — variable management`
- `PremiseEngine — deleteExpressionsUsingVariable`
- `PremiseEngine — updateExpression`
- `removeExpression — deleteSubtree parameter`
- `VariableManager — generic type parameter`
- `mutation types — generic changesets`
- `ExpressionManager — generic type parameter`
- `PremiseEngine — generic type parameters`
- `ArgumentEngine — generic type parameters`
- `diffArguments — generic type parameters`
- `ExpressionManager — snapshot`
- `VariableManager — snapshot`
- `PremiseEngine — snapshot`
- `ArgumentEngine — snapshot/fromSnapshot/rollback`
- `ArgumentEngine — fromData`
- `ArgumentEngine — toDisplayString`
- `VariableManager — getVariableBySymbol`
- `PremiseEngine — shared expression index`
- `ArgumentEngine — lookup methods`

When adding a test for a new feature, add a new `describe` block at the bottom.

## Linting notes

- `*.mjs` files (including `eslint.config.mjs`) are excluded from type-aware ESLint rules — see the `disableTypeChecked` override in `eslint.config.mjs`.
- `.claude/` is excluded from Prettier via `.prettierignore`.
- Run `pnpm eslint . --fix` to auto-fix `prefer-optional-chain` and similar stylistic issues before running a manual check.

## ESM import requirements

The project uses `moduleResolution: "bundler"` in `tsconfig.json`, which allows extension-less relative imports in TypeScript. However, `src/cli.ts` is compiled and run directly by Node.js ESM, which requires explicit `.js` extensions on all relative imports.

**Rule:** All relative imports in `src/cli/` and `src/lib/` must end in `.js`. Directory imports (e.g. `schemata/`) must use the explicit index path (`schemata/index.js`).

This matters because `src/lib/utils/` (a directory) and `src/lib/utils.ts` (a file) both compile to `dist/lib/`, and Node.js ESM resolves the directory first if no extension is given.

If you add a new file in `src/cli/` or `src/lib/`, ensure all its relative imports include `.js`.

## Documentation Sync

- `README.md` [Public-API] — API reference, CLI usage, and concepts sections
- `CLAUDE.md` [Public-API] — Architecture, types, and design decisions sections
- `CLI_EXAMPLES.md` [Public-CLI-API] — Walkthrough examples and the complete script
- `scripts/smoke-test.sh` [Public-CLI-API] — Add coverage for new commands, flags, or behaviors
