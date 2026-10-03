// IEEE segment templates for conferences.

import {
    separator,
    stringField,
    calendarDateField,
    literal,
    authorsLead,
    whenPresent,
    doiIfPresent,
    isbnIfPresent,
    pagesIfPresent,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

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
    calendarDateField("date", "date"),
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
    calendarDateField("date", "date"),
    separator(". "),
    stringField("publisher", "publisher"),
    isbnIfPresent(". "),
    separator("."),
]
