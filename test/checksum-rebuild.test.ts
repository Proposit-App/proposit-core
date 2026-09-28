// A consumer persists the checksums the live engine holds and, on the next
// load, rebuilds the engine from those rows, which recomputes every checksum.
// The two must agree after any sequence of public mutations, or the consumer
// reads its own rows back as stale. These tests replay seeded random
// sequences and compare the two after every step.

import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../src/lib/utils/lookup.js"
import { createChecksumConfig } from "../src/lib/consts.js"
import type { TArgumentEngineSnapshot } from "../src/lib/core/argument-engine.js"
import type { PremiseEngine } from "../src/lib/core/premise-engine.js"
import type { TCoreLogicalOperatorType } from "../src/lib/schemata/index.js"
import { makeArgument } from "./grammar/fixtures.js"

const ARG = makeArgument()

// Sized to keep the file within a few seconds.
const SEQUENCES_PER_BEHAVIOR = 300
const DEFAULT_CONFIG_SEQUENCES = 100
const STEPS_PER_SEQUENCE = 25

// Hashes app fields on expressions and variables, as a consumer's config
// does, so a field written without marking the entity dirty shows up.
const APP_FIELD_CONFIG = createChecksumConfig({
    expressionFields: new Set(["premiseId", "createdOn", "creatorId"]),
    variableFields: new Set(["claimId", "boundPremiseId", "creatorId"]),
})

type TEngine = ArgumentEngine
type TChecksums = Map<string, unknown[]>

function checksumsOf(snapshot: TArgumentEngineSnapshot): TChecksums {
    const out: TChecksums = new Map()
    for (const ps of snapshot.premises) {
        const p = ps.premise
        out.set(`premise ${p.id}`, [
            p.checksum,
            p.descendantChecksum,
            p.combinedChecksum,
        ])
        for (const e of ps.expressions.expressions) {
            out.set(`expression ${e.id}`, [
                e.checksum,
                e.descendantChecksum,
                e.combinedChecksum,
            ])
        }
    }
    for (const v of snapshot.variables.variables) {
        out.set(`variable ${v.id}`, [v.checksum])
    }
    return out
}

/**
 * Every checksum that differs between the live engine and its rebuild, or
 * why the rebuild failed: a state the live engine holds must load again.
 */
function mismatches(eng: TEngine): string[] {
    const snapshot = eng.snapshot()
    const live = checksumsOf(snapshot)
    let rebuilt: TChecksums
    try {
        rebuilt = checksumsOf(
            ArgumentEngine.fromSnapshot(
                JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
                EMPTY_CLAIM_LOOKUP,
                "ignore"
            ).snapshot()
        )
    } catch (error) {
        return [`rebuild failed: ${String(error)}`]
    }
    const out: string[] = []
    for (const [key, values] of live) {
        const other = rebuilt.get(key)
        if (JSON.stringify(values) !== JSON.stringify(other)) {
            out.push(
                `${key}: live ${JSON.stringify(values)}, rebuilt ${JSON.stringify(other)}`
            )
        }
    }
    for (const key of rebuilt.keys()) {
        if (!live.has(key)) out.push(`${key}: only in the rebuild`)
    }
    // The snapshot flushes first, so also compare what reads report now.
    for (const pe of eng.listPremises()) {
        for (const e of pe.getExpressions()) {
            const values = [
                e.checksum,
                e.descendantChecksum,
                e.combinedChecksum,
            ]
            const stored = live.get(`expression ${e.id}`)
            if (JSON.stringify(values) !== JSON.stringify(stored)) {
                out.push(`expression ${e.id}: read differs from snapshot`)
            }
        }
    }
    return out
}

/** Stamps missing app fields the supported way, as a consumer does. */
function stampAppFields(eng: TEngine, createdOn: string): void {
    for (const pe of eng.listPremises()) {
        for (const e of pe.getExpressions()) {
            const raw = e as unknown as Record<string, unknown>
            if (raw.creatorId == null) {
                eng.patchExpressionAppFields(e.id, {
                    creatorId: "u1",
                    createdOn,
                } as never)
            }
        }
    }
    for (const v of eng.getVariables()) {
        if ((v as unknown as Record<string, unknown>).creatorId == null) {
            eng.updateVariable(v.id, { creatorId: "u1" })
        }
    }
}

function randomOf(seed: number) {
    let state = seed
    const random = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
    }
    const pick = <T>(items: readonly T[]): T =>
        items[Math.floor(random() * items.length)]
    return { random, pick }
}

const OPERATORS: readonly TCoreLogicalOperatorType[] = [
    "and",
    "or",
    "not",
    "implies",
    "iff",
]

/** Builds one random step: its name, and a thunk that performs it. */
function randomStep(
    eng: TEngine,
    { random, pick }: ReturnType<typeof randomOf>,
    nextId: () => string
): [string, () => unknown] {
    const premises = eng.listPremises()
    if (premises.length === 0)
        return ["createPremise", () => eng.createPremise()]
    const pe: PremiseEngine = pick(premises)
    const base = {
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: pe.getId(),
    }
    const variables = eng.getVariables()
    const variableId = variables.length > 0 ? pick(variables).id : "missing"
    const expressions = pe.getExpressions()
    const target = expressions.length > 0 ? pick(expressions).id : "missing"
    const other = expressions.length > 0 ? pick(expressions).id : "missing"
    const leaf = () => ({
        ...base,
        id: nextId(),
        type: "variable" as const,
        variableId,
    })
    const steps: [string, () => unknown][] = [
        ["createPremise", () => eng.createPremise()],
        ["removePremise", () => eng.removePremise(pick(premises).getId())],
        [
            "addExpression as root",
            () =>
                pe.addExpression({
                    ...leaf(),
                    ...(random() < 0.5
                        ? {}
                        : {
                              type: "operator" as const,
                              operator: pick(OPERATORS),
                              variableId: undefined,
                          }),
                    parentId: null,
                    position: 0,
                } as never),
        ],
        [
            "appendExpression",
            () => pe.appendExpression(target, { ...leaf(), parentId: target }),
        ],
        [
            "addExpressionRelative",
            () =>
                pe.addExpressionRelative(
                    target,
                    random() < 0.5 ? "before" : "after",
                    { ...leaf(), parentId: null }
                ),
        ],
        [
            "insertExpression",
            () =>
                pe.insertExpression(
                    {
                        ...base,
                        id: nextId(),
                        type: "operator",
                        operator: pick(OPERATORS),
                        parentId: null,
                        position: 0,
                    } as never,
                    target
                ),
        ],
        [
            "wrapExpression",
            () =>
                pe.wrapExpression(
                    {
                        ...base,
                        id: nextId(),
                        type: "operator",
                        operator: pick(OPERATORS),
                        parentId: null,
                    } as never,
                    { ...leaf(), parentId: null },
                    random() < 0.5 ? target : undefined,
                    random() < 0.5 ? undefined : target
                ),
        ],
        ["updateExpression", () => pe.updateExpression(target, { variableId })],
        ["removeExpression", () => pe.removeExpression(target, random() < 0.5)],
        [
            "reparentExpression",
            () =>
                pe.reparentExpression(
                    target,
                    other,
                    Math.floor(random() * 3) * 1000
                ),
        ],
        ["wrapInFormula", () => pe.wrapInFormula(target, nextId())],
        ["toggleNegation", () => pe.toggleNegation(target)],
        ["changeOperator", () => pe.changeOperator(target, pick(OPERATORS))],
        [
            "deleteExpressionsUsingVariable",
            () => pe.deleteExpressionsUsingVariable(variableId),
        ],
        ["removeVariable", () => eng.removeVariable(variableId)],
        [
            "updateVariable",
            () =>
                eng.updateVariable(variableId, {
                    symbol: `S${String(Math.floor(random() * 1000))}`,
                }),
        ],
        ["setExtras", () => pe.setExtras({ title: `t${String(random())}` })],
        ["normalize", () => eng.normalize()],
        [
            "patchExpressionAppFields",
            () =>
                eng.patchExpressionAppFields(target, {
                    creatorId: `u${String(Math.floor(random() * 3))}`,
                } as never),
        ],
    ]
    // Building leaves weighs more, so trees grow before they are cut.
    const growth = steps.filter(([name]) =>
        /^(append|addExpressionRelative|wrapExpression|insert)/.test(name)
    )
    return random() < 0.35 ? pick(growth) : pick(steps)
}

function runSequence(
    seed: number,
    behavior: "assistive" | "permissive",
    config: typeof APP_FIELD_CONFIG | undefined
): void {
    const rng = randomOf(seed)
    let n = 0
    const nextId = () => `g${String(n++)}`
    const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
        behavior,
        generateId: nextId,
        ...(config ? { checksumConfig: config } : {}),
    })
    for (let i = 0; i < 3; i++) eng.createPremise()
    for (let step = 0; step < STEPS_PER_SEQUENCE; step++) {
        const [name, perform] = randomStep(eng, rng, nextId)
        try {
            perform()
        } catch {
            // Rejected: the check below still runs, since a rejected step
            // must leave the engine as it was.
        }
        if (config) stampAppFields(eng, `d${String(step)}`)
        const found = mismatches(eng)
        expect(
            found,
            `${behavior}, seed ${String(seed)}, step ${String(step)} (${name})`
        ).toEqual([])
    }
}

describe("live checksums equal the ones a rebuild from the snapshot computes", () => {
    it("detects an app field written onto a stored expression in place", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "assistive",
            checksumConfig: APP_FIELD_CONFIG,
        })
        const [p1, p2] = [
            eng.createPremise().result,
            eng.createPremise().result,
        ]
        const v = eng.getVariablesBoundToPremise(p1.getId())[0].id
        const base = {
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: p2.getId(),
            parentId: null,
        }
        p2.addExpression({
            ...base,
            id: "seed",
            type: "variable",
            variableId: v,
            position: 0,
        })
        p2.wrapExpression(
            { ...base, id: "imp", type: "operator", operator: "implies" },
            { ...base, id: "ant", type: "variable", variableId: v },
            undefined,
            "seed"
        )
        // Wrapping the antecedent under `implies` makes normalization insert
        // a formula buffer between the two operators.
        const { changes } = p2.wrapExpression(
            { ...base, id: "and", type: "operator", operator: "and" },
            { ...base, id: "b", type: "variable", variableId: v },
            "ant"
        )
        const buffer = changes.expressions?.added?.find(
            (e) => e.type === "formula"
        )
        expect(buffer).toBeDefined()
        expect(mismatches(eng)).toEqual([])

        // Writing onto the stored object skips the dirty mark.
        Object.assign(p2.getExpression(buffer!.id)!, { creatorId: "u1" })

        expect(mismatches(eng)).toContainEqual(
            expect.stringContaining(`expression ${buffer!.id}:`)
        )
    })

    for (const behavior of ["assistive", "permissive"] as const) {
        it(`random sequences in ${behavior} behavior, hashing app fields`, () => {
            for (let seed = 1; seed <= SEQUENCES_PER_BEHAVIOR; seed++) {
                runSequence(seed, behavior, APP_FIELD_CONFIG)
            }
        })
    }

    it("random sequences under the default checksum config", () => {
        for (let seed = 1; seed <= DEFAULT_CONFIG_SEQUENCES; seed++) {
            runSequence(
                seed,
                seed % 2 === 0 ? "assistive" : "permissive",
                undefined
            )
        }
    })
})
