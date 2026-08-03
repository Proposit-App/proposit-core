// Unit + edge tests for `createScribePipeline` — the fast (two cheap
// LLM call) ingestion pipeline.
//
// scribe's two LLM stages (`extract`, `structure`) are mocked via the
// stage-id-marker keying; its deterministic adapters + scholar's
// deterministic backend + finalize run for real. These tests assert:
//   - a small happy fixture yields a schema-valid response with a
//     compiled, validated formula (no processing failures);
//   - an empty claim set yields a valid `argument: null` response (no
//     throw);
//   - a cheap-model `structure` output that produces an invalid formula
//     surfaces a processing failure rather than crashing;
//   - the cross-repo wire id is `argument-ingestion-scribe`.

import { describe, expect, it } from "vitest"
import { executePipeline } from "../../../src/lib/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import { createMockLlmProvider, type TMockCallRecord } from "../../mocks/llm.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"

// Deterministic id generator (counter-based) so minted variable/premise
// ids are stable across runs — mirrors the e2e harness.
function createDeterministicGenerateId(prefix = "gid"): () => string {
    let counter = 0
    return () => {
        counter += 1
        return `${prefix}-${String(counter)}`
    }
}

/**
 * The source text every run in this file is given. Anchors are offsets
 * into it, so the assertions slice it rather than trusting a quote.
 */
const INPUT_TEXT = "It is raining. Therefore the ground is wet."

// A two-claim "rain → wet ground" extract payload (the per-extension
// canonicalization shape: basics claim records carry title/body/type),
// plus the mentions whose quoted text becomes each claim's anchor.
function happyExtractOutput(): unknown {
    return {
        mentions: [
            {
                mentionId: "c1-m",
                segmentId: "",
                text: "It is raining",
                span: { start: 0, end: 13 },
            },
            {
                mentionId: "c2-m",
                segmentId: "",
                text: "the ground is wet",
                // Deliberately wrong: the offsets are a tie-break hint, and
                // a quote that occurs once must resolve regardless of them.
                span: { start: 0, end: 17 },
            },
        ],
        canonicalClaims: [
            {
                miniId: "c1",
                mentionIds: ["c1-m"],
                suggestedSymbol: "Raining",
                type: "normal",
                title: "It is raining",
                body: "It is raining.",
            },
            {
                miniId: "c2",
                mentionIds: ["c2-m"],
                suggestedSymbol: "Ground_Wet",
                type: "normal",
                title: "The ground is wet",
                body: "The ground is wet.",
            },
        ],
        mentionToClaim: [
            { mentionId: "c1-m", claimMiniId: "c1" },
            { mentionId: "c2-m", claimMiniId: "c2" },
        ],
    }
}

// `structure`: c1 supports c2; c2 is the conclusion.
function happyStructureOutput(): unknown {
    return {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents: ["c1"],
                consequent: "c2",
                evidence: { segmentIds: [], quote: "" },
            },
        ],
        conclusionCandidates: ["c2"],
        rationale: "c2 is supported by c1 and supports nothing further.",
    }
}

function runScribe(
    extract: unknown,
    structure: unknown
): Promise<{
    output: TParsedArgumentResponse | null
    failures: readonly { code: string; message: string; severity: string }[]
}> {
    const llm = createMockLlmProvider({
        responses: {
            extract: [{ kind: "ok", output: extract }],
            "scribe-structure": [{ kind: "ok", output: structure }],
        },
    })
    return executePipeline(
        createScribePipeline(basicsExtension),
        { text: INPUT_TEXT },
        { llm, generateId: createDeterministicGenerateId() }
    ) as Promise<{
        output: TParsedArgumentResponse | null
        failures: readonly {
            code: string
            message: string
            severity: string
        }[]
    }>
}

describe("createScribePipeline", () => {
    it("the wire id is argument-ingestion-scribe", () => {
        expect(createScribePipeline(basicsExtension).id).toBe(
            "argument-ingestion-scribe"
        )
    })

    it("produces a schema-valid response with a compiled, validated formula", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            happyStructureOutput()
        )
        expect(result.output).not.toBeNull()
        const argument = result.output!.argument
        expect(argument).not.toBeNull()
        expect(argument!.premises.length).toBeGreaterThan(0)
        // Every premise carries a non-empty compiled formula string.
        for (const premise of argument!.premises) {
            expect(typeof premise.formula).toBe("string")
            expect(premise.formula.length).toBeGreaterThan(0)
        }
        // No processing failures on the happy path.
        const response = result.output as unknown as {
            processingFailures: unknown[]
        }
        expect(response.processingFailures).toEqual([])
    })

    it("the structure stage prompt carries each claim's title/body, not just ids", async () => {
        // Regression: the structure prompt was built from the type slot
        // alone (`[c1] type=normal`), omitting the claim text. A real model
        // then saw bare placeholders, emitted no relations/conclusion, and
        // scribe degraded to `argument: null` on every multi-claim argument.
        // The prompt MUST carry the canonical claim content from the
        // canonicalization slot (mirrors scholar's relation-extraction).
        const calls: TMockCallRecord[] = []
        const llm = createMockLlmProvider({
            responses: {
                extract: [{ kind: "ok", output: happyExtractOutput() }],
                "scribe-structure": [
                    { kind: "ok", output: happyStructureOutput() },
                ],
            },
            onCall: (record) => calls.push(record),
        })
        await executePipeline(
            createScribePipeline(basicsExtension),
            { text: INPUT_TEXT },
            { llm, generateId: createDeterministicGenerateId() }
        )
        const structureCall = calls.find(
            (c) => c.stageId === "scribe-structure"
        )
        expect(structureCall).toBeDefined()
        expect(structureCall!.userMessage).toContain("It is raining")
        expect(structureCall!.userMessage).toContain("The ground is wet")
    })

    it("an over-long claim title is truncated, not fatal — the import still produces an argument", async () => {
        // Regression: the extension's claim `title` is maxLength: 50, but
        // OpenAI strict structured-output IGNORES maxLength, so the cheap
        // model emits longer titles (60–115 chars were observed in prod).
        // Local schema validation then rejected every attempt → retryable
        // schema_validation → the run failed on every real multi-claim
        // import. An over-long string is a recoverable issue: clamp it to
        // the cap and continue, never halt the whole pipeline.
        const longTitle = "x".repeat(80)
        const extract = happyExtractOutput() as {
            canonicalClaims: { title: string }[]
            mentionToClaim: unknown
        }
        extract.canonicalClaims[0].title = longTitle
        const result = await runScribe(extract, happyStructureOutput())
        expect(result.output).not.toBeNull()
        expect(result.output!.argument).not.toBeNull()
        const titles = (
            result.output!.argument!.claims as { title?: string }[]
        ).map((c) => c.title)
        // Every title is within the 50-char cap...
        expect(titles.every((t) => t == null || t.length <= 50)).toBe(true)
        // ...and the clamped one preserves the original's 50-char prefix.
        expect(titles).toContain(longTitle.slice(0, 50))
    })

    it("an empty claim set yields a valid argument: null response (no throw)", async () => {
        const result = await runScribe(
            { canonicalClaims: [], mentionToClaim: [], mentions: [] },
            { relations: [], conclusionCandidates: [], rationale: "" }
        )
        expect(result.output).not.toBeNull()
        expect(result.output!.argument).toBeNull()
        expect(result.output!.failureText).toBeTruthy()
    })

    it("a structure output with an unresolvable conclusion surfaces a processing failure, not a crash", async () => {
        // Claims exist, but structure names no relations and no
        // conclusion candidate — the conclusion adapter resolves null
        // and records NO_SINGLE_CONCLUSION; the run does not throw.
        const result = await runScribe(happyExtractOutput(), {
            relations: [],
            conclusionCandidates: [],
            rationale: "no argument structure",
        })
        expect(result.output).not.toBeNull()
        const failureCodes = result.failures.map((f) => f.code)
        expect(failureCodes).toContain("NO_SINGLE_CONCLUSION")
        // Degraded, not crashed: a defined response with argument: null.
        expect(result.output!.argument).toBeNull()
    })

    // -- Source anchors --

    it("every claim carries source anchors located in the input text", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            happyStructureOutput()
        )
        const claims = result.output!.argument!.claims as {
            title?: string
            sourceAnchors?: {
                quote: string
                startUtf16: number
                endUtf16: number
            }[]
        }[]
        expect(claims.length).toBe(2)
        for (const claim of claims) {
            expect(claim.sourceAnchors?.length).toBeGreaterThan(0)
            for (const anchor of claim.sourceAnchors ?? []) {
                // The offsets are the fact, not the quote: slicing the
                // input at them has to reproduce the quote, or the anchor
                // points somewhere the reader was never promised.
                expect(
                    INPUT_TEXT.slice(anchor.startUtf16, anchor.endUtf16)
                ).toBe(anchor.quote)
            }
        }
        expect(claims[0].sourceAnchors![0].quote).toBe("It is raining")
        expect(claims[1].sourceAnchors![0].quote).toBe("the ground is wet")
    })

    it("a claim whose quote is not in the input still assembles, with one warning and no anchors", async () => {
        // The model paraphrasing instead of quoting is the failure mode
        // that takes anchor coverage to zero silently. It must cost the
        // anchor and a warning — never the argument.
        const extract = happyExtractOutput() as {
            mentions: { text: string }[]
        }
        extract.mentions[0].text = "a paraphrase that appears nowhere"
        const result = await runScribe(extract, happyStructureOutput())
        expect(result.output!.argument).not.toBeNull()
        const claims = result.output!.argument!.claims as {
            sourceAnchors?: unknown[]
        }[]
        // Absent, not empty: "we found nothing" and "we did not look" must
        // not read the same downstream.
        expect("sourceAnchors" in claims[0]).toBe(false)
        expect(claims[1].sourceAnchors?.length).toBe(1)
        expect(
            result.failures.filter((f) => f.code === "SOURCE_ANCHOR_UNRESOLVED")
        ).toHaveLength(1)
    })

    it("no relation is asked to supply an evidence quote it cannot have", async () => {
        // `structure` never sees the input text, so any quote it returns is
        // a paraphrase that can only miss. Nothing may be routed to anchor
        // resolution on its behalf — a miss there would blame the model for
        // a fault in the pipeline's own wiring.
        const calls: TMockCallRecord[] = []
        const llm = createMockLlmProvider({
            responses: {
                extract: [{ kind: "ok", output: happyExtractOutput() }],
                "scribe-structure": [
                    { kind: "ok", output: happyStructureOutput() },
                ],
            },
            onCall: (record) => calls.push(record),
        })
        const result = (await executePipeline(
            createScribePipeline(basicsExtension),
            { text: INPUT_TEXT },
            { llm, generateId: createDeterministicGenerateId() }
        )) as { failures: readonly { code: string; context?: unknown }[] }
        const structureCall = calls.find(
            (c) => c.stageId === "scribe-structure"
        )
        expect(structureCall!.systemPrompt).not.toMatch(/no span to cite/)
        for (const failure of result.failures) {
            expect(
                (failure.context as { relationId?: string } | undefined)
                    ?.relationId
            ).toBeUndefined()
        }
    })
})
