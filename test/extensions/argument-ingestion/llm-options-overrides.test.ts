// Unit tests for the v1.3.1 caller-configurable LLM-options surface
// on `createIngestionV1Pipeline` + `createIngestionV2Pipeline`.
//
// The surface lets a caller override `maxOutputTokens` and
// `reasoningEffort` at two layers: a pipeline-level `defaults` plus
// per-stage `overrides` keyed by stage id. Precedence is
// stage-override > pipeline-default > internal stage default.
//
// The original bug this surface unblocks: v1.3.0 shipped
// `segmentation` without a `maxOutputTokens` cap, so a 15 KB input
// hit the OpenAI Responses API default mid-string and returned
// `status: "incomplete"` with partial JSON. v1.3.1 sets a generous
// default (`SEGMENTATION_MAX_OUTPUT_TOKENS = 8192`) AND exposes the
// override surface so callers ingesting even larger inputs can dial
// the cap up further without forking the stage.

import { describe, expect, it } from "vitest"
import Type from "typebox"
import {
    basicsExtension,
    createIngestionV1Pipeline,
    createIngestionV2Pipeline,
    executePipeline,
    resolveLlmStageOptions,
    V1_PARSE_STAGE_ID,
} from "../../../src/lib/index.js"
import { STAGE_IDS } from "../../../src/extensions/argument-ingestion/stages/index.js"
import {
    SEGMENTATION_MAX_OUTPUT_TOKENS,
    SEGMENTATION_STAGE_DEFAULTS,
} from "../../../src/extensions/argument-ingestion/stages/segmentation.js"
import { createMockLlmProvider } from "../../mocks/llm.js"
import type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
} from "../../../src/lib/llm/types.js"

describe("resolveLlmStageOptions — precedence", () => {
    it("falls back to the internal default when no caller options supplied", () => {
        const resolved = resolveLlmStageOptions(
            STAGE_IDS.segmentation,
            { maxOutputTokens: 100, reasoningEffort: "low" },
            undefined
        )
        expect(resolved).toEqual({
            maxOutputTokens: 100,
            reasoningEffort: "low",
        })
    })

    it("pipeline-default overrides the internal default", () => {
        const resolved = resolveLlmStageOptions(
            STAGE_IDS.segmentation,
            { maxOutputTokens: 100, reasoningEffort: "low" },
            { defaults: { maxOutputTokens: 200 } }
        )
        expect(resolved).toEqual({
            maxOutputTokens: 200,
            reasoningEffort: "low", // unchanged — pipeline-default didn't set this knob
        })
    })

    it("per-stage override beats pipeline-default and internal default", () => {
        const resolved = resolveLlmStageOptions(
            STAGE_IDS.segmentation,
            { maxOutputTokens: 100, reasoningEffort: "low" },
            {
                defaults: { maxOutputTokens: 200 },
                overrides: {
                    [STAGE_IDS.segmentation]: {
                        maxOutputTokens: 999,
                        reasoningEffort: "high",
                    },
                },
            }
        )
        expect(resolved).toEqual({
            maxOutputTokens: 999,
            reasoningEffort: "high",
        })
    })

    it("per-stage entry for a different stage id does not bleed across", () => {
        const resolved = resolveLlmStageOptions(
            STAGE_IDS.segmentation,
            { maxOutputTokens: 100 },
            {
                overrides: {
                    [STAGE_IDS.relationExtraction]: { maxOutputTokens: 999 },
                },
            }
        )
        expect(resolved).toEqual({ maxOutputTokens: 100 })
    })
})

// -- request-introspection provider -------------------------------------
//
// To prove the factory threads overrides all the way through to the
// LLM request, we wrap a real mock provider with a tiny recording
// shim that captures the `TLlmRequest` for every call. The mock
// returns canned outputs; the recorder lets us assert on the
// `maxOutputTokens` + `reasoningEffort` actually requested.

type TRecordedRequest = {
    stageId: string | null
    maxOutputTokens?: number
    reasoningEffort?: string
}

function recordingProvider(args: {
    underlying: TLlmProvider
    onRecord: (rec: TRecordedRequest) => void
}): TLlmProvider {
    const STAGE_ID_MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/
    return {
        async respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>> {
            const match = STAGE_ID_MARKER.exec(req.systemPrompt)
            args.onRecord({
                stageId: match ? match[1] : null,
                maxOutputTokens: req.maxOutputTokens,
                reasoningEffort: req.reasoningEffort,
            })
            return args.underlying.respond(req)
        },
    }
}

describe("createIngestionV2Pipeline — LLM-options threading", () => {
    it("ships segmentation with the internal default cap when no overrides given", async () => {
        // Schema for segmentation seed — we just need any valid one
        // for the mock; the LLM call assertion is the load-bearing
        // piece.
        const segOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "Hi.",
                    span: { start: 0, end: 3 },
                },
            ],
        }
        const mock = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [{ kind: "ok", output: segOutput }],
            },
        })
        const records: TRecordedRequest[] = []
        const provider = recordingProvider({
            underlying: mock,
            onRecord: (r) => records.push(r),
        })

        // Build a pipeline but only schedule segmentation by aborting
        // before downstream stages run — simpler: we reuse
        // createIngestionV2Pipeline and feed only a segmentation
        // response. Downstream stages will fail/skip and that's OK;
        // we're only asserting on the segmentation request.
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        await executePipeline(pipeline, { text: "Hi." }, { llm: provider })

        const segRec = records.find((r) => r.stageId === STAGE_IDS.segmentation)
        expect(segRec).toBeDefined()
        expect(segRec!.maxOutputTokens).toBe(SEGMENTATION_MAX_OUTPUT_TOKENS)
    })

    it("threads a pipeline-level default through every LLM stage that doesn't override it", async () => {
        const segOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "Hi.",
                    span: { start: 0, end: 3 },
                },
            ],
        }
        const mock = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [{ kind: "ok", output: segOutput }],
            },
        })
        const records: TRecordedRequest[] = []
        const provider = recordingProvider({
            underlying: mock,
            onRecord: (r) => records.push(r),
        })

        const pipeline = createIngestionV2Pipeline(basicsExtension, {
            llm: { defaults: { maxOutputTokens: 16_384 } },
        })
        await executePipeline(pipeline, { text: "Hi." }, { llm: provider })

        const segRec = records.find((r) => r.stageId === STAGE_IDS.segmentation)
        expect(segRec).toBeDefined()
        // Pipeline default beats segmentation's internal default cap.
        expect(segRec!.maxOutputTokens).toBe(16_384)
    })

    it("per-stage override beats both internal default and pipeline default", async () => {
        const segOutput = {
            segments: [
                {
                    segmentId: "s1",
                    text: "Hi.",
                    span: { start: 0, end: 3 },
                },
            ],
        }
        const mock = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [{ kind: "ok", output: segOutput }],
            },
        })
        const records: TRecordedRequest[] = []
        const provider = recordingProvider({
            underlying: mock,
            onRecord: (r) => records.push(r),
        })

        const pipeline = createIngestionV2Pipeline(basicsExtension, {
            llm: {
                defaults: { maxOutputTokens: 16_384 },
                overrides: {
                    [STAGE_IDS.segmentation]: { maxOutputTokens: 32_768 },
                },
            },
        })
        await executePipeline(pipeline, { text: "Hi." }, { llm: provider })

        const segRec = records.find((r) => r.stageId === STAGE_IDS.segmentation)
        expect(segRec).toBeDefined()
        expect(segRec!.maxOutputTokens).toBe(32_768)
    })

    it("preserves the canonicalization stage's internal reasoningEffort when no override given", () => {
        // The shipped `claim-canonicalization` stage has an internal
        // `reasoningEffort: "medium"`. Verify the override mechanism
        // preserves it.
        expect(SEGMENTATION_STAGE_DEFAULTS).toBeDefined()
        const resolved = resolveLlmStageOptions(
            STAGE_IDS.claimCanonicalization,
            { reasoningEffort: "medium" },
            undefined
        )
        expect(resolved.reasoningEffort).toBe("medium")
    })
})

describe("createIngestionV1Pipeline — LLM-options threading", () => {
    it("threads maxOutputTokens through the single parse-argument stage", async () => {
        // v1's single stage uses `extension.responseSchema` as its
        // outputSchema. We build a tiny extension stub and a mock
        // that responds to the V1_PARSE_STAGE_ID stage marker.
        const tinyResponseSchema = Type.Object({
            failures: Type.Optional(Type.Array(Type.Unknown())),
            argument: Type.Optional(Type.Null()),
        })
        const tinyExtension = {
            responseSchema: tinyResponseSchema,
            claimSchema: Type.Object({}),
            variableSchema: Type.Object({}),
            premiseSchema: Type.Object({}),
            argumentSchema: Type.Object({}),
        }
        const mock = createMockLlmProvider({
            responses: {
                [V1_PARSE_STAGE_ID]: [
                    { kind: "ok", output: { argument: null } },
                ],
            },
        })
        const records: TRecordedRequest[] = []
        const provider = recordingProvider({
            underlying: mock,
            onRecord: (r) => records.push(r),
        })

        const pipeline = createIngestionV1Pipeline(tinyExtension, {
            llm: {
                overrides: {
                    [V1_PARSE_STAGE_ID]: { maxOutputTokens: 4096 },
                },
            },
        })
        await executePipeline(pipeline, { text: "x" }, { llm: provider })

        const rec = records.find((r) => r.stageId === V1_PARSE_STAGE_ID)
        expect(rec).toBeDefined()
        expect(rec!.maxOutputTokens).toBe(4096)
    })
})
