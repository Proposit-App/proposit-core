// Unit tests for `RecordingLlmProvider`.
//
//   - Record mode: writes `recorded-llm.json` with the expected
//     shape; replay finds the entry by hash.
//   - Replay mode: hash hit → recorded response.
//   - Replay mode: hash miss → throws `RecordedPromptStaleError`
//     with the stage id + filePath in the message.
//
// All tests use a temp directory + a fake underlying provider; no
// real network calls.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Type from "typebox"
import {
    RecordedPromptStaleError,
    createRecordingLlmProvider,
} from "./recording-provider.js"
import { executePipeline, llmStage } from "../../../src/lib/index.js"
import type {
    TPipeline,
    TStageContext,
} from "../../../src/lib/pipelines/index.js"
import type { TLlmProvider } from "../../../src/lib/llm/types.js"

// A minimal one-LLM-stage pipeline used only to drive the recording
// provider's record → replay → drift path end-to-end without depending
// on a concrete ingestion pipeline's multi-stage schemas. The stage's
// system prompt carries the `<!-- stage-id -->` marker the recorder
// keys on; the user message echoes the input text so a changed input
// drifts the hash.
const DriftProbeOutputSchema = Type.Object({ ok: Type.Boolean() })
function buildDriftProbePipeline(): TPipeline<
    { text: string },
    { ok: boolean }
> {
    const stage = llmStage<{ ok: boolean }>({
        id: "drift-probe",
        dependsOn: [],
        outputSchema: DriftProbeOutputSchema,
        model: "test-model",
        buildPrompt: (ctx: TStageContext) => ({
            system: "<!-- stage-id: drift-probe -->\nProbe stage.",
            user: (ctx.input as { text: string }).text,
        }),
    })
    return {
        id: "drift-probe-pipeline",
        version: "1.0.0",
        inputSchema: Type.Object({ text: Type.String() }),
        outputSchema: DriftProbeOutputSchema,
        stages: [stage],
        finalize: {
            dependsOn: ["drift-probe"],
            run: (ctx) =>
                ctx.get<{ ok: boolean }>("drift-probe") ?? { ok: false },
        },
    }
}

function makeFakeProvider(
    output: unknown,
    tokenUsage = { input: 100, output: 50 }
): TLlmProvider {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async respond<T>() {
            return {
                output: output as T,
                tokenUsage,
                rawResponseId: "fake-resp-1",
            }
        },
    }
}

const SCHEMA = Type.Object({ ok: Type.Boolean() })

describe("RecordingLlmProvider — record mode", () => {
    let dir: string
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-llm-"))
    })
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it("writes recorded-llm.json with a hashed entry after the first call", async () => {
        const underlying = makeFakeProvider({ ok: true })
        const provider = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "record",
            underlying,
        })
        const result = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "<!-- stage-id: test-stage -->\nDo a thing.",
            userMessage: "hello",
            outputSchema: SCHEMA,
        })
        expect(result.output).toEqual({ ok: true })

        const file = JSON.parse(
            fs.readFileSync(path.join(dir, "recorded-llm.json"), "utf-8")
        ) as {
            version: number
            records: {
                hash: string
                stageId: string
                request: Record<string, unknown>
                response: Record<string, unknown>
            }[]
        }
        expect(file.version).toBe(1)
        expect(file.records).toHaveLength(1)
        expect(file.records[0].stageId).toBe("test-stage")
        expect(file.records[0].hash).toMatch(/^[0-9a-f]{64}$/)
        expect(file.records[0].response.output).toEqual({ ok: true })
    })

    it("replaces an existing record when re-recording the same prompt", async () => {
        const dir2 = dir
        const first = makeFakeProvider({ ok: true })
        const recorder1 = createRecordingLlmProvider({
            fixtureDir: dir2,
            mode: "record",
            underlying: first,
        })
        await recorder1.respond({
            model: "gpt-5.4",
            systemPrompt: "S",
            userMessage: "U",
            outputSchema: SCHEMA,
        })

        const second = makeFakeProvider({ ok: false })
        const recorder2 = createRecordingLlmProvider({
            fixtureDir: dir2,
            mode: "record",
            underlying: second,
        })
        await recorder2.respond({
            model: "gpt-5.4",
            systemPrompt: "S",
            userMessage: "U",
            outputSchema: SCHEMA,
        })

        const file = JSON.parse(
            fs.readFileSync(path.join(dir2, "recorded-llm.json"), "utf-8")
        ) as { records: { response: { output: unknown } }[] }
        expect(file.records).toHaveLength(1)
        expect(file.records[0].response.output).toEqual({ ok: false })
    })

    it("throws when record mode is requested without an underlying provider", () => {
        expect(() =>
            createRecordingLlmProvider({
                fixtureDir: dir,
                mode: "record",
            })
        ).toThrow(/underlying/)
    })
})

describe("RecordingLlmProvider — replay mode", () => {
    let dir: string
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-llm-"))
    })
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it("returns the recorded response on hash hit", async () => {
        // First, record.
        const underlying = makeFakeProvider({ ok: true })
        const recorder = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "record",
            underlying,
        })
        await recorder.respond({
            model: "gpt-5.4",
            systemPrompt: "<!-- stage-id: s -->\nS",
            userMessage: "U",
            outputSchema: SCHEMA,
        })

        // Then, replay with the same input shape.
        const replayer = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "replay",
        })
        const replayed = await replayer.respond({
            model: "gpt-5.4",
            systemPrompt: "<!-- stage-id: s -->\nS",
            userMessage: "U",
            outputSchema: SCHEMA,
        })
        expect(replayed.output).toEqual({ ok: true })
        expect(replayed.tokenUsage).toEqual({ input: 100, output: 50 })
    })

    it("throws RecordedPromptStaleError with the stage id when the prompt has drifted", async () => {
        const underlying = makeFakeProvider({ ok: true })
        const recorder = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "record",
            underlying,
        })
        await recorder.respond({
            model: "gpt-5.4",
            systemPrompt: "<!-- stage-id: parse-argument -->\nORIGINAL",
            userMessage: "U",
            outputSchema: SCHEMA,
        })

        const replayer = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "replay",
        })
        await expect(
            replayer.respond({
                model: "gpt-5.4",
                systemPrompt: "<!-- stage-id: parse-argument -->\nDRIFTED",
                userMessage: "U",
                outputSchema: SCHEMA,
            })
        ).rejects.toBeInstanceOf(RecordedPromptStaleError)
    })

    it("throws RecordedPromptStaleError when the fixture file is empty", async () => {
        const replayer = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "replay",
        })
        try {
            await replayer.respond({
                model: "gpt-5.4",
                systemPrompt: "<!-- stage-id: s -->\nS",
                userMessage: "U",
                outputSchema: SCHEMA,
            })
            throw new Error("expected throw")
        } catch (err) {
            expect(err).toBeInstanceOf(RecordedPromptStaleError)
            const e = err as RecordedPromptStaleError
            expect(e.stageId).toBe("s")
            expect(e.message).toMatch(/RECORDED_PROMPT_STALE/)
        }
    })
})

describe("RecordingLlmProvider — prompt-drift guard end-to-end", () => {
    let dir: string
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-llm-drift-"))
    })
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it("catches prompt drift between record-time and replay-time pipelines", async () => {
        // Step 1: record a one-stage probe-pipeline run against a fake
        // underlying provider that returns a happy schema-shaped response.
        const recordedOutput = { ok: true }
        const fake: TLlmProvider = {
            // eslint-disable-next-line @typescript-eslint/require-await
            async respond<T>() {
                return {
                    output: recordedOutput as T,
                    tokenUsage: { input: 1, output: 1 },
                    rawResponseId: "fake-1",
                }
            },
        }
        const recorder = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "record",
            underlying: fake,
        })
        const pipeline = buildDriftProbePipeline()
        const result = await executePipeline(
            pipeline,
            { text: "A. Therefore B." },
            { llm: recorder }
        )
        expect(result.failures).toEqual([])

        // Step 2: replay with the same input text — should hit. Then
        // mutate the input text to simulate upstream prompt drift; the
        // next replay should miss and throw RecordedPromptStaleError.
        const replayer = createRecordingLlmProvider({
            fixtureDir: dir,
            mode: "replay",
        })
        const replayResult = await executePipeline(
            pipeline,
            { text: "A. Therefore B." },
            { llm: replayer }
        )
        expect(replayResult.failures).toEqual([])
        expect(replayResult.output).not.toBeNull()

        // Drift the user message — equivalent to a prompt change
        // upstream — and replay. The recording-provider's hash
        // includes the user message, so the replay misses.
        const driftedResult = await executePipeline(
            pipeline,
            { text: "Something completely different." },
            { llm: replayer }
        )
        // Pipeline catches the throw and surfaces it as a stage
        // failure. The failure code reflects the executor's classify-
        // and-collect for non-retryable errors thrown by the
        // provider; we assert the underlying RecordedPromptStaleError
        // by inspecting the failure message.
        expect(driftedResult.output).toBeNull()
        const messages = driftedResult.failures.map((f) => f.message).join("\n")
        expect(messages).toMatch(/RECORDED_PROMPT_STALE/)
    })
})
