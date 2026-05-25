// Framework unit tests for src/lib/pipelines.
//
// Coverage areas (one describe block each), matching the slice 1A
// test plan in docs/superpowers/briefings/ingestion-pipeline-proposit-core-agenda.md
// §test-plan and spec §11.1:
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

import { describe, expect, it } from "vitest"
import Type from "typebox"
import {
    DEFAULT_RETRY_POLICY,
    LlmStageRetryExhaustedError,
    PipelineConfigurationError,
    StageAbortedError,
    SubPipelineFailedError,
    deterministicStage,
    executePipeline,
    llmStage,
    optional,
    subPipelineStage,
} from "../src/lib/index.js"
import type {
    TPipeline,
    TPipelineEvent,
    TStage,
    TStageContext,
} from "../src/lib/index.js"
import {
    createMockLlmProvider,
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
        expect(DEFAULT_RETRY_POLICY.maxAppendedErrorBytes).toBe(2048)
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

// ---------------- Slice 1A.1 — reviewer fold ----------------

// P2 #1 — Mid-flight abort surfaces as `skipped` with no ProcessingFailure.
describe("slice 1A.1 — P2 #1: mid-flight abort surfaces as skipped", () => {
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

// P3 #1 — Abort fast-path emits paired stage:start / stage:end.
describe("slice 1A.1 — P3 #1: abort fast-path emits paired start/end events", () => {
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

// P3 #2 — Optional-dep cycle detection.
describe("slice 1A.1 — P3 #2: optional-dep cycle detection", () => {
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

// P3 #3 — ctx.stageStatus enforces the same dep allowlist as ctx.get.
describe("slice 1A.1 — P3 #3: ctx.stageStatus enforces dep allowlist", () => {
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

// P3 #5 — subPipelineStage null-output throws SubPipelineFailedError.
describe("slice 1A.1 — P3 #5: subPipelineStage null-output throws SubPipelineFailedError", () => {
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

// ---------------- Slice 2C.A — stage:llm-call event ----------------
//
// Tests for the new `stage:llm-call` event variant. The event must fire
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
            "stage:llm-call",
            "stage:retry",
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
            "stage:llm-call",
            "stage:retry",
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
