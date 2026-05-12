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
}): TParsedArgumentResponse {
    return {
        argument: {
            claims: parts.claims,
            variables: parts.variables,
            premises: parts.premises,
            conclusionPremiseMiniId: parts.conclusionPremiseMiniId,
        },
        uncategorizedText: null,
        selectionRationale: null,
        failureText: null,
    }
}

describe("ArgumentParser — formula-inferred citation/axiom edges", () => {
    it("extracts a single citation edge from IMPLIES(citation_var, normal_var)", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Cite implies Concl" }],
            conclusionPremiseMiniId: "p1",
        })

        const parser = new ArgumentParser()
        const result = parser.build(response)

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

    it("emits two citation edges for OR antecedent with two citation vars", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c3",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "A", claimMiniId: "c1" },
                { miniId: "v2", symbol: "B", claimMiniId: "c2" },
                { miniId: "v3", symbol: "C", claimMiniId: "c3" },
            ],
            premises: [{ miniId: "p1", formula: "(A or B) implies C" }],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        const normalClaim = result.claimLibrary
            .getAll()
            .find((c) => c.type === "normal")!
        const edges = result.claimCitationLibrary.getConnectionsForClaim(
            normalClaim.id
        )
        expect(edges).toHaveLength(2)
    })

    it("emits a citation edge even for negated antecedent variables", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "not Cite implies Concl" }],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        const normalClaim = result.claimLibrary
            .getAll()
            .find((c) => c.type === "normal")!
        expect(
            result.claimCitationLibrary.getConnectionsForClaim(normalClaim.id)
        ).toHaveLength(1)
    })

    it("treats the right-hand operand of iff as the consequent", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Cite iff Concl" }],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        const normalClaim = result.claimLibrary
            .getAll()
            .find((c) => c.type === "normal")!
        const citationClaim = result.claimLibrary
            .getAll()
            .find((c) => c.type === "citation")!
        const edges = result.claimCitationLibrary.getConnectionsForClaim(
            normalClaim.id
        )
        expect(edges).toHaveLength(1)
        expect(edges[0].supportingClaimId).toBe(citationClaim.id)
    })

    it("emits one citation edge, one axiom edge, and no edge for normal antecedent", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "premise",
                    type: "axiomatic",
                    citationMiniIds: [],
                },
                {
                    miniId: "c3",
                    role: "premise",
                    type: "normal",
                    citationMiniIds: [],
                },
                {
                    miniId: "c4",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Ax", claimMiniId: "c2" },
                { miniId: "v3", symbol: "Norm", claimMiniId: "c3" },
                { miniId: "v4", symbol: "Concl", claimMiniId: "c4" },
            ],
            premises: [
                {
                    miniId: "p1",
                    formula: "(Cite and Ax and Norm) implies Concl",
                },
            ],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        // claimLibrary.getAll() preserves insertion order (Map iteration), so
        // claims appear in the same order as arg.claims in the fixture:
        // [citation, axiomatic, normal-supporting, normal-conclusion].
        const [citationClaim, axiomClaim, , conclClaim] =
            result.claimLibrary.getAll()
        expect(citationClaim.type).toBe("citation")
        expect(axiomClaim.type).toBe("axiomatic")
        expect(conclClaim.type).toBe("normal")

        const citationEdges = result.claimCitationLibrary.getConnectionsForClaim(
            conclClaim.id
        )
        expect(citationEdges).toHaveLength(1)
        expect(citationEdges[0].supportingClaimId).toBe(citationClaim.id)

        const axiomEdges = result.claimAxiomLibrary.getConnectionsForClaim(
            conclClaim.id
        )
        expect(axiomEdges).toHaveLength(1)
        expect(axiomEdges[0].supportingClaimId).toBe(axiomClaim.id)
    })

    it("dedupes identical (claim, supporting) pairs across premises", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "premise",
                    type: "normal",
                    citationMiniIds: [],
                },
                {
                    miniId: "c3",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Intermediate", claimMiniId: "c2" },
                { miniId: "v3", symbol: "Concl", claimMiniId: "c3" },
            ],
            premises: [
                { miniId: "p1", formula: "Cite implies Concl" },
                {
                    miniId: "p2",
                    formula: "(Cite and Intermediate) implies Concl",
                },
            ],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        const conclClaim = result.claimLibrary.getAll()[2]
        expect(
            result.claimCitationLibrary.getConnectionsForClaim(conclClaim.id)
        ).toHaveLength(1)
    })

    it("emits no edge when a citation appears only in the consequent slot", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "normal",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "citation",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Norm", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Cite", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Norm implies Cite" }],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        expect(result.claimCitationLibrary.getAll()).toEqual([])
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
    })

    it("emits no edge from constraint premises (AND-rooted root)", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
            ],
            premises: [
                { miniId: "p1", formula: "Cite and Concl" },
                { miniId: "p2", formula: "Concl" },
            ],
            conclusionPremiseMiniId: "p2",
        })

        const result = new ArgumentParser().build(response)
        expect(result.claimCitationLibrary.getAll()).toEqual([])
    })

    it("returns empty libraries when no implies/iff premise exists", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [{ miniId: "v1", symbol: "X", claimMiniId: "c1" }],
            premises: [{ miniId: "p1", formula: "X" }],
            conclusionPremiseMiniId: "p1",
        })

        const result = new ArgumentParser().build(response)
        expect(result.claimCitationLibrary.getAll()).toEqual([])
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
    })

    it("emits AXIOM_EDGE_REJECTED in non-strict mode for IMPLIES(axiom, citation)", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "axiomatic",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "citation",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Ax", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Cite", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Ax implies Cite" }],
            conclusionPremiseMiniId: "p1",
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
                {
                    miniId: "c1",
                    role: "premise",
                    type: "axiomatic",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "citation",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Ax", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Cite", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Ax implies Cite" }],
            conclusionPremiseMiniId: "p1",
        })

        expect(() => new ArgumentParser().build(response)).toThrow(
            /AXIOM_CLAIM_NOT_NORMAL_TYPE/
        )
    })
})
