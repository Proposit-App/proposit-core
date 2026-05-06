import type { TSchema } from "typebox"
import type { TPromptOptions } from "./types.js"

/**
 * Core property keys for each sub-schema in the parsed argument response.
 * Used to distinguish extension fields from built-in fields.
 */
const CORE_CLAIM_KEYS = new Set(["miniId", "role", "type", "citationMiniIds"])
const CORE_VARIABLE_KEYS = new Set(["miniId", "symbol", "claimMiniId"])
const CORE_PREMISE_KEYS = new Set(["miniId", "formula"])
const CORE_ARGUMENT_KEYS = new Set([
    "claims",
    "variables",
    "premises",
    "conclusionPremiseMiniId",
])
const CORE_RESPONSE_KEYS = new Set([
    "argument",
    "uncategorizedText",
    "selectionRationale",
    "failureText",
])

const CORE_PROMPT = `You are an expert argument analyst specializing in propositional logic. Your task is to analyze text and extract a structured propositional argument from it.

## Task

Given input text, identify:
1. The distinct claims (propositions) being made
2. Assign a variable (a short symbolic name) to each claim, one variable per claim
3. Write logical formula strings connecting those variables into premises
4. Identify which premise is the conclusion

## Formula Syntax

Formulas use infix notation with the following operators:

- **and**: logical conjunction (A and B)
- **or**: logical disjunction (A or B)
- **not**: logical negation (not A)
- **implies**: logical implication (A implies B)
- **iff**: logical biconditional (A iff B)
- **parentheses**: for grouping sub-expressions, e.g. (A or B) and C

### Root-Only Operators

The operators **implies** and **iff** must appear ONLY at the root level of a formula. They cannot be nested inside other operators. For example:
- Valid: "A implies B"
- Valid: "A and B"
- Invalid: "(A implies B) and C" — implies is nested, not at root

If you need to express a nested conditional, introduce an intermediate claim and a separate premise.

### Variable Declaration Rule

**Every symbol that appears in any premise formula MUST have a corresponding entry in the \`variables\` array, and every variable MUST reference a claim in the \`claims\` array.** If your argument requires intermediate reasoning steps — for example, when chaining implications across premises — you must declare a claim and variable for each intermediate proposition. A formula that references an undeclared symbol will be rejected and the premise will be dropped.

## Response Structure

Your response must conform to the provided JSON schema. Key fields:

- **argument**: The parsed argument object, or null if the text cannot be parsed as an argument
- **uncategorizedText**: Any portions of the input text that do not fit into the argument structure, or null
- **selectionRationale**: If the text contains multiple potential arguments, explain why you chose the one you did, or null
- **failureText**: If the argument cannot be parsed, explain why here, or null

## Edge Cases

- If the input text contains multiple distinct arguments, select the strongest or most complete one and explain your choice in selectionRationale.
- If the input text cannot be reasonably interpreted as a propositional argument, set argument to null and provide an explanation in failureText.
- If portions of the text are tangential or do not contribute to the argument, capture them in uncategorizedText.

## Variable Symbols

Each variable symbol should be a concise PascalCase summary of the claim it represents — short enough to scan at a glance, but specific enough to distinguish from other variables. Examples:

| Claim | Good symbol | Bad symbol |
|---|---|---|
| "The GDP grew an average of 4% every year for the past decade" | GDP_Growth | G |
| "Unrestricted free speech leads to the spread of misinformation" | FreeSpeech_Misinformation | Variable1 |
| "Increased funding reduces classroom overcrowding" | Funding_Reduces_Overcrowding | FundingEffect |

Use underscores to separate distinct concepts within a symbol when needed for clarity. Avoid single letters, numeric suffixes, or generic names like "Premise1".

Abbreviations are encouraged to keep symbols short. Aim for under 20 characters when possible. Examples: "Gross Domestic Product growth is 4%" → GDP_Growth, "The cost of a degree at most universities has risen sharply" → Uni_Cost_Increase, "Regulatory intervention is necessary" → Reg_Intervention.

## Writing Style

When formulating claims, write in third person, present tense, active voice. Each claim should be a clear, standalone declarative sentence.

## Claim Types

Every claim has a \`type\` field, which is one of:

- **\`"normal"\`**: a claim authored as part of the argument's primary reasoning (the propositions being argued for or from). Most claims are normal.
- **\`"citation"\`**: a claim representing **cited evidence** — an external reference, source, or citation that another claim relies on for support. Citation claims live in the **same** \`claims\` array as normal claims; they are NOT a separate array.

A citation claim is just a claim whose propositional content is "the cited material says/shows X". Logical relationships between *normal* claims are expressed through variables, formulas, and premises; citation evidence is expressed through the \`citationMiniIds\` link described below.

## Citation Links

A claim's \`citationMiniIds\` array links that claim to other claims (within the same \`claims\` array) that have \`type: "citation"\` and serve as cited evidence supporting it. It must contain only miniIds of claims with \`type: "citation"\` (e.g., \`["s1", "s2"]\`).

**Never put miniIds of normal-typed claims in \`citationMiniIds\`** — that is a common mistake. If claim A logically depends on claim B (where B is itself a normal claim being argued), express that dependency through a premise formula, not through \`citationMiniIds\`.

If the input text has no citations, leave every claim's \`citationMiniIds\` as an empty array \`[]\`. You only emit citation-typed claims when the input text actually references external evidence.

## Citation Claim Metadata

Citation claims may carry additional fields (e.g., \`url\`, \`citation\`) defined by the consuming application's schema extension. When such fields are present in your assigned output schema, populate them from the source material:

- Markdown links \`[text](url)\` → set the \`url\` field to the linked URL; the visible \`text\` typically informs the claim's natural-language content.
- Footnote markers, anchor references, or bracketed reference numbers → preserve the linked URL or reference target in whichever field the schema provides for it.
- Free-form citations (e.g., "as reported in The New York Times, January 5") → encode the citation text in the available \`citation\` (or equivalent) field.

Only populate fields that actually appear in your assigned output schema. Do not invent fields, and do not fabricate URLs or citation text that the source material does not contain.

## MiniId Conventions

Each entity type uses a distinct prefix for its miniId to avoid cross-reference confusion:

- Normal claims: \`c1\`, \`c2\`, \`c3\`, ...
- Citation claims: \`s1\`, \`s2\`, \`s3\`, ... (the \`s\` prefix is a UX convention to mark the cited-evidence role; semantically these are claims in the same \`claims\` array, distinguished only by their \`type: "citation"\` field)
- Variables: \`v1\`, \`v2\`, \`v3\`, ...
- Premises: \`p1\`, \`p2\`, \`p3\`, ...

Always use the correct prefix when referencing entities. Cross-type references are strict:
- \`citationMiniIds\` on a claim → only miniIds of claims with \`type: "citation"\` (typically \`s\`-prefixed by convention)
- \`claimMiniId\` on a variable → any claim in the \`claims\` array (typically \`c\`-prefixed; \`s\`-prefixed citation claims may also be referenced when their propositional content is part of the reasoning)
- \`conclusionPremiseMiniId\` → only \`p\`-prefixed miniIds (premises)

## Self-Check

Before finalizing your response, verify:
1. Every symbol that appears in any premise formula is declared in the \`variables\` array
2. Every variable's \`claimMiniId\` references an existing claim in the \`claims\` array
3. The \`conclusionPremiseMiniId\` references an existing premise in the \`premises\` array
4. No \`implies\` or \`iff\` operator is nested inside another operator in any formula
5. \`citationMiniIds\` on each claim contains only miniIds of claims whose \`type\` is \`"citation"\`, never miniIds of \`"normal"\`-typed claims
6. Every claim has a \`type\` field set to either \`"normal"\` or \`"citation"\``

type TSchemaLike = {
    properties?: Record<string, TSchemaLike>
    anyOf?: TSchemaLike[]
    items?: TSchemaLike
    type?: string
    description?: string
    minLength?: number
    maxLength?: number
}

/**
 * Unwrap a Nullable union (anyOf with null) to get the inner schema.
 */
function unwrapNullable(schema: TSchemaLike): TSchemaLike {
    if (schema.anyOf) {
        const nonNull = schema.anyOf.find(
            (s) => !(s.type === "null" || s.type === undefined)
        )
        if (nonNull) return nonNull
    }
    return schema
}

type TExtensionField = {
    entity: string
    field: string
    description?: string
    minLength?: number
    maxLength?: number
}

/**
 * Find extension fields in an object schema by comparing against known core keys.
 */
function findExtensions(
    schema: TSchemaLike | undefined,
    coreKeys: Set<string>,
    entityName: string
): TExtensionField[] {
    if (!schema?.properties) return []
    const extensions: TExtensionField[] = []
    for (const [key, fieldSchema] of Object.entries(schema.properties)) {
        if (coreKeys.has(key)) continue
        const unwrapped = unwrapNullable(fieldSchema)
        extensions.push({
            entity: entityName,
            field: key,
            description: unwrapped.description,
            minLength: unwrapped.minLength,
            maxLength: unwrapped.maxLength,
        })
    }
    return extensions
}

/**
 * Walk the response schema to discover all extension fields.
 */
function discoverExtensionFields(responseSchema: TSchema): TExtensionField[] {
    const schema = responseSchema as TSchemaLike
    const extensions: TExtensionField[] = []

    // Response-level extensions
    extensions.push(...findExtensions(schema, CORE_RESPONSE_KEYS, "response"))

    // Argument-level: response.argument is Nullable(ArgumentSchema)
    const argumentField = schema.properties?.argument
    if (!argumentField) return extensions
    const argumentSchema = unwrapNullable(argumentField)

    extensions.push(
        ...findExtensions(argumentSchema, CORE_ARGUMENT_KEYS, "argument")
    )

    // Claims (unified — covers both normal and citation typed claims):
    // argument.claims is Array(ClaimSchema)
    const claimsArray = argumentSchema.properties?.claims
    if (claimsArray?.items) {
        extensions.push(
            ...findExtensions(claimsArray.items, CORE_CLAIM_KEYS, "claim")
        )
    }

    // Variables: argument.variables is Array(VariableSchema)
    const variablesArray = argumentSchema.properties?.variables
    if (variablesArray?.items) {
        extensions.push(
            ...findExtensions(
                variablesArray.items,
                CORE_VARIABLE_KEYS,
                "variable"
            )
        )
    }

    // Premises: argument.premises is Array(PremiseSchema)
    const premisesArray = argumentSchema.properties?.premises
    if (premisesArray?.items) {
        extensions.push(
            ...findExtensions(premisesArray.items, CORE_PREMISE_KEYS, "premise")
        )
    }

    return extensions
}

/**
 * Format extension fields into instruction text.
 */
function formatExtensionInstructions(fields: TExtensionField[]): string {
    if (fields.length === 0) return ""

    const lines = ["\n\n## Extension Fields\n"]
    for (const field of fields) {
        const constraints: string[] = []
        if (field.description) {
            constraints.push(field.description)
        }
        if (field.minLength !== undefined) {
            constraints.push(`minLength: ${field.minLength}`)
        }
        if (field.maxLength !== undefined) {
            constraints.push(`maxLength: ${field.maxLength}`)
        }
        const constraintStr =
            constraints.length > 0 ? ` — ${constraints.join("; ")}` : ""
        lines.push(`- **${field.entity}.${field.field}**${constraintStr}`)
    }
    return lines.join("\n")
}

/**
 * Build the system prompt for LLM-based argument parsing.
 *
 * @param responseSchema - The TypeBox response schema (core or extended)
 * @param options - Optional configuration including custom instructions
 * @returns The complete system prompt string
 */
export function buildParsingPrompt(
    responseSchema: TSchema,
    options?: TPromptOptions
): string {
    let prompt = CORE_PROMPT

    const extensionFields = discoverExtensionFields(responseSchema)
    const extensionInstructions = formatExtensionInstructions(extensionFields)
    prompt += extensionInstructions

    if (options?.customInstructions) {
        prompt += `\n\n## Additional Instructions\n\n${options.customInstructions}`
    }

    return prompt
}
