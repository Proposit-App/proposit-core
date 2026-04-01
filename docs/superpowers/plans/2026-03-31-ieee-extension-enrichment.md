# IEEE Extension Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the IEEE citation extension with strict validation constraints, relaxed schema variants, a type-to-schema lookup map, and structured citation formatting utilities.

**Architecture:** Four focused modules under `src/extensions/ieee/` — `references.ts` (enriched schemas + map), `relaxed.ts` (constraint-stripped variants), `formatting.ts` (citation segment builders), and `source.ts` (unchanged). Tests in `test/extensions/ieee.test.ts`. TDD throughout — tests written before implementation for each module.

**Tech Stack:** TypeBox schemas, `EncodableDate` from `src/lib/schemata/shared.ts`, Vitest

**Spec:** `docs/superpowers/specs/2026-03-31-ieee-extension-enrichment-design.md`

---

### Task 1: Enrich `references.ts` — constraints, descriptions, EncodableDate, and schema map

**Files:**

- Modify: `src/extensions/ieee/references.ts`
- Test: `test/extensions/ieee.test.ts` (create)

- [ ] **Step 1: Create test file with schema validation tests**

Create `test/extensions/ieee.test.ts`:

```ts
import { describe, expect, it } from "vitest"
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    // -----------------------------------------------------------------
    // Schema validation — valid objects
    // -----------------------------------------------------------------
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

    // -----------------------------------------------------------------
    // Schema validation — constraint rejections
    // -----------------------------------------------------------------
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
                Value.Check(BookReferenceSchema, {
                    ...validBook(),
                    year: "24",
                })
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

    // -----------------------------------------------------------------
    // EncodableDate fields
    // -----------------------------------------------------------------
    describe("EncodableDate fields", () => {
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

    // -----------------------------------------------------------------
    // IEEEReferenceSchemaMap
    // -----------------------------------------------------------------
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
            expect(
                Value.Check(IEEEReferenceSchemaMap["Book"], validBook())
            ).toBe(true)
        })

        it("Book map entry rejects a Website reference", () => {
            expect(
                Value.Check(IEEEReferenceSchemaMap["Book"], validWebsite())
            ).toBe(false)
        })
    })

    // -----------------------------------------------------------------
    // IEEEReferenceSchema union
    // -----------------------------------------------------------------
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/extensions/ieee.test.ts`

Expected: Most constraint and EncodableDate tests fail (current schemas have no constraints, dates are strings/numbers, no map export).

- [ ] **Step 3: Enrich `references.ts` with constraints, descriptions, EncodableDate, and schema map**

Rewrite `src/extensions/ieee/references.ts`. Key changes:

- Add `import { EncodableDate } from "../../lib/schemata/shared.js"` at the top
- Add `{ minLength: 1, description: "..." }` to all required string fields
- Change `authors`/`editors`/`inventors` arrays to `Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })` for required, omit `minItems` for optional
- Change `year` fields to `Type.String({ pattern: "^\\d{4}$", description: "Four-digit year" })`
- Change URL fields to `Type.String({ format: "uri", minLength: 1, description: "..." })`
- Change ISBN fields to `Type.Optional(Type.String({ pattern: "^(?:\\d{9}[\\dX]|\\d{13})$", description: "ISBN-10 or ISBN-13 (digits only)" }))`
- Change DOI fields to `Type.Optional(Type.String({ pattern: "^10\\..+/.+$", description: "DOI identifier" }))`
- Change all `accessedDate`, `date`, `postDate`, `dateEnacted` fields to `EncodableDate`
- Add `IEEEReferenceSchemaMap` object mapping each type name to its schema, and export it

Here is the full file content:

```ts
// IEEE Citation Reference Schemas
// https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf

import Type, { type Static } from "typebox"
import { EncodableDate } from "../../lib/schemata/shared.js"

// ---------------------------------------------------------------------------
// Reference type discriminator
// ---------------------------------------------------------------------------
export const ReferenceTypeSchema = Type.Union([
    Type.Literal("Book"),
    Type.Literal("Website"),
    Type.Literal("BookChapter"),
    Type.Literal("Handbook"),
    Type.Literal("TechnicalReport"),
    Type.Literal("Standard"),
    Type.Literal("Thesis"),
    Type.Literal("Patent"),
    Type.Literal("Dictionary"),
    Type.Literal("Encyclopedia"),
    Type.Literal("JournalArticle"),
    Type.Literal("MagazineArticle"),
    Type.Literal("NewspaperArticle"),
    Type.Literal("ConferencePaper"),
    Type.Literal("ConferenceProceedings"),
    Type.Literal("Dataset"),
    Type.Literal("Software"),
    Type.Literal("OnlineDocument"),
    Type.Literal("Blog"),
    Type.Literal("SocialMedia"),
    Type.Literal("Preprint"),
    Type.Literal("Video"),
    Type.Literal("Podcast"),
    Type.Literal("Course"),
    Type.Literal("Presentation"),
    Type.Literal("Interview"),
    Type.Literal("PersonalCommunication"),
    Type.Literal("Email"),
    Type.Literal("Law"),
    Type.Literal("CourtCase"),
    Type.Literal("GovernmentPublication"),
    Type.Literal("Datasheet"),
    Type.Literal("ProductManual"),
])
export type TReferenceType = Static<typeof ReferenceTypeSchema>

// ---------------------------------------------------------------------------
// Base reference (shared by all types)
// ---------------------------------------------------------------------------
const BaseReferenceSchema = Type.Object({
    type: ReferenceTypeSchema,
})

// ---------------------------------------------------------------------------
// Textual sources
// ---------------------------------------------------------------------------
export const BookReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Book"),
        title: Type.String({ minLength: 1, description: "Title of the book" }),
        year: Type.String({
            pattern: "^\\d{4}$",
            description: "Four-digit publication year",
        }),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition (e.g. 3rd)" })
        ),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        location: Type.Optional(
            Type.String({
                minLength: 1,
                description: "City and state/country of publication",
            })
        ),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type TBookReference = Static<typeof BookReferenceSchema>

export const WebsiteReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Website"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        pageTitle: Type.String({
            minLength: 1,
            description: "Title of the web page",
        }),
        websiteTitle: Type.String({
            minLength: 1,
            description: "Name of the website",
        }),
        accessedDate: EncodableDate,
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the web page",
        }),
    }),
])
export type TWebsiteReference = Static<typeof WebsiteReferenceSchema>

export const BookChapterReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("BookChapter"),
        chapterTitle: Type.String({
            minLength: 1,
            description: "Title of the chapter",
        }),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of chapter author full names",
        }),
        bookTitle: Type.String({
            minLength: 1,
            description: "Title of the book containing the chapter",
        }),
        editors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of book editor full names",
            })
        ),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        location: Type.String({
            minLength: 1,
            description: "City and state/country of publication",
        }),
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type TBookChapterReference = Static<typeof BookChapterReferenceSchema>

export const HandbookReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Handbook"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition" })
        ),
        location: Type.String({
            minLength: 1,
            description: "City and state/country of publication",
        }),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type THandbookReference = Static<typeof HandbookReferenceSchema>

export const TechnicalReportReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("TechnicalReport"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        reportNumber: Type.String({
            minLength: 1,
            description: "Report identifier number",
        }),
        institution: Type.String({
            minLength: 1,
            description: "Publishing institution",
        }),
        location: Type.String({
            minLength: 1,
            description: "City and state/country",
        }),
    }),
])
export type TTechnicalReportReference = Static<
    typeof TechnicalReportReferenceSchema
>

export const StandardReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Standard"),
        organization: Type.String({
            minLength: 1,
            description: "Standards organization name",
        }),
        standardNumber: Type.String({
            minLength: 1,
            description: "Standard identifier number",
        }),
        title: Type.String({
            minLength: 1,
            description: "Title of the standard",
        }),
        date: EncodableDate,
    }),
])
export type TStandardReference = Static<typeof StandardReferenceSchema>

export const ThesisReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Thesis"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        degree: Type.String({
            minLength: 1,
            description: "Degree type (e.g. Ph.D., M.S.)",
        }),
        institution: Type.String({
            minLength: 1,
            description: "Granting institution",
        }),
        location: Type.String({
            minLength: 1,
            description: "City and state/country",
        }),
    }),
])
export type TThesisReference = Static<typeof ThesisReferenceSchema>

export const PatentReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Patent"),
        inventors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of inventor full names",
        }),
        country: Type.String({
            minLength: 1,
            description: "Country of patent",
        }),
        patentNumber: Type.String({
            minLength: 1,
            description: "Patent identifier number",
        }),
        date: EncodableDate,
    }),
])
export type TPatentReference = Static<typeof PatentReferenceSchema>

export const DictionaryReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Dictionary"),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition" })
        ),
    }),
])
export type TDictionaryReference = Static<typeof DictionaryReferenceSchema>

export const EncyclopediaReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Encyclopedia"),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition" })
        ),
    }),
])
export type TEncyclopediaReference = Static<typeof EncyclopediaReferenceSchema>

// ---------------------------------------------------------------------------
// Periodicals
// ---------------------------------------------------------------------------
export const JournalArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("JournalArticle"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        journalTitle: Type.String({
            minLength: 1,
            description: "Title of the journal",
        }),
        volume: Type.Optional(
            Type.String({ minLength: 1, description: "Volume number" })
        ),
        issue: Type.Optional(
            Type.String({ minLength: 1, description: "Issue number" })
        ),
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
    }),
])
export type TJournalArticleReference = Static<
    typeof JournalArticleReferenceSchema
>

export const MagazineArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("MagazineArticle"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        magazineTitle: Type.String({
            minLength: 1,
            description: "Title of the magazine",
        }),
        volume: Type.Optional(
            Type.String({ minLength: 1, description: "Volume number" })
        ),
        issue: Type.Optional(
            Type.String({ minLength: 1, description: "Issue number" })
        ),
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
    }),
])
export type TMagazineArticleReference = Static<
    typeof MagazineArticleReferenceSchema
>

export const NewspaperArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("NewspaperArticle"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        newspaperTitle: Type.String({
            minLength: 1,
            description: "Title of the newspaper",
        }),
        date: EncodableDate,
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
    }),
])
export type TNewspaperArticleReference = Static<
    typeof NewspaperArticleReferenceSchema
>

// ---------------------------------------------------------------------------
// Conference
// ---------------------------------------------------------------------------
export const ConferencePaperReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ConferencePaper"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        conferenceName: Type.String({
            minLength: 1,
            description: "Name of the conference",
        }),
        location: Type.String({
            minLength: 1,
            description: "Conference location",
        }),
        date: EncodableDate,
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
    }),
])
export type TConferencePaperReference = Static<
    typeof ConferencePaperReferenceSchema
>

export const ConferenceProceedingsReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ConferenceProceedings"),
        editors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of editor full names",
            })
        ),
        conferenceName: Type.String({
            minLength: 1,
            description: "Name of the conference",
        }),
        location: Type.String({
            minLength: 1,
            description: "Conference location",
        }),
        date: EncodableDate,
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type TConferenceProceedingsReference = Static<
    typeof ConferenceProceedingsReferenceSchema
>

// ---------------------------------------------------------------------------
// Digital sources
// ---------------------------------------------------------------------------
export const DatasetReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Dataset"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of author full names",
            })
        ),
        repository: Type.String({
            minLength: 1,
            description: "Repository or archive name",
        }),
        version: Type.Optional(
            Type.String({ minLength: 1, description: "Dataset version" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the dataset",
        }),
    }),
])
export type TDatasetReference = Static<typeof DatasetReferenceSchema>

export const SoftwareReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Software"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of author full names",
            })
        ),
        version: Type.Optional(
            Type.String({ minLength: 1, description: "Software version" })
        ),
        publisher: Type.Optional(
            Type.String({
                minLength: 1,
                description: "Publisher or distributor",
            })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the software",
        }),
    }),
])
export type TSoftwareReference = Static<typeof SoftwareReferenceSchema>

export const OnlineDocumentReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("OnlineDocument"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of author full names",
            })
        ),
        title: Type.String({
            minLength: 1,
            description: "Title of the document",
        }),
        publisher: Type.Optional(
            Type.String({ minLength: 1, description: "Publisher name" })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the document",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TOnlineDocumentReference = Static<
    typeof OnlineDocumentReferenceSchema
>

export const BlogReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Blog"),
        author: Type.String({
            minLength: 1,
            description: "Author full name",
        }),
        blogTitle: Type.String({
            minLength: 1,
            description: "Title of the blog post",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the blog post",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TBlogReference = Static<typeof BlogReferenceSchema>

export const SocialMediaReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("SocialMedia"),
        author: Type.String({
            minLength: 1,
            description: "Author or account name",
        }),
        platform: Type.String({
            minLength: 1,
            description: "Social media platform name",
        }),
        postDate: EncodableDate,
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the post",
        }),
    }),
])
export type TSocialMediaReference = Static<typeof SocialMediaReferenceSchema>

export const PreprintReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Preprint"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "List of author full names",
        }),
        server: Type.String({
            minLength: 1,
            description: "Preprint server name (e.g. arXiv)",
        }),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the preprint",
        }),
    }),
])
export type TPreprintReference = Static<typeof PreprintReferenceSchema>

// ---------------------------------------------------------------------------
// Multimedia
// ---------------------------------------------------------------------------
export const VideoReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Video"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of creator full names",
            })
        ),
        platform: Type.String({
            minLength: 1,
            description: "Video platform name",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the video",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TVideoReference = Static<typeof VideoReferenceSchema>

export const PodcastReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Podcast"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of host/creator full names",
            })
        ),
        episodeTitle: Type.String({
            minLength: 1,
            description: "Title of the episode",
        }),
        seriesTitle: Type.String({
            minLength: 1,
            description: "Title of the podcast series",
        }),
        platform: Type.String({
            minLength: 1,
            description: "Podcast platform name",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the episode",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TPodcastReference = Static<typeof PodcastReferenceSchema>

export const CourseReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Course"),
        instructor: Type.String({
            minLength: 1,
            description: "Instructor full name",
        }),
        institution: Type.String({
            minLength: 1,
            description: "Institution name",
        }),
        courseCode: Type.Optional(
            Type.String({ minLength: 1, description: "Course code" })
        ),
        term: Type.String({
            minLength: 1,
            description: "Academic term (e.g. Fall 2024)",
        }),
    }),
])
export type TCourseReference = Static<typeof CourseReferenceSchema>

export const PresentationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Presentation"),
        presenter: Type.String({
            minLength: 1,
            description: "Presenter full name",
        }),
        eventTitle: Type.String({
            minLength: 1,
            description: "Title of the event",
        }),
        location: Type.String({
            minLength: 1,
            description: "Event location",
        }),
        date: EncodableDate,
    }),
])
export type TPresentationReference = Static<typeof PresentationReferenceSchema>

// ---------------------------------------------------------------------------
// Personal / unpublished
// ---------------------------------------------------------------------------
export const InterviewReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Interview"),
        interviewee: Type.String({
            minLength: 1,
            description: "Interviewee full name",
        }),
        interviewer: Type.Optional(
            Type.String({
                minLength: 1,
                description: "Interviewer full name",
            })
        ),
        date: EncodableDate,
    }),
])
export type TInterviewReference = Static<typeof InterviewReferenceSchema>

export const PersonalCommunicationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("PersonalCommunication"),
        person: Type.String({
            minLength: 1,
            description: "Person communicated with",
        }),
        date: EncodableDate,
    }),
])
export type TPersonalCommunicationReference = Static<
    typeof PersonalCommunicationReferenceSchema
>

export const EmailReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Email"),
        sender: Type.String({
            minLength: 1,
            description: "Sender full name",
        }),
        recipient: Type.String({
            minLength: 1,
            description: "Recipient full name",
        }),
        date: EncodableDate,
    }),
])
export type TEmailReference = Static<typeof EmailReferenceSchema>

// ---------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------
export const LawReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Law"),
        title: Type.String({
            minLength: 1,
            description: "Title of the legislation",
        }),
        jurisdiction: Type.String({
            minLength: 1,
            description: "Jurisdiction (e.g. United States)",
        }),
        dateEnacted: EncodableDate,
    }),
])
export type TLawReference = Static<typeof LawReferenceSchema>

export const CourtCaseReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("CourtCase"),
        caseName: Type.String({
            minLength: 1,
            description: "Case name (e.g. Roe v. Wade)",
        }),
        court: Type.String({ minLength: 1, description: "Court name" }),
        date: EncodableDate,
        reporter: Type.Optional(
            Type.String({
                minLength: 1,
                description: "Reporter citation",
            })
        ),
    }),
])
export type TCourtCaseReference = Static<typeof CourtCaseReferenceSchema>

export const GovernmentPublicationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("GovernmentPublication"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "List of author full names",
            })
        ),
        agency: Type.String({
            minLength: 1,
            description: "Government agency name",
        }),
        reportNumber: Type.Optional(
            Type.String({
                minLength: 1,
                description: "Report or document number",
            })
        ),
        location: Type.String({
            minLength: 1,
            description: "City and state/country",
        }),
    }),
])
export type TGovernmentPublicationReference = Static<
    typeof GovernmentPublicationReferenceSchema
>

// ---------------------------------------------------------------------------
// Technical documents
// ---------------------------------------------------------------------------
export const DatasheetReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Datasheet"),
        manufacturer: Type.String({
            minLength: 1,
            description: "Manufacturer name",
        }),
        partNumber: Type.String({
            minLength: 1,
            description: "Part or model number",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the datasheet",
        }),
    }),
])
export type TDatasheetReference = Static<typeof DatasheetReferenceSchema>

export const ProductManualReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ProductManual"),
        manufacturer: Type.String({
            minLength: 1,
            description: "Manufacturer name",
        }),
        model: Type.String({
            minLength: 1,
            description: "Product model name or number",
        }),
        url: Type.Optional(
            Type.String({
                format: "uri",
                minLength: 1,
                description: "URL of the manual",
            })
        ),
    }),
])
export type TProductManualReference = Static<
    typeof ProductManualReferenceSchema
>

// ---------------------------------------------------------------------------
// Discriminated union of all reference types
// ---------------------------------------------------------------------------
export const IEEEReferenceSchema = Type.Union([
    BookReferenceSchema,
    WebsiteReferenceSchema,
    BookChapterReferenceSchema,
    HandbookReferenceSchema,
    TechnicalReportReferenceSchema,
    StandardReferenceSchema,
    ThesisReferenceSchema,
    PatentReferenceSchema,
    DictionaryReferenceSchema,
    EncyclopediaReferenceSchema,
    JournalArticleReferenceSchema,
    MagazineArticleReferenceSchema,
    NewspaperArticleReferenceSchema,
    ConferencePaperReferenceSchema,
    ConferenceProceedingsReferenceSchema,
    DatasetReferenceSchema,
    SoftwareReferenceSchema,
    OnlineDocumentReferenceSchema,
    BlogReferenceSchema,
    SocialMediaReferenceSchema,
    PreprintReferenceSchema,
    VideoReferenceSchema,
    PodcastReferenceSchema,
    CourseReferenceSchema,
    PresentationReferenceSchema,
    InterviewReferenceSchema,
    PersonalCommunicationReferenceSchema,
    EmailReferenceSchema,
    LawReferenceSchema,
    CourtCaseReferenceSchema,
    GovernmentPublicationReferenceSchema,
    DatasheetReferenceSchema,
    ProductManualReferenceSchema,
])
export type TIEEEReference = Static<typeof IEEEReferenceSchema>

// ---------------------------------------------------------------------------
// Schema map — type name to schema for per-type validation
// ---------------------------------------------------------------------------
export const IEEEReferenceSchemaMap = {
    Book: BookReferenceSchema,
    Website: WebsiteReferenceSchema,
    BookChapter: BookChapterReferenceSchema,
    Handbook: HandbookReferenceSchema,
    TechnicalReport: TechnicalReportReferenceSchema,
    Standard: StandardReferenceSchema,
    Thesis: ThesisReferenceSchema,
    Patent: PatentReferenceSchema,
    Dictionary: DictionaryReferenceSchema,
    Encyclopedia: EncyclopediaReferenceSchema,
    JournalArticle: JournalArticleReferenceSchema,
    MagazineArticle: MagazineArticleReferenceSchema,
    NewspaperArticle: NewspaperArticleReferenceSchema,
    ConferencePaper: ConferencePaperReferenceSchema,
    ConferenceProceedings: ConferenceProceedingsReferenceSchema,
    Dataset: DatasetReferenceSchema,
    Software: SoftwareReferenceSchema,
    OnlineDocument: OnlineDocumentReferenceSchema,
    Blog: BlogReferenceSchema,
    SocialMedia: SocialMediaReferenceSchema,
    Preprint: PreprintReferenceSchema,
    Video: VideoReferenceSchema,
    Podcast: PodcastReferenceSchema,
    Course: CourseReferenceSchema,
    Presentation: PresentationReferenceSchema,
    Interview: InterviewReferenceSchema,
    PersonalCommunication: PersonalCommunicationReferenceSchema,
    Email: EmailReferenceSchema,
    Law: LawReferenceSchema,
    CourtCase: CourtCaseReferenceSchema,
    GovernmentPublication: GovernmentPublicationReferenceSchema,
    Datasheet: DatasheetReferenceSchema,
    ProductManual: ProductManualReferenceSchema,
} as const
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/ieee/references.ts test/extensions/ieee.test.ts
git commit -m "feat(ieee): add schema constraints, descriptions, EncodableDate, and schema map"
```

---

### Task 2: Add relaxed schema variants (`relaxed.ts`)

**Files:**

- Create: `src/extensions/ieee/relaxed.ts`
- Modify: `src/extensions/ieee/index.ts`
- Test: `test/extensions/ieee.test.ts`

- [ ] **Step 1: Add relaxed schema tests to `test/extensions/ieee.test.ts`**

Append to the file, inside the top-level `describe("IEEE extension")`:

```ts
import {
    RelaxedBookReferenceSchema,
    RelaxedWebsiteReferenceSchema,
    RelaxedJournalArticleReferenceSchema,
    IEEEReferenceSchemaRelaxed,
    IEEEReferenceSchemaMapRelaxed,
} from "../../src/extensions/ieee"

// ... inside describe("IEEE extension") ...

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
        expect(Value.Check(IEEEReferenceSchemaRelaxed, validBook())).toBe(true)
    })

    it("relaxed map has entry for every type", () => {
        expect(Object.keys(IEEEReferenceSchemaMapRelaxed)).toHaveLength(33)
    })

    it("relaxed map Book entry accepts invalid ISBN", () => {
        expect(
            Value.Check(IEEEReferenceSchemaMapRelaxed["Book"], {
                ...validBook(),
                isbn: "bad-isbn",
            })
        ).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: FAIL — relaxed imports don't exist yet.

- [ ] **Step 3: Create `src/extensions/ieee/relaxed.ts`**

```ts
import type { TSchema } from "typebox"
import {
    BookReferenceSchema,
    WebsiteReferenceSchema,
    BookChapterReferenceSchema,
    HandbookReferenceSchema,
    TechnicalReportReferenceSchema,
    StandardReferenceSchema,
    ThesisReferenceSchema,
    PatentReferenceSchema,
    DictionaryReferenceSchema,
    EncyclopediaReferenceSchema,
    JournalArticleReferenceSchema,
    MagazineArticleReferenceSchema,
    NewspaperArticleReferenceSchema,
    ConferencePaperReferenceSchema,
    ConferenceProceedingsReferenceSchema,
    DatasetReferenceSchema,
    SoftwareReferenceSchema,
    OnlineDocumentReferenceSchema,
    BlogReferenceSchema,
    SocialMediaReferenceSchema,
    PreprintReferenceSchema,
    VideoReferenceSchema,
    PodcastReferenceSchema,
    CourseReferenceSchema,
    PresentationReferenceSchema,
    InterviewReferenceSchema,
    PersonalCommunicationReferenceSchema,
    EmailReferenceSchema,
    LawReferenceSchema,
    CourtCaseReferenceSchema,
    GovernmentPublicationReferenceSchema,
    DatasheetReferenceSchema,
    ProductManualReferenceSchema,
    IEEEReferenceSchema,
} from "./references.js"
import type { Static } from "typebox"

// ---------------------------------------------------------------------------
// Constraint stripping utility (internal)
// ---------------------------------------------------------------------------
const CONSTRAINT_KEYS = new Set([
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "format",
    "minimum",
    "maximum",
])

/**
 * Deep-clone a TypeBox schema, stripping constraint keys.
 * Class instances (e.g. EncodableDate) are preserved by reference
 * since structuredClone would lose their prototype methods.
 */
function stripConstraints<T extends TSchema>(schema: T): T {
    return cloneAndStrip(schema) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === "object" &&
        (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null)
    )
}

function cloneAndStrip(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(cloneAndStrip)
    }
    if (!isPlainObject(value)) {
        return value // preserve class instances (EncodableDate, etc.) by reference
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
        if (CONSTRAINT_KEYS.has(k)) continue
        result[k] = cloneAndStrip(v)
    }
    return result
}

// ---------------------------------------------------------------------------
// Relaxed individual schemas
// ---------------------------------------------------------------------------
export const RelaxedBookReferenceSchema = stripConstraints(BookReferenceSchema)
export type TRelaxedBookReference = Static<typeof RelaxedBookReferenceSchema>

export const RelaxedWebsiteReferenceSchema = stripConstraints(
    WebsiteReferenceSchema
)
export type TRelaxedWebsiteReference = Static<
    typeof RelaxedWebsiteReferenceSchema
>

export const RelaxedBookChapterReferenceSchema = stripConstraints(
    BookChapterReferenceSchema
)
export type TRelaxedBookChapterReference = Static<
    typeof RelaxedBookChapterReferenceSchema
>

export const RelaxedHandbookReferenceSchema = stripConstraints(
    HandbookReferenceSchema
)
export type TRelaxedHandbookReference = Static<
    typeof RelaxedHandbookReferenceSchema
>

export const RelaxedTechnicalReportReferenceSchema = stripConstraints(
    TechnicalReportReferenceSchema
)
export type TRelaxedTechnicalReportReference = Static<
    typeof RelaxedTechnicalReportReferenceSchema
>

export const RelaxedStandardReferenceSchema = stripConstraints(
    StandardReferenceSchema
)
export type TRelaxedStandardReference = Static<
    typeof RelaxedStandardReferenceSchema
>

export const RelaxedThesisReferenceSchema = stripConstraints(
    ThesisReferenceSchema
)
export type TRelaxedThesisReference = Static<
    typeof RelaxedThesisReferenceSchema
>

export const RelaxedPatentReferenceSchema = stripConstraints(
    PatentReferenceSchema
)
export type TRelaxedPatentReference = Static<
    typeof RelaxedPatentReferenceSchema
>

export const RelaxedDictionaryReferenceSchema = stripConstraints(
    DictionaryReferenceSchema
)
export type TRelaxedDictionaryReference = Static<
    typeof RelaxedDictionaryReferenceSchema
>

export const RelaxedEncyclopediaReferenceSchema = stripConstraints(
    EncyclopediaReferenceSchema
)
export type TRelaxedEncyclopediaReference = Static<
    typeof RelaxedEncyclopediaReferenceSchema
>

export const RelaxedJournalArticleReferenceSchema = stripConstraints(
    JournalArticleReferenceSchema
)
export type TRelaxedJournalArticleReference = Static<
    typeof RelaxedJournalArticleReferenceSchema
>

export const RelaxedMagazineArticleReferenceSchema = stripConstraints(
    MagazineArticleReferenceSchema
)
export type TRelaxedMagazineArticleReference = Static<
    typeof RelaxedMagazineArticleReferenceSchema
>

export const RelaxedNewspaperArticleReferenceSchema = stripConstraints(
    NewspaperArticleReferenceSchema
)
export type TRelaxedNewspaperArticleReference = Static<
    typeof RelaxedNewspaperArticleReferenceSchema
>

export const RelaxedConferencePaperReferenceSchema = stripConstraints(
    ConferencePaperReferenceSchema
)
export type TRelaxedConferencePaperReference = Static<
    typeof RelaxedConferencePaperReferenceSchema
>

export const RelaxedConferenceProceedingsReferenceSchema = stripConstraints(
    ConferenceProceedingsReferenceSchema
)
export type TRelaxedConferenceProceedingsReference = Static<
    typeof RelaxedConferenceProceedingsReferenceSchema
>

export const RelaxedDatasetReferenceSchema = stripConstraints(
    DatasetReferenceSchema
)
export type TRelaxedDatasetReference = Static<
    typeof RelaxedDatasetReferenceSchema
>

export const RelaxedSoftwareReferenceSchema = stripConstraints(
    SoftwareReferenceSchema
)
export type TRelaxedSoftwareReference = Static<
    typeof RelaxedSoftwareReferenceSchema
>

export const RelaxedOnlineDocumentReferenceSchema = stripConstraints(
    OnlineDocumentReferenceSchema
)
export type TRelaxedOnlineDocumentReference = Static<
    typeof RelaxedOnlineDocumentReferenceSchema
>

export const RelaxedBlogReferenceSchema = stripConstraints(BlogReferenceSchema)
export type TRelaxedBlogReference = Static<typeof RelaxedBlogReferenceSchema>

export const RelaxedSocialMediaReferenceSchema = stripConstraints(
    SocialMediaReferenceSchema
)
export type TRelaxedSocialMediaReference = Static<
    typeof RelaxedSocialMediaReferenceSchema
>

export const RelaxedPreprintReferenceSchema = stripConstraints(
    PreprintReferenceSchema
)
export type TRelaxedPreprintReference = Static<
    typeof RelaxedPreprintReferenceSchema
>

export const RelaxedVideoReferenceSchema =
    stripConstraints(VideoReferenceSchema)
export type TRelaxedVideoReference = Static<typeof RelaxedVideoReferenceSchema>

export const RelaxedPodcastReferenceSchema = stripConstraints(
    PodcastReferenceSchema
)
export type TRelaxedPodcastReference = Static<
    typeof RelaxedPodcastReferenceSchema
>

export const RelaxedCourseReferenceSchema = stripConstraints(
    CourseReferenceSchema
)
export type TRelaxedCourseReference = Static<
    typeof RelaxedCourseReferenceSchema
>

export const RelaxedPresentationReferenceSchema = stripConstraints(
    PresentationReferenceSchema
)
export type TRelaxedPresentationReference = Static<
    typeof RelaxedPresentationReferenceSchema
>

export const RelaxedInterviewReferenceSchema = stripConstraints(
    InterviewReferenceSchema
)
export type TRelaxedInterviewReference = Static<
    typeof RelaxedInterviewReferenceSchema
>

export const RelaxedPersonalCommunicationReferenceSchema = stripConstraints(
    PersonalCommunicationReferenceSchema
)
export type TRelaxedPersonalCommunicationReference = Static<
    typeof RelaxedPersonalCommunicationReferenceSchema
>

export const RelaxedEmailReferenceSchema =
    stripConstraints(EmailReferenceSchema)
export type TRelaxedEmailReference = Static<typeof RelaxedEmailReferenceSchema>

export const RelaxedLawReferenceSchema = stripConstraints(LawReferenceSchema)
export type TRelaxedLawReference = Static<typeof RelaxedLawReferenceSchema>

export const RelaxedCourtCaseReferenceSchema = stripConstraints(
    CourtCaseReferenceSchema
)
export type TRelaxedCourtCaseReference = Static<
    typeof RelaxedCourtCaseReferenceSchema
>

export const RelaxedGovernmentPublicationReferenceSchema = stripConstraints(
    GovernmentPublicationReferenceSchema
)
export type TRelaxedGovernmentPublicationReference = Static<
    typeof RelaxedGovernmentPublicationReferenceSchema
>

export const RelaxedDatasheetReferenceSchema = stripConstraints(
    DatasheetReferenceSchema
)
export type TRelaxedDatasheetReference = Static<
    typeof RelaxedDatasheetReferenceSchema
>

export const RelaxedProductManualReferenceSchema = stripConstraints(
    ProductManualReferenceSchema
)
export type TRelaxedProductManualReference = Static<
    typeof RelaxedProductManualReferenceSchema
>

// ---------------------------------------------------------------------------
// Relaxed discriminated union
// ---------------------------------------------------------------------------
export const IEEEReferenceSchemaRelaxed = stripConstraints(IEEEReferenceSchema)
export type TRelaxedIEEEReference = Static<typeof IEEEReferenceSchemaRelaxed>

// ---------------------------------------------------------------------------
// Relaxed schema map
// ---------------------------------------------------------------------------
export const IEEEReferenceSchemaMapRelaxed = {
    Book: RelaxedBookReferenceSchema,
    Website: RelaxedWebsiteReferenceSchema,
    BookChapter: RelaxedBookChapterReferenceSchema,
    Handbook: RelaxedHandbookReferenceSchema,
    TechnicalReport: RelaxedTechnicalReportReferenceSchema,
    Standard: RelaxedStandardReferenceSchema,
    Thesis: RelaxedThesisReferenceSchema,
    Patent: RelaxedPatentReferenceSchema,
    Dictionary: RelaxedDictionaryReferenceSchema,
    Encyclopedia: RelaxedEncyclopediaReferenceSchema,
    JournalArticle: RelaxedJournalArticleReferenceSchema,
    MagazineArticle: RelaxedMagazineArticleReferenceSchema,
    NewspaperArticle: RelaxedNewspaperArticleReferenceSchema,
    ConferencePaper: RelaxedConferencePaperReferenceSchema,
    ConferenceProceedings: RelaxedConferenceProceedingsReferenceSchema,
    Dataset: RelaxedDatasetReferenceSchema,
    Software: RelaxedSoftwareReferenceSchema,
    OnlineDocument: RelaxedOnlineDocumentReferenceSchema,
    Blog: RelaxedBlogReferenceSchema,
    SocialMedia: RelaxedSocialMediaReferenceSchema,
    Preprint: RelaxedPreprintReferenceSchema,
    Video: RelaxedVideoReferenceSchema,
    Podcast: RelaxedPodcastReferenceSchema,
    Course: RelaxedCourseReferenceSchema,
    Presentation: RelaxedPresentationReferenceSchema,
    Interview: RelaxedInterviewReferenceSchema,
    PersonalCommunication: RelaxedPersonalCommunicationReferenceSchema,
    Email: RelaxedEmailReferenceSchema,
    Law: RelaxedLawReferenceSchema,
    CourtCase: RelaxedCourtCaseReferenceSchema,
    GovernmentPublication: RelaxedGovernmentPublicationReferenceSchema,
    Datasheet: RelaxedDatasheetReferenceSchema,
    ProductManual: RelaxedProductManualReferenceSchema,
} as const
```

- [ ] **Step 4: Update `src/extensions/ieee/index.ts`**

```ts
export * from "./references.js"
export * from "./relaxed.js"
export * from "./source.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: All tests PASS (including the new relaxed tests).

- [ ] **Step 6: Commit**

```bash
git add src/extensions/ieee/relaxed.ts src/extensions/ieee/index.ts test/extensions/ieee.test.ts
git commit -m "feat(ieee): add relaxed schema variants with constraints stripped"
```

---

### Task 3: Add citation formatting (`formatting.ts`)

**Files:**

- Create: `src/extensions/ieee/formatting.ts`
- Modify: `src/extensions/ieee/index.ts`
- Test: `test/extensions/ieee.test.ts`

- [ ] **Step 1: Add `formatNamesInCitation` tests**

Append to `test/extensions/ieee.test.ts`, inside `describe("IEEE extension")`:

```ts
import {
    formatNamesInCitation,
    formatCitationParts,
    type TCitationSegment,
} from "../../src/extensions/ieee"

// ... inside describe("IEEE extension") ...

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
            formatNamesInCitation(["Jane Smith", "Bob Wilson", "Carol White"])
        ).toBe("J. Smith, B. Wilson, and C. White")
    })

    it("handles single-element array", () => {
        expect(formatNamesInCitation(["Jane Smith"])).toBe("J. Smith")
    })
})
```

- [ ] **Step 2: Add `formatCitationParts` tests**

Append to the test file, inside `describe("IEEE extension")`:

```ts
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
            {
                type: "Dictionary" as const,
                publisher: "OUP",
            },
            {
                type: "Encyclopedia" as const,
                publisher: "Britannica",
            },
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
            const result = formatCitationParts(ref as any)
            expect(result.type).toBe(ref.type)
            expect(result.segments.length).toBeGreaterThan(0)
            for (const seg of result.segments) {
                expect(seg.text.length).toBeGreaterThan(0)
            }
        }
    })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: FAIL — formatting imports don't exist yet.

- [ ] **Step 4: Create `src/extensions/ieee/formatting.ts`**

```ts
import type { TIEEEReference, TReferenceType } from "./references.js"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface TCitationSegment {
    text: string
    role:
        | "authors"
        | "title"
        | "bookTitle"
        | "publisher"
        | "location"
        | "year"
        | "date"
        | "edition"
        | "pages"
        | "volume"
        | "issue"
        | "doi"
        | "url"
        | "isbn"
        | "accessedDate"
        | "institution"
        | "degree"
        | "organization"
        | "standardNumber"
        | "reportNumber"
        | "patentNumber"
        | "country"
        | "platform"
        | "separator"
        | "prefix"
        | "suffix"
        | "misc"
    style?: "italic" | "quoted" | "link" | "plain"
}

export interface TCitationFormatResult {
    type: TReferenceType
    segments: TCitationSegment[]
}

// ---------------------------------------------------------------------------
// Name formatting
// ---------------------------------------------------------------------------
export function formatNamesInCitation(names: string[]): string {
    if (names.length === 0) return ""

    const formatted = names.map((name) => {
        const parts = name.trim().split(/\s+/)
        if (parts.length === 1) return parts[0]
        const [first, ...rest] = parts
        return `${first.charAt(0)}. ${rest.join(" ")}`
    })

    if (formatted.length === 1) return formatted[0]
    if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`
    return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`
}

// ---------------------------------------------------------------------------
// Segment helpers (internal)
// ---------------------------------------------------------------------------
function sep(text: string): TCitationSegment {
    return { text, role: "separator" }
}

function formatDate(d: Date): string {
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    })
}

type SegmentBuilder = (ref: Record<string, unknown>) => TCitationSegment[]

// ---------------------------------------------------------------------------
// Per-type segment builders
// ---------------------------------------------------------------------------
function bookSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.title as string, role: "title", style: "italic" })
    if (ref.edition !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.edition as string, role: "edition" })
        segs.push({ text: " ed.", role: "suffix" })
    }
    if (ref.location !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.location as string, role: "location" })
    }
    segs.push(sep(": "))
    segs.push({ text: ref.publisher as string, role: "publisher" })
    segs.push(sep(", "))
    segs.push({ text: ref.year as string, role: "year" })
    segs.push(sep("."))
    if (ref.isbn !== undefined) {
        segs.push(sep(" "))
        segs.push({ text: ref.isbn as string, role: "isbn" })
    }
    return segs
}

function websiteSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(". "))
    segs.push({ text: ref.pageTitle as string, role: "title", style: "quoted" })
    segs.push(sep(". "))
    segs.push({
        text: ref.websiteTitle as string,
        role: "misc",
        style: "italic",
    })
    segs.push(sep(". "))
    segs.push({ text: "Accessed: ", role: "prefix" })
    segs.push({
        text: formatDate(ref.accessedDate as Date),
        role: "accessedDate",
    })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function bookChapterSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({
        text: ref.chapterTitle as string,
        role: "title",
        style: "quoted",
    })
    segs.push(sep(", in "))
    segs.push({
        text: ref.bookTitle as string,
        role: "bookTitle",
        style: "italic",
    })
    if (ref.editors !== undefined) {
        segs.push(sep(", "))
        segs.push({
            text: formatNamesInCitation(ref.editors as string[]),
            role: "misc",
        })
        segs.push({ text: ", Ed.", role: "suffix" })
    }
    segs.push(sep(". "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep(": "))
    segs.push({ text: ref.publisher as string, role: "publisher" })
    if (ref.pages !== undefined) {
        segs.push(sep(", pp. "))
        segs.push({ text: ref.pages as string, role: "pages" })
    }
    segs.push(sep("."))
    if (ref.isbn !== undefined) {
        segs.push(sep(" "))
        segs.push({ text: ref.isbn as string, role: "isbn" })
    }
    return segs
}

function handbookSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    if (ref.edition !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.edition as string, role: "edition" })
        segs.push({ text: " ed.", role: "suffix" })
    }
    segs.push(sep(". "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep(": "))
    segs.push({ text: ref.publisher as string, role: "publisher" })
    segs.push(sep("."))
    if (ref.isbn !== undefined) {
        segs.push(sep(" "))
        segs.push({ text: ref.isbn as string, role: "isbn" })
    }
    return segs
}

function technicalReportSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.institution as string, role: "institution" })
    segs.push(sep(", "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep(", Rep. "))
    segs.push({ text: ref.reportNumber as string, role: "reportNumber" })
    segs.push(sep("."))
    return segs
}

function standardSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: ref.title as string,
        role: "title",
        style: "italic",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.standardNumber as string, role: "standardNumber" })
    segs.push(sep(", "))
    segs.push({ text: ref.organization as string, role: "organization" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep("."))
    return segs
}

function thesisSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.degree as string, role: "degree" })
    segs.push({ text: " thesis", role: "suffix" })
    segs.push(sep(", "))
    segs.push({ text: ref.institution as string, role: "institution" })
    segs.push(sep(", "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep("."))
    return segs
}

function patentSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.inventors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.country as string, role: "country" })
    segs.push({ text: " Patent ", role: "prefix" })
    segs.push({ text: ref.patentNumber as string, role: "patentNumber" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep("."))
    return segs
}

function dictionarySegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.publisher as string, role: "publisher" })
    if (ref.edition !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.edition as string, role: "edition" })
        segs.push({ text: " ed.", role: "suffix" })
    }
    segs.push(sep("."))
    return segs
}

function encyclopediaSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.publisher as string, role: "publisher" })
    if (ref.edition !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.edition as string, role: "edition" })
        segs.push({ text: " ed.", role: "suffix" })
    }
    segs.push(sep("."))
    return segs
}

function journalArticleSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({
        text: ref.journalTitle as string,
        role: "title",
        style: "italic",
    })
    if (ref.volume !== undefined) {
        segs.push(sep(", vol. "))
        segs.push({ text: ref.volume as string, role: "volume" })
    }
    if (ref.issue !== undefined) {
        segs.push(sep(", no. "))
        segs.push({ text: ref.issue as string, role: "issue" })
    }
    if (ref.pages !== undefined) {
        segs.push(sep(", pp. "))
        segs.push({ text: ref.pages as string, role: "pages" })
    }
    if (ref.doi !== undefined) {
        segs.push(sep(", doi: "))
        segs.push({ text: ref.doi as string, role: "doi" })
    }
    segs.push(sep("."))
    return segs
}

function magazineArticleSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({
        text: ref.magazineTitle as string,
        role: "title",
        style: "italic",
    })
    if (ref.volume !== undefined) {
        segs.push(sep(", vol. "))
        segs.push({ text: ref.volume as string, role: "volume" })
    }
    if (ref.issue !== undefined) {
        segs.push(sep(", no. "))
        segs.push({ text: ref.issue as string, role: "issue" })
    }
    if (ref.pages !== undefined) {
        segs.push(sep(", pp. "))
        segs.push({ text: ref.pages as string, role: "pages" })
    }
    segs.push(sep("."))
    return segs
}

function newspaperArticleSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({
        text: ref.newspaperTitle as string,
        role: "title",
        style: "italic",
    })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    if (ref.pages !== undefined) {
        segs.push(sep(", pp. "))
        segs.push({ text: ref.pages as string, role: "pages" })
    }
    segs.push(sep("."))
    return segs
}

function conferencePaperSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", presented at "))
    segs.push({
        text: ref.conferenceName as string,
        role: "title",
        style: "italic",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    if (ref.pages !== undefined) {
        segs.push(sep(", pp. "))
        segs.push({ text: ref.pages as string, role: "pages" })
    }
    if (ref.doi !== undefined) {
        segs.push(sep(", doi: "))
        segs.push({ text: ref.doi as string, role: "doi" })
    }
    segs.push(sep("."))
    return segs
}

function conferenceProceedingsSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.editors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.editors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push({ text: ", Ed.", role: "suffix" })
        segs.push(sep(", "))
    }
    segs.push({
        text: ref.conferenceName as string,
        role: "title",
        style: "italic",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep(". "))
    segs.push({ text: ref.publisher as string, role: "publisher" })
    segs.push(sep("."))
    if (ref.isbn !== undefined) {
        segs.push(sep(" "))
        segs.push({ text: ref.isbn as string, role: "isbn" })
    }
    return segs
}

function datasetSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.authors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.authors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push(sep(", "))
    }
    segs.push({ text: ref.repository as string, role: "misc" })
    if (ref.version !== undefined) {
        segs.push(sep(", ver. "))
        segs.push({ text: ref.version as string, role: "misc" })
    }
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    if (ref.doi !== undefined) {
        segs.push(sep(", doi: "))
        segs.push({ text: ref.doi as string, role: "doi" })
    }
    return segs
}

function softwareSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.authors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.authors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push(sep(", "))
    }
    if (ref.publisher !== undefined) {
        segs.push({ text: ref.publisher as string, role: "publisher" })
        segs.push(sep(", "))
    }
    if (ref.version !== undefined) {
        segs.push(sep("ver. "))
        segs.push({ text: ref.version as string, role: "misc" })
        segs.push(sep(". "))
    }
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    if (ref.doi !== undefined) {
        segs.push(sep(", doi: "))
        segs.push({ text: ref.doi as string, role: "doi" })
    }
    return segs
}

function onlineDocumentSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.authors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.authors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push(sep(", "))
    }
    segs.push({ text: ref.title as string, role: "title", style: "quoted" })
    if (ref.publisher !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.publisher as string, role: "publisher" })
    }
    segs.push(sep(". "))
    segs.push({ text: "Accessed: ", role: "prefix" })
    segs.push({
        text: formatDate(ref.accessedDate as Date),
        role: "accessedDate",
    })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function blogSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.author as string, role: "authors", style: "plain" })
    segs.push(sep(", "))
    segs.push({ text: ref.blogTitle as string, role: "title", style: "quoted" })
    segs.push(sep(". "))
    segs.push({ text: "Accessed: ", role: "prefix" })
    segs.push({
        text: formatDate(ref.accessedDate as Date),
        role: "accessedDate",
    })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function socialMediaSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.author as string, role: "authors", style: "plain" })
    segs.push(sep(", "))
    segs.push({ text: ref.platform as string, role: "platform" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.postDate as Date), role: "date" })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function preprintSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: formatNamesInCitation(ref.authors as string[]),
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.server as string, role: "misc" })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    if (ref.doi !== undefined) {
        segs.push(sep(", doi: "))
        segs.push({ text: ref.doi as string, role: "doi" })
    }
    return segs
}

function videoSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.authors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.authors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push(sep(", "))
    }
    segs.push({ text: ref.platform as string, role: "platform" })
    segs.push(sep(". "))
    segs.push({ text: "Accessed: ", role: "prefix" })
    segs.push({
        text: formatDate(ref.accessedDate as Date),
        role: "accessedDate",
    })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function podcastSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.authors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.authors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push(sep(", "))
    }
    segs.push({
        text: ref.episodeTitle as string,
        role: "title",
        style: "quoted",
    })
    segs.push(sep(", "))
    segs.push({
        text: ref.seriesTitle as string,
        role: "misc",
        style: "italic",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.platform as string, role: "platform" })
    segs.push(sep(". "))
    segs.push({ text: "Accessed: ", role: "prefix" })
    segs.push({
        text: formatDate(ref.accessedDate as Date),
        role: "accessedDate",
    })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function courseSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: ref.instructor as string,
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.institution as string, role: "institution" })
    if (ref.courseCode !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.courseCode as string, role: "misc" })
    }
    segs.push(sep(", "))
    segs.push({ text: ref.term as string, role: "misc" })
    segs.push(sep("."))
    return segs
}

function presentationSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: ref.presenter as string,
        role: "authors",
        style: "plain",
    })
    segs.push(sep(", presented at "))
    segs.push({
        text: ref.eventTitle as string,
        role: "title",
        style: "italic",
    })
    segs.push(sep(", "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep("."))
    return segs
}

function interviewSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({
        text: ref.interviewee as string,
        role: "authors",
        style: "plain",
    })
    if (ref.interviewer !== undefined) {
        segs.push(sep(", interview with "))
        segs.push({ text: ref.interviewer as string, role: "misc" })
    }
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep("."))
    return segs
}

function personalCommunicationSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.person as string, role: "authors", style: "plain" })
    segs.push(sep(", private communication, "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep("."))
    return segs
}

function emailSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.sender as string, role: "authors", style: "plain" })
    segs.push(sep(", personal email to "))
    segs.push({ text: ref.recipient as string, role: "misc" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    segs.push(sep("."))
    return segs
}

function lawSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.title as string, role: "title", style: "italic" })
    segs.push(sep(", "))
    segs.push({ text: ref.jurisdiction as string, role: "misc" })
    segs.push(sep(", "))
    segs.push({
        text: formatDate(ref.dateEnacted as Date),
        role: "date",
    })
    segs.push(sep("."))
    return segs
}

function courtCaseSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.caseName as string, role: "title", style: "italic" })
    segs.push(sep(", "))
    segs.push({ text: ref.court as string, role: "misc" })
    segs.push(sep(", "))
    segs.push({ text: formatDate(ref.date as Date), role: "date" })
    if (ref.reporter !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.reporter as string, role: "misc" })
    }
    segs.push(sep("."))
    return segs
}

function governmentPublicationSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    if (ref.authors !== undefined) {
        segs.push({
            text: formatNamesInCitation(ref.authors as string[]),
            role: "authors",
            style: "plain",
        })
        segs.push(sep(", "))
    }
    segs.push({ text: ref.agency as string, role: "organization" })
    if (ref.reportNumber !== undefined) {
        segs.push(sep(", "))
        segs.push({ text: ref.reportNumber as string, role: "reportNumber" })
    }
    segs.push(sep(", "))
    segs.push({ text: ref.location as string, role: "location" })
    segs.push(sep("."))
    return segs
}

function datasheetSegments(ref: Record<string, unknown>): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.manufacturer as string, role: "publisher" })
    segs.push(sep(", "))
    segs.push({ text: ref.partNumber as string, role: "misc" })
    segs.push(sep(". "))
    segs.push({ text: "[Online]. Available: ", role: "prefix" })
    segs.push({ text: ref.url as string, role: "url", style: "link" })
    return segs
}

function productManualSegments(
    ref: Record<string, unknown>
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    segs.push({ text: ref.manufacturer as string, role: "publisher" })
    segs.push(sep(", "))
    segs.push({ text: ref.model as string, role: "misc" })
    segs.push({ text: " User Manual", role: "suffix" })
    if (ref.url !== undefined) {
        segs.push(sep(". "))
        segs.push({ text: "[Online]. Available: ", role: "prefix" })
        segs.push({ text: ref.url as string, role: "url", style: "link" })
    }
    segs.push(sep("."))
    return segs
}

// ---------------------------------------------------------------------------
// Builder dispatch map
// ---------------------------------------------------------------------------
const BUILDERS: Record<TReferenceType, SegmentBuilder> = {
    Book: bookSegments,
    Website: websiteSegments,
    BookChapter: bookChapterSegments,
    Handbook: handbookSegments,
    TechnicalReport: technicalReportSegments,
    Standard: standardSegments,
    Thesis: thesisSegments,
    Patent: patentSegments,
    Dictionary: dictionarySegments,
    Encyclopedia: encyclopediaSegments,
    JournalArticle: journalArticleSegments,
    MagazineArticle: magazineArticleSegments,
    NewspaperArticle: newspaperArticleSegments,
    ConferencePaper: conferencePaperSegments,
    ConferenceProceedings: conferenceProceedingsSegments,
    Dataset: datasetSegments,
    Software: softwareSegments,
    OnlineDocument: onlineDocumentSegments,
    Blog: blogSegments,
    SocialMedia: socialMediaSegments,
    Preprint: preprintSegments,
    Video: videoSegments,
    Podcast: podcastSegments,
    Course: courseSegments,
    Presentation: presentationSegments,
    Interview: interviewSegments,
    PersonalCommunication: personalCommunicationSegments,
    Email: emailSegments,
    Law: lawSegments,
    CourtCase: courtCaseSegments,
    GovernmentPublication: governmentPublicationSegments,
    Datasheet: datasheetSegments,
    ProductManual: productManualSegments,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function formatCitationParts(
    ref: TIEEEReference
): TCitationFormatResult {
    const builder = BUILDERS[ref.type]
    return {
        type: ref.type,
        segments: builder(ref as unknown as Record<string, unknown>),
    }
}
```

- [ ] **Step 5: Update `src/extensions/ieee/index.ts`**

```ts
export * from "./references.js"
export * from "./relaxed.js"
export * from "./formatting.js"
export * from "./source.js"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/extensions/ieee/formatting.ts src/extensions/ieee/index.ts test/extensions/ieee.test.ts
git commit -m "feat(ieee): add citation formatting with structured segments"
```

---

### Task 4: Lint, typecheck, and full test suite

**Files:**

- Possibly modify: any files with lint/type issues

- [ ] **Step 1: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS. If there are type errors in the new files, fix them.

- [ ] **Step 2: Run lint**

Run: `pnpm eslint . --fix && pnpm run prettify`
Then: `pnpm run lint`
Expected: PASS. Fix any remaining issues.

- [ ] **Step 3: Run full test suite**

Run: `pnpm run test`
Expected: All tests PASS (existing + new IEEE tests).

- [ ] **Step 4: Commit any lint/type fixes**

```bash
git add -A
git commit -m "chore(ieee): fix lint and formatting"
```

(Skip this commit if no changes were needed.)

---

### Task 5: Update documentation

**Files:**

- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Update release notes**

Add to `docs/release-notes/upcoming.md`:

```markdown
### IEEE Extension Enrichment

- All 33 IEEE reference type schemas now include field descriptions, validation constraints (min lengths, regex patterns for ISBN/DOI/URL, format hints), and proper date handling via `EncodableDate`.
- New `IEEEReferenceSchemaMap` export for per-type schema lookup.
- New relaxed schema variants (`IEEEReferenceSchemaRelaxed`, `IEEEReferenceSchemaMapRelaxed`, and all 33 individual relaxed schemas) with validation constraints stripped for permissive use cases.
- New `formatCitationParts()` function that produces structured citation segments with roles and style hints for consumer rendering.
- New `formatNamesInCitation()` function for IEEE-style author name abbreviation.

**Breaking:** `accessedDate`, `date`, `postDate`, and `dateEnacted` fields across all reference types now use `EncodableDate` instead of `Type.Number()` or `Type.String()`. Values convert automatically from strings and numbers via `Value.Parse()`.
```

- [ ] **Step 2: Update changelog**

Add to `docs/changelogs/upcoming.md`:

```markdown
### IEEE Extension Enrichment

- `src/extensions/ieee/references.ts` — Added field descriptions, validation constraints (minLength, minItems, pattern, format), EncodableDate for date fields, IEEEReferenceSchemaMap export
- `src/extensions/ieee/relaxed.ts` — New file: constraint-stripped schema variants with stripConstraints internal utility
- `src/extensions/ieee/formatting.ts` — New file: formatCitationParts(), formatNamesInCitation(), TCitationSegment, TCitationFormatResult types
- `src/extensions/ieee/index.ts` — Updated barrel to re-export relaxed and formatting modules
- `test/extensions/ieee.test.ts` — New file: comprehensive tests for schema validation, constraint rejections, EncodableDate, relaxed schemas, schema map, name formatting, citation parts formatting
```

- [ ] **Step 3: Commit**

```bash
git add docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: add IEEE extension enrichment to release notes and changelog"
```
