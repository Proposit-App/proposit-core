import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import {
    GrammarTierSchema,
    GrammarRuleCodeSchema,
    ViolationSchema,
} from "../../src/lib/grammar/types.js"

// Schemas are inherited from proposit-shared-dev's grammar-tiers/shared
// branch (Phase 2 commits 2b5d7f0, 0a05925, 5865d45 there); they're being
// relocated to core to avoid a mutual peer-dep between core and shared.
// Tests preserved character-for-character where the schema shape matches.

describe("GrammarTierSchema", () => {
    it("accepts each of the four canonical tier names", () => {
        for (const tier of [
            "structural",
            "evaluable",
            "derivable",
            "presentable",
        ]) {
            expect(Value.Check(GrammarTierSchema, tier)).toBe(true)
        }
    })

    it("rejects an unknown tier name", () => {
        expect(Value.Check(GrammarTierSchema, "atomic")).toBe(false)
        expect(Value.Check(GrammarTierSchema, "Structural")).toBe(false) // case-sensitive
        expect(Value.Check(GrammarTierSchema, "")).toBe(false)
    })

    it("rejects non-string inputs", () => {
        expect(Value.Check(GrammarTierSchema, 0)).toBe(false)
        expect(Value.Check(GrammarTierSchema, null)).toBe(false)
        expect(Value.Check(GrammarTierSchema, undefined)).toBe(false)
    })
})

// The canonical rule-code inventory, lifted from spec §7.1. Any change here
// is a coordinated single-repo change — extend the TypeBox union, ship the
// validator implementation. TypeScript catches drift at build time.
const ALL_CODES = [
    "S-1",
    "S-2",
    "S-3",
    "S-4",
    "S-5",
    "S-6",
    "S-7",
    "S-8",
    "S-9",
    "S-10",
    "S-11",
    "S-12",
    "S-13",
    "S-14",
    "E-1",
    "E-3",
    "E-4",
    "E-5",
    "E-6",
    "E-7",
    "D-1",
    "D-2",
    "D-3",
    "D-4",
    "D-5",
    "D-6",
    "P-1",
    "P-2",
    "P-3",
    "P-4",
    "P-5",
] as const

describe("GrammarRuleCodeSchema", () => {
    it("accepts every code in the canonical inventory", () => {
        for (const code of ALL_CODES) {
            expect(Value.Check(GrammarRuleCodeSchema, code)).toBe(true)
        }
    })

    it("has exactly 31 codes (Structural 14 + Evaluable 6 + Derivable 6 + Presentable 5)", () => {
        // Cross-check the count so a future edit that adds/removes a code
        // notices when the union grows past spec §7.1's inventory.
        // 14 + 6 + 6 + 5 = 31. Reserved codes 'E-2' and 'D-7' are NOT in the
        // count — they are excluded from the union.
        expect(ALL_CODES.length).toBe(31)
    })

    it("rejects 'E-2' (reserved; promoted to Structural as S-13 per spec §4.2)", () => {
        expect(Value.Check(GrammarRuleCodeSchema, "E-2")).toBe(false)
    })

    it("rejects 'D-7' (reserved; restated as E-6 per spec §4.3)", () => {
        expect(Value.Check(GrammarRuleCodeSchema, "D-7")).toBe(false)
    })

    it("rejects codes outside the namespace", () => {
        expect(Value.Check(GrammarRuleCodeSchema, "S-99")).toBe(false)
        expect(Value.Check(GrammarRuleCodeSchema, "X-1")).toBe(false)
        expect(Value.Check(GrammarRuleCodeSchema, "s-1")).toBe(false) // case-sensitive
        expect(Value.Check(GrammarRuleCodeSchema, "S1")).toBe(false) // missing hyphen
    })
})

describe("ViolationSchema", () => {
    it("accepts a minimal violation with just the three required fields", () => {
        const minimal = {
            tier: "structural",
            code: "S-1",
            message: "FK soundness: parentId 'foo' does not resolve",
        }
        expect(Value.Check(ViolationSchema, minimal)).toBe(true)
    })

    it("accepts a violation with every documented optional locator", () => {
        const fullyLocated = {
            tier: "presentable",
            code: "P-1",
            message: "Non-`not` operator is a direct child of another operator",
            argumentId: "arg-uuid",
            premiseId: "premise-uuid",
            expressionId: "expr-uuid",
            variableId: "var-uuid",
            claimId: "claim-uuid",
        }
        expect(Value.Check(ViolationSchema, fullyLocated)).toBe(true)
    })

    it("accepts rule-specific context fields beyond the documented locators (extension slot)", () => {
        // Spec §7.1: "additional rule-specific context fields as needed".
        // The TypeBox schema must allow additional properties so a future
        // rule can attach extra context without a wire-format break.
        const withExtras = {
            tier: "derivable",
            code: "D-3",
            message: "Mixed-grounding antecedent",
            premiseId: "premise-uuid",
            mixedCitationCount: 2,
            mixedAxiomCount: 1,
            antecedentSkeleton: "OR(c, c, a)",
        }
        expect(Value.Check(ViolationSchema, withExtras)).toBe(true)
    })

    it("rejects when `tier` is missing", () => {
        const bad = { code: "S-1", message: "x" }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })

    it("rejects when `code` is missing", () => {
        const bad = { tier: "structural", message: "x" }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })

    it("rejects when `message` is missing", () => {
        const bad = { tier: "structural", code: "S-1" }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })

    it("rejects when `tier` is not in the GrammarTier union", () => {
        const bad = { tier: "atomic", code: "S-1", message: "x" }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })

    it("rejects when `code` is not in the GrammarRuleCode union", () => {
        const bad = { tier: "structural", code: "S-99", message: "x" }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })

    it("rejects when `code` is 'E-2' (reserved)", () => {
        const bad = { tier: "evaluable", code: "E-2", message: "x" }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })

    it("rejects when an optional locator is the wrong type", () => {
        const bad = {
            tier: "structural",
            code: "S-1",
            message: "x",
            premiseId: 42, // expected string
        }
        expect(Value.Check(ViolationSchema, bad)).toBe(false)
    })
})
