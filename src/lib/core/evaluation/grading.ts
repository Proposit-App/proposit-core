import type { TCoreArgumentEvaluationResult } from "../../types/evaluation.js"

/**
 * Human-readable grade for an argument evaluation result.
 * Summarizes the logical status of the argument under the given assignment.
 */
export type TCoreEvaluationGrade =
    | "sound"
    | "vacuously-true"
    | "unsound"
    | "counterexample"
    | "inadmissible"
    | "indeterminate"

export interface TCoreEvaluationGrading {
    /** Machine-readable grade. */
    grade: TCoreEvaluationGrade
    /** Short human-readable label (e.g. "Sound", "Vacuously True"). */
    label: string
    /** Display color name for UI rendering. */
    color: "green" | "orange" | "red" | "gray"
}

/**
 * Derives a human-readable grade from an argument evaluation result.
 *
 * Precedence:
 * 1. Evaluation failed (ok=false) → indeterminate
 * 2. Inadmissible assignment → inadmissible
 * 3. Supporting premise false → unsound
 * 4. Counterexample (all supporting true, conclusion false) → counterexample
 * 5. Supporting premises not known true (unknown or absent) → indeterminate
 * 6. Conclusion vacuously true → vacuously-true
 * 7. Conclusion true → sound
 * 8. Otherwise → indeterminate
 */
export function gradeEvaluation(
    result: TCoreArgumentEvaluationResult
): TCoreEvaluationGrading {
    if (!result.ok) {
        return { grade: "indeterminate", label: "Indeterminate", color: "gray" }
    }

    if (result.isAdmissibleAssignment === false) {
        return { grade: "inadmissible", label: "Inadmissible", color: "gray" }
    }

    if (result.allSupportingPremisesTrue === false) {
        return { grade: "unsound", label: "Unsound", color: "red" }
    }

    if (result.isCounterexample === true) {
        return {
            grade: "counterexample",
            label: "Counterexample",
            color: "red",
        }
    }

    // Soundness requires the supporting premises to be true. An unknown or
    // absent value is not true, so it can never reach sound or vacuously-true.
    if (result.allSupportingPremisesTrue !== true) {
        return { grade: "indeterminate", label: "Indeterminate", color: "gray" }
    }

    if (result.conclusionTrue === true) {
        // Check if conclusion is vacuously true
        const diag = result.conclusion?.inferenceDiagnostic
        if (diag?.kind === "implies" && diag.isVacuouslyTrue === true) {
            return {
                grade: "vacuously-true",
                label: "Vacuously True",
                color: "orange",
            }
        }
        return { grade: "sound", label: "Sound", color: "green" }
    }

    return { grade: "indeterminate", label: "Indeterminate", color: "gray" }
}
