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
//
// **Fixture rigidity is intentional.** Recorded fixtures pin specific
// v1 LLM outputs. CI failures here fall into two buckets, both of
// which are signals to investigate — not flake:
//
//   1. **Prompt-drift guard fires** (`RecordedPromptStaleError` /
//      `RECORDED_PROMPT_STALE`). The request hash includes the
//      model, system prompt, user message, and output schema; any
//      change to `buildParsingPrompt`, the response schema, or the
//      pipeline's request-shape construction invalidates the hash.
//      Re-record with `INGESTION_TEST_RECORD=1`; review the diff in
//      `recorded-llm.json` to confirm the change was intended.
//
//   2. **`expected.json` mismatch on re-record.** If the live model
//      produces a meaningfully different response (e.g. picks a
//      different conclusion on `ambiguous-conclusion`, or adds an
//      implicit premise on `enthymeme`), the fixture's
//      `expected.json` will diverge. That's a load-bearing finding —
//      it means either the model's behavior has shifted or the
//      fixture's assumptions were too brittle. Review by hand
//      before committing the new `expected.json`.
//
// Each `expected.json` carries a `parity` field declaring the
// fixture's intent for a future v1↔v2 parity test:
// `"strict"` means v1 and v2 should match byte-for-byte;
// `"v2-strict-upgrade"` means v1's behavior is being pinned for
// historical reference but v2 is expected to upgrade the outcome
// (e.g., `ambiguous-conclusion` should soft-fail under v2). The e2e
// driver does not consume `parity` today; it's metadata for a future
// v2 reviewer.

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

type TExpectedFile = Record<string, unknown> & {
    parity?: "strict" | "v2-strict-upgrade" | "v2-only"
}

function readExpected(fixtureDir: string): TExpectedFile | undefined {
    const p = path.join(fixtureDir, "expected.json")
    if (!fs.existsSync(p)) return undefined
    return JSON.parse(fs.readFileSync(p, "utf-8")) as TExpectedFile
}

/**
 * Split `expected.json` into (a) the per-fixture metadata (currently
 * just `parity`) and (b) the runtime output the pipeline should
 * reproduce. Metadata fields don't appear in the runtime output and
 * are excluded from the equality comparison.
 */
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
    // Preserve any caller-supplied metadata (parity label) at the
    // top of the file; the pipeline's runtime output follows.
    const body: TExpectedFile = parity ? { parity, ...runtime } : { ...runtime }
    fs.writeFileSync(
        path.join(fixtureDir, "expected.json"),
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
        })
    }
    return createRecordingLlmProvider({ fixtureDir, mode: "replay" })
}

const mode = recordingMode()

// Pin the `parity` field shape across all fixtures — metadata for a
// future v1↔v2 parity test. Each fixture must declare its intent so a
// future reviewer can read it without spelunking the runtime output.
describe("v1 ingestion pipeline — fixture parity labels", () => {
    const VALID_PARITY = new Set(["strict", "v2-strict-upgrade", "v2-only"])
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        const has = fs.existsSync(path.join(fixtureDir, "expected.json"))
        const itOrSkip = has ? it : it.skip
        itOrSkip(`${name}: expected.json declares a valid parity field`, () => {
            const expected = readExpected(fixtureDir)
            expect(expected).toBeDefined()
            expect(expected?.parity).toBeDefined()
            expect(VALID_PARITY.has(expected!.parity as string)).toBe(true)
        })
    }
})

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
                    // Always overwrite the expected.json in record
                    // mode so the dev reviews the draft and re-
                    // commits. Preserve the existing `parity` label
                    // (if any) — the recording step doesn't change
                    // the fixture's parity intent.
                    const prior = readExpected(fixtureDir)
                    writeExpected(fixtureDir, actual, prior?.parity)
                    return
                }

                const expected = readExpected(fixtureDir)
                if (expected === undefined) {
                    throw new Error(
                        `Fixture ${name} has no expected.json. Re-record with INGESTION_TEST_RECORD=1.`
                    )
                }
                const { runtime } = splitExpected(expected)
                expect(actual).toEqual(runtime)
            }
        )
    }
})
