import { describe, it, expect } from "vitest"
import {
    ArgumentParser,
    type TParsedArgumentResponse,
    type TParsedClaim,
    type TParsedVariable,
    type TParsedPremise,
} from "../src/lib/parsing/index.js"

function buildResponse(parts: {
    claims: TParsedClaim[]
    variables: TParsedVariable[]
    premises: TParsedPremise[]
    conclusionPremiseMiniId: string
    derivationBacking?: {
        derivedClaimMiniId: string
        supportingClaimMiniIds: string[]
    }[]
}): TParsedArgumentResponse {
    return {
        argument: {
            claims: parts.claims,
            variables: parts.variables,
            premises: parts.premises,
            conclusionPremiseMiniId: parts.conclusionPremiseMiniId,
            ...(parts.derivationBacking
                ? { derivationBacking: parts.derivationBacking }
                : {}),
        },
        uncategorizedText: null,
        selectionRationale: null,
        failureText: null,
    }
}

// In the inference relation model, citation/axiomatic claims never appear in
// freeform premises. Their support is carried in `derivationBacking`
// (consequent claim → its citation/axiomatic supporters); the parser
// materializes each backing entry into a ClaimCitationLibrary /
// ClaimAxiomLibrary edge. Premise formula structure no longer drives edges.
describe("ArgumentParser — derivation-backing citation/axiom edges", () => {
    it("extracts a single citation edge from derivation backing", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "citation" },
                { miniId: "c2", role: "conclusion", type: "normal" },
            ],
            variables: [{ miniId: "v2", symbol: "Concl", claimMiniId: "c2" }],
            premises: [{ miniId: "p1", formula: "Concl" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                { derivedClaimMiniId: "c2", supportingClaimMiniIds: ["c1"] },
            ],
        })

        const result = new ArgumentParser().build(response)
        const claims = result.claimLibrary.getAll()
        const citationClaim = claims.find((c) => c.type === "citation")!
        const normalClaim = claims.find((c) => c.type === "normal")!
        const edges = result.claimCitationLibrary.getConnectionsForClaim(
            normalClaim.id
        )
        expect(edges).toHaveLength(1)
        expect(edges[0].supportingClaimId).toBe(citationClaim.id)
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
        expect(result.warnings).toEqual([])
    })

    it("emits two citation edges for two supporting citations", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "citation" },
                { miniId: "c2", role: "premise", type: "citation" },
                { miniId: "c3", role: "conclusion", type: "normal" },
            ],
            variables: [{ miniId: "v3", symbol: "C", claimMiniId: "c3" }],
            premises: [{ miniId: "p1", formula: "C" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                {
                    derivedClaimMiniId: "c3",
                    supportingClaimMiniIds: ["c1", "c2"],
                },
            ],
        })

        const result = new ArgumentParser().build(response)
        const normalClaim = result.claimLibrary
            .getAll()
            .find((c) => c.type === "normal")!
        expect(
            result.claimCitationLibrary.getConnectionsForClaim(normalClaim.id)
        ).toHaveLength(2)
    })

    it("emits a citation edge and an axiom edge from mixed backing", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "citation" },
                { miniId: "c2", role: "premise", type: "axiomatic" },
                { miniId: "c3", role: "conclusion", type: "normal" },
            ],
            variables: [{ miniId: "v3", symbol: "Concl", claimMiniId: "c3" }],
            premises: [{ miniId: "p1", formula: "Concl" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                {
                    derivedClaimMiniId: "c3",
                    supportingClaimMiniIds: ["c1", "c2"],
                },
            ],
        })

        const result = new ArgumentParser().build(response)
        const [citationClaim, axiomClaim, conclClaim] =
            result.claimLibrary.getAll()
        expect(citationClaim.type).toBe("citation")
        expect(axiomClaim.type).toBe("axiomatic")

        const citationEdges =
            result.claimCitationLibrary.getConnectionsForClaim(conclClaim.id)
        expect(citationEdges).toHaveLength(1)
        expect(citationEdges[0].supportingClaimId).toBe(citationClaim.id)

        const axiomEdges = result.claimAxiomLibrary.getConnectionsForClaim(
            conclClaim.id
        )
        expect(axiomEdges).toHaveLength(1)
        expect(axiomEdges[0].supportingClaimId).toBe(axiomClaim.id)
    })

    it("emits no edge for a normal supporter in backing", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "normal" },
                { miniId: "c2", role: "conclusion", type: "normal" },
            ],
            variables: [{ miniId: "v2", symbol: "Concl", claimMiniId: "c2" }],
            premises: [{ miniId: "p1", formula: "Concl" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                { derivedClaimMiniId: "c2", supportingClaimMiniIds: ["c1"] },
            ],
        })

        const result = new ArgumentParser().build(response)
        expect(result.claimCitationLibrary.getAll()).toEqual([])
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
    })

    it("dedupes a supporter listed twice for the same consequent", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "citation" },
                { miniId: "c2", role: "conclusion", type: "normal" },
            ],
            variables: [{ miniId: "v2", symbol: "Concl", claimMiniId: "c2" }],
            premises: [{ miniId: "p1", formula: "Concl" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                {
                    derivedClaimMiniId: "c2",
                    supportingClaimMiniIds: ["c1", "c1"],
                },
            ],
        })

        const result = new ArgumentParser().build(response)
        const normalClaim = result.claimLibrary
            .getAll()
            .find((c) => c.type === "normal")!
        expect(
            result.claimCitationLibrary.getConnectionsForClaim(normalClaim.id)
        ).toHaveLength(1)
    })

    it("ignores premise formula structure: a citation in a premise creates no edge without backing", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "citation" },
                { miniId: "c2", role: "conclusion", type: "normal" },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Cite implies Concl" }],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        expect(result.claimCitationLibrary.getAll()).toEqual([])
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
    })

    it("emits AXIOM_EDGE_REJECTED in non-strict mode when backing a citation with an axiom", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "axiomatic" },
                { miniId: "c2", role: "conclusion", type: "citation" },
            ],
            variables: [{ miniId: "v2", symbol: "Cite", claimMiniId: "c2" }],
            premises: [{ miniId: "p1", formula: "Cite" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                { derivedClaimMiniId: "c2", supportingClaimMiniIds: ["c1"] },
            ],
        })

        const result = new ArgumentParser().build(response, { strict: false })
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
        const axWarning = result.warnings.find(
            (w) => w.code === "AXIOM_EDGE_REJECTED"
        )
        expect(axWarning).toBeDefined()
        expect(axWarning?.context.libraryErrorCode).toBe(
            "AXIOM_CLAIM_NOT_NORMAL_TYPE"
        )
    })

    it("throws on the same scenario in strict mode", () => {
        const response = buildResponse({
            claims: [
                { miniId: "c1", role: "premise", type: "axiomatic" },
                { miniId: "c2", role: "conclusion", type: "citation" },
            ],
            variables: [{ miniId: "v2", symbol: "Cite", claimMiniId: "c2" }],
            premises: [{ miniId: "p1", formula: "Cite" }],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [
                { derivedClaimMiniId: "c2", supportingClaimMiniIds: ["c1"] },
            ],
        })

        expect(() => new ArgumentParser().build(response)).toThrow(
            /AXIOM_CLAIM_NOT_NORMAL_TYPE/
        )
    })
})

describe("ArgumentParser — a mapping hook returning undefined", () => {
    // The map* hooks are the documented extension point, and returning
    // `{ field: undefined }` for something a hook could not populate is
    // ordinary JavaScript. Spreading that straight into a fresh entity creates
    // the key holding `undefined`: the checksum is unaffected, because
    // canonical serialization drops it, but `"field" in entity` is true and any
    // downstream mapper that coerces `undefined` to `null` flips it to present
    // — the same failure the engine-level extras paths had.
    class UndefinedMappingParser extends ArgumentParser {
        protected override mapClaim(): Record<string, unknown> {
            return { title: undefined, source: "hook" }
        }
        protected override mapVariable(): Record<string, unknown> {
            return { label: undefined }
        }
        protected override mapClaimCitation(): Record<string, unknown> {
            return { note: undefined }
        }
    }

    const response = buildResponse({
        claims: [
            { miniId: "c1", role: "premise", type: "citation" },
            { miniId: "c2", role: "conclusion", type: "normal" },
        ],
        variables: [{ miniId: "v2", symbol: "Concl", claimMiniId: "c2" }],
        premises: [{ miniId: "p1", formula: "Concl" }],
        conclusionPremiseMiniId: "p1",
        derivationBacking: [
            { derivedClaimMiniId: "c2", supportingClaimMiniIds: ["c1"] },
        ],
    })

    it("does not create the key on a claim", () => {
        const result = new UndefinedMappingParser().build(response)
        for (const claim of result.claimLibrary.getAll()) {
            expect("title" in claim).toBe(false)
            // A defined value from the same hook still lands.
            expect(claim).toMatchObject({ source: "hook" })
        }
    })

    it("does not create the key on a variable", () => {
        const result = new UndefinedMappingParser().build(response)
        const variables = result.engine.getVariables()
        expect(variables.length).toBeGreaterThan(0)
        for (const variable of variables) {
            expect("label" in variable).toBe(false)
        }
    })

    it("does not create the key on a claim-connection edge", () => {
        const result = new UndefinedMappingParser().build(response)
        const edges = result.claimCitationLibrary.getAll()
        expect(edges.length).toBeGreaterThan(0)
        for (const edge of edges) {
            expect("note" in edge).toBe(false)
        }
    })
})
