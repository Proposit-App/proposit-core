# proposit-core

Core engine for building, evaluating, and checking the logical validity of propositional-logic arguments. Manages typed trees of variables and expressions across one or more **premises**, with strict structural invariants, automatic operator collapse, a display renderer, and a truth-table validity checker.

## Installation

This package is hosted on GitHub Packages. Add the following to your project's `.npmrc` (replace `polintpro` with your GitHub org):

```
@polintpro:registry=https://npm.pkg.github.com
```

Then install:

```bash
pnpm add @polintpro/proposit-core
# or
npm install @polintpro/proposit-core
```

## Concepts

### Argument

An `ArgumentEngine` is scoped to a single **argument** — a record with an `id`, `version`, `title`, and `description`. Every variable and expression carries a matching `argumentId` and `argumentVersion`; the engine rejects entities that belong to a different argument.

### Premises

An argument is composed of one or more **premises**, each managed by a `PremiseManager`. Premises come in two types derived from their root expression:

- **Inference premise** (`"inference"`) — root is `implies` or `iff`. Used as a supporting premise or the conclusion of the argument.
- **Constraint premise** (`"constraint"`) — root is anything else. Restricts which variable assignments are considered admissible without contributing to the inference chain.

### Variables

A **propositional variable** (e.g. `P`, `Q`, `Rain`) is a named atomic proposition. Variables are registered with a `PremiseManager` before they can be referenced by expressions in that premise. Each variable must have a unique `id` and a unique `symbol` within the premise.

### Expressions

An **expression** is a node in the rooted expression tree managed by a `PremiseManager`. There are three kinds:

- **Variable expression** (`"variable"`) — a leaf node that references a registered variable.
- **Operator expression** (`"operator"`) — an interior node that applies a logical operator to its children.
- **Formula expression** (`"formula"`) — a transparent unary wrapper, equivalent to parentheses around its single child.

The five supported operators and their arities are:

| Operator  | Symbol | Arity          |
| --------- | ------ | -------------- |
| `not`     | ¬      | unary (= 1)    |
| `and`     | ∧      | variadic (≥ 2) |
| `or`      | ∨      | variadic (≥ 2) |
| `implies` | →      | binary (= 2)   |
| `iff`     | ↔      | binary (= 2)   |

`implies` and `iff` are **root-only**: they must have `parentId: null` and cannot be nested inside another expression.

### Argument roles

To evaluate or check an argument, premises must be assigned roles:

- **Conclusion** — the single premise whose truth is being argued for. Set with `ArgumentEngine.setConclusionPremise()`.
- **Supporting** — premises whose combined truth is supposed to entail the conclusion. Added with `ArgumentEngine.addSupportingPremise()`.

A premise that is neither supporting nor the conclusion and whose type is `"constraint"` is automatically used to filter admissible variable assignments during validity checking.

Each expression carries:

| Field             | Type             | Description                                          |
| ----------------- | ---------------- | ---------------------------------------------------- |
| `id`              | `string`         | Unique identifier.                                   |
| `argumentId`      | `string`         | Must match the engine's argument.                    |
| `argumentVersion` | `number`         | Must match the engine's argument version.            |
| `parentId`        | `string \| null` | ID of the parent operator, or `null` for root nodes. |
| `position`        | `number \| null` | Ordered index among siblings under the same parent.  |

## Usage

### Creating an engine and premises

```typescript
import { ArgumentEngine } from "@polintpro/proposit-core"
import type {
    TArgument,
    TPropositionalVariable,
    TPropositionalExpression,
} from "@polintpro/proposit-core"

const argument: TArgument = {
    id: "arg-1",
    version: 1,
    title: "Modus Ponens",
    description: "",
}

const eng = new ArgumentEngine(argument)

const premise1 = eng.createPremise("P implies Q")
const premise2 = eng.createPremise("P")
const conclusion = eng.createPremise("Q")
```

### Adding variables and expressions

```typescript
const varP: TPropositionalVariable = {
    id: "var-p",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "P",
}
const varQ: TPropositionalVariable = {
    id: "var-q",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "Q",
}

// Premise 1: P → Q
premise1.addVariable(varP)
premise1.addVariable(varQ)
premise1.addExpression({
    id: "op-implies",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "operator",
    operator: "implies",
    parentId: null,
    position: null,
})
premise1.addExpression({
    id: "expr-p1",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-p",
    parentId: "op-implies",
    position: 0,
})
premise1.addExpression({
    id: "expr-q",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-q",
    parentId: "op-implies",
    position: 1,
})

console.log(premise1.toDisplayString()) // (P → Q)

// Premise 2: P
premise2.addVariable(varP)
premise2.addExpression({
    id: "expr-p2",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-p",
    parentId: null,
    position: null,
})

// Conclusion: Q
conclusion.addVariable(varQ)
conclusion.addExpression({
    id: "expr-q2",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-q",
    parentId: null,
    position: null,
})
```

### Setting roles

```typescript
eng.addSupportingPremise(premise1.getId())
eng.addSupportingPremise(premise2.getId())
eng.setConclusionPremise(conclusion.getId())
```

### Evaluating an argument

```typescript
const result = eng.evaluate({ "var-p": true, "var-q": true })
if (result.ok) {
    console.log(result.conclusionTrue) // true
    console.log(result.allSupportingPremisesTrue) // true
    console.log(result.isCounterexample) // false
}
```

### Checking validity

```typescript
const validity = eng.checkValidity()
if (validity.ok) {
    console.log(validity.isValid) // true (Modus Ponens is valid)
    console.log(validity.counterexamples) // []
}
```

### Inserting an expression into the tree

`insertExpression` splices a new node between existing nodes. The new expression inherits the **anchor** node's current slot in the tree (`leftNodeId ?? rightNodeId`).

```typescript
// Extend  P → Q  into  (P ∧ R) → Q  by inserting an `and` above expr-p1.
const varR: TPropositionalVariable = {
    id: "var-r",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "R",
}
premise1.addVariable(varR)
premise1.addExpression({
    id: "expr-r",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-r",
    parentId: null,
    position: null,
})
premise1.insertExpression(
    {
        id: "op-and",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "operator",
        operator: "and",
        parentId: null, // overwritten by insertExpression
        position: null,
    },
    "expr-p1", // becomes child at position 0
    "expr-r" // becomes child at position 1
)

console.log(premise1.toDisplayString()) // ((P ∧ R) → Q)
```

### Removing expressions

Removing an expression also removes its entire descendant subtree. After the subtree is gone, ancestor operators left with fewer than two children are automatically collapsed:

- **0 children remaining** — the operator is deleted; the check recurses upward.
- **1 child remaining** — the operator is deleted and that child is promoted into the operator's former slot.

```typescript
// Remove expr-r from the and-cluster.
// op-and now has only expr-p1 → op-and is deleted, expr-p1 is promoted back
// to position 0 under op-implies.
premise1.removeExpression("expr-r")

console.log(premise1.toDisplayString()) // (P → Q)
```

## API Reference

### `ArgumentEngine`

#### `new ArgumentEngine(argument)`

Creates an engine scoped to `argument` (`{ id, version, title, description }`).

---

#### `createPremise(title?)` → `PremiseManager`

Creates a new `PremiseManager`, registers it with the engine, and returns it.

---

#### `removePremise(premiseId)`

Removes a premise and clears its role assignments.

---

#### `getPremise(premiseId)` → `PremiseManager | undefined`

Returns the `PremiseManager` for the given ID, or `undefined`.

---

#### `hasPremise(premiseId)` → `boolean`

Returns `true` if a premise with the given ID exists.

---

#### `listPremises()` → `PremiseManager[]`

Returns all premises sorted by ID.

---

#### `listPremiseIds()` → `string[]`

Returns all premise IDs sorted alphabetically.

---

#### `setConclusionPremise(premiseId)`

Designates a premise as the conclusion. Throws if the premise does not exist or is already a supporting premise.

---

#### `clearConclusionPremise()`

Removes the conclusion role assignment.

---

#### `getConclusionPremise()` → `PremiseManager | undefined`

Returns the conclusion `PremiseManager`, if one has been set.

---

#### `addSupportingPremise(premiseId)`

Adds a premise to the set of supporting premises. Throws if it is already the conclusion.

---

#### `removeSupportingPremise(premiseId)`

Removes a premise from the supporting set.

---

#### `listSupportingPremises()` → `PremiseManager[]`

Returns all supporting premises sorted by ID.

---

#### `getRoleState()` → `TArgumentRoleState`

Returns `{ supportingPremiseIds, conclusionPremiseId }`.

---

#### `collectReferencedVariables()`

Returns a cross-premise summary of every variable referenced by expressions, keyed by `id` and `symbol`.

---

#### `validateEvaluability()` → `TValidationResult`

Checks whether the argument is structurally ready to evaluate. Returns `{ ok, issues }`.

---

#### `evaluate(assignment, options?)` → `TArgumentEvaluationResult`

Evaluates all relevant premises under the given variable assignment (`Record<string, boolean>`). Returns per-premise truth values, counterexample status, and an admissibility flag.

Options:

- `validateFirst` (default `true`) — run validation before evaluating.
- `includeExpressionValues` (default `true`) — include per-expression truth maps.
- `includeDiagnostics` (default `true`) — include inference diagnostics.
- `strictUnknownAssignmentKeys` (default `false`) — reject assignment keys not referenced by evaluated premises.

---

#### `checkValidity(options?)` → `TValidityCheckResult`

Runs a truth-table search over all 2ⁿ assignments (n = distinct referenced variable count). Returns `isValid` (`true`, `false`, or `undefined` if truncated), counterexamples, and statistics.

Options:

- `mode` (`"firstCounterexample"` | `"exhaustive"`, default `"firstCounterexample"`) — stop at first counterexample or continue exhaustively.
- `maxVariables` — safety limit on the number of variables.
- `maxAssignmentsChecked` — safety limit on the number of assignments evaluated.
- `includeCounterexampleEvaluations` (default `false`) — attach full evaluation payloads to counterexamples.
- `validateFirst` (default `true`) — run validation before the search.

---

#### `toData()` / `exportState()` → `TArgumentEngineData`

Returns a serialisable snapshot of the engine state (`{ argument, premises, roles }`).

---

### `PremiseManager`

#### `addVariable(variable)`

Registers a variable for use in this premise. Throws if the `id` or `symbol` is already in use, or if the variable does not belong to this argument.

---

#### `removeVariable(variableId)` → `TPropositionalVariable | undefined`

Removes and returns a variable. Throws if any expression still references it.

---

#### `addExpression(expression)`

Adds an expression to the tree. Validates argument membership, variable references, root uniqueness, and structural constraints (operator type, child limits, position uniqueness).

---

#### `removeExpression(expressionId)` → `TPropositionalExpression | undefined`

Removes an expression and its subtree, then collapses degenerate ancestor operators. Returns the removed root expression, or `undefined` if not found.

---

#### `insertExpression(expression, leftNodeId?, rightNodeId?)`

Splices `expression` into the tree. At least one of `leftNodeId` / `rightNodeId` must be provided. `leftNodeId` becomes position 0 and `rightNodeId` position 1 under the new expression.

---

#### `getExpression(id)` → `TPropositionalExpression | undefined`

Returns an expression by ID.

---

#### `getExpressions()` → `TPropositionalExpression[]`

Returns all expressions sorted by ID.

---

#### `getVariables()` → `TPropositionalVariable[]`

Returns all registered variables sorted by ID.

---

#### `getChildExpressions(parentId)` → `TPropositionalExpression[]`

Returns children of `parentId` sorted by position.

---

#### `getRootExpression()` → `TPropositionalExpression | undefined`

Returns the root expression, if one exists.

---

#### `getRootExpressionId()` → `string | undefined`

Returns the root expression ID.

---

#### `getPremiseType()` → `"inference" | "constraint"`

Derived from the root expression.

---

#### `getId()` → `string`

Returns this premise's ID.

---

#### `getTitle()` → `string | undefined`

Returns this premise's optional title.

---

#### `validateEvaluability()` → `TValidationResult`

Validates the premise structure (root presence, child counts, variable declarations, binary positions).

---

#### `evaluate(assignment, options?)` → `TPremiseEvaluationResult`

Evaluates the expression tree under the given assignment. Throws if the premise is not valid. Returns `{ rootValue, expressionValues, variableValues, inferenceDiagnostic }`.

---

#### `toDisplayString()` → `string`

Returns the expression tree rendered with standard logical notation (¬ ∧ ∨ → ↔). Missing operands render as `(?)`.

---

#### `toData()` → `TPremise`

Returns a serialisable snapshot of this premise (`{ id, title, type, rootExpressionId, variables, expressions }`).

---

## Development

```bash
pnpm install
pnpm run typecheck   # type-check without emitting
pnpm run lint        # Prettier + ESLint
pnpm run test        # Vitest
pnpm run build       # compile to dist/
pnpm run check       # all of the above in sequence
```

## Publishing

Releases are published to GitHub Packages automatically. To publish a new version:

1. Bump `version` in `package.json`.
2. Create a GitHub Release with a tag matching the version (e.g. `v0.2.0`).
3. The [Publish workflow](.github/workflows/publish.yml) will build and publish the package.
