import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    PremiseEngine,
    ClaimLibrary,
} from "../../src/lib/index"
import {
    type TClaimBoundVariable,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import { ExpressionManager } from "../../src/lib/core/expression-manager"
import type { TExpressionInput } from "../../src/lib/core/expression-manager"
import { DEFAULT_CHECKSUM_CONFIG } from "../../src/lib/checksum-config"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { DEFAULT_POSITION_CONFIG } from "../../src/lib/utils/position"
import { ARG, aLib } from "./fixtures"

describe("ExpressionManager — snapshot and fromSnapshot", () => {
    it("round-trips an empty manager", () => {
        const em = new ExpressionManager()
        const snap = em.snapshot()
        expect(snap.expressions).toEqual([])
        expect(snap.config).toBeUndefined()

        const restored = ExpressionManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual([])
    })

    it("round-trips a manager with expressions", () => {
        const em = new ExpressionManager()
        em.addExpression({
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        em.addExpression({
            id: "c1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: "root",
            position: 0,
        })
        em.addExpression({
            id: "c2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v2",
            parentId: "root",
            position: 1,
        })

        const snap = em.snapshot()
        expect(snap.expressions).toHaveLength(3)

        const restored = ExpressionManager.fromSnapshot(snap)
        const originalArr = em.toArray()
        const restoredArr = restored.toArray()
        expect(restoredArr).toHaveLength(originalArr.length)
        for (let i = 0; i < originalArr.length; i++) {
            expect(restoredArr[i].id).toBe(originalArr[i].id)
            expect(restoredArr[i].parentId).toBe(originalArr[i].parentId)
            expect(restoredArr[i].position).toBe(originalArr[i].position)
        }

        // Verify tree structure
        const children = restored.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
    })

    it("preserves config in snapshot", () => {
        const config = {
            positionConfig: { min: 10, max: 90, initial: 50 },
        }
        const em = new ExpressionManager(config)
        const snap = em.snapshot()
        expect(snap.config).toEqual(config)

        const restored = ExpressionManager.fromSnapshot(snap)
        // Verify config is applied by checking position behavior
        restored.appendExpression(null, {
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: null,
        })
        const root = restored.getExpression("root")!
        expect(root.position).toBe(50) // custom initial
    })

    it("restored manager is functionally independent", () => {
        const em = new ExpressionManager()
        em.addExpression({
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
        })

        const snap = em.snapshot()
        const restored = ExpressionManager.fromSnapshot(snap)

        // Mutate restored — should not affect original
        restored.removeExpression("root", true)
        expect(restored.toArray()).toHaveLength(0)
        expect(em.toArray()).toHaveLength(1)
    })
})

describe("VariableManager — snapshot and fromSnapshot", () => {
    it("round-trips an empty manager", () => {
        const vm = new VariableManager()
        const snap = vm.snapshot()
        expect(snap.variables).toEqual([])
        expect(snap.config).toBeUndefined()

        const restored = VariableManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual([])
    })

    it("round-trips with variables", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            checksum: "x",
        })
        vm.addVariable({
            id: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "Q",
            checksum: "y",
        })

        const snap = vm.snapshot()
        expect(snap.variables).toHaveLength(2)

        const restored = VariableManager.fromSnapshot(snap)
        const restoredArr = restored.toArray()
        expect(restoredArr).toHaveLength(2)
        expect(restoredArr[0].symbol).toBe("P")
        expect(restoredArr[1].symbol).toBe("Q")
        expect(restored.hasVariable("v1")).toBe(true)
        expect(restored.hasVariable("v2")).toBe(true)
    })

    it("preserves config in snapshot", () => {
        const config = {
            positionConfig: { min: 10, max: 90, initial: 50 },
        }
        const vm = new VariableManager(config)
        const snap = vm.snapshot()
        expect(snap.config).toEqual(config)
    })

    it("restored manager is independent", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            checksum: "x",
        })

        const snap = vm.snapshot()
        const restored = VariableManager.fromSnapshot(snap)

        // Mutate restored — should not affect original
        restored.removeVariable("v1")
        expect(restored.hasVariable("v1")).toBe(false)
        expect(vm.hasVariable("v1")).toBe(true)
    })
})

describe("PremiseEngine — snapshot and fromSnapshot", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("round-trips an empty premise", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TCorePremise,
            { argument: ARG as TCoreArgument, variables: vm }
        )
        const snap = pe.snapshot()
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm
        )
        expect(restored.getId()).toBe("p1")
        expect(restored.getExpressions()).toEqual([])
    })

    it("round-trips a premise with expressions", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pe } = eng.createPremise()
        pe.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
        })
        const snap = pe.snapshot()
        // Create a fresh VariableManager with same variables for restore
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )
        expect(restored.getExpressions().length).toBe(1)
        expect(restored.toDisplayString()).toBe(pe.toDisplayString())
    })

    it("snapshot excludes variables and argument", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TCorePremise,
            { argument: ARG as TCoreArgument, variables: vm }
        )
        const snap = pe.snapshot()
        expect(snap).not.toHaveProperty("variables")
        expect(snap).not.toHaveProperty("argument")
        expect(snap).toHaveProperty("premise")
        expect(snap).toHaveProperty("expressions")
        expect(snap).toHaveProperty("config")
    })

    it("restored premise is independent from original", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
            position: 0,
        })
        pe.appendExpression("op1", {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: "op1",
        })
        const snap = pe.snapshot()
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )

        // Mutate restored — add a second child to the operator
        restored.appendExpression("op1", {
            id: "e2",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: restored.getId(),
            parentId: "op1",
        })
        expect(restored.getExpressions().length).toBe(3)
        expect(pe.getExpressions().length).toBe(2)
    })

    it("restores rootExpressionId correctly", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pe } = eng.createPremise()
        pe.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
        })
        const snap = pe.snapshot()
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )
        // The root expression ID should be preserved
        expect(restored.getRootExpressionId()).toBe("e1")
    })

    it("rebuilds expressionsByVariableId index on restore", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
            position: 0,
        })
        pe.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: "op1",
            position: 0,
        })
        pe.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: "op1",
            position: 1,
        })

        const snap = pe.snapshot()
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        vm2.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )

        // deleteExpressionsUsingVariable relies on the index; if the index
        // was not rebuilt this would be a no-op.
        const { result: removed } =
            restored.deleteExpressionsUsingVariable("v1")
        expect(removed.length).toBeGreaterThan(0)
    })
})

describe("ArgumentEngine — snapshot, fromSnapshot, and rollback", () => {
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

    it("round-trips an empty engine", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())
        expect(restored.getArgument().id).toBe("arg-1")
        expect(restored.listPremiseIds()).toEqual([])
        expect(restored.getVariables()).toEqual([])
        expect(restored.getRoleState()).toEqual({})
    })

    it("round-trips engine with premises and variables", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        engine.addVariable(makeVariable("v2", "Q"))
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

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        expect(restored.listPremiseIds()).toEqual(["p1"])
        expect(restored.getVariables()).toHaveLength(3) // 2 claim-bound + 1 auto premise-bound
        const restoredPm = restored.getPremise("p1")!
        expect(restoredPm.getExpressions()).toHaveLength(1)
        expect(restoredPm.getExpressions()[0].id).toBe("e1")
    })

    it("preserves conclusion role through round-trip", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.setConclusionPremise("p2")

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        expect(restored.getRoleState().conclusionPremiseId).toBe("p2")
    })

    it("snapshot includes config", () => {
        const config = {
            checksumConfig: DEFAULT_CHECKSUM_CONFIG,
            positionConfig: DEFAULT_POSITION_CONFIG,
        }
        const engine = new ArgumentEngine(ARG, aLib(), config)
        const snap = engine.snapshot()
        expect(snap.config).toBeDefined()
        expect(snap.config!.positionConfig).toEqual(DEFAULT_POSITION_CONFIG)
    })

    it("fromSnapshot produces independent copy", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        // Mutate restored, original should be unaffected
        restored.createPremiseWithId("p2")
        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(restored.listPremiseIds()).toEqual(["p1", "p2"])
    })

    it("rollback restores previous state", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()

        // Mutate the engine
        engine.addVariable(makeVariable("v2", "Q"))
        engine.createPremiseWithId("p2")

        expect(engine.listPremiseIds()).toEqual(["p1", "p2"])
        expect(engine.getVariables()).toHaveLength(4) // v1 + v2 + 2 auto premise-bound

        // Rollback
        engine.rollback(snap)

        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(engine.getVariables()).toHaveLength(2) // v1 + 1 auto premise-bound
        expect(engine.getVariables().find((v) => v.id === "v1")?.symbol).toBe(
            "P"
        )
    })

    it("rollback after multiple mutations restores correct state", () => {
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
        engine.setConclusionPremise("p1")

        const snap = engine.snapshot()

        // Multiple mutations
        engine.createPremiseWithId("p2")
        engine.addVariable(makeVariable("v2", "Q"))
        engine.setConclusionPremise("p2")
        engine.removeVariable("v1")

        // Rollback to original
        engine.rollback(snap)

        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(engine.getVariables()).toHaveLength(2) // v1 + 1 auto premise-bound
        expect(engine.getVariables().find((v) => v.id === "v1")).toBeDefined()
        expect(engine.getRoleState().conclusionPremiseId).toBe("p1")
        const restoredPm = engine.getPremise("p1")!
        expect(restoredPm.getExpressions()).toHaveLength(1)
        expect(restoredPm.getExpressions()[0].id).toBe("e1")
    })

    it("defaults restored engine behavior to 'assistive' when snapshot omits config.behavior", () => {
        // `snapshot()` intentionally omits `behavior` from the serialized
        // config (see `argument-engine.ts` snapshot()'s inline note: behavior
        // is re-supplied at restore time and defaults to 'assistive'). This
        // regression test locks the JSDoc-promised default-to-assistive
        // contract directly via `fromSnapshot`, independent of the
        // `forkArgumentEngine` / `PropositCore.forkArgument` paths that
        // explicitly thread `behavior` through.
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()

        // Sanity: snapshot() does not serialize `behavior` into config —
        // this is the precondition the default-to-assistive contract
        // protects against silent regression of.
        expect(
            (snap.config as Record<string, unknown> | undefined)?.behavior
        ).toBeUndefined()

        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        // The source engine was 'permissive'; the restored engine defaults
        // to 'assistive' because behavior is not carried in the snapshot.
        expect(engine.behavior).toBe("permissive")
        expect(restored.behavior).toBe("assistive")
    })
})

describe("ArgumentEngine — fromData bulk loading", () => {
    it("loads an engine from flat arrays", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            {
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
            {
                id: "v2",
                symbol: "Q",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
            {
                id: "p2",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
        ]
        const expressions = [
            {
                id: "e1",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
            {
                id: "e2",
                type: "variable" as const,
                variableId: "v2",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p2",
                parentId: null,
                position: 0,
            },
        ]
        const roles = { conclusionPremiseId: "p2" }
        const engine = ArgumentEngine.fromData(
            arg,
            aLib(),
            variables,
            premises,
            expressions,
            roles
        )
        expect(engine.getVariables().length).toBe(2)
        expect(engine.listPremiseIds()).toEqual(["p1", "p2"])
        expect(engine.getRoleState().conclusionPremiseId).toBe("p2")
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(1)
    })

    it("handles premises with no expressions", () => {
        const arg = { id: "arg-1", version: 1 }
        const engine = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                },
            ] as TOptionalChecksum<TCorePremise>[],
            [],
            {}
        )
        expect(engine.listPremiseIds()).toEqual(["p1"])
    })

    it("groups expressions by premiseId correctly", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            {
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
            {
                id: "p2",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
        ]
        const expressions = [
            {
                id: "e1",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
            {
                id: "e2",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p2",
                parentId: null,
                position: 0,
            },
        ]
        const engine = ArgumentEngine.fromData(
            arg,
            aLib(),
            variables,
            premises,
            expressions,
            {}
        )
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(1)
        expect(engine.getPremise("p2")?.getExpressions().length).toBe(1)
    })

    it("loads nested expressions in BFS order", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            {
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
            {
                id: "v2",
                symbol: "Q",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
        ]
        // Expressions out of order — child before parent
        const expressions = [
            {
                id: "e2",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e1",
                position: 0,
            },
            {
                id: "e3",
                type: "variable" as const,
                variableId: "v2",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e1",
                position: 1,
            },
            {
                id: "e1",
                type: "operator" as const,
                operator: "and" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
        ]
        const engine = ArgumentEngine.fromData(
            arg,
            aLib(),
            variables,
            premises,
            expressions,
            {}
        )
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(3)
    })

    it("infers generic types from parameters", () => {
        type TMyArg = TCoreArgument & { customField: string }
        const arg: TMyArg = {
            id: "arg-1",
            version: 1,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
            customField: "hello",
        }
        const engine = ArgumentEngine.fromData<TMyArg>(
            arg,
            aLib(),
            [],
            [],
            [],
            {}
        )
        const result = engine.getArgument()
        expect(result.customField).toBe("hello")
    })
})

// ---------------------------------------------------------------------------
// fromData premise-extras preservation
//
// Regression coverage for the typed-bag misinterpretation: when a DB row
// carries `type: "freeform"` (or `"derivation"`) plus sibling extras, the
// restore path used to send the row through parsePremiseArgsInternal, which
// classified it as a typed-bag and silently dropped every property other than
// type/derivedClaimId/extras/symbol. The restore path must instead preserve
// all sibling properties on the premise as extras.
// ---------------------------------------------------------------------------

describe("ArgumentEngine.fromData — premise extras preservation", () => {
    it("preserves DB-shape sibling properties as extras", () => {
        const arg = { id: "arg-1", version: 1 }
        const createdOn = new Date("2026-01-01T00:00:00Z")
        const premises = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
                title: "Some premise title",
                role: "supporting",
                createdOn,
                creatorId: "u1",
            },
        ] as unknown as TOptionalChecksum<TCorePremise>[]
        const engine = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            premises,
            [],
            {}
        )
        const restored = engine.getPremise("p1")!.toPremiseData() as Record<
            string,
            unknown
        >
        expect(restored.title).toBe("Some premise title")
        expect(restored.role).toBe("supporting")
        expect(restored.createdOn).toEqual(createdOn)
        expect(restored.creatorId).toBe("u1")
        expect(restored.type).toBe("freeform")
    })

    it("round-trips extras through createPremise → snapshot → fromData", () => {
        const claimLib = aLib()
        const engine = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise({
            type: "freeform",
            extras: { title: "X", role: "supporting" },
        })
        const premiseId = pm.toPremiseData().id

        const snapshot = engine.snapshot()
        const variables = snapshot.variables.variables
        const premises = snapshot.premises.map((ps) => ps.premise)
        const expressions: TExpressionInput<TCorePropositionalExpression>[] = []
        for (const ps of snapshot.premises) {
            for (const e of ps.expressions.expressions) {
                expressions.push({
                    ...(e as unknown as Record<string, unknown>),
                    premiseId: ps.premise.id,
                } as unknown as TExpressionInput<TCorePropositionalExpression>)
            }
        }

        const restoredEngine = ArgumentEngine.fromData(
            snapshot.argument,
            claimLib,
            variables,
            premises,
            expressions,
            { conclusionPremiseId: snapshot.conclusionPremiseId }
        )
        const restoredData = restoredEngine
            .getPremise(premiseId)!
            .toPremiseData() as Record<string, unknown>
        expect(restoredData.title).toBe("X")
        expect(restoredData.role).toBe("supporting")
    })

    it("createPremise typed-bag still treats `extras` as the extras source (no regression)", () => {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise({
            type: "derivation",
            derivedClaimId: claim.id,
            extras: { title: "Y" },
        })
        const data = pm.toPremiseData() as Record<string, unknown>
        expect(data.title).toBe("Y")
        expect(data.type).toBe("derivation")
        expect(data.derivedClaimId).toBe(claim.id)
    })

    it("premise checksum is identical with or without sibling extras (extras excluded from hash)", () => {
        const arg = { id: "arg-1", version: 1 }
        const bare = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    type: "freeform" as const,
                },
            ] as TOptionalChecksum<TCorePremise>[],
            [],
            {}
        )
        const withExtras = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    type: "freeform" as const,
                    title: "X",
                    role: "supporting",
                    createdOn: new Date("2026-01-01T00:00:00Z"),
                    creatorId: "u1",
                },
            ] as unknown as TOptionalChecksum<TCorePremise>[],
            [],
            {}
        )
        expect(bare.getPremise("p1")!.checksum()).toBe(
            withExtras.getPremise("p1")!.checksum()
        )
    })
})
