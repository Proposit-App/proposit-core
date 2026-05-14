import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import { makeArgument } from "./fixtures.js"

describe("ArgumentEngine.behavior + setBehavior()", () => {
    it("defaults to 'assistive' when no option is supplied", () => {
        const engine = new ArgumentEngine(makeArgument(), EMPTY_CLAIM_LOOKUP)
        expect(engine.behavior).toBe("assistive")
    })

    it("accepts an initial 'permissive' value via the constructor option", () => {
        const engine = new ArgumentEngine(makeArgument(), EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        expect(engine.behavior).toBe("permissive")
    })

    it("accepts an explicit 'assistive' value via the constructor option", () => {
        const engine = new ArgumentEngine(makeArgument(), EMPTY_CLAIM_LOOKUP, {
            behavior: "assistive",
        })
        expect(engine.behavior).toBe("assistive")
    })

    it("setBehavior switches the engine's behavior at runtime", () => {
        const engine = new ArgumentEngine(makeArgument(), EMPTY_CLAIM_LOOKUP)
        expect(engine.behavior).toBe("assistive")
        engine.setBehavior("permissive")
        expect(engine.behavior).toBe("permissive")
        engine.setBehavior("assistive")
        expect(engine.behavior).toBe("assistive")
    })
})
