// `orderChangeset` must order a changeset so that a store checking foreign
// keys immediately accepts every operation and ends in the engine's state.
// Each changeset is applied twice: to a store that cascades nothing, and to
// one whose deletes cascade to the rows pointing at the deleted row (as
// proposit-app's parent, variable and bound-premise keys do), where a wrongly
// timed delete silently takes a row with it. A premise-bound variable names
// its premise too, so deleting that premise reaches the variable and, through
// it, every expression naming the variable. Both require a row with no parent to sit at
// position 0, a rule a database checks on every statement. The stores start
// from the rows as they were before the call, so an expression's stored
// parent can differ from the parent its removed entry carries: a change in
// the same call can move an expression before removing it.

import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../src/lib/utils/lookup.js"
import {
    composeChangesets,
    orderChangeset,
} from "../src/lib/utils/changeset.js"
import type { TCoreChangeset } from "../src/lib/types/mutation.js"
import type { PremiseEngine } from "../src/lib/core/premise-engine.js"
import { makeArgument } from "./grammar/fixtures.js"

const ARG = makeArgument()

type TRow = Record<string, unknown> & { id: string }
type TStore = {
    expressions: Map<string, TRow>
    premises: Map<string, TRow>
    variables: Map<string, TRow>
}

function storeOf(eng: ArgumentEngine): TStore {
    const store: TStore = {
        expressions: new Map(),
        premises: new Map(),
        variables: new Map(),
    }
    for (const pe of eng.listPremises()) {
        store.premises.set(pe.getId(), pe.toPremiseData() as TRow)
        for (const e of pe.getExpressions()) {
            store.expressions.set(e.id, { ...e } as TRow)
        }
    }
    for (const v of eng.getVariables()) store.variables.set(v.id, v as TRow)
    return store
}

type TDeletes = "restrict" | "cascade"

/** Applies the ordered operations; returns every foreign-key violation. */
function applyStrictly(
    store: TStore,
    changes: TCoreChangeset,
    deletes: TDeletes = "restrict"
): string[] {
    const errors: string[] = []
    // Removes the rows that point at a deleted row, or reports them.
    const dependents = (
        test: (e: TRow) => boolean,
        describe: (e: TRow) => string
    ) => {
        for (const e of [...store.expressions.values()]) {
            if (!test(e)) continue
            if (deletes === "restrict") errors.push(describe(e))
            else deleteExpression(e.id)
        }
    }
    const deleteExpression = (id: string) => {
        store.expressions.delete(id)
        dependents(
            (e) => e.parentId === id,
            (e) => `delete ${id} while ${e.id} points at it`
        )
    }
    const deleteVariable = (id: string) => {
        store.variables.delete(id)
        dependents(
            (e) => e.variableId === id,
            (e) => `delete variable ${id} while ${e.id} uses it`
        )
    }
    const checkVariable = (row: TRow) => {
        if (
            row.boundPremiseId !== undefined &&
            !store.premises.has(row.boundPremiseId as string)
        ) {
            errors.push(`variable ${row.id}: bound premise missing`)
        }
    }
    const checkExpression = (row: TRow) => {
        if (!store.premises.has(row.premiseId as string)) {
            errors.push(`expression ${row.id}: premise missing`)
        }
        if (
            row.parentId !== null &&
            !store.expressions.has(row.parentId as string)
        ) {
            errors.push(
                `expression ${row.id}: parent ${row.parentId as string} missing`
            )
        }
        if (
            row.type === "variable" &&
            !store.variables.has(row.variableId as string)
        ) {
            errors.push(`expression ${row.id}: variable missing`)
        }
        if (row.parentId === null && row.position !== 0) {
            errors.push(
                `expression ${row.id}: root at position ${String(row.position)}`
            )
        }
    }
    for (const op of orderChangeset(changes)) {
        const row = op.data as TRow
        if (op.entity === "expression") {
            if (op.type === "delete") {
                deleteExpression(row.id)
            } else if (op.type === "update") {
                // An update writes the fields it carries, as SQL does.
                const stored = store.expressions.get(row.id)
                if (!stored) {
                    errors.push(`update ${row.id}, which is not stored`)
                    continue
                }
                const merged = { ...stored, ...row }
                checkExpression(merged)
                store.expressions.set(row.id, merged)
            } else {
                checkExpression(row)
                store.expressions.set(row.id, row)
            }
        } else if (op.entity === "variable") {
            if (op.type === "delete") {
                deleteVariable(row.id)
            } else {
                if (op.type === "update" && !store.variables.has(row.id)) {
                    errors.push(
                        `update variable ${row.id}, which is not stored`
                    )
                    continue
                }
                checkVariable(row)
                store.variables.set(row.id, row)
            }
        } else if (op.entity === "premise") {
            if (op.type === "delete") {
                store.premises.delete(row.id)
                for (const v of [...store.variables.values()]) {
                    if (v.boundPremiseId !== row.id) continue
                    if (deletes === "restrict") {
                        errors.push(
                            `delete premise ${row.id} while variable ${v.id} is bound to it`
                        )
                    } else deleteVariable(v.id)
                }
                dependents(
                    (e) => e.premiseId === row.id,
                    (e) => `delete premise ${row.id} while ${e.id} is in it`
                )
            } else {
                store.premises.set(row.id, row)
            }
        }
    }
    return errors
}

const rows = (m: Map<string, TRow>) =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b))

function expectAppliesStrictly(
    eng: ArgumentEngine,
    mutate: () => TCoreChangeset
): void {
    const stores = { restrict: storeOf(eng), cascade: storeOf(eng) }
    const changes = mutate()
    const after = storeOf(eng)
    for (const deletes of ["restrict", "cascade"] as const) {
        const store = stores[deletes]
        expect(applyStrictly(store, changes, deletes), deletes).toEqual([])
        expect(rows(store.expressions), deletes).toEqual(
            rows(after.expressions)
        )
        expect(rows(store.premises), deletes).toEqual(rows(after.premises))
        expect(rows(store.variables), deletes).toEqual(rows(after.variables))
    }
}

function premiseBoundVariable(
    eng: ArgumentEngine,
    premise: PremiseEngine
): string {
    const variables = eng.getVariables() as unknown as {
        id: string
        boundPremiseId?: string
    }[]
    return variables.find((v) => v.boundPremiseId === premise.getId())!.id
}

describe("orderChangeset suits a store with immediate foreign keys", () => {
    // `iff(and(x, b1), b2)` gets a formula buffer around `and` from
    // normalization. Removing what `b1` and `b2` name empties `iff` and
    // collapses it, so normalization first promotes the buffer to root and
    // then removes it: its removed entry has no parent while its stored row
    // still points at `iff`, which is also removed.
    for (const call of ["removePremise", "removeVariable"] as const) {
        it(`${call}, when normalization moves an expression and then removes it`, () => {
            const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                behavior: "permissive",
            })
            const [p1, p2, p3] = [
                eng.createPremise().result,
                eng.createPremise().result,
                eng.createPremise().result,
            ]
            const vb = premiseBoundVariable(eng, p1)
            const vx = premiseBoundVariable(eng, p2)
            const base = {
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: p3.getId(),
            }
            p3.addExpression({
                ...base,
                id: "a-iff",
                type: "operator",
                operator: "iff",
                parentId: null,
                position: 0,
            })
            p3.addExpression({
                ...base,
                id: "m-and",
                type: "operator",
                operator: "and",
                parentId: "a-iff",
                position: 0,
            })
            p3.addExpression({
                ...base,
                id: "x",
                type: "variable",
                variableId: vx,
                parentId: "m-and",
                position: 0,
            })
            p3.addExpression({
                ...base,
                id: "b1",
                type: "variable",
                variableId: vb,
                parentId: "m-and",
                position: 1,
            })
            p3.addExpression({
                ...base,
                id: "b2",
                type: "variable",
                variableId: vb,
                parentId: "a-iff",
                position: 1,
            })
            eng.setBehavior("assistive")
            eng.normalize()

            expectAppliesStrictly(eng, () =>
                call === "removePremise"
                    ? eng.removePremise(p1.getId()).changes
                    : eng.removeVariable(vb).changes
            )
        })
    }

    // Composed across calls, a removed entry can name a variable that the
    // same changeset inserts: here `x` is pointed at a new premise's variable
    // and then removed.
    it("a composed changeset that points an expression at a new variable, then removes it", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const [p1, p2] = [
            eng.createPremise().result,
            eng.createPremise().result,
        ]
        const v1 = premiseBoundVariable(eng, p1)
        const base = {
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: p2.getId(),
            type: "variable" as const,
            variableId: v1,
            parentId: "and",
        }
        p2.addExpression({
            ...base,
            id: "and",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        p2.addExpression({ ...base, id: "x", position: 0 })
        p2.addExpression({ ...base, id: "y", position: 1 })
        p2.addExpression({ ...base, id: "z", position: 2 })

        expectAppliesStrictly(eng, () => {
            const created = eng.createPremise()
            const vNew = premiseBoundVariable(eng, created.result)
            const pointed = p2.updateExpression("x", { variableId: vNew })
            const removed = p2.removeExpression("x", true)
            return composeChangesets(
                composeChangesets(created.changes, pointed.changes),
                removed.changes
            )
        })
    })

    // Removing an operator detaches its children, and a child that was not
    // first becomes a root at a non-zero position unless the detach resets it.
    it("removeExpression of an operator whose second child goes with it", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const [p1, p2] = [
            eng.createPremise().result,
            eng.createPremise().result,
        ]
        const v1 = premiseBoundVariable(eng, p1)
        const base = {
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: p2.getId(),
        }
        p2.addExpression({
            ...base,
            id: "and",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        for (const id of ["x", "y"]) {
            p2.appendExpression("and", {
                ...base,
                id,
                type: "variable",
                variableId: v1,
                parentId: "and",
            })
        }

        expectAppliesStrictly(
            eng,
            () => p2.removeExpression("and", true).changes
        )
    })

    // An existing expression moved under an operator the same call inserts:
    // its update needs that insert first.
    for (const behavior of ["assistive", "permissive"] as const) {
        for (const call of [
            "wrapExpression",
            "insertExpression",
            "toggleNegation",
        ] as const) {
            it(`${call} in ${behavior} behavior moves an expression under a new operator`, () => {
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior,
                })
                const [p1, p2] = [
                    eng.createPremise().result,
                    eng.createPremise().result,
                ]
                const v1 = premiseBoundVariable(eng, p1)
                const base = {
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    premiseId: p2.getId(),
                    parentId: null,
                }
                p2.addExpression({
                    ...base,
                    id: "x",
                    type: "variable",
                    variableId: v1,
                    position: 0,
                })
                const operator = {
                    ...base,
                    id: "op",
                    type: "operator" as const,
                    operator: "and" as const,
                }
                expectAppliesStrictly(eng, () =>
                    call === "wrapExpression"
                        ? p2.wrapExpression(
                              operator,
                              {
                                  ...base,
                                  id: "y",
                                  type: "variable",
                                  variableId: v1,
                              },
                              "x"
                          ).changes
                        : call === "insertExpression"
                          ? p2.insertExpression(
                                { ...operator, operator: "not", position: 0 },
                                "x"
                            ).changes
                          : p2.toggleNegation("x").changes
                )
            })
        }
    }

    // Composed across calls, an expression can be pointed at a variable the
    // same changeset inserts, and the variable it pointed at before can be
    // removed by the same changeset.
    for (const removeOld of [false, true]) {
        it(`a composed changeset that points an expression at a new variable${removeOld ? ", removing the old one" : ""}`, () => {
            const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                behavior: "permissive",
            })
            const [p1, p2] = [
                eng.createPremise().result,
                eng.createPremise().result,
            ]
            const v1 = premiseBoundVariable(eng, p1)
            p2.addExpression({
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: p2.getId(),
                id: "x",
                type: "variable",
                variableId: v1,
                parentId: null,
                position: 0,
            })

            expectAppliesStrictly(eng, () => {
                const created = eng.createPremise()
                const vNew = premiseBoundVariable(eng, created.result)
                let changes = composeChangesets(
                    created.changes,
                    p2.updateExpression("x", { variableId: vNew }).changes
                )
                if (removeOld) {
                    changes = composeChangesets(
                        changes,
                        eng.removePremise(p1.getId()).changes
                    )
                }
                return changes
            })
        })
    }

    // One update with a new parent and a new variable, while the changeset
    // removes the variable it pointed at before: a cascading store loses the
    // row if that variable is deleted before the row is repointed.
    it("an expression moved under a new operator and onto a new variable, the old variable removed", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const [p1, p2] = [
            eng.createPremise().result,
            eng.createPremise().result,
        ]
        const v1 = premiseBoundVariable(eng, p1)
        const base = {
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: p2.getId(),
            parentId: null,
        }
        p2.addExpression({
            ...base,
            id: "x",
            type: "variable",
            variableId: v1,
            position: 0,
        })

        expectAppliesStrictly(eng, () => {
            const created = eng.createPremise()
            const vNew = premiseBoundVariable(eng, created.result)
            const wrapped = p2.wrapExpression(
                { ...base, id: "op", type: "operator", operator: "and" },
                { ...base, id: "y", type: "variable", variableId: vNew },
                "x"
            )
            const pointed = p2.updateExpression("x", { variableId: vNew })
            const removed = eng.removePremise(p1.getId())
            return [wrapped, pointed, removed].reduce(
                (all, next) => composeChangesets(all, next.changes),
                created.changes
            )
        })
    })

    // Late only because of its new parent, while the changeset removes the
    // variable the row named before and moves it onto one that exists: the
    // old variable's delete must not reach the row first.
    it("an expression moved under a new operator and off a removed variable onto an existing one", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const [p1, p2, p3] = [
            eng.createPremise().result,
            eng.createPremise().result,
            eng.createPremise().result,
        ]
        const v1 = premiseBoundVariable(eng, p1)
        const v3 = premiseBoundVariable(eng, p3)
        const base = {
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: p2.getId(),
            parentId: null,
        }
        p2.addExpression({
            ...base,
            id: "x",
            type: "variable",
            variableId: v1,
            position: 0,
        })

        expectAppliesStrictly(eng, () =>
            [
                p2.wrapExpression(
                    { ...base, id: "op", type: "operator", operator: "and" },
                    { ...base, id: "y", type: "variable", variableId: v3 },
                    "x"
                ),
                p2.updateExpression("x", { variableId: v3 }),
                eng.removePremise(p1.getId()),
            ].reduce<TCoreChangeset>(
                (all, next) => composeChangesets(all, next.changes),
                {}
            )
        )
    })

    // A variable rebound off a premise the changeset removes: the stored
    // row names that premise until its update runs, so the premise delete
    // must wait for it. Onto a new premise, the update must also follow that
    // premise's insert.
    for (const onto of ["an existing premise", "a new premise"] as const) {
        for (const hold of [false, true]) {
            it(`a variable rebound off a removed premise onto ${onto}${hold ? ", with deletes held" : ""}`, () => {
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior: "permissive",
                })
                const [p1, p2, p3] = [
                    eng.createPremise().result,
                    eng.createPremise().result,
                    eng.createPremise().result,
                ]
                const v1 = premiseBoundVariable(eng, p1)
                const base = {
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    premiseId: p3.getId(),
                    type: "variable" as const,
                    parentId: "and",
                }
                p3.addExpression({
                    ...base,
                    id: "and",
                    type: "operator",
                    operator: "and",
                    parentId: null,
                    position: 0,
                })
                p3.addExpression({
                    ...base,
                    id: "x",
                    variableId: v1,
                    position: 0,
                })
                p3.addExpression({
                    ...base,
                    id: "y",
                    variableId: premiseBoundVariable(eng, p2),
                    position: 1,
                })

                expectAppliesStrictly(eng, () => {
                    const created = eng.createPremise()
                    const target =
                        onto === "a new premise" ? created.result : p2
                    const steps = [
                        eng.updateVariable(v1, {
                            boundPremiseId: target.getId(),
                        }),
                        // Pointing an expression at a new variable holds
                        // the deletes until after the inserts.
                        ...(hold
                            ? [
                                  p3.updateExpression("y", {
                                      variableId: premiseBoundVariable(
                                          eng,
                                          created.result
                                      ),
                                  }),
                              ]
                            : []),
                        eng.removePremise(p1.getId()),
                    ]
                    return steps.reduce(
                        (all, next) => composeChangesets(all, next.changes),
                        created.changes
                    )
                })
            })
        }
    }

    // An expression removed from one premise and added with the same id to
    // a premise the changeset creates composes to one update naming the new
    // premise, which must follow that premise's insert.
    for (const shape of ["as a root", "under a new operator"] as const) {
        for (const removeOld of [false, true]) {
            it(`an expression id reused in a new premise ${shape}${removeOld ? ", its old premise removed" : ""}`, () => {
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior: "permissive",
                })
                const [p1, p2] = [
                    eng.createPremise().result,
                    eng.createPremise().result,
                ]
                const v1 = premiseBoundVariable(eng, p1)
                p2.addExpression({
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    premiseId: p2.getId(),
                    id: "x",
                    type: "variable",
                    variableId: v1,
                    parentId: null,
                    position: 0,
                })

                expectAppliesStrictly(eng, () => {
                    const created = eng.createPremise()
                    const pNew = created.result
                    const base = {
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: pNew.getId(),
                    }
                    const steps: { changes: TCoreChangeset }[] = [
                        p2.removeExpression("x", true),
                    ]
                    if (shape === "under a new operator") {
                        steps.push(
                            pNew.addExpression({
                                ...base,
                                id: "op",
                                type: "operator",
                                operator: "not",
                                parentId: null,
                                position: 0,
                            })
                        )
                    }
                    steps.push(
                        pNew.addExpression({
                            ...base,
                            id: "x",
                            type: "variable",
                            variableId: v1,
                            parentId: shape === "as a root" ? null : "op",
                            position: 0,
                        })
                    )
                    if (removeOld) steps.push(eng.removePremise(p2.getId()))
                    return steps.reduce<TCoreChangeset>(
                        (all, next) => composeChangesets(all, next.changes),
                        created.changes
                    )
                })
            })
        }
    }

    // Removing one premise and creating another needs no late update, so
    // the deletes still come before the inserts: holding them back would let
    // a reused symbol meet the one it replaces.
    it("deletes before inserts when a premise is replaced", () => {
        let n = 0
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
            generateId: () => `g${String(n++)}`,
        })
        const [p1] = [eng.createPremise().result, eng.createPremise().result]
        const changes = composeChangesets(
            eng.removePremise(p1.getId()).changes,
            eng.createPremise().changes
        )
        const kinds = orderChangeset(changes).map(
            (o) => `${o.type} ${o.entity}`
        )

        expect(kinds.indexOf("delete variable")).toBeLessThan(
            kinds.indexOf("insert premise")
        )
        expect(kinds.indexOf("delete premise")).toBeLessThan(
            kinds.indexOf("insert premise")
        )
    })

    // With no update that needs an insert first, the order is the one
    // orderChangeset has always produced.
    it("keeps the order of a changeset with no update that needs an insert", () => {
        let n = 0
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
            generateId: () => `g${String(n++)}`,
        })
        const [p1, p2] = [
            eng.createPremise().result,
            eng.createPremise().result,
        ]
        const v1 = premiseBoundVariable(eng, p1)
        const base = {
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: p2.getId(),
        }
        p2.addExpression({
            ...base,
            id: "and",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        for (const id of ["x", "y", "z"]) {
            p2.appendExpression("and", {
                ...base,
                id,
                type: "variable",
                variableId: v1,
                parentId: "and",
            })
        }
        const ops = orderChangeset(eng.removePremise(p1.getId()).changes)

        expect(
            ops.map(
                (o) =>
                    `${o.type} ${o.entity} ${(o.data as { id?: string }).id ?? ""}`
            )
        ).toEqual([
            "update premise g2",
            "update expression and",
            "update expression x",
            "update expression y",
            "update expression z",
            "delete expression z",
            "delete expression y",
            "delete expression x",
            "delete variable g1",
            "delete premise g0",
            "update roles ",
        ])
    })

    // A premise replaced, with and without its variable rebound. With no
    // variable update the order is the one orderChangeset has always
    // produced. A variable update runs between the variable and premise
    // deletes. One bound to the new premise follows that premise's insert,
    // and the premise delete waits for it, so for that moment the argument
    // holds both premises: a store allowing one conclusion per argument,
    // checked per statement, rejects a conclusion swap made in the same
    // changeset.
    for (const rebind of ["none", "existing", "new"] as const) {
        it(`orders a replaced premise with ${rebind === "none" ? "no variable rebound" : `its variable rebound onto the ${rebind} premise`}`, () => {
            let n = 0
            const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                behavior: "permissive",
                generateId: () => `g${String(n++)}`,
            })
            const [p1, p2] = [
                eng.createPremise().result,
                eng.createPremise().result,
            ]
            const created = eng.createPremise()
            const target = rebind === "new" ? created.result : p2
            const steps = [
                ...(rebind === "none"
                    ? []
                    : [
                          eng.updateVariable("g1", {
                              boundPremiseId: target.getId(),
                          }),
                      ]),
                eng.removePremise(p1.getId()),
            ]
            const changes = steps.reduce(
                (all, next) => composeChangesets(all, next.changes),
                created.changes
            )

            expect(
                orderChangeset(changes).map(
                    (o) =>
                        `${o.type} ${o.entity} ${(o.data as { id?: string }).id ?? ""}`
                )
            ).toEqual(
                {
                    none: [
                        "delete variable g1",
                        "delete premise g0",
                        "insert premise g4",
                        "insert variable g5",
                        "update roles ",
                    ],
                    existing: [
                        "update variable g1",
                        "delete premise g0",
                        "insert premise g4",
                        "insert variable g5",
                        "update roles ",
                    ],
                    new: [
                        "insert premise g4",
                        "update variable g1",
                        "delete premise g0",
                        "insert variable g5",
                        "update roles ",
                    ],
                }[rebind]
            )
        })
    }

    // Chains of mutations combined into one changeset, as a consumer's
    // before/after diff or composeChangesets produces them.
    for (const behavior of ["assistive", "permissive"] as const) {
        it(`random composed changesets in ${behavior} behavior`, () => {
            for (let seed = 1; seed <= 1000; seed++) {
                let state = seed
                const random = () => {
                    state = (state * 1103515245 + 12345) % 2147483648
                    return state / 2147483648
                }
                const pick = <T>(items: readonly T[]): T =>
                    items[Math.floor(random() * items.length)]
                let n = 0
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior,
                    generateId: () => `g${String(n++)}`,
                })
                for (let i = 0; i < 3; i++) eng.createPremise()
                const leafOf = (pe: PremiseEngine) => ({
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    premiseId: pe.getId(),
                    id: `e${String(n++)}`,
                    type: "variable" as const,
                    variableId: pick(
                        eng
                            .getVariables()
                            .filter(
                                (v) =>
                                    (v as { boundPremiseId?: string })
                                        .boundPremiseId !== pe.getId()
                            )
                    ).id,
                    parentId: null,
                })
                // A starting tree in each premise.
                for (const pe of eng.listPremises()) {
                    try {
                        pe.addExpression({ ...leafOf(pe), position: 0 })
                        for (let k = 0; k < 2; k++) {
                            const target = pick(pe.getExpressions()).id
                            pe.wrapExpression(
                                {
                                    argumentId: ARG.id,
                                    argumentVersion: ARG.version,
                                    premiseId: pe.getId(),
                                    id: `e${String(n++)}`,
                                    type: "operator",
                                    operator: pick(["and", "or"] as const),
                                    parentId: null,
                                },
                                leafOf(pe),
                                target
                            )
                        }
                    } catch {
                        // A tree the engine refuses is simply smaller.
                    }
                }
                const before = {
                    restrict: storeOf(eng),
                    cascade: storeOf(eng),
                }
                let changes: TCoreChangeset = {}
                const steps = 1 + Math.floor(random() * 4)
                for (let step = 0; step < steps; step++) {
                    const premises = eng.listPremises()
                    if (premises.length === 0) break
                    const pe = pick(premises)
                    const expressions = pe.getExpressions()
                    const target =
                        expressions.length > 0
                            ? pick(expressions).id
                            : "missing"
                    const variables = expressions.filter(
                        (e) => e.type === "variable"
                    )
                    const operator = {
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: pe.getId(),
                        id: `e${String(n++)}`,
                        type: "operator" as const,
                        operator: pick(["and", "or", "not"] as const),
                        parentId: null,
                    }
                    const call = pick([
                        "createPremise",
                        "updateExpression",
                        "wrapExpression",
                        "insertExpression",
                        "toggleNegation",
                        "removePremise",
                        "removeVariable",
                        "removeExpression",
                        "rebindVariable",
                        "renameVariable",
                        "moveToNewPremise",
                    ] as const)
                    const premiseBound = eng
                        .getVariables()
                        .filter((v) => "boundPremiseId" in v)
                    try {
                        if (call === "moveToNewPremise") {
                            // Remove a leaf and add one with the same id to
                            // a new premise: composed, one update naming it.
                            const leaf = pick(variables)
                            const removed = pe.removeExpression(leaf.id, false)
                            const created = eng.createPremise()
                            const added = created.result.addExpression({
                                ...leaf,
                                premiseId: created.result.getId(),
                                parentId: null,
                                position: 0,
                            })
                            changes = [removed, created, added].reduce(
                                (all, next) =>
                                    composeChangesets(all, next.changes),
                                changes
                            )
                            continue
                        }
                        const result =
                            call === "rebindVariable"
                                ? eng.updateVariable(pick(premiseBound).id, {
                                      boundPremiseId: pick(premises).getId(),
                                  })
                                : call === "renameVariable"
                                  ? eng.updateVariable(
                                        pick(eng.getVariables()).id,
                                        { symbol: `S${String(n++)}` }
                                    )
                                  : call === "createPremise"
                                    ? eng.createPremise()
                                    : call === "updateExpression"
                                      ? pe.updateExpression(
                                            variables.length > 0
                                                ? pick(variables).id
                                                : "missing",
                                            {
                                                variableId:
                                                    leafOf(pe).variableId,
                                            }
                                        )
                                      : call === "wrapExpression"
                                        ? pe.wrapExpression(
                                              operator,
                                              leafOf(pe),
                                              target
                                          )
                                        : call === "insertExpression"
                                          ? pe.insertExpression(
                                                { ...operator, position: 0 },
                                                target
                                            )
                                          : call === "toggleNegation"
                                            ? pe.toggleNegation(target)
                                            : call === "removePremise"
                                              ? eng.removePremise(
                                                    pick(premises).getId()
                                                )
                                              : call === "removeVariable"
                                                ? eng.removeVariable(
                                                      pick(eng.getVariables())
                                                          .id
                                                  )
                                                : pe.removeExpression(
                                                      target,
                                                      random() < 0.5
                                                  )
                        changes = composeChangesets(changes, result.changes)
                    } catch {
                        // A rejected step changes nothing.
                    }
                }
                const after = storeOf(eng)
                for (const deletes of ["restrict", "cascade"] as const) {
                    const store = before[deletes]
                    const label = `seed ${String(seed)}, ${deletes}`
                    expect(
                        applyStrictly(store, changes, deletes),
                        label
                    ).toEqual([])
                    expect(rows(store.expressions), label).toEqual(
                        rows(after.expressions)
                    )
                    expect(rows(store.variables), label).toEqual(
                        rows(after.variables)
                    )
                    expect(rows(store.premises), label).toEqual(
                        rows(after.premises)
                    )
                }
            }
        }, 60_000)
    }

    // Random trees over a few shared variables, then a removal that
    // cascades through them. Seeded, so a failure names a reproducible seed.
    for (const behavior of ["assistive", "permissive"] as const) {
        it(`random cascading removals in ${behavior} behavior`, () => {
            for (let seed = 1; seed <= 1000; seed++) {
                let state = seed
                const random = () => {
                    state = (state * 1103515245 + 12345) & 0x7fffffff
                    return state / 0x7fffffff
                }
                const pick = <T>(items: T[]): T =>
                    items[Math.floor(random() * items.length)]
                let n = 0
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior: "permissive",
                    generateId: () => `g${String(n++)}`,
                })
                const premises = Array.from(
                    { length: 5 },
                    () => eng.createPremise().result
                )
                const pool = [0, 1, 2].map((i) =>
                    premiseBoundVariable(eng, premises[i])
                )
                let k = 0
                for (const target of [premises[3], premises[4]]) {
                    const base = {
                        argumentId: ARG.id,
                        argumentVersion: ARG.version,
                        premiseId: target.getId(),
                    }
                    const build = (
                        parentId: string | null,
                        position: number,
                        depth: number,
                        parentType?: string
                    ): void => {
                        const id = `e${String(k++)}`
                        const roll = random()
                        if (depth >= 3 || roll < 0.35) {
                            target.addExpression({
                                ...base,
                                id,
                                type: "variable",
                                variableId: pick(pool),
                                parentId,
                                position,
                            })
                            return
                        }
                        if (roll < 0.5 && parentType !== "formula") {
                            target.addExpression({
                                ...base,
                                id,
                                type: "formula",
                                parentId,
                                position,
                            })
                            build(id, 0, depth + 1, "formula")
                            return
                        }
                        const operator = pick([
                            "and",
                            "or",
                            "not",
                            "implies",
                            "iff",
                        ] as const)
                        target.addExpression({
                            ...base,
                            id,
                            type: "operator",
                            operator,
                            parentId,
                            position,
                        })
                        const count =
                            operator === "not"
                                ? 1
                                : operator === "implies" || operator === "iff"
                                  ? 2
                                  : 2 + Math.floor(random() * 2)
                        for (let c = 0; c < count; c++) {
                            build(id, c, depth + 1, "operator")
                        }
                    }
                    try {
                        build(null, 0, 0)
                    } catch {
                        // A random tree the engine rejects is simply smaller.
                    }
                }
                eng.setBehavior(behavior)
                eng.normalize()
                const call = pick([
                    "removeVariable",
                    "removePremise",
                    "deleteExpressionsUsingVariable",
                ] as const)
                const index = Math.floor(random() * 3)
                const store = storeOf(eng)
                let changes: TCoreChangeset
                try {
                    changes =
                        call === "removePremise"
                            ? eng.removePremise(premises[index].getId()).changes
                            : call === "removeVariable"
                              ? eng.removeVariable(pool[index]).changes
                              : premises[4].deleteExpressionsUsingVariable(
                                    pool[index]
                                ).changes
                } catch {
                    continue
                }
                const errors = applyStrictly(store, changes)
                expect(errors, `seed ${String(seed)}, ${call}`).toEqual([])
                const after = storeOf(eng)
                expect(rows(store.expressions), `seed ${String(seed)}`).toEqual(
                    rows(after.expressions)
                )
            }
        })
    }
})
