// The structured output types of IEEE citation formatting. They live in
// their own file so the segment builder and the templates can use them
// without importing formatting.ts, which imports both of those.

import type { TReferenceType } from "./references.js"

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
        | "username"
        | "body"
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
