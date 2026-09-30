// TypeBox → standard JSON Schema converter for the chat-completions
// provider.
//
// An OpenAI-compatible `/v1/chat/completions` endpoint with a
// `response_format: { type: "json_schema", json_schema: { schema } }`
// accepts a *standard* JSON Schema. The kind-by-kind walk (and the
// supported TypeBox subset) is shared with the OpenAI converter in
// `../structured-output/typebox-converter.ts`; what differs is how an
// Object is written. This converter deliberately does NOT apply the
// OpenAI Responses-API strict-mode rules that `typeboxToOpenAiSchema`
// (`../openai/structured-output.ts`) applies:
//
//   * No forced `additionalProperties: false` on objects.
//   * `Type.Optional(T)` → the key is simply OMITTED from `required`
//     (standard JSON-schema optionality), NOT widened to
//     `{ anyOf: [T, { type: "null" }] }` and kept in `required`.
//
// Those strict rules are correct for OpenAI strict mode and harmful for
// a standard `json_schema` consumer (a local llama-server compiling the
// schema to a GBNF grammar, the HF router, etc.).

import type { TSchema } from "typebox"
import {
    createTypeboxConverter,
    isOptional,
    type TSchemaConverter,
} from "../structured-output/typebox-converter.js"

/**
 * The output shape is intentionally typed as a plain object literal
 * (not a full JSON-Schema TS type). The endpoint's `json_schema`
 * `schema` slot accepts this shape and we round-trip it through the
 * request body. Keeping the return type loose avoids dragging a
 * JSON-Schema dependency into the converter.
 */
export type TChatCompletionsJsonSchema = Record<string, unknown>

const convertForChatCompletions = createTypeboxConverter({
    converterName: "chat-completions",
    projectObject: projectStandardObject,
})

/**
 * Convert a TypeBox schema into a standard JSON Schema document
 * suitable for an OpenAI-compatible `json_schema` response format.
 *
 * Throws `UnsupportedSchemaError` when the source schema contains a
 * TypeBox primitive outside the supported subset.
 */
export function typeboxToJsonSchema(
    schema: TSchema
): TChatCompletionsJsonSchema {
    return convertForChatCompletions(schema)
}

function projectStandardObject(
    objectProperties: Record<string, TSchema>,
    convert: TSchemaConverter
): TChatCompletionsJsonSchema {
    const properties: Record<string, TChatCompletionsJsonSchema> = {}
    const required: string[] = []
    for (const [key, propSchema] of Object.entries(objectProperties)) {
        // Standard JSON-schema optionality: an `Type.Optional(T)`
        // property is converted as its inner `T` and simply OMITTED
        // from `required`. No null-widening, no forced
        // `additionalProperties: false` — those are OpenAI strict-mode
        // rules a standard `json_schema` consumer does not want.
        properties[key] = convert(propSchema)
        if (!isOptional(propSchema)) {
            required.push(key)
        }
    }
    return {
        type: "object",
        properties,
        required,
    }
}
