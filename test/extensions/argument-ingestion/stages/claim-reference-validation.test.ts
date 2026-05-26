// Unit tests for `claim-reference-validation` — the deterministic
// reference-audit stage on the v2 ingestion pipeline.

import { describe, expect, it } from "vitest"
import {
    claimReferenceValidationStage,
    validateClaimReferences,
    CLAIM_REFERENCE_FAILURE_CODES,
} from "../../../../src/extensions/argument-ingestion/stages/claim-reference-validation.js"
import { STAGE_IDS } from "../../../../src/extensions/argument-ingestion/stages/schemas.js"
import type { TClaimCanonicalizationOutput } from "../../../../src/extensions/argument-ingestion/stages/schemas.js"

function canon(
    overrides: Partial<TClaimCanonicalizationOutput>
): TClaimCanonicalizationOutput {
    return {
        canonicalClaims: [],
        mentionToClaim: [],
        ...overrides,
    }
}

describe("validateClaimReferences — happy path", () => {
    it("returns no failures for a consistent set", () => {
        const out = validateClaimReferences(
            canon({
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: ["m1"],
                        suggestedSymbol: "A",
                        type: "normal",
                    },
                    {
                        miniId: "c2",
                        mentionIds: ["m2"],
                        suggestedSymbol: "B",
                        type: "normal",
                    },
                ],
                mentionToClaim: [
                    { mentionId: "m1", claimMiniId: "c1" },
                    { mentionId: "m2", claimMiniId: "c2" },
                ],
            })
        )
        expect(out.failures).toEqual([])
    })

    it("returns no failures for an empty canonicalization output", () => {
        const out = validateClaimReferences(canon({}))
        expect(out.failures).toEqual([])
    })
})

describe("validateClaimReferences — miniId collisions", () => {
    it("emits CLAIM_MINIID_COLLISION when two claims share a miniId", () => {
        const out = validateClaimReferences(
            canon({
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: ["m1"],
                        suggestedSymbol: "A",
                        type: "normal",
                    },
                    {
                        miniId: "c1",
                        mentionIds: ["m2"],
                        suggestedSymbol: "B",
                        type: "normal",
                    },
                ],
            })
        )
        expect(out.failures).toHaveLength(1)
        expect(out.failures[0].code).toBe(
            CLAIM_REFERENCE_FAILURE_CODES.miniIdCollision
        )
        expect(out.failures[0].context.claimMiniId).toBe("c1")
        expect(out.failures[0].context.occurrences).toBe(2)
    })

    it("emits one failure per colliding miniId, not per duplicate", () => {
        const out = validateClaimReferences(
            canon({
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: ["m1"],
                        suggestedSymbol: "A",
                        type: "normal",
                    },
                    {
                        miniId: "c1",
                        mentionIds: ["m2"],
                        suggestedSymbol: "B",
                        type: "normal",
                    },
                    {
                        miniId: "c1",
                        mentionIds: ["m3"],
                        suggestedSymbol: "C",
                        type: "normal",
                    },
                ],
            })
        )
        const collisions = out.failures.filter(
            (f) => f.code === CLAIM_REFERENCE_FAILURE_CODES.miniIdCollision
        )
        expect(collisions).toHaveLength(1)
        expect(collisions[0].context.occurrences).toBe(3)
    })
})

describe("validateClaimReferences — dangling mappings", () => {
    it("emits CLAIM_MENTION_MAPPING_DANGLING when mentionToClaim points at unknown claim", () => {
        const out = validateClaimReferences(
            canon({
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: ["m1"],
                        suggestedSymbol: "A",
                        type: "normal",
                    },
                ],
                mentionToClaim: [
                    { mentionId: "m1", claimMiniId: "c1" },
                    { mentionId: "m2", claimMiniId: "c99" },
                ],
            })
        )
        const dangling = out.failures.filter(
            (f) => f.code === CLAIM_REFERENCE_FAILURE_CODES.danglingMapping
        )
        expect(dangling).toHaveLength(1)
        expect(dangling[0].context.mentionId).toBe("m2")
        expect(dangling[0].context.unknownClaimMiniId).toBe("c99")
    })
})

describe("validateClaimReferences — empty mention ids", () => {
    it("emits CLAIM_MENTION_ID_EMPTY when mentionToClaim has a whitespace key", () => {
        const out = validateClaimReferences(
            canon({
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: ["m1"],
                        suggestedSymbol: "A",
                        type: "normal",
                    },
                ],
                mentionToClaim: [{ mentionId: "   ", claimMiniId: "c1" }],
            })
        )
        const empty = out.failures.filter(
            (f) => f.code === CLAIM_REFERENCE_FAILURE_CODES.emptyMentionId
        )
        expect(empty).toHaveLength(1)
        expect(empty[0].context.targetClaimMiniId).toBe("c1")
    })
})

describe("validateClaimReferences — empty mention list on a claim", () => {
    it("emits CLAIM_MENTION_LIST_EMPTY when a canonical claim has no mentionIds", () => {
        const out = validateClaimReferences(
            canon({
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: [],
                        suggestedSymbol: "A",
                        type: "normal",
                    },
                ],
            })
        )
        const empty = out.failures.filter(
            (f) => f.code === CLAIM_REFERENCE_FAILURE_CODES.emptyMentionList
        )
        expect(empty).toHaveLength(1)
        expect(empty[0].context.claimMiniId).toBe("c1")
    })
})

describe("claimReferenceValidationStage — TStage wiring", () => {
    it("declares the correct id + deps", () => {
        expect(claimReferenceValidationStage.id).toBe(
            STAGE_IDS.claimReferenceValidation
        )
        expect(claimReferenceValidationStage.dependsOn).toEqual([
            STAGE_IDS.claimCanonicalization,
        ])
    })
})
