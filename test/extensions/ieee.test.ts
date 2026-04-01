import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Settings } from "typebox/system"
import { Value } from "typebox/value"

import {
    BookReferenceSchema,
    WebsiteReferenceSchema,
    JournalArticleReferenceSchema,
    PatentReferenceSchema,
    BlogReferenceSchema,
    DatasetReferenceSchema,
    IEEEReferenceSchema,
    IEEEReferenceSchemaMap,
    RelaxedBookReferenceSchema,
    RelaxedWebsiteReferenceSchema,
    RelaxedJournalArticleReferenceSchema,
    IEEEReferenceSchemaRelaxed,
    IEEEReferenceSchemaMapRelaxed,
    type TReferenceType,
    formatNamesInCitation,
    formatCitationParts,
    type TIEEEReference,
} from "../../src/extensions/ieee"

function validBook() {
    return {
        type: "Book" as const,
        title: "Artificial Intelligence",
        year: "2024",
        authors: ["Jane Smith"],
        publisher: "MIT Press",
    }
}

function validWebsite() {
    return {
        type: "Website" as const,
        authors: ["John Doe"],
        pageTitle: "Understanding AI",
        websiteTitle: "Tech Blog",
        accessedDate: new Date("2024-06-15"),
        url: "https://example.com/article",
    }
}

function validJournalArticle() {
    return {
        type: "JournalArticle" as const,
        authors: ["Alice Johnson"],
        journalTitle: "Nature",
        doi: "10.1038/s41586-024-00001-1",
    }
}

function validPatent() {
    return {
        type: "Patent" as const,
        inventors: ["Bob Wilson"],
        country: "US",
        patentNumber: "US1234567",
        date: new Date("2024-01-15"),
    }
}

function validBlog() {
    return {
        type: "Blog" as const,
        author: "Carol White",
        blogTitle: "My Tech Blog",
        url: "https://blog.example.com/post",
        accessedDate: new Date("2024-03-01"),
    }
}

function validDataset() {
    return {
        type: "Dataset" as const,
        repository: "Zenodo",
        url: "https://zenodo.org/record/12345",
        doi: "10.5281/zenodo.12345",
    }
}

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

        it("rejects a Book with empty string in authors array", () => {
            expect(
                Value.Check(BookReferenceSchema, {
                    ...validBook(),
                    authors: [""],
                })
            ).toBe(false)
        })
    })

    describe("EncodableDate fields", () => {
        beforeAll(() => Settings.Set({ correctiveParse: true }))
        afterAll(() => Settings.Set({ correctiveParse: false }))

        it("Website accessedDate accepts a Date object", () => {
            expect(Value.Check(WebsiteReferenceSchema, validWebsite())).toBe(
                true
            )
        })

        it("Website accessedDate converts from a number via Parse", () => {
            const ref = { ...validWebsite(), accessedDate: 1718409600000 }
            const parsed = Value.Parse(WebsiteReferenceSchema, ref)
            expect(parsed.accessedDate).toBeInstanceOf(Date)
        })

        it("Website accessedDate converts from an ISO string via Parse", () => {
            const ref = {
                ...validWebsite(),
                accessedDate: "2024-06-15T00:00:00Z",
            }
            const parsed = Value.Parse(WebsiteReferenceSchema, ref)
            expect(parsed.accessedDate).toBeInstanceOf(Date)
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

    describe("formatNamesInCitation", () => {
        it("returns empty string for empty array", () => {
            expect(formatNamesInCitation([])).toBe("")
        })
        it("passes through a single-part name unchanged", () => {
            expect(formatNamesInCitation(["Aristotle"])).toBe("Aristotle")
        })
        it("abbreviates first name for a two-part name", () => {
            expect(formatNamesInCitation(["Jane Smith"])).toBe("J. Smith")
        })
        it("abbreviates first name and preserves multi-part last name", () => {
            expect(formatNamesInCitation(["Jean Paul Sartre"])).toBe(
                "J. Paul Sartre"
            )
        })
        it("joins two names with and", () => {
            expect(formatNamesInCitation(["Jane Smith", "Bob Wilson"])).toBe(
                "J. Smith and B. Wilson"
            )
        })
        it("joins three or more names with commas and and", () => {
            expect(
                formatNamesInCitation([
                    "Jane Smith",
                    "Bob Wilson",
                    "Carol White",
                ])
            ).toBe("J. Smith, B. Wilson, and C. White")
        })
        it("handles single-element array", () => {
            expect(formatNamesInCitation(["Jane Smith"])).toBe("J. Smith")
        })
    })

    describe("formatCitationParts", () => {
        it("formats a Book citation with all optional fields", () => {
            const result = formatCitationParts({
                type: "Book",
                title: "AI Fundamentals",
                year: "2024",
                authors: ["Jane Smith", "Bob Wilson"],
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
            expect(roles).toContain("patentNumber")
            expect(roles).toContain("country")
            expect(roles).toContain("date")
        })

        it("formats a JournalArticle citation", () => {
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
        })

        it("handles all 33 reference types without throwing", () => {
            const refs = [
                validBook(),
                validWebsite(),
                {
                    type: "BookChapter" as const,
                    chapterTitle: "Ch 1",
                    authors: ["A B"],
                    bookTitle: "Book",
                    publisher: "Pub",
                    location: "NYC",
                },
                {
                    type: "Handbook" as const,
                    authors: ["A B"],
                    publisher: "Pub",
                    location: "NYC",
                },
                {
                    type: "TechnicalReport" as const,
                    authors: ["A B"],
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
                    authors: ["A B"],
                    degree: "Ph.D.",
                    institution: "MIT",
                    location: "Cambridge",
                },
                validPatent(),
                { type: "Dictionary" as const, publisher: "OUP" },
                { type: "Encyclopedia" as const, publisher: "Britannica" },
                validJournalArticle(),
                {
                    type: "MagazineArticle" as const,
                    authors: ["A B"],
                    magazineTitle: "Mag",
                },
                {
                    type: "NewspaperArticle" as const,
                    authors: ["A B"],
                    newspaperTitle: "Times",
                    date: new Date(),
                },
                {
                    type: "ConferencePaper" as const,
                    authors: ["A B"],
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
                    author: "A",
                    platform: "Twitter",
                    postDate: new Date(),
                    url: "https://twitter.com",
                },
                {
                    type: "Preprint" as const,
                    authors: ["A B"],
                    server: "arXiv",
                    url: "https://arxiv.org",
                },
                {
                    type: "Video" as const,
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
                    instructor: "A B",
                    institution: "MIT",
                    term: "Fall 2024",
                },
                {
                    type: "Presentation" as const,
                    presenter: "A B",
                    eventTitle: "Event",
                    location: "NYC",
                    date: new Date(),
                },
                {
                    type: "Interview" as const,
                    interviewee: "A B",
                    date: new Date(),
                },
                {
                    type: "PersonalCommunication" as const,
                    person: "A B",
                    date: new Date(),
                },
                {
                    type: "Email" as const,
                    sender: "A",
                    recipient: "B",
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
                    agency: "EPA",
                    location: "DC",
                },
                {
                    type: "Datasheet" as const,
                    manufacturer: "Intel",
                    partNumber: "i7-12700K",
                    url: "https://intel.com",
                },
                {
                    type: "ProductManual" as const,
                    manufacturer: "Dell",
                    model: "XPS 15",
                },
            ]
            for (const ref of refs) {
                const result = formatCitationParts(ref as TIEEEReference)
                expect(result.type).toBe(ref.type)
                expect(result.segments.length).toBeGreaterThan(0)
                for (const seg of result.segments) {
                    expect(seg.text.length).toBeGreaterThan(0)
                }
            }
        })
    })
})
