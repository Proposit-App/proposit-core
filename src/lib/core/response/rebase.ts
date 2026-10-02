import { isExpressionBound } from "../../schemata/index.js"
import type {
    TBindingChangeReason,
    TBindingClassification,
    TBindingClassificationResult,
    TBindingPremiseUse,
    TRebaseDecisions,
} from "../../types/response.js"
import type {
    ArgumentEngine,
    TArgumentEngineSnapshot,
} from "../argument-engine.js"
import {
    describeSubtree,
    positionClassOf,
    premiseRootOf,
    snapshotHasExpression,
    type TOutsideReference,
} from "./fingerprint.js"
import { readLink, validateLinks } from "./links.js"

export interface TClassifyBindingsOptions {
    /**
     * Snapshots of other arguments, each identified by its id and version.
     * When a bound expression references an element of another argument and
     * the two versions of the answered argument pin that reference to
     * different versions, the element is compared across the two versions
     * supplied here. Without them the binding is reported changed with reason
     * `outsideReferenceRepinned`.
     */
    outsideSnapshots?: readonly TArgumentEngineSnapshot[]
}

const REASON_ORDER: readonly TBindingChangeReason[] = [
    "content",
    "position",
    "outsideReferenceRepinned",
]

function inOrder(reasons: Set<TBindingChangeReason>): TBindingChangeReason[] {
    return REASON_ORDER.filter((reason) => reasons.has(reason))
}

/**
 * Compares the elements of other arguments that a subtree references across
 * two versions of those arguments, as far as the supplied snapshots reach.
 */
class OutsideComparer {
    // Comparisons under way, so that references leading back into an
    // element already being compared count as unchanged instead of looping.
    private readonly entered = new Set<string>()

    constructor(
        private readonly outsideSnapshots: readonly TArgumentEngineSnapshot[]
    ) {}

    private find(
        argumentId: string,
        version: number
    ): TArgumentEngineSnapshot | undefined {
        return this.outsideSnapshots.find(
            (snap) =>
                snap.argument.id === argumentId &&
                snap.argument.version === version
        )
    }

    /**
     * Reasons the subtree rooted at `idA` in `snapA` differs from the one
     * rooted at `idB` in `snapB`. `position` means the two sit in different
     * position classes.
     */
    compareSubtrees(
        snapA: TArgumentEngineSnapshot,
        idA: string,
        snapB: TArgumentEngineSnapshot,
        idB: string
    ): Set<TBindingChangeReason> {
        const reasons = new Set<TBindingChangeReason>()
        const a = describeSubtree(snapA, idA)
        const b = describeSubtree(snapB, idB)
        if (positionClassOf(snapA, idA) !== positionClassOf(snapB, idB)) {
            reasons.add("position")
        }
        if (a.shape !== b.shape) {
            reasons.add("content")
            return reasons
        }
        // Equal shapes reference the same elements in the same order, so the
        // two lists differ at most in the versions they pin.
        a.outside.forEach((refA, i) => {
            const refB = b.outside[i]
            if (refA.argumentVersion === refB.argumentVersion) return
            for (const reason of this.compareRepinned(refA, refB)) {
                reasons.add(reason)
            }
        })
        return reasons
    }

    /**
     * Whether a reference pinned to one version of another argument in one
     * subtree, and to another version in the other, means the same thing in
     * both. The element is the same when it exists in both versions with the
     * same structure and position class, judging its own references the same
     * way; then the re-pin is no change. Otherwise it is `content`, and when
     * either version's snapshot was not supplied it is
     * `outsideReferenceRepinned`.
     */
    private compareRepinned(
        refA: TOutsideReference,
        refB: TOutsideReference
    ): Set<TBindingChangeReason> {
        const snapA = this.find(refA.argumentId, refA.argumentVersion)
        const snapB = this.find(refB.argumentId, refB.argumentVersion)
        if (snapA === undefined || snapB === undefined) {
            return new Set(["outsideReferenceRepinned"])
        }
        const elementId =
            refA.kind === "expression" ? refA.expressionId : refA.premiseId
        const key = `${refA.kind}|${refA.argumentId}|${refA.argumentVersion}|${refB.argumentVersion}|${elementId}`
        if (this.entered.has(key)) return new Set()
        this.entered.add(key)
        try {
            let rootA: string | null | undefined
            let rootB: string | null | undefined
            if (refA.kind === "expression") {
                rootA = snapshotHasExpression(snapA, elementId)
                    ? elementId
                    : undefined
                rootB = snapshotHasExpression(snapB, elementId)
                    ? elementId
                    : undefined
            } else {
                rootA = premiseRootOf(snapA, elementId)
                rootB = premiseRootOf(snapB, elementId)
            }
            if (rootA === undefined || rootB === undefined) {
                return new Set(["content"])
            }
            if (rootA === null || rootB === null) {
                return new Set(rootA === rootB ? [] : ["content"])
            }
            const reasons = this.compareSubtrees(snapA, rootA, snapB, rootB)
            // A difference in the referenced element, of any kind, is a
            // difference in what the referencing expression means.
            if (reasons.has("position")) {
                reasons.delete("position")
                reasons.add("content")
            }
            return reasons
        } finally {
            this.entered.delete(key)
        }
    }
}

/**
 * The premises of a response that dropping a variable removes: every premise
 * using the variable, then every premise using a variable bound to a premise
 * already in the list, and so on, since removing a premise removes the
 * variables bound to it and every expression using them.
 */
export function premisesDroppedWith(
    response: ArgumentEngine,
    variableId: string
): TBindingPremiseUse[] {
    const premises = response.listPremises()
    const uses = (premiseId: string, id: string): boolean =>
        response
            .getPremise(premiseId)!
            .getExpressions()
            .some((expr) => expr.type === "variable" && expr.variableId === id)
    const isLink = (premiseId: string): boolean => {
        const premise = response.getPremise(premiseId)!
        return (
            readLink(premiseId, premise.getExpressions(), (id) =>
                response.getVariable(id)
            ) !== undefined
        )
    }

    const listed = new Set<string>()
    const result: TBindingPremiseUse[] = []
    for (const premise of premises) {
        const premiseId = premise.getId()
        if (!uses(premiseId, variableId)) continue
        listed.add(premiseId)
        result.push({ premiseId, isLink: isLink(premiseId), cascaded: false })
    }
    // The loop also visits the entries it appends, so the cascade is
    // followed to its end.
    for (const removed of result) {
        for (const bound of response.getVariablesBoundToPremise(
            removed.premiseId
        )) {
            for (const premise of premises) {
                const premiseId = premise.getId()
                if (listed.has(premiseId) || !uses(premiseId, bound.id))
                    continue
                listed.add(premiseId)
                result.push({
                    premiseId,
                    isLink: isLink(premiseId),
                    cascaded: true,
                })
            }
        }
    }
    return result
}

/** Throws unless the two snapshots are versions of the argument `response` answers. */
function assertRebaseTargets(
    response: ArgumentEngine,
    targetFrom: TArgumentEngineSnapshot,
    targetTo: TArgumentEngineSnapshot
): void {
    const respondsTo = response.getRespondsTo()
    if (respondsTo === undefined) {
        throw new Error(
            `Argument "${response.getArgument().id}" is not a response.`
        )
    }
    if (targetFrom.argument.id !== targetTo.argument.id) {
        throw new Error(
            `The two target snapshots must be versions of the same argument, but they are "${targetFrom.argument.id}" and "${targetTo.argument.id}".`
        )
    }
    if (
        respondsTo.argumentId !== targetFrom.argument.id ||
        (respondsTo.argumentVersion !== targetFrom.argument.version &&
            respondsTo.argumentVersion !== targetTo.argument.version)
    ) {
        throw new Error(
            `The response answers "${respondsTo.argumentId}" version ${respondsTo.argumentVersion}, not "${targetFrom.argument.id}" version ${targetFrom.argument.version} or ${targetTo.argument.version}.`
        )
    }
}

/**
 * Classifies what happened to each expression binding of a response between
 * two versions of the argument it answers, before the response is moved
 * from `targetFrom` to `targetTo`.
 *
 * Nothing here compares the two version numbers: `targetTo` may be older
 * than `targetFrom`, for example to show what a response pinned to a newer
 * version would see on the older one. Every label is then read in that
 * direction — `removed` means absent from `targetTo`.
 *
 * Each expression-bound variable is judged against the snapshot of the
 * version it is bound to. One already bound to `targetTo` is
 * `alreadyRebased` when its expression is there and `removed` when it is
 * not. Every other one must be bound to `targetFrom`, and is:
 * - `removed` when its expression id is absent from `targetTo`;
 * - `changed` when the expression's structure (`content`) or position class
 *   (`position`) differs, or when something it references in another
 *   argument is pinned to a different version that differs (`content`) or
 *   cannot be compared because a snapshot was not supplied
 *   (`outsideReferenceRepinned`);
 * - `unchanged` otherwise.
 *
 * Each entry lists the premises dropping the variable would remove. The
 * response's claim-bound variables are not classified: a claim it shares with
 * either version means the same proposition in both, and rebasing never
 * touches it.
 *
 * @throws When the response is not a response, when the two snapshots are
 * not versions of one argument, when the response answers neither version,
 * or when a binding names any other version.
 */
export function classifyBindings(
    response: ArgumentEngine,
    targetFrom: TArgumentEngineSnapshot,
    targetTo: TArgumentEngineSnapshot,
    options: TClassifyBindingsOptions = {}
): TBindingClassificationResult {
    assertRebaseTargets(response, targetFrom, targetTo)
    const comparer = new OutsideComparer(options.outsideSnapshots ?? [])
    const fromVersion = targetFrom.argument.version
    const toVersion = targetTo.argument.version

    const bindings: TBindingClassification[] = []
    for (const variable of response.getVariables()) {
        if (!isExpressionBound(variable)) continue
        const base = {
            variableId: variable.id,
            boundExpressionId: variable.boundExpressionId,
            boundAspect: variable.boundAspect,
            boundArgumentVersion: variable.boundArgumentVersion,
            premises: premisesDroppedWith(response, variable.id),
        }
        const presentInTo = snapshotHasExpression(
            targetTo,
            variable.boundExpressionId
        )
        if (variable.boundArgumentVersion === toVersion) {
            bindings.push({
                ...base,
                status: presentInTo ? "alreadyRebased" : "removed",
            })
            continue
        }
        if (variable.boundArgumentVersion !== fromVersion) {
            throw new Error(
                `Variable "${variable.id}" is bound to version ${variable.boundArgumentVersion} of "${variable.boundArgumentId}", which is neither version ${fromVersion} nor version ${toVersion}.`
            )
        }
        if (!presentInTo) {
            bindings.push({ ...base, status: "removed" })
            continue
        }
        if (!snapshotHasExpression(targetFrom, variable.boundExpressionId)) {
            // Nothing to compare against: the binding was already broken.
            bindings.push({ ...base, status: "changed", reasons: ["content"] })
            continue
        }
        const reasons = comparer.compareSubtrees(
            targetFrom,
            variable.boundExpressionId,
            targetTo,
            variable.boundExpressionId
        )
        bindings.push(
            reasons.size === 0
                ? { ...base, status: "unchanged" }
                : { ...base, status: "changed", reasons: inOrder(reasons) }
        )
    }
    return { bindings }
}

/** What a rebase does, worked out and checked before anything changes. */
export interface TResolvedRebase {
    classification: TBindingClassificationResult
    /** Expression-bound variables to bind to `targetTo`, with their new expression. */
    repoint: Map<string, string>
    /** Premises to remove, in the order listed. */
    dropPremiseIds: string[]
    /** Variables to remove after their premises. */
    dropVariableIds: string[]
}

/**
 * Works out what a rebase does from the classification and the caller's
 * decisions, refusing every decision that cannot be carried out before
 * anything changes.
 *
 * @throws When a changed or removed binding has no decision; when a decision names a variable that needs none; when a
 * removed binding is to be kept; when a retarget names an expression absent
 * from `targetTo`; when a keep or retarget would bind an expression another
 * variable already binds in the same aspect.
 */
export function resolveRebase(
    response: ArgumentEngine,
    targetFrom: TArgumentEngineSnapshot,
    targetTo: TArgumentEngineSnapshot,
    decisions: TRebaseDecisions,
    options: TClassifyBindingsOptions = {}
): TResolvedRebase {
    const classification = classifyBindings(
        response,
        targetFrom,
        targetTo,
        options
    )
    const toVersion = targetTo.argument.version
    const bindingDecisions = decisions.bindings ?? {}

    const repoint = new Map<string, string>()
    const decided = new Set<string>()
    const dropPremiseIds: string[] = []
    const dropVariableIds: string[] = []
    const dropPremises = (uses: TBindingPremiseUse[]): void => {
        for (const use of uses) {
            if (!dropPremiseIds.includes(use.premiseId))
                dropPremiseIds.push(use.premiseId)
        }
    }

    const needing = new Set<string>()
    for (const entry of classification.bindings) {
        if (entry.status === "unchanged") {
            repoint.set(entry.variableId, entry.boundExpressionId)
            continue
        }
        if (entry.status === "alreadyRebased") continue
        needing.add(entry.variableId)
        const decision = bindingDecisions[entry.variableId]
        if (decision === undefined) {
            throw new Error(
                `No decision for variable "${entry.variableId}", whose binding is ${entry.status}; give keep, retarget or drop.`
            )
        }
        if (decision.action === "drop") {
            dropPremises(entry.premises)
            dropVariableIds.push(entry.variableId)
        } else if (decision.action === "keep") {
            if (entry.status === "removed") {
                throw new Error(
                    `Variable "${entry.variableId}" cannot be kept: its expression "${entry.boundExpressionId}" was removed from version ${toVersion}; retarget or drop it.`
                )
            }
            repoint.set(entry.variableId, entry.boundExpressionId)
            decided.add(entry.variableId)
        } else {
            if (!snapshotHasExpression(targetTo, decision.expressionId)) {
                throw new Error(
                    `Variable "${entry.variableId}" cannot be retargeted to expression "${decision.expressionId}", which is not in version ${toVersion}.`
                )
            }
            repoint.set(entry.variableId, decision.expressionId)
            decided.add(entry.variableId)
        }
    }
    for (const variableId of Object.keys(bindingDecisions)) {
        if (!needing.has(variableId)) {
            throw new Error(
                `Variable "${variableId}" needs no decision: it is not a changed or removed binding.`
            )
        }
    }

    // A keep or retarget must not leave two variables with one referent.
    const referents = new Map<string, string[]>()
    for (const variable of response.getVariables()) {
        if (!isExpressionBound(variable)) continue
        if (dropVariableIds.includes(variable.id)) continue
        const expressionId =
            repoint.get(variable.id) ?? variable.boundExpressionId
        const key = `${expressionId}|${variable.boundAspect}`
        referents.set(key, [...(referents.get(key) ?? []), variable.id])
    }
    for (const [key, ids] of referents) {
        if (ids.length < 2) continue
        const moved = ids.find((id) => decided.has(id))
        if (moved === undefined) continue
        const other = ids.find((id) => id !== moved)!
        const [expressionId, aspect] = key.split("|")
        throw new Error(
            `Variable "${moved}" would bind expression "${expressionId}" (${aspect}), which variable "${other}" already binds; drop one of them instead.`
        )
    }

    return {
        classification,
        repoint,
        dropPremiseIds,
        dropVariableIds,
    }
}

/**
 * The link faults `validateLinks` reports of severity `"error"`, each keyed
 * by its code, variable id and expression id, so that the faults before and
 * after a rebase can be compared.
 */
export function linkFaultKeys(
    response: ArgumentEngine,
    targetSnapshot: TArgumentEngineSnapshot
): Set<string> {
    return new Set(
        validateLinks(response, targetSnapshot)
            .violations.filter((violation) => violation.severity === "error")
            .map(
                (violation) =>
                    `${violation.code}|${violation.variableId ?? ""}|${violation.expressionId ?? ""}`
            )
    )
}

/**
 * Throws unless every expression-bound variable of the response is bound to
 * `targetTo` and names an expression present there, and `validateLinks`
 * against `targetTo` reports no fault that `faultsBefore` lacks.
 */
export function assertRebased(
    response: ArgumentEngine,
    targetTo: TArgumentEngineSnapshot,
    faultsBefore: ReadonlySet<string>
): void {
    for (const variable of response.getVariables()) {
        if (!isExpressionBound(variable)) continue
        if (
            variable.boundArgumentVersion !== targetTo.argument.version ||
            !snapshotHasExpression(targetTo, variable.boundExpressionId)
        ) {
            throw new Error(
                `After rebasing, variable "${variable.id}" does not resolve in version ${targetTo.argument.version} of "${targetTo.argument.id}".`
            )
        }
    }
    const added = [...linkFaultKeys(response, targetTo)].filter(
        (key) => !faultsBefore.has(key)
    )
    if (added.length > 0) {
        throw new Error(
            `Rebasing would leave new link faults: ${added
                .map((key) => {
                    const [code, variableId, expressionId] = key.split("|")
                    return `${code} on variable "${variableId}"${expressionId ? ` and expression "${expressionId}"` : ""}`
                })
                .join("; ")}.`
        )
    }
}
