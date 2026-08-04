// Unit tests for `finalizeResponseV2` premise-title composition.
//
// `finalizeResponseV2` assembles the v2 pipeline's final response from
// the accumulated per-stage outputs. These tests pin the *premise
// title* behavior: titles must read as natural-language prose composed
// from the LLM-authored claim titles (mirroring `buildArgumentTitle`)
// rather than serializing the compiled symbolic formula.
//
// We build a minimal `TStageContext` stub whose `get<T>(stageId)`
// returns canned stage outputs, then call `finalizeResponseV2`
// directly. This keeps the title assertions decoupled from the full
// 12-stage LLM-mocked pipeline.

import { describe, expect, it } from "vitest"
import {
    basicsExtension,
    finalizeResponseV2,
} from "../../../src/extensions/pipelines/base/index.js"
import {
    STAGE_IDS,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TRelationExtractionOutput,
    type TVariableAssignmentOutput,
} from "../../../src/extensions/pipelines/base/stages/index.js"
import { structureConclusionAdapterStage } from "../../../src/extensions/pipelines/ingestion/scribe/structure-stage.js"
import type { TStageContext } from "../../../src/lib/pipelines/index.js"

/**
 * Build a `TStageContext` stub that serves canned stage outputs from a
 * lookup table. Only `get` is load-bearing for `finalizeResponseV2`;
 * the remaining members are inert stubs.
 */
function buildContextStub(outputs: Record<string, unknown>): TStageContext {
    return {
        input: { text: "ignored" },
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

// A "Strait of Hormuz" argument:
//   c1  "Forcing Hormuz open is too risky"  → Hormuz_Too_Risky
//   c2  "No realistic off-ramp exists"      → No_Offramp
//   c3  "Diplomacy beats escalation"        → Diplomacy_Wins
//   c4  "The US should not strike"          → No_Strike   (conclusion)
//
// Relations:
//   r1  support        c1 → c2     ⇒ Hormuz_Too_Risky implies No_Offramp
//   r2  joint-support  c2,c3 → c4  ⇒ (No_Offramp and Diplomacy_Wins) implies No_Strike
// Conclusion premise: bare `No_Strike`.
function buildHormuzOutputs(): Record<string, unknown> {
    const canonicalization: TClaimCanonicalizationOutput = {
        canonicalClaims: [
            {
                miniId: "c1",
                mentionIds: ["m1"],
                suggestedSymbol: "Hormuz_Too_Risky",
                type: "normal",
                ...({
                    title: "Forcing Hormuz open is too risky",
                    body: "Forcing the Strait of Hormuz open is too risky.",
                } as Record<string, unknown>),
            },
            {
                miniId: "c2",
                mentionIds: ["m2"],
                suggestedSymbol: "No_Offramp",
                type: "normal",
                ...({
                    title: "No realistic off-ramp exists",
                    body: "There is no realistic off-ramp.",
                } as Record<string, unknown>),
            },
            {
                miniId: "c3",
                mentionIds: ["m3"],
                suggestedSymbol: "Diplomacy_Wins",
                type: "normal",
                ...({
                    title: "Diplomacy beats escalation",
                    body: "Diplomacy beats escalation.",
                } as Record<string, unknown>),
            },
            {
                miniId: "c4",
                mentionIds: ["m4"],
                suggestedSymbol: "No_Strike",
                type: "normal",
                ...({
                    title: "The US should not strike",
                    body: "The US should not strike.",
                } as Record<string, unknown>),
            },
        ],
        mentionToClaim: [
            { mentionId: "m1", claimMiniId: "c1" },
            { mentionId: "m2", claimMiniId: "c2" },
            { mentionId: "m3", claimMiniId: "c3" },
            { mentionId: "m4", claimMiniId: "c4" },
        ],
    }

    const typeMap: TClaimTypeClassificationOutput = {
        classifications: [
            { miniId: "c1", type: "normal", sourceString: null },
            { miniId: "c2", type: "normal", sourceString: null },
            { miniId: "c3", type: "normal", sourceString: null },
            { miniId: "c4", type: "normal", sourceString: null },
        ],
    }

    const variables: TVariableAssignmentOutput = [
        { miniId: "v1", symbol: "Hormuz_Too_Risky", claimMiniId: "c1" },
        { miniId: "v2", symbol: "No_Offramp", claimMiniId: "c2" },
        { miniId: "v3", symbol: "Diplomacy_Wins", claimMiniId: "c3" },
        { miniId: "v4", symbol: "No_Strike", claimMiniId: "c4" },
    ]

    const relations: TRelationExtractionOutput = {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents: ["c1"],
                consequent: "c2",
                title: "",
                evidence: { segmentIds: ["s1"], quote: "too risky" },
            },
            {
                relationId: "r2",
                type: "inference",
                antecedents: ["c2", "c3"],
                consequent: "c4",
                title: "",
                evidence: { segmentIds: ["s2"], quote: "therefore" },
            },
        ],
    }

    const selection: TConclusionSelectionOutput = {
        conclusionMiniId: "c4",
        conclusionCandidates: ["c4"],
        title: "",
        rationale: "c4 is the terminal of the support graph.",
    }

    const compilation: TFormulaCompilationOutput = {
        premises: [
            {
                premiseMiniId: "p1",
                formula: "Hormuz_Too_Risky implies No_Offramp",
                roleHint: "freeform",
                sourceRelationId: "r1",
            },
            {
                premiseMiniId: "p2",
                formula: "(No_Offramp and Diplomacy_Wins) implies No_Strike",
                roleHint: "freeform",
                sourceRelationId: "r2",
            },
            {
                premiseMiniId: "p3",
                formula: "No_Strike",
                roleHint: "conclusion",
                sourceRelationId: null,
            },
        ],
        conclusionPremiseMiniId: "p3",
        derivationBacking: [],
    }

    return {
        [STAGE_IDS.claimCanonicalization]: canonicalization,
        [STAGE_IDS.claimTypeClassification]: typeMap,
        [STAGE_IDS.variableAssignment]: variables,
        [STAGE_IDS.relationExtraction]: relations,
        [STAGE_IDS.conclusionSelection]: selection,
        [STAGE_IDS.formulaCompilation]: compilation,
    }
}

function finalize(outputs: Record<string, unknown>) {
    const ctx = buildContextStub(outputs)
    const out = finalizeResponseV2({
        ctx,
        extension: basicsExtension,
    })
    const argument = out.argument as unknown as {
        premises: { miniId: string; formula: string; title: string }[]
        conclusionPremiseMiniId: string
    }
    return argument
}

describe("finalizeResponseV2 — natural-language premise titles", () => {
    it('titles a support (implies) premise as \'If "<ant>" then "<cons>"\'', () => {
        const argument = finalize(buildHormuzOutputs())
        const support = argument.premises.find((p) => p.miniId === "p1")!
        expect(support.title).toBe(
            'If "Forcing Hormuz open is too risky" then "No realistic off-ramp exists"'
        )
        // Machine formula must remain byte-for-byte unchanged.
        expect(support.formula).toBe("Hormuz_Too_Risky implies No_Offramp")
    })

    it("titles a joint-support (and) premise with an 'and'-joined antecedent", () => {
        const argument = finalize(buildHormuzOutputs())
        const joint = argument.premises.find((p) => p.miniId === "p2")!
        expect(joint.title).toBe(
            'If "No realistic off-ramp exists" and "Diplomacy beats escalation" then "The US should not strike"'
        )
        expect(joint.formula).toBe(
            "(No_Offramp and Diplomacy_Wins) implies No_Strike"
        )
    })

    it("titles the conclusion premise as the bare claim title (no role prefix)", () => {
        const argument = finalize(buildHormuzOutputs())
        const conclusion = argument.premises.find((p) => p.miniId === "p3")!
        expect(conclusion.title).toBe("The US should not strike")
        expect(conclusion.formula).toBe("No_Strike")
    })

    it("does not prefix prose titles with a role label", () => {
        const argument = finalize(buildHormuzOutputs())
        for (const p of argument.premises) {
            expect(p.title).not.toMatch(
                /^(Support:|Joint support|Conclusion:|Derivation:)/
            )
        }
    })

    it("does not truncate readable prose titles at 50 chars", () => {
        const argument = finalize(buildHormuzOutputs())
        const joint = argument.premises.find((p) => p.miniId === "p2")!
        expect(joint.title.length).toBeGreaterThan(50)
        expect(joint.title).not.toContain("…")
    })

    it("falls back to the symbol when a variable has no resolvable claim title", () => {
        const outputs = buildHormuzOutputs()
        // Drop c2's title/axiom so its claim title cannot resolve; the
        // symbol No_Offramp should appear verbatim instead of throwing.
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c2 = canon.canonicalClaims.find(
            (c) => c.miniId === "c2"
        )! as Record<string, unknown>
        delete c2.title
        delete c2.axiom

        const argument = finalize(outputs)
        const support = argument.premises.find((p) => p.miniId === "p1")!
        expect(support.title).toBe(
            'If "Forcing Hormuz open is too risky" then "No_Offramp"'
        )
    })
})

// -- Authored titles --
//
// A relation and the conclusion-selection slot each carry a `title` the
// model authored to name the inferential move. finalize prefers it over
// the composition above — but only when it is usable, and for the
// conclusion only when the resolved conclusion is the very candidate the
// title was written for.

function relationsOf(outputs: Record<string, unknown>) {
    return (outputs[STAGE_IDS.relationExtraction] as TRelationExtractionOutput)
        .relations
}

function selectionOf(outputs: Record<string, unknown>) {
    return outputs[STAGE_IDS.conclusionSelection] as TConclusionSelectionOutput
}

function titleOf(outputs: Record<string, unknown>, premiseMiniId: string) {
    return finalize(outputs).premises.find((p) => p.miniId === premiseMiniId)!
        .title
}

describe("finalizeResponseV2 — authored relation titles", () => {
    it("uses the relation's authored title verbatim", () => {
        const outputs = buildHormuzOutputs()
        relationsOf(outputs)[0].title = "Limits of the crowd's power"
        expect(titleOf(outputs, "p1")).toBe("Limits of the crowd's power")
    })

    it("trims surrounding whitespace off an authored title", () => {
        const outputs = buildHormuzOutputs()
        relationsOf(outputs)[0].title = "  Principle over survival\n"
        expect(titleOf(outputs, "p1")).toBe("Principle over survival")
    })

    it("composes when the authored title is whitespace-only", () => {
        const outputs = buildHormuzOutputs()
        relationsOf(outputs)[0].title = "   "
        expect(titleOf(outputs, "p1")).toBe(
            'If "Forcing Hormuz open is too risky" then "No realistic off-ramp exists"'
        )
    })

    it("composes when the relation carries no title at all", () => {
        const outputs = buildHormuzOutputs()
        delete (relationsOf(outputs)[0] as Record<string, unknown>).title
        expect(titleOf(outputs, "p1")).toBe(
            'If "Forcing Hormuz open is too risky" then "No realistic off-ramp exists"'
        )
    })

    it("clamps an over-long authored title rather than failing the run", () => {
        const outputs = buildHormuzOutputs()
        relationsOf(outputs)[0].title = "x".repeat(500)
        const ctx = buildContextStub(outputs)
        const response = finalizeResponseV2({ ctx, extension: basicsExtension })
        // The run completes — an unusable length is a display problem,
        // not grounds for discarding a finished pipeline run.
        expect(response.failureText).toBeNull()
        expect(response.argument).not.toBeNull()
        const title = titleOf(outputs, "p1")
        expect(title).toHaveLength(80)
        expect(title.endsWith("…")).toBe(true)
    })

    it("leaves the machine formula untouched when a title is authored", () => {
        const outputs = buildHormuzOutputs()
        relationsOf(outputs)[0].title = "Limits of the crowd's power"
        const support = finalize(outputs).premises.find(
            (p) => p.miniId === "p1"
        )!
        expect(support.formula).toBe("Hormuz_Too_Risky implies No_Offramp")
    })
})

describe("finalizeResponseV2 — authored conclusion titles", () => {
    it("uses the authored title when the resolved conclusion is the first candidate", () => {
        const outputs = buildHormuzOutputs()
        const selection = selectionOf(outputs)
        selection.conclusionCandidates = ["c4"]
        selection.conclusionMiniId = "c4"
        selection.title = "Restraint over escalation"
        expect(titleOf(outputs, "p3")).toBe("Restraint over escalation")
    })

    it("composes when a later candidate was resolved — the title describes the first", () => {
        const outputs = buildHormuzOutputs()
        const selection = selectionOf(outputs)
        // The model's best pick (c9) was not a known normal claim, so
        // resolution moved on to c4. The authored title still describes
        // c9 and must not be pinned onto c4's premise.
        selection.conclusionCandidates = ["c9", "c4"]
        selection.conclusionMiniId = "c4"
        selection.title = "A title written about a different claim"
        expect(titleOf(outputs, "p3")).toBe("The US should not strike")
    })

    it("composes when the conclusion came from the relation-graph fallback", () => {
        const outputs = buildHormuzOutputs()
        const selection = selectionOf(outputs)
        // The model named no candidate at all; `conclusionMiniId` was
        // resolved deterministically from the relation graph.
        selection.conclusionCandidates = []
        selection.conclusionMiniId = "c4"
        selection.title = "A title written about nothing in particular"
        expect(titleOf(outputs, "p3")).toBe("The US should not strike")
    })

    it("composes when the authored conclusion title is whitespace-only", () => {
        const outputs = buildHormuzOutputs()
        selectionOf(outputs).title = "   "
        expect(titleOf(outputs, "p3")).toBe("The US should not strike")
    })

    it("clamps an over-long authored conclusion title", () => {
        const outputs = buildHormuzOutputs()
        selectionOf(outputs).title = "y".repeat(500)
        const title = titleOf(outputs, "p3")
        expect(title).toHaveLength(80)
        expect(title.endsWith("…")).toBe(true)
    })
})

describe("finalizeResponseV2 — title resolution is pipeline-independent", () => {
    it("resolves the same titles whether the slots come from scholar or scribe", async () => {
        // scribe emits relations + conclusion candidates in one call and
        // republishes them into the same two slots scholar's dedicated
        // stages fill. Same slot contents ⇒ same titles, so the adapter's
        // `conclusionTitle` → `title` hand-off is the only thing that can
        // make the two pipelines disagree.
        const scholarOutputs = buildHormuzOutputs()
        relationsOf(scholarOutputs)[0].title = "Limits of the crowd's power"
        relationsOf(scholarOutputs)[1].title = "Principle over survival"
        selectionOf(scholarOutputs).title = "Restraint over escalation"

        const scribeStructure = {
            relations: relationsOf(scholarOutputs),
            conclusionCandidates:
                selectionOf(scholarOutputs).conclusionCandidates,
            conclusionTitle: "Restraint over escalation",
            rationale: selectionOf(scholarOutputs).rationale,
        }
        const scribeOutputs = { ...buildHormuzOutputs() }
        scribeOutputs[STAGE_IDS.relationExtraction] = {
            relations: scribeStructure.relations,
        }
        scribeOutputs[STAGE_IDS.scribeStructure] = scribeStructure
        scribeOutputs[STAGE_IDS.conclusionSelection] =
            await structureConclusionAdapterStage.run(
                buildContextStub(scribeOutputs)
            )

        const scholarTitles = finalize(scholarOutputs).premises.map(
            (p) => p.title
        )
        expect(finalize(scribeOutputs).premises.map((p) => p.title)).toEqual(
            scholarTitles
        )
        expect(scholarTitles).toEqual([
            "Limits of the crowd's power",
            "Principle over survival",
            "Restraint over escalation",
        ])
    })
})

// A claim the type-classifier marked `citation` that is also a relation
// source/target (a propositional antecedent or consequent). The claim
// stays typed `citation` and finalize attaches an explicit
// `UnparsedCitation` whose `text` carries the display string — so a
// url-less reference no longer renders blank — instead of being demoted
// to `normal`.
//
//   c1  "Pooley case reports imprisonment"  → citation, source of r1
//   c2  "Footnotes support the argument"     → normal, conclusion
//   r1  support  c1 → c2
function buildCitationAntecedentOutputs(): Record<string, unknown> {
    const canonicalization: TClaimCanonicalizationOutput = {
        canonicalClaims: [
            {
                miniId: "c1",
                mentionIds: ["m1"],
                suggestedSymbol: "Pooley",
                type: "citation",
                ...({
                    title: "Pooley case reports imprisonment",
                    body: "",
                    url: "",
                } as Record<string, unknown>),
            },
            {
                miniId: "c2",
                mentionIds: ["m2"],
                suggestedSymbol: "Footnotes",
                type: "normal",
                ...({
                    title: "Footnotes support the argument",
                    body: "The footnotes reinforce the case.",
                } as Record<string, unknown>),
            },
        ],
        mentionToClaim: [
            { mentionId: "m1", claimMiniId: "c1" },
            { mentionId: "m2", claimMiniId: "c2" },
        ],
    }

    const typeMap: TClaimTypeClassificationOutput = {
        classifications: [
            { miniId: "c1", type: "citation", sourceString: "Pooley case" },
            { miniId: "c2", type: "normal", sourceString: null },
        ],
    }

    const variables: TVariableAssignmentOutput = [
        { miniId: "v1", symbol: "Pooley", claimMiniId: "c1" },
        { miniId: "v2", symbol: "Footnotes", claimMiniId: "c2" },
    ]

    const relations: TRelationExtractionOutput = {
        relations: [
            {
                relationId: "r1",
                type: "inference",
                antecedents: ["c1"],
                consequent: "c2",
                title: "",
                evidence: { segmentIds: ["s1"], quote: "the footnotes" },
            },
        ],
    }

    const selection: TConclusionSelectionOutput = {
        conclusionMiniId: "c2",
        conclusionCandidates: ["c2"],
        title: "",
        rationale: "c2 is the terminal of the support graph.",
    }

    const compilation: TFormulaCompilationOutput = {
        premises: [
            {
                premiseMiniId: "p1",
                formula: "Pooley implies Footnotes",
                roleHint: "freeform",
                sourceRelationId: "r1",
            },
            {
                premiseMiniId: "p2",
                formula: "Footnotes",
                roleHint: "conclusion",
                sourceRelationId: null,
            },
        ],
        conclusionPremiseMiniId: "p2",
        derivationBacking: [],
    }

    return {
        [STAGE_IDS.claimCanonicalization]: canonicalization,
        [STAGE_IDS.claimTypeClassification]: typeMap,
        [STAGE_IDS.variableAssignment]: variables,
        [STAGE_IDS.relationExtraction]: relations,
        [STAGE_IDS.conclusionSelection]: selection,
        [STAGE_IDS.formulaCompilation]: compilation,
    }
}

type TFinalCitation = {
    type: string
    text: string
    citationTypeGuess: string
    url?: string
}

type TFinalClaim = {
    miniId: string
    type: string
    role: string
    title?: string
    citation?: TFinalCitation
    citationTypeGuess?: unknown
}

function finalizeClaims(outputs: Record<string, unknown>): TFinalClaim[] {
    const ctx = buildContextStub(outputs)
    const out = finalizeResponseV2({ ctx, extension: basicsExtension })
    return (out.argument as unknown as { claims: TFinalClaim[] }).claims
}

describe("finalizeResponseV2 — citation claims carry an unparsed citation", () => {
    it("keeps a citation-typed relation source typed citation", () => {
        const claims = finalizeClaims(buildCitationAntecedentOutputs())
        const antecedent = claims.find((c) => c.miniId === "c1")!
        expect(antecedent.role).toBe("premise")
        // The claim stays `citation`; its proposition text is preserved on
        // the attached unparsed citation rather than by demoting the type.
        expect(antecedent.type).toBe("citation")
        expect(antecedent.title).toBe("Pooley case reports imprisonment")
    })

    it("emits a well-formed unparsed citation for a url-less reference", () => {
        const claims = finalizeClaims(buildCitationAntecedentOutputs())
        const antecedent = claims.find((c) => c.miniId === "c1")!
        expect(antecedent.citation).toBeDefined()
        expect(antecedent.citation!.type).toBe("unparsed")
        // The display text falls back to the claim title; no url present.
        expect(antecedent.citation!.text).toBe(
            "Pooley case reports imprisonment"
        )
        expect(antecedent.citation!.url).toBeUndefined()
    })

    it('clamps an absent citation-type guess to "unknown"', () => {
        const claims = finalizeClaims(buildCitationAntecedentOutputs())
        const antecedent = claims.find((c) => c.miniId === "c1")!
        expect(antecedent.citation!.citationTypeGuess).toBe("unknown")
    })

    it('clamps an out-of-enum citation-type guess to "unknown"', () => {
        const outputs = buildCitationAntecedentOutputs()
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c1 = canon.canonicalClaims.find(
            (c) => c.miniId === "c1"
        )! as Record<string, unknown>
        c1.citationTypeGuess = "DefinitelyNotAnIeeeType"

        const antecedent = finalizeClaims(outputs).find(
            (c) => c.miniId === "c1"
        )!
        expect(antecedent.citation!.citationTypeGuess).toBe("unknown")
    })

    it("carries a valid model citation-type guess through verbatim", () => {
        const outputs = buildCitationAntecedentOutputs()
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c1 = canon.canonicalClaims.find(
            (c) => c.miniId === "c1"
        )! as Record<string, unknown>
        c1.citationTypeGuess = "CourtCase"

        const antecedent = finalizeClaims(outputs).find(
            (c) => c.miniId === "c1"
        )!
        expect(antecedent.citation!.citationTypeGuess).toBe("CourtCase")
    })

    it("carries the url onto the unparsed citation when present", () => {
        const outputs = buildCitationAntecedentOutputs()
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c1 = canon.canonicalClaims.find(
            (c) => c.miniId === "c1"
        )! as Record<string, unknown>
        c1.url = "https://example.com/pooley"

        const antecedent = finalizeClaims(outputs).find(
            (c) => c.miniId === "c1"
        )!
        expect(antecedent.type).toBe("citation")
        expect(antecedent.citation!.url).toBe("https://example.com/pooley")
    })

    it("does not leave a loose citationTypeGuess field on the claim", () => {
        const outputs = buildCitationAntecedentOutputs()
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c1 = canon.canonicalClaims.find(
            (c) => c.miniId === "c1"
        )! as Record<string, unknown>
        c1.citationTypeGuess = "CourtCase"

        const antecedent = finalizeClaims(outputs).find(
            (c) => c.miniId === "c1"
        )!
        expect(antecedent.citationTypeGuess).toBeUndefined()
    })

    it('clamps a non-string citation-type guess to "unknown"', () => {
        const outputs = buildCitationAntecedentOutputs()
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c1 = canon.canonicalClaims.find(
            (c) => c.miniId === "c1"
        )! as Record<string, unknown>
        c1.citationTypeGuess = 42

        const antecedent = finalizeClaims(outputs).find(
            (c) => c.miniId === "c1"
        )!
        expect(antecedent.citation!.citationTypeGuess).toBe("unknown")
    })

    it("falls back to the classifier source string, then the id, for the citation text", () => {
        const outputs = buildCitationAntecedentOutputs()
        const canon = outputs[
            STAGE_IDS.claimCanonicalization
        ] as TClaimCanonicalizationOutput
        const c1 = canon.canonicalClaims.find(
            (c) => c.miniId === "c1"
        )! as Record<string, unknown>
        // Blank the title so the text falls back to the classifier's
        // recorded source string ("Pooley case").
        c1.title = ""
        const withSource = finalizeClaims(outputs).find(
            (c) => c.miniId === "c1"
        )!
        expect(withSource.citation!.text).toBe("Pooley case")

        // Drop the source string too → final fallback is the claim id.
        const typeMap = outputs[
            STAGE_IDS.claimTypeClassification
        ] as TClaimTypeClassificationOutput
        typeMap.classifications.find((e) => e.miniId === "c1")!.sourceString =
            null
        const withId = finalizeClaims(outputs).find((c) => c.miniId === "c1")!
        expect(withId.citation!.text).toBe("c1")
    })
})
