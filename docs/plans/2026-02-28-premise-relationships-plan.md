# Premise Relationship Analysis — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Analyze how premises relate to a focused premise by classifying each as supporting, contradicting, restricting, downstream, or unrelated.

**Architecture:** A standalone `analyzePremiseRelationships(engine, focusedPremiseId)` function that profiles each premise's variable appearances (side + polarity), builds a directed variable-flow graph, and uses BFS reachability to classify relationships including transitive ones.

**Tech Stack:** TypeScript, Vitest, existing ArgumentEngine/PremiseManager APIs.

---

### Task 1: Create type definitions and stub

**Files:**
- Create: `src/lib/types/relationships.ts`
- Create: `src/lib/core/relationships.ts`
- Modify: `src/lib/index.ts`

**Step 1: Create type definitions**

Create `src/lib/types/relationships.ts`:

```typescript
/** Polarity of a variable within an expression subtree. */
export type TCoreVariablePolarity = "positive" | "negative"

/** Which side of an inference premise a variable appears on. */
export type TCorePremiseSide = "antecedent" | "consequent"

/** A single variable appearance within a premise, recording its side and polarity. */
export interface TCoreVariableAppearance {
    variableId: string
    side: TCorePremiseSide
    polarity: TCoreVariablePolarity
}

/** Profile of a premise's variable appearances, split by antecedent/consequent. */
export interface TCorePremiseProfile {
    premiseId: string
    isInference: boolean
    appearances: TCoreVariableAppearance[]
}

/** The five relationship categories a premise can have relative to a focused premise. */
export type TCorePremiseRelationshipType =
    | "supporting"
    | "contradicting"
    | "restricting"
    | "downstream"
    | "unrelated"

/** Per-variable relationship detail explaining why a variable contributes to the classification. */
export interface TCoreVariableRelationship {
    variableId: string
    relationship: "supporting" | "contradicting" | "restricting"
}

/** Classification result for a single premise relative to the focused premise. */
export interface TCorePremiseRelationResult {
    premiseId: string
    relationship: TCorePremiseRelationshipType
    variableDetails: TCoreVariableRelationship[]
    transitive: boolean
}

/** Top-level result from `analyzePremiseRelationships`. */
export interface TCorePremiseRelationshipAnalysis {
    focusedPremiseId: string
    premises: TCorePremiseRelationResult[]
}
```

**Step 2: Create stub implementation**

Create `src/lib/core/relationships.ts`:

```typescript
import type { ArgumentEngine } from "./ArgumentEngine.js"
import type { PremiseManager } from "./PremiseManager.js"
import type {
    TCoreVariableAppearance,
    TCorePremiseProfile,
    TCorePremiseRelationshipAnalysis,
} from "../types/relationships.js"

/**
 * Builds a profile of a premise's variable appearances, recording each
 * variable's side (antecedent/consequent) and polarity (positive/negative).
 */
export function buildPremiseProfile(
    premise: PremiseManager
): TCorePremiseProfile {
    throw new Error("Not implemented")
}

/**
 * Analyzes how every other premise in the argument relates to the focused
 * premise, classifying each as supporting, contradicting, restricting,
 * downstream, or unrelated.
 */
export function analyzePremiseRelationships(
    engine: ArgumentEngine,
    focusedPremiseId: string
): TCorePremiseRelationshipAnalysis {
    throw new Error("Not implemented")
}
```

**Step 3: Add exports to barrel**

In `src/lib/index.ts`, add after the existing diff exports (line 15):

```typescript
export * from "./types/relationships.js"
export {
    analyzePremiseRelationships,
    buildPremiseProfile,
} from "./core/relationships.js"
```

**Step 4: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS (stubs compile, types are valid)

**Step 5: Commit**

```bash
git add src/lib/types/relationships.ts src/lib/core/relationships.ts src/lib/index.ts
git commit -m "Add relationship analysis types and stubs"
```

---

### Task 2: Variable profiling — buildPremiseProfile (TDD)

**Files:**
- Test: `test/ExpressionManager.test.ts` (new describe block at bottom)
- Modify: `src/lib/core/relationships.ts`

**Step 1: Write failing tests for variable profiling**

Add to the test file imports (at top, near the diff imports):

```typescript
import { buildPremiseProfile } from "../src/lib/core/relationships"
```

Add new describe block at the bottom of the test file:

```typescript
// ---------------------------------------------------------------------------
// analyzePremiseRelationships
// ---------------------------------------------------------------------------

describe("buildPremiseProfile", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_F = makeVar("var-f", "F")

    it("profiles an implies premise with simple antecedent and consequent", () => {
        // A → B
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()
        pm.addVariable(VAR_A)
        pm.addVariable(VAR_B)
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "impl", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(true)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                { variableId: VAR_A.id, side: "antecedent", polarity: "positive" },
                { variableId: VAR_B.id, side: "consequent", polarity: "positive" },
            ])
        )
        expect(profile.appearances).toHaveLength(2)
    })

    it("profiles negation as negative polarity", () => {
        // F → ¬A
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()
        pm.addVariable(VAR_F)
        pm.addVariable(VAR_A)
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("ve-f", VAR_F.id, { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("not-1", "not", { parentId: "impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "not-1", position: 0 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                { variableId: VAR_F.id, side: "antecedent", polarity: "positive" },
                { variableId: VAR_A.id, side: "consequent", polarity: "negative" },
            ])
        )
    })

    it("profiles double negation as positive polarity", () => {
        // ¬(¬A ∧ B) → C
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()
        pm.addVariable(VAR_A)
        pm.addVariable(VAR_B)
        pm.addVariable(VAR_C)
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeOpExpr("not-outer", "not", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("and-1", "and", { parentId: "not-outer", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("not-inner", "not", { parentId: "and-1", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "not-inner", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "and-1", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("ve-c", VAR_C.id, { parentId: "impl", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                { variableId: VAR_A.id, side: "antecedent", polarity: "positive" },
                { variableId: VAR_B.id, side: "antecedent", polarity: "negative" },
                { variableId: VAR_C.id, side: "consequent", polarity: "positive" },
            ])
        )
        expect(profile.appearances).toHaveLength(3)
    })

    it("profiles compound antecedent and consequent", () => {
        // (A ∧ B) → (B ∧ C)
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()
        pm.addVariable(VAR_A)
        pm.addVariable(VAR_B)
        pm.addVariable(VAR_C)
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeOpExpr("and-l", "and", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "and-l", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b1", VAR_B.id, { parentId: "and-l", position: 1 })
        )
        pm.addExpression(
            makeOpExpr("and-r", "and", { parentId: "impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("ve-b2", VAR_B.id, { parentId: "and-r", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-c", VAR_C.id, { parentId: "and-r", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                { variableId: VAR_A.id, side: "antecedent", polarity: "positive" },
                { variableId: VAR_B.id, side: "antecedent", polarity: "positive" },
                { variableId: VAR_B.id, side: "consequent", polarity: "positive" },
                { variableId: VAR_C.id, side: "consequent", polarity: "positive" },
            ])
        )
        expect(profile.appearances).toHaveLength(4)
    })

    it("profiles iff as left=antecedent, right=consequent", () => {
        // A ↔ B
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()
        pm.addVariable(VAR_A)
        pm.addVariable(VAR_B)
        pm.addExpression(makeOpExpr("iff-1", "iff"))
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "iff-1", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "iff-1", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(true)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                { variableId: VAR_A.id, side: "antecedent", polarity: "positive" },
                { variableId: VAR_B.id, side: "consequent", polarity: "positive" },
            ])
        )
    })

    it("profiles a constraint premise as non-inference with no appearances", () => {
        // A ∧ B (constraint)
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()
        pm.addVariable(VAR_A)
        pm.addVariable(VAR_B)
        pm.addExpression(makeOpExpr("and-1", "and"))
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "and-1", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "and-1", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(false)
        expect(profile.appearances).toEqual([])
    })

    it("profiles an empty premise as non-inference with no appearances", () => {
        const eng = new ArgumentEngine(ARG)
        const pm = eng.createPremise()

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(false)
        expect(profile.appearances).toEqual([])
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `buildPremiseProfile` throws "Not implemented"

**Step 3: Implement buildPremiseProfile**

Replace the stub in `src/lib/core/relationships.ts`:

```typescript
import type { ArgumentEngine } from "./ArgumentEngine.js"
import type { PremiseManager } from "./PremiseManager.js"
import type {
    TCoreVariableAppearance,
    TCoreVariablePolarity,
    TCorePremiseProfile,
    TCorePremiseSide,
    TCorePremiseRelationshipAnalysis,
} from "../types/relationships.js"

function collectVariableAppearances(
    premise: PremiseManager,
    expressionId: string,
    side: TCorePremiseSide
): TCoreVariableAppearance[] {
    const appearances: TCoreVariableAppearance[] = []
    const stack: Array<{ id: string; negationDepth: number }> = [
        { id: expressionId, negationDepth: 0 },
    ]

    while (stack.length > 0) {
        const { id, negationDepth } = stack.pop()!
        const expr = premise.getExpression(id)
        if (!expr) continue

        if (expr.type === "variable") {
            appearances.push({
                variableId: expr.variableId,
                side,
                polarity:
                    negationDepth % 2 === 0 ? "positive" : "negative",
            })
        } else {
            const nextDepth =
                expr.type === "operator" && expr.operator === "not"
                    ? negationDepth + 1
                    : negationDepth
            for (const child of premise.getChildExpressions(id)) {
                stack.push({ id: child.id, negationDepth: nextDepth })
            }
        }
    }

    return appearances
}

export function buildPremiseProfile(
    premise: PremiseManager
): TCorePremiseProfile {
    const premiseId = premise.getId()

    if (!premise.isInference()) {
        return { premiseId, isInference: false, appearances: [] }
    }

    const root = premise.getRootExpression()!
    const children = premise.getChildExpressions(root.id)
    const leftChild = children.find((c) => c.position === 0)
    const rightChild = children.find((c) => c.position === 1)

    const appearances: TCoreVariableAppearance[] = []
    if (leftChild) {
        appearances.push(
            ...collectVariableAppearances(premise, leftChild.id, "antecedent")
        )
    }
    if (rightChild) {
        appearances.push(
            ...collectVariableAppearances(premise, rightChild.id, "consequent")
        )
    }

    return { premiseId, isInference: true, appearances }
}

export function analyzePremiseRelationships(
    engine: ArgumentEngine,
    focusedPremiseId: string
): TCorePremiseRelationshipAnalysis {
    throw new Error("Not implemented")
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS — all `buildPremiseProfile` tests green

**Step 5: Commit**

```bash
git add src/lib/core/relationships.ts test/ExpressionManager.test.ts
git commit -m "Implement buildPremiseProfile with variable side and polarity extraction"
```

---

### Task 3: Direct relationship classification (TDD)

**Files:**
- Test: `test/ExpressionManager.test.ts`
- Modify: `src/lib/core/relationships.ts`

This task tests and implements the main `analyzePremiseRelationships` function using scenarios that only require direct (non-transitive) relationships.

**Step 1: Write failing tests**

Add import for `analyzePremiseRelationships` at the top of the test file:

```typescript
import {
    buildPremiseProfile,
    analyzePremiseRelationships,
} from "../src/lib/core/relationships"
```

Add a new describe block after the `buildPremiseProfile` block:

```typescript
describe("analyzePremiseRelationships — direct relationships", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")
    const VAR_E = makeVar("var-e", "E")
    const VAR_F = makeVar("var-f", "F")

    /** Build an implies premise: left → right (single variables). */
    function buildImplies(
        eng: ArgumentEngine,
        premiseId: string,
        leftVar: TCorePropositionalVariable,
        rightVar: TCorePropositionalVariable
    ): PremiseManager {
        const pm = eng.createPremiseWithId(premiseId)
        pm.addVariable(leftVar)
        if (leftVar.id !== rightVar.id) pm.addVariable(rightVar)
        pm.addExpression(makeOpExpr(`${premiseId}-impl`, "implies"))
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-l`, leftVar.id, {
                parentId: `${premiseId}-impl`,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-r`, rightVar.id, {
                parentId: `${premiseId}-impl`,
                position: 1,
            })
        )
        return pm
    }

    it("classifies a premise whose consequent feeds the focused antecedent as supporting", () => {
        // P1: A → B, P2 (focused): B → C
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        const p2 = buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
        expect(p1Result.transitive).toBe(false)
        expect(p1Result.variableDetails).toEqual(
            expect.arrayContaining([
                { variableId: VAR_B.id, relationship: "supporting" },
            ])
        )
    })

    it("classifies a premise with negated consequent as contradicting", () => {
        // P1: A → ¬B, P2 (focused): B → C
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_A)
        p1.addVariable(VAR_B)
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("contradicting")
        expect(p1Result.variableDetails).toEqual(
            expect.arrayContaining([
                { variableId: VAR_B.id, relationship: "contradicting" },
            ])
        )
    })

    it("classifies a premise with variable in both ante and conseq as restricting", () => {
        // P1: B → (B ∧ C), P2 (focused): B → D
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_B)
        p1.addVariable(VAR_C)
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-b1", VAR_B.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b2", VAR_B.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-c", VAR_C.id, {
                parentId: "p1-and",
                position: 1,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_D)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
        expect(p1Result.variableDetails).toEqual(
            expect.arrayContaining([
                { variableId: VAR_B.id, relationship: "restricting" },
            ])
        )
    })

    it("classifies a constraint premise sharing variables as restricting", () => {
        // P1: A ∧ B (constraint), P2 (focused): B → C
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_A)
        p1.addVariable(VAR_B)
        p1.addExpression(makeOpExpr("p1-and", "and"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-and",
                position: 1,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
    })

    it("classifies a premise taking the focused consequent as downstream", () => {
        // P1 (focused): A → B, P2: B → C
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p1")
        const p2Result = result.premises.find((p) => p.premiseId === "p2")!
        expect(p2Result.relationship).toBe("downstream")
        expect(p2Result.transitive).toBe(false)
    })

    it("classifies a premise with no shared variables as unrelated", () => {
        // P1: A → B, P2 (focused): C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
        expect(p1Result.variableDetails).toEqual([])
    })

    it("excludes the focused premise from results", () => {
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        expect(result.premises.find((p) => p.premiseId === "p2")).toBeUndefined()
    })

    it("throws when focused premise does not exist", () => {
        const eng = new ArgumentEngine(ARG)
        expect(() =>
            analyzePremiseRelationships(eng, "nonexistent")
        ).toThrow()
    })

    it("returns empty premises array when argument has only the focused premise", () => {
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)

        const result = analyzePremiseRelationships(eng, "p1")
        expect(result.premises).toEqual([])
    })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `analyzePremiseRelationships` throws "Not implemented"

**Step 3: Implement analyzePremiseRelationships (direct classification)**

Replace the stub in `src/lib/core/relationships.ts`. The full implementation handles both direct and transitive relationships. Internal helpers:

- `buildVariableFlowGraph`: for each pair of inference premises, creates directed edges from source to target when source's consequent variables appear in target's antecedent. Each edge carries polarity compatibility.
- `classifyWithBFS`: from each premise, BFS toward the focused premise. Track accumulated polarity. Also BFS from focused toward each premise for downstream detection.
- `classifyConstraintPremise`: constraint premises are restricting if they share variables with the focused premise or any premise connected to it; otherwise unrelated.

```typescript
import type { ArgumentEngine } from "./ArgumentEngine.js"
import type { PremiseManager } from "./PremiseManager.js"
import type {
    TCoreVariableAppearance,
    TCorePremiseProfile,
    TCorePremiseSide,
    TCorePremiseRelationResult,
    TCorePremiseRelationshipAnalysis,
    TCorePremiseRelationshipType,
    TCoreVariableRelationship,
} from "../types/relationships.js"

// ── Variable profiling ──────────────────────────────────────────────────

function collectVariableAppearances(
    premise: PremiseManager,
    expressionId: string,
    side: TCorePremiseSide
): TCoreVariableAppearance[] {
    const appearances: TCoreVariableAppearance[] = []
    const stack: Array<{ id: string; negationDepth: number }> = [
        { id: expressionId, negationDepth: 0 },
    ]

    while (stack.length > 0) {
        const { id, negationDepth } = stack.pop()!
        const expr = premise.getExpression(id)
        if (!expr) continue

        if (expr.type === "variable") {
            appearances.push({
                variableId: expr.variableId,
                side,
                polarity:
                    negationDepth % 2 === 0 ? "positive" : "negative",
            })
        } else {
            const nextDepth =
                expr.type === "operator" && expr.operator === "not"
                    ? negationDepth + 1
                    : negationDepth
            for (const child of premise.getChildExpressions(id)) {
                stack.push({ id: child.id, negationDepth: nextDepth })
            }
        }
    }

    return appearances
}

export function buildPremiseProfile(
    premise: PremiseManager
): TCorePremiseProfile {
    const premiseId = premise.getId()

    if (!premise.isInference()) {
        return { premiseId, isInference: false, appearances: [] }
    }

    const root = premise.getRootExpression()!
    const children = premise.getChildExpressions(root.id)
    const leftChild = children.find((c) => c.position === 0)
    const rightChild = children.find((c) => c.position === 1)

    const appearances: TCoreVariableAppearance[] = []
    if (leftChild) {
        appearances.push(
            ...collectVariableAppearances(premise, leftChild.id, "antecedent")
        )
    }
    if (rightChild) {
        appearances.push(
            ...collectVariableAppearances(
                premise,
                rightChild.id,
                "consequent"
            )
        )
    }

    return { premiseId, isInference: true, appearances }
}

// ── Graph edge types ────────────────────────────────────────────────────

type VariableEdge = {
    variableId: string
    polarityMatch: boolean // true = same polarity, false = opposite
}

type PremiseEdge = {
    targetPremiseId: string
    variables: VariableEdge[]
}

// ── Graph construction ──────────────────────────────────────────────────

function buildVariableFlowGraph(
    profiles: Map<string, TCorePremiseProfile>
): Map<string, PremiseEdge[]> {
    const graph = new Map<string, PremiseEdge[]>()

    for (const [sourceId, sourceProfile] of profiles) {
        if (!sourceProfile.isInference) continue
        const edges: PremiseEdge[] = []

        const conseqVars = sourceProfile.appearances.filter(
            (a) => a.side === "consequent"
        )

        for (const [targetId, targetProfile] of profiles) {
            if (targetId === sourceId || !targetProfile.isInference) continue

            const anteVars = targetProfile.appearances.filter(
                (a) => a.side === "antecedent"
            )

            const variables: VariableEdge[] = []
            for (const cv of conseqVars) {
                for (const av of anteVars) {
                    if (cv.variableId === av.variableId) {
                        variables.push({
                            variableId: cv.variableId,
                            polarityMatch: cv.polarity === av.polarity,
                        })
                    }
                }
            }

            if (variables.length > 0) {
                edges.push({ targetPremiseId: targetId, variables })
            }
        }

        graph.set(sourceId, edges)
    }

    return graph
}

// ── BFS reachability ────────────────────────────────────────────────────

type ReachResult = {
    reachable: boolean
    polarityMatch: boolean // accumulated polarity through chain
    variableDetails: TCoreVariableRelationship[]
    transitive: boolean
}

function bfsToTarget(
    graph: Map<string, PremiseEdge[]>,
    sourceId: string,
    targetId: string
): ReachResult {
    // BFS from source toward target
    // Track: { premiseId, accumulatedPolarityMatch }
    const queue: Array<{
        premiseId: string
        polarityMatch: boolean
        depth: number
        entryVariables: VariableEdge[]
    }> = []
    const visited = new Set<string>()

    const sourceEdges = graph.get(sourceId) ?? []
    for (const edge of sourceEdges) {
        if (edge.targetPremiseId === targetId) {
            // Direct connection
            const allMatch = edge.variables.every((v) => v.polarityMatch)
            const anyMismatch = edge.variables.some((v) => !v.polarityMatch)
            return {
                reachable: true,
                polarityMatch: allMatch,
                variableDetails: edge.variables.map((v) => ({
                    variableId: v.variableId,
                    relationship: v.polarityMatch
                        ? "supporting"
                        : "contradicting",
                })),
                transitive: false,
            }
        }
        if (!visited.has(edge.targetPremiseId)) {
            visited.add(edge.targetPremiseId)
            queue.push({
                premiseId: edge.targetPremiseId,
                polarityMatch: edge.variables.every((v) => v.polarityMatch),
                depth: 1,
                entryVariables: edge.variables,
            })
        }
    }

    while (queue.length > 0) {
        const { premiseId, polarityMatch, depth, entryVariables } =
            queue.shift()!
        const edges = graph.get(premiseId) ?? []

        for (const edge of edges) {
            if (edge.targetPremiseId === targetId) {
                const stepMatch = edge.variables.every(
                    (v) => v.polarityMatch
                )
                const accMatch = polarityMatch === stepMatch
                    ? true
                    : !(polarityMatch !== stepMatch)
                // XOR: if both match or both mismatch, result matches
                const finalMatch = polarityMatch && stepMatch
                    ? true
                    : !polarityMatch && !stepMatch
                        ? true
                        : false
                return {
                    reachable: true,
                    polarityMatch: finalMatch,
                    variableDetails: entryVariables.map((v) => ({
                        variableId: v.variableId,
                        relationship: finalMatch
                            ? "supporting"
                            : "contradicting",
                    })),
                    transitive: true,
                }
            }
            if (!visited.has(edge.targetPremiseId)) {
                visited.add(edge.targetPremiseId)
                const stepMatch = edge.variables.every(
                    (v) => v.polarityMatch
                )
                const nextMatch =
                    polarityMatch && stepMatch
                        ? true
                        : !polarityMatch && !stepMatch
                            ? true
                            : false
                queue.push({
                    premiseId: edge.targetPremiseId,
                    polarityMatch: nextMatch,
                    depth: depth + 1,
                    entryVariables,
                })
            }
        }
    }

    return {
        reachable: false,
        polarityMatch: true,
        variableDetails: [],
        transitive: false,
    }
}

// ── Restricting check ───────────────────────────────────────────────────

function hasVariableOnBothSides(
    profile: TCorePremiseProfile,
    focusedProfile: TCorePremiseProfile
): TCoreVariableRelationship[] {
    const antecedentVarIds = new Set(
        profile.appearances
            .filter((a) => a.side === "antecedent")
            .map((a) => a.variableId)
    )
    const consequentVarIds = new Set(
        profile.appearances
            .filter((a) => a.side === "consequent")
            .map((a) => a.variableId)
    )

    const bothSideVarIds = new Set(
        [...antecedentVarIds].filter((id) => consequentVarIds.has(id))
    )

    // Check if any both-side variable appears in the focused premise
    const focusedVarIds = new Set(
        focusedProfile.appearances.map((a) => a.variableId)
    )

    const restricting: TCoreVariableRelationship[] = []
    for (const varId of bothSideVarIds) {
        if (focusedVarIds.has(varId)) {
            restricting.push({ variableId: varId, relationship: "restricting" })
        }
    }
    return restricting
}

// ── Constraint premise classification ───────────────────────────────────

function classifyConstraintPremise(
    premise: PremiseManager,
    focusedProfile: TCorePremiseProfile,
    connectedVarIds: Set<string>
): TCorePremiseRelationResult {
    const premiseVarIds = new Set(
        premise.getVariables().map((v) => v.id)
    )
    const focusedVarIds = new Set(
        focusedProfile.appearances.map((a) => a.variableId)
    )

    // Check direct variable overlap with focused premise
    const directOverlap = [...premiseVarIds].some((id) =>
        focusedVarIds.has(id)
    )
    // Check transitive overlap via connected premises
    const transitiveOverlap = [...premiseVarIds].some((id) =>
        connectedVarIds.has(id)
    )

    if (directOverlap || transitiveOverlap) {
        return {
            premiseId: premise.getId(),
            relationship: "restricting",
            variableDetails: [],
            transitive: !directOverlap && transitiveOverlap,
        }
    }

    return {
        premiseId: premise.getId(),
        relationship: "unrelated",
        variableDetails: [],
        transitive: false,
    }
}

// ── Precedence ──────────────────────────────────────────────────────────

const PRECEDENCE: Record<string, number> = {
    contradicting: 3,
    restricting: 2,
    supporting: 1,
}

function applyPrecedence(
    details: TCoreVariableRelationship[]
): "supporting" | "contradicting" | "restricting" {
    let highest: "supporting" | "contradicting" | "restricting" = "supporting"
    for (const d of details) {
        if (PRECEDENCE[d.relationship] > PRECEDENCE[highest]) {
            highest = d.relationship
        }
    }
    return highest
}

// ── Main function ───────────────────────────────────────────────────────

export function analyzePremiseRelationships(
    engine: ArgumentEngine,
    focusedPremiseId: string
): TCorePremiseRelationshipAnalysis {
    const focusedPremise = engine.getPremise(focusedPremiseId)
    if (!focusedPremise) {
        throw new Error(
            `Premise "${focusedPremiseId}" does not exist in the argument.`
        )
    }

    const allPremises = engine.listPremises()
    const otherPremises = allPremises.filter(
        (pm) => pm.getId() !== focusedPremiseId
    )

    if (otherPremises.length === 0) {
        return { focusedPremiseId, premises: [] }
    }

    // Build profiles for all premises
    const profiles = new Map<string, TCorePremiseProfile>()
    for (const pm of allPremises) {
        profiles.set(pm.getId(), buildPremiseProfile(pm))
    }

    const focusedProfile = profiles.get(focusedPremiseId)!

    // Build variable flow graph (inference premises only)
    const graph = buildVariableFlowGraph(profiles)

    // Collect all variable IDs connected to the focused premise (for
    // constraint classification)
    const connectedVarIds = new Set<string>()
    for (const pm of allPremises) {
        const pmId = pm.getId()
        if (pmId === focusedPremiseId) continue
        const profile = profiles.get(pmId)!
        if (!profile.isInference) continue
        const toFocused = bfsToTarget(graph, pmId, focusedPremiseId)
        const fromFocused = bfsToTarget(graph, focusedPremiseId, pmId)
        if (toFocused.reachable || fromFocused.reachable) {
            for (const v of pm.getVariables()) {
                connectedVarIds.add(v.id)
            }
        }
    }
    // Also add focused premise's own variables
    for (const a of focusedProfile.appearances) {
        connectedVarIds.add(a.variableId)
    }

    // Classify each premise
    const results: TCorePremiseRelationResult[] = []

    for (const pm of otherPremises) {
        const pmId = pm.getId()
        const profile = profiles.get(pmId)!

        // Constraint premises get special handling
        if (!profile.isInference) {
            results.push(
                classifyConstraintPremise(
                    pm,
                    focusedProfile,
                    connectedVarIds
                )
            )
            continue
        }

        // If focused premise is a constraint, all sharing premises are
        // restricting
        if (!focusedProfile.isInference) {
            const focusedVarIds = new Set(
                focusedPremise.getVariables().map((v) => v.id)
            )
            const pmVarIds = new Set(pm.getVariables().map((v) => v.id))
            const shares = [...pmVarIds].some((id) => focusedVarIds.has(id))
            results.push({
                premiseId: pmId,
                relationship: shares ? "restricting" : "unrelated",
                variableDetails: [],
                transitive: false,
            })
            continue
        }

        // Check restricting (variable on both sides of source, appearing
        // in focused)
        const restrictingDetails = hasVariableOnBothSides(
            profile,
            focusedProfile
        )

        // Check forward path (source → focused)
        const toFocused = bfsToTarget(graph, pmId, focusedPremiseId)

        // Check reverse path (focused → source) for downstream
        const fromFocused = bfsToTarget(graph, focusedPremiseId, pmId)

        if (restrictingDetails.length > 0 || toFocused.reachable) {
            const allDetails = [
                ...restrictingDetails,
                ...toFocused.variableDetails,
            ]
            const relationship = applyPrecedence(allDetails)
            results.push({
                premiseId: pmId,
                relationship,
                variableDetails: allDetails,
                transitive: toFocused.transitive,
            })
        } else if (fromFocused.reachable) {
            results.push({
                premiseId: pmId,
                relationship: "downstream",
                variableDetails: [],
                transitive: fromFocused.transitive,
            })
        } else {
            results.push({
                premiseId: pmId,
                relationship: "unrelated",
                variableDetails: [],
                transitive: false,
            })
        }
    }

    return { focusedPremiseId, premises: results }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS — all direct relationship tests green

**Step 5: Commit**

```bash
git add src/lib/core/relationships.ts test/ExpressionManager.test.ts
git commit -m "Implement analyzePremiseRelationships with direct classification"
```

---

### Task 4: Transitive relationships (TDD)

**Files:**
- Test: `test/ExpressionManager.test.ts`

**Step 1: Write failing tests for transitivity**

Add a new describe block:

```typescript
describe("analyzePremiseRelationships — transitive relationships", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")
    const VAR_E = makeVar("var-e", "E")
    const VAR_F = makeVar("var-f", "F")

    function buildImplies(
        eng: ArgumentEngine,
        premiseId: string,
        leftVar: TCorePropositionalVariable,
        rightVar: TCorePropositionalVariable
    ): PremiseManager {
        const pm = eng.createPremiseWithId(premiseId)
        pm.addVariable(leftVar)
        if (leftVar.id !== rightVar.id) pm.addVariable(rightVar)
        pm.addExpression(makeOpExpr(`${premiseId}-impl`, "implies"))
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-l`, leftVar.id, {
                parentId: `${premiseId}-impl`,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-r`, rightVar.id, {
                parentId: `${premiseId}-impl`,
                position: 1,
            })
        )
        return pm
    }

    it("classifies transitive support through a chain", () => {
        // P1: A → B, P2: B → C, P3 (focused): C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
        expect(p1Result.transitive).toBe(true)

        const p2Result = result.premises.find((p) => p.premiseId === "p2")!
        expect(p2Result.relationship).toBe("supporting")
        expect(p2Result.transitive).toBe(false)
    })

    it("unrelated premise remains unrelated even when other premises form a chain", () => {
        // P1: E → F (unrelated), P2: B → C, P3 (focused): C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_E, VAR_F)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
    })

    it("classifies transitive downstream", () => {
        // P1 (focused): A → B, P2: B → C, P3: C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p1")
        const p3Result = result.premises.find((p) => p.premiseId === "p3")!
        expect(p3Result.relationship).toBe("downstream")
        expect(p3Result.transitive).toBe(true)
    })

    it("propagates contradicting polarity through a chain", () => {
        // P1: A → ¬B, P2: B → C, P3 (focused): C → D
        // P1 contradicts P2's antecedent, so P1 is transitively contradicting P3
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_A)
        p1.addVariable(VAR_B)
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("contradicting")
        expect(p1Result.transitive).toBe(true)
    })

    it("double negation through chain cancels to supporting", () => {
        // P1: A → ¬B, P2: ¬B → C, P3 (focused): C → D
        // P1's conseq is B(negative), P2's ante is B(negative) → polarity match → supporting
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_A)
        p1.addVariable(VAR_B)
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )

        const p2 = eng.createPremiseWithId("p2")
        p2.addVariable(VAR_B)
        p2.addVariable(VAR_C)
        p2.addExpression(makeOpExpr("p2-impl", "implies"))
        p2.addExpression(
            makeOpExpr("p2-not", "not", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-not",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-c", VAR_C.id, {
                parentId: "p2-impl",
                position: 1,
            })
        )

        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
        expect(p1Result.transitive).toBe(true)
    })

    it("constraint premise connected transitively is restricting", () => {
        // P1: A ∧ B (constraint), P2: B → C, P3 (focused): C → D
        // P1 shares B with P2 which supports P3 → P1 restricts P3 transitively
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_A)
        p1.addVariable(VAR_B)
        p1.addExpression(makeOpExpr("p1-and", "and"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-and",
                position: 1,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
        expect(p1Result.transitive).toBe(true)
    })
})
```

**Step 2: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS — the implementation from Task 3 already handles transitivity via BFS. If any fail, adjust the BFS polarity propagation logic.

**Step 3: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Add transitive relationship tests"
```

---

### Task 5: Precedence and edge cases (TDD)

**Files:**
- Test: `test/ExpressionManager.test.ts`

**Step 1: Write tests for precedence and edge cases**

Add a new describe block:

```typescript
describe("analyzePremiseRelationships — precedence and edge cases", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")

    function buildImplies(
        eng: ArgumentEngine,
        premiseId: string,
        leftVar: TCorePropositionalVariable,
        rightVar: TCorePropositionalVariable
    ): PremiseManager {
        const pm = eng.createPremiseWithId(premiseId)
        pm.addVariable(leftVar)
        if (leftVar.id !== rightVar.id) pm.addVariable(rightVar)
        pm.addExpression(makeOpExpr(`${premiseId}-impl`, "implies"))
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-l`, leftVar.id, {
                parentId: `${premiseId}-impl`,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-r`, rightVar.id, {
                parentId: `${premiseId}-impl`,
                position: 1,
            })
        )
        return pm
    }

    it("contradicting takes precedence over supporting", () => {
        // P1: A → (¬B ∧ C), P2 (focused): (B ∧ C) → D
        // B: contradicting (¬B in conseq, B in ante), C: supporting (C in conseq, C in ante)
        // Precedence: contradicting wins
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_A)
        p1.addVariable(VAR_B)
        p1.addVariable(VAR_C)
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-c", VAR_C.id, {
                parentId: "p1-and",
                position: 1,
            })
        )

        const p2 = eng.createPremiseWithId("p2")
        p2.addVariable(VAR_B)
        p2.addVariable(VAR_C)
        p2.addVariable(VAR_D)
        p2.addExpression(makeOpExpr("p2-impl", "implies"))
        p2.addExpression(
            makeOpExpr("p2-and", "and", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-and",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-c", VAR_C.id, {
                parentId: "p2-and",
                position: 1,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-d", VAR_D.id, {
                parentId: "p2-impl",
                position: 1,
            })
        )

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("contradicting")
    })

    it("restricting takes precedence over supporting", () => {
        // P1: B → (B ∧ C), P2 (focused): (B ∧ C) → D
        // B: restricting (in both ante and conseq of P1, in ante of P2)
        // C: supporting (in conseq of P1, in ante of P2)
        // Precedence: restricting wins
        const eng = new ArgumentEngine(ARG)
        const p1 = eng.createPremiseWithId("p1")
        p1.addVariable(VAR_B)
        p1.addVariable(VAR_C)
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-b1", VAR_B.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b2", VAR_B.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-c", VAR_C.id, {
                parentId: "p1-and",
                position: 1,
            })
        )

        const p2 = eng.createPremiseWithId("p2")
        p2.addVariable(VAR_B)
        p2.addVariable(VAR_C)
        p2.addVariable(VAR_D)
        p2.addExpression(makeOpExpr("p2-impl", "implies"))
        p2.addExpression(
            makeOpExpr("p2-and", "and", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-and",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-c", VAR_C.id, {
                parentId: "p2-and",
                position: 1,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-d", VAR_D.id, {
                parentId: "p2-impl",
                position: 1,
            })
        )

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
    })

    it("handles constraint-focused premise by classifying all sharers as restricting", () => {
        // P1: A → B, P2 (focused): A ∧ B (constraint)
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        const p2 = eng.createPremiseWithId("p2")
        p2.addVariable(VAR_A)
        p2.addVariable(VAR_B)
        p2.addExpression(makeOpExpr("p2-and", "and"))
        p2.addExpression(
            makeVarExpr("p2-ve-a", VAR_A.id, {
                parentId: "p2-and",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-and",
                position: 1,
            })
        )

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
    })

    it("handles empty premise as unrelated", () => {
        const eng = new ArgumentEngine(ARG)
        eng.createPremiseWithId("p1") // empty
        buildImplies(eng, "p2", VAR_A, VAR_B)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
    })

    it("handles graph cycles without hanging", () => {
        // P1: A → B, P2: B → A, P3 (focused): A → C
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_A)
        buildImplies(eng, "p3", VAR_A, VAR_C)

        // Should complete without infinite loop
        const result = analyzePremiseRelationships(eng, "p3")
        expect(result.premises).toHaveLength(2)
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
    })
})
```

**Step 2: Run tests**

Run: `pnpm run test`
Expected: PASS if the implementation handles all cases. If any fail, adjust the implementation accordingly.

**Step 3: Commit**

```bash
git add test/ExpressionManager.test.ts
git commit -m "Add precedence and edge case tests for premise relationships"
```

---

### Task 6: Lint, typecheck, and final verification

**Files:**
- All modified files

**Step 1: Run prettify**

Run: `pnpm run prettify`

**Step 2: Run eslint with auto-fix**

Run: `pnpm eslint . --fix`

**Step 3: Run full check**

Run: `pnpm run check`
Expected: All checks pass (typecheck, lint, test, build)

**Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "Fix formatting for premise relationships"
```

(Skip this commit if prettify/eslint made no changes.)
