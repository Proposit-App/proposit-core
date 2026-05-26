// Unit tests for `createIngestionV2Pipeline`.
//
// Covers:
//   - The factory constructs a pipeline whose DAG validates at
//     executor build time (no cycles, no unknown deps, no self-deps,
//     no duplicate ids).
//   - Pipeline declares 12 stages with the spec-aligned ids.
//   - `finalize.dependsOn` declares the spec-aligned required +
//     optional deps.
//   - With a fully-mocked LLM, the pipeline produces a coherent
//     argument response (the happy path).
//   - With `conclusion-selection` returning `{conclusionMiniId: null}`,
//     the response is `argument: null` + `failureText: "No single
//     conclusion could be selected."` (spec §7.5).
//   - With `claim-canonicalization` returning empty `canonicalClaims`,
//     the response is `argument: null` + `failureText: "No claims
//     could be extracted from the input."`.

import { describe, expect, it } from "vitest"
import {
    basicsExtension,
    createIngestionV2Pipeline,
    executePipeline,
} from "../../../src/lib/index.js"
import {
    STAGE_IDS,
    type TAxiomIndicatorDetectionOutput,
    type TCitationSourceDetectionOutput,
    type TClaimCanonicalizationOutput,
    type TClaimMentionExtractionOutput,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
} from "../../../src/extensions/argument-ingestion/stages/index.js"
import { createMockLlmProvider } from "../../mocks/llm.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"

describe("createIngestionV2Pipeline — shape", () => {
    it("constructs a pipeline with 12 stages + the spec-aligned ids", () => {
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        expect(pipeline.stages).toHaveLength(12)
        const ids = pipeline.stages.map((s) => s.id).sort()
        expect(ids).toEqual(
            [
                STAGE_IDS.segmentation,
                STAGE_IDS.claimMentionExtraction,
                STAGE_IDS.citationSourceDetection,
                STAGE_IDS.axiomIndicatorDetection,
                STAGE_IDS.claimCanonicalization,
                STAGE_IDS.claimTypeClassification,
                STAGE_IDS.claimReferenceValidation,
                STAGE_IDS.variableAssignment,
                STAGE_IDS.relationExtraction,
                STAGE_IDS.conclusionSelection,
                STAGE_IDS.formulaCompilation,
                STAGE_IDS.formulaValidation,
            ].sort()
        )
    })

    it("declares the spec-aligned finalize.dependsOn (3 required + 5 optional)", () => {
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        const required = pipeline.finalize.dependsOn
            .filter((d) => typeof d === "string")
            .map((d) => d)
            .sort()
        const optionalDeps = pipeline.finalize.dependsOn
            .filter((d) => typeof d !== "string")
            .map((d) => (d as { id: string }).id)
            .sort()
        expect(required).toEqual(
            [
                STAGE_IDS.claimCanonicalization,
                STAGE_IDS.variableAssignment,
                STAGE_IDS.formulaCompilation,
            ].sort()
        )
        expect(optionalDeps).toEqual(
            [
                STAGE_IDS.claimTypeClassification,
                STAGE_IDS.relationExtraction,
                STAGE_IDS.conclusionSelection,
                STAGE_IDS.formulaValidation,
                STAGE_IDS.claimReferenceValidation,
            ].sort()
        )
    })

    it("validates the DAG at executor build time (no thrown PipelineConfigurationError)", async () => {
        // Construct + immediately try to execute against a never-
        // satisfied mock (the executor build is the load-bearing
        // check — if any stage's deps don't resolve, the executor
        // throws *before* any stage runs). Pre-empt the LLM-call
        // failures by feeding a happy queue to every stage.
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        const llm = createMockLlmProvider({
            responses: {},
            keyByCallOrder: false,
        })
        // We expect failures (the mock has no canned responses), but
        // we should NOT get a PipelineConfigurationError.
        const promise = executePipeline(pipeline, { text: "a" }, { llm })
        await expect(promise).resolves.toBeDefined()
    })
})

// -- Happy-path end-to-end with a fully-mocked LLM ---------------------

/**
 * Build a fully-canned LLM provider for a 3-claim "rain → wet ground"
 * argument. Returns a happy-path response for every LLM stage.
 */
function buildHappyMockResponses(): Record<
    string,
    { kind: "ok"; output: unknown }[]
> {
    const segmentation: TSegmentationOutput = [
        {
            segmentId: "s1",
            text: "If it rains, ground gets wet.",
            span: [0, 29],
        },
        { segmentId: "s2", text: "It is raining.", span: [30, 44] },
        {
            segmentId: "s3",
            text: "Therefore, the ground is wet.",
            span: [45, 74],
        },
    ]
    const mentions: TClaimMentionExtractionOutput = [
        {
            mentionId: "m1",
            segmentId: "s1",
            text: "If it rains, ground gets wet.",
            span: [0, 29],
        },
        {
            mentionId: "m2",
            segmentId: "s2",
            text: "It is raining.",
            span: [0, 14],
        },
        {
            mentionId: "m3",
            segmentId: "s3",
            text: "the ground is wet",
            span: [11, 28],
        },
    ]
    const citations: TCitationSourceDetectionOutput = []
    const axioms: TAxiomIndicatorDetectionOutput = []

    const canonicalization: TClaimCanonicalizationOutput = {
        canonicalClaims: [
            {
                miniId: "c1",
                mentionIds: ["m1"],
                suggestedSymbol: "Rain_Wet",
                type: "normal",
                // basics-extension fields:
                ...({
                    title: "Rain implies wet",
                    body: "If it rains, ground gets wet.",
                } as Record<string, unknown>),
            },
            {
                miniId: "c2",
                mentionIds: ["m2"],
                suggestedSymbol: "Raining",
                type: "normal",
                ...({
                    title: "It is raining",
                    body: "It is raining.",
                } as Record<string, unknown>),
            },
            {
                miniId: "c3",
                mentionIds: ["m3"],
                suggestedSymbol: "Wet",
                type: "normal",
                ...({
                    title: "Ground is wet",
                    body: "The ground is wet.",
                } as Record<string, unknown>),
            },
        ],
        mentionToClaim: { m1: "c1", m2: "c2", m3: "c3" },
    }

    const typeMap: TClaimTypeClassificationOutput = {
        c1: { type: "normal", sourceString: null },
        c2: { type: "normal", sourceString: null },
        c3: { type: "normal", sourceString: null },
    }

    const relations: TRelationExtractionOutput = [
        {
            relationId: "r1",
            type: "joint-support",
            sources: ["c1", "c2"],
            target: "c3",
            evidence: { segmentIds: ["s3"], quote: "Therefore" },
        },
    ]

    const selection: TConclusionSelectionOutput = {
        conclusionMiniId: "c3",
        rationale: "c3 is the only terminal of the support graph.",
    }

    return {
        [STAGE_IDS.segmentation]: [{ kind: "ok", output: segmentation }],
        [STAGE_IDS.claimMentionExtraction]: [{ kind: "ok", output: mentions }],
        [STAGE_IDS.citationSourceDetection]: [
            { kind: "ok", output: citations },
        ],
        [STAGE_IDS.axiomIndicatorDetection]: [{ kind: "ok", output: axioms }],
        [STAGE_IDS.claimCanonicalization]: [
            { kind: "ok", output: canonicalization },
        ],
        [STAGE_IDS.claimTypeClassification]: [{ kind: "ok", output: typeMap }],
        [STAGE_IDS.relationExtraction]: [{ kind: "ok", output: relations }],
        [STAGE_IDS.conclusionSelection]: [{ kind: "ok", output: selection }],
    }
}

describe("createIngestionV2Pipeline — happy path", () => {
    it("produces a coherent argument from a happy-path mock chain", async () => {
        const llm = createMockLlmProvider({
            responses: buildHappyMockResponses(),
        })
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            {
                text: "If it rains, ground gets wet. It is raining. Therefore, the ground is wet.",
            },
            { llm }
        )
        expect(result.failures).toEqual([])
        expect(result.output).not.toBeNull()
        const out = result.output as TParsedArgumentResponse & {
            processingFailures: unknown[]
        }
        expect(out.argument).not.toBeNull()
        expect(out.failureText).toBeNull()
        const argument = out.argument as Record<string, unknown>

        const claims = argument.claims as Record<string, unknown>[]
        expect(claims).toHaveLength(3)
        expect(claims.find((c) => c.miniId === "c3")?.role).toBe("conclusion")
        expect(claims.find((c) => c.miniId === "c1")?.role).toBe("premise")
        expect(claims.find((c) => c.miniId === "c2")?.role).toBe("premise")

        const variables = argument.variables as Record<string, unknown>[]
        expect(variables).toHaveLength(3)
        // suggestedSymbol passed through as the variable's `symbol`.
        expect(variables.map((v) => v.symbol).sort()).toEqual(
            ["Rain_Wet", "Raining", "Wet"].sort()
        )

        const premises = argument.premises as Record<string, unknown>[]
        expect(premises).toHaveLength(2) // one joint-support + one conclusion
        const conclusionPremiseId = argument.conclusionPremiseMiniId as string
        const conclusionPremise = premises.find(
            (p) => p.miniId === conclusionPremiseId
        )!
        expect(conclusionPremise.formula).toBe("Wet")
        const relationPremise = premises.find(
            (p) => p.miniId !== conclusionPremiseId
        )!
        // Joint support: (Rain_Wet and Raining) implies Wet
        expect(relationPremise.formula).toBe(
            "(Rain_Wet and Raining) implies Wet"
        )

        expect(out.selectionRationale).toBe(
            "c3 is the only terminal of the support graph."
        )
        expect(out.processingFailures).toEqual([])
    })
})

describe("createIngestionV2Pipeline — failure paths", () => {
    it("emits `argument: null` + 'No single conclusion could be selected.' when conclusion-selection returns null", async () => {
        const responses = buildHappyMockResponses()
        responses[STAGE_IDS.conclusionSelection] = [
            {
                kind: "ok",
                output: {
                    conclusionMiniId: null,
                    rationale: "Multiple terminals.",
                } satisfies TConclusionSelectionOutput,
            },
        ]
        const llm = createMockLlmProvider({ responses })
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            { text: "A. B. C." },
            { llm }
        )
        expect(result.output).not.toBeNull()
        const out = result.output!
        expect(out.argument).toBeNull()
        expect(out.failureText).toBe("No single conclusion could be selected.")
    })

    it("emits `argument: null` + 'No claims could be extracted from the input.' when canonicalization returns empty claims", async () => {
        const responses = buildHappyMockResponses()
        responses[STAGE_IDS.claimCanonicalization] = [
            {
                kind: "ok",
                output: {
                    canonicalClaims: [],
                    mentionToClaim: {},
                } satisfies TClaimCanonicalizationOutput,
            },
        ]
        // The downstream stages will all run against an empty
        // canonical set; we still need to feed them something
        // schema-conformant.
        responses[STAGE_IDS.claimTypeClassification] = [
            { kind: "ok", output: {} },
        ]
        responses[STAGE_IDS.relationExtraction] = [{ kind: "ok", output: [] }]
        responses[STAGE_IDS.conclusionSelection] = [
            {
                kind: "ok",
                output: {
                    conclusionMiniId: null,
                    rationale: "No claims to choose from.",
                },
            },
        ]
        const llm = createMockLlmProvider({ responses })
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            { text: "Empty." },
            { llm }
        )
        const out = result.output!
        expect(out.argument).toBeNull()
        expect(out.failureText).toBe(
            "No claims could be extracted from the input."
        )
    })
})
