import { describe, it, expect } from "vitest"
import { validateS15 } from "../../src/lib/grammar/validators/structural.js"
import {
    validateE7,
    validateE8,
} from "../../src/lib/grammar/validators/evaluable.js"
import { buildContext, makeArgument, makeFreeformPremise } from "./fixtures.js"

const TARGET = { argumentId: "arg-target", argumentVersion: 3 }

describe("grammar rules for response arguments", () => {
    it("S-15 reports a response that answers itself", () => {
        const ctx = buildContext({
            argument: makeArgument({
                respondsTo: { argumentId: "arg-1", argumentVersion: 0 },
            }),
        })
        expect(validateS15(ctx).map((v) => v.code)).toEqual(["S-15"])
    })

    it("S-15 accepts a response that answers another argument, and a standard argument", () => {
        expect(
            validateS15(
                buildContext({ argument: makeArgument({ respondsTo: TARGET }) })
            )
        ).toEqual([])
        expect(validateS15(buildContext({}))).toEqual([])
    })

    it("E-7 does not ask a response with premises for a conclusion", () => {
        const ctx = buildContext({
            argument: makeArgument({ respondsTo: TARGET }),
            premises: [makeFreeformPremise({ id: "p-1" })],
        })
        expect(validateE7(ctx)).toEqual([])
    })

    it("E-8 reports a response that has a conclusion", () => {
        const ctx = buildContext({
            argument: makeArgument({ respondsTo: TARGET }),
            premises: [makeFreeformPremise({ id: "p-1" })],
            roleState: { conclusionPremiseId: "p-1" },
        })
        expect(validateE8(ctx).map((v) => v.code)).toEqual(["E-8"])
    })

    it("E-8 says nothing about a standard argument's conclusion", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            roleState: { conclusionPremiseId: "p-1" },
        })
        expect(validateE8(ctx)).toEqual([])
    })
})
