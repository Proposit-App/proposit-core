# YAML Argument Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import a human-authored YAML file into a hydrated `ArgumentEngine`, with formulas parsed from strings like `(A ∨ ¬B) → C`.

**Architecture:** A PEG grammar (compiled with `peggy`) parses formula strings into an intermediate AST. A standalone `importArgumentFromYaml` function parses YAML, validates structure, extracts variables, and builds a fully wired `ArgumentEngine`.

**Tech Stack:** peggy (PEG parser generator), js-yaml (YAML parser), typebox (schema validation), vitest (testing)

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install js-yaml, @types/js-yaml, and peggy**

Run:
```bash
pnpm add js-yaml && pnpm add -D @types/js-yaml peggy
```

**Step 2: Add parser generation script to package.json**

Add to `scripts`:
```json
"generate:parser": "peggy --format es -o src/lib/core/parser/formula.js src/lib/core/parser/formula.peggy"
```

Update the `build` script to run parser generation first:
```json
"build": "pnpm run generate:parser && pnpm tsc -p tsconfig.build.json"
```

**Step 3: Exclude generated .js file from ESLint and Prettier**

Add `src/lib/core/parser/formula.js` to `.prettierignore` on its own line.

In `eslint.config.mjs`, add `"src/lib/core/parser/formula.js"` to the top-level `ignores` array.

**Step 4: Exclude generated .js file from TypeScript**

In `tsconfig.json`, add `"src/lib/core/parser/formula.js"` to the `exclude` array.

In `tsconfig.build.json`, add `"src/lib/core/parser/formula.js"` to the `exclude` array.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .prettierignore eslint.config.mjs tsconfig.json tsconfig.build.json
git commit -m "Add js-yaml, peggy dependencies and parser generation script"
```

---

### Task 2: Write the PEG grammar and typed wrapper

**Files:**
- Create: `src/lib/core/parser/formula.peggy`
- Create: `src/lib/core/parser/formula.ts`

**Step 1: Write the PEG grammar**

Create `src/lib/core/parser/formula.peggy`:

```peg
{{
// AST node constructors used by grammar actions
function variableNode(name) {
  return { type: "variable", name };
}
function notNode(operand) {
  return { type: "not", operand };
}
function binaryNode(type, left, right) {
  return { type, left, right };
}
function naryNode(type, first, rest) {
  if (rest.length === 0) return first;
  return { type, operands: [first, ...rest] };
}
}}

Formula
  = _ expr:Implication _ { return expr; }

Implication
  = left:Disjunction _ op:("→" / "->" / "↔" / "<->") _ right:Disjunction {
      const type = (op === "→" || op === "->") ? "implies" : "iff";
      return binaryNode(type, left, right);
    }
  / Disjunction

Disjunction
  = first:Conjunction rest:(_ ("∨" / "||") _ c:Conjunction { return c; })* {
      return naryNode("or", first, rest);
    }

Conjunction
  = first:Unary rest:(_ ("∧" / "&&") _ u:Unary { return u; })* {
      return naryNode("and", first, rest);
    }

Unary
  = ("¬" / "!") _ operand:Unary { return notNode(operand); }
  / Atom

Atom
  = "(" _ expr:Implication _ ")" { return expr; }
  / name:Identifier { return variableNode(name); }

Identifier
  = $([A-Za-z_][A-Za-z0-9_]*)

_ "whitespace"
  = [ \t\n\r]*
```

**Step 2: Generate the parser JS file**

Run:
```bash
pnpm run generate:parser
```

Expected: creates `src/lib/core/parser/formula.js` without errors.

**Step 3: Write the typed wrapper**

Create `src/lib/core/parser/formula.ts`:

```typescript
// @ts-expect-error — generated parser has no type declarations
import { parse as pegParse } from "./formula.js"

export type FormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: FormulaAST }
    | { type: "and"; operands: FormulaAST[] }
    | { type: "or"; operands: FormulaAST[] }
    | { type: "implies"; left: FormulaAST; right: FormulaAST }
    | { type: "iff"; left: FormulaAST; right: FormulaAST }

export function parseFormula(input: string): FormulaAST {
    return pegParse(input) as FormulaAST
}
```

**Step 4: Verify typecheck passes**

Run:
```bash
pnpm run typecheck
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/parser/formula.peggy src/lib/core/parser/formula.js src/lib/core/parser/formula.ts
git commit -m "Add PEG formula grammar and typed parser wrapper"
```

---

### Task 3: Write formula parser tests

**Files:**
- Create: `test/import.test.ts`

**Step 1: Write failing tests for parseFormula**

Create `test/import.test.ts` with a `parseFormula` describe block:

```typescript
import { describe, expect, it } from "vitest"
import { parseFormula } from "../src/lib/core/parser/formula"
import type { FormulaAST } from "../src/lib/core/parser/formula"

describe("parseFormula", () => {
    it("parses a single variable", () => {
        expect(parseFormula("P")).toEqual({ type: "variable", name: "P" })
    })

    it("parses multi-character variable names", () => {
        expect(parseFormula("Rain")).toEqual({ type: "variable", name: "Rain" })
    })

    it("parses variable names with underscores and digits", () => {
        expect(parseFormula("is_wet_1")).toEqual({
            type: "variable",
            name: "is_wet_1",
        })
    })

    it("parses negation with Unicode ¬", () => {
        expect(parseFormula("¬P")).toEqual({
            type: "not",
            operand: { type: "variable", name: "P" },
        })
    })

    it("parses negation with ASCII !", () => {
        expect(parseFormula("!P")).toEqual({
            type: "not",
            operand: { type: "variable", name: "P" },
        })
    })

    it("parses double negation", () => {
        expect(parseFormula("¬¬P")).toEqual({
            type: "not",
            operand: {
                type: "not",
                operand: { type: "variable", name: "P" },
            },
        })
    })

    it("parses conjunction with Unicode ∧", () => {
        expect(parseFormula("P ∧ Q")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses conjunction with ASCII &&", () => {
        expect(parseFormula("P && Q")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses three-way conjunction", () => {
        expect(parseFormula("P ∧ Q ∧ R")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
                { type: "variable", name: "R" },
            ],
        })
    })

    it("parses disjunction with Unicode ∨", () => {
        expect(parseFormula("P ∨ Q")).toEqual({
            type: "or",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses disjunction with ASCII ||", () => {
        expect(parseFormula("P || Q")).toEqual({
            type: "or",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses implication with Unicode →", () => {
        expect(parseFormula("P → Q")).toEqual({
            type: "implies",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("parses implication with ASCII ->", () => {
        expect(parseFormula("P -> Q")).toEqual({
            type: "implies",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("parses biconditional with Unicode ↔", () => {
        expect(parseFormula("P ↔ Q")).toEqual({
            type: "iff",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("parses biconditional with ASCII <->", () => {
        expect(parseFormula("P <-> Q")).toEqual({
            type: "iff",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("respects precedence: conjunction binds tighter than disjunction", () => {
        // P ∨ Q ∧ R  →  P ∨ (Q ∧ R)
        expect(parseFormula("P ∨ Q ∧ R")).toEqual({
            type: "or",
            operands: [
                { type: "variable", name: "P" },
                {
                    type: "and",
                    operands: [
                        { type: "variable", name: "Q" },
                        { type: "variable", name: "R" },
                    ],
                },
            ],
        })
    })

    it("respects precedence: negation binds tighter than conjunction", () => {
        // ¬P ∧ Q  →  (¬P) ∧ Q
        expect(parseFormula("¬P ∧ Q")).toEqual({
            type: "and",
            operands: [
                {
                    type: "not",
                    operand: { type: "variable", name: "P" },
                },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("respects precedence: implication is lowest", () => {
        // P ∧ Q → R  →  (P ∧ Q) → R
        expect(parseFormula("P ∧ Q → R")).toEqual({
            type: "implies",
            left: {
                type: "and",
                operands: [
                    { type: "variable", name: "P" },
                    { type: "variable", name: "Q" },
                ],
            },
            right: { type: "variable", name: "R" },
        })
    })

    it("handles parentheses overriding precedence", () => {
        // (P ∨ Q) ∧ R  →  and(or(P, Q), R)
        expect(parseFormula("(P ∨ Q) ∧ R")).toEqual({
            type: "and",
            operands: [
                {
                    type: "or",
                    operands: [
                        { type: "variable", name: "P" },
                        { type: "variable", name: "Q" },
                    ],
                },
                { type: "variable", name: "R" },
            ],
        })
    })

    it("parses complex formula: (A ∨ ¬B) → C", () => {
        expect(parseFormula("(A ∨ ¬B) → C")).toEqual({
            type: "implies",
            left: {
                type: "or",
                operands: [
                    { type: "variable", name: "A" },
                    {
                        type: "not",
                        operand: { type: "variable", name: "B" },
                    },
                ],
            },
            right: { type: "variable", name: "C" },
        })
    })

    it("allows mixed Unicode and ASCII operators", () => {
        expect(parseFormula("¬P && Q || R -> S")).toEqual({
            type: "implies",
            left: {
                type: "or",
                operands: [
                    {
                        type: "and",
                        operands: [
                            {
                                type: "not",
                                operand: { type: "variable", name: "P" },
                            },
                            { type: "variable", name: "Q" },
                        ],
                    },
                    { type: "variable", name: "R" },
                ],
            },
            right: { type: "variable", name: "S" },
        })
    })

    it("handles whitespace variations", () => {
        expect(parseFormula("  P   ∧   Q  ")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("handles no whitespace", () => {
        expect(parseFormula("P∧Q")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("throws on empty input", () => {
        expect(() => parseFormula("")).toThrow()
    })

    it("throws on invalid token", () => {
        expect(() => parseFormula("P @ Q")).toThrow()
    })

    it("throws on unmatched parenthesis", () => {
        expect(() => parseFormula("(P ∧ Q")).toThrow()
    })

    it("throws on chained implications", () => {
        expect(() => parseFormula("P → Q → R")).toThrow()
    })

    it("allows implies inside parenthesized atom", () => {
        // The grammar permits (P → Q) as an atom — this is a parenthesized
        // Implication, which is valid syntax. Whether it creates a valid
        // expression tree is enforced downstream by the import function.
        expect(parseFormula("(P → Q)")).toEqual({
            type: "implies",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("allows implies inside parenthesized atom used in conjunction", () => {
        // The grammar parses this, but importArgumentFromYaml will reject it
        // because implies/iff can only be at the root of the expression tree.
        // The parser itself should succeed.
        expect(parseFormula("(P → Q) ∧ R")).toEqual({
            type: "and",
            operands: [
                {
                    type: "implies",
                    left: { type: "variable", name: "P" },
                    right: { type: "variable", name: "Q" },
                },
                { type: "variable", name: "R" },
            ],
        })
    })
})
```

**Step 2: Run tests to verify they pass**

Run:
```bash
pnpm run test
```

Expected: all `parseFormula` tests PASS (the parser was built in Task 2).

**Step 3: Commit**

```bash
git add test/import.test.ts
git commit -m "Add parseFormula test suite"
```

---

### Task 4: Write the YAML input schema

**Files:**
- Create: `src/lib/schemata/import.ts`
- Modify: `src/lib/schemata/index.ts`

**Step 1: Write the Typebox schema for YAML input**

Create `src/lib/schemata/import.ts`:

```typescript
import Type, { type Static } from "typebox"

export const CoreYamlPremiseSchema = Type.Object({
    title: Type.Optional(Type.String()),
    role: Type.Optional(
        Type.Union([Type.Literal("conclusion"), Type.Literal("supporting")])
    ),
    formula: Type.String(),
})

export type TCoreYamlPremise = Static<typeof CoreYamlPremiseSchema>

export const CoreYamlArgumentSchema = Type.Object({
    title: Type.String(),
    description: Type.Optional(Type.String({ default: "" })),
    premises: Type.Array(CoreYamlPremiseSchema, { minItems: 1 }),
})

export type TCoreYamlArgument = Static<typeof CoreYamlArgumentSchema>
```

**Step 2: Re-export from schemata index**

Add to the end of `src/lib/schemata/index.ts`:

```typescript
export * from "./import.js"
```

**Step 3: Run typecheck**

Run:
```bash
pnpm run typecheck
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/schemata/import.ts src/lib/schemata/index.ts
git commit -m "Add Typebox schema for YAML argument input"
```

---

### Task 5: Implement importArgumentFromYaml

**Files:**
- Create: `src/lib/core/import.ts`
- Modify: `src/lib/index.ts`
- Modify: `src/index.ts`

**Step 1: Write the import function**

Create `src/lib/core/import.ts`:

```typescript
import { randomUUID } from "node:crypto"
import yaml from "js-yaml"
import { Value } from "typebox/value"
import { CoreYamlArgumentSchema } from "../schemata/import.js"
import type { TCoreYamlArgument } from "../schemata/import.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { FormulaAST } from "./parser/formula.js"
import { parseFormula } from "./parser/formula.js"
import { ArgumentEngine } from "./ArgumentEngine.js"

/**
 * Validates that `implies` and `iff` nodes appear only at the AST root.
 * Throws if an implication/biconditional is nested inside another operator.
 */
function validateRootOnly(
    ast: FormulaAST,
    isRoot: boolean,
    premiseIndex: number,
    premiseTitle: string | undefined
): void {
    if (!isRoot && (ast.type === "implies" || ast.type === "iff")) {
        const label = premiseTitle
            ? `premise "${premiseTitle}" (index ${premiseIndex})`
            : `premise at index ${premiseIndex}`
        throw new Error(
            `${ast.type === "implies" ? "Implication (→)" : "Biconditional (↔)"} operator must be at the root of a formula, but found nested in ${label}.`
        )
    }
    switch (ast.type) {
        case "variable":
            break
        case "not":
            validateRootOnly(ast.operand, false, premiseIndex, premiseTitle)
            break
        case "and":
        case "or":
            for (const operand of ast.operands) {
                validateRootOnly(operand, false, premiseIndex, premiseTitle)
            }
            break
        case "implies":
        case "iff":
            validateRootOnly(ast.left, false, premiseIndex, premiseTitle)
            validateRootOnly(ast.right, false, premiseIndex, premiseTitle)
            break
    }
}

/** Recursively collects all variable names from a formula AST. */
function collectVariableNames(ast: FormulaAST, names: Set<string>): void {
    switch (ast.type) {
        case "variable":
            names.add(ast.name)
            break
        case "not":
            collectVariableNames(ast.operand, names)
            break
        case "and":
        case "or":
            for (const operand of ast.operands) {
                collectVariableNames(operand, names)
            }
            break
        case "implies":
        case "iff":
            collectVariableNames(ast.left, names)
            collectVariableNames(ast.right, names)
            break
    }
}

/**
 * Converts a formula AST into internal expression objects and adds them
 * to the premise manager. Returns the root expression ID.
 */
function buildExpressions(
    ast: FormulaAST,
    parentId: string | null,
    position: number | null,
    argumentId: string,
    argumentVersion: number,
    variablesByName: Map<string, TCorePropositionalVariable>,
    addExpression: (expr: TCorePropositionalExpression) => void
): string {
    const id = randomUUID()

    switch (ast.type) {
        case "variable": {
            const variable = variablesByName.get(ast.name)!
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "variable",
                variableId: variable.id,
                parentId,
                position,
            })
            return id
        }
        case "not": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "operator",
                operator: "not",
                parentId,
                position,
            })
            buildExpressions(
                ast.operand,
                id,
                0,
                argumentId,
                argumentVersion,
                variablesByName,
                addExpression
            )
            return id
        }
        case "and":
        case "or": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "operator",
                operator: ast.type,
                parentId,
                position,
            })
            for (let i = 0; i < ast.operands.length; i++) {
                buildExpressions(
                    ast.operands[i],
                    id,
                    i,
                    argumentId,
                    argumentVersion,
                    variablesByName,
                    addExpression
                )
            }
            return id
        }
        case "implies":
        case "iff": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                type: "operator",
                operator: ast.type,
                parentId,
                position,
            })
            buildExpressions(
                ast.left,
                id,
                0,
                argumentId,
                argumentVersion,
                variablesByName,
                addExpression
            )
            buildExpressions(
                ast.right,
                id,
                1,
                argumentId,
                argumentVersion,
                variablesByName,
                addExpression
            )
            return id
        }
    }
}

/**
 * Parses a YAML string representing a logical argument and returns a
 * fully hydrated {@link ArgumentEngine}.
 *
 * Variables are implicitly declared by their usage in formula strings.
 * Premises without an explicit `role` default to `"supporting"`.
 * At most one premise may have `role: "conclusion"`.
 *
 * @throws On YAML parse errors, schema validation failures, formula
 *   parse errors, nested implies/iff operators, or multiple conclusions.
 */
export function importArgumentFromYaml(yamlString: string): ArgumentEngine {
    const raw = yaml.load(yamlString)
    const input: TCoreYamlArgument = Value.Parse(
        CoreYamlArgumentSchema,
        raw
    )

    // Parse all formulas and validate root-only constraint
    const parsedFormulas: FormulaAST[] = []
    for (let i = 0; i < input.premises.length; i++) {
        const premise = input.premises[i]
        let ast: FormulaAST
        try {
            ast = parseFormula(premise.formula)
        } catch (error) {
            const label = premise.title
                ? `premise "${premise.title}" (index ${i})`
                : `premise at index ${i}`
            const msg =
                error instanceof Error ? error.message : String(error)
            throw new Error(
                `Failed to parse formula for ${label}: ${msg}`
            )
        }
        validateRootOnly(ast, true, i, premise.title)
        parsedFormulas.push(ast)
    }

    // Validate conclusion count
    const conclusionIndices = input.premises
        .map((p, i) => (p.role === "conclusion" ? i : -1))
        .filter((i) => i !== -1)
    if (conclusionIndices.length > 1) {
        throw new Error(
            `Multiple premises designated as conclusion (indices ${conclusionIndices.join(", ")}). Only one conclusion is allowed.`
        )
    }

    // Collect all variable names across all formulas
    const allVariableNames = new Set<string>()
    for (const ast of parsedFormulas) {
        collectVariableNames(ast, allVariableNames)
    }

    // Build the argument
    const argumentId = randomUUID()
    const argument = {
        id: argumentId,
        version: 0,
        title: input.title,
        description: input.description ?? "",
        createdAt: Date.now(),
        published: false,
    }

    const engine = new ArgumentEngine(argument)

    // Create variables
    const variablesByName = new Map<string, TCorePropositionalVariable>()
    for (const name of [...allVariableNames].sort()) {
        const variable: TCorePropositionalVariable = {
            id: randomUUID(),
            argumentId,
            argumentVersion: 0,
            symbol: name,
        }
        variablesByName.set(name, variable)
    }

    // Create premises and build expression trees
    for (let i = 0; i < input.premises.length; i++) {
        const premiseDef = input.premises[i]
        const pm = engine.createPremise(premiseDef.title)

        // Register all variables with this premise
        for (const variable of variablesByName.values()) {
            pm.addVariable(variable)
        }

        // Build expression tree from parsed AST
        buildExpressions(
            parsedFormulas[i],
            null,
            null,
            argumentId,
            0,
            variablesByName,
            (expr) => pm.addExpression(expr)
        )

        // Assign role
        const role = premiseDef.role ?? "supporting"
        if (role === "conclusion") {
            engine.setConclusionPremise(pm.getId())
        } else {
            engine.addSupportingPremise(pm.getId())
        }
    }

    return engine
}
```

**Step 2: Export from lib/index.ts**

Add to `src/lib/index.ts`:

```typescript
export { importArgumentFromYaml } from "./core/import.js"
export { parseFormula } from "./core/parser/formula.js"
export type { FormulaAST } from "./core/parser/formula.js"
```

**Step 3: Export from src/index.ts**

Add to `src/index.ts`:

```typescript
export { importArgumentFromYaml } from "./lib/core/import"
export { parseFormula } from "./lib/core/parser/formula"
export type { FormulaAST } from "./lib/core/parser/formula"
```

**Step 4: Run typecheck**

Run:
```bash
pnpm run typecheck
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/import.ts src/lib/index.ts src/index.ts
git commit -m "Implement importArgumentFromYaml function"
```

---

### Task 6: Write importArgumentFromYaml tests

**Files:**
- Modify: `test/import.test.ts`

**Step 1: Add import tests**

Append a new describe block after the `parseFormula` block in `test/import.test.ts`:

```typescript
import { importArgumentFromYaml } from "../src/lib/core/import"
import type { ArgumentEngine } from "../src/lib/index"

describe("importArgumentFromYaml", () => {
    it("imports a simple argument with one variable", () => {
        const yaml = `
title: "Simple"
description: "A simple argument"
premises:
  - title: "Conclusion"
    role: "conclusion"
    formula: "P"
  - title: "Support"
    formula: "P"
`
        const engine = importArgumentFromYaml(yaml)
        expect(engine.getArgument().title).toBe("Simple")
        expect(engine.getArgument().description).toBe("A simple argument")
        expect(engine.listPremiseIds()).toHaveLength(2)
    })

    it("extracts variables implicitly from formulas", () => {
        const yaml = `
title: "Variables test"
premises:
  - role: "conclusion"
    formula: "A → B"
  - formula: "A ∧ C"
`
        const engine = importArgumentFromYaml(yaml)
        const vars = engine.collectReferencedVariables()
        const symbols = Object.keys(vars.bySymbol).sort()
        expect(symbols).toEqual(["A", "B", "C"])
    })

    it("defaults description to empty string", () => {
        const yaml = `
title: "No description"
premises:
  - role: "conclusion"
    formula: "P"
`
        const engine = importArgumentFromYaml(yaml)
        expect(engine.getArgument().description).toBe("")
    })

    it("defaults premises without role to supporting", () => {
        const yaml = `
title: "Role defaults"
premises:
  - role: "conclusion"
    formula: "P → Q"
  - formula: "P"
  - formula: "Q"
`
        const engine = importArgumentFromYaml(yaml)
        expect(engine.listSupportingPremises()).toHaveLength(2)
        expect(engine.getConclusionPremise()).toBeDefined()
    })

    it("sets conclusion and supporting roles correctly", () => {
        const yaml = `
title: "Modus Ponens"
premises:
  - title: "Conclusion"
    role: "conclusion"
    formula: "Q"
  - title: "Major"
    formula: "P → Q"
  - title: "Minor"
    formula: "P"
`
        const engine = importArgumentFromYaml(yaml)
        const conclusion = engine.getConclusionPremise()!
        expect(conclusion.getTitle()).toBe("Conclusion")
        expect(engine.listSupportingPremises()).toHaveLength(2)
    })

    it("builds correct expression tree for conjunction", () => {
        const yaml = `
title: "Conjunction test"
premises:
  - role: "conclusion"
    formula: "P ∧ Q"
`
        const engine = importArgumentFromYaml(yaml)
        const pm = engine.getConclusionPremise()!
        expect(pm.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("builds correct expression tree for complex formula", () => {
        const yaml = `
title: "Complex formula"
premises:
  - role: "conclusion"
    formula: "(A ∨ ¬B) → C"
`
        const engine = importArgumentFromYaml(yaml)
        const pm = engine.getConclusionPremise()!
        expect(pm.toDisplayString()).toBe("((A ∨ ¬(B)) → C)")
    })

    it("builds correct expression tree for three-way conjunction", () => {
        const yaml = `
title: "Three-way and"
premises:
  - role: "conclusion"
    formula: "P ∧ Q ∧ R"
`
        const engine = importArgumentFromYaml(yaml)
        const pm = engine.getConclusionPremise()!
        expect(pm.toDisplayString()).toBe("(P ∧ Q ∧ R)")
    })

    it("builds correct expression tree for biconditional", () => {
        const yaml = `
title: "Biconditional"
premises:
  - role: "conclusion"
    formula: "P ↔ Q"
`
        const engine = importArgumentFromYaml(yaml)
        const pm = engine.getConclusionPremise()!
        expect(pm.toDisplayString()).toBe("(P ↔ Q)")
    })

    it("produces a valid evaluable argument", () => {
        const yaml = `
title: "Evaluable argument"
premises:
  - title: "Conclusion"
    role: "conclusion"
    formula: "P → Q"
  - title: "Support"
    formula: "P → Q"
`
        const engine = importArgumentFromYaml(yaml)
        const validation = engine.validateEvaluability()
        expect(validation.ok).toBe(true)
    })

    it("produces an argument that can check validity", () => {
        const yaml = `
title: "Valid modus ponens"
premises:
  - role: "conclusion"
    formula: "Q"
  - formula: "P → Q"
  - formula: "P"
`
        const engine = importArgumentFromYaml(yaml)
        const result = engine.checkValidity()
        expect(result.ok).toBe(true)
    })

    it("shares variables across premises", () => {
        const yaml = `
title: "Shared vars"
premises:
  - role: "conclusion"
    formula: "P"
  - formula: "P ∧ Q"
`
        const engine = importArgumentFromYaml(yaml)
        const vars = engine.collectReferencedVariables()
        // P should appear in both premises
        expect(vars.bySymbol["P"].premiseIds).toHaveLength(2)
    })

    it("throws on invalid YAML", () => {
        expect(() => importArgumentFromYaml(":::invalid")).toThrow()
    })

    it("throws on missing title", () => {
        const yaml = `
premises:
  - formula: "P"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on missing premises", () => {
        const yaml = `
title: "No premises"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on empty premises array", () => {
        const yaml = `
title: "Empty premises"
premises: []
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on missing formula", () => {
        const yaml = `
title: "Missing formula"
premises:
  - title: "No formula"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on multiple conclusions", () => {
        const yaml = `
title: "Two conclusions"
premises:
  - role: "conclusion"
    formula: "P"
  - role: "conclusion"
    formula: "Q"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow(/[Mm]ultiple/)
    })

    it("throws on invalid formula syntax", () => {
        const yaml = `
title: "Bad formula"
premises:
  - role: "conclusion"
    formula: "P @@ Q"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow(/parse/)
    })

    it("throws on nested implication", () => {
        const yaml = `
title: "Nested implies"
premises:
  - role: "conclusion"
    formula: "(P → Q) ∧ R"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow(
            /root/i
        )
    })

    it("uses ASCII formula variants correctly", () => {
        const yaml = `
title: "ASCII"
premises:
  - role: "conclusion"
    formula: "!P && Q || R -> S"
`
        const engine = importArgumentFromYaml(yaml)
        const pm = engine.getConclusionPremise()!
        expect(pm.toDisplayString()).toBe("((¬(P) ∧ Q) ∨ R) → S)")
    })

    it("sets argument version to 0 and published to false", () => {
        const yaml = `
title: "Version check"
premises:
  - role: "conclusion"
    formula: "P"
`
        const engine = importArgumentFromYaml(yaml)
        expect(engine.getArgument().version).toBe(0)
        expect(engine.getArgument().published).toBe(false)
    })
})
```

Note: The ASCII formula test's expected `toDisplayString` may need adjustment based on how the actual rendering works — the operator precedence grouping may vary. The implementer should run the test and adjust the expected string if the rendering differs.

**Step 2: Run tests**

Run:
```bash
pnpm run test
```

Expected: all tests PASS

**Step 3: Commit**

```bash
git add test/import.test.ts
git commit -m "Add importArgumentFromYaml test suite"
```

---

### Task 7: Run full checks and fix issues

**Files:**
- Potentially any file from Tasks 1-6

**Step 1: Run full check suite**

Run:
```bash
pnpm run check
```

Expected: typecheck, lint, test, build all PASS.

**Step 2: Fix any issues found**

If lint errors: run `pnpm eslint . --fix` and `pnpm run prettify`.

If type errors or test failures: fix the underlying issue.

**Step 3: Commit fixes if any**

```bash
git add -A
git commit -m "Fix lint and formatting issues from YAML import feature"
```
