// Golden-corpus e2e test driver for the v1 ingestion pipeline.
//
// Mode is controlled by the `INGESTION_TEST_RECORD` env var:
//
//   - `INGESTION_TEST_RECORD=1` + `OPENAI_API_KEY` → record mode.
//     Each fixture invokes the real OpenAI Responses API once; the
//     recorded request/response is written to
//     `<fixture>/recorded-llm.json`, and a draft `expected.json` is
//     populated from the actual v1 output for human review.
//
//   - unset → replay mode. The provider replays from
//     `<fixture>/recorded-llm.json` (no API key required); the
//     pipeline's final output is asserted against `<fixture>/expected.json`.
//
// The prompt-drift guard inside `RecordingLlmProvider` throws
// `RecordedPromptStaleError` on hash miss — any change to
// `buildParsingPrompt`, the response schema, or the request shape
// will fail CI until the corpus is re-recorded.
//
// Recording instructions:
//
//   INGESTION_TEST_RECORD=1 \
//     OPENAI_API_KEY=$(grep ^OPENAI_API_KEY= .env.development | cut -d= -f2) \
//     pnpm vitest run test/extensions/argument-ingestion/e2e.test.ts
//
// Then review each `<fixture>/expected.json` — they encode the v1
// behavior we want CI to pin (including edge cases like v1's force-
// choice on the `ambiguous-conclusion` fixture and the
// enthymeme-claim-preservation behavior).

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
    basicsExtension,
    createIngestionV1Pipeline,
    createOpenAiResponsesProvider,
    executePipeline,
} from "../../../src/lib/index.js"
import {
    createRecordingLlmProvider,
    recordingMode,
} from "./recording-provider.js"
import type { TLlmProvider } from "../../../src/lib/llm/types.js"

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures")
const FIXTURE_NAMES = [
    "straightforward",
    "with-url-citation",
    "with-axiom",
    "ambiguous-conclusion",
    "enthymeme",
] as const

function loadApiKey(): string | undefined {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
    const envPath = path.resolve(
        import.meta.dirname,
        "../../../.env.development"
    )
    if (!fs.existsSync(envPath)) return undefined
    const content = fs.readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
        const match = /^OPENAI_API_KEY=(.+)$/.exec(line)
        if (match) return match[1].trim()
    }
    return undefined
}

function readInput(fixtureDir: string): string {
    return fs.readFileSync(path.join(fixtureDir, "input.txt"), "utf-8").trim()
}

function readExpected(fixtureDir: string): unknown {
    const p = path.join(fixtureDir, "expected.json")
    if (!fs.existsSync(p)) return undefined
    return JSON.parse(fs.readFileSync(p, "utf-8")) as unknown
}

function writeExpected(fixtureDir: string, value: unknown): void {
    fs.writeFileSync(
        path.join(fixtureDir, "expected.json"),
        JSON.stringify(value, null, 2) + "\n",
        "utf-8"
    )
}

function buildProviderForMode(fixtureDir: string): TLlmProvider {
    const mode = recordingMode()
    if (mode === "record") {
        const apiKey = loadApiKey()
        if (!apiKey) {
            throw new Error(
                "INGESTION_TEST_RECORD=1 requires OPENAI_API_KEY (env var or .env.development)."
            )
        }
        const underlying = createOpenAiResponsesProvider({ apiKey })
        return createRecordingLlmProvider({
            fixtureDir,
            mode: "record",
            underlying,
        })
    }
    return createRecordingLlmProvider({ fixtureDir, mode: "replay" })
}

const mode = recordingMode()

describe(`v1 ingestion pipeline — golden corpus (${mode} mode)`, () => {
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        const recordedPath = path.join(fixtureDir, "recorded-llm.json")
        const hasRecording = fs.existsSync(recordedPath)
        // Skip a fixture in replay mode if its `recorded-llm.json` is
        // missing — the recording step (one-time, with a real API
        // key) hasn't happened yet. The dev agent records once and
        // commits the files; subsequent CI runs find them and the
        // skip clears.
        const itOrSkip = mode === "record" || hasRecording ? it : it.skip
        itOrSkip(
            `${name}: replays the recorded provider and matches expected.json`,
            { timeout: 120_000 },
            async () => {
                const provider = buildProviderForMode(fixtureDir)
                const pipeline = createIngestionV1Pipeline(basicsExtension)
                const input = { text: readInput(fixtureDir) }
                const result = await executePipeline(pipeline, input, {
                    llm: provider,
                })
                expect(result.failures).toEqual([])
                expect(result.output).not.toBeNull()
                const actual = result.output as Record<string, unknown>

                if (mode === "record") {
                    // Always overwrite the expected.json in record mode
                    // so the dev reviews the draft and re-commits.
                    writeExpected(fixtureDir, actual)
                    return
                }

                const expected = readExpected(fixtureDir)
                if (expected === undefined) {
                    throw new Error(
                        `Fixture ${name} has no expected.json. Re-record with INGESTION_TEST_RECORD=1.`
                    )
                }
                expect(actual).toEqual(expected)
            }
        )
    }
})
