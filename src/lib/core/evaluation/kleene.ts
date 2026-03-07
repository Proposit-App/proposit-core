import type { TCoreTrivalentValue } from "../../types/evaluation.js"

/** Kleene three-valued NOT: null propagates. */
export function kleeneNot(a: TCoreTrivalentValue): TCoreTrivalentValue {
    return a === null ? null : !a
}

/** Kleene three-valued AND: false dominates, null propagates. */
export function kleeneAnd(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    if (a === false || b === false) return false
    if (a === null || b === null) return null
    return true
}

/** Kleene three-valued OR: true dominates, null propagates. */
export function kleeneOr(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    if (a === true || b === true) return true
    if (a === null || b === null) return null
    return false
}

/** Kleene three-valued material implication: NOT a OR b. */
export function kleeneImplies(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneOr(kleeneNot(a), b)
}

/** Kleene three-valued biconditional: (a -> b) AND (b -> a). */
export function kleeneIff(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneAnd(kleeneImplies(a, b), kleeneImplies(b, a))
}
