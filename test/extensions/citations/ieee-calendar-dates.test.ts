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
