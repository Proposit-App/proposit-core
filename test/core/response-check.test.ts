import { describe, expect, it } from "vitest"
import {
    and,
    at,
    build,
    implies,
    labelled,
    newLib,
    not,
    or,
    s,
    v,
    x,
    type TBuilt,
    type TNode,
    type TPremiseSpec,
} from "./response-fixtures"
import { validateLinks } from "../../src/lib/core/response/links"

/** The argument answered: one labelled expression of each kind the cases need. */
function target(lib = newLib(), extra: TNode[] = []): TBuilt {
    return build({
        id: "x",
        version: 3,
        lib,
        conclusion: at("x", v("X")),
        premises: [
            at("y", v("Y")),
            at("p", v("P")),
            at("c", v("C")),
            at("step", implies(v("A"), v("B"))),
            at("qr", and(at("q", v("Q")), at("r", v("R")))),
            at("c2", v("C")),
            ...extra,
        ],
    })
}

function respond(
    t: TBuilt,
    lib: ReturnType<typeof newLib>,
    premises: (TNode | TPremiseSpec)[],
    claimTypes?: Record<string, "citation" | "axiomatic">
): TBuilt {
    return build({
        id: "y",
        version: 0,
        lib,
        respondsTo: t,
        premises,
        claimTypes,
    })
}

function setUp(
    premises: (TNode | TPremiseSpec)[],
    claimTypes?: Record<string, "citation" | "axiomatic">
) {
    const lib = newLib()
    const t = target(lib)
    const response = respond(t, lib, premises, claimTypes)
    const snapshot = t.engine.snapshot()
    return {
        response,
        check: (label: string) =>
            response.engine.checkLink(response.premise(label), snapshot),
        coherence: () => response.engine.checkResponseCoherent(snapshot),
    }
}

describe("checkLink", () => {
    it("finds a link that follows from the other premises, with a minimal support set", () => {
        const { response, check } = setUp([
            labelled("r", v("R1")),
            labelled("rule", implies(v("R1"), not(x("x")))),
            labelled("link", not(x("x"))),
        ])
        expect(check("link")).toEqual({
            status: "follows",
            supportPremiseIds: [
                response.premise("r"),
                response.premise("rule"),
            ],
            restsOnlyOnLinks: false,
        })
    })

    it("reports an asserted link that something tried to support", () => {
        const { check } = setUp([
            implies(v("R1"), not(x("x"))),
            labelled("link", not(x("x"))),
        ])
        expect(check("link")).toMatchObject({
            status: "asserted",
            attemptedSupport: true,
        })
    })

    it("reports a bare assertion, with a counterexample in terms of claims", () => {
        const { check } = setUp([labelled("link", not(x("x")))])
        expect(check("link")).toEqual({
            status: "asserted",
            attemptedSupport: false,
            counterexample: [
                { column: { kind: "claim", claimId: "claim-X" }, value: true },
            ],
        })
    })

    it("grounds a link that follows from an asserted affirm link", () => {
        const { check } = setUp([
            labelled("p", x("p")),
            implies(x("p"), not(x("c"))),
            labelled("notC", not(x("c"))),
        ])
        expect(check("p")).toMatchObject({
            status: "asserted",
            attemptedSupport: false,
        })
        expect(check("notC")).toMatchObject({
            status: "follows",
            restsOnlyOnLinks: false,
        })
    })

    it("finds an undercut that follows", () => {
        const { check } = setUp([
            v("R1"),
            implies(v("R1"), not(s("step"))),
            labelled("undercut", not(s("step"))),
        ])
        expect(check("undercut")).toMatchObject({ status: "follows" })
    })

    it("reports links that only support each other as resting on links", () => {
        const circular = [
            labelled("notX", not(x("x"))),
            labelled("notY", not(x("y"))),
            implies(not(x("y")), not(x("x"))),
            implies(not(x("x")), not(x("y"))),
        ]
        const { check } = setUp(circular)
        expect(check("notX")).toMatchObject({
            status: "follows",
            restsOnlyOnLinks: true,
        })
        expect(check("notY")).toMatchObject({
            status: "follows",
            restsOnlyOnLinks: true,
        })

        const grounded = setUp([
            ...circular,
            v("R1"),
            implies(v("R1"), not(x("y"))),
        ])
        expect(grounded.check("notX")).toMatchObject({
            status: "follows",
            restsOnlyOnLinks: false,
        })
        expect(grounded.check("notY")).toMatchObject({
            status: "follows",
            restsOnlyOnLinks: false,
        })
    })

    it("takes a cited source as given through its derivation premise", () => {
        const { check } = setUp(
            [
                labelled("derivation", implies(v("S"), v("D")), "D"),
                implies(v("D"), not(x("x"))),
                labelled("link", not(x("x"))),
            ],
            { S: "citation" }
        )
        expect(check("link")).toMatchObject({ status: "follows" })
    })

    it("calls every link incoherent when a denial contradicts a cited source", () => {
        const { check, coherence } = setUp(
            [
                labelled("derivation", implies(v("S"), v("D")), "D"),
                not(v("D")),
                labelled("link", not(x("x"))),
            ],
            { S: "citation" }
        )
        expect(check("link")).toEqual({ status: "incoherent" })
        expect(coherence()).toMatchObject({ coherent: false })
    })

    it("agrees with coherence when a contradicted conjunction has both parts affirmed", () => {
        const { check, coherence } = setUp([
            not(x("qr")),
            x("q"),
            x("r"),
            labelled("other", not(x("x"))),
        ])
        expect(check("other")).toEqual({ status: "incoherent" })
        expect(coherence()).toMatchObject({ coherent: false })
    })

    it("does not let two affirm links on one claim support each other", () => {
        const { check } = setUp([
            labelled("first", x("c")),
            labelled("second", x("c2")),
        ])
        for (const label of ["first", "second"]) {
            const result = check(label)
            expect(result).toMatchObject({ status: "asserted" })
            expect(result).not.toHaveProperty("restsOnlyOnLinks")
        }
    })

    it("answers invalid for a response whose bindings do not fit the target", () => {
        const { check, coherence } = setUp([
            labelled("bad", not(s("x"))),
            labelled("link", not(x("y"))),
        ])
        expect(check("link")).toMatchObject({
            status: "invalid",
            problems: [{ code: "LINK_INFERENCE_ON_NON_OPERATOR" }],
        })
        expect(coherence()).toMatchObject({ status: "invalid" })
    })

    it("answers invalid for a snapshot of another version", () => {
        const lib = newLib()
        const t = target(lib)
        const response = respond(t, lib, [labelled("link", not(x("x")))])
        const snapshot = t.engine.snapshot()
        snapshot.argument = { ...snapshot.argument, version: 4 }
        expect(
            response.engine.checkLink(response.premise("link"), snapshot)
        ).toMatchObject({
            status: "invalid",
            problems: [{ code: "LINK_TARGET_MISMATCH" }],
        })
    })

    it("answers undetermined, without throwing, for a group of 17 variables", () => {
        const own = Array.from({ length: 16 }, (_, index) => v(`A${index}`))
        const { check, coherence } = setUp([
            or(...own, x("x")),
            labelled("link", not(x("x"))),
        ])
        expect(check("link")).toEqual({
            status: "undetermined",
            reason: "too-many-variables",
        })
        expect(coherence()).toEqual({
            status: "checked",
            coherent: null,
            reason: "too-many-variables",
        })
    })

    it("decides two independent groups of 10 variables each", () => {
        const group = (prefix: string, label: string): TNode =>
            or(
                ...Array.from({ length: 9 }, (_, index) =>
                    v(`${prefix}${index}`)
                ),
                x(label)
            )
        const { check } = setUp([
            group("A", "x"),
            labelled("notX", not(x("x"))),
            group("B", "y"),
            labelled("notY", not(x("y"))),
        ])
        expect(check("notX").status).toBe("asserted")
        expect(check("notY").status).toBe("asserted")
    })

    it("refuses a premise that is not a link", () => {
        const { response } = setUp([labelled("own", v("R1"))])
        expect(() =>
            response.engine.checkLink(
                response.premise("own"),
                target().engine.snapshot()
            )
        ).toThrow(/not a link/)
    })

    it("stays within reach of the ceiling for one group of 16 columns and 10 links", () => {
        // The expensive shape: every link follows, so each search walks its
        // whole table, and the minimal support set and the grounding pass
        // repeat it. The time is read from the test's duration; the generous
        // timeout keeps a busy machine from failing a test about answers.
        const lib = newLib()
        const labels = Array.from({ length: 10 }, (_, index) => `t${index}`)
        const t = target(
            lib,
            labels.map((label, index) => at(label, v(`T${index}`)))
        )
        const own = Array.from({ length: 6 }, (_, index) => v(`A${index}`))
        const response = respond(t, lib, [
            ...own,
            implies(and(...own), and(...labels.map((label) => not(x(label))))),
            ...labels.map((label) => labelled(label, not(x(label)))),
        ])
        const snapshot = t.engine.snapshot()
        for (const label of labels) {
            expect(
                response.engine.checkLink(response.premise(label), snapshot)
            ).toMatchObject({ status: "follows", restsOnlyOnLinks: false })
        }
    }, 60_000)
})

describe("checkResponseCoherent", () => {
    it("is coherent for a response that can hold", () => {
        expect(setUp([not(x("x")), x("y")]).coherence()).toEqual({
            status: "checked",
            coherent: true,
        })
    })

    it("is incoherent for a link and its denial, naming both", () => {
        const { response, coherence } = setUp([
            labelled("affirm", x("x")),
            labelled("deny", not(x("x"))),
            labelled("other", x("y")),
        ])
        expect(coherence()).toEqual({
            status: "checked",
            coherent: false,
            unsatisfiablePremiseIds: [
                response.premise("affirm"),
                response.premise("deny"),
            ],
        })
    })

    it("is incoherent for a contradicted conjunction with both parts affirmed", () => {
        expect(setUp([not(x("qr")), x("q"), x("r")]).coherence()).toMatchObject(
            { coherent: false }
        )
    })

    it("is incoherent for two occurrences of one claim affirmed and denied", () => {
        expect(setUp([x("c"), not(x("c2"))]).coherence()).toMatchObject({
            coherent: false,
        })
    })

    it("is incoherent for a denial of what a cited source derives", () => {
        expect(
            setUp(
                [
                    labelled("derivation", implies(v("S"), v("D")), "D"),
                    not(v("D")),
                ],
                { S: "citation" }
            ).coherence()
        ).toMatchObject({ coherent: false })
    })
})

describe("claims a response shares with the argument it answers", () => {
    // The argument answered: P → Q and Q → R, with P derived from the cited
    // source S. R is its conclusion.
    function sharedTarget(lib: ReturnType<typeof newLib>): TBuilt {
        return build({
            id: "x",
            version: 3,
            lib,
            conclusion: at("r", v("R")),
            premises: [
                implies(v("P"), v("Q")),
                implies(v("Q"), v("R")),
                labelled("derivation", implies(v("S"), v("P")), "P"),
            ],
            claimTypes: { S: "citation" },
        })
    }

    function setUpShared(premises: (TNode | TPremiseSpec)[]) {
        const lib = newLib()
        const t = sharedTarget(lib)
        const response = respond(t, lib, premises)
        const snapshot = t.engine.snapshot()
        return {
            response,
            snapshot,
            check: (label: string) =>
                response.engine.checkLink(response.premise(label), snapshot),
            coherence: () => response.engine.checkResponseCoherent(snapshot),
        }
    }

    it("follows when the shared claim is grounded by a copy of the target's derivation premise", () => {
        const { response, snapshot, check } = setUpShared([
            labelled("derivation", implies(v("S"), v("P")), "P"),
            labelled("reason", implies(v("P"), not(x("r")))),
            labelled("link", not(x("r"))),
        ])
        expect(validateLinks(response.engine, snapshot)).toEqual({
            ok: true,
            violations: [],
        })
        expect(check("link")).toMatchObject({
            status: "follows",
            restsOnlyOnLinks: false,
        })
    })

    it("is asserted when nothing grounds the shared claim", () => {
        const { check } = setUpShared([
            labelled("reason", implies(v("P"), not(x("r")))),
            labelled("link", not(x("r"))),
        ])
        expect(check("link")).toMatchObject({ status: "asserted" })
    })

    it("accepts a derivation premise reusing the target's cited source", () => {
        const { response, snapshot } = setUpShared([
            labelled("derivation", implies(v("S"), v("P")), "P"),
            labelled("reason", implies(v("P"), not(x("r")))),
            labelled("link", not(x("r"))),
        ])
        expect(response.engine.validate("structural")).toEqual([])
        expect(response.engine.validate("evaluable")).toEqual([])
        expect(validateLinks(response.engine, snapshot).ok).toBe(true)
    })

    it("reads a shared claim as one proposition: using it and contradicting it is incoherent", () => {
        const lib = newLib()
        const t = target(lib)
        const response = respond(t, lib, [
            v("P"),
            labelled("link", not(x("p"))),
        ])
        const snapshot = t.engine.snapshot()
        expect(
            response.engine.checkLink(response.premise("link"), snapshot)
        ).toEqual({ status: "incoherent" })
        expect(response.engine.checkResponseCoherent(snapshot)).toMatchObject({
            coherent: false,
        })
    })
})
