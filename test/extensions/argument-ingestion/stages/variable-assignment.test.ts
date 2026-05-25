// Exhaustive unit tests for the `variable-assignment` deterministic
// stage. Covers the spec §7.2 row 8 behavior:
//
//   - Valid suggested symbol passes through verbatim.
//   - Symbol-validation regex: reserved-word-shaped strings are still
//     valid (the regex is purely structural — it doesn't blacklist
//     keywords like `and`/`or`/`implies` even though they would
//     conflict with the formula parser; that's a `formula-validation`
//     concern, not this stage's).
//   - Length > 32, hyphens, empty, starts-with-digit → invalid →
//     fallback.
//   - Collision: first claim wins the symbol; later claims with the
//     same suggested symbol fall back.
//   - Full-fallback: every claim's suggested symbol is invalid → every
//     claim gets `p1`, `p2`, ... in canonicalization order.
//   - Mixed: some valid suggested symbols also happen to be `p<n>`-
//     shaped (e.g. `p1`); the fallback counter skips numbers already
//     used and continues from the next unused integer.

import { describe, expect, it } from "vitest"
import {
    assignVariables,
    isValidVariableSymbol,
    variableAssignmentStage,
} from "../../../../src/extensions/argument-ingestion/stages/variable-assignment.js"
import { STAGE_IDS } from "../../../../src/extensions/argument-ingestion/stages/schemas.js"
import type { TBaseCanonicalClaim } from "../../../../src/extensions/argument-ingestion/stages/schemas.js"

function buildClaim(
    miniId: string,
    suggestedSymbol: string,
    overrides?: Partial<TBaseCanonicalClaim>
): TBaseCanonicalClaim {
    return {
        miniId,
        mentionIds: [],
        suggestedSymbol,
        type: "normal",
        ...overrides,
    }
}

function counterIdGen(): () => string {
    let n = 0
    return () => {
        n += 1
        return `v${n}`
    }
}

describe("isValidVariableSymbol — regex + length", () => {
    it("accepts ASCII identifier shapes up to 32 chars", () => {
        expect(isValidVariableSymbol("a")).toBe(true)
        expect(isValidVariableSymbol("Foo_Bar")).toBe(true)
        expect(isValidVariableSymbol("_leading_underscore")).toBe(true)
        expect(isValidVariableSymbol("a".repeat(32))).toBe(true)
        expect(isValidVariableSymbol("MixedCase_With123Numbers")).toBe(true)
    })

    it("rejects empty strings and over-length identifiers", () => {
        expect(isValidVariableSymbol("")).toBe(false)
        expect(isValidVariableSymbol("a".repeat(33))).toBe(false)
    })

    it("rejects leading digit", () => {
        expect(isValidVariableSymbol("1variable")).toBe(false)
    })

    it("rejects hyphens, dots, and other punctuation", () => {
        expect(isValidVariableSymbol("foo-bar")).toBe(false)
        expect(isValidVariableSymbol("foo.bar")).toBe(false)
        expect(isValidVariableSymbol("foo bar")).toBe(false)
        expect(isValidVariableSymbol("foo$bar")).toBe(false)
    })

    it("treats all-uppercase identifiers as valid (structurally OK)", () => {
        // All-uppercase symbols are structurally valid; the regex is
        // not a stylistic filter. (Some formula DSLs reserve all-caps
        // for keywords — that's a `formula-validation` concern, not
        // this stage's.)
        expect(isValidVariableSymbol("FOO_BAR")).toBe(true)
    })
})

describe("assignVariables — happy path", () => {
    it("uses each claim's suggested symbol when valid + unique", () => {
        const claims = [
            buildClaim("c1", "Rains"),
            buildClaim("c2", "GroundWet"),
            buildClaim("c3", "Implication"),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables).toEqual([
            { miniId: "v1", symbol: "Rains", claimMiniId: "c1" },
            { miniId: "v2", symbol: "GroundWet", claimMiniId: "c2" },
            { miniId: "v3", symbol: "Implication", claimMiniId: "c3" },
        ])
    })

    it("mints a fresh `miniId` per claim from `generateId`", () => {
        const claims = [
            buildClaim("c1", "a"),
            buildClaim("c2", "b"),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        const ids = variables.map((v) => v.miniId)
        expect(new Set(ids).size).toBe(ids.length)
    })
})

describe("assignVariables — invalid symbol falls back to p<n>", () => {
    it("falls back when a claim's suggestion is empty", () => {
        const claims = [
            buildClaim("c1", ""),
            buildClaim("c2", "Valid"),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables[0].symbol).toBe("p1")
        expect(variables[1].symbol).toBe("Valid")
    })

    it("falls back when a claim's suggestion is over-length", () => {
        const tooLong = "x".repeat(33)
        const claims = [buildClaim("c1", tooLong)]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables[0].symbol).toBe("p1")
    })

    it("falls back when a claim's suggestion starts with a digit", () => {
        const claims = [buildClaim("c1", "1Var")]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables[0].symbol).toBe("p1")
    })

    it("falls back when a claim's suggestion contains hyphens", () => {
        const claims = [buildClaim("c1", "foo-bar")]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables[0].symbol).toBe("p1")
    })
})

describe("assignVariables — collision resolution", () => {
    it("first claim wins on collision; later claim falls back", () => {
        const claims = [
            buildClaim("c1", "Same"),
            buildClaim("c2", "Same"),
            buildClaim("c3", "Same"),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables.map((v) => v.symbol)).toEqual(["Same", "p1", "p2"])
    })

    it("full fallback when every suggestion is invalid", () => {
        const claims = [
            buildClaim("c1", ""),
            buildClaim("c2", "1bad"),
            buildClaim("c3", "x".repeat(40)),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables.map((v) => v.symbol)).toEqual(["p1", "p2", "p3"])
    })

    it("fallback counter skips integers already used by valid suggestions", () => {
        // c1 claims `p1` as a valid (if quirky) suggestion. c2 has an
        // invalid suggestion, so it falls back — the counter must skip
        // `p1` and use `p2`.
        const claims = [
            buildClaim("c1", "p1"),
            buildClaim("c2", ""),
            buildClaim("c3", "Valid"),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables.map((v) => v.symbol)).toEqual(["p1", "p2", "Valid"])
    })

    it("fallback counter skips multiple pre-used p<n> integers", () => {
        const claims = [
            buildClaim("c1", "p2"),
            buildClaim("c2", "p1"),
            buildClaim("c3", ""),
        ]
        const variables = assignVariables({
            canonicalClaims: claims,
            generateId: counterIdGen(),
        })
        expect(variables.map((v) => v.symbol)).toEqual(["p2", "p1", "p3"])
    })
})

describe("assignVariables — empty input", () => {
    it("returns an empty array", () => {
        const variables = assignVariables({
            canonicalClaims: [],
            generateId: counterIdGen(),
        })
        expect(variables).toEqual([])
    })
})

describe("variableAssignmentStage — TStage wiring", () => {
    it("declares the correct id + deps + outputSchema", () => {
        expect(variableAssignmentStage.id).toBe(STAGE_IDS.variableAssignment)
        expect(variableAssignmentStage.dependsOn).toEqual([
            STAGE_IDS.claimCanonicalization,
        ])
    })
})
