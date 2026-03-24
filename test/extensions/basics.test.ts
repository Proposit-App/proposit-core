import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import {
    BasicsArgumentParser,
    BasicsParsingSchema,
    BasicsArgumentSchema,
    BasicsClaimSchema,
    BasicsPremiseSchema,
} from "../../src/extensions/basics"

function basicsResponse(): Record<string, unknown> {
    return {
        argument: {
            claims: [
                {
                    miniId: "C1",
                    role: "premise",
                    sourceMiniIds: [],
                    title: "Earth is warming",
                    body: "Global average temperatures have increased over the past century.",
                },
                {
                    miniId: "C2",
                    role: "conclusion",
                    sourceMiniIds: [],
                    title: "Action needed",
                    body: "Immediate action is required to address climate change.",
                },
            ],
            variables: [
                { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
            ],
            sources: [],
            premises: [
                {
                    miniId: "P1",
                    formula: "P implies Q",
                    title: "Warming implies action",
                },
            ],
            conclusionPremiseMiniId: "P1",
            title: "Climate argument",
        },
        uncategorizedText: null,
        selectionRationale: null,
        failureText: null,
    }
}

describe("Basics extension", () => {
    describe("BasicsParsingSchema", () => {
        it("validates a response with title and body fields", () => {
            expect(() =>
                Value.Parse(BasicsParsingSchema, basicsResponse())
            ).not.toThrow()
        })
    })

    describe("entity schemas", () => {
        it("BasicsArgumentSchema extends core with title", () => {
            const arg = {
                id: "arg-1",
                version: 0,
                checksum: "abc",
                descendantChecksum: null,
                combinedChecksum: "abc",
                title: "My argument",
            }
            expect(() => Value.Parse(BasicsArgumentSchema, arg)).not.toThrow()
        })

        it("BasicsClaimSchema extends core with title and body", () => {
            const claim = {
                id: "claim-1",
                version: 0,
                frozen: false,
                checksum: "abc",
                title: "My claim",
                body: "Full description",
            }
            expect(() => Value.Parse(BasicsClaimSchema, claim)).not.toThrow()
        })

        it("BasicsPremiseSchema extends core with title", () => {
            const premise = {
                id: "prem-1",
                argumentId: "arg-1",
                argumentVersion: 0,
                checksum: "abc",
                descendantChecksum: null,
                combinedChecksum: "abc",
                title: "My premise",
            }
            expect(() =>
                Value.Parse(BasicsPremiseSchema, premise)
            ).not.toThrow()
        })
    })

    describe("BasicsArgumentParser", () => {
        it("maps title/body onto claims", () => {
            const parser = new BasicsArgumentParser()
            const result = parser.build(parser.validate(basicsResponse()))
            const claims = result.claimLibrary.getAll()
            const claim = claims.find(
                (c) =>
                    (c as Record<string, unknown>).title === "Earth is warming"
            )
            expect(claim).toBeDefined()
            expect((claim as Record<string, unknown>).body).toBe(
                "Global average temperatures have increased over the past century."
            )
        })

        it("maps title onto premises", () => {
            const parser = new BasicsArgumentParser()
            const result = parser.build(parser.validate(basicsResponse()))
            const snap = result.engine.snapshot()
            const premise = snap.premises[0]
            expect((premise.premise as Record<string, unknown>).title).toBe(
                "Warming implies action"
            )
        })

        it("maps title onto argument", () => {
            const parser = new BasicsArgumentParser()
            const result = parser.build(parser.validate(basicsResponse()))
            const snap = result.engine.snapshot()
            expect((snap.argument as Record<string, unknown>).title).toBe(
                "Climate argument"
            )
        })

        it("round-trip: parse -> build -> snapshot preserves metadata", () => {
            const parser = new BasicsArgumentParser()
            const validated = parser.validate(basicsResponse())
            const result = parser.build(validated)
            const snap = result.engine.snapshot()

            expect(snap.argument).toHaveProperty("title")
            expect(snap.premises).toHaveLength(1)
            expect(snap.premises[0].premise).toHaveProperty("title")
            expect(snap.variables.variables).toHaveLength(2)
            const symbols = snap.variables.variables.map((v) => v.symbol).sort()
            expect(symbols).toEqual(["P", "Q"])
            expect(snap.premises[0].rootExpressionId).toBeDefined()
            expect(
                snap.premises[0].expressions.expressions.length
            ).toBeGreaterThan(0)
        })
    })
})
