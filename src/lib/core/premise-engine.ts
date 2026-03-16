import { randomUUID } from "node:crypto"
import {
    isPremiseBound,
    type TCoreArgument,
    type TCoreLogicalOperatorType,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TOptionalChecksum,
} from "../schemata/index.js"
import { DefaultMap } from "../utils/default-map.js"
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
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type { TLogicEngineOptions } from "./argument-engine.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { ChangeCollector } from "./change-collector.js"
import { canonicalSerialize, computeHash, entityChecksum } from "./checksum.js"
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
    TDisplayable,
    TChecksummable,
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
        TChecksummable
{
    private premise: TOptionalChecksum<TPremise>
    private rootExpressionId: string | undefined
    private variables: VariableManager<TVar>
    private expressions: ExpressionManager<TExpr>
    private expressionsByVariableId: DefaultMap<string, Set<string>>
    private argument: TOptionalChecksum<TArg>
    private checksumConfig?: TCoreChecksumConfig
    private checksumDirty = true
    private cachedChecksum: string | undefined
    private expressionIndex?: Map<string, string>
    private onMutate?: () => void
    private circularityCheck?: (
        variableId: string,
        premiseId: string
    ) => boolean

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
        this.rootExpressionId = undefined
        this.variables = deps.variables
        this.expressions = new ExpressionManager<TExpr>(config)
        this.expressionsByVariableId = new DefaultMap(() => new Set())
        this.expressionIndex = deps.expressionIndex
    }

    public setOnMutate(callback: (() => void) | undefined): void {
        this.onMutate = callback
    }

    public setCircularityCheck(
        check: ((variableId: string, premiseId: string) => boolean) | undefined
    ): void {
        this.circularityCheck = check
    }

    public deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg> {
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

                const { result, changes } = this.removeExpression(exprId, true)
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
    }

    public addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )

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

            this.markDirty()
            const changes = collector.toChangeset()
            this.syncExpressionIndex(changes)
            this.onMutate?.()
            return {
                result: this.expressions.getExpression(expression.id)!,
                changes,
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )

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

            if (parentId === null) {
                this.syncRootExpressionId()
            }
            if (expression.type === "variable") {
                this.expressionsByVariableId
                    .get(expression.variableId)
                    .add(expression.id)
            }

            this.markDirty()
            const changes = collector.toChangeset()
            this.syncExpressionIndex(changes)
            this.onMutate?.()
            return {
                result: this.expressions.getExpression(expression.id)!,
                changes,
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )

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

            this.markDirty()
            const changes = collector.toChangeset()
            this.syncExpressionIndex(changes)
            this.onMutate?.()
            return {
                result: this.expressions.getExpression(expression.id)!,
                changes,
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    public updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
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
                existing.type === "variable" ? existing.variableId : undefined

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

            const changeset = collector.toChangeset()
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
    }

    public removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TCoreMutationResult<TExpr | undefined, TExpr, TVar, TPremise, TArg> {
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

            this.syncRootExpressionId()
            this.markDirty()

            const changes = collector.toChangeset()
            this.syncExpressionIndex(changes)
            this.onMutate?.()
            return {
                result: snapshot,
                changes,
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    public insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertBelongsToArgument(
            expression.argumentId,
            expression.argumentVersion
        )

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

            this.syncRootExpressionId()
            this.markDirty()

            const changes = collector.toChangeset()
            this.syncExpressionIndex(changes)
            this.onMutate?.()
            return {
                result: this.expressions.getExpression(expression.id)!,
                changes,
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    public wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertBelongsToArgument(
            operator.argumentId,
            operator.argumentVersion
        )
        this.assertBelongsToArgument(
            newSibling.argumentId,
            newSibling.argumentVersion
        )

        if (
            newSibling.type === "variable" &&
            !this.variables.hasVariable(newSibling.variableId)
        ) {
            throw new Error(
                `Variable expression "${newSibling.id}" references non-existent variable "${newSibling.variableId}".`
            )
        }

        if (newSibling.type === "variable" && this.circularityCheck) {
            if (this.circularityCheck(newSibling.variableId, this.premise.id)) {
                throw new Error(
                    `Circular binding: variable "${newSibling.variableId}" is bound to this premise (directly or transitively)`
                )
            }
        }

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

            this.syncRootExpressionId()
            this.markDirty()

            const changes = collector.toChangeset()
            this.syncExpressionIndex(changes)
            this.onMutate?.()
            return {
                result: this.expressions.getExpression(operator.id)!,
                changes,
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    public toggleNegation(
        expressionId: string
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg> {
        const target = this.expressions.getExpression(expressionId)
        if (!target) {
            throw new Error(
                `Expression "${expressionId}" not found in this premise.`
            )
        }

        this.assertBelongsToArgument(target.argumentId, target.argumentVersion)

        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        this.expressions.setCollector(collector)
        try {
            const parent = target.parentId
                ? this.expressions.getExpression(target.parentId)
                : undefined

            if (
                parent &&
                parent.type === "operator" &&
                parent.operator === "not"
            ) {
                // Remove the NOT operator, promoting target into its slot
                this.expressions.removeExpression(parent.id, false)

                this.syncRootExpressionId()
                this.markDirty()

                const changes = collector.toChangeset()
                this.syncExpressionIndex(changes)
                this.onMutate?.()
                return { result: null, changes }
            } else {
                // Wrap target with a new NOT operator
                const notExpr = {
                    id: randomUUID(),
                    argumentId: target.argumentId,
                    argumentVersion: target.argumentVersion,
                    premiseId: target.premiseId,
                    type: "operator",
                    operator: "not",
                    parentId: target.parentId,
                    position: target.position,
                } as TExpressionInput<TExpr>

                this.expressions.insertExpression(notExpr, expressionId)

                this.syncRootExpressionId()
                this.markDirty()

                const changes = collector.toChangeset()
                this.syncExpressionIndex(changes)
                this.onMutate?.()
                return {
                    result: this.expressions.getExpression(notExpr.id)!,
                    changes,
                }
            }
        } finally {
            this.expressions.setCollector(null)
        }
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
        // Strip old extras and replace with new ones
        const { id, argumentId, argumentVersion, checksum } = this
            .premise as Record<string, unknown>
        this.premise = {
            ...extras,
            id,
            argumentId,
            argumentVersion,
            ...(checksum !== undefined ? { checksum } : {}),
        } as TOptionalChecksum<TPremise>
        this.markDirty()
        this.onMutate?.()
        return { result: this.getExtras(), changes: {} }
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
                if (!childPositions.has(0) || !childPositions.has(1)) {
                    issues.push(
                        makeErrorIssue({
                            code: "EXPR_BINARY_POSITIONS_INVALID",
                            message: `Operator "${expr.id}" (${expr.operator}) must have children at positions 0 and 1.`,
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

            if (assignment.rejectedExpressionIds.includes(expression.id)) {
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
                        isPremiseBound(variable)
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
                    const left = children.find((child) => child.position === 0)
                    const right = children.find((child) => child.position === 1)
                    value = kleeneImplies(
                        evaluateExpression(left!.id),
                        evaluateExpression(right!.id)
                    )
                    break
                }
                case "iff": {
                    const left = children.find((child) => child.position === 0)
                    const right = children.find((child) => child.position === 1)
                    value = kleeneIff(
                        evaluateExpression(left!.id),
                        evaluateExpression(right!.id)
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
                if (
                    variable &&
                    isPremiseBound(variable)
                ) {
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
            !assignment.rejectedExpressionIds.includes(rootExpressionId)
        ) {
            const root = this.expressions.getExpression(rootExpressionId)
            if (root?.type === "operator") {
                const children = this.expressions.getChildExpressions(root.id)
                const left = children.find((child) => child.position === 0)
                const right = children.find((child) => child.position === 1)
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
        return {
            ...this.premise,
            checksum: this.checksum(),
        } as TPremise
    }

    public checksum(): string {
        if (this.checksumDirty || this.cachedChecksum === undefined) {
            this.cachedChecksum = this.computeChecksum()
            this.checksumDirty = false
        }
        return this.cachedChecksum
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private computeChecksum(): string {
        const checksumMap: Record<string, string> = {}

        // Premise's own entity checksum
        const premiseFields =
            this.checksumConfig?.premiseFields ??
            DEFAULT_CHECKSUM_CONFIG.premiseFields!
        checksumMap[this.premise.id] = entityChecksum(
            { id: this.premise.id } as Record<string, unknown>,
            premiseFields
        )

        // All owned expression checksums
        for (const expr of this.expressions.toArray()) {
            checksumMap[expr.id] = expr.checksum
        }

        return computeHash(canonicalSerialize(checksumMap))
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
        const exprSnapshot = this.expressions.snapshot()
        return {
            premise: { ...this.premise },
            rootExpressionId: this.rootExpressionId,
            expressions: exprSnapshot,
            config: {
                checksumConfig: this.checksumConfig,
                positionConfig: exprSnapshot.config?.positionConfig,
            },
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
        expressionIndex?: Map<string, string>
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> {
        const pe = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
            snapshot.premise,
            { argument, variables, expressionIndex },
            snapshot.config
        )
        // Restore expressions from the snapshot
        pe.expressions = ExpressionManager.fromSnapshot<TExpr>(
            snapshot.expressions
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
