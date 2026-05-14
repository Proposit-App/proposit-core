import { describe, it } from "vitest"

// Per-rule scaffolds for Presentable-tier validators (P-1..P-5).
// Real assertions land in Phase B4.

describe("grammar/presentable", () => {
    describe("P-1 formula buffer between operators", () => {
        it.todo("rejects AND(OR(...), ...) — OR is a direct child of AND")
        it.todo("rejects OR(AND(...), ...) — AND is a direct child of OR")
        it.todo("accepts AND(formula(OR(...)), ...) — buffer between operators")
        it.todo(
            "accepts NOT(AND(...)) — not is exempt as a child of an operator"
        )
        it.todo(
            "accepts AND(NOT(...), ...) — not as a child of an operator is allowed"
        )
    })

    describe("P-2 no double negation", () => {
        it.todo("rejects NOT(NOT(x))")
        it.todo("accepts NOT(x) for any x")
    })

    describe("P-3 formula has operator descendant", () => {
        it.todo("rejects formula(variable) — leaf wrapper")
        it.todo(
            "rejects formula(NOT(variable)) — single not, no binary operator"
        )
        it.todo("accepts formula(AND(...))")
        it.todo("accepts formula(OR(...))")
    })

    describe("P-4 no single-child binary operator", () => {
        it.todo("rejects AND with 1 child")
        it.todo("rejects OR with 1 child")
        it.todo("accepts AND/OR with 2+ children")
    })

    describe("P-5 no operator-of-same-type adjacency through a formula", () => {
        it.todo("rejects AND(formula(AND(B, C)), D)")
        it.todo("rejects OR(formula(OR(B, C)), D)")
        it.todo("accepts AND(formula(OR(B, C)), D)")
    })

    describe("aggregator validatePresentable", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
