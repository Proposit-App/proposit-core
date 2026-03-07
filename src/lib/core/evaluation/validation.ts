import type {
    TCoreDirectionalVacuity,
    TCoreTrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import { kleeneAnd, kleeneImplies, kleeneNot } from "./kleene.js"

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

/** Computes Kleene three-valued material implication: `!antecedent || consequent`. */
export function implicationValue(
    antecedent: TCoreTrivalentValue,
    consequent: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneImplies(antecedent, consequent)
}

/** Builds a directional vacuity diagnostic for one direction of an implication. */
export function buildDirectionalVacuity(
    antecedentTrue: TCoreTrivalentValue,
    consequentTrue: TCoreTrivalentValue
): TCoreDirectionalVacuity {
    const implication = implicationValue(antecedentTrue, consequentTrue)
    return {
        antecedentTrue,
        consequentTrue,
        implicationValue: implication,
        isVacuouslyTrue: kleeneAnd(implication, kleeneNot(antecedentTrue)),
        fired: antecedentTrue,
    }
}
