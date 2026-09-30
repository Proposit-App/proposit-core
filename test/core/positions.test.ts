import { describe, expect, it } from "vitest"
import { ArgumentEngine, PremiseEngine } from "../../src/lib/index"
import { Value } from "typebox/value"
import {
    CorePropositionalExpressionSchema,
    type TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import { ExpressionManager } from "../../src/lib/core/expression-manager"
import {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    DEFAULT_POSITION_CONFIG,
    midpoint,
    type TCorePositionConfig,
} from "../../src/lib/utils/position"
import {
    ARG,
    aLib,
    makeOpExpr,
    VAR_P,
    VAR_Q,
    premiseWithVars,
} from "./fixtures"

describe("position utilities", () => {
    it("POSITION_INITIAL is 0", () => {
        expect(POSITION_INITIAL).toBe(0)
    })

    it("POSITION_MIN is -(2^31-1)", () => {
        expect(POSITION_MIN).toBe(-2147483647)
    })

    it("POSITION_MAX is 2^31-1", () => {
        expect(POSITION_MAX).toBe(2147483647)
    })

    it("midpoint computes average of two numbers", () => {
        expect(midpoint(0, 100)).toBe(50)
        expect(midpoint(10, 20)).toBe(15)
    })

    it("midpoint works with large numbers", () => {
        const a = POSITION_INITIAL
        const b = POSITION_MAX
        const m = midpoint(a, b)
        expect(m).toBeGreaterThan(a)
        expect(m).toBeLessThan(b)
    })

    it("midpoint of equal values returns that value", () => {
        expect(midpoint(50, 50)).toBe(50)
    })
})

describe("PremiseEngine — appendExpression and addExpressionRelative", () => {
    it("appendExpression assigns POSITION_INITIAL to first child", () => {
        const pm = premiseWithVars()
        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(POSITION_INITIAL)
    })

    it("appendExpression appends after last child", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[0].position).toBeLessThan(children[1].position)
    })

    it("addExpressionRelative before inserts before sibling", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "before", {
            id: "c0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c0")
        expect(children[1].id).toBe("c1")
    })

    it("addExpressionRelative after inserts after sibling", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-r",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(3)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[2].id).toBe("c3")
    })

    it("addExpressionRelative after last child appends", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[0].position).toBeLessThan(children[1].position)
    })

    it("addExpressionRelative throws if sibling not found", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpressionRelative("nonexistent", "before", {
                id: "c1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: "premise-1",
                type: "variable",
                variableId: "var-p",
                parentId: null,
            })
        ).toThrow(/not found/)
    })
})

describe("configurable position range", () => {
    it("DEFAULT_POSITION_CONFIG has signed int32 range", () => {
        expect(DEFAULT_POSITION_CONFIG).toEqual({
            min: -2147483647,
            max: 2147483647,
            initial: 0,
        })
    })

    it("POSITION_MIN is -(2^31-1)", () => {
        expect(POSITION_MIN).toBe(-2147483647)
    })

    it("POSITION_MAX is 2^31-1", () => {
        expect(POSITION_MAX).toBe(2147483647)
    })

    it("POSITION_INITIAL is 0", () => {
        expect(POSITION_INITIAL).toBe(0)
    })

    it("schema allows negative positions", () => {
        const expr = {
            id: "e1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            parentId: null,
            position: -100,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
            type: "variable" as const,
            variableId: "v1",
        }
        expect(Value.Check(CorePropositionalExpressionSchema, expr)).toBe(true)
    })

    it("ExpressionManager uses custom positionConfig in appendExpression", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const em = new ExpressionManager({ positionConfig: config })

        em.appendExpression(null, {
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = em.getExpression("root")!
        expect(root.position).toBe(200) // initial

        em.appendExpression("root", {
            id: "c1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: "root",
        })
        const c1 = em.getExpression("c1")!
        expect(c1.position).toBe(200) // first child gets initial

        em.appendExpression("root", {
            id: "c2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v2",
            parentId: "root",
        })
        const c2 = em.getExpression("c2")!
        expect(c2.position).toBe(midpoint(200, 300)) // midpoint(c1.pos, max)
    })

    it("ExpressionManager uses custom positionConfig in addExpressionRelative before", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const em = new ExpressionManager({ positionConfig: config })

        em.addExpression({
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 200,
        })
        em.appendExpression("root", {
            id: "c1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: "root",
        })

        em.addExpressionRelative("c1", "before", {
            id: "c0",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v2",
            parentId: "root",
        })
        const c0 = em.getExpression("c0")!
        expect(c0.position).toBe(midpoint(100, 200)) // midpoint(min, c1.pos)
    })

    it("PremiseEngine forwards positionConfig to ExpressionManager", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
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
        const pm = new PremiseEngine(
            {
                id: "p1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                type: "freeform" as const,
            } as unknown as TCorePremise,
            { argument: ARG, variables: vm },
            { positionConfig: config }
        )

        pm.appendExpression(null, {
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(200)
    })

    it("ArgumentEngine passes positionConfig to premises", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const eng = new ArgumentEngine(ARG, aLib(), {
            positionConfig: config,
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()

        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(200)

        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children[0].position).toBe(200)
        expect(children[1].position).toBe(midpoint(200, 300))
    })

    it("ArgumentEngine defaults work without positionConfig", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(POSITION_INITIAL)
    })
})
