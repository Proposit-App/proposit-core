// Unit tests for the TypeBox → OpenAI strict-mode JSON Schema
// converter shipping with the `extensions/openai/` provider.
//
// Scope: assert the converter produces strict-mode-compatible JSON
// Schema for every supported TypeBox primitive, and throws with a
// clear message for unsupported primitives. The strict-mode rules we
// encode here:
//
//   - Every object lists `additionalProperties: false`.
//   - Every object lists `required` with every declared key —
//     strict mode requires it. Optional properties widen to
//     `{ anyOf: [<T>, { type: "null" }] }` and stay in `required`
//     (the strict-mode-compatible encoding of optionality).
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
    it("converts a flat Type.Object with required + optional properties (Optional → anyOf-with-null, key kept in required)", () => {
        // OpenAI strict mode requires every declared property in
        // `required`. Optional properties widen to allow null and
        // remain in `required` — the strict-mode-compatible encoding
        // of "this field can be absent".
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
                label: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
            required: ["id", "count", "label"],
        })
    })

    it("emits Type.Optional(Type.Number()) as anyOf-with-null while keeping the key in required", () => {
        const schema = Type.Object({
            a: Type.String(),
            b: Type.Optional(Type.Number()),
        })
        const json = typeboxToOpenAiSchema(schema) as {
            required: string[]
            properties: Record<string, { anyOf?: unknown }>
        }
        expect(json.required).toEqual(["a", "b"])
        expect(json.properties.b.anyOf).toEqual([
            { type: "number" },
            { type: "null" },
        ])
    })

    it("does not double-wrap when Type.Optional wraps a value that is already nullable (Union with Null)", () => {
        // An Optional(Nullable(...)) schema should stay anyOf with a
        // single null branch — the converter must not add a redundant
        // null member.
        const inner = Type.Union([Type.String(), Type.Null()])
        const schema = Type.Object({
            value: Type.Optional(inner),
        })
        const json = typeboxToOpenAiSchema(schema) as {
            properties: { value: { anyOf: { type?: string }[] } }
            required: string[]
        }
        const branches = json.properties.value.anyOf
        const nullBranches = branches.filter((b) => b.type === "null")
        expect(nullBranches).toHaveLength(1)
        expect(json.required).toContain("value")
    })

    it("produces a strict-mode-valid schema for an object mixing required, Optional, and Nullable fields", () => {
        const schema = Type.Object({
            required: Type.String(),
            optional: Type.Optional(Type.Number()),
            nullable: Type.Union([Type.Boolean(), Type.Null()]),
            optionalNullable: Type.Optional(
                Type.Union([Type.String(), Type.Null()])
            ),
        })
        const json = typeboxToOpenAiSchema(schema) as {
            additionalProperties: boolean
            required: string[]
            properties: Record<string, unknown>
        }
        // Strict mode: additionalProperties false, every declared key
        // in required.
        expect(json.additionalProperties).toBe(false)
        expect(json.required.sort()).toEqual(
            ["nullable", "optional", "optionalNullable", "required"].sort()
        )
        // Required field stays untouched.
        expect(json.properties.required).toEqual({ type: "string" })
        // Optional widens to anyOf-with-null.
        expect(json.properties.optional).toEqual({
            anyOf: [{ type: "number" }, { type: "null" }],
        })
        // Nullable (Union containing Null) passes through as-is — the
        // Optional widener only fires for the Optional modifier, not
        // for explicit Nullable unions.
        const nullable = json.properties.nullable as {
            anyOf: { type?: string }[]
        }
        expect(nullable.anyOf.some((b) => b.type === "boolean")).toBe(true)
        expect(nullable.anyOf.some((b) => b.type === "null")).toBe(true)
        // OptionalNullable: no redundant double null branch.
        const optNullable = json.properties.optionalNullable as {
            anyOf: { type?: string }[]
        }
        expect(optNullable.anyOf.filter((b) => b.type === "null")).toHaveLength(
            1
        )
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

    it("shrinks a free-text String's maxLength and appends the budget to its description", () => {
        const schema = Type.Object({
            title: Type.String({
                maxLength: 100,
                description: "A short title",
            }),
        })
        const json = typeboxToOpenAiSchema(schema) as {
            properties: { title: { maxLength: number; description: string } }
        }
        expect(json.properties.title.maxLength).toBe(90)
        expect(json.properties.title.description).toBe(
            "A short title; at most 90 characters"
        )
    })

    it("leaves a String with no maxLength as a bare string (no shrink, no hint)", () => {
        const schema = Type.Object({ note: Type.String() })
        const json = typeboxToOpenAiSchema(schema) as {
            properties: { note: Record<string, unknown> }
        }
        expect(json.properties.note).toEqual({ type: "string" })
    })

    it("does not shrink an exact-value String (format: uri) — original maxLength, no hint", () => {
        const schema = Type.Object({
            url: Type.String({
                maxLength: 500,
                description: "The URL of the citation",
                format: "uri",
            }),
        })
        const json = typeboxToOpenAiSchema(schema) as {
            properties: { url: { maxLength: number; description: string } }
        }
        expect(json.properties.url.maxLength).toBe(500)
        expect(json.properties.url.description).toBe("The URL of the citation")
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
        // Optional `extra` stays in `required` (strict-mode rule); the
        // model emits `null` when no value applies.
        expect(json).toHaveProperty("required", [
            "id",
            "tags",
            "status",
            "extra",
        ])
    })
})
