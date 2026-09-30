import { describe, expect, it } from "vitest"
import { ClaimLibrary, PropositCore } from "../../src/lib/index"
import { ClaimCitationLibrary } from "../../src/lib/core/claim-citation-library"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import { AXIOM_NOT_FOUND } from "../../src/lib/types/validation"
import { InvariantViolationError } from "../../src/lib/index"
import { ClaimAxiomLibrary } from "../../src/lib/core/claim-axiom-library"

describe("ClaimLibrary axiomatic claim type", () => {
    it("creates a claim with type 'axiomatic'", () => {
        const lib = new ClaimLibrary()
        const claim = lib.create({ type: "axiomatic" })
        expect(claim.type).toBe("axiomatic")
        expect(claim.version).toBe(0)
        expect(claim.frozen).toBe(false)
    })

    it("rejects an update that changes type to or from 'axiomatic'", () => {
        const lib = new ClaimLibrary()
        const normal = lib.create({ type: "normal" })
        const axiomatic = lib.create({ type: "axiomatic" })
        expect(() =>
            lib.update(normal.id, { type: "axiomatic" } as never)
        ).toThrow(/type is immutable/)
        expect(() =>
            lib.update(axiomatic.id, { type: "normal" } as never)
        ).toThrow(/type is immutable/)
    })
})

describe("ClaimAxiomLibrary", () => {
    function setup() {
        const claims = new ClaimLibrary()
        const normalClaim = claims.create({ type: "normal" })
        const axiomClaim = claims.create({ type: "axiomatic" })
        const citationClaim = claims.create({ type: "citation" })
        const axioms = new ClaimAxiomLibrary(claims)
        return { claims, normalClaim, axiomClaim, citationClaim, axioms }
    }

    it("creates an axiom connection between a normal claim and an axiomatic claim", () => {
        const { normalClaim, axiomClaim, axioms } = setup()
        const conn = axioms.add({
            id: "ax-1",
            claimId: normalClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        expect(conn.id).toBe("ax-1")
        expect(conn.checksum).not.toBe("")
        expect(axioms.getAll()).toHaveLength(1)
        expect(axioms.getConnectionsForClaim(normalClaim.id)).toHaveLength(1)
    })

    it("rejects a connection whose supporting claim is not axiomatic", () => {
        const { normalClaim, citationClaim, axioms } = setup()
        expect(() =>
            axioms.add({
                id: "ax-2",
                claimId: normalClaim.id,
                claimVersion: 0,
                supportingClaimId: citationClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE/)
    })

    it("rejects a connection whose supported claim is not normal", () => {
        const { citationClaim, axiomClaim, axioms } = setup()
        expect(() =>
            axioms.add({
                id: "ax-3",
                claimId: citationClaim.id,
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_CLAIM_NOT_NORMAL_TYPE/)
    })

    it("rejects a connection with unknown claim refs", () => {
        const { axiomClaim, axioms } = setup()
        expect(() =>
            axioms.add({
                id: "ax-4",
                claimId: "missing-id",
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_CLAIM_REF_NOT_FOUND/)
    })

    it("rejects duplicate IDs", () => {
        const { normalClaim, axiomClaim, axioms } = setup()
        axioms.add({
            id: "dup",
            claimId: normalClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        expect(() =>
            axioms.add({
                id: "dup",
                claimId: normalClaim.id,
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_DUPLICATE_ID/)
    })

    it("snapshot and fromSnapshot round-trip", () => {
        const { claims, normalClaim, axiomClaim, axioms } = setup()
        axioms.add({
            id: "ax-rt",
            claimId: normalClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        const snap = axioms.snapshot()
        const restored = ClaimAxiomLibrary.fromSnapshot(snap, claims)
        expect(restored.getAll()).toHaveLength(1)
        expect(restored.get("ax-rt")?.id).toBe("ax-rt")
    })

    it("axioms cannot form cycles by structural impossibility", () => {
        // Axiomatic claims can never appear on the dependent side, so cycles
        // cannot be constructed. This test documents the invariant.
        const { axiomClaim, normalClaim, axioms } = setup()
        // Try to make an axiom point AT another axiom (depend on it).
        expect(() =>
            axioms.add({
                id: "ax-cycle",
                claimId: axiomClaim.id,
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_CLAIM_NOT_NORMAL_TYPE/)
        expect(normalClaim).toBeDefined() // suppress unused
    })

    describe("remove", () => {
        it("throws InvariantViolationError with code AXIOM_NOT_FOUND when removing a missing id", () => {
            const claimLib = new ClaimLibrary()
            const lib = new ClaimAxiomLibrary(claimLib)
            let caught: unknown
            try {
                lib.remove("does-not-exist")
            } catch (e) {
                caught = e
            }
            expect(caught).toBeInstanceOf(InvariantViolationError)
            const err = caught as InvariantViolationError
            expect(err.violations[0].code).toBe(AXIOM_NOT_FOUND)
        })
    })
})

describe("PropositCore axioms field", () => {
    it("exposes axioms as a public field", () => {
        const core = new PropositCore()
        expect(core.axioms).toBeInstanceOf(ClaimAxiomLibrary)
    })

    it("citations field is named 'citations' (renamed from claimCitations)", () => {
        const core = new PropositCore()
        expect(core.citations).toBeInstanceOf(ClaimCitationLibrary)
        expect("claimCitations" in core).toBe(false)
    })

    it("snapshot includes citations and axioms slots", () => {
        const core = new PropositCore()
        const snap = core.snapshot()
        expect(snap).toHaveProperty("citations")
        expect(snap).toHaveProperty("axioms")
        expect(snap.citations).toEqual({ connections: [] })
        expect(snap.axioms).toEqual({ connections: [] })
    })

    it("fromSnapshot throws LEGACY_MISSING_AXIOM_SLOT when 'axioms' is absent", () => {
        const legacy = {
            arguments: { arguments: [] },
            claims: { claims: [] },
            citations: { connections: [] },
            forks: {
                arguments: [],
                premises: [],
                expressions: [],
                variables: [],
                claims: [],
            },
        } as unknown
        expect(() => PropositCore.fromSnapshot(legacy as never)).toThrow(
            /LEGACY_MISSING_AXIOM_SLOT/
        )
    })

    it("fromSnapshot throws LEGACY_CLAIM_CITATION_SHAPE when 'claimCitations' slot present", () => {
        const legacy = {
            arguments: { arguments: [] },
            claims: { claims: [] },
            claimCitations: { claimCitations: [] }, // older stored shape, rejected
            axioms: { connections: [] },
            forks: {
                arguments: [],
                premises: [],
                expressions: [],
                variables: [],
                claims: [],
            },
        } as unknown
        expect(() => PropositCore.fromSnapshot(legacy as never)).toThrow(
            /LEGACY_CLAIM_CITATION_SHAPE/
        )
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine.evaluate / checkValidity axiom force-true semantics
// ---------------------------------------------------------------------------

describe("ArgumentEngine.evaluate axiom force-true", () => {
    it("forces axiomatic-bound variables to true with no caller assignment", () => {
        const core = new PropositCore()
        const claim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const variable = engine.ensureClaimBoundVariable(claim.id)
        // Build a trivial premise with the variable as its expression. With
        // a single variable expression at the root, it is a constraint
        // premise; because it is the first premise added, it is also
        // auto-designated as the conclusion.
        const { result: pm } = engine.createPremise({ type: "freeform" })
        const premiseId = pm.toPremiseData().id
        pm.addExpression({
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "variable",
            variableId: variable.id,
        })
        const result = engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        // The premise's expression should evaluate to true because the
        // axiomatic-bound variable is force-true.
        expect(result.ok).toBe(true)
        expect(result.conclusion?.rootValue).toBe(true)
    })

    it("rejects an explicit assignment of an axiomatic-bound variable", () => {
        const core = new PropositCore()
        const claim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const variable = engine.ensureClaimBoundVariable(claim.id)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: true },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: false },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: null },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
    })

    it("rejects an explicit `undefined` assignment of an axiomatic-bound variable", () => {
        // Regression: a caller passing { [varId]: undefined } previously slipped
        // past the `!== undefined` guard and was silently overwritten to true.
        // ANY explicit key on the assignment map for
        // an axiomatic-bound variable must throw, including an explicit undefined.
        const core = new PropositCore()
        const claim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const variable = engine.ensureClaimBoundVariable(claim.id)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: undefined as unknown as boolean },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
    })

    it("iff-rooted derivation backed by an axiom forces consequent Q to true", () => {
        // An axiom-backed derivation whose root operator is iff propagates
        // both ways: the axiom is true, so once the reader accepts the step,
        // Q is forced true. The derivation premise is a supporting premise and
        // a separate premise holding only Q is the conclusion, so Q's value
        // comes from the derivation step, not from Q's own premise.
        const core = new PropositCore()
        const derivedClaim = core.claims.create({ type: "normal" })
        const axiomClaim = core.claims.create({ type: "axiomatic" })
        core.axioms.add({
            id: "iff-a",
            claimId: derivedClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const { result: conclusion } = engine.createPremise({
            type: "freeform",
        })
        const consequentVar = engine.ensureClaimBoundVariable(derivedClaim.id)
        conclusion.addExpression({
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId: conclusion.toPremiseData().id,
            parentId: null,
            position: POSITION_INITIAL,
            type: "variable",
            variableId: consequentVar.id,
        })
        const { result: derivation } = engine.createPremise({
            type: "derivation",
            derivedClaimId: derivedClaim.id,
        })
        engine.populateFromAxioms(derivedClaim.id, core.axioms)
        const rootId = derivation.getRootExpression()!.id
        derivation.changeOperator(rootId, "iff")
        engine.setConclusionPremise(conclusion.toPremiseData().id)
        expect(derivation.getRootExpression()).toMatchObject({
            type: "operator",
            operator: "iff",
        })

        const result = engine.evaluate(
            { variables: {}, operatorAssignments: { [rootId]: "accepted" } },
            { includeDiagnostics: true }
        )
        expect(result.propagatedVariableValues?.[consequentVar.id]).toBe(true)
        expect(result.conclusion?.rootValue).toBe(true)
    })

    it("checkValidity excludes axiomatic-bound variables from enumeration", () => {
        const core = new PropositCore()
        const normalClaim = core.claims.create({ type: "normal" })
        const axiomClaim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        // Permissive build: this test builds AND(VAR, VAR)
        // incrementally; assistive AN-3 would collapse the 0-child
        // AND between addExpression calls. Switch to permissive for
        // the build phase (no normalize() needed — the tree's final
        // shape is already Presentable, so AN would be a no-op).
        engine.setBehavior("permissive")
        const normalVar = engine.ensureClaimBoundVariable(normalClaim.id)
        const axiomVar = engine.ensureClaimBoundVariable(axiomClaim.id)
        // Conclusion premise: P ∧ axiom — counts admissible assignments over
        // the free vars (just P; axiom is forced true).
        const { result: pm } = engine.createPremise({ type: "freeform" })
        const premiseId = pm.toPremiseData().id
        const andId = crypto.randomUUID()
        pm.addExpression({
            id: andId,
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "operator",
            operator: "and",
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: normalVar.id,
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: axiomVar.id,
        })
        engine.setConclusionPremise(premiseId)
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.ok).toBe(true)
        // 2^1 = 2 enumerated assignments (normalVar true/false), not 2^2 = 4.
        // The axiomatic variable is forced-true and excluded from enumeration.
        expect(result.numAssignmentsChecked).toBe(2)
        // No constraint premises, so every enumerated row is admissible
        // (admissibility is over constraints, not the conclusion).
        expect(result.numAdmissibleAssignments).toBe(2)
    })
})

// ---------------------------------------------------------------------------
// Propagator interaction with axiomatic variables
// ---------------------------------------------------------------------------

describe("Propagator interaction with axiomatic variables", () => {
    it("rejecting an operator whose only unknown child is axiom-bound does not flip the axiom", () => {
        const core = new PropositCore()
        const axiomClaim = core.claims.create({ type: "axiomatic" })
        const normalClaim = core.claims.create({ type: "normal" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        // Permissive build: see the matching comment in the
        // `checkValidity excludes axiomatic-bound variables` test
        // above. The tree built here is Presentable in its final
        // shape, so no post-build normalize() is needed.
        engine.setBehavior("permissive")
        const normalVar = engine.ensureClaimBoundVariable(normalClaim.id)
        const axiomVar = engine.ensureClaimBoundVariable(axiomClaim.id)
        const { result: pm } = engine.createPremise({ type: "freeform" })
        const premiseId = pm.toPremiseData().id
        const andId = crypto.randomUUID()
        pm.addExpression({
            id: andId,
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "operator",
            operator: "and",
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: normalVar.id,
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: axiomVar.id,
        })
        // Evaluate with the AND operator REJECTED. The propagator wants to
        // flip one child to false; the axiomatic-bound variable is
        // force-true and lives in the propagator's `userAssigned` set, so
        // it is immune to overwrite.
        const rejectedResult = engine.evaluate({
            variables: {},
            operatorAssignments: { [andId]: "rejected" },
        })
        // The axiomatic variable stays true (forced); the rejection's
        // downstream propagation halts gracefully — the premise still
        // evaluates without throwing.
        expect(rejectedResult.ok).toBe(true)
        expect(rejectedResult.conclusion).toBeDefined()
        expect(rejectedResult.conclusion?.variableValues?.[axiomVar.id]).toBe(
            true
        )
        // Re-evaluate without rejection — baseline sanity.
        const baseline = engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        expect(baseline.ok).toBe(true)
        expect(baseline.conclusion).toBeDefined()
        expect(baseline.conclusion?.variableValues?.[axiomVar.id]).toBe(true)
    })
})
