// Framework unit tests for src/lib/pipelines.
//
// Coverage areas (one describe block each):
//
//   1. DAG validation at entry
//   2. Concurrency
//   3. Failure propagation
//   4. Schema validation
//   5. Retry
//   6. Token usage aggregation
//   7. Cancellation
//   8. Pipeline events
//   9. Finalize semantics
//   10. subPipelineStage smoke test
//
// All tests run against the mock LlmProvider in test/mocks/llm.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import Type from "typebox"
import { Value } from "typebox/value"
import { Settings } from "typebox/system"
import {
    DEFAULT_RETRY_POLICY,
    LLM_QUOTA_EXHAUSTED,
    LlmStageRetryExhaustedError,
    PipelineConfigurationError,
    QuotaExhaustedLlmError,
    StageAbortedError,
    SubPipelineFailedError,
    deterministicStage,
    executeFinalize,
    executePipeline,
    executeStage,
    llmStage,
    optional,
    subPipelineStage,
} from "../src/lib/index.js"
import type {
    TPipeline,
    TPipelineEvent,
    TStage,
    TStageContext,
    TStageOutcomeRecord,
} from "../src/lib/index.js"
import {
    createMockLlmProvider,
    makeQuotaError,
    makeRateLimitError,
    makeTransientError,
} from "./mocks/llm.js"

// ---------------- helpers ----------------

function emptyInputSchema() {
    return Type.Object({})
}

function passthroughStage<TOutput>(args: {
    id: string
    dependsOn?: readonly (string | ReturnType<typeof optional>)[]
    output: TOutput
    outputSchema: import("typebox").TSchema
}): TStage<TOutput> {
    return deterministicStage({
        id: args.id,
        dependsOn: args.dependsOn ?? [],
        outputSchema: args.outputSchema,
        fn: () => args.output,
    })
}

function buildPipeline<TOutput>(args: {
    id?: string
    stages: readonly TStage<unknown>[]
    finalize: TPipeline<unknown, TOutput>["finalize"]
    outputSchema?: import("typebox").TSchema
}): TPipeline<unknown, TOutput> {
    return {
        id: args.id ?? "test-pipeline",
        version: "0.0.0",
        inputSchema: emptyInputSchema(),
        outputSchema: args.outputSchema ?? Type.Any(),
        stages: args.stages,
        finalize: args.finalize,
    }
}

function emptyMockLlm() {
    return createMockLlmProvider({ responses: {} })
}

// ---------------- 1. DAG validation ----------------

describe("executePipeline — DAG validation", () => {
    it("throws DAG_CYCLE when a cycle exists, before any stage runs", async () => {
        const visited: string[] = []
        const a: TStage<number> = deterministicStage({
            id: "a",
            dependsOn: ["b"],
            outputSchema: Type.Number(),
            fn: () => {
                visited.push("a")
                return 1
            },
        })
        const b: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => {
                visited.push("b")
                return 2
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: ["a"],
                run: (ctx) => ctx.get<number>("a") ?? 0,
            },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "DAG_CYCLE",
        })
        expect(visited).toEqual([])
    })

    it("throws UNKNOWN_DEP when a stage depends on a missing stage", async () => {
        const a: TStage<number> = deterministicStage({
            id: "a",
            dependsOn: ["nonexistent"],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: { dependsOn: ["a"], run: () => 0 },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "UNKNOWN_DEP",
        })
    })

    it("throws SELF_DEP when a stage depends on itself", async () => {
        const a: TStage<number> = deterministicStage({
            id: "a",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: { dependsOn: ["a"], run: () => 0 },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "SELF_DEP",
        })
    })

    it("throws UNKNOWN_DEP when finalize references a non-existent stage", async () => {
        const a: TStage<number> = passthroughStage({
            id: "a",
            output: 1,
            outputSchema: Type.Number(),
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: { dependsOn: ["nope"], run: () => 0 },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "UNKNOWN_DEP",
        })
    })

    it("throws when input fails inputSchema validation", async () => {
        const pipeline: TPipeline<unknown, number> = {
            id: "schema-pipe",
            version: "0",
            inputSchema: Type.Object({ x: Type.Number() }),
            outputSchema: Type.Number(),
            stages: [],
            finalize: { dependsOn: [], run: () => 0 },
        }
        await expect(
            executePipeline(
                pipeline,
                { x: "not-a-number" },
                { llm: emptyMockLlm() }
            )
        ).rejects.toThrow()
    })
})

// ---------------- 2. Concurrency ----------------

describe("executePipeline — concurrency", () => {
    it("runs two independent stages overlapping in time", async () => {
        const records: { stage: string; phase: "start" | "end"; at: number }[] =
            []
        const makeStage = (id: string): TStage<number> =>
            deterministicStage({
                id,
                dependsOn: [],
                outputSchema: Type.Number(),
                fn: async () => {
                    records.push({
                        stage: id,
                        phase: "start",
                        at: performance.now(),
                    })
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 50)
                    )
                    records.push({
                        stage: id,
                        phase: "end",
                        at: performance.now(),
                    })
                    return 1
                },
            })

        const pipeline = buildPipeline<number>({
            stages: [makeStage("a"), makeStage("b")],
            finalize: {
                dependsOn: ["a", "b"],
                run: (ctx) =>
                    (ctx.get<number>("a") ?? 0) + (ctx.get<number>("b") ?? 0),
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBe(2)
        const aStart = records.find(
            (r) => r.stage === "a" && r.phase === "start"
        )
        const bStart = records.find(
            (r) => r.stage === "b" && r.phase === "start"
        )
        const aEnd = records.find((r) => r.stage === "a" && r.phase === "end")
        const bEnd = records.find((r) => r.stage === "b" && r.phase === "end")
        expect(aStart && bStart && aEnd && bEnd).toBeTruthy()
        const startGap = Math.abs((aStart?.at ?? 0) - (bStart?.at ?? 0))
        expect(startGap).toBeLessThan(50)
        // overlap: each runs for ~50ms and they started within 50ms,
        // so both should have started before either ended.
        expect(aStart?.at ?? 0).toBeLessThan(
            bEnd?.at ?? Number.NEGATIVE_INFINITY
        )
        expect(bStart?.at ?? 0).toBeLessThan(
            aEnd?.at ?? Number.NEGATIVE_INFINITY
        )
    })

    it("respects concurrencyLimit of 2 with three independent stages", async () => {
        let inFlight = 0
        let maxInFlight = 0
        const makeStage = (id: string): TStage<number> =>
            deterministicStage({
                id,
                dependsOn: [],
                outputSchema: Type.Number(),
                fn: async () => {
                    inFlight += 1
                    if (inFlight > maxInFlight) maxInFlight = inFlight
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 40)
                    )
                    inFlight -= 1
                    return 1
                },
            })

        const pipeline = buildPipeline<number>({
            stages: [makeStage("a"), makeStage("b"), makeStage("c")],
            finalize: {
                dependsOn: ["a", "b", "c"],
                run: () => 3,
            },
        })
        await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm(), concurrencyLimit: 2 }
        )
        expect(maxInFlight).toBeLessThanOrEqual(2)
        expect(maxInFlight).toBeGreaterThanOrEqual(2) // we expect actual parallelism
    })
})

// ---------------- 3. Failure propagation ----------------

describe("executePipeline — failure propagation", () => {
    it("downstream required dep skips when upstream fails", async () => {
        let bRan = false
        const a: TStage<number> = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("upstream broke")
            },
        })
        const b: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                bRan = true
                return (ctx.get<number>("a") ?? 0) + 1
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: [optional("b")],
                run: (ctx) => ctx.get<number>("b") ?? -1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(bRan).toBe(false)
        expect(result.stageOutcomes).toMatchObject({
            a: "failed",
            b: "skipped",
        })
        expect(result.failures.some((f) => f.stage === "a")).toBe(true)
    })

    it("downstream optional dep runs with ctx.get returning undefined", async () => {
        let bGot: unknown = "not-set"
        let bSawStatus: string | null = null
        const a: TStage<number> = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("upstream broke")
            },
        })
        const b: TStage<string> = deterministicStage({
            id: "b",
            dependsOn: [optional("a")],
            outputSchema: Type.String(),
            fn: (ctx) => {
                bGot = ctx.get<number>("a")
                bSawStatus = ctx.stageStatus("a")
                return "b-output"
            },
        })
        const pipeline = buildPipeline<string>({
            stages: [a, b],
            finalize: {
                dependsOn: ["b"],
                run: (ctx) => ctx.get<string>("b") ?? "",
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(bGot).toBeUndefined()
        expect(bSawStatus).toBe("failed")
        expect(result.stageOutcomes).toMatchObject({
            a: "failed",
            b: "completed",
        })
        expect(result.output).toBe("b-output")
    })

    it("mixed case: a fails, b skipped (req on a), c runs (opt on b + req on d)", async () => {
        const a: TStage<number> = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("a broken")
            },
        })
        const b: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => 99,
        })
        const d: TStage<number> = deterministicStage({
            id: "d",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 7,
        })
        let cBStatus = ""
        const c: TStage<number> = deterministicStage({
            id: "c",
            dependsOn: [optional("b"), "d"],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                cBStatus = ctx.stageStatus("b")
                return ctx.get<number>("d") ?? -1
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b, d, c],
            finalize: {
                dependsOn: ["c"],
                run: (ctx) => ctx.get<number>("c") ?? -1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.stageOutcomes).toMatchObject({
            a: "failed",
            b: "skipped",
            d: "completed",
            c: "completed",
        })
        expect(cBStatus).toBe("skipped")
        expect(result.output).toBe(7)
    })
})

// ---------------- 4. Schema validation ----------------

describe("executePipeline — output schema validation", () => {
    it("emits OUTPUT_SCHEMA_INVALID and marks downstream-required skipped", async () => {
        const a: TStage<unknown> = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Object({ x: Type.Number() }),
            fn: () => ({ x: "not-a-number" }),
        })
        const b: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: [optional("b")],
                run: (ctx) => ctx.get<number>("b") ?? -1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.stageOutcomes).toMatchObject({
            a: "failed",
            b: "skipped",
        })
        const failure = result.failures.find((f) => f.stage === "a")
        expect(failure?.code).toBe("OUTPUT_SCHEMA_INVALID")
        expect(failure?.severity).toBe("error")
    })
})

// ---------------- 5. Retry ----------------

describe("llmStage — retry policy", () => {
    const outputSchema = Type.Object({ value: Type.Number() })

    it("schema-validation: invalid on attempt 1, success on attempt 2", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "x",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: x--> system",
                user: "user-prompt",
            }),
        })
        const llm = createMockLlmProvider({
            responses: {
                x: [
                    { kind: "schema-invalid", output: { value: "nope" } },
                    { kind: "ok", output: { value: 5 } },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["x"],
                run: (ctx) => ctx.get<{ value: number }>("x") ?? { value: -1 },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            {
                llm,
                onEvent: (e) => events.push(e),
            }
        )
        expect(result.output).toEqual({ value: 5 })
        expect(result.stageOutcomes).toMatchObject({ x: "completed" })
        const retries = events.filter((e) => e.kind === "stage:retry")
        expect(retries.length).toBe(1)
        expect(retries[0].kind === "stage:retry" && retries[0].reason).toBe(
            "schema_validation"
        )
    })

    it("schema-validation: invalid on both attempts → failed with latest validation error", async () => {
        const stage = llmStage<{ value: number }>({
            id: "y",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: y--> system",
                user: "u",
            }),
        })
        const llm = createMockLlmProvider({
            responses: {
                y: [
                    { kind: "schema-invalid", output: { value: "first" } },
                    { kind: "schema-invalid", output: { value: "second" } },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: [optional("y")],
                run: () => ({ value: -1 }),
            },
        })
        const result = await executePipeline(pipeline, {}, { llm })
        expect(result.stageOutcomes).toMatchObject({ y: "failed" })
        const failure = result.failures.find((f) => f.stage === "y")
        expect(failure?.code).toBe("OUTPUT_SCHEMA_INVALID")
    })

    it("appended validation error is truncated when longer than maxAppendedErrorBytes", async () => {
        // Build a schema that yields a long error path. We force a long
        // error by constraining a many-property object.
        const wideSchema = Type.Object({
            // 50 properties; missing all of them produces a long error.
            ...Object.fromEntries(
                Array.from({ length: 50 }, (_, i) => [
                    `field${i}`,
                    Type.String(),
                ])
            ),
        })
        const recordedUserMessages: string[] = []
        const llm = createMockLlmProvider({
            responses: {
                z: [
                    { kind: "schema-invalid", output: {} },
                    { kind: "ok", output: {} },
                ],
            },
            onCall: (rec) => recordedUserMessages.push(rec.userMessage),
        })
        const stage = llmStage<unknown>({
            id: "z",
            dependsOn: [],
            outputSchema: wideSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: z--> system",
                user: "base",
            }),
            retry: { maxAppendedErrorBytes: 80 },
        })
        const pipeline = buildPipeline<unknown>({
            stages: [stage],
            finalize: {
                dependsOn: [optional("z")],
                run: () => null,
            },
        })
        await executePipeline(pipeline, {}, { llm })
        // The second call should carry the retry-appended user message.
        expect(recordedUserMessages.length).toBeGreaterThanOrEqual(2)
        const secondCall = recordedUserMessages[1]
        expect(secondCall).toContain(
            "Your previous response failed schema validation"
        )
        expect(secondCall).toContain("…<truncated>")
    })

    it("transient error retries and then succeeds", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "t",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: t--> system",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                t: [
                    { kind: "error", error: makeTransientError("boom") },
                    { kind: "ok", output: { value: 9 } },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["t"],
                run: (ctx) => ctx.get<{ value: number }>("t") ?? { value: -1 },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.output).toEqual({ value: 9 })
        const retries = events.filter((e) => e.kind === "stage:retry")
        expect(retries.length).toBe(1)
        expect(retries[0].kind === "stage:retry" && retries[0].reason).toBe(
            "transient"
        )
    })

    it("rate-limit not in retryOn by default → fails immediately, no retry events", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "r",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: r--> system",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                r: [{ kind: "error", error: makeRateLimitError("429") }],
            },
        })
        const pipeline = buildPipeline<unknown>({
            stages: [stage],
            finalize: { dependsOn: [optional("r")], run: () => null },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.stageOutcomes).toMatchObject({ r: "failed" })
        const retries = events.filter((e) => e.kind === "stage:retry")
        expect(retries.length).toBe(0)
        const failure = result.failures.find((f) => f.stage === "r")
        expect(failure?.code).toBe("LLM_RATE_LIMITED")
    })

    it("DEFAULT_RETRY_POLICY matches the expected shape", () => {
        expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(2)
        expect(DEFAULT_RETRY_POLICY.retryOn).toContain("schema_validation")
        expect(DEFAULT_RETRY_POLICY.retryOn).toContain("transient")
        expect(DEFAULT_RETRY_POLICY.retryOn).not.toContain("rate_limit")
        expect(DEFAULT_RETRY_POLICY.retryOn).not.toContain("quota_exhausted")
        expect(DEFAULT_RETRY_POLICY.maxAppendedErrorBytes).toBe(2048)
    })
})

// ---------------- Quota-exhaustion classification ----------------

describe("llmStage — quota-exhaustion classification", () => {
    const outputSchema = Type.Object({ value: Type.Number() })

    it("quota error fails fast on attempt 1 (no retry) with code LLM_QUOTA_EXHAUSTED", async () => {
        const events: TPipelineEvent[] = []
        let callCount = 0
        const stage = llmStage<{ value: number }>({
            id: "q",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: q--> system",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                // Two queued errors, but a fail-fast stage must only
                // consume the first — proving no second attempt fires.
                q: [
                    {
                        kind: "error",
                        error: makeQuotaError("insufficient_quota"),
                    },
                    {
                        kind: "error",
                        error: makeQuotaError("insufficient_quota"),
                    },
                ],
            },
            onCall: () => {
                callCount += 1
            },
        })
        const pipeline = buildPipeline<unknown>({
            stages: [stage],
            finalize: { dependsOn: [optional("q")], run: () => null },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.stageOutcomes).toMatchObject({ q: "failed" })
        expect(callCount).toBe(1)
        const retries = events.filter((e) => e.kind === "stage:retry")
        expect(retries.length).toBe(0)
        const failure = result.failures.find((f) => f.stage === "q")
        expect(failure?.code).toBe(LLM_QUOTA_EXHAUSTED)
        expect(failure?.code).toBe("LLM_QUOTA_EXHAUSTED")
    })

    it("quota stays non-retryable even when rate_limit IS in retryOn — fail-fast comes from absence in retryOn, not a hard-coded branch", async () => {
        let callCount = 0
        const stage = llmStage<{ value: number }>({
            id: "q2",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: q2--> system",
                user: "u",
            }),
            // rate_limit is retryable here; quota is still absent, so a
            // quota 429 must NOT borrow rate_limit's retryability.
            retry: { backoffMs: 0, retryOn: ["rate_limit"] },
        })
        const llm = createMockLlmProvider({
            responses: {
                q2: [
                    {
                        kind: "error",
                        error: makeQuotaError("insufficient_quota"),
                    },
                    {
                        kind: "error",
                        error: makeQuotaError("insufficient_quota"),
                    },
                ],
            },
            onCall: () => {
                callCount += 1
            },
        })
        const pipeline = buildPipeline<unknown>({
            stages: [stage],
            finalize: { dependsOn: [optional("q2")], run: () => null },
        })
        const result = await executePipeline(pipeline, {}, { llm })
        expect(result.stageOutcomes).toMatchObject({ q2: "failed" })
        expect(callCount).toBe(1)
        const failure = result.failures.find((f) => f.stage === "q2")
        expect(failure?.code).toBe(LLM_QUOTA_EXHAUSTED)
    })

    it("transient attempt-count pin: a transient error under the default policy retries to exactly maxAttempts (regression guard for the quota branch)", async () => {
        let callCount = 0
        const stage = llmStage<{ value: number }>({
            id: "tp",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: tp--> system",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                tp: [
                    { kind: "error", error: makeTransientError("boom-1") },
                    { kind: "error", error: makeTransientError("boom-2") },
                ],
            },
            onCall: () => {
                callCount += 1
            },
        })
        const pipeline = buildPipeline<unknown>({
            stages: [stage],
            finalize: { dependsOn: [optional("tp")], run: () => null },
        })
        const result = await executePipeline(pipeline, {}, { llm })
        expect(result.stageOutcomes).toMatchObject({ tp: "failed" })
        expect(callCount).toBe(DEFAULT_RETRY_POLICY.maxAttempts)
        expect(callCount).toBe(2)
        const failure = result.failures.find((f) => f.stage === "tp")
        expect(failure?.code).toBe("LLM_TRANSIENT_ERROR")
    })

    it("exports LLM_QUOTA_EXHAUSTED constant and QuotaExhaustedLlmError class from the package root", () => {
        expect(LLM_QUOTA_EXHAUSTED).toBe("LLM_QUOTA_EXHAUSTED")
        const err = new QuotaExhaustedLlmError({
            message: "boom",
            status: 429,
        })
        expect(err).toBeInstanceOf(QuotaExhaustedLlmError)
        expect(err.retryReason).toBe("quota_exhausted")
        expect(err.status).toBe(429)
    })
})

// ---------------- 6. Token usage aggregation ----------------

describe("executePipeline — token usage aggregation", () => {
    it("sums tokenUsage from three llmStages", async () => {
        const stage = (id: string) =>
            llmStage<{ value: number }>({
                id,
                dependsOn: [],
                outputSchema: Type.Object({ value: Type.Number() }),
                model: "mock",
                buildPrompt: () => ({
                    system: `<!--stage-id: ${id}--> sys`,
                    user: "u",
                }),
            })
        const llm = createMockLlmProvider({
            responses: {
                a: [
                    {
                        kind: "ok",
                        output: { value: 1 },
                        tokenUsage: { input: 100, output: 50 },
                    },
                ],
                b: [
                    {
                        kind: "ok",
                        output: { value: 2 },
                        tokenUsage: { input: 200, output: 100 },
                    },
                ],
                c: [
                    {
                        kind: "ok",
                        output: { value: 3 },
                        tokenUsage: { input: 50, output: 25, reasoning: 10 },
                    },
                ],
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [stage("a"), stage("b"), stage("c")],
            finalize: {
                dependsOn: ["a", "b", "c"],
                run: () => 6,
            },
        })
        const result = await executePipeline(pipeline, {}, { llm })
        expect(result.tokenUsage).toEqual({
            input: 350,
            output: 175,
            reasoning: 10,
        })
    })

    it("deterministic stages do not contribute to token usage", async () => {
        const llm = createMockLlmProvider({
            responses: {
                a: [
                    {
                        kind: "ok",
                        output: { value: 1 },
                        tokenUsage: { input: 100, output: 50 },
                    },
                ],
            },
        })
        const aStage = llmStage<{ value: number }>({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Object({ value: Type.Number() }),
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: a--> sys",
                user: "u",
            }),
        })
        const bStage = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 7,
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage, bStage],
            finalize: {
                dependsOn: ["a", "b"],
                run: () => 1,
            },
        })
        const result = await executePipeline(pipeline, {}, { llm })
        expect(result.tokenUsage).toEqual({ input: 100, output: 50 })
    })
})

// ---------------- 7. Cancellation ----------------

describe("executePipeline — cancellation", () => {
    it("aborts in-flight stage and skips pending stages", async () => {
        const controller = new AbortController()
        let bRan = false
        const llm = createMockLlmProvider({
            responses: {
                a: [
                    {
                        kind: "ok",
                        output: { value: 1 },
                        tokenUsage: { input: 1, output: 1 },
                    },
                ],
            },
            responseDelayMs: 100,
        })
        const aStage = llmStage<{ value: number }>({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Object({ value: Type.Number() }),
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: a--> sys",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const bStage = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => {
                bRan = true
                return 5
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage, bStage],
            finalize: {
                dependsOn: ["b"],
                run: () => 99,
            },
        })
        // Abort shortly after launch.
        setTimeout(() => controller.abort(), 20)
        const result = await executePipeline(
            pipeline,
            {},
            { llm, signal: controller.signal }
        )
        expect(result.output).toBeNull()
        expect(bRan).toBe(false)
        expect(result.stageOutcomes.b).toBe("skipped")
        // The aborted stage itself is `skipped`, not `failed` — caller
        // cancellation is distinct from a provider error.
        expect(result.stageOutcomes.a).toBe("skipped")
        // No ProcessingFailure is recorded for the aborted stage.
        expect(result.failures.some((f) => f.stage === "a")).toBe(false)
    })
})

// ---------------- 8. Pipeline events ----------------

describe("executePipeline — events", () => {
    it("happy path emits pipeline:start, per-stage start/end, pipeline:end completed/present", async () => {
        const events: TPipelineEvent[] = []
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: (ctx) => (ctx.get<number>("a") ?? 0) + 1,
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: ["b"],
                run: (ctx) => ctx.get<number>("b") ?? -1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(result.output).toBe(2)
        expect(events[0].kind).toBe("pipeline:start")
        const last = events[events.length - 1]
        expect(last.kind).toBe("pipeline:end")
        if (last.kind === "pipeline:end") {
            expect(last.status).toBe("completed")
            expect(last.output).toBe("present")
        }
        // Per-stage start/end pairs (order may interleave when
        // concurrent, but here a→b is sequential so they're ordered).
        const stageEvents = events.filter(
            (e) => e.kind === "stage:start" || e.kind === "stage:end"
        )
        expect(stageEvents.length).toBe(4)
    })

    it("finalize-skipped path emits pipeline:end with output:null", async () => {
        const events: TPipelineEvent[] = []
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("nope")
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: () => 1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(result.output).toBeNull()
        const last = events[events.length - 1]
        if (last.kind === "pipeline:end") {
            expect(last.output).toBe("null")
            // status is "completed" because the pipeline itself didn't
            // throw — the failure is encoded in stageOutcomes.
            expect(last.status).toBe("completed")
        }
    })
})

// ---------------- 9. Finalize semantics ----------------

describe("executePipeline — finalize", () => {
    it("invokes finalize when all required deps completed", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 3,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: (ctx) => (ctx.get<number>("a") ?? 0) * 10,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBe(30)
    })

    it("skips finalize when a required dep failed; output is null", async () => {
        let finalizeRan = false
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("nope")
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: () => {
                    finalizeRan = true
                    return 1
                },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(finalizeRan).toBe(false)
        expect(result.output).toBeNull()
        expect(result.failures.some((f) => f.stage === "a")).toBe(true)
    })

    it("runs finalize when only an optional dep was skipped", async () => {
        let finalizeAGot: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("nope")
            },
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 5,
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: [optional("a"), "b"],
                run: (ctx) => {
                    finalizeAGot = ctx.get<number>("a")
                    return ctx.get<number>("b") ?? -1
                },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBe(5)
        expect(finalizeAGot).toBeUndefined()
    })
})

// ---------------- 10. subPipelineStage smoke test ----------------

describe("subPipelineStage", () => {
    it("executes a nested pipeline; events are prefixed", async () => {
        const events: TPipelineEvent[] = []
        const innerStage = deterministicStage({
            id: "inner-stage",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 11,
        })
        const innerPipeline: TPipeline<unknown, number> = {
            id: "inner-pipeline",
            version: "0",
            inputSchema: emptyInputSchema(),
            outputSchema: Type.Number(),
            stages: [innerStage],
            finalize: {
                dependsOn: ["inner-stage"],
                run: (ctx) => ctx.get<number>("inner-stage") ?? -1,
            },
        }
        const wrapper = subPipelineStage<number>({
            id: "wrap",
            dependsOn: [],
            pipeline: innerPipeline,
        })
        const outer = buildPipeline<number>({
            stages: [wrapper],
            finalize: {
                dependsOn: ["wrap"],
                run: (ctx) => (ctx.get<number>("wrap") ?? 0) * 2,
            },
        })
        const result = await executePipeline(
            outer,
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(result.output).toBe(22)
        const innerStageEvent = events.find(
            (e) =>
                (e.kind === "stage:start" || e.kind === "stage:end") &&
                "stageId" in e &&
                e.stageId.startsWith("wrap::")
        )
        expect(innerStageEvent).toBeTruthy()
    })
})

// ---------------- bonus: ctx.get strictness ----------------

describe("executePipeline — ctx.get strictness", () => {
    it("throws PipelineConfigurationError when a stage calls ctx.get on a non-dep", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const b: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx: TStageContext) => {
                // 'a' is not in b's dependsOn.
                return ctx.get<number>("a") ?? 0
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: [optional("b")],
                run: (ctx) => ctx.get<number>("b") ?? -1,
            },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toBeInstanceOf(PipelineConfigurationError)
    })
})

// ---------------- bonus: llmStage thrown shape on retry exhaustion ----------------

describe("LlmStageRetryExhaustedError", () => {
    it("is a real Error subclass with the expected fields", () => {
        const err = new LlmStageRetryExhaustedError({
            stageId: "x",
            reason: "transient",
            code: "LLM_TRANSIENT_ERROR",
            attempts: 2,
            message: "boom",
        })
        expect(err).toBeInstanceOf(Error)
        expect(err.stageId).toBe("x")
        expect(err.reason).toBe("transient")
        expect(err.code).toBe("LLM_TRANSIENT_ERROR")
        expect(err.attempts).toBe(2)
    })
})

// Mid-flight abort surfaces as `skipped` with no ProcessingFailure.
describe("mid-flight abort surfaces as skipped", () => {
    it("aborted in-flight llmStage is `skipped`, not `failed`, with no failure recorded", async () => {
        const events: TPipelineEvent[] = []
        const controller = new AbortController()
        const llm = createMockLlmProvider({
            // Mock will sleep `responseDelayMs` then check signal; on
            // abort it throws Error("mock-llm: aborted") without a
            // `retryReason` tag — pre-fold this surfaced as
            // LLM_NON_RETRYABLE_ERROR; post-fold llmStage recognizes
            // the in-flight abort and throws StageAbortedError instead.
            responses: {
                a: [{ kind: "ok", output: { value: 1 } }],
            },
            responseDelayMs: 80,
        })
        const aStage = llmStage<{ value: number }>({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Object({ value: Type.Number() }),
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: a--> sys",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [aStage],
            finalize: {
                dependsOn: ["a"],
                run: (ctx) => ctx.get<{ value: number }>("a") ?? { value: -1 },
            },
        })
        setTimeout(() => controller.abort(), 20)
        const result = await executePipeline(
            pipeline,
            {},
            {
                llm,
                signal: controller.signal,
                onEvent: (e) => events.push(e),
            }
        )
        expect(result.stageOutcomes.a).toBe("skipped")
        expect(result.failures.find((f) => f.stage === "a")).toBeUndefined()
        // The finalize was bypassed because its required dep `a` is
        // not `completed`. Per spec §5.4 step 6, output is null.
        expect(result.output).toBeNull()
        const aEnd = events.find(
            (e) => e.kind === "stage:end" && e.stageId === "a"
        )
        if (aEnd?.kind === "stage:end") {
            expect(aEnd.status).toBe("skipped")
        } else {
            throw new Error("expected a stage:end event for stage 'a'")
        }
    })
})

// Abort fast-path emits paired stage:start / stage:end.
describe("abort fast-path emits paired start/end events", () => {
    it("a stage that never starts because the signal was already aborted still emits stage:start before stage:end", async () => {
        const events: TPipelineEvent[] = []
        const controller = new AbortController()
        // Build a 2-stage pipeline; abort early so the second stage
        // enters runStage with `signal.aborted === true` and goes
        // through the abort fast-path.
        const llm = createMockLlmProvider({
            responses: {
                a: [{ kind: "ok", output: { value: 1 } }],
            },
            responseDelayMs: 60,
        })
        const aStage = llmStage<{ value: number }>({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Object({ value: Type.Number() }),
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: a--> sys",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const bStage = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => 5,
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage, bStage],
            finalize: { dependsOn: ["b"], run: () => 99 },
        })
        setTimeout(() => controller.abort(), 10)
        await executePipeline(
            pipeline,
            {},
            {
                llm,
                signal: controller.signal,
                onEvent: (e) => events.push(e),
            }
        )
        // For stage `b`, the pre-stage abort-fast-path triggers.
        const bEvents = events.filter(
            (e) =>
                (e.kind === "stage:start" || e.kind === "stage:end") &&
                "stageId" in e &&
                e.stageId === "b"
        )
        expect(bEvents.length).toBe(2)
        expect(bEvents[0].kind).toBe("stage:start")
        expect(bEvents[1].kind).toBe("stage:end")
    })
})

// Optional-dep cycle detection.
describe("optional-dep cycle detection", () => {
    it("DAG_CYCLE throws when the cycle edge is via optional(...)", async () => {
        const visited: string[] = []
        const aStage = deterministicStage({
            id: "a",
            dependsOn: [optional("b")],
            outputSchema: Type.Number(),
            fn: () => {
                visited.push("a")
                return 1
            },
        })
        const bStage = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: () => {
                visited.push("b")
                return 2
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage, bStage],
            finalize: { dependsOn: ["a"], run: () => 0 },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "DAG_CYCLE",
        })
        expect(visited).toEqual([])
    })
})

// ctx.stageStatus enforces the same dep allowlist as ctx.get.
describe("ctx.stageStatus enforces dep allowlist", () => {
    it("throws PipelineConfigurationError when stage calls ctx.stageStatus on a non-dep", async () => {
        const aStage = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const bStage: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx: TStageContext) => {
                // 'a' is not in b's dependsOn — must throw.
                ctx.stageStatus("a")
                return 0
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage, bStage],
            finalize: {
                dependsOn: [optional("b")],
                run: (ctx) => ctx.get<number>("b") ?? -1,
            },
        })
        await expect(
            executePipeline(pipeline, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "STATUS_OUTSIDE_DEPS",
        })
    })
})

// subPipelineStage null-output throws SubPipelineFailedError.
describe("subPipelineStage null-output throws SubPipelineFailedError", () => {
    it("nested null output surfaces as SubPipelineFailedError (not LlmStageRetryExhaustedError)", async () => {
        // Build a nested pipeline whose required finalize dep fails so
        // the nested result is `output: null`. The outer wrapper must
        // throw `SubPipelineFailedError`, the executor must surface it
        // as a stage failure on the outer pipeline with code
        // `SUB_PIPELINE_NULL_OUTPUT`.
        const failingInnerStage = deterministicStage({
            id: "inner-bad",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => {
                throw new Error("inner stage broken")
            },
        })
        const innerPipeline: TPipeline<unknown, number> = {
            id: "inner-pipeline",
            version: "0",
            inputSchema: Type.Object({}),
            outputSchema: Type.Number(),
            stages: [failingInnerStage],
            finalize: {
                dependsOn: ["inner-bad"],
                run: () => 1,
            },
        }
        const wrapper = subPipelineStage<number>({
            id: "wrap",
            dependsOn: [],
            pipeline: innerPipeline,
        })
        const outer = buildPipeline<number>({
            stages: [wrapper],
            finalize: {
                dependsOn: [optional("wrap")],
                run: (ctx) => ctx.get<number>("wrap") ?? -1,
            },
        })
        const result = await executePipeline(outer, {}, { llm: emptyMockLlm() })
        expect(result.stageOutcomes.wrap).toBe("failed")
        // The outer failure list contains (a) the forwarded inner
        // stage failure (`STAGE_UNCAUGHT_ERROR` from the throwing
        // inner stage, re-attached to the wrapper id) and (b) the
        // SubPipelineFailedError-induced `SUB_PIPELINE_NULL_OUTPUT`.
        // Assert the latter is present — it's the load-bearing
        // signal that the wrapper recognized the nested null.
        const subPipelineFailure = result.failures.find(
            (f) => f.code === "SUB_PIPELINE_NULL_OUTPUT"
        )
        expect(subPipelineFailure).toBeDefined()
        expect(subPipelineFailure?.stage).toBe("wrap")
    })

    it("SubPipelineFailedError is a real Error subclass with the expected fields", () => {
        const err = new SubPipelineFailedError({
            stageId: "wrap",
            code: "SUB_PIPELINE_NULL_OUTPUT",
            message: "boom",
            context: { subPipelineId: "inner-pipeline" },
        })
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("SubPipelineFailedError")
        expect(err.stageId).toBe("wrap")
        expect(err.code).toBe("SUB_PIPELINE_NULL_OUTPUT")
        expect(err.failureContext).toEqual({
            subPipelineId: "inner-pipeline",
        })
    })
})

describe("StageAbortedError class shape", () => {
    it("is a real Error subclass with the expected fields", () => {
        const err = new StageAbortedError({ stageId: "x" })
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("StageAbortedError")
        expect(err.stageId).toBe("x")
        expect(err.message).toBe("aborted")
    })
})

// stage:llm-call event
//
// Tests for the `stage:llm-call` event variant. The event must fire
// from `llmStage` after every LLM-call attempt — including
// schema-failed attempts whose retry is about to fire — carrying the
// actual prompts sent, the raw provider output, the call's token usage,
// and an optional `validationError` set iff schema validation rejected
// the output. Deterministic stages emit zero events of this kind.

describe("llmStage — stage:llm-call event", () => {
    const outputSchema = Type.Object({ value: Type.Number() })

    it("successful attempt fires exactly one stage:llm-call before stage:end with no validationError", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "s1",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: s1--> system-prompt",
                user: "original-user",
            }),
        })
        const llm = createMockLlmProvider({
            responses: {
                s1: [
                    {
                        kind: "ok",
                        output: { value: 42 },
                        tokenUsage: { input: 10, output: 20 },
                    },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["s1"],
                run: (ctx) => ctx.get<{ value: number }>("s1") ?? { value: -1 },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.output).toEqual({ value: 42 })

        const llmCallEvents = events.filter((e) => e.kind === "stage:llm-call")
        expect(llmCallEvents.length).toBe(1)
        const evt = llmCallEvents[0]
        if (evt.kind !== "stage:llm-call") {
            throw new Error("expected stage:llm-call event")
        }
        expect(evt.stageId).toBe("s1")
        expect(evt.attempt).toBe(1)
        expect(evt.prompts.system).toBe("<!--stage-id: s1--> system-prompt")
        expect(evt.prompts.user).toBe("original-user")
        expect(evt.output).toEqual({ value: 42 })
        expect(evt.tokenUsage).toEqual({ input: 10, output: 20 })
        expect(evt.validationError).toBeUndefined()

        // The event must fire BEFORE the corresponding stage:end.
        const llmCallIdx = events.indexOf(evt)
        const stageEndIdx = events.findIndex(
            (e) => e.kind === "stage:end" && e.stageId === "s1"
        )
        expect(llmCallIdx).toBeGreaterThanOrEqual(0)
        expect(stageEndIdx).toBeGreaterThan(llmCallIdx)
    })

    it("retry-then-succeed: emits stage:llm-call on both attempts; attempt 1 carries validationError, attempt 2's user message carries the retry suffix", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "s2",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: s2--> system",
                user: "base-user",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                s2: [
                    {
                        kind: "schema-invalid",
                        output: { value: "not-a-number" },
                        tokenUsage: { input: 5, output: 5 },
                    },
                    {
                        kind: "ok",
                        output: { value: 7 },
                        tokenUsage: { input: 8, output: 9 },
                    },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["s2"],
                run: (ctx) => ctx.get<{ value: number }>("s2") ?? { value: -1 },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.output).toEqual({ value: 7 })
        expect(result.stageOutcomes).toMatchObject({ s2: "completed" })

        // Extract the relevant event sequence for stage s2.
        const s2Events = events.filter(
            (e) => "stageId" in e && e.stageId === "s2"
        )
        const kinds = s2Events.map((e) => e.kind)
        expect(kinds).toEqual([
            "stage:start",
            "stage:llm-request",
            "stage:llm-call",
            "stage:retry",
            "stage:llm-request",
            "stage:llm-call",
            "stage:end",
        ])

        const llmCallEvents = s2Events.filter(
            (e) => e.kind === "stage:llm-call"
        )
        expect(llmCallEvents.length).toBe(2)

        const first = llmCallEvents[0]
        const second = llmCallEvents[1]
        if (
            first.kind !== "stage:llm-call" ||
            second.kind !== "stage:llm-call"
        ) {
            throw new Error("expected stage:llm-call events")
        }
        expect(first.attempt).toBe(1)
        expect(first.prompts.user).toBe("base-user")
        expect(first.output).toEqual({ value: "not-a-number" })
        expect(first.tokenUsage).toEqual({ input: 5, output: 5 })
        expect(typeof first.validationError).toBe("string")
        expect(first.validationError ?? "").toContain("/value")

        expect(second.attempt).toBe(2)
        expect(second.prompts.user).toContain("base-user")
        expect(second.prompts.user).toContain(
            "Your previous response failed schema validation"
        )
        expect(second.output).toEqual({ value: 7 })
        expect(second.tokenUsage).toEqual({ input: 8, output: 9 })
        expect(second.validationError).toBeUndefined()

        // stage:end status is completed because attempt 2 succeeded.
        const stageEnd = s2Events.find((e) => e.kind === "stage:end")
        if (stageEnd?.kind === "stage:end") {
            expect(stageEnd.status).toBe("completed")
        }
    })

    it("retry-exhausted: emits stage:llm-call on both attempts with validationError set; stage:end is failed", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "s3",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: s3--> system",
                user: "base-user-3",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                s3: [
                    {
                        kind: "schema-invalid",
                        output: { value: "bad1" },
                    },
                    {
                        kind: "schema-invalid",
                        output: { value: "bad2" },
                    },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: [optional("s3")],
                run: () => ({ value: -1 }),
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.stageOutcomes).toMatchObject({ s3: "failed" })

        const s3Events = events.filter(
            (e) => "stageId" in e && e.stageId === "s3"
        )
        const kinds = s3Events.map((e) => e.kind)
        expect(kinds).toEqual([
            "stage:start",
            "stage:llm-request",
            "stage:llm-call",
            "stage:retry",
            "stage:llm-request",
            "stage:llm-call",
            "stage:end",
        ])

        const llmCallEvents = s3Events.filter(
            (e) => e.kind === "stage:llm-call"
        )
        expect(llmCallEvents.length).toBe(2)
        const first = llmCallEvents[0]
        const second = llmCallEvents[1]
        if (
            first.kind !== "stage:llm-call" ||
            second.kind !== "stage:llm-call"
        ) {
            throw new Error("expected stage:llm-call events")
        }
        expect(first.attempt).toBe(1)
        expect(typeof first.validationError).toBe("string")
        expect(first.output).toEqual({ value: "bad1" })

        expect(second.attempt).toBe(2)
        expect(typeof second.validationError).toBe("string")
        expect(second.output).toEqual({ value: "bad2" })
        expect(second.prompts.user).toContain(
            "Your previous response failed schema validation"
        )

        const stageEnd = s3Events.find((e) => e.kind === "stage:end")
        if (stageEnd?.kind === "stage:end") {
            expect(stageEnd.status).toBe("failed")
        }
    })

    it("deterministic stage emits zero stage:llm-call events", async () => {
        const events: TPipelineEvent[] = []
        const aStage = deterministicStage({
            id: "det",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 42,
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage],
            finalize: {
                dependsOn: ["det"],
                run: (ctx) => ctx.get<number>("det") ?? -1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(result.output).toBe(42)
        const llmCallEvents = events.filter((e) => e.kind === "stage:llm-call")
        expect(llmCallEvents.length).toBe(0)
    })
})

// ---------------- A2 — stage:llm-request event ----------------
//
// Tests for the new additive `stage:llm-request` event variant. It must
// fire from `llmStage` INSIDE the retry loop, after `attempt += 1` and
// after the request is built, immediately BEFORE the provider call
// resolves — carrying the prompts as-sent on this attempt (the user
// message includes any retry-suffix), the current `attempt`, and an
// `at` timestamp. Per-attempt ordering is
// `stage:start → stage:llm-request → stage:llm-call → stage:end`, with a
// retried attempt firing a second `stage:llm-request`. Deterministic
// stages emit none. This lets a consumer surface a stage's input the
// instant the stage starts its call, before the response lands.

describe("llmStage — stage:llm-request event", () => {
    const outputSchema = Type.Object({ value: Type.Number() })

    it("fires exactly one stage:llm-request before stage:llm-call and stage:end, carrying prompts + attempt + at", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "r1",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: r1--> system-prompt",
                user: "original-user",
            }),
        })
        const llm = createMockLlmProvider({
            responses: {
                r1: [{ kind: "ok", output: { value: 42 } }],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["r1"],
                run: (ctx) => ctx.get<{ value: number }>("r1") ?? { value: -1 },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.output).toEqual({ value: 42 })

        const reqEvents = events.filter((e) => e.kind === "stage:llm-request")
        expect(reqEvents.length).toBe(1)
        const evt = reqEvents[0]
        if (evt.kind !== "stage:llm-request") {
            throw new Error("expected stage:llm-request event")
        }
        expect(evt.stageId).toBe("r1")
        expect(evt.attempt).toBe(1)
        expect(evt.prompts.system).toBe("<!--stage-id: r1--> system-prompt")
        expect(evt.prompts.user).toBe("original-user")
        expect(typeof evt.at).toBe("number")

        // The request event fires before the matching call + end.
        const reqIdx = events.indexOf(evt)
        const callIdx = events.findIndex(
            (e) => e.kind === "stage:llm-call" && e.stageId === "r1"
        )
        const endIdx = events.findIndex(
            (e) => e.kind === "stage:end" && e.stageId === "r1"
        )
        expect(reqIdx).toBeGreaterThanOrEqual(0)
        expect(callIdx).toBeGreaterThan(reqIdx)
        expect(endIdx).toBeGreaterThan(callIdx)
    })

    it("single-attempt event order is stage:start → stage:llm-request → stage:llm-call → stage:end", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "r2",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: r2--> sys",
                user: "u",
            }),
        })
        const llm = createMockLlmProvider({
            responses: {
                r2: [{ kind: "ok", output: { value: 1 } }],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["r2"],
                run: (ctx) => ctx.get<{ value: number }>("r2") ?? { value: -1 },
            },
        })
        await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        const r2Kinds = events
            .filter((e) => "stageId" in e && e.stageId === "r2")
            .map((e) => e.kind)
        expect(r2Kinds).toEqual([
            "stage:start",
            "stage:llm-request",
            "stage:llm-call",
            "stage:end",
        ])
    })

    it("a retried attempt fires a second stage:llm-request with the incremented attempt and the retry-suffixed user message", async () => {
        const events: TPipelineEvent[] = []
        const stage = llmStage<{ value: number }>({
            id: "r3",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: r3--> sys",
                user: "base-user",
            }),
            retry: { backoffMs: 0 },
        })
        const llm = createMockLlmProvider({
            responses: {
                r3: [
                    { kind: "schema-invalid", output: { value: "nope" } },
                    { kind: "ok", output: { value: 7 } },
                ],
            },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: ["r3"],
                run: (ctx) => ctx.get<{ value: number }>("r3") ?? { value: -1 },
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )
        expect(result.output).toEqual({ value: 7 })

        const r3Events = events.filter(
            (e) => "stageId" in e && e.stageId === "r3"
        )
        const kinds = r3Events.map((e) => e.kind)
        expect(kinds).toEqual([
            "stage:start",
            "stage:llm-request",
            "stage:llm-call",
            "stage:retry",
            "stage:llm-request",
            "stage:llm-call",
            "stage:end",
        ])

        const reqEvents = r3Events.filter((e) => e.kind === "stage:llm-request")
        expect(reqEvents.length).toBe(2)
        const first = reqEvents[0]
        const second = reqEvents[1]
        if (
            first.kind !== "stage:llm-request" ||
            second.kind !== "stage:llm-request"
        ) {
            throw new Error("expected stage:llm-request events")
        }
        expect(first.attempt).toBe(1)
        expect(first.prompts.user).toBe("base-user")
        expect(second.attempt).toBe(2)
        expect(second.prompts.user).toContain("base-user")
        expect(second.prompts.user).toContain(
            "Your previous response failed schema validation"
        )
    })

    it("deterministic stage emits zero stage:llm-request events", async () => {
        const events: TPipelineEvent[] = []
        const aStage = deterministicStage({
            id: "det",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 42,
        })
        const pipeline = buildPipeline<number>({
            stages: [aStage],
            finalize: {
                dependsOn: ["det"],
                run: (ctx) => ctx.get<number>("det") ?? -1,
            },
        })
        const result = await executePipeline(
            pipeline,
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(result.output).toBe(42)
        const reqEvents = events.filter((e) => e.kind === "stage:llm-request")
        expect(reqEvents.length).toBe(0)
    })
})

// ---------------- executeStage — single-stage execution ----------------
//
// `executeStage` runs ONE stage of a pipeline against a caller-supplied
// map of upstream `{ outcome, output? }` records, reproducing the
// monolithic run's `ctx.get` / `ctx.stageStatus` semantics without
// re-running the DAG. It emits only the per-stage events (no
// `pipeline:*` bookends), throws on an unknown stage id or a
// ctx.get-on-non-dep caller bug, and normalizes away `output` for any
// non-completed upstream.

describe("executeStage — single-stage execution", () => {
    it("runs one stage from fixed upstream completed outputs", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 10,
        })
        let bSawA: unknown = "unset"
        const b = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                bSawA = ctx.get<number>("a")
                return (ctx.get<number>("a") ?? 0) + 1
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: ["b"],
                run: (ctx) => ctx.get<number>("b") ?? -1,
            },
        })
        const result = await executeStage(
            pipeline,
            "b",
            { a: { outcome: "completed", output: 41 } },
            {},
            { llm: emptyMockLlm() }
        )
        expect(bSawA).toBe(41)
        expect(result.outcome).toBe("completed")
        expect(result.output).toBe(42)
        expect(result.failures).toEqual([])
    })

    it("seeds ctx.input via Value.Parse(inputSchema, input), identical to what executePipeline seeds", async () => {
        // The load-bearing parity invariant: the single-stage path must
        // seed ctx.input with Value.Parse(inputSchema, input) — exactly
        // what executePipeline seeds — so a stage reading ctx.input
        // (e.g. segmentation, claim-canonicalization) sees the same value
        // it would in the monolithic run.
        const inputSchema = Type.Object({
            text: Type.String(),
            opts: Type.Object({ tag: Type.String() }),
        })
        const rawInput = { text: "hi", opts: { tag: "z" } }
        const expectedSeed = Value.Parse(inputSchema, rawInput)

        let stageSawInput: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                stageSawInput = ctx.input
                return 1
            },
        })
        const pipeline: TPipeline<unknown, number> = {
            id: "parse-pipe",
            version: "0",
            inputSchema,
            outputSchema: Type.Number(),
            stages: [a],
            finalize: { dependsOn: ["a"], run: () => 0 },
        }

        // Capture what executePipeline seeds, for an exact comparison.
        let monolithicSawInput: unknown = "unset"
        const aForWhole = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                monolithicSawInput = ctx.input
                return 1
            },
        })
        await executePipeline({ ...pipeline, stages: [aForWhole] }, rawInput, {
            llm: emptyMockLlm(),
        })

        await executeStage(pipeline, "a", {}, rawInput, {
            llm: emptyMockLlm(),
        })
        expect(stageSawInput).toEqual(expectedSeed)
        expect(stageSawInput).toEqual(monolithicSawInput)
    })

    it("throws PipelineConfigurationError (UNKNOWN_STAGE) for a stage id not in the pipeline", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: { dependsOn: ["a"], run: () => 0 },
        })
        await expect(
            executeStage(pipeline, "nope", {}, {}, { llm: emptyMockLlm() })
        ).rejects.toMatchObject({
            name: "PipelineConfigurationError",
            code: "UNKNOWN_STAGE",
            stageId: "nope",
        })
    })

    it("throws inputSchema rejection out (caller bug), like executePipeline", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const pipeline: TPipeline<unknown, number> = {
            id: "schema-pipe",
            version: "0",
            inputSchema: Type.Object({ x: Type.Number() }),
            outputSchema: Type.Number(),
            stages: [a],
            finalize: { dependsOn: ["a"], run: () => 0 },
        }
        await expect(
            executeStage(
                pipeline,
                "a",
                {},
                { x: "not-a-number" },
                { llm: emptyMockLlm() }
            )
        ).rejects.toThrow()
    })

    it("a skipped optional upstream rehydrates to ctx.get undefined AND ctx.stageStatus 'skipped'", async () => {
        let bGot: unknown = "unset"
        let bStatus = ""
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: [optional("a")],
            outputSchema: Type.String(),
            fn: (ctx) => {
                bGot = ctx.get<number>("a")
                bStatus = ctx.stageStatus("a")
                return "b-output"
            },
        })
        const pipeline = buildPipeline<string>({
            stages: [a, b],
            finalize: {
                dependsOn: ["b"],
                run: (ctx) => ctx.get<string>("b") ?? "",
            },
        })
        const result = await executeStage(
            pipeline,
            "b",
            { a: { outcome: "skipped" } },
            {},
            { llm: emptyMockLlm() }
        )
        expect(bGot).toBeUndefined()
        expect(bStatus).toBe("skipped")
        expect(result.outcome).toBe("completed")
        expect(result.output).toBe("b-output")
    })

    it("a failed REQUIRED upstream still runs the stage with ctx.get undefined (skip decision is the caller's)", async () => {
        let bGot: unknown = "unset"
        let bStatus = ""
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.String(),
            fn: (ctx) => {
                bGot = ctx.get<number>("a")
                bStatus = ctx.stageStatus("a")
                return "ran-anyway"
            },
        })
        const pipeline = buildPipeline<string>({
            stages: [a, b],
            finalize: {
                dependsOn: ["b"],
                run: (ctx) => ctx.get<string>("b") ?? "",
            },
        })
        const result = await executeStage(
            pipeline,
            "b",
            { a: { outcome: "failed" } },
            {},
            { llm: emptyMockLlm() }
        )
        expect(bGot).toBeUndefined()
        expect(bStatus).toBe("failed")
        expect(result.outcome).toBe("completed")
        expect(result.output).toBe("ran-anyway")
    })

    it("rejects with PipelineConfigurationError (not a failed result) when a stage reads a non-dep", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const b: TStage<number> = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx: TStageContext) => {
                // 'a' is not in b's dependsOn — a caller bug.
                return ctx.get<number>("a") ?? 0
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: { dependsOn: [optional("b")], run: () => 0 },
        })
        await expect(
            executeStage(
                pipeline,
                "b",
                { a: { outcome: "completed", output: 1 } },
                {},
                { llm: emptyMockLlm() }
            )
        ).rejects.toBeInstanceOf(PipelineConfigurationError)
    })

    it("normalizes a caller-supplied output away for a non-completed upstream", async () => {
        // A skipped record carrying a stale output must not leak — the
        // dependent must still see ctx.get(undefined).
        let bGot: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: [optional("a")],
            outputSchema: Type.String(),
            fn: (ctx) => {
                bGot = ctx.get<number>("a")
                return "ok"
            },
        })
        const pipeline = buildPipeline<string>({
            stages: [a, b],
            finalize: {
                dependsOn: ["b"],
                run: (ctx) => ctx.get<string>("b") ?? "",
            },
        })
        await executeStage(
            pipeline,
            "b",
            // Inconsistent: skipped but with an output present.
            { a: { outcome: "skipped", output: 999 } },
            {},
            { llm: emptyMockLlm() }
        )
        expect(bGot).toBeUndefined()
    })

    it("accepts a superset of upstream records and uses the stage's own dependsOn", async () => {
        let bGot: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: ["a"],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                bGot = ctx.get<number>("a")
                return 1
            },
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: { dependsOn: ["b"], run: () => 0 },
        })
        const result = await executeStage(
            pipeline,
            "b",
            {
                a: { outcome: "completed", output: 5 },
                // An irrelevant extra record the stage does not depend on.
                "some-other-stage": { outcome: "completed", output: 99 },
            },
            {},
            { llm: emptyMockLlm() }
        )
        expect(bGot).toBe(5)
        expect(result.outcome).toBe("completed")
    })

    it("emits per-stage events but NO pipeline:start / pipeline:end bookends", async () => {
        const events: TPipelineEvent[] = []
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 1,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: { dependsOn: ["a"], run: () => 0 },
        })
        await executeStage(
            pipeline,
            "a",
            {},
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(events.some((e) => e.kind === "pipeline:start")).toBe(false)
        expect(events.some((e) => e.kind === "pipeline:end")).toBe(false)
        const stageEventKinds = events.map((e) => e.kind)
        expect(stageEventKinds).toContain("stage:start")
        expect(stageEventKinds).toContain("stage:end")
    })

    it("an llmStage replayed via executeStage emits the same per-stage event sequence as inside executePipeline, and surfaces tokenUsage", async () => {
        const outputSchema = Type.Object({ value: Type.Number() })
        const makeStage = () =>
            llmStage<{ value: number }>({
                id: "x",
                dependsOn: [],
                outputSchema,
                model: "mock",
                buildPrompt: () => ({
                    system: "<!--stage-id: x--> system",
                    user: "user-prompt",
                }),
                retry: { backoffMs: 0 },
            })
        const responseQueue = () => ({
            x: [
                { kind: "schema-invalid" as const, output: { value: "nope" } },
                {
                    kind: "ok" as const,
                    output: { value: 5 },
                    tokenUsage: { input: 11, output: 22 },
                },
            ],
        })

        // Whole-run reference sequence.
        const wholeEvents: TPipelineEvent[] = []
        const wholePipeline = buildPipeline<{ value: number }>({
            stages: [makeStage()],
            finalize: {
                dependsOn: ["x"],
                run: (ctx) => ctx.get<{ value: number }>("x") ?? { value: -1 },
            },
        })
        await executePipeline(
            wholePipeline,
            {},
            {
                llm: createMockLlmProvider({ responses: responseQueue() }),
                onEvent: (e) => wholeEvents.push(e),
            }
        )
        const wholeXKinds = wholeEvents
            .filter((e) => "stageId" in e && e.stageId === "x")
            .map((e) => e.kind)

        // Single-stage replay.
        const stageEvents: TPipelineEvent[] = []
        const singlePipeline = buildPipeline<{ value: number }>({
            stages: [makeStage()],
            finalize: { dependsOn: ["x"], run: () => ({ value: -1 }) },
        })
        const result = await executeStage(
            singlePipeline,
            "x",
            {},
            {},
            {
                llm: createMockLlmProvider({ responses: responseQueue() }),
                onEvent: (e) => stageEvents.push(e),
            }
        )
        const singleXKinds = stageEvents
            .filter((e) => "stageId" in e && e.stageId === "x")
            .map((e) => e.kind)

        expect(singleXKinds).toEqual(wholeXKinds)
        expect(singleXKinds).toEqual([
            "stage:start",
            "stage:llm-request",
            "stage:llm-call",
            "stage:retry",
            "stage:llm-request",
            "stage:llm-call",
            "stage:end",
        ])
        expect(result.outcome).toBe("completed")
        expect(result.output).toEqual({ value: 5 })
        expect(result.tokenUsage).toEqual({ input: 11, output: 22 })
    })

    it("a failing llmStage surfaces a failed outcome + the failure, with no output/tokenUsage", async () => {
        const outputSchema = Type.Object({ value: Type.Number() })
        const stage = llmStage<{ value: number }>({
            id: "x",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!--stage-id: x--> system",
                user: "u",
            }),
            retry: { backoffMs: 0 },
        })
        const pipeline = buildPipeline<{ value: number }>({
            stages: [stage],
            finalize: {
                dependsOn: [optional("x")],
                run: () => ({ value: -1 }),
            },
        })
        const result = await executeStage(
            pipeline,
            "x",
            {},
            {},
            {
                llm: createMockLlmProvider({
                    responses: {
                        x: [
                            {
                                kind: "error",
                                error: makeRateLimitError("429"),
                            },
                        ],
                    },
                }),
            }
        )
        expect(result.outcome).toBe("failed")
        expect(result.output).toBeUndefined()
        expect(result.tokenUsage).toBeUndefined()
        expect(result.failures.find((f) => f.stage === "x")?.code).toBe(
            "LLM_RATE_LIMITED"
        )
    })
})

// ---------------- executeFinalize — single-finalize execution ----------------
//
// `executeFinalize` runs the pipeline's finalize against caller-supplied
// upstream records, mirroring executePipeline's finalize semantics: the
// finalizeRequiredOk() gate (null output when a required dep is not
// completed), the FINALIZE_UNCAUGHT_ERROR capture, and the outcome-
// carrying rehydration. It emits no events and is async only for
// signature symmetry with executeStage.

describe("executeFinalize — single-finalize execution", () => {
    it("happy path: returns the finalize output from completed upstream records", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: ["a", "b"],
                run: (ctx) =>
                    (ctx.get<number>("a") ?? 0) + (ctx.get<number>("b") ?? 0),
            },
        })
        const result = await executeFinalize(
            pipeline,
            {
                a: { outcome: "completed", output: 3 },
                b: { outcome: "completed", output: 4 },
            },
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBe(7)
        expect(result.failures).toEqual([])
    })

    it("seeds finalize ctx.input via Value.Parse(inputSchema, input)", async () => {
        const inputSchema = Type.Object({
            text: Type.String(),
            opts: Type.Object({ tag: Type.String() }),
        })
        const rawInput = { text: "hi", opts: { tag: "z" } }
        const expectedSeed = Value.Parse(inputSchema, rawInput)
        let finalizeSawInput: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline: TPipeline<unknown, number> = {
            id: "parse-pipe",
            version: "0",
            inputSchema,
            outputSchema: Type.Number(),
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: (ctx) => {
                    finalizeSawInput = ctx.input
                    return 1
                },
            },
        }
        await executeFinalize(
            pipeline,
            { a: { outcome: "completed", output: 0 } },
            rawInput,
            { llm: emptyMockLlm() }
        )
        expect(finalizeSawInput).toEqual(expectedSeed)
    })

    it("required dep not completed → output null (the finalizeRequiredOk gate)", async () => {
        let finalizeRan = false
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: () => {
                    finalizeRan = true
                    return 1
                },
            },
        })
        const result = await executeFinalize(
            pipeline,
            { a: { outcome: "failed" } },
            {},
            { llm: emptyMockLlm() }
        )
        expect(finalizeRan).toBe(false)
        expect(result.output).toBeNull()
    })

    it("optional dep skipped → finalize runs with ctx.get(dep) undefined", async () => {
        let finalizeAGot: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline = buildPipeline<number>({
            stages: [a, b],
            finalize: {
                dependsOn: [optional("a"), "b"],
                run: (ctx) => {
                    finalizeAGot = ctx.get<number>("a")
                    return ctx.get<number>("b") ?? -1
                },
            },
        })
        const result = await executeFinalize(
            pipeline,
            {
                a: { outcome: "skipped" },
                b: { outcome: "completed", output: 5 },
            },
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBe(5)
        expect(finalizeAGot).toBeUndefined()
    })

    it("a throwing finalize → output null + FINALIZE_UNCAUGHT_ERROR failure", async () => {
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: () => {
                    throw new Error("finalize boom")
                },
            },
        })
        const result = await executeFinalize(
            pipeline,
            { a: { outcome: "completed", output: 0 } },
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBeNull()
        const failure = result.failures.find((f) => f.stage === "finalize")
        expect(failure?.code).toBe("FINALIZE_UNCAUGHT_ERROR")
    })

    it("emits no events at all", async () => {
        const events: TPipelineEvent[] = []
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline = buildPipeline<number>({
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: (ctx) => ctx.get<number>("a") ?? -1,
            },
        })
        await executeFinalize(
            pipeline,
            { a: { outcome: "completed", output: 1 } },
            {},
            { llm: emptyMockLlm(), onEvent: (e) => events.push(e) }
        )
        expect(events).toEqual([])
    })

    it("a finalize that reads a non-dep yields output null + FINALIZE_UNCAUGHT_ERROR (mirroring executePipeline, which captures it rather than throwing out)", async () => {
        // Finalize reuses executePipeline's finalize body verbatim: a
        // ctx.get-on-non-dep raised inside finalize.run is caught as a
        // FINALIZE_UNCAUGHT_ERROR failure (output null), NOT thrown out.
        // (The throw-out disposition is specific to executeStage's
        // single-stage path.) This asserts parity with executePipeline.
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const b = deterministicStage({
            id: "b",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const finalize = {
            // finalize depends only on 'a' but reads 'b'.
            dependsOn: ["a"],
            run: (ctx: TStageContext) => {
                ctx.get<number>("b")
                return 0
            },
        }

        // executePipeline reference: the same config error is captured as
        // a FINALIZE_UNCAUGHT_ERROR, not thrown.
        const wholeResult = await executePipeline(
            buildPipeline<number>({ stages: [a, b], finalize }),
            {},
            { llm: emptyMockLlm() }
        )
        expect(wholeResult.output).toBeNull()
        expect(
            wholeResult.failures.find((f) => f.stage === "finalize")?.code
        ).toBe("FINALIZE_UNCAUGHT_ERROR")

        const result = await executeFinalize(
            buildPipeline<number>({ stages: [a, b], finalize }),
            {
                a: { outcome: "completed", output: 0 },
                b: { outcome: "completed", output: 0 },
            },
            {},
            { llm: emptyMockLlm() }
        )
        expect(result.output).toBeNull()
        expect(result.failures.find((f) => f.stage === "finalize")?.code).toBe(
            "FINALIZE_UNCAUGHT_ERROR"
        )
    })
})

// ---------------- input-parse transform: ctx.input is the Value.Parse result ----------------
//
// executeStage / executeFinalize seed ctx.input with the RESULT of
// Value.Parse(inputSchema, input), exactly as executePipeline does. When
// the inputSchema carries Default / Convert transforms AND corrective
// parsing is enabled, Value.Parse applies them — so a defaulted/converted
// field must appear in ctx.input. These cases exercise a genuinely
// transforming schema (not just agreement on a pass-through value) so the
// transform is demonstrated to fire, for both entry points. (correctiveParse
// is off by default in this TypeBox build; Value.Parse is otherwise
// validate-or-throw, applying transforms only via the corrective path —
// the same pattern test/extensions/ieee.test.ts uses for EncodableDate.)

describe("executeStage / executeFinalize — ctx.input reflects Value.Parse transforms", () => {
    beforeAll(() => Settings.Set({ correctiveParse: true }))
    afterAll(() => Settings.Set({ correctiveParse: false }))

    // A schema that defaults `limit` (omitted in the raw input) and
    // converts `count` from its string form to a number.
    const transformingInputSchema = Type.Object({
        text: Type.String(),
        limit: Type.Number({ default: 7 }),
        count: Type.Number(),
    })
    const rawInput = { text: "hi", count: "42" }
    const expectedSeed = { text: "hi", limit: 7, count: 42 }

    it("executeStage seeds ctx.input with the defaulted + converted value (identical to executePipeline)", async () => {
        let stageSawInput: unknown = "unset"
        const stage = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                stageSawInput = ctx.input
                return 1
            },
        })
        const pipeline: TPipeline<unknown, number> = {
            id: "transform-pipe",
            version: "0",
            inputSchema: transformingInputSchema,
            outputSchema: Type.Number(),
            stages: [stage],
            finalize: { dependsOn: ["a"], run: () => 0 },
        }

        // Reference: what executePipeline seeds for the same input.
        let monolithicSawInput: unknown = "unset"
        const stageForWhole = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx) => {
                monolithicSawInput = ctx.input
                return 1
            },
        })
        await executePipeline(
            { ...pipeline, stages: [stageForWhole] },
            rawInput,
            { llm: emptyMockLlm() }
        )

        await executeStage(pipeline, "a", {}, rawInput, {
            llm: emptyMockLlm(),
        })

        // The transform fired: the default + conversion are present.
        expect(stageSawInput).toEqual(expectedSeed)
        // And it matches executePipeline's seed exactly.
        expect(stageSawInput).toEqual(monolithicSawInput)
    })

    it("executeFinalize seeds ctx.input with the defaulted + converted value", async () => {
        let finalizeSawInput: unknown = "unset"
        const a = deterministicStage({
            id: "a",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: () => 0,
        })
        const pipeline: TPipeline<unknown, number> = {
            id: "transform-pipe",
            version: "0",
            inputSchema: transformingInputSchema,
            outputSchema: Type.Number(),
            stages: [a],
            finalize: {
                dependsOn: ["a"],
                run: (ctx) => {
                    finalizeSawInput = ctx.input
                    return 1
                },
            },
        }
        await executeFinalize(
            pipeline,
            { a: { outcome: "completed", output: 0 } },
            rawInput,
            { llm: emptyMockLlm() }
        )
        expect(finalizeSawInput).toEqual(expectedSeed)
    })
})

// ---------------- TStageOutcomeRecord type smoke ----------------

describe("TStageOutcomeRecord", () => {
    it("accepts both completed-with-output and skipped/failed-without-output shapes", () => {
        const completed: TStageOutcomeRecord = {
            outcome: "completed",
            output: { any: "value" },
        }
        const skipped: TStageOutcomeRecord = { outcome: "skipped" }
        const failed: TStageOutcomeRecord = { outcome: "failed" }
        expect(completed.outcome).toBe("completed")
        expect(skipped.output).toBeUndefined()
        expect(failed.output).toBeUndefined()
    })
})
