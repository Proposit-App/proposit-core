import { describe, expect, it } from "vitest"
import { linkTargetsElement } from "../../src/lib/core/response/link-reference"
import {
    and,
    at,
    build,
    implies,
    labelled,
    newLib,
    not,
    or,
    paren,
    s,
    v,
    x,
} from "./response-fixtures"

function setUp() {
    const lib = newLib()
    const target = build({
        id: "x",
        version: 3,
        lib,
        conclusion: at("c", v("C")),
        premises: [
            labelled(
                "step",
                at(
                    "root",
                    implies(
                        at("p", v("P")),
                        at("both", and(v("Q"), at("c2", v("C"))))
                    )
                )
            ),
        ],
    })
    const response = build({
        id: "y",
        version: 0,
        lib,
        respondsTo: target,
        premises: [
            labelled("onC", not(x("c"))),
            labelled("onRoot", not(s("root"))),
            labelled("onBoth", x("both")),
            labelled("own", v("Own")),
        ],
    })
    const snapshot = target.engine.snapshot()
    const reference = (label: string) => ({
        argumentId: "y",
        argumentVersion: 0,
        premiseId: response.premise(label),
    })
    const targets = (
        label: string,
        element: Parameters<typeof linkTargetsElement>[3]
    ) =>
        linkTargetsElement(reference(label), response.engine, snapshot, element)
    return { target, response, snapshot, reference, targets }
}

describe("linkTargetsElement", () => {
    it("reads an undercut of the operator under a premise's root formula as about the whole premise", () => {
        const lib = newLib()
        const target = build({
            id: "x",
            version: 3,
            lib,
            conclusion: v("C"),
            premises: [
                labelled(
                    "wrapped",
                    paren(at("top", or(at("p", v("P")), v("Q"))))
                ),
            ],
        })
        const response = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: target,
            premises: [labelled("onTop", not(s("top")))],
        })
        const snapshot = target.engine.snapshot()
        expect(
            linkTargetsElement(
                {
                    argumentId: "y",
                    argumentVersion: 0,
                    premiseId: response.premise("onTop"),
                },
                response.engine,
                snapshot,
                { kind: "expression", expressionId: target.expr("p") }
            )
        ).toBe(true)
    })

    it("matches a claim through any of its occurrences", () => {
        const { targets } = setUp()
        expect(targets("onC", { kind: "claim", claimId: "claim-C" })).toBe(true)
        expect(targets("onC", { kind: "claim", claimId: "claim-P" })).toBe(
            false
        )
    })

    it("matches a claim whatever version of it the occurrence names", () => {
        const { response, snapshot, reference } = setUp()
        const bumped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
        bumped.variables.variables = bumped.variables.variables.map(
            (variable) =>
                "claimId" in variable && variable.claimId === "claim-C"
                    ? { ...variable, claimVersion: 1 }
                    : variable
        )
        expect(
            linkTargetsElement(reference("onC"), response.engine, bumped, {
                kind: "claim",
                claimId: "claim-C",
            })
        ).toBe(true)
    })

    it("does not match a claim through a link on an operator", () => {
        const { targets } = setUp()
        expect(targets("onBoth", { kind: "claim", claimId: "claim-C" })).toBe(
            false
        )
    })

    it("matches an expression directly", () => {
        const { target, targets } = setUp()
        expect(
            targets("onBoth", {
                kind: "expression",
                expressionId: target.expr("both"),
            })
        ).toBe(true)
        expect(
            targets("onBoth", {
                kind: "expression",
                expressionId: target.expr("c2"),
            })
        ).toBe(false)
    })

    it("matches an expression through the root of the premise containing it", () => {
        const { target, targets } = setUp()
        for (const label of ["p", "both", "c2"]) {
            expect(
                targets("onRoot", {
                    kind: "expression",
                    expressionId: target.expr(label),
                })
            ).toBe(true)
        }
        expect(
            targets("onRoot", {
                kind: "expression",
                expressionId: target.expr("c"),
            })
        ).toBe(false)
    })

    it("never matches a premise that is not a link", () => {
        const { target, targets } = setUp()
        expect(targets("own", { kind: "claim", claimId: "claim-Own" })).toBe(
            false
        )
        expect(
            targets("own", {
                kind: "expression",
                expressionId: target.expr("c"),
            })
        ).toBe(false)
    })

    it("never matches a reference to another argument or version", () => {
        const { response, snapshot, reference } = setUp()
        const element = { kind: "claim" as const, claimId: "claim-C" }
        expect(
            linkTargetsElement(
                { ...reference("onC"), argumentVersion: 1 },
                response.engine,
                snapshot,
                element
            )
        ).toBe(false)
        expect(
            linkTargetsElement(
                { ...reference("onC"), argumentId: "z" },
                response.engine,
                snapshot,
                element
            )
        ).toBe(false)
    })
})
