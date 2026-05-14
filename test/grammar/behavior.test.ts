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

describe("ArgumentEngine.idGenerator", () => {
    it("returns the same function reference across calls", () => {
        // The accessor is the typed replacement for the prior
        // `(engine as unknown as { generateId }).generateId` cast in
        // populate-from.ts. It must hand back the same function the
        // engine itself uses internally — i.e., the same reference on
        // every call (no fresh closure per access).
        const engine = new ArgumentEngine(makeArgument(), EMPTY_CLAIM_LOOKUP)
        const a = engine.idGenerator
        const b = engine.idGenerator
        expect(a).toBe(b)
        expect(typeof a).toBe("function")
    })

    it("uses the constructor's generateId option when supplied", () => {
        // Custom generator must be observable through the accessor; this
        // is what the C6 factory relies on to mint deterministic IDs in
        // tests / programmatic construction.
        let counter = 0
        const customGen = () => `id-${++counter}`
        const engine = new ArgumentEngine(makeArgument(), EMPTY_CLAIM_LOOKUP, {
            generateId: customGen,
        })
        expect(engine.idGenerator).toBe(customGen)
        expect(engine.idGenerator()).toBe("id-1")
        expect(engine.idGenerator()).toBe("id-2")
    })
})
