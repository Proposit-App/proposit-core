import {
    isClaimBound,
    isPremiseBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreCounterexample,
    TCoreExpressionAssignment,
    TCoreTrivalentValue,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
    TCoreVariableAssignment,
    TCorePremiseEvaluationResult,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import {
    kleeneAnd,
    kleeneNot,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "./kleene.js"
import { makeErrorIssue, makeValidationResult } from "./validation.js"

/**
 * Read-only interface providing the data an evaluation needs from an
 * argument engine. This is intentionally narrow — evaluation should
 * not mutate anything.
 */
export interface TArgumentEvaluationContext {
    /** The argument's own ID. */
    argumentId: string
    /** Returns the conclusion PremiseEngine, or undefined. */
    getConclusionPremise(): TEvaluablePremise | undefined
    /** Returns supporting premises (inference premises minus conclusion). */
    listSupportingPremises(): TEvaluablePremise[]
    /** Returns all premises. */
    listPremises(): TEvaluablePremise[]
    /** The conclusion premise ID, if set. */
    conclusionPremiseId: string | undefined
    /** Look up a variable by ID. */
    getVariable(variableId: string): TCorePropositionalVariable | undefined
    /** Look up a premise by ID. */
    getPremise(premiseId: string): TEvaluablePremise | undefined
    /** Pre-evaluation structural validation. */
    validateEvaluability(): TCoreValidationResult
}

/**
 * Narrow view of a PremiseEngine needed for evaluation.
 */
export interface TEvaluablePremise {
    getId(): string
    getExpressions(): TCorePropositionalExpression[]
    getChildExpressions(parentId: string): TCorePropositionalExpression[]
    getVariables(): TCorePropositionalVariable[]
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            resolver?: (variableId: string) => boolean | null
        }
    ): TCorePremiseEvaluationResult
    /**
     * Returns the operator expressions a reviewer can accept or reject,
     * in pre-order tree order. Excludes `"not"` operators and skips
     * formula nodes. See `TExpressionQueries.getDecidableOperatorExpressions`
     * on the full `PremiseEngine` for the authoritative contract.
     */
    getDecidableOperatorExpressions(): TCorePropositionalExpression[]
}

/**
 * Run fixed-point constraint propagation over accepted/rejected operators.
 * Fills unknown (null) variable values based on operator semantics.
 * Never overwrites user-assigned values (true/false).
 */
export function propagateOperatorConstraints(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment
): TCoreVariableAssignment {
    const vars: TCoreVariableAssignment = { ...assignment.variables }
    const opAssignments = assignment.operatorAssignments

    // Collect all expressions across all premises, indexed by id
    const exprById = new Map<
        string,
        TCorePropositionalExpression & { premiseId: string }
    >()
    // Children lookup: parentId -> sorted children
    const childrenOf = new Map<string, TCorePropositionalExpression[]>()

    for (const pm of ctx.listPremises()) {
        for (const expr of pm.getExpressions()) {
            exprById.set(
                expr.id,
                expr as TCorePropositionalExpression & { premiseId: string }
            )
        }
        // Build children map using getChildExpressions for each operator/formula
        for (const expr of pm.getExpressions()) {
            if (expr.type === "operator" || expr.type === "formula") {
                childrenOf.set(expr.id, pm.getChildExpressions(expr.id))
            }
        }
    }

    /**
     * Resolve the current Kleene value of an expression subtree
     * given the current variable assignments. Does not force-accept
     * nested operators — evaluates them normally via Kleene logic.
     */
    const resolveValue = (exprId: string): TCoreTrivalentValue => {
        const expr = exprById.get(exprId)
        if (!expr) return null

        if (expr.type === "variable") {
            return (
                vars[
                    (expr as TCorePropositionalExpression<"variable">)
                        .variableId
                ] ?? null
            )
        }

        if (expr.type === "formula") {
            const children = childrenOf.get(expr.id) ?? []
            return children.length > 0 ? resolveValue(children[0].id) : null
        }

        // operator
        const op = (expr as TCorePropositionalExpression<"operator">).operator
        const children = childrenOf.get(expr.id) ?? []

        switch (op) {
            case "not":
                return kleeneNot(resolveValue(children[0].id))
            case "and":
                return children.reduce<TCoreTrivalentValue>(
                    (acc, child) => kleeneAnd(acc, resolveValue(child.id)),
                    true
                )
            case "or":
                return children.reduce<TCoreTrivalentValue>(
                    (acc, child) => kleeneOr(acc, resolveValue(child.id)),
                    false
                )
            case "implies": {
                return kleeneImplies(
                    resolveValue(children[0].id),
                    resolveValue(children[1].id)
                )
            }
            case "iff": {
                return kleeneIff(
                    resolveValue(children[0].id),
                    resolveValue(children[1].id)
                )
            }
        }
    }

    /**
     * Unwrap formula wrappers to find the leaf variable expression.
     * Returns the variableId if the leaf is a variable, otherwise null.
     */
    const resolveLeafVariableId = (
        expr: TCorePropositionalExpression
    ): string | null => {
        if (expr.type === "variable") {
            return expr.variableId
        }
        if (expr.type === "formula") {
            const children = childrenOf.get(expr.id) ?? []
            if (children.length > 0) {
                return resolveLeafVariableId(children[0])
            }
        }
        return null
    }

    // Track which variable IDs were explicitly set by the user
    // (true or false). These are never overwritten by propagation.
    const userAssigned = new Set<string>()
    for (const [varId, val] of Object.entries(vars)) {
        if (val !== null && val !== undefined) userAssigned.add(varId)
    }

    /**
     * Try to set a child expression's variable to a value.
     * Never overwrites user-assigned values.
     * False overrides propagated true (rejection wins).
     * Returns true if a value changed.
     */
    const trySetChild = (
        child: TCorePropositionalExpression,
        value: boolean
    ): boolean => {
        const varId = resolveLeafVariableId(child)
        if (varId == null || userAssigned.has(varId)) return false
        const current = vars[varId] ?? null
        if (current === null) {
            vars[varId] = value
            return true
        }
        // False overrides propagated true
        if (value === false && current === true) {
            vars[varId] = false
            return true
        }
        return false
    }

    // Two-phase propagation: rejections first (to establish false values),
    // then acceptances (which only fill remaining unknowns).
    // This prevents acceptance from deriving values through chains that
    // are later invalidated by rejection.
    for (const phase of ["rejected", "accepted"] as const) {
        let changed = true
        while (changed) {
            changed = false

            for (const [exprId, expr] of exprById) {
                if (expr.type !== "operator") continue
                const state = opAssignments[exprId]
                if (state !== phase) continue

                const op = (expr as TCorePropositionalExpression<"operator">)
                    .operator
                const children = childrenOf.get(exprId) ?? []

                if (state === "accepted") {
                    switch (op) {
                        case "not": {
                            // ¬A accepted (= true) => child must be false
                            if (children.length > 0) {
                                if (trySetChild(children[0], false))
                                    changed = true
                            }
                            break
                        }
                        case "and": {
                            // A ∧ B accepted => all children must be true
                            for (const child of children) {
                                if (trySetChild(child, true)) changed = true
                            }
                            break
                        }
                        case "or": {
                            // A ∨ B accepted: if all-but-one are false, remaining must be true
                            const unknownChildren: TCorePropositionalExpression[] =
                                []
                            let allOthersAreFalse = true
                            for (const child of children) {
                                const childValue = resolveValue(child.id)
                                if (childValue === null) {
                                    unknownChildren.push(child)
                                } else if (childValue !== false) {
                                    allOthersAreFalse = false
                                }
                            }
                            if (
                                unknownChildren.length === 1 &&
                                allOthersAreFalse
                            ) {
                                if (trySetChild(unknownChildren[0], true))
                                    changed = true
                            }
                            break
                        }
                        case "implies": {
                            // A → B accepted: if A=true => B=true; if B=false => A=false
                            if (children.length >= 2) {
                                const leftValue = resolveValue(children[0].id)
                                const rightValue = resolveValue(children[1].id)
                                if (leftValue === true) {
                                    if (trySetChild(children[1], true))
                                        changed = true
                                }
                                if (rightValue === false) {
                                    if (trySetChild(children[0], false))
                                        changed = true
                                }
                            }
                            break
                        }
                        case "iff": {
                            // A ↔ B accepted: if A known => B matches; if B known => A matches
                            if (children.length >= 2) {
                                const leftValue = resolveValue(children[0].id)
                                const rightValue = resolveValue(children[1].id)
                                if (leftValue !== null) {
                                    if (trySetChild(children[1], leftValue))
                                        changed = true
                                }
                                if (rightValue !== null) {
                                    if (trySetChild(children[0], rightValue))
                                        changed = true
                                }
                            }
                            break
                        }
                    }
                } else {
                    // state === "rejected" — expression forced false
                    switch (op) {
                        case "not": {
                            // ¬A rejected (= false) => child must be true
                            if (children.length > 0) {
                                if (trySetChild(children[0], true))
                                    changed = true
                            }
                            break
                        }
                        case "and": {
                            // A ∧ B rejected (= false): if all-but-one are true, remaining must be false
                            const unknownChildren: TCorePropositionalExpression[] =
                                []
                            let allOthersAreTrue = true
                            for (const child of children) {
                                const childValue = resolveValue(child.id)
                                if (childValue === null) {
                                    unknownChildren.push(child)
                                } else if (childValue !== true) {
                                    allOthersAreTrue = false
                                }
                            }
                            if (
                                unknownChildren.length === 1 &&
                                allOthersAreTrue
                            ) {
                                if (trySetChild(unknownChildren[0], false))
                                    changed = true
                            }
                            break
                        }
                        case "or": {
                            // A ∨ B rejected (= false) => all children must be false
                            for (const child of children) {
                                if (trySetChild(child, false)) changed = true
                            }
                            break
                        }
                        case "implies": {
                            // A → B rejected (= false) => A must be true, B must be false
                            if (children.length >= 2) {
                                if (trySetChild(children[0], true))
                                    changed = true
                                if (trySetChild(children[1], false))
                                    changed = true
                            }
                            break
                        }
                        case "iff": {
                            // A ↔ B rejected (= false): if A known => B is opposite; if B known => A is opposite
                            if (children.length >= 2) {
                                const leftValue = resolveValue(children[0].id)
                                const rightValue = resolveValue(children[1].id)
                                if (leftValue !== null) {
                                    if (trySetChild(children[1], !leftValue))
                                        changed = true
                                }
                                if (rightValue !== null) {
                                    if (trySetChild(children[0], !rightValue))
                                        changed = true
                                }
                            }
                            break
                        }
                    }
                }
            }
        }
    }

    return vars
}

/**
 * Evaluates an argument under a three-valued expression assignment.
 */
export function evaluateArgument(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCoreArgumentEvaluationOptions
): TCoreArgumentEvaluationResult {
    const validateFirst = options?.validateFirst ?? true
    if (validateFirst) {
        const validation = ctx.validateEvaluability()
        if (!validation.ok) {
            return {
                ok: false,
                validation,
            }
        }
    }

    const conclusion = ctx.getConclusionPremise()
    if (!conclusion) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ARGUMENT_NO_CONCLUSION",
                    message: "Argument has no designated conclusion premise.",
                }),
            ]),
        }
    }

    const supportingPremises = ctx.listSupportingPremises()
    const supportingIds = new Set(supportingPremises.map((pm) => pm.getId()))
    const constraintPremises = ctx
        .listPremises()
        .filter(
            (pm) =>
                pm.getId() !== ctx.conclusionPremiseId &&
                !supportingIds.has(pm.getId())
        )

    const allRelevantPremises = [
        conclusion,
        ...supportingPremises,
        ...constraintPremises,
    ]
    const allVariableIds = [
        ...new Set(
            allRelevantPremises.flatMap((pm) =>
                pm
                    .getExpressions()
                    .filter((expr) => expr.type === "variable")
                    .map((expr) => expr.variableId)
            )
        ),
    ].sort()

    // Claim-bound and externally-bound premise variables get truth-table columns;
    // internally-bound premise variables are resolved lazily.
    const referencedVariableIds = allVariableIds.filter((vid) => {
        const v = ctx.getVariable(vid)
        if (v == null) return false
        if (isClaimBound(v)) return true
        if (isPremiseBound(v) && v.boundArgumentId !== ctx.argumentId)
            return true
        return false
    })

    // Run operator constraint propagation
    const propagatedVars = propagateOperatorConstraints(ctx, assignment)
    const propagatedAssignment: TCoreExpressionAssignment = {
        variables: propagatedVars,
        operatorAssignments: assignment.operatorAssignments,
    }

    try {
        // Build a resolver that lazily evaluates premise-bound variables
        // by evaluating their bound premise's expression tree under the
        // same assignment. Results are cached per-variable per-evaluate call.
        const resolverCache = new Map<string, boolean | null>()
        const resolver = (variableId: string): boolean | null => {
            if (resolverCache.has(variableId)) {
                return resolverCache.get(variableId)!
            }
            const variable = ctx.getVariable(variableId)
            if (
                !variable ||
                !isPremiseBound(variable) ||
                variable.boundArgumentId !== ctx.argumentId
            ) {
                // Claim-bound or externally-bound: read from assignment
                return propagatedAssignment.variables[variableId] ?? null
            }
            // Internal premise-bound: lazy resolution
            const boundPremiseId = variable.boundPremiseId
            const boundPremise = ctx.getPremise(boundPremiseId)
            if (!boundPremise) {
                resolverCache.set(variableId, null)
                return null
            }
            const premiseResult = boundPremise.evaluate(propagatedAssignment, {
                resolver,
            })
            const value = premiseResult?.rootValue ?? null
            resolverCache.set(variableId, value)
            return value
        }

        const evalOpts = {
            strictUnknownKeys: options?.strictUnknownAssignmentKeys ?? false,
            resolver,
        }
        const conclusionEvaluation = conclusion.evaluate(
            propagatedAssignment,
            evalOpts
        )
        const supportingEvaluations = supportingPremises.map((pm) =>
            pm.evaluate(propagatedAssignment, evalOpts)
        )
        const constraintEvaluations = constraintPremises.map((pm) =>
            pm.evaluate(propagatedAssignment, evalOpts)
        )

        const isAdmissibleAssignment =
            constraintEvaluations.reduce<TCoreTrivalentValue>(
                (acc, result) => kleeneAnd(acc, result.rootValue ?? null),
                true
            )
        const allSupportingPremisesTrue =
            supportingEvaluations.reduce<TCoreTrivalentValue>(
                (acc, result) => kleeneAnd(acc, result.rootValue ?? null),
                true
            )
        const conclusionTrue: TCoreTrivalentValue =
            conclusionEvaluation.rootValue ?? null
        const isCounterexample = kleeneAnd(
            isAdmissibleAssignment,
            kleeneAnd(allSupportingPremisesTrue, kleeneNot(conclusionTrue))
        )

        const includeExpressionValues = options?.includeExpressionValues ?? true
        const includeDiagnostics = options?.includeDiagnostics ?? true
        const strip = (
            result: TCorePremiseEvaluationResult
        ): TCorePremiseEvaluationResult => ({
            ...result,
            expressionValues: includeExpressionValues
                ? result.expressionValues
                : {},
            inferenceDiagnostic: includeDiagnostics
                ? result.inferenceDiagnostic
                : undefined,
        })

        return {
            ok: true,
            assignment: {
                variables: { ...propagatedAssignment.variables },
                operatorAssignments: {
                    ...propagatedAssignment.operatorAssignments,
                },
            },
            referencedVariableIds,
            conclusion: strip(conclusionEvaluation),
            supportingPremises: supportingEvaluations.map(strip),
            constraintPremises: constraintEvaluations.map(strip),
            isAdmissibleAssignment,
            allSupportingPremisesTrue,
            conclusionTrue,
            isCounterexample,
            preservesTruthUnderAssignment: kleeneNot(isCounterexample),
        }
    } catch (error) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ASSIGNMENT_MISSING_VARIABLE",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Argument evaluation failed.",
                }),
            ]),
        }
    }
}

/**
 * Enumerates all 2^n variable assignments and checks for counterexamples.
 */
export function checkArgumentValidity(
    ctx: TArgumentEvaluationContext,
    options?: TCoreValidityCheckOptions
): TCoreValidityCheckResult {
    const validateFirst = options?.validateFirst ?? true
    if (validateFirst) {
        const validation = ctx.validateEvaluability()
        if (!validation.ok) {
            return {
                ok: false,
                validation,
            }
        }
    }

    const conclusion = ctx.getConclusionPremise()
    if (!conclusion) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ARGUMENT_NO_CONCLUSION",
                    message: "Argument has no designated conclusion premise.",
                }),
            ]),
        }
    }

    const supportingPremises = ctx.listSupportingPremises()
    const supportingIds = new Set(supportingPremises.map((pm) => pm.getId()))
    const constraintPremises = ctx
        .listPremises()
        .filter(
            (pm) =>
                pm.getId() !== ctx.conclusionPremiseId &&
                !supportingIds.has(pm.getId())
        )

    const allVariableIdsForCheck = [
        ...new Set(
            [conclusion, ...supportingPremises, ...constraintPremises].flatMap(
                (pm) =>
                    pm
                        .getExpressions()
                        .filter((expr) => expr.type === "variable")
                        .map((expr) => expr.variableId)
            )
        ),
    ].sort()

    // Claim-bound and externally-bound premise variables get truth-table columns;
    // internally-bound premise variables are resolved lazily.
    const checkedVariableIds = allVariableIdsForCheck.filter((vid) => {
        const v = ctx.getVariable(vid)
        if (v == null) return false
        if (isClaimBound(v)) return true
        if (isPremiseBound(v) && v.boundArgumentId !== ctx.argumentId)
            return true
        return false
    })

    if (
        options?.maxVariables !== undefined &&
        checkedVariableIds.length > options.maxVariables
    ) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ASSIGNMENT_UNKNOWN_VARIABLE",
                    message: `Validity check requires ${checkedVariableIds.length} variables, exceeding limit ${options.maxVariables}.`,
                }),
            ]),
        }
    }

    const mode = options?.mode ?? "firstCounterexample"
    const maxAssignmentsChecked = options?.maxAssignmentsChecked
    const counterexamples: TCoreCounterexample[] = []
    let numAssignmentsChecked = 0
    let numAdmissibleAssignments = 0
    let truncated = false

    const totalAssignments = 2 ** checkedVariableIds.length
    for (let mask = 0; mask < totalAssignments; mask++) {
        if (
            maxAssignmentsChecked !== undefined &&
            numAssignmentsChecked >= maxAssignmentsChecked
        ) {
            truncated = true
            break
        }

        const assignment: TCoreExpressionAssignment = {
            variables: {},
            operatorAssignments: {},
        }
        for (let i = 0; i < checkedVariableIds.length; i++) {
            assignment.variables[checkedVariableIds[i]] = Boolean(
                mask & (1 << i)
            )
        }

        const result = evaluateArgument(ctx, assignment, {
            validateFirst: false,
            includeExpressionValues:
                options?.includeCounterexampleEvaluations ?? false,
            includeDiagnostics:
                options?.includeCounterexampleEvaluations ?? false,
        })

        if (!result.ok) {
            return {
                ok: false,
                validation: result.validation,
            }
        }

        numAssignmentsChecked += 1

        if (result.isAdmissibleAssignment === true) {
            numAdmissibleAssignments += 1
        }

        if (result.isCounterexample === true) {
            counterexamples.push({
                assignment: result.assignment!,
                result,
            })
            if (mode === "firstCounterexample") {
                break
            }
        }
    }

    const foundCounterexample = counterexamples.length > 0
    const fullyChecked =
        !truncated &&
        (mode === "exhaustive" ||
            (mode === "firstCounterexample" && !foundCounterexample))

    return {
        ok: true,
        isValid: foundCounterexample ? false : fullyChecked ? true : undefined,
        checkedVariableIds,
        numAssignmentsChecked,
        numAdmissibleAssignments,
        counterexamples,
        truncated,
    }
}
