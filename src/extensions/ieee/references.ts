// IEEE Citation Reference Schemas
// https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf

import Type, { type Static } from "typebox"

// ---------------------------------------------------------------------------
// Reference type discriminator
// ---------------------------------------------------------------------------
export const ReferenceTypeSchema = Type.Union([
    Type.Literal("Book"),
    Type.Literal("Website"),
    Type.Literal("BookChapter"),
    Type.Literal("Handbook"),
    Type.Literal("TechnicalReport"),
    Type.Literal("Standard"),
    Type.Literal("Thesis"),
    Type.Literal("Patent"),
    Type.Literal("Dictionary"),
    Type.Literal("Encyclopedia"),
    Type.Literal("JournalArticle"),
    Type.Literal("MagazineArticle"),
    Type.Literal("NewspaperArticle"),
    Type.Literal("ConferencePaper"),
    Type.Literal("ConferenceProceedings"),
    Type.Literal("Dataset"),
    Type.Literal("Software"),
    Type.Literal("OnlineDocument"),
    Type.Literal("Blog"),
    Type.Literal("SocialMedia"),
    Type.Literal("Preprint"),
    Type.Literal("Video"),
    Type.Literal("Podcast"),
    Type.Literal("Course"),
    Type.Literal("Presentation"),
    Type.Literal("Interview"),
    Type.Literal("PersonalCommunication"),
    Type.Literal("Email"),
    Type.Literal("Law"),
    Type.Literal("CourtCase"),
    Type.Literal("GovernmentPublication"),
    Type.Literal("Datasheet"),
    Type.Literal("ProductManual"),
])
export type TReferenceType = Static<typeof ReferenceTypeSchema>

// ---------------------------------------------------------------------------
// Base reference (shared by all types)
// ---------------------------------------------------------------------------
const BaseReferenceSchema = Type.Object({
    type: ReferenceTypeSchema,
})

// ---------------------------------------------------------------------------
// Textual sources
// ---------------------------------------------------------------------------
export const BookReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Book"),
        title: Type.String(),
        year: Type.String(),
        authors: Type.Array(Type.String()),
        edition: Type.Optional(Type.String()),
        publisher: Type.String(),
        location: Type.Optional(Type.String()),
        isbn: Type.Optional(Type.String()),
    }),
])
export type TBookReference = Static<typeof BookReferenceSchema>

export const WebsiteReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Website"),
        authors: Type.Array(Type.String()),
        pageTitle: Type.String(),
        websiteTitle: Type.String(),
        accessedDate: Type.Number(),
        url: Type.String(),
    }),
])
export type TWebsiteReference = Static<typeof WebsiteReferenceSchema>

export const BookChapterReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("BookChapter"),
        chapterTitle: Type.String(),
        authors: Type.Array(Type.String()),
        bookTitle: Type.String(),
        editors: Type.Optional(Type.Array(Type.String())),
        publisher: Type.String(),
        location: Type.String(),
        pages: Type.Optional(Type.String()),
        isbn: Type.Optional(Type.String()),
    }),
])
export type TBookChapterReference = Static<typeof BookChapterReferenceSchema>

export const HandbookReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Handbook"),
        authors: Type.Array(Type.String()),
        publisher: Type.String(),
        edition: Type.Optional(Type.String()),
        location: Type.String(),
        isbn: Type.Optional(Type.String()),
    }),
])
export type THandbookReference = Static<typeof HandbookReferenceSchema>

export const TechnicalReportReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("TechnicalReport"),
        authors: Type.Array(Type.String()),
        reportNumber: Type.String(),
        institution: Type.String(),
        location: Type.String(),
    }),
])
export type TTechnicalReportReference = Static<
    typeof TechnicalReportReferenceSchema
>

export const StandardReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Standard"),
        organization: Type.String(),
        standardNumber: Type.String(),
        title: Type.String(),
        date: Type.String(),
    }),
])
export type TStandardReference = Static<typeof StandardReferenceSchema>

export const ThesisReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Thesis"),
        authors: Type.Array(Type.String()),
        degree: Type.String(),
        institution: Type.String(),
        location: Type.String(),
    }),
])
export type TThesisReference = Static<typeof ThesisReferenceSchema>

export const PatentReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Patent"),
        inventors: Type.Array(Type.String()),
        country: Type.String(),
        patentNumber: Type.String(),
        date: Type.String(),
    }),
])
export type TPatentReference = Static<typeof PatentReferenceSchema>

export const DictionaryReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Dictionary"),
        publisher: Type.String(),
        edition: Type.Optional(Type.String()),
    }),
])
export type TDictionaryReference = Static<typeof DictionaryReferenceSchema>

export const EncyclopediaReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Encyclopedia"),
        publisher: Type.String(),
        edition: Type.Optional(Type.String()),
    }),
])
export type TEncyclopediaReference = Static<typeof EncyclopediaReferenceSchema>

// ---------------------------------------------------------------------------
// Periodicals
// ---------------------------------------------------------------------------
export const JournalArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("JournalArticle"),
        authors: Type.Array(Type.String()),
        journalTitle: Type.String(),
        volume: Type.Optional(Type.String()),
        issue: Type.Optional(Type.String()),
        pages: Type.Optional(Type.String()),
        doi: Type.Optional(Type.String()),
    }),
])
export type TJournalArticleReference = Static<
    typeof JournalArticleReferenceSchema
>

export const MagazineArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("MagazineArticle"),
        authors: Type.Array(Type.String()),
        magazineTitle: Type.String(),
        volume: Type.Optional(Type.String()),
        issue: Type.Optional(Type.String()),
        pages: Type.Optional(Type.String()),
    }),
])
export type TMagazineArticleReference = Static<
    typeof MagazineArticleReferenceSchema
>

export const NewspaperArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("NewspaperArticle"),
        authors: Type.Array(Type.String()),
        newspaperTitle: Type.String(),
        date: Type.String(),
        pages: Type.Optional(Type.String()),
    }),
])
export type TNewspaperArticleReference = Static<
    typeof NewspaperArticleReferenceSchema
>

// ---------------------------------------------------------------------------
// Conference
// ---------------------------------------------------------------------------
export const ConferencePaperReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ConferencePaper"),
        authors: Type.Array(Type.String()),
        conferenceName: Type.String(),
        location: Type.String(),
        date: Type.String(),
        pages: Type.Optional(Type.String()),
        doi: Type.Optional(Type.String()),
    }),
])
export type TConferencePaperReference = Static<
    typeof ConferencePaperReferenceSchema
>

export const ConferenceProceedingsReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ConferenceProceedings"),
        editors: Type.Optional(Type.Array(Type.String())),
        conferenceName: Type.String(),
        location: Type.String(),
        date: Type.String(),
        publisher: Type.String(),
        isbn: Type.Optional(Type.String()),
    }),
])
export type TConferenceProceedingsReference = Static<
    typeof ConferenceProceedingsReferenceSchema
>

// ---------------------------------------------------------------------------
// Digital sources
// ---------------------------------------------------------------------------
export const DatasetReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Dataset"),
        authors: Type.Optional(Type.Array(Type.String())),
        repository: Type.String(),
        version: Type.Optional(Type.String()),
        doi: Type.Optional(Type.String()),
        url: Type.String(),
    }),
])
export type TDatasetReference = Static<typeof DatasetReferenceSchema>

export const SoftwareReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Software"),
        authors: Type.Optional(Type.Array(Type.String())),
        version: Type.Optional(Type.String()),
        publisher: Type.Optional(Type.String()),
        doi: Type.Optional(Type.String()),
        url: Type.String(),
    }),
])
export type TSoftwareReference = Static<typeof SoftwareReferenceSchema>

export const OnlineDocumentReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("OnlineDocument"),
        authors: Type.Optional(Type.Array(Type.String())),
        title: Type.String(),
        publisher: Type.Optional(Type.String()),
        url: Type.String(),
        accessedDate: Type.Number(),
    }),
])
export type TOnlineDocumentReference = Static<
    typeof OnlineDocumentReferenceSchema
>

export const BlogReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Blog"),
        author: Type.String(),
        blogTitle: Type.String(),
        url: Type.String(),
        accessedDate: Type.String(),
    }),
])
export type TBlogReference = Static<typeof BlogReferenceSchema>

export const SocialMediaReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("SocialMedia"),
        author: Type.String(),
        platform: Type.String(),
        postDate: Type.String(),
        url: Type.String(),
    }),
])
export type TSocialMediaReference = Static<typeof SocialMediaReferenceSchema>

export const PreprintReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Preprint"),
        authors: Type.Array(Type.String()),
        server: Type.String(),
        doi: Type.Optional(Type.String()),
        url: Type.String(),
    }),
])
export type TPreprintReference = Static<typeof PreprintReferenceSchema>

// ---------------------------------------------------------------------------
// Multimedia
// ---------------------------------------------------------------------------
export const VideoReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Video"),
        authors: Type.Optional(Type.Array(Type.String())),
        platform: Type.String(),
        url: Type.String(),
        accessedDate: Type.String(),
    }),
])
export type TVideoReference = Static<typeof VideoReferenceSchema>

export const PodcastReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Podcast"),
        authors: Type.Optional(Type.Array(Type.String())),
        episodeTitle: Type.String(),
        seriesTitle: Type.String(),
        platform: Type.String(),
        url: Type.String(),
        accessedDate: Type.String(),
    }),
])
export type TPodcastReference = Static<typeof PodcastReferenceSchema>

export const CourseReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Course"),
        instructor: Type.String(),
        institution: Type.String(),
        courseCode: Type.Optional(Type.String()),
        term: Type.String(),
    }),
])
export type TCourseReference = Static<typeof CourseReferenceSchema>

export const PresentationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Presentation"),
        presenter: Type.String(),
        eventTitle: Type.String(),
        location: Type.String(),
        date: Type.String(),
    }),
])
export type TPresentationReference = Static<typeof PresentationReferenceSchema>

// ---------------------------------------------------------------------------
// Personal / unpublished
// ---------------------------------------------------------------------------
export const InterviewReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Interview"),
        interviewee: Type.String(),
        interviewer: Type.Optional(Type.String()),
        date: Type.String(),
    }),
])
export type TInterviewReference = Static<typeof InterviewReferenceSchema>

export const PersonalCommunicationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("PersonalCommunication"),
        person: Type.String(),
        date: Type.String(),
    }),
])
export type TPersonalCommunicationReference = Static<
    typeof PersonalCommunicationReferenceSchema
>

export const EmailReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Email"),
        sender: Type.String(),
        recipient: Type.String(),
        date: Type.String(),
    }),
])
export type TEmailReference = Static<typeof EmailReferenceSchema>

// ---------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------
export const LawReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Law"),
        title: Type.String(),
        jurisdiction: Type.String(),
        dateEnacted: Type.String(),
    }),
])
export type TLawReference = Static<typeof LawReferenceSchema>

export const CourtCaseReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("CourtCase"),
        caseName: Type.String(),
        court: Type.String(),
        date: Type.String(),
        reporter: Type.Optional(Type.String()),
    }),
])
export type TCourtCaseReference = Static<typeof CourtCaseReferenceSchema>

export const GovernmentPublicationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("GovernmentPublication"),
        authors: Type.Optional(Type.Array(Type.String())),
        agency: Type.String(),
        reportNumber: Type.Optional(Type.String()),
        location: Type.String(),
    }),
])
export type TGovernmentPublicationReference = Static<
    typeof GovernmentPublicationReferenceSchema
>

// ---------------------------------------------------------------------------
// Technical documents
// ---------------------------------------------------------------------------
export const DatasheetReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Datasheet"),
        manufacturer: Type.String(),
        partNumber: Type.String(),
        url: Type.String(),
    }),
])
export type TDatasheetReference = Static<typeof DatasheetReferenceSchema>

export const ProductManualReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ProductManual"),
        manufacturer: Type.String(),
        model: Type.String(),
        url: Type.Optional(Type.String()),
    }),
])
export type TProductManualReference = Static<
    typeof ProductManualReferenceSchema
>

// ---------------------------------------------------------------------------
// Discriminated union of all reference types
// ---------------------------------------------------------------------------
export const IEEEReferenceSchema = Type.Union([
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
])
export type TIEEEReference = Static<typeof IEEEReferenceSchema>
