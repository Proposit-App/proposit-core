import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import Type from "typebox"
import {
    UnparsedCitationSchema,
    UnparsedCitationTypeGuessSchema,
} from "../../../../src/extensions/citations/unparsed/index.js"
import { IEEEReferenceSchema } from "../../../../src/extensions/citations/ieee/index.js"

describe("UnparsedCitationSchema", () => {
    it("accepts a url-less unparsed citation", () => {
        const c = {
            type: "unparsed",
            text: "Pooley case (1857)",
            citationTypeGuess: "CourtCase",
        }
        expect(Value.Check(UnparsedCitationSchema, c)).toBe(true)
    })

    it("accepts an unparsed citation with a url and the 'unknown' guess", () => {
        const c = {
            type: "unparsed",
            text: "some footnote",
            citationTypeGuess: "unknown",
            url: "https://example.com",
        }
        expect(Value.Check(UnparsedCitationSchema, c)).toBe(true)
    })

    it("rejects a missing text field", () => {
        const c = { type: "unparsed", citationTypeGuess: "Book" }
        expect(Value.Check(UnparsedCitationSchema, c)).toBe(false)
    })

    it("rejects a citationTypeGuess that is not an IEEE type or 'unknown'", () => {
        expect(Value.Check(UnparsedCitationTypeGuessSchema, "CourtCase")).toBe(
            true
        )
        expect(Value.Check(UnparsedCitationTypeGuessSchema, "unknown")).toBe(
            true
        )
        expect(
            Value.Check(UnparsedCitationTypeGuessSchema, "UnparsedURL")
        ).toBe(false)
    })

    it("discriminates cleanly against IEEE in a IEEE|Unparsed union (on .type)", () => {
        const union = Type.Union([IEEEReferenceSchema, UnparsedCitationSchema])
        const ieeeBook = {
            type: "Book",
            title: "On Liberty",
            year: "1859",
            authors: [{ givenNames: "John Stuart", familyName: "Mill" }],
            publisher: "Parker",
        }
        const unparsed = {
            type: "unparsed",
            text: "x",
            citationTypeGuess: "Book",
        }
        expect(Value.Check(union, ieeeBook)).toBe(true)
        expect(Value.Check(union, unparsed)).toBe(true)
        // an unparsed shape must NOT validate as an IEEE reference and vice-versa
        expect(Value.Check(IEEEReferenceSchema, unparsed)).toBe(false)
        expect(Value.Check(UnparsedCitationSchema, ieeeBook)).toBe(false)
    })
})
