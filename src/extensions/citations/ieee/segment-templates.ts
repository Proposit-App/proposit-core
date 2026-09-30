// IEEE Citation Segment Templates — declarative config arrays interpreted by buildSegments()

import type { TCitationSegment } from "./segment-types.js"

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
    /** Emitted exactly when `then` is not. */
    else?: TSegmentInstruction[]
}

export type TSegmentInstruction =
    | TSegmentInstructionSegment
    | TSegmentInstructionSeparator
    | TSegmentInstructionConditional

// ---------------------------------------------------------------------------
// Fragment builders
// ---------------------------------------------------------------------------
// Every builder returns newly created objects on each call, so no two
// templates share an instruction object and changing one template can never
// change another. Keys are written in the same order as the original
// hand-written literals, so each template serializes exactly as before.

type TSegmentRole = TCitationSegment["role"]
type TSegmentStyle = TCitationSegment["style"]

function separator(text: string): TSegmentInstructionSeparator {
    return { type: "separator", text }
}

function segment(
    source: TSegmentSource,
    role: TSegmentRole,
    style?: TSegmentStyle
): TSegmentInstructionSegment {
    return style === undefined
        ? { type: "segment", source, role }
        : { type: "segment", source, role, style }
}

/** A segment showing a string field of the reference. */
function stringField(
    field: string,
    role: TSegmentRole,
    style?: TSegmentStyle
): TSegmentInstructionSegment {
    return segment({ kind: "string", field }, role, style)
}

/** A segment showing a date field of the reference, formatted IEEE style. */
function dateField(
    field: string,
    role: TSegmentRole
): TSegmentInstructionSegment {
    return segment({ kind: "date", field }, role)
}

/** A segment showing fixed text. */
function literal(text: string, role: TSegmentRole): TSegmentInstructionSegment {
    return segment({ kind: "literal", text }, role)
}

/** The list of authors that opens most references. */
function authorsLead(field = "authors"): TSegmentInstructionSegment {
    return segment({ kind: "authors", field }, "authors", "plain")
}

/** A single person that opens a reference, in the authors position. */
function singleAuthorLead(field: string): TSegmentInstructionSegment {
    return segment({ kind: "singleAuthor", field }, "authors", "plain")
}

/**
 * Emits `then` only when `field` is present (and, with `checkLength`, is a
 * non-empty array); `otherwise` is emitted exactly when `then` is not.
 */
function whenPresent(
    field: string,
    then: TSegmentInstruction[],
    options: { checkLength?: boolean; otherwise?: TSegmentInstruction[] } = {}
): TSegmentInstructionConditional {
    return {
        type: "conditional",
        field,
        ...(options.checkLength === true ? { checkLength: true } : {}),
        then,
        ...(options.otherwise !== undefined ? { else: options.otherwise } : {}),
    }
}

/** The optional authors list, followed by `trailing` when present. */
function optionalAuthorsLead(trailing: string): TSegmentInstructionConditional {
    return whenPresent("authors", [authorsLead(), separator(trailing)], {
        checkLength: true,
    })
}

/** "[Online]. Available: " followed by the url as a link. */
function onlineAvailable(): TSegmentInstruction[] {
    return [
        literal("[Online]. Available: ", "prefix"),
        stringField("url", "url", "link"),
    ]
}

/** "Accessed: " followed by the access date. */
function accessedOn(): TSegmentInstruction[] {
    return [
        literal("Accessed: ", "prefix"),
        dateField("accessedDate", "accessedDate"),
    ]
}

/** ", doi: " and the DOI, when the reference has one. */
function doiIfPresent(): TSegmentInstructionConditional {
    return whenPresent("doi", [separator(", doi: "), stringField("doi", "doi")])
}

/** ", " and the edition followed by " ed.", when the reference has one. */
function editionIfPresent(): TSegmentInstructionConditional {
    return whenPresent("edition", [
        separator(", "),
        stringField("edition", "edition"),
        literal(" ed.", "suffix"),
    ])
}

/** `lead` and the ISBN, when the reference has one. */
function isbnIfPresent(lead: string): TSegmentInstructionConditional {
    return whenPresent("isbn", [separator(lead), stringField("isbn", "isbn")])
}

/** ", pp. " and the page range, when the reference has one. */
function pagesIfPresent(): TSegmentInstructionConditional {
    return whenPresent("pages", [
        separator(", pp. "),
        stringField("pages", "pages"),
    ])
}

/** The optional volume, issue and page range of a periodical article. */
function volumeIssuePagesIfPresent(): TSegmentInstructionConditional[] {
    return [
        whenPresent("volume", [
            separator(", vol. "),
            stringField("volume", "volume"),
        ]),
        whenPresent("issue", [
            separator(", no. "),
            stringField("issue", "issue"),
        ]),
        pagesIfPresent(),
    ]
}

/** ", ver. " and the version, when the reference has one. */
function versionIfPresent(): TSegmentInstructionConditional {
    return whenPresent("version", [
        separator(", "),
        literal("ver. ", "prefix"),
        stringField("version", "misc"),
    ])
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// Book: authors, ", ", title(italic), [", ", edition, " ed."], [", ", location], ": ", publisher, ", ", year, ".", [" ", isbn]
export const BOOK_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "italic"),
    editionIfPresent(),
    whenPresent("location", [
        separator(", "),
        stringField("location", "location"),
    ]),
    separator(": "),
    stringField("publisher", "publisher"),
    separator(", "),
    stringField("year", "year"),
    separator("."),
    isbnIfPresent(" "),
]

// Website: authors, ". ", pageTitle(quoted), ". ", websiteTitle(italic,misc), ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const WEBSITE_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(". "),
    stringField("pageTitle", "title", "quoted"),
    separator(". "),
    stringField("websiteTitle", "misc", "italic"),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// BookChapter: authors, ", ", chapterTitle(quoted), ", in ", bookTitle(italic,bookTitle), [editors+Eds.], ". ", location, ": ", publisher, ", ", year, [", pp. ", pages], ".", [" ", isbn]
export const BOOK_CHAPTER_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("chapterTitle", "title", "quoted"),
    separator(", in "),
    stringField("bookTitle", "bookTitle", "italic"),
    whenPresent(
        "editors",
        [
            separator(", "),
            segment({ kind: "authors", field: "editors" }, "misc"),
            literal(", Eds.", "suffix"),
        ],
        { checkLength: true }
    ),
    separator(". "),
    stringField("location", "location"),
    separator(": "),
    stringField("publisher", "publisher"),
    separator(", "),
    stringField("year", "year"),
    whenPresent("pages", [
        separator(", "),
        literal("pp. ", "prefix"),
        stringField("pages", "pages"),
    ]),
    separator("."),
    isbnIfPresent(" "),
]

// Handbook: title(italic), [", ", edition, " ed."], ". ", location, ": ", publisher, ", ", year, ".", [" ", isbn]
export const HANDBOOK_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    editionIfPresent(),
    separator(". "),
    stringField("location", "location"),
    separator(": "),
    stringField("publisher", "publisher"),
    separator(", "),
    stringField("year", "year"),
    separator("."),
    isbnIfPresent(" "),
]

// TechnicalReport: authors, ", ", title(quoted), ", ", institution, ", ", location, ", ", "Rep. ", reportNumber, ", ", year, "."
export const TECHNICAL_REPORT_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("institution", "institution"),
    separator(", "),
    stringField("location", "location"),
    separator(", "),
    literal("Rep. ", "prefix"),
    stringField("reportNumber", "reportNumber"),
    separator(", "),
    stringField("year", "year"),
    separator("."),
]

// Standard: title(italic), ", ", standardNumber, ", ", organization, ", ", date, "."
export const STANDARD_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("standardNumber", "standardNumber"),
    separator(", "),
    stringField("organization", "organization"),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// Thesis: authors, ", ", title(quoted), ", ", degree, " thesis", ", ", institution, ", ", location, ", ", year, "."
export const THESIS_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("degree", "degree"),
    literal(" thesis", "suffix"),
    separator(", "),
    stringField("institution", "institution"),
    separator(", "),
    stringField("location", "location"),
    separator(", "),
    stringField("year", "year"),
    separator("."),
]

// Patent: inventors(authors), ", ", title(quoted), ", ", country, " Patent ", patentNumber, ", ", date, "."
export const PATENT_TEMPLATE: TSegmentInstruction[] = [
    authorsLead("inventors"),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("country", "country"),
    literal(" Patent ", "prefix"),
    stringField("patentNumber", "patentNumber"),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// Dictionary: title(italic), ". ", publisher, [", ", edition, " ed."], ", ", year, "."
export const DICTIONARY_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(". "),
    stringField("publisher", "publisher"),
    editionIfPresent(),
    separator(", "),
    stringField("year", "year"),
    separator("."),
]

// Encyclopedia: title(italic), ". ", publisher, [", ", edition, " ed."], ", ", year, "."
export const ENCYCLOPEDIA_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(". "),
    stringField("publisher", "publisher"),
    editionIfPresent(),
    separator(", "),
    stringField("year", "year"),
    separator("."),
]

// JournalArticle: authors, ", ", title(quoted), ", ", journalTitle(italic,misc), [", vol. ", volume], [", no. ", issue], [", pp. ", pages], ", ", year, [", doi: ", doi], "."
export const JOURNAL_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("journalTitle", "misc", "italic"),
    ...volumeIssuePagesIfPresent(),
    separator(", "),
    stringField("year", "year"),
    doiIfPresent(),
    separator("."),
]

// MagazineArticle: authors, ", ", title(quoted), ", ", magazineTitle(italic,misc), [", vol. ", volume], [", no. ", issue], [", pp. ", pages], ", ", year, "."
export const MAGAZINE_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("magazineTitle", "misc", "italic"),
    ...volumeIssuePagesIfPresent(),
    separator(", "),
    stringField("year", "year"),
    separator("."),
]

// NewspaperArticle: authors, ", ", title(quoted), ", ", newspaperTitle(italic,misc), ", ", date, [", pp. ", pages], "."
export const NEWSPAPER_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("newspaperTitle", "misc", "italic"),
    separator(", "),
    dateField("date", "date"),
    pagesIfPresent(),
    separator("."),
]

// ConferencePaper: authors, ", ", title(quoted), ", ", "presented at ", conferenceName(italic,misc), ", ", location, ", ", date, [", pp. ", pages], [", doi: ", doi], "."
export const CONFERENCE_PAPER_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    literal("presented at ", "prefix"),
    stringField("conferenceName", "misc", "italic"),
    separator(", "),
    stringField("location", "location"),
    separator(", "),
    dateField("date", "date"),
    pagesIfPresent(),
    doiIfPresent(),
    separator("."),
]

// ConferenceProceedings: [editors+", Eds.", ", "], conferenceName(italic,title), ", ", location, ", ", date, ". ", publisher, [". ", isbn], "."
export const CONFERENCE_PROCEEDINGS_TEMPLATE: TSegmentInstruction[] = [
    whenPresent(
        "editors",
        [authorsLead("editors"), literal(", Eds.", "suffix"), separator(", ")],
        { checkLength: true }
    ),
    stringField("conferenceName", "title", "italic"),
    separator(", "),
    stringField("location", "location"),
    separator(", "),
    dateField("date", "date"),
    separator(". "),
    stringField("publisher", "publisher"),
    isbnIfPresent(". "),
    separator("."),
]

// Dataset: [authors, ", "], title(quoted), ", ", repository(misc), [", ver. ", version(misc)], ", ", year, [", doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const DATASET_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("repository", "misc"),
    versionIfPresent(),
    separator(", "),
    stringField("year", "year"),
    doiIfPresent(),
    separator(". "),
    ...onlineAvailable(),
]

// Software: [authors, ", "], title(italic), [", ver. ", version(misc)], ", ", year, [". ", publisher], [". ", "doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const SOFTWARE_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(", "),
    stringField("title", "title", "italic"),
    versionIfPresent(),
    separator(", "),
    stringField("year", "year"),
    whenPresent("publisher", [
        separator(". "),
        stringField("publisher", "publisher"),
    ]),
    whenPresent("doi", [
        separator(". "),
        literal("doi: ", "prefix"),
        stringField("doi", "doi"),
    ]),
    separator(". "),
    ...onlineAvailable(),
]

// OnlineDocument: [authors, ". "], title(quoted), [". ", publisher], ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const ONLINE_DOCUMENT_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(". "),
    stringField("title", "title", "quoted"),
    whenPresent("publisher", [
        separator(". "),
        stringField("publisher", "publisher"),
    ]),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// Blog: author(single), ", ", postTitle(quoted), ", ", blogName(italic,misc), ", ", date, ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const BLOG_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("author"),
    separator(", "),
    stringField("postTitle", "title", "quoted"),
    separator(", "),
    stringField("blogName", "misc", "italic"),
    separator(", "),
    dateField("date", "date"),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// SocialMedia: [author, [" [@", username, "]"], ", " | "[@", username, "]", ", "], ["title"(quoted), ", " | body, ", "], websiteTitle | platform, ", ", postDate(date), ". ", ["Accessed: ", accessedDate, ". "], "Available: ", url(link)
// Follows the University of Melbourne's IEEE social media style.
export const SOCIAL_MEDIA_TEMPLATE: TSegmentInstruction[] = [
    whenPresent(
        "author",
        [
            singleAuthorLead("author"),
            whenPresent("username", [
                separator(" "),
                literal("[@", "prefix"),
                stringField("username", "username"),
                literal("]", "suffix"),
            ]),
            separator(", "),
        ],
        {
            otherwise: [
                whenPresent("username", [
                    literal("[@", "prefix"),
                    stringField("username", "username"),
                    literal("]", "suffix"),
                    separator(", "),
                ]),
            ],
        }
    ),
    whenPresent(
        "postTitle",
        [stringField("postTitle", "title", "quoted"), separator(", ")],
        {
            otherwise: [
                whenPresent("postBody", [
                    stringField("postBody", "body"),
                    separator(", "),
                ]),
            ],
        }
    ),
    whenPresent("websiteTitle", [stringField("websiteTitle", "platform")], {
        otherwise: [stringField("platform", "platform")],
    }),
    separator(", "),
    dateField("postDate", "date"),
    separator(". "),
    whenPresent("accessedDate", [...accessedOn(), separator(". ")]),
    literal("Available: ", "prefix"),
    stringField("url", "url", "link"),
]

// Preprint: authors, ", ", title(quoted), ", ", server(italic,misc), ", ", year, [", doi: ", doi], ". ", "[Online]. Available: ", url(link)
export const PREPRINT_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("server", "misc", "italic"),
    separator(", "),
    stringField("year", "year"),
    doiIfPresent(),
    separator(". "),
    ...onlineAvailable(),
]

// Video: [authors, ". "], title(italic), ". ", platform, [". ", releaseDate(date)], ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const VIDEO_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(". "),
    stringField("title", "title", "italic"),
    separator(". "),
    stringField("platform", "platform"),
    whenPresent("releaseDate", [
        separator(". "),
        dateField("releaseDate", "date"),
    ]),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// Podcast: [authors, ". "], episodeTitle(quoted), ", in ", seriesTitle(italic,misc), ". ", platform, ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const PODCAST_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(". "),
    stringField("episodeTitle", "title", "quoted"),
    separator(", in "),
    stringField("seriesTitle", "misc", "italic"),
    separator(". "),
    stringField("platform", "platform"),
    separator(". "),
    ...accessedOn(),
    separator(". "),
    ...onlineAvailable(),
]

// Course: instructor(single), ", ", title(italic), ", ", institution, [", ", courseCode(misc)], ", ", term(misc), ", ", year, "."
export const COURSE_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("instructor"),
    separator(", "),
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("institution", "institution"),
    whenPresent("courseCode", [
        separator(", "),
        stringField("courseCode", "misc"),
    ]),
    separator(", "),
    stringField("term", "misc"),
    separator(", "),
    stringField("year", "year"),
    separator("."),
]

// Presentation: presenter(single), ", ", title(quoted), ", ", "presented at ", eventTitle(italic,misc), ", ", location, ", ", date, "."
export const PRESENTATION_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("presenter"),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    literal("presented at ", "prefix"),
    stringField("eventTitle", "misc", "italic"),
    separator(", "),
    stringField("location", "location"),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// Interview: interviewee(single), [", ", "interviewed by ", interviewer(single,misc)], ", ", date, "."
export const INTERVIEW_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("interviewee"),
    whenPresent("interviewer", [
        separator(", "),
        literal("interviewed by ", "prefix"),
        segment({ kind: "singleAuthor", field: "interviewer" }, "misc"),
    ]),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// PersonalCommunication: person(single), ", ", "personal communication"(misc), ", ", date, "."
export const PERSONAL_COMMUNICATION_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("person"),
    separator(", "),
    literal("personal communication", "misc"),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// Email: sender(single), ", ", "email to ", recipient(single,misc), ", ", date, "."
export const EMAIL_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("sender"),
    separator(", "),
    literal("email to ", "prefix"),
    segment({ kind: "singleAuthor", field: "recipient" }, "misc"),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// Law: title(italic), ", ", jurisdiction(misc), ", ", dateEnacted(date), "."
export const LAW_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("jurisdiction", "misc"),
    separator(", "),
    dateField("dateEnacted", "date"),
    separator("."),
]

// CourtCase: caseName(italic,title), ", ", court(misc), [", ", reporter(misc)], ", ", date, "."
export const COURT_CASE_TEMPLATE: TSegmentInstruction[] = [
    stringField("caseName", "title", "italic"),
    separator(", "),
    stringField("court", "misc"),
    whenPresent("reporter", [separator(", "), stringField("reporter", "misc")]),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// GovernmentPublication: [authors, ", "], title(italic), ", ", agency(organization), ", ", location, [", Rep. ", reportNumber], ", ", date, "."
export const GOVERNMENT_PUBLICATION_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(", "),
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("agency", "organization"),
    separator(", "),
    stringField("location", "location"),
    whenPresent("reportNumber", [
        separator(", "),
        literal("Rep. ", "prefix"),
        stringField("reportNumber", "reportNumber"),
    ]),
    separator(", "),
    dateField("date", "date"),
    separator("."),
]

// Datasheet: title(italic), ", ", manufacturer(publisher), ", ", partNumber(misc), ", ", year, ". ", "[Online]. Available: ", url(link)
export const DATASHEET_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("manufacturer", "publisher"),
    separator(", "),
    stringField("partNumber", "misc"),
    separator(", "),
    stringField("year", "year"),
    separator(". "),
    ...onlineAvailable(),
]

// ProductManual: title(italic), ", ", manufacturer(publisher), ", ", model(misc), ", ", year, [". ", "[Online]. Available: ", url(link)], "."
export const PRODUCT_MANUAL_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("manufacturer", "publisher"),
    separator(", "),
    stringField("model", "misc"),
    separator(", "),
    stringField("year", "year"),
    whenPresent("url", [separator(". "), ...onlineAvailable()]),
    separator("."),
]
