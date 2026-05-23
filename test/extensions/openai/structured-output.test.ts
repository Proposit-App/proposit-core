// Unit tests for the TypeBox → OpenAI strict-mode JSON Schema
// converter shipping with the `extensions/openai/` provider.
//
// Scope (per slice 1B): assert the converter produces strict-mode-
// compatible JSON Schema for every supported TypeBox primitive listed
// in the agenda, and throws with a clear message for unsupported
// primitives. The strict-mode rules we encode here:
//
//   - Every object lists `additionalProperties: false`.
//   - Every object lists `required: [...all-non-optional-keys]`.
//   - Optional properties are omitted from `required` but remain
//     declared under `properties`.
//   - Unions surface as `anyOf: [...]`.
//   - A union of `Type.Literal` of the same primitive collapses to a
//     single `enum: [...]` for compactness (OpenAI's strict mode
//     accepts both shapes; the enum form is the conventional one).
//   - Records (`Type.Record(Type.String(), V)`) surface as
//     `{ type: "object", additionalProperties: <V> }`. The strict-
//     mode rule against open-ended objects applies to declared
//     property bags, not records — records are how callers opt into
//     dynamic-keyed objects.

import { describe, it, expect } from "vitest"
import Type from "typebox"
import { Value } from "typebox/value"
import { typeboxToOpenAiSchema } from "../../../src/extensions/openai/structured-output.js"

describe("typeboxToOpenAiSchema", () => {
    it("converts a flat Type.Object with required + optional properties", () => {
        const schema = Type.Object({
            id: Type.String(),
            count: Type.Number(),
            label: Type.Optional(Type.String()),
        })
        const json = typeboxToOpenAiSchema(schema)
        expect(json).toEqual({
            type: "object",
            additionalProperties: false,
            properties: {
                id: { type: "string" },
                count: { type: "number" },
                label: { type: "string" },
            },
            required: ["id", "count"],
        })
    })

    it("converts Type.Array of strings", () => {
        const schema = Type.Array(Type.String())
        const json = typeboxToOpenAiSchema(schema)
        expect(json).toEqual({
            type: "array",
            items: { type: "string" },
        })
    })

    it("converts Type.Integer and Type.Boolean", () => {
        expect(typeboxToOpenAiSchema(Type.Integer())).toEqual({
            type: "integer",
        })
        expect(typeboxToOpenAiSchema(Type.Boolean())).toEqual({
            type: "boolean",
        })
    })

    it("converts Type.Literal to a single-value enum", () => {
        expect(typeboxToOpenAiSchema(Type.Literal("active"))).toEqual({
            type: "string",
            enum: ["active"],
        })
        expect(typeboxToOpenAiSchema(Type.Literal(42))).toEqual({
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
        const json = typeboxToOpenAiSchema(schema)
        expect(json).toEqual({
            type: "string",
            enum: ["draft", "published", "archived"],
        })
    })

    it("converts a Type.Union of mixed shapes to anyOf", () => {
        const schema = Type.Union([
            Type.Object({ tag: Type.Literal("number"), value: Type.Number() }),
            Type.Object({ tag: Type.Literal("string"), value: Type.String() }),
        ])
        const json = typeboxToOpenAiSchema(schema) as { anyOf: unknown[] }
        expect(json.anyOf).toBeDefined()
        expect(json.anyOf).toHaveLength(2)
    })

    it("converts Type.Record(Type.String(), V) to an open object", () => {
        const schema = Type.Record(Type.String(), Type.Number())
        const json = typeboxToOpenAiSchema(schema)
        expect(json).toEqual({
            type: "object",
            additionalProperties: { type: "number" },
        })
    })

    it("converts a nested object inside an array", () => {
        const schema = Type.Array(
            Type.Object({
                id: Type.String(),
                value: Type.Number(),
            })
        )
        const json = typeboxToOpenAiSchema(schema)
        expect(json).toEqual({
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    value: { type: "number" },
                },
                required: ["id", "value"],
            },
        })
    })

    it("converts a Type.Union with Type.Null (Nullable) to anyOf with null branch", () => {
        const schema = Type.Union([
            Type.Object({ value: Type.String() }),
            Type.Null(),
        ])
        const json = typeboxToOpenAiSchema(schema) as { anyOf: unknown[] }
        expect(Array.isArray(json.anyOf)).toBe(true)
        expect(json.anyOf).toContainEqual({ type: "null" })
    })

    it("converts Type.Null", () => {
        expect(typeboxToOpenAiSchema(Type.Null())).toEqual({ type: "null" })
    })

    it("throws on Type.Tuple (unsupported primitive)", () => {
        const schema = Type.Tuple([Type.String(), Type.Number()])
        expect(() => typeboxToOpenAiSchema(schema)).toThrow(
            /Tuple.*not supported/i
        )
    })

    it("throws on Type.Any (unsupported primitive)", () => {
        const schema = Type.Any()
        expect(() => typeboxToOpenAiSchema(schema)).toThrow(
            /Any.*not supported/i
        )
    })

    it("converts the BasicsParsingSchema end-to-end (smoke check on the real parser schema)", async () => {
        const mod = await import("../../../src/extensions/basics/index.js")
        const schema = mod.BasicsParsingSchema
        const json = typeboxToOpenAiSchema(schema)
        // Top-level shape: discriminated by Object → strict-mode object.
        expect(json).toHaveProperty("type", "object")
        expect(json).toHaveProperty("additionalProperties", false)
        const required = (json as { required: string[] }).required
        expect(required).toContain("argument")
        expect(required).toContain("uncategorizedText")
        expect(required).toContain("selectionRationale")
        expect(required).toContain("failureText")
    })

    it("round-trips a TypeBox-valid value through the produced JSON Schema (sanity)", () => {
        // Sanity: the converter must preserve enough structure that a
        // TypeBox-valid value still satisfies the source schema. We
        // don't ship a JSON Schema validator with proposit-core, so we
        // assert TypeBox round-trip on the source side; the produced
        // JSON Schema is consumed by OpenAI's server side.
        const schema = Type.Object({
            id: Type.String(),
            tags: Type.Array(Type.String()),
            status: Type.Union([Type.Literal("ok"), Type.Literal("err")]),
            extra: Type.Optional(Type.Number()),
        })
        const sample = { id: "x", tags: ["a", "b"], status: "ok" as const }
        expect(Value.Check(schema, sample)).toBe(true)
        const json = typeboxToOpenAiSchema(schema)
        expect(json).toHaveProperty("type", "object")
        expect(json).toHaveProperty("additionalProperties", false)
        expect(json).toHaveProperty("required", ["id", "tags", "status"])
    })
})
