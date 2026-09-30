// Shared TypeBox → JSON Schema walker for the structured-output schema
// converters.
//
// Both providers turn a TypeBox schema into a JSON Schema document the
// model is asked to follow: the OpenAI provider for the Responses API's
// strict mode (`../openai/structured-output.ts`) and the
// chat-completions provider for a standard `json_schema` response
// format (`../chat-completions/structured-output.ts`). Every kind they
// support converts the same way in both except Object, where strict
// mode keeps optional keys in `required` (made nullable) and forbids
// extra keys, while standard JSON Schema leaves optional keys out of
// `required`. So the walker lives here once and each provider passes in
// its own object projection.
//
// Supported TypeBox subset: Object, Array, String, Number, Integer,
// Boolean, Literal, Union (a union of literals of one JSON Schema type
// collapses to a single `enum`; any other union becomes `anyOf`),
// Optional (a property modifier, handled by the object projection),
// Record, Null. Any other kind throws `UnsupportedSchemaError` at
// conversion time, naming the kind — extending the converter is better
// than silently producing a schema the endpoint rejects.
//
// Only structural fields are projected; TypeBox `$id` and other
// metadata on inner types are dropped. The one exception is a String
// field's length budget, which `projectStringLengthHint` states in its
// `description`.

import type { TSchema } from "typebox"
import { projectStringLengthHint } from "./length-hint.js"

/**
 * A converted JSON Schema document, typed as a plain object rather than
 * a full JSON Schema type so the converters need no JSON Schema
 * dependency. It is serialized with `JSON.stringify` into the request
 * body.
 */
export type TJsonSchemaDocument = Record<string, unknown>

/** Converts one TypeBox schema (and everything under it). */
export type TSchemaConverter = (schema: TSchema) => TJsonSchemaDocument

/**
 * Builds the JSON Schema for a TypeBox Object from its declared
 * properties. `convert` is the full converter, for the property
 * schemas.
 */
export type TObjectProjection = (
    properties: Record<string, TSchema>,
    convert: TSchemaConverter
) => TJsonSchemaDocument

class UnsupportedSchemaError extends Error {
    constructor(converterName: string, kind: string) {
        super(
            `TypeBox primitive "${kind}" is not supported by the ${converterName} structured-output converter. ` +
                `Supported subset: Object, Array, String, Number, Integer, Boolean, Literal, Union, Optional, Record, Null.`
        )
        this.name = "UnsupportedSchemaError"
    }
}

// TypeBox stores its kind under the `~kind` key; the tilde keeps it
// from colliding with user property names. That name is TypeBox's, so
// the camelCase naming rule is switched off here rather than renaming
// it.
// eslint-disable-next-line @typescript-eslint/naming-convention
type TKindedSchema = TSchema & { "~kind"?: string }

function kindOf(schema: TSchema): string | undefined {
    return (schema as TKindedSchema)["~kind"]
}

/** True when the schema was wrapped in `Type.Optional`. */
export function isOptional(schema: TSchema): boolean {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return (schema as { "~optional"?: boolean })["~optional"] === true
}

/**
 * Build a TypeBox → JSON Schema converter. `converterName` appears in
 * the error thrown for an unsupported kind; `projectObject` decides how
 * an Object (and its optional properties) is written.
 */
export function createTypeboxConverter(options: {
    converterName: string
    projectObject: TObjectProjection
}): TSchemaConverter {
    const { converterName, projectObject } = options

    const convert: TSchemaConverter = (schema) => {
        const kind = kindOf(schema)
        switch (kind) {
            case "String":
                // Free-text String fields get a budget hint in
                // `description` and no `maxLength`; exact-value fields
                // keep their original limit.
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
                return convertUnion(schema, convert)
            case "Array":
                return convertArray(schema, convert)
            case "Object":
                return projectObject(
                    (
                        schema as TKindedSchema & {
                            properties: Record<string, TSchema>
                        }
                    ).properties,
                    convert
                )
            case "Record":
                return convertRecord(schema, convert)
            default:
                throw new UnsupportedSchemaError(
                    converterName,
                    kind ?? "(unknown)"
                )
        }
    }

    return convert
}

function convertLiteral(schema: TSchema): TJsonSchemaDocument {
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

function convertUnion(
    schema: TSchema,
    convert: TSchemaConverter
): TJsonSchemaDocument {
    const union = schema as TKindedSchema & { anyOf: TSchema[] }
    const branches = union.anyOf
    if (branches.length === 0) {
        throw new Error("Cannot convert an empty Type.Union.")
    }

    // A union of literals that all share one JSON Schema type collapses
    // into a single `enum`. A mixed-type literal union still converts
    // correctly through the general `anyOf` path below.
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

    return { anyOf: branches.map((b) => convert(b)) }
}

function isLiteralKind(schema: TSchema): boolean {
    return kindOf(schema) === "Literal"
}

function convertArray(
    schema: TSchema,
    convert: TSchemaConverter
): TJsonSchemaDocument {
    const array = schema as TKindedSchema & { items: TSchema }
    return {
        type: "array",
        items: convert(array.items),
    }
}

function convertRecord(
    schema: TSchema,
    convert: TSchemaConverter
): TJsonSchemaDocument {
    const record = schema as TKindedSchema & {
        patternProperties: Record<string, TSchema>
    }
    // TypeBox encodes Record(Type.String(), V) as
    // { patternProperties: { "^.*$": V } }, which is written here as the
    // equivalent `additionalProperties: <V>`.
    const patterns = Object.values(record.patternProperties)
    if (patterns.length !== 1) {
        throw new Error(
            "Type.Record with multiple pattern keys is not supported by the converter."
        )
    }
    const valueSchema = patterns[0]
    return {
        type: "object",
        additionalProperties: convert(valueSchema),
    }
}
