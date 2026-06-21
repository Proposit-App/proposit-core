# YAML Argument Import — Design Document

## Overview

A library-level mechanism to ingest a `.yaml` file containing a human-authored representation of a logical argument and convert it into a fully hydrated `ArgumentEngine`.

## YAML Input Format

A single YAML file represents one argument:

```yaml
title: "Modus Ponens Example"
description: "A simple modus ponens argument"
premises:
    - title: "If it rains, the ground is wet"
      role: "conclusion"
      formula: "Rain → Wet"
    - title: "It is raining"
      formula: "Rain"
    - title: "Connection"
      formula: "(A ∨ ¬B) → C"
```

### Fields

| Field                | Required | Default        | Description                              |
| -------------------- | -------- | -------------- | ---------------------------------------- |
| `title`              | yes      | —              | Argument title                           |
| `description`        | no       | `""`           | Argument description                     |
| `premises`           | yes      | —              | Non-empty array of premise objects       |
| `premises[].title`   | no       | —              | Premise title                            |
| `premises[].role`    | no       | `"supporting"` | `"conclusion"` or `"supporting"`         |
| `premises[].formula` | yes      | —              | Formula string (see Proposit_Grammar.md) |

### Implicit Variable Declaration

Variables are not declared explicitly. They are extracted from all formula strings across all premises. Any identifier token in a formula that is not an operator becomes a variable. All premises in the argument share the same variable pool.

## Formula Parser

### Approach

A PEG parser built with `peggy` (dev dependency). The grammar is compiled to JavaScript at build time; the generated parser is committed to the repo so consumers don't need `peggy` installed.

### Operator Precedence (low to high)

| Precedence  | Operators     | Unicode | ASCII  | Associativity    |
| ----------- | ------------- | ------- | ------ | ---------------- |
| 1 (lowest)  | implies       | `→`     | `->`   | None (root-only) |
| 1           | biconditional | `↔`     | `<->`  | None (root-only) |
| 2           | disjunction   | `∨`     | `\|\|` | Left             |
| 3           | conjunction   | `∧`     | `&&`   | Left             |
| 4 (highest) | negation      | `¬`     | `!`    | Right (prefix)   |

Atoms: parenthesized sub-expressions `( ... )` or identifiers matching `[A-Za-z_][A-Za-z0-9_]*`.

### Root-Only Constraint

`implies` and `iff` can only appear at the top level of a formula, not nested inside other operators (matching the internal expression tree constraint). `(A → B)` inside a larger expression is invalid.

### Intermediate AST

```typescript
type FormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: FormulaAST }
    | { type: "and"; operands: FormulaAST[] }
    | { type: "or"; operands: FormulaAST[] }
    | { type: "implies"; left: FormulaAST; right: FormulaAST }
    | { type: "iff"; left: FormulaAST; right: FormulaAST }
```

`and`/`or` collect multiple operands (e.g., `A ∧ B ∧ C` becomes `{ type: "and", operands: [A, B, C] }`) to match the internal model where operators have n children.

## Ingestion Function

### Signature

```typescript
function importArgumentFromYaml(yamlString: string): ArgumentEngine
```

Standalone function (not an instance method), consistent with `diffArguments`.

### Processing Steps

1. Parse YAML string to raw object (`js-yaml`)
2. Validate against Typebox schema (throw on invalid structure)
3. Parse each premise's formula string to `FormulaAST` (throw with premise context on parse error)
4. Collect all unique variable symbols across all formulas
5. Create `ArgumentEngine` with generated UUID, title, description, version 0
6. Register all collected variables with the engine
7. For each premise:
    - Create a `PremiseManager` (with title if provided)
    - Convert `FormulaAST` into internal `TPropositionalExpression` nodes (generating UUIDs, assigning parentIds and positions)
    - Add expressions to the premise
8. Assign roles: set conclusion premise, add all others as supporting

### Error Handling

- YAML parse errors: throw with parse error details
- Schema validation errors: throw with Typebox validation issues
- Formula parse errors: throw with premise index/title and parser error (position, expected tokens)
- Multiple conclusions: throw with clear message
- No premises: throw (schema enforces non-empty array)

## File Layout

```
src/lib/core/parser/
  formula.peggy           # PEG grammar source
  formula.ts              # Typed wrapper: parseFormula() + AST types
src/lib/core/import.ts    # importArgumentFromYaml()
src/lib/schemata/import.ts # Typebox schema for YAML input shape
docs/Proposit_Grammar.md  # Grammar documentation with examples
```

## Build Integration

- New script: `pnpm run generate:parser` runs `peggy formula.peggy -o formula.js`
- Generated `.js` file committed to repo
- `pnpm run build` runs parser generation before `tsc`

## Dependencies

- `js-yaml` — added as direct dependency (already available transitively)
- `@types/js-yaml` — added as dev dependency
- `peggy` — added as dev dependency (build-time only)

## Public API

Exported from `src/index.ts`:

- `importArgumentFromYaml(yamlString: string): ArgumentEngine`
- `parseFormula(formulaString: string): FormulaAST`
- `FormulaAST` type

## Testing

New file: `test/import.test.ts`

- `parseFormula` — operator precedence, all operator variants (Unicode + ASCII), parentheses, identifiers, error cases
- `importArgumentFromYaml` — full YAML ingestion, variable extraction, role assignment, edge cases, error handling
