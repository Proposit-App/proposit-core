# proposit-core — Claude Code Guide

## Generic instructions

- Git commit messages should not include any co-authoring content
- When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.
- After completing a major set of changes, offer to cut a new version via `pnpm version patch|minor|major`. Use `patch` for most changes, `minor` for major feature work, and `major` only when explicitly instructed. When versioning, rename `docs/release-notes/upcoming.md` to `docs/release-notes/v{version}.md` and `docs/changelogs/upcoming.md` to `docs/changelogs/v{version}.md`, then start fresh `upcoming.md` files for subsequent work.

## Change requests

Detailed change requests live in `docs/change-requests/` as markdown files. When the user mentions a change request, list the files in that folder and check if any filename pertains to the request. If a match looks likely, ask the user to confirm before reading the file. Once confirmed, read the file and use it as the specification for the work. After a change request is fully implemented, delete its markdown file from `docs/change-requests/`.

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
- **Operator nesting restriction:** Non-`not` operator expressions (`and`, `or`, `implies`, `iff`) cannot be direct children of any operator expression. A `formula` node must sit between them. `not` is exempt as a child. Controlled by `grammarConfig.enforceFormulaBetweenOperators` (default: `true`). When `autoNormalize` is `true`, `addExpression` auto-inserts formula buffers. `fromSnapshot` and `fromData` accept a `grammarConfig` parameter for load-time enforcement control.
- **Operator collapse:** When `removeExpression` leaves an operator/formula with 0 children, it's deleted (recurses to grandparent). With 1 child, the child is promoted into the operator's slot.
- **`insertExpression` mutation order:** `reparent(rightNodeId)` runs before `reparent(leftNodeId)` to handle the case where right is a descendant of left's subtree.
- **Premise types are derived:** `isInference()` = root is `implies`/`iff`. `isConstraint()` = anything else or empty. Not stored — derived from expression tree.
- **Derived supporting premises:** Any inference premise not designated as conclusion is automatically supporting. `TCoreArgumentRoleState` only stores `{ conclusionPremiseId? }`.
- **Auto-conclusion assignment:** First premise added to an engine is auto-designated as conclusion if none is set.
- **Variable cascade:** `removeVariable()` cascades across all premises, deleting referencing expressions with operator collapse.
- **Kleene three-valued evaluation:** `true`, `false`, `null`/unknown. All summary flags (`isAdmissibleAssignment`, `isCounterexample`, `preservesTruthUnderAssignment`) are three-valued.
- **`updateExpression` restricted swaps:** Only `and↔or` and `implies↔iff`. `not` cannot be changed (delete and re-create).
- **Publish semantics:** Publishing marks the current version as published and copies it to a new unpublished version. All mutating CLI commands reject published versions.
- **Variables require either claim or premise references:** Every variable must reference either a claim (via `claimId`/`claimVersion`) or a premise (via `boundPremiseId`/`boundArgumentId`/`boundArgumentVersion`), but not both. Claim-bound variables represent atomic propositions; premise-bound variables represent the proposition expressed by the bound premise's expression tree. Internal bindings (`boundArgumentId` matches the engine's argument) are resolved lazily during evaluation. External bindings (different `boundArgumentId`) are evaluator-assigned like claims — use `bindVariableToExternalPremise` or `bindVariableToArgument`. `createPremise` auto-creates a premise-bound variable for each new premise.
- **Libraries are required by ArgumentEngine:** Constructor is `(argument, claimLibrary, sourceLibrary, claimSourceLibrary, options?)`. Libraries are validated at variable-add time (claim library) and by `ClaimSourceLibrary` on association add (claim and source libraries). `PropositCore` handles the wiring automatically — prefer using `PropositCore` over constructing engines directly.
- **Claim and source libraries:** `ClaimLibrary` and `SourceLibrary` are global, versioned repositories with freeze semantics. `freeze()` locks the current version and auto-creates a new mutable copy. No deletion.
- **Claim-source associations are global:** `ClaimSourceLibrary` is a standalone class (not argument-scoped). Create-or-delete only — no update path. Validates against `TClaimLookup` and `TSourceLookup` on `add()`. Associations link a claim version to a source version.
- **Argument forking:** Forking goes through `PropositCore.forkArgument()`, which creates an independent copy of the argument with new UUIDs, clones all referenced claims and sources (including their associations), creates fork records in all six `ForkLibrary` namespaces, and registers the new engine in `ArgumentLibrary`. `canFork()` is a public overridable method on `ArgumentEngine` that subclasses use to inject validation policy (e.g., only fork published arguments). Returns `{ engine, remapTable, claimRemap, sourceRemap, argumentFork }`. For low-level forking without orchestration, use the standalone `forkArgumentEngine()` function. Fork-aware diffing is automatic via `PropositCore.diffArguments()`, which uses `ForkLibrary` records as matchers.
- **`generateId` injection:** All entity ID generation in library files uses `generateId` from `TLogicEngineOptions` (or `TPropositCoreConfig` / `TParserBuildOptions`). Default is `globalThis.crypto.randomUUID()`. CLI files use `randomUUID` from `node:crypto` directly. Never add `import { randomUUID } from "node:crypto"` to `src/lib/` files.
- **No application metadata:** The core library does not deal in metadata such as user IDs, timestamps, or display text. These are application-level concerns. The CLI adds some metadata for its own purposes, but the core schemas are intentionally minimal. Applications extend core types via generic parameters.
- **PropositCore orchestrator:** `PropositCore` is the recommended entry point. It holds all libraries (`ArgumentLibrary`, `ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary`, `ForkLibrary`) and provides cross-library operations (`forkArgument`, `diffArguments`). Designed for subclassing — all internal state is `protected`.
- **ArgumentLibrary:** Engine registry with lifecycle management. Creating engines goes through the library via `create()`. `register()` is for internal use (e.g., forking inserts a pre-built engine).
- **ForkLibrary / ForkNamespace:** Fork provenance lives in `ForkLibrary` (6 namespaces: arguments, premises, expressions, variables, claims, sources), not on entity schemas. Fork records are immutable after creation, no checksums. `ForkNamespace` is a standalone reusable class keyed by `entityId`.
- **Hierarchical checksums:** Every hierarchical entity (expression, premise, argument) carries three checksum fields: `checksum` (meta — entity data only, driven by `checksumConfig`), `descendantChecksum` (from children's `combinedChecksum` values, `null` for leaves), and `combinedChecksum` (equals `checksum` when `descendantChecksum` is null, otherwise `computeHash(checksum + descendantChecksum)`). Dirty flags propagate bottom-up on mutation; recomputation is lazy via `flushChecksums()`. Variables are non-hierarchical (single `checksum`). Role state is folded into the argument's meta checksum. Per-collection checksums are exposed via `getCollectionChecksum()`. `fromSnapshot`/`fromData` accept `checksumVerification?: "ignore" | "strict"`.
- **`orderChangeset` FK-safe ordering:** The `orderChangeset` function in `src/lib/utils/changeset.ts` returns persistence operations in a specific order that satisfies FK constraints: premise updates → expression deletes (reverse-topologically sorted) → variable deletes → premise deletes → premise inserts → variable inserts → expression inserts (topologically sorted) → variable updates → expression updates → argument updates → role updates. This ordering is an invariant. Any future work that changes entity relationships, adds new entity types, or modifies FK dependencies must preserve or extend this ordering. Flag any planned change that would violate this guarantee.

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
- `README.md` "Invalid Constructions" section [Validation-Rules] — Update when adding, removing, or changing validation rules, thrown errors, error codes, operator constraints, cascade behaviors, or grammar config options
- `docs/api-reference.md` [Public-API] — Full API reference for engines, standalone functions, and types; update when public API changes
- `CLAUDE.md` [Public-API] — Design rules and conventions sections
- `CLI_EXAMPLES.md` [Public-CLI-API] — Walkthrough examples and the complete script
- `scripts/smoke-test.sh` [Public-CLI-API] — Add coverage for new commands, flags, or behaviors
- `src/lib/core/interfaces/argument-engine.interfaces.ts` [Public-Engine-API] — JSDoc for ArgumentEngine interface methods; update when ArgumentEngine public method signatures, parameters, return types, or thrown errors change
- `src/lib/core/interfaces/premise-engine.interfaces.ts` [Public-Engine-API] — JSDoc for PremiseEngine interface methods; update when PremiseEngine public method signatures, parameters, return types, or thrown errors change
- `src/lib/core/interfaces/shared.interfaces.ts` [Public-Engine-API] — JSDoc for shared engine interfaces (TDisplayable, THierarchicalChecksummable); update when shared method signatures change
- `src/lib/core/interfaces/library.interfaces.ts` [Public-Engine-API] — JSDoc for TClaimLookup, TSourceLookup, TClaimSourceLookup, and library snapshot interfaces (including `TArgumentLibrarySnapshot`, `TForkLibrarySnapshot`, `TPropositCoreSnapshot`); update when library interface signatures change
- `src/lib/core/proposit-core.ts` [Public-API] — JSDoc for PropositCore; update when PropositCore public methods change
- `src/lib/core/argument-library.ts` [Public-API] — JSDoc for ArgumentLibrary; update when ArgumentLibrary public methods change
- `src/lib/core/fork-library.ts` [Public-API] — JSDoc for ForkLibrary; update when ForkLibrary public methods change
- `src/lib/core/fork-namespace.ts` [Public-API] — JSDoc for ForkNamespace; update when ForkNamespace public methods change
- `examples/arguments/*.yaml` [Argument-Schema] — Example argument YAML files used by `test/examples.test.ts`; update when core argument schemas (`src/lib/schemata/`) or CLI-extended schemas (`src/cli/schemata.ts`, YAML import shape) change
- `docs/release-notes/upcoming.md` [Public-API] — User-facing release notes; plain language, no jargon
- `docs/changelogs/upcoming.md` [Any-Code-Change] — Developer changelog with commit hash ranges
