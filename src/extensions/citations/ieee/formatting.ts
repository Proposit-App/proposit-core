// IEEE Citation Formatting — structured segment output
// Follows IEEE Reference Guide patterns for all 33 reference types.

import type { TIEEEReference, TReferenceType } from "./references.js"
import { buildSegments } from "./segment-builder.js"
import * as templates from "./segment-templates.js"
import type { TCitationFormatResult } from "./segment-types.js"

// Re-exported so they are public: segment-builder.ts defines them but is
// not exported from the package, so this is the only public path to them.
export {
    formatSingleAuthor,
    formatNamesInCitation,
    formatDate,
    formatCalendarDate,
    IEEE_MONTHS,
} from "./segment-builder.js"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type {
    TCitationSegment,
    TCitationFormatResult,
} from "./segment-types.js"

// ---------------------------------------------------------------------------
// Config-driven dispatch
// ---------------------------------------------------------------------------

const TEMPLATES: Record<TReferenceType, templates.TSegmentInstruction[]> = {
    Book: templates.BOOK_TEMPLATE,
    Website: templates.WEBSITE_TEMPLATE,
    BookChapter: templates.BOOK_CHAPTER_TEMPLATE,
    Handbook: templates.HANDBOOK_TEMPLATE,
    TechnicalReport: templates.TECHNICAL_REPORT_TEMPLATE,
    Standard: templates.STANDARD_TEMPLATE,
    Thesis: templates.THESIS_TEMPLATE,
    Patent: templates.PATENT_TEMPLATE,
    Dictionary: templates.DICTIONARY_TEMPLATE,
    Encyclopedia: templates.ENCYCLOPEDIA_TEMPLATE,
    JournalArticle: templates.JOURNAL_ARTICLE_TEMPLATE,
    MagazineArticle: templates.MAGAZINE_ARTICLE_TEMPLATE,
    NewspaperArticle: templates.NEWSPAPER_ARTICLE_TEMPLATE,
    ConferencePaper: templates.CONFERENCE_PAPER_TEMPLATE,
    ConferenceProceedings: templates.CONFERENCE_PROCEEDINGS_TEMPLATE,
    Dataset: templates.DATASET_TEMPLATE,
    Software: templates.SOFTWARE_TEMPLATE,
    OnlineDocument: templates.ONLINE_DOCUMENT_TEMPLATE,
    Blog: templates.BLOG_TEMPLATE,
    SocialMedia: templates.SOCIAL_MEDIA_TEMPLATE,
    Preprint: templates.PREPRINT_TEMPLATE,
    Video: templates.VIDEO_TEMPLATE,
    Podcast: templates.PODCAST_TEMPLATE,
    Course: templates.COURSE_TEMPLATE,
    Presentation: templates.PRESENTATION_TEMPLATE,
    Interview: templates.INTERVIEW_TEMPLATE,
    PersonalCommunication: templates.PERSONAL_COMMUNICATION_TEMPLATE,
    Email: templates.EMAIL_TEMPLATE,
    Law: templates.LAW_TEMPLATE,
    CourtCase: templates.COURT_CASE_TEMPLATE,
    GovernmentPublication: templates.GOVERNMENT_PUBLICATION_TEMPLATE,
    Datasheet: templates.DATASHEET_TEMPLATE,
    ProductManual: templates.PRODUCT_MANUAL_TEMPLATE,
}

/**
 * Build a structured citation for any IEEE reference type.
 * Returns an array of typed segments that consumers can render into
 * plain text, HTML, or any other format.
 */
export function formatCitationParts(
    ref: TIEEEReference
): TCitationFormatResult {
    const template = TEMPLATES[ref.type]
    return {
        type: ref.type,
        segments: buildSegments(
            ref as unknown as Record<string, unknown>,
            template
        ),
    }
}
