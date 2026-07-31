import { describe, it, expect } from "vitest"
import { Value } from "typebox/value"
import {
    CorePropositionalVariableExpressionSchema,
    CoreFreeformPremiseSchema,
    CoreDerivationPremiseSchema,
} from "../../src/lib/schemata/index.js"

const baseExpression = {
    id: "11111111-1111-4111-8111-111111111111",
    argumentId: "22222222-2222-4222-8222-222222222222",
    argumentVersion: 0,
    premiseId: "33333333-3333-4333-8333-333333333333",
    parentId: null,
    position: 0,
    checksum: "aaaaaaaa",
    descendantChecksum: null,
    combinedChecksum: "aaaaaaaa",
    type: "variable" as const,
    variableId: "44444444-4444-4444-8444-444444444444",
}

const basePremise = {
    id: "55555555-5555-4555-8555-555555555555",
    argumentId: "22222222-2222-4222-8222-222222222222",
    argumentVersion: 0,
    checksum: "bbbbbbbb",
    descendantChecksum: null,
    combinedChecksum: "bbbbbbbb",
}

describe("enthymeme on the propositional schemas", () => {
    it("accepts a variable expression with and without the field", () => {
        expect(
            Value.Check(
                CorePropositionalVariableExpressionSchema,
                baseExpression
            )
        ).toBe(true)
        expect(
            Value.Check(CorePropositionalVariableExpressionSchema, {
                ...baseExpression,
                enthymeme: true,
            })
        ).toBe(true)
    })

    it("accepts a freeform premise with and without the field", () => {
        const premise = { ...basePremise, type: "freeform" as const }
        expect(Value.Check(CoreFreeformPremiseSchema, premise)).toBe(true)
        expect(
            Value.Check(CoreFreeformPremiseSchema, {
                ...premise,
                enthymeme: true,
            })
        ).toBe(true)
    })

    it("accepts a derivation premise with and without the field", () => {
        const premise = {
            ...basePremise,
            type: "derivation" as const,
            derivedClaimId: "66666666-6666-4666-8666-666666666666",
        }
        expect(Value.Check(CoreDerivationPremiseSchema, premise)).toBe(true)
        expect(
            Value.Check(CoreDerivationPremiseSchema, {
                ...premise,
                enthymeme: true,
            })
        ).toBe(true)
    })

    it("rejects a non-boolean value", () => {
        expect(
            Value.Check(CorePropositionalVariableExpressionSchema, {
                ...baseExpression,
                enthymeme: "yes",
            })
        ).toBe(false)
    })

    it("rejects false — a present key is a present key", () => {
        // `false` shifts the checksum exactly as `null` does, and it is the
        // likelier value: an unchecked form control or an ORM default produces
        // it. Unmarking must delete the key, not write `false`.
        expect(
            Value.Check(CorePropositionalVariableExpressionSchema, {
                ...baseExpression,
                enthymeme: false,
            })
        ).toBe(false)
        expect(
            Value.Check(CoreFreeformPremiseSchema, {
                ...basePremise,
                type: "freeform",
                enthymeme: false,
            })
        ).toBe(false)
        expect(
            Value.Check(CoreDerivationPremiseSchema, {
                ...basePremise,
                type: "derivation",
                derivedClaimId: "66666666-6666-4666-8666-666666666666",
                enthymeme: false,
            })
        ).toBe(false)
    })

    it("rejects null — absence is the unmarked state, not null", () => {
        // A null here would pass into the entity checksum and shift the hash
        // of every premise and expression in existence. The schema refuses it
        // so a consumer that round-trips absence as null fails loudly.
        expect(
            Value.Check(CorePropositionalVariableExpressionSchema, {
                ...baseExpression,
                enthymeme: null,
            })
        ).toBe(false)
        expect(
            Value.Check(CoreFreeformPremiseSchema, {
                ...basePremise,
                type: "freeform",
                enthymeme: null,
            })
        ).toBe(false)
    })
})
