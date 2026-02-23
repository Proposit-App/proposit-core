# proposit-core

Core engine for building and manipulating propositional logic arguments. Manages a typed tree of variables and logical expressions with strict structural invariants, automatic operator collapse, and a display renderer.

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

### Variables

A **propositional variable** (e.g. `P`, `Q`, `Rain`) is a named atomic proposition. Variables are registered with the engine before they can be referenced by expressions. Each variable must have a unique `id` and a unique `symbol`.

### Expressions

An **expression** is a node in a rooted expression tree. There are two kinds:

- **Variable expression** — a leaf node that references a registered variable.
- **Operator expression** — an interior node that applies a logical operator to its children.

The five supported operators and their arities are:

| Operator  | Symbol | Arity          |
| --------- | ------ | -------------- |
| `not`     | ¬      | unary (max 1)  |
| `and`     | ∧      | variadic (≥ 2) |
| `or`      | ∨      | variadic (≥ 2) |
| `implies` | →      | binary (= 2)   |
| `iff`     | ↔      | binary (= 2)   |

`implies` and `iff` are **root-only**: they must have `parentId: null` and cannot be nested inside another expression.

Each expression carries:

| Field             | Type             | Description                                          |
| ----------------- | ---------------- | ---------------------------------------------------- |
| `id`              | `string`         | Unique identifier.                                   |
| `argumentId`      | `string`         | Must match the engine's argument.                    |
| `argumentVersion` | `number`         | Must match the engine's argument version.            |
| `parentId`        | `string \| null` | ID of the parent operator, or `null` for root nodes. |
| `position`        | `number \| null` | Ordered index among siblings under the same parent.  |

## Usage

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

eng.addVariable(varP)
eng.addVariable(varQ)

// Build:  P → Q
const implies: TPropositionalExpression = {
    id: "op-implies",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "operator",
    operator: "implies",
    parentId: null,
    position: null,
}
const exprP: TPropositionalExpression = {
    id: "expr-p",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-p",
    parentId: "op-implies",
    position: 0,
}
const exprQ: TPropositionalExpression = {
    id: "expr-q",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-q",
    parentId: "op-implies",
    position: 1,
}

eng.addExpression(implies)
eng.addExpression(exprP)
eng.addExpression(exprQ)

console.log(eng.toDisplayString()) // (P → Q)
```

### Inserting an expression into the tree

`insertExpression` splices a new node between existing nodes. The new expression inherits the **anchor** node's current slot in the tree (`leftNodeId ?? rightNodeId`).

```typescript
// Extend  P → Q  into  (P ∧ R) → Q  by inserting an `and` above expr-p.
const varR: TPropositionalVariable = {
    id: "var-r",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "R",
}
const exprR: TPropositionalExpression = {
    id: "expr-r",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-r",
    parentId: null,
    position: null,
}

eng.addVariable(varR)
eng.addExpression(exprR)

const opAnd: TPropositionalExpression = {
    id: "op-and",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "operator",
    operator: "and",
    parentId: null, // will be overwritten by insertExpression
    position: null,
}

// op-and takes expr-p's slot (position 0 under op-implies).
// expr-p → position 0 under op-and, expr-r → position 1 under op-and.
eng.insertExpression(opAnd, "expr-p", "expr-r")

console.log(eng.toDisplayString()) // ((P ∧ R) → Q)
```

### Removing expressions

Removing an expression also removes its entire descendant subtree. After the subtree is gone, the engine automatically collapses any ancestor operators left with fewer than two children:

- **0 children remaining** — the operator is deleted; the check recurses upward.
- **1 child remaining** — the operator is deleted and that child is promoted into the operator's former slot.

```typescript
// Remove expr-r from the and-cluster.
// op-and now has only expr-p → op-and is deleted, expr-p is promoted back
// to position 0 under op-implies.
eng.removeExpression("expr-r")

console.log(eng.toDisplayString()) // (P → Q)
```

### Loading initial state

Pass pre-built arrays to the constructor to restore persisted state. Expressions may be listed in any order; the engine resolves parent–child relationships automatically.

```typescript
const eng = new ArgumentEngine(argument, [varP, varQ], [implies, exprP, exprQ])
```

## API Reference

### `new ArgumentEngine(argument, variables?, expressions?)`

Creates an engine scoped to `argument`. Optional `variables` and `expressions` arrays are loaded in dependency order.

---

### `addVariable(variable)`

Registers a propositional variable. Throws if the `id` or `symbol` is already in use, or if the variable does not belong to this argument.

---

### `removeVariable(variableId)`

Removes and returns a variable, or `undefined` if not found. Throws if any expression still references it.

---

### `addExpression(expression)`

Adds an expression to the tree. Validates argument membership, variable references, parent existence, operator type, child limits, and position uniqueness.

---

### `removeExpression(expressionId)`

Removes an expression and its subtree, collapses degenerate ancestor operators, and returns the removed root expression, or `undefined` if not found.

---

### `insertExpression(expression, leftNodeId?, rightNodeId?)`

Splices `expression` into the tree between existing nodes. At least one of `leftNodeId` / `rightNodeId` must be provided. The new node inherits the anchor's current slot; `leftNodeId` becomes child at position 0 and `rightNodeId` at position 1.

---

### `toDisplayString()`

Returns a newline-separated string of all root expressions rendered with standard logical notation (¬ ∧ ∨ → ↔). Missing operands render as `(?)`.

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
