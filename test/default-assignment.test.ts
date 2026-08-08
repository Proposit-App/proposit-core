// Usage-based default variable assignments: `ArgumentEngine.deriveDefaultAssignment`.
//
// A default assignment gives every argument variable a truth value derived
// purely from claim type + immediate support structure:
//   - citation / axiomatic claim  → true
//   - normal claim whose derivation premise's IMMEDIATE antecedent evaluates
//     true (each immediate antecedent claim seeded true iff citation/axiomatic,
//     else unknown) → true
//   - everything else → null (unknown)
// A default is NEVER false.
//
// These tests build their own fixtures inline (no shared beforeEach state)
// per the repo convention. The engine runs in `permissive` behavior so the
// incremental derivation-tree surgery (remove naked-Q root, rebuild
// IMPLIES(antecedent, Q)) is not disturbed by the assistive AN post-hook —
// the same pattern the `populateFrom*` factories use.

import { describe, it, expect } from "vitest"
import { ArgumentEngine, ClaimLibrary, gradeEvaluation } from "../src/lib/index"
import type {
    TCoreVariableAssignment,
    TCoreTrivalentValue,
    TCoreEvaluationGrade,
    TCoreArgumentEvaluationResult,
    TCorePremiseEvaluationResult,
} from "../src/lib/index"
import { ClaimCitationLibrary } from "../src/lib/core/claim-citation-library.js"
import { makeArgument } from "./grammar/fixtures.js"
import type { PremiseEngine } from "../src/lib/index"

const ARG = makeArgument()

// -- Antecedent spec + tree builders --------------------------------------

type TAnte =
    | { op: "var"; claimId: string }
    | { op: "and" | "or"; kids: TAnte[] }
    | { op: "not"; kid: TAnte }

function makeEngine(): { eng: ArgumentEngine; claimLib: ClaimLibrary } {
    const claimLib = new ClaimLibrary()
    const eng = new ArgumentEngine(ARG, claimLib, { behavior: "permissive" })
    return { eng, claimLib }
}

let exprSeq = 0
const eid = (): string => `e-${exprSeq++}`

function buildAntecedent(
    eng: ArgumentEngine,
    pe: PremiseEngine,
    parentId: string,
    position: number,
    ante: TAnte
): void {
    if (ante.op === "var") {
        const v = eng.ensureClaimBoundVariable(ante.claimId)
        pe.addExpression({
            id: eid(),
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            parentId,
            position,
            type: "variable",
            variableId: v.id,
        })
        return
    }
    if (ante.op === "not") {
        const notId = eid()
        pe.addExpression({
            id: notId,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            parentId,
            position,
            type: "operator",
            operator: "not",
        })
        buildAntecedent(eng, pe, notId, 0, ante.kid)
        return
    }
    const opId = eid()
    pe.addExpression({
        id: opId,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: pe.getId(),
        parentId,
        position,
        type: "operator",
        operator: ante.op,
    })
    ante.kids.forEach((kid, i) => buildAntecedent(eng, pe, opId, i, kid))
}

/**
 * Create a derivation premise for `derivedClaimId` and populate it as
 * `IMPLIES(antecedent, Q)`, where Q is the derived claim's variable.
 * Returns the premise, the consequent variable, and the IMPLIES id.
 */
function buildDerivation(
    eng: ArgumentEngine,
    derivedClaimId: string,
    ante: TAnte
): { pe: PremiseEngine; qVarId: string; implId: string } {
    const { result: pe } = eng.createPremise({
        type: "derivation",
        derivedClaimId,
    })
    const qVar = eng.ensureClaimBoundVariable(derivedClaimId)
    const nakedRoot = pe.getRootExpression()!
    pe.removeExpression(nakedRoot.id, true)
    const implId = eid()
    pe.addExpression({
        id: implId,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: pe.getId(),
        parentId: null,
        position: 0,
        type: "operator",
        operator: "implies",
    })
    buildAntecedent(eng, pe, implId, 0, ante)
    pe.addExpression({
        id: eid(),
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: pe.getId(),
        parentId: implId,
        position: 1,
        type: "variable",
        variableId: qVar.id,
    })
    return { pe, qVarId: qVar.id, implId }
}

// -- D(claim) cases -------------------------------------------------------

describe("deriveDefaultAssignment — D(claim)", () => {
    it("citation claim → true", () => {
        const { eng, claimLib } = makeEngine()
        const c = claimLib.create({ id: "cite", type: "citation" })
        const v = eng.ensureClaimBoundVariable(c.id)
        expect(eng.deriveDefaultAssignment()[v.id]).toBe(true)
    })

    it("axiomatic claim → true", () => {
        const { eng, claimLib } = makeEngine()
        const c = claimLib.create({ id: "axiom", type: "axiomatic" })
        const v = eng.ensureClaimBoundVariable(c.id)
        expect(eng.deriveDefaultAssignment()[v.id]).toBe(true)
    })

    it("normal claim with a single citation supporter → true", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { qVarId } = buildDerivation(eng, derived.id, {
            op: "var",
            claimId: "cite",
        })
        expect(eng.deriveDefaultAssignment()[qVarId]).toBe(true)
    })

    it("normal claim with cite ∧ cite → true", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "c1", type: "citation" })
        claimLib.create({ id: "c2", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { qVarId } = buildDerivation(eng, derived.id, {
            op: "and",
            kids: [
                { op: "var", claimId: "c1" },
                { op: "var", claimId: "c2" },
            ],
        })
        expect(eng.deriveDefaultAssignment()[qVarId]).toBe(true)
    })

    it("normal claim with cite ∧ normal → unknown", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        claimLib.create({ id: "norm", type: "normal" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { qVarId } = buildDerivation(eng, derived.id, {
            op: "and",
            kids: [
                { op: "var", claimId: "cite" },
                { op: "var", claimId: "norm" },
            ],
        })
        expect(eng.deriveDefaultAssignment()[qVarId]).toBeNull()
    })

    it("normal claim with cite ∨ normal → true", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        claimLib.create({ id: "norm", type: "normal" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { qVarId } = buildDerivation(eng, derived.id, {
            op: "or",
            kids: [
                { op: "var", claimId: "cite" },
                { op: "var", claimId: "norm" },
            ],
        })
        expect(eng.deriveDefaultAssignment()[qVarId]).toBe(true)
    })

    it("normal claim with cite ∨ cite → true", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "c1", type: "citation" })
        claimLib.create({ id: "c2", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { qVarId } = buildDerivation(eng, derived.id, {
            op: "or",
            kids: [
                { op: "var", claimId: "c1" },
                { op: "var", claimId: "c2" },
            ],
        })
        expect(eng.deriveDefaultAssignment()[qVarId]).toBe(true)
    })

    it("normal claim supported only by another normal claim → unknown", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "norm", type: "normal" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { qVarId } = buildDerivation(eng, derived.id, {
            op: "var",
            claimId: "norm",
        })
        expect(eng.deriveDefaultAssignment()[qVarId]).toBeNull()
    })

    it("unsupported normal claim (naked-Q derivation) → unknown", () => {
        const { eng, claimLib } = makeEngine()
        const derived = claimLib.create({ id: "d", type: "normal" })
        // Naked-Q derivation premise: created but never populated.
        eng.createPremise({ type: "derivation", derivedClaimId: derived.id })
        const qVar = eng.ensureClaimBoundVariable(derived.id)
        expect(eng.deriveDefaultAssignment()[qVar.id]).toBeNull()
    })

    it("normal claim with no derivation premise at all → unknown", () => {
        const { eng, claimLib } = makeEngine()
        const c = claimLib.create({ id: "d", type: "normal" })
        const v = eng.ensureClaimBoundVariable(c.id)
        expect(eng.deriveDefaultAssignment()[v.id]).toBeNull()
    })

    it("never defaults any variable to false", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        claimLib.create({ id: "norm", type: "normal" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        buildDerivation(eng, derived.id, {
            op: "and",
            kids: [
                { op: "var", claimId: "cite" },
                { op: "var", claimId: "norm" },
            ],
        })
        const map = eng.deriveDefaultAssignment()
        for (const value of Object.values(map)) {
            expect(value).not.toBe(false)
        }
    })

    it("reads a derivation populated the real way (populateFromCitations, assistive AN-1 formula buffer)", () => {
        // Exercises the actual consumer path — default assistive engine +
        // populateFromCitations builds IMPLIES(formula(OR(c1, c2)), Q) — to
        // guard the sorted-antecedent lookup and formula-unwrapping against
        // real data rather than the hand-built fixtures above.
        const claimLib = new ClaimLibrary()
        const derived = claimLib.create({ id: "d", type: "normal" })
        claimLib.create({ id: "c1", type: "citation" })
        claimLib.create({ id: "c2", type: "citation" })
        const citLib = new ClaimCitationLibrary(claimLib)
        citLib.add({
            id: "cit-1",
            claimId: derived.id,
            claimVersion: 0,
            supportingClaimId: "c1",
            supportingClaimVersion: 0,
        })
        citLib.add({
            id: "cit-2",
            claimId: derived.id,
            claimVersion: 0,
            supportingClaimId: "c2",
            supportingClaimVersion: 0,
        })
        const eng = new ArgumentEngine(ARG, claimLib)
        eng.createPremise({ type: "derivation", derivedClaimId: derived.id })
        expect(eng.populateFromCitations(derived.id, citLib).kind).toBe(
            "populated"
        )
        const qVarId = eng.getVariableIdForClaim(derived.id)!
        expect(eng.deriveDefaultAssignment()[qVarId]).toBe(true)
    })

    it("returns an entry for every argument variable", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        buildDerivation(eng, derived.id, { op: "var", claimId: "cite" })
        const map = eng.deriveDefaultAssignment()
        const expectedIds = eng
            .getVariables()
            .map((v) => v.id)
            .sort()
        expect(Object.keys(map).sort()).toEqual(expectedIds)
    })
})

// -- Transitive propagation story -----------------------------------------

describe("deriveDefaultAssignment ⇄ evaluate (propagation)", () => {
    it("transitive chain: A grounded true, B unknown at assignment, then B propagates true once the inferences are evaluated", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        const claimA = claimLib.create({ id: "a", type: "normal" })
        const claimB = claimLib.create({ id: "b", type: "normal" })

        // A's support: IMPLIES(cite, A)  (supporting premise)
        const a = buildDerivation(eng, claimA.id, {
            op: "var",
            claimId: "cite",
        })
        // B's support: IMPLIES(A, B)  (conclusion premise)
        const b = buildDerivation(eng, claimB.id, { op: "var", claimId: "a" })
        eng.setConclusionPremise(b.pe.getId())

        const defaults = eng.deriveDefaultAssignment()
        const citeVarId = eng.getVariableIdForClaim("cite")!
        // Structural defaults: cite true, A true (grounded by citation),
        // B unknown (its immediate antecedent A is a normal claim → unknown).
        expect(defaults[citeVarId]).toBe(true)
        expect(defaults[a.qVarId]).toBe(true)
        expect(defaults[b.qVarId]).toBeNull()

        // Evaluate under the defaults with the argument's inferences accepted
        // (the review asserts the derivation implications). Propagation then
        // lights up the transitively-grounded consequent: unknown → true.
        const result = eng.evaluate({
            variables: defaults,
            operatorAssignments: {
                [a.implId]: "accepted",
                [b.implId]: "accepted",
            },
        })
        expect(result.ok).toBe(true)
        expect(result.assignment!.variables[b.qVarId]).toBe(true)
    })
})

// -- evaluateWithDefaults + axiom reconciliation --------------------------

describe("evaluateWithDefaults", () => {
    function citationGroundedArgument(): {
        eng: ArgumentEngine
        dVarId: string
    } {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { pe, qVarId } = buildDerivation(eng, derived.id, {
            op: "var",
            claimId: "cite",
        })
        eng.setConclusionPremise(pe.getId())
        return { eng, dVarId: qVarId }
    }

    it("grades a fully citation-grounded valid argument as a non-counterexample (sound) under defaults", () => {
        const { eng } = citationGroundedArgument()
        const result = eng.evaluateWithDefaults()
        expect(result.ok).toBe(true)
        expect(result.premisesHoldConclusionFalse).not.toBe(true)
        expect(gradeEvaluation(result).grade).toBe("sound")
    })

    it("reconciles with the axiomatic force-true pre-pass (no AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN)", () => {
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "axiom", type: "axiomatic" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { pe } = buildDerivation(eng, derived.id, {
            op: "var",
            claimId: "axiom",
        })
        eng.setConclusionPremise(pe.getId())

        // The derived map reports the axiom as `true`; feeding that raw map to
        // evaluate() is rejected because axioms are force-set by the engine.
        expect(() =>
            eng.evaluate({
                variables: eng.deriveDefaultAssignment(),
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)

        // evaluateWithDefaults drops the default-sourced axiom key, so the
        // pre-pass and the defaults agree without conflict.
        const result = eng.evaluateWithDefaults()
        expect(result.ok).toBe(true)
        expect(result.premisesHoldConclusionFalse).not.toBe(true)
    })

    it("keeps default-sourced citation keys (citations are free, not engine-forced — the explicit true is load-bearing)", () => {
        // Asymmetry with axioms: the engine does NOT force citation-bound
        // variables true and does NOT reject an explicit citation assignment.
        // So deriveDefaultAssignment's citation=true must reach evaluate as a
        // real assignment — dropping it (as axiom keys are dropped) would leave
        // the citation unknown. This test fails if citation keys are dropped.
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { pe } = buildDerivation(eng, derived.id, {
            op: "var",
            claimId: "cite",
        })
        eng.setConclusionPremise(pe.getId())
        const citeVarId = eng.getVariableIdForClaim("cite")!

        // Unlike an axiom key, an explicit citation assignment is accepted
        // (no AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN) — proving citations are free.
        expect(() =>
            eng.evaluate({
                variables: { [citeVarId]: true },
                operatorAssignments: {},
            })
        ).not.toThrow()

        // evaluateWithDefaults keeps the citation=true in the effective
        // assignment (it is not stripped the way axiom defaults are).
        const result = eng.evaluateWithDefaults()
        expect(result.ok).toBe(true)
        expect(result.assignment!.variables[citeVarId]).toBe(true)
    })

    it("applies caller overrides over the derived defaults", () => {
        const { eng, dVarId } = citationGroundedArgument()
        const overrides: TCoreVariableAssignment = { [dVarId]: false }
        const result = eng.evaluateWithDefaults(overrides)
        expect(result.ok).toBe(true)
        // Default would have made the conclusion true; the override flips it.
        expect(result.conclusionTrue).toBe(false)
    })
})

// -- claimId ↔ variableId accessors ---------------------------------------

describe("claimId ↔ variableId accessors", () => {
    it("round-trips a claim-bound variable", () => {
        const { eng, claimLib } = makeEngine()
        const c = claimLib.create({ id: "d", type: "normal" })
        const v = eng.ensureClaimBoundVariable(c.id)
        expect(eng.getVariableIdForClaim(c.id)).toBe(v.id)
        expect(eng.getClaimIdForVariable(v.id)).toBe(c.id)
    })

    it("returns undefined for an unknown claim id", () => {
        const { eng } = makeEngine()
        expect(eng.getVariableIdForClaim("nope")).toBeUndefined()
    })

    it("returns undefined for a premise-bound variable", () => {
        const { eng } = makeEngine()
        const { result: pe } = eng.createPremise()
        const premiseBound = eng.getVariablesBoundToPremise(pe.getId())[0]
        expect(premiseBound).toBeDefined()
        expect(eng.getClaimIdForVariable(premiseBound.id)).toBeUndefined()
    })
})

// -- gradeEvaluation precedence -------------------------------------------

const TRIVALENT: (TCoreTrivalentValue | undefined)[] = [
    true,
    false,
    null,
    undefined,
]

function vacuousConclusion(): TCorePremiseEvaluationResult {
    return {
        premiseId: "p-conclusion",
        premiseType: "inference",
        rootExpressionId: "x-root",
        rootValue: true,
        expressionValues: {},
        variableValues: {},
        inferenceDiagnostic: {
            kind: "implies",
            premiseId: "p-conclusion",
            rootExpressionId: "x-root",
            leftValue: false,
            rightValue: null,
            rootValue: true,
            antecedentTrue: false,
            consequentTrue: null,
            isVacuouslyTrue: true,
            fired: false,
            firedAndHeld: false,
        },
    }
}

/** The grade the specification requires, independent of the implementation. */
function expectedGrade(
    survivingSupportingPremisesTrue: TCoreTrivalentValue | undefined,
    conclusionTrue: TCoreTrivalentValue | undefined,
    premisesHoldConclusionFalse: TCoreTrivalentValue | undefined,
    isAdmissibleAssignment: TCoreTrivalentValue | undefined,
    conclusionIsVacuous: boolean
): TCoreEvaluationGrade {
    if (isAdmissibleAssignment === false) return "inadmissible"
    if (survivingSupportingPremisesTrue === false) return "unsound"
    if (premisesHoldConclusionFalse === true) return "counterexample"
    // Soundness requires premises known true; unknown or absent is not true.
    if (survivingSupportingPremisesTrue !== true) return "indeterminate"
    if (conclusionTrue !== true) return "indeterminate"
    return conclusionIsVacuous ? "vacuously-true" : "sound"
}

describe("gradeEvaluation — soundness requires true premises", () => {
    it("walks every trivalent permutation", () => {
        for (const survivingSupportingPremisesTrue of TRIVALENT) {
            for (const conclusionTrue of TRIVALENT) {
                for (const premisesHoldConclusionFalse of TRIVALENT) {
                    for (const isAdmissibleAssignment of TRIVALENT) {
                        for (const conclusionIsVacuous of [false, true]) {
                            const result: TCoreArgumentEvaluationResult = {
                                ok: true,
                                survivingSupportingPremisesTrue,
                                conclusionTrue,
                                premisesHoldConclusionFalse,
                                isAdmissibleAssignment,
                                conclusion: conclusionIsVacuous
                                    ? vacuousConclusion()
                                    : undefined,
                            }
                            const expected = expectedGrade(
                                survivingSupportingPremisesTrue,
                                conclusionTrue,
                                premisesHoldConclusionFalse,
                                isAdmissibleAssignment,
                                conclusionIsVacuous
                            )
                            expect({
                                survivingSupportingPremisesTrue,
                                conclusionTrue,
                                premisesHoldConclusionFalse,
                                isAdmissibleAssignment,
                                conclusionIsVacuous,
                                grade: gradeEvaluation(result).grade,
                            }).toEqual({
                                survivingSupportingPremisesTrue,
                                conclusionTrue,
                                premisesHoldConclusionFalse,
                                isAdmissibleAssignment,
                                conclusionIsVacuous,
                                grade: expected,
                            })
                        }
                    }
                }
            }
        }
    })

    it("unknown premises with a true conclusion are indeterminate, not sound", () => {
        const grading = gradeEvaluation({
            ok: true,
            survivingSupportingPremisesTrue: null,
            conclusionTrue: true,
        })
        expect(grading.grade).toBe("indeterminate")
    })

    it("unknown premises with a vacuously true conclusion are indeterminate", () => {
        const grading = gradeEvaluation({
            ok: true,
            survivingSupportingPremisesTrue: null,
            conclusionTrue: true,
            conclusion: vacuousConclusion(),
        })
        expect(grading.grade).toBe("indeterminate")
    })

    it("treats an absent survivingSupportingPremisesTrue as unknown", () => {
        const grading = gradeEvaluation({ ok: true, conclusionTrue: true })
        expect(grading.grade).toBe("indeterminate")
    })

    it("true premises with a true conclusion stay sound", () => {
        const grading = gradeEvaluation({
            ok: true,
            survivingSupportingPremisesTrue: true,
            conclusionTrue: true,
        })
        expect(grading.grade).toBe("sound")
    })

    it("true premises with a vacuously true conclusion stay vacuously true", () => {
        const grading = gradeEvaluation({
            ok: true,
            survivingSupportingPremisesTrue: true,
            conclusionTrue: true,
            conclusion: vacuousConclusion(),
        })
        expect(grading.grade).toBe("vacuously-true")
    })

    it("an argument with zero supporting premises grades sound", () => {
        // Decided behavior: the supporting-premise fold is seeded true, so an
        // argument with nothing to support grades sound rather than unknown.
        const { eng, claimLib } = makeEngine()
        claimLib.create({ id: "cite", type: "citation" })
        const derived = claimLib.create({ id: "d", type: "normal" })
        const { pe } = buildDerivation(eng, derived.id, {
            op: "var",
            claimId: "cite",
        })
        eng.setConclusionPremise(pe.getId())
        const result = eng.evaluateWithDefaults()
        expect(result.supportingPremises ?? []).toHaveLength(0)
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(gradeEvaluation(result).grade).toBe("sound")
    })
})
