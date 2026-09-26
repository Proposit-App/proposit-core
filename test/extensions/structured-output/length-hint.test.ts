// Unit tests for the shared free-text length-steering projection used
// by both structured-output converters.
//
// The projection nudges a model toward a String field's declared
// budget without enforcing it: a free-text String shrinks its
// `maxLength` by `SHRINK` and restates the budget in `description`,
// while an exact-value String (declares a `format`, or a very small
// `maxLength`) is left at its original limit with no hint.

import { describe, it, expect } from "vitest"
import Type from "typebox"
import {
    projectStringLengthHint,
    SHRINK,
} from "../../../src/extensions/structured-output/length-hint.js"

describe("projectStringLengthHint", () => {
    it("sends no maxLength for a free-text String and appends the shrunk budget to description", () => {
        const projected = projectStringLengthHint(
            Type.String({ maxLength: 100, description: "A short title" })
        )
        expect(projected).toEqual({
            type: "string",
            description: "A short title; at most 90 characters",
        })
    })

    it("floors the shrunk budget rather than rounding it", () => {
        // floor(100 * 0.9) = 90, floor(17 * 0.9) = 15.
        expect(
            projectStringLengthHint(Type.String({ maxLength: 100 }))
        ).toEqual({
            type: "string",
            description: `at most ${String(Math.floor(100 * SHRINK))} characters`,
        })
        expect(projectStringLengthHint(Type.String({ maxLength: 17 }))).toEqual(
            {
                type: "string",
                description: `at most ${String(Math.floor(17 * SHRINK))} characters`,
            }
        )
    })

    it("supplies a description of just the budget when the source has none", () => {
        const projected = projectStringLengthHint(
            Type.String({ maxLength: 50 })
        )
        expect(projected).toEqual({
            type: "string",
            description: "at most 45 characters",
        })
    })

    it("leaves a String with no maxLength as a bare string (no shrink, no hint)", () => {
        expect(projectStringLengthHint(Type.String())).toEqual({
            type: "string",
        })
        // A description with no maxLength is also untouched — there is
        // no budget to steer toward.
        expect(
            projectStringLengthHint(Type.String({ description: "freeform" }))
        ).toEqual({ type: "string" })
    })

    it("does not shrink an exact-value String that declares a format (e.g. uri), and does not project format to the wire object", () => {
        const projected = projectStringLengthHint(
            Type.String({
                maxLength: 500,
                description: "The URL of the citation",
                format: "uri",
            })
        )
        // Original maxLength preserved; description not appended. `format`
        // drives the exemption decision but is NOT projected onto the
        // wire object — the converters strip non-structural metadata, and
        // OpenAI strict mode rejects string formats outside its fixed set
        // (uri is not in it).
        expect(projected).toEqual({
            type: "string",
            maxLength: 500,
            description: "The URL of the citation",
        })
        expect(projected).not.toHaveProperty("format")
    })

    it("does not shrink an exact-value String with a very small maxLength", () => {
        const projected = projectStringLengthHint(
            Type.String({ maxLength: 8, description: "a short code" })
        )
        expect(projected).toEqual({
            type: "string",
            maxLength: 8,
            description: "a short code",
        })
    })
})
