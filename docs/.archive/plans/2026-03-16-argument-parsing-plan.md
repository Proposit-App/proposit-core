# Argument Parsing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-model-agnostic argument parsing module that converts structured AI responses into fully populated ArgumentEngine instances with libraries, plus a "basics" extension demonstrating metadata fields.

**Architecture:** Core parsing module in `src/lib/parsing/` defines response schemas, prompt builder, and a subclassable `ArgumentParser` class with two-phase validate→build API. Extension module in `src/extensions/basics/` adds title/body fields and subclasses the parser. Expression trees are built from formula strings via the existing `parseFormula()` function.

**Tech Stack:** TypeBox schemas, vitest, existing proposit-core engine API

**Spec:** `docs/plans/2026-03-16-argument-parsing-design.md`

---

## File Structure

### New files — Core parsing (`src/lib/parsing/`)

| File                                 | Responsibility                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/parsing/types.ts`           | `TPromptOptions`, `TParsingSchemaOptions` types                                                                               |
| `src/lib/parsing/schemata.ts`        | TypeBox response schemas (`ParsedArgumentResponseSchema`, etc.), `buildParsingResponseSchema()`, `getParsingResponseSchema()` |
| `src/lib/parsing/prompt-builder.ts`  | `buildParsingPrompt()` — hand-crafted core prompt + schema-driven extension instructions                                      |
| `src/lib/parsing/argument-parser.ts` | `ArgumentParser` class — validate + build + protected mapping hooks                                                           |
| `src/lib/parsing/index.ts`           | Barrel re-exports                                                                                                             |

### New files — Basics extension (`src/extensions/basics/`)

| File                                       | Responsibility                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/extensions/basics/schemata.ts`        | `TBasicsArgument`, `TBasicsClaim`, `TBasicsPremise` entity schemas + `BasicsParsingSchema` |
| `src/extensions/basics/argument-parser.ts` | `BasicsArgumentParser` subclass with metadata mapping hooks                                |
| `src/extensions/basics/index.ts`           | Barrel re-exports                                                                          |

### New test files

| File                             | Responsibility         |
| -------------------------------- | ---------------------- |
| `test/extensions/basics.test.ts` | Basics extension tests |

### Modified files

| File                | Change                                    |
| ------------------- | ----------------------------------------- |
| `src/lib/index.ts`  | Add parsing module exports                |
| `package.json`      | Add `./extensions/basics` export entry    |
| `test/core.test.ts` | Add parsing module test `describe` blocks |

---

## Chunk 1: Response schemas and schema extension mechanism

### Task 1: Parsing types

**Files:**

- Create: `src/lib/parsing/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/lib/parsing/types.ts
import type { TSchema } from "typebox"

export type TPromptOptions = {
    customInstructions?: string
}

export type TParsingSchemaOptions = {
    claimSchema?: TSchema
    sourceSchema?: TSchema
    variableSchema?: TSchema
    premiseSchema?: TSchema
    parsedArgumentSchema?: TSchema
    responseSchema?: TSchema
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no errors from new file)

- [ ] **Step 3: Commit**

```bash
git add src/lib/parsing/types.ts
git commit -m "feat(parsing): add TPromptOptions and TParsingSchemaOptions types"
```

### Task 2: Core response schemas

**Files:**

- Create: `src/lib/parsing/schemata.ts`
- Test: `test/core.test.ts` (new describe block)

- [ ] **Step 1: Write failing tests for core schemas**

Add a new `describe("Parsing — response schemas")` block at the bottom of `test/core.test.ts`:

```typescript
import { Value } from "typebox/value"
import {
    ParsedClaimRoleType,
    ParsedClaimSchema,
    ParsedVariableSchema,
    ParsedSourceSchema,
    ParsedPremiseSchema,
    ParsedArgumentSchema,
    ParsedArgumentResponseSchema,
    buildParsingResponseSchema,
    getParsingResponseSchema,
} from "../src/lib/parsing/schemata"
import type {
    TParsedClaim,
    TParsedVariable,
    TParsedSource,
    TParsedPremise,
    TParsedArgument,
    TParsedArgumentResponse,
} from "../src/lib/parsing/schemata"

describe("Parsing — response schemas", () => {
    describe("ParsedClaimSchema", () => {
        it("accepts a valid claim", () => {
            const claim: TParsedClaim = {
                miniId: "C1",
                role: "premise",
                sourceMiniIds: ["S1"],
            }
            expect(() => Value.Parse(ParsedClaimSchema, claim)).not.toThrow()
        })

        it("accepts additional properties", () => {
            const claim = {
                miniId: "C1",
                role: "conclusion",
                sourceMiniIds: [],
                title: "Some title",
            }
            expect(() => Value.Parse(ParsedClaimSchema, claim)).not.toThrow()
        })

        it("rejects invalid role", () => {
            const claim = {
                miniId: "C1",
                role: "invalid",
                sourceMiniIds: [],
            }
            expect(() => Value.Parse(ParsedClaimSchema, claim)).toThrow()
        })
    })

    describe("ParsedVariableSchema", () => {
        it("accepts a valid variable", () => {
            const variable: TParsedVariable = {
                miniId: "V1",
                symbol: "P",
                claimMiniId: "C1",
            }
            expect(() =>
                Value.Parse(ParsedVariableSchema, variable)
            ).not.toThrow()
        })
    })

    describe("ParsedSourceSchema", () => {
        it("accepts a valid source", () => {
            const source: TParsedSource = {
                miniId: "S1",
                text: "https://example.com",
            }
            expect(() => Value.Parse(ParsedSourceSchema, source)).not.toThrow()
        })
    })

    describe("ParsedPremiseSchema", () => {
        it("accepts a valid premise", () => {
            const premise: TParsedPremise = {
                miniId: "P1",
                formula: "V1 and V2 implies V3",
            }
            expect(() =>
                Value.Parse(ParsedPremiseSchema, premise)
            ).not.toThrow()
        })
    })

    describe("ParsedArgumentResponseSchema", () => {
        it("accepts a valid response with argument", () => {
            const response: TParsedArgumentResponse = {
                argument: {
                    claims: [
                        { miniId: "C1", role: "premise", sourceMiniIds: [] },
                        {
                            miniId: "C2",
                            role: "conclusion",
                            sourceMiniIds: [],
                        },
                    ],
                    variables: [
                        { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                        { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                    ],
                    sources: [],
                    premises: [{ miniId: "P1", formula: "V1 implies V2" }],
                    conclusionPremiseMiniId: "P1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(() =>
                Value.Parse(ParsedArgumentResponseSchema, response)
            ).not.toThrow()
        })

        it("accepts a null argument with failureText", () => {
            const response: TParsedArgumentResponse = {
                argument: null,
                uncategorizedText: null,
                selectionRationale: null,
                failureText: "No argument found in the text.",
            }
            expect(() =>
                Value.Parse(ParsedArgumentResponseSchema, response)
            ).not.toThrow()
        })

        it("accepts additional properties on nested schemas", () => {
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "C1",
                            role: "premise",
                            sourceMiniIds: [],
                            title: "Custom field",
                        },
                    ],
                    variables: [
                        { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                    ],
                    sources: [],
                    premises: [{ miniId: "P1", formula: "V1" }],
                    conclusionPremiseMiniId: "P1",
                    title: "Argument title",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(() =>
                Value.Parse(ParsedArgumentResponseSchema, response)
            ).not.toThrow()
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — cannot resolve `../src/lib/parsing/schemata`

- [ ] **Step 3: Implement core response schemas**

Create `src/lib/parsing/schemata.ts`:

```typescript
import Type, { type Static, type TObject, type TSchema } from "typebox"
import { Nullable } from "../schemata/shared.js"
import type { TParsingSchemaOptions } from "./types.js"

export const ParsedClaimRoleType = Type.Union([
    Type.Literal("premise"),
    Type.Literal("conclusion"),
    Type.Literal("intermediate"),
])

export const ParsedClaimSchema = Type.Object(
    {
        miniId: Type.String(),
        role: ParsedClaimRoleType,
        sourceMiniIds: Type.Array(Type.String()),
    },
    { additionalProperties: true }
)
export type TParsedClaim = Static<typeof ParsedClaimSchema>

export const ParsedVariableSchema = Type.Object(
    {
        miniId: Type.String(),
        symbol: Type.String(),
        claimMiniId: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedVariable = Static<typeof ParsedVariableSchema>

export const ParsedSourceSchema = Type.Object(
    {
        miniId: Type.String(),
        text: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedSource = Static<typeof ParsedSourceSchema>

export const ParsedPremiseSchema = Type.Object(
    {
        miniId: Type.String(),
        formula: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedPremise = Static<typeof ParsedPremiseSchema>

export const ParsedArgumentSchema = Type.Object(
    {
        claims: Type.Array(ParsedClaimSchema, { minItems: 1 }),
        variables: Type.Array(ParsedVariableSchema, { minItems: 1 }),
        sources: Type.Array(ParsedSourceSchema),
        premises: Type.Array(ParsedPremiseSchema, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedArgument = Static<typeof ParsedArgumentSchema>

export const ParsedArgumentResponseSchema = Type.Object(
    {
        argument: Nullable(ParsedArgumentSchema),
        uncategorizedText: Nullable(Type.String()),
        selectionRationale: Nullable(Type.String()),
        failureText: Nullable(Type.String()),
    },
    { additionalProperties: true }
)
export type TParsedArgumentResponse = Static<
    typeof ParsedArgumentResponseSchema
>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsing/schemata.ts test/core.test.ts
git commit -m "feat(parsing): add core response schemas with tests"
```

### Task 3: Schema extension mechanism — `buildParsingResponseSchema`

**Files:**

- Modify: `src/lib/parsing/schemata.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for `buildParsingResponseSchema`**

Add inside the `"Parsing — response schemas"` describe block:

```typescript
describe("buildParsingResponseSchema", () => {
    it("returns core schema with no options", () => {
        const schema = buildParsingResponseSchema()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [{ miniId: "C1", role: "premise", sourceMiniIds: [] }],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => Value.Parse(schema, response)).not.toThrow()
    })

    it("merges claim extension fields", () => {
        const schema = buildParsingResponseSchema({
            claimSchema: Type.Object({
                title: Type.String({ maxLength: 50 }),
            }),
        })
        const response = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        sourceMiniIds: [],
                        title: "My claim",
                    },
                ],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => Value.Parse(schema, response)).not.toThrow()
    })

    it("merges parsedArgumentSchema extension fields", () => {
        const schema = buildParsingResponseSchema({
            parsedArgumentSchema: Type.Object({
                title: Type.String({ maxLength: 50 }),
            }),
        })
        const response = {
            argument: {
                claims: [{ miniId: "C1", role: "premise", sourceMiniIds: [] }],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
                title: "Argument title",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => Value.Parse(schema, response)).not.toThrow()
    })

    it("merges multiple extension schemas simultaneously", () => {
        const schema = buildParsingResponseSchema({
            claimSchema: Type.Object({
                title: Type.String(),
                body: Type.String(),
            }),
            premiseSchema: Type.Object({
                title: Type.String(),
            }),
            parsedArgumentSchema: Type.Object({
                title: Type.String(),
            }),
        })
        const response = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        sourceMiniIds: [],
                        title: "Claim",
                        body: "Body",
                    },
                ],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [
                    {
                        miniId: "P1",
                        formula: "V1",
                        title: "Premise",
                    },
                ],
                conclusionPremiseMiniId: "P1",
                title: "Argument",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => Value.Parse(schema, response)).not.toThrow()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `buildParsingResponseSchema` not yet defined (or returns schema that doesn't merge extensions)

- [ ] **Step 3: Implement `buildParsingResponseSchema`**

Add to `src/lib/parsing/schemata.ts`:

```typescript
/**
 * Merges a base TypeBox Object schema with an extension Object schema,
 * combining their properties. Both schemas must be Type.Object instances.
 */
function mergeObjectSchemas(base: TObject, extension: TObject): TObject {
    return Type.Object(
        { ...base.properties, ...extension.properties },
        { additionalProperties: true }
    )
}

/**
 * Builds a (possibly extended) response schema by merging developer-provided
 * extension schemas into the core parsed response schemas.
 */
export function buildParsingResponseSchema(
    options?: TParsingSchemaOptions
): TSchema {
    if (!options) return ParsedArgumentResponseSchema

    const claimSch = options.claimSchema
        ? mergeObjectSchemas(ParsedClaimSchema, options.claimSchema as TObject)
        : ParsedClaimSchema

    const variableSch = options.variableSchema
        ? mergeObjectSchemas(
              ParsedVariableSchema,
              options.variableSchema as TObject
          )
        : ParsedVariableSchema

    const sourceSch = options.sourceSchema
        ? mergeObjectSchemas(
              ParsedSourceSchema,
              options.sourceSchema as TObject
          )
        : ParsedSourceSchema

    const premiseSch = options.premiseSchema
        ? mergeObjectSchemas(
              ParsedPremiseSchema,
              options.premiseSchema as TObject
          )
        : ParsedPremiseSchema

    const baseArgProps = {
        claims: Type.Array(claimSch, { minItems: 1 }),
        variables: Type.Array(variableSch, { minItems: 1 }),
        sources: Type.Array(sourceSch),
        premises: Type.Array(premiseSch, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
    }

    const argSch = options.parsedArgumentSchema
        ? Type.Object(
              {
                  ...baseArgProps,
                  ...(options.parsedArgumentSchema as TObject).properties,
              },
              { additionalProperties: true }
          )
        : Type.Object(baseArgProps, { additionalProperties: true })

    const baseResponseProps = {
        argument: Nullable(argSch),
        uncategorizedText: Nullable(Type.String()),
        selectionRationale: Nullable(Type.String()),
        failureText: Nullable(Type.String()),
    }

    const responseSch = options.responseSchema
        ? Type.Object(
              {
                  ...baseResponseProps,
                  ...(options.responseSchema as TObject).properties,
              },
              { additionalProperties: true }
          )
        : Type.Object(baseResponseProps, { additionalProperties: true })

    return responseSch
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsing/schemata.ts test/core.test.ts
git commit -m "feat(parsing): add buildParsingResponseSchema with extension merging"
```

### Task 4: JSON Schema utility — `getParsingResponseSchema`

**Files:**

- Modify: `src/lib/parsing/schemata.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for `getParsingResponseSchema`**

Add inside the `"Parsing — response schemas"` describe block:

```typescript
describe("getParsingResponseSchema", () => {
    it("returns a valid JSON Schema object from core schema", () => {
        const jsonSchema = getParsingResponseSchema()
        expect(jsonSchema).toHaveProperty("type", "object")
        expect(jsonSchema).toHaveProperty("properties")
        const props = (jsonSchema as Record<string, unknown>)
            .properties as Record<string, unknown>
        expect(props).toHaveProperty("argument")
        expect(props).toHaveProperty("uncategorizedText")
        expect(props).toHaveProperty("failureText")
    })

    it("returns JSON Schema from an extended schema", () => {
        const extended = buildParsingResponseSchema({
            claimSchema: Type.Object({
                title: Type.String({ maxLength: 50 }),
            }),
        })
        const jsonSchema = getParsingResponseSchema(extended)
        expect(jsonSchema).toHaveProperty("type", "object")
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `getParsingResponseSchema` not defined

- [ ] **Step 3: Implement `getParsingResponseSchema`**

Add to `src/lib/parsing/schemata.ts`:

```typescript
/**
 * Converts a TypeBox response schema to a plain JSON Schema object
 * for use with any AI model's structured output configuration.
 * TypeBox schemas are JSON Schema compatible — this produces a clean
 * copy without TypeBox internal metadata (Symbol-keyed properties).
 */
export function getParsingResponseSchema(
    schema?: TSchema
): Record<string, unknown> {
    const target = schema ?? ParsedArgumentResponseSchema
    return JSON.parse(JSON.stringify(target)) as Record<string, unknown>
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/schemata.ts test/core.test.ts
git commit -m "feat(parsing): add getParsingResponseSchema JSON Schema utility"
```

---

## Chunk 2: Prompt builder

### Task 5: Core prompt builder

**Files:**

- Create: `src/lib/parsing/prompt-builder.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for `buildParsingPrompt`**

Add a new `describe("Parsing — prompt builder")` block at the bottom of `test/core.test.ts`:

```typescript
import { buildParsingPrompt } from "../src/lib/parsing/prompt-builder"

describe("Parsing — prompt builder", () => {
    it("includes core instructions with default schema", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        expect(prompt).toContain("expert argument analyst")
        expect(prompt).toContain("propositional argument")
        expect(prompt).toContain("uncategorizedText")
        expect(prompt).toContain("selectionRationale")
        expect(prompt).toContain("failureText")
        expect(prompt).toContain("implies")
        expect(prompt).toContain("third person")
    })

    it("includes formula syntax rules", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        expect(prompt).toContain("and")
        expect(prompt).toContain("or")
        expect(prompt).toContain("not")
        expect(prompt).toContain("implies")
        expect(prompt).toContain("iff")
        expect(prompt).toContain("parentheses")
    })

    it("includes root-only constraint for implies and iff", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        expect(prompt).toMatch(/implies.*root/i)
        expect(prompt).toMatch(/iff.*root/i)
    })

    it("discovers extension fields and generates constraint instructions", () => {
        const extended = buildParsingResponseSchema({
            claimSchema: Type.Object({
                title: Type.String({
                    maxLength: 50,
                    description: "A short title for the claim",
                }),
                body: Type.String({ maxLength: 500 }),
            }),
        })
        const prompt = buildParsingPrompt(extended)
        expect(prompt).toContain("title")
        expect(prompt).toContain("50")
        expect(prompt).toContain("body")
        expect(prompt).toContain("500")
    })

    it("appends customInstructions", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema, {
            customInstructions: 'CMV means "change my view"',
        })
        expect(prompt).toContain('CMV means "change my view"')
    })

    it("does not include extension instructions for core-only schema", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        // Core schema has no extension fields, so no field-specific instructions
        // beyond the core template
        expect(prompt).not.toContain("maxLength")
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — cannot resolve `../src/lib/parsing/prompt-builder`

- [ ] **Step 3: Implement `buildParsingPrompt`**

Create `src/lib/parsing/prompt-builder.ts`:

```typescript
import type { TObject, TSchema } from "typebox"
import type { TPromptOptions } from "./types.js"
import { ParsedClaimSchema } from "./schemata.js"
import { ParsedVariableSchema } from "./schemata.js"
import { ParsedSourceSchema } from "./schemata.js"
import { ParsedPremiseSchema } from "./schemata.js"
import { ParsedArgumentSchema } from "./schemata.js"

const CORE_PROMPT = `You are an expert argument analyst. Your task is to analyze the provided text and convert it into a structured propositional argument representation.

## Instructions

1. **Identify claims** — Extract the atomic propositions (claims) made in the text. Each claim is a distinct statement that can be true or false. Assign each claim a unique miniId (e.g., "C1", "C2").

2. **Classify claim roles** — For each claim, assign a role:
   - "premise" — a foundational assertion taken as given
   - "conclusion" — the main point being argued for
   - "intermediate" — a derived step between premises and conclusion

3. **Assign variables** — Create one propositional variable per claim, with a unique miniId (e.g., "V1", "V2") and a short symbol (e.g., "P", "Q"). Link each variable to its claim via claimMiniId. If multiple premises reference the same claim, they must share the same variable.

4. **Extract sources** — If the text references URLs, citations, or other sources, extract them with a unique miniId (e.g., "S1") and the raw text. Link sources to claims via the claim's sourceMiniIds array.

5. **Construct premises** — Each premise represents a logical relationship between variables, expressed as a formula string. Assign each premise a unique miniId (e.g., "P1", "P2").

6. **Designate conclusion** — Set conclusionPremiseMiniId to the miniId of the premise that represents the main conclusion.

## Formula Syntax

Write formulas using variable miniIds as operands and the following operators:
- \`not\` — negation (e.g., \`not V1\`)
- \`and\` — conjunction (e.g., \`V1 and V2\`)
- \`or\` — disjunction (e.g., \`V1 or V2\`)
- \`implies\` — implication (e.g., \`V1 implies V2\`)
- \`iff\` — biconditional (e.g., \`V1 iff V2\`)
- Use parentheses for grouping (e.g., \`(V1 or V2) and V3\`)

**Critical constraint:** \`implies\` and \`iff\` operators must appear ONLY at the root level of a formula. They cannot be nested inside other operators. For example, \`V1 and V2 implies V3\` is valid, but \`V1 and (V2 implies V3)\` is NOT valid.

## Handling Edge Cases

- **Multiple arguments:** If the text contains multiple arguments, select the most substantial one. Set selectionRationale to explain why you chose it and what was excluded.
- **Irrelevant content:** Place any text that does not relate to the core argument in uncategorizedText.
- **Cannot parse:** If no argument can be constructed from the text, set argument to null and explain why in failureText.

## Writing Style

- Write all text in third person, present tense, and active voice
- Do not refer to the author; state their position directly`

/**
 * Set of property keys that belong to the core schemas.
 * Used to detect extension fields added by developers.
 */
const CORE_CLAIM_KEYS = new Set(Object.keys(ParsedClaimSchema.properties))
const CORE_VARIABLE_KEYS = new Set(Object.keys(ParsedVariableSchema.properties))
const CORE_SOURCE_KEYS = new Set(Object.keys(ParsedSourceSchema.properties))
const CORE_PREMISE_KEYS = new Set(Object.keys(ParsedPremiseSchema.properties))
const CORE_ARGUMENT_KEYS = new Set(Object.keys(ParsedArgumentSchema.properties))

interface TFieldMeta {
    name: string
    description?: string
    maxLength?: number
    minLength?: number
}

/**
 * Extracts extension field metadata from a schema object by comparing
 * its properties against known core keys.
 */
function extractExtensionFields(
    schema: TObject,
    coreKeys: Set<string>
): TFieldMeta[] {
    const fields: TFieldMeta[] = []
    for (const [key, prop] of Object.entries(schema.properties)) {
        if (coreKeys.has(key)) continue
        const fieldSchema = prop as TSchema
        fields.push({
            name: key,
            description: fieldSchema.description as string | undefined,
            maxLength: fieldSchema.maxLength as number | undefined,
            minLength: fieldSchema.minLength as number | undefined,
        })
    }
    return fields
}

function formatFieldInstruction(context: string, field: TFieldMeta): string {
    let instruction = `- For each ${context}, populate the \`${field.name}\` field`
    if (field.description) {
        instruction += `: ${field.description}`
    }
    const constraints: string[] = []
    if (field.minLength !== undefined) {
        constraints.push(`minimum ${field.minLength} characters`)
    }
    if (field.maxLength !== undefined) {
        constraints.push(`maximum ${field.maxLength} characters`)
    }
    if (constraints.length > 0) {
        instruction += ` (${constraints.join(", ")})`
    }
    return instruction
}

/**
 * Builds a system prompt for AI-based argument parsing.
 *
 * The core prompt is hand-crafted prose. Extension fields discovered
 * on the response schema generate additional instructions automatically
 * using each field's description, minLength, and maxLength attributes.
 */
export function buildParsingPrompt(
    responseSchema: TSchema,
    options?: TPromptOptions
): string {
    const sections: string[] = [CORE_PROMPT]

    // Discover extension fields from the response schema
    const extensionInstructions: string[] = []
    const responseSch = responseSchema as TObject
    const argSch = responseSch.properties?.argument

    if (argSch) {
        // Navigate through Nullable union to the object schema
        const argObjectSch = findObjectSchema(argSch as TSchema)

        if (argObjectSch) {
            // Argument-level extensions
            const argExtFields = extractExtensionFields(
                argObjectSch,
                CORE_ARGUMENT_KEYS
            )
            for (const f of argExtFields) {
                extensionInstructions.push(
                    formatFieldInstruction("argument", f)
                )
            }

            // Claim extensions
            const claimsSch = argObjectSch.properties?.claims as
                | TSchema
                | undefined
            if (claimsSch && "items" in claimsSch) {
                const claimItemSch = (claimsSch as { items: TObject }).items
                const claimExtFields = extractExtensionFields(
                    claimItemSch,
                    CORE_CLAIM_KEYS
                )
                for (const f of claimExtFields) {
                    extensionInstructions.push(
                        formatFieldInstruction("claim", f)
                    )
                }
            }

            // Variable extensions
            const varsSch = argObjectSch.properties?.variables as
                | TSchema
                | undefined
            if (varsSch && "items" in varsSch) {
                const varItemSch = (varsSch as { items: TObject }).items
                const varExtFields = extractExtensionFields(
                    varItemSch,
                    CORE_VARIABLE_KEYS
                )
                for (const f of varExtFields) {
                    extensionInstructions.push(
                        formatFieldInstruction("variable", f)
                    )
                }
            }

            // Source extensions
            const sourcesSch = argObjectSch.properties?.sources as
                | TSchema
                | undefined
            if (sourcesSch && "items" in sourcesSch) {
                const sourceItemSch = (sourcesSch as { items: TObject }).items
                const sourceExtFields = extractExtensionFields(
                    sourceItemSch,
                    CORE_SOURCE_KEYS
                )
                for (const f of sourceExtFields) {
                    extensionInstructions.push(
                        formatFieldInstruction("source", f)
                    )
                }
            }

            // Premise extensions
            const premisesSch = argObjectSch.properties?.premises as
                | TSchema
                | undefined
            if (premisesSch && "items" in premisesSch) {
                const premiseItemSch = (premisesSch as { items: TObject }).items
                const premiseExtFields = extractExtensionFields(
                    premiseItemSch,
                    CORE_PREMISE_KEYS
                )
                for (const f of premiseExtFields) {
                    extensionInstructions.push(
                        formatFieldInstruction("premise", f)
                    )
                }
            }
        }
    }

    if (extensionInstructions.length > 0) {
        sections.push(
            "## Additional Fields\n\n" + extensionInstructions.join("\n")
        )
    }

    if (options?.customInstructions) {
        sections.push("## Additional Context\n\n" + options.customInstructions)
    }

    return sections.join("\n\n")
}

/**
 * Navigates through Nullable (Union with Null) to find the Object schema.
 */
function findObjectSchema(schema: TSchema): TObject | null {
    if ("properties" in schema) return schema as TObject
    // Nullable wraps in a Union — look for the non-null member
    if ("anyOf" in schema) {
        const members = (schema as { anyOf: TSchema[] }).anyOf
        for (const member of members) {
            if ("properties" in member) return member as TObject
        }
    }
    return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS (fix any issues)

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/prompt-builder.ts test/core.test.ts
git commit -m "feat(parsing): add prompt builder with schema-driven extension discovery"
```

---

## Chunk 3: ArgumentParser class

### Task 6: ArgumentParser — validate phase

**Files:**

- Create: `src/lib/parsing/argument-parser.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for `ArgumentParser.validate`**

Add a new `describe("Parsing — ArgumentParser")` block at the bottom of `test/core.test.ts`:

```typescript
import { ArgumentParser } from "../src/lib/parsing/argument-parser"
import type { TParsedSource } from "../src/lib/parsing/schemata"

describe("Parsing — ArgumentParser", () => {
    function validResponse(): TParsedArgumentResponse {
        return {
            argument: {
                claims: [
                    { miniId: "C1", role: "premise", sourceMiniIds: [] },
                    { miniId: "C2", role: "conclusion", sourceMiniIds: [] },
                ],
                variables: [
                    { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                    { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                ],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1 implies V2" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
    }

    describe("validate", () => {
        it("accepts valid response JSON", () => {
            const parser = new ArgumentParser()
            const result = parser.validate(validResponse())
            expect(result.argument).not.toBeNull()
            expect(result.argument!.claims).toHaveLength(2)
        })

        it("accepts null argument with failureText", () => {
            const parser = new ArgumentParser()
            const result = parser.validate({
                argument: null,
                uncategorizedText: null,
                selectionRationale: null,
                failureText: "No argument found.",
            })
            expect(result.argument).toBeNull()
            expect(result.failureText).toBe("No argument found.")
        })

        it("throws on malformed input", () => {
            const parser = new ArgumentParser()
            expect(() => parser.validate({ foo: "bar" })).toThrow()
        })

        it("throws on missing required fields", () => {
            const parser = new ArgumentParser()
            expect(() =>
                parser.validate({
                    argument: { claims: [] },
                })
            ).toThrow()
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — cannot resolve `../src/lib/parsing/argument-parser`

- [ ] **Step 3: Implement ArgumentParser with validate method**

Create `src/lib/parsing/argument-parser.ts`:

```typescript
import { randomUUID } from "node:crypto"
import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import type { TCoreArgument } from "../schemata/argument.js"
import type {
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/propositional.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type {
    TCoreSource,
    TCoreClaimSourceAssociation,
} from "../schemata/source.js"
import {
    ParsedArgumentResponseSchema,
    type TParsedArgumentResponse,
    type TParsedClaim,
    type TParsedVariable,
    type TParsedSource,
    type TParsedPremise,
    type TParsedArgument,
} from "./schemata.js"
import type { ArgumentEngine } from "../core/argument-engine.js"
import type { ClaimLibrary } from "../core/claim-library.js"
import type { SourceLibrary } from "../core/source-library.js"
import type { ClaimSourceLibrary } from "../core/claim-source-library.js"

export type TArgumentParserResult<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    claimLibrary: ClaimLibrary<TClaim>
    sourceLibrary: SourceLibrary<TSource>
    claimSourceLibrary: ClaimSourceLibrary<TAssoc>
}

export class ArgumentParser<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    protected readonly responseSchema: TSchema

    constructor(responseSchema?: TSchema) {
        this.responseSchema = responseSchema ?? ParsedArgumentResponseSchema
    }

    /**
     * Validates raw JSON against the response schema.
     * @throws On invalid input.
     */
    public validate(raw: unknown): TParsedArgumentResponse {
        return Value.Parse(this.responseSchema, raw)
    }

    /**
     * Builds an ArgumentEngine and libraries from a validated response.
     * @throws If response.argument is null, or formulas are invalid.
     */
    public build(
        _response: TParsedArgumentResponse
    ): TArgumentParserResult<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    > {
        throw new Error("Not yet implemented")
    }

    protected mapArgument(_parsed: TParsedArgument): Record<string, unknown> {
        return {}
    }

    protected mapClaim(_parsed: TParsedClaim): Record<string, unknown> {
        return {}
    }

    protected mapSource(_parsed: TParsedSource): Record<string, unknown> {
        return {}
    }

    protected mapVariable(_parsed: TParsedVariable): Record<string, unknown> {
        return {}
    }

    protected mapPremise(_parsed: TParsedPremise): Record<string, unknown> {
        return {}
    }

    protected mapClaimSourceAssociation(
        _parsed: TParsedClaim,
        _claimId: string,
        _sourceId: string
    ): Record<string, unknown> {
        return {}
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parsing): add ArgumentParser with validate phase and mapping hooks"
```

### Task 7: ArgumentParser — build phase

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for `ArgumentParser.build`**

Add inside the existing `"Parsing — ArgumentParser"` describe block, after the `validate` tests. Reuse `validResponse()` from Task 6.

```typescript
describe("build", () => {
    it("produces ArgumentEngine and libraries from valid response", () => {
        const parser = new ArgumentParser()
        const response = validResponse()
        const result = parser.build(response)

        expect(result.engine).toBeDefined()
        expect(result.claimLibrary).toBeDefined()
        expect(result.sourceLibrary).toBeDefined()
        expect(result.claimSourceLibrary).toBeDefined()
    })

    it("creates claims in the claim library", () => {
        const parser = new ArgumentParser()
        const result = parser.build(validResponse())

        const claims = result.claimLibrary.getAll()
        expect(claims).toHaveLength(2)
    })

    it("creates variables bound to claims", () => {
        const parser = new ArgumentParser()
        const result = parser.build(validResponse())

        const snap = result.engine.snapshot()
        const vars = snap.variables.variables
        expect(vars).toHaveLength(2)
        // Variables should have symbols from the parsed response
        const symbols = vars.map((v) => v.symbol).sort()
        expect(symbols).toEqual(["P", "Q"])
    })

    it("creates premises with expression trees from formulas", () => {
        const parser = new ArgumentParser()
        const result = parser.build(validResponse())

        const snap = result.engine.snapshot()
        expect(snap.premises).toHaveLength(1)
        // "V1 implies V2" should produce an operator expression tree
        const premiseSnap = snap.premises[0]
        expect(premiseSnap.rootExpressionId).toBeDefined()
        expect(premiseSnap.expressions.expressions.length).toBeGreaterThan(0)
    })

    it("sets conclusion role based on conclusionPremiseMiniId", () => {
        const parser = new ArgumentParser()
        const result = parser.build(validResponse())

        const snap = result.engine.snapshot()
        expect(snap.conclusionPremiseId).toBeDefined()
    })

    it("wires claim-source associations", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        sourceMiniIds: ["S1"],
                    },
                ],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [{ miniId: "S1", text: "https://example.com" }],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        const result = parser.build(response)

        const assocSnapshot = result.claimSourceLibrary.snapshot()
        expect(assocSnapshot.claimSourceAssociations).toHaveLength(1)
    })

    it("shares variables across premises referencing the same claim", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    { miniId: "C1", role: "premise", sourceMiniIds: [] },
                    { miniId: "C2", role: "premise", sourceMiniIds: [] },
                    {
                        miniId: "C3",
                        role: "conclusion",
                        sourceMiniIds: [],
                    },
                ],
                variables: [
                    { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                    { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                    { miniId: "V3", symbol: "R", claimMiniId: "C3" },
                ],
                sources: [],
                premises: [
                    { miniId: "P1", formula: "V1 and V2 implies V3" },
                    { miniId: "P2", formula: "V1 implies V2" },
                ],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        const result = parser.build(response)

        const snap = result.engine.snapshot()
        // Only 3 variables total, shared across both premises
        expect(snap.variables.variables).toHaveLength(3)
        expect(snap.premises).toHaveLength(2)
    })

    it("throws on null argument", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: null,
            uncategorizedText: null,
            selectionRationale: null,
            failureText: "Cannot parse",
        }
        expect(() => parser.build(response)).toThrow(/argument is null/i)
    })

    it("throws on formula referencing undeclared variable miniId", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [{ miniId: "C1", role: "premise", sourceMiniIds: [] }],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [
                    {
                        miniId: "P1",
                        formula: "V1 and V99",
                    },
                ],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => parser.build(response)).toThrow(/V99/)
    })

    it("throws on nested implies in formula", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    { miniId: "C1", role: "premise", sourceMiniIds: [] },
                    { miniId: "C2", role: "premise", sourceMiniIds: [] },
                    {
                        miniId: "C3",
                        role: "conclusion",
                        sourceMiniIds: [],
                    },
                ],
                variables: [
                    { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                    { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                    { miniId: "V3", symbol: "R", claimMiniId: "C3" },
                ],
                sources: [],
                premises: [
                    {
                        miniId: "P1",
                        formula: "V1 and (V2 implies V3)",
                    },
                ],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => parser.build(response)).toThrow(/implies/i)
    })

    it("throws on variable referencing undeclared claim miniId", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [{ miniId: "C1", role: "premise", sourceMiniIds: [] }],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C99" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => parser.build(response)).toThrow(/C99/)
    })

    it("throws on unresolvable conclusionPremiseMiniId", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [{ miniId: "C1", role: "premise", sourceMiniIds: [] }],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P99",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => parser.build(response)).toThrow(/P99/)
    })

    it("throws on invalid formula syntax", () => {
        const parser = new ArgumentParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [{ miniId: "C1", role: "premise", sourceMiniIds: [] }],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "V1 &&& V2" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        expect(() => parser.build(response)).toThrow(/P1/)
    })
})

describe("subclass hooks", () => {
    it("calls mapClaim and reflects extension fields", () => {
        class TestParser extends ArgumentParser {
            protected mapClaim(parsed: TParsedClaim) {
                return {
                    customField: `claim-${parsed.miniId}`,
                }
            }
        }
        const parser = new TestParser()
        const result = parser.build(validResponse())
        const claims = result.claimLibrary.getAll()
        expect(
            claims.some(
                (c) => (c as Record<string, unknown>).customField === "claim-C1"
            )
        ).toBe(true)
    })

    it("calls mapPremise and reflects extension fields", () => {
        class TestParser extends ArgumentParser {
            protected mapPremise(parsed: TParsedPremise) {
                return {
                    customField: `premise-${parsed.miniId}`,
                }
            }
        }
        const parser = new TestParser()
        const result = parser.build(validResponse())
        const snap = result.engine.snapshot()
        expect(
            snap.premises.some(
                (p) =>
                    (p.premise as Record<string, unknown>).customField ===
                    "premise-P1"
            )
        ).toBe(true)
    })

    it("calls mapVariable and reflects extension fields", () => {
        class TestParser extends ArgumentParser {
            protected mapVariable(parsed: TParsedVariable) {
                return {
                    customField: `var-${parsed.miniId}`,
                }
            }
        }
        const parser = new TestParser()
        const result = parser.build(validResponse())
        const snap = result.engine.snapshot()
        expect(
            snap.variables.variables.some(
                (v) => (v as Record<string, unknown>).customField === "var-V1"
            )
        ).toBe(true)
    })

    it("calls mapArgument and reflects extension fields", () => {
        class TestParser extends ArgumentParser {
            protected mapArgument() {
                return { customField: "arg-extra" }
            }
        }
        const parser = new TestParser()
        const result = parser.build(validResponse())
        const snap = result.engine.snapshot()
        expect((snap.argument as Record<string, unknown>).customField).toBe(
            "arg-extra"
        )
    })

    it("calls mapSource and reflects extension fields", () => {
        class TestParser extends ArgumentParser {
            protected mapSource(parsed: TParsedSource) {
                return { customField: `source-${parsed.miniId}` }
            }
        }
        const parser = new TestParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        sourceMiniIds: [],
                    },
                ],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [{ miniId: "S1", text: "https://example.com" }],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        const result = parser.build(response)
        const sources = result.sourceLibrary.getAll()
        expect(
            sources.some(
                (s) =>
                    (s as Record<string, unknown>).customField === "source-S1"
            )
        ).toBe(true)
    })

    it("calls mapClaimSourceAssociation and reflects extension fields", () => {
        class TestParser extends ArgumentParser {
            protected mapClaimSourceAssociation() {
                return { customField: "assoc-extra" }
            }
        }
        const parser = new TestParser()
        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        sourceMiniIds: ["S1"],
                    },
                ],
                variables: [{ miniId: "V1", symbol: "P", claimMiniId: "C1" }],
                sources: [{ miniId: "S1", text: "https://example.com" }],
                premises: [{ miniId: "P1", formula: "V1" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        const result = parser.build(response)
        const assocs =
            result.claimSourceLibrary.snapshot().claimSourceAssociations
        expect(
            assocs.some(
                (a) =>
                    (a as Record<string, unknown>).customField === "assoc-extra"
            )
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `build()` throws "Not yet implemented"

- [ ] **Step 3: Implement the build method**

Replace the `build` stub in `src/lib/parsing/argument-parser.ts` with the full implementation. The approach reuses `validateRootOnly`, `collectVariableNames`, and `buildExpressions` patterns from `src/cli/import.ts`.

Add these imports at the top:

```typescript
import { randomUUID } from "node:crypto"
import type { TClaimBoundVariable } from "../schemata/propositional.js"
import { parseFormula } from "../core/parser/formula.js"
import type { TFormulaAST } from "../core/parser/formula.js"
import type { TExpressionInput } from "../core/expression-manager.js"
import { POSITION_INITIAL } from "../utils/position.js"
import { ArgumentEngine } from "../core/argument-engine.js"
import { ClaimLibrary } from "../core/claim-library.js"
import { SourceLibrary } from "../core/source-library.js"
import { ClaimSourceLibrary } from "../core/claim-source-library.js"
```

Remove `type` from the existing ArgumentEngine, ClaimLibrary, SourceLibrary, ClaimSourceLibrary imports (they are now value imports, not type-only).

Add these private helper methods to the class:

```typescript
    /** Validates that implies/iff appear only at AST root. */
    private validateRootOnly(
        ast: TFormulaAST,
        isRoot: boolean,
        premiseMiniId: string
    ): void {
        if (!isRoot && (ast.type === "implies" || ast.type === "iff")) {
            throw new Error(
                `Premise "${premiseMiniId}": ${ast.type} operator must appear only at the root of a formula, not nested.`
            )
        }
        switch (ast.type) {
            case "variable":
                break
            case "not":
                this.validateRootOnly(ast.operand, false, premiseMiniId)
                break
            case "and":
            case "or":
                for (const op of ast.operands) {
                    this.validateRootOnly(op, false, premiseMiniId)
                }
                break
            case "implies":
            case "iff":
                this.validateRootOnly(ast.left, false, premiseMiniId)
                this.validateRootOnly(ast.right, false, premiseMiniId)
                break
        }
    }

    /** Collects all variable names from a formula AST. */
    private collectVariableNames(
        ast: TFormulaAST,
        names: Set<string>
    ): void {
        switch (ast.type) {
            case "variable":
                names.add(ast.name)
                break
            case "not":
                this.collectVariableNames(ast.operand, names)
                break
            case "and":
            case "or":
                for (const op of ast.operands) {
                    this.collectVariableNames(op, names)
                }
                break
            case "implies":
            case "iff":
                this.collectVariableNames(ast.left, names)
                this.collectVariableNames(ast.right, names)
                break
        }
    }

    /** Recursively builds expression nodes from a formula AST. */
    private buildExpressions(
        ast: TFormulaAST,
        parentId: string | null,
        position: number,
        argumentId: string,
        argumentVersion: number,
        premiseId: string,
        variablesByMiniId: Map<string, string>,
        addExpression: (expr: TExpressionInput) => void
    ): string {
        const id = randomUUID()
        switch (ast.type) {
            case "variable": {
                const variableId = variablesByMiniId.get(ast.name)!
                addExpression({
                    id,
                    argumentId,
                    argumentVersion,
                    premiseId,
                    type: "variable",
                    variableId,
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
                    premiseId,
                    type: "operator",
                    operator: "not",
                    parentId,
                    position,
                })
                this.buildExpressions(
                    ast.operand, id, 0,
                    argumentId, argumentVersion, premiseId,
                    variablesByMiniId, addExpression
                )
                return id
            }
            case "and":
            case "or": {
                addExpression({
                    id,
                    argumentId,
                    argumentVersion,
                    premiseId,
                    type: "operator",
                    operator: ast.type,
                    parentId,
                    position,
                })
                for (let i = 0; i < ast.operands.length; i++) {
                    this.buildExpressions(
                        ast.operands[i], id, i,
                        argumentId, argumentVersion, premiseId,
                        variablesByMiniId, addExpression
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
                    premiseId,
                    type: "operator",
                    operator: ast.type,
                    parentId,
                    position,
                })
                this.buildExpressions(
                    ast.left, id, 0,
                    argumentId, argumentVersion, premiseId,
                    variablesByMiniId, addExpression
                )
                this.buildExpressions(
                    ast.right, id, 1,
                    argumentId, argumentVersion, premiseId,
                    variablesByMiniId, addExpression
                )
                return id
            }
        }
    }
```

Replace the `build` method stub:

```typescript
    public build(
        response: TParsedArgumentResponse
    ): TArgumentParserResult<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        if (response.argument === null) {
            throw new Error(
                "Cannot build: argument is null. Check failureText for details."
            )
        }

        const arg = response.argument

        // Step 1: Validate all formulas upfront
        const parsedFormulas = new Map<string, TFormulaAST>()
        const declaredVarMiniIds = new Set(arg.variables.map((v) => v.miniId))

        for (const premise of arg.premises) {
            let ast: TFormulaAST
            try {
                ast = parseFormula(premise.formula)
            } catch (error) {
                const msg =
                    error instanceof Error ? error.message : String(error)
                throw new Error(
                    `Premise "${premise.miniId}": failed to parse formula: ${msg}`
                )
            }

            this.validateRootOnly(ast, true, premise.miniId)

            const usedNames = new Set<string>()
            this.collectVariableNames(ast, usedNames)
            for (const name of usedNames) {
                if (!declaredVarMiniIds.has(name)) {
                    throw new Error(
                        `Premise "${premise.miniId}": formula references undeclared variable "${name}".`
                    )
                }
            }

            parsedFormulas.set(premise.miniId, ast)
        }

        // Step 2: Create argument
        const argumentId = randomUUID()
        const argumentVersion = 0
        const argExtras = this.mapArgument(arg)
        const argument = {
            id: argumentId,
            version: argumentVersion,
            ...argExtras,
        } as TArg

        // Step 3: Create claims
        const claimLibrary = new ClaimLibrary<TClaim>()
        const claimMiniIdToId = new Map<string, { id: string; version: number }>()

        for (const parsedClaim of arg.claims) {
            const claimId = randomUUID()
            const extras = this.mapClaim(parsedClaim)
            const claim = claimLibrary.create({
                id: claimId,
                ...extras,
            } as Omit<TClaim, "version" | "frozen" | "checksum">)
            claimMiniIdToId.set(parsedClaim.miniId, {
                id: claim.id,
                version: claim.version,
            })
        }

        // Step 4: Create sources
        const sourceLibrary = new SourceLibrary<TSource>()
        const sourceMiniIdToId = new Map<string, { id: string; version: number }>()

        for (const parsedSource of arg.sources) {
            const sourceId = randomUUID()
            const extras = this.mapSource(parsedSource)
            const source = sourceLibrary.create({
                id: sourceId,
                ...extras,
            } as Omit<TSource, "version" | "frozen" | "checksum">)
            sourceMiniIdToId.set(parsedSource.miniId, {
                id: source.id,
                version: source.version,
            })
        }

        // Step 5: Wire claim-source associations
        const claimSourceLibrary = new ClaimSourceLibrary<TAssoc>(
            claimLibrary,
            sourceLibrary
        )

        for (const parsedClaim of arg.claims) {
            const claimRef = claimMiniIdToId.get(parsedClaim.miniId)!
            for (const sourceMiniId of parsedClaim.sourceMiniIds) {
                const sourceRef = sourceMiniIdToId.get(sourceMiniId)
                if (!sourceRef) continue
                const extras = this.mapClaimSourceAssociation(
                    parsedClaim,
                    claimRef.id,
                    sourceRef.id
                )
                claimSourceLibrary.add({
                    id: randomUUID(),
                    claimId: claimRef.id,
                    claimVersion: claimRef.version,
                    sourceId: sourceRef.id,
                    sourceVersion: sourceRef.version,
                    ...extras,
                } as Omit<TAssoc, "checksum">)
            }
        }

        // Step 6: Create engine
        const engine = new ArgumentEngine<
            TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc
        >(argument, claimLibrary, sourceLibrary, claimSourceLibrary)

        // Step 7: Create variables
        const variableMiniIdToId = new Map<string, string>()

        for (const parsedVar of arg.variables) {
            const varId = randomUUID()
            const claimRef = claimMiniIdToId.get(parsedVar.claimMiniId)
            if (!claimRef) {
                throw new Error(
                    `Variable "${parsedVar.miniId}" references undeclared claim "${parsedVar.claimMiniId}".`
                )
            }
            const extras = this.mapVariable(parsedVar)
            engine.addVariable({
                id: varId,
                argumentId,
                argumentVersion,
                symbol: parsedVar.symbol,
                claimId: claimRef.id,
                claimVersion: claimRef.version,
                ...extras,
            } as TClaimBoundVariable & Record<string, unknown>)
            variableMiniIdToId.set(parsedVar.miniId, varId)
        }

        // Step 8: Create premises and build expression trees
        const premiseMiniIdToId = new Map<string, string>()

        for (const parsedPremise of arg.premises) {
            const extras = this.mapPremise(parsedPremise)
            const { result: pm } = engine.createPremise(extras)
            premiseMiniIdToId.set(parsedPremise.miniId, pm.getId())

            const ast = parsedFormulas.get(parsedPremise.miniId)!
            this.buildExpressions(
                ast,
                null,
                POSITION_INITIAL,
                argumentId,
                argumentVersion,
                pm.getId(),
                variableMiniIdToId,
                (expr) => pm.addExpression(expr)
            )
        }

        // Step 9: Set conclusion role
        const conclusionPremiseId = premiseMiniIdToId.get(
            arg.conclusionPremiseMiniId
        )
        if (!conclusionPremiseId) {
            throw new Error(
                `conclusionPremiseMiniId "${arg.conclusionPremiseMiniId}" does not match any declared premise.`
            )
        }
        engine.setConclusionPremise(conclusionPremiseId)

        return {
            engine,
            claimLibrary,
            sourceLibrary,
            claimSourceLibrary,
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS (fix lint/type issues if any)

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/core.test.ts
git commit -m "feat(parsing): implement ArgumentParser build phase with formula validation"
```

### Task 8: Parsing barrel and library exports

**Files:**

- Create: `src/lib/parsing/index.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Create parsing barrel**

```typescript
// src/lib/parsing/index.ts
export {
    ParsedClaimRoleType,
    ParsedClaimSchema,
    ParsedVariableSchema,
    ParsedSourceSchema,
    ParsedPremiseSchema,
    ParsedArgumentSchema,
    ParsedArgumentResponseSchema,
    buildParsingResponseSchema,
    getParsingResponseSchema,
} from "./schemata.js"
export type {
    TParsedClaim,
    TParsedVariable,
    TParsedSource,
    TParsedPremise,
    TParsedArgument,
    TParsedArgumentResponse,
} from "./schemata.js"
export { ArgumentParser } from "./argument-parser.js"
export type { TArgumentParserResult } from "./argument-parser.js"
export { buildParsingPrompt } from "./prompt-builder.js"
export type { TPromptOptions, TParsingSchemaOptions } from "./types.js"
```

- [ ] **Step 2: Add parsing exports to library barrel**

Add to `src/lib/index.ts`:

```typescript
export * from "./parsing/index.js"
```

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/parsing/index.ts src/lib/index.ts
git commit -m "feat(parsing): add barrel exports for parsing module"
```

---

## Chunk 4: Basics extension

### Task 9: Basics entity schemas

**Files:**

- Create: `src/extensions/basics/schemata.ts`

- [ ] **Step 1: Create basics schemas**

```typescript
// src/extensions/basics/schemata.ts
import Type, { type Static } from "typebox"
import { CoreArgumentSchema } from "../../lib/schemata/argument.js"
import { CoreClaimSchema } from "../../lib/schemata/claim.js"
import { CorePremiseSchema } from "../../lib/schemata/propositional.js"
import { buildParsingResponseSchema } from "../../lib/parsing/schemata.js"

// --- Core entity extensions ---

export const BasicsArgumentSchema = Type.Intersect([
    CoreArgumentSchema,
    Type.Object({
        title: Type.String(),
        description: Type.Optional(Type.String()),
    }),
])
export type TBasicsArgument = Static<typeof BasicsArgumentSchema>

export const BasicsClaimSchema = Type.Intersect([
    CoreClaimSchema,
    Type.Object({
        title: Type.String(),
        body: Type.String(),
    }),
])
export type TBasicsClaim = Static<typeof BasicsClaimSchema>

export const BasicsPremiseSchema = Type.Intersect([
    CorePremiseSchema,
    Type.Object({
        title: Type.String(),
    }),
])
export type TBasicsPremise = Static<typeof BasicsPremiseSchema>

// --- Parsing response extensions ---

const BasicsClaimExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title summarizing the claim",
    }),
    body: Type.String({
        maxLength: 500,
        description: "A detailed description of the claim",
    }),
})

const BasicsPremiseExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for this premise",
    }),
})

const BasicsArgumentExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for the argument",
    }),
})

/** Pre-built extended response schema with basics metadata fields. */
export const BasicsParsingSchema = buildParsingResponseSchema({
    claimSchema: BasicsClaimExtension,
    premiseSchema: BasicsPremiseExtension,
    parsedArgumentSchema: BasicsArgumentExtension,
})
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extensions/basics/schemata.ts
git commit -m "feat(basics): add entity schemas and parsing response extensions"
```

### Task 10: BasicsArgumentParser

**Files:**

- Create: `src/extensions/basics/argument-parser.ts`

- [ ] **Step 1: Create BasicsArgumentParser**

```typescript
// src/extensions/basics/argument-parser.ts
import { ArgumentParser } from "../../lib/parsing/argument-parser.js"
import type {
    TParsedClaim,
    TParsedPremise,
    TParsedArgument,
} from "../../lib/parsing/schemata.js"
import { BasicsParsingSchema } from "./schemata.js"
import type {
    TBasicsArgument,
    TBasicsClaim,
    TBasicsPremise,
} from "./schemata.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../lib/schemata/propositional.js"
import type { TCoreSource } from "../../lib/schemata/source.js"
import type { TCoreClaimSourceAssociation } from "../../lib/schemata/source.js"

export class BasicsArgumentParser extends ArgumentParser<
    TBasicsArgument,
    TBasicsPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreSource,
    TBasicsClaim,
    TCoreClaimSourceAssociation
> {
    constructor() {
        super(BasicsParsingSchema)
    }

    protected mapArgument(parsed: TParsedArgument): Record<string, unknown> {
        const ext = parsed as Record<string, unknown>
        return {
            ...(ext.title !== undefined ? { title: ext.title } : {}),
        }
    }

    protected mapClaim(parsed: TParsedClaim): Record<string, unknown> {
        const ext = parsed as Record<string, unknown>
        return {
            ...(ext.title !== undefined ? { title: ext.title } : {}),
            ...(ext.body !== undefined ? { body: ext.body } : {}),
        }
    }

    protected mapPremise(parsed: TParsedPremise): Record<string, unknown> {
        const ext = parsed as Record<string, unknown>
        return {
            ...(ext.title !== undefined ? { title: ext.title } : {}),
        }
    }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extensions/basics/argument-parser.ts
git commit -m "feat(basics): add BasicsArgumentParser subclass"
```

### Task 11: Basics barrel and package.json exports

**Files:**

- Create: `src/extensions/basics/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Create basics barrel**

```typescript
// src/extensions/basics/index.ts
export {
    BasicsArgumentSchema,
    BasicsClaimSchema,
    BasicsPremiseSchema,
    BasicsParsingSchema,
} from "./schemata.js"
export type {
    TBasicsArgument,
    TBasicsClaim,
    TBasicsPremise,
} from "./schemata.js"
export { BasicsArgumentParser } from "./argument-parser.js"
```

- [ ] **Step 2: Add package.json exports entry**

Add to the `"exports"` field in `package.json`:

```json
"./extensions/basics": {
    "types": "./dist/extensions/basics/index.d.ts",
    "import": "./dist/extensions/basics/index.js"
}
```

- [ ] **Step 3: Run build to verify everything compiles**

Run: `pnpm run build`
Expected: PASS — dist/ includes `extensions/basics/` files

- [ ] **Step 4: Commit**

```bash
git add src/extensions/basics/index.ts package.json
git commit -m "feat(basics): add barrel exports and package.json entry"
```

### Task 12: Basics extension tests

**Depends on:** Task 11 (barrel + package.json exports)

**Files:**

- Create: `test/extensions/basics.test.ts`

- [ ] **Step 1: Write basics extension tests**

```typescript
import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import {
    BasicsArgumentParser,
    BasicsParsingSchema,
    BasicsArgumentSchema,
    BasicsClaimSchema,
    BasicsPremiseSchema,
} from "../../src/extensions/basics"
import type { TParsedArgumentResponse } from "../../src/lib/parsing/schemata"

function basicsResponse(): TParsedArgumentResponse & Record<string, unknown> {
    return {
        argument: {
            claims: [
                {
                    miniId: "C1",
                    role: "premise" as const,
                    sourceMiniIds: [],
                    title: "Earth is warming",
                    body: "Global average temperatures have increased over the past century.",
                },
                {
                    miniId: "C2",
                    role: "conclusion" as const,
                    sourceMiniIds: [],
                    title: "Action needed",
                    body: "Immediate action is required to address climate change.",
                },
            ],
            variables: [
                { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
            ],
            sources: [],
            premises: [
                {
                    miniId: "P1",
                    formula: "V1 implies V2",
                    title: "Warming implies action",
                },
            ],
            conclusionPremiseMiniId: "P1",
            title: "Climate argument",
        },
        uncategorizedText: null,
        selectionRationale: null,
        failureText: null,
    }
}

describe("Basics extension", () => {
    describe("BasicsParsingSchema", () => {
        it("validates a response with title and body fields", () => {
            expect(() =>
                Value.Parse(BasicsParsingSchema, basicsResponse())
            ).not.toThrow()
        })

        it("includes title/body constraints from schema", () => {
            // BasicsParsingSchema should contain the extended claim fields
            const schemaStr = JSON.stringify(BasicsParsingSchema)
            expect(schemaStr).toContain("title")
            expect(schemaStr).toContain("body")
        })
    })

    describe("entity schemas", () => {
        it("BasicsArgumentSchema extends core with title", () => {
            const arg = {
                id: "arg-1",
                version: 0,
                checksum: "abc",
                title: "My argument",
            }
            expect(() => Value.Parse(BasicsArgumentSchema, arg)).not.toThrow()
        })

        it("BasicsClaimSchema extends core with title and body", () => {
            const claim = {
                id: "claim-1",
                version: 0,
                frozen: false,
                checksum: "abc",
                title: "My claim",
                body: "Full description",
            }
            expect(() => Value.Parse(BasicsClaimSchema, claim)).not.toThrow()
        })

        it("BasicsPremiseSchema extends core with title", () => {
            const premise = {
                id: "prem-1",
                argumentId: "arg-1",
                argumentVersion: 0,
                checksum: "abc",
                title: "My premise",
            }
            expect(() =>
                Value.Parse(BasicsPremiseSchema, premise)
            ).not.toThrow()
        })
    })

    describe("BasicsArgumentParser", () => {
        it("maps title/body onto claims", () => {
            const parser = new BasicsArgumentParser()
            const result = parser.build(parser.validate(basicsResponse()))
            const claims = result.claimLibrary.getAll()
            const claim = claims.find(
                (c) =>
                    (c as Record<string, unknown>).title === "Earth is warming"
            )
            expect(claim).toBeDefined()
            expect((claim as Record<string, unknown>).body).toBe(
                "Global average temperatures have increased over the past century."
            )
        })

        it("maps title onto premises", () => {
            const parser = new BasicsArgumentParser()
            const result = parser.build(parser.validate(basicsResponse()))
            const snap = result.engine.snapshot()
            const premise = snap.premises[0]
            expect((premise.premise as Record<string, unknown>).title).toBe(
                "Warming implies action"
            )
        })

        it("maps title onto argument", () => {
            const parser = new BasicsArgumentParser()
            const result = parser.build(parser.validate(basicsResponse()))
            const snap = result.engine.snapshot()
            expect((snap.argument as Record<string, unknown>).title).toBe(
                "Climate argument"
            )
        })

        it("round-trip: parse → build → snapshot preserves metadata", () => {
            const parser = new BasicsArgumentParser()
            const validated = parser.validate(basicsResponse())
            const result = parser.build(validated)
            const snap = result.engine.snapshot()

            // Argument has title
            expect(snap.argument).toHaveProperty("title")

            // Premises have titles
            expect(snap.premises).toHaveLength(1)
            expect(snap.premises[0].premise).toHaveProperty("title")

            // Variables exist with correct symbols
            expect(snap.variables.variables).toHaveLength(2)
            const symbols = snap.variables.variables.map((v) => v.symbol).sort()
            expect(symbols).toEqual(["P", "Q"])

            // Expression tree exists
            expect(snap.premises[0].rootExpressionId).toBeDefined()
            expect(
                snap.premises[0].expressions.expressions.length
            ).toBeGreaterThan(0)
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/extensions/basics.test.ts
git commit -m "test(basics): add basics extension tests"
```

---

## Chunk 5: Final verification and cleanup

### Task 13: Full check

**Files:** None (verification only)

- [ ] **Step 1: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck + lint + test + build)

- [ ] **Step 2: Fix any issues**

If lint or formatting issues arise:
Run: `pnpm run prettify && pnpm eslint . --fix`
Then re-run: `pnpm run check`

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint and formatting"
```

### Task 14: Update library barrel exports in test imports

**Files:** Verify `test/core.test.ts` imports

- [ ] **Step 1: Verify test imports use library barrel where possible**

Check that the new parsing tests import from `../src/lib/parsing/schemata` (direct module) or `../src/lib/index` (barrel). Both are acceptable since tests are internal.

- [ ] **Step 2: Verify no unused imports or dead code**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS

- [ ] **Step 3: Commit if changes were needed**

Only commit if files were modified.
