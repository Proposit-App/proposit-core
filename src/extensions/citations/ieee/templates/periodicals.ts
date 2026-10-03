// IEEE segment templates for periodicals.

import {
    separator,
    stringField,
    yearOrUndated,
    calendarDateField,
    authorsLead,
    doiIfPresent,
    pagesIfPresent,
    volumeIssuePagesIfPresent,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

// JournalArticle: authors, ", ", title(quoted), ", ", journalTitle(italic,misc), [", vol. ", volume], [", no. ", issue], [", pp. ", pages], ", ", year, [", doi: ", doi], "."
export const JOURNAL_ARTICLE_TEMPLATE: TSegmentInstruction[] = [
    authorsLead(),
    separator(", "),
    stringField("title", "title", "quoted"),
    separator(", "),
    stringField("journalTitle", "misc", "italic"),
    ...volumeIssuePagesIfPresent(),
    separator(", "),
    yearOrUndated(),
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
    yearOrUndated(),
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
    calendarDateField("date", "date"),
    pagesIfPresent(),
    separator("."),
]
