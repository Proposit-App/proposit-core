// C6: populateFromCitations / populateFromAxioms factory tests.
//
// Per briefing §7 (post-handoff refinement, 2026-05-14):
//   - Each method is a factory operating on naked-Q derivation premises.
//   - Library-passing is method-arg (TClaimConnectionLookup passed in).
//   - Tree shape:
//       n=0 → no-op (naked-Q stays)
//       n=1 → IMPLIES(supporting-var, Q)
//       n≥2 → IMPLIES(OR(s1, …, sn), Q), with AN-1 inserting a formula
//             buffer between IMPLIES and OR in assistive mode.
//   - Already-populated premise → no-op (caller must use a repair
//     primitive to clear the antecedent first; preserves Proposit's
//     no-changes-without-consent principle and the Structural-only
//     mutation throw rule).
//   - Return shape:
//       { kind: 'populated' | 'no-op',
//         state: TCoreDerivationPremise,
//         resolved?: readonly TViolation[] }
//   - No derivation premise found for derivedClaimId → throws (legitimate
//     entity-not-found Structural integrity check).

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../../src/lib/core/claim-citation-library.js"
import { ClaimAxiomLibrary } from "../../src/lib/core/claim-axiom-library.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

function setupCitationFixture(): {
    eng: ArgumentEngine
    claimLib: ClaimLibrary
    citLib: ClaimCitationLibrary
    derivedClaimId: string
    s1Id: string
    s2Id: string
} {
    const claimLib = new ClaimLibrary()
    const derived = claimLib.create({ id: "claim-derived", type: "normal" })
    const s1 = claimLib.create({ id: "claim-s1", type: "citation" })
    const s2 = claimLib.create({ id: "claim-s2", type: "citation" })
    const citLib = new ClaimCitationLibrary(claimLib)
    const eng = new ArgumentEngine(ARG, claimLib)
    return {
        eng,
        claimLib,
        citLib,
        derivedClaimId: derived.id,
        s1Id: s1.id,
        s2Id: s2.id,
    }
}

function setupAxiomFixture(): {
    eng: ArgumentEngine
    claimLib: ClaimLibrary
    axLib: ClaimAxiomLibrary
    derivedClaimId: string
    s1Id: string
    s2Id: string
} {
    const claimLib = new ClaimLibrary()
    const derived = claimLib.create({ id: "claim-derived", type: "normal" })
    const s1 = claimLib.create({ id: "claim-s1", type: "axiomatic" })
    const s2 = claimLib.create({ id: "claim-s2", type: "axiomatic" })
    const axLib = new ClaimAxiomLibrary(claimLib)
    const eng = new ArgumentEngine(ARG, claimLib)
    return {
        eng,
        claimLib,
        axLib,
        derivedClaimId: derived.id,
        s1Id: s1.id,
        s2Id: s2.id,
    }
}

describe("ArgumentEngine.populateFromCitations (C6)", () => {
    it("returns kind='no-op' when 0 citations exist (naked-Q stays)", () => {
        const { eng, citLib, derivedClaimId } = setupCitationFixture()
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })
        const result = eng.populateFromCitations(derivedClaimId, citLib)
        expect(result.kind).toBe("no-op")
        // Premise still has its naked-Q root (single variable expression).
        expect(pe.getExpressions()).toHaveLength(1)
        expect(pe.getRootExpression()?.type).toBe("variable")
    })

    it("builds IMPLIES(c, Q) when 1 citation exists (assistive)", () => {
        const { eng, citLib, claimLib, derivedClaimId, s1Id } =
            setupCitationFixture()
        // Add the citation connection.
        citLib.add({
            id: "cit-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })

        const result = eng.populateFromCitations(derivedClaimId, citLib)
        expect(result.kind).toBe("populated")

        const exprs = pe.getExpressions()
        const root = pe.getRootExpression()
        expect(root?.type).toBe("operator")
        expect((root as { operator: string }).operator).toBe("implies")
        // Antecedent (position 0 child of IMPLIES) is the citation variable;
        // consequent (position 1) is Q.
        const children = exprs.filter((e) => e.parentId === root!.id)
        const antecedent = children.find((e) => e.position === 0)
        const consequent = children.find((e) => e.position === 1)
        expect(antecedent?.type).toBe("variable")
        expect(consequent?.type).toBe("variable")

        // Reference unused locals to satisfy lint.
        void claimLib
    })

    it("builds IMPLIES(formula(OR(s1, s2)), Q) when 2 citations exist (assistive)", () => {
        const { eng, citLib, derivedClaimId, s1Id, s2Id } =
            setupCitationFixture()
        citLib.add({
            id: "cit-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        citLib.add({
            id: "cit-2",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s2Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })

        const result = eng.populateFromCitations(derivedClaimId, citLib)
        expect(result.kind).toBe("populated")

        const exprs = pe.getExpressions()
        const root = pe.getRootExpression()
        expect(root?.type).toBe("operator")
        expect((root as { operator: string }).operator).toBe("implies")

        // Antecedent slot: formula buffer (assistive AN-1) wrapping the OR.
        const antecedent = exprs.find(
            (e) => e.parentId === root!.id && e.position === 0
        )
        expect(antecedent?.type).toBe("formula")
        const or = exprs.find((e) => e.parentId === antecedent!.id)
        expect(or?.type).toBe("operator")
        expect((or as { operator: string }).operator).toBe("or")
        const orChildren = exprs.filter((e) => e.parentId === or!.id)
        expect(orChildren).toHaveLength(2)
        for (const c of orChildren) expect(c.type).toBe("variable")
    })

    it("builds IMPLIES(OR(s1, s2), Q) — no buffer — when 2 citations exist in permissive mode", () => {
        const {
            eng: _,
            citLib,
            claimLib,
            derivedClaimId,
            s1Id,
            s2Id,
        } = setupCitationFixture()
        void _
        citLib.add({
            id: "cit-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        citLib.add({
            id: "cit-2",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s2Id,
            supportingClaimVersion: 0,
        })
        // Fresh permissive engine using the same claim library.
        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })

        const result = eng.populateFromCitations(derivedClaimId, citLib)
        expect(result.kind).toBe("populated")

        const exprs = pe.getExpressions()
        const root = pe.getRootExpression()
        // Antecedent slot: in permissive AN-1 is disarmed, so OR sits
        // directly under IMPLIES with no formula buffer. This is a
        // Structural-valid tree, but a P-1 violation surfaces via
        // validate('presentable').
        const antecedent = exprs.find(
            (e) => e.parentId === root!.id && e.position === 0
        )
        expect(antecedent?.type).toBe("operator")
        expect((antecedent as { operator: string }).operator).toBe("or")
    })

    it("returns kind='no-op' when the derivation premise is already populated", () => {
        const { eng, citLib, claimLib, derivedClaimId, s1Id } =
            setupCitationFixture()
        // Pre-populate by adding a citation BEFORE creating the premise so
        // we can drive the population manually, then verify a SECOND call
        // is a no-op.
        citLib.add({
            id: "cit-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })
        const first = eng.populateFromCitations(derivedClaimId, citLib)
        expect(first.kind).toBe("populated")

        // Add a new citation to the connection lookup so a re-call WOULD
        // change the tree if the factory weren't naked-Q-only.
        const s3 = claimLib.create({ id: "claim-s3", type: "citation" })
        citLib.add({
            id: "cit-2",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s3.id,
            supportingClaimVersion: 0,
        })
        const exprsBefore = pe
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const second = eng.populateFromCitations(derivedClaimId, citLib)
        expect(second.kind).toBe("no-op")
        const exprsAfter = pe
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(exprsAfter).toEqual(exprsBefore)
    })

    it("throws when no derivation premise exists for the derivedClaimId", () => {
        const { eng, citLib, derivedClaimId } = setupCitationFixture()
        // No createPremise call — no derivation premise for derivedClaimId.
        expect(() =>
            eng.populateFromCitations(derivedClaimId, citLib)
        ).toThrow()
    })

    it("deduplicates connections referencing the same supportingClaimId (one OR child per unique support)", () => {
        // Source-order de-duplication: the factory iterates connections,
        // collapses duplicate supportingClaimId entries into a single
        // antecedent variable, and preserves first-seen order. This
        // covers the seen-set branch in populate-from.ts.
        //
        // Assistive-mode coupling: the assertion below
        // (`antecedent?.type === "formula"`) walks past the formula
        // buffer that AN-1 inserts in assistive mode between IMPLIES
        // and OR. The default-constructed engine here is assistive; a
        // permissive engine would have OR as the direct antecedent
        // (no buffer). See the §5 P-1 / AN-1 contract.
        const { eng, citLib, derivedClaimId, s1Id, s2Id } =
            setupCitationFixture()
        citLib.add({
            id: "cit-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        citLib.add({
            id: "cit-2",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s2Id,
            supportingClaimVersion: 0,
        })
        // A third connection referencing s1 again — the factory must
        // collapse this with the first cit-1 connection rather than
        // adding a redundant OR child.
        citLib.add({
            id: "cit-3",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })

        const result = eng.populateFromCitations(derivedClaimId, citLib)
        expect(result.kind).toBe("populated")

        // The antecedent is `formula(OR(s1, s2))` — two children of OR,
        // not three. Walk past the formula buffer that AN-1 inserts in
        // assistive mode.
        const exprs = pe.getExpressions()
        const root = pe.getRootExpression()
        const antecedent = exprs.find(
            (e) => e.parentId === root!.id && e.position === 0
        )
        expect(antecedent?.type).toBe("formula")
        const or = exprs.find((e) => e.parentId === antecedent!.id)
        expect((or as { operator: string }).operator).toBe("or")
        const orChildren = exprs.filter((e) => e.parentId === or!.id)
        expect(orChildren).toHaveLength(2)
    })
})

describe("ArgumentEngine.populateFromAxioms (C6)", () => {
    it("returns kind='no-op' when 0 axiom connections exist", () => {
        const { eng, axLib, derivedClaimId } = setupAxiomFixture()
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })
        const result = eng.populateFromAxioms(derivedClaimId, axLib)
        expect(result.kind).toBe("no-op")
        expect(pe.getExpressions()).toHaveLength(1)
    })

    it("builds IMPLIES(a, Q) when 1 axiom connection exists", () => {
        const { eng, axLib, derivedClaimId, s1Id } = setupAxiomFixture()
        axLib.add({
            id: "ax-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })
        const result = eng.populateFromAxioms(derivedClaimId, axLib)
        expect(result.kind).toBe("populated")
        const root = pe.getRootExpression()
        expect((root as { operator: string }).operator).toBe("implies")
    })

    it("builds IMPLIES(formula(OR(a1, a2)), Q) when 2 axiom connections exist (assistive)", () => {
        const { eng, axLib, derivedClaimId, s1Id, s2Id } = setupAxiomFixture()
        axLib.add({
            id: "ax-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        axLib.add({
            id: "ax-2",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s2Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })

        eng.populateFromAxioms(derivedClaimId, axLib)
        const exprs = pe.getExpressions()
        const root = pe.getRootExpression()
        const antecedent = exprs.find(
            (e) => e.parentId === root!.id && e.position === 0
        )
        // Same shape as citation case: formula buffer (AN-1) → OR → 2 vars.
        expect(antecedent?.type).toBe("formula")
        const or = exprs.find((e) => e.parentId === antecedent!.id)
        expect((or as { operator: string }).operator).toBe("or")
        const orChildren = exprs.filter((e) => e.parentId === or!.id)
        expect(orChildren).toHaveLength(2)
    })

    it("returns kind='no-op' when premise is already populated", () => {
        const { eng, axLib, derivedClaimId, s1Id } = setupAxiomFixture()
        axLib.add({
            id: "ax-1",
            claimId: derivedClaimId,
            claimVersion: 0,
            supportingClaimId: s1Id,
            supportingClaimVersion: 0,
        })
        const { result: pe } = eng.createPremise({
            type: "derivation",
            derivedClaimId,
        })
        eng.populateFromAxioms(derivedClaimId, axLib)
        const before = pe
            .getExpressions()
            .map((e) => e.id)
            .sort()
        const result = eng.populateFromAxioms(derivedClaimId, axLib)
        expect(result.kind).toBe("no-op")
        expect(
            pe
                .getExpressions()
                .map((e) => e.id)
                .sort()
        ).toEqual(before)
    })

    it("throws when no derivation premise exists for the derivedClaimId", () => {
        const { eng, axLib, derivedClaimId } = setupAxiomFixture()
        expect(() => eng.populateFromAxioms(derivedClaimId, axLib)).toThrow()
    })
})
