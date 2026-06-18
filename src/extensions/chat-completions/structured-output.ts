// TypeBox → standard JSON Schema converter for the chat-completions
// provider.
//
// An OpenAI-compatible `/v1/chat/completions` endpoint with a
// `response_format: { type: "json_schema", json_schema: { schema } }`
// accepts a *standard* JSON Schema (the same shape `zodToJsonSchema`
// would emit). This converter deliberately does NOT apply the OpenAI
// Responses-API strict-mode folds that `typeboxToOpenAiSchema`
// (`../openai/structured-output.ts`) applies:
//
//   * No forced `additionalProperties: false` on objects.
//   * `Type.Optional(T)` → the key is simply OMITTED from `required`
//     (standard JSON-schema optionality), NOT widened to
//     `{ anyOf: [T, { type: "null" }] }` and kept in `required`.
//
// Those strict folds are correct for OpenAI strict mode and harmful for
// a standard `json_schema` consumer (a local llama-server compiling the
// schema to a GBNF grammar, the HF router, etc.), so this provider gets
// its own converter rather than reusing/renaming the OpenAI one.
//
// Supported TypeBox subset (same primitives the OpenAI converter
// covers): Object, Array, String, Number, Integer, Boolean, Literal,
// Union (including Union-of-Literals → enum shorthand, and Union
// containing Null for the Nullable pattern), Optional (modifier),
// Record, Null. Unsupported primitives throw a clear
// `UnsupportedSchemaError` at conversion time.
//
// The converter ignores TypeBox `$id` and other metadata on inner
// types — only structural fields are projected. The one exception is a
// String field's length budget: a free-text String's `maxLength` /
// `description` are projected (shrunk + a budget hint). On this path a
// respected `maxLength` caps output strictly below the true limit —
// see `projectStringLengthHint`.

import type { TSchema } from "typebox"
import { projectStringLengthHint } from "../structured-output/length-hint.js"

/**
 * The output shape is intentionally typed as a plain object literal
 * (not a full JSON-Schema TS type). The endpoint's `json_schema`
 * `schema` slot accepts this shape and we round-trip it through the
 * request body. Keeping the return type loose avoids dragging a
 * JSON-Schema dependency into the converter.
 */
export type TChatCompletionsJsonSchema = Record<string, unknown>

class UnsupportedSchemaError extends Error {
    constructor(kind: string) {
        super(
            `TypeBox primitive "${kind}" is not supported by the chat-completions structured-output converter. ` +
                `Supported subset: Object, Array, String, Number, Integer, Boolean, Literal, Union, Optional, Record, Null.`
        )
        this.name = "UnsupportedSchemaError"
    }
}

// TypeBox encodes its kind discriminant under the `~kind` key (a
// tilde-prefixed name TypeBox uses to keep the meta-shape from
// colliding with user property names). The brain-style camelCase
// naming rule doesn't fit external symbol names like this; suppress
// the lint locally rather than rename TypeBox's wire shape.
// eslint-disable-next-line @typescript-eslint/naming-convention
type TKindedSchema = TSchema & { "~kind"?: string }

function kindOf(schema: TSchema): string | undefined {
    return (schema as TKindedSchema)["~kind"]
}

function isOptional(schema: TSchema): boolean {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return (schema as { "~optional"?: boolean })["~optional"] === true
}

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
    const kind = kindOf(schema)
    switch (kind) {
        case "String":
            // Free-text String fields project a shrunk `maxLength` + a
            // budget hint in `description`; exact-value fields keep
            // their original limit. A GBNF-compiling consumer respects
            // `maxLength`, so the shrunk cap keeps output below the true
            // limit.
            return projectStringLengthHint(schema)
        case "Number":
            return { type: "number" }
        case "Integer":
            return { type: "integer" }
        case "Boolean":
            return { type: "boolean" }
        case "Null":
            return { type: "null" }
        case "Literal":
            return convertLiteral(schema)
        case "Union":
            return convertUnion(schema)
        case "Array":
            return convertArray(schema)
        case "Object":
            return convertObject(schema)
        case "Record":
            return convertRecord(schema)
        default:
            throw new UnsupportedSchemaError(kind ?? "(unknown)")
    }
}

function convertLiteral(schema: TSchema): TChatCompletionsJsonSchema {
    const literal = schema as TKindedSchema & {
        const: unknown
        type?: string
    }
    const value = literal.const
    const jsType = literal.type ?? jsonSchemaTypeOf(value)
    return { type: jsType, enum: [value] }
}

function jsonSchemaTypeOf(value: unknown): string {
    if (value === null) return "null"
    switch (typeof value) {
        case "string":
            return "string"
        case "number":
            return "number"
        case "bigint":
            return "integer"
        case "boolean":
            return "boolean"
        default:
            throw new Error(
                `Literal value of type "${typeof value}" cannot be converted to a JSON Schema primitive type.`
            )
    }
}

function convertUnion(schema: TSchema): TChatCompletionsJsonSchema {
    const union = schema as TKindedSchema & { anyOf: TSchema[] }
    const branches = union.anyOf
    if (branches.length === 0) {
        throw new Error("Cannot convert an empty Type.Union.")
    }

    // Shorthand: collapse a union of same-typed literals into a single
    // `enum`. Mixed-type literal unions still convert correctly via the
    // general anyOf branch — we only collapse when every literal shares
    // the same JSON Schema type.
    if (branches.every(isLiteralKind)) {
        const literalTypes = new Set(
            branches.map((b) => (b as TSchema & { type?: string }).type)
        )
        if (literalTypes.size === 1) {
            const literalType = [...literalTypes][0] ?? "string"
            return {
                type: literalType,
                enum: branches.map(
                    (b) => (b as TSchema & { const: unknown }).const
                ),
            }
        }
    }

    return { anyOf: branches.map((b) => typeboxToJsonSchema(b)) }
}

function isLiteralKind(schema: TSchema): boolean {
    return kindOf(schema) === "Literal"
}

function convertArray(schema: TSchema): TChatCompletionsJsonSchema {
    const array = schema as TKindedSchema & { items: TSchema }
    return {
        type: "array",
        items: typeboxToJsonSchema(array.items),
    }
}

function convertObject(schema: TSchema): TChatCompletionsJsonSchema {
    const object = schema as TKindedSchema & {
        properties: Record<string, TSchema>
    }
    const properties: Record<string, TChatCompletionsJsonSchema> = {}
    const required: string[] = []
    for (const [key, propSchema] of Object.entries(object.properties)) {
        // Standard JSON-schema optionality: an `Type.Optional(T)`
        // property is converted as its inner `T` and simply OMITTED
        // from `required`. No null-widening, no forced
        // `additionalProperties: false` — that is the OpenAI-strict
        // fold a standard `json_schema` consumer does not want.
        properties[key] = typeboxToJsonSchema(propSchema)
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

function convertRecord(schema: TSchema): TChatCompletionsJsonSchema {
    const record = schema as TKindedSchema & {
        patternProperties: Record<string, TSchema>
    }
    // TypeBox encodes Record(Type.String(), V) as
    // { patternProperties: { "^.*$": V } }. We collapse this to the
    // canonical `additionalProperties: <V>` shape.
    const patterns = Object.values(record.patternProperties)
    if (patterns.length !== 1) {
        throw new Error(
            "Type.Record with multiple pattern keys is not supported by the converter."
        )
    }
    const valueSchema = patterns[0]
    return {
        type: "object",
        additionalProperties: typeboxToJsonSchema(valueSchema),
    }
}
