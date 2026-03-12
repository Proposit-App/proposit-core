import { randomUUID } from "node:crypto"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
    TCoreSource,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"
import type {
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
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type { TCorePositionConfig } from "../utils/position.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import type { TCoreMutationResult, TCoreChangeset } from "../types/mutation.js"
import type {
    TReactiveSnapshot,
    TReactivePremiseSnapshot,
} from "../types/reactive.js"
import { getOrCreate, sortedUnique } from "../utils/collections.js"
import { ChangeCollector } from "./change-collector.js"
import { canonicalSerialize, computeHash, entityChecksum } from "./checksum.js"
import { kleeneAnd, kleeneNot } from "./evaluation/kleene.js"
import {
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"
import type { TExpressionInput } from "./expression-manager.js"
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
    TSourceManagement,
    TDisplayable,
    TChecksummable,
} from "./interfaces/index.js"
import { SourceManager } from "./source-manager.js"
import type { TSourceManagerSnapshot } from "./source-manager.js"

export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
}

export type TArgumentEngineSnapshot<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
> = {
    argument: TOptionalChecksum<TArg>
    variables: TVariableManagerSnapshot<TVar>
    premises: TPremiseEngineSnapshot<TPremise, TExpr>[]
    conclusionPremiseId?: string
    config?: TLogicEngineOptions
    sources?: TSourceManagerSnapshot<TSource>
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
>
    implements
        TPremiseCrud<TArg, TPremise, TExpr, TVar, TSource>,
        TVariableManagement<TArg, TPremise, TExpr, TVar, TSource>,
        TArgumentExpressionQueries<TExpr>,
        TArgumentRoleState<TArg, TPremise, TExpr, TVar, TSource>,
        TArgumentEvaluation,
        TArgumentLifecycle<TArg, TPremise, TExpr, TVar, TSource>,
        TArgumentIdentity<TArg>,
        TSourceManagement<TArg, TPremise, TExpr, TVar, TSource>,
        TDisplayable,
        TChecksummable
{
    private argument: TOptionalChecksum<TArg>
    private premises: Map<
        string,
        PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>
    >
    private variables: VariableManager<TVar>
    private sourceManager: SourceManager<TSource>
    private conclusionPremiseId: string | undefined
    private checksumConfig?: TCoreChecksumConfig
    private positionConfig?: TCorePositionConfig
    private checksumDirty = true
    private cachedChecksum: string | undefined
    private expressionIndex: Map<string, string>
    private listeners = new Set<() => void>()
    private reactiveDirty = {
        argument: true,
        variables: true,
        roles: true,
        sources: true,
        premiseIds: new Set<string>(),
        allPremises: true,
    }
    private cachedReactiveSnapshot:
        | TReactiveSnapshot<TArg, TPremise, TExpr, TVar, TSource>
        | undefined

    constructor(
        argument: TOptionalChecksum<TArg>,
        options?: TLogicEngineOptions
    ) {
        this.argument = { ...argument }
        this.premises = new Map()
        this.variables = new VariableManager<TVar>({
            checksumConfig: this.checksumConfig,
            positionConfig: this.positionConfig,
        })
        this.sourceManager = new SourceManager<TSource>()
        this.expressionIndex = new Map()
        this.conclusionPremiseId = undefined
        this.checksumConfig = options?.checksumConfig
        this.positionConfig = options?.positionConfig
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

    public getSnapshot = (): TReactiveSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource
    > => {
        return this.buildReactiveSnapshot()
    }

    protected buildReactiveSnapshot(): TReactiveSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource
    > {
        const dirty = this.reactiveDirty
        const prev = this.cachedReactiveSnapshot

        if (
            prev &&
            !dirty.argument &&
            !dirty.variables &&
            !dirty.roles &&
            !dirty.sources &&
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

        let sourcesRecord: Record<string, TSource>
        let varAssocRecord: Record<string, TCoreVariableSourceAssociation>
        let exprAssocRecord: Record<string, TCoreExpressionSourceAssociation>
        if (dirty.sources || !prev) {
            sourcesRecord = {}
            for (const s of this.sourceManager.getSources()) {
                sourcesRecord[s.id] = s
            }
            varAssocRecord = {}
            for (const a of this.sourceManager.getAllVariableSourceAssociations()) {
                varAssocRecord[a.id] = a
            }
            exprAssocRecord = {}
            for (const a of this.sourceManager.getAllExpressionSourceAssociations()) {
                exprAssocRecord[a.id] = a
            }
        } else {
            sourcesRecord = prev.sources
            varAssocRecord = prev.variableSourceAssociations
            exprAssocRecord = prev.expressionSourceAssociations
        }

        const snapshot: TReactiveSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource
        > = {
            argument,
            variables,
            premises,
            roles,
            sources: sourcesRecord,
            variableSourceAssociations: varAssocRecord,
            expressionSourceAssociations: exprAssocRecord,
        }

        this.cachedReactiveSnapshot = snapshot
        this.reactiveDirty = {
            argument: false,
            variables: false,
            roles: false,
            sources: false,
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
        pm: PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>
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
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg, TSource>
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
        if (
            changes.sources ||
            changes.variableSourceAssociations ||
            changes.expressionSourceAssociations
        ) {
            this.reactiveDirty.sources = true
        }
    }

    public getArgument(): TArg {
        return { ...this.argument, checksum: this.checksum() } as TArg
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
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        return this.createPremiseWithId(randomUUID(), extras)
    }

    public createPremiseWithId(
        id: string,
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        if (this.premises.has(id)) {
            throw new Error(`Premise "${id}" already exists.`)
        }
        const premiseData = {
            ...extras,
            id,
            argumentId: this.argument.id,
            argumentVersion: this.argument.version,
        } as TOptionalChecksum<TPremise>
        const pm = new PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>(
            premiseData,
            {
                argument: this.argument,
                variables: this.variables,
                expressionIndex: this.expressionIndex,
                sourceManager: this.sourceManager,
            },
            {
                checksumConfig: this.checksumConfig,
                positionConfig: this.positionConfig,
            }
        )
        this.premises.set(id, pm)
        pm.setOnMutate(() => {
            this.reactiveDirty.premiseIds.add(id)
            this.notifySubscribers()
        })
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.addedPremise(pm.toPremiseData())
        this.markDirty()

        if (this.conclusionPremiseId === undefined) {
            this.conclusionPremiseId = id
            collector.setRoles(this.getRoleState())
        }

        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: pm,
            changes,
        }
    }

    public removePremise(
        premiseId: string
    ): TCoreMutationResult<
        TPremise | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        const pm = this.premises.get(premiseId)
        if (!pm) return { result: undefined, changes: {} }
        const data = pm.toPremiseData()
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        // Clean up expression index and source associations for removed premise's expressions
        for (const expr of pm.getExpressions()) {
            this.expressionIndex.delete(expr.id)
            const sourceResult =
                this.sourceManager.removeAssociationsForExpression(expr.id)
            for (const assoc of sourceResult.removedExpressionAssociations) {
                collector.removedExpressionSourceAssociation(assoc)
            }
            for (const orphan of sourceResult.removedOrphanSources) {
                collector.removedSource(orphan)
            }
        }
        this.premises.delete(premiseId)
        collector.removedPremise(data)
        if (this.conclusionPremiseId === premiseId) {
            this.conclusionPremiseId = undefined
            collector.setRoles(this.getRoleState())
        }
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: data,
            changes,
        }
    }

    public getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar, TSource> | undefined {
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

    public listPremises(): PremiseEngine<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource
    >[] {
        return this.listPremiseIds()
            .map((id) => this.premises.get(id))
            .filter(
                (
                    pm
                ): pm is PremiseEngine<TArg, TPremise, TExpr, TVar, TSource> =>
                    pm !== undefined
            )
    }

    public addVariable(
        variable: TOptionalChecksum<TVar>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg, TSource> {
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
        const withChecksum = this.attachVariableChecksum({ ...variable })
        this.variables.addVariable(withChecksum)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.addedVariable(withChecksum)
        this.markDirty()
        this.markAllPremisesDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: withChecksum,
            changes,
        }
    }

    public updateVariable(
        variableId: string,
        updates: { symbol?: string }
    ): TCoreMutationResult<
        TVar | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        const updated = this.variables.updateVariable(variableId, updates)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        if (updated) {
            const withChecksum = this.attachVariableChecksum({ ...updated })
            // Re-store with updated checksum so VariableManager always holds
            // variables with correct checksums.
            this.variables.removeVariable(variableId)
            this.variables.addVariable(withChecksum)
            collector.modifiedVariable(withChecksum)
            this.markDirty()
            this.markAllPremisesDirty()
            const changes = collector.toChangeset()
            this.markReactiveDirty(changes)
            this.notifySubscribers()
            return {
                result: withChecksum,
                changes,
            }
        }
        return {
            result: undefined,
            changes: collector.toChangeset(),
        }
    }

    public removeVariable(
        variableId: string
    ): TCoreMutationResult<
        TVar | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        const variable = this.variables.getVariable(variableId)
        if (!variable) {
            return { result: undefined, changes: {} }
        }

        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()

        // Cascade: delete referencing expressions in every premise
        // (PremiseEngine.removeExpression already cascades expression-source
        //  associations via the Task 12 logic)
        for (const pm of this.listPremises()) {
            const { changes } = pm.deleteExpressionsUsingVariable(variableId)
            if (changes.expressions) {
                for (const e of changes.expressions.removed) {
                    collector.removedExpression(e)
                }
            }
            if (changes.expressionSourceAssociations) {
                for (const a of changes.expressionSourceAssociations.removed) {
                    collector.removedExpressionSourceAssociation(a)
                }
            }
            if (changes.sources) {
                for (const s of changes.sources.removed) {
                    collector.removedSource(s)
                }
            }
        }

        // Cascade: remove variable-source associations
        const varAssocResult =
            this.sourceManager.removeAssociationsForVariable(variableId)
        for (const assoc of varAssocResult.removedVariableAssociations) {
            collector.removedVariableSourceAssociation(assoc)
        }
        for (const orphan of varAssocResult.removedOrphanSources) {
            collector.removedSource(orphan)
        }

        this.variables.removeVariable(variableId)
        collector.removedVariable(variable)
        this.markDirty()
        this.markAllPremisesDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: variable,
            changes,
        }
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
    ): PremiseEngine<TArg, TPremise, TExpr, TVar, TSource> | undefined {
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
        TArg,
        TSource
    > {
        const premise = this.premises.get(premiseId)
        if (!premise) {
            throw new Error(`Premise "${premiseId}" does not exist.`)
        }
        this.conclusionPremiseId = premiseId
        const roles = this.getRoleState()
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.setRoles(roles)
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: roles,
            changes,
        }
    }

    public clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        this.conclusionPremiseId = undefined
        const roles = this.getRoleState()
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.setRoles(roles)
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: roles,
            changes,
        }
    }

    public getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar, TSource>
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
        TVar,
        TSource
    >[] {
        return this.listPremises().filter(
            (pm) => pm.isInference() && pm.getId() !== this.conclusionPremiseId
        )
    }

    // -------------------------------------------------------------------------
    // Source management
    // -------------------------------------------------------------------------

    public addSource(
        source: TOptionalChecksum<TSource>
    ): TCoreMutationResult<TSource, TExpr, TVar, TPremise, TArg, TSource> {
        if (source.argumentId !== this.argument.id) {
            throw new Error(
                `Source argumentId "${source.argumentId}" does not match engine argument ID "${this.argument.id}".`
            )
        }
        if (source.argumentVersion !== this.argument.version) {
            throw new Error(
                `Source argumentVersion ${source.argumentVersion} does not match engine argument version ${this.argument.version}.`
            )
        }
        const fields =
            this.checksumConfig?.sourceFields ??
            DEFAULT_CHECKSUM_CONFIG.sourceFields!
        const sourceWithChecksum = {
            ...source,
            checksum: entityChecksum(
                source as unknown as Record<string, unknown>,
                fields
            ),
        } as TSource
        this.sourceManager.addSource(sourceWithChecksum)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.addedSource(sourceWithChecksum)
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return { result: sourceWithChecksum, changes }
    }

    public removeSource(
        sourceId: string
    ): TCoreMutationResult<
        TSource | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        const source = this.sourceManager.getSource(sourceId)
        if (!source) {
            return { result: undefined, changes: {} }
        }
        const removalResult = this.sourceManager.removeSource(sourceId)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.removedSource(source)
        for (const assoc of removalResult.removedVariableAssociations) {
            collector.removedVariableSourceAssociation(assoc)
        }
        for (const assoc of removalResult.removedExpressionAssociations) {
            collector.removedExpressionSourceAssociation(assoc)
        }
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return { result: source, changes }
    }

    public addVariableSourceAssociation(
        sourceId: string,
        variableId: string
    ): TCoreMutationResult<
        TCoreVariableSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        if (!this.sourceManager.getSource(sourceId)) {
            throw new Error(`Source "${sourceId}" does not exist.`)
        }
        if (!this.variables.hasVariable(variableId)) {
            throw new Error(`Variable "${variableId}" does not exist.`)
        }
        const assoc: TCoreVariableSourceAssociation = {
            id: randomUUID(),
            sourceId,
            variableId,
            argumentId: this.argument.id,
            argumentVersion: this.argument.version,
            checksum: "",
        }
        const fields =
            this.checksumConfig?.variableSourceAssociationFields ??
            DEFAULT_CHECKSUM_CONFIG.variableSourceAssociationFields!
        const assocWithChecksum: TCoreVariableSourceAssociation = {
            ...assoc,
            checksum: entityChecksum(
                assoc as unknown as Record<string, unknown>,
                fields
            ),
        }
        this.sourceManager.addVariableSourceAssociation(assocWithChecksum)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.addedVariableSourceAssociation(assocWithChecksum)
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return { result: assocWithChecksum, changes }
    }

    public removeVariableSourceAssociation(
        associationId: string
    ): TCoreMutationResult<
        TCoreVariableSourceAssociation | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        const allVarAssocs =
            this.sourceManager.getAllVariableSourceAssociations()
        if (!allVarAssocs.some((a) => a.id === associationId)) {
            return { result: undefined, changes: {} }
        }
        const removalResult =
            this.sourceManager.removeVariableSourceAssociation(associationId)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        for (const assoc of removalResult.removedVariableAssociations) {
            collector.removedVariableSourceAssociation(assoc)
        }
        for (const orphan of removalResult.removedOrphanSources) {
            collector.removedSource(orphan)
        }
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: removalResult.removedVariableAssociations[0],
            changes,
        }
    }

    public addExpressionSourceAssociation(
        sourceId: string,
        expressionId: string,
        premiseId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        if (!this.sourceManager.getSource(sourceId)) {
            throw new Error(`Source "${sourceId}" does not exist.`)
        }
        const pm = this.premises.get(premiseId)
        if (!pm) {
            throw new Error(`Premise "${premiseId}" does not exist.`)
        }
        if (!pm.getExpression(expressionId)) {
            throw new Error(
                `Expression "${expressionId}" does not exist in premise "${premiseId}".`
            )
        }
        const assoc: TCoreExpressionSourceAssociation = {
            id: randomUUID(),
            sourceId,
            expressionId,
            premiseId,
            argumentId: this.argument.id,
            argumentVersion: this.argument.version,
            checksum: "",
        }
        const fields =
            this.checksumConfig?.expressionSourceAssociationFields ??
            DEFAULT_CHECKSUM_CONFIG.expressionSourceAssociationFields!
        const assocWithChecksum: TCoreExpressionSourceAssociation = {
            ...assoc,
            checksum: entityChecksum(
                assoc as unknown as Record<string, unknown>,
                fields
            ),
        }
        this.sourceManager.addExpressionSourceAssociation(assocWithChecksum)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        collector.addedExpressionSourceAssociation(assocWithChecksum)
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return { result: assocWithChecksum, changes }
    }

    public removeExpressionSourceAssociation(
        associationId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    > {
        const allExprAssocs =
            this.sourceManager.getAllExpressionSourceAssociations()
        if (!allExprAssocs.some((a) => a.id === associationId)) {
            return { result: undefined, changes: {} }
        }
        const removalResult =
            this.sourceManager.removeExpressionSourceAssociation(associationId)
        const collector = new ChangeCollector<
            TExpr,
            TVar,
            TPremise,
            TArg,
            TSource
        >()
        for (const assoc of removalResult.removedExpressionAssociations) {
            collector.removedExpressionSourceAssociation(assoc)
        }
        for (const orphan of removalResult.removedOrphanSources) {
            collector.removedSource(orphan)
        }
        this.markDirty()
        const changes = collector.toChangeset()
        this.markReactiveDirty(changes)
        this.notifySubscribers()
        return {
            result: removalResult.removedExpressionAssociations[0],
            changes,
        }
    }

    public getSources(): TSource[] {
        return this.sourceManager.getSources()
    }

    public getSource(sourceId: string): TSource | undefined {
        return this.sourceManager.getSource(sourceId)
    }

    public getAssociationsForSource(sourceId: string): {
        variable: TCoreVariableSourceAssociation[]
        expression: TCoreExpressionSourceAssociation[]
    } {
        return this.sourceManager.getAssociationsForSource(sourceId)
    }

    public getAssociationsForVariable(
        variableId: string
    ): TCoreVariableSourceAssociation[] {
        return this.sourceManager.getAssociationsForVariable(variableId)
    }

    public getAssociationsForExpression(
        expressionId: string
    ): TCoreExpressionSourceAssociation[] {
        return this.sourceManager.getAssociationsForExpression(expressionId)
    }

    public getAllVariableSourceAssociations(): TCoreVariableSourceAssociation[] {
        return this.sourceManager.getAllVariableSourceAssociations()
    }

    public getAllExpressionSourceAssociations(): TCoreExpressionSourceAssociation[] {
        return this.sourceManager.getAllExpressionSourceAssociations()
    }

    public snapshot(): TArgumentEngineSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource
    > {
        return {
            argument: { ...this.argument },
            variables: this.variables.snapshot(),
            premises: this.listPremises().map((pe) => pe.snapshot()),
            ...(this.conclusionPremiseId !== undefined
                ? { conclusionPremiseId: this.conclusionPremiseId }
                : {}),
            config: {
                checksumConfig: this.checksumConfig,
                positionConfig: this.positionConfig,
            },
            sources: this.sourceManager.snapshot(),
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
    >(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar, TSource>
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource> {
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource>(
            snapshot.argument,
            snapshot.config
        )
        // Restore variables
        for (const v of snapshot.variables.variables) {
            engine.addVariable(v)
        }
        // Restore source manager (before premises, so PremiseEngines get the correct reference)
        if (snapshot.sources) {
            engine.sourceManager = SourceManager.fromSnapshot<TSource>(
                snapshot.sources
            )
        }
        // Restore premises using PremiseEngine.fromSnapshot
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<
                TArg,
                TPremise,
                TExpr,
                TVar,
                TSource
            >(
                premiseSnap,
                snapshot.argument,
                engine.variables,
                engine.expressionIndex,
                engine.sourceManager
            )
            engine.premises.set(pe.getId(), pe)
            const premiseId = pe.getId()
            pe.setOnMutate(() => {
                engine.reactiveDirty.premiseIds.add(premiseId)
                engine.notifySubscribers()
            })
        }
        // Restore conclusion role (don't use setConclusionPremise to avoid auto-assign logic)
        engine.conclusionPremiseId = snapshot.conclusionPremiseId
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
    >(
        argument: TOptionalChecksum<TArg>,
        variables: TOptionalChecksum<TVar>[],
        premises: TOptionalChecksum<TPremise>[],
        expressions: TExpressionInput<TExpr>[],
        roles: TCoreArgumentRoleState,
        config?: TLogicEngineOptions
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource> {
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource>(
            argument,
            config
        )

        // Register variables
        for (const v of variables) {
            engine.addVariable(v)
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

        // Create premises and load their expressions in BFS order
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

            // Add expressions in BFS order (roots first, then children)
            const premiseExprs = exprsByPremise.get(premise.id) ?? []
            // Cast to base type to access .id and .parentId on the distributive conditional type
            type TBaseInput = TExpressionInput<TCorePropositionalExpression>
            const pending = new Map(
                premiseExprs.map((e) => [(e as unknown as TBaseInput).id, e])
            )
            let progressed = true
            while (pending.size > 0 && progressed) {
                progressed = false
                for (const [eid, expr] of Array.from(pending.entries())) {
                    const base = expr as unknown as TBaseInput
                    if (
                        base.parentId !== null &&
                        !pe.getExpression(base.parentId)
                    ) {
                        continue
                    }
                    pe.addExpression(expr)
                    pending.delete(eid)
                    progressed = true
                }
            }
            if (pending.size > 0) {
                throw new Error(
                    `Could not resolve parent relationships for expressions: ${Array.from(pending.keys()).join(", ")}`
                )
            }
        }

        // Set roles (override auto-assignment)
        if (roles.conclusionPremiseId !== undefined) {
            engine.setConclusionPremise(roles.conclusionPremiseId)
        }

        return engine
    }

    public rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar, TSource>
    ): void {
        this.argument = { ...snapshot.argument }
        this.checksumConfig = snapshot.config?.checksumConfig
        this.positionConfig = snapshot.config?.positionConfig
        this.variables = VariableManager.fromSnapshot<TVar>(snapshot.variables)
        this.sourceManager = snapshot.sources
            ? SourceManager.fromSnapshot<TSource>(snapshot.sources)
            : new SourceManager<TSource>()
        this.premises = new Map()
        this.expressionIndex = new Map()
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<
                TArg,
                TPremise,
                TExpr,
                TVar,
                TSource
            >(
                premiseSnap,
                this.argument,
                this.variables,
                this.expressionIndex,
                this.sourceManager
            )
            this.premises.set(pe.getId(), pe)
        }
        this.conclusionPremiseId = snapshot.conclusionPremiseId
        for (const pe of this.premises.values()) {
            const premiseId = pe.getId()
            pe.setOnMutate(() => {
                this.reactiveDirty.premiseIds.add(premiseId)
                this.notifySubscribers()
            })
        }
        this.markDirty()
        this.reactiveDirty = {
            argument: true,
            variables: true,
            roles: true,
            sources: true,
            premiseIds: new Set(),
            allPremises: true,
        }
        this.notifySubscribers()
    }

    public checksum(): string {
        if (this.checksumDirty || this.cachedChecksum === undefined) {
            this.cachedChecksum = this.computeChecksum()
            this.checksumDirty = false
        }
        return this.cachedChecksum
    }

    private computeChecksum(): string {
        const config = this.checksumConfig
        const checksumMap: Record<string, string> = {}

        // Argument entity checksum
        checksumMap[this.argument.id as string] = entityChecksum(
            this.argument as unknown as Record<string, unknown>,
            config?.argumentFields ?? DEFAULT_CHECKSUM_CONFIG.argumentFields!
        )

        // Role state checksum (use fixed key since roles have no ID)
        checksumMap.__roles__ = entityChecksum(
            this.getRoleState() as unknown as Record<string, unknown>,
            config?.roleFields ?? DEFAULT_CHECKSUM_CONFIG.roleFields!
        )

        // Variable checksums
        for (const v of this.variables.toArray()) {
            checksumMap[v.id] = v.checksum
        }

        // Premise checksums (cumulative, from each PremiseEngine)
        for (const pe of this.listPremises()) {
            checksumMap[pe.getId()] = pe.checksum()
        }

        return computeHash(canonicalSerialize(checksumMap))
    }

    private markDirty(): void {
        this.checksumDirty = true
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
        const supportingIds = new Set(
            supportingPremises.map((pm) => pm.getId())
        )
        const constraintPremises = this.listPremises().filter(
            (pm) =>
                pm.getId() !== this.conclusionPremiseId &&
                !supportingIds.has(pm.getId())
        )

        const allRelevantPremises = [
            conclusion,
            ...supportingPremises,
            ...constraintPremises,
        ]
        const referencedVariableIds = [
            ...new Set(
                allRelevantPremises.flatMap((pm) =>
                    pm
                        .getExpressions()
                        .filter((expr) => expr.type === "variable")
                        .map(
                            (expr) =>
                                (
                                    expr as TCorePropositionalExpression<"variable">
                                ).variableId
                        )
                )
            ),
        ].sort()

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
        const supportingIds = new Set(
            supportingPremises.map((pm) => pm.getId())
        )
        const constraintPremises = this.listPremises().filter(
            (pm) =>
                pm.getId() !== this.conclusionPremiseId &&
                !supportingIds.has(pm.getId())
        )

        const checkedVariableIds = [
            ...new Set(
                [
                    conclusion,
                    ...supportingPremises,
                    ...constraintPremises,
                ].flatMap((pm) =>
                    pm
                        .getExpressions()
                        .filter((expr) => expr.type === "variable")
                        .map(
                            (expr) =>
                                (
                                    expr as TCorePropositionalExpression<"variable">
                                ).variableId
                        )
                )
            ),
        ].sort()

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
