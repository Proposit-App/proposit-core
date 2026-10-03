// IEEE segment templates for textual sources: books, reports, standards, theses, patents and reference works.

import {
    separator,
    segment,
    stringField,
    calendarDateField,
    literal,
    authorsLead,
    whenPresent,
    onlineAvailable,
    accessedOn,
    editionIfPresent,
    isbnIfPresent,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

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
    calendarDateField("date", "date"),
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
    calendarDateField("date", "date"),
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
