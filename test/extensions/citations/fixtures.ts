// Reference fixtures shared by the IEEE citation tests.

import type {
    TAuthor,
    TIEEEReference,
} from "../../../src/extensions/citations/ieee"

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

export function author(
    given: string,
    family: string,
    suffix?: string
): TAuthor {
    return suffix
        ? { givenNames: given, familyName: family, suffix }
        : { givenNames: given, familyName: family }
}

export function validBook() {
    return {
        type: "Book" as const,
        title: "Artificial Intelligence",
        year: "2024",
        authors: [author("Jane", "Smith")],
        publisher: "MIT Press",
    }
}

export function validWebsite() {
    return {
        type: "Website" as const,
        authors: [author("John", "Doe")],
        pageTitle: "Understanding AI",
        websiteTitle: "Tech Blog",
        accessedDate: new Date("2024-06-15"),
        url: "https://example.com/article",
    }
}

export function validJournalArticle() {
    return {
        type: "JournalArticle" as const,
        authors: [author("Alice", "Johnson")],
        title: "Quantum computing advances",
        journalTitle: "Nature",
        year: "2024",
        doi: "10.1038/s41586-024-00001-1",
    }
}

export function validPatent() {
    return {
        type: "Patent" as const,
        title: "Nonlinear resonant circuit devices",
        inventors: [author("Bob", "Wilson")],
        country: "US",
        patentNumber: "US1234567",
        date: new Date("2024-01-15"),
    }
}

export function validBlog() {
    return {
        type: "Blog" as const,
        author: author("Carol", "White"),
        postTitle: "My Latest Discovery",
        blogName: "My Tech Blog",
        date: new Date("2024-03-01"),
        url: "https://blog.example.com/post",
        accessedDate: new Date("2024-03-15"),
    }
}

export function validDataset() {
    return {
        type: "Dataset" as const,
        title: "Climate Data 2024",
        repository: "Zenodo",
        year: "2024",
        url: "https://zenodo.org/record/12345",
        doi: "10.5281/zenodo.12345",
    }
}

// One reference of each of the 33 types, every required field filled.
export function oneOfEachType(): TIEEEReference[] {
    const a = author("Alex", "Brown")
    return [
        validBook(),
        validWebsite(),
        {
            type: "BookChapter" as const,
            chapterTitle: "Ch 1",
            year: "2024",
            authors: [a],
            bookTitle: "Book",
            publisher: "Pub",
            location: "NYC",
        },
        {
            type: "Handbook" as const,
            title: "Engineering Handbook",
            year: "2024",
            publisher: "Pub",
            location: "NYC",
        },
        {
            type: "TechnicalReport" as const,
            title: "Report on Systems",
            year: "2024",
            authors: [a],
            reportNumber: "TR-1",
            institution: "MIT",
            location: "Cambridge",
        },
        {
            type: "Standard" as const,
            organization: "IEEE",
            standardNumber: "802.11",
            title: "WiFi",
            date: new Date(),
        },
        {
            type: "Thesis" as const,
            title: "On Computation",
            year: "2024",
            authors: [a],
            degree: "Ph.D.",
            institution: "MIT",
            location: "Cambridge",
        },
        validPatent(),
        {
            type: "Dictionary" as const,
            title: "English Dictionary",
            year: "2024",
            publisher: "OUP",
        },
        {
            type: "Encyclopedia" as const,
            title: "World Encyclopedia",
            year: "2024",
            publisher: "Britannica",
        },
        validJournalArticle(),
        {
            type: "MagazineArticle" as const,
            title: "Tech Trends",
            year: "2024",
            authors: [a],
            magazineTitle: "Mag",
        },
        {
            type: "NewspaperArticle" as const,
            title: "Breaking News",
            authors: [a],
            newspaperTitle: "Times",
            date: new Date(),
        },
        {
            type: "ConferencePaper" as const,
            title: "New Algorithms",
            authors: [a],
            conferenceName: "Conf",
            location: "NYC",
            date: new Date(),
        },
        {
            type: "ConferenceProceedings" as const,
            conferenceName: "Conf",
            location: "NYC",
            date: new Date(),
            publisher: "Pub",
        },
        validDataset(),
        {
            type: "Software" as const,
            title: "MyApp",
            year: "2024",
            url: "https://example.com",
        },
        {
            type: "OnlineDocument" as const,
            title: "Doc",
            url: "https://example.com",
            accessedDate: new Date(),
        },
        validBlog(),
        {
            type: "SocialMedia" as const,
            author: a,
            platform: "Twitter",
            postDate: new Date(),
            url: "https://twitter.com",
        },
        {
            type: "Preprint" as const,
            title: "Early Results",
            year: "2024",
            authors: [a],
            server: "arXiv",
            url: "https://arxiv.org",
        },
        {
            type: "Video" as const,
            title: "Tutorial Video",
            platform: "YouTube",
            url: "https://youtube.com",
            accessedDate: new Date(),
        },
        {
            type: "Podcast" as const,
            episodeTitle: "Ep 1",
            seriesTitle: "Pod",
            platform: "Spotify",
            url: "https://spotify.com",
            accessedDate: new Date(),
        },
        {
            type: "Course" as const,
            title: "Intro to CS",
            year: "2024",
            instructor: a,
            institution: "MIT",
            term: "Fall 2024",
        },
        {
            type: "Presentation" as const,
            title: "Keynote Talk",
            presenter: a,
            eventTitle: "Event",
            location: "NYC",
            date: new Date(),
        },
        {
            type: "Interview" as const,
            interviewee: a,
            date: new Date(),
        },
        {
            type: "PersonalCommunication" as const,
            person: a,
            date: new Date(),
        },
        {
            type: "Email" as const,
            sender: a,
            recipient: author("Zara", "Lee"),
            date: new Date(),
        },
        {
            type: "Law" as const,
            title: "Act",
            jurisdiction: "US",
            dateEnacted: new Date(),
        },
        {
            type: "CourtCase" as const,
            caseName: "X v Y",
            court: "Supreme Court",
            date: new Date(),
        },
        {
            type: "GovernmentPublication" as const,
            title: "Annual Report",
            date: new Date(),
            agency: "EPA",
            location: "DC",
        },
        {
            type: "Datasheet" as const,
            title: "Processor Specs",
            year: "2024",
            manufacturer: "Intel",
            partNumber: "i7-12700K",
            url: "https://intel.com",
        },
        {
            type: "ProductManual" as const,
            title: "User Guide",
            year: "2024",
            manufacturer: "Dell",
            model: "XPS 15",
        },
    ]
}
