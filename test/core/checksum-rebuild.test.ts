// A consumer persists the checksums the live engine holds and, on the next
// load, rebuilds the engine from those rows, which recomputes every checksum.
// The two must agree after any sequence of public mutations, or the consumer
// reads its own rows back as stale. These tests replay seeded random
// sequences and compare the two after every step.

import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import { createChecksumConfig } from "../../src/lib/checksum-config.js"
import type { TArgumentEngineSnapshot } from "../../src/lib/core/argument-engine.js"
import type { PremiseEngine } from "../../src/lib/core/premise-engine.js"
import type { TCoreLogicalOperatorType } from "../../src/lib/schemata/index.js"
import { makeArgument } from "../grammar/fixtures.js"

const ARG = makeArgument()

// Sized to keep the file within a few seconds; the timeout only stops a
// hang on a slow runner.
const SEQUENCES_PER_BEHAVIOR = 150
const DEFAULT_CONFIG_SEQUENCES = 60
const STEPS_PER_SEQUENCE = 25
const CLAIM_VARIABLES = 4
const TIMEOUT_MS = 60_000

// Hashes app fields on expressions and variables, as a consumer's config
// does, so a field written without marking the entity dirty shows up.
const APP_FIELD_CONFIG = createChecksumConfig({
    expressionFields: new Set(["premiseId", "createdOn", "creatorId"]),
    variableFields: new Set(["claimId", "boundPremiseId", "creatorId"]),
})

type TEngine = ArgumentEngine
type TLookup = typeof EMPTY_CLAIM_LOOKUP | ClaimLibrary
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
function mismatches(eng: TEngine, lookup: TLookup): string[] {
    const snapshot = eng.snapshot()
    const live = checksumsOf(snapshot)
    let rebuilt: TChecksums
    try {
        rebuilt = checksumsOf(
            ArgumentEngine.fromSnapshot(
                JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
                lookup,
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

type TRng = ReturnType<typeof randomOf>

/**
 * Builds one random step: its name, and a thunk that performs it. Targets
 * are chosen to suit each step (an operator for `changeOperator`, a variable
 * expression for `updateExpression`), and leaves mostly name claim-bound
 * variables, which no premise can bind circularly, so that most steps are
 * accepted and trees grow.
 */
function randomStep(
    eng: TEngine,
    { random, pick }: TRng,
    nextId: () => string
): [string, () => unknown] {
    const premises = eng.listPremises()
    if (premises.length === 0) {
        return ["createPremise", () => eng.createPremise()]
    }
    const populated = premises.filter((p) => p.getExpressions().length > 0)
    const pe: PremiseEngine =
        populated.length > 0 && random() < 0.8
            ? pick(populated)
            : pick(premises)
    const base = {
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: pe.getId(),
    }
    const variables = eng.getVariables()
    const claimBound = variables.filter(
        (v) => (v as unknown as Record<string, unknown>).claimId !== undefined
    )
    const anyVariable = () =>
        variables.length > 0 ? pick(variables).id : "missing"
    const leafVariable = () =>
        claimBound.length > 0 && random() < 0.85
            ? pick(claimBound).id
            : anyVariable()
    const expressions = pe.getExpressions()
    const ofType = (type: string) => {
        const matching = expressions.filter((e) => e.type === type)
        return matching.length > 0 ? pick(matching).id : "missing"
    }
    const target = expressions.length > 0 ? pick(expressions).id : "missing"
    const container = () => {
        const parents = expressions.filter((e) => e.type !== "variable")
        return parents.length > 0 ? pick(parents).id : "missing"
    }
    const leaf = () => ({
        ...base,
        id: nextId(),
        type: "variable" as const,
        variableId: leafVariable(),
    })
    const operator = () => ({
        ...base,
        id: nextId(),
        type: "operator" as const,
        operator: pick(OPERATORS),
        parentId: null,
    })

    const growth: [string, () => unknown][] = [
        [
            "addExpression as root",
            () =>
                pe.addExpression(
                    random() < 0.5
                        ? { ...leaf(), parentId: null, position: 0 }
                        : ({ ...operator(), position: 0 } as never)
                ),
        ],
        [
            "appendExpression",
            () => {
                const parentId = container()
                return pe.appendExpression(parentId, { ...leaf(), parentId })
            },
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
                    { ...operator(), position: 0 } as never,
                    target
                ),
        ],
        [
            "wrapExpression",
            () =>
                random() < 0.5
                    ? pe.wrapExpression(
                          operator() as never,
                          {
                              ...leaf(),
                              parentId: null,
                          },
                          target
                      )
                    : pe.wrapExpression(
                          operator() as never,
                          { ...leaf(), parentId: null },
                          undefined,
                          target
                      ),
        ],
    ]
    const edits: [string, () => unknown][] = [
        [
            "updateExpression",
            () =>
                pe.updateExpression(ofType("variable"), {
                    variableId: leafVariable(),
                }),
        ],
        ["removeExpression", () => pe.removeExpression(target, random() < 0.5)],
        [
            "reparentExpression",
            () =>
                pe.reparentExpression(
                    target,
                    container(),
                    Math.floor(random() * 2 ** 31)
                ),
        ],
        ["wrapInFormula", () => pe.wrapInFormula(target, nextId())],
        ["toggleNegation", () => pe.toggleNegation(target)],
        [
            "changeOperator",
            () => pe.changeOperator(ofType("operator"), pick(OPERATORS)),
        ],
        [
            "patchExpressionAppFields",
            () =>
                eng.patchExpressionAppFields(target, {
                    creatorId: `u${String(Math.floor(random() * 3))}`,
                } as never),
        ],
        ["normalize", () => eng.normalize()],
    ]
    const other: [string, () => unknown][] = [
        ["createPremise", () => eng.createPremise()],
        ["removePremise", () => eng.removePremise(pick(premises).getId())],
        [
            "deleteExpressionsUsingVariable",
            () => pe.deleteExpressionsUsingVariable(anyVariable()),
        ],
        ["removeVariable", () => eng.removeVariable(anyVariable())],
        [
            "updateVariable",
            () =>
                eng.updateVariable(anyVariable(), {
                    symbol: `S${String(Math.floor(random() * 1000))}`,
                }),
        ],
        ["setExtras", () => pe.setExtras({ title: `t${String(random())}` })],
    ]
    const roll = random()
    return pick(roll < 0.45 ? growth : roll < 0.85 ? edits : other)
}

function runSequence(
    seed: number,
    behavior: "assistive" | "permissive",
    config: typeof APP_FIELD_CONFIG | undefined
): void {
    const rng = randomOf(seed)
    let n = 0
    const nextId = () => `g${String(n++)}`
    const lookup = new ClaimLibrary()
    const eng = new ArgumentEngine(ARG, lookup, {
        behavior,
        generateId: nextId,
        ...(config ? { checksumConfig: config } : {}),
    })
    for (let i = 0; i < CLAIM_VARIABLES; i++) {
        lookup.create({ id: `c${String(i)}`, type: "normal" })
        eng.addVariable({
            id: `v${String(i)}`,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: `V${String(i)}`,
            claimId: `c${String(i)}`,
            claimVersion: 0,
        })
    }
    for (let i = 0; i < 3; i++) eng.createPremise()
    const label = (step: number, name: string, stage: string) =>
        `${behavior}, seed ${String(seed)}, step ${String(step)} (${name}), ${stage}`
    for (let step = 0; step < STEPS_PER_SEQUENCE; step++) {
        const [name, perform] = randomStep(eng, rng, nextId)
        try {
            perform()
        } catch {
            // Rejected: the checks below still run, since a rejected step
            // must leave the engine as it was.
        }
        // Checked before stamping as well: stamping marks each stamped
        // expression and its ancestors dirty, which would hide a mutation
        // that forgot to.
        expect(
            mismatches(eng, lookup),
            label(step, name, "after the step")
        ).toEqual([])
        if (config) {
            stampAppFields(eng, `d${String(step)}`)
            expect(
                mismatches(eng, lookup),
                label(step, name, "after stamping")
            ).toEqual([])
        }
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
        expect(mismatches(eng, EMPTY_CLAIM_LOOKUP)).toEqual([])

        // Writing onto the stored object skips the dirty mark.
        Object.assign(p2.getExpression(buffer!.id)!, { creatorId: "u1" })

        expect(mismatches(eng, EMPTY_CLAIM_LOOKUP)).toContainEqual(
            expect.stringContaining(`expression ${buffer!.id}:`)
        )
    })

    for (const behavior of ["assistive", "permissive"] as const) {
        it(
            `random sequences in ${behavior} behavior, hashing app fields`,
            () => {
                for (let seed = 1; seed <= SEQUENCES_PER_BEHAVIOR; seed++) {
                    runSequence(seed, behavior, APP_FIELD_CONFIG)
                }
            },
            TIMEOUT_MS
        )
    }

    it(
        "random sequences under the default checksum config",
        () => {
            for (let seed = 1; seed <= DEFAULT_CONFIG_SEQUENCES; seed++) {
                runSequence(
                    seed,
                    seed % 2 === 0 ? "assistive" : "permissive",
                    undefined
                )
            }
        },
        TIMEOUT_MS
    )
})
