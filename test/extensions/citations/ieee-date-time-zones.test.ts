import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Value } from "typebox/value"

import {
    NewspaperArticleReferenceSchema,
    formatCitationParts,
    formatDate,
} from "../../../src/extensions/citations/ieee"

// A citation date is a calendar date, so it must print the same day whatever
// time zone the formatting process runs in. The zones include two whose local
// mean time in 1787 was more than twelve hours from UTC, so no stored time of
// day would print the right day in all of them.
const TIME_ZONES = [
    "UTC",
    "America/Los_Angeles",
    "Pacific/Auckland",
    "Asia/Manila",
    "America/Sitka",
]

describe("IEEE citation dates are calendar dates", () => {
    let originalTimeZone: string | undefined

    beforeEach(() => {
        originalTimeZone = process.env.TZ
    })

    afterEach(() => {
        if (originalTimeZone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimeZone
    })

    it("switching the process time zone takes effect", () => {
        // Guards the tests below: if the zone could not be changed at run
        // time, every case would run in one zone and could pass by accident.
        const date = new Date("1787-11-22")
        process.env.TZ = "America/Los_Angeles"
        expect(date.getDate()).toBe(21)
        process.env.TZ = "UTC"
        expect(date.getDate()).toBe(22)
    })

    for (const timeZone of TIME_ZONES) {
        describe(`in ${timeZone}`, () => {
            beforeEach(() => {
                process.env.TZ = timeZone
            })

            it("formats a historical date as the stored calendar day", () => {
                expect(formatDate(new Date("1787-11-22"))).toBe("Nov. 22, 1787")
            })

            it("formats a modern date as the stored calendar day", () => {
                expect(formatDate(new Date("2024-01-01"))).toBe("Jan. 1, 2024")
            })

            it("formats the ISO string a stored date comes back from JSON as", () => {
                expect(formatDate("1787-11-22T00:00:00.000Z")).toBe(
                    "Nov. 22, 1787"
                )
            })

            it("shows the stored day in a full NewspaperArticle citation", () => {
                const reference = Value.Decode(
                    NewspaperArticleReferenceSchema,
                    {
                        type: "NewspaperArticle",
                        title: "To the People of the State of New York",
                        authors: [{ name: "Publius" }],
                        newspaperTitle: "New York Packet",
                        date: "1787-11-22",
                    }
                )
                const dateSegment = formatCitationParts(
                    reference
                ).segments.find((segment) => segment.role === "date")
                expect(dateSegment?.text).toBe("Nov. 22, 1787")
            })
        })
    }
})
