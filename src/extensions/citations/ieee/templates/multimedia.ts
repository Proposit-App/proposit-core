// IEEE segment templates for multimedia, courses and presentations.

import {
    separator,
    stringField,
    calendarDateField,
    literal,
    singleAuthorLead,
    whenPresent,
    optionalAuthorsLead,
    onlineAvailable,
    accessedOn,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

// Video: [authors, ". "], title(italic), ". ", platform, [". ", releaseDate(date)], ". ", "Accessed: ", accessedDate, ". ", "[Online]. Available: ", url(link)
export const VIDEO_TEMPLATE: TSegmentInstruction[] = [
    optionalAuthorsLead(". "),
    stringField("title", "title", "italic"),
    separator(". "),
    stringField("platform", "platform"),
    whenPresent("releaseDate", [
        separator(". "),
        calendarDateField("releaseDate", "date"),
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
    calendarDateField("date", "date"),
    separator("."),
]
