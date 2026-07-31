// Golden-corpus e2e test driver for the scholar (multi-stage)
// ingestion pipeline. Reads + writes `v2-recorded-llm.json` +
// `v2-expected.json` per fixture (the recorded-data filenames predate
// the role rename and are kept as-is — the recordings are byte-identical
// across the rename, which is the point).
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
// **Fixture rigidity is intentional.** CI failures here fall into two
// buckets, neither of which is flake:
//
//   1. Prompt-drift guard fires (RecordedPromptStaleError) — a scholar
//      stage's prompt changed since the last recording. Re-record.
//   2. `v2-expected.json` mismatch on re-record — the live model's
//      behavior shifted (or the fixture's assumptions were too
//      brittle). Review by hand before committing the new expected.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { executePipeline } from "../../../src/lib/index.js"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/index.js"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/scholar.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/basics-extension.js"
import {
    countingLlmProvider,
    createRecordingLlmProvider,
    recordingMode,
} from "./recording-provider.js"
import { SOURCE_ANCHOR_CONTEXT_CHARS } from "../../../src/extensions/pipelines/base/index.js"
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

// The pipeline's 8 LLM stages (segmentation, claim-mention-extraction,
// citation-source-detection, axiom-indicator-detection,
// claim-canonicalization, claim-type-classification, relation-extraction,
// conclusion-selection); the other 4 are deterministic. Asserted per
// fixture so any change that quietly adds model work fails loudly.
const SCHOLAR_LLM_STAGE_COUNT = 8

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

const mode = recordingMode()

// -- Source-anchor assertions --
//
// Every anchor the pipeline emits must be resolvable against the exact
// input the pipeline was given: slicing the input at the anchor's own
// offsets returns the anchor's own quote. That is the check that turns
// "the model said it copied verbatim" into something falsifiable, and it
// is measured here on real recorded runs for the first time.

type TFixtureAnchor = {
    quote: string
    startUtf16: number
    endUtf16: number
    prefix: string
    suffix: string
}
type TFixtureEntity = { miniId: string; sourceAnchors?: TFixtureAnchor[] }
type TFixtureArgument = {
    claims: TFixtureEntity[]
    premises: TFixtureEntity[]
    conclusionPremiseMiniId: string
}

function assertAnchorResolves(anchor: TFixtureAnchor, input: string): void {
    expect(anchor.startUtf16).toBeGreaterThanOrEqual(0)
    expect(anchor.endUtf16).toBeGreaterThan(anchor.startUtf16)
    expect(anchor.endUtf16).toBeLessThanOrEqual(input.length)
    expect(input.slice(anchor.startUtf16, anchor.endUtf16)).toBe(anchor.quote)
    expect(anchor.prefix).toBe(
        input.slice(
            Math.max(0, anchor.startUtf16 - SOURCE_ANCHOR_CONTEXT_CHARS),
            anchor.startUtf16
        )
    )
    expect(anchor.suffix).toBe(
        input.slice(
            anchor.endUtf16,
            Math.min(
                input.length,
                anchor.endUtf16 + SOURCE_ANCHOR_CONTEXT_CHARS
            )
        )
    )
}

function assertSourceAnchors(
    output: Record<string, unknown>,
    input: string
): void {
    const argument = output.argument as TFixtureArgument | null
    if (argument === null) return
    for (const claim of argument.claims) {
        expect(claim.sourceAnchors ?? []).not.toHaveLength(0)
        for (const anchor of claim.sourceAnchors ?? []) {
            assertAnchorResolves(anchor, input)
        }
    }
    for (const premise of argument.premises) {
        if (premise.miniId === argument.conclusionPremiseMiniId) {
            // Synthesized from a bare symbol — no source relation, so
            // nothing to quote.
            expect("sourceAnchors" in premise).toBe(false)
            continue
        }
        // A relation-derived premise is anchored only when its evidence
        // quote is verbatim. Models sometimes elide with an ellipsis
        // instead, and an unlocatable quote is deliberately dropped
        // rather than guessed at, so this is not required of every
        // premise — which premises carry anchors is pinned exactly by
        // the golden comparison above. What is required here is that
        // whatever is emitted resolves against the input.
        for (const anchor of premise.sourceAnchors ?? []) {
            expect(anchor.quote.length).toBeGreaterThan(0)
            assertAnchorResolves(anchor, input)
        }
    }
}

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
                const provider = countingLlmProvider(
                    buildProviderForMode(fixtureDir)
                )
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
                    const parity = prior?.parity
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
                    const parity = prior?.parity
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
                assertSourceAnchors(actual, input.text)
                // Assembling the anchors adds no model work: the run
                // still makes exactly one call per LLM stage.
                expect(provider.callCount()).toBe(SCHOLAR_LLM_STAGE_COUNT)
            }
        )
    }
})
