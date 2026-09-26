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
import {
    completeStage,
    executePipeline,
    launchStage,
} from "../../../src/lib/index.js"
import { STAGE_IDS } from "../../../src/extensions/pipelines/base/stages/index.js"
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
        sourceSupport: [],
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
                title: "Rain as the cause of wetness",
                evidence: { segmentIds: [], quote: "" },
            },
        ],
        conclusionCandidates: ["c2"],
        conclusionTitle: "Wet ground as the upshot",
        rationale: "c2 is supported by c1 and supports nothing further.",
    }
}

/** Run scribe; `structures` answer the structure stage's attempts in turn. */
function runScribe(
    extract: unknown,
    ...structures: unknown[]
): Promise<{
    output: TParsedArgumentResponse | null
    failures: readonly { code: string; message: string; severity: string }[]
}> {
    const llm = createMockLlmProvider({
        responses: {
            extract: [{ kind: "ok", output: extract }],
            "scribe-structure": structures.map((output) => ({
                kind: "ok" as const,
                output,
            })),
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

    it("titles each premise with the phrase the structure stage authored", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            happyStructureOutput()
        )
        const titles = result.output!.argument!.premises.map(
            (p) => (p as { title?: string }).title
        )
        expect(titles).toContain("Rain as the cause of wetness")
        // The conclusion premise gets the authored conclusion title
        // because the resolved conclusion is the first candidate.
        expect(titles).toContain("Wet ground as the upshot")
    })

    it("never gives the conclusion premise a step premise's title", async () => {
        // The model can name the concluding step with the very phrase it
        // gave the relation that reaches the conclusion, which shows two
        // premises under one title.
        const structure = happyStructureOutput() as {
            conclusionTitle: string
        }
        structure.conclusionTitle = " rain as the cause of WETNESS "
        const result = await runScribe(happyExtractOutput(), structure)
        const premises = result.output!.argument!.premises as {
            miniId: string
            title?: string
        }[]
        const conclusionId = result.output!.argument!.conclusionPremiseMiniId
        const conclusion = premises.find((p) => p.miniId === conclusionId)
        expect(conclusion?.title).toBe("The ground is wet")
        expect(
            premises.filter((p) => p.title === "Rain as the cause of wetness")
        ).toHaveLength(1)
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
            {
                canonicalClaims: [],
                mentionToClaim: [],
                mentions: [],
                sourceSupport: [],
            },
            {
                relations: [],
                conclusionCandidates: [],
                conclusionTitle: "",
                rationale: "",
            }
        )
        expect(result.output).not.toBeNull()
        expect(result.output!.argument).toBeNull()
        expect(result.output!.failureText).toBeTruthy()
    })

    const noStructure = {
        relations: [],
        conclusionCandidates: [],
        conclusionTitle: "",
        rationale: "no argument structure",
    }

    it("asks again when structure finds nothing to connect two claims", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            noStructure,
            happyStructureOutput()
        )
        expect(result.output!.argument).not.toBeNull()
        expect(result.failures.map((f) => f.code)).not.toContain(
            "NO_ARGUMENT_STRUCTURE"
        )
    })

    it("fails the import in plain words when the second answer is empty too", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            noStructure,
            noStructure
        )
        expect(result.output).toBeNull()
        const failure = result.failures.find(
            (f) => f.code === "NO_ARGUMENT_STRUCTURE"
        )
        expect(failure?.severity).toBe("error")
        expect(failure?.message).toBe(
            "Couldn't work out how these claims connect to a conclusion."
        )
    })

    it("asks again when structure names relations but no conclusion candidate", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            {
                ...(happyStructureOutput() as Record<string, unknown>),
                conclusionCandidates: [],
            },
            happyStructureOutput()
        )
        expect(result.output!.argument).not.toBeNull()
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

describe("createScribePipeline — structure checked out of process", () => {
    // What the launch and complete calls see: the two slots structure reads,
    // with two normal claims, so an answer naming no structure is refused.
    const upstream = {
        [STAGE_IDS.claimCanonicalization]: {
            outcome: "completed" as const,
            output: { canonicalClaims: [], mentionToClaim: [] },
        },
        [STAGE_IDS.claimTypeClassification]: {
            outcome: "completed" as const,
            output: {
                classifications: [
                    { miniId: "c1", type: "normal", sourceString: null },
                    { miniId: "c2", type: "normal", sourceString: null },
                ],
            },
        },
    }
    const empty = {
        status: "completed" as const,
        rawResponseId: "resp_s",
        output: JSON.stringify({
            relations: [],
            conclusionCandidates: [],
            conclusionTitle: "",
            rationale: "none",
        }),
    }
    const deps = { llm: createMockLlmProvider({ responses: {} }) }

    it("refuses an empty answer as retryable when given the upstream outputs", async () => {
        const result = await completeStage(
            createScribePipeline(basicsExtension),
            STAGE_IDS.scribeStructure,
            empty,
            deps,
            1,
            { upstream, input: { text: INPUT_TEXT } }
        )
        expect(result.outcome).toBe("failed")
        expect(result.retryReason).toBe("schema_validation")
        expect(result.failures[0]).toMatchObject({
            code: "NO_ARGUMENT_STRUCTURE",
            message:
                "Couldn't work out how these claims connect to a conclusion.",
        })
    })

    it("checks only the schema when not given them", async () => {
        const result = await completeStage(
            createScribePipeline(basicsExtension),
            STAGE_IDS.scribeStructure,
            empty,
            deps
        )
        expect(result.outcome).toBe("completed")
    })

    it("re-launches with the retry note after a refused answer", async () => {
        let sentUser = ""
        await launchStage(
            createScribePipeline(basicsExtension),
            STAGE_IDS.scribeStructure,
            upstream,
            { text: INPUT_TEXT },
            {
                ...deps,
                submitBackgroundResponse: (req) => {
                    sentUser = req.userMessage
                    return Promise.resolve({
                        responseId: "resp_2",
                        status: "queued",
                    })
                },
            },
            2
        )
        expect(sentUser).toContain("Your previous response failed")
    })
})
