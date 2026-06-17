// Unit tests for `conclusion-selection` — the wrapper that resolves a
// single `conclusionMiniId` from the model's confidence-ranked
// `conclusionCandidates` list, falling back to the relation graph when
// the model names none, and surfacing `NO_SINGLE_CONCLUSION` only when no
// claim qualifies at all.

import { describe, expect, it } from "vitest"
import Type from "typebox"
import {
    deterministicStage,
    executePipeline,
} from "../../../../src/lib/pipelines/index.js"
import type { TPipeline } from "../../../../src/lib/pipelines/index.js"
import {
    STAGE_IDS,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionLlmOutput,
    type TConclusionSelectionOutput,
    type TRelationExtractionOutput,
} from "../../../../src/extensions/pipelines/base/stages/index.js"
import {
    CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
    conclusionSelectionStage,
    selectFallbackConclusion,
} from "../../../../src/extensions/pipelines/base/stages/conclusion-selection.js"
import { claimTypeClassificationStage } from "../../../../src/extensions/pipelines/base/stages/claim-type-classification.js"
import { relationExtractionStage } from "../../../../src/extensions/pipelines/base/stages/relation-extraction.js"
import { createMockLlmProvider } from "../../../mocks/llm.js"

const INPUT_SCHEMA = Type.Object({ text: Type.String() })

function buildStandalonePipeline(
    typeMap: TClaimTypeClassificationOutput,
    relations: TRelationExtractionOutput
): TPipeline<{ text: string }, TConclusionSelectionOutput> {
    const typeSeed = deterministicStage<TClaimTypeClassificationOutput>({
        id: STAGE_IDS.claimTypeClassification,
        dependsOn: [],
        outputSchema: claimTypeClassificationStage.outputSchema,
        fn: () => typeMap,
    })
    const relSeed = deterministicStage<TRelationExtractionOutput>({
        id: STAGE_IDS.relationExtraction,
        dependsOn: [],
        outputSchema: relationExtractionStage.outputSchema,
        fn: () => relations,
    })
    return {
        id: "test",
        version: "1.0.0",
        inputSchema: INPUT_SCHEMA,
        outputSchema: conclusionSelectionStage.outputSchema,
        stages: [typeSeed, relSeed, conclusionSelectionStage],
        finalize: {
            dependsOn: [STAGE_IDS.conclusionSelection],
            run: (ctx) =>
                ctx.get<TConclusionSelectionOutput>(
                    STAGE_IDS.conclusionSelection
                )!,
        },
    }
}

function makeClassifications(
    entries: readonly (readonly [string, "normal" | "citation" | "axiomatic"])[]
): TClaimTypeClassificationOutput {
    return {
        classifications: entries.map(([miniId, type]) => ({
            miniId,
            type,
            sourceString: null,
        })),
    }
}

function makeRelation(
    relationId: string,
    sources: string[],
    target: string
): TRelationExtractionOutput["relations"][number] {
    return {
        relationId,
        type: "support",
        sources,
        target,
        evidence: { segmentIds: [], quote: "" },
    }
}

function llmReturning(candidates: string[], rationale = "Model rationale.") {
    return createMockLlmProvider({
        responses: {
            [STAGE_IDS.conclusionSelection]: [
                {
                    kind: "ok",
                    output: {
                        conclusionCandidates: candidates,
                        rationale,
                    } satisfies TConclusionSelectionLlmOutput,
                },
            ],
        },
    })
}

function noConclusionFailure(result: {
    failures: { code: string }[]
}): { code: string } | undefined {
    return result.failures.find(
        (f) => f.code === CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE
    )
}

describe("conclusionSelectionStage — model-ranked candidates", () => {
    it("picks the model's top candidate when it is a valid normal claim", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c1", "normal"],
                ["c2", "normal"],
            ]),
            { relations: [] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning(["c2", "c1"], "c2 is the strongest.") }
        )
        expect(result.stageOutcomes[STAGE_IDS.conclusionSelection]).toBe(
            "completed"
        )
        expect(result.output?.conclusionMiniId).toBe("c2")
        // The full ranked list rides along untouched for consumers.
        expect(result.output?.conclusionCandidates).toEqual(["c2", "c1"])
        // A clean model pick keeps the model's own rationale.
        expect(result.output?.rationale).toBe("c2 is the strongest.")
        expect(noConclusionFailure(result)).toBeUndefined()
    })

    it("prefers the model's pick over the graph fallback when they disagree", async () => {
        // The model picks c1 (a normal non-terminal); the relation graph
        // would pick c2 (the sink). The model's choice must win — the
        // fallback is only consulted when the model names no valid pick.
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c1", "normal"],
                ["c2", "normal"],
            ]),
            { relations: [makeRelation("r1", ["c1"], "c2")] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning(["c1"], "c1 is the real point.") }
        )
        expect(result.output?.conclusionMiniId).toBe("c1")
        expect(result.output?.rationale).toBe("c1 is the real point.")
        expect(noConclusionFailure(result)).toBeUndefined()
    })

    it("skips a citation top candidate to the next valid normal one", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["cit1", "citation"],
                ["c3", "normal"],
            ]),
            { relations: [] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning(["cit1", "c3"]) }
        )
        expect(result.output?.conclusionMiniId).toBe("c3")
        expect(noConclusionFailure(result)).toBeUndefined()
    })

    it("skips an unknown top candidate to the next valid one", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c2", "normal"],
                ["c3", "normal"],
            ]),
            { relations: [] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning(["zz9", "c3"]) }
        )
        expect(result.output?.conclusionMiniId).toBe("c3")
        expect(noConclusionFailure(result)).toBeUndefined()
    })

    it("falls back to the relation graph when every model candidate is invalid", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["cit1", "citation"],
                ["c2", "normal"],
                ["c3", "normal"],
            ]),
            { relations: [makeRelation("r1", ["c2"], "c3")] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning(["cit1"]) }
        )
        // cit1 is a citation (rule 3) → graph fallback picks the lone
        // normal terminal c3.
        expect(result.output?.conclusionMiniId).toBe("c3")
        expect(result.output?.rationale).toContain("Auto-selected")
        expect(noConclusionFailure(result)).toBeUndefined()
    })
})

describe("conclusionSelectionStage — relation-graph fallback when the model returns no candidates", () => {
    it("auto-picks the earliest pure sink when terminals tie on in-degree", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c1", "normal"],
                ["c2", "normal"],
                ["c3", "normal"],
            ]),
            {
                relations: [
                    makeRelation("r1", ["c2"], "c1"),
                    makeRelation("r2", ["c2"], "c3"),
                ],
            }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning([]) }
        )
        expect(result.stageOutcomes[STAGE_IDS.conclusionSelection]).toBe(
            "completed"
        )
        expect(result.output?.conclusionMiniId).toBe("c1")
        expect(result.output?.rationale).toContain("Auto-selected")
        expect(noConclusionFailure(result)).toBeUndefined()
    })

    it("prefers the higher in-degree terminal over an earlier lower-degree one", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c1", "normal"],
                ["c2", "normal"],
                ["c3", "normal"],
                ["c4", "normal"],
                ["c5", "normal"],
            ]),
            {
                relations: [
                    makeRelation("r1", ["c2"], "c1"),
                    makeRelation("r2", ["c3"], "c5"),
                    makeRelation("r3", ["c4"], "c5"),
                ],
            }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning([]) }
        )
        expect(result.output?.conclusionMiniId).toBe("c5")
    })

    it("excludes citation terminals and non-sink normals, picking the lone normal sink", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c1", "citation"],
                ["c2", "normal"],
                ["c3", "normal"],
                ["c4", "normal"],
            ]),
            {
                relations: [
                    makeRelation("r1", ["c2"], "c1"),
                    makeRelation("r2", ["c2"], "c4"),
                    makeRelation("r3", ["c4"], "c3"),
                ],
            }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning([]) }
        )
        expect(result.output?.conclusionMiniId).toBe("c3")
    })

    it("relaxes to the highest in-degree target when a cycle leaves no pure sink", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([
                ["c1", "normal"],
                ["c2", "normal"],
            ]),
            {
                relations: [
                    makeRelation("r1", ["c1"], "c2"),
                    makeRelation("r2", ["c2"], "c1"),
                ],
            }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning([]) }
        )
        expect(result.output?.conclusionMiniId).toBe("c1")
        expect(noConclusionFailure(result)).toBeUndefined()
    })
})

describe("conclusionSelectionStage — no conclusion at all", () => {
    it("emits NO_SINGLE_CONCLUSION when the model returns no candidates and the graph has none", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([["c1", "normal"]]),
            { relations: [] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            {
                llm: llmReturning(
                    [],
                    "No claim is supported by another; there is no argument."
                ),
            }
        )
        expect(result.stageOutcomes[STAGE_IDS.conclusionSelection]).toBe(
            "completed"
        )
        expect(result.output?.conclusionMiniId).toBeNull()
        const failure = noConclusionFailure(result) as
            | { stage: string; severity: string; message: string }
            | undefined
        expect(failure).toBeDefined()
        expect(failure?.stage).toBe(STAGE_IDS.conclusionSelection)
        expect(failure?.severity).toBe("warning")
        expect(failure?.message).toBe(
            "No claim is supported by another; there is no argument."
        )
    })

    it("falls back to a canned message when the rationale is empty", async () => {
        const pipeline = buildStandalonePipeline(
            makeClassifications([["c1", "normal"]]),
            { relations: [] }
        )
        const result = await executePipeline(
            pipeline,
            { text: "x" },
            { llm: llmReturning([], "") }
        )
        const failure = noConclusionFailure(result) as
            | { message: string }
            | undefined
        expect(failure?.message).toBe("No single conclusion could be selected.")
    })
})

describe("selectFallbackConclusion (exported helper)", () => {
    it("picks the pure-sink normal claim with the highest in-degree", () => {
        const classifications = [
            { miniId: "c1", type: "normal" as const, sourceString: null },
            { miniId: "c2", type: "normal" as const, sourceString: null },
            { miniId: "c3", type: "normal" as const, sourceString: null },
        ]
        const relations = [
            {
                relationId: "r1",
                type: "support" as const,
                sources: ["c1"],
                target: "c3",
                evidence: { segmentIds: [], quote: "" },
            },
            {
                relationId: "r2",
                type: "support" as const,
                sources: ["c2"],
                target: "c3",
                evidence: { segmentIds: [], quote: "" },
            },
        ]
        expect(selectFallbackConclusion(classifications, relations)).toBe("c3")
    })

    it("returns null when there are no relations", () => {
        expect(selectFallbackConclusion([], [])).toBeNull()
    })
})
