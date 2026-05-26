// Regression test: every v2 LLM-stage outputSchema must convert
// successfully via `typeboxToOpenAiSchema`. Added after the
// recording-mode bug surfaced — all 5 fixtures failed in ~9ms because
// `Type.Tuple` (used in segmentation / mention / citation / axiom
// schemas for `span: [start, end]`) is not supported by the OpenAI
// strict-mode JSON Schema converter; the conversion throw came from
// `typeboxToOpenAiSchema` synchronously at request-build time, the
// `llmStage` retry loop classified it as `LLM_NON_RETRYABLE_ERROR`
// (no `retryReason` tag on `UnsupportedSchemaError`), `segmentation`
// failed after exhausting attempts, and every downstream stage with
// a required dep on `segmentation` cascade-skipped. The executor's
// `finalizeRequiredOk()` then returned false on `claim-canonicalization`
// being `skipped`, so `output: null` came back with zero successful
// LLM calls.
//
// Fix: v2 stage schemas use a named-key `SpanSchema` (`{ start, end }`)
// instead of `Type.Tuple([Number, Number])`. The named-key form stays
// in the converter's supported subset and is also more LLM-friendly.
//
// This test asserts each v2 LLM stage's `outputSchema` survives the
// converter so the same class of bug fails at unit-test time rather
// than during fixture recording.

import { describe, expect, it } from "vitest"
import { typeboxToOpenAiSchema } from "../../../../src/extensions/openai/structured-output.js"
import {
    AxiomIndicatorDetectionOutputSchema,
    CitationSourceDetectionOutputSchema,
    ClaimMentionExtractionOutputSchema,
    ClaimTypeClassificationOutputSchema,
    ConclusionSelectionOutputSchema,
    RelationExtractionOutputSchema,
    SegmentationOutputSchema,
} from "../../../../src/extensions/argument-ingestion/stages/schemas.js"
import { createClaimCanonicalizationStage } from "../../../../src/extensions/argument-ingestion/stages/claim-canonicalization.js"
import { basicsExtension } from "../../../../src/extensions/argument-ingestion/shared/basics-extension.js"

describe("v2 LLM stages — outputSchema OpenAI-converter round trip", () => {
    it("converts SegmentationOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(SegmentationOutputSchema)
        ).not.toThrow()
    })

    it("converts ClaimMentionExtractionOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(ClaimMentionExtractionOutputSchema)
        ).not.toThrow()
    })

    it("converts CitationSourceDetectionOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(CitationSourceDetectionOutputSchema)
        ).not.toThrow()
    })

    it("converts AxiomIndicatorDetectionOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(AxiomIndicatorDetectionOutputSchema)
        ).not.toThrow()
    })

    it("converts ClaimTypeClassificationOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(ClaimTypeClassificationOutputSchema)
        ).not.toThrow()
    })

    it("converts RelationExtractionOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(RelationExtractionOutputSchema)
        ).not.toThrow()
    })

    it("converts ConclusionSelectionOutputSchema without throwing", () => {
        expect(() =>
            typeboxToOpenAiSchema(ConclusionSelectionOutputSchema)
        ).not.toThrow()
    })

    it("converts the basics-extension claim-canonicalization outputSchema without throwing", () => {
        const stage = createClaimCanonicalizationStage(basicsExtension)
        expect(() => typeboxToOpenAiSchema(stage.outputSchema)).not.toThrow()
    })
})
