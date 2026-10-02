import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import { type TClaimBoundVariable } from "../../src/lib/schemata"
import type { TExpressionWithoutPosition } from "../../src/lib/core/expression-manager"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import { computeHash, canonicalSerialize } from "../../src/lib/core/checksum"
import {
    ARG,
    aLib,
    makeVar,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
    premiseWithVars,
} from "./fixtures"

describe("hierarchical checksum schema", () => {
    it("expression entity includes descendantChecksum and combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        const expr = pm.getExpression("e1")!
        expect(expr).toBeDefined()
        expect(expr).toHaveProperty("checksum")
        expect(expr).toHaveProperty("descendantChecksum")
        expect(expr).toHaveProperty("combinedChecksum")
        // Leaf expression: descendantChecksum should be null
        expect(expr.descendantChecksum).toBeNull()
        // combinedChecksum should be a non-empty string
        expect(typeof expr.combinedChecksum).toBe("string")
        expect(expr.combinedChecksum.length).toBeGreaterThan(0)
    })

    it("premise entity includes descendantChecksum and combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        const premiseData = pm.toPremiseData()
        expect(premiseData).toHaveProperty("checksum")
        expect(premiseData).toHaveProperty("descendantChecksum")
        expect(premiseData).toHaveProperty("combinedChecksum")
        // descendantChecksum equals root expression's combinedChecksum
        expect(typeof premiseData.descendantChecksum).toBe("string")
        expect(typeof premiseData.combinedChecksum).toBe("string")
        expect(premiseData.combinedChecksum.length).toBeGreaterThan(0)
    })

    it("argument entity includes descendantChecksum and combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const arg = engine.getArgument()
        expect(arg).toHaveProperty("checksum")
        expect(arg).toHaveProperty("descendantChecksum")
        expect(arg).toHaveProperty("combinedChecksum")
        expect(typeof arg.combinedChecksum).toBe("string")
    })
})

describe("expression hierarchical checksums", () => {
    it("leaf expression has null descendantChecksum and combinedChecksum equals checksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        pm.flushChecksums()

        const expr = pm.getExpression("e1")!
        expect(expr.descendantChecksum).toBeNull()
        expect(expr.combinedChecksum).toBe(expr.checksum)
    })

    it("parent expression descendantChecksum reflects children", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        pm.flushChecksums()

        const parent = pm.getExpression("op-and")!
        const childP = pm.getExpression("e-p")!
        const childQ = pm.getExpression("e-q")!

        // Leaves should still have null descendantChecksum
        expect(childP.descendantChecksum).toBeNull()
        expect(childQ.descendantChecksum).toBeNull()

        // Parent should have non-null descendantChecksum
        expect(parent.descendantChecksum).not.toBeNull()

        // Parent combinedChecksum should differ from its meta checksum
        expect(parent.combinedChecksum).not.toBe(parent.checksum)

        // Verify exact descendantChecksum computation
        const expectedDescendant = computeHash(
            canonicalSerialize({
                [childP.id]: childP.combinedChecksum,
                [childQ.id]: childQ.combinedChecksum,
            })
        )
        expect(parent.descendantChecksum).toBe(expectedDescendant)

        // Verify exact combinedChecksum computation
        const expectedCombined = computeHash(
            parent.checksum + expectedDescendant
        )
        expect(parent.combinedChecksum).toBe(expectedCombined)
    })

    it("adding a child changes parent descendantChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        pm.flushChecksums()

        const beforeDescendant = pm.getExpression("op-and")!.descendantChecksum
        const beforeCombined = pm.getExpression("op-and")!.combinedChecksum

        // Add a second child
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        pm.flushChecksums()

        const afterDescendant = pm.getExpression("op-and")!.descendantChecksum
        const afterCombined = pm.getExpression("op-and")!.combinedChecksum

        expect(afterDescendant).not.toBe(beforeDescendant)
        expect(afterCombined).not.toBe(beforeCombined)
    })
})

describe("premise hierarchical checksums", () => {
    it("premise checksum is entity-only (meta)", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Capture checksum before adding any expression
        const checksumBefore = pm.checksum()

        // Add an expression — this should NOT change the meta checksum
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))
        const checksumAfter = pm.checksum()

        expect(checksumAfter).toBe(checksumBefore)
    })

    it("premise descendantChecksum is null when no expressions", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise()

        expect(pm.descendantChecksum()).toBeNull()
    })

    it("premise descendantChecksum equals root expression combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))

        pm.flushChecksums()

        const rootExpr = pm.getExpression("e1")!
        expect(pm.descendantChecksum()).toBe(rootExpr.combinedChecksum)
    })

    it("premise getCollectionChecksum('expressions') equals descendantChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))

        pm.flushChecksums()

        expect(pm.getCollectionChecksum("expressions")).toBe(
            pm.descendantChecksum()
        )
    })

    it("premise combinedChecksum changes when expression tree changes", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build initial tree: and(P)
        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        pm.flushChecksums()

        const metaBefore = pm.checksum()
        const combinedBefore = pm.combinedChecksum()

        // Add another child — this changes the expression tree
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        pm.flushChecksums()

        const metaAfter = pm.checksum()
        const combinedAfter = pm.combinedChecksum()

        // Meta (entity-only) checksum should be unchanged
        expect(metaAfter).toBe(metaBefore)

        // Combined checksum should have changed (descendants changed)
        expect(combinedAfter).not.toBe(combinedBefore)
    })
})

describe("argument hierarchical checksums", () => {
    it("argument checksum includes role state", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.createPremise()
        const { result: pm2 } = engine.createPremise()

        // First premise is auto-set as conclusion; capture current meta checksum
        const before = engine.checksum()

        // Switch conclusion to pm2 — meta checksum should change
        engine.setConclusionPremise(pm2.getId())
        const after = engine.checksum()

        expect(after).not.toBe(before)
    })

    it("argument descendantChecksum is null when no premises and no variables", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        expect(engine.descendantChecksum()).toBeNull()
    })

    it("argument getCollectionChecksum('premises') changes when premise expression changes", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build initial tree: and(P)
        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        engine.flushChecksums()
        const premisesBefore = engine.getCollectionChecksum("premises")
        expect(premisesBefore).not.toBeNull()

        // Add a second child to the operator — and(P, Q)
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const premisesAfter = engine.getCollectionChecksum("premises")

        expect(premisesAfter).not.toBe(premisesBefore)
    })

    it("argument getCollectionChecksum('variables') changes when variable is added", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })

        engine.flushChecksums()
        const varsBefore = engine.getCollectionChecksum("variables")
        expect(varsBefore).toBeNull()

        engine.addVariable(makeVar("v1", "P"))

        engine.flushChecksums()
        const varsAfter = engine.getCollectionChecksum("variables")
        expect(varsAfter).not.toBeNull()
        expect(varsAfter).not.toBe(varsBefore)
    })

    it("argument combinedChecksum changes when deep expression added but meta stays same", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        engine.flushChecksums()
        const metaBefore = engine.checksum()
        const combinedBefore = engine.combinedChecksum()

        // Add another expression to the premise (deep mutation)
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const metaAfter = engine.checksum()
        const combinedAfter = engine.combinedChecksum()

        // Meta (entity-only) should be unchanged — no argument entity or role change
        expect(metaAfter).toBe(metaBefore)

        // Combined should have changed — descendants changed
        expect(combinedAfter).not.toBe(combinedBefore)
    })

    it("snapshot includes all three checksum fields on argument", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(
            makeVarExpr("e1", "v1", {
                premiseId: pm.getId(),
                parentId: null,
            })
        )

        const snap = engine.snapshot()
        expect(snap.argument.checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(snap.argument.descendantChecksum).not.toBeNull()
        expect(snap.argument.combinedChecksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getArgument includes all three checksum fields", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(
            makeVarExpr("e1", "v1", {
                premiseId: pm.getId(),
                parentId: null,
            })
        )

        const arg = engine.getArgument()
        expect(arg.checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(arg.descendantChecksum).not.toBeNull()
        expect(arg.combinedChecksum).toMatch(/^[0-9a-f]{8}$/)
        expect(arg.combinedChecksum).not.toBe(arg.checksum)
    })

    it("premise mutation propagates dirty to argument checksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        engine.flushChecksums()
        const combinedBefore = engine.combinedChecksum()

        // Mutate expression within premise via PremiseEngine (triggers onMutate)
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))

        // The argument's checksumDirty flag should now be set via onMutate
        const combinedAfter = engine.combinedChecksum()
        expect(combinedAfter).not.toBe(combinedBefore)
    })

    it("descendantChecksum is computed from non-null collection checksums only", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })

        // No premises, no variables — descendant is null
        expect(engine.descendantChecksum()).toBeNull()
        expect(engine.combinedChecksum()).toBe(engine.checksum())

        // Add a premise — descendant becomes non-null (auto-creates a premise-bound variable too)
        engine.createPremise()
        engine.flushChecksums()
        expect(engine.descendantChecksum()).not.toBeNull()
        expect(engine.getCollectionChecksum("premises")).not.toBeNull()
        expect(engine.getCollectionChecksum("variables")).not.toBeNull() // auto-created variable

        // Verify descendant is based on both premises and variables collections
        const expectedDescendant = computeHash(
            canonicalSerialize({
                premises: engine.getCollectionChecksum("premises"),
                variables: engine.getCollectionChecksum("variables"),
            })
        )
        expect(engine.descendantChecksum()).toBe(expectedDescendant)
    })
})

describe("checksum verification on load", () => {
    const ARG = { id: "arg-1", version: 1 }

    function makeVariable(
        id: string,
        symbol: string
    ): TOptionalChecksum<TClaimBoundVariable> {
        return {
            id,
            symbol,
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        }
    }

    it("fromSnapshot with 'strict' passes when checksums match", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        engine.flushChecksums()
        const snap = engine.snapshot()

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).not.toThrow()
    })

    it("fromSnapshot with 'strict' throws when expression checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with expression checksum
        snap.premises[0].expressions.expressions[0].checksum = "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'ignore' (default) does not throw on tampered checksums", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with expression checksum
        snap.premises[0].expressions.expressions[0].checksum = "tampered!"

        // Default is "ignore" — should not throw
        expect(() => ArgumentEngine.fromSnapshot(snap, aLib())).not.toThrow()
    })

    it("fromSnapshot with 'strict' throws when premise checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with premise checksum
        ;(
            snap.premises[0].premise as Record<string, unknown>
        ).combinedChecksum = "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'strict' throws when argument checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with argument checksum
        ;(snap.argument as Record<string, unknown>).combinedChecksum =
            "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'strict' throws when variable checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with variable checksum
        ;(snap.variables.variables[0] as Record<string, unknown>).checksum =
            "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromData with 'strict' passes when checksums match", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Extract flat data from snapshot
        const argData = snap.argument
        const variables = snap.variables.variables
        const premises = [snap.premises[0].premise]
        const expressions = snap.premises[0].expressions.expressions

        expect(() =>
            ArgumentEngine.fromData(
                argData,
                aLib(),
                variables,
                premises,
                expressions,
                {},
                snap.config,
                "strict"
            )
        ).not.toThrow()
    })

    it("fromData with 'strict' throws when variable checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Extract flat data from snapshot
        const argData = snap.argument
        const variables = snap.variables.variables.map((v) => ({
            ...v,
            checksum: "tampered!",
        }))
        const premises = [snap.premises[0].premise]
        const expressions = snap.premises[0].expressions.expressions

        expect(() =>
            ArgumentEngine.fromData(
                argData,
                aLib(),
                variables,
                premises,
                expressions,
                {},
                snap.config,
                "strict"
            )
        ).toThrow(/checksum mismatch/i)
    })
})

// ---------------------------------------------------------------------------
// hierarchical checksum propagation (end-to-end)
// ---------------------------------------------------------------------------

describe("hierarchical checksum propagation", () => {
    it("deep expression change propagates to premise and argument", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        engine.addVariable(makeVar("v3", "R"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, formula(or(Q, placeholder)))
        // We need `or` to have 2 children to avoid collapse later, so add Q and a dummy
        // Actually, we need: and(P, formula(or(Q)))
        // and is root with 2 children: P (pos 0), formula (pos 1)
        // formula has 1 child: or
        // or has 1 child: Q
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeFormulaExpr("e-formula", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )
        pm.addExpression(
            makeOpExpr("e-or", "or", {
                parentId: "e-formula",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-or",
                position: 0,
                premiseId,
            })
        )

        // Flush and capture all combinedChecksums
        engine.flushChecksums()

        const orBefore = pm.getExpression("e-or")!.combinedChecksum
        const formulaBefore = pm.getExpression("e-formula")!.combinedChecksum
        const andBefore = pm.getExpression("e-and")!.combinedChecksum
        const premiseMetaBefore = pm.checksum()
        const premiseCombinedBefore = pm.combinedChecksum()
        const argMetaBefore = engine.checksum()
        const argCombinedBefore = engine.combinedChecksum()

        // Mutate: add R to the `or` node
        pm.addExpression(
            makeVarExpr("e-r", "v3", {
                parentId: "e-or",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()

        // `or` node's combinedChecksum changed (got a new child)
        expect(pm.getExpression("e-or")!.combinedChecksum).not.toBe(orBefore)
        // `formula` node's combinedChecksum changed (its child `or` changed)
        expect(pm.getExpression("e-formula")!.combinedChecksum).not.toBe(
            formulaBefore
        )
        // `and` root's combinedChecksum changed
        expect(pm.getExpression("e-and")!.combinedChecksum).not.toBe(andBefore)
        // Premise combinedChecksum changed
        expect(pm.combinedChecksum()).not.toBe(premiseCombinedBefore)
        // Argument combinedChecksum changed
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
        // But premise meta checksum is unchanged
        expect(pm.checksum()).toBe(premiseMetaBefore)
        // And argument meta checksum is unchanged
        expect(engine.checksum()).toBe(argMetaBefore)
    })

    // Operator collapse does not happen inside removeExpression — the
    // AN-3 post-hook does it, and that path's checksum-flush correctness is implicit in the
    // post-hook tests in `test/grammar/auto-normalize.test.ts` (the
    // post-hook runs through full PE mutation paths). Hierarchical
    // checksum flush correctness for ordinary removeExpression
    // without cascade is covered by neighboring tests in this
    // describe block.

    it("insertExpression propagates checksum changes", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const combinedBefore = engine.combinedChecksum()

        // Insert `not` wrapping variable P — `not` is exempt from the
        // operator-nesting restriction, so this is valid as a child of `and`.
        pm.insertExpression(makeOpExpr("e-not", "not", { premiseId }), "e-p")

        engine.flushChecksums()
        const combinedAfter = engine.combinedChecksum()

        expect(combinedAfter).not.toBe(combinedBefore)
    })

    it("variable mutation changes argument but not premise combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(
            makeVarExpr("e-p", "v1", { premiseId, parentId: null })
        )

        engine.flushChecksums()

        const argCombinedBefore = engine.combinedChecksum()
        const premiseCombinedBefore = pm.combinedChecksum()

        // Add a second variable (argument-scoped, not premise-scoped)
        engine.addVariable(makeVar("v2", "Q"))

        engine.flushChecksums()

        // Argument combinedChecksum changed (variables collection changed)
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
        // Premise combinedChecksum unchanged (variables are argument-scoped)
        expect(pm.combinedChecksum()).toBe(premiseCombinedBefore)
    })

    it("snapshot round-trip preserves all hierarchical checksums", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()

        // Capture all checksums from the original engine
        const origArgChecksum = engine.checksum()
        const origArgDescendant = engine.descendantChecksum()
        const origArgCombined = engine.combinedChecksum()
        const origPremiseChecksum = pm.checksum()
        const origPremiseDescendant = pm.descendantChecksum()
        const origPremiseCombined = pm.combinedChecksum()

        // Snapshot and restore
        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        restored.flushChecksums()

        // Verify all three checksum values match
        expect(restored.checksum()).toBe(origArgChecksum)
        expect(restored.descendantChecksum()).toBe(origArgDescendant)
        expect(restored.combinedChecksum()).toBe(origArgCombined)

        const restoredPm = restored.getPremise(premiseId)!
        expect(restoredPm.checksum()).toBe(origPremiseChecksum)
        expect(restoredPm.descendantChecksum()).toBe(origPremiseDescendant)
        expect(restoredPm.combinedChecksum()).toBe(origPremiseCombined)
    })

    it("removeVariable cascades through to checksums", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const argCombinedBefore = engine.combinedChecksum()

        // Remove variable Q — cascades: Q's variable expression is deleted,
        // `and` collapses (only P left), P is promoted to root
        engine.removeVariable("v2")

        // No errors during flush (deleted expressions properly pruned from dirty set)
        expect(() => engine.flushChecksums()).not.toThrow()

        // Argument combinedChecksum changed
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
    })
})

// ---------------------------------------------------------------------------
// changeset hierarchical checksums
// ---------------------------------------------------------------------------

describe("changeset hierarchical checksums", () => {
    it("wrapExpression changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()
        const premiseId = pm.getId()

        // Single root variable expression — wrapping it with "and" creates an operator with 2 children
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        // Wrap expr-p with an "and" operator plus a new sibling expr-q
        const { changes } = pm.wrapExpression(
            {
                id: "op-and",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "operator",
                operator: "and",
            } as TExpressionWithoutPosition,
            {
                id: "expr-q",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "variable",
                variableId: VAR_Q.id,
            } as TExpressionWithoutPosition,
            "expr-p"
        )

        // The new "and" operator should have correct hierarchical checksums
        const addedAnd = changes.expressions!.added.find(
            (e) => e.id === "op-and"
        )!
        expect(addedAnd).toBeDefined()
        // Before fix: descendantChecksum is null because attachChecksum always sets it null
        // After fix: descendantChecksum should reflect children (expr-p, expr-q)
        expect(addedAnd.descendantChecksum).not.toBeNull()
        expect(addedAnd.combinedChecksum).not.toBe(addedAnd.checksum)

        // Cross-check: flushed engine state should agree with changeset
        const flushedAnd = pm.getExpression("op-and")!
        expect(addedAnd.combinedChecksum).toBe(flushedAnd.combinedChecksum)
        expect(addedAnd.descendantChecksum).toBe(flushedAnd.descendantChecksum)
    })

    it("toggleNegation changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()

        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr, changes } = pm.toggleNegation("expr-p")

        // The new NOT operator should have correct hierarchical checksums
        expect(notExpr).not.toBeNull()
        const addedNot = changes.expressions!.added.find(
            (e) => e.id === notExpr!.id
        )!
        expect(addedNot).toBeDefined()
        expect(addedNot.descendantChecksum).not.toBeNull()
        expect(addedNot.combinedChecksum).not.toBe(addedNot.checksum)

        // Cross-check with flushed engine state
        const flushedNot = pm.getExpression(notExpr!.id)!
        expect(addedNot.combinedChecksum).toBe(flushedNot.combinedChecksum)
        expect(addedNot.descendantChecksum).toBe(flushedNot.descendantChecksum)
    })

    it("addExpression changeset has correct ancestor checksums", () => {
        const pm = premiseWithVars()

        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )

        // Adding a second child should update the parent's checksums in the changeset
        const { changes } = pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // The parent operator should be in modified with updated descendantChecksum
        const modifiedAnd = changes.expressions?.modified?.find(
            (e) => e.id === "op-and"
        )
        if (modifiedAnd) {
            const flushedAnd = pm.getExpression("op-and")!
            expect(modifiedAnd.combinedChecksum).toBe(
                flushedAnd.combinedChecksum
            )
            expect(modifiedAnd.descendantChecksum).toBe(
                flushedAnd.descendantChecksum
            )
        }

        // The added expression itself should match flushed state
        const addedQ = changes.expressions!.added.find(
            (e) => e.id === "expr-q"
        )!
        const flushedQ = pm.getExpression("expr-q")!
        expect(addedQ.combinedChecksum).toBe(flushedQ.combinedChecksum)
    })

    it("insertExpression changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()
        const premiseId = pm.getId()

        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        // Insert a NOT operator between root and expr-p
        const { changes } = pm.insertExpression(
            {
                id: "op-not",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "operator",
                operator: "not",
                parentId: null,
                position: POSITION_INITIAL,
            },
            "expr-p"
        )

        const addedNot = changes.expressions!.added.find(
            (e) => e.id === "op-not"
        )!
        expect(addedNot).toBeDefined()
        expect(addedNot.descendantChecksum).not.toBeNull()
        expect(addedNot.combinedChecksum).not.toBe(addedNot.checksum)

        // Cross-check with flushed engine state
        const flushedNot = pm.getExpression("op-not")!
        expect(addedNot.combinedChecksum).toBe(flushedNot.combinedChecksum)
        expect(addedNot.descendantChecksum).toBe(flushedNot.descendantChecksum)
    })

    it("removeExpression changeset has correct checksums after collapse", () => {
        const pm = premiseWithVars()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // Remove Q — and collapses, promoting P
        const { changes } = pm.removeExpression("expr-q", true)

        // P should be modified (promoted to root) — verify checksums match flushed state
        const modifiedP = changes.expressions?.modified?.find(
            (e) => e.id === "expr-p"
        )
        if (modifiedP) {
            const flushedP = pm.getExpression("expr-p")!
            expect(modifiedP.combinedChecksum).toBe(flushedP.combinedChecksum)
        }
    })

    it("updateExpression changeset has correct ancestor checksums", () => {
        const pm = premiseWithVars()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // Change "and" to "or" — this modifies the operator
        const { changes } = pm.updateExpression("op-and", { operator: "or" })

        const modifiedOr = changes.expressions?.modified?.find(
            (e) => e.id === "op-and"
        )
        if (modifiedOr) {
            const flushedOr = pm.getExpression("op-and")!
            expect(modifiedOr.combinedChecksum).toBe(flushedOr.combinedChecksum)
            expect(modifiedOr.descendantChecksum).toBe(
                flushedOr.descendantChecksum
            )
        }
    })
})

// ---------------------------------------------------------------------------
// premise checksum in changeset
// ---------------------------------------------------------------------------

describe("premise checksum in changeset", () => {
    it("addExpression changeset includes premise with updated checksum", () => {
        const pm = premiseWithVars()
        const premiseBefore = pm.toPremiseData()

        const { changes } = pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        expect(changes.premises?.modified).toHaveLength(1)
        const premiseInChangeset = changes.premises!.modified[0]
        expect(premiseInChangeset.id).toBe(pm.getId())
        // Premise checksum changed because it now has an expression
        expect(premiseInChangeset.combinedChecksum).not.toBe(
            premiseBefore.combinedChecksum
        )
        // The changeset premise matches the engine's current state
        expect(premiseInChangeset.combinedChecksum).toBe(pm.combinedChecksum())
        expect(premiseInChangeset.descendantChecksum).toBe(
            pm.descendantChecksum()
        )
    })

    it("removeExpression changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.removeExpression("expr-p", true)

        expect(changes.premises?.modified).toHaveLength(1)
        expect(changes.premises!.modified[0].combinedChecksum).toBe(
            pm.combinedChecksum()
        )
    })

    it("wrapExpression changeset includes premise update", () => {
        const pm = premiseWithVars()
        const premiseId = pm.getId()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.wrapExpression(
            {
                id: "op-and",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "operator",
                operator: "and",
            } as TExpressionWithoutPosition,
            {
                id: "expr-q",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "variable",
                variableId: VAR_Q.id,
            } as TExpressionWithoutPosition,
            "expr-p"
        )

        expect(changes.premises?.modified).toHaveLength(1)
    })

    it("toggleNegation changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.toggleNegation("expr-p")

        expect(changes.premises?.modified).toHaveLength(1)
        const premiseData = changes.premises!.modified[0]
        expect(premiseData.checksum).toBe(pm.checksum())
        expect(premiseData.descendantChecksum).toBe(pm.descendantChecksum())
        expect(premiseData.combinedChecksum).toBe(pm.combinedChecksum())
    })

    it("insertExpression changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.insertExpression(
            {
                id: "op-not",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: pm.getId(),
                type: "operator",
                operator: "not",
                parentId: null,
                position: POSITION_INITIAL,
            },
            "expr-p"
        )

        expect(changes.premises?.modified).toHaveLength(1)
        expect(changes.premises!.modified[0].combinedChecksum).toBe(
            pm.combinedChecksum()
        )
    })

    it("updateExpression with no effective change omits premise", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        // Flush checksums so the "before" snapshot is stable
        pm.flushChecksums()

        // updateExpression with no actual field changes
        const { changes } = pm.updateExpression("op-and", {})

        // If nothing changed, no premise entry
        expect(changes.premises?.modified ?? []).toHaveLength(0)
    })

    it("changeOperator changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { changes } = pm.changeOperator("op-and", "or")

        expect(changes.premises?.modified).toHaveLength(1)
        expect(changes.premises!.modified[0].combinedChecksum).toBe(
            pm.combinedChecksum()
        )
    })
})

describe("strict verification of an argument or premise with nothing beneath it", () => {
    it("reloads an argument with no premises", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(() =>
            ArgumentEngine.fromSnapshot(eng.snapshot(), aLib(), "strict")
        ).not.toThrow()
    })

    it("reloads a premise with no expressions", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.createPremise()
        expect(() =>
            ArgumentEngine.fromSnapshot(eng.snapshot(), aLib(), "strict")
        ).not.toThrow()
    })

    it("reloads both from data", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.createPremise()
        const snap = eng.snapshot()
        expect(() =>
            ArgumentEngine.fromData(
                eng.getArgument(),
                aLib(),
                eng.getVariables(),
                snap.premises.map((ps) => ps.premise),
                [],
                eng.getRoleState(),
                undefined,
                "strict"
            )
        ).not.toThrow()
    })

    it("still reports a stored checksum that disagrees", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const snap = eng.snapshot()
        snap.argument = { ...snap.argument, descendantChecksum: "wrong" }
        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/descendantChecksum/)
    })
})
