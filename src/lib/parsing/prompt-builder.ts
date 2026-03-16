import type { TSchema } from "typebox"
import type { TPromptOptions } from "./types.js"

/**
 * Core property keys for each sub-schema in the parsed argument response.
 * Used to distinguish extension fields from built-in fields.
 */
const CORE_CLAIM_KEYS = new Set(["miniId", "role", "sourceMiniIds"])
const CORE_VARIABLE_KEYS = new Set(["miniId", "symbol", "claimMiniId"])
const CORE_SOURCE_KEYS = new Set(["miniId", "text"])
const CORE_PREMISE_KEYS = new Set(["miniId", "formula"])
const CORE_ARGUMENT_KEYS = new Set([
    "claims",
    "variables",
    "sources",
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

## Writing Style

When formulating claims, write in third person, present tense, active voice. Each claim should be a clear, standalone declarative sentence.`

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

    // Claims: argument.claims is Array(ClaimSchema)
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

    // Sources: argument.sources is Array(SourceSchema)
    const sourcesArray = argumentSchema.properties?.sources
    if (sourcesArray?.items) {
        extensions.push(
            ...findExtensions(sourcesArray.items, CORE_SOURCE_KEYS, "source")
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
