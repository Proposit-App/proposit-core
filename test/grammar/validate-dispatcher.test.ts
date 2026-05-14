import { describe, it } from "vitest"

// Scaffold for the validate(tier) dispatcher tests (spec §7.1).
// Real assertions land in Phase B5 after the per-tier validators are
// implemented.

describe("grammar/validate dispatcher (spec §7.1)", () => {
    it.todo("validate('structural') returns Structural violations only")
    it.todo(
        "validate('evaluable') returns Structural + Evaluable violations in that order"
    )
    it.todo(
        "validate('derivable') returns Structural + Evaluable + Derivable in that order"
    )
    it.todo(
        "validate('presentable') returns Structural + Evaluable + Derivable + Presentable in that order"
    )
    it.todo(
        "returns an empty array when the context is at the requested tier or stricter"
    )
    it.todo("never throws on grammar issues")
})
