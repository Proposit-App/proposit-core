import { describe, expect, it } from "vitest"
import Type from "typebox"
import { Value } from "typebox/value"

import {
    EncodableDate,
    dateType,
    JsonPrimitiveSchema,
    Nullable,
} from "../src/lib/schemata/shared.js"

const isoString = "2026-05-27T12:00:00.000Z"

const RecordSchema = Type.Object({
    createdAt: EncodableDate,
    publishedAt: Type.Optional(EncodableDate),
    archivedAt: Nullable(EncodableDate),
    title: Type.String(),
})

describe("EncodableDate", () => {
    it("builds a fresh schema instance without touching a class constructor", () => {
        // The module must evaluate — and the factory must run — against the
        // installed TypeBox. A schema built from a removed base class throws
        // "Class extends value undefined" before any of this executes.
        expect(dateType()).not.toBe(EncodableDate)
        expect(Value.Check(dateType(), new Date())).toBe(true)
    })

    it("accepts a Date instance and rejects a non-date value", () => {
        expect(Value.Check(EncodableDate, new Date())).toBe(true)
        expect(Value.Check(EncodableDate, "not a date")).toBe(false)
        expect(Value.Check(EncodableDate, {})).toBe(false)
    })

    it("reports an invalid-date error for a value it rejects", () => {
        const errors = [...Value.Errors(EncodableDate, "not a date")]
        expect(errors).toHaveLength(1)
        expect(errors[0]?.message).toBe("Invalid date")
    })

    it("decodes an ISO string into a Date", () => {
        expect(Value.Decode(EncodableDate, isoString)).toEqual(
            new Date(isoString)
        )
    })

    it("rejects a number, which is not a form JSON.stringify emits for a Date", () => {
        expect(Value.Check(EncodableDate, 1718409600000)).toBe(false)
    })

    it("round-trips a record through encode, JSON, and decode", () => {
        const record = {
            createdAt: new Date(isoString),
            archivedAt: null,
            title: "a",
        }
        const encoded = Value.Encode(RecordSchema, record)
        const wire: unknown = JSON.parse(JSON.stringify(encoded))
        const decoded = Value.Decode(RecordSchema, wire)
        expect(decoded.createdAt).toBeInstanceOf(Date)
        expect(decoded.createdAt.getTime()).toBe(new Date(isoString).getTime())
        expect(decoded.archivedAt).toBeNull()
        expect(decoded.title).toBe("a")
    })

    it("decodes optional and nullable date fields", () => {
        const decoded = Value.Decode(RecordSchema, {
            createdAt: isoString,
            publishedAt: isoString,
            archivedAt: isoString,
            title: "a",
        })
        expect(decoded.publishedAt).toBeInstanceOf(Date)
        expect(decoded.archivedAt).toBeInstanceOf(Date)
    })

    it("leaves a plain string alone inside the JSON primitive union", () => {
        expect(Value.Decode(JsonPrimitiveSchema, isoString)).toBe(isoString)
    })
})
