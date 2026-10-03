import Type, { type TSchemaOptions } from "typebox"

// ---------------------------------------------------------------------------
// CalendarDate — a day, month or year as written, with no time or zone
// ---------------------------------------------------------------------------

/** How much of a calendar date is known. */
export type TCalendarDatePrecision = "year" | "month" | "day"

/** A calendar date read into its parts. */
export interface TCalendarDateParts {
    year: number
    month?: number
    day?: number
    precision: TCalendarDatePrecision
}

const CALENDAR_DATE_PATTERN = "^\\d{4}(-\\d{2}(-\\d{2})?)?$"
const CALENDAR_DATE_SHAPE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

// Arithmetic rather than `Date.UTC`, which reads years 0-99 as 1900-1999.
function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) return isLeapYear(year) ? 29 : 28
    return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function readCalendarDate(value: unknown): TCalendarDateParts | undefined {
    if (typeof value !== "string") return undefined
    const match = CALENDAR_DATE_SHAPE.exec(value)
    if (match === null) return undefined
    const year = Number(match[1])
    if (match[2] === undefined) return { year, precision: "year" }
    const month = Number(match[2])
    if (month < 1 || month > 12) return undefined
    if (match[3] === undefined) return { year, month, precision: "month" }
    const day = Number(match[3])
    if (day < 1 || day > daysInMonth(year, month)) return undefined
    return { year, month, day, precision: "day" }
}

/**
 * Creates a {@link CalendarDate} schema, with any extra schema options (such
 * as a `description`).
 *
 * The value is an ISO 8601 calendar date at one of three precisions:
 * `"1787"`, `"1787-11"` or `"1787-11-22"`. It is a plain string, so it
 * encodes, hashes and round-trips as itself. The whole check is a
 * refinement, not only the `pattern`: a schema whose `pattern` has been
 * stripped (the relaxed IEEE schemas) still refuses `"87"` or `"1787-13"`.
 */
export function calendarDateType(options?: TSchemaOptions) {
    return Type.Refine(
        Type.String({ ...options, pattern: CALENDAR_DATE_PATTERN }),
        (value: unknown) => readCalendarDate(value) !== undefined,
        () => "Invalid calendar date"
    )
}

/** TypeBox type of a calendar date: a year, a year and month, or a day. */
export const CalendarDate = calendarDateType()

/**
 * Reads a calendar date into its parts.
 *
 * @throws TypeError when `value` is not a valid calendar date.
 */
export function parseCalendarDate(value: string): TCalendarDateParts {
    const parts = readCalendarDate(value)
    if (parts === undefined) {
        throw new TypeError(`Not a calendar date: ${JSON.stringify(value)}`)
    }
    return parts
}

function pad(value: number, width: number): string {
    return String(value).padStart(width, "0")
}

// An ISO 8601 date-time that names its zone, as `JSON.stringify` writes a
// `Date`. A date-time without one is read in the process's own zone, which
// would make the day depend on where the conversion runs.
const ZONED_INSTANT_SHAPE =
    /^([+-]?\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/

// Whether a string is a zoned ISO date-time naming a day and time that exist.
// `Date` would roll "2024-02-30" over to March 1st and read "24:00" as the
// next day, inventing a day the value never named.
function isZonedInstant(value: string): boolean {
    const match = ZONED_INSTANT_SHAPE.exec(value)
    if (match === null) return false
    const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
        match.map(Number)
    return (
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth(year, month) &&
        hour <= 23 &&
        minute <= 59 &&
        (Number.isNaN(second) || second <= 59) &&
        (Number.isNaN(offsetHour) || offsetHour <= 23) &&
        (Number.isNaN(offsetMinute) || offsetMinute <= 59)
    )
}

const PRECISION_LENGTH: Record<TCalendarDatePrecision, number> = {
    year: 4,
    month: 7,
    day: 10,
}

/**
 * The calendar date of an instant, read in `timeZone` and cut to
 * `precision`.
 *
 * `value` is a `Date`, or the ISO string a `Date` is written as by
 * `JSON.stringify`, which names its zone. With the default zone, `"UTC"`, it
 * gives the day a citation date stored as midnight UTC of that day means.
 * Pass the zone the value was written in to recover a day stored at local
 * midnight.
 *
 * A string that is already a calendar date comes back as it is, cut to
 * `precision` only when it is longer, so converting a partly converted store
 * twice changes nothing and never invents a month or day.
 *
 * @throws TypeError when `value` is neither a valid instant nor a calendar
 * date, including a date-time string that names no zone or names a day or
 * time that does not exist.
 * @throws RangeError when the year falls outside 0000-9999, or `timeZone`
 * is not a time zone `Intl.DateTimeFormat` knows.
 */
export function calendarDateFromInstant(
    value: Date | string,
    precision: TCalendarDatePrecision = "day",
    timeZone = "UTC"
): string {
    // Checked first, so a mistyped zone is refused whatever the value.
    if (timeZone !== "UTC") new Intl.DateTimeFormat("en-US", { timeZone })
    if (typeof value === "string" && readCalendarDate(value) !== undefined) {
        return value.slice(0, PRECISION_LENGTH[precision])
    }
    if (typeof value === "string" && !isZonedInstant(value)) {
        throw new TypeError(`Not an instant: ${JSON.stringify(value)}`)
    }
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Not an instant: ${String(value)}`)
    }
    let year: number
    let month: number
    let day: number
    if (timeZone === "UTC") {
        year = date.getUTCFullYear()
        month = date.getUTCMonth() + 1
        day = date.getUTCDate()
    } else {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            era: "short",
            year: "numeric",
            month: "numeric",
            day: "numeric",
        }).formatToParts(date)
        const part = (type: Intl.DateTimeFormatPartTypes): string =>
            parts.find((p) => p.type === type)?.value ?? ""
        const yearOfEra = Number(part("year"))
        // `Intl` counts years by era: 1 BC is year 1 of the earlier era,
        // which is year 0 in ISO 8601.
        year = part("era") === "BC" ? 1 - yearOfEra : yearOfEra
        month = Number(part("month"))
        day = Number(part("day"))
    }
    if (year < 0 || year > 9999) {
        throw new RangeError(
            `Year ${String(year)} is outside 0000-9999 and has no calendar date`
        )
    }
    const text = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
    return precision === "year"
        ? text.slice(0, 4)
        : precision === "month"
          ? text.slice(0, 7)
          : text
}
