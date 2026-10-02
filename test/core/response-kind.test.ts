import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import { DEFAULT_CHECKSUM_CONFIG } from "../../src/lib/checksum-config"
import { defaultCompareArgument } from "../../src/lib/core/diff"
import type { TCoreArgument } from "../../src/lib/schemata"
import type { TCoreChecksumConfig } from "../../src/lib/types/checksum"
import { ARG, aLib, makeVarExpr, VAR_P } from "./fixtures"

const TARGET = { argumentId: "arg-target", argumentVersion: 3 }

function response(
    respondsTo = TARGET,
    checksumConfig?: TCoreChecksumConfig
): ArgumentEngine {
    return new ArgumentEngine({ ...ARG, respondsTo }, aLib(), {
        behavior: "permissive",
        ...(checksumConfig ? { checksumConfig } : {}),
    })
}

describe("respondsTo belongs to the engine, not to extras", () => {
    it("is not one of the extras", () => {
        expect(response().getExtras()).not.toHaveProperty("respondsTo")
    })

    it("survives setExtras", () => {
        const eng = response()
        eng.setExtras({ title: "t" })
        expect(eng.getArgument().respondsTo).toEqual(TARGET)
        expect(eng.getExtras()).toEqual({ title: "t" })
    })

    it("survives updateExtras", () => {
        const eng = response()
        eng.updateExtras({ title: "t" })
        expect(eng.getArgument().respondsTo).toEqual(TARGET)
    })

    it("cannot be set through setExtras", () => {
        const standard = new ArgumentEngine(ARG, aLib())
        expect(() => standard.setExtras({ respondsTo: TARGET })).toThrow(
            /respondsTo/
        )
        expect(standard.getArgument()).not.toHaveProperty("respondsTo")
    })
})

describe("respondsTo is part of the argument checksum", () => {
    const configs: [string, TCoreChecksumConfig | undefined][] = [
        ["the default configuration", undefined],
        [
            "a partial configuration without argumentFields",
            { expressionFields: DEFAULT_CHECKSUM_CONFIG.expressionFields },
        ],
        [
            "a configuration stored before the field existed",
            { argumentFields: new Set(["version"]) },
        ],
    ]

    for (const [name, config] of configs) {
        it(`moves the checksum when the pinned target version changes, under ${name}`, () => {
            const before = response(TARGET, config).getArgument().checksum
            const after = response(
                { ...TARGET, argumentVersion: 4 },
                config
            ).getArgument().checksum
            expect(after).not.toBe(before)
        })

        it(`agrees after a snapshot round trip, under ${name}`, () => {
            const eng = response(TARGET, config)
            const restored = ArgumentEngine.fromSnapshot(
                eng.snapshot(),
                aLib(),
                "strict"
            )
            expect(restored.getArgument().checksum).toBe(
                eng.getArgument().checksum
            )
        })
    }
})

function responseWithPremise(): ArgumentEngine {
    const eng = response()
    eng.addVariable({
        ...VAR_P,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
    })
    const { result: pm } = eng.createPremiseWithId("premise-1")
    pm.addExpression(
        makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
    )
    return eng
}

describe("a response has no conclusion", () => {
    it("validates at every tier and passes the invariant sweep with premises and no conclusion", () => {
        const eng = responseWithPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBeUndefined()
        expect(eng.validate("presentable")).toEqual([])
        expect(eng.validateInvariants().ok).toBe(true)
    })

    it("still fails E-7 for a standard argument with premises and no conclusion", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.createPremise()
        const snap = eng.snapshot()
        delete snap.conclusionPremiseId
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())
        expect(restored.validate("evaluable").map((v) => v.code)).toContain(
            "E-7"
        )
    })

    it("reports E-8 for a response stored with a conclusion, and keeps the stored conclusion", () => {
        const snap = responseWithPremise().snapshot()
        snap.conclusionPremiseId = "premise-1"
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())
        expect(restored.getRoleState().conclusionPremiseId).toBe("premise-1")
        expect(restored.validate("evaluable").map((v) => v.code)).toContain(
            "E-8"
        )
    })

    it("refuses to load a response that names itself", () => {
        const snap = response().snapshot()
        snap.argument = {
            ...snap.argument,
            respondsTo: { argumentId: ARG.id, argumentVersion: 0 },
        }
        expect(() => ArgumentEngine.fromSnapshot(snap, aLib())).toThrow(
            /respond to itself/
        )
    })

    it("refuses to build a response that names itself", () => {
        expect(() =>
            response({ argumentId: ARG.id, argumentVersion: 0 })
        ).toThrow()
    })

    it("makes no premise the conclusion when the first premise is created", () => {
        const eng = response()
        eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBeUndefined()
    })

    it("promotes no premise when one is removed", () => {
        const eng = response()
        const { result: a } = eng.createPremise()
        eng.createPremise()
        eng.removePremise(a.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBeUndefined()
    })

    it("refuses a conclusion", () => {
        const eng = response()
        const { result: pm } = eng.createPremise()
        expect(() => eng.setConclusionPremise(pm.getId())).toThrow(/response/)
    })

    it("loads from data without a conclusion", () => {
        const eng = responseWithPremise()
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromData(
            eng.getArgument(),
            aLib(),
            eng.getVariables(),
            snap.premises.map((ps) => ps.premise),
            snap.premises.flatMap((ps) => ps.expressions.expressions),
            {}
        )
        expect(restored.getRoleState().conclusionPremiseId).toBeUndefined()
        expect(restored.isResponse()).toBe(true)
    })

    it("answers evaluate and checkValidity with ARGUMENT_IS_RESPONSE", () => {
        const eng = responseWithPremise()
        const codes = (result: {
            validation?: { issues: { code: string }[] }
        }) => result.validation?.issues.map((issue) => issue.code)
        expect(
            codes(eng.evaluate({ variables: {}, operatorAssignments: {} }))
        ).toEqual(["ARGUMENT_IS_RESPONSE"])
        expect(codes(eng.checkValidity())).toEqual(["ARGUMENT_IS_RESPONSE"])
    })

    it("counts every premise that is not a link as supporting", () => {
        const eng = responseWithPremise()
        expect(eng.listSupportingPremises().map((pm) => pm.getId())).toEqual([
            "premise-1",
        ])
    })
})

describe("respondsTo in diffs and rendering", () => {
    it("is reported by the default argument comparison when the pinned version changes", () => {
        expect(
            defaultCompareArgument(
                { ...ARG, respondsTo: TARGET } as TCoreArgument,
                {
                    ...ARG,
                    respondsTo: { ...TARGET, argumentVersion: 4 },
                } as TCoreArgument
            )
        ).toEqual([
            {
                field: "respondsTo",
                before: TARGET,
                after: { ...TARGET, argumentVersion: 4 },
            },
        ])
    })

    it("is not reported when it is unchanged", () => {
        expect(
            defaultCompareArgument(
                { ...ARG, respondsTo: TARGET } as TCoreArgument,
                { ...ARG, respondsTo: { ...TARGET } } as TCoreArgument
            )
        ).toEqual([])
    })

    it("is named in the argument's display string", () => {
        expect(response().toDisplayString()).toContain(
            "Responds to: arg-target (v3)"
        )
    })
})
