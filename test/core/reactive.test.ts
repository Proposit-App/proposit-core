import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import type { TReactiveSnapshot } from "../../src/lib/index"
import type { TExpressionWithoutPosition } from "../../src/lib/core/expression-manager"
import { ARG, aLib, makeOpExpr, VAR_P, VAR_Q } from "./fixtures"

// ---------------------------------------------------------------------------
// PremiseEngine onMutate callback
// ---------------------------------------------------------------------------

describe("PremiseEngine onMutate callback", () => {
    it("fires onMutate when addExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.addExpression(
            makeOpExpr("op-1", "and", { premiseId: premise.getId() })
        )
        expect(callCount).toBe(1)
    })

    it("fires onMutate when removeExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        premise.addExpression(
            makeOpExpr("op-1", "and", { premiseId: premise.getId() })
        )
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.removeExpression("op-1", true)
        expect(callCount).toBe(1)
    })

    it("fires onMutate when updateExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        premise.addExpression(
            makeOpExpr("op-1", "and", { premiseId: premise.getId() })
        )
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.updateExpression("op-1", { operator: "or" })
        expect(callCount).toBe(1)
    })

    it("fires onMutate when appendExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.appendExpression(null, {
            id: "op-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            type: "operator",
            operator: "and",
        } as TExpressionWithoutPosition)
        expect(callCount).toBe(1)
    })

    it("fires onMutate when insertExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: premise } = engine.createPremise()
        const pid = premise.getId()
        // Build: root "and" with two variable children
        premise.addExpression(makeOpExpr("op-root", "and", { premiseId: pid }))
        premise.appendExpression("op-root", {
            id: "var-p",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pid,
            type: "variable",
            variableId: VAR_P.id,
        } as TExpressionWithoutPosition)
        premise.appendExpression("op-root", {
            id: "var-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pid,
            type: "variable",
            variableId: VAR_Q.id,
        } as TExpressionWithoutPosition)
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        // Insert a "not" wrapping var-p — not is exempt from the nesting restriction
        premise.insertExpression(
            makeOpExpr("op-not", "not", { premiseId: pid }),
            "var-p"
        )
        expect(callCount).toBe(1)
    })

    it("does not fire onMutate when deleteExpressionsUsingVariable finds nothing", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.deleteExpressionsUsingVariable("nonexistent")
        expect(callCount).toBe(0)
    })
})

describe("ArgumentEngine subscribe", () => {
    it("notifies subscriber when a premise is created", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.createPremise()
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a premise is removed", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: premise } = engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removePremise(premise.getId())
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is added", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is updated", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.updateVariable("v1", { symbol: "Q" })
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is removed", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removeVariable("v1")
        expect(notified).toBe(true)
    })

    it("notifies subscriber when conclusion is set", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: premise } = engine.createPremise()
        engine.clearConclusionPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.setConclusionPremise(premise.getId())
        expect(notified).toBe(true)
    })

    it("notifies subscriber when conclusion is cleared on an empty argument", () => {
        // Under the invariant guard `clearConclusionPremise` is a
        // no-op on a non-empty argument and therefore does NOT notify.
        // The notification path is only exercised on the zero-premise
        // branch (or when transitioning the conclusion from set →
        // undefined via the only legitimate route, draining all
        // premises — but `removePremise` already drives its own
        // notification). Use a setConclusionPremise → removePremise →
        // clearConclusionPremise sequence so the final clear actually
        // transitions state (rolesa stay as-is because removePremise
        // already cleared them, so clear is also redundant). We
        // instead use the "set then clear on zero premises" shape
        // via a brand-new engine where conclusionPremiseId stays
        // undefined throughout — then we verify the subscriber path
        // still fires on the role-state mutation.
        //
        // The contract is: `clearConclusionPremise`
        // notifies only when it actually transitions state. The
        // simplest reproducer is to call it on a zero-premise engine
        // whose conclusionPremiseId happens to be set (only reachable
        // via fromSnapshot, but we can simulate by setting then
        // removing in sequence and observing the subscriber on the
        // intentional clear).
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise()
        engine.setConclusionPremise(pm.getId())
        engine.removePremise(pm.getId()) // drains + clears conclusion
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        // Zero premises now. clearConclusionPremise on the zero-premise
        // branch still emits a roles changeset when conclusionPremiseId
        // is undefined → undefined, which counts as a markDirty mutation
        // for notification purposes.
        engine.clearConclusionPremise()
        expect(notified).toBe(true)
    })

    it("does NOT notify subscriber when clearConclusionPremise is guarded out on a non-empty argument", () => {
        // The complement of the previous test: when the invariant
        // guard refuses to clear, no state changes — subscribers
        // must not be notified for a no-op.
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise()
        engine.setConclusionPremise(pm.getId())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.clearConclusionPremise()
        expect(notified).toBe(false)
    })

    it("notifies subscriber on rollback", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const snap = engine.snapshot()
        engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.rollback(snap)
        expect(notified).toBe(true)
    })

    it("unsubscribe stops notifications", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        let count = 0
        const unsub = engine.subscribe(() => {
            count++
        })
        engine.createPremise()
        expect(count).toBe(1)
        unsub()
        engine.createPremise()
        expect(count).toBe(1)
    })

    it("notifies subscriber when expression is mutated through PremiseEngine", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: premise } = engine.createPremise()
        let count = 0
        engine.subscribe(() => {
            count++
        })

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        expect(count).toBeGreaterThanOrEqual(1)
    })

    it("does not notify when removePremise finds nothing", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removePremise("nonexistent")
        expect(notified).toBe(false)
    })

    it("does not notify when removeVariable finds nothing", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removeVariable("nonexistent")
        expect(notified).toBe(false)
    })
})

describe("ArgumentEngine getSnapshot", () => {
    it("returns a snapshot with argument, variables, premises, and roles", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        const { result: premise } = engine.createPremise()
        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const snap = engine.getSnapshot()

        expect(snap.argument.id).toBe(ARG.id)
        expect(snap.variables.v1).toBeDefined()
        expect(snap.variables.v1.symbol).toBe("P")
        expect(snap.premises[premise.getId()]).toBeDefined()
        expect(
            snap.premises[premise.getId()].expressions["expr-1"]
        ).toBeDefined()
        expect(snap.premises[premise.getId()].rootExpressionId).toBe("expr-1")
        expect(snap.roles).toBeDefined()
    })

    it("returns the same reference when nothing has changed", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.createPremise()
        const snap1 = engine.getSnapshot()
        const snap2 = engine.getSnapshot()
        expect(snap1).toBe(snap2)
    })

    it("returns a new top-level reference after a mutation", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const snap1 = engine.getSnapshot()
        engine.createPremise()
        const snap2 = engine.getSnapshot()
        expect(snap1).not.toBe(snap2)
    })

    it("preserves premise reference when a different premise is mutated", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: premiseA } = engine.createPremiseWithId("pA")
        engine.createPremiseWithId("pB")
        const snap1 = engine.getSnapshot()

        premiseA.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "pA",
            parentId: null,
            position: 0,
        })

        const snap2 = engine.getSnapshot()
        expect(snap2.premises.pA).not.toBe(snap1.premises.pA)
        expect(snap2.premises.pB).toBe(snap1.premises.pB)
    })

    it("returns new variables reference when a variable is added", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const snap1 = engine.getSnapshot()
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        const snap2 = engine.getSnapshot()
        expect(snap2.variables).not.toBe(snap1.variables)
    })

    it("preserves variables reference when only a premise is mutated", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: premise } = engine.createPremise()
        const snap1 = engine.getSnapshot()

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const snap2 = engine.getSnapshot()
        expect(snap2.variables).toBe(snap1.variables)
    })

    it("returns new roles reference when conclusion changes", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        const { result: premise } = engine.createPremise()
        engine.clearConclusionPremise()
        const snap1 = engine.getSnapshot()
        engine.setConclusionPremise(premise.getId())
        const snap2 = engine.getSnapshot()
        expect(snap2.roles).not.toBe(snap1.roles)
    })

    it("preserves roles reference when only a variable changes", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.createPremise()
        const snap1 = engine.getSnapshot()
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        const snap2 = engine.getSnapshot()
        expect(snap2.roles).toBe(snap1.roles)
    })

    it("rebuilds fully after rollback", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.createPremise()
        const engineSnap = engine.snapshot()
        const reactiveSnap1 = engine.getSnapshot()

        engine.createPremise()
        engine.rollback(engineSnap)

        const reactiveSnap2 = engine.getSnapshot()
        expect(reactiveSnap2).not.toBe(reactiveSnap1)
        expect(Object.keys(reactiveSnap2.premises).length).toBe(1)
    })
})

describe("ArgumentEngine reactive store integration", () => {
    it("works as a useSyncExternalStore-compatible store", () => {
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })

        // Simulate useSyncExternalStore contract:
        // 1. subscribe returns unsubscribe
        // 2. getSnapshot returns stable reference when unchanged
        // 3. getSnapshot returns new reference when changed

        const snapshots: TReactiveSnapshot[] = []
        const unsub = engine.subscribe(() => {
            snapshots.push(engine.getSnapshot())
        })

        engine.getSnapshot()

        // Mutation 1: add variable
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })

        // Mutation 2: create premise and add expression
        const { result: premise } = engine.createPremise()
        premise.appendExpression(null, {
            id: "expr-root",
            type: "variable",
            variableId: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
        })

        // Should have been notified for each mutation
        expect(snapshots.length).toBeGreaterThanOrEqual(3)

        // Each snapshot should be a different reference
        for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]).not.toBe(snapshots[i - 1])
        }

        // Final snapshot should reflect current state
        const final = engine.getSnapshot()
        expect(final.variables.v1).toBeDefined()
        expect(Object.keys(final.premises).length).toBe(1)
        expect(
            final.premises[premise.getId()].expressions["expr-root"]
        ).toBeDefined()

        unsub()
    })
})
