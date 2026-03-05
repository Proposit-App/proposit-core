# Integration Skill Design

## Goal

Create a self-contained Claude Skill that ships with the `@polintpro/proposit-core` package, helping both the solo developer and external consumers integrate with the library effectively.

## Location

`skills/proposit-core/` at repo root. Added to the `files` array in `package.json` so it ships with the npm package.

## File Structure

```
skills/proposit-core/
  SKILL.md              # Frontmatter + overview + routing table
  docs/
    api-usage.md        # ArgumentEngine, PremiseManager, variables, expressions, evaluation
    architecture.md     # Class hierarchy, expression tree, positions, collapse, changesets, checksums
    types-schemas.md    # All exported types organized by domain
    testing.md          # Test structure, fixtures, adding new tests
    cli.md              # CLI routing, state storage, hydration, commands
```

## SKILL.md

### Frontmatter

```yaml
---
name: proposit-core
description: Use when working with the proposit-core library — building propositional logic arguments, managing premises/variables/expressions, evaluating with Kleene three-valued logic, or using the proposit-core CLI.
---
```

### Content

- Overview: one-paragraph description of the library
- "When to Use" bullet list: triggering conditions
- "Key Patterns" quick reference: mutation results, intent-based insertion, derived supporting premises, lazy checksums, ESM extensions
- Routing table: one entry per doc file with description and when to load it

### Routing Table

Modeled after the typebox skill. Each entry describes the doc and what tasks it covers:

- **API Usage** — `docs/api-usage.md` — Creating arguments, managing premises/variables/expressions, evaluation, validity checking, diffing, relationship analysis.
- **Architecture & Design** — `docs/architecture.md` — Class hierarchy, expression tree internals, midpoint positions, operator collapse, mutation changesets, checksums.
- **Types & Schemas** — `docs/types-schemas.md` — All exported types: expression unions, evaluation types, mutation result types, diff types, relationship types, checksum config.
- **Testing** — `docs/testing.md` — Test file structure, describe block conventions, fixture patterns, how to add new tests.
- **CLI** — `docs/cli.md` — CLI routing, state storage layout, engine hydration, version resolution, command reference.

## docs/api-usage.md

Covers the public API surface with brief code examples:

1. Creating an argument — `new ArgumentEngine(...)`, constructor options
2. Variable management — `addVariable()`, `updateVariable()`, `removeVariable()` with cascade
3. Premise CRUD — `createPremise()`, `createPremiseWithId()`, auto-conclusion, `removePremise()`
4. Expression tree — `appendExpression`, `addExpressionRelative`, `addExpression`, `insertExpression`, `updateExpression`, `removeExpression(id, deleteSubtree)`, collapse rules
5. Roles — `setConclusionPremise()`, `clearConclusionPremise()`, `listSupportingPremises()`
6. Evaluation — `PremiseManager.evaluate()`, `ArgumentEngine.evaluate()`, `checkValidity()`
7. Diffing — `diffArguments(engineA, engineB, options?)`
8. Relationship analysis — `analyzePremiseRelationships()`, `buildPremiseProfile()`
9. Formula parsing — `parseFormula()`
10. Mutation result pattern — `{ result, changes }` destructuring, changeset structure

## docs/architecture.md

Covers internals and design decisions:

1. Class hierarchy — ArgumentEngine → VariableManager (shared) + PremiseManager[] → ExpressionManager
2. Expression tree representation — three internal maps, null key for roots, immutable value objects
3. Midpoint-based positions — constants, midpoint function, ~52 bisections precision, scenario table
4. Root-only operators — `implies`/`iff` must have `parentId: null`
5. Formula nodes — transparent unary wrapper, one child, same collapse rules
6. Operator collapse — 0 children → delete + recurse, 1 child → delete + promote
7. insertExpression mutation order — right node reparented before left
8. Premise types — `isInference()` vs `isConstraint()`, derived dynamically
9. Derived supporting premises — any inference premise not the conclusion
10. Mutation changesets — ChangeCollector internals, raw → final conversion
11. Checksum system — lazy, dirty flags, configurable fields
12. ESM import requirements — `.js` extensions, utils directory disambiguation

## docs/types-schemas.md

All exported types with shapes and usage context:

1. Expression types — `TPropositionalExpression<T>` union, `TExpressionInput`, `TExpressionWithoutPosition`, `TExpressionUpdate`
2. Variable type — `TPropositionalVariable`, `TVariableInput`
3. Premise type — `TPremise`, `TCorePremise`
4. Argument types — `TArgument`, `TArgumentMeta`, `TArgumentVersionMeta`, `TCoreArgumentRoleState`
5. Logical operators — `TLogicalOperatorType` values, root-only constraints
6. Evaluation types — `TTrivalentValue`, `TVariableAssignment`, `TExpressionAssignment`, `TPremiseEvaluationResult`, `TArgumentEvaluationResult`, `TValidityCheckResult`, `TValidationResult`, `TValidationIssue`, `TValidationCode`
7. Mutation types — `TCoreMutationResult<T>`, `TCoreChangeset`, `TCoreEntityChanges<T>`, `TCoreRawChangeset`
8. Diff types — `TCoreFieldChange`, `TCoreEntityFieldDiff<T>`, `TCoreEntitySetDiff<T>`, `TCorePremiseDiff`, `TCoreArgumentDiff`, `TCoreDiffOptions`
9. Relationship types — `TCoreVariableAppearance`, `TCorePremiseProfile`, `TCorePremiseRelationshipType`, `TCorePremiseRelationResult`, `TCorePremiseRelationshipAnalysis`
10. Checksum types — `TCoreChecksumConfig`, `DEFAULT_CHECKSUM_CONFIG`, `createChecksumConfig()`
11. Schema system — Typebox-based, `Value.Parse()` for validation, `Type.Static<>` for inference

## docs/testing.md

1. Test file — `test/ExpressionManager.test.ts`, Vitest
2. Structure — each describe block = one method or grouping, new features at bottom
3. Fixture convention — no shared beforeEach, inline fixtures per test
4. Common fixture pattern — code snippet showing typical setup
5. Adding a new test — new describe block at bottom, don't modify existing blocks
6. Existing describe blocks — full ordered list
7. Running tests — `pnpm run test`, `pnpm run check`
8. Key patterns — destructure mutation results, assert on both result and changeset

## docs/cli.md

1. Running the CLI — `pnpm cli -- --help` (dev), `proposit-core` (installed)
2. Routing — argv[2] as named command or argument ID, argv[3] as version selector
3. Version selectors — `latest`, `last-published`, integer
4. State storage layout — full directory tree with file descriptions
5. Engine hydration — `hydrateEngine()` steps (parallel reads, BFS expression load, conclusion last)
6. Publish semantics — mark published, copy to next version, assertNotPublished
7. Command reference — top-level and versioned subcommands
8. Storage utilities — key functions in `src/cli/storage/`
9. Output helpers — `printJson`, `printLine`, `errorExit`, `requireConfirmation`

## package.json Change

Add `"skills"` to the `files` array:

```json
"files": [
    "dist",
    "skills"
]
```
