// IEEE Citation Segment Templates — declarative config arrays interpreted by buildSegments()
//
// The templates live in templates/, one file per group of reference types;
// this module gathers them so importers keep one path for every name.

export type {
    TSegmentInstruction,
    TSegmentInstructionConditional,
    TSegmentInstructionSegment,
    TSegmentInstructionSeparator,
    TSegmentSource,
} from "./templates/instruction-types.js"
export {
    BOOK_TEMPLATE,
    WEBSITE_TEMPLATE,
    BOOK_CHAPTER_TEMPLATE,
    HANDBOOK_TEMPLATE,
    TECHNICAL_REPORT_TEMPLATE,
    STANDARD_TEMPLATE,
    THESIS_TEMPLATE,
    PATENT_TEMPLATE,
    DICTIONARY_TEMPLATE,
    ENCYCLOPEDIA_TEMPLATE,
} from "./templates/textual-sources.js"
export {
    JOURNAL_ARTICLE_TEMPLATE,
    MAGAZINE_ARTICLE_TEMPLATE,
    NEWSPAPER_ARTICLE_TEMPLATE,
} from "./templates/periodicals.js"
export {
    CONFERENCE_PAPER_TEMPLATE,
    CONFERENCE_PROCEEDINGS_TEMPLATE,
} from "./templates/conferences.js"
export {
    DATASET_TEMPLATE,
    SOFTWARE_TEMPLATE,
    ONLINE_DOCUMENT_TEMPLATE,
    BLOG_TEMPLATE,
    SOCIAL_MEDIA_TEMPLATE,
    PREPRINT_TEMPLATE,
} from "./templates/digital-sources.js"
export {
    VIDEO_TEMPLATE,
    PODCAST_TEMPLATE,
    COURSE_TEMPLATE,
    PRESENTATION_TEMPLATE,
} from "./templates/multimedia.js"
export {
    INTERVIEW_TEMPLATE,
    PERSONAL_COMMUNICATION_TEMPLATE,
    EMAIL_TEMPLATE,
} from "./templates/personal.js"
export {
    LAW_TEMPLATE,
    COURT_CASE_TEMPLATE,
    GOVERNMENT_PUBLICATION_TEMPLATE,
} from "./templates/legal.js"
export {
    DATASHEET_TEMPLATE,
    PRODUCT_MANUAL_TEMPLATE,
} from "./templates/technical-documents.js"
