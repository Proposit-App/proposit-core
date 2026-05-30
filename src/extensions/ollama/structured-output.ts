// TypeBox → standard JSON Schema converter for the Ollama provider.
//
// Ollama's `format` parameter accepts a *standard* JSON Schema (the
// same shape `zodToJsonSchema` would emit). This converter deliberately
// does NOT apply the OpenAI Responses-API strict-mode folds that
// `typeboxToOpenAiSchema` (`../openai/structured-output.ts`) applies:
//
//   * No forced `additionalProperties: false` on objects.
//   * `Type.Optional(T)` → the key is simply OMITTED from `required`
//     (standard JSON-schema optionality), NOT widened to
//     `{ anyOf: [T, { type: "null" }] }` and kept in `required`.
//
// Those strict folds are correct for OpenAI strict mode and harmful for
// a standard `format` consumer, so the Ollama provider gets its own
// converter rather than reusing/renaming the OpenAI one.
//
// Supported TypeBox subset (same primitives the OpenAI converter
// covers): Object, Array, String, Number, Integer, Boolean, Literal,
// Union (including Union-of-Literals → enum shorthand, and Union
// containing Null for the Nullable pattern), Optional (modifier),
// Record, Null. Unsupported primitives throw a clear
// `UnsupportedSchemaError` at conversion time.
//
// The converter ignores TypeBox `$id` / `description` / other metadata
// on inner types — only structural fields are projected.

import type { TSchema } from "typebox"

/**
 * The output shape is intentionally typed as a plain object literal
 * (not a full JSON-Schema TS type). Ollama's `format` accepts this
 * shape and we round-trip it through the SDK request body. Keeping the
 * return type loose avoids dragging a JSON-Schema dependency into the
 * converter.
 */
export type TOllamaJsonSchema = Record<string, unknown>

class UnsupportedSchemaError extends Error {
    constructor(kind: string) {
        super(
            `TypeBox primitive "${kind}" is not supported by the Ollama structured-output converter. ` +
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
 * suitable for Ollama's `format` parameter.
 *
 * Throws `UnsupportedSchemaError` when the source schema contains a
 * TypeBox primitive outside the supported subset.
 */
export function typeboxToJsonSchema(schema: TSchema): TOllamaJsonSchema {
    const kind = kindOf(schema)
    switch (kind) {
        case "String":
            return { type: "string" }
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

function convertLiteral(schema: TSchema): TOllamaJsonSchema {
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

function convertUnion(schema: TSchema): TOllamaJsonSchema {
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

function convertArray(schema: TSchema): TOllamaJsonSchema {
    const array = schema as TKindedSchema & { items: TSchema }
    return {
        type: "array",
        items: typeboxToJsonSchema(array.items),
    }
}

function convertObject(schema: TSchema): TOllamaJsonSchema {
    const object = schema as TKindedSchema & {
        properties: Record<string, TSchema>
    }
    const properties: Record<string, TOllamaJsonSchema> = {}
    const required: string[] = []
    for (const [key, propSchema] of Object.entries(object.properties)) {
        // Standard JSON-schema optionality: an `Type.Optional(T)`
        // property is converted as its inner `T` and simply OMITTED
        // from `required`. No null-widening, no forced
        // `additionalProperties: false` — that is the OpenAI-strict
        // fold the Ollama `format` consumer does not want.
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

function convertRecord(schema: TSchema): TOllamaJsonSchema {
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
