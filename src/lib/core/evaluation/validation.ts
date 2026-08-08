import type {
    TCoreDirectionalVacuity,
    TCoreQuadrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import { belnapAnd, belnapImplies, belnapNot } from "./belnap.js"

/** Creates a validation result, setting `ok` based on whether any error-severity issues exist. */
export function makeValidationResult(
    issues: TCoreValidationIssue[]
): TCoreValidationResult {
    return {
        ok: issues.every((issue) => issue.severity !== "error"),
        issues,
    }
}

/** Creates a validation issue with `severity: "error"`. */
export function makeErrorIssue(
    issue: Omit<TCoreValidationIssue, "severity">
): TCoreValidationIssue {
    return { severity: "error", ...issue }
}

/** Computes four-valued material implication: `!antecedent || consequent`. */
export function implicationValue(
    antecedent: TCoreQuadrivalentValue,
    consequent: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    return belnapImplies(antecedent, consequent)
}

/** Builds a directional vacuity diagnostic for one direction of an implication. */
export function buildDirectionalVacuity(
    antecedentTrue: TCoreQuadrivalentValue,
    consequentTrue: TCoreQuadrivalentValue
): TCoreDirectionalVacuity {
    const implication = implicationValue(antecedentTrue, consequentTrue)
    return {
        antecedentTrue,
        consequentTrue,
        implicationValue: implication,
        isVacuouslyTrue: belnapAnd(implication, belnapNot(antecedentTrue)),
        fired: antecedentTrue,
    }
}
