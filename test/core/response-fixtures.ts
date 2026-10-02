// Builders for the response suites: a target argument and a response that
// answers it, written as expression trees. Pure — no state between calls, so
// each test composes its own arguments.
//
// Claims are named by letter and live in one claim library shared by every
// argument built against it. Expressions and premises are found again by the
// labels a test gives them.

import { ArgumentEngine, ClaimLibrary } from "../../src/lib/index"
import type {
    TBoundAspect,
    TCoreClaimType,
} from "../../src/lib/schemata/index.js"
import { isPremiseBound } from "../../src/lib/schemata/index.js"

type TOperator = "not" | "and" | "or" | "xor" | "implies" | "iff"

export type TNode = {
    label?: string
    /** A fixed expression id, used in place of the generated one. */
    id?: string
} & (
    | { kind: "var"; name: string }
    | { kind: "op"; operator: TOperator; kids: TNode[] }
    /** A formula (parenthesis) node around one child. */
    | { kind: "formula"; kid: TNode }
    /** A response's expression-bound variable on a labelled target expression. */
    | { kind: "bound"; target: string; aspect: TBoundAspect }
    /** The variable bound to an earlier premise of the same argument. */
    | { kind: "premise"; premise: string }
    /** A variable bound to a premise of another argument. */
    | {
          kind: "external"
          argumentId: string
          argumentVersion: number
          premiseId: string
      }
)

export const v = (name: string, label?: string): TNode => ({
    kind: "var",
    name,
    label,
})
const op =
    (operator: TOperator) =>
    (...kids: TNode[]): TNode => ({ kind: "op", operator, kids })
export const not = (kid: TNode): TNode => op("not")(kid)
export const and = op("and")
export const or = op("or")
export const implies = (left: TNode, right: TNode): TNode =>
    op("implies")(left, right)
export const iff = (left: TNode, right: TNode): TNode => op("iff")(left, right)
/** Wraps a node in a formula (parenthesis) node. */
export const paren = (kid: TNode): TNode => ({ kind: "formula", kid })
/** Gives a node a label, so a test can find its expression id. */
export const at = (label: string, node: TNode): TNode => ({ ...node, label })
/**
 * Gives a node a fixed expression id, so that one expression can sit at
 * different places in two versions of an argument and keep its id. The
 * generated ids of the other nodes are unaffected.
 */
export const withId = (id: string, node: TNode): TNode => ({ ...node, id })
/** The statement of a labelled target expression. */
export const x = (target: string): TNode => ({
    kind: "bound",
    target,
    aspect: "statement",
})
/** The step of a labelled target operator. */
export const s = (target: string): TNode => ({
    kind: "bound",
    target,
    aspect: "inference",
})
export const pv = (premise: string): TNode => ({ kind: "premise", premise })
export const ext = (
    argumentId: string,
    argumentVersion: number,
    premiseId: string
): TNode => ({ kind: "external", argumentId, argumentVersion, premiseId })

export interface TPremiseSpec {
    tree: TNode
    label?: string
    /** Creates a derivation premise deriving this claim. */
    derivedClaim?: string
}

export interface TBuildInput {
    id: string
    version: number
    /** Claims shared with every other argument built against the same library. */
    lib: ClaimLibrary
    /** The argument this one answers; makes it a response. */
    respondsTo?: TBuilt
    conclusion?: TNode
    premises?: (TNode | TPremiseSpec)[]
    /** Claim types by name; unlisted claims are `"normal"`. */
    claimTypes?: Record<string, TCoreClaimType>
}

export interface TBuilt {
    engine: ArgumentEngine
    /** Expression id for a label. */
    expr: (label: string) => string
    /** Premise id for a label. */
    premise: (label: string) => string
    /** Variable id for a claim name, or for a bound target label. */
    variable: (key: string) => string
    /** Premise ids in creation order (the conclusion first, if any). */
    premiseIds: string[]
}

export function newLib(): ClaimLibrary {
    return new ClaimLibrary()
}

export function build(input: TBuildInput): TBuilt {
    const { id, version, lib } = input
    const respondsTo = input.respondsTo
    const engine = new ArgumentEngine(
        {
            id,
            version,
            ...(respondsTo
                ? {
                      respondsTo: {
                          argumentId: respondsTo.engine.getArgument().id,
                          argumentVersion:
                              respondsTo.engine.getArgument().version,
                      },
                  }
                : {}),
        },
        lib,
        { behavior: "permissive" }
    )

    const exprIds = new Map<string, string>()
    const premiseLabels = new Map<string, string>()
    const variableIds = new Map<string, string>()
    const premiseIds: string[] = []
    let exprSeq = 0
    let varSeq = 0

    const claimVariable = (name: string): string => {
        const key = `claim:${name}`
        const known = variableIds.get(key)
        if (known !== undefined) return known
        const claimId = `claim-${name}`
        if (lib.getCurrent(claimId) === undefined) {
            lib.create({
                id: claimId,
                type: input.claimTypes?.[name] ?? "normal",
            })
        }
        const variable = engine.ensureClaimBoundVariable(claimId)
        variableIds.set(key, variable.id)
        variableIds.set(name, variable.id)
        return variable.id
    }

    const boundVariable = (target: string, aspect: TBoundAspect): string => {
        if (respondsTo === undefined)
            throw new Error("only a response binds target expressions")
        const key = `${aspect}:${target}`
        const known = variableIds.get(key)
        if (known !== undefined) return known
        const argument = respondsTo.engine.getArgument()
        const { result } = engine.bindVariableToExpression({
            id: `${id}.v${varSeq}`,
            argumentId: id,
            argumentVersion: version,
            symbol: `L${varSeq++}`,
            boundExpressionId: respondsTo.expr(target),
            boundArgumentId: argument.id,
            boundArgumentVersion: argument.version,
            boundAspect: aspect,
        })
        variableIds.set(key, result.id)
        if (aspect === "statement") variableIds.set(target, result.id)
        return result.id
    }

    const premiseVariable = (premiseLabel: string): string => {
        const premiseId = premiseLabels.get(premiseLabel)
        if (premiseId === undefined)
            throw new Error(`no premise labelled ${premiseLabel} yet`)
        const variable = engine
            .getVariables()
            .find((v) => isPremiseBound(v) && v.boundPremiseId === premiseId)
        if (variable === undefined)
            throw new Error(`no variable bound to ${premiseLabel}`)
        return variable.id
    }

    const externalVariable = (
        node: Extract<TNode, { kind: "external" }>
    ): string => {
        const key = `ext:${node.argumentId}:${node.argumentVersion}:${node.premiseId}`
        const known = variableIds.get(key)
        if (known !== undefined) return known
        const { result } = engine.bindVariableToExternalPremise({
            id: `${id}.v${varSeq}`,
            argumentId: id,
            argumentVersion: version,
            symbol: `E${varSeq++}`,
            boundPremiseId: node.premiseId,
            boundArgumentId: node.argumentId,
            boundArgumentVersion: node.argumentVersion,
        })
        variableIds.set(key, result.id)
        return result.id
    }

    const addTree = (
        premiseId: string,
        node: TNode,
        parentId: string | null,
        position: number
    ): string => {
        const generated = `${id}.e${exprSeq++}`
        const exprId = node.id ?? generated
        if (node.label !== undefined) exprIds.set(node.label, exprId)
        const common = {
            id: exprId,
            argumentId: id,
            argumentVersion: version,
            premiseId,
            parentId,
            position,
        }
        const premise = engine.getPremise(premiseId)!
        if (node.kind === "op") {
            premise.addExpression({
                ...common,
                type: "operator",
                operator: node.operator,
            })
            node.kids.forEach((kid, index) =>
                addTree(premiseId, kid, exprId, index)
            )
            return exprId
        }
        if (node.kind === "formula") {
            premise.addExpression({ ...common, type: "formula" })
            addTree(premiseId, node.kid, exprId, 0)
            return exprId
        }
        const variableId =
            node.kind === "var"
                ? claimVariable(node.name)
                : node.kind === "bound"
                  ? boundVariable(node.target, node.aspect)
                  : node.kind === "premise"
                    ? premiseVariable(node.premise)
                    : externalVariable(node)
        premise.addExpression({ ...common, type: "variable", variableId })
        return exprId
    }

    const addPremise = (spec: TPremiseSpec): string => {
        const premiseId = `${id}.p${premiseIds.length}`
        if (spec.derivedClaim !== undefined) {
            claimVariable(spec.derivedClaim)
            const { result } = engine.createPremiseWithId(premiseId, {
                type: "derivation",
                derivedClaimId: `claim-${spec.derivedClaim}`,
            })
            // A new derivation premise holds a naked-Q placeholder root;
            // replace it with the tree the test asked for.
            const placeholder = result.getRootExpression()
            if (placeholder !== undefined)
                result.removeExpression(placeholder.id, true)
        } else {
            engine.createPremiseWithId(premiseId)
        }
        premiseIds.push(premiseId)
        if (spec.label !== undefined) premiseLabels.set(spec.label, premiseId)
        addTree(premiseId, spec.tree, null, 0)
        return premiseId
    }

    if (input.conclusion !== undefined) {
        const conclusionId = addPremise({
            tree: input.conclusion,
            label: "conclusion",
        })
        engine.setConclusionPremise(conclusionId)
    }
    for (const item of input.premises ?? []) {
        addPremise("kind" in item ? { tree: item } : item)
    }

    const lookup =
        (map: Map<string, string>, what: string) =>
        (label: string): string => {
            const found = map.get(label)
            if (found === undefined) throw new Error(`no ${what} ${label}`)
            return found
        }
    return {
        engine,
        expr: lookup(exprIds, "expression labelled"),
        premise: lookup(premiseLabels, "premise labelled"),
        variable: lookup(variableIds, "variable for"),
        premiseIds,
    }
}

/** A premise spec with a label. */
export const labelled = (
    label: string,
    tree: TNode,
    derivedClaim?: string
): TPremiseSpec => ({ label, tree, derivedClaim })
