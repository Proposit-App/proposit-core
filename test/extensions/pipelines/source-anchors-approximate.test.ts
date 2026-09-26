// `locateSourceAnchor`'s last resort: a quote the model did not copy
// verbatim. Two shapes are accepted, conservatively — a lightly reworded
// quote ("compared with" for "compared to"), and a quote joined from two
// passages, which anchors to its longest word-for-word run. Either way the
// anchor is the document's own text, and the match says which rule made it.

import { describe, expect, it } from "vitest"
import { locateSourceAnchor } from "../../../src/extensions/pipelines/base/index.js"

// Two paragraphs of the r/changemyview post whose import produced both
// failures this covers.
const REDDIT_EXCERPT =
    "In terms of my original point, no other politician comes close. Nixon/Watergate would be a 1/10 compared to Trump's 10/10.\n\n" +
    "Edit: Edit after posting: Obviously I haven't addressed a slew of US politician scandals, and in my opinion (and this might be a second point of contention), the average \"corrupt\" US politician doesn't come close and isn't even worth mentioning. In terms of categorizing scale, literally only the historical context of HOW corrupt Nixon was considered at the time comes to mind, along with NYC's 'Boss' Tweed; and virtually every other example I can think of isn't even worth mentioning."

describe("locateSourceAnchor — quotes not copied verbatim", () => {
    it("anchors a quote with one word changed to the document's own words", () => {
        const match = locateSourceAnchor(
            REDDIT_EXCERPT,
            "Nixon/Watergate would be a 1/10 compared with Trump's 10/10",
            0
        )
        expect(match?.approximate).toBe("reworded")
        expect(match?.anchor.quote).toBe(
            "Nixon/Watergate would be a 1/10 compared to Trump's 10/10."
        )
        expect(
            REDDIT_EXCERPT.slice(
                match!.anchor.startUtf16,
                match!.anchor.endUtf16
            )
        ).toBe(match!.anchor.quote)
    })

    it("keeps a dropped word inside the anchor rather than starting after it", () => {
        const input =
            "It's also important to note the river floods every spring near the old mill."
        const match = locateSourceAnchor(
            input,
            "it's important to note the river floods every spring near the old mill",
            0
        )
        expect(match?.approximate).toBe("reworded")
        expect(match?.anchor.quote).toBe(
            "It's also important to note the river floods every spring near the old mill."
        )
    })

    it("anchors a quote joined from two passages to its longest verbatim run", () => {
        // The stored run's quote for the claim that Trump exceeds Nixon:
        // the start of one sentence spliced onto a later paragraph.
        const match = locateSourceAnchor(
            REDDIT_EXCERPT,
            "no other politician comes close and isn't even worth mentioning. In terms of categorizing scale, literally only the historical context of HOW corrupt Nixon was considered at the time comes to mind, along with NYC's 'Boss' Tweed; and virtually every other example I can think of isn't even worth mentioning.",
            0
        )
        expect(match?.approximate).toBe("joined")
        expect(match?.anchor.quote).toBe(
            "close and isn't even worth mentioning. In terms of categorizing scale, literally only the historical context of HOW corrupt Nixon was considered at the time comes to mind, along with NYC's 'Boss' Tweed; and virtually every other example I can think of isn't even worth mentioning."
        )
    })

    it("folds curly quotes and dashes without calling the quote reworded", () => {
        const input = "The mayor’s plan — funded by the state — failed twice."
        const match = locateSourceAnchor(
            input,
            "The mayor's plan - funded by the state - failed twice.",
            0
        )
        expect(match?.approximate).toBe("normalized")
        expect(match?.anchor.quote).toBe(input)
    })

    it("does not loosely match a short quote", () => {
        const input = "The cat sat on the mat by the door."
        expect(locateSourceAnchor(input, "The dog sat on the mat", 0)).toBe(
            undefined
        )
        expect(locateSourceAnchor(input, "big red cat", 0)).toBe(undefined)
    })

    it("gives no anchor when two passages match a reworded quote equally well", () => {
        const input =
            "The committee approved the new budget for the city today. The committee approved the new budget for the county today."
        expect(
            locateSourceAnchor(
                input,
                "The committee approved the new budget for the town today",
                0
            )
        ).toBe(undefined)
    })

    it("marks nothing approximate when the quote is verbatim", () => {
        const match = locateSourceAnchor(
            REDDIT_EXCERPT,
            "no other politician comes close",
            0
        )
        expect(match).toBeDefined()
        expect(match!.approximate).toBe(undefined)
    })
})
