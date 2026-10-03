import {
    isClaimBound,
    isExpressionBound,
    isPremiseBound,
    type TBoundAspect,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type { TPositionClass } from "../../types/response.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"
import { canonicalSerialize, computeHash } from "../checksum.js"

/**
 * A reference, from inside a subtree, to one element of another argument at
 * a pinned version: the expression an expression-bound variable names, or
 * the premise an externally premise-bound variable names.
 */
export type TOutsideReference =
    | {
          kind: "expression"
          argumentId: string
          argumentVersion: number
          expressionId: string
          aspect: TBoundAspect
      }
    | {
          kind: "premise"
          argumentId: string
          argumentVersion: number
          premiseId: string
      }

/**
 * A subtree's structure written out in full, and the references it makes
 * into other arguments, in the order the structure meets them. Two subtrees
 * with equal `shape` hold references to the same elements in the same order,
 * so their `outside` lists line up entry by entry, differing at most in the
 * versions they pin.
 */
export interface TSubtreeDescription {
    shape: string
    outside: TOutsideReference[]
}

export interface TSnapshotIndex {
    argumentId: string
    conclusionPremiseId: string | undefined
    expressions: Map<string, TCorePropositionalExpression>
    children: Map<string, TCorePropositionalExpression[]>
    variables: Map<string, TCorePropositionalVariable>
    premiseOfExpression: Map<string, { id: string; type: string }>
    premiseRoots: Map<string, string | undefined>
}

const indexes = new WeakMap<TArgumentEngineSnapshot, TSnapshotIndex>()

/**
 * The snapshot's expressions, premises and variables, indexed once per
 * snapshot object. Shared by everything in this folder that reads a target
 * snapshot.
 */
export function indexOf(snapshot: TArgumentEngineSnapshot): TSnapshotIndex {
    const known = indexes.get(snapshot)
    if (known !== undefined) return known
    const index: TSnapshotIndex = {
        argumentId: snapshot.argument.id,
        conclusionPremiseId: snapshot.conclusionPremiseId,
        expressions: new Map(),
        children: new Map(),
        variables: new Map(
            snapshot.variables.variables.map((variable) => [
                variable.id,
                variable,
            ])
        ),
        premiseOfExpression: new Map(),
        premiseRoots: new Map(),
    }
    for (const ps of snapshot.premises) {
        const premise = { id: ps.premise.id, type: ps.premise.type }
        let root: string | undefined
        for (const expr of ps.expressions.expressions) {
            index.expressions.set(expr.id, expr)
            index.premiseOfExpression.set(expr.id, premise)
            if (expr.parentId === null) {
                root = expr.id
            } else {
                const siblings = index.children.get(expr.parentId) ?? []
                siblings.push(expr)
                index.children.set(expr.parentId, siblings)
            }
        }
        index.premiseRoots.set(premise.id, ps.rootExpressionId ?? root)
    }
    for (const siblings of index.children.values()) {
        siblings.sort((a, b) => a.position - b.position)
    }
    indexes.set(snapshot, index)
    return index
}

function expressionOf(
    index: TSnapshotIndex,
    expressionId: string
): TCorePropositionalExpression {
    const expr = index.expressions.get(expressionId)
    if (expr === undefined) {
        throw new Error(
            `Expression "${expressionId}" is not in argument "${index.argumentId}".`
        )
    }
    return expr
}

/**
 * Whether an expression is its premise's root once formula (parenthesis)
 * nodes above it are looked through: every ancestor is a formula.
 */
function isAtRoot(
    index: TSnapshotIndex,
    expr: TCorePropositionalExpression
): boolean {
    let parentId = expr.parentId
    while (parentId !== null) {
        const parent = expressionOf(index, parentId)
        if (parent.type !== "formula") return false
        parentId = parent.parentId
    }
    return true
}

/** Whether an expression of the snapshot is its premise's root, as `isAtRoot` reads it. */
export function isPremiseRootExpression(
    snapshot: TArgumentEngineSnapshot,
    expressionId: string
): boolean {
    const index = indexOf(snapshot)
    return isAtRoot(index, expressionOf(index, expressionId))
}

/** Whether the snapshot holds the expression. */
export function snapshotHasExpression(
    snapshot: TArgumentEngineSnapshot,
    expressionId: string
): boolean {
    return indexOf(snapshot).expressions.has(expressionId)
}

/**
 * The root expression of one premise of a snapshot: `null` when the premise
 * is empty, `undefined` when the snapshot has no such premise.
 */
export function premiseRootOf(
    snapshot: TArgumentEngineSnapshot,
    premiseId: string
): string | null | undefined {
    const index = indexOf(snapshot)
    if (!index.premiseRoots.has(premiseId)) return undefined
    return index.premiseRoots.get(premiseId) ?? null
}

/**
 * Writes out a subtree's structure: each node's type, operator and child
 * order, and each variable's referent. The argument's own ids and versions
 * never appear, and neither do the versions of other arguments; those are
 * collected into `outside` instead, so the caller can judge a re-pinned
 * reference separately.
 *
 * A variable's referent is:
 * - for a claim-bound variable, the claim id and claim version;
 * - for a variable bound to a premise of the same argument, the structure
 *   of that premise's root, followed recursively;
 * - for a variable bound to a premise of another argument, that argument's
 *   id and the premise id;
 * - for an expression-bound variable, the argument id, expression id and
 *   aspect.
 *
 * @throws When the snapshot has no such expression, or when bindings between
 * its premises form a cycle.
 */
export function describeSubtree(
    snapshot: TArgumentEngineSnapshot,
    expressionId: string
): TSubtreeDescription {
    const index = indexOf(snapshot)
    const outside: TOutsideReference[] = []

    const describe = (id: string, premisesEntered: string[]): unknown => {
        const expr = expressionOf(index, id)
        const kids = () =>
            (index.children.get(id) ?? []).map((kid) =>
                describe(kid.id, premisesEntered)
            )
        if (expr.type === "operator") return ["op", expr.operator, kids()]
        if (expr.type === "formula") return ["formula", kids()]
        const variable = index.variables.get(expr.variableId)
        if (variable === undefined) return ["unresolved"]
        if (isClaimBound(variable)) {
            return ["claim", variable.claimId, variable.claimVersion]
        }
        if (isExpressionBound(variable)) {
            outside.push({
                kind: "expression",
                argumentId: variable.boundArgumentId,
                argumentVersion: variable.boundArgumentVersion,
                expressionId: variable.boundExpressionId,
                aspect: variable.boundAspect,
            })
            return [
                "expression",
                variable.boundArgumentId,
                variable.boundExpressionId,
                variable.boundAspect,
            ]
        }
        if (isPremiseBound(variable)) {
            if (variable.boundArgumentId !== index.argumentId) {
                outside.push({
                    kind: "premise",
                    argumentId: variable.boundArgumentId,
                    argumentVersion: variable.boundArgumentVersion,
                    premiseId: variable.boundPremiseId,
                })
                return [
                    "external",
                    variable.boundArgumentId,
                    variable.boundPremiseId,
                ]
            }
            const premiseId = variable.boundPremiseId
            if (premisesEntered.includes(premiseId)) {
                throw new Error(
                    `Premise bindings in argument "${index.argumentId}" form a cycle through premise "${premiseId}".`
                )
            }
            if (!index.premiseRoots.has(premiseId)) return ["missingPremise"]
            const root = index.premiseRoots.get(premiseId)
            return [
                "premise",
                root === undefined
                    ? null
                    : describe(root, [...premisesEntered, premiseId]),
            ]
        }
        return ["unresolved"]
    }

    const owner = index.premiseOfExpression.get(expressionId)
    const shape = canonicalSerialize(
        describe(expressionId, owner !== undefined ? [owner.id] : [])
    )
    return { shape, outside }
}

/**
 * A hash over the structure of the subtree rooted at one expression of a
 * snapshot. It covers each node's type, operator and child order, and each
 * variable's referent: claim id and claim version for a claim-bound
 * variable; the bound premise's root, recursively, for a variable bound to a
 * premise of the same argument; argument id and premise id for one bound to
 * a premise of another argument; argument id, expression id and aspect for
 * an expression-bound variable. It ignores the argument's own ids and
 * versions, and leaves out the versions of other arguments, so moving
 * another argument to a new version does not change it.
 *
 * Two versions of an argument that keep an expression's id and give it the
 * same fingerprint hold the same structure under it.
 *
 * @throws When the snapshot has no such expression, or when bindings between
 * its premises form a cycle.
 */
export function structuralFingerprint(
    snapshot: TArgumentEngineSnapshot,
    expressionId: string
): string {
    return computeHash(describeSubtree(snapshot, expressionId).shape)
}

/**
 * The position class, refined by whether a nested expression sits in the
 * conclusion premise. Carrying an undercut strikes a premise for an operator
 * nested in any other premise but ignores one nested in the conclusion, so
 * two places with the same class can still mean different things to a link.
 * (Inside a derivation premise no finer split is needed: its root is a
 * variable, `implies` or `iff`, and those operators occur only at a root, so
 * an operator keeping its structure cannot move between root and nested.)
 *
 * @throws When the snapshot has no such expression.
 */
export function bindingPositionOf(
    snapshot: TArgumentEngineSnapshot,
    expressionId: string
): string {
    const positionClass = positionClassOf(snapshot, expressionId)
    if (positionClass !== "nested") return positionClass
    const index = indexOf(snapshot)
    const premise = index.premiseOfExpression.get(expressionId)!
    return premise.id === index.conclusionPremiseId
        ? "nestedInConclusion"
        : "nested"
}

/**
 * Where an expression sits in its argument: the root of a freeform premise,
 * the root of the conclusion premise, below a premise root, or anywhere in a
 * derivation premise.
 *
 * @throws When the snapshot has no such expression.
 */
export function positionClassOf(
    snapshot: TArgumentEngineSnapshot,
    expressionId: string
): TPositionClass {
    const index = indexOf(snapshot)
    const expr = expressionOf(index, expressionId)
    const premise = index.premiseOfExpression.get(expressionId)!
    if (premise.type === "derivation") return "inDerivation"
    if (!isAtRoot(index, expr)) return "nested"
    return premise.id === index.conclusionPremiseId
        ? "conclusionRoot"
        : "freeformRoot"
}
