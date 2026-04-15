import {
    CorePremiseSchema,
    isExternallyBound,
    isPremiseBound,
    type TCoreArgument,
    type TCoreLogicalOperatorType,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePropositionalVariableExpression,
    type TOptionalChecksum,
} from "../schemata/index.js"
import { DefaultMap } from "../utils/default-map.js"
import { midpoint, POSITION_INITIAL, POSITION_MAX } from "../utils/position.js"
import { sortedCopyById, sortedUnique } from "../utils/collections.js"
import type {
    TCoreExpressionAssignment,
    TCorePremiseEvaluationResult,
    TCorePremiseInferenceDiagnostic,
    TCoreTrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../types/evaluation.js"
import type { TCoreMutationResult, TCoreChangeset } from "../types/mutation.js"
import {
    kleeneAnd,
    kleeneIff,
    kleeneImplies,
    kleeneNot,
    kleeneOr,
} from "./evaluation/kleene.js"
import {
    buildDirectionalVacuity,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"
import { Value } from "typebox/value"
import type {
    TInvariantViolation,
    TInvariantValidationResult,
} from "../types/validation.js"
import {
    PREMISE_SCHEMA_INVALID,
    PREMISE_ROOT_EXPRESSION_INVALID,
    PREMISE_VARIABLE_REF_NOT_FOUND,
} from "../types/validation.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import {
    defaultGenerateId,
    type TLogicEngineOptions,
} from "./argument-engine.js"
import {
    DEFAULT_GRAMMAR_CONFIG,
    resolveAutoNormalize,
    type TGrammarConfig,
} from "../types/grammar.js"
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
import { VariableManager } from "./variable-manager.js"
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

export class PremiseEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>
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
    private premise: TOptionalChecksum<TPremise>
    private rootExpressionId: string | undefined
    private variables: VariableManager<TVar>
    private expressions: ExpressionManager<TExpr>
    private expressionsByVariableId: DefaultMap<string, Set<string>>
    private argument: TOptionalChecksum<TArg>
    private checksumConfig?: TCoreChecksumConfig
    private grammarConfig: TGrammarConfig
    private checksumDirty = true
    private cachedMetaChecksum: string | undefined
    private cachedDescendantChecksum: string | null | undefined
    private cachedCombinedChecksum: string | undefined
    private expressionIndex?: Map<string, string>
    private generateId: () => string
    private onMutate?: () => void
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
        this.premise = { ...premise }
        this.argument = deps.argument
        this.checksumConfig = config?.checksumConfig
        this.grammarConfig = config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
        this.rootExpressionId = undefined
        this.variables = deps.variables
        this.expressions = new ExpressionManager<TExpr>(config)
        this.expressionsByVariableId = new DefaultMap(() => new Set())
        this.expressionIndex = deps.expressionIndex
        this.generateId = config?.generateId ?? defaultGenerateId
    }

    /**
     * Overrides the grammar config for both this premise engine and its
     * internal expression manager. Used by restoration paths when the
     * caller's grammar config should override the snapshot's config.
     */
    public setGrammarConfig(grammarConfig: TGrammarConfig): void {
        this.grammarConfig = grammarConfig
        this.expressions.setGrammarConfig(grammarConfig)
    }

    public setOnMutate(callback: (() => void) | undefined): void {
        this.onMutate = callback
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

    public deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const expressionIds = this.expressionsByVariableId.get(variableId)
            if (expressionIds.size === 0) {
                return { result: [], changes: {} }
            }

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()

            // Suppress onMutate during the loop to avoid redundant notifications
            const savedOnMutate = this.onMutate
            this.onMutate = undefined
            try {
                // Copy the set since removeExpression mutates expressionsByVariableId
                const removed: TExpr[] = []
                for (const exprId of [...expressionIds]) {
                    // The expression may already have been removed as part of a
                    // prior subtree deletion or operator collapse in this loop.
                    if (!this.expressions.getExpression(exprId)) continue

                    const { result, changes } = this.removeExpression(
                        exprId,
                        true
                    )
                    if (result) removed.push(result)
                    if (changes.expressions) {
                        for (const e of changes.expressions.removed) {
                            collector.removedExpression(e)
                        }
                    }
                }

                // Expressions in the collector already have checksums attached
                // (from ExpressionManager which stores expressions with checksums).
                const changes = collector.toChangeset()
                this.syncExpressionIndex(changes)

                // Restore and fire once if something was removed
                this.onMutate = savedOnMutate
                if (removed.length > 0) {
                    this.onMutate?.()
                }

                return {
                    result: removed,
                    changes,
                }
            } catch (e) {
                this.onMutate = savedOnMutate
                throw e
            }
        })
    }

    public addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
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
            } else {
                if (!this.expressions.getExpression(expression.parentId)) {
                    throw new Error(
                        `Parent expression "${expression.parentId}" does not exist in this premise.`
                    )
                }
            }

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                // Delegate structural validation (operator type checks, position
                // uniqueness, child limits) to ExpressionManager.
                this.expressions.addExpression(expression)

                if (expression.parentId === null) {
                    this.rootExpressionId = expression.id
                }
                if (expression.type === "variable") {
                    this.expressionsByVariableId
                        .get(expression.variableId)
                        .add(expression.id)
                }

                const changes = this.finalizeExpressionMutation(collector)
                return {
                    result: this.expressions.getExpression(expression.id)!,
                    changes,
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
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

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                this.expressions.appendExpression(parentId, expression)

                if (expression.type === "variable") {
                    this.expressionsByVariableId
                        .get(expression.variableId)
                        .add(expression.id)
                }

                const changes = this.finalizeExpressionMutation(collector)
                return {
                    result: this.expressions.getExpression(expression.id)!,
                    changes,
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
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

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                this.expressions.addExpressionRelative(
                    siblingId,
                    relativePosition,
                    expression
                )

                if (expression.type === "variable") {
                    this.expressionsByVariableId
                        .get(expression.variableId)
                        .add(expression.id)
                }

                const changes = this.finalizeExpressionMutation(collector)
                return {
                    result: this.expressions.getExpression(expression.id)!,
                    changes,
                }
            } finally {
                this.expressions.setCollector(null)
            }
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
                if (changeset.expressions !== undefined) {
                    this.markDirty()
                    this.onMutate?.()
                }

                this.syncExpressionIndex(changeset)
                return {
                    result: updated,
                    changes: changeset,
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
                    const subtree = this.collectSubtree(expressionId)

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
        return this.withValidation(() => {
            this.assertBelongsToArgument(
                expression.argumentId,
                expression.argumentVersion
            )
            this.assertVariableExpressionValid(expression)

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                this.expressions.insertExpression(
                    expression,
                    leftNodeId,
                    rightNodeId
                )

                if (expression.type === "variable") {
                    this.expressionsByVariableId
                        .get(expression.variableId)
                        .add(expression.id)
                }

                const changes = this.finalizeExpressionMutation(collector)
                return {
                    result: this.expressions.getExpression(expression.id)!,
                    changes,
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    public wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            this.assertBelongsToArgument(
                operator.argumentId,
                operator.argumentVersion
            )
            this.assertBelongsToArgument(
                newSibling.argumentId,
                newSibling.argumentVersion
            )
            this.assertVariableExpressionValid(newSibling)

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                this.expressions.wrapExpression(
                    operator,
                    newSibling,
                    leftNodeId,
                    rightNodeId
                )

                if (newSibling.type === "variable") {
                    this.expressionsByVariableId
                        .get(newSibling.variableId)
                        .add(newSibling.id)
                }

                const changes = this.finalizeExpressionMutation(collector)
                return {
                    result: this.expressions.getExpression(operator.id)!,
                    changes,
                }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

    /**
     * Performs a full normalization sweep on this premise's expression tree.
     * Collapses unjustified formulas, operators with 0/1 children, and inserts
     * formula buffers where needed. Works regardless of `autoNormalize` setting.
     */
    public normalizeExpressions(): TCoreMutationResult<
        void,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.withValidation(() => {
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.expressions.setCollector(collector)
            try {
                this.expressions.normalize()
                const changes = this.finalizeExpressionMutation(collector)
                return { result: undefined, changes }
            } finally {
                this.expressions.setCollector(null)
            }
        })
    }

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
                    target.operator === "not" &&
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "collapseDoubleNegation"
                    )
                ) {
                    // Target is already NOT — wrapping would create NOT(NOT(x)).
                    // Collapse instead: remove the existing NOT, promoting its child.
                    this.expressions.removeExpression(expressionId, false)

                    const changes = this.finalizeExpressionMutation(collector)
                    return { result: null, changes }
                } else {
                    // When the target is a non-not operator, a formula buffer
                    // is needed between the new NOT and the target to satisfy
                    // the operator nesting restriction.
                    const needsFormula =
                        this.grammarConfig.enforceFormulaBetweenOperators &&
                        target.type === "operator" &&
                        target.operator !== "not"

                    let notExprId: string

                    if (needsFormula) {
                        if (
                            !resolveAutoNormalize(
                                this.grammarConfig,
                                "negationInsertFormula"
                            )
                        ) {
                            throw new Error(
                                `Cannot negate operator expression "${expressionId}" — would place a non-not operator as a direct child of NOT. Enable negationInsertFormula or wrap in a formula node first.`
                            )
                        }
                        // Build not → formula → target
                        const formulaExpr = {
                            ...extraFields,
                            id: this.generateId(),
                            argumentId: target.argumentId,
                            argumentVersion: target.argumentVersion,
                            premiseId: target.premiseId,
                            type: "formula",
                            parentId: target.parentId,
                            position: target.position,
                        } as TExpressionInput<TExpr>
                        this.expressions.insertExpression(
                            formulaExpr,
                            expressionId
                        )

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
                        this.expressions.insertExpression(
                            notExpr,
                            formulaExpr.id
                        )
                        notExprId = notExpr.id
                    } else {
                        // Wrap target with a new NOT operator
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
                        notExprId = notExpr.id
                    }

                    const changes = this.finalizeExpressionMutation(collector)
                    return {
                        result: this.expressions.getExpression(notExprId)!,
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
                if (childCount <= 2) {
                    // Check for merge condition: parent is same type as newOperator.
                    // Only merge when childCount < 2 (degenerate operator). With
                    // exactly 2 children the operator is well-formed — just change
                    // the type in place.
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
                        return {
                            result: this.expressions.getExpression(
                                expressionId
                            )!,
                            changes,
                        }
                    }
                } else {
                    // --- SPLIT (>2 children) ---
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

                    // Now reparent the children under the new sub-operator
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
            // Strip old extras and replace with new ones
            const {
                id,
                argumentId,
                argumentVersion,
                checksum,
                descendantChecksum,
                combinedChecksum,
            } = this.premise as Record<string, unknown>
            this.premise = {
                ...extras,
                id,
                argumentId,
                argumentVersion,
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
                changes: collector.toChangeset(),
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
        const issues: TCoreValidationIssue[] = []
        const roots = this.expressions.getChildExpressions(null)

        if (this.expressions.toArray().length === 0) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_EMPTY",
                    message: `Premise "${this.premise.id}" has no expressions to evaluate.`,
                    premiseId: this.premise.id,
                })
            )
            return makeValidationResult(issues)
        }

        if (roots.length === 0) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISSING",
                    message: `Premise "${this.premise.id}" has expressions but no root expression.`,
                    premiseId: this.premise.id,
                })
            )
        }

        if (this.rootExpressionId === undefined) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISSING",
                    message: `Premise "${this.premise.id}" does not have rootExpressionId set.`,
                    premiseId: this.premise.id,
                })
            )
        } else if (!this.expressions.getExpression(this.rootExpressionId)) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISMATCH",
                    message: `Premise "${this.premise.id}" rootExpressionId "${this.rootExpressionId}" does not exist.`,
                    premiseId: this.premise.id,
                    expressionId: this.rootExpressionId,
                })
            )
        } else if (roots[0] && roots[0].id !== this.rootExpressionId) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISMATCH",
                    message: `Premise "${this.premise.id}" rootExpressionId "${this.rootExpressionId}" does not match actual root "${roots[0].id}".`,
                    premiseId: this.premise.id,
                    expressionId: this.rootExpressionId,
                })
            )
        }

        for (const expr of this.expressions.toArray()) {
            if (
                expr.type === "variable" &&
                !this.variables.hasVariable(expr.variableId)
            ) {
                issues.push(
                    makeErrorIssue({
                        code: "EXPR_VARIABLE_UNDECLARED",
                        message: `Expression "${expr.id}" references undeclared variable "${expr.variableId}".`,
                        premiseId: this.premise.id,
                        expressionId: expr.id,
                        variableId: expr.variableId,
                    })
                )
            }

            if (
                expr.type === "variable" &&
                this.emptyBoundPremiseCheck?.(expr.variableId)
            ) {
                issues.push({
                    code: "EXPR_BOUND_PREMISE_EMPTY",
                    severity: "warning",
                    message: `Variable "${expr.variableId}" is bound to a premise with no expression tree`,
                    expressionId: expr.id,
                })
            }

            if (expr.type !== "operator" && expr.type !== "formula") {
                continue
            }

            const children = this.expressions.getChildExpressions(expr.id)

            if (expr.type === "formula") {
                if (children.length !== 1) {
                    issues.push(
                        makeErrorIssue({
                            code: "EXPR_CHILD_COUNT_INVALID",
                            message: `Formula expression "${expr.id}" must have exactly 1 child; found ${children.length}.`,
                            premiseId: this.premise.id,
                            expressionId: expr.id,
                        })
                    )
                }
                continue
            }

            if (expr.operator === "not" && children.length !== 1) {
                issues.push(
                    makeErrorIssue({
                        code: "EXPR_CHILD_COUNT_INVALID",
                        message: `Operator "${expr.id}" (not) must have exactly 1 child; found ${children.length}.`,
                        premiseId: this.premise.id,
                        expressionId: expr.id,
                    })
                )
            }

            if (
                (expr.operator === "implies" || expr.operator === "iff") &&
                children.length !== 2
            ) {
                issues.push(
                    makeErrorIssue({
                        code: "EXPR_CHILD_COUNT_INVALID",
                        message: `Operator "${expr.id}" (${expr.operator}) must have exactly 2 children; found ${children.length}.`,
                        premiseId: this.premise.id,
                        expressionId: expr.id,
                    })
                )
            }

            if (
                (expr.operator === "and" || expr.operator === "or") &&
                children.length < 2
            ) {
                issues.push(
                    makeErrorIssue({
                        code: "EXPR_CHILD_COUNT_INVALID",
                        message: `Operator "${expr.id}" (${expr.operator}) must have at least 2 children; found ${children.length}.`,
                        premiseId: this.premise.id,
                        expressionId: expr.id,
                    })
                )
            }

            if (expr.operator === "implies" || expr.operator === "iff") {
                const childPositions = new Set(
                    children.map((child) => child.position)
                )
                if (children.length !== 2 || childPositions.size !== 2) {
                    issues.push(
                        makeErrorIssue({
                            code: "EXPR_BINARY_POSITIONS_INVALID",
                            message: `Operator "${expr.id}" (${expr.operator}) must have exactly 2 children with distinct positions.`,
                            premiseId: this.premise.id,
                            expressionId: expr.id,
                        })
                    )
                }
            }
        }

        return makeValidationResult(issues)
    }

    public evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            requireExactCoverage?: boolean
            resolver?: (variableId: string) => boolean | null
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

        const rootExpressionId = this.rootExpressionId!
        const referencedVariableIds = sortedUnique(
            this.expressions
                .toArray()
                .filter(
                    (
                        expr
                    ): expr is TExpressionInput<TExpr> & {
                        type: "variable"
                        variableId: string
                    } => expr.type === "variable"
                )
                .map((expr) => expr.variableId)
        )

        if (options?.strictUnknownKeys || options?.requireExactCoverage) {
            const knownVariableIds = new Set(referencedVariableIds)
            const unknownKeys = Object.keys(assignment.variables).filter(
                (variableId) => !knownVariableIds.has(variableId)
            )
            if (unknownKeys.length > 0) {
                throw new Error(
                    `Assignment contains unknown variable IDs for premise "${this.premise.id}": ${unknownKeys.join(", ")}`
                )
            }
        }

        const expressionValues: Record<string, TCoreTrivalentValue> = {}
        const evaluateExpression = (
            expressionId: string
        ): TCoreTrivalentValue => {
            const expression = this.expressions.getExpression(expressionId)
            if (!expression) {
                throw new Error(`Expression "${expressionId}" was not found.`)
            }

            const operatorState = assignment.operatorAssignments[expression.id]
            if (operatorState === "rejected") {
                expressionValues[expression.id] = false
                return false
            }

            if (expression.type === "variable") {
                let value: TCoreTrivalentValue
                if (options?.resolver) {
                    const variable = this.variables.getVariable(
                        expression.variableId
                    )
                    if (
                        variable &&
                        isPremiseBound(variable) &&
                        !isExternallyBound(variable, this.argument.id as string)
                    ) {
                        value = options.resolver(expression.variableId)
                    } else {
                        value =
                            assignment.variables[expression.variableId] ?? null
                    }
                } else {
                    value = assignment.variables[expression.variableId] ?? null
                }
                expressionValues[expression.id] = value
                return value
            }

            const children = this.expressions.getChildExpressions(expression.id)
            let value: TCoreTrivalentValue

            if (expression.type === "formula") {
                value = evaluateExpression(children[0].id)
                expressionValues[expression.id] = value
                return value
            }

            switch (expression.operator) {
                case "not":
                    value = kleeneNot(evaluateExpression(children[0].id))
                    break
                case "and":
                    value = children.reduce<TCoreTrivalentValue>(
                        (acc, child) =>
                            kleeneAnd(acc, evaluateExpression(child.id)),
                        true
                    )
                    break
                case "or":
                    value = children.reduce<TCoreTrivalentValue>(
                        (acc, child) =>
                            kleeneOr(acc, evaluateExpression(child.id)),
                        false
                    )
                    break
                case "implies": {
                    const left = children[0]
                    const right = children[1]
                    value = kleeneImplies(
                        evaluateExpression(left.id),
                        evaluateExpression(right.id)
                    )
                    break
                }
                case "iff": {
                    const left = children[0]
                    const right = children[1]
                    value = kleeneIff(
                        evaluateExpression(left.id),
                        evaluateExpression(right.id)
                    )
                    break
                }
            }

            expressionValues[expression.id] = value
            return value
        }

        const rootValue = evaluateExpression(rootExpressionId)
        const variableValues: Record<string, TCoreTrivalentValue> = {}
        for (const variableId of referencedVariableIds) {
            if (options?.resolver) {
                const variable = this.variables.getVariable(variableId)
                if (variable && isPremiseBound(variable)) {
                    variableValues[variableId] = options.resolver(variableId)
                    continue
                }
            }
            variableValues[variableId] =
                assignment.variables[variableId] ?? null
        }

        let inferenceDiagnostic: TCorePremiseInferenceDiagnostic | undefined
        if (
            this.isInference() &&
            assignment.operatorAssignments[rootExpressionId] !== "rejected"
        ) {
            const root = this.expressions.getExpression(rootExpressionId)
            if (root?.type === "operator") {
                const children = this.expressions.getChildExpressions(root.id)
                const left = children[0]
                const right = children[1]
                if (left && right) {
                    const leftValue = expressionValues[left.id]
                    const rightValue = expressionValues[right.id]
                    if (root.operator === "implies") {
                        inferenceDiagnostic = {
                            kind: "implies",
                            premiseId: this.premise.id,
                            rootExpressionId,
                            leftValue,
                            rightValue,
                            rootValue,
                            antecedentTrue: leftValue,
                            consequentTrue: rightValue,
                            isVacuouslyTrue: kleeneNot(leftValue),
                            fired: leftValue,
                            firedAndHeld: kleeneAnd(leftValue, rightValue),
                        }
                    } else if (root.operator === "iff") {
                        const leftToRight = buildDirectionalVacuity(
                            leftValue,
                            rightValue
                        )
                        const rightToLeft = buildDirectionalVacuity(
                            rightValue,
                            leftValue
                        )
                        inferenceDiagnostic = {
                            kind: "iff",
                            premiseId: this.premise.id,
                            rootExpressionId,
                            leftValue,
                            rightValue,
                            rootValue,
                            leftToRight,
                            rightToLeft,
                            bothSidesTrue: kleeneAnd(leftValue, rightValue),
                            bothSidesFalse: kleeneAnd(
                                kleeneNot(leftValue),
                                kleeneNot(rightValue)
                            ),
                        }
                    }
                }
            }
        }

        return {
            premiseId: this.premise.id,
            premiseType: this.isInference() ? "inference" : "constraint",
            rootExpressionId,
            rootValue,
            expressionValues,
            variableValues,
            inferenceDiagnostic,
        }
    }

    public toDisplayString(): string {
        if (this.rootExpressionId === undefined) {
            return ""
        }
        return this.renderExpression(this.rootExpressionId)
    }

    public walkFormulaTree<T>(visitor: TFormulaTreeVisitor<T>): T {
        if (this.rootExpressionId === undefined) {
            return visitor.empty()
        }
        return this.walkExpression(visitor, this.rootExpressionId)
    }

    public getDecidableOperatorExpressions(): TExpr[] {
        const result: TExpr[] = []
        const rootId = this.rootExpressionId
        if (rootId === undefined) return result

        const visit = (exprId: string): void => {
            const expr = this.expressions.getExpression(exprId)
            if (!expr) return
            if (expr.type === "operator" && expr.operator !== "not") {
                result.push(expr)
            }
            for (const child of this.expressions.getChildExpressions(exprId)) {
                visit(child.id)
            }
        }

        visit(rootId)
        return result
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

    public checksum(): string {
        if (this.checksumDirty || this.cachedMetaChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedMetaChecksum!
    }

    public descendantChecksum(): string | null {
        if (this.checksumDirty || this.cachedDescendantChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedDescendantChecksum!
    }

    public combinedChecksum(): string {
        if (this.checksumDirty || this.cachedCombinedChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedCombinedChecksum!
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
        const violations: TInvariantViolation[] = []
        const premiseId = this.premise.id

        // 1. Schema check (use toPremiseData() to include computed checksums)
        const premiseData = this.toPremiseData()
        if (
            !Value.Check(
                CorePremiseSchema,
                premiseData as unknown as TCorePremise
            )
        ) {
            violations.push({
                code: PREMISE_SCHEMA_INVALID,
                message: `Premise "${premiseId}" does not conform to CorePremiseSchema.`,
                entityType: "premise",
                entityId: premiseId,
                premiseId,
            })
        }

        // 2. Delegate to expression-level validation, attaching premiseId
        const exprResult = this.expressions.validate()
        for (const v of exprResult.violations) {
            violations.push({ ...v, premiseId })
        }

        // 3. Root expression consistency
        if (this.rootExpressionId !== undefined) {
            const rootExpr = this.expressions.getExpression(
                this.rootExpressionId
            )
            if (!rootExpr) {
                violations.push({
                    code: PREMISE_ROOT_EXPRESSION_INVALID,
                    message: `Premise "${premiseId}" rootExpressionId "${this.rootExpressionId}" does not exist in expression store.`,
                    entityType: "premise",
                    entityId: premiseId,
                    premiseId,
                })
            } else if (rootExpr.parentId !== null) {
                violations.push({
                    code: PREMISE_ROOT_EXPRESSION_INVALID,
                    message: `Premise "${premiseId}" rootExpressionId "${this.rootExpressionId}" has non-null parentId "${rootExpr.parentId}".`,
                    entityType: "premise",
                    entityId: premiseId,
                    premiseId,
                })
            }
        }

        // 4. Variable references: every variable-type expression must
        //    reference a variableId that exists in the argument's variable set
        if (this.variableIdsCallback) {
            const variableIds = this.variableIdsCallback()
            for (const expr of this.expressions.toArray()) {
                if (expr.type === "variable") {
                    const varExpr =
                        expr as unknown as TCorePropositionalVariableExpression
                    if (!variableIds.has(varExpr.variableId)) {
                        violations.push({
                            code: PREMISE_VARIABLE_REF_NOT_FOUND,
                            message: `Expression "${expr.id}" in premise "${premiseId}" references non-existent variable "${varExpr.variableId}".`,
                            entityType: "expression",
                            entityId: expr.id,
                            premiseId,
                        })
                    }
                }
            }
        }

        return {
            ok: violations.length === 0,
            violations,
        }
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
     * Re-reads the single root from ExpressionManager after any operation
     * that may have caused operator collapse to silently change the root.
     */
    private syncRootExpressionId(): void {
        const roots = this.expressions.getChildExpressions(null)
        this.rootExpressionId = roots[0]?.id
    }

    private collectSubtree(rootId: string): TExpr[] {
        const result: TExpr[] = []
        const stack = [rootId]
        while (stack.length > 0) {
            const id = stack.pop()!
            const expr = this.expressions.getExpression(id)
            if (!expr) continue
            result.push(expr)
            for (const child of this.expressions.getChildExpressions(id)) {
                stack.push(child.id)
            }
        }
        return result
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

    private renderExpression(expressionId: string): string {
        const expression = this.expressions.getExpression(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" was not found.`)
        }

        if (expression.type === "variable") {
            const variable = this.variables.getVariable(expression.variableId)
            if (!variable) {
                throw new Error(
                    `Variable "${expression.variableId}" for expression "${expressionId}" was not found.`
                )
            }
            return variable.symbol
        }

        if (expression.type === "formula") {
            const children = this.expressions.getChildExpressions(expression.id)
            if (children.length === 0) {
                return "(?)"
            }
            return `(${this.renderExpression(children[0].id)})`
        }

        const children = this.expressions.getChildExpressions(expression.id)
        if (expression.operator === "not") {
            if (children.length === 0) {
                return `${this.operatorSymbol(expression.operator)} (?)`
            }
            return `${this.operatorSymbol(expression.operator)}(${this.renderExpression(children[0].id)})`
        }

        if (children.length === 0) {
            return "(?)"
        }

        const renderedChildren = children.map((child) =>
            this.renderExpression(child.id)
        )
        return `(${renderedChildren.join(` ${this.operatorSymbol(expression.operator)} `)})`
    }

    private walkExpression<T>(
        visitor: TFormulaTreeVisitor<T>,
        expressionId: string
    ): T {
        const expression = this.expressions.getExpression(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" was not found.`)
        }

        if (expression.type === "variable") {
            const variable = this.variables.getVariable(expression.variableId)
            if (!variable) {
                throw new Error(
                    `Variable "${expression.variableId}" for expression "${expressionId}" was not found.`
                )
            }
            return visitor.variable(variable.symbol, expression.variableId)
        }

        if (expression.type === "formula") {
            const children = this.expressions.getChildExpressions(expression.id)
            if (children.length === 0) {
                return visitor.empty()
            }
            return visitor.formula(this.walkExpression(visitor, children[0].id))
        }

        const children = this.expressions.getChildExpressions(expression.id)
        const renderedChildren = children.map((child) =>
            this.walkExpression(visitor, child.id)
        )
        return visitor.operator(expression.operator, renderedChildren)
    }

    private operatorSymbol(operator: TCoreLogicalOperatorType): string {
        switch (operator) {
            case "and":
                return "∧"
            case "or":
                return "∨"
            case "implies":
                return "→"
            case "iff":
                return "↔"
            case "not":
                return "¬"
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
        grammarConfig?: TGrammarConfig,
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
        // Override grammar config if the caller specified one.
        if (grammarConfig) {
            pe.grammarConfig = grammarConfig
        }
        // Restore expressions from the snapshot
        pe.expressions = ExpressionManager.fromSnapshot<TExpr>(
            snapshot.expressions,
            grammarConfig,
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
        return changes
    }

    private flushAndBuildChangeset(
        collector: ChangeCollector<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        // Snapshot premise combinedChecksum before flush
        const premiseCombinedBefore = this.cachedCombinedChecksum ?? null

        this.expressions.flushExpressionChecksums()
        const changes = collector.toChangeset()
        if (changes.expressions) {
            changes.expressions.added = changes.expressions.added.map(
                (expr) => {
                    const current = this.expressions.getExpression(expr.id)
                    return current ? { ...current } : expr
                }
            )
            changes.expressions.modified = changes.expressions.modified.map(
                (expr) => {
                    const current = this.expressions.getExpression(expr.id)
                    return current ? { ...current } : expr
                }
            )
        }

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

    private rebuildVariableIndex(): void {
        this.expressionsByVariableId = new DefaultMap(() => new Set())
        for (const expr of this.expressions.toArray()) {
            if (expr.type === "variable") {
                this.expressionsByVariableId.get(expr.variableId).add(expr.id)
            }
        }
    }
}
