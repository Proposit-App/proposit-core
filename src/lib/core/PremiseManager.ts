import type {
    TCoreArgument,
    TCoreLogicalOperatorType,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import { DefaultMap } from "../utils.js"
import { sortedCopyById, sortedUnique } from "../utils/collections.js"
import type {
    TCoreExpressionAssignment,
    TCorePremiseEvaluationResult,
    TCorePremiseInferenceDiagnostic,
    TCoreTrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../types/evaluation.js"
import type { TCoreChangeset, TCoreMutationResult } from "../types/mutation.js"
import {
    buildDirectionalVacuity,
    kleeneAnd,
    kleeneIff,
    kleeneImplies,
    kleeneNot,
    kleeneOr,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/shared.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { ChangeCollector } from "./ChangeCollector.js"
import { computeHash, entityChecksum } from "./checksum.js"
import type { TExpressionWithoutPosition } from "./ExpressionManager.js"
import { ExpressionManager } from "./ExpressionManager.js"
import { VariableManager } from "./VariableManager.js"

const DEFAULT_EXPRESSION_FIELDS = [
    "id",
    "type",
    "parentId",
    "position",
    "argumentId",
    "argumentVersion",
    "variableId",
    "operator",
]

const DEFAULT_VARIABLE_FIELDS = [
    "id",
    "symbol",
    "argumentId",
    "argumentVersion",
]

export class PremiseManager {
    private id: string
    private extras: Record<string, unknown>
    private rootExpressionId: string | undefined
    private variables: VariableManager
    private expressions: ExpressionManager
    private expressionsByVariableId: DefaultMap<string, Set<string>>
    private argument: TCoreArgument
    private checksumConfig?: TCoreChecksumConfig
    private checksumDirty = true
    private cachedChecksum: string | undefined

    constructor(
        id: string,
        argument: TCoreArgument,
        extras?: Record<string, unknown>,
        checksumConfig?: TCoreChecksumConfig
    ) {
        this.id = id
        this.argument = argument
        this.extras = extras ?? {}
        this.checksumConfig = checksumConfig
        this.rootExpressionId = undefined
        this.variables = new VariableManager()
        this.expressions = new ExpressionManager()
        this.expressionsByVariableId = new DefaultMap(() => new Set())
    }

    /**
     * Registers a propositional variable for use within this premise.
     *
     * @throws If `variable.symbol` is already in use within this premise.
     * @throws If `variable.id` already exists within this premise.
     * @throws If the variable does not belong to this premise's argument.
     */
    public addVariable(
        variable: TCorePropositionalVariable
    ): TCoreMutationResult<TCorePropositionalVariable> {
        this.assertBelongsToArgument(
            variable.argumentId,
            variable.argumentVersion
        )
        this.variables.addVariable(variable)
        const collector = new ChangeCollector()
        collector.addedVariable({ ...variable })
        this.markDirty()
        return {
            result: this.attachVariableChecksum({ ...variable }),
            changes: this.attachChangesetChecksums(collector.toChangeset()),
        }
    }

    /**
     * Removes a variable from this premise's registry and returns it, or
     * `undefined` if it was not found.
     *
     * @throws If any expression in this premise still references the variable.
     */
    public removeVariable(
        variableId: string
    ): TCoreMutationResult<TCorePropositionalVariable | undefined> {
        if (this.expressionsByVariableId.get(variableId).size > 0) {
            throw new Error(
                `Variable "${variableId}" cannot be removed because it is referenced by one or more expressions.`
            )
        }
        const removed = this.variables.removeVariable(variableId)
        const collector = new ChangeCollector()
        if (removed) {
            collector.removedVariable({ ...removed })
            this.markDirty()
        }
        return {
            result: removed
                ? this.attachVariableChecksum({ ...removed })
                : undefined,
            changes: this.attachChangesetChecksums(collector.toChangeset()),
        }
    }

    /**
     * Adds an expression to this premise's tree.
     *
     * If the expression has `parentId: null` it becomes the root; only one
     * root is permitted per premise.  If `parentId` is non-null the parent
     * must already exist within this premise.
     *
     * All other structural rules (`implies`/`iff` root-only, child limits,
     * position uniqueness) are enforced by the underlying `ExpressionManager`.
     *
     * @throws If the premise already has a root expression and this one is also a root.
     * @throws If the expression's parent does not exist in this premise.
     * @throws If the expression is a variable reference and the variable has not been registered.
     * @throws If the expression does not belong to this argument.
     */
    public addExpression(
        expression: TCorePropositionalExpression
    ): TCoreMutationResult<TCorePropositionalExpression> {
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

        if (expression.parentId === null) {
            if (this.rootExpressionId !== undefined) {
                throw new Error(
                    `Premise "${this.id}" already has a root expression.`
                )
            }
        } else {
            if (!this.expressions.getExpression(expression.parentId)) {
                throw new Error(
                    `Parent expression "${expression.parentId}" does not exist in this premise.`
                )
            }
        }

        const collector = new ChangeCollector()
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
            return {
                result: this.attachExpressionChecksum({ ...expression }),
                changes: this.attachChangesetChecksums(collector.toChangeset()),
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    /**
     * Adds an expression as the last child of the given parent, with
     * position computed automatically.
     *
     * If `parentId` is `null`, the expression becomes the root.
     *
     * @throws If the premise already has a root and parentId is null.
     * @throws If the expression does not belong to this argument.
     * @throws If the expression is a variable reference and the variable has not been registered.
     */
    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition
    ): TCoreMutationResult<TCorePropositionalExpression> {
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

        if (parentId === null) {
            if (this.rootExpressionId !== undefined) {
                throw new Error(
                    `Premise "${this.id}" already has a root expression.`
                )
            }
        } else {
            if (!this.expressions.getExpression(parentId)) {
                throw new Error(
                    `Parent expression "${parentId}" does not exist in this premise.`
                )
            }
        }

        const collector = new ChangeCollector()
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
            const stored = this.expressions.getExpression(expression.id)!
            return {
                result: this.attachExpressionChecksum({ ...stored }),
                changes: this.attachChangesetChecksums(collector.toChangeset()),
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    /**
     * Adds an expression immediately before or after an existing sibling,
     * with position computed automatically.
     *
     * @throws If the sibling does not exist in this premise.
     * @throws If the expression does not belong to this argument.
     * @throws If the expression is a variable reference and the variable has not been registered.
     */
    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition
    ): TCoreMutationResult<TCorePropositionalExpression> {
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

        if (!this.expressions.getExpression(siblingId)) {
            throw new Error(
                `Expression "${siblingId}" not found in this premise.`
            )
        }

        const collector = new ChangeCollector()
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
            const stored = this.expressions.getExpression(expression.id)!
            return {
                result: this.attachExpressionChecksum({ ...stored }),
                changes: this.attachChangesetChecksums(collector.toChangeset()),
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    /**
     * Removes an expression and its entire descendant subtree, then collapses
     * any ancestor operators with fewer than two children (same semantics as
     * before).  Returns the removed root expression, or `undefined` if not
     * found.
     *
     * `rootExpressionId` is recomputed after every removal because operator
     * collapse can silently promote a new expression into the root slot.
     */
    public removeExpression(
        expressionId: string
    ): TCoreMutationResult<TCorePropositionalExpression | undefined> {
        // Snapshot the expression before removal (for result).
        const snapshot = this.expressions.getExpression(expressionId)

        const collector = new ChangeCollector()
        this.expressions.setCollector(collector)
        try {
            if (!snapshot) {
                return { result: undefined, changes: collector.toChangeset() }
            }

            // Snapshot the subtree before deletion so we can clean up
            // expressionsByVariableId for cascade-deleted descendants — they are
            // not individually surfaced by ExpressionManager.removeExpression.
            const subtree = this.collectSubtree(expressionId)

            this.expressions.removeExpression(expressionId)

            for (const expr of subtree) {
                if (expr.type === "variable") {
                    this.expressionsByVariableId
                        .get(expr.variableId)
                        ?.delete(expr.id)
                }
            }

            this.syncRootExpressionId()
            this.markDirty()
            return {
                result: this.attachExpressionChecksum({ ...snapshot }),
                changes: this.attachChangesetChecksums(collector.toChangeset()),
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    /**
     * Splices a new expression between existing nodes in the tree.  The new
     * expression inherits the tree slot of the anchor node
     * (`leftNodeId ?? rightNodeId`).
     *
     * `rootExpressionId` is recomputed after every insertion because the
     * anchor may have been the root.
     *
     * See `ArgumentEngine.insertExpression` for the full contract; the same
     * rules apply here.
     *
     * @throws If the expression does not belong to this argument.
     * @throws If the expression is a variable reference and the variable has not been registered.
     */
    public insertExpression(
        expression: TCorePropositionalExpression,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TCorePropositionalExpression> {
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

        const collector = new ChangeCollector()
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

            const stored = this.expressions.getExpression(expression.id)!
            return {
                result: this.attachExpressionChecksum({ ...stored }),
                changes: this.attachChangesetChecksums(collector.toChangeset()),
            }
        } finally {
            this.expressions.setCollector(null)
        }
    }

    /**
     * Returns an expression by ID, or `undefined` if not found in this
     * premise.
     */
    public getExpression(id: string): TCorePropositionalExpression | undefined {
        const expr = this.expressions.getExpression(id)
        if (!expr) return undefined
        return this.attachExpressionChecksum(expr)
    }

    public getId(): string {
        return this.id
    }

    public getExtras(): Record<string, unknown> {
        return { ...this.extras }
    }

    public setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>> {
        this.extras = { ...extras }
        this.markDirty()
        return { result: { ...this.extras }, changes: {} }
    }

    public getRootExpressionId(): string | undefined {
        return this.rootExpressionId
    }

    public getRootExpression(): TCorePropositionalExpression | undefined {
        if (this.rootExpressionId === undefined) {
            return undefined
        }
        const expr = this.expressions.getExpression(this.rootExpressionId)
        if (!expr) return undefined
        return this.attachExpressionChecksum(expr)
    }

    public getVariables(): TCorePropositionalVariable[] {
        const fields =
            this.checksumConfig?.variableFields ?? DEFAULT_VARIABLE_FIELDS
        return sortedCopyById(
            this.variables.toArray().map((v) => ({
                ...v,
                checksum: entityChecksum(
                    v as unknown as Record<string, unknown>,
                    fields
                ),
            }))
        )
    }

    public getExpressions(): TCorePropositionalExpression[] {
        const fields =
            this.checksumConfig?.expressionFields ?? DEFAULT_EXPRESSION_FIELDS
        return sortedCopyById(
            this.expressions.toArray().map((e) => ({
                ...e,
                checksum: entityChecksum(
                    e as unknown as Record<string, unknown>,
                    fields
                ),
            }))
        )
    }

    public getChildExpressions(
        parentId: string | null
    ): TCorePropositionalExpression[] {
        return this.expressions
            .getChildExpressions(parentId)
            .map((expr) => this.attachExpressionChecksum(expr))
    }

    /**
     * Returns `true` if the root expression is an `implies` or `iff` operator,
     * meaning this premise expresses a logical inference relationship.
     */
    public isInference(): boolean {
        const root = this.getRootExpression()
        return (
            root?.type === "operator" &&
            (root.operator === "implies" || root.operator === "iff")
        )
    }

    /**
     * Returns `true` if this premise does not have an inference operator at its
     * root (i.e. it is a constraint premise).  Equivalent to `!isInference()`.
     */
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
                    message: `Premise "${this.id}" has no expressions to evaluate.`,
                    premiseId: this.id,
                })
            )
            return makeValidationResult(issues)
        }

        if (roots.length === 0) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISSING",
                    message: `Premise "${this.id}" has expressions but no root expression.`,
                    premiseId: this.id,
                })
            )
        }

        if (this.rootExpressionId === undefined) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISSING",
                    message: `Premise "${this.id}" does not have rootExpressionId set.`,
                    premiseId: this.id,
                })
            )
        } else if (!this.expressions.getExpression(this.rootExpressionId)) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISMATCH",
                    message: `Premise "${this.id}" rootExpressionId "${this.rootExpressionId}" does not exist.`,
                    premiseId: this.id,
                    expressionId: this.rootExpressionId,
                })
            )
        } else if (roots[0] && roots[0].id !== this.rootExpressionId) {
            issues.push(
                makeErrorIssue({
                    code: "PREMISE_ROOT_MISMATCH",
                    message: `Premise "${this.id}" rootExpressionId "${this.rootExpressionId}" does not match actual root "${roots[0].id}".`,
                    premiseId: this.id,
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
                        premiseId: this.id,
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
                            premiseId: this.id,
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
                        premiseId: this.id,
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
                        premiseId: this.id,
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
                        premiseId: this.id,
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
                            premiseId: this.id,
                            expressionId: expr.id,
                        })
                    )
                }
            }
        }

        return makeValidationResult(issues)
    }

    /**
     * Evaluates the premise under a three-valued expression assignment.
     *
     * Variable values are looked up in `assignment.variables` using Kleene
     * three-valued logic (`null` = unknown). Missing variables default to `null`.
     * Expressions listed in `assignment.rejectedExpressionIds` evaluate to
     * `false` and their children are not evaluated.
     *
     * For inference premises (`implies`/`iff`), an `inferenceDiagnostic` is
     * computed with three-valued fields unless the root is rejected.
     */
    public evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            requireExactCoverage?: boolean
        }
    ): TCorePremiseEvaluationResult {
        const validation = this.validateEvaluability()
        if (!validation.ok) {
            throw new Error(
                `Premise "${this.id}" is not evaluable: ${validation.issues
                    .map((issue) => issue.code)
                    .join(", ")}`
            )
        }

        const rootExpressionId = this.rootExpressionId!
        const referencedVariableIds = sortedUnique(
            this.expressions
                .toArray()
                .filter(
                    (expr): expr is TCorePropositionalExpression<"variable"> =>
                        expr.type === "variable"
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
                    `Assignment contains unknown variable IDs for premise "${this.id}": ${unknownKeys.join(", ")}`
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
                const value =
                    assignment.variables[expression.variableId] ?? null
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
                            premiseId: this.id,
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
                            premiseId: this.id,
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
            premiseId: this.id,
            premiseType: this.isInference() ? "inference" : "constraint",
            rootExpressionId,
            rootValue,
            expressionValues,
            variableValues,
            inferenceDiagnostic,
        }
    }

    /**
     * Returns a human-readable string of this premise's expression tree using
     * standard logical notation (∧ ∨ ¬ → ↔).  Missing operands are rendered
     * as `(?)`.  Returns an empty string when the premise has no expressions.
     */
    public toDisplayString(): string {
        if (this.rootExpressionId === undefined) {
            return ""
        }
        return this.renderExpression(this.rootExpressionId)
    }

    /**
     * Returns a serialisable snapshot of this premise conforming to
     * `TCorePremise`.  `variables` contains only the variables that are actually
     * referenced by expressions in this premise.
     */
    public toData(): TCorePremise {
        const expressions = this.getExpressions()

        const referencedVariableIds = new Set<string>()
        for (const expr of expressions) {
            if (expr.type === "variable") {
                referencedVariableIds.add(expr.variableId)
            }
        }
        const variables = Array.from(referencedVariableIds).sort()

        return {
            ...this.extras,
            id: this.id,
            rootExpressionId: this.rootExpressionId,
            variables,
            expressions,
            checksum: this.checksum(),
        } as TCorePremise
    }

    /**
     * Returns a premise-level checksum combining all entity checksums.
     * Computed lazily -- only recalculated when state has changed.
     */
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

    private attachExpressionChecksum(
        expr: TCorePropositionalExpression
    ): TCorePropositionalExpression {
        const fields =
            this.checksumConfig?.expressionFields ?? DEFAULT_EXPRESSION_FIELDS
        return {
            ...expr,
            checksum: entityChecksum(
                expr as unknown as Record<string, unknown>,
                fields
            ),
        }
    }

    private attachVariableChecksum(
        v: TCorePropositionalVariable
    ): TCorePropositionalVariable {
        const fields =
            this.checksumConfig?.variableFields ?? DEFAULT_VARIABLE_FIELDS
        return {
            ...v,
            checksum: entityChecksum(
                v as unknown as Record<string, unknown>,
                fields
            ),
        }
    }

    private attachChangesetChecksums(changes: TCoreChangeset): TCoreChangeset {
        const result: TCoreChangeset = { ...changes }
        if (result.expressions) {
            result.expressions = {
                added: result.expressions.added.map((e) =>
                    this.attachExpressionChecksum(e)
                ),
                modified: result.expressions.modified.map((e) =>
                    this.attachExpressionChecksum(e)
                ),
                removed: result.expressions.removed.map((e) =>
                    this.attachExpressionChecksum(e)
                ),
            }
        }
        if (result.variables) {
            result.variables = {
                added: result.variables.added.map((v) =>
                    this.attachVariableChecksum(v)
                ),
                modified: result.variables.modified.map((v) =>
                    this.attachVariableChecksum(v)
                ),
                removed: result.variables.removed.map((v) =>
                    this.attachVariableChecksum(v)
                ),
            }
        }
        return result
    }

    private computeChecksum(): string {
        const config = this.checksumConfig
        const parts: string[] = []

        // Premise metadata
        parts.push(
            entityChecksum(
                {
                    id: this.id,
                    rootExpressionId: this.rootExpressionId,
                } as Record<string, unknown>,
                config?.premiseFields ?? ["id", "rootExpressionId"]
            )
        )

        // Variable checksums (sorted by ID for determinism)
        for (const v of this.getVariables()) {
            parts.push(
                entityChecksum(
                    v as unknown as Record<string, unknown>,
                    config?.variableFields ?? [
                        "id",
                        "symbol",
                        "argumentId",
                        "argumentVersion",
                    ]
                )
            )
        }

        // Expression checksums (sorted by ID for determinism)
        for (const e of this.getExpressions()) {
            parts.push(
                entityChecksum(
                    e as unknown as Record<string, unknown>,
                    config?.expressionFields ?? [
                        "id",
                        "type",
                        "parentId",
                        "position",
                        "argumentId",
                        "argumentVersion",
                        "variableId",
                        "operator",
                    ]
                )
            )
        }

        return computeHash(parts.join(":"))
    }

    private markDirty(): void {
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

    private collectSubtree(rootId: string): TCorePropositionalExpression[] {
        const result: TCorePropositionalExpression[] = []
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
}
