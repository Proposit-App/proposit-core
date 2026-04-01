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
    type TReferenceType,
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
})
