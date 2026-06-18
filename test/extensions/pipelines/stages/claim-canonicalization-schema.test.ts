// Unit tests for the per-extension canonicalization schema builders,
// newly exported so the scribe pipeline's `extract` stage + its
// canonicalization adapter can derive the same extension-shaped output
// schema scholar's `claim-canonicalization` stage uses.

import { describe, it, expect } from "vitest"
import { Value } from "typebox/value"
import {
    buildResponseSchema,
    buildClaimRecordSchema,
} from "../../../../src/extensions/pipelines/base/stages/claim-canonicalization.js"
import { basicsExtension } from "../../../../src/extensions/pipelines/base/basics-extension.js"

describe("buildResponseSchema / buildClaimRecordSchema (exported)", () => {
    it("produces a schema that accepts a basics canonical claim with extension fields", () => {
        const schema = buildResponseSchema(basicsExtension)
        const ok = Value.Check(schema, {
            canonicalClaims: [
                {
                    miniId: "c1",
                    mentionIds: ["m1"],
                    suggestedSymbol: "Rain_Wets",
                    type: "normal",
                    title: "Rain wets the ground",
                    body: "Rain makes the ground wet.",
                },
            ],
            mentionToClaim: [{ mentionId: "m1", claimMiniId: "c1" }],
        })
        expect(ok).toBe(true)
    })

    it("buildClaimRecordSchema injects the canonicalizer fields, so a claim missing them is rejected", () => {
        const recordSchema = buildClaimRecordSchema(basicsExtension.claimSchema)
        const missingFields = Value.Check(recordSchema, {
            type: "normal",
            title: "x",
            body: "y",
        })
        expect(missingFields).toBe(false)
    })
})
