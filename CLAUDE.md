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

## Key design rules

Non-obvious constraints enforced by the code that are easy to violate:

- **Root-only operators:** `implies` and `iff` must have `parentId: null`. They cannot be nested. Enforced in `addExpression` and `insertExpression`.
- **`formula` nodes:** Transparent unary wrappers (parentheses). Exactly one child. Collapse rules apply same as operators.
- **Operator collapse:** When `removeExpression` leaves an operator/formula with 0 children, it's deleted (recurses to grandparent). With 1 child, the child is promoted into the operator's slot.
- **`insertExpression` mutation order:** `reparent(rightNodeId)` runs before `reparent(leftNodeId)` to handle the case where right is a descendant of left's subtree.
- **Premise types are derived:** `isInference()` = root is `implies`/`iff`. `isConstraint()` = anything else or empty. Not stored — derived from expression tree.
- **Derived supporting premises:** Any inference premise not designated as conclusion is automatically supporting. `TCoreArgumentRoleState` only stores `{ conclusionPremiseId? }`.
- **Auto-conclusion assignment:** First premise added to an engine is auto-designated as conclusion if none is set.
- **Variable cascade:** `removeVariable()` cascades across all premises, deleting referencing expressions with operator collapse.
- **Kleene three-valued evaluation:** `true`, `false`, `null`/unknown. All summary flags (`isAdmissibleAssignment`, `isCounterexample`, `preservesTruthUnderAssignment`) are three-valued.
- **`updateExpression` restricted swaps:** Only `and↔or` and `implies↔iff`. `not` cannot be changed (delete and re-create).
- **Publish semantics:** Publishing marks the current version as published and copies it to a new unpublished version. All mutating CLI commands reject published versions.

## Testing

Tests live in `test/core.test.ts`. Each `describe` block corresponds to a method or logical grouping. All tests build their own fixtures inline — no shared `beforeEach` state. When adding a test for a new feature, add a new `describe` block at the bottom.

## Linting notes

- `*.mjs` files are excluded from type-aware ESLint rules — see `disableTypeChecked` override in `eslint.config.mjs`.
- `.claude/` is excluded from Prettier via `.prettierignore`.
- Run `pnpm eslint . --fix` to auto-fix stylistic issues before checking manually.

## ESM import requirements

All relative imports in `src/cli/` and `src/lib/` must end in `.js`. Directory imports must use the explicit index path (e.g. `schemata/index.js`).

## Naming conventions

Enforced by ESLint (`@typescript-eslint/naming-convention` and `check-file/filename-naming-convention`).

| Category                      | Convention                         | Examples                                  |
| ----------------------------- | ---------------------------------- | ----------------------------------------- |
| Filenames                     | `kebab-case`                       | `argument-engine.ts`, `default-map.ts`    |
| Functions, methods, variables | `camelCase`                        | `parseFormula`, `getVariable`, `rootId`   |
| Classes                       | `PascalCase`                       | `ArgumentEngine`, `DefaultMap`            |
| Type aliases and interfaces   | `T`-prefixed `PascalCase`          | `TCoreArgument`, `TFormulaAST`, `TUUID`   |
| Type parameters               | `PascalCase` (no prefix required)  | `T`, `K`, `TExpr`, `TVar`                 |
| Enum names                    | `PascalCase`                       | `LogicalOperator`                         |
| Enum members                  | `SCREAMING_SNAKE_CASE`             | `AND`, `IMPLIES`                          |
| True constants                | `SCREAMING_SNAKE_CASE`             | `POSITION_MIN`, `DEFAULT_CHECKSUM_CONFIG` |
| Typebox schema objects        | `PascalCase` (allowed for `const`) | `CoreArgumentSchema`, `UUID`              |

**Notes:**
- Destructured variables and imports are exempt (source determines naming).
- Override methods are exempt (parent class determines name).

## Documentation Sync

- `README.md` [Public-CLI-API] — Concepts, usage examples, and CLI sections
- `docs/api-reference.md` [Public-API] — Full API reference for engines, standalone functions, and types; update when public API changes
- `CLAUDE.md` [Public-API] — Design rules and conventions sections
- `CLI_EXAMPLES.md` [Public-CLI-API] — Walkthrough examples and the complete script
- `scripts/smoke-test.sh` [Public-CLI-API] — Add coverage for new commands, flags, or behaviors
