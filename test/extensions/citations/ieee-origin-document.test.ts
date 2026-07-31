import { describe, it, expect } from "vitest"
import { Value } from "typebox/value"
import { IEEEOriginDocumentSchema } from "../../../src/extensions/citations/ieee/index.js"
import { CoreOriginDocumentSchema } from "../../../src/lib/schemata/index.js"
import { OriginLibrary } from "../../../src/lib/core/origin-library.js"

// Attribution rides on an origin document through the same route an IEEE
// citation rides on a claim: core declares the entity and leaves the reference
// vocabulary to this extension. A document with no attribution stays valid,
// so nothing about the model demands one.

const SOURCE = "All swans observed so far are white."

const reference = {
    type: "Website" as const,
    authors: [{ givenNames: "Jane Marie", familyName: "Doe" }],
    pageTitle: "On swans",
    websiteTitle: "Example Journal",
    accessedDate: new Date("2026-07-30T00:00:00.000Z"),
    url: "https://example.com/swans",
}

function attributedDocument() {
    const origins = new OriginLibrary()
    return origins.addDocument({
        id: "doc-1",
        text: SOURCE,
        url: "https://example.com/swans",
        reference,
    } as Parameters<OriginLibrary["addDocument"]>[0])
}

describe("IEEEOriginDocumentSchema", () => {
    it("accepts an attributed document under both the extension and core schemas", () => {
        const document = attributedDocument()
        expect(Value.Check(IEEEOriginDocumentSchema, document)).toBe(true)
        expect(Value.Check(CoreOriginDocumentSchema, document)).toBe(true)
    })

    it("accepts a null url — attribution without a reachable address", () => {
        const document = { ...attributedDocument(), url: null }
        expect(Value.Check(IEEEOriginDocumentSchema, document)).toBe(true)
    })

    it("rejects a malformed reference while core still accepts the document", () => {
        const document = {
            ...attributedDocument(),
            reference: { type: "Website", pageTitle: "" },
        }
        expect(Value.Check(IEEEOriginDocumentSchema, document)).toBe(false)
        // Core holds the slot and does not interpret it, so an attribution it
        // knows nothing about does not make the document invalid to core.
        expect(Value.Check(CoreOriginDocumentSchema, document)).toBe(true)
    })

    it("rejects an unattributed document under the extension schema only", () => {
        const plain = new OriginLibrary().addDocument({
            id: "doc-1",
            text: SOURCE,
        })
        expect(Value.Check(CoreOriginDocumentSchema, plain)).toBe(true)
        expect(Value.Check(IEEEOriginDocumentSchema, plain)).toBe(false)
    })

    it("carries the attribution through an origin snapshot round-trip", () => {
        const origins = new OriginLibrary()
        origins.addDocument({
            id: "doc-1",
            text: SOURCE,
            url: "https://example.com/swans",
            reference,
        } as Parameters<OriginLibrary["addDocument"]>[0])

        const restored = OriginLibrary.fromSnapshot(origins.snapshot())
        const document = restored.getDocument("doc-1")
        expect(document).toBeDefined()
        expect(Value.Check(IEEEOriginDocumentSchema, document)).toBe(true)
        expect(restored.validate().ok).toBe(true)
    })

    it("does not change the document checksum — attribution is not identity", () => {
        // The document's checksum covers its digest, so re-attributing a
        // source text does not present as a content change to sync detection.
        const attributed = attributedDocument()
        const plain = new OriginLibrary().addDocument({
            id: "doc-1",
            text: SOURCE,
        })
        expect(attributed.checksum).toBe(plain.checksum)
    })
})
