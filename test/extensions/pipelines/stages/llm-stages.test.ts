// Unit tests for the 8 LLM stages of the v2 multi-stage ingestion
// pipeline. We use the in-repo mock LlmProvider to assert each stage:
//   1. Declares the expected id + deps.
//   2. Builds a prompt that interpolates upstream context (we run the
//      stage through `executePipeline` with seeded upstream outputs).
//   3. Returns the parsed output shape on a canned ok response.
//
// Schema-validation retry + transient retry are exercised by the
// framework-level tests in `test/pipelines.test.ts`; we do not
// re-prove that machinery here.

import { describe, expect, it } from "vitest"
import Type from "typebox"
import {
    deterministicStage,
    executePipeline,
} from "../../../../src/lib/pipelines/index.js"
import type { TPipeline } from "../../../../src/lib/pipelines/index.js"
import {
    STAGE_IDS,
    segmentationStage,
    claimMentionExtractionStage,
    citationSourceDetectionStage,
    axiomIndicatorDetectionStage,
    createClaimCanonicalizationStage,
    claimTypeClassificationStage,
    relationExtractionStage,
    conclusionSelectionStage,
} from "../../../../src/extensions/pipelines/base/stages/index.js"
import { basicsExtension } from "../../../../src/extensions/pipelines/base/basics-extension.js"
import { createMockLlmProvider } from "../../../mocks/llm.js"
import type {
    TAxiomIndicatorDetectionOutput,
    TCitationSourceDetectionOutput,
    TClaimCanonicalizationOutput,
    TClaimMentionExtractionOutput,
    TClaimTypeClassificationOutput,
    TConclusionSelectionLlmOutput,
    TConclusionSelectionOutput,
    TRelationExtractionOutput,
    TSegmentationOutput,
} from "../../../../src/extensions/pipelines/base/stages/schemas.js"

const INPUT_SCHEMA = Type.Object({ text: Type.String() })

type TPipelineInput = { text: string }

// Per-test, we inline a standalone pipeline shape: a `deterministicStage`
// seeds each upstream output the stage under test reads, then the
// pipeline's `finalize` returns the stage's output verbatim. This
// mirrors how the real v2 pipeline will run each stage and exercises
// the executor's DAG validator on each `dependsOn` declaration.

describe("segmentationStage", () => {
    it("declares the right id + empty deps", () => {
        expect(segmentationStage.id).toBe(STAGE_IDS.segmentation)
        expect(segmentationStage.dependsOn).toEqual([])
    })

    it("returns the LLM's segmentation output verbatim", async () => {
        const happy: TSegmentationOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "It rains.",
                    span: { start: 0, end: 9 },
                },
                {
                    segmentId: "s2",
                    text: "Ground is wet.",
                    span: { start: 10, end: 24 },
                },
            ],
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [{ kind: "ok", output: happy }],
            },
        })
        const pipeline: TPipeline<TPipelineInput, TSegmentationOutput> = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: segmentationStage.outputSchema,
            stages: [segmentationStage],
            finalize: {
                dependsOn: [STAGE_IDS.segmentation],
                run: (ctx) =>
                    ctx.get<TSegmentationOutput>(STAGE_IDS.segmentation) ?? {
                        segments: [],
                    },
            },
        }
        const result = await executePipeline(
            pipeline,
            { text: "It rains. Ground is wet." },
            { llm }
        )
        expect(result.output).toEqual(happy)
    })
})

describe("claimMentionExtractionStage", () => {
    it("declares the right id + deps", () => {
        expect(claimMentionExtractionStage.id).toBe(
            STAGE_IDS.claimMentionExtraction
        )
        expect(claimMentionExtractionStage.dependsOn).toEqual([
            STAGE_IDS.segmentation,
        ])
    })

    it("interpolates segments into the user prompt + returns mock output", async () => {
        const segments: TSegmentationOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "It rains.",
                    span: { start: 0, end: 9 },
                },
            ],
        }
        const mentions: TClaimMentionExtractionOutput = {
            mentions: [
                {
                    mentionId: "m1",
                    segmentId: "s1",
                    text: "It rains.",
                    span: { start: 0, end: 9 },
                },
            ],
        }
        const calls: { systemPrompt: string; userMessage: string }[] = []
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.claimMentionExtraction]: [
                    { kind: "ok", output: mentions },
                ],
            },
            onCall: (rec) =>
                calls.push({
                    systemPrompt: rec.systemPrompt,
                    userMessage: rec.userMessage,
                }),
        })
        const seedStage = deterministicStage<TSegmentationOutput>({
            id: STAGE_IDS.segmentation,
            dependsOn: [],
            outputSchema: segmentationStage.outputSchema,
            fn: () => segments,
        })
        const pipeline: TPipeline<
            TPipelineInput,
            TClaimMentionExtractionOutput
        > = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: claimMentionExtractionStage.outputSchema,
            stages: [seedStage, claimMentionExtractionStage],
            finalize: {
                dependsOn: [STAGE_IDS.claimMentionExtraction],
                run: (ctx) =>
                    ctx.get<TClaimMentionExtractionOutput>(
                        STAGE_IDS.claimMentionExtraction
                    ) ?? { mentions: [] },
            },
        }
        const result = await executePipeline(
            pipeline,
            { text: "It rains." },
            { llm }
        )
        expect(result.output).toEqual(mentions)
        expect(calls[0].userMessage).toContain("[s1]")
        expect(calls[0].userMessage).toContain('"It rains."')
    })
})

describe("citationSourceDetectionStage", () => {
    it("declares the right id + deps", () => {
        expect(citationSourceDetectionStage.id).toBe(
            STAGE_IDS.citationSourceDetection
        )
        expect(citationSourceDetectionStage.dependsOn).toEqual([
            STAGE_IDS.segmentation,
        ])
    })

    it("returns the LLM's citation output", async () => {
        const segments: TSegmentationOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "According to NASA.",
                    span: { start: 0, end: 18 },
                },
            ],
        }
        const sources: TCitationSourceDetectionOutput = {
            sources: [
                {
                    sourceId: "src1",
                    segmentIds: ["s1"],
                    sourceString: "NASA",
                    url: null,
                    spans: [{ start: 13, end: 17 }],
                },
            ],
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.citationSourceDetection]: [
                    { kind: "ok", output: sources },
                ],
            },
        })
        const seed = deterministicStage<TSegmentationOutput>({
            id: STAGE_IDS.segmentation,
            dependsOn: [],
            outputSchema: segmentationStage.outputSchema,
            fn: () => segments,
        })
        const pipeline: TPipeline<
            TPipelineInput,
            TCitationSourceDetectionOutput
        > = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: citationSourceDetectionStage.outputSchema,
            stages: [seed, citationSourceDetectionStage],
            finalize: {
                dependsOn: [STAGE_IDS.citationSourceDetection],
                run: (ctx) =>
                    ctx.get<TCitationSourceDetectionOutput>(
                        STAGE_IDS.citationSourceDetection
                    ) ?? { sources: [] },
            },
        }
        const result = await executePipeline(
            pipeline,
            { text: "According to NASA." },
            { llm }
        )
        expect(result.output).toEqual(sources)
    })
})

describe("axiomIndicatorDetectionStage", () => {
    it("declares the right id + deps", () => {
        expect(axiomIndicatorDetectionStage.id).toBe(
            STAGE_IDS.axiomIndicatorDetection
        )
        expect(axiomIndicatorDetectionStage.dependsOn).toEqual([
            STAGE_IDS.segmentation,
        ])
    })

    it("returns the LLM's axiom-indicator output", async () => {
        const segments: TSegmentationOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "By definition, a bachelor is unmarried.",
                    span: { start: 0, end: 39 },
                },
            ],
        }
        const axioms: TAxiomIndicatorDetectionOutput = {
            axioms: [
                {
                    axiomId: "ax1",
                    segmentIds: ["s1"],
                    indicator: "By definition",
                    spans: [{ start: 0, end: 13 }],
                },
            ],
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.axiomIndicatorDetection]: [
                    { kind: "ok", output: axioms },
                ],
            },
        })
        const seed = deterministicStage<TSegmentationOutput>({
            id: STAGE_IDS.segmentation,
            dependsOn: [],
            outputSchema: segmentationStage.outputSchema,
            fn: () => segments,
        })
        const pipeline: TPipeline<
            TPipelineInput,
            TAxiomIndicatorDetectionOutput
        > = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: axiomIndicatorDetectionStage.outputSchema,
            stages: [seed, axiomIndicatorDetectionStage],
            finalize: {
                dependsOn: [STAGE_IDS.axiomIndicatorDetection],
                run: (ctx) =>
                    ctx.get<TAxiomIndicatorDetectionOutput>(
                        STAGE_IDS.axiomIndicatorDetection
                    ) ?? { axioms: [] },
            },
        }
        const result = await executePipeline(pipeline, { text: "x" }, { llm })
        expect(result.output).toEqual(axioms)
    })
})

describe("createClaimCanonicalizationStage", () => {
    it("declares the right id + deps (claim-mention required, citation+axiom optional)", () => {
        const stage = createClaimCanonicalizationStage(basicsExtension)
        expect(stage.id).toBe(STAGE_IDS.claimCanonicalization)
        const depIds = stage.dependsOn.map((d) =>
            typeof d === "string" ? d : d.id
        )
        expect(depIds).toContain(STAGE_IDS.claimMentionExtraction)
        expect(depIds).toContain(STAGE_IDS.citationSourceDetection)
        expect(depIds).toContain(STAGE_IDS.axiomIndicatorDetection)
    })

    it("returns the LLM's canonicalization output", async () => {
        const stage = createClaimCanonicalizationStage(basicsExtension)
        const mentions: TClaimMentionExtractionOutput = {
            mentions: [
                {
                    mentionId: "m1",
                    segmentId: "s1",
                    text: "P",
                    span: { start: 0, end: 1 },
                },
                {
                    mentionId: "m2",
                    segmentId: "s2",
                    text: "Q",
                    span: { start: 0, end: 1 },
                },
            ],
        }
        const canon: TClaimCanonicalizationOutput = {
            canonicalClaims: [
                {
                    miniId: "c1",
                    mentionIds: ["m1"],
                    suggestedSymbol: "P",
                    type: "normal",
                    // Extension fields for the normal-typed branch:
                    ...({ title: "Claim P", body: "P is asserted." } as Record<
                        string,
                        unknown
                    >),
                },
                {
                    miniId: "c2",
                    mentionIds: ["m2"],
                    suggestedSymbol: "Q",
                    type: "normal",
                    ...({ title: "Claim Q", body: "Q is asserted." } as Record<
                        string,
                        unknown
                    >),
                },
            ],
            mentionToClaim: [
                { mentionId: "m1", claimMiniId: "c1" },
                { mentionId: "m2", claimMiniId: "c2" },
            ],
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.claimCanonicalization]: [
                    { kind: "ok", output: canon },
                ],
            },
        })
        const mentionSeed = deterministicStage<TClaimMentionExtractionOutput>({
            id: STAGE_IDS.claimMentionExtraction,
            dependsOn: [],
            outputSchema: claimMentionExtractionStage.outputSchema,
            fn: () => mentions,
        })
        // The optional deps (citation/axiom) still need a stage with
        // the matching id to exist on the pipeline for the executor's
        // DAG validator; we seed empty stubs.
        const citationSeed = deterministicStage<TCitationSourceDetectionOutput>(
            {
                id: STAGE_IDS.citationSourceDetection,
                dependsOn: [],
                outputSchema: citationSourceDetectionStage.outputSchema,
                fn: () => ({ sources: [] }),
            }
        )
        const axiomSeed = deterministicStage<TAxiomIndicatorDetectionOutput>({
            id: STAGE_IDS.axiomIndicatorDetection,
            dependsOn: [],
            outputSchema: axiomIndicatorDetectionStage.outputSchema,
            fn: () => ({ axioms: [] }),
        })
        const pipeline: TPipeline<
            TPipelineInput,
            TClaimCanonicalizationOutput
        > = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: stage.outputSchema,
            stages: [mentionSeed, citationSeed, axiomSeed, stage],
            finalize: {
                dependsOn: [STAGE_IDS.claimCanonicalization],
                run: (ctx) =>
                    ctx.get<TClaimCanonicalizationOutput>(
                        STAGE_IDS.claimCanonicalization
                    )!,
            },
        }
        const result = await executePipeline(
            pipeline,
            { text: "P. Q." },
            { llm }
        )
        expect(result.output).toEqual(canon)
    })
})

describe("claimTypeClassificationStage", () => {
    it("declares the right id + deps (canonicalization required, citations+axioms optional)", () => {
        expect(claimTypeClassificationStage.id).toBe(
            STAGE_IDS.claimTypeClassification
        )
        const depIds = claimTypeClassificationStage.dependsOn.map((d) =>
            typeof d === "string" ? d : d.id
        )
        expect(depIds).toContain(STAGE_IDS.claimCanonicalization)
        expect(depIds).toContain(STAGE_IDS.citationSourceDetection)
        expect(depIds).toContain(STAGE_IDS.axiomIndicatorDetection)
    })

    it("returns the LLM's type-classification output", async () => {
        const canon: TClaimCanonicalizationOutput = {
            canonicalClaims: [
                {
                    miniId: "c1",
                    mentionIds: ["m1"],
                    suggestedSymbol: "P",
                    type: "normal",
                },
            ],
            mentionToClaim: [{ mentionId: "m1", claimMiniId: "c1" }],
        }
        const typeMap: TClaimTypeClassificationOutput = {
            classifications: [
                { miniId: "c1", type: "normal", sourceString: null },
            ],
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.claimTypeClassification]: [
                    { kind: "ok", output: typeMap },
                ],
            },
        })
        const canonSeed = deterministicStage<TClaimCanonicalizationOutput>({
            id: STAGE_IDS.claimCanonicalization,
            dependsOn: [],
            outputSchema: Type.Any(),
            fn: () => canon,
        })
        const citationSeed = deterministicStage<TCitationSourceDetectionOutput>(
            {
                id: STAGE_IDS.citationSourceDetection,
                dependsOn: [],
                outputSchema: citationSourceDetectionStage.outputSchema,
                fn: () => ({ sources: [] }),
            }
        )
        const axiomSeed = deterministicStage<TAxiomIndicatorDetectionOutput>({
            id: STAGE_IDS.axiomIndicatorDetection,
            dependsOn: [],
            outputSchema: axiomIndicatorDetectionStage.outputSchema,
            fn: () => ({ axioms: [] }),
        })
        const pipeline: TPipeline<
            TPipelineInput,
            TClaimTypeClassificationOutput
        > = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: claimTypeClassificationStage.outputSchema,
            stages: [
                canonSeed,
                citationSeed,
                axiomSeed,
                claimTypeClassificationStage,
            ],
            finalize: {
                dependsOn: [STAGE_IDS.claimTypeClassification],
                run: (ctx) =>
                    ctx.get<TClaimTypeClassificationOutput>(
                        STAGE_IDS.claimTypeClassification
                    )!,
            },
        }
        const result = await executePipeline(pipeline, { text: "P." }, { llm })
        expect(result.output).toEqual(typeMap)
    })
})

describe("relationExtractionStage", () => {
    it("declares the right id + required deps", () => {
        expect(relationExtractionStage.id).toBe(STAGE_IDS.relationExtraction)
        const depIds = relationExtractionStage.dependsOn.map((d) =>
            typeof d === "string" ? d : d.id
        )
        expect(depIds).toContain(STAGE_IDS.claimCanonicalization)
        expect(depIds).toContain(STAGE_IDS.claimTypeClassification)
        expect(depIds).toContain(STAGE_IDS.segmentation)
    })

    it("returns the LLM's relation output", async () => {
        const segments: TSegmentationOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "P, therefore Q.",
                    span: { start: 0, end: 14 },
                },
            ],
        }
        const canon: TClaimCanonicalizationOutput = {
            canonicalClaims: [
                {
                    miniId: "c1",
                    mentionIds: ["m1"],
                    suggestedSymbol: "P",
                    type: "normal",
                },
                {
                    miniId: "c2",
                    mentionIds: ["m2"],
                    suggestedSymbol: "Q",
                    type: "normal",
                },
            ],
            mentionToClaim: [
                { mentionId: "m1", claimMiniId: "c1" },
                { mentionId: "m2", claimMiniId: "c2" },
            ],
        }
        const typeMap: TClaimTypeClassificationOutput = {
            classifications: [
                { miniId: "c1", type: "normal", sourceString: null },
                { miniId: "c2", type: "normal", sourceString: null },
            ],
        }
        const relations: TRelationExtractionOutput = {
            relations: [
                {
                    relationId: "r1",
                    type: "inference",
                    antecedents: ["c1"],
                    consequent: "c2",
                    evidence: { segmentIds: ["s1"], quote: "therefore" },
                },
            ],
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.relationExtraction]: [
                    { kind: "ok", output: relations },
                ],
            },
        })
        const segSeed = deterministicStage<TSegmentationOutput>({
            id: STAGE_IDS.segmentation,
            dependsOn: [],
            outputSchema: segmentationStage.outputSchema,
            fn: () => segments,
        })
        const canonSeed = deterministicStage<TClaimCanonicalizationOutput>({
            id: STAGE_IDS.claimCanonicalization,
            dependsOn: [],
            outputSchema: Type.Any(),
            fn: () => canon,
        })
        const typeSeed = deterministicStage<TClaimTypeClassificationOutput>({
            id: STAGE_IDS.claimTypeClassification,
            dependsOn: [],
            outputSchema: claimTypeClassificationStage.outputSchema,
            fn: () => typeMap,
        })
        const pipeline: TPipeline<TPipelineInput, TRelationExtractionOutput> = {
            id: "test",
            version: "1.0.0",
            inputSchema: INPUT_SCHEMA,
            outputSchema: relationExtractionStage.outputSchema,
            stages: [segSeed, canonSeed, typeSeed, relationExtractionStage],
            finalize: {
                dependsOn: [STAGE_IDS.relationExtraction],
                run: (ctx) =>
                    ctx.get<TRelationExtractionOutput>(
                        STAGE_IDS.relationExtraction
                    )!,
            },
        }
        const result = await executePipeline(
            pipeline,
            { text: "P, therefore Q." },
            { llm }
        )
        expect(result.output).toEqual(relations)
    })
})

describe("conclusionSelectionStage", () => {
    it("declares the right id + deps", () => {
        expect(conclusionSelectionStage.id).toBe(STAGE_IDS.conclusionSelection)
        const depIds = conclusionSelectionStage.dependsOn.map((d) =>
            typeof d === "string" ? d : d.id
        )
        expect(depIds).toContain(STAGE_IDS.claimTypeClassification)
        expect(depIds).toContain(STAGE_IDS.relationExtraction)
    })

    it("returns the LLM's conclusion selection output", async () => {
        const typeMap: TClaimTypeClassificationOutput = {
            classifications: [
                { miniId: "c1", type: "normal", sourceString: null },
                { miniId: "c2", type: "normal", sourceString: null },
            ],
        }
        const relations: TRelationExtractionOutput = {
            relations: [
                {
                    relationId: "r1",
                    type: "inference",
                    antecedents: ["c1"],
                    consequent: "c2",
                    evidence: { segmentIds: ["s1"], quote: "therefore" },
                },
            ],
        }
        const llmOutput: TConclusionSelectionLlmOutput = {
            conclusionCandidates: ["c2"],
            rationale: "c2 is the only terminal of the support graph.",
        }
        const selection: TConclusionSelectionOutput = {
            conclusionMiniId: "c2",
            conclusionCandidates: ["c2"],
            rationale: "c2 is the only terminal of the support graph.",
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.conclusionSelection]: [
                    { kind: "ok", output: llmOutput },
                ],
            },
        })
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
        const pipeline: TPipeline<TPipelineInput, TConclusionSelectionOutput> =
            {
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
        const result = await executePipeline(pipeline, { text: "x" }, { llm })
        expect(result.output).toEqual(selection)
    })

    it("can return a null conclusionMiniId", async () => {
        const llmOutput: TConclusionSelectionLlmOutput = {
            conclusionCandidates: [],
            rationale: "Multiple candidates.",
        }
        const selection: TConclusionSelectionOutput = {
            conclusionMiniId: null,
            conclusionCandidates: [],
            rationale: "Multiple candidates.",
        }
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.conclusionSelection]: [
                    { kind: "ok", output: llmOutput },
                ],
            },
        })
        const typeSeed = deterministicStage<TClaimTypeClassificationOutput>({
            id: STAGE_IDS.claimTypeClassification,
            dependsOn: [],
            outputSchema: claimTypeClassificationStage.outputSchema,
            fn: () => ({ classifications: [] }),
        })
        const relSeed = deterministicStage<TRelationExtractionOutput>({
            id: STAGE_IDS.relationExtraction,
            dependsOn: [],
            outputSchema: relationExtractionStage.outputSchema,
            fn: () => ({ relations: [] }),
        })
        const pipeline: TPipeline<TPipelineInput, TConclusionSelectionOutput> =
            {
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
        const result = await executePipeline(pipeline, { text: "x" }, { llm })
        expect(result.output).toEqual(selection)
    })
})
