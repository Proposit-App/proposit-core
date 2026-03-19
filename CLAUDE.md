# proposit-core — Claude Code Guide

## Generic instructions

- Git commit messages should not include any co-authoring content
- When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.
- After completing a major set of changes, offer to cut a new version via `pnpm version patch|minor|major`. Use `patch` for most changes, `minor` for major feature work, and `major` only when explicitly instructed. When versioning, add release notes to `docs/release-notes/{version}.md` summarizing what changed.

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
- **Operator nesting restriction:** Non-`not` operator expressions (`and`, `or`, `implies`, `iff`) cannot be direct children of any operator expression. A `formula` node must sit between them. `not` is exempt as a child. Enforced in `addExpression`, `insertExpression`, `wrapExpression`, and `removeExpression` (pre-flight check). Bypassed during `fromSnapshot`/`fromData`/`rollback` restoration.
- **Operator collapse:** When `removeExpression` leaves an operator/formula with 0 children, it's deleted (recurses to grandparent). With 1 child, the child is promoted into the operator's slot.
- **`insertExpression` mutation order:** `reparent(rightNodeId)` runs before `reparent(leftNodeId)` to handle the case where right is a descendant of left's subtree.
- **Premise types are derived:** `isInference()` = root is `implies`/`iff`. `isConstraint()` = anything else or empty. Not stored — derived from expression tree.
- **Derived supporting premises:** Any inference premise not designated as conclusion is automatically supporting. `TCoreArgumentRoleState` only stores `{ conclusionPremiseId? }`.
- **Auto-conclusion assignment:** First premise added to an engine is auto-designated as conclusion if none is set.
- **Variable cascade:** `removeVariable()` cascades across all premises, deleting referencing expressions with operator collapse.
- **Kleene three-valued evaluation:** `true`, `false`, `null`/unknown. All summary flags (`isAdmissibleAssignment`, `isCounterexample`, `preservesTruthUnderAssignment`) are three-valued.
- **`updateExpression` restricted swaps:** Only `and↔or` and `implies↔iff`. `not` cannot be changed (delete and re-create).
- **Publish semantics:** Publishing marks the current version as published and copies it to a new unpublished version. All mutating CLI commands reject published versions.
- **Variables require either claim or premise references:** Every variable must reference either a claim (via `claimId`/`claimVersion`) or a premise (via `boundPremiseId`/`boundArgumentId`/`boundArgumentVersion`), but not both. Claim-bound variables represent atomic propositions; premise-bound variables represent the proposition expressed by the bound premise's expression tree, and are resolved during evaluation.
- **Libraries are required by ArgumentEngine:** Constructor is `(argument, claimLibrary, sourceLibrary, claimSourceLibrary, options?)`. Libraries are validated at variable-add time (claim library) and by `ClaimSourceLibrary` on association add (claim and source libraries).
- **Claim and source libraries:** `ClaimLibrary` and `SourceLibrary` are global, versioned repositories with freeze semantics. `freeze()` locks the current version and auto-creates a new mutable copy. No deletion.
- **Claim-source associations are global:** `ClaimSourceLibrary` is a standalone class (not argument-scoped). Create-or-delete only — no update path. Validates against `TClaimLookup` and `TSourceLookup` on `add()`. Associations link a claim version to a source version.

## Testing

Tests live in `test/core.test.ts`. Each `describe` block corresponds to a method or logical grouping. All tests build their own fixtures inline — no shared `beforeEach` state. When adding a test for a new feature, add a new `describe` block at the bottom.

## Linting notes

- `*.mjs` files are excluded from type-aware ESLint rules — see `disableTypeChecked` override in `eslint.config.mjs`.
- `.claude/` is excluded from Prettier via `.prettierignore`.
- Run `pnpm eslint . --fix` to auto-fix stylistic issues before checking manually.

## ESM import requirements

All relative imports in `src/cli/` and `src/lib/` must end in `.js`. Directory imports must use the explicit index path (e.g. `schemata/index.js`).

## Naming conventions

Defined in the `brain-style` skill. Enforced by ESLint (`@typescript-eslint/naming-convention` and `check-file/filename-naming-convention`).

## Documentation Sync

- `README.md` [Public-CLI-API] — Concepts, usage examples, and CLI sections
- `docs/api-reference.md` [Public-API] — Full API reference for engines, standalone functions, and types; update when public API changes
- `CLAUDE.md` [Public-API] — Design rules and conventions sections
- `CLI_EXAMPLES.md` [Public-CLI-API] — Walkthrough examples and the complete script
- `scripts/smoke-test.sh` [Public-CLI-API] — Add coverage for new commands, flags, or behaviors
- `src/lib/core/interfaces/argument-engine.interfaces.ts` [Public-Engine-API] — JSDoc for ArgumentEngine interface methods; update when ArgumentEngine public method signatures, parameters, return types, or thrown errors change
- `src/lib/core/interfaces/premise-engine.interfaces.ts` [Public-Engine-API] — JSDoc for PremiseEngine interface methods; update when PremiseEngine public method signatures, parameters, return types, or thrown errors change
- `src/lib/core/interfaces/shared.interfaces.ts` [Public-Engine-API] — JSDoc for shared engine interfaces (TDisplayable, TChecksummable); update when shared method signatures change
- `src/lib/core/interfaces/library.interfaces.ts` [Public-Engine-API] — JSDoc for TClaimLookup, TSourceLookup, TClaimSourceLookup, and library snapshot interfaces; update when library interface signatures change
- `examples/arguments/*.yaml` [Argument-Schema] — Example argument YAML files used by `test/examples.test.ts`; update when core argument schemas (`src/lib/schemata/`) or CLI-extended schemas (`src/cli/schemata.ts`, YAML import shape) change
