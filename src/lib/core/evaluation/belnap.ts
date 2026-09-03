import {
    CONTESTED,
    type TCoreQuadrivalentValue,
} from "../../types/evaluation.js"

/**
 * Belnap's four-valued connectives (the bilattice `FOUR`, also known as first
 * degree entailment).
 *
 * Each value is the set of things we have been told about a proposition:
 * `null` is `{}` (told neither), `true` is `{t}`, `false` is `{f}`, and
 * `CONTESTED` is `{t, f}` (told both). Conjunction is the meet and disjunction
 * the join of the truth order `false ≤ null ≤ true`, `false ≤ contested ≤
 * true`, which on subsets reads: `a ∧ b` is told true iff both are, and told
 * false iff either is; `a ∨ b` dually. Negation swaps the two components.
 *
 * Restricted to `{null, true, false}` every table below is exactly strong
 * Kleene, which is why a reader's three-valued assignment behaves as it always
 * has and only a conflict produced by constraint closure can reach the fourth
 * value.
 *
 * ponytail: the tables are computed from the two components rather than
 * written out as twenty-five entries; the exhaustive suite pins every cell.
 */

const TRUE_COMPONENT = 1
const FALSE_COMPONENT = 2

function toComponents(value: TCoreQuadrivalentValue): number {
    if (value === true) return TRUE_COMPONENT
    if (value === false) return FALSE_COMPONENT
    if (value === CONTESTED) return TRUE_COMPONENT | FALSE_COMPONENT
    return 0
}

function fromComponents(components: number): TCoreQuadrivalentValue {
    switch (components) {
        case TRUE_COMPONENT:
            return true
        case FALSE_COMPONENT:
            return false
        case TRUE_COMPONENT | FALSE_COMPONENT:
            return CONTESTED
        default:
            return null
    }
}

/** `true` iff the value carries the "told true" component. */
export function hasTrueComponent(value: TCoreQuadrivalentValue): boolean {
    return (toComponents(value) & TRUE_COMPONENT) !== 0
}

/** `true` iff the value carries the "told false" component. */
export function hasFalseComponent(value: TCoreQuadrivalentValue): boolean {
    return (toComponents(value) & FALSE_COMPONENT) !== 0
}

/**
 * Merge what two sources say about the same proposition: the join of the
 * knowledge order `null ≤ true ≤ contested`, `null ≤ false ≤ contested`.
 * `true` merged with `false` is `CONTESTED`.
 */
export function joinKnowledge(
    a: TCoreQuadrivalentValue,
    b: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    return fromComponents(toComponents(a) | toComponents(b))
}

/** Belnap NOT: swaps the components, so `null` and `contested` are fixed points. */
export function belnapNot(a: TCoreQuadrivalentValue): TCoreQuadrivalentValue {
    const components = toComponents(a)
    return fromComponents(
        ((components & TRUE_COMPONENT) !== 0 ? FALSE_COMPONENT : 0) |
            ((components & FALSE_COMPONENT) !== 0 ? TRUE_COMPONENT : 0)
    )
}

/** Belnap AND: told true iff both are, told false iff either is. */
export function belnapAnd(
    a: TCoreQuadrivalentValue,
    b: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    const left = toComponents(a)
    const right = toComponents(b)
    return fromComponents(
        (left & right & TRUE_COMPONENT) | ((left | right) & FALSE_COMPONENT)
    )
}

/** Belnap OR: told true iff either is, told false iff both are. */
export function belnapOr(
    a: TCoreQuadrivalentValue,
    b: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    const left = toComponents(a)
    const right = toComponents(b)
    return fromComponents(
        ((left | right) & TRUE_COMPONENT) | (left & right & FALSE_COMPONENT)
    )
}

/**
 * Belnap exclusive disjunction (parity): told true iff some reading of the
 * operands makes an odd number of them true, told false iff some reading makes
 * an even number.
 *
 * This is written from the components rather than composed out of
 * `and`/`or`/`not`, and the difference is load-bearing. The composed reading
 * `(a ∧ ¬b) ∨ (¬a ∧ b)` agrees with this everywhere except `xor(null,
 * contested)`, where it answers `false`; that single cell costs associativity,
 * and 8 of the 64 triples then disagree depending on how they are bracketed.
 * A variadic operator cannot afford that — flattening a nested xor is an
 * auto-normalization rule, and the parser already collapses `a ⊻ b ⊻ c` into
 * one node, so a fold-order-dependent answer would make normalization change
 * what a formula means.
 *
 * Restricted to `{null, true, false}` this is exactly strong Kleene XOR, and
 * `null` absorbs throughout: a parity depends on every operand, so knowing
 * nothing about one is knowing nothing about the result. `iff` is composed and
 * keeps its own answer, which is why `xor(a, b)` and `not(iff(a, b))` part
 * company at that one cell — `iff` is binary and never has to associate.
 */
export function belnapXor(
    a: TCoreQuadrivalentValue,
    b: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    const aTrue = hasTrueComponent(a)
    const aFalse = hasFalseComponent(a)
    const bTrue = hasTrueComponent(b)
    const bFalse = hasFalseComponent(b)
    return fromComponents(
        ((aTrue && bFalse) || (aFalse && bTrue) ? TRUE_COMPONENT : 0) |
            ((aTrue && bTrue) || (aFalse && bFalse) ? FALSE_COMPONENT : 0)
    )
}

/** Belnap material implication: NOT a OR b. */
export function belnapImplies(
    a: TCoreQuadrivalentValue,
    b: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    return belnapOr(belnapNot(a), b)
}

/** Belnap biconditional: (a -> b) AND (b -> a). */
export function belnapIff(
    a: TCoreQuadrivalentValue,
    b: TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    return belnapAnd(belnapImplies(a, b), belnapImplies(b, a))
}
