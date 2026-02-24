# proposit-core — Claude Code Guide

## Commands

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # prettier --check + eslint
pnpm run prettify    # prettier --write (auto-fix formatting)
pnpm run test        # vitest run
pnpm run build       # tsc -p tsconfig.build.json → dist/
pnpm run check       # all of the above in sequence
```

Run `pnpm eslint . --fix` to auto-fix lint errors before checking manually.

## Architecture

```
src/
  index.ts              # Public entry point — re-exports ArgumentEngine, PremiseManager, and all schemata
  lib/
    index.ts            # Re-exports core classes and evaluation types
    utils.ts            # DefaultMap utility (with optional LRU limit)
    utils/
      collections.ts    # getOrCreate, sortedCopyById, sortedUnique
    schemata/
      index.ts          # Re-exports all schemata
      argument.ts       # TArgument schema + type
      propositional.ts  # TPropositionalVariable, TPropositionalExpression (variable/operator/formula),
                        #   TPremise, TLogicalOperatorType
      shared.ts         # UUID, Nullable helpers
    types/
      evaluation.ts     # All evaluation types: TVariableAssignment, TValidationResult,
                        #   TArgumentEvaluationResult, TValidityCheckResult, etc.
    core/
      ArgumentEngine.ts    # ArgumentEngine — premise CRUD, role management, evaluate, checkValidity
      PremiseManager.ts    # PremiseManager — variables, expressions, evaluate, toDisplayString, toData
      ExpressionManager.ts # Low-level expression tree (addExpression, removeExpression, insertExpression)
      VariableManager.ts   # Low-level variable registry
      evaluation/
        shared.ts          # makeValidationResult, makeErrorIssue, implicationValue, buildDirectionalVacuity

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

## Key design decisions

### Premise types

Each premise has a **type** derived from its root expression:

- `"inference"` — root is an `implies` or `iff` operator. Used as a supporting or conclusion premise.
- `"constraint"` — root is anything else (e.g. a plain variable, `not`, `and`, `or`). Constraint premises restrict admissible variable assignments but are not part of the supporting/conclusion chain.

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
