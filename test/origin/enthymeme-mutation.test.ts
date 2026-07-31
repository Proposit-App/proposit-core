import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../src/lib/schemata/index.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"

// Marking content unspoken needs no new mutation API: an expression takes the
// field through the existing `patchExpressionAppFields`, and a premise through
// the existing extras round-trip. Both routes are exercised here because the
// consuming layer builds its authoring surface on them, and because the
// standing rule is that only Structural violations throw at mutation time —
// a premise-bound variable marked unspoken must mutate cleanly and surface at
// `validate('presentable')` instead.

function makeEngine() {
    const claims = new ClaimLibrary()
    claims.create({ id: "claim-default", type: "normal" })
    return new ArgumentEngine<
        TCoreArgument,
        TCorePremise,
        TCorePropositionalExpression,
        TCorePropositionalVariable
    >({ id: "arg-1", version: 1 }, claims, { behavior: "permissive" })
}

function seedSingleVariablePremise(engine: ReturnType<typeof makeEngine>) {
    engine.addVariable({
        id: "v1",
        symbol: "P",
        argumentId: "arg-1",
        argumentVersion: 1,
        claimId: "claim-default",
        claimVersion: 0,
    })
    const { result: premise } = engine.createPremise()
    premise.addExpression({
        id: "e1",
        type: "variable",
        variableId: "v1",
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: premise.getId(),
        parentId: null,
        position: 1,
    } as TExpressionInput<TCorePropositionalExpression>)
    engine.flushChecksums()
    return premise
}

function findVariableExpression(
    engine: ReturnType<typeof makeEngine>,
    id: string
) {
    const expression = engine
        .snapshot()
        .premises.flatMap((p) => p.expressions.expressions)
        .find((e) => e.id === id)
    if (expression?.type !== "variable") {
        throw new Error(`No variable expression "${id}" in the snapshot.`)
    }
    return expression
}

describe("marking content unspoken", () => {
    it("marks an expression and changes its checksum", () => {
        const engine = makeEngine()
        seedSingleVariablePremise(engine)
        const before = findVariableExpression(engine, "e1")

        engine.patchExpressionAppFields("e1", { enthymeme: true })
        engine.flushChecksums()

        const after = findVariableExpression(engine, "e1")
        expect(after.enthymeme).toBe(true)
        expect(after.checksum).not.toBe(before.checksum)
    })

    it("removes a premise mark by deleting the key, not blanking it", () => {
        // The mirror of the expression assertion below. `updateExtras` spreads
        // its updates into the extras object, so an `undefined` value used to
        // *create* the key — the same failure the expression path had.
        const engine = makeEngine()
        const premise = seedSingleVariablePremise(engine)
        const original = engine.snapshot().premises[0].premise.checksum

        premise.updateExtras({ enthymeme: true })
        engine.flushChecksums()
        expect(engine.snapshot().premises[0].premise.checksum).not.toBe(
            original
        )

        premise.updateExtras({ enthymeme: undefined })
        engine.flushChecksums()
        const unmarked = engine.snapshot().premises[0].premise
        expect(unmarked.checksum).toBe(original)
        expect("enthymeme" in unmarked).toBe(false)
    })

    it("drops an undefined-valued key passed straight to setExtras", () => {
        const engine = makeEngine()
        const premise = seedSingleVariablePremise(engine)
        premise.setExtras({ title: "kept", enthymeme: undefined })
        const stored = engine.snapshot().premises[0].premise as Record<
            string,
            unknown
        >
        expect(stored.title).toBe("kept")
        expect("enthymeme" in stored).toBe(false)
    })

    it("removes an argument-level field by deleting the key, not blanking it", () => {
        // The argument-level mirror. `ArgumentEngine` has its own
        // `setExtras`/`updateExtras` pair, independent of `PremiseEngine`'s,
        // and it had the same defect. It matters at least as much here:
        // `createChecksumConfig` unions app fields onto `argumentFields`, and
        // an argument carries descendant and combined checksums, so a shift
        // propagates further than a premise-level one.
        const engine = makeEngine()
        seedSingleVariablePremise(engine)

        engine.updateExtras({ note: "hello" })
        engine.flushChecksums()
        expect(engine.snapshot().argument).toMatchObject({ note: "hello" })

        engine.updateExtras({ note: undefined })
        engine.flushChecksums()
        expect("note" in engine.snapshot().argument).toBe(false)
    })

    it("restores the argument checksum when a checksum-bearing field is cleared", () => {
        // With the field in the checksum config, a key left present holding
        // `undefined` is one downstream null-coercion away from moving every
        // argument checksum. Clearing has to be exactly reversible.
        const claims = new ClaimLibrary()
        claims.create({ id: "claim-default", type: "normal" })
        const engine = new ArgumentEngine<
            TCoreArgument,
            TCorePremise,
            TCorePropositionalExpression,
            TCorePropositionalVariable
        >({ id: "arg-1", version: 1 }, claims, {
            behavior: "permissive",
            checksumConfig: { argumentFields: new Set(["note"]) },
        })
        engine.flushChecksums()
        const original = engine.snapshot().argument.checksum

        engine.updateExtras({ note: "hello" })
        engine.flushChecksums()
        expect(engine.snapshot().argument.checksum).not.toBe(original)

        engine.updateExtras({ note: undefined })
        engine.flushChecksums()
        expect(engine.snapshot().argument.checksum).toBe(original)
        expect("note" in engine.snapshot().argument).toBe(false)
    })

    it("marks a premise and changes its checksum", () => {
        const engine = makeEngine()
        const premise = seedSingleVariablePremise(engine)
        const before = engine.snapshot().premises[0].premise.checksum

        premise.setExtras({ ...premise.getExtras(), enthymeme: true })
        engine.flushChecksums()

        const after = engine.snapshot().premises[0]
        expect(after.premise.enthymeme).toBe(true)
        expect(after.premise.checksum).not.toBe(before)
    })

    it("does not throw when the marked variable is premise-bound", () => {
        // The violation this creates is Presentable-tier (P-6), and mutations
        // throw only on Structural violations.
        const engine = makeEngine()
        const { result: source } = engine.createPremise()
        engine.bindVariableToPremise({
            id: "v-bound",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            boundPremiseId: source.getId(),
            boundArgumentId: "arg-1",
            boundArgumentVersion: 1,
        })
        const { result: target } = engine.createPremise()
        target.addExpression({
            id: "e-bound",
            type: "variable",
            variableId: "v-bound",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: target.getId(),
            parentId: null,
            position: 1,
        } as TExpressionInput<TCorePropositionalExpression>)
        engine.flushChecksums()

        expect(() => {
            engine.patchExpressionAppFields("e-bound", { enthymeme: true })
        }).not.toThrow()

        engine.flushChecksums()
        expect(findVariableExpression(engine, "e-bound").enthymeme).toBe(true)
        expect(engine.validate("presentable").map((v) => v.code)).toContain(
            "P-6"
        )
        expect(engine.validate("derivable").map((v) => v.code)).not.toContain(
            "P-6"
        )
    })

    it("leaves the checksum at its original value when the mark is removed", () => {
        // Unmarking must delete the key rather than set it to false, or the
        // entity never returns to the checksum it had before it was marked.
        const engine = makeEngine()
        seedSingleVariablePremise(engine)
        const original = findVariableExpression(engine, "e1").checksum

        engine.patchExpressionAppFields("e1", { enthymeme: true })
        engine.flushChecksums()
        expect(findVariableExpression(engine, "e1").checksum).not.toBe(original)

        engine.patchExpressionAppFields("e1", { enthymeme: undefined })
        engine.flushChecksums()
        expect(findVariableExpression(engine, "e1").checksum).toBe(original)

        // And the key is gone, not merely undefined. `"enthymeme" in expr`
        // staying true is checksum-safe here but reintroduces the invariant's
        // failure the moment a downstream mapper turns undefined into null.
        expect("enthymeme" in findVariableExpression(engine, "e1")).toBe(false)
    })
})
