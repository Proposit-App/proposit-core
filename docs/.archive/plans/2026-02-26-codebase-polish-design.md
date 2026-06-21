# Codebase Polish Design

**Date:** 2026-02-26
**Scope:** Full polish — documentation, metadata, light cleanup
**Audience:** Both library consumers and open-source contributors
**Priority:** Library API (`src/lib/`) over CLI (`src/cli/`)

## Approach

Inside-out: start from core library classes and work outward to types, entry points, package metadata, and cleanup.

## Documentation Convention

- **Typebox schemas** use `description` fields (runtime-inspectable by tooling).
- **Plain TypeScript types/interfaces** use `/** JSDoc */` comments (IDE hover tooltips).
- **Class-level JSDoc** on all exported classes.
- **Method-level JSDoc** on public methods following PremiseManager's existing style: brief description, `@throws` annotations, `@param`/`@returns` where non-obvious. Simple getters (e.g., `getId()`) do not need JSDoc.

## Changes

### 1. Core Library JSDoc

**ArgumentEngine.ts** — Add class-level JSDoc and method JSDoc to all public methods (~20 methods). Match PremiseManager's style.

**ExpressionManager.ts** — Add class-level JSDoc (noting it is an internal building block). Add JSDoc to key public methods: `addExpression`, `removeExpression`, `insertExpression`, `getChildExpressions`, `hasVariableReference`, `getExpression`, `toArray`. Private methods already have good inline comments.

**VariableManager.ts** — Add class-level JSDoc. Brief one-liner JSDoc on public methods.

**evaluation/shared.ts** — Add JSDoc to all 4 exported functions: `makeValidationResult`, `makeErrorIssue`, `implicationValue`, `buildDirectionalVacuity`.

**diff.ts** — Add JSDoc to all 5 exported functions: `diffArguments`, `defaultCompareArgument`, `defaultCompareVariable`, `defaultComparePremise`, `defaultCompareExpression`.

### 2. Types & Schemata

**evaluation.ts** — Convert `//` inline comments on interface fields to `/** JSDoc */` format. No content changes.

**schemata/argument.ts** — Add Typebox `description` to `CoreArgumentRoleStateSchema` and its fields.

**schemata/propositional.ts** — Add Typebox `description` to `CorePropositionalVariableSchema`. Convert `//` comments on `CorePremiseMetaSchema` and `CorePremiseDataSchema` fields to Typebox `description` fields.

**schemata/analysis.ts** — Already well-documented; no changes.

**schemata/shared.ts** — No changes (too small to warrant it).

### 3. Entry Points

**src/index.ts** — Add top-of-file JSDoc block describing the package and its main exports.

**src/lib/index.ts** — Add top-of-file JSDoc block describing the internal library barrel export.

### 4. Package Metadata & Utilities

**package.json** — Add `keywords` and `homepage` fields.

**utils.ts (DefaultMap)** — Move constructor body comment to class-level JSDoc. Add JSDoc to `get` and `set` overrides.

**utils/collections.ts** — Add JSDoc to `getOrCreate`, `sortedCopyById`, `sortedUnique`.

### 5. Light Cleanup

- **ExpressionManager.ts:519-521** — Remove stray `// PremiseManager` section comment at end of file.
- **diff.ts:202** — Change `_id` to `id` (variable is used on next line, not intentionally unused).

## Out of Scope

- No structural refactoring or file renames
- No CLI documentation changes
- No new files created
- No test changes
- No code behavior changes
