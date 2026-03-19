# Subjective Logic Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Kleene three-valued evaluation with Jøsang's subjective logic opinions — a strict generalization where `true`/`false`/`null` map to corner opinions.

**Architecture:** New `subjective.ts` module with opinion type, operators, and utilities. Evaluation types in `evaluation.ts` change from `TCoreTrivalentValue` to `TOpinion`. `PremiseEngine.evaluate()` and `ArgumentEngine.evaluate()` swap Kleene operators for subjective operators and drop aggregate classification flags. `checkValidity()` recomputes counterexample detection inline from corner opinion equality. Input accepts `TOpinion | boolean | null` for backward compatibility.

**Tech Stack:** TypeScript, Vitest, Typebox

**Spec:** `docs/plans/2026-03-18-subjective-logic-design.md`

---

## File Map

| File                                                    | Action | Responsibility                                                                                                                                           |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/core/evaluation/subjective.ts`                 | Create | `TOpinion` type, corner constants, operators, utilities                                                                                                  |
| `src/lib/types/evaluation.ts`                           | Modify | Change `TCoreTrivalentValue` → `TOpinion` in result types, remove aggregate flags from `TCoreArgumentEvaluationResult`, update `TCoreVariableAssignment` |
| `src/lib/core/evaluation/validation.ts`                 | Modify | Update `buildDirectionalVacuity` and `implicationValue` to use subjective operators                                                                      |
| `src/lib/core/premise-engine.ts`                        | Modify | Swap Kleene → subjective in `evaluate()`                                                                                                                 |
| `src/lib/core/argument-engine.ts`                       | Modify | Remove aggregate flags from `evaluate()`, update resolver to `TOpinion`, update `checkValidity()` counterexample detection                               |
| `src/lib/index.ts`                                      | Modify | Re-export `subjective.ts` public symbols                                                                                                                 |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | Modify | Update `evaluate()` / `checkValidity()` JSDoc                                                                                                            |
| `src/lib/core/interfaces/premise-engine.interfaces.ts`  | Modify | Update `evaluate()` JSDoc                                                                                                                                |
| `src/cli/commands/analysis.ts`                          | Modify | Update evaluate output (removed flags), accept opinion input                                                                                             |
| `test/core.test.ts`                                     | Modify | Update existing assertions, add new subjective operator and evaluation tests                                                                             |
| `test/examples.test.ts`                                 | Modify | Update assertions that reference removed aggregate flags                                                                                                 |

---

### Task 1: TOpinion type, corner constants, and utilities

**Files:**

- Create: `src/lib/core/evaluation/subjective.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for TOpinion utilities**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
import {
    type TOpinion,
    OPINION_TRUE,
    OPINION_FALSE,
    OPINION_UNCERTAIN,
    toOpinion,
    isValidOpinion,
    projectProbability,
} from "../src/lib/core/evaluation/subjective.js"

describe("Subjective logic — TOpinion utilities", () => {
    describe("toOpinion", () => {
        it("converts true to OPINION_TRUE", () => {
            expect(toOpinion(true)).toEqual(OPINION_TRUE)
        })

        it("converts false to OPINION_FALSE", () => {
            expect(toOpinion(false)).toEqual(OPINION_FALSE)
        })

        it("converts null to OPINION_UNCERTAIN", () => {
            expect(toOpinion(null)).toEqual(OPINION_UNCERTAIN)
        })

        it("accepts a custom baseRate", () => {
            expect(toOpinion(true, 0.8)).toEqual({
                belief: 1,
                disbelief: 0,
                uncertainty: 0,
                baseRate: 0.8,
            })
        })
    })

    describe("isValidOpinion", () => {
        it("accepts valid corner opinions", () => {
            expect(isValidOpinion(OPINION_TRUE)).toBe(true)
            expect(isValidOpinion(OPINION_FALSE)).toBe(true)
            expect(isValidOpinion(OPINION_UNCERTAIN)).toBe(true)
        })

        it("accepts a valid interior opinion", () => {
            expect(
                isValidOpinion({
                    belief: 0.5,
                    disbelief: 0.3,
                    uncertainty: 0.2,
                    baseRate: 0.5,
                })
            ).toBe(true)
        })

        it("rejects opinions that do not sum to 1", () => {
            expect(
                isValidOpinion({
                    belief: 0.5,
                    disbelief: 0.5,
                    uncertainty: 0.5,
                    baseRate: 0.5,
                })
            ).toBe(false)
        })

        it("rejects negative components", () => {
            expect(
                isValidOpinion({
                    belief: -0.1,
                    disbelief: 0.6,
                    uncertainty: 0.5,
                    baseRate: 0.5,
                })
            ).toBe(false)
        })

        it("rejects baseRate outside [0, 1]", () => {
            expect(
                isValidOpinion({
                    belief: 0.5,
                    disbelief: 0.3,
                    uncertainty: 0.2,
                    baseRate: 1.5,
                })
            ).toBe(false)
        })
    })

    describe("projectProbability", () => {
        it("projects OPINION_TRUE to 1", () => {
            expect(projectProbability(OPINION_TRUE)).toBe(1)
        })

        it("projects OPINION_FALSE to 0", () => {
            expect(projectProbability(OPINION_FALSE)).toBe(0)
        })

        it("projects OPINION_UNCERTAIN to baseRate", () => {
            expect(projectProbability(OPINION_UNCERTAIN)).toBe(0.5)
        })

        it("projects interior opinion correctly", () => {
            // P = 0.7 + 0.5 * 0.1 = 0.75
            expect(
                projectProbability({
                    belief: 0.7,
                    disbelief: 0.2,
                    uncertainty: 0.1,
                    baseRate: 0.5,
                })
            ).toBeCloseTo(0.75)
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "(FAIL|Cannot find|does not provide)"`
Expected: Import errors — module doesn't exist yet.

- [ ] **Step 3: Implement TOpinion type, constants, and utilities**

Create `src/lib/core/evaluation/subjective.ts`:

```typescript
/** Subjective logic opinion: (belief, disbelief, uncertainty, baseRate). */
export interface TOpinion {
    readonly belief: number
    readonly disbelief: number
    readonly uncertainty: number
    readonly baseRate: number
}

/** Corner opinion for absolute belief. */
export const OPINION_TRUE: TOpinion = Object.freeze({
    belief: 1,
    disbelief: 0,
    uncertainty: 0,
    baseRate: 0.5,
})

/** Corner opinion for absolute disbelief. */
export const OPINION_FALSE: TOpinion = Object.freeze({
    belief: 0,
    disbelief: 1,
    uncertainty: 0,
    baseRate: 0.5,
})

/** Corner opinion for complete uncertainty. */
export const OPINION_UNCERTAIN: TOpinion = Object.freeze({
    belief: 0,
    disbelief: 0,
    uncertainty: 1,
    baseRate: 0.5,
})

const TOLERANCE = 1e-9

/** Converts a Kleene trivalue to a corner opinion. */
export function toOpinion(value: boolean | null, baseRate = 0.5): TOpinion {
    if (value === true)
        return baseRate === 0.5
            ? OPINION_TRUE
            : { belief: 1, disbelief: 0, uncertainty: 0, baseRate }
    if (value === false)
        return baseRate === 0.5
            ? OPINION_FALSE
            : { belief: 0, disbelief: 1, uncertainty: 0, baseRate }
    return baseRate === 0.5
        ? OPINION_UNCERTAIN
        : { belief: 0, disbelief: 0, uncertainty: 1, baseRate }
}

/** Checks whether an opinion satisfies the simplex constraints. */
export function isValidOpinion(o: TOpinion): boolean {
    if (o.belief < 0 || o.disbelief < 0 || o.uncertainty < 0) return false
    if (o.belief > 1 || o.disbelief > 1 || o.uncertainty > 1) return false
    if (o.baseRate < 0 || o.baseRate > 1) return false
    return Math.abs(o.belief + o.disbelief + o.uncertainty - 1) < TOLERANCE
}

/** Projects an opinion to a probability: P(x) = belief + baseRate * uncertainty. */
export function projectProbability(o: TOpinion): number {
    return o.belief + o.baseRate * o.uncertainty
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "(Subjective logic|PASS|FAIL)"`
Expected: All new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/evaluation/subjective.ts test/core.test.ts
git commit -m "feat: add TOpinion type, corner constants, and utility functions"
```

---

### Task 2: Subjective logic operators

**Files:**

- Modify: `src/lib/core/evaluation/subjective.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for operators**

Add to `test/core.test.ts`, after the utilities describe block:

```typescript
import {
    subjectiveNot,
    subjectiveAnd,
    subjectiveOr,
    subjectiveImplies,
    subjectiveIff,
} from "../src/lib/core/evaluation/subjective.js"

describe("Subjective logic — operators", () => {
    // Helper: check that b + d + u ≈ 1
    function expectValidOpinion(o: TOpinion) {
        expect(o.belief + o.disbelief + o.uncertainty).toBeCloseTo(1, 9)
        expect(o.belief).toBeGreaterThanOrEqual(0)
        expect(o.disbelief).toBeGreaterThanOrEqual(0)
        expect(o.uncertainty).toBeGreaterThanOrEqual(0)
    }

    // Helper: compare only the mass triple (b, d, u), ignoring baseRate.
    // baseRate propagates through binary operators (e.g., AND: a_out = a_a * a_b),
    // so corner inputs (baseRate=0.5) don't produce corner baseRates in outputs.
    // The mass values are what matter for logical equivalence with Kleene.
    function expectMasses(o: TOpinion, b: number, d: number, u: number) {
        expect(o.belief).toBeCloseTo(b)
        expect(o.disbelief).toBeCloseTo(d)
        expect(o.uncertainty).toBeCloseTo(u)
        expectValidOpinion(o)
    }

    describe("subjectiveNot", () => {
        it("NOT OPINION_TRUE = OPINION_FALSE", () => {
            expect(subjectiveNot(OPINION_TRUE)).toEqual(OPINION_FALSE)
        })

        it("NOT OPINION_FALSE = OPINION_TRUE", () => {
            expect(subjectiveNot(OPINION_FALSE)).toEqual(OPINION_TRUE)
        })

        it("NOT OPINION_UNCERTAIN = OPINION_UNCERTAIN", () => {
            expect(subjectiveNot(OPINION_UNCERTAIN)).toEqual(OPINION_UNCERTAIN)
        })

        it("swaps belief/disbelief and complements baseRate for interior opinion", () => {
            const o: TOpinion = {
                belief: 0.7,
                disbelief: 0.2,
                uncertainty: 0.1,
                baseRate: 0.8,
            }
            const result = subjectiveNot(o)
            expect(result.belief).toBeCloseTo(0.2)
            expect(result.disbelief).toBeCloseTo(0.7)
            expect(result.uncertainty).toBeCloseTo(0.1)
            expect(result.baseRate).toBeCloseTo(0.2) // 1 - 0.8
            expectValidOpinion(result)
        })
    })

    describe("subjectiveAnd", () => {
        it("TRUE AND TRUE has masses (1, 0, 0)", () => {
            expectMasses(subjectiveAnd(OPINION_TRUE, OPINION_TRUE), 1, 0, 0)
        })

        it("TRUE AND FALSE has masses (0, 1, 0)", () => {
            expectMasses(subjectiveAnd(OPINION_TRUE, OPINION_FALSE), 0, 1, 0)
        })

        it("FALSE AND TRUE has masses (0, 1, 0)", () => {
            expectMasses(subjectiveAnd(OPINION_FALSE, OPINION_TRUE), 0, 1, 0)
        })

        it("FALSE AND FALSE has masses (0, 1, 0)", () => {
            expectMasses(subjectiveAnd(OPINION_FALSE, OPINION_FALSE), 0, 1, 0)
        })

        it("TRUE AND UNCERTAIN has masses (0, 0, 1)", () => {
            expectMasses(
                subjectiveAnd(OPINION_TRUE, OPINION_UNCERTAIN),
                0,
                0,
                1
            )
        })

        it("FALSE AND UNCERTAIN has masses (0, 1, 0)", () => {
            expectMasses(
                subjectiveAnd(OPINION_FALSE, OPINION_UNCERTAIN),
                0,
                1,
                0
            )
        })

        it("AND propagates baseRate as product", () => {
            const a: TOpinion = {
                belief: 1,
                disbelief: 0,
                uncertainty: 0,
                baseRate: 0.8,
            }
            const b: TOpinion = {
                belief: 1,
                disbelief: 0,
                uncertainty: 0,
                baseRate: 0.6,
            }
            expect(subjectiveAnd(a, b).baseRate).toBeCloseTo(0.48)
        })

        it("computes correct interior result", () => {
            const a: TOpinion = {
                belief: 0.8,
                disbelief: 0.1,
                uncertainty: 0.1,
                baseRate: 0.5,
            }
            const b: TOpinion = {
                belief: 0.6,
                disbelief: 0.2,
                uncertainty: 0.2,
                baseRate: 0.5,
            }
            const result = subjectiveAnd(a, b)
            // b_out = 0.8 * 0.6 = 0.48
            expect(result.belief).toBeCloseTo(0.48)
            // d_out = 0.1 + 0.2 - 0.1 * 0.2 = 0.28
            expect(result.disbelief).toBeCloseTo(0.28)
            // u_out = 0.8 * 0.2 + 0.1 * 0.6 + 0.1 * 0.2 = 0.24
            expect(result.uncertainty).toBeCloseTo(0.24)
            // baseRate_out = 0.5 * 0.5 = 0.25
            expect(result.baseRate).toBeCloseTo(0.25)
            expectValidOpinion(result)
        })
    })

    describe("subjectiveOr", () => {
        it("TRUE OR FALSE has masses (1, 0, 0)", () => {
            expectMasses(subjectiveOr(OPINION_TRUE, OPINION_FALSE), 1, 0, 0)
        })

        it("FALSE OR FALSE has masses (0, 1, 0)", () => {
            expectMasses(subjectiveOr(OPINION_FALSE, OPINION_FALSE), 0, 1, 0)
        })

        it("FALSE OR UNCERTAIN has masses (0, 0, 1)", () => {
            expectMasses(
                subjectiveOr(OPINION_FALSE, OPINION_UNCERTAIN),
                0,
                0,
                1
            )
        })

        it("TRUE OR UNCERTAIN has masses (1, 0, 0)", () => {
            expectMasses(subjectiveOr(OPINION_TRUE, OPINION_UNCERTAIN), 1, 0, 0)
        })

        it("computes correct interior result", () => {
            const a: TOpinion = {
                belief: 0.8,
                disbelief: 0.1,
                uncertainty: 0.1,
                baseRate: 0.5,
            }
            const b: TOpinion = {
                belief: 0.6,
                disbelief: 0.2,
                uncertainty: 0.2,
                baseRate: 0.5,
            }
            const result = subjectiveOr(a, b)
            // b_out = 0.8 + 0.6 - 0.8 * 0.6 = 0.92
            expect(result.belief).toBeCloseTo(0.92)
            // d_out = 0.1 * 0.2 = 0.02
            expect(result.disbelief).toBeCloseTo(0.02)
            // u_out = 0.1 * 0.2 + 0.1 * 0.2 + 0.1 * 0.2 = 0.06
            expect(result.uncertainty).toBeCloseTo(0.06)
            expectValidOpinion(result)
        })
    })

    describe("subjectiveImplies", () => {
        it("TRUE -> TRUE has masses (1, 0, 0)", () => {
            expectMasses(subjectiveImplies(OPINION_TRUE, OPINION_TRUE), 1, 0, 0)
        })

        it("TRUE -> FALSE has masses (0, 1, 0)", () => {
            expectMasses(
                subjectiveImplies(OPINION_TRUE, OPINION_FALSE),
                0,
                1,
                0
            )
        })

        it("FALSE -> TRUE has masses (1, 0, 0)", () => {
            expectMasses(
                subjectiveImplies(OPINION_FALSE, OPINION_TRUE),
                1,
                0,
                0
            )
        })

        it("FALSE -> FALSE has masses (1, 0, 0)", () => {
            expectMasses(
                subjectiveImplies(OPINION_FALSE, OPINION_FALSE),
                1,
                0,
                0
            )
        })

        it("FALSE -> UNCERTAIN has masses (1, 0, 0)", () => {
            expectMasses(
                subjectiveImplies(OPINION_FALSE, OPINION_UNCERTAIN),
                1,
                0,
                0
            )
        })

        it("UNCERTAIN -> TRUE has masses (1, 0, 0)", () => {
            expectMasses(
                subjectiveImplies(OPINION_UNCERTAIN, OPINION_TRUE),
                1,
                0,
                0
            )
        })

        it("TRUE -> UNCERTAIN has masses (0, 0, 1)", () => {
            expectMasses(
                subjectiveImplies(OPINION_TRUE, OPINION_UNCERTAIN),
                0,
                0,
                1
            )
        })

        it("UNCERTAIN -> FALSE has masses (0, 0, 1)", () => {
            expectMasses(
                subjectiveImplies(OPINION_UNCERTAIN, OPINION_FALSE),
                0,
                0,
                1
            )
        })
    })

    describe("subjectiveIff", () => {
        it("TRUE <-> TRUE has masses (1, 0, 0)", () => {
            expectMasses(subjectiveIff(OPINION_TRUE, OPINION_TRUE), 1, 0, 0)
        })

        it("TRUE <-> FALSE has masses (0, 1, 0)", () => {
            expectMasses(subjectiveIff(OPINION_TRUE, OPINION_FALSE), 0, 1, 0)
        })

        it("FALSE <-> FALSE has masses (1, 0, 0)", () => {
            expectMasses(subjectiveIff(OPINION_FALSE, OPINION_FALSE), 1, 0, 0)
        })

        it("TRUE <-> UNCERTAIN has masses (0, 0, 1)", () => {
            expectMasses(
                subjectiveIff(OPINION_TRUE, OPINION_UNCERTAIN),
                0,
                0,
                1
            )
        })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "(FAIL|does not provide)"`
Expected: Import errors — functions don't exist yet.

- [ ] **Step 3: Implement subjective operators**

Append to `src/lib/core/evaluation/subjective.ts`:

```typescript
/** Subjective complement: swap belief/disbelief, complement baseRate. */
export function subjectiveNot(a: TOpinion): TOpinion {
    return {
        belief: a.disbelief,
        disbelief: a.belief,
        uncertainty: a.uncertainty,
        baseRate: 1 - a.baseRate,
    }
}

/** Subjective independent conjunction. */
export function subjectiveAnd(a: TOpinion, b: TOpinion): TOpinion {
    return {
        belief: a.belief * b.belief,
        disbelief: a.disbelief + b.disbelief - a.disbelief * b.disbelief,
        uncertainty:
            a.belief * b.uncertainty +
            a.uncertainty * b.belief +
            a.uncertainty * b.uncertainty,
        baseRate: a.baseRate * b.baseRate,
    }
}

/** Subjective independent disjunction (direct formula, dual of AND). */
export function subjectiveOr(a: TOpinion, b: TOpinion): TOpinion {
    return {
        belief: a.belief + b.belief - a.belief * b.belief,
        disbelief: a.disbelief * b.disbelief,
        uncertainty:
            a.disbelief * b.uncertainty +
            a.uncertainty * b.disbelief +
            a.uncertainty * b.uncertainty,
        baseRate: a.baseRate + b.baseRate - a.baseRate * b.baseRate,
    }
}

/** Subjective material implication: OR(NOT a, b). */
export function subjectiveImplies(a: TOpinion, b: TOpinion): TOpinion {
    return subjectiveOr(subjectiveNot(a), b)
}

/** Subjective biconditional: AND(IMPLIES(a, b), IMPLIES(b, a)). */
export function subjectiveIff(a: TOpinion, b: TOpinion): TOpinion {
    return subjectiveAnd(subjectiveImplies(a, b), subjectiveImplies(b, a))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --reporter=verbose 2>&1 | grep -E "(Subjective logic|PASS|FAIL)"`
Expected: All operator tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/evaluation/subjective.ts test/core.test.ts
git commit -m "feat: add subjective logic operators (NOT, AND, OR, IMPLIES, IFF)"
```

---

### Task 3: Update evaluation types

**Files:**

- Modify: `src/lib/types/evaluation.ts`

This task changes the type definitions. No tests yet — they compile-fail until the engines are updated in subsequent tasks.

- [ ] **Step 1: Update `TCoreVariableAssignment` to accept opinions**

In `src/lib/types/evaluation.ts`, change:

```typescript
// Before
import type { TCoreArgumentRoleState } from "../schemata/index.js"

// After
import type { TCoreArgumentRoleState } from "../schemata/index.js"
import type { TOpinion } from "../core/evaluation/subjective.js"
```

Change `TCoreVariableAssignment`:

```typescript
// Before
export type TCoreVariableAssignment = Record<string, TCoreTrivalentValue>

// After
export type TCoreVariableAssignment = Record<string, TOpinion | boolean | null>
```

- [ ] **Step 2: Update `TCoreDirectionalVacuity` fields to TOpinion**

```typescript
// Before
export interface TCoreDirectionalVacuity {
    antecedentTrue: TCoreTrivalentValue
    consequentTrue: TCoreTrivalentValue
    implicationValue: TCoreTrivalentValue
    isVacuouslyTrue: TCoreTrivalentValue
    fired: TCoreTrivalentValue
}

// After
export interface TCoreDirectionalVacuity {
    antecedentTrue: TOpinion
    consequentTrue: TOpinion
    implicationValue: TOpinion
    isVacuouslyTrue: TOpinion
    fired: TOpinion
}
```

- [ ] **Step 3: Update `TCorePremiseInferenceDiagnostic` fields to TOpinion**

Change all `TCoreTrivalentValue` fields to `TOpinion` in both the `implies` and `iff` variants. The `kind`, `premiseId`, and `rootExpressionId` fields stay as strings.

- [ ] **Step 4: Update `TCorePremiseEvaluationResult` fields to TOpinion**

```typescript
// Before
rootValue?: TCoreTrivalentValue
expressionValues: Record<string, TCoreTrivalentValue>
variableValues: Record<string, TCoreTrivalentValue>

// After
rootValue?: TOpinion
expressionValues: Record<string, TOpinion>
variableValues: Record<string, TOpinion>
```

- [ ] **Step 5: Remove aggregate flags from `TCoreArgumentEvaluationResult`**

Remove these five fields entirely:

- `isAdmissibleAssignment`
- `allSupportingPremisesTrue`
- `conclusionTrue`
- `isCounterexample`
- `preservesTruthUnderAssignment`

Remove the JSDoc comments for each removed field.

- [ ] **Step 6: Verify typecheck fails (expected — engines not yet updated)**

Run: `pnpm run typecheck 2>&1 | head -30`
Expected: Type errors in `premise-engine.ts`, `argument-engine.ts`, `analysis.ts`, and test files. This is expected — we fix them in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/evaluation.ts
git commit -m "feat: update evaluation types — TOpinion replaces TCoreTrivalentValue in results"
```

---

### Task 4: Update validation helpers

**Files:**

- Modify: `src/lib/core/evaluation/validation.ts`

- [ ] **Step 1: Update imports and function signatures**

```typescript
// Before
import type {
    TCoreDirectionalVacuity,
    TCoreTrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import { kleeneAnd, kleeneImplies, kleeneNot } from "./kleene.js"

// After
import type {
    TCoreDirectionalVacuity,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import type { TOpinion } from "./subjective.js"
import {
    subjectiveAnd,
    subjectiveImplies,
    subjectiveNot,
} from "./subjective.js"
```

- [ ] **Step 2: Update `implicationValue` and `buildDirectionalVacuity`**

```typescript
/** Computes subjective material implication. */
export function implicationValue(
    antecedent: TOpinion,
    consequent: TOpinion
): TOpinion {
    return subjectiveImplies(antecedent, consequent)
}

/** Builds a directional vacuity diagnostic for one direction of an implication. */
export function buildDirectionalVacuity(
    antecedentTrue: TOpinion,
    consequentTrue: TOpinion
): TCoreDirectionalVacuity {
    const implication = implicationValue(antecedentTrue, consequentTrue)
    return {
        antecedentTrue,
        consequentTrue,
        implicationValue: implication,
        isVacuouslyTrue: subjectiveAnd(
            implication,
            subjectiveNot(antecedentTrue)
        ),
        fired: antecedentTrue,
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/evaluation/validation.ts
git commit -m "feat: update validation helpers to use subjective operators"
```

---

### Task 5: Update PremiseEngine.evaluate()

**Files:**

- Modify: `src/lib/core/premise-engine.ts`

- [ ] **Step 1: Update imports**

Replace Kleene imports with subjective imports. Keep the `buildDirectionalVacuity` import (it's already updated).

```typescript
// Remove these imports:
import {
    kleeneAnd,
    kleeneIff,
    kleeneImplies,
    kleeneNot,
    kleeneOr,
} from "./evaluation/kleene.js"

// Add these imports:
import {
    type TOpinion,
    OPINION_FALSE,
    OPINION_TRUE,
    toOpinion,
    isValidOpinion,
    subjectiveNot,
    subjectiveAnd,
    subjectiveOr,
    subjectiveImplies,
    subjectiveIff,
} from "./evaluation/subjective.js"
```

Also remove `TCoreTrivalentValue` from the `../../types/evaluation.js` import if it's only used in `evaluate()`.

- [ ] **Step 2: Update `evaluate()` method body**

Key changes in the `evaluate()` method (around lines 926-1133):

1. Change `expressionValues` type:

    ```typescript
    const expressionValues: Record<string, TOpinion> = {}
    ```

2. Change `evaluateExpression` return type and inner `value` declarations:

    ```typescript
    const evaluateExpression = (expressionId: string): TOpinion => {
    ```

3. Rejected expressions return `OPINION_FALSE`:

    ```typescript
    if (assignment.rejectedExpressionIds.includes(expression.id)) {
        expressionValues[expression.id] = OPINION_FALSE
        return OPINION_FALSE
    }
    ```

4. Variable lookup normalizes through `toOpinion()`:

    ```typescript
    if (expression.type === "variable") {
        let value: TOpinion
        if (options?.resolver) {
            const variable = this.variables.getVariable(expression.variableId)
            if (variable && isPremiseBound(variable)) {
                value = options.resolver(expression.variableId)
            } else {
                const raw = assignment.variables[expression.variableId] ?? null
                value =
                    typeof raw === "object" && raw !== null && "belief" in raw
                        ? raw
                        : toOpinion(raw as boolean | null)
            }
        } else {
            const raw = assignment.variables[expression.variableId] ?? null
            value =
                typeof raw === "object" && raw !== null && "belief" in raw
                    ? raw
                    : toOpinion(raw as boolean | null)
        }
        expressionValues[expression.id] = value
        return value
    }
    ```

    **Important:** Extract the normalization into a local helper at the top of `evaluate()` to avoid duplication:

    ```typescript
    const normalizeValue = (
        raw: TOpinion | boolean | null | undefined
    ): TOpinion => {
        if (raw === undefined || raw === null) return toOpinion(null)
        if (typeof raw === "boolean") return toOpinion(raw)
        return raw as TOpinion
    }
    ```

5. Operator switch — replace Kleene with subjective:

    ```typescript
    case "not":
        value = subjectiveNot(evaluateExpression(children[0].id))
        break
    case "and":
        value = children.reduce<TOpinion>(
            (acc, child) => subjectiveAnd(acc, evaluateExpression(child.id)),
            OPINION_TRUE
        )
        break
    case "or":
        value = children.reduce<TOpinion>(
            (acc, child) => subjectiveOr(acc, evaluateExpression(child.id)),
            OPINION_FALSE
        )
        break
    case "implies": {
        const left = children.find((child) => child.position === 0)
        const right = children.find((child) => child.position === 1)
        value = subjectiveImplies(
            evaluateExpression(left!.id),
            evaluateExpression(right!.id)
        )
        break
    }
    case "iff": {
        const left = children.find((child) => child.position === 0)
        const right = children.find((child) => child.position === 1)
        value = subjectiveIff(
            evaluateExpression(left!.id),
            evaluateExpression(right!.id)
        )
        break
    }
    ```

6. Update `variableValues` construction:

    ```typescript
    const variableValues: Record<string, TOpinion> = {}
    for (const variableId of referencedVariableIds) {
        if (options?.resolver) {
            const variable = this.variables.getVariable(variableId)
            if (variable && isPremiseBound(variable)) {
                variableValues[variableId] = options.resolver(variableId)
                continue
            }
        }
        variableValues[variableId] = normalizeValue(
            assignment.variables[variableId]
        )
    }
    ```

7. Update inference diagnostics — replace `kleeneNot`/`kleeneAnd` with `subjectiveNot`/`subjectiveAnd`:

    ```typescript
    // implies diagnostic
    isVacuouslyTrue: subjectiveNot(leftValue),
    fired: leftValue,
    firedAndHeld: subjectiveAnd(leftValue, rightValue),

    // iff diagnostic
    bothSidesTrue: subjectiveAnd(leftValue, rightValue),
    bothSidesFalse: subjectiveAnd(subjectiveNot(leftValue), subjectiveNot(rightValue)),
    ```

8. Update the resolver callback type in the options:
    ```typescript
    resolver?: (variableId: string) => TOpinion
    ```

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "feat: update PremiseEngine.evaluate() to use subjective operators"
```

---

### Task 6: Update ArgumentEngine.evaluate() and checkValidity()

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Update imports**

```typescript
// Remove:
import { kleeneAnd, kleeneNot } from "./evaluation/kleene.js"
// Remove TCoreTrivalentValue from evaluation type imports (if only used in evaluate)

// Add:
import {
    type TOpinion,
    OPINION_TRUE,
    OPINION_FALSE,
    OPINION_UNCERTAIN,
    toOpinion,
} from "./evaluation/subjective.js"
```

- [ ] **Step 2: Update `evaluate()` method**

1. Change resolver cache and callback:

    ```typescript
    const resolverCache = new Map<string, TOpinion>()
    const resolver = (variableId: string): TOpinion => {
        if (resolverCache.has(variableId)) {
            return resolverCache.get(variableId)!
        }
        const variable = this.variables.getVariable(variableId)
        if (!variable || !isPremiseBound(variable)) {
            const raw = assignment.variables[variableId] ?? null
            if (typeof raw === "object" && raw !== null && "belief" in raw)
                return raw as TOpinion
            return toOpinion(raw as boolean | null)
        }
        const boundPremiseId = variable.boundPremiseId
        const boundPremise = this.premises.get(boundPremiseId)
        if (!boundPremise) {
            resolverCache.set(variableId, OPINION_UNCERTAIN)
            return OPINION_UNCERTAIN
        }
        const premiseResult = boundPremise.evaluate(assignment, { resolver })
        const value = premiseResult?.rootValue ?? OPINION_UNCERTAIN
        resolverCache.set(variableId, value)
        return value
    }
    ```

2. Remove the aggregate flag computation block (lines ~1506-1554 — the `isAdmissibleAssignment`, `allSupportingPremisesTrue`, `conclusionTrue`, `isCounterexample`, `preservesTruthUnderAssignment` block).

3. Simplify the return:
    ```typescript
    return {
        ok: true,
        assignment: {
            variables: { ...assignment.variables },
            rejectedExpressionIds: [...assignment.rejectedExpressionIds],
        },
        referencedVariableIds,
        conclusion: strip(conclusionEvaluation),
        supportingPremises: supportingEvaluations.map(strip),
        constraintPremises: constraintEvaluations.map(strip),
    }
    ```

- [ ] **Step 3: Update `checkValidity()` counterexample and admissibility detection**

Replace the two checks that use removed fields:

```typescript
// Before:
if (result.isAdmissibleAssignment === true) {
    numAdmissibleAssignments += 1
}
if (result.isCounterexample === true) {

// After — helper function at the top of checkValidity().
// Only checks masses (b, d, u), NOT baseRate — baseRate propagates
// through operators and won't be 0.5 for computed values.
const isCornerTrue = (o?: TOpinion): boolean =>
    o !== undefined && o.belief === 1 && o.disbelief === 0 && o.uncertainty === 0

const isCornerFalse = (o?: TOpinion): boolean =>
    o !== undefined && o.belief === 0 && o.disbelief === 1 && o.uncertainty === 0

// Then in the loop:
const allConstraintsTrue = constraintPremises.every((pm) => {
    const pmResult = result.constraintPremises?.find(
        (r) => r.premiseId === pm.getId()
    )
    return isCornerTrue(pmResult?.rootValue)
})
if (allConstraintsTrue) {
    numAdmissibleAssignments += 1
}

const allSupportingTrue = result.supportingPremises?.every(
    (r) => isCornerTrue(r.rootValue)
) ?? true
const conclusionFalse = isCornerFalse(result.conclusion?.rootValue)
if (allConstraintsTrue && allSupportingTrue && conclusionFalse) {
    counterexamples.push({
        assignment: result.assignment!,
        result,
    })
    if (mode === "firstCounterexample") {
        break
    }
}
```

**Note:** The constraint premise IDs are available from the `constraintPremises` array built earlier in `checkValidity()`. The `result.constraintPremises` array returned from `evaluate()` has matching `premiseId` fields. Alternatively, since the evaluate result's `constraintPremises` array is in the same order, you can use index-based comparison. Choose whichever is cleaner during implementation.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "feat: update ArgumentEngine evaluate/checkValidity for subjective logic"
```

---

### Task 7: Update existing tests

**Files:**

- Modify: `test/core.test.ts`
- Modify: `test/examples.test.ts`

This is the largest task — many existing assertions reference `TCoreTrivalentValue` results or the removed aggregate flags.

- [ ] **Step 1: Update Kleene test assertions**

The "Kleene three-valued logic helpers" tests (line ~2826) test the Kleene functions directly — these stay unchanged since `kleene.ts` is retained.

- [ ] **Step 2: Update PremiseEngine evaluation test assertions**

Tests in "PremiseEngine — validation and evaluation" (line ~1801) and "PremiseEngine — three-valued evaluation" (line ~2998) assert `result.rootValue` with `.toBe(true)`, `.toBe(false)`, `.toBeNull()`. These need to change to compare against corner opinions:

**Important baseRate note:** Binary operators propagate baseRate (e.g., AND: `a_out = a_a * a_b`), so operator _outputs_ from corner inputs won't have `baseRate: 0.5`. Use `toMatchObject` with only the mass triple for assertions on computed values. Direct variable lookups (via `toOpinion`) will have `baseRate: 0.5` and can use `toEqual(OPINION_*)`.

```typescript
// For variable lookups (direct from assignment — baseRate preserved):
// Before:
expect(result.rootValue).toBe(true)
// After:
expect(result.rootValue).toEqual(OPINION_TRUE)

// For operator outputs (baseRate may differ):
// Before:
expect(result.rootValue).toBe(false)
// After:
expect(result.rootValue).toMatchObject({
    belief: 0,
    disbelief: 1,
    uncertainty: 0,
})

// Before:
expect(result.rootValue).toBeNull()
// After (if from operator output):
expect(result.rootValue).toMatchObject({
    belief: 0,
    disbelief: 0,
    uncertainty: 1,
})

// Before:
expect(result.expressionValues["e-p"]).toBe(true)
// After:
expect(result.expressionValues["e-p"]).toEqual(OPINION_TRUE)
```

Rejected expressions now return `OPINION_FALSE` instead of `false` (direct assignment, not operator output — can use `toEqual`):

```typescript
// Before:
expect(result.expressionValues["and-child"]).toBe(false)
// After:
expect(result.expressionValues["and-child"]).toEqual(OPINION_FALSE)
```

The `.toBeUndefined()` assertions for skipped children remain unchanged.

Inference diagnostic field assertions — use `toMatchObject` with masses since diagnostic values come from operators:

```typescript
// Before:
expect(result.inferenceDiagnostic).toMatchObject({
    kind: "implies",
    antecedentTrue: true,
    consequentTrue: false,
    fired: true,
    firedAndHeld: false,
    isVacuouslyTrue: false,
})
// After:
expect(result.inferenceDiagnostic?.kind).toBe("implies")
expect(result.inferenceDiagnostic?.antecedentTrue).toEqual(OPINION_TRUE)
expect(result.inferenceDiagnostic?.consequentTrue).toEqual(OPINION_FALSE)
expect(result.inferenceDiagnostic?.fired).toEqual(OPINION_TRUE)
expect(result.inferenceDiagnostic?.firedAndHeld).toMatchObject({
    belief: 0,
    disbelief: 1,
    uncertainty: 0,
})
expect(result.inferenceDiagnostic?.isVacuouslyTrue).toMatchObject({
    belief: 0,
    disbelief: 1,
    uncertainty: 0,
})
```

Note: `antecedentTrue`, `consequentTrue`, and `fired` are direct variable lookups (not operator outputs), so they preserve `baseRate: 0.5`. `firedAndHeld` and `isVacuouslyTrue` are operator outputs (`subjectiveAnd`, `subjectiveNot`) so use `toMatchObject`.

Add `OPINION_TRUE`, `OPINION_FALSE`, `OPINION_UNCERTAIN` imports at the top of the test file.

- [ ] **Step 3: Update ArgumentEngine evaluation test assertions**

Tests in "ArgumentEngine — roles and evaluation" (line ~1864) and "ArgumentEngine — three-valued evaluation" (line ~3231) reference the removed aggregate flags. Update or remove these assertions:

```typescript
// Before:
expect(result.isAdmissibleAssignment).toBe(false)
expect(result.isCounterexample).toBe(false)
expect(result.preservesTruthUnderAssignment).toBe(true)
// After — derive from per-premise results:
expect(result.constraintPremises?.[0]?.rootValue).toEqual(OPINION_FALSE)
// Or simply remove these assertions if the test's purpose was to verify the
// aggregate flags. The per-premise results are already tested.
```

For the "three-valued evaluation" tests that specifically test `isCounterexample`, `isAdmissibleAssignment`, `conclusionTrue`, `preservesTruthUnderAssignment` — these tests are about the removed flags, so they should be **replaced** with tests that verify the per-premise root opinions directly:

```typescript
// Before: "returns null for isAdmissibleAssignment when constraint is null"
expect(result.isAdmissibleAssignment).toBe(null)

// After: verify the constraint premise root opinion is OPINION_UNCERTAIN
expect(result.constraintPremises?.[0]?.rootValue).toEqual(OPINION_UNCERTAIN)
```

- [ ] **Step 4: Update `test/examples.test.ts` assertions**

These tests reference `allSupportingPremisesTrue`, `conclusionTrue`, `isCounterexample`. Replace:

```typescript
// Before:
expect(result.allSupportingPremisesTrue).toBe(true)
expect(result.conclusionTrue).toBe(true)
expect(result.isCounterexample).toBe(false)

// After — verify conclusion root directly:
expect(result.conclusion?.rootValue).toEqual(OPINION_TRUE)
expect(
    result.supportingPremises?.every(
        (p) =>
            p.rootValue !== undefined &&
            p.rootValue.belief === 1 &&
            p.rootValue.disbelief === 0
    )
).toBe(true)
```

The `checkValidity()` tests should pass unchanged since their assertions are on `isValid`, `numAssignmentsChecked`, `numAdmissibleAssignments`, and `counterexamples.length` — none of which changed.

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add test/core.test.ts test/examples.test.ts
git commit -m "test: update evaluation assertions for TOpinion return types"
```

---

### Task 8: Add opinion-specific evaluation tests

**Files:**

- Modify: `test/core.test.ts`

- [ ] **Step 1: Write tests for evaluating with interior opinions**

Add a new describe block at the bottom of `test/core.test.ts`:

```typescript
describe("Subjective logic — opinion evaluation", () => {
    it("evaluates a variable with an interior opinion", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const opinion: TOpinion = {
            belief: 0.7,
            disbelief: 0.2,
            uncertainty: 0.1,
            baseRate: 0.5,
        }
        const result = pm.evaluate({
            variables: { "var-p": opinion },
            rejectedExpressionIds: [],
        })
        expect(result.rootValue).toEqual(opinion)
    })

    it("evaluates NOT with interior opinion", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("not-root", "not"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "not-root", position: 0 })
        )

        const opinion: TOpinion = {
            belief: 0.7,
            disbelief: 0.2,
            uncertainty: 0.1,
            baseRate: 0.8,
        }
        const result = pm.evaluate({
            variables: { "var-p": opinion },
            rejectedExpressionIds: [],
        })
        expect(result.rootValue?.belief).toBeCloseTo(0.2)
        expect(result.rootValue?.disbelief).toBeCloseTo(0.7)
        expect(result.rootValue?.uncertainty).toBeCloseTo(0.1)
        expect(result.rootValue?.baseRate).toBeCloseTo(0.2)
    })

    it("evaluates AND with mixed opinions and booleans", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("and-root", "and"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-root", position: 1 })
        )

        // Mix: P gets an opinion, Q gets a boolean (sugar)
        const opinion: TOpinion = {
            belief: 0.8,
            disbelief: 0.1,
            uncertainty: 0.1,
            baseRate: 0.5,
        }
        const result = pm.evaluate({
            variables: { "var-p": opinion, "var-q": true },
            rejectedExpressionIds: [],
        })
        // AND(opinion, OPINION_TRUE) = opinion (identity)
        expect(result.rootValue?.belief).toBeCloseTo(0.8)
        expect(result.rootValue?.disbelief).toBeCloseTo(0.1)
        expect(result.rootValue?.uncertainty).toBeCloseTo(0.1)
    })

    it("evaluates an implication with interior opinions and produces diagnostic", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "impl", position: 1 })
        )

        const pOpinion: TOpinion = {
            belief: 0.9,
            disbelief: 0.05,
            uncertainty: 0.05,
            baseRate: 0.5,
        }
        const qOpinion: TOpinion = {
            belief: 0.3,
            disbelief: 0.5,
            uncertainty: 0.2,
            baseRate: 0.5,
        }
        const result = pm.evaluate({
            variables: { "var-p": pOpinion, "var-q": qOpinion },
            rejectedExpressionIds: [],
        })

        expect(result.premiseType).toBe("inference")
        expect(result.inferenceDiagnostic?.kind).toBe("implies")
        // Root value should be a valid opinion
        expect(
            result.rootValue!.belief +
                result.rootValue!.disbelief +
                result.rootValue!.uncertainty
        ).toBeCloseTo(1)
    })

    it("rejects invalid opinion in assignment", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const invalid = {
            belief: 0.5,
            disbelief: 0.5,
            uncertainty: 0.5,
            baseRate: 0.5,
        }
        expect(() =>
            pm.evaluate({
                variables: { "var-p": invalid },
                rejectedExpressionIds: [],
            })
        ).toThrow()
    })

    it("argument-level evaluate returns per-premise opinions without aggregate flags", () => {
        const eng = new ArgumentEngine(ARG, aLib(), sLib(), csLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })

        support.addExpression(makeOpExpr("impl", "implies"))
        support.addExpression(
            makeVarExpr("impl-p", VAR_P.id, { parentId: "impl", position: 0 })
        )
        support.addExpression(
            makeVarExpr("impl-q", VAR_Q.id, { parentId: "impl", position: 1 })
        )
        conclusion.addExpression(makeVarExpr("c-q", VAR_Q.id))
        eng.setConclusionPremise(conclusion.getId())

        const pOpinion: TOpinion = {
            belief: 0.8,
            disbelief: 0.1,
            uncertainty: 0.1,
            baseRate: 0.5,
        }
        const qOpinion: TOpinion = {
            belief: 0.6,
            disbelief: 0.2,
            uncertainty: 0.2,
            baseRate: 0.5,
        }
        const result = eng.evaluate({
            variables: { [VAR_P.id]: pOpinion, [VAR_Q.id]: qOpinion },
            rejectedExpressionIds: [],
        })

        expect(result.ok).toBe(true)
        expect(result.conclusion?.rootValue).toEqual(qOpinion)
        // Aggregate flags should not exist
        expect(result).not.toHaveProperty("isCounterexample")
        expect(result).not.toHaveProperty("isAdmissibleAssignment")
        expect(result).not.toHaveProperty("conclusionTrue")
        expect(result).not.toHaveProperty("preservesTruthUnderAssignment")
        expect(result).not.toHaveProperty("allSupportingPremisesTrue")
    })
})
```

- [ ] **Step 2: Add opinion validation to PremiseEngine.evaluate()**

In `src/lib/core/premise-engine.ts`, at the top of `evaluate()` after the evaluability validation, add:

```typescript
// Validate opinion values in assignment
for (const [variableId, value] of Object.entries(assignment.variables)) {
    if (value !== null && typeof value === "object" && "belief" in value) {
        if (!isValidOpinion(value as TOpinion)) {
            throw new Error(
                `Invalid opinion for variable "${variableId}": belief + disbelief + uncertainty must equal 1.`
            )
        }
    }
}
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass, including new opinion-specific tests.

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts src/lib/core/premise-engine.ts
git commit -m "test: add subjective logic evaluation tests with interior opinions"
```

---

### Task 9: Update library exports

**Files:**

- Modify: `src/lib/index.ts`

- [ ] **Step 1: Add subjective module exports**

Add to `src/lib/index.ts`:

```typescript
export {
    type TOpinion,
    OPINION_TRUE,
    OPINION_FALSE,
    OPINION_UNCERTAIN,
    toOpinion,
    isValidOpinion,
    projectProbability,
    subjectiveNot,
    subjectiveAnd,
    subjectiveOr,
    subjectiveImplies,
    subjectiveIff,
} from "./core/evaluation/subjective.js"
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/index.ts
git commit -m "feat: export subjective logic types and functions from library barrel"
```

---

### Task 10: Update CLI analysis command

**Files:**

- Modify: `src/cli/commands/analysis.ts`

- [ ] **Step 1: Update evaluate output (lines ~441-446)**

Replace the removed aggregate flag output with per-premise opinion summaries:

```typescript
// Before:
printLine(`admissible:        ${result.isAdmissibleAssignment}`)
printLine(`all supporting:    ${result.allSupportingPremisesTrue}`)
printLine(`conclusion true:   ${result.conclusionTrue}`)
printLine(`counterexample:    ${result.isCounterexample}`)

// After:
if (result.conclusion?.rootValue) {
    const rv = result.conclusion.rootValue
    printLine(
        `conclusion:  b=${rv.belief.toFixed(3)} d=${rv.disbelief.toFixed(3)} u=${rv.uncertainty.toFixed(3)}`
    )
}
for (const sp of result.supportingPremises ?? []) {
    if (sp.rootValue) {
        const rv = sp.rootValue
        printLine(
            `supporting ${sp.premiseId}:  b=${rv.belief.toFixed(3)} d=${rv.disbelief.toFixed(3)} u=${rv.uncertainty.toFixed(3)}`
        )
    }
}
for (const cp of result.constraintPremises ?? []) {
    if (cp.rootValue) {
        const rv = cp.rootValue
        printLine(
            `constraint ${cp.premiseId}:  b=${rv.belief.toFixed(3)} d=${rv.disbelief.toFixed(3)} u=${rv.uncertainty.toFixed(3)}`
        )
    }
}
```

- [ ] **Step 2: Update analysis file input handling**

The CLI currently reads `analysisData.assignments` as `Record<string, boolean | null>` (line ~401). For now, keep this as-is — the backward-compatible sugar means boolean/null inputs are normalized to opinions by the engine. Opinion-valued CLI input (accepting `{ belief, disbelief, uncertainty, baseRate }` objects in the analysis JSON file) can be added as a follow-up if needed.

- [ ] **Step 3: Run lint and typecheck**

Run: `pnpm run typecheck && pnpm run lint`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/analysis.ts
git commit -m "feat: update CLI evaluate output for opinion-valued results"
```

---

### Task 11: Update interface JSDoc

**Files:**

- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`

- [ ] **Step 1: Update ArgumentEngine evaluate JSDoc**

In `argument-engine.interfaces.ts` (line ~366-383), update the JSDoc for `evaluate()`:

```typescript
/**
 * Evaluates the argument under an expression assignment. Variables may be
 * assigned subjective logic opinions `{ belief, disbelief, uncertainty,
 * baseRate }` or legacy trivalue (`true`, `false`, `null`). Legacy values
 * are normalized to corner opinions. Returns per-premise opinion results.
 *
 * @param assignment - The variable assignment and optional rejected
 *   expression IDs.
 * @param options - Optional evaluation options.
 * @returns The evaluation result, or `{ ok: false }` with validation
 *   details if the argument is not structurally evaluable.
 */
```

- [ ] **Step 2: Update PremiseEngine evaluate JSDoc**

In `premise-engine.interfaces.ts` (line ~282-298), update the JSDoc for `evaluate()`:

```typescript
/**
 * Evaluates the premise under an expression assignment. Variables may be
 * assigned subjective logic opinions or legacy trivalues (`true`, `false`,
 * `null`). Legacy values are normalized to corner opinions. Missing
 * variables default to complete uncertainty. For inference premises
 * (`implies`/`iff`), an `inferenceDiagnostic` is computed with
 * opinion-valued fields unless the root is rejected.
 *
 * @param assignment - The variable assignment and optional rejected
 *   expression IDs.
 * @param options - Optional evaluation options.
 * @returns The premise evaluation result with opinion-valued fields.
 */
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/interfaces/argument-engine.interfaces.ts src/lib/core/interfaces/premise-engine.interfaces.ts
git commit -m "docs: update evaluate/checkValidity JSDoc for subjective logic"
```

---

### Task 12: Final verification and lint

**Files:** All modified files

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, prettier, test, and build all pass.

- [ ] **Step 2: Fix any lint/formatting issues**

Run: `pnpm run prettify && pnpm eslint . --fix`

- [ ] **Step 3: Run smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: Passes (or fails at the pre-existing `variables create` issue noted in CLAUDE.md).

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix lint and formatting"
```

---

### Task 13: Documentation sync

**Files:**

- Modify: `docs/api-reference.md`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts` (if not done in Task 11)

Per CLAUDE.md Documentation Sync rules:

- [ ] **Step 1: Update `docs/api-reference.md`**

Update the evaluation section to document:

- `TOpinion` type and corner constants
- Updated `evaluate()` return type (opinions, no aggregate flags)
- `toOpinion()`, `isValidOpinion()`, `projectProbability()` utilities
- Subjective logic operator functions
- Backward-compatible input format

- [ ] **Step 2: Update CLAUDE.md design rules**

Add a design rule about subjective logic evaluation:

- Variables are assigned opinion tuples `(belief, disbelief, uncertainty, baseRate)` or legacy `true`/`false`/`null`
- `evaluate()` returns `TOpinion`-valued results; no aggregate classification flags
- `checkValidity()` uses corner-case enumeration (classical validity)
- `baseRate` propagates through binary operators (product for AND, complement sum for OR)

- [ ] **Step 3: Update README.md if evaluation is covered**

Check if the evaluation section needs updating for the new opinion-based API.

- [ ] **Step 4: Commit**

```bash
git add docs/api-reference.md CLAUDE.md README.md
git commit -m "docs: update documentation for subjective logic evaluation"
```
