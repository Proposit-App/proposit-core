// Every source (citation) claim scribe extracts must end up backing the
// normal claim it supports, whether or not `structure` listed it as an
// antecedent. `structure` never sees the text, so it can — and on a real
// run did — leave sources out of its relations; a source attached to
// nothing yields no derivation backing and is lost downstream.
//
// Both LLM stages are mocked with fixed outputs; everything after them
// runs for real, and the assertions read the pipeline's final
// `derivationBacking`.

import { describe, expect, it } from "vitest"
import { executePipeline } from "../../../src/lib/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import { createMockLlmProvider } from "../../mocks/llm.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"

const INPUT_TEXT =
    "Trump took foreign payments ([tracker](https://tracker.example/pay)). " +
    "He ignored subpoenas. The record is at https://news.example/subpoenas. " +
    "So he is the most corrupt politician."

type TMention = { mentionId: string; text: string }

function span(text: string): { start: number; end: number } {
    const start = INPUT_TEXT.indexOf(text)
    return { start, end: start + text.length }
}

const MENTIONS: Record<string, TMention> = {
    c1: { mentionId: "c1-m", text: "Trump took foreign payments" },
    // Overlaps c1's mention, as a link sitting inside the sentence it
    // backs does.
    c2: {
        mentionId: "c2-m",
        text: "Trump took foreign payments ([tracker](https://tracker.example/pay))",
    },
    c3: { mentionId: "c3-m", text: "He ignored subpoenas." },
    // Follows c3's mention without overlapping it.
    c4: {
        mentionId: "c4-m",
        text: "The record is at https://news.example/subpoenas.",
    },
    c5: { mentionId: "c5-m", text: "he is the most corrupt politician" },
}

function claim(miniId: string, type: "normal" | "citation"): unknown {
    const base = {
        miniId,
        mentionIds: [MENTIONS[miniId].mentionId],
        suggestedSymbol: `Claim_${miniId}`,
        type,
        title: `Claim ${miniId}`,
    }
    return type === "citation"
        ? {
              ...base,
              url: `https://source.example/${miniId}`,
              citationTypeGuess: "Website",
          }
        : { ...base, body: `Claim ${miniId}.` }
}

function extractOutput(
    sourceSupport: { sourceMiniId: string; supportedMiniId: string }[] = [],
    mentions: Record<string, TMention> = MENTIONS
): unknown {
    const types: Record<string, "normal" | "citation"> = {
        c1: "normal",
        c2: "citation",
        c3: "normal",
        c4: "citation",
        c5: "normal",
    }
    return {
        canonicalClaims: Object.keys(types).map((id) => claim(id, types[id])),
        mentionToClaim: Object.keys(types).map((id) => ({
            mentionId: mentions[id].mentionId,
            claimMiniId: id,
        })),
        mentions: Object.values(mentions).map((m) => ({
            mentionId: m.mentionId,
            segmentId: "",
            text: m.text,
            span: span(m.text),
        })),
        sourceSupport,
    }
}

// The shape of the reported run: one relation from the normal claims to
// the conclusion, with every source left out.
function structureOutput(
    antecedents: string[] = ["c1", "c3"],
    conclusionCandidates: string[] = ["c5"]
): unknown {
    return {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents,
                consequent: "c5",
                title: "Pattern of corruption",
                evidence: { segmentIds: [], quote: "" },
            },
        ],
        conclusionCandidates,
        conclusionTitle: "Most corrupt",
        rationale: "c5 is supported and supports nothing further.",
    }
}

type TRunResult = {
    output: TParsedArgumentResponse | null
    failures: readonly {
        code: string
        severity: string
        context?: Record<string, unknown>
    }[]
}

async function runScribe(
    extract: unknown,
    structure: unknown
): Promise<TRunResult> {
    let counter = 0
    const llm = createMockLlmProvider({
        responses: {
            extract: [{ kind: "ok", output: extract }],
            "scribe-structure": [{ kind: "ok", output: structure }],
        },
    })
    return (await executePipeline(
        createScribePipeline(basicsExtension),
        { text: INPUT_TEXT },
        {
            llm,
            generateId: () => {
                counter += 1
                return `gid-${String(counter)}`
            },
        }
    )) as TRunResult
}

/** derivationBacking as a `supported claim → sorted sources` record. */
function backing(result: TRunResult): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const entry of result.output?.argument?.derivationBacking ?? []) {
        out[entry.derivedClaimMiniId] = [...entry.supportingClaimMiniIds].sort()
    }
    return out
}

describe("scribe attaches every source claim to the claim it supports", () => {
    it("attaches sources structure left out, by where their mentions sit", async () => {
        const result = await runScribe(extractOutput(), structureOutput())
        expect(backing(result)).toEqual({ c1: ["c2"], c3: ["c4"] })
    })

    it("uses the claim extract names over the position of the mention", async () => {
        const result = await runScribe(
            extractOutput([{ sourceMiniId: "c4", supportedMiniId: "c1" }]),
            structureOutput()
        )
        expect(backing(result)).toEqual({ c1: ["c2", "c4"] })
    })

    it("warns about a target that is unknown or not a normal claim, then falls back", async () => {
        const result = await runScribe(
            extractOutput([
                { sourceMiniId: "c2", supportedMiniId: "c99" },
                { sourceMiniId: "c4", supportedMiniId: "c2" },
            ]),
            structureOutput()
        )
        expect(backing(result)).toEqual({ c1: ["c2"], c3: ["c4"] })
        const invalid = result.failures.filter(
            (f) => f.code === "SOURCE_ATTACHMENT_INVALID_TARGET"
        )
        expect(invalid.map((f) => f.context?.sourceMiniId).sort()).toEqual([
            "c2",
            "c4",
        ])
        expect(invalid.every((f) => f.severity === "warning")).toBe(true)
    })

    it("leaves a source with no overlapping or earlier claim unattached, and says so", async () => {
        // c2's quote moves to the very start of the text, before every
        // normal claim's mention and overlapping none of them.
        const mentions = {
            ...MENTIONS,
            c2: { mentionId: "c2-m", text: "Trump took" },
            c1: { mentionId: "c1-m", text: "foreign payments" },
        }
        const result = await runScribe(
            extractOutput([], mentions),
            structureOutput()
        )
        expect(backing(result)).toEqual({ c3: ["c4"] })
        const unattached = result.failures.filter(
            (f) => f.code === "SOURCE_ATTACHMENT_UNATTACHED"
        )
        expect(unattached.map((f) => f.context?.sourceMiniId)).toEqual(["c2"])
    })

    it("adds no fallback for a source structure already attached", async () => {
        const result = await runScribe(
            extractOutput(),
            structureOutput(["c1", "c2", "c3"])
        )
        expect(backing(result)).toEqual({ c5: ["c2"], c3: ["c4"] })
    })

    it("does not let an added source relation change the chosen conclusion", async () => {
        // With no usable candidate the conclusion comes from the relation
        // graph. c3 is in no relation of structure's, so a source relation
        // into it would make it a supported sink that ties with c5 and
        // wins on document order.
        const result = await runScribe(
            extractOutput(),
            structureOutput(["c1"], [])
        )
        const conclusion = result.output?.argument?.claims.find(
            (c) => (c as { role?: string }).role === "conclusion"
        ) as { miniId?: string } | undefined
        expect(conclusion?.miniId).toBe("c5")
        expect(backing(result)).toEqual({ c1: ["c2"], c3: ["c4"] })
    })
})
