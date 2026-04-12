// IEEE Citation Segment Templates — declarative config arrays interpreted by buildSegments()

import type { TCitationSegment } from "./formatting.js"

// ---------------------------------------------------------------------------
// Instruction types
// ---------------------------------------------------------------------------

export interface TSegmentSource {
    kind: "string" | "date" | "authors" | "singleAuthor" | "literal"
    field?: string
    text?: string
}

export interface TSegmentInstructionSegment {
    type: "segment"
    source: TSegmentSource
    role: TCitationSegment["role"]
    style?: TCitationSegment["style"]
}

export interface TSegmentInstructionSeparator {
    type: "separator"
    text: string
}

export interface TSegmentInstructionConditional {
    type: "conditional"
    field: string
    checkLength?: boolean
    then: TSegmentInstruction[]
}

export type TSegmentInstruction =
    | TSegmentInstructionSegment
    | TSegmentInstructionSeparator
    | TSegmentInstructionConditional

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// Book: authors, ", ", title(italic), [", ", edition, " ed."], [", ", location], ": ", publisher, ", ", year, ".", [" ", isbn]
export const BOOK_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    {
        type: "conditional",
        field: "edition",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "edition" },
                role: "edition",
            },
            {
                type: "segment",
                source: { kind: "literal", text: " ed." },
                role: "suffix",
            },
        ],
    },
    {
        type: "conditional",
        field: "location",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "location" },
                role: "location",
            },
        ],
    },
    { type: "separator", text: ": " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
    {
        type: "conditional",
        field: "isbn",
        then: [
            { type: "separator", text: " " },
            {
                type: "segment",
                source: { kind: "string", field: "isbn" },
                role: "isbn",
            },
        ],
    },
]

// Website: authors, ". ", pageTitle(quoted), ". ", websiteTitle(italic,misc), ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const WEBSITE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "pageTitle" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "websiteTitle" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "Accessed: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "date", field: "accessedDate" },
        role: "accessedDate",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// BookChapter: authors, ", ", chapterTitle(quoted), ", in ", bookTitle(italic,bookTitle), [editors+Eds.], ". ", location, ": ", publisher, ", ", year, [", pp. ", pages], ".", [" ", isbn]
export const BOOK_CHAPTER_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "chapterTitle" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", in " },
    {
        type: "segment",
        source: { kind: "string", field: "bookTitle" },
        role: "bookTitle",
        style: "italic",
    },
    {
        type: "conditional",
        field: "editors",
        checkLength: true,
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "authors", field: "editors" },
                role: "misc",
            },
            {
                type: "segment",
                source: { kind: "literal", text: ", Eds." },
                role: "suffix",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ": " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    {
        type: "conditional",
        field: "pages",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "literal", text: "pp. " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "string", field: "pages" },
                role: "pages",
            },
        ],
    },
    { type: "separator", text: "." },
    {
        type: "conditional",
        field: "isbn",
        then: [
            { type: "separator", text: " " },
            {
                type: "segment",
                source: { kind: "string", field: "isbn" },
                role: "isbn",
            },
        ],
    },
]

// Handbook: title(italic), [", ", edition, " ed."], ". ", location, ": ", publisher, ", ", year, ".", [" ", isbn]
export const HANDBOOK_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    {
        type: "conditional",
        field: "edition",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "edition" },
                role: "edition",
            },
            {
                type: "segment",
                source: { kind: "literal", text: " ed." },
                role: "suffix",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ": " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
    {
        type: "conditional",
        field: "isbn",
        then: [
            { type: "separator", text: " " },
            {
                type: "segment",
                source: { kind: "string", field: "isbn" },
                role: "isbn",
            },
        ],
    },
]

// TechnicalReport: authors, ", ", title(quoted), ", ", institution, ", ", location, ", ", "Rep. ", reportNumber, ", ", year, "."
export const TECHNICAL_REPORT_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "institution" },
        role: "institution",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "literal", text: "Rep. " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "reportNumber" },
        role: "reportNumber",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
]

// Standard: title(italic), ", ", standardNumber, ", ", organization, ", ", date, "."
export const STANDARD_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "standardNumber" },
        role: "standardNumber",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "organization" },
        role: "organization",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// Thesis: authors, ", ", title(quoted), ", ", degree, " thesis", ", ", institution, ", ", location, ", ", year, "."
export const THESIS_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "degree" },
        role: "degree",
    },
    {
        type: "segment",
        source: { kind: "literal", text: " thesis" },
        role: "suffix",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "institution" },
        role: "institution",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
]

// Patent: inventors(authors), ", ", title(quoted), ", ", country, " Patent ", patentNumber, ", ", date, "."
export const PATENT_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "inventors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "country" },
        role: "country",
    },
    {
        type: "segment",
        source: { kind: "literal", text: " Patent " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "patentNumber" },
        role: "patentNumber",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// Dictionary: title(italic), ". ", publisher, [", ", edition, " ed."], ", ", year, "."
export const DICTIONARY_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    {
        type: "conditional",
        field: "edition",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "edition" },
                role: "edition",
            },
            {
                type: "segment",
                source: { kind: "literal", text: " ed." },
                role: "suffix",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
]

// Encyclopedia: title(italic), ". ", publisher, [", ", edition, " ed."], ", ", year, "."
export const ENCYCLOPEDIA_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    {
        type: "conditional",
        field: "edition",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "edition" },
                role: "edition",
            },
            {
                type: "segment",
                source: { kind: "literal", text: " ed." },
                role: "suffix",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
]

// JournalArticle: authors, ", ", title(quoted), ", ", journalTitle(italic,misc), [", vol. ", volume], [", no. ", issue], [", pp. ", pages], ", ", year, [", doi: ", doi], "."
export const JOURNAL_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "journalTitle" },
        role: "misc",
        style: "italic",
    },
    {
        type: "conditional",
        field: "volume",
        then: [
            { type: "separator", text: ", vol. " },
            {
                type: "segment",
                source: { kind: "string", field: "volume" },
                role: "volume",
            },
        ],
    },
    {
        type: "conditional",
        field: "issue",
        then: [
            { type: "separator", text: ", no. " },
            {
                type: "segment",
                source: { kind: "string", field: "issue" },
                role: "issue",
            },
        ],
    },
    {
        type: "conditional",
        field: "pages",
        then: [
            { type: "separator", text: ", pp. " },
            {
                type: "segment",
                source: { kind: "string", field: "pages" },
                role: "pages",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    {
        type: "conditional",
        field: "doi",
        then: [
            { type: "separator", text: ", doi: " },
            {
                type: "segment",
                source: { kind: "string", field: "doi" },
                role: "doi",
            },
        ],
    },
    { type: "separator", text: "." },
]

// MagazineArticle: authors, ", ", title(quoted), ", ", magazineTitle(italic,misc), [", vol. ", volume], [", no. ", issue], [", pp. ", pages], ", ", year, "."
export const MAGAZINE_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "magazineTitle" },
        role: "misc",
        style: "italic",
    },
    {
        type: "conditional",
        field: "volume",
        then: [
            { type: "separator", text: ", vol. " },
            {
                type: "segment",
                source: { kind: "string", field: "volume" },
                role: "volume",
            },
        ],
    },
    {
        type: "conditional",
        field: "issue",
        then: [
            { type: "separator", text: ", no. " },
            {
                type: "segment",
                source: { kind: "string", field: "issue" },
                role: "issue",
            },
        ],
    },
    {
        type: "conditional",
        field: "pages",
        then: [
            { type: "separator", text: ", pp. " },
            {
                type: "segment",
                source: { kind: "string", field: "pages" },
                role: "pages",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
]

// NewspaperArticle: authors, ", ", title(quoted), ", ", newspaperTitle(italic,misc), ", ", date, [", pp. ", pages], "."
export const NEWSPAPER_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "newspaperTitle" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    {
        type: "conditional",
        field: "pages",
        then: [
            { type: "separator", text: ", pp. " },
            {
                type: "segment",
                source: { kind: "string", field: "pages" },
                role: "pages",
            },
        ],
    },
    { type: "separator", text: "." },
]

// ConferencePaper: authors, ", ", title(quoted), ", ", "presented at ", conferenceName(italic,misc), ", ", location, ", ", date, [", pp. ", pages], [", doi: ", doi], "."
export const CONFERENCE_PAPER_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "literal", text: "presented at " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "conferenceName" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    {
        type: "conditional",
        field: "pages",
        then: [
            { type: "separator", text: ", pp. " },
            {
                type: "segment",
                source: { kind: "string", field: "pages" },
                role: "pages",
            },
        ],
    },
    {
        type: "conditional",
        field: "doi",
        then: [
            { type: "separator", text: ", doi: " },
            {
                type: "segment",
                source: { kind: "string", field: "doi" },
                role: "doi",
            },
        ],
    },
    { type: "separator", text: "." },
]

// ConferenceProceedings: [editors+", Eds.", ", "], conferenceName(italic,title), ", ", location, ", ", date, ". ", publisher, [". ", isbn], "."
export const CONFERENCE_PROCEEDINGS_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "editors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "editors" },
                role: "authors",
                style: "plain",
            },
            {
                type: "segment",
                source: { kind: "literal", text: ", Eds." },
                role: "suffix",
            },
            { type: "separator", text: ", " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "conferenceName" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    {
        type: "conditional",
        field: "isbn",
        then: [
            { type: "separator", text: ". " },
            {
                type: "segment",
                source: { kind: "string", field: "isbn" },
                role: "isbn",
            },
        ],
    },
    { type: "separator", text: "." },
]

// Dataset: [authors, ", "], title(quoted), ", ", repository(misc), [", ver. ", version(misc)], ", ", year, [", doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const DATASET_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "authors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "authors" },
                role: "authors",
                style: "plain",
            },
            { type: "separator", text: ", " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "repository" },
        role: "misc",
    },
    {
        type: "conditional",
        field: "version",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "literal", text: "ver. " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "string", field: "version" },
                role: "misc",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    {
        type: "conditional",
        field: "doi",
        then: [
            { type: "separator", text: ", doi: " },
            {
                type: "segment",
                source: { kind: "string", field: "doi" },
                role: "doi",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// Software: [authors, ", "], title(italic), [", ver. ", version(misc)], ", ", year, [". ", publisher], [". ", "doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const SOFTWARE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "authors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "authors" },
                role: "authors",
                style: "plain",
            },
            { type: "separator", text: ", " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    {
        type: "conditional",
        field: "version",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "literal", text: "ver. " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "string", field: "version" },
                role: "misc",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    {
        type: "conditional",
        field: "publisher",
        then: [
            { type: "separator", text: ". " },
            {
                type: "segment",
                source: { kind: "string", field: "publisher" },
                role: "publisher",
            },
        ],
    },
    {
        type: "conditional",
        field: "doi",
        then: [
            { type: "separator", text: ". " },
            {
                type: "segment",
                source: { kind: "literal", text: "doi: " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "string", field: "doi" },
                role: "doi",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// OnlineDocument: [authors, ". "], title(quoted), [". ", publisher], ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const ONLINE_DOCUMENT_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "authors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "authors" },
                role: "authors",
                style: "plain",
            },
            { type: "separator", text: ". " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    {
        type: "conditional",
        field: "publisher",
        then: [
            { type: "separator", text: ". " },
            {
                type: "segment",
                source: { kind: "string", field: "publisher" },
                role: "publisher",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "Accessed: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "date", field: "accessedDate" },
        role: "accessedDate",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// Blog: author(single), ", ", postTitle(quoted), ", ", blogName(italic,misc), ", ", date, ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const BLOG_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "author" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "postTitle" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "blogName" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "Accessed: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "date", field: "accessedDate" },
        role: "accessedDate",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// SocialMedia: author(single), ". ", platform, ". ", postDate(date), ". ", "[Online]. Available: ", url(link)
export const SOCIAL_MEDIA_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "author" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "platform" },
        role: "platform",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "date", field: "postDate" },
        role: "date",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// Preprint: authors, ", ", title(quoted), ", ", server(italic,misc), ", ", year, [", doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const PREPRINT_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "server" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    {
        type: "conditional",
        field: "doi",
        then: [
            { type: "separator", text: ", doi: " },
            {
                type: "segment",
                source: { kind: "string", field: "doi" },
                role: "doi",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// Video: [authors, ". "], title(italic), ". ", platform, [". ", releaseDate(date)], ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const VIDEO_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "authors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "authors" },
                role: "authors",
                style: "plain",
            },
            { type: "separator", text: ". " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "platform" },
        role: "platform",
    },
    {
        type: "conditional",
        field: "releaseDate",
        then: [
            { type: "separator", text: ". " },
            {
                type: "segment",
                source: { kind: "date", field: "releaseDate" },
                role: "date",
            },
        ],
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "Accessed: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "date", field: "accessedDate" },
        role: "accessedDate",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// Podcast: [authors, ". "], episodeTitle(quoted), ", in ", seriesTitle(italic,misc), ". ", platform, ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const PODCAST_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "authors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "authors" },
                role: "authors",
                style: "plain",
            },
            { type: "separator", text: ". " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "episodeTitle" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", in " },
    {
        type: "segment",
        source: { kind: "string", field: "seriesTitle" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "string", field: "platform" },
        role: "platform",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "Accessed: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "date", field: "accessedDate" },
        role: "accessedDate",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// Course: instructor(single), ", ", title(italic), ", ", institution, [", ", courseCode(misc)], ", ", term(misc), ", ", year, "."
export const COURSE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "instructor" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "institution" },
        role: "institution",
    },
    {
        type: "conditional",
        field: "courseCode",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "courseCode" },
                role: "misc",
            },
        ],
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "term" },
        role: "misc",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
]

// Presentation: presenter(single), ", ", title(quoted), ", ", "presented at ", eventTitle(italic,misc), ", ", location, ", ", date, "."
export const PRESENTATION_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "presenter" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "quoted",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "literal", text: "presented at " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "eventTitle" },
        role: "misc",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// Interview: interviewee(single), [", ", "interviewed by ", interviewer(single,misc)], ", ", date, "."
export const INTERVIEW_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "interviewee" },
        role: "authors",
        style: "plain",
    },
    {
        type: "conditional",
        field: "interviewer",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "literal", text: "interviewed by " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "singleAuthor", field: "interviewer" },
                role: "misc",
            },
        ],
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// PersonalCommunication: person(single), ", ", "personal communication"(misc), ", ", date, "."
export const PERSONAL_COMMUNICATION_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "person" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "literal", text: "personal communication" },
        role: "misc",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// Email: sender(single), ", ", "email to ", recipient(single,misc), ", ", date, "."
export const EMAIL_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "sender" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "literal", text: "email to " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "singleAuthor", field: "recipient" },
        role: "misc",
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// Law: title(italic), ", ", jurisdiction(misc), ", ", dateEnacted(date), "."
export const LAW_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "jurisdiction" },
        role: "misc",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "date", field: "dateEnacted" },
        role: "date",
    },
    { type: "separator", text: "." },
]

// CourtCase: caseName(italic,title), ", ", court(misc), [", ", reporter(misc)], ", ", date, "."
export const COURT_CASE_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "caseName" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "court" },
        role: "misc",
    },
    {
        type: "conditional",
        field: "reporter",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "reporter" },
                role: "misc",
            },
        ],
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// GovernmentPublication: [authors, ", "], title(italic), ", ", agency(organization), ", ", location, [", Rep. ", reportNumber], ", ", date, "."
export const GOVERNMENT_PUBLICATION_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "conditional",
        field: "authors",
        checkLength: true,
        then: [
            {
                type: "segment",
                source: { kind: "authors", field: "authors" },
                role: "authors",
                style: "plain",
            },
            { type: "separator", text: ", " },
        ],
    },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "agency" },
        role: "organization",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "location" },
        role: "location",
    },
    {
        type: "conditional",
        field: "reportNumber",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "literal", text: "Rep. " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "string", field: "reportNumber" },
                role: "reportNumber",
            },
        ],
    },
    { type: "separator", text: ", " },
    { type: "segment", source: { kind: "date", field: "date" }, role: "date" },
    { type: "separator", text: "." },
]

// Datasheet: title(italic), ", ", manufacturer(publisher), ", ", partNumber(misc), ", ", year, ". ", "[Online]. Available: ", url(link)
export const DATASHEET_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "manufacturer" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "partNumber" },
        role: "misc",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: ". " },
    {
        type: "segment",
        source: { kind: "literal", text: "[Online]. Available: " },
        role: "prefix",
    },
    {
        type: "segment",
        source: { kind: "string", field: "url" },
        role: "url",
        style: "link",
    },
]

// ProductManual: title(italic), ", ", manufacturer(publisher), ", ", model(misc), ", ", year, [". ", "[Online]. Available: ", url(link)], "."
export const PRODUCT_MANUAL_TEMPLATE: TSegmentInstruction[] = [
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "manufacturer" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "model" },
        role: "misc",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    {
        type: "conditional",
        field: "url",
        then: [
            { type: "separator", text: ". " },
            {
                type: "segment",
                source: { kind: "literal", text: "[Online]. Available: " },
                role: "prefix",
            },
            {
                type: "segment",
                source: { kind: "string", field: "url" },
                role: "url",
                style: "link",
            },
        ],
    },
    { type: "separator", text: "." },
]
