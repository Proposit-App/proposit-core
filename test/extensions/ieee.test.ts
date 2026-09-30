import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"

import {
    BookReferenceSchema,
    WebsiteReferenceSchema,
    JournalArticleReferenceSchema,
    PatentReferenceSchema,
    BlogReferenceSchema,
    DatasetReferenceSchema,
    ReferenceTypeSchema,
    IEEE_REFERENCE_TYPES,
    IEEEReferenceSchema,
    IEEEReferenceSchemaMap,
    RelaxedBookReferenceSchema,
    RelaxedWebsiteReferenceSchema,
    RelaxedJournalArticleReferenceSchema,
    IEEEReferenceSchemaRelaxed,
    IEEEReferenceSchemaMapRelaxed,
    type TReferenceType,
    type TAuthor,
    formatNamesInCitation,
    formatSingleAuthor,
    formatCitationParts,
    type TIEEEReference,
} from "../../src/extensions/citations/ieee"

describe("UnparsedURL removal", () => {
    it("ReferenceTypeSchema has 33 literals and excludes UnparsedURL", () => {
        expect(IEEE_REFERENCE_TYPES).toHaveLength(33)
        expect(IEEE_REFERENCE_TYPES).not.toContain("UnparsedURL")
        expect(Value.Check(ReferenceTypeSchema, "Book")).toBe(true)
        expect(Value.Check(ReferenceTypeSchema, "UnparsedURL")).toBe(false)
    })

    it("IEEEReferenceSchema does not validate an UnparsedURL shape", () => {
        const unparsedUrlShape = {
            type: "UnparsedURL",
            url: "https://example.com",
            text: "Example",
        }
        expect(Value.Check(IEEEReferenceSchema, unparsedUrlShape)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function author(given: string, family: string, suffix?: string): TAuthor {
    return suffix
        ? { givenNames: given, familyName: family, suffix }
        : { givenNames: given, familyName: family }
}

function validBook() {
    return {
        type: "Book" as const,
        title: "Artificial Intelligence",
        year: "2024",
        authors: [author("Jane", "Smith")],
        publisher: "MIT Press",
    }
}

function validWebsite() {
    return {
        type: "Website" as const,
        authors: [author("John", "Doe")],
        pageTitle: "Understanding AI",
        websiteTitle: "Tech Blog",
        accessedDate: new Date("2024-06-15"),
        url: "https://example.com/article",
    }
}

function validJournalArticle() {
    return {
        type: "JournalArticle" as const,
        authors: [author("Alice", "Johnson")],
        title: "Quantum computing advances",
        journalTitle: "Nature",
        year: "2024",
        doi: "10.1038/s41586-024-00001-1",
    }
}

function validPatent() {
    return {
        type: "Patent" as const,
        title: "Nonlinear resonant circuit devices",
        inventors: [author("Bob", "Wilson")],
        country: "US",
        patentNumber: "US1234567",
        date: new Date("2024-01-15"),
    }
}

function validBlog() {
    return {
        type: "Blog" as const,
        author: author("Carol", "White"),
        postTitle: "My Latest Discovery",
        blogName: "My Tech Blog",
        date: new Date("2024-03-01"),
        url: "https://blog.example.com/post",
        accessedDate: new Date("2024-03-15"),
    }
}

function validDataset() {
    return {
        type: "Dataset" as const,
        title: "Climate Data 2024",
        repository: "Zenodo",
        year: "2024",
        url: "https://zenodo.org/record/12345",
        doi: "10.5281/zenodo.12345",
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IEEE extension", () => {
    describe("schema validation — valid objects", () => {
        it("validates a conforming Book reference", () => {
            expect(Value.Check(BookReferenceSchema, validBook())).toBe(true)
        })

        it("validates a Book with all optional fields", () => {
            expect(
                Value.Check(BookReferenceSchema, {
                    ...validBook(),
                    edition: "3rd",
                    location: "Cambridge, MA",
                    isbn: "9780262046824",
                })
            ).toBe(true)
        })

        it("validates a conforming Website reference", () => {
            expect(Value.Check(WebsiteReferenceSchema, validWebsite())).toBe(
                true
            )
        })

        it("validates a conforming JournalArticle reference", () => {
            expect(
                Value.Check(
                    JournalArticleReferenceSchema,
                    validJournalArticle()
                )
            ).toBe(true)
        })

        it("validates a conforming Patent reference", () => {
            expect(Value.Check(PatentReferenceSchema, validPatent())).toBe(true)
        })

        it("validates a conforming Blog reference", () => {
            expect(Value.Check(BlogReferenceSchema, validBlog())).toBe(true)
        })

        it("validates a conforming Dataset reference with optional authors", () => {
            expect(Value.Check(DatasetReferenceSchema, validDataset())).toBe(
                true
            )
        })
    })

    describe("schema validation — constraint rejections", () => {
        it("rejects a Book with empty title", () => {
            expect(
                Value.Check(BookReferenceSchema, { ...validBook(), title: "" })
            ).toBe(false)
        })

        it("rejects a Book with empty authors array", () => {
            expect(
                Value.Check(BookReferenceSchema, {
                    ...validBook(),
                    authors: [],
                })
            ).toBe(false)
        })

        it("rejects a Book with invalid year format", () => {
            expect(
                Value.Check(BookReferenceSchema, { ...validBook(), year: "24" })
            ).toBe(false)
        })

        it("rejects a Book with invalid ISBN", () => {
            expect(
                Value.Check(BookReferenceSchema, {
                    ...validBook(),
                    isbn: "bad-isbn",
                })
            ).toBe(false)
        })

        it("rejects a JournalArticle with invalid DOI", () => {
            expect(
                Value.Check(JournalArticleReferenceSchema, {
                    ...validJournalArticle(),
                    doi: "not-a-doi",
                })
            ).toBe(false)
        })

        it("rejects a Website with invalid URL format", () => {
            expect(
                Value.Check(WebsiteReferenceSchema, {
                    ...validWebsite(),
                    url: "not a url",
                })
            ).toBe(false)
        })

        it("rejects a Book with empty string in author givenNames", () => {
            expect(
                Value.Check(BookReferenceSchema, {
                    ...validBook(),
                    authors: [{ givenNames: "", familyName: "Smith" }],
                })
            ).toBe(false)
        })
    })

    describe("EncodableDate fields", () => {
        it("Website accessedDate accepts a Date object", () => {
            expect(Value.Check(WebsiteReferenceSchema, validWebsite())).toBe(
                true
            )
        })

        it("Website accessedDate rejects a number", () => {
            const ref = { ...validWebsite(), accessedDate: 1718409600000 }
            expect(Value.Check(WebsiteReferenceSchema, ref)).toBe(false)
        })

        it("Website accessedDate decodes from an ISO string", () => {
            const ref = {
                ...validWebsite(),
                accessedDate: "2024-06-15T00:00:00Z",
            }
            const decoded = Value.Decode(WebsiteReferenceSchema, ref)
            expect(decoded.accessedDate).toBeInstanceOf(Date)
        })

        it("Patent date accepts a Date object", () => {
            expect(Value.Check(PatentReferenceSchema, validPatent())).toBe(true)
        })

        it("Blog accessedDate accepts a Date object", () => {
            expect(Value.Check(BlogReferenceSchema, validBlog())).toBe(true)
        })
    })

    describe("IEEEReferenceSchemaMap", () => {
        it("has an entry for every reference type", () => {
            const expectedTypes: TReferenceType[] = [
                "Book",
                "Website",
                "BookChapter",
                "Handbook",
                "TechnicalReport",
                "Standard",
                "Thesis",
                "Patent",
                "Dictionary",
                "Encyclopedia",
                "JournalArticle",
                "MagazineArticle",
                "NewspaperArticle",
                "ConferencePaper",
                "ConferenceProceedings",
                "Dataset",
                "Software",
                "OnlineDocument",
                "Blog",
                "SocialMedia",
                "Preprint",
                "Video",
                "Podcast",
                "Course",
                "Presentation",
                "Interview",
                "PersonalCommunication",
                "Email",
                "Law",
                "CourtCase",
                "GovernmentPublication",
                "Datasheet",
                "ProductManual",
            ]
            for (const t of expectedTypes) {
                expect(IEEEReferenceSchemaMap).toHaveProperty(t)
            }
        })

        it("Book map entry validates a Book reference", () => {
            expect(Value.Check(IEEEReferenceSchemaMap.Book, validBook())).toBe(
                true
            )
        })

        it("Book map entry rejects a Website reference", () => {
            expect(
                Value.Check(IEEEReferenceSchemaMap.Book, validWebsite())
            ).toBe(false)
        })
    })

    describe("relaxed schemas", () => {
        it("accepts a Book with invalid ISBN (constraint stripped)", () => {
            expect(
                Value.Check(RelaxedBookReferenceSchema, {
                    ...validBook(),
                    isbn: "bad-isbn",
                })
            ).toBe(true)
        })

        it("accepts a Book with empty title (minLength stripped)", () => {
            expect(
                Value.Check(RelaxedBookReferenceSchema, {
                    ...validBook(),
                    title: "",
                })
            ).toBe(true)
        })

        it("accepts a JournalArticle with invalid DOI (pattern stripped)", () => {
            expect(
                Value.Check(RelaxedJournalArticleReferenceSchema, {
                    ...validJournalArticle(),
                    doi: "not-a-doi",
                })
            ).toBe(true)
        })

        it("accepts a Website with non-URI URL (format stripped)", () => {
            expect(
                Value.Check(RelaxedWebsiteReferenceSchema, {
                    ...validWebsite(),
                    url: "not a url",
                })
            ).toBe(true)
        })

        it("still rejects structural type mismatches", () => {
            expect(
                Value.Check(RelaxedBookReferenceSchema, {
                    ...validBook(),
                    title: 42,
                })
            ).toBe(false)
        })

        it("still rejects missing required fields", () => {
            const { title: _, ...noTitle } = validBook()
            expect(Value.Check(RelaxedBookReferenceSchema, noTitle)).toBe(false)
        })

        it("relaxed union validates a Book", () => {
            expect(Value.Check(IEEEReferenceSchemaRelaxed, validBook())).toBe(
                true
            )
        })

        it("relaxed map has entry for every type", () => {
            expect(Object.keys(IEEEReferenceSchemaMapRelaxed)).toHaveLength(33)
        })

        it("relaxed map Book entry accepts invalid ISBN", () => {
            expect(
                Value.Check(IEEEReferenceSchemaMapRelaxed.Book, {
                    ...validBook(),
                    isbn: "bad-isbn",
                })
            ).toBe(true)
        })
    })

    describe("IEEEReferenceSchema union", () => {
        it("validates a Book via the union", () => {
            expect(Value.Check(IEEEReferenceSchema, validBook())).toBe(true)
        })

        it("validates a Website via the union", () => {
            expect(Value.Check(IEEEReferenceSchema, validWebsite())).toBe(true)
        })

        it("rejects an object with unknown type", () => {
            expect(
                Value.Check(IEEEReferenceSchema, {
                    type: "Unknown",
                    foo: "bar",
                })
            ).toBe(false)
        })
    })

    describe("formatSingleAuthor", () => {
        it("abbreviates given name to initial", () => {
            expect(
                formatSingleAuthor({ givenNames: "Jane", familyName: "Smith" })
            ).toBe("J. Smith")
        })

        it("abbreviates multiple given names to initials", () => {
            expect(
                formatSingleAuthor({
                    givenNames: "Jane Marie",
                    familyName: "Smith",
                })
            ).toBe("J. M. Smith")
        })

        it("appends suffix without comma", () => {
            expect(
                formatSingleAuthor({
                    givenNames: "Ray",
                    familyName: "Barnett",
                    suffix: "Sr.",
                })
            ).toBe("R. Barnett Sr.")
        })

        it("handles a single-character given name", () => {
            expect(
                formatSingleAuthor({
                    givenNames: "A",
                    familyName: "Mononym",
                })
            ).toBe("A. Mononym")
        })
    })

    describe("formatNamesInCitation", () => {
        it("returns empty string for empty array", () => {
            expect(formatNamesInCitation([])).toBe("")
        })

        it("formats a single author", () => {
            expect(formatNamesInCitation([author("Jane", "Smith")])).toBe(
                "J. Smith"
            )
        })

        it("abbreviates multi-part given names", () => {
            expect(formatNamesInCitation([author("Jane Marie", "Smith")])).toBe(
                "J. M. Smith"
            )
        })

        it("includes suffix", () => {
            expect(
                formatNamesInCitation([author("William", "Pratt", "Jr.")])
            ).toBe("W. Pratt Jr.")
        })

        it("joins two authors with and", () => {
            expect(
                formatNamesInCitation([
                    author("Jane", "Smith"),
                    author("Bob", "Wilson"),
                ])
            ).toBe("J. Smith and B. Wilson")
        })

        it("joins three authors with Oxford comma and and", () => {
            expect(
                formatNamesInCitation([
                    author("Jane", "Smith"),
                    author("Bob", "Wilson"),
                    author("Carol", "White"),
                ])
            ).toBe("J. Smith, B. Wilson, and C. White")
        })

        it("uses et al. for seven or more authors", () => {
            const authors = [
                author("A", "One"),
                author("B", "Two"),
                author("C", "Three"),
                author("D", "Four"),
                author("E", "Five"),
                author("F", "Six"),
                author("G", "Seven"),
            ]
            expect(formatNamesInCitation(authors)).toBe("A. One et al.")
        })

        it("lists all six authors when exactly six", () => {
            const authors = [
                author("A", "One"),
                author("B", "Two"),
                author("C", "Three"),
                author("D", "Four"),
                author("E", "Five"),
                author("F", "Six"),
            ]
            const result = formatNamesInCitation(authors)
            expect(result).toContain("and F. Six")
            expect(result).not.toContain("et al.")
        })

        it("formats a single-character given name", () => {
            expect(formatNamesInCitation([author("A", "Mononym")])).toBe(
                "A. Mononym"
            )
        })
    })

    describe("formatCitationParts", () => {
        it("formats a Book citation with all optional fields", () => {
            const result = formatCitationParts({
                type: "Book",
                title: "AI Fundamentals",
                year: "2024",
                authors: [author("Jane", "Smith"), author("Bob", "Wilson")],
                edition: "3rd",
                publisher: "MIT Press",
                location: "Cambridge, MA",
                isbn: "9780262046824",
            })
            expect(result.type).toBe("Book")
            const roles = result.segments.map((s) => s.role)
            expect(roles).toContain("authors")
            expect(roles).toContain("title")
            expect(roles).toContain("year")
            expect(roles).toContain("publisher")
            expect(roles).toContain("edition")
            expect(roles).toContain("location")
            expect(roles).toContain("isbn")
            const authorSeg = result.segments.find((s) => s.role === "authors")!
            expect(authorSeg.text).toBe("J. Smith and B. Wilson")
            const titleSeg = result.segments.find((s) => s.role === "title")!
            expect(titleSeg.style).toBe("italic")
        })

        it("formats a Book citation omitting missing optional fields", () => {
            const result = formatCitationParts(validBook())
            const roles = result.segments.map((s) => s.role)
            expect(roles).not.toContain("edition")
            expect(roles).not.toContain("isbn")
        })

        it("formats a Website citation", () => {
            const result = formatCitationParts({
                ...validWebsite(),
                accessedDate: new Date("2024-06-15"),
            })
            expect(result.type).toBe("Website")
            const roles = result.segments.map((s) => s.role)
            expect(roles).toContain("authors")
            expect(roles).toContain("title")
            expect(roles).toContain("url")
            expect(roles).toContain("accessedDate")
            const titleSeg = result.segments.find((s) => s.role === "title")!
            expect(titleSeg.text).toBe("Understanding AI")
            expect(titleSeg.style).toBe("quoted")
            const urlSeg = result.segments.find((s) => s.role === "url")!
            expect(urlSeg.style).toBe("link")
        })

        it("produces no empty-text segments", () => {
            const result = formatCitationParts(validBook())
            for (const seg of result.segments) {
                expect(seg.text.length).toBeGreaterThan(0)
            }
        })

        it("formats a Patent citation", () => {
            const result = formatCitationParts({
                ...validPatent(),
                date: new Date("2024-01-15"),
            })
            expect(result.type).toBe("Patent")
            const roles = result.segments.map((s) => s.role)
            expect(roles).toContain("authors")
            expect(roles).toContain("title")
            expect(roles).toContain("patentNumber")
            expect(roles).toContain("country")
            expect(roles).toContain("date")
            const titleSeg = result.segments.find((s) => s.role === "title")!
            expect(titleSeg.style).toBe("quoted")
        })

        it("formats a JournalArticle citation with volume/issue/pages", () => {
            const result = formatCitationParts({
                ...validJournalArticle(),
                volume: "586",
                issue: "7",
                pages: "1-10",
            })
            expect(result.type).toBe("JournalArticle")
            const roles = result.segments.map((s) => s.role)
            expect(roles).toContain("authors")
            expect(roles).toContain("title")
            expect(roles).toContain("volume")
            expect(roles).toContain("issue")
            expect(roles).toContain("pages")
            // title (quoted) should appear before journalTitle (italic)
            const titleIdx = result.segments.findIndex(
                (s) => s.role === "title"
            )
            const journalIdx = result.segments.findIndex(
                (s) => s.role === "misc" && s.style === "italic"
            )
            expect(titleIdx).toBeLessThan(journalIdx)
            const titleSeg = result.segments[titleIdx]
            expect(titleSeg.style).toBe("quoted")
        })

        it("formats a June date with period (Jun.)", () => {
            const result = formatCitationParts({
                ...validWebsite(),
                accessedDate: new Date("2024-06-15"),
            })
            const dateSeg = result.segments.find(
                (s) => s.role === "accessedDate"
            )!
            expect(dateSeg.text).toContain("Jun.")
        })

        it("formats a May date without period (May)", () => {
            const result = formatCitationParts({
                ...validWebsite(),
                accessedDate: new Date("2024-05-15"),
            })
            const dateSeg = result.segments.find(
                (s) => s.role === "accessedDate"
            )!
            expect(dateSeg.text).toContain("May")
            expect(dateSeg.text).not.toContain("May.")
        })

        it("handles all 33 reference types without throwing", () => {
            const a = author("Alex", "Brown")
            const refs: TIEEEReference[] = [
                validBook(),
                validWebsite(),
                {
                    type: "BookChapter" as const,
                    chapterTitle: "Ch 1",
                    year: "2024",
                    authors: [a],
                    bookTitle: "Book",
                    publisher: "Pub",
                    location: "NYC",
                },
                {
                    type: "Handbook" as const,
                    title: "Engineering Handbook",
                    year: "2024",
                    publisher: "Pub",
                    location: "NYC",
                },
                {
                    type: "TechnicalReport" as const,
                    title: "Report on Systems",
                    year: "2024",
                    authors: [a],
                    reportNumber: "TR-1",
                    institution: "MIT",
                    location: "Cambridge",
                },
                {
                    type: "Standard" as const,
                    organization: "IEEE",
                    standardNumber: "802.11",
                    title: "WiFi",
                    date: new Date(),
                },
                {
                    type: "Thesis" as const,
                    title: "On Computation",
                    year: "2024",
                    authors: [a],
                    degree: "Ph.D.",
                    institution: "MIT",
                    location: "Cambridge",
                },
                validPatent(),
                {
                    type: "Dictionary" as const,
                    title: "English Dictionary",
                    year: "2024",
                    publisher: "OUP",
                },
                {
                    type: "Encyclopedia" as const,
                    title: "World Encyclopedia",
                    year: "2024",
                    publisher: "Britannica",
                },
                validJournalArticle(),
                {
                    type: "MagazineArticle" as const,
                    title: "Tech Trends",
                    year: "2024",
                    authors: [a],
                    magazineTitle: "Mag",
                },
                {
                    type: "NewspaperArticle" as const,
                    title: "Breaking News",
                    authors: [a],
                    newspaperTitle: "Times",
                    date: new Date(),
                },
                {
                    type: "ConferencePaper" as const,
                    title: "New Algorithms",
                    authors: [a],
                    conferenceName: "Conf",
                    location: "NYC",
                    date: new Date(),
                },
                {
                    type: "ConferenceProceedings" as const,
                    conferenceName: "Conf",
                    location: "NYC",
                    date: new Date(),
                    publisher: "Pub",
                },
                validDataset(),
                {
                    type: "Software" as const,
                    title: "MyApp",
                    year: "2024",
                    url: "https://example.com",
                },
                {
                    type: "OnlineDocument" as const,
                    title: "Doc",
                    url: "https://example.com",
                    accessedDate: new Date(),
                },
                validBlog(),
                {
                    type: "SocialMedia" as const,
                    author: a,
                    platform: "Twitter",
                    postDate: new Date(),
                    url: "https://twitter.com",
                },
                {
                    type: "Preprint" as const,
                    title: "Early Results",
                    year: "2024",
                    authors: [a],
                    server: "arXiv",
                    url: "https://arxiv.org",
                },
                {
                    type: "Video" as const,
                    title: "Tutorial Video",
                    platform: "YouTube",
                    url: "https://youtube.com",
                    accessedDate: new Date(),
                },
                {
                    type: "Podcast" as const,
                    episodeTitle: "Ep 1",
                    seriesTitle: "Pod",
                    platform: "Spotify",
                    url: "https://spotify.com",
                    accessedDate: new Date(),
                },
                {
                    type: "Course" as const,
                    title: "Intro to CS",
                    year: "2024",
                    instructor: a,
                    institution: "MIT",
                    term: "Fall 2024",
                },
                {
                    type: "Presentation" as const,
                    title: "Keynote Talk",
                    presenter: a,
                    eventTitle: "Event",
                    location: "NYC",
                    date: new Date(),
                },
                {
                    type: "Interview" as const,
                    interviewee: a,
                    date: new Date(),
                },
                {
                    type: "PersonalCommunication" as const,
                    person: a,
                    date: new Date(),
                },
                {
                    type: "Email" as const,
                    sender: a,
                    recipient: author("Zara", "Lee"),
                    date: new Date(),
                },
                {
                    type: "Law" as const,
                    title: "Act",
                    jurisdiction: "US",
                    dateEnacted: new Date(),
                },
                {
                    type: "CourtCase" as const,
                    caseName: "X v Y",
                    court: "Supreme Court",
                    date: new Date(),
                },
                {
                    type: "GovernmentPublication" as const,
                    title: "Annual Report",
                    date: new Date(),
                    agency: "EPA",
                    location: "DC",
                },
                {
                    type: "Datasheet" as const,
                    title: "Processor Specs",
                    year: "2024",
                    manufacturer: "Intel",
                    partNumber: "i7-12700K",
                    url: "https://intel.com",
                },
                {
                    type: "ProductManual" as const,
                    title: "User Guide",
                    year: "2024",
                    manufacturer: "Dell",
                    model: "XPS 15",
                },
            ]
            expect(refs).toHaveLength(33)
            for (const ref of refs) {
                const result = formatCitationParts(ref)
                expect(result.type).toBe(ref.type)
                expect(result.segments.length).toBeGreaterThan(0)
                for (const seg of result.segments) {
                    expect(seg.text.length).toBeGreaterThan(0)
                }
            }
        })
    })
})

describe("segment template config", () => {
    it("BOOK_TEMPLATE is a non-empty array", async () => {
        const { BOOK_TEMPLATE } =
            await import("../../src/extensions/citations/ieee/segment-templates.js")
        expect(Array.isArray(BOOK_TEMPLATE)).toBe(true)
        expect(BOOK_TEMPLATE.length).toBeGreaterThan(0)
    })
})

describe("buildSegments conditional else", () => {
    it("emits the else branch when the field is absent or, with checkLength, an empty array", async () => {
        const { buildSegments } =
            await import("../../src/extensions/citations/ieee/segment-builder.js")
        const template = [
            {
                type: "conditional" as const,
                field: "items",
                checkLength: true,
                then: [{ type: "separator" as const, text: "then" }],
                else: [{ type: "separator" as const, text: "else" }],
            },
        ]
        const texts = (ref: Record<string, unknown>) =>
            buildSegments(ref, template).map((s) => s.text)
        expect(texts({ items: ["a"] })).toEqual(["then"])
        expect(texts({ items: [] })).toEqual(["else"])
        expect(texts({})).toEqual(["else"])
    })
})

describe("single-name authors", () => {
    const rendered = (ref: TIEEEReference) =>
        formatCitationParts(ref)
            .segments.map((s) => s.text)
            .join("")

    it("accepts an organisation or a one-word name as an author", async () => {
        const { AuthorSchema } =
            await import("../../src/extensions/citations/ieee/references.js")
        expect(Value.Check(AuthorSchema, { name: "Reuters" })).toBe(true)
        expect(Value.Check(AuthorSchema, { name: "Aristotle" })).toBe(true)
        expect(Value.Check(AuthorSchema, author("Jane", "Smith"))).toBe(true)
    })

    it("rejects a single name with anything beside it, or with no text", async () => {
        const { AuthorSchema } =
            await import("../../src/extensions/citations/ieee/references.js")
        expect(
            Value.Check(AuthorSchema, { name: "Reuters", suffix: "Jr." })
        ).toBe(false)
        expect(Value.Check(AuthorSchema, { name: "" })).toBe(false)
        expect(Value.Check(AuthorSchema, { name: " " })).toBe(false)
        expect(Value.Check(AuthorSchema, {})).toBe(false)
    })

    it("validates and renders a Book whose author is a single name", () => {
        for (const name of ["Reuters", "Aristotle"]) {
            const book = { ...validBook(), authors: [{ name }] }
            expect(Value.Check(IEEEReferenceSchema, book)).toBe(true)
            expect(Value.Check(RelaxedBookReferenceSchema, book)).toBe(true)
            expect(rendered(book)).toMatch(new RegExp(`^${name}, `))
        }
    })

    it("keeps a particle with the family name", () => {
        expect(
            formatSingleAuthor({
                givenNames: "Ludwig",
                familyName: "van Beethoven",
            })
        ).toBe("L. van Beethoven")
    })

    it("ignores a leading space in the given names", () => {
        expect(
            formatSingleAuthor({ givenNames: " Jane", familyName: "Smith" })
        ).toBe("J. Smith")
    })

    it("lists a single name beside a personal name", () => {
        expect(
            formatNamesInCitation([
                { givenNames: "John", familyName: "Smith" },
                { name: "Reuters" },
            ])
        ).toBe("J. Smith and Reuters")
    })
})

describe("SocialMedia", () => {
    const url = "https://example.com/p/1"
    const full = {
        type: "SocialMedia" as const,
        author: author("John Kim", "Author"),
        username: "user",
        postTitle: "Title",
        websiteTitle: "Site",
        platform: "Reddit",
        postDate: new Date(Date.UTC(1995, 7, 12)),
        url,
        accessedDate: new Date(Date.UTC(2026, 8, 1)),
    }
    const withBody = (() => {
        const { postTitle: _t, websiteTitle: _w, ...rest } = full
        return { ...rest, postBody: "Some text", platform: "X" }
    })()
    const without = <K extends keyof typeof full>(...keys: K[]) => {
        const ref: Record<string, unknown> = { ...full }
        for (const key of keys) delete ref[key]
        return ref as TIEEEReference
    }
    const rendered = (ref: TIEEEReference) =>
        formatCitationParts(ref)
            .segments.map((s) =>
                s.style === "quoted" ? `"${s.text}"` : s.text
            )
            .join("")

    it("renders a titled post with handle, site and access date", () => {
        expect(rendered(full)).toBe(
            `J. K. Author [@user], "Title", Site, Aug. 12, 1995. Accessed: Sep. 1, 2026. Available: ${url}`
        )
    })

    it("renders the post body when there is no title, and the platform when there is no website title", () => {
        expect(rendered(withBody)).toBe(
            `J. K. Author [@user], Some text, X, Aug. 12, 1995. Accessed: Sep. 1, 2026. Available: ${url}`
        )
    })

    it("prefers the title when both a title and a body are given", () => {
        const text = rendered({ ...full, postBody: "Some text" })
        expect(text).toContain(`"Title", Site`)
        expect(text).not.toContain("Some text")
    })

    it("starts at the handle when there is no author", () => {
        expect(rendered(without("author"))).toMatch(/^\[@user\], "Title", /)
    })

    it("follows the author with a comma when there is no handle", () => {
        expect(rendered(without("username"))).toMatch(
            /^J\. K\. Author, "Title", /
        )
    })

    it("starts at the site when there is no author, handle, title or body", () => {
        expect(
            rendered(without("author", "username", "postTitle", "websiteTitle"))
        ).toMatch(/^Reddit, Aug\. 12, 1995\. /)
    })

    it("ends at the URL, with no access date, when none is given", () => {
        const ref = without("accessedDate")
        expect(rendered(ref)).toMatch(
            new RegExp(`, Aug\\. 12, 1995\\. Available: ${url}$`)
        )
        const segments = formatCitationParts(ref).segments
        expect(segments[segments.length - 1]).toMatchObject({ role: "url" })
    })

    it("emits each part under its own role", () => {
        const pairs = (ref: TIEEEReference) =>
            formatCitationParts(ref).segments.map((s) => [s.role, s.text])
        const tail = [
            ["separator", ", "],
            ["date", "Aug. 12, 1995"],
            ["separator", ". "],
            ["prefix", "Accessed: "],
            ["accessedDate", "Sep. 1, 2026"],
            ["separator", ". "],
            ["prefix", "Available: "],
            ["url", url],
        ]
        const head = [
            ["authors", "J. K. Author"],
            ["separator", " "],
            ["prefix", "[@"],
            ["username", "user"],
            ["suffix", "]"],
            ["separator", ", "],
        ]
        expect(pairs(full)).toEqual([
            ...head,
            ["title", "Title"],
            ["separator", ", "],
            ["platform", "Site"],
            ...tail,
        ])
        expect(pairs(withBody)).toEqual([
            ...head,
            ["body", "Some text"],
            ["separator", ", "],
            ["platform", "X"],
            ...tail,
        ])
    })

    it("still validates and renders a citation holding only the original four fields", async () => {
        const {
            SocialMediaReferenceSchema,
            RelaxedSocialMediaReferenceSchema,
        } = await import("../../src/extensions/citations/ieee/index.js")
        const old = {
            type: "SocialMedia" as const,
            author: author("Jane Q.", "Doe"),
            platform: "X",
            postDate: new Date(Date.UTC(2026, 2, 5)),
            url,
        }
        expect(Value.Check(SocialMediaReferenceSchema, old)).toBe(true)
        expect(Value.Check(IEEEReferenceSchema, old)).toBe(true)
        expect(Value.Check(RelaxedSocialMediaReferenceSchema, old)).toBe(true)
        expect(rendered(old)).toBe(
            `J. Q. Doe, X, Mar. 5, 2026. Available: ${url}`
        )
    })

    it("validates the new fields", async () => {
        const { SocialMediaReferenceSchema } =
            await import("../../src/extensions/citations/ieee/index.js")
        const check = (patch: Record<string, unknown>) =>
            Value.Check(SocialMediaReferenceSchema, { ...full, ...patch })
        expect(check({})).toBe(true)
        expect(check({ username: "user@mastodon.social" })).toBe(true)
        expect(check({ username: "@user" })).toBe(false)
        expect(check({ username: "a b" })).toBe(false)
        expect(check({ username: "a]b" })).toBe(false)
        expect(check({ postTitle: " " })).toBe(false)
        expect(check({ postBody: " " })).toBe(false)
        expect(check({ websiteTitle: " " })).toBe(false)
        expect(check({ accessedDate: new Date("nonsense") })).toBe(false)
    })
})
