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
import { createMockLlmProvider, makeTransientError } from "../../mocks/llm.js"
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

    it("threads a `model` override: pipeline-default and per-stage both win over the internal default", () => {
        // Internal default carries the stage's hard-coded model const.
        const internal = { model: "gpt-5.4-mini", maxOutputTokens: 100 }
        // Pipeline default overrides the model.
        expect(
            resolveLlmStageOptions(STAGE_IDS.segmentation, internal, {
                defaults: { model: "qwen3.6:latest" },
            })
        ).toEqual({ model: "qwen3.6:latest", maxOutputTokens: 100 })
        // Per-stage override beats the pipeline default.
        expect(
            resolveLlmStageOptions(STAGE_IDS.segmentation, internal, {
                defaults: { model: "qwen3.6:latest" },
                overrides: {
                    [STAGE_IDS.segmentation]: { model: "llama3:latest" },
                },
            })
        ).toEqual({ model: "llama3:latest", maxOutputTokens: 100 })
    })

    it("threads a `retry` override: pipeline-default and per-stage both win over the internal default (straight pass-through, no DEFAULT_RETRY_POLICY merge)", () => {
        // Internal default carries no retry knob (stages don't ship a
        // per-stage retry default).
        const internal = { model: "gpt-5.4-mini" }
        // Pipeline default sets the retry override; resolver forwards it
        // verbatim (the merge against DEFAULT_RETRY_POLICY is llmStage's
        // job, not the resolver's).
        expect(
            resolveLlmStageOptions(STAGE_IDS.segmentation, internal, {
                defaults: { retry: { retryOn: ["schema_validation"] } },
            })
        ).toEqual({
            model: "gpt-5.4-mini",
            retry: { retryOn: ["schema_validation"] },
        })
        // Per-stage override beats the pipeline default — last-writer-wins
        // on the whole `retry` object, identical to the scalar knobs.
        expect(
            resolveLlmStageOptions(STAGE_IDS.segmentation, internal, {
                defaults: { retry: { retryOn: ["schema_validation"] } },
                overrides: {
                    [STAGE_IDS.segmentation]: { retry: { maxAttempts: 3 } },
                },
            })
        ).toEqual({
            model: "gpt-5.4-mini",
            retry: { maxAttempts: 3 },
        })
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
    model: string
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
                model: req.model,
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

    it("ships segmentation with its hard-coded model const when no override given (default unchanged)", async () => {
        const segOutput = {
            segments: [
                { segmentId: "s1", text: "Hi.", span: { start: 0, end: 3 } },
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
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        await executePipeline(pipeline, { text: "Hi." }, { llm: provider })
        const segRec = records.find((r) => r.stageId === STAGE_IDS.segmentation)
        expect(segRec).toBeDefined()
        expect(segRec!.model).toBe("gpt-5.4-mini")
    })

    it("REGRESSION (P1 #2): a `model` override actually REACHES the built llmStage request", async () => {
        // Guards the silent-no-op regression: the resolver computing the
        // right model but no stage factory reading it. Build a v2
        // pipeline with a pipeline-level model default and assert the
        // segmentation request carries the override, not the const.
        const segOutput = {
            segments: [
                { segmentId: "s1", text: "Hi.", span: { start: 0, end: 3 } },
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
            llm: { defaults: { model: "qwen3.6:latest" } },
        })
        await executePipeline(pipeline, { text: "Hi." }, { llm: provider })
        const segRec = records.find((r) => r.stageId === STAGE_IDS.segmentation)
        expect(segRec).toBeDefined()
        expect(segRec!.model).toBe("qwen3.6:latest")
    })

    it("per-stage `model` override beats the pipeline default and reaches the request", async () => {
        const segOutput = {
            segments: [
                { segmentId: "s1", text: "Hi.", span: { start: 0, end: 3 } },
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
                defaults: { model: "qwen3.6:latest" },
                overrides: {
                    [STAGE_IDS.segmentation]: { model: "llama3:latest" },
                },
            },
        })
        await executePipeline(pipeline, { text: "Hi." }, { llm: provider })
        const segRec = records.find((r) => r.stageId === STAGE_IDS.segmentation)
        expect(segRec).toBeDefined()
        expect(segRec!.model).toBe("llama3:latest")
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

// -- retry-policy override threading (serves server slice C2) -----------
//
// C2's "no-auto-retry" toggle drops `"transient"` from a stage's
// `retryOn`. These tests exercise the real C2 path: a caller sets
// `llm.overrides[stageId].retry` on `createIngestionV2Pipeline`, and we
// assert the override reaches the stage's retry policy by observing
// retry behavior against the mock provider. We count only the
// segmentation stage's calls (it is the root stage, so it always runs
// first regardless of downstream stages failing for lack of canned
// responses).

describe("createIngestionV2Pipeline — retry-policy override threading (C2)", () => {
    const goodSeg = {
        segments: [
            { segmentId: "s1", text: "Hi.", span: { start: 0, end: 3 } },
        ],
    }

    it("a retry override dropping 'transient' makes a transient error fail-fast (no retry)", async () => {
        let segCalls = 0
        const mock = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [
                    { kind: "error", error: makeTransientError("boom") },
                    // Queued but must NOT be consumed — proves no retry.
                    { kind: "ok", output: goodSeg },
                ],
            },
            onCall: (rec) => {
                if (rec.stageId === STAGE_IDS.segmentation) segCalls += 1
            },
        })
        const pipeline = createIngestionV2Pipeline(basicsExtension, {
            llm: {
                overrides: {
                    [STAGE_IDS.segmentation]: {
                        retry: { retryOn: ["schema_validation"], backoffMs: 0 },
                    },
                },
            },
        })
        const result = await executePipeline(
            pipeline,
            { text: "Hi." },
            { llm: mock }
        )
        // `transient` is no longer in retryOn → the transient error stops
        // at the retryOn gate after exactly one call.
        expect(segCalls).toBe(1)
        expect(result.stageOutcomes[STAGE_IDS.segmentation]).toBe("failed")
    })

    it("the same retry override STILL retries a schema_validation failure once", async () => {
        let segCalls = 0
        const mock = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [
                    {
                        kind: "schema-invalid",
                        output: { segments: "not-an-array" },
                    },
                    { kind: "ok", output: goodSeg },
                ],
            },
            onCall: (rec) => {
                if (rec.stageId === STAGE_IDS.segmentation) segCalls += 1
            },
        })
        const pipeline = createIngestionV2Pipeline(basicsExtension, {
            llm: {
                overrides: {
                    [STAGE_IDS.segmentation]: {
                        retry: { retryOn: ["schema_validation"], backoffMs: 0 },
                    },
                },
            },
        })
        const result = await executePipeline(
            pipeline,
            { text: "Hi." },
            { llm: mock }
        )
        // `schema_validation` is still in retryOn → one retry fires and
        // the second (valid) response lands.
        expect(segCalls).toBe(2)
        expect(result.stageOutcomes[STAGE_IDS.segmentation]).toBe("completed")
    })

    it("default policy (no retry override) retries a transient error once", async () => {
        let segCalls = 0
        const mock = createMockLlmProvider({
            responses: {
                [STAGE_IDS.segmentation]: [
                    { kind: "error", error: makeTransientError("boom") },
                    { kind: "ok", output: goodSeg },
                ],
            },
            onCall: (rec) => {
                if (rec.stageId === STAGE_IDS.segmentation) segCalls += 1
            },
        })
        const pipeline = createIngestionV2Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            { text: "Hi." },
            { llm: mock }
        )
        // DEFAULT_RETRY_POLICY.retryOn includes "transient" → retried.
        expect(segCalls).toBe(2)
        expect(result.stageOutcomes[STAGE_IDS.segmentation]).toBe("completed")
    })
})
