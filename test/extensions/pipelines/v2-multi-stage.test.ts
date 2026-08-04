// Unit tests for `createScholarPipeline`.
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
//   - With no claim supported by any relation (so the conclusion
//     fallback has no terminal candidate to pick), the response is
//     `argument: null` + `failureText: "No single conclusion could be
//     selected."`.
//   - With `claim-canonicalization` returning empty `canonicalClaims`,
//     the response is `argument: null` + `failureText: "No claims
//     could be extracted from the input."`.

import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import { executePipeline } from "../../../src/lib/index.js"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/scholar.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/basics-extension.js"
import {
    STAGE_IDS,
    SegmentationOutputSchema,
    ClaimMentionExtractionOutputSchema,
    CitationSourceDetectionOutputSchema,
    AxiomIndicatorDetectionOutputSchema,
    ClaimCanonicalizationOutputSchema,
    ClaimTypeClassificationOutputSchema,
    VariableAssignmentOutputSchema,
    RelationExtractionOutputSchema,
    ConclusionSelectionOutputSchema,
    FormulaCompilationOutputSchema,
    ValidationStageOutputSchema,
    type TAxiomIndicatorDetectionOutput,
    type TCitationSourceDetectionOutput,
    type TClaimCanonicalizationOutput,
    type TClaimMentionExtractionOutput,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionLlmOutput,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
} from "../../../src/extensions/pipelines/base/stages/index.js"
import { createMockLlmProvider } from "../../mocks/llm.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"

describe("createScholarPipeline — shape", () => {
    it("constructs a pipeline with 12 stages + the spec-aligned ids", () => {
        const pipeline = createScholarPipeline(basicsExtension)
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

    it("declares the spec-aligned finalize.dependsOn (3 required + 7 optional)", () => {
        const pipeline = createScholarPipeline(basicsExtension)
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
                // Read by finalize only to anchor claims back to the
                // input text.
                STAGE_IDS.segmentation,
                STAGE_IDS.claimMentionExtraction,
            ].sort()
        )
    })

    it("validates the DAG at executor build time (no thrown PipelineConfigurationError)", async () => {
        // Construct + immediately try to execute against a never-
        // satisfied mock (the executor build is the load-bearing
        // check — if any stage's deps don't resolve, the executor
        // throws *before* any stage runs). Pre-empt the LLM-call
        // failures by feeding a happy queue to every stage.
        const pipeline = createScholarPipeline(basicsExtension)
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
    const segmentation: TSegmentationOutput = {
        segments: [
            {
                segmentId: "s1",
                text: "If it rains, ground gets wet.",
                span: { start: 0, end: 29 },
            },
            {
                segmentId: "s2",
                text: "It is raining.",
                span: { start: 30, end: 44 },
            },
            {
                segmentId: "s3",
                text: "Therefore, the ground is wet.",
                span: { start: 45, end: 74 },
            },
        ],
    }
    const mentions: TClaimMentionExtractionOutput = {
        mentions: [
            {
                mentionId: "m1",
                segmentId: "s1",
                text: "If it rains, ground gets wet.",
                span: { start: 0, end: 29 },
            },
            {
                mentionId: "m2",
                segmentId: "s2",
                text: "It is raining.",
                span: { start: 0, end: 14 },
            },
            {
                mentionId: "m3",
                segmentId: "s3",
                text: "the ground is wet",
                span: { start: 11, end: 28 },
            },
        ],
    }
    const citations: TCitationSourceDetectionOutput = { sources: [] }
    const axioms: TAxiomIndicatorDetectionOutput = { axioms: [] }

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
        mentionToClaim: [
            { mentionId: "m1", claimMiniId: "c1" },
            { mentionId: "m2", claimMiniId: "c2" },
            { mentionId: "m3", claimMiniId: "c3" },
        ],
    }

    const typeMap: TClaimTypeClassificationOutput = {
        classifications: [
            { miniId: "c1", type: "normal", sourceString: null },
            { miniId: "c2", type: "normal", sourceString: null },
            { miniId: "c3", type: "normal", sourceString: null },
        ],
    }

    const relations: TRelationExtractionOutput = {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents: ["c1", "c2"],
                consequent: "c3",
                title: "",
                evidence: { segmentIds: ["s3"], quote: "Therefore" },
            },
        ],
    }

    const selection: TConclusionSelectionLlmOutput = {
        conclusionCandidates: ["c3"],
        title: "",
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

describe("createScholarPipeline — happy path", () => {
    it("produces a coherent argument from a happy-path mock chain", async () => {
        const llm = createMockLlmProvider({
            responses: buildHappyMockResponses(),
        })
        const pipeline = createScholarPipeline(basicsExtension)
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

describe("createScholarPipeline — failure paths", () => {
    it("emits `argument: null` + 'No single conclusion could be selected.' when no claim is supported by a relation", async () => {
        const responses = buildHappyMockResponses()
        // No support relations → nothing is terminal → the conclusion
        // fallback has no candidate, so the pipeline reports the genuine
        // no-conclusion outcome rather than auto-picking one.
        responses[STAGE_IDS.relationExtraction] = [
            {
                kind: "ok",
                output: { relations: [] } satisfies TRelationExtractionOutput,
            },
        ]
        responses[STAGE_IDS.conclusionSelection] = [
            {
                kind: "ok",
                output: {
                    conclusionCandidates: [],
                    title: "",
                    rationale: "Multiple terminals.",
                } satisfies TConclusionSelectionLlmOutput,
            },
        ]
        const llm = createMockLlmProvider({ responses })
        const pipeline = createScholarPipeline(basicsExtension)
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
                    mentionToClaim: [],
                } satisfies TClaimCanonicalizationOutput,
            },
        ]
        // The downstream stages will all run against an empty
        // canonical set; we still need to feed them something
        // schema-conformant.
        responses[STAGE_IDS.claimTypeClassification] = [
            { kind: "ok", output: { classifications: [] } },
        ]
        responses[STAGE_IDS.relationExtraction] = [
            { kind: "ok", output: { relations: [] } },
        ]
        responses[STAGE_IDS.conclusionSelection] = [
            {
                kind: "ok",
                output: {
                    conclusionCandidates: [],
                    title: "",
                    rationale: "No claims to choose from.",
                },
            },
        ]
        const llm = createMockLlmProvider({ responses })
        const pipeline = createScholarPipeline(basicsExtension)
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

// The serialize/rehydrate contract for the durable single-stage /
// single-finalize execution model rests on every stage output (and the
// pipeline's finalize output) being JSON round-trippable: a value persisted
// as jsonb and read back must deep-equal the original. This pins the
// "JSON serializable" half of the contract for the whole rehydration
// surface — all 12 v2 stage outputs plus a finalize output. It is a VALUE
// round-trip (`JSON.parse(JSON.stringify(v))` deep-equals `v`), NOT a
// schema→JSON→schema check: the finalize output schema is intentionally
// `additionalProperties: true`, so a schema-level round-trip would be
// inaccurate. (For the stage schemas we additionally assert the round-
// tripped value still satisfies the schema.)

describe("v2 stage + finalize outputs are JSON round-trippable", () => {
    const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v))

    // One representative, schema-conformant value per stage output. Two
    // stages (claim-reference-validation, formula-validation) share
    // ValidationStageOutputSchema; both are represented.
    const stageOutputFixtures: readonly {
        stageId: string
        schema: TSchema
        value: unknown
    }[] = [
        {
            stageId: STAGE_IDS.segmentation,
            schema: SegmentationOutputSchema,
            value: {
                segments: [
                    {
                        segmentId: "s1",
                        text: "All men are mortal.",
                        span: { start: 0, end: 19 },
                    },
                ],
            } satisfies TSegmentationOutput,
        },
        {
            stageId: STAGE_IDS.claimMentionExtraction,
            schema: ClaimMentionExtractionOutputSchema,
            value: {
                mentions: [
                    {
                        mentionId: "m1",
                        segmentId: "s1",
                        text: "men are mortal",
                        span: { start: 4, end: 18 },
                    },
                ],
            } satisfies TClaimMentionExtractionOutput,
        },
        {
            stageId: STAGE_IDS.citationSourceDetection,
            schema: CitationSourceDetectionOutputSchema,
            value: {
                sources: [
                    {
                        sourceId: "src1",
                        segmentIds: ["s1"],
                        sourceString: "Aristotle, Prior Analytics",
                        url: null,
                        spans: [{ start: 0, end: 5 }],
                    },
                ],
            } satisfies TCitationSourceDetectionOutput,
        },
        {
            stageId: STAGE_IDS.axiomIndicatorDetection,
            schema: AxiomIndicatorDetectionOutputSchema,
            value: {
                axioms: [
                    {
                        axiomId: "ax1",
                        segmentIds: ["s1"],
                        indicator: "by definition",
                        spans: [{ start: 0, end: 13 }],
                    },
                ],
            } satisfies TAxiomIndicatorDetectionOutput,
        },
        {
            stageId: STAGE_IDS.claimCanonicalization,
            schema: ClaimCanonicalizationOutputSchema,
            value: {
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: ["m1"],
                        suggestedSymbol: "men_mortal",
                        type: "normal",
                    },
                ],
                mentionToClaim: [{ mentionId: "m1", claimMiniId: "c1" }],
            } satisfies TClaimCanonicalizationOutput,
        },
        {
            stageId: STAGE_IDS.claimTypeClassification,
            schema: ClaimTypeClassificationOutputSchema,
            value: {
                classifications: [
                    { miniId: "c1", type: "normal", sourceString: null },
                ],
            } satisfies TClaimTypeClassificationOutput,
        },
        {
            stageId: STAGE_IDS.claimReferenceValidation,
            schema: ValidationStageOutputSchema,
            value: [
                {
                    code: "REF_OK",
                    message: "all references resolve",
                    context: { checked: 3 },
                },
            ],
        },
        {
            stageId: STAGE_IDS.variableAssignment,
            schema: VariableAssignmentOutputSchema,
            value: [{ miniId: "v1", symbol: "P", claimMiniId: "c1" }],
        },
        {
            stageId: STAGE_IDS.relationExtraction,
            schema: RelationExtractionOutputSchema,
            value: {
                relations: [
                    {
                        relationId: "r1",
                        type: "inference",
                        antecedents: ["c1"],
                        consequent: "c2",
                        title: "",
                        evidence: { segmentIds: ["s1"], quote: "therefore" },
                    },
                ],
            } satisfies TRelationExtractionOutput,
        },
        {
            stageId: STAGE_IDS.conclusionSelection,
            schema: ConclusionSelectionOutputSchema,
            value: {
                conclusionMiniId: "c2",
                conclusionCandidates: ["c2", "c3"],
                title: "",
                rationale: "c2 is terminal in the support graph.",
            },
        },
        {
            stageId: STAGE_IDS.formulaCompilation,
            schema: FormulaCompilationOutputSchema,
            value: {
                premises: [
                    {
                        premiseMiniId: "c1",
                        formula: "P",
                        roleHint: "freeform",
                        sourceRelationId: "r1",
                    },
                    {
                        premiseMiniId: "c2",
                        formula: "Q",
                        roleHint: "conclusion",
                        sourceRelationId: null,
                    },
                ],
                conclusionPremiseMiniId: "c2",
                derivationBacking: [],
            },
        },
        {
            stageId: STAGE_IDS.formulaValidation,
            schema: ValidationStageOutputSchema,
            value: [{ code: "FORMULA_OK", message: "all formulas parse" }],
        },
    ]

    it("covers all 12 scholar stages", () => {
        const covered = stageOutputFixtures.map((f) => f.stageId).sort()
        // `STAGE_IDS` also carries the two scribe-only stage ids
        // (`extract`, `scribe-structure`); those have no scholar-stage
        // output fixture, so exclude them from the coverage check.
        const scholarStageIds = Object.values(STAGE_IDS)
            .filter(
                (id) =>
                    id !== STAGE_IDS.extract && id !== STAGE_IDS.scribeStructure
            )
            .sort()
        expect(covered).toEqual(scholarStageIds)
    })

    for (const fixture of stageOutputFixtures) {
        it(`stage output round-trips through JSON: ${fixture.stageId}`, () => {
            const after = roundTrip(fixture.value)
            expect(after).toEqual(fixture.value)
            // The round-tripped value still satisfies the stage's schema.
            expect(Value.Check(fixture.schema, after)).toBe(true)
        })
    }

    it("finalize output (the pipeline output value) round-trips through JSON", async () => {
        // Produce a real finalize output via a happy whole-run, then
        // assert the value round-trips. The finalize outputSchema is
        // additionalProperties:true, so this is a value round-trip only.
        const llm = createMockLlmProvider({
            responses: buildHappyMockResponses(),
        })
        const pipeline = createScholarPipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            {
                text: "All men are mortal. Socrates is a man. Therefore Socrates is mortal.",
            },
            { llm }
        )
        expect(result.output).not.toBeNull()
        const finalizeOutput = result.output!
        expect(roundTrip(finalizeOutput)).toEqual(finalizeOutput)
    })
})
