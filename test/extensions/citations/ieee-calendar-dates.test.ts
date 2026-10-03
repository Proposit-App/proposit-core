// Reference dates other than access dates are calendar dates: strings at a
// precision, never instants.

import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"

import {
    IEEEReferenceSchemaMap,
    IEEEReferenceSchemaMapRelaxed,
    NewspaperArticleReferenceSchema,
    RelaxedNewspaperArticleReferenceSchema,
    formatCitationParts,
    type TIEEEReference,
} from "../../../src/extensions/citations/ieee"
import { ClaimLibrary } from "../../../src/lib/index.js"
import { oneOfEachType, validBlog } from "./fixtures.js"

// The field of each type that holds its calendar date.
const CALENDAR_DATE_FIELDS = {
    Standard: "date",
    Patent: "date",
    NewspaperArticle: "date",
    ConferencePaper: "date",
    ConferenceProceedings: "date",
    Blog: "date",
    SocialMedia: "postDate",
    Video: "releaseDate",
    Presentation: "date",
    Interview: "date",
    PersonalCommunication: "date",
    Email: "date",
    Law: "dateEnacted",
    CourtCase: "date",
    GovernmentPublication: "date",
} as const

const ACCESS_DATE_TYPES = [
    "Website",
    "OnlineDocument",
    "Blog",
    "SocialMedia",
    "Video",
    "Podcast",
] as const

function fixtureOf(type: string): Record<string, unknown> {
    const reference = oneOfEachType().find((r) => r.type === type)
    if (reference === undefined) throw new Error(`no fixture for ${type}`)
    return { ...reference }
}

const newspaper = {
    type: "NewspaperArticle",
    title: "To the People of the State of New York",
    authors: [{ name: "Publius" }],
    newspaperTitle: "New York Packet",
}

function dateSegment(reference: unknown, role = "date"): string | undefined {
    return formatCitationParts(reference as TIEEEReference).segments.find(
        (segment) => segment.role === role
    )?.text
}

describe("calendar-date fields", () => {
    it.each(Object.entries(CALENDAR_DATE_FIELDS))(
        "%s.%s takes a calendar string, never an instant",
        (type, field) => {
            const schema =
                IEEEReferenceSchemaMap[
                    type as keyof typeof IEEEReferenceSchemaMap
                ]
            const withDate = (value: unknown) =>
                Value.Check(schema, { ...fixtureOf(type), [field]: value })
            expect(withDate("1787-11-22")).toBe(true)
            expect(withDate("1787-11")).toBe(true)
            expect(withDate("1787")).toBe(true)
            expect(withDate(new Date("1787-11-22"))).toBe(false)
            expect(withDate("1787-11-22T00:00:00.000Z")).toBe(false)
        }
    )

    it.each(ACCESS_DATE_TYPES)("%s.accessedDate still takes a Date", (type) => {
        const schema =
            IEEEReferenceSchemaMap[type as keyof typeof IEEEReferenceSchemaMap]
        expect(
            Value.Check(schema, {
                ...fixtureOf(type),
                accessedDate: new Date("2024-06-15"),
            })
        ).toBe(true)
    })

    it("a relaxed schema still checks the whole calendar date", () => {
        const check = (date: unknown) =>
            Value.Check(RelaxedNewspaperArticleReferenceSchema, {
                ...newspaper,
                date,
            })
        expect(check("1787-11-22")).toBe(true)
        expect(check("1787-02-30")).toBe(false)
        expect(check("87")).toBe(false)
        expect(check("1787-11-22T00:00:00.000Z")).toBe(false)
        expect(
            Value.Check(IEEEReferenceSchemaMapRelaxed.NewspaperArticle, {
                ...newspaper,
                date: "87",
            })
        ).toBe(false)
    })

    it("round-trips a calendar date unchanged, precision included", () => {
        const reference = { ...newspaper, date: "1787-11" }
        expect(
            Value.Decode(NewspaperArticleReferenceSchema, reference)
        ).toEqual(reference)
        expect(
            Value.Encode(NewspaperArticleReferenceSchema, reference)
        ).toEqual(reference)

        const library = new ClaimLibrary()
        const claim = library.create({
            type: "citation",
            citation: reference,
        } as never)
        const restored = ClaimLibrary.fromSnapshot(
            JSON.parse(JSON.stringify(library.snapshot())) as never
        )
        const citation = (
            restored.get(claim.id, claim.version) as unknown as {
                citation: { date: string }
            }
        ).citation
        expect(citation.date).toBe("1787-11")
    })
})

describe("rendering calendar dates in a citation", () => {
    it.each([
        ["1787", "1787"],
        ["1787-11", "Nov. 1787"],
        ["1787-11-22", "Nov. 22, 1787"],
    ])("a %s date renders %s", (date, expected) => {
        expect(dateSegment({ ...newspaper, date })).toBe(expected)
    })

    it("renders both kinds of date in one reference", () => {
        const blog = {
            ...validBlog(),
            date: "2026-07-30",
            accessedDate: new Date("2026-07-30T03:00:00Z"),
        }
        expect(dateSegment(blog)).toBe("Jul. 30, 2026")
        expect(dateSegment(blog, "accessedDate")).toBe("Jul. 30, 2026")
    })

    it.each([
        ["a Date", new Date("1787-11-22")],
        ["an ISO instant", "1787-11-22T00:00:00.000Z"],
    ])("throws a TypeError naming the field for %s", (_, date) => {
        expect(() => dateSegment({ ...newspaper, date })).toThrow(TypeError)
        expect(() => dateSegment({ ...newspaper, date })).toThrow(
            /Citation field "date" is not a calendar date/
        )
    })
})

const YEAR_TYPES = [
    "Book",
    "BookChapter",
    "Handbook",
    "TechnicalReport",
    "Thesis",
    "Dictionary",
    "Encyclopedia",
    "JournalArticle",
    "MagazineArticle",
    "Dataset",
    "Software",
    "Preprint",
    "Course",
    "Datasheet",
    "ProductManual",
] as const

const YEAR_DESCRIPTION =
    'Publication date as written: a year, a year and month, or a full day (ISO 8601: "1787", "1787-11", "1787-11-22"). Absent when the source is undated.'

// The `year` property schema of a reference schema, wherever the
// intersection it is built from keeps it.
function yearPropertySchema(schema: unknown): Record<string, unknown> {
    const node = schema as {
        properties?: Record<string, Record<string, unknown>>
        allOf?: unknown[]
    }
    if (node.properties?.year !== undefined) return node.properties.year
    for (const part of node.allOf ?? []) {
        try {
            return yearPropertySchema(part)
        } catch {
            // not in this part
        }
    }
    throw new Error("no year property")
}

function yearSegment(reference: unknown): string | undefined {
    return dateSegment(reference, "year")
}

describe("year fields", () => {
    describe.each(YEAR_TYPES)("%s", (type) => {
        const strict =
            IEEEReferenceSchemaMap[type as keyof typeof IEEEReferenceSchemaMap]
        const relaxed =
            IEEEReferenceSchemaMapRelaxed[
                type as keyof typeof IEEEReferenceSchemaMapRelaxed
            ]

        it.each(["1787", "1787-11", "1787-11-22", undefined])(
            "accepts %j",
            (year) => {
                const reference = fixtureOf(type)
                if (year === undefined) delete reference.year
                else reference.year = year
                expect(Value.Check(strict, reference)).toBe(true)
                expect(Value.Check(relaxed, reference)).toBe(true)
            }
        )

        it.each(["c. 1787", "n.d."])("refuses %j", (year) => {
            const reference = { ...fixtureOf(type), year }
            expect(Value.Check(strict, reference)).toBe(false)
            expect(Value.Check(relaxed, reference)).toBe(false)
        })

        it("describes the field as a calendar date", () => {
            expect(yearPropertySchema(strict).description).toBe(
                YEAR_DESCRIPTION
            )
        })

        it("renders (n.d.) in the year's place when undated", () => {
            const dated = fixtureOf(type)
            const undated = { ...dated }
            delete undated.year
            const datedSegments = formatCitationParts(
                dated as TIEEEReference
            ).segments
            const undatedSegments = formatCitationParts(
                undated as TIEEEReference
            ).segments
            expect(undatedSegments).toEqual(
                datedSegments.map((segment) =>
                    segment.role === "year"
                        ? { ...segment, text: "(n.d.)" }
                        : segment
                )
            )
        })
    })

    it.each([
        ["JournalArticle", "2011-10", "Oct. 2011"],
        ["TechnicalReport", "1988-11", "Nov. 1988"],
        ["Dataset", "2013-08", "Aug. 2013"],
        ["Book", "1964", "1964"],
        ["JournalArticle", "2018-12-11", "Dec. 11, 2018"],
    ])(
        "a %s dated %s renders %s, as IEEE's examples do",
        (type, year, text) => {
            expect(yearSegment({ ...fixtureOf(type), year })).toBe(text)
        }
    )

    it("an undated Datasheet ends like IEEE's example", () => {
        const datasheet = fixtureOf("Datasheet")
        delete datasheet.year
        const text = formatCitationParts(datasheet as TIEEEReference)
            .segments.map((segment) => segment.text)
            .join("")
        expect(text).toContain(", (n.d.).")
    })

    it("throws a TypeError naming the field for a year that is not a calendar date", () => {
        expect(() =>
            yearSegment({ ...fixtureOf("JournalArticle"), year: "c. 1787" })
        ).toThrow(/Citation field "year" is not a calendar date: "c. 1787"/)
    })
})
