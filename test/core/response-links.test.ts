import { describe, expect, it } from "vitest"
import { ArgumentEngine, forkArgumentEngine } from "../../src/lib/index"
import { defaultCompareVariable } from "../../src/lib/core/diff"
import {
    isExpressionBound,
    type TExpressionBoundVariable,
} from "../../src/lib/schemata"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { ARG, aLib, makeOpExpr, makeVarExpr } from "./fixtures"

const TARGET = { argumentId: "arg-target", argumentVersion: 3 }

function response(): ArgumentEngine {
    return new ArgumentEngine({ ...ARG, respondsTo: TARGET }, aLib(), {
        behavior: "permissive",
    })
}

function binding(
    overrides: Partial<TExpressionBoundVariable> = {}
): TOptionalChecksum<TExpressionBoundVariable> {
    return {
        id: "v-x",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "X",
        boundExpressionId: "e-target-x",
        boundArgumentId: TARGET.argumentId,
        boundArgumentVersion: TARGET.argumentVersion,
        boundAspect: "statement",
        ...overrides,
    }
}

/** A response with one contradict link, `NOT(x)`. */
function responseWithLink(): ArgumentEngine {
    const eng = response()
    eng.bindVariableToExpression(binding())
    const { result: pm } = eng.createPremiseWithId("premise-1")
    pm.addExpression(
        makeOpExpr("e-not", "not", { parentId: null, position: 1 })
    )
    pm.addExpression(
        makeVarExpr("e-x", "v-x", { parentId: "e-not", position: 1 })
    )
    return eng
}

describe("binding a variable to an expression of the argument a response answers", () => {
    it("registers an expression-bound variable", () => {
        const eng = response()
        const { result } = eng.bindVariableToExpression(binding())
        expect(isExpressionBound(result)).toBe(true)
        expect(eng.getVariable("v-x")).toMatchObject({
            boundExpressionId: "e-target-x",
            boundAspect: "statement",
        })
    })

    it("refuses outside a response", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(() => eng.bindVariableToExpression(binding())).toThrow(
            /response/
        )
    })

    it("refuses a binding into any argument other than the one answered", () => {
        expect(() =>
            response().bindVariableToExpression(
                binding({ boundArgumentId: "arg-other" })
            )
        ).toThrow()
    })

    it("refuses a binding into another version of the argument answered", () => {
        expect(() =>
            response().bindVariableToExpression(
                binding({ boundArgumentVersion: 2 })
            )
        ).toThrow()
    })

    it("refuses what canBind refuses", () => {
        class Refusing extends ArgumentEngine {
            protected override canBind(): boolean {
                return false
            }
        }
        const eng = new Refusing({ ...ARG, respondsTo: TARGET }, aLib(), {
            behavior: "permissive",
        })
        expect(() => eng.bindVariableToExpression(binding())).toThrow()
    })

    it("returns the existing variable for a second binding with the same referent", () => {
        const eng = response()
        eng.bindVariableToExpression(binding())
        const { result } = eng.bindVariableToExpression(
            binding({ id: "v-x2", symbol: "X2" })
        )
        expect(result.id).toBe("v-x")
        expect(eng.getVariable("v-x2")).toBeUndefined()
    })

    it("binds the inference aspect of the same expression as a different variable", () => {
        const eng = response()
        eng.bindVariableToExpression(binding())
        const { result } = eng.bindVariableToExpression(
            binding({ id: "v-s", symbol: "S", boundAspect: "inference" })
        )
        expect(result.id).toBe("v-s")
    })
})

describe("shapes and loading", () => {
    it("passes S-3", () => {
        expect(
            responseWithLink()
                .validate("structural")
                .map((v) => v.code)
        ).not.toContain("S-3")
    })

    it("refuses to load a variable with both a claim and an expression reference", () => {
        const snap = responseWithLink().snapshot()
        snap.variables.variables = snap.variables.variables.map((v) =>
            v.id === "v-x"
                ? { ...v, claimId: "claim-default", claimVersion: 0 }
                : v
        )
        expect(() => ArgumentEngine.fromSnapshot(snap, aLib())).toThrow()
    })

    it("refuses to load an expression-bound variable in a standard argument", () => {
        const snap = responseWithLink().snapshot()
        const { respondsTo: _r, ...standard } = snap.argument as Record<
            string,
            unknown
        >
        snap.argument = standard as typeof snap.argument
        expect(() => ArgumentEngine.fromSnapshot(snap, aLib())).toThrow()
    })

    it("refuses to load a binding into an argument other than the one answered", () => {
        const snap = responseWithLink().snapshot()
        snap.variables.variables = snap.variables.variables.map((v) =>
            v.id === "v-x" ? { ...v, boundArgumentId: "arg-other" } : v
        )
        expect(() => ArgumentEngine.fromSnapshot(snap, aLib())).toThrow()
    })

    it("loads a binding on another version of the argument answered and reports E-10", () => {
        const snap = responseWithLink().snapshot()
        snap.variables.variables = snap.variables.variables.map((v) =>
            v.id === "v-x" ? { ...v, boundArgumentVersion: 2 } : v
        )
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())
        expect(restored.validate("evaluable").map((v) => v.code)).toContain(
            "E-10"
        )
    })

    it("loads two variables with the same referent and reports E-9", () => {
        const snap = responseWithLink().snapshot()
        const original = snap.variables.variables.find((v) => v.id === "v-x")!
        snap.variables.variables = [
            ...snap.variables.variables,
            { ...original, id: "v-x2", symbol: "X2" },
        ]
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())
        expect(restored.getVariable("v-x2")).toBeDefined()
        expect(restored.validate("evaluable").map((v) => v.code)).toContain(
            "E-9"
        )
    })

    it("refuses an update to a binding field", () => {
        const eng = responseWithLink()
        expect(() =>
            eng.updateVariable("v-x", { boundExpressionId: "e-other" })
        ).toThrow()
        expect(() =>
            eng.updateVariable("v-x", { boundAspect: "inference" })
        ).toThrow()
        expect(() =>
            eng.updateVariable("v-x", { boundArgumentVersion: 4 })
        ).toThrow()
    })

    it("refuses turning an expression-bound variable into another kind", () => {
        const eng = responseWithLink()
        expect(() =>
            eng.updateVariable("v-x", {
                claimId: "claim-default",
                claimVersion: 0,
            })
        ).toThrow()
    })

    it("still renames", () => {
        const eng = responseWithLink()
        eng.updateVariable("v-x", { symbol: "Y" })
        expect(eng.getVariable("v-x")!.symbol).toBe("Y")
    })
})

describe("round trips", () => {
    it("survives snapshot and fromSnapshot with checksums unchanged", () => {
        const eng = responseWithLink()
        const restored = ArgumentEngine.fromSnapshot(
            JSON.parse(JSON.stringify(eng.snapshot())) as ReturnType<
                typeof eng.snapshot
            >,
            aLib(),
            "strict"
        )
        const asJson = (value: unknown): unknown =>
            JSON.parse(JSON.stringify(value))
        expect(asJson(restored.snapshot())).toEqual(asJson(eng.snapshot()))
    })

    it("survives fromData with checksums unchanged", () => {
        const eng = responseWithLink()
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromData(
            eng.getArgument(),
            aLib(),
            eng.getVariables(),
            snap.premises.map((ps) => ps.premise),
            snap.premises.flatMap((ps) => ps.expressions.expressions),
            eng.getRoleState(),
            undefined,
            "strict"
        )
        expect(restored.snapshot()).toEqual(eng.snapshot())
    })
})

describe("expression-bound variables in diffs and forks", () => {
    it("reports a re-pointed binding field by field", () => {
        const before = binding() as TExpressionBoundVariable
        const after = {
            ...before,
            boundExpressionId: "e-target-y",
            boundArgumentVersion: 4,
        }
        expect(
            defaultCompareVariable(before, after).map((change) => change.field)
        ).toEqual(["boundArgumentVersion", "boundExpressionId"])
        expect(
            defaultCompareVariable(before, {
                ...before,
                boundAspect: "inference",
            }).map((change) => change.field)
        ).toEqual(["boundAspect"])
    })

    it("keeps a forked response answering the same argument and version", () => {
        const { engine: forked } = forkArgumentEngine(
            responseWithLink(),
            "arg-fork",
            { claimLibrary: aLib() }
        )
        expect(forked.getRespondsTo()).toEqual(TARGET)
        const bound = forked.getVariables().filter((v) => isExpressionBound(v))
        expect(bound).toHaveLength(1)
        expect(bound[0]).toMatchObject({
            argumentId: "arg-fork",
            boundExpressionId: "e-target-x",
            boundArgumentId: TARGET.argumentId,
            boundArgumentVersion: TARGET.argumentVersion,
        })
        expect(forked.validateInvariants().ok).toBe(true)
    })
})
