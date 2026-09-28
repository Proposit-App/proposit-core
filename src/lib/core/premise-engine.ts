import {
    type TCoreArgument,
    type TCoreLogicalOperatorType,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TOptionalChecksum,
} from "../schemata/index.js"
import { DefaultMap } from "../utils/default-map.js"
import {
    midpoint,
    POSITION_INITIAL,
    POSITION_MAX,
    type TCorePositionConfig,
} from "../utils/position.js"
import { sortedCopyById, withoutUndefinedValues } from "../utils/collections.js"
import { HierarchicalChecksumCache } from "./checksum-cache.js"
import type {
    TCoreQuadrivalentValue,
    TCoreResolvedAssignment,
    TCorePremiseEvaluationResult,
    TCoreValidationResult,
} from "../types/evaluation.js"
import type { TCoreMutationResult, TCoreChangeset } from "../types/mutation.js"
import { composeChangesets, withCurrentEntries } from "../utils/changeset.js"
import type { TInvariantValidationResult } from "../types/validation.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import {
    defaultGenerateId,
    type TLogicEngineOptions,
} from "./argument-engine.js"
import {
    DEFAULT_CHECKSUM_CONFIG,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "../consts.js"
import { ChangeCollector } from "./change-collector.js"
import { computeHash, entityChecksum } from "./checksum.js"
import { InvariantViolationError } from "./invariant-violation-error.js"
import type {
    TExpressionInput,
    TExpressionManagerSnapshot,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./expression-manager.js"
import { ExpressionManager } from "./expression-manager.js"
import { isVariadicOperator } from "./expression-manager-checks.js"
import { VariableManager } from "./variable-manager.js"
import {
    collectDecidableOperators,
    collectSubtree,
    isDescendantOf,
    renderPremiseExpression,
    walkPremiseExpression,
} from "./premise/formula-tree.js"
import type { TPremiseReadContext } from "./premise/read-context.js"
import { validatePremiseEvaluability } from "./premise/evaluability.js"
import { evaluatePremise } from "./premise/evaluation.js"
import { validatePremiseInvariants } from "./premise/invariants.js"
import type {
    TExpressionMutations,
    TExpressionQueries,
    TVariableReferences,
    TPremiseClassification,
    TPremiseEvaluation,
    TPremiseLifecycle,
    TPremiseIdentity,
    TFormulaTreeVisitor,
    TFormulaTreeWalking,
    TDisplayable,
    THierarchicalChecksummable,
} from "./interfaces/index.js"

export type TPremiseEngineSnapshot<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = {
    premise: TOptionalChecksum<TPremise>
    rootExpressionId?: string
    expressions: TExpressionManagerSnapshot<TExpr>
    config?: TLogicEngineOptions
}

type TMutationFollowUp<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TPremise extends TCorePremise,
    TArg extends TCoreArgument,
> = {
    run(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> | undefined
}["run"]

export class PremiseEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>
    extends HierarchicalChecksumCache
    implements
        TExpressionMutations<TArg, TPremise, TExpr, TVar>,
        TExpressionQueries<TExpr>,
        TVariableReferences<TArg, TPremise, TExpr, TVar>,
        TPremiseClassification,
        TPremiseEvaluation,
        TPremiseLifecycle<TPremise, TExpr>,
        TPremiseIdentity<TArg, TPremise, TExpr, TVar>,
        TDisplayable,
        TFormulaTreeWalking,
        THierarchicalChecksummable<"expressions">
{
    protected premise: TOptionalChecksum<TPremise>
    protected rootExpressionId: string | undefined
    protected variables: VariableManager<TVar>
    protected expressions: ExpressionManager<TExpr>
    private expressionsByVariableId: DefaultMap<string, Set<string>>
    private argument: TOptionalChecksum<TArg>
    private checksumConfig?: TCoreChecksumConfig
    private expressionIndex?: Map<string, string>
    private generateId: () => string
    private onMutate?: () => void
    // Written as a method signature so TypeScript compares it bivariantly,
    // like the class's methods: a function-typed field would make
    // PremiseEngine invariant in its type parameters.
    private mutationFollowUp?: TMutationFollowUp<TExpr, TVar, TPremise, TArg>
    private circularityCheck?: (
        variableId: string,
        premiseId: string
    ) => boolean
    private emptyBoundPremiseCheck?: (variableId: string) => boolean
    private variableIdsCallback?: () => Set<string>
    private argumentValidateCallback?: () => TInvariantValidationResult
    private insideValidation = false

    constructor(
        premise: TOptionalChecksum<TPremise>,
        deps: {
            argument: TOptionalChecksum<TArg>
            variables: VariableManager<TVar>
            expressionIndex?: Map<string, string>
        },
        config?: TLogicEngineOptions
    ) {
        super()
        this.premise = { ...premise }
        this.argument = deps.argument
        this.checksumConfig = config?.checksumConfig
        this.rootExpressionId = undefined
        this.variables = deps.variables
        this.expressions = new ExpressionManager<TExpr>(config)
        this.expressionsByVariableId = new DefaultMap(() => new Set())
        this.expressionIndex = deps.expressionIndex
        this.generateId = config?.generateId ?? defaultGenerateId
    }

    /**
     * Returns the position config in effect for this premise engine.
     * Used by in-package helpers (notably the native AN-4 absorption
     * pass in `src/lib/grammar/an-rules.ts`) that need the position
     * range boundaries when computing target positions for absorbed
     * children.
     *
     * @internal
     */
    public getPositionConfig(): TCorePositionConfig {
        return this.expressions.getPositionConfig()
    }

    public setOnMutate(callback: (() => void) | undefined): void {
        this.onMutate = callback
    }

    /**
     * Sets what runs after each mutation, given the changeset the mutation
     * built. If it returns a changeset, the mutation returns that instead.
     * The owning `ArgumentEngine` uses it to run assistive normalization and
     * add what that changed.
     *
     * @internal
     */
    public setMutationFollowUp(
        callback: TMutationFollowUp<TExpr, TVar, TPremise, TArg> | undefined
    ): void {
        this.mutationFollowUp = callback
    }

    private followUp(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        return this.mutationFollowUp?.(changes) ?? changes
    }

    /** This premise's added and modified entries, at their current values. */
    private withCurrentOwnEntries(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        this.flushChecksums()
        return withCurrentEntries(
            changes,
            (id) => this.expressions.getExpression(id),
            (id) => (id === this.premise.id ? this.toPremiseData() : undefined)
        )
    }

    public setCircularityCheck(
        check: ((variableId: string, premiseId: string) => boolean) | undefined
    ): void {
        this.circularityCheck = check
    }

    public setEmptyBoundPremiseCheck(
        check: ((variableId: string) => boolean) | undefined
    ): void {
        this.emptyBoundPremiseCheck = check
    }

    public setVariableIdsCallback(
        callback: (() => Set<string>) | undefined
    ): void {
        this.variableIdsCallback = callback
    }

    public setArgumentValidateCallback(
        callback: (() => TInvariantValidationResult) | undefined
    ): void {
        this.argumentValidateCallback = callback
    }

    private premiseSnapshot() {
        const expressionIndexEntries: [string, string][] = []
        if (this.expressionIndex) {
            for (const [exprId, premiseId] of this.expressionIndex) {
                if (premiseId === this.premise.id) {
                    expressionIndexEntries.push([exprId, premiseId])
                }
            }
        }
        return {
            premiseData: { ...this.premise },
            rootExpressionId: this.rootExpressionId,
            expressionSnapshot: this.expressions.snapshot(),
            expressionIndexEntries,
        }
    }

    private restoreFromPremiseSnapshot(
        snap: ReturnType<PremiseEngine["premiseSnapshot"]>
    ): void {
        this.premise = snap.premiseData as TOptionalChecksum<TPremise>
        this.rootExpressionId = snap.rootExpressionId
        this.expressions = ExpressionManager.fromSnapshot<TExpr>(
            snap.expressionSnapshot as TExpressionManagerSnapshot<TExpr>
        )
        // Restore expression index entries
        if (this.expressionIndex) {
            for (const [exprId, premiseId] of [...this.expressionIndex]) {
                if (premiseId === this.premise.id) {
                    this.expressionIndex.delete(exprId)
                }
            }
            for (const [exprId, premiseId] of snap.expressionIndexEntries) {
                this.expressionIndex.set(exprId, premiseId)
            }
        }
        this.rebuildVariableIndex()
    }

    protected withValidation<T>(fn: () => T): T {
        if (this.insideValidation) {
            return fn()
        }
        const snap = this.premiseSnapshot()
        this.insideValidation = true
        try {
            const result = fn()
            const validation =
                this.argumentValidateCallback?.() ?? this.validate()
            if (!validation.ok) {
                this.restoreFromPremiseSnapshot(snap)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromPremiseSnapshot(snap)
            }
            throw e
        } finally {
            this.insideValidation = false
        }
    }

    /**
     * Wraps a single expression mutation: opens a ChangeCollector, binds it
     * to the ExpressionManager for the duration of `body`, then finalizes
     * (checksum flush + index sync + onMutate) and returns the standard
     * `{ result, changes }` shape. The whole thing runs inside
     * `withValidation`, so Structural violations roll back and throw while
     * higher-tier issues surface via `validate(tier)`.
     */
    private withExpressionMutation<TResult>(
        body: () => TResult
    ): TCoreMutationResult<TResult, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                const result = body()
                const changes = this.finalizeExpressionMutation(collector)
                return { result, changes }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const expressionIds = this.expressionsByVariableId.get(variableId)
            if (expressionIds.size === 0) {
                return { result: [], changes: {} }
            }

            // Suppress the notification and the follow-up during the loop;
            // both run once, for the whole deletion, at the end.
            const savedOnMutate = this.onMutate
            const savedFollowUp = this.mutationFollowUp
            this.onMutate = undefined
            this.mutationFollowUp = undefined
            try {
                // Copy the set since removeExpression mutates expressionsByVariableId
                const removed: TExpr[] = []
                let changes: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
                for (const exprId of [...expressionIds]) {
                    // The expression may already have been removed as part of a
                    // prior subtree deletion or operator collapse in this loop.
                    if (!this.expressions.getExpression(exprId)) continue

                    const removal = this.removeExpression(exprId, true)
                    if (removal.result) removed.push(removal.result)
                    // The whole changeset, not only its removals: removing an
                    // expression can also collapse an operator and move the
                    // surviving child.
                    changes = composeChangesets(changes, removal.changes)
                }
                changes = this.withCurrentOwnEntries(changes)
                this.syncExpressionIndex(changes)

                this.onMutate = savedOnMutate
                this.mutationFollowUp = savedFollowUp
                if (removed.length > 0) {
                    this.onMutate?.()
                    changes = this.followUp(changes)
                }

                return {
                    result: removed,
                    changes,
                }
            } catch (e) {
                this.onMutate = savedOnMutate
                this.mutationFollowUp = savedFollowUp
                throw e
            }
        })
    }

    public addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            if (expression.parentId === null) {
                if (this.rootExpressionId !== undefined) {
                    throw new Error(
                        `Premise "${this.premise.id}" already has a root expression.`
                    )
                }
                // S-14: derivation premise root must be one of variable,
                // implies, or iff. Enforced at mutation time regardless
                // of engine `behavior` — Structural rules throw in both
                // modes (spec §4).
                if (
                    (this.premise as TCorePremise).type === "derivation" &&
                    expression.type === "operator" &&
                    expression.operator !== "implies" &&
                    expression.operator !== "iff"
                ) {
                    throw new Error(
                        `S-14: derivation premise "${this.premise.id}" root must be variable, implies, or iff (got operator "${expression.operator}").`
                    )
                }
            } else {
                if (!this.expressions.getExpression(expression.parentId)) {
                    throw new Error(
                        `Parent expression "${expression.parentId}" does not exist in this premise.`
                    )
                }
            }

            this.expressions.addExpression(expression)
            if (expression.parentId === null) {
                this.rootExpressionId = expression.id
            }
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }

    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            if (parentId === null) {
                if (this.rootExpressionId !== undefined) {
                    throw new Error(
                        `Premise "${this.premise.id}" already has a root expression.`
                    )
                }
            } else {
                if (!this.expressions.getExpression(parentId)) {
                    throw new Error(
                        `Parent expression "${parentId}" does not exist in this premise.`
                    )
                }
            }

            this.expressions.appendExpression(parentId, expression)
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }

    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            if (!this.expressions.getExpression(siblingId)) {
                throw new Error(
                    `Expression "${siblingId}" not found in this premise.`
                )
            }

            this.expressions.addExpressionRelative(
                siblingId,
                relativePosition,
                expression
            )
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }

    public updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const existing = this.expressions.getExpression(expressionId)
            if (!existing) {
                throw new Error(
                    `Expression "${expressionId}" not found in premise "${this.premise.id}".`
                )
            }

            if (updates.variableId !== undefined) {
                if (!this.variables.hasVariable(updates.variableId)) {
                    throw new Error(
                        `Variable expression "${expressionId}" references non-existent variable "${updates.variableId}".`
                    )
                }
                // The circular binding check adding it runs, which a stored
                // engine also enforces on load.
                if (
                    existing.type === "variable" &&
                    this.circularityCheck?.(updates.variableId, this.premise.id)
                ) {
                    throw new Error(
                        `Circular binding: variable "${updates.variableId}" is bound to this premise (directly or transitively)`
                    )
                }
            }

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                const oldVariableId =
                    existing.type === "variable"
                        ? existing.variableId
                        : undefined

                const updated = this.expressions.updateExpression(
                    expressionId,
                    updates
                )

                if (
                    updates.variableId !== undefined &&
                    oldVariableId !== undefined &&
                    oldVariableId !== updates.variableId
                ) {
                    this.expressionsByVariableId
                        .get(oldVariableId)
                        ?.delete(expressionId)
                    this.expressionsByVariableId
                        .get(updates.variableId)
                        .add(expressionId)
                }

                const changeset = this.flushAndBuildChangeset(collector)
                this.syncExpressionIndex(changeset)
                if (changeset.expressions === undefined) {
                    return { result: updated, changes: changeset }
                }
                this.markDirty()
                this.onMutate?.()
                return {
                    result: updated,
                    changes: this.followUp(changeset),
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TCoreMutationResult<TExpr | undefined, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            // Snapshot the expression before removal (for result).
            const snapshot = this.expressions.getExpression(expressionId)

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                if (!snapshot) {
                    return {
                        result: undefined,
                        changes: collector.toChangeset(),
                    }
                }

                if (deleteSubtree) {
                    // Snapshot the subtree before deletion so we can clean up
                    // expressionsByVariableId for cascade-deleted descendants — they are
                    // not individually surfaced by ExpressionManager.removeExpression.
                    const subtree = collectSubtree(
                        this.expressions,
                        expressionId
                    )

                    this.expressions.removeExpression(expressionId, true)

                    for (const expr of subtree) {
                        if (expr.type === "variable") {
                            this.expressionsByVariableId
                                .get(expr.variableId)
                                ?.delete(expr.id)
                        }
                    }
                } else {
                    // Only clean up expressionsByVariableId for the removed
                    // expression itself — children survive promotion.
                    if (snapshot.type === "variable") {
                        this.expressionsByVariableId
                            .get(snapshot.variableId)
                            ?.delete(snapshot.id)
                    }

                    this.expressions.removeExpression(expressionId, false)
                }

                const changes = this.finalizeExpressionMutation(collector)
                return {
                    result: snapshot,
                    changes,
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            this.expressions.insertExpression(
                expression,
                leftNodeId,
                rightNodeId
            )
            this.indexVariableExpression(expression)
            return this.expressions.getExpression(expression.id)!
        })
    }

    public wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            this.assertBelongsToArgument(
                operator.argumentId,
                operator.argumentVersion
            )
            this.assertBelongsToArgument(
                newSibling.argumentId,
                newSibling.argumentVersion
            )
            this.assertVariableExpressionValid(newSibling)

            this.expressions.wrapExpression(
                operator,
                newSibling,
                leftNodeId,
                rightNodeId
            )
            this.indexVariableExpression(newSibling)
            return this.expressions.getExpression(operator.id)!
        })
    }

    /**
     * Reparent an existing expression onto a new parent at the given
     * position. Bundled-composite mutation per spec §8 — the parent
     * reference, position field, and checksum-dirty propagation update
     * atomically in a single call. No transient orphan state is
     * externally observable.
     *
     * Enforces Structural rules only (S-1 FK soundness, S-4 no-cycles,
     * entity-not-found, and S-9 logical sibling-position uniqueness at
     * the bundled-composite level — same-position collisions with the
     * moved expression's own prior slot are tolerated as transient,
     * since the move atomically frees that slot). Higher-tier violations
     * never throw here — Evaluable/Derivable/Presentable issues surface
     * through `validate(tier)` per spec §7.1.
     *
     * Used by the native AN-1 (formula-buffer insertion) and AN-4
     * (same-operator absorption) passes in `src/lib/grammar/an-rules.ts`,
     * and available to repair primitives and future composite ops that
     * need a public reparent surface (e.g. `removeOrphanOperators`).
     *
     * @throws If `expressionId` or `newParentId` does not exist in this
     *         premise.
     * @throws S-1: if `newParent` is not an `operator` or `formula` (a
     *         variable cannot be a parent — parity with `addExpression`
     *         at em.ts:418-422).
     * @throws S-1: arity — if reparenting would push `newParent`'s
     *         child count past its operator-specific limit (unary `not`
     *         max 1; binary `implies`/`iff` max 2). Same-parent moves
     *         leave count unchanged and bypass this check.
     * @throws S-4: if `newParentId === expressionId` or `newParentId` is
     *         a descendant of `expressionId`.
     * @throws S-9: if another sibling (NOT the expression being moved)
     *         already occupies `newPosition` under `newParentId`.
     *
     * @since 1.0.0
     */
    public reparentExpression(
        expressionId: string,
        newParentId: string,
        newPosition: number
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            const expression = this.expressions.getExpression(expressionId)
            if (!expression) {
                throw new Error(
                    `Expression "${expressionId}" not found in premise "${this.premise.id}".`
                )
            }
            const newParent = this.expressions.getExpression(newParentId)
            if (!newParent) {
                throw new Error(
                    `Parent expression "${newParentId}" not found in premise "${this.premise.id}".`
                )
            }

            // S-1 parent-type: only operators and formulas accept
            // children. Without this guard a caller could reparent under
            // a variable (or any other non-container) and produce a
            // malformed AST that no validator catches. Parity with
            // `addExpression` at em.ts:418-422.
            if (newParent.type !== "operator" && newParent.type !== "formula") {
                throw new Error(
                    `S-1: cannot reparent under non-operator/formula parent "${newParentId}" (type=${newParent.type}).`
                )
            }

            // S-4 no-cycles: newParent cannot be expressionId itself nor
            // a descendant of expressionId.
            if (newParentId === expressionId) {
                throw new Error(
                    `S-4: cannot reparent expression "${expressionId}" under itself.`
                )
            }
            if (isDescendantOf(this.expressions, newParentId, expressionId)) {
                throw new Error(
                    `S-4: cannot reparent expression "${expressionId}" under its descendant "${newParentId}" (would create a cycle).`
                )
            }

            // S-9 sibling-position uniqueness — only fires if a sibling
            // OTHER than the moved expression occupies the target slot.
            // Same-parent move with newPosition === expression.position
            // is a no-op-position case and tolerated.
            const isSameParentSamePosition =
                expression.parentId === newParentId &&
                expression.position === newPosition
            if (!isSameParentSamePosition) {
                const siblings =
                    this.expressions.getChildExpressions(newParentId)
                const collision = siblings.find(
                    (s) => s.id !== expressionId && s.position === newPosition
                )
                if (collision) {
                    throw new Error(
                        `S-9: position ${newPosition} is already occupied by sibling "${collision.id}" under parent "${newParentId}".`
                    )
                }
            }

            // S-1 arity: when source is moving OUT of one parent and
            // INTO `newParent`, the new parent's child count increases
            // by 1. Reuse `addExpression`'s `assertChildLimit` parity
            // (which only enforces caps for `not`/`implies`/`iff`).
            // Same-parent moves bypass: count is unchanged. Formula
            // parents enforce their 1-child cap separately.
            const isSameParent = expression.parentId === newParentId
            if (!isSameParent) {
                if (newParent.type === "operator") {
                    // assertChildLimit lives in EM — gate via the public
                    // reparent call's pre-check shape: replicate its
                    // logic here so we don't widen EM's surface.
                    const childCount =
                        this.expressions.getChildExpressions(newParentId).length
                    if (newParent.operator === "not" && childCount >= 1) {
                        throw new Error(
                            `Operator expression "${newParentId}" with "not" can only have one child.`
                        )
                    }
                    if (
                        (newParent.operator === "implies" ||
                            newParent.operator === "iff") &&
                        childCount >= 2
                    ) {
                        throw new Error(
                            `Operator expression "${newParentId}" with "${newParent.operator}" can only have two children.`
                        )
                    }
                } else if (newParent.type === "formula") {
                    const childCount =
                        this.expressions.getChildExpressions(newParentId).length
                    if (childCount >= 1) {
                        throw new Error(
                            `Formula expression "${newParentId}" can only have one child.`
                        )
                    }
                }
            }

            this.expressions.reparentExpression(
                expressionId,
                newParentId,
                newPosition
            )
            return this.expressions.getExpression(expressionId)!
        })
    }

    /**
     * Wrap an existing expression in a freshly-minted `formula` node
     * atomically. The formula takes the child's original parent slot
     * (parentId + position); the child becomes the formula's sole
     * child at position 0. Bundled-composite mutation per spec §8.
     *
     * Used by the native AN-1 (formula-buffer insertion) pass in
     * `src/lib/grammar/an-rules.ts`. Composing this from
     * `addExpression` + `reparentExpression` is not possible: the
     * intermediate state would either (a) violate S-9 with the child
     * still occupying the formula's target slot, or (b) trip the
     * parent's `assertChildLimit` (unary `not`, binary
     * `implies`/`iff`) even though the *net* child count of the parent
     * is unchanged after the wrap.
     *
     * The new formula's id is minted via the engine's `idGenerator`
     * accessor and returned in the mutation result. Argument fields
     * (`argumentId`, `argumentVersion`, `premiseId`) are inherited
     * from the source child.
     *
     * @throws If `childId` does not exist in this premise.
     * @throws If `childId` is at the root (no parent to insert a
     *         buffer beneath).
     * @throws S-10: if `formulaId` is already used by an existing
     *         expression in this premise (entity-ID uniqueness).
     *
     * @since 1.0.0
     */
    public wrapInFormula(
        childId: string,
        formulaId: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withExpressionMutation(() => {
            const child = this.expressions.getExpression(childId)
            if (!child) {
                throw new Error(
                    `Expression "${childId}" not found in premise "${this.premise.id}".`
                )
            }
            if (child.parentId === null) {
                throw new Error(
                    `Cannot wrap root expression "${childId}" in a formula — no parent operator above it.`
                )
            }

            this.expressions.wrapInFormula(childId, formulaId)
            return this.expressions.getExpression(formulaId)!
        })
    }

    // Normalization is reached via `engine.normalize(tier?)`, which
    // routes through the native AN-1..AN-4 passes in
    // `src/lib/grammar/an-rules.ts`; the post-mutation assistive hook
    // covers the per-mutation use case. There is no per-premise
    // `pe.normalizeExpressions()` wrapper and no legacy
    // `ExpressionManager.normalize()` 5-pass sweep.

    public toggleNegation(
        expressionId: string,
        extraFields?: Partial<TExpr>
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const target = this.expressions.getExpression(expressionId)
            if (!target) {
                throw new Error(
                    `Expression "${expressionId}" not found in this premise.`
                )
            }

            this.assertBelongsToArgument(
                target.argumentId,
                target.argumentVersion
            )

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                const parent = target.parentId
                    ? this.expressions.getExpression(target.parentId)
                    : undefined

                // Check for direct not parent: not(target)
                const isDirectNot =
                    parent?.type === "operator" && parent.operator === "not"

                // Check for formula-buffered not: not(formula(target))
                const grandparent =
                    parent?.type === "formula" && parent.parentId
                        ? this.expressions.getExpression(parent.parentId)
                        : undefined
                const isBufferedNot =
                    parent?.type === "formula" &&
                    grandparent?.type === "operator" &&
                    grandparent.operator === "not"

                if (isDirectNot || isBufferedNot) {
                    if (isBufferedNot) {
                        // Structure is not → formula → target.
                        // Remove just the not (promotes formula into its slot).
                        // The formula remains as a transparent wrapper.
                        this.expressions.removeExpression(grandparent.id, false)
                    } else {
                        // Remove the NOT operator, promoting target into its slot
                        this.expressions.removeExpression(parent.id, false)
                    }

                    const changes = this.finalizeExpressionMutation(collector)
                    return { result: null, changes }
                } else if (
                    target.type === "operator" &&
                    target.operator === "not"
                ) {
                    // Target is already NOT — toggling adds a second NOT and
                    // immediately collapses to the inner child. We express
                    // this directly by removing the existing NOT (promotes
                    // its child into its slot). The pre-v1.0 gate on
                    // `collapseDoubleNegation` is gone — `toggleNegation`
                    // unconditionally toggles.
                    this.expressions.removeExpression(expressionId, false)

                    const changes = this.finalizeExpressionMutation(collector)
                    return { result: null, changes }
                } else {
                    // The pre-v1.0 P-1 inline buffer-insertion branch
                    // (gated on `grammarConfig.enforceFormulaBetweenOperators`
                    // + `resolveAutoNormalize(_, 'negationInsertFormula')`,
                    // which built `NOT(formula(target))` inline) is gone.
                    // Always wrap with just NOT. AN-1 (post-mutation hook in
                    // assistive mode) inserts the formula buffer if the
                    // target is a non-not operator; permissive mode leaves
                    // the un-buffered state and `validate('presentable')`
                    // flags it.
                    const notExpr = {
                        ...extraFields,
                        id: this.generateId(),
                        argumentId: target.argumentId,
                        argumentVersion: target.argumentVersion,
                        premiseId: target.premiseId,
                        type: "operator",
                        operator: "not",
                        parentId: target.parentId,
                        position: target.position,
                    } as TExpressionInput<TExpr>

                    this.expressions.insertExpression(notExpr, expressionId)

                    const changes = this.finalizeExpressionMutation(collector)
                    return {
                        result: this.expressions.getExpression(notExpr.id)!,
                        changes,
                    }
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public changeOperator(
        expressionId: string,
        newOperator: TCoreLogicalOperatorType,
        sourceChildId?: string,
        targetChildId?: string,
        extraFields?: Partial<TExpr>
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const target = this.expressions.getExpression(expressionId)
            if (!target) {
                throw new Error(
                    `Expression "${expressionId}" not found in this premise.`
                )
            }
            if (target.type !== "operator") {
                throw new Error(
                    `Expression "${expressionId}" is not an operator expression (type: "${target.type}").`
                )
            }
            if (target.type === "operator" && target.operator === "not") {
                throw new Error(
                    `Cannot change a "not" operator. Use toggleNegation instead.`
                )
            }

            this.assertBelongsToArgument(
                target.argumentId,
                target.argumentVersion
            )

            // No-op: already the requested operator
            if (target.type === "operator" && target.operator === newOperator) {
                return { result: target, changes: {} }
            }

            const children = this.expressions.getChildExpressions(expressionId)
            const childCount = children.length

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                // Any number of operands suits every variadic operator, so
                // with no children named for a split the type changes in
                // place, keeping the children where they are.
                const swapInPlace =
                    sourceChildId === undefined &&
                    targetChildId === undefined &&
                    isVariadicOperator(newOperator)
                if (childCount <= 2 || swapInPlace) {
                    // Check for merge condition: parent is same type as newOperator.
                    // Only merge when childCount < 2 (degenerate operator). With
                    // 2 or more children the operator is well-formed — just
                    // change the type in place.
                    const parent = target.parentId
                        ? this.expressions.getExpression(target.parentId)
                        : undefined
                    let mergeTarget: TExpr | undefined
                    if (childCount < 2) {
                        // Look through formula buffer: if parent is formula, check grandparent
                        if (parent?.type === "formula" && parent.parentId) {
                            const grandparent = this.expressions.getExpression(
                                parent.parentId
                            )
                            if (
                                grandparent?.type === "operator" &&
                                grandparent.operator === newOperator
                            ) {
                                mergeTarget = grandparent
                            }
                        } else if (
                            parent?.type === "operator" &&
                            parent.operator === newOperator
                        ) {
                            mergeTarget = parent
                        }
                    }

                    if (mergeTarget) {
                        // --- MERGE ---
                        // Reparent children of the dissolving operator under the merge target.
                        // Use the dissolving operator's position slot for the first child,
                        // compute midpoint positions for subsequent children.

                        // If parent was a formula buffer, we'll dissolve that too
                        const formulaToDissolve =
                            parent?.type === "formula" ? parent : undefined

                        // The position slot we're replacing
                        const slotPosition = formulaToDissolve
                            ? formulaToDissolve.position
                            : target.position

                        // Get the merge target's existing children sorted by position to find neighbors
                        const mergeChildren =
                            this.expressions.getChildExpressions(mergeTarget.id)

                        // Find the position of the next sibling after the slot
                        const slotIndex = mergeChildren.findIndex(
                            (c) =>
                                c.id === (formulaToDissolve?.id ?? expressionId)
                        )
                        const nextSibling = mergeChildren[slotIndex + 1]
                        const nextPosition = nextSibling
                            ? nextSibling.position
                            : POSITION_MAX

                        // Reparent each child
                        for (let i = 0; i < children.length; i++) {
                            const childPosition =
                                i === 0
                                    ? slotPosition
                                    : midpoint(
                                          i === 1
                                              ? slotPosition
                                              : children[i - 1].position,
                                          nextPosition
                                      )
                            this.expressions.reparentExpression(
                                children[i].id,
                                mergeTarget.id,
                                childPosition
                            )
                        }

                        // Delete the dissolving operator (now has no children)
                        this.expressions.deleteExpression(expressionId)

                        // Delete the formula buffer if it existed (now has no children)
                        if (formulaToDissolve) {
                            this.expressions.deleteExpression(
                                formulaToDissolve.id
                            )
                        }

                        const changes =
                            this.finalizeExpressionMutation(collector)
                        return { result: null, changes }
                    } else {
                        // --- SIMPLE CHANGE ---
                        this.expressions.changeOperatorType(
                            expressionId,
                            newOperator
                        )

                        const changes =
                            this.finalizeExpressionMutation(collector)
                        // Normalization runs inside finalize and may have
                        // absorbed the node into a same-operator
                        // grandparent; that reads as a dissolve, like a
                        // merge.
                        return {
                            result:
                                this.expressions.getExpression(expressionId) ??
                                null,
                            changes,
                        }
                    }
                } else {
                    // --- SPLIT (>2 children, not swapped in place) ---
                    if (!sourceChildId || !targetChildId) {
                        throw new Error(
                            `Operator "${expressionId}" has ${childCount} children — sourceChildId and targetChildId are required for split.`
                        )
                    }

                    // Validate source and target are children of the operator
                    const sourceChild =
                        this.expressions.getExpression(sourceChildId)
                    const targetChild =
                        this.expressions.getExpression(targetChildId)
                    if (!sourceChild || sourceChild.parentId !== expressionId) {
                        throw new Error(
                            `Expression "${sourceChildId}" is not a child of operator "${expressionId}".`
                        )
                    }
                    if (!targetChild || targetChild.parentId !== expressionId) {
                        throw new Error(
                            `Expression "${targetChildId}" is not a child of operator "${expressionId}".`
                        )
                    }

                    // Determine position for the formula buffer (min of the two children)
                    const formulaPosition = Math.min(
                        sourceChild.position,
                        targetChild.position
                    )

                    // Create the sub-operator and formula first as detached nodes,
                    // then reparent children away from the parent (freeing their
                    // position slots), and finally add formula + sub-operator.
                    const formulaId = this.generateId()
                    const newOpId = this.generateId()

                    // Reparent source and target children to a temporary holding
                    // position under the new sub-operator. We must reparent them
                    // away from the parent BEFORE adding the formula at their old
                    // position slot.
                    const firstChild =
                        sourceChild.position <= targetChild.position
                            ? sourceChild
                            : targetChild
                    const secondChild =
                        sourceChild.position <= targetChild.position
                            ? targetChild
                            : sourceChild

                    // Reparent children to null temporarily (detach from parent)
                    // so their position slots are freed.
                    this.expressions.reparentExpression(
                        firstChild.id,
                        null,
                        firstChild.position
                    )
                    this.expressions.reparentExpression(
                        secondChild.id,
                        null,
                        secondChild.position
                    )

                    // Now add the formula buffer at the freed position
                    const formulaExpr = {
                        ...extraFields,
                        id: formulaId,
                        argumentId: target.argumentId,
                        argumentVersion: target.argumentVersion,
                        premiseId: target.premiseId,
                        type: "formula",
                        parentId: expressionId,
                        position: formulaPosition,
                    } as TExpressionInput<TExpr>
                    this.expressions.addExpression(formulaExpr)

                    // Add the new sub-operator under the formula
                    const newOpExpr = {
                        ...extraFields,
                        id: newOpId,
                        argumentId: target.argumentId,
                        argumentVersion: target.argumentVersion,
                        premiseId: target.premiseId,
                        type: "operator",
                        operator: newOperator,
                        parentId: formulaId,
                        position: POSITION_INITIAL,
                    } as TExpressionInput<TExpr>
                    this.expressions.addExpression(newOpExpr)

                    // Now reparent the children under the new sub-operator,
                    // using the midpoint-spaced pattern so future inserts
                    // can bisect. As of core 1.0.2 S-8 is arity-only, so
                    // the same spacing applies uniformly to all binary
                    // operators.
                    this.expressions.reparentExpression(
                        firstChild.id,
                        newOpId,
                        POSITION_INITIAL
                    )
                    this.expressions.reparentExpression(
                        secondChild.id,
                        newOpId,
                        midpoint(POSITION_INITIAL, POSITION_MAX)
                    )

                    const changes = this.finalizeExpressionMutation(collector)
                    return {
                        result: this.expressions.getExpression(newOpId)!,
                        changes,
                    }
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public getExpression(id: string): TExpr | undefined {
        return this.expressions.getExpression(id)
    }

    /**
     * Internal helper: mutates an expression in place and marks it dirty.
     * Used by `ArgumentEngine.patchExpressionAppFields` to implement the
     * atomic patch-and-mark contract without reaching into internals from
     * outside the engine.
     *
     * @internal
     */
    patchAndMarkExpression(expressionId: string, fields: Partial<TExpr>): void {
        const expr = this.expressions.getExpression(expressionId)
        if (expr) {
            // An `undefined` value deletes the key rather than assigning it.
            // `Object.assign` would leave the key present holding `undefined`,
            // which is checksum-safe and JSON-safe on its own but makes
            // `"field" in entity` true — and any downstream mapper that turns
            // `undefined` into `null` then flips a field from absent to
            // present, changing the entity's checksum. Clearing a field has to
            // restore the shape it had before it was set.
            const target = expr as Record<string, unknown>
            for (const [key, value] of Object.entries(fields)) {
                if (value === undefined) delete target[key]
                else target[key] = value
            }
        }
        this.expressions.markExpressionDirty(expressionId)
        this.markDirty()
    }

    public getId(): string {
        return this.premise.id
    }

    public getExtras(): Record<string, unknown> {
        const {
            id: _id,
            argumentId: _argumentId,
            argumentVersion: _argumentVersion,
            checksum: _checksum,
            descendantChecksum: _descendantChecksum,
            combinedChecksum: _combinedChecksum,
            type: _type,
            derivedClaimId: _derivedClaimId,
            ...extras
        } = this.premise as Record<string, unknown>
        return { ...extras }
    }

    public setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.withValidation(() => {
            // Strip old extras and replace with new ones, preserving structural fields.
            const {
                id,
                argumentId,
                argumentVersion,
                checksum,
                descendantChecksum,
                combinedChecksum,
                type,
                derivedClaimId,
            } = this.premise as Record<string, unknown>
            // Clearing a field means removing its key, not assigning
            // `undefined` — see `withoutUndefinedValues`. `updateExtras`
            // spreads its updates in, so this is the single place that has to
            // enforce it for every premise-level caller.
            this.premise = {
                ...withoutUndefinedValues(extras),
                id,
                argumentId,
                argumentVersion,
                type,
                ...(derivedClaimId !== undefined ? { derivedClaimId } : {}),
                ...(checksum !== undefined ? { checksum } : {}),
                ...(descendantChecksum !== undefined
                    ? { descendantChecksum }
                    : {}),
                ...(combinedChecksum !== undefined ? { combinedChecksum } : {}),
            } as TOptionalChecksum<TPremise>
            this.markDirty()

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.flushChecksums()
            collector.modifiedPremise(this.toPremiseData())

            this.onMutate?.()
            return {
                result: this.getExtras(),
                changes: this.followUp(collector.toChangeset()),
            }
        })
    }

    public updateExtras(
        updates: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.setExtras({ ...this.getExtras(), ...updates })
    }

    public getRootExpressionId(): string | undefined {
        return this.rootExpressionId
    }

    public getRootExpression(): TExpr | undefined {
        if (this.rootExpressionId === undefined) {
            return undefined
        }
        return this.expressions.getExpression(this.rootExpressionId)
    }

    public getVariables(): TVar[] {
        return sortedCopyById(this.variables.toArray())
    }

    public getExpressions(): TExpr[] {
        return sortedCopyById(this.expressions.toArray())
    }

    public getChildExpressions(parentId: string | null): TExpr[] {
        return this.expressions.getChildExpressions(parentId)
    }

    public getPremiseType(): string {
        return this.premise.type
    }

    public isInference(): boolean {
        const root = this.getRootExpression()
        return (
            root?.type === "operator" &&
            (root.operator === "implies" || root.operator === "iff")
        )
    }

    public isConstraint(): boolean {
        return !this.isInference()
    }

    public validateEvaluability(): TCoreValidationResult {
        return validatePremiseEvaluability(this.asReadContext())
    }

    public evaluate(
        assignment: TCoreResolvedAssignment,
        options?: {
            strictUnknownKeys?: boolean
            requireExactCoverage?: boolean
            resolver?: (variableId: string) => TCoreQuadrivalentValue
        }
    ): TCorePremiseEvaluationResult {
        const validation = this.validateEvaluability()
        if (!validation.ok) {
            throw new Error(
                `Premise "${this.premise.id}" is not evaluable: ${validation.issues
                    .map((issue) => issue.code)
                    .join(", ")}`
            )
        }

        return evaluatePremise(
            this.asReadContext(),
            assignment,
            () => this.isInference(),
            options
        )
    }

    public toDisplayString(): string {
        if (this.rootExpressionId === undefined) {
            return ""
        }
        return renderPremiseExpression(
            this.asReadContext(),
            this.rootExpressionId
        )
    }

    public walkFormulaTree<T>(visitor: TFormulaTreeVisitor<T>): T {
        if (this.rootExpressionId === undefined) {
            return visitor.empty()
        }
        return walkPremiseExpression(
            this.asReadContext(),
            visitor,
            this.rootExpressionId
        )
    }

    public getDecidableOperatorExpressions(): TExpr[] {
        return collectDecidableOperators(
            this.expressions,
            this.rootExpressionId
        )
    }

    public getReferencedVariableIds(): Set<string> {
        const ids = new Set<string>()
        for (const expr of this.expressions.toArray()) {
            if (expr.type === "variable") {
                ids.add(expr.variableId)
            }
        }
        return ids
    }

    public toPremiseData(): TPremise {
        this.flushChecksums()
        return {
            ...this.premise,
            checksum: this.cachedMetaChecksum!,
            descendantChecksum: this.cachedDescendantChecksum!,
            combinedChecksum: this.cachedCombinedChecksum!,
        } as TPremise
    }

    public getCollectionChecksum(_name: "expressions"): string | null {
        return this.descendantChecksum()
    }

    public flushChecksums(): void {
        this.expressions.flushExpressionChecksums()

        const premiseFields =
            this.checksumConfig?.premiseFields ??
            DEFAULT_CHECKSUM_CONFIG.premiseFields!
        this.cachedMetaChecksum = entityChecksum(
            this.premise as unknown as Record<string, unknown>,
            premiseFields
        )

        const rootId = this.rootExpressionId
        if (rootId) {
            const rootExpr = this.expressions.getExpression(rootId)
            this.cachedDescendantChecksum = rootExpr
                ? rootExpr.combinedChecksum
                : null
        } else {
            this.cachedDescendantChecksum = null
        }

        this.cachedCombinedChecksum =
            this.cachedDescendantChecksum === null
                ? this.cachedMetaChecksum
                : computeHash(
                      this.cachedMetaChecksum + this.cachedDescendantChecksum
                  )

        this.checksumDirty = false
    }

    public validate(): TInvariantValidationResult {
        // Flushes checksums before the expression checks read them.
        const premiseData = this.toPremiseData()
        return validatePremiseInvariants(this.asReadContext(), premiseData)
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Loads expressions in BFS order with the nesting check bypassed.
     * Bypasses all PremiseEngine validation (ownership, variable existence, circularity)
     * since restoration paths trust existing data completely.
     */
    public loadExpressions(expressions: TExpressionInput<TExpr>[]): void {
        this.expressions.loadExpressions(expressions)

        // Rebuild root and variable tracking after bulk load.
        for (const expr of this.expressions.toArray()) {
            if (expr.parentId === null) {
                this.rootExpressionId = expr.id
            }
            if (expr.type === "variable") {
                this.expressionsByVariableId.get(expr.variableId).add(expr.id)
            }
            if (this.expressionIndex) {
                this.expressionIndex.set(expr.id, this.premise.id)
            }
        }
        this.markDirty()
    }

    public markDirty(): void {
        this.checksumDirty = true
    }

    /**
     * The state the read-only routines under `premise/` consult, as a plain
     * object built per call — accessor properties on it cost the
     * satisfiability search, which evaluates once per row, about an eighth of
     * its time. The callbacks go through wrappers that look the engine's
     * field up on every call, as the methods did, so one replaced mid-call is
     * honoured and each runs with the engine as `this`. `argument` is the
     * engine's own object, never replaced. The premise id, root and managers
     * are read once per call; nothing this library calls changes them.
     */
    private asReadContext(): TPremiseReadContext<TExpr, TVar> {
        return {
            premiseId: this.premise.id,
            argument: this.argument,
            rootExpressionId: this.rootExpressionId,
            expressions: this.expressions,
            variables: this.variables,
            emptyBoundPremiseCheck: this.readEmptyBoundPremiseCheck,
            readVariableIds: this.readVariableIds,
        }
    }

    private readonly readEmptyBoundPremiseCheck = (
        variableId: string
    ): boolean | undefined => this.emptyBoundPremiseCheck?.(variableId)

    private readonly readVariableIds = (): Set<string> | undefined =>
        this.variableIdsCallback?.()

    /**
     * Re-reads the single root from ExpressionManager after any operation
     * that may have caused operator collapse to silently change the root.
     */
    private syncRootExpressionId(): void {
        const roots = this.expressions.getChildExpressions(null)
        this.rootExpressionId = roots[0]?.id
    }

    private assertBelongsToArgument(
        argumentId: string,
        argumentVersion: number
    ): void {
        if (argumentId !== this.argument.id) {
            throw new Error(
                `Entity argumentId "${argumentId}" does not match engine argument ID "${this.argument.id}".`
            )
        }
        if (argumentVersion !== this.argument.version) {
            throw new Error(
                `Entity argumentVersion "${argumentVersion}" does not match engine argument version "${this.argument.version}".`
            )
        }
    }

    private assertVariableExpressionValid(
        expression: TExpressionInput<TExpr> | TExpressionWithoutPosition<TExpr>
    ): void {
        if (
            expression.type === "variable" &&
            !this.variables.hasVariable(expression.variableId)
        ) {
            throw new Error(
                `Variable expression "${expression.id}" references non-existent variable "${expression.variableId}".`
            )
        }

        if (expression.type === "variable" && this.circularityCheck) {
            if (this.circularityCheck(expression.variableId, this.premise.id)) {
                throw new Error(
                    `Circular binding: variable "${expression.variableId}" is bound to this premise (directly or transitively)`
                )
            }
        }
    }

    public snapshot(): TPremiseEngineSnapshot<TPremise, TExpr> {
        this.flushChecksums()
        const exprSnapshot = this.expressions.snapshot()
        return {
            premise: {
                ...this.premise,
                checksum: this.cachedMetaChecksum!,
                descendantChecksum: this.cachedDescendantChecksum!,
                combinedChecksum: this.cachedCombinedChecksum!,
            },
            rootExpressionId: this.rootExpressionId,
            expressions: exprSnapshot,
            config: {
                ...exprSnapshot.config,
                checksumConfig: serializeChecksumConfig(this.checksumConfig),
            } as TLogicEngineOptions,
        }
    }

    /** Creates a new PremiseEngine from a previously captured snapshot. */
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    >(
        snapshot: TPremiseEngineSnapshot<TPremise, TExpr>,
        argument: TOptionalChecksum<TArg>,
        variables: VariableManager<TVar>,
        expressionIndex?: Map<string, string>,
        generateId?: () => string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> {
        // Normalize checksumConfig in case the snapshot went through a JSON
        // round-trip that converted Sets to arrays or empty objects.
        const normalizedConfig: TLogicEngineOptions | undefined =
            snapshot.config
                ? {
                      ...snapshot.config,
                      checksumConfig: normalizeChecksumConfig(
                          snapshot.config.checksumConfig
                      ),
                      generateId: generateId ?? snapshot.config.generateId,
                  }
                : generateId
                  ? { generateId }
                  : snapshot.config
        const pe = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
            snapshot.premise,
            { argument, variables, expressionIndex },
            normalizedConfig
        )
        // Restore expressions from the snapshot
        pe.expressions = ExpressionManager.fromSnapshot<TExpr>(
            snapshot.expressions,
            generateId
        )
        // Restore rootExpressionId from snapshot
        pe.rootExpressionId = snapshot.rootExpressionId
        // Rebuild the expressionsByVariableId index
        pe.rebuildVariableIndex()
        // Populate the shared expression index if provided
        if (expressionIndex) {
            for (const expr of pe.expressions.toArray()) {
                expressionIndex.set(expr.id, pe.getId())
            }
        }
        return pe
    }

    /**
     * Flushes hierarchical expression checksums and rebuilds the changeset
     * so that added/modified expressions carry correct `descendantChecksum`
     * and `combinedChecksum` values (rather than the stale ones captured
     * at mutation time by the ChangeCollector).
     */
    private finalizeExpressionMutation(
        collector: ChangeCollector<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        this.syncRootExpressionId()
        this.markDirty()
        const changes = this.flushAndBuildChangeset(collector)
        this.syncExpressionIndex(changes)
        this.onMutate?.()
        return this.followUp(changes)
    }

    private flushAndBuildChangeset(
        collector: ChangeCollector<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        // Snapshot premise combinedChecksum before flush
        const premiseCombinedBefore = this.cachedCombinedChecksum ?? null

        this.expressions.flushExpressionChecksums()
        const changes = withCurrentEntries(
            collector.toChangeset(),
            (id) => this.expressions.getExpression(id),
            () => undefined
        )

        // Recompute premise checksum and include if changed
        this.flushChecksums()
        if (this.cachedCombinedChecksum !== premiseCombinedBefore) {
            changes.premises ??= { added: [], modified: [], removed: [] }
            changes.premises.modified.push(this.toPremiseData())
        }

        return changes
    }

    private syncExpressionIndex(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): void {
        if (!this.expressionIndex || !changes.expressions) return
        for (const expr of changes.expressions.added) {
            this.expressionIndex.set(expr.id, this.premise.id)
        }
        for (const expr of changes.expressions.removed) {
            this.expressionIndex.delete(expr.id)
        }
    }

    /**
     * Records a newly-added variable expression in the by-variable index.
     * No-op for non-variable expressions. Mirrors the per-variable entry
     * that `rebuildVariableIndex` produces on bulk load.
     */
    private indexVariableExpression(
        expression: TExpressionInput<TExpr> | TExpressionWithoutPosition<TExpr>
    ): void {
        if (expression.type === "variable") {
            this.expressionsByVariableId
                .get(expression.variableId)
                .add(expression.id)
        }
    }

    private rebuildVariableIndex(): void {
        this.expressionsByVariableId = new DefaultMap(() => new Set())
        for (const expr of this.expressions.toArray()) {
            if (expr.type === "variable") {
                this.expressionsByVariableId.get(expr.variableId).add(expr.id)
            }
        }
    }
}
