// `orderChangeset` must order a changeset so that a store checking foreign
// keys immediately, with no cascading deletes, accepts every operation, and
// ends in the engine's state. The store also requires a row with no parent to
// sit at position 0, a rule a database checks on every statement. The store here starts from the rows as they
// were before the call, so an expression's stored parent can differ from the
// parent its removed entry carries: a change in the same call can move an
// expression before removing it.

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

/** Applies the ordered operations; returns every foreign-key violation. */
function applyStrictly(store: TStore, changes: TCoreChangeset): string[] {
    const errors: string[] = []
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
                for (const other of store.expressions.values()) {
                    if (other.parentId === row.id) {
                        errors.push(
                            `delete ${row.id} while ${other.id} points at it`
                        )
                    }
                }
                store.expressions.delete(row.id)
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
                for (const e of store.expressions.values()) {
                    if (e.variableId === row.id) {
                        errors.push(
                            `delete variable ${row.id} while ${e.id} uses it`
                        )
                    }
                }
                store.variables.delete(row.id)
            } else {
                store.variables.set(row.id, row)
            }
        } else if (op.entity === "premise") {
            if (op.type === "delete") {
                for (const e of store.expressions.values()) {
                    if (e.premiseId === row.id) {
                        errors.push(
                            `delete premise ${row.id} while ${e.id} is in it`
                        )
                    }
                }
                store.premises.delete(row.id)
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
    const store = storeOf(eng)
    const changes = mutate()
    expect(applyStrictly(store, changes)).toEqual([])
    const after = storeOf(eng)
    expect(rows(store.expressions)).toEqual(rows(after.expressions))
    expect(rows(store.premises)).toEqual(rows(after.premises))
    expect(rows(store.variables)).toEqual(rows(after.variables))
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
            })
        }

        expectAppliesStrictly(
            eng,
            () => p2.removeExpression("and", true).changes
        )
    })

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
