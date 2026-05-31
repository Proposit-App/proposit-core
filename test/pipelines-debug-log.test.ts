// Unit tests for the opt-in debug logging added in v1.3.1.
//
// Surface under test: `src/lib/pipelines/debug-log.ts` (the env-gated
// emitter module) and its wiring in `executePipeline` +
// `createOpenAiResponsesProvider`. When the
// `PROPOSIT_PIPELINE_DEBUG` env var is unset (or set to anything but
// `"1" / "true" / "yes"`), every helper is a no-op — production
// pipelines must see zero stdout/stderr noise. When the env var is
// on, structured single-line `[proposit/pipeline] [<event>] {...}`
// emissions land on `console.debug` (Node default = stderr).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Type from "typebox"
import { createOpenAiResponsesProvider } from "../src/extensions/openai/provider.js"
import {
    executePipeline,
    deterministicStage,
    debugLlmRequest,
    isDebugEnabled,
    PROPOSIT_PIPELINE_DEBUG_ENV_VAR,
    PROPOSIT_PIPELINE_DEBUG_PREFIX,
} from "../src/lib/pipelines/index.js"
import { createMockLlmProvider } from "./mocks/llm.js"
import type { TOpenAiFetch } from "../src/extensions/openai/types.js"
import type { TPipeline } from "../src/lib/pipelines/index.js"

// -- console.debug interception ---------------------------------------
//
// We swap `console.debug` for a recording function rather than using
// `vi.spyOn`. `spyOn` returns `MockInstance<any>` under the strict
// type-checked ESLint config — every downstream `.mock.calls[i][j]`
// becomes an `any`-typed access and trips no-unsafe-member-access /
// no-unsafe-call. The plain-function swap keeps the recorded calls
// strongly typed (string[]) and respects the lib's strict-types
// settings.

type TConsoleDebug = (...args: unknown[]) => void

function captureDebugCalls(): {
    lines: string[]
    restore: () => void
} {
    const lines: string[] = []
    const original = console.debug as TConsoleDebug
    console.debug = ((...args: unknown[]) => {
        const first = args[0]
        lines.push(typeof first === "string" ? first : String(first))
    }) as TConsoleDebug
    return {
        lines,
        restore: () => {
            console.debug = original
        },
    }
}

// -- env-var gate ------------------------------------------------------

describe("isDebugEnabled", () => {
    const original = process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
    afterEach(() => {
        if (original === undefined) {
            delete process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
        } else {
            process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR] = original
        }
    })

    it("is false when unset", () => {
        delete process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
        expect(isDebugEnabled()).toBe(false)
    })

    it("is true for '1', 'true', 'yes' (case-insensitive)", () => {
        for (const v of ["1", "true", "True", "YES", "yes"]) {
            process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR] = v
            expect(isDebugEnabled()).toBe(true)
        }
    })

    it("is false for '0', 'false', empty, garbage", () => {
        for (const v of ["0", "false", "", "no", "garbage"]) {
            process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR] = v
            expect(isDebugEnabled()).toBe(false)
        }
    })
})

// -- no-op when disabled -----------------------------------------------

describe("debug helpers are no-ops when env var is unset", () => {
    const original = process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
    let capture: ReturnType<typeof captureDebugCalls>

    beforeEach(() => {
        delete process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
        capture = captureDebugCalls()
    })
    afterEach(() => {
        capture.restore()
        if (original === undefined) {
            delete process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
        } else {
            process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR] = original
        }
    })

    it("debugLlmRequest does not call console.debug", () => {
        debugLlmRequest({
            stageId: "x",
            model: "gpt-5.4",
            systemPromptLen: 1,
            userMessageLen: 1,
            systemPromptHead: "s",
            userMessageHead: "u",
        })
        expect(capture.lines).toHaveLength(0)
    })

    it("executePipeline does not emit any [proposit/pipeline] lines", async () => {
        const pipeline: TPipeline<{ x: number }, number> = {
            id: "noop",
            version: "1.0.0",
            inputSchema: Type.Object({ x: Type.Number() }),
            outputSchema: Type.Number(),
            stages: [
                deterministicStage<number>({
                    id: "double",
                    dependsOn: [],
                    outputSchema: Type.Number(),
                    fn: (ctx) => (ctx.input as { x: number }).x * 2,
                }),
            ],
            finalize: {
                dependsOn: ["double"],
                run: (ctx) => ctx.get<number>("double") ?? 0,
            },
        }
        const llm = createMockLlmProvider({ responses: {} })
        await executePipeline(pipeline, { x: 21 }, { llm })
        const ourLines = capture.lines.filter((line) =>
            line.startsWith(PROPOSIT_PIPELINE_DEBUG_PREFIX)
        )
        expect(ourLines).toEqual([])
    })
})

// -- emits when enabled ------------------------------------------------

describe("debug helpers emit on console.debug when env var is on", () => {
    const original = process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
    let capture: ReturnType<typeof captureDebugCalls>

    beforeEach(() => {
        process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR] = "1"
        capture = captureDebugCalls()
    })
    afterEach(() => {
        capture.restore()
        if (original === undefined) {
            delete process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
        } else {
            process.env[PROPOSIT_PIPELINE_DEBUG_ENV_VAR] = original
        }
    })

    it("emits pipeline:start, stage:start, stage:end, pipeline:end with the prefix", async () => {
        const pipeline: TPipeline<{ x: number }, number> = {
            id: "demo",
            version: "1.0.0",
            inputSchema: Type.Object({ x: Type.Number() }),
            outputSchema: Type.Number(),
            stages: [
                deterministicStage<number>({
                    id: "double",
                    dependsOn: [],
                    outputSchema: Type.Number(),
                    fn: (ctx) => (ctx.input as { x: number }).x * 2,
                }),
            ],
            finalize: {
                dependsOn: ["double"],
                run: (ctx) => ctx.get<number>("double") ?? 0,
            },
        }
        const llm = createMockLlmProvider({ responses: {} })
        await executePipeline(pipeline, { x: 21 }, { llm })

        const messages = capture.lines.filter((line) =>
            line.startsWith(PROPOSIT_PIPELINE_DEBUG_PREFIX)
        )
        // Bookends + per-stage start/end:
        expect(messages.some((m) => m.includes("[pipeline:start]"))).toBe(true)
        expect(messages.some((m) => m.includes("[pipeline:end]"))).toBe(true)
        expect(messages.some((m) => m.includes("[stage:start]"))).toBe(true)
        expect(messages.some((m) => m.includes("[stage:end]"))).toBe(true)
        // pipeline:start payload includes the root stage list.
        const startLine = messages.find((m) => m.includes("[pipeline:start]"))
        expect(startLine).toContain('"rootStages":["double"]')
        // pipeline:end payload reports the final status + durationMs.
        const endLine = messages.find((m) => m.includes("[pipeline:end]"))
        expect(endLine).toContain('"status":"completed"')
        expect(endLine).toContain('"output":"present"')
        expect(endLine).toMatch(/"durationMs":\d/)
    })

    it("OpenAI provider emits llm:request + llm:response on the happy path", async () => {
        const successJson = {
            id: "resp_dbg_1",
            status: "completed",
            output: [
                {
                    type: "message",
                    role: "assistant",
                    content: [
                        {
                            type: "output_text",
                            text: JSON.stringify({ answer: "ok" }),
                        },
                    ],
                },
            ],
            usage: { input_tokens: 10, output_tokens: 3 },
        }
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify(successJson), { status: 200 })
            )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: fetchMock as unknown as TOpenAiFetch,
            stream: false,
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "<!-- stage-id: demo-stage -->\nsystem",
            userMessage: "hi",
            outputSchema: Type.Object({ answer: Type.String() }),
            maxOutputTokens: 1024,
        })

        const messages = capture.lines.filter((line) =>
            line.startsWith(PROPOSIT_PIPELINE_DEBUG_PREFIX)
        )
        // The provider correlates by the system-prompt stage marker.
        const requestLine = messages.find((m) => m.includes("[llm:request]"))
        const responseLine = messages.find((m) => m.includes("[llm:response]"))
        expect(requestLine).toBeDefined()
        expect(responseLine).toBeDefined()
        expect(requestLine).toContain('"stageId":"demo-stage"')
        expect(requestLine).toContain('"model":"gpt-5.4"')
        expect(requestLine).toContain('"maxOutputTokens":1024')
        expect(responseLine).toContain('"status":"completed"')
        expect(responseLine).toContain('"tokenUsage":{"input":10,"output":3}')
    })

    it("OpenAI provider emits llm:failure with the truncated rawText on status: incomplete", async () => {
        const incompleteJson = {
            id: "resp_dbg_inc",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [
                {
                    type: "message",
                    role: "assistant",
                    content: [
                        {
                            type: "output_text",
                            text: '{"segments":[{"segmentId":"s1","text":"It rai',
                        },
                    ],
                },
            ],
            usage: { input_tokens: 4000, output_tokens: 80 },
        }
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify(incompleteJson), { status: 200 })
            )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: fetchMock as unknown as TOpenAiFetch,
            stream: false,
        })

        await expect(
            provider.respond({
                model: "gpt-5.4-mini",
                systemPrompt: "<!-- stage-id: segmentation -->\nsys",
                userMessage: "big input",
                outputSchema: Type.Object({ answer: Type.String() }),
            })
        ).rejects.toMatchObject({ name: "TransientLlmError" })

        const messages = capture.lines.filter((line) =>
            line.startsWith(PROPOSIT_PIPELINE_DEBUG_PREFIX)
        )
        const failLine = messages.find((m) => m.includes("[llm:failure]"))
        expect(failLine).toBeDefined()
        expect(failLine).toContain('"stageId":"segmentation"')
        expect(failLine).toContain('"incompleteReason":"max_output_tokens"')
        // The truncated rawText is dumped so the dev can see what
        // the model managed to emit before the cap fired.
        expect(failLine).toContain('"rawText":')
        expect(failLine).toContain("segmentId")
    })
})
