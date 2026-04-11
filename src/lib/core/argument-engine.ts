import {
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCoreArgument,
    type TCoreClaim,
    type TCoreClaimSourceAssociation,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TOptionalChecksum,
    type TCoreSource,
} from "../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreArgumentRoleState,
    TCoreExpressionAssignment,
    TCoreValidationResult,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
} from "../types/evaluation.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import {
    DEFAULT_GRAMMAR_CONFIG,
    PERMISSIVE_GRAMMAR_CONFIG,
    type TGrammarConfig,
} from "../types/grammar.js"
import type { TCorePositionConfig } from "../utils/position.js"
import type { TInvariantValidationResult } from "../types/validation.js"
import {
    DEFAULT_CHECKSUM_CONFIG,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "../consts.js"
import type { TCoreMutationResult, TCoreChangeset } from "../types/mutation.js"
import type {
    TReactiveSnapshot,
    TReactivePremiseSnapshot,
} from "../types/reactive.js"
import { ChangeCollector } from "./change-collector.js"
import { canonicalSerialize, computeHash, entityChecksum } from "./checksum.js"
import {
    evaluateArgument as evaluateArgumentStandalone,
    checkArgumentValidity as checkArgumentValidityStandalone,
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "./evaluation/argument-evaluation.js"
import {
    validateArgument as validateArgumentStandalone,
    validateArgumentAfterPremiseMutation as validateAfterPremiseMutationStandalone,
    validateArgumentEvaluability as validateArgumentEvaluabilityStandalone,
    collectArgumentReferencedVariables as collectArgumentReferencedVariablesStandalone,
    type TArgumentValidationContext,
    type TValidatablePremise,
} from "./argument-validation.js"
import type { TExpressionInput } from "./expression-manager.js"
import { InvariantViolationError } from "./invariant-violation-error.js"
import { PremiseEngine } from "./premise-engine.js"
import type { TPremiseEngineSnapshot } from "./premise-engine.js"
import { VariableManager } from "./variable-manager.js"
import type { TVariableManagerSnapshot } from "./variable-manager.js"
import type {
    TPremiseCrud,
    TVariableManagement,
    TArgumentExpressionQueries,
    TArgumentRoleState,
    TArgumentEvaluation,
    TArgumentLifecycle,
    TArgumentIdentity,
    TDisplayable,
    THierarchicalChecksummable,
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
} from "./interfaces/index.js"

/** Default ID generator using the Web Crypto API (Node.js 20+, all modern browsers). */
export const defaultGenerateId = (): string => globalThis.crypto.randomUUID()

export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
    grammarConfig?: TGrammarConfig
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}

export type TArgumentEngineSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    argument: TOptionalChecksum<TArg>
    variables: TVariableManagerSnapshot<TVar>
    premises: TPremiseEngineSnapshot<TPremise, TExpr>[]
    conclusionPremiseId?: string
    config?: TLogicEngineOptions
}

/**
 * Manages a propositional logic argument composed of premises, variable
 * assignments, and logical roles (supporting premises and a conclusion).
 *
 * Provides premise CRUD, role management, evaluation of individual
 * assignments, and exhaustive validity checking via truth-table enumeration.
 */
export class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
>
    implements
        TPremiseCrud<TArg, TPremise, TExpr, TVar>,
        TVariableManagement<TArg, TPremise, TExpr, TVar>,
        TArgumentExpressionQueries<TExpr>,
        TArgumentRoleState<TArg, TPremise, TExpr, TVar>,
        TArgumentEvaluation,
        TArgumentLifecycle<TArg, TPremise, TExpr, TVar>,
        TArgumentIdentity<TArg>,
        TDisplayable,
        THierarchicalChecksummable<"premises" | "variables">
{
    private argument: TOptionalChecksum<TArg>
    private premises: Map<string, PremiseEngine<TArg, TPremise, TExpr, TVar>>
    private variables: VariableManager<TVar>
    private claimLibrary: TClaimLookup<TClaim>
    private sourceLibrary: TSourceLookup<TSource>
    private claimSourceLibrary: TClaimSourceLookup<TAssoc>
    private conclusionPremiseId: string | undefined
    private checksumConfig?: TCoreChecksumConfig
    private positionConfig?: TCorePositionConfig
    private grammarConfig?: TGrammarConfig
    private generateId: () => string
    private restoringFromSnapshot = false
    private checksumDirty = true
    private cachedMetaChecksum: string | undefined
    private cachedDescendantChecksum: string | null | undefined
    private cachedCombinedChecksum: string | undefined
    private cachedPremisesCollectionChecksum: string | null | undefined
    private cachedVariablesCollectionChecksum: string | null | undefined
    private expressionIndex: Map<string, string>
    private listeners = new Set<() => void>()
    private reactiveDirty = {
        argument: true,
        variables: true,
        roles: true,
        premiseIds: new Set<string>(),
        allPremises: true,
    }
    private cachedReactiveSnapshot:
        | TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
        | undefined

    constructor(
        argument: TOptionalChecksum<TArg>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        claimSourceLibrary: TClaimSourceLookup<TAssoc>,
        options?: TLogicEngineOptions
    ) {
        this.argument = { ...argument }
        this.claimLibrary = claimLibrary
        this.sourceLibrary = sourceLibrary
        this.claimSourceLibrary = claimSourceLibrary
        this.premises = new Map()
        this.checksumConfig = options?.checksumConfig
        this.positionConfig = options?.positionConfig
        this.grammarConfig = options?.grammarConfig
        this.generateId = options?.generateId ?? defaultGenerateId
        this.variables = new VariableManager<TVar>({
            checksumConfig: this.checksumConfig,
            positionConfig: this.positionConfig,
            generateId: this.generateId,
        })
        this.expressionIndex = new Map()
        this.conclusionPremiseId = undefined
    }

    private createCircularityCheck(): (
        variableId: string,
        premiseId: string
    ) => boolean {
        return (variableId: string, targetPremiseId: string): boolean => {
            return this.wouldCreateCycle(variableId, targetPremiseId, new Set())
        }
    }

    private wouldCreateCycle(
        variableId: string,
        targetPremiseId: string,
        visited: Set<string>
    ): boolean {
        const variable = this.variables.getVariable(variableId)
        if (!variable) return false

        if (!isPremiseBound(variable)) return false

        const bound = variable as unknown as TPremiseBoundVariable
        if (bound.boundPremiseId === targetPremiseId) return true

        if (visited.size >= this.premises.size) {
            throw new Error(
                `Circularity check depth limit exceeded (visited ${visited.size} premises).`
            )
        }

        if (visited.has(bound.boundPremiseId)) return false
        visited.add(bound.boundPremiseId)

        const boundPremise = this.premises.get(bound.boundPremiseId)
        if (!boundPremise) return false

        for (const expr of boundPremise.getExpressions()) {
            if (expr.type === "variable") {
                if (
                    this.wouldCreateCycle(
                        expr.variableId,
                        targetPremiseId,
                        visited
                    )
                ) {
                    return true
                }
            }
        }

        return false
    }

    private wireCircularityCheck(
        pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
    ): void {
        pm.setCircularityCheck(this.createCircularityCheck())
    }

    private wireEmptyBoundPremiseCheck(
        pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
    ): void {
        pm.setEmptyBoundPremiseCheck((variableId: string) => {
            const v = this.variables.getVariable(variableId)
            if (
                !v ||
                !isPremiseBound(v as unknown as TCorePropositionalVariable)
            )
                return false
            const boundPremise = this.premises.get(
                (v as TPremiseBoundVariable).boundPremiseId
            )
            return !boundPremise?.getRootExpressionId()
        })
    }

    private generateUniqueSymbol(): string {
        let n = this.premises.size - 1
        let candidate = `P${n}`
        while (this.variables.getVariableBySymbol(candidate) !== undefined) {
            n++
            candidate = `P${n}`
        }
        return candidate
    }

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    protected notifySubscribers(): void {
        for (const listener of this.listeners) {
            listener()
        }
    }

    private finalizeChanges(
        collector: ChangeCollector<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return changes
    }

    private static readonly skipValidationResult: TInvariantValidationResult = {
        ok: true,
        violations: [],
    }

    private suppressPremiseValidation(): void {
        for (const pe of this.premises.values()) {
            pe.setArgumentValidateCallback(
                () => ArgumentEngine.skipValidationResult
            )
        }
    }

    private restorePremiseValidation(): void {
        for (const pe of this.premises.values()) {
            pe.setArgumentValidateCallback(() =>
                this.validateAfterPremiseMutation()
            )
        }
    }

    protected withValidation<T>(fn: () => T): T {
        if (this.restoringFromSnapshot) {
            return fn()
        }
        const snap = this.snapshot()
        // Suppress PremiseEngine-level validation during ArgumentEngine
        // mutations. The ArgumentEngine will do its own validation at the end.
        this.suppressPremiseValidation()
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.rollbackInternal(snap)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.rollbackInternal(snap)
            }
            throw e
        } finally {
            this.restorePremiseValidation()
        }
    }

    public getSnapshot = (): TReactiveSnapshot<TArg, TPremise, TExpr, TVar> => {
        return this.buildReactiveSnapshot()
    }

    protected buildReactiveSnapshot(): TReactiveSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar
    > {
        const dirty = this.reactiveDirty
        const prev = this.cachedReactiveSnapshot

        if (
            prev &&
            !dirty.argument &&
            !dirty.variables &&
            !dirty.roles &&
            dirty.premiseIds.size === 0 &&
            !dirty.allPremises
        ) {
            return prev
        }

        const argument =
            dirty.argument || !prev ? this.getArgument() : prev.argument

        const variables =
            dirty.variables || !prev
                ? this.buildVariablesRecord()
                : prev.variables

        const roles =
            dirty.roles || !prev ? { ...this.getRoleState() } : prev.roles

        let premises: Record<string, TReactivePremiseSnapshot<TPremise, TExpr>>
        if (dirty.allPremises || !prev) {
            premises = this.buildAllPremisesRecord()
        } else {
            premises = { ...prev.premises }
            // Remove premises that no longer exist
            for (const id of Object.keys(premises)) {
                if (!this.premises.has(id)) {
                    delete premises[id]
                }
            }
            // Rebuild dirty premises
            for (const id of dirty.premiseIds) {
                const pm = this.premises.get(id)
                if (pm) {
                    premises[id] = this.buildPremiseRecord(pm)
                } else {
                    delete premises[id]
                }
            }
            // Add any new premises not yet in snapshot
            for (const [id, pm] of this.premises) {
                if (!(id in premises)) {
                    premises[id] = this.buildPremiseRecord(pm)
                }
            }
        }

        const snapshot: TReactiveSnapshot<TArg, TPremise, TExpr, TVar> = {
            argument,
            variables,
            premises,
            roles,
        }

        this.cachedReactiveSnapshot = snapshot
        this.reactiveDirty = {
            argument: false,
            variables: false,
            roles: false,
            premiseIds: new Set(),
            allPremises: false,
        }

        return snapshot
    }

    private buildVariablesRecord(): Record<string, TVar> {
        const result: Record<string, TVar> = {}
        for (const v of this.variables.toArray()) {
            result[v.id] = v
        }
        return result
    }

    private buildAllPremisesRecord(): Record<
        string,
        TReactivePremiseSnapshot<TPremise, TExpr>
    > {
        const result: Record<
            string,
            TReactivePremiseSnapshot<TPremise, TExpr>
        > = {}
        for (const [id, pm] of this.premises) {
            result[id] = this.buildPremiseRecord(pm)
        }
        return result
    }

    private buildPremiseRecord(
        pm: PremiseEngine<TArg, TPremise, TExpr, TVar>
    ): TReactivePremiseSnapshot<TPremise, TExpr> {
        const expressions: Record<string, TExpr> = {}
        for (const expr of pm.getExpressions()) {
            expressions[expr.id] = expr
        }
        return {
            premise: pm.toPremiseData(),
            expressions,
            rootExpressionId: pm.getRootExpressionId(),
        }
    }

    private markReactiveDirty(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): void {
        if (changes.argument) {
            this.reactiveDirty.argument = true
        }
        if (changes.variables) {
            this.reactiveDirty.variables = true
        }
        if (changes.roles) {
            this.reactiveDirty.roles = true
        }
        if (changes.expressions) {
            const allExprs = [
                ...changes.expressions.added,
                ...changes.expressions.modified,
                ...changes.expressions.removed,
            ]
            for (const expr of allExprs) {
                this.reactiveDirty.premiseIds.add(
                    (expr as unknown as { premiseId: string }).premiseId
                )
            }
        }
        if (changes.premises) {
            for (const p of [
                ...changes.premises.added,
                ...changes.premises.modified,
                ...changes.premises.removed,
            ]) {
                this.reactiveDirty.premiseIds.add(p.id)
            }
        }
    }

    public getArgument(): TArg {
        this.flushChecksums()
        return {
            ...this.argument,
            checksum: this.cachedMetaChecksum!,
            descendantChecksum: this.cachedDescendantChecksum!,
            combinedChecksum: this.cachedCombinedChecksum!,
        } as TArg
    }

    public getExtras(): Record<string, unknown> {
        const {
            id: _id,
            version: _version,
            checksum: _checksum,
            descendantChecksum: _descendantChecksum,
            combinedChecksum: _combinedChecksum,
            ...extras
        } = this.argument as Record<string, unknown>
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
        const { id, version, checksum, descendantChecksum, combinedChecksum } =
            this.argument as Record<string, unknown>
        this.argument = {
            ...extras,
            id,
            version,
            ...(checksum !== undefined ? { checksum } : {}),
            ...(descendantChecksum !== undefined ? { descendantChecksum } : {}),
            ...(combinedChecksum !== undefined ? { combinedChecksum } : {}),
        } as TOptionalChecksum<TArg>
        this.markDirty()

        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        this.flushChecksums()
        collector.setArgument(this.getArgument())

        return { result: this.getExtras(), changes: collector.toChangeset() }
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

    public toDisplayString(): string {
        const lines: string[] = []
        const arg = this.getArgument()
        lines.push(`Argument: ${arg.id} (v${arg.version})`)
        lines.push("")

        const supportingIds = new Set(
            this.listSupportingPremises().map((pe) => pe.getId())
        )

        for (const pe of this.listPremises()) {
            let role: string
            if (pe.getId() === this.conclusionPremiseId) {
                role = "Conclusion"
            } else if (supportingIds.has(pe.getId())) {
                role = "Supporting"
            } else {
                role = "Constraint"
            }
            const display = pe.toDisplayString() || "(empty)"
            lines.push(`[${role}] ${display}`)
        }

        return lines.join("\n")
    }

    public createPremise(
        extras?: Record<string, unknown>,
        symbol?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.createPremiseWithId(this.generateId(), extras, symbol)
    }

    public createPremiseWithId(
        id: string,
        extras?: Record<string, unknown>,
        symbol?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.withValidation(() => {
            if (this.premises.has(id)) {
                throw new Error(`Premise "${id}" already exists.`)
            }
            const premiseData = {
                ...extras,
                id,
                argumentId: this.argument.id,
                argumentVersion: this.argument.version,
            } as TOptionalChecksum<TPremise>
            const pm = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
                premiseData,
                {
                    argument: this.argument,
                    variables: this.variables,
                    expressionIndex: this.expressionIndex,
                },
                {
                    checksumConfig: this.checksumConfig,
                    positionConfig: this.positionConfig,
                    grammarConfig: this.grammarConfig,
                    generateId: this.generateId,
                }
            )
            this.premises.set(id, pm)
            this.wireCircularityCheck(pm)
            this.wireEmptyBoundPremiseCheck(pm)
            pm.setVariableIdsCallback(
                () => new Set(this.variables.toArray().map((v) => v.id))
            )
            pm.setArgumentValidateCallback(() =>
                this.validateAfterPremiseMutation()
            )
            pm.setOnMutate(() => {
                this.markDirty()
                this.reactiveDirty.premiseIds.add(id)
                this.notifySubscribers()
            })
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.addedPremise(pm.toPremiseData())
            this.markDirty()

            if (this.conclusionPremiseId === undefined) {
                this.conclusionPremiseId = id
                collector.setRoles(this.getRoleState())
            }

            // Auto-create a premise-bound variable for this premise
            if (!this.restoringFromSnapshot) {
                const autoSymbol = symbol ?? this.generateUniqueSymbol()
                const autoVariable = {
                    id: this.generateId(),
                    argumentId: this.argument.id,
                    argumentVersion: this.argument.version as number,
                    symbol: autoSymbol,
                    boundPremiseId: id,
                    boundArgumentId: this.argument.id,
                    boundArgumentVersion: this.argument.version as number,
                } as TOptionalChecksum<TPremiseBoundVariable>
                const withChecksum = this.attachVariableChecksum({
                    ...autoVariable,
                } as unknown as TOptionalChecksum<TVar>)
                this.variables.addVariable(withChecksum)
                collector.addedVariable(withChecksum)
                this.markAllPremisesDirty()
            }

            const changes = this.finalizeChanges(collector)
            return {
                result: pm,
                changes,
            }
        })
    }

    public removePremise(
        premiseId: string
    ): TCoreMutationResult<TPremise | undefined, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const pm = this.premises.get(premiseId)
            if (!pm) return { result: undefined, changes: {} }
            const data = pm.toPremiseData()
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            // Clean up expression index for removed premise's expressions
            for (const expr of pm.getExpressions()) {
                this.expressionIndex.delete(expr.id)
            }
            this.premises.delete(premiseId)
            collector.removedPremise(data)
            if (this.conclusionPremiseId === premiseId) {
                this.conclusionPremiseId = undefined
                collector.setRoles(this.getRoleState())
            }
            // Cascade: remove variables bound to the deleted premise
            const boundVars = this.getVariablesBoundToPremise(premiseId)
            for (const v of boundVars) {
                const removeResult = this.removeVariableCore(v.id)
                if (removeResult.changes.variables) {
                    for (const rv of removeResult.changes.variables.removed) {
                        collector.removedVariable(rv)
                    }
                }
                if (removeResult.changes.expressions) {
                    for (const re of removeResult.changes.expressions.removed) {
                        collector.removedExpression(re)
                    }
                }
            }
            const changes = this.finalizeChanges(collector)
            return {
                result: data,
                changes,
            }
        })
    }

    public getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined {
        return this.premises.get(premiseId)
    }

    public hasPremise(premiseId: string): boolean {
        return this.premises.has(premiseId)
    }

    public listPremiseIds(): string[] {
        return Array.from(this.premises.keys()).sort((a, b) =>
            a.localeCompare(b)
        )
    }

    public listPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[] {
        return this.listPremiseIds()
            .map((id) => this.premises.get(id))
            .filter(
                (pm): pm is PremiseEngine<TArg, TPremise, TExpr, TVar> =>
                    pm !== undefined
            )
    }

    public addVariable(
        variable: TOptionalChecksum<TClaimBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            // Only claim-bound variables may be added via addVariable.
            // Premise-bound variables must use bindVariableToPremise.
            if (
                !isClaimBound(variable as unknown as TCorePropositionalVariable)
            ) {
                throw new Error(
                    "addVariable only accepts claim-bound variables. Use bindVariableToPremise for premise-bound variables."
                )
            }
            if (variable.argumentId !== this.argument.id) {
                throw new Error(
                    `Variable argumentId "${variable.argumentId}" does not match engine argument ID "${this.argument.id}".`
                )
            }
            if (variable.argumentVersion !== this.argument.version) {
                throw new Error(
                    `Variable argumentVersion "${variable.argumentVersion}" does not match engine argument version "${this.argument.version}".`
                )
            }
            // Validate claim reference
            if (
                !this.claimLibrary.get(variable.claimId, variable.claimVersion)
            ) {
                throw new Error(
                    `Claim "${variable.claimId}" version ${variable.claimVersion} does not exist in the claim library.`
                )
            }
            const withChecksum = this.attachVariableChecksum({
                ...variable,
            } as unknown as TOptionalChecksum<TVar>)
            this.variables.addVariable(withChecksum)
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.addedVariable(withChecksum)
            this.markAllPremisesDirty()
            const changes = this.finalizeChanges(collector)
            return {
                result: withChecksum,
                changes,
            }
        })
    }

    public bindVariableToPremise(
        variable: TOptionalChecksum<TPremiseBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            if (variable.argumentId !== this.argument.id) {
                throw new Error(
                    `Variable argumentId "${variable.argumentId}" does not match engine argument ID "${this.argument.id}".`
                )
            }
            if (variable.argumentVersion !== this.argument.version) {
                throw new Error(
                    `Variable argumentVersion "${variable.argumentVersion}" does not match engine argument version "${this.argument.version}".`
                )
            }
            if (variable.boundArgumentId !== this.argument.id) {
                throw new Error(
                    `Cross-argument bindings are not supported. boundArgumentId "${variable.boundArgumentId}" does not match engine argument ID "${this.argument.id}".`
                )
            }
            if (!this.premises.has(variable.boundPremiseId)) {
                throw new Error(
                    `Bound premise "${variable.boundPremiseId}" does not exist in this argument.`
                )
            }
            const withChecksum = this.attachVariableChecksum({
                ...variable,
            } as unknown as TOptionalChecksum<TVar>)
            this.variables.addVariable(withChecksum)
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.addedVariable(withChecksum)
            this.markAllPremisesDirty()
            const changes = this.finalizeChanges(collector)
            return {
                result: withChecksum,
                changes,
            }
        })
    }

    /** Adds a premise-bound variable that references a premise in a different argument. */
    public bindVariableToExternalPremise(
        variable: TOptionalChecksum<TPremiseBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            if (variable.argumentId !== this.argument.id) {
                throw new Error(
                    `Variable argumentId "${variable.argumentId}" does not match engine argument ID "${this.argument.id}".`
                )
            }
            if (variable.argumentVersion !== this.argument.version) {
                throw new Error(
                    `Variable argumentVersion "${variable.argumentVersion}" does not match engine argument version "${this.argument.version}".`
                )
            }
            if (variable.boundArgumentId === this.argument.id) {
                throw new Error(
                    `boundArgumentId matches this engine's argument — use bindVariableToPremise for internal bindings.`
                )
            }
            if (
                !this.canBind(
                    variable.boundArgumentId,
                    variable.boundArgumentVersion
                )
            ) {
                throw new Error(
                    `Binding to argument "${variable.boundArgumentId}" version ${variable.boundArgumentVersion} is not allowed.`
                )
            }
            const withChecksum = this.attachVariableChecksum({
                ...variable,
            } as unknown as TOptionalChecksum<TVar>)
            this.variables.addVariable(withChecksum)
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.addedVariable(withChecksum)
            this.markAllPremisesDirty()
            const changes = this.finalizeChanges(collector)
            return {
                result: withChecksum,
                changes,
            }
        })
    }

    /** Adds a premise-bound variable that references another argument's conclusion premise. */
    public bindVariableToArgument(
        variable: Omit<
            TOptionalChecksum<TPremiseBoundVariable>,
            "boundPremiseId"
        > &
            Record<string, unknown>,
        conclusionPremiseId: string
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        return this.bindVariableToExternalPremise({
            ...variable,
            boundPremiseId: conclusionPremiseId,
        } as TOptionalChecksum<TPremiseBoundVariable> & Record<string, unknown>)
    }

    public updateVariable(
        variableId: string,
        updates: Record<string, unknown>
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            const existing = this.variables.getVariable(variableId)
            if (!existing) {
                return { result: undefined, changes: {} }
            }

            const existingVar =
                existing as unknown as TCorePropositionalVariable
            const updatesObj = updates

            // Reject binding-type conversion
            if (isClaimBound(existingVar)) {
                const premiseBoundFields = [
                    "boundPremiseId",
                    "boundArgumentId",
                    "boundArgumentVersion",
                ] as const
                for (const f of premiseBoundFields) {
                    if (updatesObj[f] !== undefined) {
                        throw new Error(
                            `Cannot set "${f}" on a claim-bound variable. Delete and re-create to change binding type.`
                        )
                    }
                }
                // Validate: claimId and claimVersion must be provided together
                const hasClaimId = updatesObj.claimId !== undefined
                const hasClaimVersion = updatesObj.claimVersion !== undefined
                if (hasClaimId !== hasClaimVersion) {
                    throw new Error(
                        "claimId and claimVersion must be provided together."
                    )
                }
                // Validate claim reference if provided
                if (hasClaimId && hasClaimVersion) {
                    if (
                        !this.claimLibrary.get(
                            updatesObj.claimId as string,
                            updatesObj.claimVersion as number
                        )
                    ) {
                        throw new Error(
                            `Claim "${String(updatesObj.claimId)}" version ${String(updatesObj.claimVersion)} does not exist in the claim library.`
                        )
                    }
                }
            } else if (isPremiseBound(existingVar)) {
                const claimBoundFields = ["claimId", "claimVersion"] as const
                for (const f of claimBoundFields) {
                    if (updatesObj[f] !== undefined) {
                        throw new Error(
                            `Cannot set "${f}" on a premise-bound variable. Delete and re-create to change binding type.`
                        )
                    }
                }
                // Validate boundPremiseId if provided
                if (updatesObj.boundPremiseId !== undefined) {
                    const newPremiseId = updatesObj.boundPremiseId as string
                    if (!this.premises.has(newPremiseId)) {
                        throw new Error(
                            `Bound premise "${newPremiseId}" does not exist in this argument.`
                        )
                    }
                }
            }

            const updated = this.variables.updateVariable(
                variableId,
                updates as Partial<TVar>
            )
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            if (updated) {
                const withChecksum = this.attachVariableChecksum({
                    ...updated,
                })
                // Re-store with updated checksum so VariableManager always holds
                // variables with correct checksums.
                this.variables.removeVariable(variableId)
                this.variables.addVariable(withChecksum)
                collector.modifiedVariable(withChecksum)
                this.markAllPremisesDirty()
                const changes = this.finalizeChanges(collector)
                return {
                    result: withChecksum,
                    changes,
                }
            }
            return {
                result: undefined,
                changes: collector.toChangeset(),
            }
        })
    }

    private removeVariableCore(
        variableId: string
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg> {
        const variable = this.variables.getVariable(variableId)
        if (!variable) {
            return { result: undefined, changes: {} }
        }

        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()

        // Cascade: delete referencing expressions in every premise
        for (const pm of this.listPremises()) {
            const { changes } = pm.deleteExpressionsUsingVariable(variableId)
            if (changes.expressions) {
                for (const e of changes.expressions.removed) {
                    collector.removedExpression(e)
                }
            }
        }

        this.variables.removeVariable(variableId)
        collector.removedVariable(variable)
        this.markAllPremisesDirty()
        const changes = this.finalizeChanges(collector)
        return {
            result: variable,
            changes,
        }
    }

    public removeVariable(
        variableId: string
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            return this.removeVariableCore(variableId)
        })
    }

    public getVariables(): TVar[] {
        return this.variables.toArray()
    }

    public getVariable(variableId: string): TVar | undefined {
        return this.variables.getVariable(variableId)
    }

    public hasVariable(variableId: string): boolean {
        return this.variables.hasVariable(variableId)
    }

    public getVariableBySymbol(symbol: string): TVar | undefined {
        return this.variables.getVariableBySymbol(symbol)
    }

    public buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar> {
        const map = new Map<K, TVar>()
        for (const v of this.variables.toArray()) {
            map.set(keyFn(v), v)
        }
        return map
    }

    public getVariablesBoundToPremise(premiseId: string): TVar[] {
        return this.variables.toArray().filter((v) => {
            const base = v as unknown as TCorePropositionalVariable
            return isPremiseBound(base) && base.boundPremiseId === premiseId
        })
    }

    public getExpression(expressionId: string): TExpr | undefined {
        const premiseId = this.expressionIndex.get(expressionId)
        if (premiseId === undefined) return undefined
        return this.premises.get(premiseId)?.getExpression(expressionId)
    }

    public hasExpression(expressionId: string): boolean {
        return this.expressionIndex.has(expressionId)
    }

    public getExpressionPremiseId(expressionId: string): string | undefined {
        return this.expressionIndex.get(expressionId)
    }

    public findPremiseByExpressionId(
        expressionId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined {
        const premiseId = this.expressionIndex.get(expressionId)
        if (premiseId === undefined) return undefined
        return this.premises.get(premiseId)
    }

    public getAllExpressions(): TExpr[] {
        const all: TExpr[] = []
        for (const pe of this.listPremises()) {
            all.push(...pe.getExpressions())
        }
        return all.sort((a, b) => a.id.localeCompare(b.id))
    }

    public getExpressionsByVariableId(variableId: string): TExpr[] {
        const result: TExpr[] = []
        for (const pe of this.listPremises()) {
            const refIds = pe.getReferencedVariableIds()
            if (!refIds.has(variableId)) continue
            for (const expr of pe.getExpressions()) {
                if (
                    expr.type === "variable" &&
                    expr.variableId === variableId
                ) {
                    result.push(expr)
                }
            }
        }
        return result
    }

    public listRootExpressions(): TExpr[] {
        const roots: TExpr[] = []
        for (const pe of this.listPremises()) {
            const root = pe.getRootExpression()
            if (root) roots.push(root)
        }
        return roots
    }

    /**
     * Normalizes expression trees across all premises. Collapses unjustified
     * formulas, operators with 0/1 children, and inserts formula buffers where
     * needed. Works regardless of `autoNormalize` setting.
     */
    public normalizeAllExpressions(): TCoreMutationResult<
        void,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        const merged: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
        for (const pe of this.premises.values()) {
            const { changes } = pe.normalizeExpressions()
            if (changes.expressions) {
                merged.expressions ??= { added: [], modified: [], removed: [] }
                merged.expressions.added.push(...changes.expressions.added)
                merged.expressions.modified.push(
                    ...changes.expressions.modified
                )
                merged.expressions.removed.push(...changes.expressions.removed)
            }
            if (changes.premises) {
                merged.premises ??= { added: [], modified: [], removed: [] }
                merged.premises.modified.push(...changes.premises.modified)
            }
        }
        return { result: undefined, changes: merged }
    }

    public getRoleState(): TCoreArgumentRoleState {
        return {
            ...(this.conclusionPremiseId !== undefined
                ? { conclusionPremiseId: this.conclusionPremiseId }
                : {}),
        }
    }

    public setConclusionPremise(
        premiseId: string
    ): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.withValidation(() => {
            const premise = this.premises.get(premiseId)
            if (!premise) {
                throw new Error(`Premise "${premiseId}" does not exist.`)
            }
            this.conclusionPremiseId = premiseId
            const roles = this.getRoleState()
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.setRoles(roles)
            const changes = this.finalizeChanges(collector)
            return {
                result: roles,
                changes,
            }
        })
    }

    public clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.withValidation(() => {
            this.conclusionPremiseId = undefined
            const roles = this.getRoleState()
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.setRoles(roles)
            const changes = this.finalizeChanges(collector)
            return {
                result: roles,
                changes,
            }
        })
    }

    public getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar>
        | undefined {
        if (this.conclusionPremiseId === undefined) {
            return undefined
        }
        return this.premises.get(this.conclusionPremiseId)
    }

    public listSupportingPremises(): PremiseEngine<
        TArg,
        TPremise,
        TExpr,
        TVar
    >[] {
        return this.listPremises().filter(
            (pm) => pm.isInference() && pm.getId() !== this.conclusionPremiseId
        )
    }

    public snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar> {
        this.flushChecksums()
        return {
            argument: {
                ...this.argument,
                checksum: this.cachedMetaChecksum!,
                descendantChecksum: this.cachedDescendantChecksum!,
                combinedChecksum: this.cachedCombinedChecksum!,
            } as TArg,
            variables: this.variables.snapshot(),
            premises: this.listPremises().map((pe) => pe.snapshot()),
            ...(this.conclusionPremiseId !== undefined
                ? { conclusionPremiseId: this.conclusionPremiseId }
                : {}),
            config: {
                checksumConfig: serializeChecksumConfig(this.checksumConfig),
                positionConfig: this.positionConfig,
                grammarConfig: this.grammarConfig,
            } as TLogicEngineOptions,
        }
    }

    /** Creates a new ArgumentEngine from a previously captured snapshot. */
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TSource extends TCoreSource = TCoreSource,
        TClaim extends TCoreClaim = TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation =
            TCoreClaimSourceAssociation,
    >(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        claimSourceLibrary: TClaimSourceLookup<TAssoc>,
        grammarConfig?: TGrammarConfig,
        checksumVerification?: "ignore" | "strict",
        generateId?: () => string
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        const engine = new ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            snapshot.argument,
            claimLibrary,
            sourceLibrary,
            claimSourceLibrary,
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
                  : undefined
        )
        engine.restoringFromSnapshot = true
        // Restore premises first (premise-bound variables reference them)
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
                premiseSnap,
                snapshot.argument,
                engine.variables,
                engine.expressionIndex,
                grammarConfig,
                generateId
            )
            engine.premises.set(pe.getId(), pe)
            engine.wireCircularityCheck(pe)
            engine.wireEmptyBoundPremiseCheck(pe)
            pe.setVariableIdsCallback(
                () => new Set(engine.variables.toArray().map((v) => v.id))
            )
            pe.setArgumentValidateCallback(() =>
                engine.validateAfterPremiseMutation()
            )
            const premiseId = pe.getId()
            pe.setOnMutate(() => {
                engine.markDirty()
                engine.reactiveDirty.premiseIds.add(premiseId)
                engine.notifySubscribers()
            })
        }
        // Restore claim-bound variables first, then premise-bound variables
        for (const v of snapshot.variables.variables) {
            if (isClaimBound(v as unknown as TCorePropositionalVariable)) {
                engine.addVariable(
                    v as unknown as TOptionalChecksum<TClaimBoundVariable>
                )
            }
        }
        for (const v of snapshot.variables.variables) {
            if (isPremiseBound(v as unknown as TCorePropositionalVariable)) {
                const pbv = v as unknown as TPremiseBoundVariable
                if (pbv.boundArgumentId === engine.argument.id) {
                    engine.bindVariableToPremise(
                        v as unknown as TOptionalChecksum<TPremiseBoundVariable>
                    )
                } else {
                    engine.bindVariableToExternalPremise(
                        v as unknown as TOptionalChecksum<TPremiseBoundVariable>
                    )
                }
            }
        }
        // Restore conclusion role (don't use setConclusionPremise to avoid auto-assign logic)
        engine.conclusionPremiseId = snapshot.conclusionPremiseId

        engine.restoringFromSnapshot = false

        // Apply the caller's grammarConfig override to the engine and all
        // premise engines so that validate() and subsequent mutations use the
        // caller's grammar rules instead of whatever was stored in the snapshot.
        if (grammarConfig) {
            engine.grammarConfig = grammarConfig
            for (const pe of engine.premises.values()) {
                pe.setGrammarConfig(grammarConfig)
            }
        }

        // Post-load normalization: only run full normalize when autoNormalize
        // is `true` (boolean). When it is a granular config object, individual
        // flags control in-operation behavior — loading should not mutate data.
        const restoredGrammarConfig = grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
        if (restoredGrammarConfig.autoNormalize === true) {
            for (const pe of engine.premises.values()) {
                pe.normalizeExpressions()
            }
        }

        if (checksumVerification === "strict") {
            engine.flushChecksums()
            ArgumentEngine.verifySnapshotChecksums(engine, snapshot)
        }

        const validation = engine.validate()
        if (!validation.ok) {
            throw new InvariantViolationError(validation.violations)
        }

        return engine
    }

    /**
     * Creates a new ArgumentEngine from flat arrays of entities, as typically
     * stored in a relational database. Expressions are grouped by their
     * `premiseId` field and loaded in BFS order (roots first, then children
     * of already-added nodes) to satisfy parent-existence requirements.
     */
    public static fromData<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TSource extends TCoreSource = TCoreSource,
        TClaim extends TCoreClaim = TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation =
            TCoreClaimSourceAssociation,
    >(
        argument: TOptionalChecksum<TArg>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        claimSourceLibrary: TClaimSourceLookup<TAssoc>,
        variables: TOptionalChecksum<TVar>[],
        premises: TOptionalChecksum<TPremise>[],
        expressions: TExpressionInput<TExpr>[],
        roles: TCoreArgumentRoleState,
        config?: TLogicEngineOptions,
        grammarConfig?: TGrammarConfig,
        checksumVerification?: "ignore" | "strict"
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc> {
        const loadingGrammarConfig =
            grammarConfig ?? config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
        const normalizedConfig = config
            ? {
                  ...config,
                  checksumConfig: normalizeChecksumConfig(
                      config.checksumConfig
                  ),
              }
            : undefined
        const loadingConfig: TLogicEngineOptions = {
            ...normalizedConfig,
            grammarConfig: loadingGrammarConfig,
        }
        const engine = new ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(
            argument,
            claimLibrary,
            sourceLibrary,
            claimSourceLibrary,
            loadingConfig
        )
        engine.restoringFromSnapshot = true

        // Register claim-bound variables first (no dependencies)
        for (const v of variables) {
            if (isClaimBound(v as unknown as TCorePropositionalVariable)) {
                engine.addVariable(
                    v as unknown as TOptionalChecksum<TClaimBoundVariable>
                )
            }
        }

        // Create premises (premise-bound variables reference them)
        const premiseEngines = new Map<
            string,
            PremiseEngine<TArg, TPremise, TExpr, TVar>
        >()
        for (const premise of premises) {
            const {
                id: _id,
                argumentId: _argumentId,
                argumentVersion: _argumentVersion,
                checksum: _checksum,
                ...extras
            } = premise as unknown as Record<string, unknown>
            const { result: pe } = engine.createPremiseWithId(
                premise.id,
                extras
            )
            premiseEngines.set(premise.id, pe)
        }

        // Register premise-bound variables (depend on premises)
        for (const v of variables) {
            if (isPremiseBound(v as unknown as TCorePropositionalVariable)) {
                const pbv = v as unknown as TPremiseBoundVariable
                if (pbv.boundArgumentId === engine.argument.id) {
                    engine.bindVariableToPremise(
                        v as unknown as TOptionalChecksum<TPremiseBoundVariable>
                    )
                } else {
                    engine.bindVariableToExternalPremise(
                        v as unknown as TOptionalChecksum<TPremiseBoundVariable>
                    )
                }
            }
        }

        // Group expressions by premiseId
        const exprsByPremise = new Map<string, TExpressionInput<TExpr>[]>()
        for (const expr of expressions) {
            const premiseId = (expr as unknown as { premiseId: string })
                .premiseId
            let group = exprsByPremise.get(premiseId)
            if (!group) {
                group = []
                exprsByPremise.set(premiseId, group)
            }
            group.push(expr)
        }

        // Add expressions via loadExpressions (bypasses nesting check for legacy data)
        for (const [premiseId, pe] of premiseEngines) {
            const premiseExprs = exprsByPremise.get(premiseId) ?? []
            pe.loadExpressions(premiseExprs)
        }

        // Set roles (override auto-assignment)
        if (roles.conclusionPremiseId !== undefined) {
            engine.setConclusionPremise(roles.conclusionPremiseId)
        }

        // After loading: restore the caller's intended grammar config
        engine.grammarConfig = config?.grammarConfig

        engine.restoringFromSnapshot = false

        // Post-load normalization: only run full normalize when autoNormalize
        // is `true` (boolean). Granular config objects skip post-load normalization.
        const restoredGrammarConfig =
            config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
        if (restoredGrammarConfig.autoNormalize === true) {
            for (const pe of engine.premises.values()) {
                pe.normalizeExpressions()
            }
        }

        if (checksumVerification === "strict") {
            engine.flushChecksums()
            ArgumentEngine.verifyDataChecksums(
                engine,
                argument,
                variables,
                premises
            )
        }

        const validation = engine.validate()
        if (!validation.ok) {
            throw new InvariantViolationError(validation.violations)
        }

        return engine
    }

    /**
     * Verifies that all checksum fields in the snapshot match the recomputed
     * checksums on the restored engine. Throws on the first mismatch.
     */
    private static verifySnapshotChecksums<
        TArg extends TCoreArgument,
        TPremise extends TCorePremise,
        TExpr extends TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable,
        TSource extends TCoreSource,
        TClaim extends TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation,
    >(
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >,
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void {
        const checksumFields = [
            "checksum",
            "descendantChecksum",
            "combinedChecksum",
        ] as const

        // Verify expression checksums
        for (const pe of engine.listPremises()) {
            for (const expr of pe.getExpressions()) {
                const premiseSnap = snapshot.premises.find(
                    (ps) => ps.premise.id === pe.getId()
                )
                const exprSnap = premiseSnap?.expressions.expressions.find(
                    (e) => e.id === expr.id
                )
                if (exprSnap) {
                    for (const field of checksumFields) {
                        const stored = String(
                            (exprSnap as Record<string, unknown>)[field]
                        )
                        const computed = String(
                            (expr as Record<string, unknown>)[field]
                        )
                        if (stored !== "undefined" && stored !== computed) {
                            throw new Error(
                                `Checksum mismatch on expression "${expr.id}" field "${field}": stored="${stored}", computed="${computed}"`
                            )
                        }
                    }
                }
            }
        }

        // Verify variable checksums
        for (const v of engine.getVariables()) {
            const varSnap = snapshot.variables.variables.find(
                (sv) => (sv as Record<string, unknown>).id === v.id
            )
            const storedVarChecksum = varSnap
                ? String((varSnap as Record<string, unknown>).checksum)
                : undefined
            if (storedVarChecksum && storedVarChecksum !== "undefined") {
                if (storedVarChecksum !== v.checksum) {
                    throw new Error(
                        `Checksum mismatch on variable "${v.id}": stored="${storedVarChecksum}", computed="${v.checksum}"`
                    )
                }
            }
        }

        // Verify premise checksums
        for (const pe of engine.listPremises()) {
            const premiseSnap = snapshot.premises.find(
                (ps) => ps.premise.id === pe.getId()
            )
            if (premiseSnap?.premise) {
                const sp = premiseSnap.premise as Record<string, unknown>
                for (const field of checksumFields) {
                    const stored = String(sp[field])
                    const computed = pe[field]()
                    if (stored !== "undefined" && stored !== computed) {
                        throw new Error(
                            `Checksum mismatch on premise "${pe.getId()}" field "${field}": stored="${stored}", computed="${computed}"`
                        )
                    }
                }
            }
        }

        // Verify argument checksums
        const sa = snapshot.argument as Record<string, unknown>
        for (const field of checksumFields) {
            const stored = String(sa[field])
            const computed = engine[field]()
            if (stored !== "undefined" && stored !== computed) {
                throw new Error(
                    `Checksum mismatch on argument "${engine.getArgument().id}" field "${field}": stored="${stored}", computed="${computed}"`
                )
            }
        }
    }

    /**
     * Verifies that all checksum fields in the input data match the recomputed
     * checksums on the restored engine. Throws on the first mismatch.
     */
    private static verifyDataChecksums<
        TArg extends TCoreArgument,
        TPremise extends TCorePremise,
        TExpr extends TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable,
        TSource extends TCoreSource,
        TClaim extends TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation,
    >(
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >,
        argument: TOptionalChecksum<TArg>,
        variables: TOptionalChecksum<TVar>[],
        premises: TOptionalChecksum<TPremise>[]
    ): void {
        const checksumFields = [
            "checksum",
            "descendantChecksum",
            "combinedChecksum",
        ] as const

        // Verify variable checksums
        for (const v of engine.getVariables()) {
            const inputVar = variables.find(
                (iv) => (iv as Record<string, unknown>).id === v.id
            )
            const storedVarChecksum = inputVar
                ? String((inputVar as Record<string, unknown>).checksum)
                : undefined
            if (storedVarChecksum && storedVarChecksum !== "undefined") {
                if (storedVarChecksum !== v.checksum) {
                    throw new Error(
                        `Checksum mismatch on variable "${v.id}": stored="${storedVarChecksum}", computed="${v.checksum}"`
                    )
                }
            }
        }

        // Verify premise checksums
        for (const pe of engine.listPremises()) {
            const inputPremise = premises.find((p) => p.id === pe.getId())
            if (inputPremise) {
                const sp = inputPremise as Record<string, unknown>
                for (const field of checksumFields) {
                    const stored = String(sp[field])
                    const computed = pe[field]()
                    if (stored !== "undefined" && stored !== computed) {
                        throw new Error(
                            `Checksum mismatch on premise "${pe.getId()}" field "${field}": stored="${stored}", computed="${computed}"`
                        )
                    }
                }
            }
        }

        // Verify argument checksums
        const sa = argument as Record<string, unknown>
        for (const field of checksumFields) {
            const stored = String(sa[field])
            const computed = engine[field]()
            if (stored !== "undefined" && stored !== computed) {
                throw new Error(
                    `Checksum mismatch on argument "${engine.getArgument().id}" field "${field}": stored="${stored}", computed="${computed}"`
                )
            }
        }
    }

    public rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void {
        const preRollbackSnap = this.snapshot()
        this.rollbackInternal(snapshot)
        const validation = this.validate()
        if (!validation.ok) {
            this.rollbackInternal(preRollbackSnap)
            throw new InvariantViolationError(validation.violations)
        }
    }

    private rollbackInternal(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void {
        this.argument = { ...snapshot.argument }
        this.checksumConfig = normalizeChecksumConfig(
            snapshot.config?.checksumConfig
        )
        this.positionConfig = snapshot.config?.positionConfig
        this.grammarConfig = snapshot.config?.grammarConfig
        this.variables = VariableManager.fromSnapshot<TVar>(snapshot.variables)
        this.premises = new Map()
        this.expressionIndex = new Map()
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
                premiseSnap,
                this.argument,
                this.variables,
                this.expressionIndex,
                PERMISSIVE_GRAMMAR_CONFIG
            )
            this.premises.set(pe.getId(), pe)
        }
        this.conclusionPremiseId = snapshot.conclusionPremiseId
        for (const pe of this.premises.values()) {
            this.wireCircularityCheck(pe)
            this.wireEmptyBoundPremiseCheck(pe)
            pe.setVariableIdsCallback(
                () => new Set(this.variables.toArray().map((v) => v.id))
            )
            pe.setArgumentValidateCallback(() =>
                this.validateAfterPremiseMutation()
            )
            const premiseId = pe.getId()
            pe.setOnMutate(() => {
                this.markDirty()
                this.reactiveDirty.premiseIds.add(premiseId)
                this.notifySubscribers()
            })
        }
        this.markDirty()
        this.reactiveDirty = {
            argument: true,
            variables: true,
            roles: true,
            premiseIds: new Set(),
            allPremises: true,
        }
        this.notifySubscribers()
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

    public getCollectionChecksum(
        name: "premises" | "variables"
    ): string | null {
        if (this.checksumDirty) {
            this.flushChecksums()
        }
        return name === "premises"
            ? this.cachedPremisesCollectionChecksum!
            : this.cachedVariablesCollectionChecksum!
    }

    public flushChecksums(): void {
        const config = this.checksumConfig

        // 1. Flush all premise checksums (which flush expression checksums)
        for (const pe of this.listPremises()) {
            pe.flushChecksums()
        }

        // 2. Compute argument meta checksum (entity fields + role state MERGED)
        const argumentFields =
            config?.argumentFields ?? DEFAULT_CHECKSUM_CONFIG.argumentFields!
        const roleFields =
            config?.roleFields ?? DEFAULT_CHECKSUM_CONFIG.roleFields!
        const mergedFields = new Set([...argumentFields, ...roleFields])
        const mergedEntity = {
            ...(this.argument as unknown as Record<string, unknown>),
            ...(this.getRoleState() as unknown as Record<string, unknown>),
        }
        this.cachedMetaChecksum = entityChecksum(mergedEntity, mergedFields)

        // 3. Compute collection checksums
        const premiseEntries = this.listPremises()
        if (premiseEntries.length > 0) {
            const premiseMap: Record<string, string> = {}
            for (const pe of premiseEntries) {
                premiseMap[pe.getId()] = pe.combinedChecksum()
            }
            this.cachedPremisesCollectionChecksum = computeHash(
                canonicalSerialize(premiseMap)
            )
        } else {
            this.cachedPremisesCollectionChecksum = null
        }

        const vars = this.variables.toArray()
        if (vars.length > 0) {
            const varMap: Record<string, string> = {}
            for (const v of vars) {
                varMap[v.id] = v.checksum
            }
            this.cachedVariablesCollectionChecksum = computeHash(
                canonicalSerialize(varMap)
            )
        } else {
            this.cachedVariablesCollectionChecksum = null
        }

        // 4. Compute descendant checksum (exclude null collections)
        const collectionMap: Record<string, string> = {}
        if (this.cachedPremisesCollectionChecksum !== null) {
            collectionMap.premises = this.cachedPremisesCollectionChecksum
        }
        if (this.cachedVariablesCollectionChecksum !== null) {
            collectionMap.variables = this.cachedVariablesCollectionChecksum
        }
        this.cachedDescendantChecksum =
            Object.keys(collectionMap).length > 0
                ? computeHash(canonicalSerialize(collectionMap))
                : null

        // 5. Compute combined checksum
        this.cachedCombinedChecksum =
            this.cachedDescendantChecksum === null
                ? this.cachedMetaChecksum
                : computeHash(
                      this.cachedMetaChecksum + this.cachedDescendantChecksum
                  )

        this.checksumDirty = false
    }

    private markDirty(): void {
        this.checksumDirty = true
        this.cachedMetaChecksum = undefined
        this.cachedDescendantChecksum = undefined
        this.cachedCombinedChecksum = undefined
        this.cachedPremisesCollectionChecksum = undefined
        this.cachedVariablesCollectionChecksum = undefined
    }

    /** Invalidate all premise checksums (e.g. after variable changes). */
    private markAllPremisesDirty(): void {
        for (const pm of this.listPremises()) {
            pm.markDirty()
        }
    }

    private attachVariableChecksum(v: TOptionalChecksum<TVar>): TVar {
        const fields =
            this.checksumConfig?.variableFields ??
            DEFAULT_CHECKSUM_CONFIG.variableFields!
        return {
            ...v,
            checksum: entityChecksum(
                v as unknown as Record<string, unknown>,
                fields
            ),
        } as TVar
    }

    public collectReferencedVariables(): {
        variableIds: string[]
        byId: Record<string, { symbol: string; premiseIds: string[] }>
        bySymbol: Record<
            string,
            { variableIds: string[]; premiseIds: string[] }
        >
    } {
        return collectArgumentReferencedVariablesStandalone(
            this.asValidationContext()
        )
    }

    private validateAfterPremiseMutation(): TInvariantValidationResult {
        return validateAfterPremiseMutationStandalone(
            this.asValidationContext()
        )
    }

    public validate(): TInvariantValidationResult {
        return validateArgumentStandalone(this.asValidationContext())
    }

    public validateEvaluability(): TCoreValidationResult {
        return validateArgumentEvaluabilityStandalone(
            this.asValidationContext()
        )
    }

    private asValidationContext(): TArgumentValidationContext {
        return {
            argumentId: this.argument.id,
            argumentVersion: this.argument.version,
            conclusionPremiseId: this.conclusionPremiseId,
            getArgument: () => this.getArgument() as unknown as TCoreArgument,
            getVariables: () =>
                this.variables.toArray() as unknown as TCorePropositionalVariable[],
            listPremises: () =>
                this.listPremises() as unknown as TValidatablePremise[],
            hasPremise: (premiseId) => this.premises.has(premiseId),
            lookupClaim: (claimId, claimVersion) =>
                this.claimLibrary.get(claimId, claimVersion),
            flushAndGetChecksumDeltas: () => {
                const savedMeta = this.cachedMetaChecksum
                const savedDescendant = this.cachedDescendantChecksum
                const savedCombined = this.cachedCombinedChecksum
                this.flushChecksums()
                return {
                    savedMeta,
                    savedDescendant,
                    savedCombined,
                    currentMeta: this.cachedMetaChecksum,
                    currentDescendant: this.cachedDescendantChecksum,
                    currentCombined: this.cachedCombinedChecksum,
                }
            },
            validateVariables: () => this.variables.validate(),
            wouldCreateCycle: (variableId, premiseId, visited) =>
                this.wouldCreateCycle(variableId, premiseId, visited),
        }
    }

    private asEvaluationContext(): TArgumentEvaluationContext {
        return {
            argumentId: this.argument.id,
            conclusionPremiseId: this.conclusionPremiseId,
            getConclusionPremise: () =>
                this.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                this.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => this.listPremises() as TEvaluablePremise[],
            getVariable: (id) =>
                this.variables.getVariable(id) as
                    | TCorePropositionalVariable
                    | undefined,
            getPremise: (id) =>
                this.premises.get(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => this.validateEvaluability(),
        }
    }

    public evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult {
        return evaluateArgumentStandalone(
            this.asEvaluationContext(),
            assignment,
            options
        )
    }

    public checkValidity(
        options?: TCoreValidityCheckOptions
    ): TCoreValidityCheckResult {
        return checkArgumentValidityStandalone(
            this.asEvaluationContext(),
            options
        )
    }

    // -----------------------------------------------------------------
    // Forking
    // -----------------------------------------------------------------

    /**
     * Override point for subclasses to prevent forking. When this returns
     * `false`, `forkArgument` will throw.
     */
    public canFork(): boolean {
        return true
    }

    /**
     * Override point for subclasses to restrict cross-argument bindings.
     * When this returns `false`, `bindVariableToExternalPremise` will throw.
     */
    protected canBind(
        _boundArgumentId: string,
        _boundArgumentVersion: number
    ): boolean {
        return true
    }
}
