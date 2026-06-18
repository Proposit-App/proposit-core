// Unit tests for the TypeBox → standard JSON Schema converter shipping
// with the `extensions/chat-completions/` provider.
//
// Scope: assert the converter produces a STANDARD JSON Schema (the shape
// an OpenAI-compatible `/v1/chat/completions` `response_format:
// { type: "json_schema" }` accepts) for every supported TypeBox
// primitive, and throws with a clear message for unsupported primitives.
//
// The load-bearing divergence from the OpenAI strict converter
// (`typeboxToOpenAiSchema`): `Type.Optional(T)` simply OMITS the key
// from `required` (standard JSON-schema optionality) and NO forced
// `additionalProperties: false` is emitted on objects. This is the
// regression most likely to creep back, so it gets dedicated cases.

import { describe, it, expect } from "vitest"
import Type from "typebox"
import { Value } from "typebox/value"
import { typeboxToJsonSchema } from "../../../src/extensions/chat-completions/structured-output.js"

describe("typeboxToJsonSchema", () => {
    it("omits Optional keys from `required` and does NOT emit additionalProperties:false", () => {
        // Core divergence from the OpenAI strict converter: Optional →
        // key dropped from `required`; objects stay open (no forced
        // `additionalProperties: false`).
        const schema = Type.Object({
            id: Type.String(),
            count: Type.Number(),
            label: Type.Optional(Type.String()),
        })
        const json = typeboxToJsonSchema(schema)
        expect(json).toEqual({
            type: "object",
            properties: {
                id: { type: "string" },
                count: { type: "number" },
                label: { type: "string" },
            },
            required: ["id", "count"],
        })
        // Explicit: no strict-mode fold leaked in.
        expect(json).not.toHaveProperty("additionalProperties")
    })

    it("emits an object with no Optional keys with every key in required (and still no additionalProperties)", () => {
        const schema = Type.Object({
            a: Type.String(),
            b: Type.Number(),
        })
        const json = typeboxToJsonSchema(schema) as {
            required: string[]
            additionalProperties?: unknown
        }
        expect(json.required).toEqual(["a", "b"])
        expect(json.additionalProperties).toBeUndefined()
    })

    it("keeps a Nullable (Union with Null) field as an anyOf with a null branch, and in required", () => {
        const schema = Type.Object({
            value: Type.Union([Type.String(), Type.Null()]),
        })
        const json = typeboxToJsonSchema(schema) as {
            required: string[]
            properties: { value: { anyOf: { type?: string }[] } }
        }
        // Nullable is NOT Optional — the key stays required.
        expect(json.required).toEqual(["value"])
        expect(json.properties.value.anyOf).toContainEqual({ type: "null" })
        expect(json.properties.value.anyOf).toContainEqual({ type: "string" })
    })

    it("does not widen an Optional field to allow null (standard optionality, not strict-mode nullable widening)", () => {
        const schema = Type.Object({
            a: Type.String(),
            b: Type.Optional(Type.Number()),
        })
        const json = typeboxToJsonSchema(schema) as {
            required: string[]
            properties: Record<string, unknown>
        }
        expect(json.required).toEqual(["a"])
        // `b` is just a number — no anyOf-with-null widening.
        expect(json.properties.b).toEqual({ type: "number" })
    })

    it("converts Type.Array of strings", () => {
        const schema = Type.Array(Type.String())
        const json = typeboxToJsonSchema(schema)
        expect(json).toEqual({
            type: "array",
            items: { type: "string" },
        })
    })

    it("converts Type.Integer and Type.Boolean", () => {
        expect(typeboxToJsonSchema(Type.Integer())).toEqual({
            type: "integer",
        })
        expect(typeboxToJsonSchema(Type.Boolean())).toEqual({
            type: "boolean",
        })
    })

    it("converts Type.Literal to a single-value enum", () => {
        expect(typeboxToJsonSchema(Type.Literal("active"))).toEqual({
            type: "string",
            enum: ["active"],
        })
        expect(typeboxToJsonSchema(Type.Literal(42))).toEqual({
            type: "number",
            enum: [42],
        })
    })

    it("converts a Type.Union of string literals to a multi-value enum", () => {
        const schema = Type.Union([
            Type.Literal("draft"),
            Type.Literal("published"),
            Type.Literal("archived"),
        ])
        expect(typeboxToJsonSchema(schema)).toEqual({
            type: "string",
            enum: ["draft", "published", "archived"],
        })
    })

    it("converts a Type.Union of mixed shapes to anyOf", () => {
        const schema = Type.Union([
            Type.Object({ tag: Type.Literal("number"), value: Type.Number() }),
            Type.Object({ tag: Type.Literal("string"), value: Type.String() }),
        ])
        const json = typeboxToJsonSchema(schema) as { anyOf: unknown[] }
        expect(json.anyOf).toBeDefined()
        expect(json.anyOf).toHaveLength(2)
    })

    it("converts Type.Record(Type.String(), V) to an open object", () => {
        const schema = Type.Record(Type.String(), Type.Number())
        expect(typeboxToJsonSchema(schema)).toEqual({
            type: "object",
            additionalProperties: { type: "number" },
        })
    })

    it("converts a nested object inside an array, recursively omitting Optional keys", () => {
        const schema = Type.Array(
            Type.Object({
                id: Type.String(),
                note: Type.Optional(Type.String()),
            })
        )
        expect(typeboxToJsonSchema(schema)).toEqual({
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    note: { type: "string" },
                },
                required: ["id"],
            },
        })
    })

    it("converts Type.Null", () => {
        expect(typeboxToJsonSchema(Type.Null())).toEqual({ type: "null" })
    })

    it("throws on Type.Tuple (unsupported primitive)", () => {
        const schema = Type.Tuple([Type.String(), Type.Number()])
        expect(() => typeboxToJsonSchema(schema)).toThrow(
            /Tuple.*not supported/i
        )
    })

    it("throws on Type.Any (unsupported primitive)", () => {
        expect(() => typeboxToJsonSchema(Type.Any())).toThrow(
            /Any.*not supported/i
        )
    })

    it("converts the BasicsParsingSchema end-to-end (smoke check on the real parser schema)", async () => {
        const mod = await import("../../../src/extensions/basics/index.js")
        const schema = mod.BasicsParsingSchema
        const json = typeboxToJsonSchema(schema)
        expect(json).toHaveProperty("type", "object")
        // Standard JSON schema: objects do NOT carry the strict-mode
        // `additionalProperties: false` fold.
        expect(json).not.toHaveProperty("additionalProperties")
    })

    it("round-trips a TypeBox-valid value through the source schema (sanity)", () => {
        const schema = Type.Object({
            id: Type.String(),
            tags: Type.Array(Type.String()),
            status: Type.Union([Type.Literal("ok"), Type.Literal("err")]),
            extra: Type.Optional(Type.Number()),
        })
        const sample = { id: "x", tags: ["a", "b"], status: "ok" as const }
        expect(Value.Check(schema, sample)).toBe(true)
        const json = typeboxToJsonSchema(schema) as { required: string[] }
        // `extra` is Optional → omitted from required (standard schema).
        expect(json.required).toEqual(["id", "tags", "status"])
    })
})
