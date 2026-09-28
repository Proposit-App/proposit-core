// The changeset a mutation returns must describe everything the call
// changed, including what assistive normalization changed after it: applying
// the changeset to the state before the call has to give the state after it.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import { ClaimLibrary } from "../../src/lib/index.js"
import type { TCoreChangeset } from "../../src/lib/types/mutation.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

type TState = {
    expressions: Map<string, unknown>
    premises: Map<string, unknown>
    variables: Map<string, unknown>
}

function stateOf(eng: ArgumentEngine): TState {
    const state: TState = {
        expressions: new Map(),
        premises: new Map(),
        variables: new Map(),
    }
    for (const pe of eng.listPremises()) {
        state.premises.set(pe.getId(), pe.toPremiseData())
        for (const e of pe.getExpressions()) state.expressions.set(e.id, e)
    }
    for (const v of eng.getVariables()) state.variables.set(v.id, v)
    return state
}

function replay(before: TState, changes: TCoreChangeset): TState {
    const after: TState = {
        expressions: new Map(before.expressions),
        premises: new Map(before.premises),
        variables: new Map(before.variables),
    }
    const apply = (
        into: Map<string, unknown>,
        bucket:
            | {
                  added: { id: string }[]
                  modified: { id: string }[]
                  removed: { id: string }[]
              }
            | undefined
    ) => {
        for (const e of bucket?.removed ?? []) into.delete(e.id)
        for (const e of [...(bucket?.added ?? []), ...(bucket?.modified ?? [])])
            into.set(e.id, e)
    }
    apply(after.expressions, changes.expressions)
    apply(after.premises, changes.premises)
    apply(after.variables, changes.variables)
    return after
}

const sorted = (m: Map<string, unknown>) =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b))

function expectReplays(
    before: TState,
    changes: TCoreChangeset,
    eng: ArgumentEngine
): void {
    const replayed = replay(before, changes)
    const after = stateOf(eng)
    expect(sorted(replayed.expressions)).toEqual(sorted(after.expressions))
    expect(sorted(replayed.premises)).toEqual(sorted(after.premises))
    expect(sorted(replayed.variables)).toEqual(sorted(after.variables))
}

/**
 * `or(ve-0, (op-inner(ve-1..ve-n)))` in the last premise, where each `ve-i`
 * is bound to one of the other premises. Built in permissive behavior, then
 * switched to assistive, so the tree is already in normal form.
 */
function buildFixture(
    innerOperator: "and" | "or",
    operandCount: number,
    claims: ConstructorParameters<typeof ArgumentEngine>[1] = EMPTY_CLAIM_LOOKUP
) {
    const eng = new ArgumentEngine(ARG, claims, {
        behavior: "permissive",
    })
    const premises = Array.from(
        { length: operandCount + 2 },
        () => eng.createPremise().result
    )
    const pe = premises[premises.length - 1]
    const variables = pe.getVariables() as {
        id: string
        boundPremiseId?: string
    }[]
    const variableFor = (index: number) =>
        variables.find((v) => v.boundPremiseId === premises[index].getId())!.id
    const base = {
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: pe.getId(),
    }
    pe.addExpression({
        ...base,
        id: "or-outer",
        type: "operator",
        operator: "or",
        parentId: null,
        position: 0,
    })
    pe.addExpression({
        ...base,
        id: "ve-0",
        type: "variable",
        variableId: variableFor(0),
        parentId: "or-outer",
        position: 0,
    })
    pe.addExpression({
        ...base,
        id: "formula-buf",
        type: "formula",
        parentId: "or-outer",
        position: 1,
    })
    pe.addExpression({
        ...base,
        id: "op-inner",
        type: "operator",
        operator: innerOperator,
        parentId: "formula-buf",
        position: 0,
    })
    for (let i = 1; i <= operandCount; i++) {
        pe.addExpression({
            ...base,
            id: `ve-${i}`,
            type: "variable",
            variableId: variableFor(i),
            parentId: "op-inner",
            position: i,
        })
    }
    eng.setBehavior("assistive")
    return { eng, pe, premises, variableFor }
}

describe("a mutation's changeset includes what assistive normalization changed", () => {
    it("changeOperator whose result normalization absorbs", () => {
        const { eng, pe } = buildFixture("and", 2)
        const before = stateOf(eng)

        const { result, changes } = pe.changeOperator("op-inner", "or")

        expect(result).toBeNull()
        expect(
            (changes.expressions?.removed ?? []).map((e) => e.id).sort()
        ).toEqual(["formula-buf", "op-inner"])
        expect((changes.expressions?.modified ?? []).map((e) => e.id)).toEqual(
            expect.arrayContaining(["ve-1", "ve-2"])
        )
        expectReplays(before, changes, eng)
    })

    it("removeExpression that leaves an operator for normalization to collapse", () => {
        const { eng, pe } = buildFixture("and", 2)
        const before = stateOf(eng)

        const { changes } = pe.removeExpression("ve-2", true)

        expectReplays(before, changes, eng)
    })

    it("deleteExpressionsUsingVariable", () => {
        const { eng, pe, variableFor } = buildFixture("and", 2)
        const before = stateOf(eng)

        const { changes } = pe.deleteExpressionsUsingVariable(variableFor(2))

        expectReplays(before, changes, eng)
    })

    it("ArgumentEngine.removeVariable", () => {
        const { eng, variableFor } = buildFixture("and", 2)
        const before = stateOf(eng)

        const { changes } = eng.removeVariable(variableFor(2))

        expectReplays(before, changes, eng)
    })

    it("ArgumentEngine.removePremise, cascading to its bound variable", () => {
        const { eng, premises } = buildFixture("and", 2)
        const before = stateOf(eng)

        const { changes } = eng.removePremise(premises[2].getId())

        expectReplays(before, changes, eng)
    })

    it("leaves out an expression the call added and normalization removed", () => {
        const { eng, pe } = buildFixture("and", 2)
        const before = stateOf(eng)

        // An empty formula is collapsed by normalization straight away, so
        // the caller never sees it exist.
        const { changes } = pe.addExpression({
            id: "empty-formula",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "formula",
            parentId: "or-outer",
            position: 5,
        })

        expect(pe.getExpression("empty-formula")).toBeUndefined()
        const ids = [
            ...(changes.expressions?.added ?? []),
            ...(changes.expressions?.modified ?? []),
            ...(changes.expressions?.removed ?? []),
        ].map((e) => e.id)
        expect(ids).not.toContain("empty-formula")
        expectReplays(before, changes, eng)
    })

    it("createPremise for a derivation, when normalization then tidies another premise", () => {
        // The fixture's premise is left un-normalized (an `or` inside a
        // formula under an `or`), so the derivation premise's own mutation
        // is what sets normalization off.
        const claims = new ClaimLibrary()
        const derived = claims.create({ id: "d", type: "normal" })
        const { eng } = buildFixture("or", 2, claims)
        const before = stateOf(eng)

        const { changes } = eng.createPremise({
            type: "derivation",
            derivedClaimId: derived.id,
        })

        expect(
            (changes.expressions?.removed ?? []).map((e) => e.id).sort()
        ).toEqual(["formula-buf", "op-inner"])
        expectReplays(before, changes, eng)
    })
})
