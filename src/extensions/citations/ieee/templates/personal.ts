// IEEE segment templates for personal and unpublished sources.

import {
    separator,
    segment,
    calendarDateField,
    literal,
    singleAuthorLead,
    whenPresent,
} from "./fragments.js"
import type { TSegmentInstruction } from "./instruction-types.js"

// Interview: interviewee(single), [", ", "interviewed by ", interviewer(single,misc)], ", ", date, "."
export const INTERVIEW_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("interviewee"),
    whenPresent("interviewer", [
        separator(", "),
        literal("interviewed by ", "prefix"),
        segment({ kind: "singleAuthor", field: "interviewer" }, "misc"),
    ]),
    separator(", "),
    calendarDateField("date", "date"),
    separator("."),
]

// PersonalCommunication: person(single), ", ", "personal communication"(misc), ", ", date, "."
export const PERSONAL_COMMUNICATION_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("person"),
    separator(", "),
    literal("personal communication", "misc"),
    separator(", "),
    calendarDateField("date", "date"),
    separator("."),
]

// Email: sender(single), ", ", "email to ", recipient(single,misc), ", ", date, "."
export const EMAIL_TEMPLATE: TSegmentInstruction[] = [
    singleAuthorLead("sender"),
    separator(", "),
    literal("email to ", "prefix"),
    segment({ kind: "singleAuthor", field: "recipient" }, "misc"),
    separator(", "),
    calendarDateField("date", "date"),
    separator("."),
]
