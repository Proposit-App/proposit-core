import { randomUUID } from "node:crypto"
import type {
    TCoreArgument,
    TCorePropositionalExpression,
} from "../schemata/index.js"
import type {
    TCoreArgumentEngineData,
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreArgumentRoleState,
    TCoreCounterexample,
    TCoreExpressionAssignment,
    TCorePremiseEvaluationResult,
    TCoreTrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
} from "../types/evaluation.js"
import { getOrCreate, sortedUnique } from "../utils/collections.js"
import {
    kleeneAnd,
    kleeneNot,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/shared.js"
import { PremiseManager } from "./PremiseManager.js"

/**
 * Manages a propositional logic argument composed of premises, variable
 * assignments, and logical roles (supporting premises and a conclusion).
 *
 * Provides premise CRUD, role management, evaluation of individual
 * assignments, and exhaustive validity checking via truth-table enumeration.
 */
export class ArgumentEngine {
    private argument: TCoreArgument
    private premises: Map<string, PremiseManager>
    private supportingPremiseIds: Set<string>
    private conclusionPremiseId: string | undefined

    constructor(argument: TCoreArgument) {
        this.argument = { ...argument }
        this.premises = new Map()
        this.supportingPremiseIds = new Set()
        this.conclusionPremiseId = undefined
    }

    /** Returns a shallow copy of the argument metadata. */
    public getArgument(): TCoreArgument {
        return { ...this.argument }
    }

    /**
     * Creates a new premise with an auto-generated UUID and registers it
     * with this engine.
     */
    public createPremise(metadata?: Record<string, string>): PremiseManager {
        const id = randomUUID()
        const pm = new PremiseManager(id, this.argument, metadata)
        this.premises.set(id, pm)
        return pm
    }

    /**
     * Creates a premise with a caller-supplied ID and registers it with
     * this engine.
     *
     * @throws If a premise with the given ID already exists.
     */
    public createPremiseWithId(
        id: string,
        metadata?: Record<string, string>
    ): PremiseManager {
        if (this.premises.has(id)) {
            throw new Error(`Premise "${id}" already exists.`)
        }
        const pm = new PremiseManager(id, this.argument, metadata)
        this.premises.set(id, pm)
        return pm
    }

    /**
     * Removes a premise and clears any role assignments that reference it.
     * No-op if the premise does not exist.
     */
    public removePremise(premiseId: string): void {
        this.premises.delete(premiseId)
        this.supportingPremiseIds.delete(premiseId)
        if (this.conclusionPremiseId === premiseId) {
            this.conclusionPremiseId = undefined
        }
    }

    /** Returns the premise with the given ID, or `undefined` if not found. */
    public getPremise(premiseId: string): PremiseManager | undefined {
        return this.premises.get(premiseId)
    }

    /** Returns `true` if a premise with the given ID exists. */
    public hasPremise(premiseId: string): boolean {
        return this.premises.has(premiseId)
    }

    /** Returns all premise IDs in lexicographic order. */
    public listPremiseIds(): string[] {
        return Array.from(this.premises.keys()).sort((a, b) =>
            a.localeCompare(b)
        )
    }

    /** Returns all premises in lexicographic ID order. */
    public listPremises(): PremiseManager[] {
        return this.listPremiseIds()
            .map((id) => this.premises.get(id))
            .filter((pm): pm is PremiseManager => pm !== undefined)
    }

    /** Returns the current role assignments (conclusion and supporting premise IDs). */
    public getRoleState(): TCoreArgumentRoleState {
        return {
            supportingPremiseIds: sortedUnique(this.supportingPremiseIds),
            conclusionPremiseId: this.conclusionPremiseId,
        }
    }

    /**
     * Designates a premise as the argument's conclusion.
     *
     * @throws If the premise does not exist.
     * @throws If the premise is already a supporting premise.
     */
    public setConclusionPremise(premiseId: string): void {
        if (!this.hasPremise(premiseId)) {
            throw new Error(`Premise "${premiseId}" does not exist.`)
        }
        if (this.supportingPremiseIds.has(premiseId)) {
            throw new Error(
                `Premise "${premiseId}" is already a supporting premise and cannot also be the conclusion.`
            )
        }
        this.conclusionPremiseId = premiseId
    }

    /** Clears the conclusion designation. */
    public clearConclusionPremise(): void {
        this.conclusionPremiseId = undefined
    }

    /** Returns the conclusion premise, or `undefined` if none is set. */
    public getConclusionPremise(): PremiseManager | undefined {
        if (this.conclusionPremiseId === undefined) {
            return undefined
        }
        return this.premises.get(this.conclusionPremiseId)
    }

    /**
     * Adds a premise to the supporting role.
     *
     * @throws If the premise does not exist.
     * @throws If the premise is the conclusion.
     */
    public addSupportingPremise(premiseId: string): void {
        if (!this.hasPremise(premiseId)) {
            throw new Error(`Premise "${premiseId}" does not exist.`)
        }
        if (this.conclusionPremiseId === premiseId) {
            throw new Error(
                `Premise "${premiseId}" is the conclusion and cannot also be supporting.`
            )
        }
        this.supportingPremiseIds.add(premiseId)
    }

    /** Removes a premise from the supporting role. No-op if not supporting. */
    public removeSupportingPremise(premiseId: string): void {
        this.supportingPremiseIds.delete(premiseId)
    }

    /** Returns all supporting premises in lexicographic ID order. */
    public listSupportingPremises(): PremiseManager[] {
        return sortedUnique(this.supportingPremiseIds)
            .map((id) => this.premises.get(id))
            .filter((pm): pm is PremiseManager => pm !== undefined)
    }

    /** Returns a serializable snapshot of the full engine state. */
    public toData(): TCoreArgumentEngineData {
        return {
            argument: { ...this.argument },
            premises: this.listPremises().map((pm) => pm.toData()),
            roles: this.getRoleState(),
        }
    }

    /** Alias for {@link toData}. */
    public exportState(): TCoreArgumentEngineData {
        return this.toData()
    }

    /**
     * Collects all variables referenced by expressions across all premises,
     * indexed both by variable ID and by symbol.
     */
    public collectReferencedVariables(): {
        variableIds: string[]
        byId: Record<string, { symbol: string; premiseIds: string[] }>
        bySymbol: Record<
            string,
            { variableIds: string[]; premiseIds: string[] }
        >
    } {
        const byIdTmp = new Map<
            string,
            { symbols: Set<string>; premiseIds: Set<string> }
        >()
        const bySymbolTmp = new Map<
            string,
            { variableIds: Set<string>; premiseIds: Set<string> }
        >()

        for (const premise of this.listPremises()) {
            const premiseId = premise.getId()
            const varsById = new Map(
                premise.getVariables().map((v) => [v.id, v])
            )
            for (const expr of premise.getExpressions()) {
                if (expr.type !== "variable") continue
                const variable = varsById.get(expr.variableId)
                if (!variable) continue

                const byIdEntry = getOrCreate(byIdTmp, variable.id, () => ({
                    symbols: new Set<string>(),
                    premiseIds: new Set<string>(),
                }))
                byIdEntry.symbols.add(variable.symbol)
                byIdEntry.premiseIds.add(premiseId)

                const bySymbolEntry = getOrCreate(
                    bySymbolTmp,
                    variable.symbol,
                    () => ({
                        variableIds: new Set<string>(),
                        premiseIds: new Set<string>(),
                    })
                )
                bySymbolEntry.variableIds.add(variable.id)
                bySymbolEntry.premiseIds.add(premiseId)
            }
        }

        const byId: Record<string, { symbol: string; premiseIds: string[] }> =
            {}
        for (const [variableId, entry] of Array.from(byIdTmp.entries()).sort(
            (a, b) => a[0].localeCompare(b[0])
        )) {
            byId[variableId] = {
                symbol: sortedUnique(entry.symbols)[0] ?? "",
                premiseIds: sortedUnique(entry.premiseIds),
            }
        }

        const bySymbol: Record<
            string,
            { variableIds: string[]; premiseIds: string[] }
        > = {}
        for (const [symbol, entry] of Array.from(bySymbolTmp.entries()).sort(
            (a, b) => a[0].localeCompare(b[0])
        )) {
            bySymbol[symbol] = {
                variableIds: sortedUnique(entry.variableIds),
                premiseIds: sortedUnique(entry.premiseIds),
            }
        }

        return {
            variableIds: sortedUnique(byIdTmp.keys()),
            byId,
            bySymbol,
        }
    }

    /**
     * Validates that this argument is structurally ready for evaluation:
     * a conclusion must be set, all role references must point to existing
     * premises, variable ID/symbol mappings must be consistent, and every
     * premise must be individually evaluable.
     */
    public validateEvaluability(): TCoreValidationResult {
        const issues: TCoreValidationIssue[] = []

        if (this.conclusionPremiseId === undefined) {
            issues.push(
                makeErrorIssue({
                    code: "ARGUMENT_NO_CONCLUSION",
                    message: "Argument has no designated conclusion premise.",
                })
            )
        } else if (!this.premises.has(this.conclusionPremiseId)) {
            issues.push(
                makeErrorIssue({
                    code: "ARGUMENT_CONCLUSION_NOT_FOUND",
                    message: `Conclusion premise "${this.conclusionPremiseId}" does not exist.`,
                    premiseId: this.conclusionPremiseId,
                })
            )
        }

        for (const premiseId of sortedUnique(this.supportingPremiseIds)) {
            if (!this.premises.has(premiseId)) {
                issues.push(
                    makeErrorIssue({
                        code: "ARGUMENT_SUPPORTING_PREMISE_NOT_FOUND",
                        message: `Supporting premise "${premiseId}" does not exist.`,
                        premiseId,
                    })
                )
            }
        }

        if (
            this.conclusionPremiseId !== undefined &&
            this.supportingPremiseIds.has(this.conclusionPremiseId)
        ) {
            issues.push(
                makeErrorIssue({
                    code: "ARGUMENT_ROLE_OVERLAP",
                    message: `Premise "${this.conclusionPremiseId}" cannot be both supporting and conclusion.`,
                    premiseId: this.conclusionPremiseId,
                })
            )
        }

        const idToSymbols = new Map<string, Set<string>>()
        const symbolToIds = new Map<string, Set<string>>()
        for (const premise of this.listPremises()) {
            const varById = new Map(
                premise.getVariables().map((v) => [v.id, v])
            )
            for (const expr of premise.getExpressions()) {
                if (expr.type !== "variable") continue
                const variable = varById.get(expr.variableId)
                if (!variable) continue
                getOrCreate(idToSymbols, variable.id, () => new Set()).add(
                    variable.symbol
                )
                getOrCreate(symbolToIds, variable.symbol, () => new Set()).add(
                    variable.id
                )
            }
        }

        for (const [variableId, symbols] of idToSymbols) {
            if (symbols.size > 1) {
                issues.push(
                    makeErrorIssue({
                        code: "ARGUMENT_VARIABLE_ID_SYMBOL_MISMATCH",
                        message: `Variable ID "${variableId}" is used with multiple symbols: ${sortedUnique(symbols).join(", ")}.`,
                        variableId,
                    })
                )
            }
        }

        for (const [symbol, ids] of symbolToIds) {
            if (ids.size > 1) {
                issues.push(
                    makeErrorIssue({
                        code: "ARGUMENT_VARIABLE_SYMBOL_AMBIGUOUS",
                        message: `Variable symbol "${symbol}" is used with multiple IDs: ${sortedUnique(ids).join(", ")}.`,
                    })
                )
            }
        }

        for (const premise of this.listPremises()) {
            const premiseValidation = premise.validateEvaluability()
            issues.push(...premiseValidation.issues)
        }

        return makeValidationResult(issues)
    }

    /**
     * Evaluates the argument under a three-valued expression assignment.
     *
     * Variables may be `true`, `false`, or `null` (unknown). Expressions
     * listed in `rejectedExpressionIds` evaluate to `false` (children
     * skipped). All result flags (`isAdmissibleAssignment`,
     * `allSupportingPremisesTrue`, `conclusionTrue`, `isCounterexample`,
     * `preservesTruthUnderAssignment`) are three-valued: `null` means
     * the result is indeterminate due to unknown variable values.
     *
     * Returns `{ ok: false }` with validation details if the argument is
     * not structurally evaluable.
     */
    public evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult {
        const validateFirst = options?.validateFirst ?? true
        if (validateFirst) {
            const validation = this.validateEvaluability()
            if (!validation.ok) {
                return {
                    ok: false,
                    validation,
                }
            }
        }

        const conclusion = this.getConclusionPremise()
        if (!conclusion) {
            return {
                ok: false,
                validation: makeValidationResult([
                    makeErrorIssue({
                        code: "ARGUMENT_NO_CONCLUSION",
                        message:
                            "Argument has no designated conclusion premise.",
                    }),
                ]),
            }
        }

        const supportingPremises = this.listSupportingPremises()
        const roleIds = new Set<string>([
            conclusion.getId(),
            ...supportingPremises.map((pm) => pm.getId()),
        ])
        const constraintPremises = this.listPremises().filter(
            (pm) => !roleIds.has(pm.getId()) && pm.isConstraint()
        )

        const allRelevantPremises = [
            conclusion,
            ...supportingPremises,
            ...constraintPremises,
        ]
        const referencedVariableIds = sortedUnique(
            allRelevantPremises.flatMap((pm) =>
                pm
                    .getExpressions()
                    .filter(
                        (
                            expr
                        ): expr is TCorePropositionalExpression<"variable"> =>
                            expr.type === "variable"
                    )
                    .map((expr) => expr.variableId)
            )
        )

        try {
            const evalOpts = {
                strictUnknownKeys:
                    options?.strictUnknownAssignmentKeys ?? false,
            }
            const conclusionEvaluation = conclusion.evaluate(
                assignment,
                evalOpts
            )
            const supportingEvaluations = supportingPremises.map((pm) =>
                pm.evaluate(assignment, evalOpts)
            )
            const constraintEvaluations = constraintPremises.map((pm) =>
                pm.evaluate(assignment, evalOpts)
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

            const includeExpressionValues =
                options?.includeExpressionValues ?? true
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
                    variables: { ...assignment.variables },
                    rejectedExpressionIds: [
                        ...assignment.rejectedExpressionIds,
                    ],
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
     *
     * A counterexample is an admissible assignment where all supporting
     * premises are true but the conclusion is false. The argument is valid
     * if no counterexamples exist.
     *
     * Supports early termination (`firstCounterexample` mode) and
     * configurable limits on variables and assignments checked.
     */
    public checkValidity(
        options?: TCoreValidityCheckOptions
    ): TCoreValidityCheckResult {
        const validateFirst = options?.validateFirst ?? true
        if (validateFirst) {
            const validation = this.validateEvaluability()
            if (!validation.ok) {
                return {
                    ok: false,
                    validation,
                }
            }
        }

        const conclusion = this.getConclusionPremise()
        if (!conclusion) {
            return {
                ok: false,
                validation: makeValidationResult([
                    makeErrorIssue({
                        code: "ARGUMENT_NO_CONCLUSION",
                        message:
                            "Argument has no designated conclusion premise.",
                    }),
                ]),
            }
        }

        const supportingPremises = this.listSupportingPremises()
        const roleIds = new Set<string>([
            conclusion.getId(),
            ...supportingPremises.map((pm) => pm.getId()),
        ])
        const constraintPremises = this.listPremises().filter(
            (pm) => !roleIds.has(pm.getId()) && pm.isConstraint()
        )

        const checkedVariableIds = sortedUnique(
            [conclusion, ...supportingPremises, ...constraintPremises].flatMap(
                (pm) =>
                    pm
                        .getExpressions()
                        .filter(
                            (
                                expr
                            ): expr is TCorePropositionalExpression<"variable"> =>
                                expr.type === "variable"
                        )
                        .map((expr) => expr.variableId)
            )
        )

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
                rejectedExpressionIds: [],
            }
            for (let i = 0; i < checkedVariableIds.length; i++) {
                assignment.variables[checkedVariableIds[i]] = Boolean(
                    mask & (1 << i)
                )
            }

            const result = this.evaluate(assignment, {
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
            isValid: foundCounterexample
                ? false
                : fullyChecked
                  ? true
                  : undefined,
            checkedVariableIds,
            numAssignmentsChecked,
            numAdmissibleAssignments,
            counterexamples,
            truncated,
        }
    }
}
