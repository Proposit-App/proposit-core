import { randomUUID } from "node:crypto"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
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
import type { TCoreMutationResult } from "../types/mutation.js"
import { getOrCreate, sortedUnique } from "../utils/collections.js"
import { ChangeCollector } from "./ChangeCollector.js"
import { canonicalSerialize, computeHash, entityChecksum } from "./checksum.js"
import {
    kleeneAnd,
    kleeneNot,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/shared.js"
import type { TExpressionInput } from "./ExpressionManager.js"
import { PremiseEngine } from "./PremiseEngine.js"
import type { TPremiseEngineSnapshot } from "./PremiseEngine.js"
import { VariableManager } from "./VariableManager.js"
import type { TVariableManagerSnapshot } from "./VariableManager.js"

export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
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
> {
    private argument: TOptionalChecksum<TArg>
    private premises: Map<string, PremiseEngine<TArg, TPremise, TExpr, TVar>>
    private variables: VariableManager<TVar>
    private conclusionPremiseId: string | undefined
    private checksumConfig?: TCoreChecksumConfig
    private positionConfig?: TCorePositionConfig
    private checksumDirty = true
    private cachedChecksum: string | undefined
    private expressionIndex: Map<string, string>

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
        this.expressionIndex = new Map()
        this.conclusionPremiseId = undefined
        this.checksumConfig = options?.checksumConfig
        this.positionConfig = options?.positionConfig
    }

    /** Returns a shallow copy of the argument metadata with checksum attached. */
    public getArgument(): TArg {
        return { ...this.argument, checksum: this.checksum() } as TArg
    }

    /** Renders the argument as a multi-line string with role labels for each premise. */
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

    /**
     * Creates a new premise with an auto-generated UUID and registers it
     * with this engine.
     */
    public createPremise(
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.createPremiseWithId(randomUUID(), extras)
    }

    /**
     * Creates a premise with a caller-supplied ID and registers it with
     * this engine.
     *
     * @throws If a premise with the given ID already exists.
     */
    public createPremiseWithId(
        id: string,
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
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
        const pm = new PremiseEngine<TArg, TPremise, TExpr, TVar>(
            premiseData,
            { argument: this.argument, variables: this.variables, expressionIndex: this.expressionIndex },
            {
                checksumConfig: this.checksumConfig,
                positionConfig: this.positionConfig,
            }
        )
        this.premises.set(id, pm)
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.addedPremise(pm.toPremiseData())
        this.markDirty()

        if (this.conclusionPremiseId === undefined) {
            this.conclusionPremiseId = id
            collector.setRoles(this.getRoleState())
        }

        return {
            result: pm,
            changes: collector.toChangeset(),
        }
    }

    /**
     * Removes a premise and clears any role assignments that reference it.
     * Returns the removed premise data, or `undefined` if not found.
     */
    public removePremise(
        premiseId: string
    ): TCoreMutationResult<TPremise | undefined, TExpr, TVar, TPremise, TArg> {
        const pm = this.premises.get(premiseId)
        if (!pm) return { result: undefined, changes: {} }
        const data = pm.toPremiseData()
        // Clean up expression index for removed premise's expressions
        for (const expr of pm.getExpressions()) {
            this.expressionIndex.delete(expr.id)
        }
        this.premises.delete(premiseId)
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.removedPremise(data)
        if (this.conclusionPremiseId === premiseId) {
            this.conclusionPremiseId = undefined
            collector.setRoles(this.getRoleState())
        }
        this.markDirty()
        return {
            result: data,
            changes: collector.toChangeset(),
        }
    }

    /** Returns the premise with the given ID, or `undefined` if not found. */
    public getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined {
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
    public listPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[] {
        return this.listPremiseIds()
            .map((id) => this.premises.get(id))
            .filter(
                (pm): pm is PremiseEngine<TArg, TPremise, TExpr, TVar> =>
                    pm !== undefined
            )
    }

    /**
     * Registers a propositional variable for use across all premises.
     *
     * @throws If `variable.symbol` is already in use.
     * @throws If `variable.id` already exists.
     * @throws If the variable does not belong to this argument.
     */
    public addVariable(
        variable: TOptionalChecksum<TVar>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
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
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.addedVariable(withChecksum)
        this.markDirty()
        this.markAllPremisesDirty()
        return {
            result: withChecksum,
            changes: collector.toChangeset(),
        }
    }

    /**
     * Updates fields on an existing variable. Since all premises share the
     * same VariableManager, the update is immediately visible everywhere.
     *
     * @throws If the new symbol is already in use by a different variable.
     */
    public updateVariable(
        variableId: string,
        updates: { symbol?: string }
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg> {
        const updated = this.variables.updateVariable(variableId, updates)
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        if (updated) {
            const withChecksum = this.attachVariableChecksum({ ...updated })
            // Re-store with updated checksum so VariableManager always holds
            // variables with correct checksums.
            this.variables.removeVariable(variableId)
            this.variables.addVariable(withChecksum)
            collector.modifiedVariable(withChecksum)
            this.markDirty()
            this.markAllPremisesDirty()
            return {
                result: withChecksum,
                changes: collector.toChangeset(),
            }
        }
        return {
            result: undefined,
            changes: collector.toChangeset(),
        }
    }

    /**
     * Removes a variable and cascade-deletes all expressions referencing it
     * across every premise (including subtrees and operator collapse).
     */
    public removeVariable(
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
        this.markDirty()
        this.markAllPremisesDirty()
        return {
            result: variable,
            changes: collector.toChangeset(),
        }
    }

    /** Returns all registered variables sorted by ID. */
    public getVariables(): TVar[] {
        return this.variables.toArray()
    }

    /** Returns the variable with the given ID, or `undefined` if not found. */
    public getVariable(variableId: string): TVar | undefined {
        return this.variables.getVariable(variableId)
    }

    /** Returns `true` if a variable with the given ID exists. */
    public hasVariable(variableId: string): boolean {
        return this.variables.hasVariable(variableId)
    }

    /** Returns the variable with the given symbol, or `undefined` if not found. */
    public getVariableBySymbol(symbol: string): TVar | undefined {
        return this.variables.getVariableBySymbol(symbol)
    }

    /**
     * Builds a Map keyed by a caller-supplied function over all variables.
     * Useful for indexing by extension fields (e.g. statementId).
     * The caller should cache the result — this is O(n) per call.
     */
    public buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar> {
        const map = new Map<K, TVar>()
        for (const v of this.variables.toArray()) {
            map.set(keyFn(v), v)
        }
        return map
    }

    /** Returns an expression by ID from any premise, or `undefined` if not found. */
    public getExpression(expressionId: string): TExpr | undefined {
        const premiseId = this.expressionIndex.get(expressionId)
        if (premiseId === undefined) return undefined
        return this.premises.get(premiseId)?.getExpression(expressionId)
    }

    /** Returns `true` if an expression with the given ID exists in any premise. */
    public hasExpression(expressionId: string): boolean {
        return this.expressionIndex.has(expressionId)
    }

    /** Returns the premise ID that contains the given expression, or `undefined`. */
    public getExpressionPremiseId(expressionId: string): string | undefined {
        return this.expressionIndex.get(expressionId)
    }

    /** Returns the PremiseEngine containing the given expression, or `undefined`. */
    public findPremiseByExpressionId(
        expressionId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined {
        const premiseId = this.expressionIndex.get(expressionId)
        if (premiseId === undefined) return undefined
        return this.premises.get(premiseId)
    }

    /** Returns all expressions across all premises, sorted by ID. */
    public getAllExpressions(): TExpr[] {
        const all: TExpr[] = []
        for (const pe of this.listPremises()) {
            all.push(...pe.getExpressions())
        }
        return all.sort((a, b) => a.id.localeCompare(b.id))
    }

    /**
     * Returns all expressions that reference the given variable ID,
     * across all premises.
     */
    public getExpressionsByVariableId(variableId: string): TExpr[] {
        const result: TExpr[] = []
        for (const pe of this.listPremises()) {
            const refIds = pe.getReferencedVariableIds()
            if (!refIds.has(variableId)) continue
            for (const expr of pe.getExpressions()) {
                if (expr.type === "variable" && expr.variableId === variableId) {
                    result.push(expr)
                }
            }
        }
        return result
    }

    /** Returns the root expression from each premise that has one. */
    public listRootExpressions(): TExpr[] {
        const roots: TExpr[] = []
        for (const pe of this.listPremises()) {
            const root = pe.getRootExpression()
            if (root) roots.push(root)
        }
        return roots
    }

    /** Returns the current role assignments (conclusion premise ID only; supporting is derived). */
    public getRoleState(): TCoreArgumentRoleState {
        return {
            ...(this.conclusionPremiseId !== undefined
                ? { conclusionPremiseId: this.conclusionPremiseId }
                : {}),
        }
    }

    /**
     * Designates a premise as the argument's conclusion.
     *
     * @throws If the premise does not exist.
     */
    public setConclusionPremise(
        premiseId: string
    ): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        const premise = this.premises.get(premiseId)
        if (!premise) {
            throw new Error(`Premise "${premiseId}" does not exist.`)
        }
        this.conclusionPremiseId = premiseId
        const roles = this.getRoleState()
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.setRoles(roles)
        this.markDirty()
        return {
            result: roles,
            changes: collector.toChangeset(),
        }
    }

    /** Clears the conclusion designation. */
    public clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        this.conclusionPremiseId = undefined
        const roles = this.getRoleState()
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.setRoles(roles)
        this.markDirty()
        return {
            result: roles,
            changes: collector.toChangeset(),
        }
    }

    /** Returns the conclusion premise, or `undefined` if none is set. */
    public getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar>
        | undefined {
        if (this.conclusionPremiseId === undefined) {
            return undefined
        }
        return this.premises.get(this.conclusionPremiseId)
    }

    /**
     * Returns all supporting premises (derived: inference premises that are
     * not the conclusion) in lexicographic ID order.
     */
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

    /** Returns a serializable snapshot of the full engine state. */
    public snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar> {
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
        }
    }

    /** Creates a new ArgumentEngine from a previously captured snapshot. */
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    >(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar> {
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar>(
            snapshot.argument,
            snapshot.config
        )
        // Restore variables
        for (const v of snapshot.variables.variables) {
            engine.addVariable(v)
        }
        // Restore premises using PremiseEngine.fromSnapshot
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
                premiseSnap,
                snapshot.argument,
                engine.variables,
                engine.expressionIndex
            )
            engine.premises.set(pe.getId(), pe)
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
    >(
        argument: TOptionalChecksum<TArg>,
        variables: TOptionalChecksum<TVar>[],
        premises: TOptionalChecksum<TPremise>[],
        expressions: TExpressionInput<TExpr>[],
        roles: TCoreArgumentRoleState,
        config?: TLogicEngineOptions
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar> {
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar>(
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
                rootExpressionId: _rootExpressionId,
                variables: _vars,
                expressions: _exprs,
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
            type BaseInput = TExpressionInput<TCorePropositionalExpression>
            const pending = new Map(
                premiseExprs.map((e) => [(e as unknown as BaseInput).id, e])
            )
            let progressed = true
            while (pending.size > 0 && progressed) {
                progressed = false
                for (const [eid, expr] of Array.from(pending.entries())) {
                    const base = expr as unknown as BaseInput
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

    /** Restores the engine to a previously captured snapshot state. */
    public rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void {
        this.argument = { ...snapshot.argument }
        this.checksumConfig = snapshot.config?.checksumConfig
        this.positionConfig = snapshot.config?.positionConfig
        this.variables = VariableManager.fromSnapshot<TVar>(snapshot.variables)
        this.premises = new Map()
        this.expressionIndex = new Map()
        for (const premiseSnap of snapshot.premises) {
            const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
                premiseSnap,
                this.argument,
                this.variables,
                this.expressionIndex
            )
            this.premises.set(pe.getId(), pe)
        }
        this.conclusionPremiseId = snapshot.conclusionPremiseId
        this.markDirty()
    }

    /**
     * Returns an argument-level checksum combining argument metadata, role
     * state, and all premise checksums. Computed lazily -- only recalculated
     * when the engine's own state has changed.
     */
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
