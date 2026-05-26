// Unit tests for `conclusion-selection` — the wrapper that surfaces
// `NO_SINGLE_CONCLUSION` as a `ProcessingFailure` whenever the LLM
// returns `{ conclusionMiniId: null }` (spec §7.2 row 10). The
// happy-path round trip + the spec-aligned dep wiring are covered by
// `llm-stages.test.ts`; this file focuses on the wrapper's
// addFailure-on-null contract added during lambda-fold 1.

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
    type TConclusionSelectionOutput,
    type TRelationExtractionOutput,
} from "../../../../src/extensions/argument-ingestion/stages/index.js"
import {
    CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
    conclusionSelectionStage,
} from "../../../../src/extensions/argument-ingestion/stages/conclusion-selection.js"
import { claimTypeClassificationStage } from "../../../../src/extensions/argument-ingestion/stages/claim-type-classification.js"
import { relationExtractionStage } from "../../../../src/extensions/argument-ingestion/stages/relation-extraction.js"
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

describe("conclusionSelectionStage — failure emission", () => {
    it("emits NO_SINGLE_CONCLUSION when LLM returns conclusionMiniId: null", async () => {
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.conclusionSelection]: [
                    {
                        kind: "ok",
                        output: {
                            conclusionMiniId: null,
                            rationale:
                                "Two terminals c2 and c3 are equally plausible.",
                        } satisfies TConclusionSelectionOutput,
                    },
                ],
            },
        })
        const pipeline = buildStandalonePipeline(
            { classifications: [] },
            { relations: [] }
        )
        const result = await executePipeline(pipeline, { text: "x" }, { llm })
        // Stage itself completes (the wrapped stage returns the null
        // output unchanged; the failure is an informational side-channel).
        expect(result.stageOutcomes[STAGE_IDS.conclusionSelection]).toBe(
            "completed"
        )
        const failure = result.failures.find(
            (f) => f.code === CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE
        )
        expect(failure).toBeDefined()
        expect(failure?.stage).toBe(STAGE_IDS.conclusionSelection)
        expect(failure?.severity).toBe("warning")
        // The LLM's rationale is propagated into the failure message.
        expect(failure?.message).toBe(
            "Two terminals c2 and c3 are equally plausible."
        )
        expect(failure?.context?.rationale).toBe(
            "Two terminals c2 and c3 are equally plausible."
        )
    })

    it("falls back to a canned message when the LLM's rationale is empty", async () => {
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.conclusionSelection]: [
                    {
                        kind: "ok",
                        output: {
                            conclusionMiniId: null,
                            rationale: "",
                        } satisfies TConclusionSelectionOutput,
                    },
                ],
            },
        })
        const pipeline = buildStandalonePipeline(
            { classifications: [] },
            { relations: [] }
        )
        const result = await executePipeline(pipeline, { text: "x" }, { llm })
        const failure = result.failures.find(
            (f) => f.code === CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE
        )
        expect(failure?.message).toBe("No single conclusion could be selected.")
    })

    it("does NOT emit NO_SINGLE_CONCLUSION on a successful conclusion pick", async () => {
        const llm = createMockLlmProvider({
            responses: {
                [STAGE_IDS.conclusionSelection]: [
                    {
                        kind: "ok",
                        output: {
                            conclusionMiniId: "c3",
                            rationale: "c3 is the only terminal.",
                        } satisfies TConclusionSelectionOutput,
                    },
                ],
            },
        })
        const pipeline = buildStandalonePipeline(
            { classifications: [] },
            { relations: [] }
        )
        const result = await executePipeline(pipeline, { text: "x" }, { llm })
        const failure = result.failures.find(
            (f) => f.code === CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE
        )
        expect(failure).toBeUndefined()
    })
})
