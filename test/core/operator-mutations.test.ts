import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import { type TCorePropositionalExpression } from "../../src/lib/schemata"
import type { TExpressionWithoutPosition } from "../../src/lib/core/expression-manager"
import {
    POSITION_MAX,
    POSITION_INITIAL,
    midpoint,
} from "../../src/lib/utils/position"
import {
    ARG,
    aLib,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
    VAR_R,
    premiseWithVars,
} from "./fixtures"

// ---------------------------------------------------------------------------
// wrapExpression
// ---------------------------------------------------------------------------

describe("wrapExpression", () => {
    // Helper: create a TExpressionWithoutPosition operator
    function wrapOp(
        id: string,
        operator: "not" | "and" | "or" | "implies" | "iff"
    ): TExpressionWithoutPosition {
        return {
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator,
            parentId: null,
        }
    }

    // Helper: create a TExpressionWithoutPosition variable
    function wrapVar(
        id: string,
        variableId: string
    ): TExpressionWithoutPosition {
        return {
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId,
            parentId: null,
        }
    }

    // Helper: create a TExpressionWithoutPosition formula
    function wrapFormula(id: string): TExpressionWithoutPosition {
        return {
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "formula",
            parentId: null,
        }
    }

    // --- Happy paths ---

    it("wraps root variable with 'and' operator, existing as left child", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // existing goes to position 0 (left)
        )
        // op-and → [expr-p(0), expr-q(1)]
        expect(pm.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("wraps root variable with 'or' operator, existing as right child", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // existing goes to position 1 (right)
        )
        // op-or → [expr-q(0), expr-p(1)]
        expect(pm.toDisplayString()).toBe("(Q ∨ P)")
    })

    it("wraps root variable with 'implies', existing as right (consequent)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-implies", "implies"),
            wrapVar("expr-f", VAR_Q.id),
            undefined,
            "expr-p" // P becomes consequent (position 1)
        )
        // op-implies → [expr-f(0), expr-p(1)] → "Q → P"
        expect(pm.toDisplayString()).toBe("(Q → P)")
    })

    it("wraps root variable with 'iff'", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-iff", "iff"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // existing as left
        )
        expect(pm.toDisplayString()).toBe("(P ↔ Q)")
    })

    it("wraps non-root node (child of a formula)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeFormulaExpr("formula-1"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "formula-1",
                position: 0,
            })
        )
        // Wrap expr-p with an 'or' and a new sibling R
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-r", VAR_R.id),
            "expr-p" // P goes left under op-or
        )
        // formula-1 → op-or(0) → [expr-p(0), expr-r(1)]
        expect(pm.toDisplayString()).toBe("((P ∨ R))")
    })

    it("new sibling can be a not operator expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // Wrap P with 'and', sibling is a 'not' operator (exempt from nesting restriction)
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapOp("op-not", "not"),
            "expr-p" // P is left
        )
        // Now add a variable inside the 'not' operator
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-not", position: 0 })
        )
        // op-and → [P(0), not(1) → [Q(0)]]
        expect(pm.toDisplayString()).toBe("(P ∧ ¬(Q))")
    })

    it("new sibling can be a formula expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(wrapOp("op-and", "and"), wrapFormula("f1"), "expr-p")
        // Add a variable inside the formula
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "f1", position: 0 })
        )
        // op-and → [expr-p(0), f1(1) → [expr-q(0)]]
        expect(pm.toDisplayString()).toBe("(P ∧ (Q))")
    })

    it("returns the stored operator as result", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const { result } = pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        expect(result.id).toBe("op-and")
        expect(result.type).toBe("operator")
        expect(result.parentId).toBeNull()
        expect(result.position).toBe(POSITION_INITIAL)
    })

    it("updates rootExpressionId when wrapping a root node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getRootExpressionId()).toBe("expr-p")
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        expect(pm.getRootExpressionId()).toBe("op-and")
    })

    // --- Changeset correctness ---

    it("changeset contains added operator, added sibling, and modified existing node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const { changes } = pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        const added = changes.expressions?.added ?? []
        const modified = changes.expressions?.modified ?? []
        expect(added.map((e) => e.id).sort()).toEqual(["expr-q", "op-and"])
        expect(modified.map((e) => e.id)).toEqual(["expr-p"])
    })

    // --- Validation errors ---

    it("throws when neither leftNodeId nor rightNodeId is provided", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-q", VAR_Q.id)
            )
        ).toThrow(/exactly one/)
    })

    it("throws when both leftNodeId and rightNodeId are provided", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-or", "or"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 1 })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-r", VAR_R.id),
                "expr-p",
                "expr-q"
            )
        ).toThrow(/exactly one.*not both/)
    })

    it("throws when operator expression ID already exists", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("expr-p", "and"), // same ID as existing
                wrapVar("expr-q", VAR_Q.id),
                "expr-p"
            )
        ).toThrow(/already exists/)
    })

    it("throws when sibling expression ID already exists", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-p", VAR_Q.id), // same ID as existing
                "expr-p"
            )
        ).toThrow(/already exists/)
    })

    it("throws when operator and sibling IDs are the same", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("same-id", "and"),
                wrapVar("same-id", VAR_Q.id),
                "expr-p"
            )
        ).toThrow(/must be different/)
    })

    it("throws when existing node does not exist", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-q", VAR_Q.id),
                "nonexistent"
            )
        ).toThrow(/does not exist/)
    })

    it("throws when operator is 'not' (unary)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-not", "not"),
                wrapVar("expr-q", VAR_Q.id),
                "expr-p"
            )
        ).toThrow(/unary/)
    })

    it("throws when operator type is not 'operator' (variable passed as operator)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapVar("bad-op", VAR_Q.id),
                wrapVar("expr-q", VAR_R.id),
                "expr-p"
            )
        ).toThrow(/must have type "operator"/)
    })

    it("throws when operator type is not 'operator' (formula passed as operator)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapFormula("bad-op"),
                wrapVar("expr-q", VAR_Q.id),
                "expr-p"
            )
        ).toThrow(/must have type "operator"/)
    })

    it("throws when implies operator wraps a non-root node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-implies", "implies"),
                wrapVar("expr-r", VAR_R.id),
                "expr-p" // expr-p is not a root
            )
        ).toThrow(/must be a root expression/)
    })

    it("throws when iff operator wraps a non-root node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-iff", "iff"),
                wrapVar("expr-r", VAR_R.id),
                "expr-p"
            )
        ).toThrow(/must be a root expression/)
    })

    it("throws when existing node is an implies operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-implies", "implies"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-implies",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-implies",
                position: 1,
            })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-r", VAR_R.id),
                "op-implies"
            )
        ).toThrow(/cannot be subordinated/)
    })

    it("throws when existing node is an iff operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-iff", "iff"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-iff",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-iff",
                position: 1,
            })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-r", VAR_R.id),
                "op-iff"
            )
        ).toThrow(/cannot be subordinated/)
    })

    it("throws when new sibling is an implies operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapOp("op-implies", "implies"),
                "expr-p"
            )
        ).toThrow(/cannot be subordinated/)
    })

    it("throws when new sibling is an iff operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapOp("op-iff", "iff"),
                "expr-p"
            )
        ).toThrow(/cannot be subordinated/)
    })

    it("throws when new sibling references a non-existent variable", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-x", "nonexistent-var"),
                "expr-p"
            )
        ).toThrow(/non-existent variable/)
    })

    // --- Integration ---

    it("wrap then evaluate produces correct truth table", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // P is root. Wrap to get "Q → P" (Q implies P)
        pm.wrapExpression(
            wrapOp("op-implies", "implies"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // P is right (consequent)
        )
        // Q=true, P=false → false (only false case for implies)
        const result = pm.evaluate({
            variables: { [VAR_Q.id]: true, [VAR_P.id]: false },
            operatorAssignments: {},
        })
        expect(result.rootValue).toBe(false)
        // Q=false, P=false → true
        const result2 = pm.evaluate({
            variables: { [VAR_Q.id]: false, [VAR_P.id]: false },
            operatorAssignments: {},
        })
        expect(result2.rootValue).toBe(true)
    })

    // Promoting the surviving child to root after wrapExpression +
    // removeExpression of one child is done by the AN-3 post-hook, not
    // by these primitives; AN-3's contract is covered by
    // `test/grammar/an-rules.test.ts`.

    it("children get midpoint-spaced positions, not consecutive integers", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // existing as left child
        )
        const children = pm.getChildExpressions("op-and")
        const left = children.find((c) => c.id === "expr-p")!
        const right = children.find((c) => c.id === "expr-q")!

        // Left should be POSITION_INITIAL (0), right should be midpoint(0, POSITION_MAX)
        expect(left.position).toBe(POSITION_INITIAL)
        expect(right.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))

        // The gap must support midpoint bisection (not consecutive integers)
        const gap = right.position - left.position
        expect(gap).toBeGreaterThan(1)
    })

    it("midpoint-spaced positions work for existing as right child", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // existing as right child
        )
        const children = pm.getChildExpressions("op-or")
        const left = children.find((c) => c.id === "expr-q")!
        const right = children.find((c) => c.id === "expr-p")!

        // When existing is right: sibling gets POSITION_INITIAL, existing gets midpoint
        expect(left.position).toBe(POSITION_INITIAL)
        expect(right.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
    })

    // --- S-8: implies/iff children sit at midpoint-spaced positions ---
    //
    // wrapExpression assigns `[POSITION_INITIAL,
    // midpoint(POSITION_INITIAL, POSITION_MAX)]` to all binary children.
    // S-8 checks arity only, so `[0, 1]` and `[0, 1073741823]` are both
    // valid for binary operators. These tests pin that behavior across
    // all four binary wrap shapes
    // (implies/iff × left-existing/right-existing) plus and/or regression
    // guards.

    it("wrapExpression with implies uses midpoint-spaced positions (left existing) — S-8 clean", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-implies", "implies"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // P at antecedent slot (lower position), Q at consequent slot
        )
        const p = pm.getExpression("expr-p")!
        const q = pm.getExpression("expr-q")!
        expect(p.position).toBe(POSITION_INITIAL)
        expect(q.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
        expect(
            eng.validate("structural").filter((v) => v.code === "S-8")
        ).toEqual([])
    })

    it("wrapExpression with implies uses midpoint-spaced positions (right existing) — S-8 clean", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-implies", "implies"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // Q at antecedent slot, P at consequent slot
        )
        const p = pm.getExpression("expr-p")!
        const q = pm.getExpression("expr-q")!
        expect(q.position).toBe(POSITION_INITIAL)
        expect(p.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
        expect(
            eng.validate("structural").filter((v) => v.code === "S-8")
        ).toEqual([])
    })

    it("wrapExpression with iff uses midpoint-spaced positions — S-8 clean", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-iff", "iff"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        const p = pm.getExpression("expr-p")!
        const q = pm.getExpression("expr-q")!
        expect(p.position).toBe(POSITION_INITIAL)
        expect(q.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
        expect(
            eng.validate("structural").filter((v) => v.code === "S-8")
        ).toEqual([])
    })

    it("wrapExpression with and retains midpoint-spaced positions (regression guard)", () => {
        // Asserts the and/or path gets the same midpoint spacing as
        // implies/iff.
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        const p = pm.getExpression("expr-p")!
        const q = pm.getExpression("expr-q")!
        expect(p.position).toBe(POSITION_INITIAL)
        expect(q.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
        expect(q.position - p.position).toBeGreaterThan(1)
        expect(eng.validate("structural")).toEqual([])
    })

    it("wrapExpression with or retains midpoint-spaced positions (regression guard)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        const p = pm.getExpression("expr-p")!
        const q = pm.getExpression("expr-q")!
        expect(p.position).toBe(POSITION_INITIAL)
        expect(q.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
        expect(eng.validate("structural")).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// toggleNegation
// ---------------------------------------------------------------------------
describe("toggleNegation", () => {
    it("wraps a root variable expression with NOT", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result } = premise.toggleNegation("expr-p")

        expect(result).not.toBeNull()
        expect(result!.type).toBe("operator")
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        expect(premise.getRootExpressionId()).toBe(result!.id)
        expect(premise.toDisplayString()).toBe("¬(P)")
    })

    it("unwraps a NOT around a variable expression, returning null", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.toggleNegation("expr-p")

        const { result } = premise.toggleNegation("expr-p")

        expect(result).toBeNull()
        expect(premise.getRootExpressionId()).toBe("expr-p")
        expect(premise.toDisplayString()).toBe("P")
    })

    it("wraps a non-root variable expression with NOT", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { result } = premise.toggleNegation("expr-p")

        expect(result).not.toBeNull()
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        expect(premise.getExpression(result!.id)!.parentId).toBe("op-and")
        expect(premise.getExpression("expr-p")!.parentId).toBe(result!.id)
        expect(premise.toDisplayString()).toBe("(¬(P) ∧ Q)")
    })

    it("unwraps NOT from a non-root expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        premise.toggleNegation("expr-p")

        const { result } = premise.toggleNegation("expr-p")

        expect(result).toBeNull()
        expect(premise.getExpression("expr-p")!.parentId).toBe("op-and")
        expect(premise.toDisplayString()).toBe("(P ∧ Q)")
    })

    // toggleNegation on a non-`not` operator does not itself insert a
    // formula buffer between the new NOT and the operator. It wraps
    // Structurally and any resulting P-1 violation is repaired by the
    // AN-1 post-hook in assistive mode. The buffer-insertion contract
    // is covered by `test/grammar/an-rules.test.ts`; toggleNegation's
    // primitive wrap-with-NOT behavior is covered by the "works on
    // formula expressions" test below.

    it("works on formula expressions", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("formula-1"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "formula-1" })
        )

        const { result } = premise.toggleNegation("formula-1")

        expect(result).not.toBeNull()
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        expect(premise.toDisplayString()).toBe("¬((P))")
    })

    it("throws when expression does not exist", () => {
        const premise = premiseWithVars()

        expect(() => premise.toggleNegation("nonexistent")).toThrow(
            /Expression .* not found/
        )
    })

    it("toggle twice returns to original structure", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const originalDisplay = premise.toDisplayString()

        premise.toggleNegation("expr-p")
        premise.toggleNegation("expr-p")

        expect(premise.toDisplayString()).toBe(originalDisplay)
    })

    it("changeset includes created NOT expression when adding negation", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = premise.toggleNegation("expr-p")

        expect(changes.expressions!.added).toHaveLength(1)
        const added = changes.expressions!.added[0]
        if (added.type === "operator") expect(added.operator).toBe("not")
        expect(added.type).toBe("operator")
        expect(changes.expressions!.modified.length).toBeGreaterThanOrEqual(1)
    })

    it("changeset includes removed NOT expression when removing negation", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.toggleNegation("expr-p")

        const { changes } = premise.toggleNegation("expr-p")

        expect(changes.expressions!.removed).toHaveLength(1)
        const removed = changes.expressions!.removed[0]
        if (removed.type === "operator") expect(removed.operator).toBe("not")
        expect(removed.type).toBe("operator")
    })

    it("marks checksum dirty after toggle", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const checksumBefore = premise.combinedChecksum()

        premise.toggleNegation("expr-p")

        expect(premise.combinedChecksum()).not.toBe(checksumBefore)
    })
})

// ---------------------------------------------------------------------------
// changeOperator
// ---------------------------------------------------------------------------

describe("changeOperator", () => {
    // --- No-op ---

    it("no-op when operator already matches", () => {
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

        const { result, changes } = pm.changeOperator("op-and", "and")

        expect(result).not.toBeNull()
        expect(result!.id).toBe("op-and")
        expect(changes.expressions).toBeUndefined()
    })

    // --- Simple change ---

    it("simple change: AND(P, Q) → OR(P, Q)", () => {
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

        const { result, changes } = pm.changeOperator("op-and", "or")

        expect(result).not.toBeNull()
        expect(result!.type).toBe("operator")
        if (result!.type === "operator") {
            expect(result!.operator).toBe("or")
        }
        expect(changes.expressions!.modified.length).toBeGreaterThanOrEqual(1)
        expect(pm.toDisplayString()).toBe("(P ∨ Q)")
    })

    it("simple change: implies(P, Q) → iff(P, Q)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-imp", "implies"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-imp",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-imp",
                position: 1,
            })
        )

        const { result } = pm.changeOperator("op-imp", "iff")

        expect(result).not.toBeNull()
        if (result!.type === "operator") {
            expect(result!.operator).toBe("iff")
        }
        expect(pm.toDisplayString()).toBe("(P ↔ Q)")
    })

    it("simple change preserves children and positions", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: -100,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 100,
            })
        )

        pm.changeOperator("op-and", "or")

        const children = pm.getChildExpressions("op-and")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("expr-p")
        expect(children[0].position).toBe(-100)
        expect(children[1].id).toBe("expr-q")
        expect(children[1].position).toBe(100)
    })

    it("simple change has correct hierarchical checksums", () => {
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

        const modifiedOr = changes.expressions!.modified.find(
            (e) => e.id === "op-and"
        )!
        expect(modifiedOr).toBeDefined()
        const flushedOr = pm.getExpression("op-and")!
        expect(modifiedOr.combinedChecksum).toBe(flushedOr.combinedChecksum)
        expect(modifiedOr.descendantChecksum).toBe(flushedOr.descendantChecksum)
    })

    it("simple change at any arity: and, or and xor swap in place with four children", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        const childIds = ["expr-p", "expr-q", "expr-r", "expr-p2"]
        const variableIds = [VAR_P.id, VAR_Q.id, VAR_R.id, VAR_P.id]
        childIds.forEach((id, position) =>
            pm.addExpression(
                makeVarExpr(id, variableIds[position], {
                    parentId: "op-and",
                    position,
                })
            )
        )
        const childSlots = () =>
            pm
                .getChildExpressions("op-and")
                .map((child) => [child.id, child.position])

        const before = childSlots()
        for (const [operator, display] of [
            ["xor", "(P ⊻ Q ⊻ R ⊻ P)"],
            ["or", "(P ∨ Q ∨ R ∨ P)"],
            ["and", "(P ∧ Q ∧ R ∧ P)"],
        ] as const) {
            const { result } = pm.changeOperator("op-and", operator)

            expect(result?.id).toBe("op-and")
            expect(result?.type === "operator" && result.operator).toBe(
                operator
            )
            expect(childSlots()).toEqual(before)
            expect(pm.toDisplayString()).toBe(display)
        }
    })

    // --- Merge (does not trigger for 2-child operators) ---

    // changeOperator does not itself absorb a formula whose inner
    // operator now matches its parent (for example
    // OR(formula(AND(P, Q)), R) with AND changed to OR). That
    // same-operator absorption is owned by the AN-4 post-hook; the contract is covered by
    // `test/grammar/an-rules.test.ts` (AN-4 + the multi-child
    // absorption regression-guard tests).

    // --- Split ---

    it("split: AND(P, Q, R) → AND(formula(OR(P, Q)), R)", () => {
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
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        const { result, changes } = pm.changeOperator(
            "op-and",
            "or",
            "expr-p",
            "expr-q"
        )

        // New sub-operator created
        expect(result).not.toBeNull()
        if (result!.type === "operator") {
            expect(result!.operator).toBe("or")
        }

        // Formula buffer inserted between AND and new OR
        const addedFormula = changes.expressions!.added.find(
            (e) => e.type === "formula"
        )
        expect(addedFormula).toBeDefined()
        expect(addedFormula!.parentId).toBe("op-and")

        const addedOr = changes.expressions!.added.find(
            (e) => e.type === "operator"
        )
        expect(addedOr).toBeDefined()
        expect(addedOr!.parentId).toBe(addedFormula!.id)

        // P and Q are children of new OR
        const orChildren = pm.getChildExpressions(result!.id)
        expect(orChildren).toHaveLength(2)

        // AND still has 2 children (formula(OR) + R)
        const andChildren = pm.getChildExpressions("op-and")
        expect(andChildren).toHaveLength(2)
    })

    it("split still needs both child ids when the operator cannot be swapped in place", () => {
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
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        // A binary operator cannot hold three operands, so it is never a swap
        // in place; with no children named there is not even a split to try.
        expect(() => pm.changeOperator("op-and", "implies")).toThrow(
            /sourceChildId and targetChildId are required/
        )
        // One id names half a split; it is not read as a request to swap.
        expect(() => pm.changeOperator("op-and", "or", "expr-p")).toThrow(
            /sourceChildId and targetChildId are required/
        )
        // Empty ids are ids that were given, not omitted — as a CLI option
        // passed an empty value arrives.
        expect(() => pm.changeOperator("op-and", "or", "", "")).toThrow(
            /sourceChildId and targetChildId are required/
        )
        // Nor can a binary operator be split out: the sub-operator would not
        // be a root, and implies and iff must be.
        expect(() =>
            pm.changeOperator("op-and", "implies", "expr-p", "expr-q")
        ).toThrow(/must be a root expression/)
        expect(pm.toDisplayString()).toBe("(P ∧ Q ∧ R)")
    })

    it("split rejects sourceChildId/targetChildId that are not children", () => {
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
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        expect(() =>
            pm.changeOperator("op-and", "or", "expr-p", "nonexistent")
        ).toThrow()
    })

    it("split changeset has correct hierarchical checksums", () => {
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
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        const { changes } = pm.changeOperator(
            "op-and",
            "or",
            "expr-p",
            "expr-q"
        )

        const newOp = changes.expressions!.added.find(
            (e) => e.type === "operator"
        )!
        expect(newOp.descendantChecksum).not.toBeNull()
        expect(newOp.combinedChecksum).not.toBe(newOp.checksum)

        // Cross-check with flushed engine state
        const flushedOp = pm.getExpression(newOp.id)!
        expect(newOp.combinedChecksum).toBe(flushedOp.combinedChecksum)
        expect(newOp.descendantChecksum).toBe(flushedOp.descendantChecksum)
    })

    it("split applies extraFields to created expressions", () => {
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
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        const { changes } = pm.changeOperator(
            "op-and",
            "or",
            "expr-p",
            "expr-q",
            { creatorId: "user-42" } as Partial<TCorePropositionalExpression>
        )

        for (const expr of changes.expressions!.added) {
            expect((expr as Record<string, unknown>).creatorId).toBe("user-42")
        }
    })

    // --- No-merge for 2-child operators ---

    // The same applies to AND(formula(OR(P, Q)), R) with OR changed to
    // AND: AN-4's same-operator absorption is owned by the post-hook
    // and covered by `test/grammar/an-rules.test.ts`.

    it("no merge: OR(formula(OR(P, Q)), R) → change inner OR to AND yields OR(formula(AND(P, Q)), R)", () => {
        const pm = premiseWithVars()
        // Build: OR( formula(OR(P, Q)), R )
        pm.addExpression(makeOpExpr("op-or-outer", "or"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-or-outer",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("op-or-inner", "or", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-or-inner",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-or-inner",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-or-outer",
                position: 1,
            })
        )

        const { result } = pm.changeOperator("op-or-inner", "and")

        // Should be a simple change, not a merge
        expect(result).not.toBeNull()
        expect(result!.id).toBe("op-or-inner")
        if (result!.type === "operator") {
            expect(result!.operator).toBe("and")
        }

        // Structure preserved: outer OR still has 2 children
        const outerChildren = pm.getChildExpressions("op-or-outer")
        expect(outerChildren).toHaveLength(2)

        // Inner operator still has 2 children
        const innerChildren = pm.getChildExpressions("op-or-inner")
        expect(innerChildren).toHaveLength(2)
    })

    // The tight-position AN-4 absorption + redistribute path is covered by
    // `test/grammar/an-rules.test.ts`'s AN-4 redistribute
    // regression-guard tests.

    // --- Error cases ---

    it("throws if expressionId not found", () => {
        const pm = premiseWithVars()
        expect(() => pm.changeOperator("nonexistent", "or")).toThrow()
    })

    it("throws if expression is not an operator", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() => pm.changeOperator("expr-p", "or")).toThrow()
    })
})

// ---------------------------------------------------------------------------
// toggleNegation extraFields
// ---------------------------------------------------------------------------

describe("toggleNegation extraFields", () => {
    it("merges extraFields into the NOT expression (variable target)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr } = pm.toggleNegation("expr-p", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        expect(notExpr).not.toBeNull()
        expect((notExpr as Record<string, unknown>).creatorId).toBe("user-42")

        // Persisted in the store too
        const stored = pm.getExpression(notExpr!.id)!
        expect((stored as Record<string, unknown>).creatorId).toBe("user-42")
    })

    // toggleNegation on an operator does not itself insert a formula
    // buffer between the new NOT and the wrapped operator. That buffer
    // is owned by the AN-1 post-hook (which doesn't get extraFields — it operates on
    // already-mutated state). The extraFields propagation contract
    // is covered by the extraFields tests in this
    // describe block (variable-target + checksum variants).

    it("extraFields in changeset expressions have correct checksums", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr, changes } = pm.toggleNegation("expr-p", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        const addedNot = changes.expressions!.added.find(
            (e) => e.id === notExpr!.id
        )!
        // Extra fields should be in the changeset expression
        expect((addedNot as Record<string, unknown>).creatorId).toBe("user-42")

        // Checksums should still be correct (hierarchical flush works with extra fields)
        expect(addedNot.descendantChecksum).not.toBeNull()
        const flushedNot = pm.getExpression(notExpr!.id)!
        expect(addedNot.combinedChecksum).toBe(flushedNot.combinedChecksum)
    })

    it("does not merge extraFields when removing negation", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.toggleNegation("expr-p")

        // Removing negation — extraFields should be accepted but not cause issues
        const { result } = pm.toggleNegation("expr-p", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        // Result is null (negation removed), no error thrown
        expect(result).toBeNull()
        expect(pm.toDisplayString()).toBe("P")
    })

    it("extraFields do not override structural fields (type, operator, parentId)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        // Attempt to override type and operator — should be ignored
        const { result: notExpr } = pm.toggleNegation("expr-p", {
            type: "variable",
            operator: "and",
        } as Partial<TCorePropositionalExpression>)

        expect(notExpr).not.toBeNull()
        // Structural fields should not be overridden
        expect(notExpr!.type).toBe("operator")
        if (notExpr!.type === "operator") {
            expect(notExpr!.operator).toBe("not")
        }
    })

    it("omitting extraFields preserves existing behavior", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr } = pm.toggleNegation("expr-p")

        expect(notExpr).not.toBeNull()
        expect(notExpr!.type).toBe("operator")
        if (notExpr!.type === "operator") {
            expect(notExpr!.operator).toBe("not")
        }
    })
})
