// Unit tests for `locateSourceAnchor` — the quote-to-offset locator the
// ingestion finalize step uses to turn a model-supplied quote into a
// verified range in the pipeline input.
//
// The locator's whole reason to exist is that the model's own arithmetic
// is not trustworthy: the offsets it emits are in ambiguous units, and
// claim-mention spans are segment-relative rather than input-relative.
// So the locator takes the model's number only as a *hint* for choosing
// among occurrences, and every anchor it returns satisfies
// `input.slice(startUtf16, endUtf16) === quote`.

import { describe, expect, it } from "vitest"
import {
    locateSourceAnchor,
    SOURCE_ANCHOR_CONTEXT_CHARS,
} from "../../../src/extensions/pipelines/base/index.js"

describe("locateSourceAnchor", () => {
    it("locates a quote that occurs once", () => {
        const input = "The blockade is unsustainable. Therefore we must talk."
        const anchor = locateSourceAnchor(input, "we must talk", 0)
        expect(anchor).toBeDefined()
        expect(input.slice(anchor!.startUtf16, anchor!.endUtf16)).toBe(
            "we must talk"
        )
        expect(anchor!.quote).toBe("we must talk")
    })

    it("picks the occurrence nearest the hint, not the first one", () => {
        // "the risk" occurs twice. A first-match rule returns the one at
        // index 0; the hint points at the second, so the second must win.
        const input = "the risk is real. Some deny the risk anyway."
        const second = input.lastIndexOf("the risk")
        const anchor = locateSourceAnchor(input, "the risk", second + 2)
        expect(anchor?.startUtf16).toBe(second)
    })

    it("picks the earlier occurrence when the hint points at it", () => {
        const input = "the risk is real. Some deny the risk anyway."
        const anchor = locateSourceAnchor(input, "the risk", 1)
        expect(anchor?.startUtf16).toBe(0)
    })

    it("still locates the quote when the hint runs past the input", () => {
        const input = "Short text with a quotable clause."
        const anchor = locateSourceAnchor(input, "quotable clause", 10_000)
        expect(anchor?.startUtf16).toBe(input.indexOf("quotable clause"))
    })

    it("returns nothing for a quote absent from the input", () => {
        const input = "The premise is stated plainly."
        expect(locateSourceAnchor(input, "a sentence never written", 0)).toBe(
            undefined
        )
    })

    it("returns nothing for an empty or whitespace-only quote", () => {
        const input = "Any input at all."
        expect(locateSourceAnchor(input, "", 0)).toBe(undefined)
        expect(locateSourceAnchor(input, "   \n\t ", 0)).toBe(undefined)
    })

    it("matches across a line break the model flattened to a space", () => {
        const input = "We should act now\nbecause delay compounds the cost."
        const anchor = locateSourceAnchor(input, "act now because delay", 0)
        expect(anchor).toBeDefined()
        // The emitted quote is the INPUT's text for the matched range,
        // not the model's flattened copy — so the slice invariant holds.
        expect(anchor!.quote).toBe("act now\nbecause delay")
        expect(input.slice(anchor!.startUtf16, anchor!.endUtf16)).toBe(
            anchor!.quote
        )
    })

    it("ignores whitespace padding the model left on the quote", () => {
        const input = "The conclusion follows."
        const anchor = locateSourceAnchor(input, "  conclusion  ", 0)
        expect(anchor?.quote).toBe("conclusion")
    })

    it("carries bounded context before and after the quote", () => {
        const filler = "x".repeat(SOURCE_ANCHOR_CONTEXT_CHARS * 2)
        const input = `${filler}QUOTE${filler}`
        const anchor = locateSourceAnchor(input, "QUOTE", 0)
        expect(anchor?.prefix).toBe("x".repeat(SOURCE_ANCHOR_CONTEXT_CHARS))
        expect(anchor?.suffix).toBe("x".repeat(SOURCE_ANCHOR_CONTEXT_CHARS))
    })

    it("clamps context at the start and end of the input", () => {
        const input = "Alpha omega"
        const first = locateSourceAnchor(input, "Alpha", 0)
        expect(first?.prefix).toBe("")
        expect(first?.suffix).toBe(" omega")
        const last = locateSourceAnchor(input, "omega", 0)
        expect(last?.prefix).toBe("Alpha ")
        expect(last?.suffix).toBe("")
    })

    it("returns offsets that slice back to the quote for every hit", () => {
        const input =
            "Markets clear. Markets clear only under competition. Hence regulation."
        for (const quote of [
            "Markets clear",
            "only under competition",
            "Hence regulation",
        ]) {
            const anchor = locateSourceAnchor(input, quote, 0)
            expect(anchor).toBeDefined()
            expect(anchor!.startUtf16).toBeGreaterThanOrEqual(0)
            expect(anchor!.endUtf16).toBeGreaterThan(anchor!.startUtf16)
            expect(anchor!.endUtf16).toBeLessThanOrEqual(input.length)
            expect(input.slice(anchor!.startUtf16, anchor!.endUtf16)).toBe(
                anchor!.quote
            )
        }
    })
})
