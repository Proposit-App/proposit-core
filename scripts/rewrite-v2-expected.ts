// One-off helper: rewrite `v2-expected.json` for every committed
// fixture by running the v2 pipeline in replay mode (no LLM calls)
// with the deterministic `createDeterministicGenerateId` the e2e
// harness now uses. Necessary after introducing the deterministic
// generateId: the existing recordings stay valid (same prompts +
// schemas + LLM outputs), but the `variable-assignment` /
// `formula-compilation` deterministic stages now mint `gid-N`-shaped
// ids instead of the UUIDs that landed in `defa2be`. Without this
// rewrite, `expect(actual).toEqual(runtime)` fails on every fixture
// that has a non-null `argument`.
//
// Usage (one-off, run by a human or the dev agent):
//
//   pnpm tsx scripts/rewrite-v2-expected.ts
//
// The script reads each fixture's `v2-recorded-llm.json` + input
// text, executes the pipeline through the replay-mode recording
// provider (no API key required), and writes the assembled output
// to `v2-expected.json` — preserving the existing `parity` label.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
    basicsExtension,
    createIngestionV2Pipeline,
    executePipeline,
} from "../src/lib/index.js"
import { createRecordingLlmProvider } from "../test/extensions/pipelines/recording-provider.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_ROOT = path.resolve(
    HERE,
    "..",
    "test",
    "extensions",
    "pipelines",
    "fixtures"
)
const FIXTURE_NAMES = [
    "straightforward",
    "with-url-citation",
    "with-axiom",
    "ambiguous-conclusion",
    "enthymeme",
] as const
const V2_RECORDED_FILE = "v2-recorded-llm.json"
const V2_EXPECTED_FILE = "v2-expected.json"

function createDeterministicGenerateId(prefix = "gid"): () => string {
    let counter = 0
    return () => {
        counter += 1
        return `${prefix}-${String(counter)}`
    }
}

type TExpectedFile = Record<string, unknown> & {
    parity?: "strict" | "v2-strict-upgrade" | "v2-only"
}

async function rewriteOne(name: string): Promise<void> {
    const fixtureDir = path.join(FIXTURES_ROOT, name)
    const recordedPath = path.join(fixtureDir, V2_RECORDED_FILE)
    const expectedPath = path.join(fixtureDir, V2_EXPECTED_FILE)
    if (!fs.existsSync(recordedPath)) {
        console.warn(
            `[rewrite-v2-expected] ${name}: no ${V2_RECORDED_FILE}; skipping.`
        )
        return
    }
    const input = {
        text: fs
            .readFileSync(path.join(fixtureDir, "input.txt"), "utf-8")
            .trim(),
    }
    const provider = createRecordingLlmProvider({
        fixtureDir,
        mode: "replay",
        fileName: V2_RECORDED_FILE,
    })
    const pipeline = createIngestionV2Pipeline(basicsExtension)
    const result = await executePipeline(pipeline, input, {
        llm: provider,
        generateId: createDeterministicGenerateId(),
    })
    if (result.output === null) {
        // Inherit ambiguous-conclusion case — even on null output we
        // still rewrite (preserves the `argument: null` shape with the
        // canonical `failureText`).
        console.error(
            `[rewrite-v2-expected] ${name}: output is null. stageOutcomes:`,
            JSON.stringify(result.stageOutcomes, null, 2)
        )
        console.error(
            `[rewrite-v2-expected] ${name}: failures:`,
            JSON.stringify(result.failures, null, 2)
        )
    }
    const actual = (result.output ?? {}) as Record<string, unknown>
    // Preserve the existing `parity` label.
    let parity: TExpectedFile["parity"] | undefined
    if (fs.existsSync(expectedPath)) {
        const prior = JSON.parse(
            fs.readFileSync(expectedPath, "utf-8")
        ) as TExpectedFile
        parity = prior.parity
    }
    const body: TExpectedFile = parity ? { parity, ...actual } : { ...actual }
    fs.writeFileSync(
        expectedPath,
        JSON.stringify(body, null, 2) + "\n",
        "utf-8"
    )
    console.log(`[rewrite-v2-expected] ${name}: rewrote ${expectedPath}`)
}

async function main(): Promise<void> {
    for (const name of FIXTURE_NAMES) {
        await rewriteOne(name)
    }
    console.log(
        "[rewrite-v2-expected] All fixtures processed. Review the diffs " +
            "before committing."
    )
}

await main()
