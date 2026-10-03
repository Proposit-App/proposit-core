import {
    isClaimBound,
    isExpressionBound,
    isPremiseBound,
    type TCoreArgumentReference,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCarriedSource,
    TCarryCollision,
    TCarryResult,
    TLinkAnswer,
    TLinkViolation,
    TMergedCarriedInput,
    TNotCarried,
    TNotCarriedReason,
    TResponseLink,
} from "../../types/response.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"
import { SATISFIABILITY_VARIABLE_CEILING } from "../evaluation/satisfiability.js"
import type { TClaimLookup } from "../interfaces/library.interfaces.js"
import {
    createTargetExpander,
    evaluateCombinedNode,
    type TCombinedNode,
    type TTargetExpander,
} from "./combined-premise-set.js"
import { isPremiseRootExpression } from "./fingerprint.js"
import { readLink } from "./links.js"

/**
 * What "this expression has this value" says about its columns.
 *
 * - `cube`: exactly the rows where each column in `fixed` has its value and
 *   every other column is free.
 * - `notExpressible`: the rows are not of that shape, so no set of fixed
 *   values says the same thing.
 * - `impossible`: no row gives the expression the value.
 * - `vacuous`: every row does.
 * - `tooLarge`: the expression reads more columns than the search allows.
 */
export type TStatementDecomposition =
    | { kind: "cube"; fixed: Map<string, boolean> }
    | { kind: "notExpressible" }
    | { kind: "impossible" }
    | { kind: "vacuous" }
    | { kind: "tooLarge" }

/** Every column a formula reads, once each, in first-seen order. */
function columnsOf(node: TCombinedNode): string[] {
    const keys = new Set<string>()
    const visit = (current: TCombinedNode): void => {
        if (current.kind === "column") keys.add(current.key)
        else current.kids.forEach(visit)
    }
    visit(node)
    return [...keys]
}

/**
 * Reads "the target expression `expressionId` has value `value`" as fixed
 * column values, over the expression's own expansion with every column free.
 * Nothing outside the expression enters: not the response's premises, not
 * the response's grounded columns, not the target's axioms.
 */
export function decomposeStatement(
    expander: TTargetExpander,
    expressionId: string,
    value: boolean
): TStatementDecomposition {
    const node = expander.expand(expressionId)
    // The expander's own column map holds every column any expansion made,
    // so the expression's columns are read from its formula.
    const keys = columnsOf(node)
    if (keys.length > SATISFIABILITY_VARIABLE_CEILING)
        return { kind: "tooLarge" }

    let kept = 0
    // For each column: the value every kept row so far gives it, or `null`
    // once two kept rows disagree.
    const agreed = new Map<string, boolean | null>()
    const row: Record<string, boolean> = {}
    const total = 2 ** keys.length
    for (let mask = 0; mask < total; mask++) {
        keys.forEach((key, index) => {
            row[key] = (mask & (1 << index)) !== 0
        })
        if (evaluateCombinedNode(node, (key) => row[key]) !== value) continue
        kept++
        for (const key of keys) {
            const seen = agreed.get(key)
            if (seen === undefined) agreed.set(key, row[key])
            else if (seen !== null && seen !== row[key]) agreed.set(key, null)
        }
    }

    if (kept === 0) return { kind: "impossible" }
    if (kept === total) return { kind: "vacuous" }
    const fixed = new Map<string, boolean>()
    for (const [key, seen] of agreed) {
        if (seen !== null) fixed.set(key, seen)
    }
    // The kept rows form a cube exactly when they are every row of the
    // columns left free.
    if (kept !== 2 ** (keys.length - fixed.size))
        return { kind: "notExpressible" }
    return { kind: "cube", fixed }
}

/** What carrying needs from the response, read once per call. */
export interface TCarryInput {
    /** Problems that make the answer `invalid`, decided by the caller. */
    problems: TLinkViolation[]
    /** The argument and version the response answers. */
    into: TCoreArgumentReference
    /** Every premise of the response, in order. */
    responsePremiseIds: readonly string[]
    links: readonly TResponseLink[]
    linkAnswers: Readonly<Record<string, TLinkAnswer>>
    target: TArgumentEngineSnapshot
    /** Resolves the target's claims at the versions it binds. */
    targetClaims: TClaimLookup
    /**
     * The links whose answers are the reader's own rather than carried into
     * this response from another; they outrank the rest on a conflict.
     */
    ownLinkPremiseIds?: Iterable<string>
}

/** One value an agreed link would carry. */
type TProposal =
    | { kind: "variable"; id: string; value: boolean }
    | { kind: "operator"; id: string; value: "accepted" | "rejected" }
    | { kind: "linkAnswer"; id: string; value: TLinkAnswer }

type TLinkOutcome = { values: TProposal[] } | { reason: TNotCarriedReason }

/** The parts of the target snapshot carrying reads, indexed once. */
interface TTargetIndex {
    expressions: Map<string, TCorePropositionalExpression>
    premiseOfExpression: Map<string, { id: string; type?: string }>
    conclusionPremiseId: string | undefined
    /** Variables named by a premise evaluation reads. */
    evaluatedVariables: TCorePropositionalVariable[]
}

function indexTarget(target: TArgumentEngineSnapshot): TTargetIndex {
    const expressions = new Map<string, TCorePropositionalExpression>()
    const premiseOfExpression = new Map<string, { id: string; type?: string }>()
    const evaluatedVariableIds = new Set<string>()
    for (const ps of target.premises) {
        const own = ps.expressions.expressions
        for (const expr of own) {
            expressions.set(expr.id, expr)
            premiseOfExpression.set(expr.id, ps.premise)
        }
        // Evaluation hides a derivation premise that holds only its derived
        // claim's variable, so nothing placed there would be read.
        const nakedQ =
            ps.premise.type === "derivation" &&
            own.length === 1 &&
            own[0].type === "variable"
        if (nakedQ) continue
        for (const expr of own) {
            if (expr.type === "variable")
                evaluatedVariableIds.add(expr.variableId)
        }
    }
    return {
        expressions,
        premiseOfExpression,
        conclusionPremiseId: target.conclusionPremiseId,
        evaluatedVariables: target.variables.variables.filter((variable) =>
            evaluatedVariableIds.has(variable.id)
        ),
    }
}

/** What an agreed statement link carries into a standard argument. */
function carryStatement(
    link: TResponseLink,
    expander: TTargetExpander,
    index: TTargetIndex,
    targetClaims: TClaimLookup
): TLinkOutcome {
    const decomposition = decomposeStatement(
        expander,
        link.boundExpressionId,
        link.move === "affirm"
    )
    if (decomposition.kind !== "cube") return { reason: decomposition.kind }
    const values: TProposal[] = []
    let skippedAxiom = false
    for (const [key, value] of decomposition.fixed) {
        const column = expander.columns.get(key)
        if (column === undefined) continue
        if (column.kind === "claim") {
            for (const variable of index.evaluatedVariables) {
                if (!isClaimBound(variable)) continue
                if (variable.claimId !== column.claimId) continue
                const claim = targetClaims.get(
                    variable.claimId,
                    variable.claimVersion
                )
                // Without the claim there is no telling whether it is an
                // axiom, and evaluation throws on an assigned axiom.
                if (claim === undefined) return { reason: "unknownClaim" }
                if (claim.type === "axiomatic") {
                    // An axiom is always true: fixing it true adds nothing,
                    // and fixing it false contradicts it.
                    if (!value) return { reason: "axiom" }
                    skippedAxiom = true
                    continue
                }
                values.push({ kind: "variable", id: variable.id, value })
            }
        } else if (column.kind === "premise") {
            for (const variable of index.evaluatedVariables) {
                if (!isPremiseBound(variable)) continue
                if (
                    variable.boundArgumentId === column.argumentId &&
                    variable.boundArgumentVersion === column.argumentVersion &&
                    variable.boundPremiseId === column.premiseId
                )
                    values.push({ kind: "variable", id: variable.id, value })
            }
        }
    }
    if (values.length === 0)
        return { reason: skippedAxiom ? "axiom" : "noLinkReached" }
    return { values }
}

/** What an agreed inference link carries into a standard argument. */
function carryInference(
    link: TResponseLink,
    target: TArgumentEngineSnapshot,
    index: TTargetIndex
): TLinkOutcome {
    const expr = index.expressions.get(link.boundExpressionId)
    const premise = index.premiseOfExpression.get(link.boundExpressionId)
    if (expr?.type !== "operator" || premise === undefined)
        return { reason: "noLinkReached" }
    const atRoot = isPremiseRootExpression(target, expr.id)
    const inDerivation = premise.type === "derivation"
    const inConclusion = premise.id === index.conclusionPremiseId
    if (link.move === "reinforce") {
        // Evaluation reads an accepted operator as "this subexpression is
        // true", so only a conditional root, whose step is an inference, means
        // what a reinforce says.
        if (!atRoot) return { reason: "nestedReinforce" }
        if (expr.operator !== "implies" && expr.operator !== "iff")
            return { reason: "nonConditionalRoot" }
        return {
            values: [{ kind: "operator", id: expr.id, value: "accepted" }],
        }
    }
    // Evaluation ignores a rejection inside a derivation premise, and one
    // below the conclusion's root.
    if (inDerivation) return { reason: "derivationOperator" }
    if (inConclusion && !atRoot) return { reason: "ignoredInConclusion" }
    return { values: [{ kind: "operator", id: expr.id, value: "rejected" }] }
}

/**
 * What an agreed link carries into a response it answers: answers on that
 * response's links. Each link of the response is `x` or `NOT(x)` for one of
 * its expression-bound variables, and expanding the response keeps `x` as a
 * column, so a fixed value of that column answers every link on it.
 */
function carryIntoResponse(
    link: TResponseLink,
    expander: TTargetExpander,
    index: TTargetIndex,
    targetLinks: readonly TResponseLink[],
    targetVariables: ReadonlyMap<string, TCorePropositionalVariable>
): TLinkOutcome {
    if (link.boundAspect === "inference") {
        // The only operator of a link is its NOT, which has no step; an
        // operator of any other premise of an argument never evaluated
        // reaches nothing.
        const premise = index.premiseOfExpression.get(link.boundExpressionId)
        const onLink = targetLinks.some(
            (targetLink) => targetLink.premiseId === premise?.id
        )
        return { reason: onLink ? "linkStep" : "noLinkReached" }
    }
    const decomposition = decomposeStatement(
        expander,
        link.boundExpressionId,
        link.move === "affirm"
    )
    if (decomposition.kind !== "cube") return { reason: decomposition.kind }
    const values: TProposal[] = []
    for (const [key, value] of decomposition.fixed) {
        const column = expander.columns.get(key)
        // Values of claims and premises are dropped: the response answered is
        // never evaluated, so only its links' answers mean anything.
        if (column?.kind !== "expression") continue
        for (const targetLink of targetLinks) {
            const variable = targetVariables.get(targetLink.variableId)
            if (variable === undefined || !isExpressionBound(variable)) continue
            if (
                variable.boundArgumentId !== column.argumentId ||
                variable.boundExpressionId !== column.expressionId ||
                variable.boundAspect !== column.aspect
            )
                continue
            const saysTrue =
                targetLink.move === "affirm" || targetLink.move === "reinforce"
            values.push({
                kind: "linkAnswer",
                id: targetLink.premiseId,
                value: value === saysTrue ? "agree" : "disagree",
            })
        }
    }
    if (values.length === 0) return { reason: "noLinkReached" }
    return { values }
}

function proposalKey(proposal: TProposal): string {
    return `${proposal.kind}:${proposal.id}`
}

// For each value key, the links proposing each value (keyed by its text).
function proposalValues(
    proposals: ReadonlyMap<string, TProposal[]>
): Map<string, Map<string, string[]>> {
    const valuesOf = new Map<string, Map<string, string[]>>()
    for (const [premiseId, values] of proposals) {
        for (const proposal of values) {
            const key = proposalKey(proposal)
            const byValue = valuesOf.get(key) ?? new Map<string, string[]>()
            const holders = byValue.get(String(proposal.value)) ?? []
            if (!holders.includes(premiseId)) holders.push(premiseId)
            byValue.set(String(proposal.value), holders)
            valuesOf.set(key, byValue)
        }
    }
    return valuesOf
}

// The links in one group that carry some value another link of the group
// carries the other way, each with the links it disagrees with.
function conflictsWithin(
    proposals: ReadonlyMap<string, TProposal[]>
): Map<string, Set<string>> {
    const conflictsWith = new Map<string, Set<string>>()
    for (const byValue of proposalValues(proposals).values()) {
        if (byValue.size < 2) continue
        const involved = [...byValue.values()].flat()
        for (const premiseId of involved) {
            const others = conflictsWith.get(premiseId) ?? new Set<string>()
            for (const other of involved)
                if (other !== premiseId) others.add(other)
            conflictsWith.set(premiseId, others)
        }
    }
    return conflictsWith
}

function collisionOf(
    proposal: TProposal,
    ownValue: string,
    premiseId: string
): TCarryCollision {
    const linkPremiseIds = [premiseId]
    if (proposal.kind === "variable")
        return {
            kind: "variable",
            id: proposal.id,
            own: ownValue === "true",
            carried: proposal.value,
            linkPremiseIds,
        }
    if (proposal.kind === "operator")
        return {
            kind: "operator",
            id: proposal.id,
            own: ownValue as "accepted" | "rejected",
            carried: proposal.value,
            linkPremiseIds,
        }
    return {
        kind: "linkAnswer",
        id: proposal.id,
        own: ownValue as TLinkAnswer,
        carried: proposal.value,
        linkPremiseIds,
    }
}

// Joins collisions on the same value into one, naming every carried link
// behind it, and puts them in a stable order.
function mergeCollisions(
    collisions: TCarryCollision[],
    byOrder: (a: string, b: string) => number
): void {
    const joined = new Map<string, TCarryCollision>()
    for (const collision of collisions) {
        const key = `${collision.kind}:${collision.id}`
        const existing = joined.get(key)
        if (existing === undefined) joined.set(key, collision)
        else
            for (const premiseId of collision.linkPremiseIds)
                if (!existing.linkPremiseIds.includes(premiseId))
                    existing.linkPremiseIds.push(premiseId)
    }
    collisions.length = 0
    for (const collision of [...joined.values()].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    )) {
        collision.linkPremiseIds.sort(byOrder)
        collisions.push(collision)
    }
}

/**
 * What a reader's answers on a response's links carry into the argument it
 * answers. Only `agree` answers carry; each agreed link carries exactly what
 * it says, or is reported in `notCarried` with the reason it cannot.
 */
export function carryAnswers(input: TCarryInput): TCarryResult {
    if (input.problems.length > 0)
        return { status: "invalid", problems: input.problems }
    const { target } = input
    const intoResponse = target.argument.respondsTo !== undefined
    const expander = createTargetExpander(target)
    const index = indexTarget(target)
    const linkOf = new Map(input.links.map((link) => [link.premiseId, link]))
    const targetVariables = new Map(
        target.variables.variables.map((variable) => [variable.id, variable])
    )
    const targetLinks = intoResponse
        ? target.premises.flatMap((ps) => {
              const targetLink = readLink(
                  ps.premise.id,
                  ps.expressions.expressions,
                  (id) => targetVariables.get(id)
              )
              return targetLink === undefined ? [] : [targetLink]
          })
        : []
    const order = new Map(input.responsePremiseIds.map((id, at) => [id, at]))
    const byOrder = (a: string, b: string): number =>
        (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) ||
        a.localeCompare(b)

    const notCarried: TNotCarried[] = []
    const proposals = new Map<string, TProposal[]>()
    const agreed = Object.keys(input.linkAnswers)
        .filter((premiseId) => input.linkAnswers[premiseId] === "agree")
        .sort(byOrder)
    for (const premiseId of agreed) {
        const link = linkOf.get(premiseId)
        if (link === undefined) {
            notCarried.push({ premiseId, reason: "notALink" })
            continue
        }
        const outcome: TLinkOutcome = intoResponse
            ? carryIntoResponse(
                  link,
                  expander,
                  index,
                  targetLinks,
                  targetVariables
              )
            : link.boundAspect === "statement"
              ? carryStatement(link, expander, index, input.targetClaims)
              : carryInference(link, target, index)
        if ("reason" in outcome)
            notCarried.push({ premiseId, reason: outcome.reason })
        else proposals.set(premiseId, outcome.values)
    }

    // A link that would carry something another agreed link carries the other
    // way carries nothing at all: carrying only its uncontested part would
    // assert less than it says. The reader's own answers are settled first:
    // a carried link that disagrees with one of them is dropped instead, and
    // the disagreement reported as a collision, so the reader's value wins.
    const own = new Set(input.ownLinkPremiseIds ?? [])
    const ownProposals = new Map(
        [...proposals].filter(([premiseId]) => own.has(premiseId))
    )
    const carriedProposals = new Map(
        [...proposals].filter(([premiseId]) => !own.has(premiseId))
    )
    const ownValuesOf = proposalValues(ownProposals)
    const collisions: TCarryCollision[] = []
    for (const [premiseId, values] of carriedProposals) {
        const outranking = new Set<string>()
        const disputed: TProposal[] = []
        for (const proposal of values) {
            const byValue = ownValuesOf.get(proposalKey(proposal))
            if (byValue === undefined) continue
            let isDisputed = false
            for (const [value, holders] of byValue) {
                if (value === String(proposal.value)) continue
                isDisputed = true
                for (const holder of holders) outranking.add(holder)
            }
            if (isDisputed) disputed.push(proposal)
        }
        if (outranking.size === 0) continue
        carriedProposals.delete(premiseId)
        notCarried.push({
            premiseId,
            reason: "overriddenByOwn",
            conflictsWith: [...outranking].sort(byOrder),
        })
        for (const proposal of disputed) {
            const byValue = ownValuesOf.get(proposalKey(proposal))
            // When the reader's own links disagree among themselves they
            // conflict below and carry nothing, so there is no own value.
            if (byValue?.size !== 1) continue
            const ownValue = [...byValue.keys()][0]
            collisions.push(collisionOf(proposal, ownValue, premiseId))
        }
    }
    proposals.clear()
    for (const group of [ownProposals, carriedProposals]) {
        const conflictsWith = conflictsWithin(group)
        for (const [premiseId, values] of group)
            if (!conflictsWith.has(premiseId)) proposals.set(premiseId, values)
        for (const [premiseId, others] of conflictsWith)
            notCarried.push({
                premiseId,
                reason: "conflict",
                conflictsWith: [...others].sort(byOrder),
            })
    }
    mergeCollisions(collisions, byOrder)
    notCarried.sort((a, b) => byOrder(a.premiseId, b.premiseId))

    const sourceOf = new Map<string, TCarriedSource>()
    for (const [premiseId, values] of proposals) {
        for (const proposal of values) {
            const key = proposalKey(proposal)
            const source = sourceOf.get(key) ?? {
                ...proposal,
                linkPremiseIds: [],
            }
            if (!source.linkPremiseIds.includes(premiseId))
                source.linkPremiseIds.push(premiseId)
            sourceOf.set(key, source)
        }
    }
    const sources = [...sourceOf.values()].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    )
    for (const source of sources) source.linkPremiseIds.sort(byOrder)

    if (intoResponse) {
        const linkAnswers: Record<string, TLinkAnswer> = {}
        for (const source of sources)
            if (source.kind === "linkAnswer")
                linkAnswers[source.id] = source.value
        return {
            status: "carried",
            into: input.into,
            intoResponse: true,
            linkAnswers,
            sources,
            notCarried,
            collisions,
        }
    }
    const variables: Record<string, boolean> = {}
    const operatorAssignments: Record<string, "accepted" | "rejected"> = {}
    for (const source of sources) {
        if (source.kind === "variable") variables[source.id] = source.value
        else if (source.kind === "operator")
            operatorAssignments[source.id] = source.value
    }
    return {
        status: "carried",
        into: input.into,
        intoResponse: false,
        variables,
        operatorAssignments,
        sources,
        notCarried,
        collisions,
    }
}

/**
 * Adds what `carryAnswers` carried to the reader's own explicit input for the
 * argument it was carried into. The reader's value wins every collision, and
 * each collision is reported with the links the carried value came from. An
 * explicit `null` ("not sure") is not a value: a carried value replaces it
 * without a collision.
 *
 * `own` is the reader's explicit input only, never a default assignment: a
 * default is not the reader's assertion, and passing one here would let a
 * default `true` on a citation outrank a carried "the citation is false".
 * Apply defaults underneath, for example
 * `evaluateWithDefaults(merged.variables, options, merged.operatorAssignments)`.
 *
 * It does not check that `own` is for the argument `carried.into` names;
 * the caller pairs them.
 */
export function mergeCarriedInput(
    own: {
        variables?: Readonly<Record<string, boolean | null>>
        operatorAssignments?: Readonly<Record<string, "accepted" | "rejected">>
        linkAnswers?: Readonly<Record<string, TLinkAnswer>>
    },
    carried: Extract<TCarryResult, { status: "carried" }>
): TMergedCarriedInput {
    const merged: TMergedCarriedInput = {
        variables: { ...own.variables },
        operatorAssignments: { ...own.operatorAssignments },
        linkAnswers: { ...own.linkAnswers },
        collisions: carried.collisions.map((collision) => ({
            ...collision,
            linkPremiseIds: [...collision.linkPremiseIds],
        })),
    }
    for (const source of carried.sources) {
        const { linkPremiseIds } = source
        if (source.kind === "variable") {
            const mine = merged.variables[source.id] ?? null
            if (mine === null) merged.variables[source.id] = source.value
            else if (mine !== source.value)
                merged.collisions.push({
                    kind: "variable",
                    id: source.id,
                    own: mine,
                    carried: source.value,
                    linkPremiseIds: [...linkPremiseIds],
                })
        } else if (source.kind === "operator") {
            const mine = merged.operatorAssignments[source.id]
            if (mine === undefined)
                merged.operatorAssignments[source.id] = source.value
            else if (mine !== source.value)
                merged.collisions.push({
                    kind: "operator",
                    id: source.id,
                    own: mine,
                    carried: source.value,
                    linkPremiseIds: [...linkPremiseIds],
                })
        } else {
            const mine = merged.linkAnswers[source.id]
            if (mine === undefined) merged.linkAnswers[source.id] = source.value
            else if (mine !== source.value)
                merged.collisions.push({
                    kind: "linkAnswer",
                    id: source.id,
                    own: mine,
                    carried: source.value,
                    linkPremiseIds: [...linkPremiseIds],
                })
        }
    }
    return merged
}
