# proposit-core

Core engine for building, evaluating, and checking the logical validity of propositional-logic arguments. Manages typed trees of variables and expressions across one or more **premises**, with strict structural invariants, automatic operator collapse, a display renderer, and a truth-table validity checker.

Also ships a **CLI** (`proposit-core`) for managing arguments, premises, variables, expressions, and analyses stored on disk.

## Installation

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

A **propositional variable** (e.g. `P`, `Q`, `Rain`) is a named atomic proposition. Variables are registered with the `ArgumentEngine` via `addVariable()` and are shared across all premises. Each variable must have a unique `id` and a unique `symbol` within the argument.

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
- **Supporting** — any inference premise (root is `implies` or `iff`) that is not the conclusion is automatically considered supporting. There is no explicit method to add or remove supporting premises.

A premise that is neither supporting nor the conclusion and whose type is `"constraint"` is automatically used to filter admissible variable assignments during validity checking.

Each expression carries:

| Field             | Type             | Description                                                |
| ----------------- | ---------------- | ---------------------------------------------------------- |
| `id`              | `string`         | Unique identifier.                                         |
| `argumentId`      | `string`         | Must match the engine's argument.                          |
| `argumentVersion` | `number`         | Must match the engine's argument version.                  |
| `parentId`        | `string \| null` | ID of the parent operator, or `null` for root nodes.       |
| `position`        | `number`         | Numeric position among siblings (midpoint-based ordering). |

## Usage

### Creating an engine and premises

```typescript
import { ArgumentEngine, POSITION_INITIAL } from "@polintpro/proposit-core"
import type { TPropositionalExpression } from "@polintpro/proposit-core"

// The constructor accepts an argument without checksum — it is computed lazily.
const argument = {
    id: "arg-1",
    version: 1,
    title: "Modus Ponens",
    description: "",
}

const eng = new ArgumentEngine(argument)

const { result: premise1 } = eng.createPremise("P implies Q")
const { result: premise2 } = eng.createPremise("P")
const { result: conclusion } = eng.createPremise("Q")
```

### Adding variables and expressions

```typescript
// Variables are passed without checksum — checksums are computed lazily.
const varP = {
    id: "var-p",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "P",
}
const varQ = {
    id: "var-q",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "Q",
}

// Register variables once on the engine — they are shared across all premises
eng.addVariable(varP)
eng.addVariable(varQ)

// Premise 1: P → Q
premise1.addExpression({
    id: "op-implies",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "operator",
    operator: "implies",
    parentId: null,
    position: POSITION_INITIAL,
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
premise2.addExpression({
    id: "expr-p2",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-p",
    parentId: null,
    position: POSITION_INITIAL,
})

// Conclusion: Q
conclusion.addExpression({
    id: "expr-q2",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-q",
    parentId: null,
    position: POSITION_INITIAL,
})
```

### Setting roles

```typescript
// Supporting premises are derived automatically — any inference premise
// (root is implies/iff) that isn't the conclusion is automatically supporting.
// Only the conclusion needs to be set explicitly:
eng.setConclusionPremise(conclusion.getId())
```

### Mutation results

All mutating methods on `PremiseManager` and `ArgumentEngine` return `TCoreMutationResult<T>`, which wraps the direct result with an entity-typed changeset:

```typescript
const { result: pm, changes } = eng.createPremise("My premise")
// pm is a PremiseManager
// changes.premises?.added contains the new premise data

const { result: expr, changes: exprChanges } = pm.addExpression({
    id: "expr-1",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-p",
    parentId: null,
    position: POSITION_INITIAL,
})
// exprChanges.expressions?.added contains the new expression
```

### Evaluating an argument

Assignments use `TCoreExpressionAssignment`, which carries both variable truth values (three-valued: `true`, `false`, or `null` for unknown) and a list of rejected expression IDs:

```typescript
const result = eng.evaluate({
    variables: { "var-p": true, "var-q": true },
    rejectedExpressionIds: [],
})
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
const varR = {
    id: "var-r",
    argumentId: "arg-1",
    argumentVersion: 1,
    symbol: "R",
}
eng.addVariable(varR)
premise1.addExpression({
    id: "expr-r",
    argumentId: "arg-1",
    argumentVersion: 1,
    type: "variable",
    variableId: "var-r",
    parentId: null,
    position: POSITION_INITIAL,
})
premise1.insertExpression(
    {
        id: "op-and",
        argumentId: "arg-1",
        argumentVersion: 1,
        type: "operator",
        operator: "and",
        parentId: null, // overwritten by insertExpression
        position: POSITION_INITIAL,
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

#### `new ArgumentEngine(argument, options?)`

Creates an engine scoped to `argument` (`{ id, version, title, description }`, without `checksum` — it is computed lazily). Accepts an optional `options` parameter with `{ checksumConfig?: TCoreChecksumConfig }` to configure which fields are included in entity checksums.

---

#### `createPremise(title?)` → `TCoreMutationResult<PremiseManager>`

Creates a new `PremiseManager`, registers it with the engine, and returns it wrapped in a mutation result with the changeset.

---

#### `removePremise(premiseId)` → `TCoreMutationResult<TCorePremise>`

Removes a premise and clears its role assignments. Returns the removed premise data.

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

#### `addVariable(variable)` → `TCoreMutationResult<TPropositionalVariable>`

Registers a variable (without `checksum` — it is computed lazily) for use across all premises. Throws if the `id` or `symbol` already exists, or if `argumentId`/`argumentVersion` don't match the engine's argument.

---

#### `updateVariable(variableId, { symbol? })` → `TCoreMutationResult<TPropositionalVariable>`

Updates variable fields. Returns a mutation result with the modified variable.

---

#### `removeVariable(variableId)` → `TCoreMutationResult<TPropositionalVariable>`

Removes the variable and cascade-deletes all expressions referencing it across every premise (including subtree deletion and operator collapse). Returns a mutation result with the removed variable.

---

#### `getVariables()` → `TPropositionalVariable[]`

Returns all registered variables sorted by ID, with checksums.

---

#### `setConclusionPremise(premiseId)` → `TCoreMutationResult<TCoreArgumentRoleState>`

Designates a premise as the conclusion. Throws if the premise does not exist.

---

#### `clearConclusionPremise()` → `TCoreMutationResult<TCoreArgumentRoleState>`

Removes the conclusion role assignment.

---

#### `getConclusionPremise()` → `PremiseManager | undefined`

Returns the conclusion `PremiseManager`, if one has been set.

---

#### `listSupportingPremises()` → `PremiseManager[]`

Returns all supporting premises (derived automatically: inference premises that are not the conclusion), sorted by ID.

---

#### `getRoleState()` → `TCoreArgumentRoleState`

Returns `{ conclusionPremiseId? }`. Supporting premises are derived from expression type, not stored in role state.

---

#### `collectReferencedVariables()`

Returns a cross-premise summary of every variable referenced by expressions, keyed by `id` and `symbol`.

---

#### `validateEvaluability()` → `TValidationResult`

Checks whether the argument is structurally ready to evaluate. Returns `{ ok, issues }`.

---

#### `evaluate(assignment, options?)` → `TArgumentEvaluationResult`

Evaluates all relevant premises under the given expression assignment (`TCoreExpressionAssignment`). The assignment contains `variables` (a `Record<string, boolean | null>`) and `rejectedExpressionIds` (expression IDs that evaluate to `false` with children skipped). Returns per-premise truth values, counterexample status, and an admissibility flag.

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

#### `deleteExpressionsUsingVariable(variableId)` → `TCoreMutationResult<TPropositionalExpression[]>`

Removes all expressions referencing the given variable, with subtree deletion and operator collapse. Returns a mutation result with the removed expressions.

---

#### `getReferencedVariableIds()` → `Set<string>`

Returns the set of variable IDs actually used in this premise's expression tree.

---

#### `getVariables()` → `TPropositionalVariable[]`

Returns all argument-level variables (shared across premises via the engine's `VariableManager`) sorted by ID, with checksums.

---

#### `addExpression(expression)` → `TCoreMutationResult<TPropositionalExpression>`

Adds an expression (without `checksum` — it is computed lazily) to the tree with an explicit numeric position. Validates argument membership, variable references, root uniqueness, and structural constraints (operator type, child limits, position uniqueness). This is the low-level escape hatch — prefer `appendExpression` or `addExpressionRelative` for most use cases.

---

#### `appendExpression(parentId, expression)` → `TCoreMutationResult<TPropositionalExpression>`

Appends an expression as the last child of `parentId` (or as a root if `parentId` is `null`). Position is computed automatically: `POSITION_INITIAL` for the first child, or the midpoint between the last child's position and `POSITION_MAX` for subsequent children. The `expression` argument omits the `position` field (`TExpressionWithoutPosition`).

---

#### `addExpressionRelative(siblingId, relativePosition, expression)` → `TCoreMutationResult<TPropositionalExpression>`

Inserts an expression before or after an existing sibling. `relativePosition` is `"before"` or `"after"`. Position is computed as the midpoint between the sibling and its neighbor (or `POSITION_MIN`/`POSITION_MAX` at the boundaries). The `expression` argument omits the `position` field (`TExpressionWithoutPosition`).

---

#### `removeExpression(expressionId)` → `TCoreMutationResult<TPropositionalExpression | undefined>`

Removes an expression and its subtree, then collapses degenerate ancestor operators. Returns the removed root expression, or `undefined` if not found.

---

#### `insertExpression(expression, leftNodeId?, rightNodeId?)` → `TCoreMutationResult<TPropositionalExpression>`

Splices `expression` into the tree. At least one of `leftNodeId` / `rightNodeId` must be provided. `leftNodeId` becomes position 0 and `rightNodeId` position 1 under the new expression.

---

#### `getExpression(id)` → `TPropositionalExpression | undefined`

Returns an expression by ID.

---

#### `getExpressions()` → `TPropositionalExpression[]`

Returns all expressions sorted by ID.

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

### Standalone Functions

#### `diffArguments(engineA, engineB, options?)` → `TCoreArgumentDiff`

Compares two `ArgumentEngine` instances and returns a structured diff covering argument metadata, variables, premises (with nested expression diffs), and role changes. Each entity category reports added, removed, and modified items with field-level change details.

Options allow plugging custom comparators per entity type via `TCoreDiffOptions`:

```typescript
import { diffArguments, defaultCompareVariable } from "@polintpro/proposit-core"

const diff = diffArguments(engineA, engineB, {
    compareVariable: (before, after) => {
        // Wrap the default comparator with custom logic
        return defaultCompareVariable(before, after)
    },
})
```

Default comparators are also exported: `defaultCompareArgument`, `defaultCompareVariable`, `defaultComparePremise`, `defaultCompareExpression`.

---

#### `analyzePremiseRelationships(engine, focusedPremiseId)` → `TCorePremiseRelationshipAnalysis`

Analyzes how every other premise in the argument relates to a focused premise, classifying each as:

| Category        | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `supporting`    | Consequent feeds into the focused premise's antecedent (helps it fire)   |
| `contradicting` | Infers values that negate the focused premise's antecedent or consequent |
| `restricting`   | Constrains shared variables without clear support or contradiction       |
| `downstream`    | Takes the focused premise's consequent as input (inference flows away)   |
| `unrelated`     | No variable overlap, even transitively                                   |

Each result includes per-variable relationship details and a `transitive` flag.

```typescript
import { analyzePremiseRelationships } from "@polintpro/proposit-core"

const analysis = analyzePremiseRelationships(engine, conclusionPremiseId)
for (const r of analysis.premises) {
    console.log(`${r.premiseId}: ${r.relationship}`)
}
```

---

#### `buildPremiseProfile(premise)` → `TCorePremiseProfile`

Builds a profile of a premise's variable appearances, recording each variable's side (`antecedent` or `consequent`) and polarity (`positive` or `negative`, determined by negation depth). Used internally by `analyzePremiseRelationships` but also exported for direct use.

---

#### `parseFormula(input)` → `FormulaAST`

Parses a logical formula string into an AST. Supports standard logical notation with operators `not`/`¬`, `and`/`∧`, `or`/`∨`, `implies`/`→`, `iff`/`↔`, and parentheses for grouping.

```typescript
import { parseFormula } from "@polintpro/proposit-core"
import type { FormulaAST } from "@polintpro/proposit-core"

const ast: FormulaAST = parseFormula("(P and Q) implies R")
```

---

#### `DEFAULT_CHECKSUM_CONFIG`

Readonly default checksum configuration with `Set<string>` fields for each entity type (`expressionFields`, `variableFields`, `premiseFields`, `argumentFields`, `roleFields`). Used by `ArgumentEngine` and `PremiseManager` when no custom config is provided.

---

#### `createChecksumConfig(additional)` → `TCoreChecksumConfig`

Merges additional fields into the defaults via set union. The `additional` parameter has the same shape as `TCoreChecksumConfig` — any omitted fields inherit the defaults from `DEFAULT_CHECKSUM_CONFIG`.

```typescript
import {
    createChecksumConfig,
    DEFAULT_CHECKSUM_CONFIG,
} from "@polintpro/proposit-core"

// Add a custom field to expression checksums while keeping all defaults
const config = createChecksumConfig({
    expressionFields: new Set(["myCustomField"]),
})
```

---

### Position Utilities

Constants and a helper for midpoint-based position computation, exported from `utils/position.ts`:

| Export             | Value / Signature                       | Description                              |
| ------------------ | --------------------------------------- | ---------------------------------------- |
| `POSITION_MIN`     | `0`                                     | Lower bound for positions.               |
| `POSITION_MAX`     | `Number.MAX_SAFE_INTEGER`               | Upper bound for positions.               |
| `POSITION_INITIAL` | `Math.floor(Number.MAX_SAFE_INTEGER/2)` | Default position for first children.     |
| `midpoint(a, b)`   | `a + (b - a) / 2`                       | Overflow-safe midpoint of two positions. |

~52 bisections at the same insertion point before losing floating-point precision.

---

### Types

#### `TExpressionInput`

A version of `TPropositionalExpression` with the `checksum` field omitted. Uses a distributive conditional type to preserve discriminated-union narrowing across the `variable`/`operator`/`formula` variants. Used as the input type for `addExpression` and `insertExpression`.

---

#### `TExpressionWithoutPosition`

A version of `TPropositionalExpression` with both the `position` and `checksum` fields omitted. Uses a distributive conditional type to preserve discriminated-union narrowing across the `variable`/`operator`/`formula` variants. Used as the input type for `appendExpression` and `addExpressionRelative`.

---

## CLI

The package ships a command-line interface for managing arguments stored on disk.

### Running the CLI

```bash
# From the repo, using node directly:
node dist/cli.js --help

# Using the npm script:
pnpm cli -- --help

# Link globally to get the `proposit-core` command on your PATH:
pnpm link --global
proposit-core --help
```

### State storage

All data is stored under `~/.proposit-core` by default. Override with the `PROPOSIT_HOME` environment variable:

```bash
PROPOSIT_HOME=/path/to/data proposit-core arguments list
```

The on-disk layout is:

```
$PROPOSIT_HOME/
  arguments/
    <argument-id>/
      meta.json          # id, title, description
      <version>/         # one directory per version (0, 1, 2, …)
        meta.json        # version, createdAt, published, publishedAt?
        variables.json   # array of TPropositionalVariable
        roles.json       # { conclusionPremiseId? }
        premises/
          <premise-id>/
            meta.json    # id, title?
            data.json    # type, rootExpressionId?, variables[], expressions[]
        <analysis>.json  # named analysis files (default: analysis.json)
```

### Versioning

Arguments start at version `0`. Publishing marks the current version as immutable and copies its state to a new draft version. All mutating commands reject published versions.

Version selectors accepted anywhere a `<version>` is required:

| Selector         | Resolves to                            |
| ---------------- | -------------------------------------- |
| `0`, `1`, …      | Exact version number                   |
| `latest`         | Highest version number                 |
| `last-published` | Highest version with `published: true` |

### Top-level commands

```
proposit-core version                              Print the package version
proposit-core arguments create <title> <desc>      Create a new argument (prints UUID)
proposit-core arguments list [--json]              List all arguments
proposit-core arguments delete [--all] [--confirm] <id>   Delete an argument or its latest version
proposit-core arguments publish <id>               Publish latest version, prepare new draft
```

By default `delete` removes only the latest version. Pass `--all` to remove the argument entirely. Both `delete` and `delete-unused` prompt for confirmation unless `--confirm` is supplied.

### Version-scoped commands

All commands below are scoped to a specific argument version:

```
proposit-core <argument_id> <version> <group> <subcommand> [args] [options]
```

#### show

```
proposit-core <id> <ver> show [--json]
```

Displays argument metadata (id, title, description, version, createdAt, published, publishedAt).

#### render

```
proposit-core <id> <ver> render
```

Prints every premise in the argument, one per line, in the format `<premise_id>: <display_string>`. The premise designated as the conclusion is marked with an asterisk (`<premise_id>*: <display_string>`). Display strings use standard logical notation (¬ ∧ ∨ → ↔).

#### roles

```
proposit-core <id> <ver> roles show [--json]
proposit-core <id> <ver> roles set-conclusion <premise_id>
proposit-core <id> <ver> roles clear-conclusion
```

Supporting premises are derived automatically from expression type (inference premises that are not the conclusion).

#### variables

```
proposit-core <id> <ver> variables create <symbol> [--id <variable_id>]
proposit-core <id> <ver> variables list [--json]
proposit-core <id> <ver> variables show <variable_id> [--json]
proposit-core <id> <ver> variables update <variable_id> --symbol <new_symbol>
proposit-core <id> <ver> variables delete <variable_id>
proposit-core <id> <ver> variables list-unused [--json]
proposit-core <id> <ver> variables delete-unused [--confirm] [--json]
```

`create` prints the new variable's UUID. `delete` cascade-deletes all expressions referencing the variable across every premise (including subtree deletion and operator collapse). `delete-unused` removes variables not referenced by any expression in any premise.

#### premises

```
proposit-core <id> <ver> premises create [--title <title>]
proposit-core <id> <ver> premises list [--json]
proposit-core <id> <ver> premises show <premise_id> [--json]
proposit-core <id> <ver> premises update <premise_id> --title <title>
proposit-core <id> <ver> premises delete [--confirm] <premise_id>
proposit-core <id> <ver> premises render <premise_id>
```

`create` prints the new premise's UUID. `render` outputs the expression tree as a display string (e.g. `(P → Q)`).

#### expressions

```
proposit-core <id> <ver> expressions create <premise_id> --type <type> [options]
proposit-core <id> <ver> expressions insert <premise_id> --type <type> [options]
proposit-core <id> <ver> expressions delete <premise_id> <expression_id>
proposit-core <id> <ver> expressions list <premise_id> [--json]
proposit-core <id> <ver> expressions show <premise_id> <expression_id> [--json]
```

Common options for `create` and `insert`:

| Option               | Description                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| `--type <type>`      | `variable`, `operator`, or `formula` (required)                        |
| `--id <id>`          | Explicit expression ID (default: generated UUID)                       |
| `--parent-id <id>`   | Parent expression ID (omit for root)                                   |
| `--position <n>`     | Explicit numeric position (low-level escape hatch)                     |
| `--before <id>`      | Insert before this sibling (computes position automatically)           |
| `--after <id>`       | Insert after this sibling (computes position automatically)            |
| `--variable-id <id>` | Variable ID (required for `type=variable`)                             |
| `--operator <op>`    | `not`, `and`, `or`, `implies`, or `iff` (required for `type=operator`) |

When none of `--position`, `--before`, or `--after` is specified, the expression is appended as the last child of the parent. `--before`/`--after` cannot be combined with `--position`.

`insert` additionally accepts `--left-node-id` and `--right-node-id` to splice the new expression between existing nodes.

#### analysis

An **analysis file** stores a variable assignment (symbol → boolean) for a specific argument version.

```
proposit-core <id> <ver> analysis create [filename] [--default <true|false>]
proposit-core <id> <ver> analysis list [--json]
proposit-core <id> <ver> analysis show [--file <filename>] [--json]
proposit-core <id> <ver> analysis set <symbol> <true|false> [--file <filename>]
proposit-core <id> <ver> analysis reset [--file <filename>] [--value <true|false>]
proposit-core <id> <ver> analysis reject <expression_id> [--file <filename>]
proposit-core <id> <ver> analysis accept <expression_id> [--file <filename>]
proposit-core <id> <ver> analysis validate-assignments [--file <filename>] [--json]
proposit-core <id> <ver> analysis delete [--file <filename>] [--confirm]
proposit-core <id> <ver> analysis evaluate [--file <filename>] [options]
proposit-core <id> <ver> analysis check-validity [options]
proposit-core <id> <ver> analysis validate-argument [--json]
proposit-core <id> <ver> analysis refs [--json]
proposit-core <id> <ver> analysis export [--json]
```

`--file` defaults to `analysis.json` throughout. Key subcommands:

- **`reject`** — marks an expression as rejected (it will evaluate to `false` and its children are skipped).
- **`accept`** — removes an expression from the rejected list (restores normal computation).
- **`evaluate`** — resolves symbol→ID, evaluates the argument, reports admissibility, counterexample status, and whether the conclusion is true.
- **`check-validity`** — runs the full truth-table search (`--mode first-counterexample|exhaustive`).
- **`validate-argument`** — checks structural readiness (conclusion set, inference premises, etc.).
- **`refs`** — lists every variable referenced across all premises.
- **`export`** — dumps the full `ArgumentEngine` state snapshot as JSON.

## Development

```bash
pnpm install
pnpm run typecheck   # type-check without emitting
pnpm run lint        # Prettier + ESLint
pnpm run test        # Vitest
pnpm run build       # compile to dist/
pnpm run check       # all of the above in sequence
pnpm cli -- --help   # run the CLI from the local build
```

A CLI smoke test exercises every command against an isolated temp directory:

```bash
pnpm run build && bash scripts/smoke-test.sh
```

See [CLI_EXAMPLES.md](CLI_EXAMPLES.md) for a full walkthrough.

## Publishing

Releases are published to GitHub Packages automatically. To publish a new version:

1. Bump `version` in `package.json`.
2. Create a GitHub Release with a tag matching the version (e.g. `v0.2.0`) via `pnpm version patch`
3. The [Publish workflow](.github/workflows/publish.yml) will build and publish the package or run `pnpm publish --access public`
4. Push new tags with `git push --follow-tags`
