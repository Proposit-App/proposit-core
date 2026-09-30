// Small builders the IEEE segment templates are assembled from.

import type { TCitationSegment } from "../segment-types.js"
import type {
    TSegmentInstruction,
    TSegmentInstructionConditional,
    TSegmentInstructionSegment,
    TSegmentInstructionSeparator,
    TSegmentSource,
} from "./instruction-types.js"

// Every builder returns newly created objects on each call, so no two
// templates share an instruction object and changing one template can never
// change another. Keys are always written in the same order (type, source,
// role, style for a segment; type, field, checkLength, then, else for a
// conditional), and an optional key is left out rather than set to
// undefined, so a template's serialized form is stable.

export type TSegmentRole = TCitationSegment["role"]
export type TSegmentStyle = TCitationSegment["style"]

export function separator(text: string): TSegmentInstructionSeparator {
    return { type: "separator", text }
}

export function segment(
    source: TSegmentSource,
    role: TSegmentRole,
    style?: TSegmentStyle
): TSegmentInstructionSegment {
    return style === undefined
        ? { type: "segment", source, role }
        : { type: "segment", source, role, style }
}

/** A segment showing a string field of the reference. */
export function stringField(
    field: string,
    role: TSegmentRole,
    style?: TSegmentStyle
): TSegmentInstructionSegment {
    return segment({ kind: "string", field }, role, style)
}

/** A segment showing a date field of the reference, formatted IEEE style. */
export function dateField(
    field: string,
    role: TSegmentRole
): TSegmentInstructionSegment {
    return segment({ kind: "date", field }, role)
}

/** A segment showing fixed text. */
export function literal(
    text: string,
    role: TSegmentRole
): TSegmentInstructionSegment {
    return segment({ kind: "literal", text }, role)
}

/** The list of authors that opens most references. */
export function authorsLead(field = "authors"): TSegmentInstructionSegment {
    return segment({ kind: "authors", field }, "authors", "plain")
}

/** A single person that opens a reference, in the authors position. */
export function singleAuthorLead(field: string): TSegmentInstructionSegment {
    return segment({ kind: "singleAuthor", field }, "authors", "plain")
}

/**
 * Emits `then` only when `field` is present (and, with `checkLength`, is a
 * non-empty array); `otherwise` is emitted exactly when `then` is not.
 */
export function whenPresent(
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
export function optionalAuthorsLead(
    trailing: string
): TSegmentInstructionConditional {
    return whenPresent("authors", [authorsLead(), separator(trailing)], {
        checkLength: true,
    })
}

/** "[Online]. Available: " followed by the url as a link. */
export function onlineAvailable(): TSegmentInstruction[] {
    return [
        literal("[Online]. Available: ", "prefix"),
        stringField("url", "url", "link"),
    ]
}

/** "Accessed: " followed by the access date. */
export function accessedOn(): TSegmentInstruction[] {
    return [
        literal("Accessed: ", "prefix"),
        dateField("accessedDate", "accessedDate"),
    ]
}

/** ", doi: " and the DOI, when the reference has one. */
export function doiIfPresent(): TSegmentInstructionConditional {
    return whenPresent("doi", [separator(", doi: "), stringField("doi", "doi")])
}

/** ", " and the edition followed by " ed.", when the reference has one. */
export function editionIfPresent(): TSegmentInstructionConditional {
    return whenPresent("edition", [
        separator(", "),
        stringField("edition", "edition"),
        literal(" ed.", "suffix"),
    ])
}

/** `lead` and the ISBN, when the reference has one. */
export function isbnIfPresent(lead: string): TSegmentInstructionConditional {
    return whenPresent("isbn", [separator(lead), stringField("isbn", "isbn")])
}

/** ", pp. " and the page range, when the reference has one. */
export function pagesIfPresent(): TSegmentInstructionConditional {
    return whenPresent("pages", [
        separator(", pp. "),
        stringField("pages", "pages"),
    ])
}

/** The optional volume, issue and page range of a periodical article. */
export function volumeIssuePagesIfPresent(): TSegmentInstructionConditional[] {
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
export function versionIfPresent(): TSegmentInstructionConditional {
    return whenPresent("version", [
        separator(", "),
        literal("ver. ", "prefix"),
        stringField("version", "misc"),
    ])
}
