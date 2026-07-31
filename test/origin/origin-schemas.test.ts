import { describe, it, expect } from "vitest"
import { Value } from "typebox/value"
import {
    CoreOriginDocumentSchema,
    CoreOriginLinkSchema,
    CoreOriginAnchorSchema,
} from "../../src/lib/schemata/index.js"
import {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "../../src/lib/consts.js"

const minimalDocument = {
    id: "doc-1",
    text: "The whole of the source text.",
    digest: "a".repeat(64),
    checksum: "11111111",
}

const minimalLink = {
    id: "link-1",
    argumentId: "arg-1",
    argumentVersion: 0,
    documentId: "doc-1",
    stance: "seed",
    checksum: "22222222",
}

const minimalAnchor = {
    id: "anchor-1",
    argumentId: "arg-1",
    argumentVersion: 0,
    documentId: "doc-1",
    targetType: "premise",
    targetId: "prem-1",
    exact: "source text",
    startCodePoint: 17,
    endCodePoint: 28,
    checksum: "33333333",
}

describe("origin document schema", () => {
    it("accepts a minimal document", () => {
        expect(Value.Check(CoreOriginDocumentSchema, minimalDocument)).toBe(
            true
        )
    })

    it("accepts a segmentation overlay and app-level fields", () => {
        expect(
            Value.Check(CoreOriginDocumentSchema, {
                ...minimalDocument,
                segments: [
                    { segmentId: "s1", startCodePoint: 0, endCodePoint: 3 },
                    { segmentId: "s2", startCodePoint: 4, endCodePoint: 9 },
                ],
                ownerId: "app-owned",
                reference: { type: "article", title: "Anything" },
            })
        ).toBe(true)
    })

    it("rejects a document with no digest or no text", () => {
        const { digest: _digest, ...noDigest } = minimalDocument
        const { text: _text, ...noText } = minimalDocument
        expect(Value.Check(CoreOriginDocumentSchema, noDigest)).toBe(false)
        expect(Value.Check(CoreOriginDocumentSchema, noText)).toBe(false)
    })

    it("rejects a malformed segment", () => {
        expect(
            Value.Check(CoreOriginDocumentSchema, {
                ...minimalDocument,
                segments: [{ segmentId: "s1", startCodePoint: 0 }],
            })
        ).toBe(false)
    })
})

describe("origin link schema", () => {
    it("accepts both stances", () => {
        expect(Value.Check(CoreOriginLinkSchema, minimalLink)).toBe(true)
        expect(
            Value.Check(CoreOriginLinkSchema, {
                ...minimalLink,
                stance: "representation",
            })
        ).toBe(true)
    })

    it("rejects an unknown stance", () => {
        expect(
            Value.Check(CoreOriginLinkSchema, {
                ...minimalLink,
                stance: "verbatim",
            })
        ).toBe(false)
    })
})

describe("origin anchor schema", () => {
    it("accepts each argument-scoped target type", () => {
        for (const targetType of ["expression", "premise", "argument"]) {
            expect(
                Value.Check(CoreOriginAnchorSchema, {
                    ...minimalAnchor,
                    targetType,
                })
            ).toBe(true)
        }
    })

    it("rejects a claim target — provenance belongs to an argument's use of a claim", () => {
        expect(
            Value.Check(CoreOriginAnchorSchema, {
                ...minimalAnchor,
                targetType: "claim",
            })
        ).toBe(false)
    })

    it("accepts optional prefix and suffix context", () => {
        expect(
            Value.Check(CoreOriginAnchorSchema, {
                ...minimalAnchor,
                prefix: "the whole of the ",
                suffix: ".",
            })
        ).toBe(true)
    })

    it("rejects non-numeric positions", () => {
        expect(
            Value.Check(CoreOriginAnchorSchema, {
                ...minimalAnchor,
                startCodePoint: "17",
            })
        ).toBe(false)
    })
})

describe("origin checksum configuration", () => {
    const originKeys = [
        "originDocumentFields",
        "originLinkFields",
        "originAnchorFields",
    ] as const

    it("ships a default field set for every origin key", () => {
        for (const key of originKeys) {
            expect(DEFAULT_CHECKSUM_CONFIG[key]).toBeInstanceOf(Set)
            expect(DEFAULT_CHECKSUM_CONFIG[key]!.size).toBeGreaterThan(0)
        }
    })

    it("createChecksumConfig populates them without throwing", () => {
        // A key listed in CHECKSUM_CONFIG_KEYS but missing from
        // DEFAULT_CHECKSUM_CONFIG crashes here at runtime rather than failing
        // to typecheck, so this covers the coupling directly.
        const config = createChecksumConfig({})
        for (const key of originKeys) {
            expect(config[key]).toEqual(DEFAULT_CHECKSUM_CONFIG[key])
        }
    })

    it("unions app fields onto the origin defaults rather than replacing them", () => {
        const config = createChecksumConfig({
            originDocumentFields: new Set(["ownerId"]),
        })
        expect(config.originDocumentFields).toEqual(
            new Set(["digest", "ownerId"])
        )
    })

    it("round-trips the origin keys through serialize and normalize", () => {
        const serialized = serializeChecksumConfig(DEFAULT_CHECKSUM_CONFIG)
        expect(serialized?.originAnchorFields).toContain("startCodePoint")
        const restored = normalizeChecksumConfig(
            serialized as unknown as typeof DEFAULT_CHECKSUM_CONFIG
        )
        for (const key of originKeys) {
            expect(restored?.[key]).toEqual(DEFAULT_CHECKSUM_CONFIG[key])
        }
    })
})
