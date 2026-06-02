// TypeBox → OpenAI Responses-API strict-mode JSON Schema converter.
//
// This converter is inlined rather than pulling in the external
// `typebox-to-openai` package.
// The supported subset covers the primitives actually used by the
// parsing schema today plus the primitives we expect ingestion-
// pipeline stages to need: Object, Array, String, Number, Integer,
// Boolean, Literal, Union (including Union of Literals → enum
// shorthand and Union containing Null for the Nullable pattern),
// Optional (modifier — removes a property from the strict `required`
// list while keeping it under `properties`), Record, Null.
//
// Unsupported primitives throw at conversion time with a clear
// message naming the unsupported kind — extending the converter is
// preferable to silently producing schema OpenAI will reject.
//
// Strict-mode encoding rules we apply (per OpenAI Responses-API
// structured-output docs):
//
//   * Every object lists `additionalProperties: false`.
//   * Every object lists `required` with **every** declared property
//     name — strict mode requires every declared property be present
//     in `required`; omitting a key from `required` is rejected.
//   * `Type.Optional(T)` properties surface as
//     `{ anyOf: [<T>, { type: "null" }] }` and remain in `required`.
//     This is the strict-mode-compatible way to express "this field
//     can be absent" — the model emits `null` when no value applies
//     and our downstream TypeBox check tolerates the null/undefined
//     equivalence for Optional members. Naively dropping Optional
//     keys from `required` produces a schema OpenAI rejects with a
//     400 strict-mode error.
//   * `Type.Union` of literals of one JSON-Schema type collapses to
//     a single `enum`; general unions surface as `anyOf`.
//
// The converter ignores TypeBox `$id` / `description` / other
// metadata on inner types — only structural fields are projected.

import type { TSchema } from "typebox"

/**
 * The output shape is intentionally typed as a plain object literal
 * (not a full JSON-Schema TS type) — the OpenAI Responses API
 * accepts this shape and we round-trip it through JSON.stringify
 * when building the request body. Keeping the return type loose
 * avoids dragging a JSON-Schema dependency into the converter.
 */
export type TOpenAiJsonSchema = Record<string, unknown>

class UnsupportedSchemaError extends Error {
    constructor(kind: string) {
        super(
            `TypeBox primitive "${kind}" is not supported by the OpenAI structured-output converter. ` +
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
 * Convert a TypeBox schema into an OpenAI Responses-API
 * strict-mode-compatible JSON Schema document.
 *
 * Throws `UnsupportedSchemaError` when the source schema contains a
 * TypeBox primitive outside the supported subset.
 */
export function typeboxToOpenAiSchema(schema: TSchema): TOpenAiJsonSchema {
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

function convertLiteral(schema: TSchema): TOpenAiJsonSchema {
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

function convertUnion(schema: TSchema): TOpenAiJsonSchema {
    const union = schema as TKindedSchema & { anyOf: TSchema[] }
    const branches = union.anyOf
    if (branches.length === 0) {
        throw new Error("Cannot convert an empty Type.Union.")
    }

    // Shorthand: collapse a union of same-typed literals into a single
    // `enum`. Mixed-type literal unions still convert correctly via
    // the general anyOf branch — we only collapse when every literal
    // shares the same JSON Schema type.
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

    return { anyOf: branches.map((b) => typeboxToOpenAiSchema(b)) }
}

function isLiteralKind(schema: TSchema): boolean {
    return kindOf(schema) === "Literal"
}

function convertArray(schema: TSchema): TOpenAiJsonSchema {
    const array = schema as TKindedSchema & { items: TSchema }
    return {
        type: "array",
        items: typeboxToOpenAiSchema(array.items),
    }
}

function convertObject(schema: TSchema): TOpenAiJsonSchema {
    const object = schema as TKindedSchema & {
        properties: Record<string, TSchema>
        required?: readonly string[]
    }
    const properties: Record<string, TOpenAiJsonSchema> = {}
    const required: string[] = []
    for (const [key, propSchema] of Object.entries(object.properties)) {
        // OpenAI strict mode requires every declared key in `required`.
        // For `Type.Optional(T)` we widen the schema to allow null and
        // keep the key in `required`; this is the strict-mode-compatible
        // way to express optionality (a literally omitted key is
        // rejected by the API).
        if (isOptional(propSchema)) {
            properties[key] = nullableSchemaFor(propSchema)
        } else {
            properties[key] = typeboxToOpenAiSchema(propSchema)
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

function nullableSchemaFor(propSchema: TSchema): TOpenAiJsonSchema {
    const inner = typeboxToOpenAiSchema(propSchema)
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

function convertRecord(schema: TSchema): TOpenAiJsonSchema {
    const record = schema as TKindedSchema & {
        patternProperties: Record<string, TSchema>
    }
    // TypeBox encodes Record(Type.String(), V) as
    // { patternProperties: { "^.*$": V } }. We collapse this to the
    // canonical OpenAI shape `additionalProperties: <V>`.
    const patterns = Object.values(record.patternProperties)
    if (patterns.length !== 1) {
        throw new Error(
            "Type.Record with multiple pattern keys is not supported by the converter."
        )
    }
    const valueSchema = patterns[0]
    return {
        type: "object",
        additionalProperties: typeboxToOpenAiSchema(valueSchema),
    }
}
