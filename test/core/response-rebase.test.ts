import { describe, expect, it } from "vitest"
import { ArgumentEngine, diffArguments } from "../../src/lib/index"
import type { ClaimLibrary } from "../../src/lib/index"
import type { TArgumentEngineSnapshot } from "../../src/lib/core/argument-engine"
import {
    positionClassOf,
    structuralFingerprint,
} from "../../src/lib/core/response/fingerprint"
import { classifyBindings } from "../../src/lib/core/response/rebase"
import {
    snapshotExpressions,
    validateLinks,
} from "../../src/lib/core/response/links"
import {
    and,
    at,
    build,
    ext,
    implies,
    labelled,
    newLib,
    not,
    or,
    pv,
    s,
    v,
    withId,
    x,
    type TBuilt,
    type TNode,
    type TPremiseSpec,
} from "./response-fixtures"
import { isExpressionBound } from "../../src/lib/schemata"
import type { TBindingClassification } from "../../src/lib/types/response"

// The argument answered, at any version: a conclusion C, a step P → Q, and
// an `and` of A and B. Tests pass replacement premises to make a version
// that differs.
function basePremises(): (TNode | TPremiseSpec)[] {
    return [
        labelled(
            "stepPremise",
            at("step", implies(at("p", v("P")), withId("x-q", at("q", v("Q")))))
        ),
        at("both", and(v("A"), v("B"))),
    ]
}

function target(
    lib: ClaimLibrary,
    version: number,
    premises: (TNode | TPremiseSpec)[] = basePremises()
): TBuilt {
    return build({
        id: "x",
        version,
        lib,
        conclusion: at("c", v("C")),
        premises,
    })
}

/** The entry for one variable. */
function entry(
    bindings: TBindingClassification[],
    variableId: string
): TBindingClassification {
    const found = bindings.find((b) => b.variableId === variableId)
    if (found === undefined) throw new Error(`no entry for ${variableId}`)
    return found
}

/**
 * The state every successful rebase must leave: each expression-bound
 * variable is bound to the newer version and names an expression present in
 * it, and the response answers that version.
 */
function expectRebased(
    response: ArgumentEngine,
    targetTo: TArgumentEngineSnapshot
): void {
    const expressions = snapshotExpressions(targetTo)
    expect(response.getRespondsTo()).toEqual({
        argumentId: targetTo.argument.id,
        argumentVersion: targetTo.argument.version,
    })
    for (const variable of response.getVariables()) {
        if (!isExpressionBound(variable)) continue
        expect(variable.boundArgumentVersion).toBe(targetTo.argument.version)
        expect(expressions.has(variable.boundExpressionId)).toBe(true)
    }
}

/** A copy of an engine, loaded from its snapshot. */
function copyOf(engine: ArgumentEngine, lib: ClaimLibrary): ArgumentEngine {
    const copy = ArgumentEngine.fromSnapshot(engine.snapshot(), lib)
    copy.setBehavior("permissive")
    return copy
}

describe("structuralFingerprint", () => {
    it("is equal for the same structure in two versions of an argument", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        expect(
            structuralFingerprint(x3.engine.snapshot(), x3.expr("step"))
        ).toBe(structuralFingerprint(x4.engine.snapshot(), x4.expr("step")))
    })

    it("ignores the argument's own ids", () => {
        const lib = newLib()
        const one = build({
            id: "one",
            version: 0,
            lib,
            premises: [at("t", implies(v("P"), v("Q")))],
        })
        const two = build({
            id: "two",
            version: 7,
            lib,
            premises: [at("t", implies(v("P"), v("Q")))],
        })
        expect(
            structuralFingerprint(one.engine.snapshot(), one.expr("t"))
        ).toBe(structuralFingerprint(two.engine.snapshot(), two.expr("t")))
    })

    it("differs when an operator, a child order or a claim version differs", () => {
        const lib = newLib()
        const base = build({
            id: "a",
            version: 0,
            lib,
            premises: [at("t", implies(v("P"), v("Q")))],
        })
        const fp = (b: TBuilt) =>
            structuralFingerprint(b.engine.snapshot(), b.expr("t"))
        const swapped = build({
            id: "a",
            version: 0,
            lib,
            premises: [at("t", implies(v("Q"), v("P")))],
        })
        const other = build({
            id: "a",
            version: 0,
            lib,
            premises: [at("t", or(v("P"), v("Q")))],
        })
        lib.freeze("claim-Q")
        const bumped = build({
            id: "a",
            version: 0,
            lib,
            premises: [at("t", implies(v("P"), v("Q")))],
        })
        expect(fp(swapped)).not.toBe(fp(base))
        expect(fp(other)).not.toBe(fp(base))
        expect(fp(bumped)).not.toBe(fp(base))
    })

    it("follows a binding to another premise of the same argument", () => {
        const lib = newLib()
        const make = (inner: TNode) =>
            build({
                id: "a",
                version: 0,
                lib,
                premises: [
                    labelled("inner", inner),
                    at("t", and(pv("inner"), v("R"))),
                ],
            })
        const one = make(implies(v("P"), v("Q")))
        const same = make(implies(v("P"), v("Q")))
        const differs = make(implies(v("P"), v("S")))
        const fp = (b: TBuilt) =>
            structuralFingerprint(b.engine.snapshot(), b.expr("t"))
        expect(fp(same)).toBe(fp(one))
        expect(fp(differs)).not.toBe(fp(one))
    })

    it("leaves the version of another argument out", () => {
        const lib = newLib()
        const make = (version: number) =>
            build({
                id: "a",
                version: 0,
                lib,
                premises: [at("t", and(v("P"), ext("w", version, "w.p0")))],
            })
        const fp = (b: TBuilt) =>
            structuralFingerprint(b.engine.snapshot(), b.expr("t"))
        expect(fp(make(2))).toBe(fp(make(1)))
    })

    it("throws for an expression the snapshot does not hold", () => {
        const lib = newLib()
        expect(() =>
            structuralFingerprint(target(lib, 3).engine.snapshot(), "nope")
        ).toThrow(/nope/)
    })
})

describe("positionClassOf", () => {
    it("tells premise roots, the conclusion, nested expressions and derivations apart", () => {
        const lib = newLib()
        const t = build({
            id: "x",
            version: 3,
            lib,
            conclusion: at("c", v("C")),
            premises: [
                at("root", implies(at("nested", v("P")), v("Q"))),
                labelled("d", at("deriving", implies(v("S"), v("D"))), "D"),
            ],
        })
        const snap = t.engine.snapshot()
        expect(positionClassOf(snap, t.expr("c"))).toBe("conclusionRoot")
        expect(positionClassOf(snap, t.expr("root"))).toBe("freeformRoot")
        expect(positionClassOf(snap, t.expr("nested"))).toBe("nested")
        expect(positionClassOf(snap, t.expr("deriving"))).toBe("inDerivation")
    })
})

describe("classifyBindings", () => {
    it("reports every binding unchanged when nothing was edited", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(x("c")), x("p"), not(s("step")), s("both")],
        })
        const result = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(result.bindings).toHaveLength(4)
        expect(result.bindings.map((b) => b.status)).toEqual([
            "unchanged",
            "unchanged",
            "unchanged",
            "unchanged",
        ])
        expect(result.claimBindingConflicts).toEqual([])
    })

    it("classifies a variable used only inside another premise, and lists that premise", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [
                labelled("r", v("R")),
                labelled("rule", implies(v("R"), not(x("q")))),
            ],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(bindings).toEqual([
            {
                variableId: y.variable("q"),
                boundExpressionId: x3.expr("q"),
                boundAspect: "statement",
                boundArgumentVersion: 3,
                premises: [
                    {
                        premiseId: y.premise("rule"),
                        isLink: false,
                        cascaded: false,
                    },
                ],
                status: "unchanged",
            },
        ])
    })

    it("reports an edited step as changed in content", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [
            labelled(
                "stepPremise",
                at("step", implies(at("p", v("P")), at("q", v("R"))))
            ),
            at("both", and(v("A"), v("B"))),
        ])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("step")), x("p")],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(entry(bindings, y.variable("inference:step"))).toMatchObject({
            status: "changed",
            reasons: ["content"],
        })
        expect(entry(bindings, y.variable("p")).status).toBe("unchanged")
    })

    it("reports an undercut step as changed in content when a claim under it gains a version", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        lib.freeze("claim-Q")
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("step")), x("p")],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(entry(bindings, y.variable("inference:step"))).toMatchObject({
            status: "changed",
            reasons: ["content"],
        })
        expect(entry(bindings, y.variable("p")).status).toBe("unchanged")
    })

    it("reports a deleted operator as removed", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, basePremises().slice(0, 1))
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [s("both")],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(bindings.map((b) => b.status)).toEqual(["removed"])
    })

    it("reports an unchanged operator moved from a premise root to a nested place as changed in position", () => {
        const lib = newLib()
        const moved = () => withId("x-mv", at("mv", and(v("A"), v("B"))))
        const x3 = target(lib, 3, [...basePremises(), moved()])
        const x4 = target(lib, 4, [...basePremises(), or(moved(), v("E"))])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("mv"))],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(bindings[0]).toMatchObject({
            status: "changed",
            reasons: ["position"],
        })
    })

    it("lists the premises reached through the removal of a premise that uses the variable", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [
                labelled("r", v("R")),
                labelled("rule", implies(v("R"), not(x("q")))),
                labelled("onRule", implies(pv("rule"), v("S"))),
                labelled("link", not(x("q"))),
            ],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(entry(bindings, y.variable("q")).premises).toEqual([
            { premiseId: y.premise("rule"), isLink: false, cascaded: false },
            { premiseId: y.premise("link"), isLink: true, cascaded: false },
            { premiseId: y.premise("onRule"), isLink: false, cascaded: true },
        ])
    })

    it("reports an external premise binding inside the bound expression, moved to another version, as re-pinned", () => {
        const lib = newLib()
        const holder = (version: number) =>
            at("holder", and(v("A"), ext("w", version, "w.p0")))
        const x3 = target(lib, 3, [...basePremises(), holder(1)])
        const x4 = target(lib, 4, [...basePremises(), holder(2)])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("holder")), not(x("c"))],
        })
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(entry(bindings, y.variable("inference:holder"))).toMatchObject({
            status: "changed",
            reasons: ["outsideReferenceRepinned"],
        })
        expect(entry(bindings, y.variable("c")).status).toBe("unchanged")
    })

    it("compares an external premise binding across both versions when they are supplied", () => {
        const lib = newLib()
        const w1 = build({ id: "w", version: 1, lib, premises: [v("K")] })
        const w2 = build({ id: "w", version: 2, lib, premises: [v("K")] })
        const w2Edited = build({
            id: "w",
            version: 2,
            lib,
            premises: [not(v("K"))],
        })
        const holder = (version: number) =>
            at("holder", and(v("A"), ext("w", version, "w.p0")))
        const x3 = target(lib, 3, [...basePremises(), holder(1)])
        const x4 = target(lib, 4, [...basePremises(), holder(2)])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("holder"))],
        })
        const classify = (outside: TArgumentEngineSnapshot[]) =>
            classifyBindings(
                y.engine,
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                { outsideSnapshots: outside }
            ).bindings[0]
        expect(
            classify([w1.engine.snapshot(), w2.engine.snapshot()]).status
        ).toBe("unchanged")
        expect(
            classify([w1.engine.snapshot(), w2Edited.engine.snapshot()])
        ).toMatchObject({ status: "changed", reasons: ["content"] })
        expect(classify([w1.engine.snapshot()])).toMatchObject({
            status: "changed",
            reasons: ["outsideReferenceRepinned"],
        })
    })

    it("reports a variable already bound to the newer version as already rebased", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = partlyRebased(lib, x3, "p")
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(entry(bindings, y.variable("p")).status).toBe("alreadyRebased")
        expect(entry(bindings, y.variable("c")).status).toBe("unchanged")
    })

    it("reports a variable already bound to the newer version as removed when its expression is not there", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [
            labelled(
                "stepPremise",
                at("step", implies(at("p", v("P")), v("Q")))
            ),
        ])
        const y = partlyRebased(lib, x3, "q")
        const { bindings } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(entry(bindings, y.variable("q")).status).toBe("removed")
    })

    it("lists a claim the newer version uses that the response holds as its own", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [...basePremises(), at("n", v("N"))])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [
                labelled("own", v("N")),
                labelled("rule", implies(v("N"), not(x("c")))),
                labelled("other", v("M")),
            ],
        })
        expect(validateLinks(y.engine, x3.engine.snapshot()).ok).toBe(true)
        const { claimBindingConflicts } = classifyBindings(
            y.engine,
            x3.engine.snapshot(),
            x4.engine.snapshot()
        )
        expect(claimBindingConflicts).toEqual([
            {
                variableId: y.variable("N"),
                claimId: "claim-N",
                premises: [
                    {
                        premiseId: y.premise("own"),
                        isLink: false,
                        cascaded: false,
                    },
                    {
                        premiseId: y.premise("rule"),
                        isLink: false,
                        cascaded: false,
                    },
                ],
            },
        ])
    })

    it("throws for a newer snapshot of another argument", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const other = build({ id: "o", version: 4, lib, premises: [v("A")] })
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [x("p")],
        })
        expect(() =>
            classifyBindings(
                y.engine,
                x3.engine.snapshot(),
                other.engine.snapshot()
            )
        ).toThrow(/same argument/)
    })
})

/**
 * A response to `x3` with links on `p`, `c` and `q`, saved halfway through a
 * rebase to version 4: the variable for `rebasedLabel` is already bound to
 * version 4, and the others are still on version 3.
 */
function partlyRebased(
    lib: ClaimLibrary,
    x3: TBuilt,
    rebasedLabel: string
): TBuilt {
    const y = build({
        id: "y",
        version: 1,
        lib,
        respondsTo: x3,
        premises: [x("p"), not(x("c")), not(x("q"))],
    })
    const snap = y.engine.snapshot()
    const rebasedId = y.variable(rebasedLabel)
    snap.variables = {
        ...snap.variables,
        variables: snap.variables.variables.map((variable) =>
            variable.id === rebasedId
                ? { ...variable, boundArgumentVersion: 4 }
                : variable
        ),
    }
    const engine = ArgumentEngine.fromSnapshot(snap, lib)
    engine.setBehavior("permissive")
    return { ...y, engine }
}

/**
 * The three-argument chain: `y` answers `x` and `z` answers `y`. `y` has an
 * affirm link on `x`'s `p` (its expression labelled `yAffirm`) and a premise
 * of its own (`own`) with no reference into another argument.
 */
function chain(lib: ClaimLibrary, x3: TBuilt, x4: TBuilt) {
    const yPremises = (): (TNode | TPremiseSpec)[] => [
        at("yAffirm", x("p")),
        at("own", and(v("M"), v("N"))),
    ]
    const y1 = build({
        id: "y",
        version: 1,
        lib,
        respondsTo: x3,
        premises: yPremises(),
    })
    const y2 = build({
        id: "y",
        version: 2,
        lib,
        respondsTo: x4,
        premises: yPremises(),
    })
    const z0 = build({
        id: "z",
        version: 0,
        lib,
        respondsTo: y1,
        premises: [not(x("yAffirm")), not(s("own"))],
    })
    return { y1, y2, z0 }
}

describe("classifying across a chain of responses", () => {
    it("does not mark a binding into an expression with no reference into another argument as changed", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        // The answered argument's own edit must not reach z through y.
        const x4 = target(lib, 4, basePremises().slice(0, 1))
        const { y1, y2, z0 } = chain(lib, x3, x4)
        const { bindings } = classifyBindings(
            z0.engine,
            y1.engine.snapshot(),
            y2.engine.snapshot()
        )
        expect(entry(bindings, z0.variable("inference:own")).status).toBe(
            "unchanged"
        )
    })

    it("reports a binding into a link unchanged when the linked expression did not change and both versions are supplied", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const { y1, y2, z0 } = chain(lib, x3, x4)
        const { bindings } = classifyBindings(
            z0.engine,
            y1.engine.snapshot(),
            y2.engine.snapshot(),
            { outsideSnapshots: [x3.engine.snapshot(), x4.engine.snapshot()] }
        )
        expect(entry(bindings, z0.variable("yAffirm")).status).toBe("unchanged")
    })

    it("reports a binding into a link changed in content when the linked claim gained a version", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        lib.freeze("claim-P")
        const x4 = target(lib, 4)
        const { y1, y2, z0 } = chain(lib, x3, x4)
        const { bindings } = classifyBindings(
            z0.engine,
            y1.engine.snapshot(),
            y2.engine.snapshot(),
            { outsideSnapshots: [x3.engine.snapshot(), x4.engine.snapshot()] }
        )
        expect(entry(bindings, z0.variable("yAffirm"))).toMatchObject({
            status: "changed",
            reasons: ["content"],
        })
    })

    it("reports a binding into a link as re-pinned when the answered argument's snapshots are not supplied", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const { y1, y2, z0 } = chain(lib, x3, x4)
        const { bindings } = classifyBindings(
            z0.engine,
            y1.engine.snapshot(),
            y2.engine.snapshot()
        )
        expect(entry(bindings, z0.variable("yAffirm"))).toMatchObject({
            status: "changed",
            reasons: ["outsideReferenceRepinned"],
        })
        expect(entry(bindings, z0.variable("inference:own")).status).toBe(
            "unchanged"
        )
    })
})

describe("rebaseResponse", () => {
    it("re-points every unchanged binding and moves the response to the newer version", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(x("c")), x("p"), not(s("step")), s("both")],
        })
        const before = y.engine.snapshot()
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {})
        expectRebased(y.engine, x4.engine.snapshot())
        expect(y.engine.listPremiseIds()).toEqual(
            before.premises.map((ps) => ps.premise.id)
        )
        expect(validateLinks(y.engine, x4.engine.snapshot()).ok).toBe(true)
    })

    it("re-points a variable used only inside another premise", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [v("R"), implies(v("R"), not(x("q")))],
        })
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {})
        expectRebased(y.engine, x4.engine.snapshot())
        expect(y.engine.getVariable(y.variable("q"))).toMatchObject({
            boundExpressionId: x4.expr("q"),
            boundArgumentVersion: 4,
        })
    })

    it("drops a variable with every premise that uses it, and keeps the rest", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [
            labelled(
                "stepPremise",
                at("step", implies(at("p", v("P")), v("Q")))
            ),
        ])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [
                labelled("r", v("R")),
                labelled("rule", implies(v("R"), not(x("q")))),
                labelled("link", not(x("q"))),
            ],
        })
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {
            bindings: { [y.variable("q")]: { action: "drop" } },
        })
        expectRebased(y.engine, x4.engine.snapshot())
        expect(y.engine.listPremiseIds()).toEqual([y.premise("r")])
        expect(y.engine.hasVariable(y.variable("q"))).toBe(false)
    })

    it("drops the premises reached through the removal of a premise that uses the variable", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [
            labelled(
                "stepPremise",
                at("step", implies(at("p", v("P")), v("Q")))
            ),
        ])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [
                labelled("r", v("R")),
                labelled("rule", implies(v("R"), not(x("q")))),
                labelled("onRule", implies(pv("rule"), v("S"))),
            ],
        })
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {
            bindings: { [y.variable("q")]: { action: "drop" } },
        })
        expectRebased(y.engine, x4.engine.snapshot())
        expect(y.engine.listPremiseIds()).toEqual([y.premise("r")])
    })

    it("keeps a changed binding on the same expression when asked", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        lib.freeze("claim-Q")
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("step"))],
        })
        const variableId = y.variable("inference:step")
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {
            bindings: { [variableId]: { action: "keep" } },
        })
        expectRebased(y.engine, x4.engine.snapshot())
        expect(y.engine.getVariable(variableId)).toMatchObject({
            boundExpressionId: x4.expr("step"),
        })
    })

    it("retargets a removed binding onto another expression", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, basePremises().slice(0, 1))
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("both"))],
        })
        const variableId = y.variable("inference:both")
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {
            bindings: {
                [variableId]: {
                    action: "retarget",
                    expressionId: x4.expr("step"),
                },
            },
        })
        expectRebased(y.engine, x4.engine.snapshot())
        expect(y.engine.getVariable(variableId)).toMatchObject({
            boundExpressionId: x4.expr("step"),
            boundAspect: "inference",
        })
    })

    it("finishes a partly rebased response", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = partlyRebased(lib, x3, "p")
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {})
        expectRebased(y.engine, x4.engine.snapshot())
    })

    it("asks for a decision on a partly rebased binding whose expression is not in the newer version", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [
            labelled(
                "stepPremise",
                at("step", implies(at("p", v("P")), v("Q")))
            ),
        ])
        const y = partlyRebased(lib, x3, "q")
        expect(() =>
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {}
            )
        ).toThrow(/decision/)
        y.engine.rebaseResponse(x3.engine.snapshot(), x4.engine.snapshot(), {
            bindings: { [y.variable("q")]: { action: "drop" } },
        })
        expectRebased(y.engine, x4.engine.snapshot())
    })

    it("throws for a missing decision and leaves the response unchanged", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        lib.freeze("claim-Q")
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("step")), x("p")],
        })
        const before = y.engine.snapshot()
        expect(() =>
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {}
            )
        ).toThrow(/decision/)
        expect(y.engine.snapshot()).toEqual(before)
    })

    it("returns, and diffArguments reports, the new respondsTo and each re-pointed variable", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        lib.freeze("claim-Q")
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("step")), x("p"), not(x("c"))],
        })
        const before = copyOf(y.engine, lib)
        const repointed = [
            y.variable("inference:step"),
            y.variable("p"),
            y.variable("c"),
        ].sort()
        const { changes } = y.engine.rebaseResponse(
            x3.engine.snapshot(),
            x4.engine.snapshot(),
            {
                bindings: {
                    [y.variable("inference:step")]: { action: "keep" },
                },
            }
        )
        expectRebased(y.engine, x4.engine.snapshot())

        expect(changes.argument?.respondsTo).toEqual({
            argumentId: "x",
            argumentVersion: 4,
        })
        expect(
            changes.variables?.modified.map((variable) => variable.id).sort()
        ).toEqual(repointed)

        const diff = diffArguments(before, y.engine)
        expect(diff.argument.changes).toContainEqual({
            field: "respondsTo",
            before: { argumentId: "x", argumentVersion: 3 },
            after: { argumentId: "x", argumentVersion: 4 },
        })
        expect(
            diff.variables.modified.map((change) => change.after.id).sort()
        ).toEqual(repointed)
    })

    it("refuses to keep a removed binding", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, basePremises().slice(0, 1))
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("both"))],
        })
        const before = y.engine.snapshot()
        expect(() =>
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {
                    bindings: {
                        [y.variable("inference:both")]: { action: "keep" },
                    },
                }
            )
        ).toThrow(/removed/)
        expect(y.engine.snapshot()).toEqual(before)
    })

    it("refuses a retarget onto an expression another variable already binds in the same aspect", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, [
            labelled(
                "stepPremise",
                at("step", implies(at("p", v("P")), v("Q")))
            ),
            at("both", and(v("A"), v("B"))),
        ])
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [x("p"), not(x("q"))],
        })
        const before = y.engine.snapshot()
        expect(() =>
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {
                    bindings: {
                        [y.variable("q")]: {
                            action: "retarget",
                            expressionId: x4.expr("p"),
                        },
                    },
                }
            )
        ).toThrow(/already binds/)
        expect(y.engine.snapshot()).toEqual(before)
    })

    it("refuses, and rolls back, a retarget that leaves a new link fault", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4, basePremises().slice(0, 1))
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [not(s("both")), x("p")],
        })
        const before = y.engine.snapshot()
        expect(() =>
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {
                    bindings: {
                        // `c` is a variable expression, which has no step.
                        [y.variable("inference:both")]: {
                            action: "retarget",
                            expressionId: x4.expr("c"),
                        },
                    },
                }
            )
        ).toThrow(/LINK_INFERENCE_ON_NON_OPERATOR/)
        expect(y.engine.snapshot()).toEqual(before)
    })

    it("refuses a decision for a binding that needs none", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [x("p")],
        })
        expect(() =>
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                { bindings: { [y.variable("p")]: { action: "drop" } } }
            )
        ).toThrow(/needs no decision/)
    })

    it("refuses when the response does not answer the older version", () => {
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const x5 = target(lib, 5)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [x("p")],
        })
        expect(() =>
            y.engine.rebaseResponse(
                x4.engine.snapshot(),
                x5.engine.snapshot(),
                {}
            )
        ).toThrow(/answers/)
    })

    it("refuses when binding to the newer version is not allowed", () => {
        class Refusing extends ArgumentEngine {
            protected override canBind(): boolean {
                return false
            }
        }
        const lib = newLib()
        const x3 = target(lib, 3)
        const x4 = target(lib, 4)
        const y = build({
            id: "y",
            version: 1,
            lib,
            respondsTo: x3,
            premises: [x("p")],
        })
        const snap = y.engine.snapshot()
        const refusing = new Refusing(snap.argument, lib, {
            behavior: "permissive",
        })
        refusing.rollback(snap)
        expect(() =>
            refusing.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {}
            )
        ).toThrow(/not allowed/)
        expect(refusing.snapshot()).toEqual(snap)
    })

    describe("claim-binding conflicts", () => {
        function conflict(
            yPremises: (TNode | TPremiseSpec)[],
            claimTypes?: Record<string, "citation">
        ) {
            const lib = newLib()
            const x3 = target(lib, 3)
            const y = build({
                id: "y",
                version: 1,
                lib,
                respondsTo: x3,
                premises: yPremises,
                claimTypes,
            })
            const x4 = target(lib, 4, [...basePremises(), at("n", v("N"))])
            return { lib, x3, x4, y }
        }

        it("throws without a decision", () => {
            const { x3, x4, y } = conflict([v("N")])
            expect(() =>
                y.engine.rebaseResponse(
                    x3.engine.snapshot(),
                    x4.engine.snapshot(),
                    {}
                )
            ).toThrow(/decision/)
        })

        it("converts the claim-bound variable to a link and adds an affirm link", () => {
            const { x3, x4, y } = conflict([
                labelled("rule", implies(v("N"), not(x("c")))),
            ])
            const claimVariable = y.variable("N")
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {
                    claimBindingConflicts: {
                        [claimVariable]: {
                            action: "convertToLink",
                            expressionId: x4.expr("n"),
                        },
                    },
                }
            )
            expectRebased(y.engine, x4.engine.snapshot())
            expect(y.engine.hasVariable(claimVariable)).toBe(false)
            const bound = y.engine
                .getVariables()
                .find(
                    (variable) =>
                        isExpressionBound(variable) &&
                        variable.boundExpressionId === x4.expr("n")
                )
            expect(bound).toBeDefined()
            // The rule now reads the link variable.
            const rule = y.engine.getPremise(y.premise("rule"))!
            expect(
                rule
                    .getExpressions()
                    .some(
                        (expr) =>
                            expr.type === "variable" &&
                            expr.variableId === bound!.id
                    )
            ).toBe(true)
            // An affirm link was added: a premise holding only the variable.
            const affirm = y.engine
                .listPremises()
                .filter((pm) => pm.getId() !== y.premise("rule"))
            expect(affirm).toHaveLength(1)
            expect(affirm[0].getExpressions()).toMatchObject([
                { type: "variable", variableId: bound!.id, parentId: null },
            ])
            expect(validateLinks(y.engine, x4.engine.snapshot()).ok).toBe(true)
        })

        it("adds no affirm link when the converted premise already is one", () => {
            const { x3, x4, y } = conflict([labelled("own", v("N"))])
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {
                    claimBindingConflicts: {
                        [y.variable("N")]: {
                            action: "convertToLink",
                            expressionId: x4.expr("n"),
                        },
                    },
                }
            )
            expectRebased(y.engine, x4.engine.snapshot())
            expect(y.engine.listPremiseIds()).toEqual([y.premise("own")])
        })

        it("drops every premise using the claim-bound variable", () => {
            const { x3, x4, y } = conflict([
                labelled("own", v("N")),
                labelled("rule", implies(v("N"), not(x("c")))),
                labelled("other", v("M")),
            ])
            y.engine.rebaseResponse(
                x3.engine.snapshot(),
                x4.engine.snapshot(),
                {
                    claimBindingConflicts: {
                        [y.variable("N")]: { action: "drop" },
                    },
                }
            )
            expectRebased(y.engine, x4.engine.snapshot())
            expect(y.engine.listPremiseIds()).toEqual([y.premise("other")])
            expect(validateLinks(y.engine, x4.engine.snapshot()).ok).toBe(true)
        })

        it("refuses to convert a claim the response derives", () => {
            const { x3, x4, y } = conflict([
                labelled("derived", implies(v("S"), v("N")), "N"),
            ])
            const before = y.engine.snapshot()
            expect(() =>
                y.engine.rebaseResponse(
                    x3.engine.snapshot(),
                    x4.engine.snapshot(),
                    {
                        claimBindingConflicts: {
                            [y.variable("N")]: {
                                action: "convertToLink",
                                expressionId: x4.expr("n"),
                            },
                        },
                    }
                )
            ).toThrow(/derivation/)
            expect(y.engine.snapshot()).toEqual(before)
        })

        it("refuses to convert a citation claim", () => {
            const { x3, x4, y } = conflict(
                [labelled("rule", implies(v("N"), not(x("c"))))],
                { N: "citation" }
            )
            expect(() =>
                y.engine.rebaseResponse(
                    x3.engine.snapshot(),
                    x4.engine.snapshot(),
                    {
                        claimBindingConflicts: {
                            [y.variable("N")]: {
                                action: "convertToLink",
                                expressionId: x4.expr("n"),
                            },
                        },
                    }
                )
            ).toThrow(/citation/)
        })

        it("refuses to convert onto an expression of another claim", () => {
            const { x3, x4, y } = conflict([v("N")])
            expect(() =>
                y.engine.rebaseResponse(
                    x3.engine.snapshot(),
                    x4.engine.snapshot(),
                    {
                        claimBindingConflicts: {
                            [y.variable("N")]: {
                                action: "convertToLink",
                                expressionId: x4.expr("p"),
                            },
                        },
                    }
                )
            ).toThrow(/claim-N/)
        })
    })
})
