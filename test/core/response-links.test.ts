import { describe, expect, it } from "vitest"
import { ArgumentEngine, forkArgumentEngine } from "../../src/lib/index"
import { defaultCompareVariable } from "../../src/lib/core/diff"
import {
    elementsWithinPremise,
    listLinks,
    validateLinks,
} from "../../src/lib/core/response/links"
import {
    and,
    at,
    build,
    implies,
    labelled,
    newLib,
    not,
    s,
    v,
    x,
} from "./response-fixtures"
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

describe("links and their moves", () => {
    function pair() {
        const lib = newLib()
        const target = build({
            id: "x",
            version: 3,
            lib,
            conclusion: at("c", v("C")),
            premises: [
                at("step", implies(at("p", v("P")), at("c2", v("C")))),
                at("both", and(v("Q"), v("R"))),
            ],
        })
        return { lib, target }
    }

    it("reads each move from the aspect and the NOT", () => {
        const { lib, target } = pair()
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: target,
            premises: [
                labelled("contradict", not(x("c"))),
                labelled("affirm", x("p")),
                labelled("undercut", not(s("step"))),
                labelled("reinforce", s("both")),
                labelled("own", v("Own")),
                labelled("mixed", and(x("p"), v("Own"))),
            ],
        })
        const moves = Object.fromEntries(
            listLinks(response.engine).map((link) => [
                link.premiseId,
                link.move,
            ])
        )
        expect(moves).toEqual({
            [response.premise("contradict")]: "contradict",
            [response.premise("affirm")]: "affirm",
            [response.premise("undercut")]: "undercut",
            [response.premise("reinforce")]: "reinforce",
        })
    })

    it("lists nothing for a premise holding a claim-bound variable alone", () => {
        const { lib, target } = pair()
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: target,
            premises: [v("Own")],
        })
        expect(listLinks(response.engine)).toEqual([])
    })

    it("counts every premise that is not a link as supporting", () => {
        const { lib, target } = pair()
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: target,
            premises: [
                labelled("link", not(x("c"))),
                labelled("own", implies(v("R2"), not(x("c")))),
            ],
        })
        expect(
            response.engine.listSupportingPremises().map((pm) => pm.getId())
        ).toEqual([response.premise("own")])
    })
})

describe("validateLinks", () => {
    function target(lib = newLib()) {
        return build({
            id: "x",
            version: 3,
            lib,
            conclusion: at("c", v("C")),
            premises: [
                at("step", implies(at("p", v("P")), at("c2", v("C")))),
                at("both", and(v("Q"), at("notR", not(v("R"))))),
                labelled(
                    "derived",
                    at("deriving", implies(v("S"), v("D"))),
                    "D"
                ),
            ],
            claimTypes: { S: "citation" },
        })
    }

    it("reports an inference binding on a variable expression", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [not(s("p"))],
        })
        const result = validateLinks(response.engine, t.engine.snapshot())
        expect(result.ok).toBe(false)
        expect(result.violations.map((violation) => violation.code)).toEqual([
            "LINK_INFERENCE_ON_NON_OPERATOR",
        ])
    })

    it("accepts inference bindings on an and, a not, and an implies inside a derivation premise", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [not(s("both")), not(s("notR")), not(s("deriving"))],
        })
        expect(validateLinks(response.engine, t.engine.snapshot())).toEqual({
            ok: true,
            violations: [],
        })
    })

    it("reports a claim-bound variable for a claim the target uses", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [implies(v("P"), not(x("c")))],
        })
        const result = validateLinks(response.engine, t.engine.snapshot())
        expect(result.violations.map((violation) => violation.code)).toEqual([
            "LINK_CLAIM_USED_BY_TARGET",
        ])
        expect(result.violations[0].claimId).toBe("claim-P")
    })

    it("does not report a claim only an older argument along the path uses", () => {
        const lib = newLib()
        const older = build({
            id: "w",
            version: 0,
            lib,
            conclusion: v("Old"),
        })
        const t = build({
            id: "x",
            version: 3,
            lib,
            respondsTo: older,
            premises: [at("c", v("C"))],
        })
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [implies(v("Old"), not(x("c")))],
        })
        expect(validateLinks(response.engine, t.engine.snapshot()).ok).toBe(
            true
        )
    })

    it("reports a bound expression the target lacks", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [not(x("c"))],
        })
        const snapshot = t.engine.snapshot()
        for (const ps of snapshot.premises) {
            ps.expressions.expressions = ps.expressions.expressions.filter(
                (expr) => expr.id !== t.expr("c")
            )
        }
        expect(
            validateLinks(response.engine, snapshot).violations.map(
                (violation) => violation.code
            )
        ).toEqual(["LINK_EXPRESSION_MISSING"])
    })

    it("reports a binding on another version and does not look it up", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [not(x("c"))],
        })
        const snap = response.engine.snapshot()
        snap.variables.variables = snap.variables.variables.map((variable) =>
            isExpressionBound(variable)
                ? { ...variable, boundArgumentVersion: 2 }
                : variable
        )
        const reloaded = ArgumentEngine.fromSnapshot(snap, lib)
        expect(
            validateLinks(reloaded, t.engine.snapshot()).violations.map(
                (violation) => violation.code
            )
        ).toEqual(["LINK_VERSION_MISMATCH"])
    })

    it("reports links on two occurrences of one claim as information only", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [x("c"), x("c2")],
        })
        const result = validateLinks(response.engine, t.engine.snapshot())
        expect(result.ok).toBe(true)
        expect(result.violations).toMatchObject([
            {
                code: "LINK_SAME_CLAIM",
                severity: "info",
                claimId: "claim-C",
                premiseIds: response.premiseIds,
            },
        ])
    })

    it("throws for a snapshot of another version", () => {
        const lib = newLib()
        const t = target(lib)
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [not(x("c"))],
        })
        const snapshot = t.engine.snapshot()
        snapshot.argument = { ...snapshot.argument, version: 4 }
        expect(() => validateLinks(response.engine, snapshot)).toThrow(
            /version 3/
        )
    })
})

describe("elementsWithinPremise", () => {
    it("gives every expression id and claim id of a premise", () => {
        const lib = newLib()
        const t = build({
            id: "x",
            version: 3,
            lib,
            premises: [
                labelled(
                    "step",
                    at("root", implies(at("p", v("P")), at("q", v("Q"))))
                ),
            ],
        })
        const elements = elementsWithinPremise(
            t.engine.snapshot(),
            t.premise("step")
        )
        expect(new Set(elements.expressionIds)).toEqual(
            new Set([t.expr("root"), t.expr("p"), t.expr("q")])
        )
        expect(new Set(elements.claimIds)).toEqual(
            new Set(["claim-P", "claim-Q"])
        )
    })
})
