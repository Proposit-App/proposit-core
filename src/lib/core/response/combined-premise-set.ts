import {
    isClaimBound,
    isExpressionBound,
    isPremiseBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCorePremiseEvaluationResult,
    TCoreQuadrivalentValue,
    TCoreResolvedAssignment,
} from "../../types/evaluation.js"
import type { TColumnReference } from "../../types/response.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"
import {
    belnapAnd,
    belnapIff,
    belnapImplies,
    belnapNot,
    belnapOr,
    belnapXor,
} from "../evaluation/belnap.js"
import type { TEvaluablePremise } from "../evaluation/argument-evaluation.js"
import { readLink } from "./links.js"

/**
 * A formula of the combined premise set: a column, or an operator over
 * formulas. Formula (parenthesis) nodes are dropped when copying, since they
 * change nothing a formula means.
 */
export type TCombinedNode =
    | { kind: "column"; key: string }
    | { kind: "op"; operator: string; kids: TCombinedNode[] }

/** One premise of the response as it enters the combined set. */
export interface TCombinedSourcePremise {
    id: string
    expressions: readonly TCorePropositionalExpression[]
}

export interface TCombinedSetInput {
    responseArgumentId: string
    responseArgumentVersion: number
    /** The response's premises, leaving out unpopulated derivation stubs. */
    premises: readonly TCombinedSourcePremise[]
    getVariable: (id: string) => TCorePropositionalVariable | undefined
    /** The response's own citation- and axiom-bound variables. */
    groundedVariableIds: ReadonlySet<string>
    /** The argument the response answers, at the version it answers. */
    target: TArgumentEngineSnapshot
}

/** A link of the response, read in terms of the combined set. */
export interface TCombinedLink {
    premiseId: string
    negated: boolean
    /** What the link says is true or false, expanded into the target. */
    referent: TCombinedNode
    /** Equal for two links exactly when their referents are the same formula. */
    referentKey: string
}

/**
 * The in-memory premise set every check of a response searches. It is built
 * for one check and never stored.
 *
 * Every premise reads only columns of this set: a statement binding is
 * replaced by a copy of the target expression it names, and a binding between
 * premises is replaced by a copy of the bound premise's formula. So nothing in
 * it reaches into another argument, and grouping by shared columns is exact.
 */
export interface TCombinedSet {
    premises: CombinedPremise[]
    links: TCombinedLink[]
    columns: Map<string, TColumnReference>
    /** Columns from the response's own grounded variables, held true. */
    forcedTrueColumns: Set<string>
}

/** The canonical text of a formula; equal texts mean equal formulas. */
export function formulaKey(node: TCombinedNode): string {
    if (node.kind === "column") return `[${node.key}]`
    return `${node.operator}(${node.kids.map(formulaKey).join(",")})`
}

function childrenByParent(
    expressions: readonly TCorePropositionalExpression[]
): Map<string | null, TCorePropositionalExpression[]> {
    const byParent = new Map<string | null, TCorePropositionalExpression[]>()
    for (const expr of expressions) {
        const siblings = byParent.get(expr.parentId) ?? []
        siblings.push(expr)
        byParent.set(expr.parentId, siblings)
    }
    for (const siblings of byParent.values()) {
        siblings.sort((a, b) => a.position - b.position)
    }
    return byParent
}

export function buildCombinedSet(input: TCombinedSetInput): TCombinedSet {
    const { target } = input
    const targetId = target.argument.id
    const columns = new Map<string, TColumnReference>()
    const forcedTrueColumns = new Set<string>()

    const column = (
        key: string,
        reference: TColumnReference
    ): TCombinedNode => {
        columns.set(key, reference)
        return { kind: "column", key }
    }
    const claimColumn = (claimId: string): TCombinedNode =>
        column(`claim:${claimId}`, { kind: "claim", claimId })
    const premiseColumn = (
        argumentId: string,
        argumentVersion: number,
        premiseId: string
    ): TCombinedNode =>
        column(`premise:${argumentId}:${argumentVersion}:${premiseId}`, {
            kind: "premise",
            argumentId,
            argumentVersion,
            premiseId,
        })
    const expressionColumn = (
        argumentId: string,
        expressionId: string,
        aspect: "statement" | "inference"
    ): TCombinedNode =>
        column(`expression:${argumentId}:${expressionId}:${aspect}`, {
            kind: "expression",
            argumentId,
            expressionId,
            aspect,
        })

    // The argument answered, as a set of trees.
    const targetExpressions = new Map<string, TCorePropositionalExpression>()
    const targetRoots = new Map<string, string>()
    for (const ps of target.premises) {
        for (const expr of ps.expressions.expressions) {
            targetExpressions.set(expr.id, expr)
            if (expr.parentId === null) targetRoots.set(ps.premise.id, expr.id)
        }
    }
    const targetChildren = childrenByParent([...targetExpressions.values()])
    const targetVariables = new Map(
        target.variables.variables.map((variable) => [variable.id, variable])
    )

    // Statement expansions of one target expression are the same whichever
    // link asks for them.
    const expandedTarget = new Map<string, TCombinedNode>()
    const expandTarget = (
        expressionId: string,
        premisesInProgress: string[]
    ): TCombinedNode => {
        const cached = expandedTarget.get(expressionId)
        if (cached !== undefined) return cached
        const expr = targetExpressions.get(expressionId)
        if (expr === undefined) {
            throw new Error(
                `Expression "${expressionId}" is not in argument "${targetId}".`
            )
        }
        let node: TCombinedNode
        if (expr.type === "operator" || expr.type === "formula") {
            const kids = (targetChildren.get(expr.id) ?? []).map((kid) =>
                expandTarget(kid.id, premisesInProgress)
            )
            node =
                expr.type === "formula"
                    ? kids[0]
                    : { kind: "op", operator: expr.operator, kids }
        } else {
            const variable = targetVariables.get(expr.variableId)
            if (variable === undefined) {
                throw new Error(
                    `Variable "${expr.variableId}" is not in argument "${targetId}".`
                )
            }
            if (isClaimBound(variable)) {
                node = claimColumn(variable.claimId)
            } else if (isPremiseBound(variable)) {
                const rootId =
                    variable.boundArgumentId === targetId
                        ? targetRoots.get(variable.boundPremiseId)
                        : undefined
                if (rootId === undefined) {
                    node = premiseColumn(
                        variable.boundArgumentId,
                        variable.boundArgumentVersion,
                        variable.boundPremiseId
                    )
                } else {
                    if (premisesInProgress.includes(variable.boundPremiseId)) {
                        throw new Error(
                            `Argument "${targetId}" binds premise "${variable.boundPremiseId}" into itself.`
                        )
                    }
                    node = expandTarget(rootId, [
                        ...premisesInProgress,
                        variable.boundPremiseId,
                    ])
                }
            } else if (isExpressionBound(variable)) {
                node = expressionColumn(
                    variable.boundArgumentId,
                    variable.boundExpressionId,
                    variable.boundAspect
                )
            } else {
                throw new Error(
                    `Variable "${expr.variableId}" has no reference.`
                )
            }
        }
        if (premisesInProgress.length === 0)
            expandedTarget.set(expressionId, node)
        return node
    }

    // The response's own premises.
    const sourceById = new Map(input.premises.map((pm) => [pm.id, pm]))
    const responseChildren = new Map(
        input.premises.map((pm) => [pm.id, childrenByParent(pm.expressions)])
    )
    const expandResponse = (
        premiseId: string,
        expr: TCorePropositionalExpression,
        premisesInProgress: string[]
    ): TCombinedNode => {
        if (expr.type === "operator" || expr.type === "formula") {
            const kids = (
                responseChildren.get(premiseId)?.get(expr.id) ?? []
            ).map((kid) => expandResponse(premiseId, kid, premisesInProgress))
            return expr.type === "formula"
                ? kids[0]
                : { kind: "op", operator: expr.operator, kids }
        }
        const variable = input.getVariable(expr.variableId)
        if (variable === undefined) {
            throw new Error(`Variable "${expr.variableId}" does not exist.`)
        }
        if (isClaimBound(variable)) {
            const node = claimColumn(variable.claimId)
            if (
                input.groundedVariableIds.has(variable.id) &&
                node.kind === "column"
            )
                forcedTrueColumns.add(node.key)
            return node
        }
        if (isExpressionBound(variable)) {
            return variable.boundAspect === "statement"
                ? expandTarget(variable.boundExpressionId, [])
                : expressionColumn(
                      variable.boundArgumentId,
                      variable.boundExpressionId,
                      "inference"
                  )
        }
        if (isPremiseBound(variable)) {
            const bound =
                variable.boundArgumentId === input.responseArgumentId
                    ? sourceById.get(variable.boundPremiseId)
                    : undefined
            const root = bound?.expressions.find(
                (candidate) => candidate.parentId === null
            )
            if (bound === undefined || root === undefined) {
                return premiseColumn(
                    variable.boundArgumentId,
                    variable.boundArgumentVersion,
                    variable.boundPremiseId
                )
            }
            if (premisesInProgress.includes(bound.id)) {
                throw new Error(
                    `Argument "${input.responseArgumentId}" binds premise "${bound.id}" into itself.`
                )
            }
            return expandResponse(bound.id, root, [
                ...premisesInProgress,
                bound.id,
            ])
        }
        throw new Error(`Variable "${expr.variableId}" has no reference.`)
    }

    const premises: CombinedPremise[] = []
    const links: TCombinedLink[] = []
    for (const source of input.premises) {
        const root = source.expressions.find((expr) => expr.parentId === null)
        if (root === undefined) continue
        const tree = expandResponse(source.id, root, [source.id])
        premises.push(new CombinedPremise(source.id, tree))
        const link = readLink(source.id, source.expressions, input.getVariable)
        if (link === undefined) continue
        const negated = link.move === "contradict" || link.move === "undercut"
        const referent = negated && tree.kind === "op" ? tree.kids[0] : tree
        links.push({
            premiseId: source.id,
            negated,
            referent,
            referentKey: formulaKey(referent),
        })
    }

    return { premises, links, columns, forcedTrueColumns }
}

/** Evaluates a formula of the combined set with the library's own operator rules. */
function evaluateNode(
    node: TCombinedNode,
    read: (key: string) => TCoreQuadrivalentValue
): TCoreQuadrivalentValue {
    if (node.kind === "column") return read(node.key)
    const values = node.kids.map((kid) => evaluateNode(kid, read))
    switch (node.operator) {
        case "not":
            return belnapNot(values[0])
        case "and":
            return values.reduce((acc, value) => belnapAnd(acc, value))
        case "or":
            return values.reduce((acc, value) => belnapOr(acc, value))
        case "xor":
            return values.reduce((acc, value) => belnapXor(acc, value))
        case "implies":
            return belnapImplies(values[0], values[1])
        case "iff":
            return belnapIff(values[0], values[1])
        default:
            throw new Error(`Operator "${node.operator}" cannot be evaluated.`)
    }
}

/**
 * A premise of the combined set, in the shape the satisfiability search
 * reads. Its expressions are generated from its formula; only their types and
 * column ids are meaningful, so that the search can group premises by the
 * columns they share.
 */
export class CombinedPremise implements TEvaluablePremise {
    private readonly expressions: TCorePropositionalExpression[]

    constructor(
        private readonly id: string,
        readonly tree: TCombinedNode
    ) {
        this.expressions = []
        let sequence = 0
        const add = (
            node: TCombinedNode,
            parentId: string | null,
            position: number
        ): void => {
            const exprId = `${id}#${sequence++}`
            const base = {
                id: exprId,
                argumentId: "",
                argumentVersion: 0,
                premiseId: id,
                parentId,
                position,
                checksum: "",
                descendantChecksum: null,
                combinedChecksum: "",
            }
            if (node.kind === "column") {
                this.expressions.push({
                    ...base,
                    type: "variable",
                    variableId: node.key,
                })
                return
            }
            this.expressions.push({
                ...base,
                type: "operator",
                operator: node.operator as "not",
            })
            node.kids.forEach((kid, index) => add(kid, exprId, index))
        }
        add(tree, null, 0)
    }

    public getId(): string {
        return this.id
    }

    public getExpressions(): TCorePropositionalExpression[] {
        return this.expressions
    }

    public getChildExpressions(
        parentId: string
    ): TCorePropositionalExpression[] {
        return this.expressions.filter((expr) => expr.parentId === parentId)
    }

    public getVariables(): TCorePropositionalVariable[] {
        return []
    }

    public getDecidableOperatorExpressions(): TCorePropositionalExpression[] {
        return []
    }

    public evaluate(
        assignment: TCoreResolvedAssignment,
        options?: { resolver?: (variableId: string) => TCoreQuadrivalentValue }
    ): TCorePremiseEvaluationResult {
        const read = (key: string): TCoreQuadrivalentValue =>
            options?.resolver?.(key) ?? assignment.variables[key] ?? null
        const rootValue = evaluateNode(this.tree, read)
        const isInference =
            this.tree.kind === "op" &&
            (this.tree.operator === "implies" || this.tree.operator === "iff")
        return {
            premiseId: this.id,
            premiseType: isInference ? "inference" : "constraint",
            rootExpressionId: this.expressions[0].id,
            rootValue,
            expressionValues: {},
            variableValues: {},
        }
    }
}
