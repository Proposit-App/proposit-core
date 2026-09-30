// Unit tests for `deriveRoles`.
//
// `deriveRoles` copies the per-claim `role` already recorded on each
// parsed claim; these tests pin that passthrough behavior.

import { describe, expect, it } from "vitest"
import { deriveRoles } from "../../../src/extensions/pipelines/base/index.js"
import type { TParsedClaim } from "../../../src/lib/parsing/index.js"

function buildClaim(
    miniId: string,
    role: TParsedClaim["role"],
    type: TParsedClaim["type"] = "normal"
): TParsedClaim {
    return { miniId, role, type } as TParsedClaim
}

describe("deriveRoles — passthrough of the claim's recorded role", () => {
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
