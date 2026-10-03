// The citation text of every reference type dated by a year, pinned from
// the output before the year became a calendar date: a four-digit year must
// keep rendering exactly as it did.

import { describe, expect, it } from "vitest"

import { formatCitationParts } from "../../../src/extensions/citations/ieee"
import { oneOfEachType } from "./fixtures.js"

const YEAR_TYPES = [
    "Book",
    "BookChapter",
    "Handbook",
    "TechnicalReport",
    "Thesis",
    "Dictionary",
    "Encyclopedia",
    "JournalArticle",
    "MagazineArticle",
    "Dataset",
    "Software",
    "Preprint",
    "Course",
    "Datasheet",
    "ProductManual",
] as const

describe("citations dated by a four-digit year", () => {
    const references = oneOfEachType()

    it.each(YEAR_TYPES)("%s renders as it did", (type) => {
        const reference = references.find((r) => r.type === type)
        expect(reference).toBeDefined()
        expect(formatCitationParts(reference!).segments).toMatchSnapshot()
    })
})
