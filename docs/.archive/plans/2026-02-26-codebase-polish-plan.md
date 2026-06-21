# Codebase Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive JSDoc, clean up minor inconsistencies, and add package metadata to prepare the codebase for public sharing.

**Architecture:** Documentation-only pass working inside-out from core library classes to types, entry points, package metadata, and light cleanup. No behavior changes, no new files beyond this plan.

**Tech Stack:** TypeScript, Typebox (schema descriptions), JSDoc

**Validation command:** `pnpm run check` (typecheck + lint + test + build) — run after every task to confirm nothing broke.

**Design doc:** `docs/plans/2026-02-26-codebase-polish-design.md`

---

### Task 1: Add JSDoc to ArgumentEngine

**Files:**

- Modify: `src/lib/core/ArgumentEngine.ts`

**Step 1: Add class-level and method-level JSDoc**

Add a `/** ... */` block above the class declaration:

```typescript
/**
 * Manages a propositional logic argument composed of premises, variable
 * assignments, and logical roles (supporting premises and a conclusion).
 *
 * Provides premise CRUD, role management, evaluation of individual
 * assignments, and exhaustive validity checking via truth-table enumeration.
 */
export class ArgumentEngine {
```

Add JSDoc to all public methods. Follow PremiseManager's style: brief description, `@throws` where relevant. Skip simple getters where the name is self-documenting. Here are the methods and their JSDoc:

```typescript
/** Returns a shallow copy of the argument metadata. */
public getArgument(): TCoreArgument {

/**
 * Creates a new premise with an auto-generated UUID and registers it
 * with this engine.
 */
public createPremise(title?: string): PremiseManager {

/**
 * Creates a premise with a caller-supplied ID and registers it with
 * this engine.
 *
 * @throws If a premise with the given ID already exists.
 */
public createPremiseWithId(id: string, title?: string): PremiseManager {

/**
 * Removes a premise and clears any role assignments that reference it.
 * No-op if the premise does not exist.
 */
public removePremise(premiseId: string): void {

/** Returns the premise with the given ID, or `undefined` if not found. */
public getPremise(premiseId: string): PremiseManager | undefined {

/** Returns `true` if a premise with the given ID exists. */
public hasPremise(premiseId: string): boolean {

/** Returns all premise IDs in lexicographic order. */
public listPremiseIds(): string[] {

/** Returns all premises in lexicographic ID order. */
public listPremises(): PremiseManager[] {

/** Returns the current role assignments (conclusion and supporting premise IDs). */
public getRoleState(): TCoreArgumentRoleState {

/**
 * Designates a premise as the argument's conclusion.
 *
 * @throws If the premise does not exist.
 * @throws If the premise is already a supporting premise.
 */
public setConclusionPremise(premiseId: string): void {

/** Clears the conclusion designation. */
public clearConclusionPremise(): void {

/** Returns the conclusion premise, or `undefined` if none is set. */
public getConclusionPremise(): PremiseManager | undefined {

/**
 * Adds a premise to the supporting role.
 *
 * @throws If the premise does not exist.
 * @throws If the premise is the conclusion.
 */
public addSupportingPremise(premiseId: string): void {

/** Removes a premise from the supporting role. No-op if not supporting. */
public removeSupportingPremise(premiseId: string): void {

/** Returns all supporting premises in lexicographic ID order. */
public listSupportingPremises(): PremiseManager[] {

/** Returns a serializable snapshot of the full engine state. */
public toData(): TCoreArgumentEngineData {

/** Alias for {@link toData}. */
public exportState(): TCoreArgumentEngineData {

/**
 * Collects all variables referenced by expressions across all premises,
 * indexed both by variable ID and by symbol.
 */
public collectReferencedVariables(): {

/**
 * Validates that this argument is structurally ready for evaluation:
 * a conclusion must be set, all role references must point to existing
 * premises, variable ID/symbol mappings must be consistent, and every
 * premise must be individually evaluable.
 */
public validateEvaluability(): TCoreValidationResult {

/**
 * Evaluates the argument under a single variable assignment.
 *
 * Determines whether the assignment is admissible (all constraints
 * satisfied), whether all supporting premises hold, whether the
 * conclusion holds, and whether the assignment is a counterexample.
 *
 * Returns `{ ok: false }` with validation details if the argument is
 * not structurally evaluable.
 */
public evaluate(

/**
 * Enumerates all 2^n variable assignments and checks for counterexamples.
 *
 * A counterexample is an admissible assignment where all supporting
 * premises are true but the conclusion is false. The argument is valid
 * if no counterexamples exist.
 *
 * Supports early termination (`firstCounterexample` mode) and
 * configurable limits on variables and assignments checked.
 */
public checkValidity(
```

**Step 2: Run checks**

Run: `pnpm run check`
Expected: All pass (no behavior changes)

**Step 3: Commit**

```bash
git add src/lib/core/ArgumentEngine.ts
git commit -m "Add JSDoc to ArgumentEngine"
```

---

### Task 2: Add JSDoc to ExpressionManager

**Files:**

- Modify: `src/lib/core/ExpressionManager.ts`

**Step 1: Add class-level and method-level JSDoc, remove stray comment**

Add class-level JSDoc:

```typescript
/**
 * Low-level manager for a flat-stored expression tree.
 *
 * Expressions are immutable value objects stored in three maps: the main
 * expression store, a parent-to-children ID index, and a parent-to-positions
 * index. Structural invariants (child limits, root-only operators, position
 * uniqueness) are enforced on every mutation.
 *
 * This class is an internal building block used by {@link PremiseManager}
 * and is not part of the public API.
 */
export class ExpressionManager {
```

Add method JSDoc:

```typescript
/** Returns all expressions as an unordered array. */
public toArray(): TCorePropositionalExpression[] {

/**
 * Adds an expression to the tree.
 *
 * @throws If the expression ID already exists.
 * @throws If the expression references itself as parent.
 * @throws If `implies`/`iff` operators have a non-null parentId (they must be roots).
 * @throws If the parent does not exist or is not an operator/formula.
 * @throws If the parent's child limit would be exceeded.
 * @throws If the position is already occupied under the parent.
 */
public addExpression(expression: TCorePropositionalExpression) {

/**
 * Removes an expression and its entire descendant subtree.
 *
 * After removal, {@link collapseIfNeeded} runs on the parent:
 * - 0 children remaining: the parent operator/formula is deleted (recurses to grandparent).
 * - 1 child remaining: the parent is deleted and the surviving child is promoted into its slot.
 *
 * @returns The removed expression, or `undefined` if not found.
 */
public removeExpression(expressionId: string) {

/** Returns `true` if any expression in the tree references the given variable ID. */
public hasVariableReference(variableId: string): boolean {

/** Returns the expression with the given ID, or `undefined` if not found. */
public getExpression(

/** Returns the children of the given parent, sorted by position. */
public getChildExpressions(

/**
 * Inserts a new expression between existing nodes in the tree.
 *
 * The new expression inherits the tree slot of the anchor node
 * (`leftNodeId ?? rightNodeId`). The anchor and optional second node
 * become children of the new expression at positions 0 and 1.
 *
 * Right node is reparented before left node to handle the case where
 * the right node is a descendant of the left node's subtree.
 *
 * @throws If neither leftNodeId nor rightNodeId is provided.
 * @throws If the expression ID already exists.
 * @throws If leftNodeId and rightNodeId are the same.
 * @throws If either referenced node does not exist.
 * @throws If a unary operator/formula is given two children.
 * @throws If either child is an `implies`/`iff` operator (cannot be subordinated).
 * @throws If an `implies`/`iff` expression would be inserted at a non-root position.
 */
public insertExpression(
```

Remove the stray comment at lines 519-521 (end of file):

```
// ---------------------------------------------------------------------------
// PremiseManager
// ---------------------------------------------------------------------------
```

**Step 2: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 3: Commit**

```bash
git add src/lib/core/ExpressionManager.ts
git commit -m "Add JSDoc to ExpressionManager, remove stray comment"
```

---

### Task 3: Add JSDoc to VariableManager

**Files:**

- Modify: `src/lib/core/VariableManager.ts`

**Step 1: Add class-level and method-level JSDoc**

```typescript
/**
 * Registry for propositional variables within a single premise.
 *
 * Enforces uniqueness of both variable IDs and symbols. This class is an
 * internal building block used by {@link PremiseManager} and is not part
 * of the public API.
 */
export class VariableManager {
```

Method JSDoc:

```typescript
/** Returns all registered variables as an array. */
public toArray(): TCorePropositionalVariable[] {

/**
 * Registers a variable.
 *
 * @throws If the symbol is already in use.
 * @throws If the ID already exists.
 */
public addVariable(variable: TCorePropositionalVariable) {

/**
 * Removes a variable by ID.
 * @returns The removed variable, or `undefined` if not found.
 */
public removeVariable(variableId: string) {

/** Returns `true` if a variable with the given ID is registered. */
public hasVariable(variableId: string): boolean {

/** Returns the variable with the given ID, or `undefined` if not found. */
public getVariable(

/**
 * Changes the symbol of an existing variable.
 *
 * @throws If the variable does not exist.
 * @throws If the new symbol is already in use by a different variable.
 */
public renameVariable(variableId: string, newSymbol: string): void {
```

**Step 2: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 3: Commit**

```bash
git add src/lib/core/VariableManager.ts
git commit -m "Add JSDoc to VariableManager"
```

---

### Task 4: Add JSDoc to evaluation/shared.ts and diff.ts

**Files:**

- Modify: `src/lib/core/evaluation/shared.ts`
- Modify: `src/lib/core/diff.ts`

**Step 1: Add JSDoc to evaluation/shared.ts**

```typescript
/** Creates a validation result, setting `ok` based on whether any error-severity issues exist. */
export function makeValidationResult(

/** Creates a validation issue with `severity: "error"`. */
export function makeErrorIssue(

/** Computes the truth value of material implication: `!antecedent || consequent`. */
export function implicationValue(

/** Builds a directional vacuity diagnostic for one direction of an implication. */
export function buildDirectionalVacuity(
```

**Step 2: Add JSDoc to diff.ts exported functions**

```typescript
/** Compares two argument metadata objects and returns field-level changes for `title` and `description`. */
export function defaultCompareArgument(

/** Compares two variables and returns field-level changes for `symbol`. */
export function defaultCompareVariable(

/** Compares two premises and returns field-level changes for `title` and `rootExpressionId`. */
export function defaultComparePremise(

/** Compares two expressions and returns field-level changes for structural fields (`type`, `parentId`, `position`, `variableId`, `operator`). */
export function defaultCompareExpression(

/**
 * Computes a structural diff between two argument engines.
 *
 * Compares argument metadata, variables, premises (with nested expression
 * diffs), and role assignments. Uses pluggable comparators that default to
 * the `defaultCompare*` functions.
 */
export function diffArguments(
```

**Step 3: Fix `_id` on line 202 of diff.ts**

Change:

```typescript
    for (const [_id, afterPremise] of afterById) {
        if (!beforeById.has(_id)) {
```

To:

```typescript
    for (const [id, afterPremise] of afterById) {
        if (!beforeById.has(id)) {
```

**Step 4: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 5: Commit**

```bash
git add src/lib/core/evaluation/shared.ts src/lib/core/diff.ts
git commit -m "Add JSDoc to evaluation helpers and diff functions, fix unused _id"
```

---

### Task 5: Convert evaluation.ts interface comments to JSDoc

**Files:**

- Modify: `src/lib/types/evaluation.ts`

**Step 1: Convert all `//` inline comments on interface fields to `/** \*/` JSDoc\*\*

Every field comment in this file that currently looks like:

```typescript
// Machine-readable issue code for callers/tests/UI logic.
code: TCoreValidationCode
```

Becomes:

```typescript
/** Machine-readable issue code for callers/tests/UI logic. */
code: TCoreValidationCode
```

Apply this transformation to all interface field comments in the file. The affected interfaces are:

- `TCoreArgumentEngineData` (3 fields)
- `TCoreValidationIssue` (6 fields)
- `TCoreValidationResult` (2 fields)
- `TCoreDirectionalVacuity` (5 fields)
- `TCoreArgumentEvaluationOptions` (4 fields)
- `TCoreArgumentEvaluationResult` (11 fields)
- `TCoreValidityCheckOptions` (5 fields)
- `TCoreCounterexample` (2 fields)
- `TCoreValidityCheckResult` (7 fields)

Also add a top-level JSDoc to the type aliases that lack them:

```typescript
/** Role that a premise plays in an argument. */
export type TCorePremiseRole = "supporting" | "conclusion"

/** Maps variable IDs to boolean truth values. */
export type TCoreVariableAssignment = Record<string, boolean>

/** Severity level for validation issues. */
export type TCoreValidationSeverity = "error" | "warning"

/** Machine-readable codes for all validation issues. */
export type TCoreValidationCode =
```

**Step 2: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 3: Commit**

```bash
git add src/lib/types/evaluation.ts
git commit -m "Convert evaluation type comments to JSDoc"
```

---

### Task 6: Add Typebox descriptions to schemata

**Files:**

- Modify: `src/lib/schemata/argument.ts`
- Modify: `src/lib/schemata/propositional.ts`

**Step 1: Add descriptions to argument.ts**

Add a `description` to `CoreArgumentRoleStateSchema`:

```typescript
export const CoreArgumentRoleStateSchema = Type.Object(
    {
        conclusionPremiseId: Type.Optional(UUID),
        supportingPremiseIds: Type.Array(UUID),
    },
    {
        description:
            "Tracks which premises serve as the conclusion and which are supporting.",
    }
)
```

**Step 2: Add descriptions to propositional.ts**

Add a schema-level `description` to `CorePropositionalVariableSchema`:

```typescript
export const CorePropositionalVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String({
            description:
                'Human-readable symbol for this variable (e.g. "P", "Q").',
        }),
    },
    {
        description:
            "A named propositional variable belonging to a specific argument version.",
    }
)
```

Convert `//` comments on `CorePremiseMetaSchema` and `CorePremiseDataSchema` to `description` fields:

```typescript
export const CorePremiseMetaSchema = Type.Object(
    {
        id: UUID,
        title: Type.Optional(
            Type.String({
                description:
                    "An optional title for this premise, for display purposes.",
            })
        ),
    },
    {
        description: "Identity and display metadata for a premise.",
    }
)
```

```typescript
export const CorePremiseDataSchema = Type.Object(
    {
        rootExpressionId: Type.Optional(UUID, {
            description:
                "ID of the root expression, if the premise has expressions.",
        }),
        variables: Type.Array(UUID, {
            description: "IDs of all variables referenced in this premise.",
        }),
        expressions: Type.Array(CorePropositionalExpressionSchema, {
            description:
                "All expressions in this premise. The root has a null parentId.",
        }),
    },
    {
        description: "Expression tree and variable references for a premise.",
    }
)
```

**Step 3: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 4: Commit**

```bash
git add src/lib/schemata/argument.ts src/lib/schemata/propositional.ts
git commit -m "Add Typebox descriptions to argument and propositional schemata"
```

---

### Task 7: Add JSDoc to entry points

**Files:**

- Modify: `src/index.ts`
- Modify: `src/lib/index.ts`

**Step 1: Add top-of-file JSDoc to src/index.ts**

```typescript
/**
 * @module @polintpro/proposit-core
 *
 * Core engine for building, evaluating, and diffing propositional logic
 * arguments. Exports {@link ArgumentEngine} and {@link PremiseManager} as
 * the primary API, along with all type schemata and the {@link diffArguments}
 * utility.
 */
export { ArgumentEngine, PremiseManager } from "./lib/index"
```

**Step 2: Add top-of-file JSDoc to src/lib/index.ts**

```typescript
/**
 * Library barrel export. Re-exports core classes, evaluation types, diff
 * types, and the diff function.
 */
export { ArgumentEngine } from "./core/ArgumentEngine.js"
```

**Step 3: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 4: Commit**

```bash
git add src/index.ts src/lib/index.ts
git commit -m "Add JSDoc to package entry points"
```

---

### Task 8: Package metadata and utility JSDoc

**Files:**

- Modify: `package.json`
- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils/collections.ts`

**Step 1: Add keywords and homepage to package.json**

Add after the `"license"` field:

```json
"keywords": [
    "propositional-logic",
    "logic-engine",
    "argument",
    "validation",
    "formal-logic"
],
"homepage": "https://github.com/polintpro/proposit-core",
```

**Step 2: Add JSDoc to DefaultMap in utils.ts**

Replace the constructor body comment with a class-level JSDoc and add method JSDoc:

```typescript
/**
 * A `Map` subclass that auto-creates values for missing keys using a
 * factory function. Optionally enforces an LRU-style size limit by
 * evicting the oldest entry when the limit is reached.
 */
export class DefaultMap<K, V> extends Map<K, V> {
    private mkDefault: DefaultValueFactory<K, V>
    private limit: number

    constructor(
        mkDefault: DefaultValueFactory<K, V>,
        entries?: Iterable<[K, V]>,
        limit = -1
    ) {
        super(entries)
        this.mkDefault = mkDefault
        this.limit = limit
    }

    /** Returns the value for `key`, creating it via the factory if absent. */
    public get(key: K): V {

    /** Sets `key` to `value`, evicting the oldest entry if the size limit is reached. */
    public set(key: K, value: V) {
```

Remove the old `/**` comment block that was inside the constructor body.

**Step 3: Add JSDoc to collections.ts**

```typescript
/**
 * Returns the value for `key` from `map`, creating and inserting it via
 * `makeDefault` if absent.
 */
export function getOrCreate<K, V>(

/** Returns a shallow-copied array of items sorted by `id` in lexicographic order. */
export function sortedCopyById<T extends { id: string }>(items: T[]): T[] {

/** Deduplicates and sorts an iterable of strings. */
export function sortedUnique(values: Iterable<string>): string[] {
```

**Step 4: Run checks**

Run: `pnpm run check`
Expected: All pass

**Step 5: Commit**

```bash
git add package.json src/lib/utils.ts src/lib/utils/collections.ts
git commit -m "Add package metadata and JSDoc to utility modules"
```

---

### Task 9: Final verification

**Step 1: Run full check suite**

Run: `pnpm run check`
Expected: All pass (typecheck, lint, test, build)

**Step 2: Review git log**

Run: `git log --oneline -10`
Expected: 8 clean commits covering all tasks above.
