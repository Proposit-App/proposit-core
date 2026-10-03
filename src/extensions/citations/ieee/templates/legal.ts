// IEEE segment templates for legal sources.

import {
    separator,
    stringField,
    calendarDateField,
    literal,
    whenPresent,
    optionalAuthorsLead,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

// Law: title(italic), ", ", jurisdiction(misc), ", ", dateEnacted(date), "."
export const LAW_TEMPLATE: TSegmentInstruction[] = [
    stringField("title", "title", "italic"),
    separator(", "),
    stringField("jurisdiction", "misc"),
    separator(", "),
    calendarDateField("dateEnacted", "date"),
    separator("."),
]

// CourtCase: caseName(italic,title), ", ", court(misc), [", ", reporter(misc)], ", ", date, "."
export const COURT_CASE_TEMPLATE: TSegmentInstruction[] = [
    stringField("caseName", "title", "italic"),
    separator(", "),
    stringField("court", "misc"),
    whenPresent("reporter", [separator(", "), stringField("reporter", "misc")]),
    separator(", "),
    calendarDateField("date", "date"),
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
    calendarDateField("date", "date"),
    separator("."),
]
