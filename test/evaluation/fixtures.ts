// Compact argument builders for the evaluation suites.
//
// Pure builders — they hold no state between calls, so every test still
// composes its own fixture inline (repo convention). A test names claims by
// letter; the builder creates the claim, the claim-bound variable and the
// expression tree, and hands back the IDs the assertions need.

import { ArgumentEngine, ClaimLibrary } from "../../src/lib/index.js"
import type { TCoreClaimType } from "../../src/lib/schemata/index.js"
import { makeArgument } from "../grammar/fixtures.js"

export type TNode =
    | { kind: "var"; name: string }
    | {
          kind: "op"
          operator: "not" | "and" | "or" | "implies" | "iff"
          kids: TNode[]
      }

export const v = (name: string): TNode => ({ kind: "var", name })
export const not = (kid: TNode): TNode => ({
    kind: "op",
    operator: "not",
    kids: [kid],
})
export const and = (...kids: TNode[]): TNode => ({
    kind: "op",
    operator: "and",
    kids,
})
export const or = (...kids: TNode[]): TNode => ({
    kind: "op",
    operator: "or",
    kids,
})
export const implies = (left: TNode, right: TNode): TNode => ({
    kind: "op",
    operator: "implies",
    kids: [left, right],
})
export const iff = (left: TNode, right: TNode): TNode => ({
    kind: "op",
    operator: "iff",
    kids: [left, right],
})

export interface TBuildArgumentInput {
    /** The conclusion premise's expression tree. */
    conclusion: TNode
    /**
     * The remaining premises, in order. Classification follows the root
     * operator: an `implies`/`iff` root is a supporting premise, anything
     * else is a constraint premise.
     */
    premises?: TNode[]
    /** Premises created with `type: "derivation"`, in order after `premises`. */
    derivations?: { derivedClaim: string; tree: TNode }[]
    /** Claim types by name; anything unlisted is created as `"normal"`. */
    claimTypes?: Record<string, TCoreClaimType>
}

export interface TBuiltArgument {
    engine: ArgumentEngine
    /** Variable ID for a claim name. */
    variableId(name: string): string
    conclusionPremiseId: string
    conclusionRootId: string
    /** Premise IDs of `premises` then `derivations`, in the order given. */
    premiseIds: string[]
    /** Root expression IDs, aligned with `premiseIds`. */
    rootIds: string[]
}

export function buildArgument(input: TBuildArgumentInput): TBuiltArgument {
    const argument = makeArgument()
    const claimLib = new ClaimLibrary()
    const engine = new ArgumentEngine(argument, claimLib, {
        behavior: "permissive",
    })

    const variableIds = new Map<string, string>()
    const variableIdFor = (name: string): string => {
        const existing = variableIds.get(name)
        if (existing !== undefined) return existing
        const claim = claimLib.create({
            id: `claim-${name}`,
            type: input.claimTypes?.[name] ?? "normal",
        })
        const variable = engine.ensureClaimBoundVariable(claim.id)
        variableIds.set(name, variable.id)
        return variable.id
    }

    let exprSeq = 0
    const addTree = (
        premise: ReturnType<ArgumentEngine["createPremise"]>["result"],
        node: TNode,
        parentId: string | null,
        position: number
    ): string => {
        const id = `e-${exprSeq++}`
        const common = {
            id,
            argumentId: argument.id,
            argumentVersion: argument.version,
            premiseId: premise.getId(),
            parentId,
            position,
        }
        if (node.kind === "var") {
            premise.addExpression({
                ...common,
                type: "variable",
                variableId: variableIdFor(node.name),
            })
            return id
        }
        premise.addExpression({
            ...common,
            type: "operator",
            operator: node.operator,
        })
        node.kids.forEach((kid, index) => addTree(premise, kid, id, index))
        return id
    }

    const { result: conclusionPremise } = engine.createPremise()
    const conclusionRootId = addTree(
        conclusionPremise,
        input.conclusion,
        null,
        0
    )
    engine.setConclusionPremise(conclusionPremise.getId())

    const premiseIds: string[] = []
    const rootIds: string[] = []
    for (const tree of input.premises ?? []) {
        const { result: premise } = engine.createPremise()
        rootIds.push(addTree(premise, tree, null, 0))
        premiseIds.push(premise.getId())
    }
    for (const derivation of input.derivations ?? []) {
        variableIdFor(derivation.derivedClaim)
        const { result: premise } = engine.createPremise({
            type: "derivation",
            derivedClaimId: `claim-${derivation.derivedClaim}`,
        })
        // A freshly created derivation premise is in naked-Q form; replace
        // that placeholder root with the tree the test asked for.
        const nakedRoot = premise.getRootExpression()
        if (nakedRoot !== undefined)
            premise.removeExpression(nakedRoot.id, true)
        rootIds.push(addTree(premise, derivation.tree, null, 0))
        premiseIds.push(premise.getId())
    }

    return {
        engine,
        variableId: (name) => variableIdFor(name),
        conclusionPremiseId: conclusionPremise.getId(),
        conclusionRootId,
        premiseIds,
        rootIds,
    }
}
