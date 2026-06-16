// Relaxed IEEE Citation Reference Schemas
// Structural validation only — constraint properties (minLength, maxLength,
// minItems, maxItems, pattern, format, minimum, maximum) are stripped.

import Type, { type Static, type TSchema } from "typebox"

import {
    BookReferenceSchema,
    WebsiteReferenceSchema,
    BookChapterReferenceSchema,
    HandbookReferenceSchema,
    TechnicalReportReferenceSchema,
    StandardReferenceSchema,
    ThesisReferenceSchema,
    PatentReferenceSchema,
    DictionaryReferenceSchema,
    EncyclopediaReferenceSchema,
    JournalArticleReferenceSchema,
    MagazineArticleReferenceSchema,
    NewspaperArticleReferenceSchema,
    ConferencePaperReferenceSchema,
    ConferenceProceedingsReferenceSchema,
    DatasetReferenceSchema,
    SoftwareReferenceSchema,
    OnlineDocumentReferenceSchema,
    BlogReferenceSchema,
    SocialMediaReferenceSchema,
    PreprintReferenceSchema,
    VideoReferenceSchema,
    PodcastReferenceSchema,
    CourseReferenceSchema,
    PresentationReferenceSchema,
    InterviewReferenceSchema,
    PersonalCommunicationReferenceSchema,
    EmailReferenceSchema,
    LawReferenceSchema,
    CourtCaseReferenceSchema,
    GovernmentPublicationReferenceSchema,
    DatasheetReferenceSchema,
    ProductManualReferenceSchema,
    type TReferenceType,
} from "./references.js"

// ---------------------------------------------------------------------------
// Internal utilities
//
// Relaxed schemas are safe for Value.Check / Value.Parse only. Non-enumerable
// TypeBox internals (~kind, ~optional) are not preserved by the recursive
// clone — do not pass relaxed schemas to Value.Create, Type.Extends, or the
// TypeBox compiler.
// ---------------------------------------------------------------------------

const CONSTRAINT_KEYS = new Set([
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "format",
    "minimum",
    "maximum",
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === "object" &&
        (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null)
    )
}

function cloneAndStrip(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(cloneAndStrip)
    }
    if (!isPlainObject(value)) {
        return value // preserve class instances (EncodableDate, etc.) by reference
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
        if (CONSTRAINT_KEYS.has(k)) continue
        result[k] = cloneAndStrip(v)
    }
    return result
}

function stripConstraints<T extends TSchema>(schema: T): T {
    return cloneAndStrip(schema) as T
}

// ---------------------------------------------------------------------------
// Relaxed individual schemas
// ---------------------------------------------------------------------------

export const RelaxedBookReferenceSchema = stripConstraints(BookReferenceSchema)
export type TRelaxedBookReference = Static<typeof RelaxedBookReferenceSchema>

export const RelaxedWebsiteReferenceSchema = stripConstraints(
    WebsiteReferenceSchema
)
export type TRelaxedWebsiteReference = Static<
    typeof RelaxedWebsiteReferenceSchema
>

export const RelaxedBookChapterReferenceSchema = stripConstraints(
    BookChapterReferenceSchema
)
export type TRelaxedBookChapterReference = Static<
    typeof RelaxedBookChapterReferenceSchema
>

export const RelaxedHandbookReferenceSchema = stripConstraints(
    HandbookReferenceSchema
)
export type TRelaxedHandbookReference = Static<
    typeof RelaxedHandbookReferenceSchema
>

export const RelaxedTechnicalReportReferenceSchema = stripConstraints(
    TechnicalReportReferenceSchema
)
export type TRelaxedTechnicalReportReference = Static<
    typeof RelaxedTechnicalReportReferenceSchema
>

export const RelaxedStandardReferenceSchema = stripConstraints(
    StandardReferenceSchema
)
export type TRelaxedStandardReference = Static<
    typeof RelaxedStandardReferenceSchema
>

export const RelaxedThesisReferenceSchema = stripConstraints(
    ThesisReferenceSchema
)
export type TRelaxedThesisReference = Static<
    typeof RelaxedThesisReferenceSchema
>

export const RelaxedPatentReferenceSchema = stripConstraints(
    PatentReferenceSchema
)
export type TRelaxedPatentReference = Static<
    typeof RelaxedPatentReferenceSchema
>

export const RelaxedDictionaryReferenceSchema = stripConstraints(
    DictionaryReferenceSchema
)
export type TRelaxedDictionaryReference = Static<
    typeof RelaxedDictionaryReferenceSchema
>

export const RelaxedEncyclopediaReferenceSchema = stripConstraints(
    EncyclopediaReferenceSchema
)
export type TRelaxedEncyclopediaReference = Static<
    typeof RelaxedEncyclopediaReferenceSchema
>

export const RelaxedJournalArticleReferenceSchema = stripConstraints(
    JournalArticleReferenceSchema
)
export type TRelaxedJournalArticleReference = Static<
    typeof RelaxedJournalArticleReferenceSchema
>

export const RelaxedMagazineArticleReferenceSchema = stripConstraints(
    MagazineArticleReferenceSchema
)
export type TRelaxedMagazineArticleReference = Static<
    typeof RelaxedMagazineArticleReferenceSchema
>

export const RelaxedNewspaperArticleReferenceSchema = stripConstraints(
    NewspaperArticleReferenceSchema
)
export type TRelaxedNewspaperArticleReference = Static<
    typeof RelaxedNewspaperArticleReferenceSchema
>

export const RelaxedConferencePaperReferenceSchema = stripConstraints(
    ConferencePaperReferenceSchema
)
export type TRelaxedConferencePaperReference = Static<
    typeof RelaxedConferencePaperReferenceSchema
>

export const RelaxedConferenceProceedingsReferenceSchema = stripConstraints(
    ConferenceProceedingsReferenceSchema
)
export type TRelaxedConferenceProceedingsReference = Static<
    typeof RelaxedConferenceProceedingsReferenceSchema
>

export const RelaxedDatasetReferenceSchema = stripConstraints(
    DatasetReferenceSchema
)
export type TRelaxedDatasetReference = Static<
    typeof RelaxedDatasetReferenceSchema
>

export const RelaxedSoftwareReferenceSchema = stripConstraints(
    SoftwareReferenceSchema
)
export type TRelaxedSoftwareReference = Static<
    typeof RelaxedSoftwareReferenceSchema
>

export const RelaxedOnlineDocumentReferenceSchema = stripConstraints(
    OnlineDocumentReferenceSchema
)
export type TRelaxedOnlineDocumentReference = Static<
    typeof RelaxedOnlineDocumentReferenceSchema
>

export const RelaxedBlogReferenceSchema = stripConstraints(BlogReferenceSchema)
export type TRelaxedBlogReference = Static<typeof RelaxedBlogReferenceSchema>

export const RelaxedSocialMediaReferenceSchema = stripConstraints(
    SocialMediaReferenceSchema
)
export type TRelaxedSocialMediaReference = Static<
    typeof RelaxedSocialMediaReferenceSchema
>

export const RelaxedPreprintReferenceSchema = stripConstraints(
    PreprintReferenceSchema
)
export type TRelaxedPreprintReference = Static<
    typeof RelaxedPreprintReferenceSchema
>

export const RelaxedVideoReferenceSchema =
    stripConstraints(VideoReferenceSchema)
export type TRelaxedVideoReference = Static<typeof RelaxedVideoReferenceSchema>

export const RelaxedPodcastReferenceSchema = stripConstraints(
    PodcastReferenceSchema
)
export type TRelaxedPodcastReference = Static<
    typeof RelaxedPodcastReferenceSchema
>

export const RelaxedCourseReferenceSchema = stripConstraints(
    CourseReferenceSchema
)
export type TRelaxedCourseReference = Static<
    typeof RelaxedCourseReferenceSchema
>

export const RelaxedPresentationReferenceSchema = stripConstraints(
    PresentationReferenceSchema
)
export type TRelaxedPresentationReference = Static<
    typeof RelaxedPresentationReferenceSchema
>

export const RelaxedInterviewReferenceSchema = stripConstraints(
    InterviewReferenceSchema
)
export type TRelaxedInterviewReference = Static<
    typeof RelaxedInterviewReferenceSchema
>

export const RelaxedPersonalCommunicationReferenceSchema = stripConstraints(
    PersonalCommunicationReferenceSchema
)
export type TRelaxedPersonalCommunicationReference = Static<
    typeof RelaxedPersonalCommunicationReferenceSchema
>

export const RelaxedEmailReferenceSchema =
    stripConstraints(EmailReferenceSchema)
export type TRelaxedEmailReference = Static<typeof RelaxedEmailReferenceSchema>

export const RelaxedLawReferenceSchema = stripConstraints(LawReferenceSchema)
export type TRelaxedLawReference = Static<typeof RelaxedLawReferenceSchema>

export const RelaxedCourtCaseReferenceSchema = stripConstraints(
    CourtCaseReferenceSchema
)
export type TRelaxedCourtCaseReference = Static<
    typeof RelaxedCourtCaseReferenceSchema
>

export const RelaxedGovernmentPublicationReferenceSchema = stripConstraints(
    GovernmentPublicationReferenceSchema
)
export type TRelaxedGovernmentPublicationReference = Static<
    typeof RelaxedGovernmentPublicationReferenceSchema
>

export const RelaxedDatasheetReferenceSchema = stripConstraints(
    DatasheetReferenceSchema
)
export type TRelaxedDatasheetReference = Static<
    typeof RelaxedDatasheetReferenceSchema
>

export const RelaxedProductManualReferenceSchema = stripConstraints(
    ProductManualReferenceSchema
)
export type TRelaxedProductManualReference = Static<
    typeof RelaxedProductManualReferenceSchema
>

// ---------------------------------------------------------------------------
// Relaxed discriminated union
// ---------------------------------------------------------------------------

export const IEEEReferenceSchemaRelaxed = Type.Union([
    RelaxedBookReferenceSchema,
    RelaxedWebsiteReferenceSchema,
    RelaxedBookChapterReferenceSchema,
    RelaxedHandbookReferenceSchema,
    RelaxedTechnicalReportReferenceSchema,
    RelaxedStandardReferenceSchema,
    RelaxedThesisReferenceSchema,
    RelaxedPatentReferenceSchema,
    RelaxedDictionaryReferenceSchema,
    RelaxedEncyclopediaReferenceSchema,
    RelaxedJournalArticleReferenceSchema,
    RelaxedMagazineArticleReferenceSchema,
    RelaxedNewspaperArticleReferenceSchema,
    RelaxedConferencePaperReferenceSchema,
    RelaxedConferenceProceedingsReferenceSchema,
    RelaxedDatasetReferenceSchema,
    RelaxedSoftwareReferenceSchema,
    RelaxedOnlineDocumentReferenceSchema,
    RelaxedBlogReferenceSchema,
    RelaxedSocialMediaReferenceSchema,
    RelaxedPreprintReferenceSchema,
    RelaxedVideoReferenceSchema,
    RelaxedPodcastReferenceSchema,
    RelaxedCourseReferenceSchema,
    RelaxedPresentationReferenceSchema,
    RelaxedInterviewReferenceSchema,
    RelaxedPersonalCommunicationReferenceSchema,
    RelaxedEmailReferenceSchema,
    RelaxedLawReferenceSchema,
    RelaxedCourtCaseReferenceSchema,
    RelaxedGovernmentPublicationReferenceSchema,
    RelaxedDatasheetReferenceSchema,
    RelaxedProductManualReferenceSchema,
])
export type TRelaxedIEEEReference = Static<typeof IEEEReferenceSchemaRelaxed>

// ---------------------------------------------------------------------------
// Relaxed schema map keyed by reference type
// ---------------------------------------------------------------------------

export const IEEEReferenceSchemaMapRelaxed = {
    Book: RelaxedBookReferenceSchema,
    Website: RelaxedWebsiteReferenceSchema,
    BookChapter: RelaxedBookChapterReferenceSchema,
    Handbook: RelaxedHandbookReferenceSchema,
    TechnicalReport: RelaxedTechnicalReportReferenceSchema,
    Standard: RelaxedStandardReferenceSchema,
    Thesis: RelaxedThesisReferenceSchema,
    Patent: RelaxedPatentReferenceSchema,
    Dictionary: RelaxedDictionaryReferenceSchema,
    Encyclopedia: RelaxedEncyclopediaReferenceSchema,
    JournalArticle: RelaxedJournalArticleReferenceSchema,
    MagazineArticle: RelaxedMagazineArticleReferenceSchema,
    NewspaperArticle: RelaxedNewspaperArticleReferenceSchema,
    ConferencePaper: RelaxedConferencePaperReferenceSchema,
    ConferenceProceedings: RelaxedConferenceProceedingsReferenceSchema,
    Dataset: RelaxedDatasetReferenceSchema,
    Software: RelaxedSoftwareReferenceSchema,
    OnlineDocument: RelaxedOnlineDocumentReferenceSchema,
    Blog: RelaxedBlogReferenceSchema,
    SocialMedia: RelaxedSocialMediaReferenceSchema,
    Preprint: RelaxedPreprintReferenceSchema,
    Video: RelaxedVideoReferenceSchema,
    Podcast: RelaxedPodcastReferenceSchema,
    Course: RelaxedCourseReferenceSchema,
    Presentation: RelaxedPresentationReferenceSchema,
    Interview: RelaxedInterviewReferenceSchema,
    PersonalCommunication: RelaxedPersonalCommunicationReferenceSchema,
    Email: RelaxedEmailReferenceSchema,
    Law: RelaxedLawReferenceSchema,
    CourtCase: RelaxedCourtCaseReferenceSchema,
    GovernmentPublication: RelaxedGovernmentPublicationReferenceSchema,
    Datasheet: RelaxedDatasheetReferenceSchema,
    ProductManual: RelaxedProductManualReferenceSchema,
} as const satisfies Record<TReferenceType, TSchema>
