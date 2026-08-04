// Pins the total anchor-resolution notes the whole recorded corpus
// emits, across BOTH pipelines.
//
// This exists because a claim about that number was written after
// measuring only the thorough pipeline, and was wrong. A per-fixture
// assertion would not have caught it either — the miscount was a whole
// pipeline's worth of fixtures going unmeasured. So the assertion is
// over the corpus, and it names each expected note so a new one has to
// be looked at rather than absorbed into a total.
//
// Both entries are model-behavior findings, not defects in the anchor
// code: each is a relation whose evidence quote the model did not copy
// verbatim from the input, so it resolves to no anchor by design. If
// this test fails, the question is what changed about the recordings.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { executePipeline } from "../../../src/lib/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/scholar.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/scribe.js"
import { createRecordingLlmProvider } from "./recording-provider.js"

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures")
const FIXTURE_NAMES = [
    "straightforward",
    "with-url-citation",
    "with-axiom",
    "ambiguous-conclusion",
    "enthymeme",
] as const

/**
 * Every note the corpus is expected to emit, as
 * `<fixture>/<pipeline> <code> <subject>`.
 *
 * Currently none: in the present recordings every relation's evidence
 * quote is copied verbatim from the input, so every one of them
 * locates. Earlier recordings carried two — a quote elided with an
 * ellipsis, and a synthesised summary sentence rather than a quote —
 * and both were model-behavior findings rather than defects in the
 * anchor code. An empty list still pins the corpus: a note reappearing
 * has to be looked at rather than absorbed into a total.
 */
const EXPECTED_NOTES = [] as const

function readInput(fixtureDir: string): string {
    return fs.readFileSync(path.join(fixtureDir, "input.txt"), "utf-8").trim()
}

async function collectNotes(): Promise<string[]> {
    const notes: string[] = []
    for (const name of FIXTURE_NAMES) {
        const fixtureDir = path.join(FIXTURES_ROOT, name)
        for (const pipeline of ["scholar", "scribe"] as const) {
            const fileName =
                pipeline === "scholar"
                    ? "v2-recorded-llm.json"
                    : "scribe-recorded-llm.json"
            if (!fs.existsSync(path.join(fixtureDir, fileName))) continue
            const result = await executePipeline(
                pipeline === "scholar"
                    ? createScholarPipeline(basicsExtension)
                    : createScribePipeline(basicsExtension),
                { text: readInput(fixtureDir) },
                {
                    llm: createRecordingLlmProvider({
                        fixtureDir,
                        mode: "replay",
                        fileName,
                    }),
                }
            )
            for (const failure of result.failures) {
                if (!failure.code.startsWith("SOURCE_ANCHOR")) continue
                const context = failure.context ?? {}
                const subject =
                    (context.relationId as string | undefined) ??
                    (context.mentionId as string | undefined) ??
                    "-"
                notes.push(`${name}/${pipeline} ${failure.code} ${subject}`)
            }
        }
    }
    return notes.sort()
}

describe("recorded corpus — anchor resolution notes", () => {
    it("emits exactly the known notes across both pipelines", async () => {
        expect(await collectNotes()).toEqual([...EXPECTED_NOTES])
    }, 300_000)

    it("emits every note as a non-fatal warning", async () => {
        const fixtureDir = path.join(FIXTURES_ROOT, "with-url-citation")
        const result = await executePipeline(
            createScholarPipeline(basicsExtension),
            { text: readInput(fixtureDir) },
            {
                llm: createRecordingLlmProvider({
                    fixtureDir,
                    mode: "replay",
                    fileName: "v2-recorded-llm.json",
                }),
            }
        )
        // A warning must never bring the run down: the argument is still
        // assembled alongside it.
        expect(result.output).not.toBeNull()
        for (const failure of result.failures) {
            if (!failure.code.startsWith("SOURCE_ANCHOR")) continue
            expect(failure.severity).toBe("warning")
        }
    }, 300_000)
})
