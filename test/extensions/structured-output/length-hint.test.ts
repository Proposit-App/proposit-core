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
    it("shrinks a free-text String's maxLength and appends the budget to description", () => {
        const projected = projectStringLengthHint(
            Type.String({ maxLength: 100, description: "A short title" })
        )
        expect(projected).toEqual({
            type: "string",
            maxLength: 90,
            description: "A short title; at most 90 characters",
        })
    })

    it("floors the shrunk maxLength and never drops below 1", () => {
        // floor(100 * 0.9) = 90 — confirm the floor, not a round.
        const ninety = projectStringLengthHint(
            Type.String({ maxLength: 100 })
        ) as { maxLength: number }
        expect(ninety.maxLength).toBe(Math.floor(100 * SHRINK))

        // A tiny-but-not-exempt value still cannot shrink to 0. (Use a
        // value above the exact-value threshold to exercise the floor
        // rather than the exemption.)
        const small = projectStringLengthHint(
            Type.String({ maxLength: 17 })
        ) as { maxLength: number }
        expect(small.maxLength).toBeGreaterThanOrEqual(1)
        expect(small.maxLength).toBe(Math.max(1, Math.floor(17 * SHRINK)))
    })

    it("supplies a description of just the budget when the source has none", () => {
        const projected = projectStringLengthHint(
            Type.String({ maxLength: 50 })
        )
        expect(projected).toEqual({
            type: "string",
            maxLength: 45,
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

    it("does not shrink an exact-value String that declares a format (e.g. uri)", () => {
        const projected = projectStringLengthHint(
            Type.String({
                maxLength: 500,
                description: "The URL of the citation",
                format: "uri",
            })
        )
        // Original maxLength preserved; description not appended; format
        // carried through.
        expect(projected).toEqual({
            type: "string",
            maxLength: 500,
            description: "The URL of the citation",
            format: "uri",
        })
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
