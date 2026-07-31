// Unit tests for the source anchors `finalizeResponseV2` attaches to
// claims and premises.
//
// Same idiom as `finalize-response-v2.test.ts`: a `TStageContext` stub
// serving canned stage outputs, so the assertions stay decoupled from a
// full pipeline run. The one difference is that `ctx.input.text` is
// load-bearing here — the anchors are verified against it.

import { describe, expect, it } from "vitest"
import {
    basicsExtension,
    finalizeResponseV2,
} from "../../../src/extensions/pipelines/base/index.js"
import {
    STAGE_IDS,
    type TClaimCanonicalizationOutput,
    type TClaimMentionExtractionOutput,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
    type TVariableAssignmentOutput,
} from "../../../src/extensions/pipelines/base/stages/index.js"
import type { TStageContext } from "../../../src/lib/pipelines/index.js"

type TAnchor = {
    quote: string
    startUtf16: number
    endUtf16: number
    prefix: string
    suffix: string
}
type TAnchored = Record<string, unknown> & {
    miniId: string
    sourceAnchors?: TAnchor[]
}

// The repeated first sentence is the point of this fixture: "The risk is
// real" occurs twice, and the claim's second mention lives in the last
// segment. Mention spans are segment-relative, so an implementation that
// forgets to add the segment's own start resolves that mention to the
// FIRST occurrence and this fixture catches it.
const INPUT_TEXT =
    "The risk is real. Escalation costs more than delay. The risk is real, so we should wait."

const SEGMENT_TEXTS = [
    "The risk is real.",
    "Escalation costs more than delay.",
    "The risk is real, so we should wait.",
] as const

/** Span of `text` in the input, located rather than hand-counted. */
function spanOf(text: string, from = 0): { start: number; end: number } {
    const start = INPUT_TEXT.indexOf(text, from)
    if (start === -1) throw new Error(`fixture text not in input: ${text}`)
    return { start, end: start + text.length }
}

function buildContextStub(
    outputs: Record<string, unknown>,
    text = INPUT_TEXT
): TStageContext {
    return {
        input: { text },
        get<T>(stageId: string): T | undefined {
            return outputs[stageId] as T | undefined
        },
        stageStatus: () => "completed",
        llm: {} as TStageContext["llm"],
        generateId: () => "gen",
        signal: new AbortController().signal,
        emit: () => {
            // inert — finalizeResponseV2 never emits events
        },
        addFailure: () => {
            // inert — the happy path records no failures
        },
    }
}

// Claims:
//   c1 "The risk is real"  — mentions m1 (segment s1) and m2 (segment s3)
//   c2 "Escalation costs"  — mention m3 (segment s2)
//   c3 "We should wait"    — mention m4 (segment s3), the conclusion
// Relation r1: c1, c2 → c3, evidenced by the last clause.
function buildOutputs(): Record<string, unknown> {
    const segmentSpans = SEGMENT_TEXTS.map((t, i) =>
        spanOf(t, i === 2 ? INPUT_TEXT.indexOf("Escalation") : 0)
    )
    const segmentation: TSegmentationOutput = {
        segments: SEGMENT_TEXTS.map((text, i) => ({
            segmentId: `s${String(i + 1)}`,
            text,
            span: segmentSpans[i],
        })),
    }

    // Spans below are relative to the SEGMENT's text, matching what the
    // claim-mention-extraction prompt asks the model for.
    const mentions: TClaimMentionExtractionOutput = {
        mentions: [
            {
                mentionId: "m1",
                segmentId: "s1",
                text: "The risk is real",
                span: { start: 0, end: 16 },
            },
            {
                mentionId: "m2",
                segmentId: "s3",
                text: "The risk is real",
                span: { start: 0, end: 16 },
            },
            {
                mentionId: "m3",
                segmentId: "s2",
                text: "Escalation costs more than delay",
                span: { start: 0, end: 32 },
            },
            {
                mentionId: "m4",
                segmentId: "s3",
                text: "we should wait",
                span: { start: 21, end: 35 },
            },
        ],
    }

    const canonicalization: TClaimCanonicalizationOutput = {
        canonicalClaims: [
            {
                miniId: "c1",
                mentionIds: ["m1", "m2"],
                suggestedSymbol: "Risk_Real",
                type: "normal",
                ...({ title: "The risk is real" } as Record<string, unknown>),
            },
            {
                miniId: "c2",
                mentionIds: ["m3"],
                suggestedSymbol: "Escalation_Costly",
                type: "normal",
                ...({ title: "Escalation is costly" } as Record<
                    string,
                    unknown
                >),
            },
            {
                miniId: "c3",
                mentionIds: ["m4"],
                suggestedSymbol: "Should_Wait",
                type: "normal",
                ...({ title: "We should wait" } as Record<string, unknown>),
            },
        ],
        mentionToClaim: [
            { mentionId: "m1", claimMiniId: "c1" },
            { mentionId: "m2", claimMiniId: "c1" },
            { mentionId: "m3", claimMiniId: "c2" },
            { mentionId: "m4", claimMiniId: "c3" },
        ],
    }

    const variables: TVariableAssignmentOutput = [
        { miniId: "v1", symbol: "Risk_Real", claimMiniId: "c1" },
        { miniId: "v2", symbol: "Escalation_Costly", claimMiniId: "c2" },
        { miniId: "v3", symbol: "Should_Wait", claimMiniId: "c3" },
    ]

    const relations: TRelationExtractionOutput = {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents: ["c1", "c2"],
                consequent: "c3",
                evidence: {
                    segmentIds: ["s3"],
                    quote: "so we should wait",
                },
            },
        ],
    }

    const selection: TConclusionSelectionOutput = {
        conclusionMiniId: "c3",
        conclusionCandidates: ["c3"],
        rationale: "c3 terminates the support graph.",
    }

    const compilation: TFormulaCompilationOutput = {
        premises: [
            {
                premiseMiniId: "p1",
                formula:
                    "(Risk_Real and Escalation_Costly) implies Should_Wait",
                roleHint: "freeform",
                sourceRelationId: "r1",
            },
            {
                premiseMiniId: "p2",
                formula: "Should_Wait",
                roleHint: "conclusion",
                sourceRelationId: null,
            },
        ],
        conclusionPremiseMiniId: "p2",
        derivationBacking: [],
    }

    return {
        [STAGE_IDS.segmentation]: segmentation,
        [STAGE_IDS.claimMentionExtraction]: mentions,
        [STAGE_IDS.claimCanonicalization]: canonicalization,
        [STAGE_IDS.variableAssignment]: variables,
        [STAGE_IDS.relationExtraction]: relations,
        [STAGE_IDS.conclusionSelection]: selection,
        [STAGE_IDS.formulaCompilation]: compilation,
    }
}

// Mirrors how a pipeline calls finalize: the segmentation + mention
// outputs are handed in rather than read from the context, because not
// every pipeline has those stages.
function finalize(outputs: Record<string, unknown>): {
    claims: TAnchored[]
    premises: TAnchored[]
} {
    const out = finalizeResponseV2({
        ctx: buildContextStub(outputs),
        extension: basicsExtension,
        segmentation: outputs[STAGE_IDS.segmentation] as
            | TSegmentationOutput
            | undefined,
        mentions: outputs[STAGE_IDS.claimMentionExtraction] as
            | TClaimMentionExtractionOutput
            | undefined,
    })
    return out.argument as unknown as {
        claims: TAnchored[]
        premises: TAnchored[]
    }
}

describe("finalizeResponseV2 — claim source anchors", () => {
    it("anchors a claim once per mention that resolved to it", () => {
        const c1 = finalize(buildOutputs()).claims.find(
            (c) => c.miniId === "c1"
        )!
        expect(c1.sourceAnchors).toHaveLength(2)
        expect(c1.sourceAnchors!.map((a) => a.quote)).toEqual([
            "The risk is real",
            "The risk is real",
        ])
    })

    it("composes the segment offset so a later mention is not resolved to an earlier occurrence", () => {
        const c1 = finalize(buildOutputs()).claims.find(
            (c) => c.miniId === "c1"
        )!
        const [first, second] = c1.sourceAnchors!
        expect(first.startUtf16).toBe(0)
        expect(second.startUtf16).toBe(INPUT_TEXT.lastIndexOf("The risk"))
    })

    it("emits offsets that slice back to the quote", () => {
        const { claims, premises } = finalize(buildOutputs())
        for (const entity of [...claims, ...premises]) {
            for (const anchor of entity.sourceAnchors ?? []) {
                expect(anchor.startUtf16).toBeGreaterThanOrEqual(0)
                expect(anchor.endUtf16).toBeGreaterThan(anchor.startUtf16)
                expect(anchor.endUtf16).toBeLessThanOrEqual(INPUT_TEXT.length)
                expect(
                    INPUT_TEXT.slice(anchor.startUtf16, anchor.endUtf16)
                ).toBe(anchor.quote)
            }
        }
    })

    it("carries surrounding context on each anchor", () => {
        const c2 = finalize(buildOutputs()).claims.find(
            (c) => c.miniId === "c2"
        )!
        const anchor = c2.sourceAnchors![0]
        expect(anchor.prefix).toBe(
            INPUT_TEXT.slice(
                Math.max(0, anchor.startUtf16 - 32),
                anchor.startUtf16
            )
        )
        expect(anchor.suffix).toBe(
            INPUT_TEXT.slice(anchor.endUtf16, anchor.endUtf16 + 32)
        )
    })

    it("omits the key entirely when no mention resolves, rather than emitting an empty array", () => {
        const outputs = buildOutputs()
        const mentions = outputs[
            STAGE_IDS.claimMentionExtraction
        ] as TClaimMentionExtractionOutput
        mentions.mentions.find((m) => m.mentionId === "m3")!.text =
            "a sentence never written"

        const c2 = finalize(outputs).claims.find((c) => c.miniId === "c2")!
        expect("sourceAnchors" in c2).toBe(false)
    })

    it("does not leak the mention-id trace onto the finalized claim", () => {
        const c1 = finalize(buildOutputs()).claims.find(
            (c) => c.miniId === "c1"
        )!
        expect("mentionIds" in c1).toBe(false)
    })
})

describe("finalizeResponseV2 — premise source anchors", () => {
    it("anchors a relation-derived premise to its evidence quote", () => {
        const p1 = finalize(buildOutputs()).premises.find(
            (p) => p.miniId === "p1"
        )!
        expect(p1.sourceAnchors).toHaveLength(1)
        expect(p1.sourceAnchors![0].quote).toBe("so we should wait")
    })

    it("leaves the conclusion premise unanchored — it has no source relation", () => {
        const p2 = finalize(buildOutputs()).premises.find(
            (p) => p.miniId === "p2"
        )!
        expect("sourceAnchors" in p2).toBe(false)
    })

    it("omits the key when the evidence quote is absent from the input", () => {
        const outputs = buildOutputs()
        const relations = outputs[
            STAGE_IDS.relationExtraction
        ] as TRelationExtractionOutput
        relations.relations[0].evidence.quote = "a clause never written"

        const p1 = finalize(outputs).premises.find((p) => p.miniId === "p1")!
        expect("sourceAnchors" in p1).toBe(false)
    })
})

describe("finalizeResponseV2 — foreign input shapes", () => {
    // `TStageContext.input` is `unknown`, and `finalizeResponseV2` is
    // public API for consumers assembling their own pipelines. Before
    // anchors existed finalize never read the input at all, so any
    // input shape worked; reading it must not turn a different
    // `inputSchema` into a throw on the happy path, after every LLM
    // call has already been paid for.
    function finalizeWithInput(input: unknown): {
        claims: TAnchored[]
        premises: TAnchored[]
    } {
        const outputs = buildOutputs()
        const ctx: TStageContext = {
            ...buildContextStub(outputs),
            input,
        }
        const out = finalizeResponseV2({
            ctx,
            extension: basicsExtension,
            segmentation: outputs[
                STAGE_IDS.segmentation
            ] as TSegmentationOutput,
            mentions: outputs[
                STAGE_IDS.claimMentionExtraction
            ] as TClaimMentionExtractionOutput,
        })
        return out.argument as unknown as {
            claims: TAnchored[]
            premises: TAnchored[]
        }
    }

    it("assembles the argument when the input has no `text` field", () => {
        const { claims, premises } = finalizeWithInput({ document: INPUT_TEXT })
        expect(claims).toHaveLength(3)
        expect(premises).toHaveLength(2)
    })

    it("emits no anchors rather than throwing on a foreign input shape", () => {
        const { claims, premises } = finalizeWithInput({ document: INPUT_TEXT })
        for (const entity of [...claims, ...premises]) {
            expect("sourceAnchors" in entity).toBe(false)
        }
    })

    it("tolerates a null or non-object input", () => {
        expect(() => finalizeWithInput(null)).not.toThrow()
        expect(() => finalizeWithInput("just a string")).not.toThrow()
    })
})

describe("finalizeResponseV2 — pipelines without segmentation", () => {
    // The fast pipeline collapses segmentation and mention extraction
    // into one call and emits synthetic mention ids, so no mention
    // record exists to anchor a claim against. Relation evidence still
    // does, so premises stay anchored.
    it("leaves claims unanchored but still anchors relation-derived premises", () => {
        const outputs = buildOutputs()
        delete outputs[STAGE_IDS.segmentation]
        delete outputs[STAGE_IDS.claimMentionExtraction]

        const { claims, premises } = finalize(outputs)
        for (const claim of claims) {
            expect("sourceAnchors" in claim).toBe(false)
        }
        const p1 = premises.find((p) => p.miniId === "p1")!
        expect(p1.sourceAnchors![0].quote).toBe("so we should wait")
    })
})
