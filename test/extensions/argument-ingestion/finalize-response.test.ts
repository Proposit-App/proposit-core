// Unit tests for `finalizeResponse`.
//
// v1's implementation is trivial — passes the LLM's response through
// with an empty `processingFailures` slot attached. These tests pin
// the v1 behavior so the v2 rewrite (slice 2A) doesn't accidentally
// alter the v1 wire-shape.

import { describe, expect, it } from "vitest"
import { finalizeResponse } from "../../../src/lib/index.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"
import type { TProcessingFailure } from "../../../src/lib/index.js"

describe("finalizeResponse", () => {
    it("passes through the LLM response verbatim and adds an empty processingFailures slot", () => {
        const input: TParsedArgumentResponse = {
            argument: null,
            uncategorizedText: "Some text.",
            selectionRationale: null,
            failureText: "Could not parse.",
        }
        const out = finalizeResponse({
            parsedResponse: input,
            failures: [],
        }) as TParsedArgumentResponse & Record<string, unknown>

        expect(out.argument).toBeNull()
        expect(out.uncategorizedText).toBe("Some text.")
        expect(out.failureText).toBe("Could not parse.")
        expect(out.processingFailures).toEqual([])
    })

    it("attaches incoming failures verbatim onto the response", () => {
        const input: TParsedArgumentResponse = {
            argument: null,
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        const failures: TProcessingFailure[] = [
            {
                stage: "parse-argument",
                code: "EXAMPLE_CODE",
                message: "example warning",
                severity: "warning",
            },
        ]
        const out = finalizeResponse({
            parsedResponse: input,
            failures,
        }) as TParsedArgumentResponse & Record<string, unknown>

        expect(out.processingFailures).toEqual(failures)
    })

    it("does not mutate the input response", () => {
        const input: TParsedArgumentResponse = {
            argument: null,
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
        const before = JSON.stringify(input)
        finalizeResponse({ parsedResponse: input, failures: [] })
        expect(JSON.stringify(input)).toBe(before)
    })
})
