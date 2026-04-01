// IEEE Citation Reference Schemas
// https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf

import Type, { type Static } from "typebox"
import { EncodableDate } from "../../lib/schemata/shared.js"

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
        title: Type.String({ minLength: 1, description: "Book title" }),
        year: Type.String({
            pattern: "^\\d{4}$",
            description: "Four-digit publication year",
        }),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition identifier" })
        ),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        location: Type.Optional(
            Type.String({
                minLength: 1,
                description: "Publication location",
            })
        ),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type TBookReference = Static<typeof BookReferenceSchema>

export const WebsiteReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Website"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        pageTitle: Type.String({
            minLength: 1,
            description: "Title of the web page",
        }),
        websiteTitle: Type.String({
            minLength: 1,
            description: "Title of the website",
        }),
        accessedDate: EncodableDate,
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the web page",
        }),
    }),
])
export type TWebsiteReference = Static<typeof WebsiteReferenceSchema>

export const BookChapterReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("BookChapter"),
        chapterTitle: Type.String({
            minLength: 1,
            description: "Chapter title",
        }),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Chapter author names",
        }),
        bookTitle: Type.String({
            minLength: 1,
            description: "Book title",
        }),
        editors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Editor names",
            })
        ),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        location: Type.String({
            minLength: 1,
            description: "Publication location",
        }),
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type TBookChapterReference = Static<typeof BookChapterReferenceSchema>

export const HandbookReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Handbook"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition identifier" })
        ),
        location: Type.String({
            minLength: 1,
            description: "Publication location",
        }),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
    }),
])
export type THandbookReference = Static<typeof HandbookReferenceSchema>

export const TechnicalReportReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("TechnicalReport"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        reportNumber: Type.String({
            minLength: 1,
            description: "Report number or identifier",
        }),
        institution: Type.String({
            minLength: 1,
            description: "Issuing institution",
        }),
        location: Type.String({
            minLength: 1,
            description: "Institution location",
        }),
    }),
])
export type TTechnicalReportReference = Static<
    typeof TechnicalReportReferenceSchema
>

export const StandardReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Standard"),
        organization: Type.String({
            minLength: 1,
            description: "Standards organization name",
        }),
        standardNumber: Type.String({
            minLength: 1,
            description: "Standard number or identifier",
        }),
        title: Type.String({
            minLength: 1,
            description: "Standard title",
        }),
        date: EncodableDate,
    }),
])
export type TStandardReference = Static<typeof StandardReferenceSchema>

export const ThesisReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Thesis"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        degree: Type.String({
            minLength: 1,
            description: "Degree type (e.g. Ph.D., M.S.)",
        }),
        institution: Type.String({
            minLength: 1,
            description: "Granting institution",
        }),
        location: Type.String({
            minLength: 1,
            description: "Institution location",
        }),
    }),
])
export type TThesisReference = Static<typeof ThesisReferenceSchema>

export const PatentReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Patent"),
        inventors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Inventor names",
        }),
        country: Type.String({
            minLength: 1,
            description: "Country of patent",
        }),
        patentNumber: Type.String({
            minLength: 1,
            description: "Patent number",
        }),
        date: EncodableDate,
    }),
])
export type TPatentReference = Static<typeof PatentReferenceSchema>

export const DictionaryReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Dictionary"),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition identifier" })
        ),
    }),
])
export type TDictionaryReference = Static<typeof DictionaryReferenceSchema>

export const EncyclopediaReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Encyclopedia"),
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        edition: Type.Optional(
            Type.String({ minLength: 1, description: "Edition identifier" })
        ),
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
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        journalTitle: Type.String({
            minLength: 1,
            description: "Journal title",
        }),
        volume: Type.Optional(
            Type.String({ minLength: 1, description: "Volume number" })
        ),
        issue: Type.Optional(
            Type.String({ minLength: 1, description: "Issue number" })
        ),
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
    }),
])
export type TJournalArticleReference = Static<
    typeof JournalArticleReferenceSchema
>

export const MagazineArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("MagazineArticle"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        magazineTitle: Type.String({
            minLength: 1,
            description: "Magazine title",
        }),
        volume: Type.Optional(
            Type.String({ minLength: 1, description: "Volume number" })
        ),
        issue: Type.Optional(
            Type.String({ minLength: 1, description: "Issue number" })
        ),
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
    }),
])
export type TMagazineArticleReference = Static<
    typeof MagazineArticleReferenceSchema
>

export const NewspaperArticleReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("NewspaperArticle"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        newspaperTitle: Type.String({
            minLength: 1,
            description: "Newspaper title",
        }),
        date: EncodableDate,
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
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
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        conferenceName: Type.String({
            minLength: 1,
            description: "Conference name",
        }),
        location: Type.String({
            minLength: 1,
            description: "Conference location",
        }),
        date: EncodableDate,
        pages: Type.Optional(
            Type.String({ minLength: 1, description: "Page range" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
    }),
])
export type TConferencePaperReference = Static<
    typeof ConferencePaperReferenceSchema
>

export const ConferenceProceedingsReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ConferenceProceedings"),
        editors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Editor names",
            })
        ),
        conferenceName: Type.String({
            minLength: 1,
            description: "Conference name",
        }),
        location: Type.String({
            minLength: 1,
            description: "Conference location",
        }),
        date: EncodableDate,
        publisher: Type.String({
            minLength: 1,
            description: "Publisher name",
        }),
        isbn: Type.Optional(
            Type.String({
                pattern: "^(?:\\d{9}[\\dX]|\\d{13})$",
                description: "ISBN-10 or ISBN-13 (digits only)",
            })
        ),
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
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Author names",
            })
        ),
        repository: Type.String({
            minLength: 1,
            description: "Repository name",
        }),
        version: Type.Optional(
            Type.String({ minLength: 1, description: "Dataset version" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the dataset",
        }),
    }),
])
export type TDatasetReference = Static<typeof DatasetReferenceSchema>

export const SoftwareReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Software"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Author names",
            })
        ),
        version: Type.Optional(
            Type.String({ minLength: 1, description: "Software version" })
        ),
        publisher: Type.Optional(
            Type.String({ minLength: 1, description: "Publisher name" })
        ),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the software",
        }),
    }),
])
export type TSoftwareReference = Static<typeof SoftwareReferenceSchema>

export const OnlineDocumentReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("OnlineDocument"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Author names",
            })
        ),
        title: Type.String({
            minLength: 1,
            description: "Document title",
        }),
        publisher: Type.Optional(
            Type.String({ minLength: 1, description: "Publisher name" })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the document",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TOnlineDocumentReference = Static<
    typeof OnlineDocumentReferenceSchema
>

export const BlogReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Blog"),
        author: Type.String({
            minLength: 1,
            description: "Blog post author",
        }),
        blogTitle: Type.String({
            minLength: 1,
            description: "Blog title",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the blog post",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TBlogReference = Static<typeof BlogReferenceSchema>

export const SocialMediaReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("SocialMedia"),
        author: Type.String({
            minLength: 1,
            description: "Post author",
        }),
        platform: Type.String({
            minLength: 1,
            description: "Social media platform name",
        }),
        postDate: EncodableDate,
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the post",
        }),
    }),
])
export type TSocialMediaReference = Static<typeof SocialMediaReferenceSchema>

export const PreprintReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Preprint"),
        authors: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "Author names",
        }),
        server: Type.String({
            minLength: 1,
            description: "Preprint server name",
        }),
        doi: Type.Optional(
            Type.String({
                pattern: "^10\\..+/.+$",
                description: "DOI identifier",
            })
        ),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the preprint",
        }),
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
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Author or creator names",
            })
        ),
        platform: Type.String({
            minLength: 1,
            description: "Video hosting platform",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the video",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TVideoReference = Static<typeof VideoReferenceSchema>

export const PodcastReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Podcast"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Host or producer names",
            })
        ),
        episodeTitle: Type.String({
            minLength: 1,
            description: "Episode title",
        }),
        seriesTitle: Type.String({
            minLength: 1,
            description: "Podcast series title",
        }),
        platform: Type.String({
            minLength: 1,
            description: "Podcast platform",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the episode",
        }),
        accessedDate: EncodableDate,
    }),
])
export type TPodcastReference = Static<typeof PodcastReferenceSchema>

export const CourseReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Course"),
        instructor: Type.String({
            minLength: 1,
            description: "Course instructor",
        }),
        institution: Type.String({
            minLength: 1,
            description: "Offering institution",
        }),
        courseCode: Type.Optional(
            Type.String({ minLength: 1, description: "Course code" })
        ),
        term: Type.String({
            minLength: 1,
            description: "Academic term",
        }),
    }),
])
export type TCourseReference = Static<typeof CourseReferenceSchema>

export const PresentationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Presentation"),
        presenter: Type.String({
            minLength: 1,
            description: "Presenter name",
        }),
        eventTitle: Type.String({
            minLength: 1,
            description: "Event or conference title",
        }),
        location: Type.String({
            minLength: 1,
            description: "Event location",
        }),
        date: EncodableDate,
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
        interviewee: Type.String({
            minLength: 1,
            description: "Interviewee name",
        }),
        interviewer: Type.Optional(
            Type.String({ minLength: 1, description: "Interviewer name" })
        ),
        date: EncodableDate,
    }),
])
export type TInterviewReference = Static<typeof InterviewReferenceSchema>

export const PersonalCommunicationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("PersonalCommunication"),
        person: Type.String({
            minLength: 1,
            description: "Person communicated with",
        }),
        date: EncodableDate,
    }),
])
export type TPersonalCommunicationReference = Static<
    typeof PersonalCommunicationReferenceSchema
>

export const EmailReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("Email"),
        sender: Type.String({
            minLength: 1,
            description: "Email sender",
        }),
        recipient: Type.String({
            minLength: 1,
            description: "Email recipient",
        }),
        date: EncodableDate,
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
        title: Type.String({
            minLength: 1,
            description: "Law title",
        }),
        jurisdiction: Type.String({
            minLength: 1,
            description: "Jurisdiction",
        }),
        dateEnacted: EncodableDate,
    }),
])
export type TLawReference = Static<typeof LawReferenceSchema>

export const CourtCaseReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("CourtCase"),
        caseName: Type.String({
            minLength: 1,
            description: "Case name",
        }),
        court: Type.String({
            minLength: 1,
            description: "Court name",
        }),
        date: EncodableDate,
        reporter: Type.Optional(
            Type.String({ minLength: 1, description: "Reporter citation" })
        ),
    }),
])
export type TCourtCaseReference = Static<typeof CourtCaseReferenceSchema>

export const GovernmentPublicationReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("GovernmentPublication"),
        authors: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
                description: "Author names",
            })
        ),
        agency: Type.String({
            minLength: 1,
            description: "Government agency",
        }),
        reportNumber: Type.Optional(
            Type.String({
                minLength: 1,
                description: "Report number",
            })
        ),
        location: Type.String({
            minLength: 1,
            description: "Publication location",
        }),
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
        manufacturer: Type.String({
            minLength: 1,
            description: "Manufacturer name",
        }),
        partNumber: Type.String({
            minLength: 1,
            description: "Part number",
        }),
        url: Type.String({
            format: "uri",
            minLength: 1,
            description: "URL of the datasheet",
        }),
    }),
])
export type TDatasheetReference = Static<typeof DatasheetReferenceSchema>

export const ProductManualReferenceSchema = Type.Intersect([
    BaseReferenceSchema,
    Type.Object({
        type: Type.Literal("ProductManual"),
        manufacturer: Type.String({
            minLength: 1,
            description: "Manufacturer name",
        }),
        model: Type.String({
            minLength: 1,
            description: "Product model",
        }),
        url: Type.Optional(
            Type.String({
                format: "uri",
                minLength: 1,
                description: "URL of the manual",
            })
        ),
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

// ---------------------------------------------------------------------------
// Schema map keyed by reference type
// ---------------------------------------------------------------------------
export const IEEEReferenceSchemaMap = {
    Book: BookReferenceSchema,
    Website: WebsiteReferenceSchema,
    BookChapter: BookChapterReferenceSchema,
    Handbook: HandbookReferenceSchema,
    TechnicalReport: TechnicalReportReferenceSchema,
    Standard: StandardReferenceSchema,
    Thesis: ThesisReferenceSchema,
    Patent: PatentReferenceSchema,
    Dictionary: DictionaryReferenceSchema,
    Encyclopedia: EncyclopediaReferenceSchema,
    JournalArticle: JournalArticleReferenceSchema,
    MagazineArticle: MagazineArticleReferenceSchema,
    NewspaperArticle: NewspaperArticleReferenceSchema,
    ConferencePaper: ConferencePaperReferenceSchema,
    ConferenceProceedings: ConferenceProceedingsReferenceSchema,
    Dataset: DatasetReferenceSchema,
    Software: SoftwareReferenceSchema,
    OnlineDocument: OnlineDocumentReferenceSchema,
    Blog: BlogReferenceSchema,
    SocialMedia: SocialMediaReferenceSchema,
    Preprint: PreprintReferenceSchema,
    Video: VideoReferenceSchema,
    Podcast: PodcastReferenceSchema,
    Course: CourseReferenceSchema,
    Presentation: PresentationReferenceSchema,
    Interview: InterviewReferenceSchema,
    PersonalCommunication: PersonalCommunicationReferenceSchema,
    Email: EmailReferenceSchema,
    Law: LawReferenceSchema,
    CourtCase: CourtCaseReferenceSchema,
    GovernmentPublication: GovernmentPublicationReferenceSchema,
    Datasheet: DatasheetReferenceSchema,
    ProductManual: ProductManualReferenceSchema,
} as const
