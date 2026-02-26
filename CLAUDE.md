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
    schemata/
      index.ts          # Re-exports all schemata
      argument.ts       # TArgument, TArgumentMeta, TArgumentVersionMeta, TArgumentRoleState schemas + types
      analysis.ts       # TAnalysisFile schema + type
      propositional.ts  # TPropositionalVariable, TPropositionalExpression (variable/operator/formula),
                        #   TPremise, TLogicalOperatorType
      shared.ts         # UUID, Nullable helpers
    types/
      evaluation.ts     # All evaluation types: TVariableAssignment, TValidationResult,
                        #   TArgumentEvaluationResult, TValidityCheckResult, etc.
    core/
      ArgumentEngine.ts    # ArgumentEngine — premise CRUD, role management, evaluate, checkValidity
      PremiseManager.ts    # PremiseManager — variables, expressions, evaluate, toDisplayString, toData, isInference, isConstraint
      ExpressionManager.ts # Low-level expression tree (addExpression, removeExpression, insertExpression)
      VariableManager.ts   # Low-level variable registry
      evaluation/
        shared.ts          # makeValidationResult, makeErrorIssue, implicationValue, buildDirectionalVacuity
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
      roles.ts            # <id> <ver> roles: show, set-conclusion, clear-conclusion, add-support, remove-support
      variables.ts        # <id> <ver> variables: create, list, show, update, delete, list-unused, delete-unused
      premises.ts         # <id> <ver> premises: create, list, show, update, delete, render
      expressions.ts      # <id> <ver> expressions: create, insert, delete, list, show
      analysis.ts         # <id> <ver> analysis: create, list, show, set, reset, validate-assignments, delete,
                          #   evaluate, check-validity, validate-argument, refs, export

test/
  ExpressionManager.test.ts   # Full test suite (112 tests, Vitest)
```

## Class hierarchy

```
ArgumentEngine
  └─ PremiseManager (one per premise)
       ├─ VariableManager (variable registry)
       └─ ExpressionManager (expression tree)
```

`ArgumentEngine` manages a collection of premises and their logical roles (supporting vs. conclusion). Each `PremiseManager` owns the variables and expression tree for one premise and can evaluate or serialize itself independently. `ExpressionManager` and `VariableManager` are internal building blocks not exposed in the public API.

## CLI state storage layout

```
$PROPOSIT_HOME/   (default: ~/.proposit-core)
  arguments/
    <argument-id>/
      meta.json            # ArgumentMetaSchema: id, title, description
      <version>/           # one directory per version (0, 1, 2, …)
        meta.json          # ArgumentVersionMetaSchema: version, createdAt, published, publishedAt?
        variables.json     # TPropositionalVariable[]
        roles.json         # ArgumentRoleStateSchema: { conclusionPremiseId?, supportingPremiseIds }
        premises/
          <premise-id>/
            meta.json      # PremiseMetaSchema: id, title?
            data.json      # PremiseDataSchema: rootExpressionId?, variables (id[]), expressions[]
        <analysis>.json    # AnalysisFileSchema: argumentId, argumentVersion, assignments (symbol→boolean)
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

`PremiseManager.evaluate(assignment)` walks the expression tree recursively. `formula` nodes are transparent (propagate their child's value). For `implies`/`iff` roots an `inferenceDiagnostic` is computed (vacuous truth, directional vacuity, fired/held flags).

`ArgumentEngine.evaluate(assignment)` orchestrates premise evaluation:

- Constraint premises must all be `true` for an assignment to be **admissible**.
- A **counterexample** is an admissible assignment where all supporting premises are true but the conclusion is false.

`ArgumentEngine.checkValidity(options?)` enumerates all 2ⁿ assignments and reports whether the argument is **valid** (no counterexamples), **invalid** (at least one found), or `undefined` (truncated).

### Engine hydration from disk

`hydrateEngine(argumentId, version)` in `src/cli/engine.ts`:

1. Reads argument meta, version meta, variables, roles, and all premise meta+data in parallel.
2. Constructs a `TArgument` from the merged meta objects.
3. Calls `engine.createPremiseWithId(id, title)` for each premise.
4. Registers all argument variables with every `PremiseManager`.
5. Adds expressions in BFS order (roots first, then children of already-added nodes) to satisfy `addExpression`'s parent-existence requirement.
6. Sets conclusion and supporting roles last.

### Publish semantics

`arguments publish <id>` marks the current latest version `published: true, publishedAt: Date.now()`, copies its directory to `version + 1`, and writes a fresh unpublished meta for the new version. All mutating CLI commands call `assertNotPublished` and exit 1 if the version is already published.

## Types

`TPropositionalExpression<T>` is a discriminated union narrowed by `type`:

```typescript
TPropositionalExpression<"variable"> // has variableId
TPropositionalExpression<"operator"> // has operator
TPropositionalExpression<"formula"> // transparent unary wrapper; no extra fields
TPropositionalExpression // any of the above
```

Key evaluation types (all in `src/lib/types/evaluation.ts`):

- `TVariableAssignment` — `Record<string, boolean>` mapping variable IDs to truth values.
- `TValidationResult` / `TValidationIssue` — structured findings with machine-readable `TValidationCode` strings.
- `TPremiseEvaluationResult` — per-expression truth values, root value, inference diagnostics.
- `TArgumentEvaluationResult` — full evaluation output for one assignment.
- `TValidityCheckResult` — truth-table search summary with counterexamples and truncation info.

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
