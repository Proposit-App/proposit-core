// What the type system says each reference date field holds.

import { describe, expectTypeOf, it } from "vitest"

import type {
    TBookReference,
    TBookChapterReference,
    TCourseReference,
    TDatasetReference,
    TDatasheetReference,
    TDictionaryReference,
    TEncyclopediaReference,
    THandbookReference,
    TJournalArticleReference,
    TMagazineArticleReference,
    TPreprintReference,
    TProductManualReference,
    TSoftwareReference,
    TTechnicalReportReference,
    TThesisReference,
    TBlogReference,
    TConferencePaperReference,
    TConferenceProceedingsReference,
    TCourtCaseReference,
    TEmailReference,
    TGovernmentPublicationReference,
    TInterviewReference,
    TLawReference,
    TNewspaperArticleReference,
    TOnlineDocumentReference,
    TPatentReference,
    TPersonalCommunicationReference,
    TPodcastReference,
    TPresentationReference,
    TSocialMediaReference,
    TStandardReference,
    TVideoReference,
    TWebsiteReference,
} from "../../../src/extensions/citations/ieee"

describe("reference date types", () => {
    it("calendar-date fields are strings", () => {
        expectTypeOf<TStandardReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<TPatentReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<
            TNewspaperArticleReference["date"]
        >().toEqualTypeOf<string>()
        expectTypeOf<
            TConferencePaperReference["date"]
        >().toEqualTypeOf<string>()
        expectTypeOf<
            TConferenceProceedingsReference["date"]
        >().toEqualTypeOf<string>()
        expectTypeOf<TBlogReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<
            TSocialMediaReference["postDate"]
        >().toEqualTypeOf<string>()
        expectTypeOf<TVideoReference["releaseDate"]>().toEqualTypeOf<
            string | undefined
        >()
        expectTypeOf<TPresentationReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<TInterviewReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<
            TPersonalCommunicationReference["date"]
        >().toEqualTypeOf<string>()
        expectTypeOf<TEmailReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<TLawReference["dateEnacted"]>().toEqualTypeOf<string>()
        expectTypeOf<TCourtCaseReference["date"]>().toEqualTypeOf<string>()
        expectTypeOf<
            TGovernmentPublicationReference["date"]
        >().toEqualTypeOf<string>()
    })

    it("access dates are still Dates", () => {
        expectTypeOf<TWebsiteReference["accessedDate"]>().toEqualTypeOf<Date>()
        expectTypeOf<
            TOnlineDocumentReference["accessedDate"]
        >().toEqualTypeOf<Date>()
        expectTypeOf<TBlogReference["accessedDate"]>().toEqualTypeOf<Date>()
        expectTypeOf<TSocialMediaReference["accessedDate"]>().toEqualTypeOf<
            Date | undefined
        >()
        expectTypeOf<TVideoReference["accessedDate"]>().toEqualTypeOf<Date>()
        expectTypeOf<TPodcastReference["accessedDate"]>().toEqualTypeOf<Date>()
    })

    it("year fields are optional strings", () => {
        type TYear = string | undefined
        expectTypeOf<TBookReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TBookChapterReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<THandbookReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TTechnicalReportReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TThesisReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TDictionaryReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TEncyclopediaReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TJournalArticleReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TMagazineArticleReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TDatasetReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TSoftwareReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TPreprintReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TCourseReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TDatasheetReference["year"]>().toEqualTypeOf<TYear>()
        expectTypeOf<TProductManualReference["year"]>().toEqualTypeOf<TYear>()
    })
})
