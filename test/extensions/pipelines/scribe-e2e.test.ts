// Golden-corpus e2e test driver for the scribe (fast, two-call)
// ingestion pipeline. Mirrors the scholar driver (`v2-e2e.test.ts`) but
// reads + writes `scribe-recorded-llm.json` + `scribe-expected.json` per
// fixture, so scholar and scribe recordings live side-by-side in each
// fixture directory.
//
// Mode is controlled by the `INGESTION_TEST_RECORD` env var:
//
//   - `INGESTION_TEST_RECORD=1` + `OPENAI_API_KEY` → record mode. Each
//     fixture invokes the real OpenAI Responses API once per LLM stage
//     (scribe has two: `extract`, `scribe-structure`); the pairs are
//     written to `<fixture>/scribe-recorded-llm.json`, and a draft
//     `<fixture>/scribe-expected.json` is populated for human review.
//
//   - unset → replay mode. The provider replays from
//     `<fixture>/scribe-recorded-llm.json` (no API key); the pipeline's
//     final output is asserted against `<fixture>/scribe-expected.json`.
//
// Until a dev records the scribe fixtures (with a real key), no
// `scribe-recorded-llm.json` files exist, so every fixture is skipped —
// the suite is inert. Recording one fixture clears its skip.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { executePipeline } from "../../../src/lib/index.js"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/scribe.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/basics-extension.js"
import {
    createRecordingLlmProvider,
    recordingMode,
} from "./recording-provider.js"
import type { TLlmProvider } from "../../../src/lib/llm/types.js"

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures")
const SCRIBE_RECORDED_FILE = "scribe-recorded-llm.json"
const SCRIBE_EXPECTED_FILE = "scribe-expected.json"
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

type TExpectedFile = Record<string, unknown> & { parity?: string }

function readExpected(fixtureDir: string): TExpectedFile | undefined {
    const p = path.join(fixtureDir, SCRIBE_EXPECTED_FILE)
    if (!fs.existsSync(p)) return undefined
    return JSON.parse(fs.readFileSync(p, "utf-8")) as TExpectedFile
}

function splitExpected(expected: TExpectedFile): {
    runtime: Record<string, unknown>
} {
    const { parity: _parity, ...runtime } = expected
    return { runtime }
}

function writeExpected(
    fixtureDir: string,
    runtime: Record<string, unknown>
): void {
    fs.writeFileSync(
        path.join(fixtureDir, SCRIBE_EXPECTED_FILE),
        JSON.stringify(runtime, null, 2) + "\n",
        "utf-8"
    )
}

// Deterministic, counter-based generateId so minted variable/premise
// ids are stable across record + replay (see the scholar driver for the
// rationale).
function createDeterministicGenerateId(prefix = "gid"): () => string {
    let counter = 0
    return () => {
        counter += 1
        return `${prefix}-${String(counter)}`
    }
}

function buildProviderForMode(fixtureDir: string): TLlmProvider {
    if (recordingMode() === "record") {
        const apiKey = loadApiKey()
        if (!apiKey) {
            throw new Error(
                "INGESTION_TEST_RECORD=1 requires OPENAI_API_KEY (env var or .env.development)."
            )
        }
        return createRecordingLlmProvider({
            fixtureDir,
            mode: "record",
            underlying: createOpenAiResponsesProvider({ apiKey }),
            fileName: SCRIBE_RECORDED_FILE,
        })
    }
    return createRecordingLlmProvider({
        fixtureDir,
        mode: "replay",
        fileName: SCRIBE_RECORDED_FILE,
    })
}

const mode = recordingMode()

describe(`scribe ingestion pipeline — golden corpus (${mode} mode)`, () => {
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        const hasRecording = fs.existsSync(
            path.join(fixtureDir, SCRIBE_RECORDED_FILE)
        )
        // In replay mode (CI + default), skip any fixture whose scribe
        // recording has not been captured yet — the suite is inert until
        // a dev records it with a real API key.
        const itOrSkip = mode === "record" || hasRecording ? it : it.skip

        itOrSkip(`${name}: scribe output matches the golden`, async () => {
            const provider = buildProviderForMode(fixtureDir)
            const result = await executePipeline(
                createScribePipeline(basicsExtension),
                { text: readInput(fixtureDir) },
                { llm: provider, generateId: createDeterministicGenerateId() }
            )

            if (mode === "record") {
                writeExpected(
                    fixtureDir,
                    result.output as unknown as Record<string, unknown>
                )
                return
            }

            const expected = readExpected(fixtureDir)
            expect(expected).toBeDefined()
            const { runtime } = splitExpected(expected!)
            expect(result.output).toEqual(runtime)
        })
    }
})
