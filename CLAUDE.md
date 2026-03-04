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
```

Run `pnpm eslint . --fix` to auto-fix lint errors before checking manually.

## Architecture

```
src/
  index.ts              # Public library entry point — re-exports ArgumentEngine, PremiseManager, and all schemata
  cli.ts                # CLI entry point — routes to named commands or version-scoped subcommands
  lib/
    index.ts            # Re-exports core classes and evaluation types
    utils.ts            # DefaultMap utility (with optional LRU limit)
    utils/
      collections.ts    # getOrCreate, sortedCopyById, sortedUnique
      position.ts       # POSITION_MIN, POSITION_MAX, POSITION_INITIAL, midpoint
    schemata/
      index.ts          # Re-exports all schemata
      argument.ts       # TArgument, TArgumentMeta, TArgumentVersionMeta, TCoreArgumentRoleState schemas + types
      analysis.ts       # TAnalysisFile schema + type
      propositional.ts  # TPropositionalVariable, TPropositionalExpression (variable/operator/formula),
                        #   TPremise, TLogicalOperatorType
      shared.ts         # UUID, Nullable helpers
    types/
      evaluation.ts     # All evaluation types: TTrivalentValue, TVariableAssignment,
                        #   TExpressionAssignment, TArgumentEvaluationResult, TValidityCheckResult, etc.
      diff.ts           # Diff types: TCoreArgumentDiff, TCoreFieldChange, TCoreEntitySetDiff, TCoreDiffOptions, etc.
      mutation.ts       # TCoreEntityChanges, TCoreChangeset, TCoreMutationResult
      checksum.ts       # TCoreChecksumConfig
      relationships.ts  # Relationship types: TCorePremiseRelationshipAnalysis, TCorePremiseProfile,
                        #   TCoreVariableAppearance, TCorePremiseRelationResult, etc.
    core/
      ArgumentEngine.ts    # ArgumentEngine — premise CRUD, role management, evaluate, checkValidity, checksum
      PremiseManager.ts    # PremiseManager — variables, expressions, evaluate, toDisplayString, toData, isInference, isConstraint, checksum
      ExpressionManager.ts # Low-level expression tree (addExpression, appendExpression, addExpressionRelative, removeExpression, insertExpression)
      VariableManager.ts   # Low-level variable registry
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
  ExpressionManager.test.ts   # Full test suite (325 tests, Vitest)
```

## Class hierarchy

```
ArgumentEngine
  └─ PremiseManager (one per premise)
       ├─ VariableManager (variable registry)
       └─ ExpressionManager (expression tree)
```

`ArgumentEngine` manages a collection of premises and their logical roles (supporting vs. conclusion). The constructor accepts an optional `options` parameter: `{ checksumConfig?: TCoreChecksumConfig }`. Each `PremiseManager` owns the variables and expression tree for one premise and can evaluate or serialize itself independently. `ExpressionManager` and `VariableManager` are internal building blocks not exposed in the public API.

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

Each premise has a type determined by its root expression, queried via `PremiseManager`:

- `isInference()` returns `true` when the root is an `implies` or `iff` operator. Inference premises are used as supporting or conclusion premises.
- `isConstraint()` returns `true` when the root is anything else (e.g. a plain variable, `not`, `and`, `or`), or when the premise is empty. Constraint premises restrict admissible variable assignments but are not part of the supporting/conclusion chain.

The type is not stored on disk — it is always derived dynamically from the current expression tree.

### Expression tree representation

Expressions form a rooted tree stored flat in three maps inside `ExpressionManager`:

- `expressions: Map<string, TPropositionalExpression>` — the main store.
- `childExpressionIdsByParentId: Map<string | null, Set<string>>` — fast child lookup. The `null` key holds root expressions.
- `childPositionsByParentId: Map<string | null, Set<number>>` — tracks which positions are occupied under each parent.

Expressions are **immutable value objects** — to "move" one, delete and re-insert or use `reparent()`.

### Midpoint-based positions

Every expression has a non-nullable numeric `position` (schema: `Type.Number({ minimum: 0 })`). Only relative ordering matters — literal values are opaque to callers.

Position computation uses midpoint bisection from `utils/position.ts`:

| Scenario                       | Position                                  |
| ------------------------------ | ----------------------------------------- |
| First child (no siblings)      | `POSITION_INITIAL`                        |
| Append (after last sibling)    | `midpoint(last.position, POSITION_MAX)`   |
| Prepend (before first sibling) | `midpoint(POSITION_MIN, first.position)`  |
| Between two siblings           | `midpoint(left.position, right.position)` |

The midpoint function uses `a + (b - a) / 2` (overflow-safe). ~52 bisections at the same insertion point before losing floating-point precision.

**Intent-based insertion API:**

- `appendExpression(parentId, expression)` — appends as last child, position computed automatically.
- `addExpressionRelative(siblingId, "before" | "after", expression)` — inserts relative to an existing sibling.
- `addExpression(expression)` — low-level escape hatch with explicit position.

Both `ExpressionManager` and `PremiseManager` expose all three methods. The input type for `appendExpression` and `addExpressionRelative` is `TExpressionWithoutPosition` — a distributive Omit that preserves discriminated-union narrowing.

### Root-only operators

`implies` and `iff` must always have `parentId: null`. They cannot be nested inside another expression. This is enforced in both `addExpression` and `insertExpression`.

### `formula` expression type

A `formula` node is a transparent unary wrapper — equivalent to parentheses around its single child. It may have exactly one child. Collapse rules apply to `formula` nodes the same way they do to `operator` nodes.

### Operator collapse on removal

After `removeExpression` deletes a subtree, `collapseIfNeeded(parentId)` is called:

- **0 children remaining** — the operator/formula is deleted; the check recurses to the grandparent.
- **1 child remaining** — the operator/formula is deleted and the surviving child is promoted into its former slot. No recursion (grandparent's child count is unchanged).

### `insertExpression` mutation order

`reparent(rightNodeId, ...)` runs **before** `reparent(leftNodeId, ...)`. This handles the case where the right node is a descendant of the left node's subtree — it must be detached first.

### Evaluation

The evaluation system uses **Kleene three-valued logic** (`true`, `false`, `null`/unknown). Assignments are represented by `TCoreExpressionAssignment`, which contains:

- `variables: Record<string, boolean | null>` — variable ID → truth value (`null` = unset/unknown)
- `rejectedExpressionIds: string[]` — expression IDs the user rejects (evaluate to `false`, children skipped)

**Kleene propagation rules:** `false` dominates AND, `true` dominates OR, `null` propagates otherwise. Helper functions `kleeneNot`, `kleeneAnd`, `kleeneOr`, `kleeneImplies`, `kleeneIff` in `evaluation/shared.ts` implement these rules.

`PremiseManager.evaluate(assignment)` walks the expression tree recursively. Rejected expressions return `false` immediately. Missing variables default to `null`. `formula` nodes are transparent (propagate their child's value). For `implies`/`iff` roots an `inferenceDiagnostic` is computed with three-valued fields (unless the root is rejected).

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
4. Registers all argument variables with every `PremiseManager`.
5. Adds expressions in BFS order (roots first, then children of already-added nodes) to satisfy `addExpression`'s parent-existence requirement.
6. Sets the conclusion role last (supporting premises are derived automatically from expression type).

### Publish semantics

`arguments publish <id>` marks the current latest version `published: true, publishedAt: Date.now()`, copies its directory to `version + 1`, and writes a fresh unpublished meta for the new version. All mutating CLI commands call `assertNotPublished` and exit 1 if the version is already published.

### Mutation changesets

Every mutating method on `PremiseManager` and `ArgumentEngine` returns `TCoreMutationResult<T>` instead of its bare return type. The wrapper contains:

- `result: T` — the direct answer (e.g. the removed expression, the new role state).
- `changes: TCoreChangeset` — an entity-typed changeset listing all side effects of the mutation.

`TCoreChangeset` has optional fields for `expressions`, `variables`, `premises`, `roles`, and `argument`. Each entity field is a `TCoreEntityChanges<T>` with `added`, `modified`, and `removed` arrays. The `roles` field is the new `TCoreArgumentRoleState` (present only when roles changed). The `argument` field is the new `TCoreArgument` (present only when argument metadata changed).

Internally, `ChangeCollector` (not exported) accumulates changes during a mutation and produces the changeset via `toChangeset()`.

### Derived supporting premises

Supporting premises are **no longer explicitly managed**. The methods `addSupportingPremise()` and `removeSupportingPremise()` have been removed from `ArgumentEngine`. Instead, any inference premise (root is `implies` or `iff`) that is not the conclusion is automatically considered supporting.

`TCoreArgumentRoleState` now contains only `{ conclusionPremiseId?: string }` — the `supportingPremiseIds` field has been removed. `listSupportingPremises()` derives the list dynamically from the current set of premises and the conclusion assignment.

### Checksum system

Per-entity checksums provide a lightweight way to detect changes without deep comparison. Key points:

- All entity types (`TPropositionalExpression`, `TPropositionalVariable`, `TCorePremise`, `TCoreArgument`) carry an optional `checksum?: string` field.
- `PremiseManager.checksum()` and `ArgumentEngine.checksum()` compute checksums lazily — dirty flags track when recomputation is needed.
- `TCoreChecksumConfig` controls which fields are hashed per entity type. Defaults are provided for each.
- The `ArgumentEngine` constructor accepts `options?: { checksumConfig?: TCoreChecksumConfig }`.
- Standalone utilities: `computeHash(input)`, `canonicalSerialize(obj, fields)`, `entityChecksum(entity, fields)` in `core/checksum.ts`.
- Checksums are populated in entity getters (e.g. `toData()`) and in changeset outputs.

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

- `TCoreMutationResult<T>` — `{ result: T, changes: TCoreChangeset }` wrapper returned by all mutating methods.
- `TCoreChangeset` — optional fields for `expressions`, `variables`, `premises` (each `TCoreEntityChanges<T>`), plus `roles` (`TCoreArgumentRoleState`) and `argument` (`TCoreArgument`).
- `TCoreEntityChanges<T>` — `{ added: T[], modified: T[], removed: T[] }` tracking entity-level side effects.

Key checksum types (in `src/lib/types/checksum.ts`):

- `TCoreChecksumConfig` — configurable fields for each entity type (`expressionFields`, `variableFields`, `premiseFields`, `argumentFields`, `roleFields`).

All entity types carry an optional `checksum?: string` field populated by getters and changesets.

Key diff types (all in `src/lib/types/diff.ts`):

- `TCoreFieldChange` — single field-level change (`{ field, before, after }`).
- `TCoreEntityFieldDiff<T>` — field-level diff for a single matched entity.
- `TCoreEntitySetDiff<T>` — set-level diff (added/removed/modified).
- `TCorePremiseDiff` — premise diff with nested expression diffs.
- `TCoreArgumentDiff` — top-level diff result from `diffArguments`.
- `TCoreDiffOptions` — per-entity comparator overrides for `diffArguments`.

Key relationship types (all in `src/lib/types/relationships.ts`):

- `TCoreVariableAppearance` — variable's side (`antecedent`/`consequent`) and polarity (`positive`/`negative`).
- `TCorePremiseProfile` — all variable appearances in a premise.
- `TCorePremiseRelationshipType` — `"supporting" | "contradicting" | "restricting" | "downstream" | "unrelated"`.
- `TCorePremiseRelationResult` — per-premise relationship classification with variable details and transitivity flag.
- `TCorePremiseRelationshipAnalysis` — top-level result from `analyzePremiseRelationships`.

Position types (in `src/lib/core/ExpressionManager.ts` and `src/lib/utils/position.ts`):

- `TExpressionWithoutPosition` — `TPropositionalExpression` with `position` omitted via distributive conditional type. Preserves discriminated-union narrowing. Used as input for `appendExpression` and `addExpressionRelative`.
- `POSITION_MIN` / `POSITION_MAX` / `POSITION_INITIAL` — constants for midpoint computation.
- `midpoint(a, b)` — overflow-safe midpoint helper (`a + (b - a) / 2`).

Schemata use [Typebox](https://github.com/sinclairzx81/typebox) for runtime-validatable schemas alongside TypeScript types.

## Testing

Tests live in `test/ExpressionManager.test.ts` and operate directly on `ArgumentEngine` and `PremiseManager`. Each `describe` block corresponds to a method or logical grouping. All tests build their own fixtures inline — there is no shared `beforeEach` state.

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
- `PremiseManager — addVariable / removeVariable`
- `PremiseManager — single-root enforcement`
- `PremiseManager — addExpression / removeExpression / insertExpression`
- `PremiseManager — toDisplayString`
- `PremiseManager — toData`
- `PremiseManager — validation and evaluation`
- `ArgumentEngine — roles and evaluation`
- `ArgumentEngine — complex argument scenarios across multiple evaluations`
- `diffArguments` (with sub-describes for each default comparator and the main function)
- `Kleene three-valued logic helpers` (with sub-describes for each helper)
- `PremiseManager — three-valued evaluation`
- `ArgumentEngine — three-valued evaluation`
- `schema shapes with additionalProperties`
- `field preservation — unknown fields survive round-trips`
- `buildPremiseProfile`
- `analyzePremiseRelationships — direct relationships`
- `analyzePremiseRelationships — transitive relationships`
- `analyzePremiseRelationships — precedence and edge cases`
- `position utilities`
- `PremiseManager — appendExpression and addExpressionRelative`
- `ChangeCollector`
- `PremiseManager — mutation changesets`
- `ArgumentEngine — mutation changesets`
- `checksum utilities` (with sub-describes for `computeHash`, `canonicalSerialize`, `entityChecksum`, `PremiseManager — checksum`, `ArgumentEngine — checksum`)

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
