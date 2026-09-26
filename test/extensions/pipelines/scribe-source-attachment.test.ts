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
    structure: unknown,
    text: string = INPUT_TEXT
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
        { text },
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
            structureOutput(["c1"], ["c99"])
        )
        const conclusion = result.output?.argument?.claims.find(
            (c) => (c as { role?: string }).role === "conclusion"
        ) as { miniId?: string } | undefined
        expect(conclusion?.miniId).toBe("c5")
        expect(backing(result)).toEqual({ c1: ["c2"], c3: ["c4"] })
    })

    it("falls back when structure's relation using the source is dropped", async () => {
        // An unknown antecedent makes the compiler drop the whole relation,
        // so the source it names backs nothing unless it is attached here.
        const result = await runScribe(
            extractOutput(),
            structureOutput(["c1", "c2", "c3", "c99"])
        )
        expect(backing(result)).toEqual({ c1: ["c2"], c3: ["c4"] })
    })

    it("warns about a pairing whose source is unknown or not a citation", async () => {
        const result = await runScribe(
            extractOutput([
                { sourceMiniId: "c1", supportedMiniId: "c3" },
                { sourceMiniId: "c77", supportedMiniId: "c3" },
            ]),
            structureOutput()
        )
        expect(backing(result)).toEqual({ c1: ["c2"], c3: ["c4"] })
        const invalid = result.failures.filter(
            (f) => f.code === "SOURCE_ATTACHMENT_INVALID_SOURCE"
        )
        expect(invalid.map((f) => f.context?.sourceMiniId).sort()).toEqual([
            "c1",
            "c77",
        ])
        expect(invalid.every((f) => f.severity === "warning")).toBe(true)
    })
})

type TClaimSpec = {
    id: string
    type: "normal" | "citation" | "axiomatic"
    quote: string
    url?: string
}

function claimFields(c: TClaimSpec): Record<string, unknown> {
    if (c.type === "citation")
        return {
            title: `Claim ${c.id}`,
            url: c.url ?? `https://source.example/${c.id}`,
            citationTypeGuess: "Website",
        }
    if (c.type === "axiomatic") return { axiom: `Axiom ${c.id}` }
    return { title: `Claim ${c.id}`, body: `Claim ${c.id}.` }
}

/** An extract payload for `text`, one mention per claim. */
function extractFor(
    text: string,
    claims: TClaimSpec[],
    sourceSupport: { sourceMiniId: string; supportedMiniId: string }[] = []
): unknown {
    return {
        canonicalClaims: claims.map((c) => ({
            miniId: c.id,
            mentionIds: [`${c.id}-m`],
            suggestedSymbol: `Claim_${c.id}`,
            type: c.type,
            ...claimFields(c),
        })),
        mentionToClaim: claims.map((c) => ({
            mentionId: `${c.id}-m`,
            claimMiniId: c.id,
        })),
        mentions: claims.map((c) => {
            const start = text.indexOf(c.quote)
            return {
                mentionId: `${c.id}-m`,
                segmentId: "",
                text: c.quote,
                span: { start, end: start + c.quote.length },
            }
        }),
        sourceSupport,
    }
}

function relationTo(consequent: string, antecedents: string[]): unknown {
    return {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents,
                consequent,
                title: "Step",
                evidence: { segmentIds: [], quote: "" },
            },
        ],
        conclusionCandidates: [consequent],
        conclusionTitle: "Upshot",
        rationale: "The consequent supports nothing further.",
    }
}

describe("scribe's position fallback for an unpaired source", () => {
    it("attaches a leading link to the claim later in its own sentence", async () => {
        // "According to <link>, <claim>." — the claim follows the link, and
        // the previous sentence's claim is the wrong one to back.
        const text =
            "Summers are longer now. According to [a report](https://report.example/heat), global temperatures rose. So the climate is changing."
        const result = await runScribe(
            extractFor(text, [
                { id: "c1", type: "normal", quote: "Summers are longer now." },
                {
                    id: "c2",
                    type: "citation",
                    quote: "According to [a report](https://report.example/heat)",
                },
                {
                    id: "c3",
                    type: "normal",
                    quote: "global temperatures rose.",
                },
                {
                    id: "c4",
                    type: "normal",
                    quote: "the climate is changing.",
                },
            ]),
            relationTo("c4", ["c1", "c3"]),
            text
        )
        expect(backing(result)).toEqual({ c3: ["c2"] })
    })

    it("attaches a leading link with nothing before it", async () => {
        const text =
            "According to [a report](https://report.example/heat), global temperatures rose. So the climate is changing."
        const result = await runScribe(
            extractFor(text, [
                {
                    id: "c1",
                    type: "citation",
                    quote: "According to [a report](https://report.example/heat)",
                },
                {
                    id: "c2",
                    type: "normal",
                    quote: "global temperatures rose.",
                },
                {
                    id: "c3",
                    type: "normal",
                    quote: "the climate is changing.",
                },
            ]),
            relationTo("c3", ["c2"]),
            text
        )
        expect(backing(result)).toEqual({ c2: ["c1"] })
        expect(
            result.failures.filter(
                (f) => f.code === "SOURCE_ATTACHMENT_UNATTACHED"
            )
        ).toEqual([])
    })

    it("picks the claim the source's mention overlaps most", async () => {
        const text =
            "Wages fell and prices rose sharply this year ([data](https://data.example/x)). So workers are worse off."
        const result = await runScribe(
            extractFor(text, [
                { id: "c1", type: "normal", quote: "Wages fell" },
                {
                    id: "c2",
                    type: "normal",
                    quote: "prices rose sharply this year",
                },
                {
                    id: "c3",
                    type: "citation",
                    quote: "Wages fell and prices rose sharply this year ([data](https://data.example/x))",
                },
                {
                    id: "c4",
                    type: "normal",
                    quote: "workers are worse off.",
                },
            ]),
            relationTo("c4", ["c1", "c2"]),
            text
        )
        expect(backing(result)).toEqual({ c2: ["c3"] })
    })

    it("leaves a source with no claim in its sentence or before it unattached, and says so", async () => {
        const text =
            "Sources: https://first.example/intro.\nIt is raining. So the ground is wet."
        const result = await runScribe(
            extractFor(text, [
                {
                    id: "c1",
                    type: "citation",
                    quote: "Sources: https://first.example/intro.",
                },
                { id: "c2", type: "normal", quote: "It is raining." },
                { id: "c3", type: "normal", quote: "the ground is wet." },
            ]),
            relationTo("c3", ["c2"]),
            text
        )
        expect(backing(result)).toEqual({})
        const unattached = result.failures.filter(
            (f) => f.code === "SOURCE_ATTACHMENT_UNATTACHED"
        )
        expect(unattached.map((f) => f.context?.sourceMiniId)).toEqual(["c1"])
    })
})

function codes(result: TRunResult, code: string): TRunResult["failures"] {
    return result.failures.filter((f) => f.code === code)
}

function claimOf(result: TRunResult, miniId: string): Record<string, unknown> {
    return result.output?.argument?.claims.find(
        (c) => (c as { miniId?: string }).miniId === miniId
    ) as Record<string, unknown>
}

describe("scribe keeps only a citation url that the text contains", () => {
    // Seen on a Wikipedia import with no URLs in its text: the reference
    // list's bare site names ("www.gutenberg.org") became invented links.
    const text =
        'Pascal wrote the Pensées. "The Project Gutenberg eBook of Pascal\'s Pensées". www.gutenberg.org. ' +
        "The data is at HTTPS://Data.Example/wages. So wagers are rational."

    async function run(urls: { c2: string; c3: string }): Promise<TRunResult> {
        return runScribe(
            extractFor(
                text,
                [
                    {
                        id: "c1",
                        type: "normal",
                        quote: "Pascal wrote the Pensées.",
                    },
                    {
                        id: "c2",
                        type: "citation",
                        quote: "www.gutenberg.org.",
                        url: urls.c2,
                    },
                    {
                        id: "c3",
                        type: "citation",
                        quote: "The data is at HTTPS://Data.Example/wages.",
                        url: urls.c3,
                    },
                    { id: "c4", type: "normal", quote: "wagers are rational." },
                ],
                [
                    { sourceMiniId: "c2", supportedMiniId: "c1" },
                    { sourceMiniId: "c3", supportedMiniId: "c1" },
                ]
            ),
            relationTo("c4", ["c1"]),
            text
        )
    }

    it("clears a url built from a site name and warns, keeping the citation", async () => {
        const result = await run({
            c2: "https://www.gutenberg.org/",
            c3: "https://data.example/wages/",
        })
        const invented = claimOf(result, "c2")
        expect(invented.type).toBe("citation")
        expect(invented.url).toBe("")
        expect((invented.citation as { url?: string }).url).toBeUndefined()
        // Differs from the text only in scheme and host case and a
        // trailing slash, so it is the author's link.
        expect(claimOf(result, "c3").url).toBe("https://data.example/wages/")
        expect(backing(result)).toEqual({ c1: ["c2", "c3"] })
        const warnings = codes(result, "SOURCE_URL_NOT_IN_TEXT")
        expect(warnings.map((f) => f.context?.miniId)).toEqual(["c2"])
        expect(warnings[0].context?.url).toBe("https://www.gutenberg.org/")
        expect(warnings[0].severity).toBe("warning")
    })

    it("does not accept a url that is longer or shorter than the text's", async () => {
        const result = await run({
            c2: "https://data.example/wag",
            c3: "https://data.example/wages-2024",
        })
        expect(claimOf(result, "c2").url).toBe("")
        expect(claimOf(result, "c3").url).toBe("")
        expect(
            codes(result, "SOURCE_URL_NOT_IN_TEXT").map(
                (f) => f.context?.miniId
            )
        ).toEqual(["c2", "c3"])
    })
})

describe("scribe attaches axioms like sources", () => {
    const text =
        "Everyone deserves dignity. So prisoners deserve humane conditions. Prison food is poor ([report](https://report.example/food)). So prisons must improve."
    const claims: TClaimSpec[] = [
        { id: "c1", type: "axiomatic", quote: "Everyone deserves dignity." },
        {
            id: "c2",
            type: "normal",
            quote: "prisoners deserve humane conditions.",
        },
        { id: "c3", type: "normal", quote: "Prison food is poor" },
        {
            id: "c4",
            type: "citation",
            quote: "([report](https://report.example/food))",
            url: "https://report.example/food",
        },
        { id: "c5", type: "normal", quote: "prisons must improve." },
    ]

    it("attaches an axiom to the claim extract names for it", async () => {
        const result = await runScribe(
            extractFor(text, claims, [
                { sourceMiniId: "c1", supportedMiniId: "c2" },
            ]),
            relationTo("c5", ["c2", "c3"]),
            text
        )
        expect(backing(result)).toEqual({ c2: ["c1"], c3: ["c4"] })
    })

    it("attaches an unpaired axiom by where its mention sits", async () => {
        const result = await runScribe(
            extractFor(text, claims),
            relationTo("c5", ["c2", "c3"]),
            text
        )
        // Nothing precedes the axiom in its sentence or before it, so it
        // is unattached — and says so, rather than silently backing
        // nothing.
        expect(backing(result)).toEqual({ c3: ["c4"] })
        expect(
            codes(result, "SOURCE_ATTACHMENT_UNATTACHED").map(
                (f) => f.context?.sourceMiniId
            )
        ).toEqual(["c1"])
    })

    it("attaches an unpaired axiom to the claim in its own sentence", async () => {
        const inline =
            "Prisoners deserve humane conditions, since everyone deserves dignity. So prisons must improve."
        const result = await runScribe(
            extractFor(inline, [
                {
                    id: "c1",
                    type: "normal",
                    quote: "Prisoners deserve humane conditions",
                },
                {
                    id: "c2",
                    type: "axiomatic",
                    quote: "everyone deserves dignity.",
                },
                { id: "c3", type: "normal", quote: "prisons must improve." },
            ]),
            relationTo("c3", ["c1"]),
            inline
        )
        expect(backing(result)).toEqual({ c1: ["c2"] })
    })

    it("does not attach an axiom to a claim a source already backs, and warns", async () => {
        const result = await runScribe(
            extractFor(text, claims, [
                { sourceMiniId: "c1", supportedMiniId: "c3" },
                { sourceMiniId: "c4", supportedMiniId: "c3" },
            ]),
            relationTo("c5", ["c2", "c3"]),
            text
        )
        expect(backing(result)).toEqual({ c3: ["c4"] })
        const mixed = codes(result, "SOURCE_ATTACHMENT_MIXED")
        expect(mixed.map((f) => f.context)).toEqual([
            { sourceMiniId: "c1", supportedMiniId: "c3" },
        ])
        expect(mixed[0].severity).toBe("warning")
    })
})
