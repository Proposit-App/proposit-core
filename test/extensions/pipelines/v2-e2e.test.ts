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
    createOpenAiResponsesProvider,
    executePipeline,
} from "../../../src/lib/index.js"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/scholar.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/basics-extension.js"
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

// **Deterministic id generation for golden-corpus replay.**
// `variable-assignment` and `formula-compilation` mint fresh variable
// + premise miniIds via `ctx.generateId()`. The framework default is
// `crypto.randomUUID()` (set in `executePipeline`'s
// `defaultGenerateId`), which produces a different identifier on every
// invocation. The recording run therefore committed UUIDs into the
// `v2-expected.json` fixtures; subsequent replay runs minted fresh
// UUIDs and the deep-equal assertion blew up on every fixture that
// had a non-null `argument` (4 of 5 — `ambiguous-conclusion` was the
// exception because its output is `{ argument: null, ... }` with no
// minted ids).
//
// Approach: inject a deterministic counter-based `generateId` into
// the e2e test's `executePipeline`
// call. Production behavior (and every other test path) keeps the
// UUID default — only the golden-corpus harness gets the deterministic
// version, used consistently across record + replay so the recorded
// expected and the replay output share the same id sequence.
//
// A fresh counter per fixture means ids restart at 1 on each pipeline
// run; the alphabetic prefix avoids collision with the canonicalizer's
// claim miniIds (`c1`, `c2`, ...) and the relation/source/axiom ids
// emitted by upstream stages (`r1`, `src1`, `ax1`).
function createDeterministicGenerateId(prefix = "gid"): () => string {
    let counter = 0
    return () => {
        counter += 1
        return `${prefix}-${String(counter)}`
    }
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

describe("scholar ingestion pipeline — fixture parity labels", () => {
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

describe(`scholar ingestion pipeline — golden corpus (${mode} mode)`, () => {
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        const recordedPath = path.join(fixtureDir, V2_RECORDED_FILE)
        const expectedPath = path.join(fixtureDir, V2_EXPECTED_FILE)
        const hasRecording = fs.existsSync(recordedPath)
        const hasExpected = fs.existsSync(expectedPath)
        // Skip in replay mode unless BOTH `v2-recorded-llm.json` AND
        // `v2-expected.json` exist. A `v2-recorded-llm.json` alone
        // indicates a partial recording (e.g. a prior recording
        // attempt crashed before reaching `finalize`); the assembled
        // expected output never got written. Treat that as
        // "recording not yet complete" → skip, not fail. Only when
        // both files are committed is the fixture truly ready for
        // replay.
        const itOrSkip =
            mode === "record" || (hasRecording && hasExpected) ? it : it.skip
        itOrSkip(
            `${name}: replays the recorded provider and matches v2-expected.json`,
            { timeout: 300_000 },
            async () => {
                const provider = buildProviderForMode(fixtureDir)
                const pipeline = createScholarPipeline(basicsExtension)
                const input = { text: readInput(fixtureDir) }
                const result = await executePipeline(pipeline, input, {
                    llm: provider,
                    generateId: createDeterministicGenerateId(),
                })

                if (mode === "record") {
                    // Always overwrite the v2-expected.json in record
                    // mode so the dev reviews the draft and re-commits.
                    if (result.output === null) {
                        // Diagnostic surfacing for the recording bug
                        // chain. The bare `expect(result.output).not.
                        // toBeNull()` assertion below tells us
                        // *whether* the pipeline succeeded but not
                        // *which stage* failed; dump the executor's
                        // bookkeeping so the human running the
                        // recording sees the per-stage outcome map +
                        // every emitted ProcessingFailure (with the
                        // stage id, code, message, and any context
                        // payload). Token usage often helps too —
                        // zero tokens means no LLM call landed; non-
                        // zero usage with output: null means an
                        // upstream stage succeeded but a downstream
                        // one (or finalize's required-dep gate)
                        // brought the result to null.
                        console.error(
                            `[v2-e2e] ${name} output: null. Diagnostic dump:`
                        )
                        console.error(
                            "  stageOutcomes:",
                            JSON.stringify(result.stageOutcomes, null, 2)
                        )
                        console.error(
                            "  failures:",
                            JSON.stringify(result.failures, null, 2)
                        )
                        console.error(
                            "  tokenUsage:",
                            JSON.stringify(result.tokenUsage, null, 2)
                        )
                    }
                    expect(result.output).not.toBeNull()
                    const actual = result.output as Record<string, unknown>
                    const prior = readExpected(fixtureDir)
                    const parity =
                        prior?.parity ?? inheritParityFromV1(fixtureDir)
                    writeExpected(fixtureDir, actual, parity)
                    return
                }

                // Optional rewrite mode: when
                // `REWRITE_V2_EXPECTED=1` is set and we're in replay
                // (so no live LLM calls are made), the test rewrites
                // `v2-expected.json` from the assembled pipeline output
                // and exits without asserting. Used after a
                // deterministic-only change (e.g., the
                // `createDeterministicGenerateId` introduction) where
                // the LLM recordings stay valid but the assembled
                // expected output needs to be regenerated. **Do not
                // commit the rewritten files without manual review.**
                if (
                    process.env.REWRITE_V2_EXPECTED === "1" &&
                    result.output !== null
                ) {
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
                if (result.output === null) {
                    // Same diagnostic dump on the replay branch — a
                    // recording exists but the assembled output is
                    // null. Useful when re-running replay after a
                    // schema change or new stage adjustment.
                    console.error(
                        `[v2-e2e] ${name} replay output: null. Diagnostic dump:`
                    )
                    console.error(
                        "  stageOutcomes:",
                        JSON.stringify(result.stageOutcomes, null, 2)
                    )
                    console.error(
                        "  failures:",
                        JSON.stringify(result.failures, null, 2)
                    )
                }
                expect(result.output).not.toBeNull()
                const actual = result.output as Record<string, unknown>
                expect(actual).toEqual(runtime)
            }
        )
    }
})
