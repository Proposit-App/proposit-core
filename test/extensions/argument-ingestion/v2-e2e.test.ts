// Golden-corpus e2e test driver for the v2 multi-stage ingestion
// pipeline. Mirrors the v1 e2e driver (`e2e.test.ts`) but reads + writes
// `v2-recorded-llm.json` + `v2-expected.json` per fixture, so v1 and
// v2 recordings live side-by-side in each fixture directory.
//
// Mode is controlled by the `INGESTION_TEST_RECORD` env var:
//
//   - `INGESTION_TEST_RECORD=1` + `OPENAI_API_KEY` → record mode. Each
//     fixture invokes the real OpenAI Responses API once per stage;
//     all per-stage request/response pairs are written to
//     `<fixture>/v2-recorded-llm.json`, and a draft
//     `<fixture>/v2-expected.json` is populated from the assembled
//     pipeline output for human review.
//
//   - unset → replay mode. The provider replays from
//     `<fixture>/v2-recorded-llm.json` (no API key required); the
//     pipeline's final output is asserted against
//     `<fixture>/v2-expected.json`.
//
// Each fixture is skipped in replay mode if its `v2-recorded-llm.json`
// is missing — the dev records once (with a real API key) and commits
// the file; subsequent CI runs find it and the skip clears.
//
// **Fixture rigidity is intentional** — see `e2e.test.ts` for the v1
// version of this note. CI failures here fall into two buckets,
// neither of which is flake:
//
//   1. Prompt-drift guard fires (RecordedPromptStaleError) — a v2
//      stage's prompt changed since the last recording. Re-record.
//   2. `v2-expected.json` mismatch on re-record — the live model's
//      behavior shifted (or the fixture's assumptions were too
//      brittle). Review by hand before committing the new expected.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
    basicsExtension,
    createIngestionV2Pipeline,
    createOpenAiResponsesProvider,
    executePipeline,
} from "../../../src/lib/index.js"
import {
    createRecordingLlmProvider,
    recordingMode,
} from "./recording-provider.js"
import type { TLlmProvider } from "../../../src/lib/llm/types.js"

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures")
const V2_RECORDED_FILE = "v2-recorded-llm.json"
const V2_EXPECTED_FILE = "v2-expected.json"
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

type TExpectedFile = Record<string, unknown> & {
    parity?: "strict" | "v2-strict-upgrade" | "v2-only"
}

function readExpected(fixtureDir: string): TExpectedFile | undefined {
    const p = path.join(fixtureDir, V2_EXPECTED_FILE)
    if (!fs.existsSync(p)) return undefined
    return JSON.parse(fs.readFileSync(p, "utf-8")) as TExpectedFile
}

function splitExpected(expected: TExpectedFile): {
    parity: TExpectedFile["parity"]
    runtime: Record<string, unknown>
} {
    const { parity, ...runtime } = expected
    return { parity, runtime }
}

function writeExpected(
    fixtureDir: string,
    runtime: Record<string, unknown>,
    parity: TExpectedFile["parity"]
): void {
    const body: TExpectedFile = parity ? { parity, ...runtime } : { ...runtime }
    fs.writeFileSync(
        path.join(fixtureDir, V2_EXPECTED_FILE),
        JSON.stringify(body, null, 2) + "\n",
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
            fileName: V2_RECORDED_FILE,
        })
    }
    return createRecordingLlmProvider({
        fixtureDir,
        mode: "replay",
        fileName: V2_RECORDED_FILE,
    })
}

// Inherit parity labels from v1's expected.json when the v2 expected
// hasn't been authored yet — the parity intent is a fixture-level
// property, not per-pipeline. Reviewers should still hand-audit the
// label when committing v2-expected.json.
function inheritParityFromV1(
    fixtureDir: string
): TExpectedFile["parity"] | undefined {
    const v1Path = path.join(fixtureDir, "expected.json")
    if (!fs.existsSync(v1Path)) return undefined
    const v1 = JSON.parse(fs.readFileSync(v1Path, "utf-8")) as TExpectedFile
    return v1.parity
}

const mode = recordingMode()

describe("v2 ingestion pipeline — fixture parity labels", () => {
    const VALID_PARITY = new Set(["strict", "v2-strict-upgrade", "v2-only"])
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        const has = fs.existsSync(path.join(fixtureDir, V2_EXPECTED_FILE))
        const itOrSkip = has ? it : it.skip
        itOrSkip(
            `${name}: v2-expected.json declares a valid parity field`,
            () => {
                const expected = readExpected(fixtureDir)
                expect(expected).toBeDefined()
                expect(expected?.parity).toBeDefined()
                expect(VALID_PARITY.has(expected!.parity as string)).toBe(true)
            }
        )
    }
})

describe(`v2 ingestion pipeline — golden corpus (${mode} mode)`, () => {
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        const recordedPath = path.join(fixtureDir, V2_RECORDED_FILE)
        const hasRecording = fs.existsSync(recordedPath)
        // Skip in replay mode if recording is missing — the recording
        // step (one-time, with a real API key) hasn't happened yet.
        const itOrSkip = mode === "record" || hasRecording ? it : it.skip
        itOrSkip(
            `${name}: replays the recorded provider and matches v2-expected.json`,
            { timeout: 300_000 },
            async () => {
                const provider = buildProviderForMode(fixtureDir)
                const pipeline = createIngestionV2Pipeline(basicsExtension)
                const input = { text: readInput(fixtureDir) }
                const result = await executePipeline(pipeline, input, {
                    llm: provider,
                })

                if (mode === "record") {
                    // Always overwrite the v2-expected.json in record
                    // mode so the dev reviews the draft and re-commits.
                    expect(result.output).not.toBeNull()
                    const actual = result.output as Record<string, unknown>
                    const prior = readExpected(fixtureDir)
                    const parity =
                        prior?.parity ?? inheritParityFromV1(fixtureDir)
                    writeExpected(fixtureDir, actual, parity)
                    return
                }

                const expected = readExpected(fixtureDir)
                if (expected === undefined) {
                    throw new Error(
                        `Fixture ${name} has no v2-expected.json. Re-record with INGESTION_TEST_RECORD=1.`
                    )
                }
                const { runtime } = splitExpected(expected)
                expect(result.output).not.toBeNull()
                const actual = result.output as Record<string, unknown>
                expect(actual).toEqual(runtime)
            }
        )
    }
})
