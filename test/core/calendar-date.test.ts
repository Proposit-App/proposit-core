import { describe, expect, it } from "vitest"
import Type from "typebox"
import { Value } from "typebox/value"

import {
    CalendarDate,
    calendarDateFromInstant,
    calendarDateType,
    parseCalendarDate,
} from "../../src/lib/index.js"

describe("CalendarDate", () => {
    it.each(["1787", "1787-11", "1787-11-22", "2024-02-29", "0000-02-29"])(
        "accepts %s",
        (value) => {
            expect(Value.Check(CalendarDate, value)).toBe(true)
        }
    )

    it.each([
        "1787-13",
        "1787-00",
        "1787-02-30",
        "2023-02-29",
        "1900-02-29",
        "1787-11-00",
        "87",
        "1787-1",
        "hello",
        "",
        "1787-11-22T00:00:00.000Z",
        "١٧٨٧",
    ])("refuses %j", (value) => {
        expect(Value.Check(CalendarDate, value)).toBe(false)
    })

    it("refuses a Date and a number", () => {
        expect(Value.Check(CalendarDate, new Date("1787-11-22"))).toBe(false)
        expect(Value.Check(CalendarDate, 1787)).toBe(false)
    })

    it("decodes and encodes to the same string", () => {
        expect(Value.Decode(CalendarDate, "1787-11")).toBe("1787-11")
        expect(Value.Encode(CalendarDate, "1787-11")).toBe("1787-11")
    })

    it("carries extra schema options without losing the check", () => {
        const described = calendarDateType({ description: "When it happened" })
        expect((described as { description?: string }).description).toBe(
            "When it happened"
        )
        expect(Value.Check(described, "1787-11")).toBe(true)
        expect(Value.Check(described, "1787-13")).toBe(false)
    })

    it("is a string to the type system", () => {
        const schema = Type.Object({ date: CalendarDate })
        const value: { date: string } = Value.Decode(schema, { date: "1787" })
        expect(value.date).toBe("1787")
    })
})

describe("parseCalendarDate", () => {
    it("reads each precision", () => {
        expect(parseCalendarDate("1787")).toEqual({
            year: 1787,
            precision: "year",
        })
        expect(parseCalendarDate("1787-11")).toEqual({
            year: 1787,
            month: 11,
            precision: "month",
        })
        expect(parseCalendarDate("1787-11-22")).toEqual({
            year: 1787,
            month: 11,
            day: 22,
            precision: "day",
        })
    })

    it("throws a TypeError naming the value", () => {
        expect(() => parseCalendarDate("1787-13")).toThrow(TypeError)
        expect(() => parseCalendarDate("1787-13")).toThrow(/"1787-13"/)
    })
})

describe("calendarDateFromInstant", () => {
    const midnight = "1787-11-22T00:00:00.000Z"

    for (const timeZone of [
        "UTC",
        "America/Los_Angeles",
        "Pacific/Auckland",
        "Asia/Manila",
        "America/Sitka",
    ]) {
        it(`reads the UTC day whatever the process zone (${timeZone})`, () => {
            const original = process.env.TZ
            process.env.TZ = timeZone
            try {
                expect(calendarDateFromInstant(new Date(midnight))).toBe(
                    "1787-11-22"
                )
                expect(calendarDateFromInstant(midnight)).toBe("1787-11-22")
            } finally {
                if (original === undefined) delete process.env.TZ
                else process.env.TZ = original
            }
        })
    }

    it("cuts to the precision asked for", () => {
        expect(calendarDateFromInstant(midnight, "month")).toBe("1787-11")
        expect(calendarDateFromInstant(midnight, "year")).toBe("1787")
    })

    it("reads the day in the zone given", () => {
        expect(
            calendarDateFromInstant(
                new Date("2024-06-14T23:00:00.000Z"),
                "day",
                "Europe/Berlin"
            )
        ).toBe("2024-06-15")
        expect(
            calendarDateFromInstant(
                new Date("2024-06-15T03:00:00.000Z"),
                "day",
                "America/Los_Angeles"
            )
        ).toBe("2024-06-14")
    })

    it("pads a year below 1000", () => {
        const date = new Date(Date.UTC(2000, 2, 1))
        date.setUTCFullYear(950)
        expect(calendarDateFromInstant(date)).toBe("0950-03-01")
        expect(calendarDateFromInstant(date, "day", "Europe/Berlin")).toBe(
            "0950-03-01"
        )
    })

    it("refuses a year outside 0000-9999", () => {
        expect(() =>
            calendarDateFromInstant(new Date("+010000-01-01T00:00:00.000Z"))
        ).toThrow(RangeError)
        expect(() =>
            calendarDateFromInstant(new Date("-000001-01-01T00:00:00.000Z"))
        ).toThrow(RangeError)
    })

    it("refuses something that is not an instant", () => {
        expect(() => calendarDateFromInstant(new Date("nonsense"))).toThrow(
            TypeError
        )
        expect(() => calendarDateFromInstant("nonsense")).toThrow(TypeError)
    })

    it("refuses an unknown zone", () => {
        expect(() =>
            calendarDateFromInstant(new Date(midnight), "day", "Not/AZone")
        ).toThrow(RangeError)
    })
})
