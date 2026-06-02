// Unit tests for `deriveRoles`.
//
// v1's implementation trusts the LLM's per-claim `role` assignment.
// A v2 pipeline would derive roles from premise relations; these tests
// pin the v1 passthrough behavior + lay groundwork for the v2 cases.

import { describe, expect, it } from "vitest"
import { deriveRoles } from "../../../src/lib/index.js"
import type { TParsedClaim } from "../../../src/lib/parsing/index.js"

function buildClaim(
    miniId: string,
    role: TParsedClaim["role"],
    type: TParsedClaim["type"] = "normal"
): TParsedClaim {
    return { miniId, role, type } as TParsedClaim
}

describe("deriveRoles — v1 (LLM-assigned passthrough)", () => {
    it("returns the LLM-provided role for each claim", () => {
        const claims = [
            buildClaim("c1", "premise"),
            buildClaim("c2", "intermediate"),
            buildClaim("c3", "conclusion"),
        ]
        expect(deriveRoles({ claims })).toEqual({
            c1: "premise",
            c2: "intermediate",
            c3: "conclusion",
        })
    })

    it("returns an empty map for an empty claims array", () => {
        expect(deriveRoles({ claims: [] })).toEqual({})
    })

    it("preserves citation- and axiomatic-typed claim roles unchanged", () => {
        const claims = [
            buildClaim("c1", "premise", "citation"),
            buildClaim("c2", "premise", "axiomatic"),
            buildClaim("c3", "conclusion", "normal"),
        ]
        expect(deriveRoles({ claims })).toEqual({
            c1: "premise",
            c2: "premise",
            c3: "conclusion",
        })
    })
})
