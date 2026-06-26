import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import { RelationExtractionOutputSchema } from "../../../../src/extensions/pipelines/base/stages/schemas.js"

describe("RelationExtractionOutputSchema (inference relations)", () => {
    it("accepts an inference relation with antecedents and consequent", () => {
        const ok = {
            relations: [
                {
                    relationId: "r1",
                    type: "inference",
                    antecedents: ["c1", "c2"],
                    consequent: "c3",
                    evidence: { segmentIds: ["s1"], quote: "q" },
                },
            ],
        }
        expect(Value.Check(RelationExtractionOutputSchema, ok)).toBe(true)
    })

    it("rejects a legacy support relation", () => {
        const bad = {
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: ["s1"], quote: "q" },
                },
            ],
        }
        expect(Value.Check(RelationExtractionOutputSchema, bad)).toBe(false)
    })
})
