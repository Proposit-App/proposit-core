import type { TCoreValidationResult } from "../../types/evaluation.js"
import type {
    TColumnValue,
    TLinkCheckResult,
    TLinkViolation,
    TResponseCoherenceResult,
} from "../../types/response.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"
import type { TArgumentEvaluationContext } from "../evaluation/argument-evaluation.js"
import {
    findSatisfyingAssignment,
    type TSatisfyingAssignmentResult,
} from "../evaluation/satisfiability.js"
import {
    buildCombinedSet,
    CombinedPremise,
    formulaKey,
    type TCombinedLink,
    type TCombinedNode,
    type TCombinedSet,
    type TCombinedSetInput,
} from "./combined-premise-set.js"

/** What a check needs from the response, read once per call. */
export interface TResponseCheckInput extends TCombinedSetInput {
    /** Problems that make every check answer `invalid`, decided by the caller. */
    problems: TLinkViolation[]
    /**
     * Changes whenever the response changes, so that the analysis of one
     * response and target pair is computed once and reused until then.
     */
    responseKey: string
}

type TGroupStatus =
    | { status: "follows" }
    | { status: "asserted"; witness: Record<string, boolean> }
    | { status: "incoherent" }
    | { status: "undetermined" }

interface TLinkGroup {
    key: string
    links: TCombinedLink[]
    status: TGroupStatus
    grounded?: boolean
}

/** Everything about one response and target pair that every link shares. */
interface TResponseAnalysis {
    set: TCombinedSet
    coherence: TSatisfyingAssignmentResult
    groups: Map<string, TLinkGroup>
    groupOfPremise: Map<string, TLinkGroup>
    /** False when any link is undetermined; `restsOnlyOnLinks` is then left out. */
    groundingKnown: boolean
}

const analysisCache = new WeakMap<
    TArgumentEngineSnapshot,
    Map<string, TResponseAnalysis>
>()

/** The premise standing for "this link's content is false". */
const NEGATION_ID = "\u0000negation"

/**
 * The satisfiability search, over premises of the combined set. A row stops
 * at its first false premise, so callers put the most restrictive premise
 * first.
 */
function search(
    set: TCombinedSet,
    premises: readonly CombinedPremise[]
): TSatisfyingAssignmentResult {
    const byId = new Map(premises.map((premise) => [premise.getId(), premise]))
    const ctx: TArgumentEvaluationContext = {
        argumentId: "",
        conclusionPremiseId: undefined,
        getConclusionPremise: () => undefined,
        listSupportingPremises: () => [],
        listPremises: () => [...premises],
        // Every variable of the combined set is a column, so the search never
        // needs to look one up.
        getVariable: () => undefined,
        getPremise: (id) => byId.get(id),
        validateEvaluability: (): TCoreValidationResult => ({
            ok: true,
            issues: [],
        }),
    }
    return findSatisfyingAssignment(ctx, {
        premises: [...premises],
        freeVariableIds: [...set.columns.keys()],
        forcedTrueVariableIds: set.forcedTrueColumns,
    })
}

function negationOf(link: TCombinedLink): CombinedPremise {
    const content: TCombinedNode = link.negated
        ? { kind: "op", operator: "not", kids: [link.referent] }
        : link.referent
    return new CombinedPremise(NEGATION_ID, {
        kind: "op",
        operator: "not",
        kids: [content],
    })
}

/** Premises other than the group's own links. */
function othersOf(set: TCombinedSet, group: TLinkGroup): CombinedPremise[] {
    const own = new Set(group.links.map((link) => link.premiseId))
    return set.premises.filter((premise) => !own.has(premise.getId()))
}

function nonLinkPremises(set: TCombinedSet): CombinedPremise[] {
    const linkPremiseIds = new Set(set.links.map((link) => link.premiseId))
    return set.premises.filter(
        (premise) => !linkPremiseIds.has(premise.getId())
    )
}

function groupKey(link: TCombinedLink): string {
    return `${link.negated ? "-" : "+"}${link.referentKey}`
}

function analyse(input: TResponseCheckInput): TResponseAnalysis {
    const set = buildCombinedSet(input)
    const coherence = search(set, set.premises)

    const groups = new Map<string, TLinkGroup>()
    const groupOfPremise = new Map<string, TLinkGroup>()
    for (const link of set.links) {
        const key = groupKey(link)
        const group = groups.get(key) ?? {
            key,
            links: [],
            status: { status: "undetermined" },
        }
        group.links.push(link)
        groups.set(key, group)
        groupOfPremise.set(link.premiseId, group)
    }

    const nonLinks = nonLinkPremises(set)
    for (const group of groups.values()) {
        if (coherence.satisfiable === false) {
            group.status = { status: "incoherent" }
            continue
        }
        if (coherence.satisfiable === null) continue
        // A link that follows from the premises that are not links follows
        // from the larger set as well, and is grounded; asking that first
        // spares the larger search in the common case.
        const fromNonLinks = search(set, [
            negationOf(group.links[0]),
            ...nonLinks,
        ])
        if (fromNonLinks.satisfiable === false) {
            group.status = { status: "follows" }
            group.grounded = true
            continue
        }
        // Links sharing a referent and polarity are one assertion written more
        // than once; none of them may support another.
        const answer = search(set, [
            negationOf(group.links[0]),
            ...othersOf(set, group),
        ])
        if (answer.satisfiable === false) group.status = { status: "follows" }
        else if (answer.satisfiable === true)
            group.status = { status: "asserted", witness: answer.assignment }
    }

    const groundingKnown = [...groups.values()].every(
        (group) => group.status.status !== "undetermined"
    )
    if (groundingKnown) ground(set, groups)
    return { set, coherence, groups, groupOfPremise, groundingKnown }
}

/**
 * Marks each link group grounded or not. A group is grounded when it is
 * asserted, or when it follows from the premises that are not links together
 * with groups already grounded — repeated until nothing changes. A link that
 * follows without being grounded rests only on other links.
 */
function ground(set: TCombinedSet, groups: Map<string, TLinkGroup>): void {
    const nonLinks = nonLinkPremises(set)
    for (const group of groups.values()) {
        group.grounded =
            group.grounded === true || group.status.status === "asserted"
    }
    let changed = true
    while (changed) {
        changed = false
        const groundedPremiseIds = new Set(
            [...groups.values()]
                .filter((group) => group.grounded === true)
                .flatMap((group) => group.links.map((link) => link.premiseId))
        )
        const base = [
            ...nonLinks,
            ...set.premises.filter((premise) =>
                groundedPremiseIds.has(premise.getId())
            ),
        ]
        for (const group of groups.values()) {
            if (group.grounded === true || group.status.status !== "follows")
                continue
            const answer = search(set, [negationOf(group.links[0]), ...base])
            if (answer.satisfiable === false) {
                group.grounded = true
                changed = true
            }
        }
    }
}

function analysisFor(input: TResponseCheckInput): TResponseAnalysis {
    const byResponse =
        analysisCache.get(input.target) ?? new Map<string, TResponseAnalysis>()
    analysisCache.set(input.target, byResponse)
    const cached = byResponse.get(input.responseKey)
    if (cached !== undefined) return cached
    const analysis = analyse(input)
    byResponse.set(input.responseKey, analysis)
    return analysis
}

/**
 * Removes premises one at a time while `stillHolds` keeps answering true, and
 * returns what remains: a set from which no single premise can be removed.
 */
function minimise(
    premises: readonly CombinedPremise[],
    stillHolds: (premises: CombinedPremise[]) => boolean,
    removeFirst: ReadonlySet<string> = new Set()
): CombinedPremise[] {
    let kept = [...premises]
    // Removing a whole batch in one step, when it can go, saves a search per
    // member; the pass below still leaves a set no single premise can leave.
    if (removeFirst.size > 0) {
        const trial = kept.filter(
            (candidate) => !removeFirst.has(candidate.getId())
        )
        if (trial.length < kept.length && stillHolds(trial)) kept = trial
    }
    for (const premise of [...kept]) {
        const trial = kept.filter((candidate) => candidate !== premise)
        if (stillHolds(trial)) kept = trial
    }
    return kept
}

/** Whether `node`, with any `NOT`s above it removed, is the formula `key`. */
function isReferent(node: TCombinedNode, key: string): boolean {
    let current = node
    while (current.kind === "op" && current.operator === "not")
        current = current.kids[0]
    return formulaKey(current) === key
}

/**
 * Whether some premise has `key` on the consequent side of a conditional: to
 * the right of an `implies`, or on either side of an `iff`, at any depth.
 */
function hasOnConsequentSide(
    premises: readonly CombinedPremise[],
    key: string
): boolean {
    const visit = (node: TCombinedNode): boolean => {
        if (node.kind === "column") return false
        if (node.operator === "implies" && isReferent(node.kids[1], key))
            return true
        if (
            node.operator === "iff" &&
            node.kids.some((kid) => isReferent(kid, key))
        )
            return true
        return node.kids.some(visit)
    }
    return premises.some((premise) => visit(premise.tree))
}

function counterexampleOf(
    set: TCombinedSet,
    witness: Record<string, boolean>
): TColumnValue[] {
    return Object.keys(witness)
        .sort()
        .flatMap((key) => {
            const column = set.columns.get(key)
            return column === undefined ? [] : [{ column, value: witness[key] }]
        })
}

/**
 * Whether one link of a response follows from the response's other premises.
 * See `TLinkCheckResult` for each answer.
 *
 * @throws When `linkPremiseId` is not a link of the response.
 */
export function checkLink(
    input: TResponseCheckInput,
    linkPremiseId: string
): TLinkCheckResult {
    if (input.problems.length > 0)
        return { status: "invalid", problems: input.problems }
    const analysis = analysisFor(input)
    const group = analysis.groupOfPremise.get(linkPremiseId)
    if (group === undefined) {
        throw new Error(`Premise "${linkPremiseId}" is not a link.`)
    }
    const { set } = analysis
    const status = group.status
    switch (status.status) {
        case "incoherent":
            return { status: "incoherent" }
        case "undetermined":
            return { status: "undetermined", reason: "too-many-variables" }
        case "asserted": {
            const link = group.links[0]
            const others = set.premises.filter(
                (premise) => premise.getId() !== linkPremiseId
            )
            return {
                status: "asserted",
                attemptedSupport: hasOnConsequentSide(others, link.referentKey),
                counterexample: counterexampleOf(set, status.witness),
            }
        }
        case "follows": {
            const negation = negationOf(group.links[0])
            const support = minimise(
                othersOf(set, group),
                (premises) =>
                    search(set, [negation, ...premises]).satisfiable === false,
                new Set(set.links.map((link) => link.premiseId))
            )
            return {
                status: "follows",
                supportPremiseIds: support.map((premise) => premise.getId()),
                ...(analysis.groundingKnown
                    ? { restsOnlyOnLinks: group.grounded !== true }
                    : {}),
            }
        }
    }
}

/**
 * Whether all of a response's premises can hold at once, searched over the
 * same combined set as `checkLink`, so the two never disagree.
 */
export function checkResponseCoherent(
    input: TResponseCheckInput
): TResponseCoherenceResult {
    if (input.problems.length > 0)
        return { status: "invalid", problems: input.problems }
    const analysis = analysisFor(input)
    const { set, coherence } = analysis
    if (coherence.satisfiable === true)
        return { status: "checked", coherent: true }
    if (coherence.satisfiable === null)
        return {
            status: "checked",
            coherent: null,
            reason: "too-many-variables",
        }
    const unsatisfiable = minimise(
        set.premises,
        (premises) => search(set, premises).satisfiable === false
    )
    return {
        status: "checked",
        coherent: false,
        unsatisfiablePremiseIds: unsatisfiable.map((premise) =>
            premise.getId()
        ),
    }
}
