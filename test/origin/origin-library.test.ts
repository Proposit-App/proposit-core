import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { OriginLibrary } from "../../src/lib/core/origin-library.js"
import { InvariantViolationError } from "../../src/lib/core/invariant-violation-error.js"
import { sha256Hex } from "../../src/lib/utils/sha256.js"
import {
    codePointLength,
    sliceByCodePoints,
    normalizeOriginText,
    buildCodePointIndex,
} from "../../src/lib/utils/origin-text.js"
import type { TCodePointIndex } from "../../src/lib/utils/origin-text.js"

const SOURCE =
    "All swans observed so far are white. Therefore all swans are white."

/**
 * A library holding one document and a link to `arg-1@0`, built inline per
 * test. The link is on by default because an anchor is only valid on an
 * argument version linked to the document it anchors into; pass
 * `{ link: false }` where the link itself is what the test is about.
 */
function withDocument(text = SOURCE, options?: { link?: boolean }) {
    const origins = new OriginLibrary()
    const document = origins.addDocument({ id: "doc-1", text })
    if (options?.link !== false) {
        origins.addLink({
            id: "link-auto",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
    }
    return { origins, document }
}

function anchorFor(
    text: string,
    quote: string,
    overrides: Record<string, unknown> = {}
) {
    const start = codePointLength(text.slice(0, text.indexOf(quote)))
    return {
        id: "anchor-1",
        argumentId: "arg-1",
        argumentVersion: 0,
        documentId: "doc-1",
        targetType: "premise" as const,
        targetId: "prem-1",
        exact: quote,
        startCodePoint: start,
        endCodePoint: start + codePointLength(quote),
        ...overrides,
    }
}

describe("OriginLibrary — documents", () => {
    it("normalizes and digests the supplied text", () => {
        const { document } = withDocument("\uFEFFcafe\u0301\r\nsecond line  ")
        expect(document.text).toBe("café\nsecond line")
        expect(document.digest).toBe(
            createHash("sha256")
                .update("café\nsecond line", "utf8")
                .digest("hex")
        )
        expect(document.checksum).not.toBe("")
    })

    it("gives the same digest to texts that differ only in encoding", () => {
        const origins = new OriginLibrary()
        const plain = origins.addDocument({ id: "d1", text: "café\nline" })
        const encoded = origins.addDocument({
            id: "d2",
            text: "\uFEFFcafe\u0301\r\nline",
        })
        expect(encoded.digest).toBe(plain.digest)
        expect(encoded.checksum).toBe(plain.checksum)
    })

    it("gives different digests to texts differing by one character", () => {
        const origins = new OriginLibrary()
        const a = origins.addDocument({ id: "d1", text: "the source text" })
        const b = origins.addDocument({ id: "d2", text: "the source texts" })
        expect(a.digest).not.toBe(b.digest)
    })

    it("carries an optional segmentation overlay and app-level fields", () => {
        const origins = new OriginLibrary()
        const document = origins.addDocument({
            id: "doc-1",
            text: SOURCE,
            segments: [
                { segmentId: "s1", startCodePoint: 0, endCodePoint: 35 },
            ],
            ownerId: "app-owned",
        } as Parameters<OriginLibrary["addDocument"]>[0])
        expect(document.segments).toHaveLength(1)
        expect(document).toMatchObject({ ownerId: "app-owned" })
    })

    it("rejects a duplicate document id", () => {
        const { origins } = withDocument()
        expect(() =>
            origins.addDocument({ id: "doc-1", text: "other" })
        ).toThrow(/ORIGIN_DOCUMENT_DUPLICATE_ID/)
    })

    it("refuses to remove a document that is still referenced", () => {
        const { origins } = withDocument(SOURCE, { link: false })
        origins.addLink({
            id: "link-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        expect(() => origins.removeDocument("doc-1")).toThrow(
            /ORIGIN_DOCUMENT_IN_USE/
        )
        origins.removeLink("link-1")
        expect(origins.removeDocument("doc-1").id).toBe("doc-1")
    })
})

describe("OriginLibrary — links", () => {
    it("records a stance per argument version and indexes by argument", () => {
        const { origins } = withDocument(SOURCE, { link: false })
        origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        origins.addLink({
            id: "link-1",
            argumentId: "arg-1",
            argumentVersion: 1,
            documentId: "doc-1",
            stance: "representation",
        })
        expect(
            origins.getLinksForArgument("arg-1", 0).map((l) => l.stance)
        ).toEqual(["seed"])
        expect(
            origins.getLinksForArgument("arg-1", 1).map((l) => l.stance)
        ).toEqual(["representation"])
        expect(origins.getLinksForArgument("arg-2", 0)).toEqual([])
    })

    it("checksums the stance, so promoting a stance changes the checksum", () => {
        const { origins } = withDocument()
        const seed = origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        const representation = origins.addLink({
            id: "link-1",
            argumentId: "arg-2",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "representation",
        })
        expect(seed.checksum).not.toBe(representation.checksum)
    })

    it("rejects a link to an unknown document and rolls back", () => {
        const { origins } = withDocument(SOURCE, { link: false })
        expect(() =>
            origins.addLink({
                id: "link-x",
                argumentId: "arg-1",
                argumentVersion: 0,
                documentId: "missing",
                stance: "seed",
            })
        ).toThrow(/ORIGIN_DOCUMENT_REF_NOT_FOUND/)
        expect(origins.getAllLinks()).toHaveLength(0)
        expect(origins.getLinksForArgument("arg-1", 0)).toEqual([])
        expect(origins.validate().ok).toBe(true)
    })
})

describe("OriginLibrary — anchors", () => {
    it("indexes by argument version and by target", () => {
        const { origins } = withDocument()
        origins.addAnchor(
            anchorFor(SOURCE, "All swans observed so far are white.")
        )
        origins.addAnchor(
            anchorFor(SOURCE, "all swans are white.", {
                id: "anchor-2",
                targetType: "expression",
                targetId: "expr-1",
            })
        )
        expect(origins.getAnchorsForArgument("arg-1", 0)).toHaveLength(2)
        expect(
            origins.getAnchorsForTarget("premise", "prem-1").map((a) => a.id)
        ).toEqual(["anchor-1"])
        expect(
            origins.getAnchorsForTarget("expression", "expr-1").map((a) => a.id)
        ).toEqual(["anchor-2"])
        expect(origins.getAnchorsForTarget("argument", "arg-1")).toEqual([])
    })

    it("keeps the optional prefix and suffix context", () => {
        const { origins } = withDocument()
        const anchor = origins.addAnchor(
            anchorFor(SOURCE, "Therefore", {
                prefix: "are white. ",
                suffix: " all swans",
            })
        )
        expect(anchor.prefix).toBe("are white. ")
        expect(anchor.suffix).toBe(" all swans")
    })

    it("rejects an anchor whose span does not slice out its own quote", () => {
        const { origins } = withDocument()
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { startCodePoint: 0 })
            )
        ).toThrow(/ORIGIN_ANCHOR_QUOTE_MISMATCH/)
        expect(origins.getAllAnchors()).toHaveLength(0)
    })

    it("rejects a span that runs past the end of the document", () => {
        const { origins } = withDocument()
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", {
                    startCodePoint: 0,
                    endCodePoint: 10_000,
                })
            )
        ).toThrow(/ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE/)
    })

    it("rejects an anchor referencing an unknown document", () => {
        const { origins } = withDocument()
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { documentId: "missing" })
            )
        ).toThrow(/ORIGIN_DOCUMENT_REF_NOT_FOUND/)
    })

    it("rejects a duplicate anchor id", () => {
        const { origins } = withDocument()
        origins.addAnchor(anchorFor(SOURCE, "Therefore"))
        expect(() => origins.addAnchor(anchorFor(SOURCE, "Therefore"))).toThrow(
            /ORIGIN_ANCHOR_DUPLICATE_ID/
        )
    })

    it("drops an anchor from every index on removal", () => {
        const { origins } = withDocument()
        origins.addAnchor(anchorFor(SOURCE, "Therefore"))
        origins.removeAnchor("anchor-1")
        expect(origins.getAnchorsForArgument("arg-1", 0)).toEqual([])
        expect(origins.getAnchorsForTarget("premise", "prem-1")).toEqual([])
        expect(origins.getAnchor("anchor-1")).toBeUndefined()
    })
})

describe("OriginLibrary — code-point addressing", () => {
    // A document whose UTF-16 offsets and code-point offsets disagree. If the
    // library ever switched units, the anchor below would stop validating.
    const astralSource = "Proof \u{1D56C}: every \u{1F44D} counts as one."

    it("validates an anchor whose span crosses an astral-plane character", () => {
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: astralSource })
        origins.addLink({
            id: "link-auto",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        const quote = "every \u{1F44D} counts"
        const anchor = origins.addAnchor(anchorFor(astralSource, quote))
        expect(anchor.exact).toBe(quote)
        expect(origins.validate().ok).toBe(true)
    })

    it("would reject the same span read as UTF-16 code units", () => {
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: astralSource })
        const quote = "every \u{1F44D} counts"
        const codePointStart = codePointLength(
            astralSource.slice(0, astralSource.indexOf(quote))
        )
        const utf16Start = astralSource.indexOf(quote)
        expect(utf16Start).not.toBe(codePointStart)
        expect(
            astralSource.slice(codePointStart, codePointStart + quote.length)
        ).not.toBe(quote)
        expect(
            sliceByCodePoints(
                astralSource,
                codePointStart,
                codePointStart + codePointLength(quote)
            )
        ).toBe(quote)
    })
})

describe("OriginLibrary — validate and rollback", () => {
    it("reports a tampered digest", () => {
        const { origins, document } = withDocument()
        const tampered = origins.snapshot()
        tampered.documents[0] = { ...document, digest: "0".repeat(64) }
        const restored = OriginLibrary.fromSnapshot(tampered)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(result.violations.map((v) => v.code)).toContain(
            "ORIGIN_DOCUMENT_DIGEST_MISMATCH"
        )
    })

    it("reports un-normalized text loaded from a snapshot", () => {
        const restored = OriginLibrary.fromSnapshot({
            documents: [
                {
                    id: "doc-1",
                    text: "line one\r\nline two",
                    digest: createHash("sha256")
                        .update("line one\r\nline two", "utf8")
                        .digest("hex"),
                    checksum: "deadbeef",
                },
            ],
            links: [],
            anchors: [],
        })
        expect(restored.validate().violations.map((v) => v.code)).toContain(
            "ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED"
        )
    })

    it("leaves the library byte-identical after a failed add", () => {
        const { origins } = withDocument()
        origins.addAnchor(anchorFor(SOURCE, "Therefore"))
        const before = JSON.stringify(origins.snapshot())
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", {
                    id: "anchor-2",
                    startCodePoint: 0,
                })
            )
        ).toThrow(InvariantViolationError)
        expect(JSON.stringify(origins.snapshot())).toBe(before)
    })
})

describe("OriginLibrary — snapshot round-trip", () => {
    it("preserves every collection, index, and checksum", () => {
        const { origins } = withDocument()
        origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        origins.addLink({
            id: "link-1",
            argumentId: "arg-1",
            argumentVersion: 1,
            documentId: "doc-1",
            stance: "representation",
        })
        origins.addAnchor(anchorFor(SOURCE, "All swans observed so far"))
        origins.addAnchor(
            anchorFor(SOURCE, "all swans are white.", {
                id: "anchor-2",
                targetType: "expression",
                targetId: "expr-1",
            })
        )

        const snapshot = origins.snapshot()
        const restored = OriginLibrary.fromSnapshot(snapshot)

        expect(restored.snapshot()).toEqual(snapshot)
        expect(restored.validate().ok).toBe(true)
        expect(restored.getLinksForArgument("arg-1", 1)[0].stance).toBe(
            "representation"
        )
        expect(restored.getAnchorsForTarget("expression", "expr-1")[0].id).toBe(
            "anchor-2"
        )
        expect(restored.getAnchorsForArgument("arg-1", 0)).toHaveLength(2)
    })

    it("round-trips through JSON, the form a snapshot is stored in", () => {
        const { origins } = withDocument()
        origins.addAnchor(anchorFor(SOURCE, "Therefore"))
        const restored = OriginLibrary.fromSnapshot(
            JSON.parse(JSON.stringify(origins.snapshot())) as ReturnType<
                OriginLibrary["snapshot"]
            >
        )
        expect(restored.snapshot()).toEqual(origins.snapshot())
    })

    it("honors a supplied checksum config", () => {
        const origins = new OriginLibrary({
            checksumConfig: { originDocumentFields: new Set(["ownerId"]) },
        })
        const withOwner = origins.addDocument({
            id: "doc-1",
            text: SOURCE,
            ownerId: "someone",
        } as Parameters<OriginLibrary["addDocument"]>[0])
        const plain = new OriginLibrary().addDocument({
            id: "doc-1",
            text: SOURCE,
        })
        expect(withOwner.checksum).not.toBe(plain.checksum)
    })
})

describe("OriginLibrary — documents whose text contains adjacent invisibles", () => {
    // `addDocument` normalizes, then `withValidation` re-normalizes to check
    // its own work. A normalizer that needed two passes made the library
    // reject ordinary prose it had just normalized itself.
    const cases: readonly [string, string][] = [
        ["joiner then variation selector", "The cat\u200D\uFE00 sat."],
        ["two variation selectors", "The cat\uFE0F\uFE0F sat."],
        [
            "tag character then variation selector",
            "The cat\u{E0067}\uFE0F sat.",
        ],
        ["joiner then variation selector, bare", "a\u200D\uFE0Fb"],
    ]

    for (const [label, text] of cases) {
        it(`stores text it normalized itself — ${label}`, () => {
            const origins = new OriginLibrary()
            const document = origins.addDocument({ id: "doc-1", text })
            expect(origins.validate().ok).toBe(true)
            // What the library stored is what one pass of the normalizer
            // produces, and a second pass changes nothing.
            expect(document.text).toBe(normalizeOriginText(text))
            expect(normalizeOriginText(document.text)).toBe(document.text)
            expect(origins.getDocument("doc-1")?.text).toBe(document.text)
        })
    }

    it("keeps an anchor drawn against a consumer's own normalization", () => {
        // The documented flow: a consumer normalizes at its import boundary,
        // measures offsets against that string, then hands the same string to
        // addDocument. If the two normalizations disagree, every anchor the
        // consumer adds fails ORIGIN_ANCHOR_QUOTE_MISMATCH.
        const raw = "The cat\u200D\uFE00 sat on the mat."
        const consumerText = normalizeOriginText(raw)
        const quote = "cat sat"
        const start = codePointLength(
            consumerText.slice(0, consumerText.indexOf(quote))
        )

        const origins = new OriginLibrary()
        const document = origins.addDocument({
            id: "doc-1",
            text: consumerText,
        })
        expect(document.text).toBe(consumerText)
        origins.addLink({
            id: "link-auto",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })

        const anchor = origins.addAnchor({
            id: "anchor-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            targetType: "premise",
            targetId: "prem-1",
            exact: quote,
            startCodePoint: start,
            endCodePoint: start + codePointLength(quote),
        })
        expect(anchor.exact).toBe(quote)
        expect(origins.validate().ok).toBe(true)
    })
})

describe("OriginLibrary — cost of validating on every mutation", () => {
    // Documents are immutable and `addDocument` computes their text and digest
    // itself, so re-normalizing and re-digesting every body on every unrelated
    // mutation is pure waste. The server slice adds one anchor per extracted
    // claim inside a request handler, so the cost has to be flat in document
    // size, not linear in it.
    //
    // The bound is deliberately loose — this asserts the algorithm, not the
    // machine. Before the fix this took over a second.
    it("adds many anchors to large documents without re-scanning them", () => {
        const body = "lorem ipsum dolor sit amet ".repeat(3_800)
        const origins = new OriginLibrary()
        for (let i = 0; i < 5; i++) {
            origins.addDocument({ id: `doc-${i}`, text: body })
        }
        origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-0",
            stance: "seed",
        })
        const stored = origins.getDocument("doc-0")!.text
        const quote = sliceByCodePoints(stored, 0, 11)

        const startedAt = performance.now()
        for (let i = 0; i < 100; i++) {
            origins.addAnchor({
                id: `anchor-${i}`,
                argumentId: "arg-1",
                argumentVersion: 0,
                documentId: "doc-0",
                targetType: "premise",
                targetId: `prem-${i}`,
                exact: quote,
                startCodePoint: 0,
                endCodePoint: 11,
            })
        }
        const elapsed = performance.now() - startedAt

        expect(origins.getAllAnchors()).toHaveLength(100)
        expect(elapsed).toBeLessThan(300)
    })

    it("still catches a tampered document body after the first validation", () => {
        // Skipping the re-check must be keyed to the exact text that was
        // verified, not to the document id, or a tampered snapshot slips past.
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: SOURCE })
        expect(origins.validate().ok).toBe(true)

        const tampered = origins.snapshot()
        tampered.documents[0] = {
            ...tampered.documents[0],
            text: `${SOURCE} and then some.`,
        }
        const restored = OriginLibrary.fromSnapshot(tampered)
        expect(restored.validate().violations.map((v) => v.code)).toContain(
            "ORIGIN_DOCUMENT_DIGEST_MISMATCH"
        )
    })
})

describe("OriginLibrary — an anchor needs a link to be interpretable", () => {
    // The link carries the stance, and the stance is what decides whether the
    // absence of provenance means anything. An anchor whose argument version
    // has no link is provenance nobody can read.
    function linkedLibrary() {
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: SOURCE })
        origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        return origins
    }

    it("rejects an anchor on an argument version with no link", () => {
        const origins = linkedLibrary()
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { argumentVersion: 77 })
            )
        ).toThrow(/ORIGIN_ANCHOR_LINK_NOT_FOUND/)
        expect(origins.getAllAnchors()).toHaveLength(0)
    })

    it("rejects an anchor on an argument with no link at all", () => {
        const origins = linkedLibrary()
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { argumentId: "arg-other" })
            )
        ).toThrow(/ORIGIN_ANCHOR_LINK_NOT_FOUND/)
    })

    it("rejects an anchor to a document the argument version is not linked to", () => {
        const origins = linkedLibrary()
        origins.addDocument({ id: "doc-2", text: SOURCE })
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { documentId: "doc-2" })
            )
        ).toThrow(/ORIGIN_ANCHOR_LINK_NOT_FOUND/)
    })

    it("accepts an anchor once the link exists", () => {
        const origins = linkedLibrary()
        expect(origins.addAnchor(anchorFor(SOURCE, "Therefore")).id).toBe(
            "anchor-1"
        )
        expect(origins.validate().ok).toBe(true)
    })

    it("reports an anchor orphaned by removing its link", () => {
        const origins = linkedLibrary()
        origins.addAnchor(anchorFor(SOURCE, "Therefore"))
        expect(() => origins.removeLink("link-0")).toThrow(
            /ORIGIN_ANCHOR_LINK_NOT_FOUND/
        )
        // The rollback leaves both entities in place.
        expect(origins.getLink("link-0")).toBeDefined()
        expect(origins.getAllAnchors()).toHaveLength(1)
    })
})

describe("OriginLibrary — an inconsistent library stays repairable", () => {
    // Validating the whole library after every mutation asks the wrong
    // question. What matters is whether a mutation made things worse, not
    // whether everything is clean afterwards — demanding cleanliness means a
    // library that is already inconsistent can never be repaired, and every
    // mutation on it fails forever.
    function orphanedAnchorSnapshot(
        count: number
    ): ReturnType<OriginLibrary["snapshot"]> {
        return {
            documents: [
                {
                    id: "doc-1",
                    text: SOURCE,
                    digest: sha256Hex(SOURCE),
                    checksum: "deadbeef",
                },
            ],
            links: [],
            anchors: Array.from({ length: count }, (_, i) => ({
                id: `anchor-${i}`,
                argumentId: "arg-1",
                argumentVersion: 0,
                documentId: "doc-1",
                targetType: "premise" as const,
                targetId: `prem-${i}`,
                exact: "All swans",
                startCodePoint: 0,
                endCodePoint: 9,
                checksum: "cafe",
            })),
        }
    }

    it("drains several orphaned anchors one at a time", () => {
        const origins = OriginLibrary.fromSnapshot(orphanedAnchorSnapshot(3))
        expect(origins.validate().ok).toBe(false)

        for (let i = 0; i < 3; i++) {
            expect(origins.removeAnchor(`anchor-${i}`).id).toBe(`anchor-${i}`)
        }
        expect(origins.getAllAnchors()).toEqual([])
        expect(origins.validate().ok).toBe(true)
    })

    it("lets the document go once its orphaned anchors are drained", () => {
        const origins = OriginLibrary.fromSnapshot(orphanedAnchorSnapshot(2))
        origins.removeAnchor("anchor-0")
        origins.removeAnchor("anchor-1")
        expect(origins.removeDocument("doc-1").id).toBe("doc-1")
    })

    it("repairs by adding the missing link instead, if that is what was meant", () => {
        const origins = OriginLibrary.fromSnapshot(orphanedAnchorSnapshot(2))
        origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        expect(origins.validate().ok).toBe(true)
    })

    it("still refuses a mutation that introduces a new violation", () => {
        const origins = OriginLibrary.fromSnapshot(orphanedAnchorSnapshot(2))
        expect(() =>
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { id: "anchor-new" })
            )
        ).toThrow(/ORIGIN_ANCHOR_LINK_NOT_FOUND/)
        expect(origins.getAnchor("anchor-new")).toBeUndefined()
        // The two it arrived with are untouched.
        expect(origins.getAllAnchors()).toHaveLength(2)
    })

    it("reports only what the mutation introduced, not what it inherited", () => {
        const origins = OriginLibrary.fromSnapshot(orphanedAnchorSnapshot(2))
        try {
            origins.addAnchor(
                anchorFor(SOURCE, "Therefore", { id: "anchor-new" })
            )
            expect.unreachable("expected the add to be refused")
        } catch (error) {
            expect(error).toBeInstanceOf(InvariantViolationError)
            const violations = (error as InvariantViolationError).violations
            expect(violations.map((v) => v.entityId)).toEqual(["anchor-new"])
        }
    })
})

describe("OriginLibrary — the caches keep their own guarantees", () => {
    // Neither defect these cover is reachable through the public API today:
    // the normalizer is idempotent, so `addDocument` cannot produce a body its
    // own check would reject, and `restoreFromSnapshot` is private and only
    // ever fed a snapshot this same library took. Both are still wrong, and
    // both are one line from becoming live — a `replaceDocument` method, or any
    // future edit to the normalizer. The tests below reach the caches directly
    // rather than pretending a black-box path exists.

    type TCacheProbe = {
        verifiedDocumentBodies: Map<string, string>
        documentIndexes: Map<string, TCodePointIndex>
    }
    const probe = (origins: OriginLibrary): TCacheProbe =>
        origins as unknown as TCacheProbe

    it("does not record a document as verified before its text is checked", () => {
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: SOURCE })
        expect(probe(origins).verifiedDocumentBodies.get("doc-1")).toBe(SOURCE)
    })

    it("keeps reporting un-normalized text however often validate runs", () => {
        // A document that fails its body checks must never enter the verified
        // record, or the second validate() would silently pass it.
        const restored = OriginLibrary.fromSnapshot({
            documents: [
                {
                    id: "doc-1",
                    text: "line one\r\nline two",
                    digest: sha256Hex("line one\r\nline two"),
                    checksum: "deadbeef",
                },
            ],
            links: [],
            anchors: [],
        })
        for (let i = 0; i < 3; i++) {
            expect(restored.validate().violations.map((v) => v.code)).toContain(
                "ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED"
            )
        }
        expect(probe(restored).verifiedDocumentBodies.has("doc-1")).toBe(false)
    })

    it("rebuilds a code-point index whose text no longer matches the document", () => {
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: SOURCE })
        origins.addLink({
            id: "link-0",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        origins.addAnchor(anchorFor(SOURCE, "All swans"))
        expect(origins.validate().ok).toBe(true)

        // Plant an index built from different text under the same id. Keyed by
        // id alone, validate() would slice against the wrong string and report
        // a quote mismatch that is not there.
        probe(origins).documentIndexes.set(
            "doc-1",
            buildCodePointIndex("a completely different body of text")
        )
        expect(origins.validate().ok).toBe(true)
        expect(probe(origins).documentIndexes.get("doc-1")?.text).toBe(SOURCE)
    })
})
