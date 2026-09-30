// TypeBox → OpenAI Responses-API strict-mode JSON Schema converter.
//
// The kind-by-kind walk (and the supported TypeBox subset) is shared
// with the chat-completions converter in
// `../structured-output/typebox-converter.ts`. What is specific to
// OpenAI strict mode is how an Object is written:
//
//   * Every object lists `additionalProperties: false`.
//   * Every object lists **every** declared property name in
//     `required` — strict mode rejects a schema that leaves a declared
//     key out of `required`.
//   * A `Type.Optional(T)` property surfaces as
//     `{ anyOf: [<T>, { type: "null" }] }` and stays in `required`.
//     This is how strict mode expresses "this field can be absent": the
//     model emits `null` when no value applies, and the downstream
//     TypeBox check treats null and undefined alike for Optional
//     members.

import type { TSchema } from "typebox"
import {
    createTypeboxConverter,
    isOptional,
    type TSchemaConverter,
} from "../structured-output/typebox-converter.js"

/**
 * The output shape is intentionally typed as a plain object literal
 * (not a full JSON-Schema TS type) — the OpenAI Responses API
 * accepts this shape and we round-trip it through JSON.stringify
 * when building the request body. Keeping the return type loose
 * avoids dragging a JSON-Schema dependency into the converter.
 */
export type TOpenAiJsonSchema = Record<string, unknown>

const convertForOpenAi = createTypeboxConverter({
    converterName: "OpenAI",
    projectObject: projectStrictObject,
})

/**
 * Convert a TypeBox schema into an OpenAI Responses-API
 * strict-mode-compatible JSON Schema document.
 *
 * Throws `UnsupportedSchemaError` when the source schema contains a
 * TypeBox primitive outside the supported subset.
 */
export function typeboxToOpenAiSchema(schema: TSchema): TOpenAiJsonSchema {
    return convertForOpenAi(schema)
}

function projectStrictObject(
    objectProperties: Record<string, TSchema>,
    convert: TSchemaConverter
): TOpenAiJsonSchema {
    const properties: Record<string, TOpenAiJsonSchema> = {}
    const required: string[] = []
    for (const [key, propSchema] of Object.entries(objectProperties)) {
        // OpenAI strict mode requires every declared key in `required`.
        // For `Type.Optional(T)` we widen the schema to allow null and
        // keep the key in `required`; this is the strict-mode-compatible
        // way to express optionality (a literally omitted key is
        // rejected by the API).
        if (isOptional(propSchema)) {
            properties[key] = nullableSchemaFor(propSchema, convert)
        } else {
            properties[key] = convert(propSchema)
        }
        required.push(key)
    }
    return {
        type: "object",
        additionalProperties: false,
        properties,
        required,
    }
}

function nullableSchemaFor(
    propSchema: TSchema,
    convert: TSchemaConverter
): TOpenAiJsonSchema {
    const inner = convert(propSchema)
    // If the inner schema is already an anyOf (e.g. an explicit
    // Union, including a Nullable that already added null), preserve
    // the existing structure and just ensure a `{ type: "null" }`
    // branch is present rather than wrapping in a redundant anyOf.
    if (isPlainAnyOf(inner)) {
        const branches = inner.anyOf
        if (branches.some(isNullBranch)) {
            return inner
        }
        return { anyOf: [...branches, { type: "null" }] }
    }
    return { anyOf: [inner, { type: "null" }] }
}

function isPlainAnyOf(
    schema: TOpenAiJsonSchema
): schema is { anyOf: TOpenAiJsonSchema[] } {
    const candidate = schema as { anyOf?: unknown }
    return Array.isArray(candidate.anyOf)
}

function isNullBranch(branch: TOpenAiJsonSchema): boolean {
    return (branch as { type?: unknown }).type === "null"
}
