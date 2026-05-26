// Regression test: every v2 LLM-stage outputSchema must (a) convert
// successfully via `typeboxToOpenAiSchema` and (b) produce a converted
// JSON Schema whose root is `{ "type": "object" }`. Both invariants
// come from concrete OpenAI 400 responses observed during fixture
// recording.
//
// Lambda-fold 1 (`Type.Tuple` → `SpanSchema { start, end }`):
//   The converter threw `UnsupportedSchemaError: "Tuple"` synchronously
//   at request-build time. `llmStage` classified it as
//   `LLM_NON_RETRYABLE_ERROR` (no `retryReason` tag), `segmentation`
//   failed after retry exhaustion, every downstream stage with a
//   required dep on `segmentation` cascade-skipped, and `finalize`
//   returned `output: null` in ~9 ms total per fixture with zero LLM
//   calls landing.
//
// Lambda-fold 3 (array-rooted → object-envelope outputSchemas):
//   With the converter no longer throwing, the v2 stages reached the
//   real OpenAI Responses API — which then returned 400
//   `invalid_json_schema`: "schema must be a JSON Schema of
//   'type: object', got 'type: array'". `classifyHttpError(400)`
//   returns `NonRetryableLlmError` (no `retryReason`), so the same
//   stage-failed → cascade-skip → output-null chain repeated, only
//   slower (84-926 ms per fixture because real HTTP roundtrips). Fix:
//   wrap each of the 5 originally-array-rooted LLM stage schemas in a
//   single-key envelope (`segments`, `mentions`, `sources`, `axioms`,
//   `relations`).
//
// This test pins both invariants so future stages can't reintroduce
// either class of bug at fixture-recording time.

import { describe, expect, it } from "vitest"
import type { TSchema } from "typebox"
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

// Table-driven test: every v2 LLM-stage outputSchema. Adding a new
// LLM stage means appending one row here; both invariants are then
// pinned automatically. Deterministic stage outputSchemas
// (`variable-assignment`, `claim-reference-validation`,
// `formula-validation`) are intentionally absent — they never reach
// the OpenAI converter, so neither invariant applies.
function llmStageSchemas(): [name: string, schema: TSchema][] {
    const canonicalizationStage =
        createClaimCanonicalizationStage(basicsExtension)
    return [
        ["segmentation", SegmentationOutputSchema],
        ["claim-mention-extraction", ClaimMentionExtractionOutputSchema],
        ["citation-source-detection", CitationSourceDetectionOutputSchema],
        ["axiom-indicator-detection", AxiomIndicatorDetectionOutputSchema],
        ["claim-canonicalization (basics)", canonicalizationStage.outputSchema],
        ["claim-type-classification", ClaimTypeClassificationOutputSchema],
        ["relation-extraction", RelationExtractionOutputSchema],
        ["conclusion-selection", ConclusionSelectionOutputSchema],
    ]
}

describe("v2 LLM stages — outputSchema OpenAI-converter round trip", () => {
    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: typeboxToOpenAiSchema converts without throwing`, () => {
            expect(() => typeboxToOpenAiSchema(schema)).not.toThrow()
        })
    }
})

describe("v2 LLM stages — converted root must be type:object", () => {
    // Pins the lambda-fold 3 invariant: the OpenAI Responses-API
    // strict-mode `text.format.schema` field requires a `type: object`
    // root. Wrap each natural array shape in a single-key envelope so
    // the converted schema's root is the envelope's `object` rather
    // than the inner `array`.
    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: converted root is { type: "object" }`, () => {
            const converted = typeboxToOpenAiSchema(schema) as {
                type?: unknown
            }
            expect(converted.type).toBe("object")
        })
    }
})
