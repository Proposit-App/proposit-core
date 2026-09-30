import { describe, expect, it } from "vitest"
import { ArgumentEngine, PremiseEngine } from "../../src/lib/index"
import {
    CONTESTED,
    type TCoreExpressionAssignment,
} from "../../src/lib/types/evaluation"
import {
    belnapNot,
    belnapAnd,
    belnapOr,
    belnapImplies,
    belnapIff,
} from "../../src/lib/core/evaluation/belnap"
import {
    propagateOperatorConstraints,
    evaluateArgument,
    checkArgumentValidity,
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "../../src/lib/core/evaluation/argument-evaluation"
import {
    ARG,
    aLib,
    makeVar,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
    VAR_R,
    type TVariableInput,
} from "./fixtures"

describe("ArgumentEngine — roles and evaluation", () => {
    function buildPremiseP(pm: PremiseEngine) {
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
    }

    function buildPremiseQ(pm: PremiseEngine) {
        pm.addExpression(makeVarExpr(`${pm.getId()}-q`, VAR_Q.id))
    }

    function buildPremiseImplies(pm: PremiseEngine) {
        const rootId = `${pm.getId()}-impl`
        pm.addExpression(makeOpExpr(rootId, "implies"))
        pm.addExpression(
            makeVarExpr(`${rootId}-p`, VAR_P.id, {
                parentId: rootId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${rootId}-q`, VAR_Q.id, {
                parentId: rootId,
                position: 1,
            })
        )
    }

    it("supports role APIs and auto-reassigns conclusion to lowest-id remaining premise when conclusion is deleted (invariant guard)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "support" })
        const { result: conclusion } = eng.createPremise({
            title: "conclusion",
        })
        buildPremiseImplies(support)
        buildPremiseImplies(conclusion)

        eng.setConclusionPremise(conclusion.getId())

        // support is an inference premise and not the conclusion, so it is automatically supporting
        expect(eng.listSupportingPremises().map((pm) => pm.getId())).toEqual([
            support.getId(),
        ])
        expect(eng.getRoleState()).toMatchObject({
            conclusionPremiseId: conclusion.getId(),
        })

        // Removing the conclusion while other premises remain must not
        // leave `conclusionPremiseId` undefined (that would trip E-7):
        // the invariant guard auto-reassigns conclusion to the lowest-id
        // remaining premise — here, `support` is the only premise
        // left, so it becomes the new conclusion.
        eng.removePremise(conclusion.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBe(support.getId())
        // E-7 stays satisfied across the delete.
        expect(
            eng.validate("evaluable").filter((v) => v.code === "E-7")
        ).toEqual([])
    })

    it("clears conclusion when removing the last remaining premise (zero-premise post-state is empty-argument case)", () => {
        // The complement of the previous test: when removing the
        // conclusion empties the argument, the invariant is vacuously
        // satisfied and `conclusionPremiseId` is cleared as before.
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: only } = eng.createPremise({ title: "only" })
        eng.setConclusionPremise(only.getId())
        eng.removePremise(only.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBeUndefined()
        expect(eng.listPremiseIds()).toEqual([])
        // Zero-premise argument: E-7 vacuous.
        expect(
            eng.validate("evaluable").filter((v) => v.code === "E-7")
        ).toEqual([])
    })

    it("prevents duplicate variable symbols at the engine level", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })

        const varA = makeVar("var-a", "X")
        const varB = makeVar("var-b", "X")

        eng.addVariable(varA)
        // Shared VariableManager enforces unique symbols
        expect(() => eng.addVariable(varB)).toThrow(/already exists/)
    })

    it("evaluates an assignment and identifies inadmissible non-counterexamples", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        const { result: constraint } = eng.createPremise({ title: "P" })

        buildPremiseImplies(support)
        buildPremiseQ(conclusion)
        buildPremiseP(constraint)

        eng.setConclusionPremise(conclusion.getId())

        const result = eng.evaluate({
            variables: { [VAR_P.id]: false, [VAR_Q.id]: false },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(false)
        expect(result.premisesHoldConclusionFalse).toBe(false)
        expect(result.constraintPremises).toHaveLength(1)
    })

    it("finds a counterexample for an invalid argument", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        buildPremiseImplies(support)
        buildPremiseQ(conclusion)

        eng.setConclusionPremise(conclusion.getId())
        // support has implies root → automatically supporting

        const validity = eng.checkValidity({ mode: "firstCounterexample" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(false)
        expect(validity.counterexamples).toHaveLength(1)
        expect(
            validity.counterexamples?.[0]?.assignment.variables
        ).toMatchObject({
            [VAR_P.id]: false,
            [VAR_Q.id]: false,
        })
    })

    it("proves modus ponens form valid", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support1 } = eng.createPremise({ title: "P->Q" })
        const { result: support2 } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        buildPremiseImplies(support1)
        buildPremiseP(support2)
        buildPremiseQ(conclusion)

        eng.setConclusionPremise(conclusion.getId())
        // support1 (P->Q) has implies root → automatically supporting
        // support2 (P) is a constraint (variable root, not inference)

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(true)
        expect(validity.counterexamples).toEqual([])
        expect(validity.numAssignmentsChecked).toBe(4)
    })
})

describe("ArgumentEngine — complex argument scenarios across multiple evaluations", () => {
    function addVars(eng: ArgumentEngine, ...vars: TVariableInput[]) {
        for (const v of vars) {
            try {
                eng.addVariable(v)
            } catch {
                // Variable may already be registered; ignore duplicates
            }
        }
    }

    function buildVarRoot(
        pm: PremiseEngine,
        exprId: string,
        variableId: string
    ) {
        pm.addExpression(makeVarExpr(exprId, variableId))
    }

    function buildNotRoot(
        pm: PremiseEngine,
        rootId: string,
        childExprId: string,
        variableId: string
    ) {
        pm.addExpression(makeOpExpr(rootId, "not"))
        pm.addExpression(
            makeVarExpr(childExprId, variableId, {
                parentId: rootId,
                position: 0,
            })
        )
    }

    function buildBinaryRoot(
        pm: PremiseEngine,
        rootId: string,
        operator: "and" | "or" | "implies" | "iff",
        left: { exprId: string; variableId: string },
        right: { exprId: string; variableId: string }
    ) {
        pm.addExpression(makeOpExpr(rootId, operator))
        pm.addExpression(
            makeVarExpr(left.exprId, left.variableId, {
                parentId: rootId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(right.exprId, right.variableId, {
                parentId: rootId,
                position: 1,
            })
        )
    }

    function summarizeEvaluation(
        eng: ArgumentEngine,
        variables: Record<string, boolean>
    ) {
        const result = eng.evaluate({
            variables,
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        return {
            assignment: variables,
            admissible: result.isAdmissibleAssignment,
            supportsTrue: result.survivingSupportingPremisesTrue,
            conclusionTrue: result.conclusionTrue,
            counterexample: result.premisesHoldConclusionFalse,
        }
    }

    function classifyAtActualAssignment(
        eng: ArgumentEngine,
        variables: Record<string, boolean>
    ) {
        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)

        const evaluation = eng.evaluate({
            variables,
            operatorAssignments: {},
        })
        expect(evaluation.ok).toBe(true)

        const premisesTrue =
            evaluation.isAdmissibleAssignment === true &&
            evaluation.survivingSupportingPremisesTrue === true
        const conclusionTrue = evaluation.conclusionTrue === true

        return {
            isValid: validity.isValid === true,
            isSound:
                validity.isValid === true && premisesTrue && conclusionTrue,
            isUnsound:
                validity.isValid !== true || !premisesTrue || !conclusionTrue,
            premisesTrue,
            conclusionTrue,
        }
    }

    it("affirming the consequent shows multiple evaluation outcomes and a single counterexample", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        addVars(eng, VAR_P, VAR_Q)
        const { result: pImpliesQ } = eng.createPremise({ title: "P -> Q" })
        const { result: qPremise } = eng.createPremise({ title: "Q" })
        const { result: pConclusion } = eng.createPremise({ title: "P" })

        buildBinaryRoot(
            pImpliesQ,
            "impl-p-q",
            "implies",
            { exprId: "impl-p-q-left", variableId: VAR_P.id },
            { exprId: "impl-p-q-right", variableId: VAR_Q.id }
        )
        buildVarRoot(qPremise, "q-root", VAR_Q.id)
        buildVarRoot(pConclusion, "p-root", VAR_P.id)

        eng.setConclusionPremise(pConclusion.getId())
        // pImpliesQ has implies root → automatically supporting
        // qPremise has variable root → constraint

        const summaries = [
            summarizeEvaluation(eng, { [VAR_P.id]: false, [VAR_Q.id]: false }),
            summarizeEvaluation(eng, { [VAR_P.id]: false, [VAR_Q.id]: true }),
            summarizeEvaluation(eng, { [VAR_P.id]: true, [VAR_Q.id]: true }),
        ]

        expect(summaries).toEqual([
            {
                assignment: { [VAR_P.id]: false, [VAR_Q.id]: false },
                admissible: false,
                supportsTrue: true,
                conclusionTrue: false,
                counterexample: false,
            },
            {
                assignment: { [VAR_P.id]: false, [VAR_Q.id]: true },
                admissible: true,
                supportsTrue: true,
                conclusionTrue: false,
                counterexample: true,
            },
            {
                assignment: { [VAR_P.id]: true, [VAR_Q.id]: true },
                admissible: true,
                supportsTrue: true,
                conclusionTrue: true,
                counterexample: false,
            },
        ])

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(false)
        expect(validity.counterexamples).toHaveLength(1)
        expect(
            validity.counterexamples?.[0]?.assignment.variables
        ).toMatchObject({
            [VAR_P.id]: false,
            [VAR_Q.id]: true,
        })

        const actualWorld = classifyAtActualAssignment(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
        })
        expect(actualWorld.isValid).toBe(false)
        expect(actualWorld.isSound).toBe(false)
        expect(actualWorld.isUnsound).toBe(true)
        expect(actualWorld.premisesTrue).toBe(true)
        expect(actualWorld.conclusionTrue).toBe(true)
    })

    it("a constrained transitive argument mixes admissible/inadmissible assignments and remains valid", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pImpliesQ } = eng.createPremise({ title: "P -> Q" })
        const { result: qImpliesR } = eng.createPremise({ title: "Q -> R" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: rConclusion } = eng.createPremise({ title: "R" })
        const { result: constraintNotR } = eng.createPremise({ title: "not R" })

        addVars(eng, VAR_P, VAR_Q, VAR_R)

        buildBinaryRoot(
            pImpliesQ,
            "root-p-q",
            "implies",
            { exprId: "root-p-q-left", variableId: VAR_P.id },
            { exprId: "root-p-q-right", variableId: VAR_Q.id }
        )
        buildBinaryRoot(
            qImpliesR,
            "root-q-r",
            "implies",
            { exprId: "root-q-r-left", variableId: VAR_Q.id },
            { exprId: "root-q-r-right", variableId: VAR_R.id }
        )
        buildVarRoot(pPremise, "root-p", VAR_P.id)
        buildVarRoot(rConclusion, "root-r", VAR_R.id)
        buildNotRoot(constraintNotR, "root-not-r", "root-not-r-child", VAR_R.id)

        eng.setConclusionPremise(rConclusion.getId())
        // pImpliesQ and qImpliesR have implies roots → automatically supporting
        // pPremise has variable root → constraint (along with constraintNotR)

        const evalInadmissible = summarizeEvaluation(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
            [VAR_R.id]: true,
        })
        const evalAdmissibleCounterexampleCandidate = summarizeEvaluation(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
            [VAR_R.id]: false,
        })
        const evalInadmissiblePremiseFalse = summarizeEvaluation(eng, {
            [VAR_P.id]: false,
            [VAR_Q.id]: false,
            [VAR_R.id]: false,
        })

        expect(evalInadmissible.admissible).toBe(false)
        expect(evalInadmissible.counterexample).toBe(false)

        expect(evalAdmissibleCounterexampleCandidate.admissible).toBe(true)
        expect(evalAdmissibleCounterexampleCandidate.supportsTrue).toBe(false)
        expect(evalAdmissibleCounterexampleCandidate.counterexample).toBe(false)

        // P is now a constraint, so P=false makes this inadmissible
        expect(evalInadmissiblePremiseFalse.admissible).toBe(false)
        expect(evalInadmissiblePremiseFalse.conclusionTrue).toBe(false)

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(true)
        expect(validity.counterexamples).toEqual([])
        expect(validity.numAssignmentsChecked).toBe(8)
        // Only P=true AND R=false are admissible (2 of 8)
        expect(validity.numAdmissibleAssignments).toBe(2)
    })

    it("distinguishes valid+sound from valid+unsound using a designated actual assignment", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pImpliesQ } = eng.createPremise({ title: "P -> Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: qConclusion } = eng.createPremise({ title: "Q" })

        addVars(eng, VAR_P, VAR_Q)

        buildBinaryRoot(
            pImpliesQ,
            "mp-root",
            "implies",
            { exprId: "mp-left", variableId: VAR_P.id },
            { exprId: "mp-right", variableId: VAR_Q.id }
        )
        buildVarRoot(pPremise, "mp-p", VAR_P.id)
        buildVarRoot(qConclusion, "mp-q", VAR_Q.id)

        eng.setConclusionPremise(qConclusion.getId())
        // pImpliesQ has implies root → automatically supporting
        // pPremise has variable root → constraint

        const soundCase = classifyAtActualAssignment(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
        })
        expect(soundCase).toMatchObject({
            isValid: true,
            isSound: true,
            isUnsound: false,
            premisesTrue: true,
            conclusionTrue: true,
        })

        const unsoundCase = classifyAtActualAssignment(eng, {
            [VAR_P.id]: false,
            [VAR_Q.id]: false,
        })
        expect(unsoundCase).toMatchObject({
            isValid: true,
            isSound: false,
            isUnsound: true,
            premisesTrue: false,
            conclusionTrue: false,
        })
    })
})

// ---------------------------------------------------------------------------
// Four-valued logic helpers
// ---------------------------------------------------------------------------

describe("four-valued logic helpers", () => {
    describe("belnapNot", () => {
        it("NOT true = false", () => {
            expect(belnapNot(true)).toBe(false)
        })

        it("NOT false = true", () => {
            expect(belnapNot(false)).toBe(true)
        })

        it("NOT null = null", () => {
            expect(belnapNot(null)).toBeNull()
        })
    })

    describe("belnapAnd", () => {
        it("true AND true = true", () => {
            expect(belnapAnd(true, true)).toBe(true)
        })

        it("true AND false = false", () => {
            expect(belnapAnd(true, false)).toBe(false)
        })

        it("true AND null = null", () => {
            expect(belnapAnd(true, null)).toBeNull()
        })

        it("false AND true = false", () => {
            expect(belnapAnd(false, true)).toBe(false)
        })

        it("false AND false = false", () => {
            expect(belnapAnd(false, false)).toBe(false)
        })

        it("false AND null = false", () => {
            expect(belnapAnd(false, null)).toBe(false)
        })

        it("null AND true = null", () => {
            expect(belnapAnd(null, true)).toBeNull()
        })

        it("null AND false = false", () => {
            expect(belnapAnd(null, false)).toBe(false)
        })

        it("null AND null = null", () => {
            expect(belnapAnd(null, null)).toBeNull()
        })
    })

    describe("belnapOr", () => {
        it("true OR true = true", () => {
            expect(belnapOr(true, true)).toBe(true)
        })

        it("true OR false = true", () => {
            expect(belnapOr(true, false)).toBe(true)
        })

        it("true OR null = true", () => {
            expect(belnapOr(true, null)).toBe(true)
        })

        it("false OR true = true", () => {
            expect(belnapOr(false, true)).toBe(true)
        })

        it("false OR false = false", () => {
            expect(belnapOr(false, false)).toBe(false)
        })

        it("false OR null = null", () => {
            expect(belnapOr(false, null)).toBeNull()
        })

        it("null OR true = true", () => {
            expect(belnapOr(null, true)).toBe(true)
        })

        it("null OR false = null", () => {
            expect(belnapOr(null, false)).toBeNull()
        })

        it("null OR null = null", () => {
            expect(belnapOr(null, null)).toBeNull()
        })
    })

    describe("belnapImplies", () => {
        it("true -> true = true", () => {
            expect(belnapImplies(true, true)).toBe(true)
        })

        it("true -> false = false", () => {
            expect(belnapImplies(true, false)).toBe(false)
        })

        it("true -> null = null", () => {
            expect(belnapImplies(true, null)).toBeNull()
        })

        it("false -> true = true", () => {
            expect(belnapImplies(false, true)).toBe(true)
        })

        it("false -> false = true", () => {
            expect(belnapImplies(false, false)).toBe(true)
        })

        it("false -> null = true", () => {
            expect(belnapImplies(false, null)).toBe(true)
        })

        it("null -> true = true", () => {
            expect(belnapImplies(null, true)).toBe(true)
        })

        it("null -> false = null", () => {
            expect(belnapImplies(null, false)).toBeNull()
        })

        it("null -> null = null", () => {
            expect(belnapImplies(null, null)).toBeNull()
        })
    })

    describe("belnapIff", () => {
        it("true <-> true = true", () => {
            expect(belnapIff(true, true)).toBe(true)
        })

        it("true <-> false = false", () => {
            expect(belnapIff(true, false)).toBe(false)
        })

        it("true <-> null = null", () => {
            expect(belnapIff(true, null)).toBeNull()
        })

        it("false <-> true = false", () => {
            expect(belnapIff(false, true)).toBe(false)
        })

        it("false <-> false = true", () => {
            expect(belnapIff(false, false)).toBe(true)
        })

        it("false <-> null = null", () => {
            expect(belnapIff(false, null)).toBeNull()
        })

        it("null <-> true = null", () => {
            expect(belnapIff(null, true)).toBeNull()
        })

        it("null <-> false = null", () => {
            expect(belnapIff(null, false)).toBeNull()
        })

        it("null <-> null = null", () => {
            expect(belnapIff(null, null)).toBeNull()
        })
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine — three-valued evaluation
// ---------------------------------------------------------------------------

describe("PremiseEngine — three-valued evaluation", () => {
    it("evaluates unset variables as null", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        // Single variable expression as root
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const assignment: TCoreExpressionAssignment = {
            variables: { "var-p": null },
            operatorAssignments: {},
        }
        const result = pm.evaluate(assignment)
        expect(result.rootValue).toBeNull()
        expect(result.expressionValues["e-p"]).toBeNull()
    })

    it("missing variables default to null", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const assignment: TCoreExpressionAssignment = {
            variables: {},
            operatorAssignments: {},
        }
        const result = pm.evaluate(assignment)
        expect(result.rootValue).toBeNull()
        expect(result.expressionValues["e-p"]).toBeNull()
    })

    it("propagates null through AND (Kleene)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // (P and Q) as root
        pm.addExpression(makeOpExpr("and-root", "and"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-root", position: 1 })
        )

        // true AND null = null
        const r1 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            operatorAssignments: {},
        })
        expect(r1.rootValue).toBeNull()

        // false AND null = false
        const r2 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            operatorAssignments: {},
        })
        expect(r2.rootValue).toBe(false)
    })

    it("propagates null through OR (Kleene)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("or-root", "or"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "or-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "or-root", position: 1 })
        )

        // true OR null = true
        const r1 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            operatorAssignments: {},
        })
        expect(r1.rootValue).toBe(true)

        // false OR null = null
        const r2 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            operatorAssignments: {},
        })
        expect(r2.rootValue).toBeNull()
    })

    it("propagates null through implies (Kleene)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("imp-root", "implies"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "imp-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "imp-root", position: 1 })
        )

        // false implies null = true
        const r1 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            operatorAssignments: {},
        })
        expect(r1.rootValue).toBe(true)

        // null implies true = true
        const r2 = pm.evaluate({
            variables: { "var-p": null, "var-q": true },
            operatorAssignments: {},
        })
        expect(r2.rootValue).toBe(true)

        // true implies null = null
        const r3 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            operatorAssignments: {},
        })
        expect(r3.rootValue).toBeNull()
    })

    it("evaluates a rejected operator normally rather than forcing it false", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // (P and Q)
        pm.addExpression(makeOpExpr("and-root", "and"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-root", position: 1 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true, "var-q": true },
            operatorAssignments: { "and-root": "rejected" },
        })
        // A rejection is a decision about the step, not a truth value: the
        // premise still evaluates from its variables.
        expect(result.rootValue).toBe(true)
        expect(result.expressionValues["e-p"]).toBe(true)
        expect(result.expressionValues["e-q"]).toBe(true)
    })

    it("evaluates a rejected formula wrapper normally", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        // (P) as root formula wrapping variable
        pm.addExpression(makeFormulaExpr("f-root"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "f-root", position: 0 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true },
            operatorAssignments: { "f-root": "rejected" },
        })
        expect(result.rootValue).toBe(true)
        expect(result.expressionValues["e-p"]).toBe(true)
    })

    it("leaves a parent unchanged when a nested operator is rejected", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        // (P and Q) or R — with formula buffer between or and and
        pm.addExpression(makeOpExpr("or-root", "or"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "or-root",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("and-child", "and", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-child", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-child", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-r", "var-r", { parentId: "or-root", position: 1 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true, "var-q": true, "var-r": true },
            operatorAssignments: { "and-child": "rejected" },
        })
        expect(result.rootValue).toBe(true)
        // The rejected AND still evaluates from its children.
        expect(result.expressionValues["and-child"]).toBe(true)
        expect(result.expressionValues["e-p"]).toBe(true)
        expect(result.expressionValues["e-q"]).toBe(true)
        expect(result.expressionValues["e-r"]).toBe(true)
    })

    it("still reports an inference diagnostic for a rejected inference root", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // P implies Q
        pm.addExpression(makeOpExpr("imp", "implies"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "imp", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "imp", position: 1 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true, "var-q": true },
            operatorAssignments: { imp: "rejected" },
        })
        expect(result.rootValue).toBe(true)
        expect(result.inferenceDiagnostic?.kind).toBe("implies")
        expect(result.expressionValues["e-p"]).toBe(true)
        expect(result.expressionValues["e-q"]).toBe(true)
    })
})

describe("ArgumentEngine — three-valued evaluation", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")

    function buildSimpleArgument() {
        // A implies B (conclusion), C implies A (supporting), D (constraint)
        const engine = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable(VAR_A)
        engine.addVariable(VAR_B)
        engine.addVariable(VAR_C)
        engine.addVariable(VAR_D)

        const { result: conclusion } = engine.createPremise({
            title: "conclusion",
        })
        conclusion.addExpression(makeOpExpr("c-imp", "implies"))
        conclusion.addExpression(
            makeVarExpr("c-a", VAR_A.id, { parentId: "c-imp", position: 0 })
        )
        conclusion.addExpression(
            makeVarExpr("c-b", VAR_B.id, { parentId: "c-imp", position: 1 })
        )

        const { result: supporting } = engine.createPremise({
            title: "supporting",
        })
        supporting.addExpression(makeOpExpr("s-imp", "implies"))
        supporting.addExpression(
            makeVarExpr("s-c", VAR_C.id, { parentId: "s-imp", position: 0 })
        )
        supporting.addExpression(
            makeVarExpr("s-a", VAR_A.id, { parentId: "s-imp", position: 1 })
        )

        const { result: constraint } = engine.createPremise({
            title: "constraint",
        })
        constraint.addExpression(makeVarExpr("d-var", VAR_D.id))

        engine.setConclusionPremise(conclusion.getId())
        // supporting has implies root → automatically supporting

        return { engine }
    }

    it("returns null for isAdmissibleAssignment when constraint is null", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: true,
                [VAR_C.id]: true,
                [VAR_D.id]: null,
            },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(null)
    })

    it("returns null for premisesHoldConclusionFalse when conclusion is null", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: null,
                [VAR_C.id]: true,
                [VAR_D.id]: true,
            },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(true)
        expect(result.conclusionTrue).toBe(null)
        expect(result.premisesHoldConclusionFalse).toBe(null)
    })

    it("ignores a rejection recorded against the conclusion premise", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: true,
                [VAR_C.id]: true,
                [VAR_D.id]: true,
            },
            operatorAssignments: { "c-imp": "rejected" },
        })
        expect(result.ok).toBe(true)
        expect(result.conclusionTrue).toBe(true)
        expect(result.struckPremiseIds).toEqual([])
    })
})

describe("evaluateArgument (standalone)", () => {
    it("is exported from the library", async () => {
        const mod = await import("../../src/lib/index.js")
        expect(typeof mod.evaluateArgument).toBe("function")
        expect(typeof mod.checkArgumentValidity).toBe("function")
        expect(typeof mod.propagateOperatorConstraints).toBe("function")
    })

    /** Build an engine with P, Q variables and a P->Q supporting premise plus a Q conclusion. */
    function buildModusPonensEngine() {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })

        // Build P->Q
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-p`, VAR_P.id, {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-q`, VAR_Q.id, {
                parentId: implId,
                position: 1,
            })
        )

        // Build P (constraint)
        pPremise.addExpression(makeVarExpr(`${pPremise.getId()}-p`, VAR_P.id))

        // Build Q (conclusion)
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
        )

        eng.setConclusionPremise(conclusion.getId())
        return eng
    }

    function ctxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    describe("propagateOperatorConstraints", () => {
        it("propagates accepted AND: all children become true", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm } = eng.createPremise({ title: "P and Q" })
            const andId = `${pm.getId()}-and`
            pm.addExpression(makeOpExpr(andId, "and"))
            pm.addExpression(
                makeVarExpr(`${andId}-p`, VAR_P.id, {
                    parentId: andId,
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr(`${andId}-q`, VAR_Q.id, {
                    parentId: andId,
                    position: 1,
                })
            )
            const ctx = ctxFrom(eng)
            const result = propagateOperatorConstraints(ctx, {
                variables: {},
                operatorAssignments: { [andId]: "accepted" },
            })
            expect(result[VAR_P.id]).toBe(true)
            expect(result[VAR_Q.id]).toBe(true)
        })

        it("propagates nothing from a rejected OR", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm } = eng.createPremise({ title: "P or Q" })
            const orId = `${pm.getId()}-or`
            pm.addExpression(makeOpExpr(orId, "or"))
            pm.addExpression(
                makeVarExpr(`${orId}-p`, VAR_P.id, {
                    parentId: orId,
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr(`${orId}-q`, VAR_Q.id, {
                    parentId: orId,
                    position: 1,
                })
            )
            const ctx = ctxFrom(eng)
            const result = propagateOperatorConstraints(ctx, {
                variables: {},
                operatorAssignments: { [orId]: "rejected" },
            })
            expect(result[VAR_P.id] ?? null).toBeNull()
            expect(result[VAR_Q.id] ?? null).toBeNull()
        })

        it("merges a granted step with a contradicting reader assignment", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm } = eng.createPremise({ title: "P and Q" })
            const andId = `${pm.getId()}-and`
            pm.addExpression(makeOpExpr(andId, "and"))
            pm.addExpression(
                makeVarExpr(`${andId}-p`, VAR_P.id, {
                    parentId: andId,
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr(`${andId}-q`, VAR_Q.id, {
                    parentId: andId,
                    position: 1,
                })
            )
            const ctx = ctxFrom(eng)
            // User says P=false; the accepted conjunction forces P=true, so
            // the two reports merge into contested rather than one winning.
            const result = propagateOperatorConstraints(ctx, {
                variables: { [VAR_P.id]: false },
                operatorAssignments: { [andId]: "accepted" },
            })
            expect(result[VAR_P.id]).toBe(CONTESTED)
            expect(result[VAR_Q.id]).toBe(true)
        })

        it("returns unchanged variables when no operator assignments given", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            eng.addVariable(VAR_P)
            const { result: pm } = eng.createPremise({ title: "P" })
            pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
            const ctx = ctxFrom(eng)
            const result = propagateOperatorConstraints(ctx, {
                variables: { [VAR_P.id]: true },
                operatorAssignments: {},
            })
            expect(result[VAR_P.id]).toBe(true)
        })
    })

    describe("evaluateArgument", () => {
        it("evaluates modus ponens with P=true, Q=true as non-counterexample", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = evaluateArgument(ctx, {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: true },
                operatorAssignments: {},
            })
            expect(result.ok).toBe(true)
            expect(result.premisesHoldConclusionFalse).toBe(false)
        })

        it("returns validation failure when no conclusion is set", () => {
            // Build context manually with no conclusion premise
            const ctx: TArgumentEvaluationContext = {
                argumentId: "arg-1",
                conclusionPremiseId: undefined,
                getConclusionPremise: () => undefined,
                listSupportingPremises: () => [],
                listPremises: () => [],
                getVariable: () => undefined,
                getPremise: () => undefined,
                validateEvaluability: () => ({ ok: true, issues: [] }),
            }
            const result = evaluateArgument(ctx, {
                variables: {},
                operatorAssignments: {},
            })
            expect(result.ok).toBe(false)
            expect(result.validation!.issues[0].code).toBe(
                "ARGUMENT_NO_CONCLUSION"
            )
        })

        it("matches engine.evaluate() output exactly", () => {
            const eng = buildModusPonensEngine()
            const assignment = {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: false },
                operatorAssignments: {},
            }
            const engineResult = eng.evaluate(assignment)
            const ctx = ctxFrom(eng)
            const standaloneResult = evaluateArgument(ctx, assignment)
            expect(standaloneResult.ok).toBe(engineResult.ok)
            expect(standaloneResult.premisesHoldConclusionFalse).toBe(
                engineResult.premisesHoldConclusionFalse
            )
            expect(standaloneResult.conclusionTrue).toBe(
                engineResult.conclusionTrue
            )
            expect(standaloneResult.survivingSupportingPremisesTrue).toBe(
                engineResult.survivingSupportingPremisesTrue
            )
        })

        it("runs validateEvaluability when validateFirst is true (default)", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            // Empty engine with no premises — validateEvaluability will fail
            const ctx = ctxFrom(eng)
            const result = evaluateArgument(ctx, {
                variables: {},
                operatorAssignments: {},
            })
            expect(result.ok).toBe(false)
        })
    })

    describe("checkArgumentValidity", () => {
        it("proves modus ponens valid", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                mode: "exhaustive",
            })
            expect(result.ok).toBe(true)
            expect(result.isValid).toBe(true)
            expect(result.counterexamples).toEqual([])
            expect(result.numAssignmentsChecked).toBe(4) // 2^2 = 4
        })

        it("finds a counterexample for an invalid argument", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: support } = eng.createPremise({ title: "P->Q" })
            const { result: conclusion } = eng.createPremise({ title: "Q" })
            const implId = `${support.getId()}-impl`
            support.addExpression(makeOpExpr(implId, "implies"))
            support.addExpression(
                makeVarExpr(`${implId}-p`, VAR_P.id, {
                    parentId: implId,
                    position: 0,
                })
            )
            support.addExpression(
                makeVarExpr(`${implId}-q`, VAR_Q.id, {
                    parentId: implId,
                    position: 1,
                })
            )
            conclusion.addExpression(
                makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
            )
            eng.setConclusionPremise(conclusion.getId())
            // Missing P constraint premise — affirming the consequent is invalid
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                mode: "firstCounterexample",
            })
            expect(result.ok).toBe(true)
            expect(result.isValid).toBe(false)
            expect(result.counterexamples!.length).toBeGreaterThan(0)
        })

        it("matches engine.checkValidity() output", () => {
            const eng = buildModusPonensEngine()
            const engineResult = eng.checkValidity({ mode: "exhaustive" })
            const ctx = ctxFrom(eng)
            const standaloneResult = checkArgumentValidity(ctx, {
                mode: "exhaustive",
            })
            expect(standaloneResult.ok).toBe(engineResult.ok)
            expect(standaloneResult.isValid).toBe(engineResult.isValid)
            expect(standaloneResult.numAssignmentsChecked).toBe(
                engineResult.numAssignmentsChecked
            )
            expect(standaloneResult.numAdmissibleAssignments).toBe(
                engineResult.numAdmissibleAssignments
            )
        })

        it("respects maxVariables limit", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                maxVariables: 1,
            })
            expect(result.ok).toBe(false)
            expect(result.validation!.issues[0].code).toBe(
                "ASSIGNMENT_UNKNOWN_VARIABLE"
            )
        })

        it("respects maxAssignmentsChecked truncation", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                mode: "exhaustive",
                maxAssignmentsChecked: 2,
            })
            expect(result.ok).toBe(true)
            expect(result.numAssignmentsChecked).toBe(2)
            expect(result.truncated).toBe(true)
        })
    })
})

describe("evaluateArgument — propagatedVariableValues", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    function buildModusPonensEng() {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-p`, VAR_P.id, {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-q`, VAR_Q.id, {
                parentId: implId,
                position: 1,
            })
        )
        pPremise.addExpression(makeVarExpr(`${pPremise.getId()}-p`, VAR_P.id))
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
        )
        eng.setConclusionPremise(conclusion.getId())
        return { eng, implId }
    }

    it("pins unknown Q to true under accepted implies + P=true", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: null },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeDefined()
        expect(result.propagatedVariableValues![VAR_P.id]).toBe(true)
        expect(result.propagatedVariableValues![VAR_Q.id]).toBe(true)
    })

    it("is undefined when includeDiagnostics is false", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: null },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: false }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeUndefined()
    })

    it("represents still-unresolved variables as null (present in map)", () => {
        const { eng } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            { variables: {}, operatorAssignments: {} },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeDefined()
        expect(VAR_P.id in result.propagatedVariableValues!).toBe(true)
        expect(VAR_Q.id in result.propagatedVariableValues!).toBe(true)
        expect(result.propagatedVariableValues![VAR_P.id]).toBeNull()
        expect(result.propagatedVariableValues![VAR_Q.id]).toBeNull()
    })

    it("map key set equals referencedVariableIds", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        const keys = Object.keys(result.propagatedVariableValues!).sort()
        expect(keys).toEqual([...result.referencedVariableIds!].sort())
    })
})
