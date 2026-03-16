import type { TCorePropositionalVariable } from "../schemata/index.js"
import type { TLogicEngineOptions } from "./argument-engine.js"

export type TVariableManagerSnapshot<
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> = {
    variables: TVar[]
    config?: TLogicEngineOptions
}

/**
 * Registry for propositional variables within an argument, shared across
 * all premises.
 *
 * Enforces uniqueness of both variable IDs and symbols. This class is an
 * internal building block owned by {@link ArgumentEngine} and passed by
 * reference to each {@link PremiseEngine}. It is not part of the public API.
 */
export class VariableManager<
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    private variables: Map<string, TVar>
    private variablesBySymbol: Map<string, string>
    private config?: TLogicEngineOptions

    constructor(config?: TLogicEngineOptions) {
        this.variables = new Map()
        this.variablesBySymbol = new Map()
        this.config = config
    }

    /** Returns all registered variables sorted by ID for deterministic output. */
    public toArray(): TVar[] {
        return Array.from(this.variables.values()).sort((a, b) =>
            a.id.localeCompare(b.id)
        )
    }

    /**
     * Registers a variable.
     *
     * @throws If the symbol is already in use.
     * @throws If the ID already exists.
     */
    public addVariable(variable: TVar) {
        if (this.variablesBySymbol.has(variable.symbol)) {
            throw new Error(
                `Variable symbol "${variable.symbol}" already exists.`
            )
        }
        if (this.variables.has(variable.id)) {
            throw new Error(`Variable with ID "${variable.id}" already exists.`)
        }

        this.variables.set(variable.id, variable)
        this.variablesBySymbol.set(variable.symbol, variable.id)
    }

    /**
     * Removes a variable by ID.
     * @returns The removed variable, or `undefined` if not found.
     */
    public removeVariable(variableId: string): TVar | undefined {
        const variable = this.variables.get(variableId)
        if (!variable) {
            return undefined
        }

        this.variables.delete(variableId)
        this.variablesBySymbol.delete(variable.symbol)
        return variable
    }

    /** Returns `true` if a variable with the given ID is registered. */
    public hasVariable(variableId: string): boolean {
        return this.variables.has(variableId)
    }

    /** Returns the variable with the given ID, or `undefined` if not found. */
    public getVariable(variableId: string): TVar | undefined {
        return this.variables.get(variableId)
    }

    /** Returns the variable with the given symbol, or `undefined` if not found. */
    public getVariableBySymbol(symbol: string): TVar | undefined {
        const id = this.variablesBySymbol.get(symbol)
        if (id === undefined) return undefined
        return this.variables.get(id)
    }

    /**
     * Changes the symbol of an existing variable.
     *
     * @throws If the variable does not exist.
     * @throws If the new symbol is already in use by a different variable.
     */
    public renameVariable(variableId: string, newSymbol: string): void {
        const variable = this.variables.get(variableId)
        if (!variable) {
            throw new Error(`Variable "${variableId}" does not exist.`)
        }
        if (
            this.variablesBySymbol.has(newSymbol) &&
            variable.symbol !== newSymbol
        ) {
            throw new Error(`Variable symbol "${newSymbol}" is already in use.`)
        }
        this.variablesBySymbol.delete(variable.symbol)
        this.variablesBySymbol.set(newSymbol, variableId)
        this.variables.set(variableId, {
            ...variable,
            symbol: newSymbol,
        } as TVar)
    }

    /**
     * Updates fields on an existing variable.
     * Handles `symbol` updates via the symbol index; all other provided
     * fields are spread onto the stored variable.
     *
     * @throws If the new symbol is already in use by a different variable.
     * @returns The updated variable, or `undefined` if not found.
     */
    public updateVariable(
        variableId: string,
        updates: Partial<TVar>
    ): TVar | undefined {
        const variable = this.variables.get(variableId)
        if (!variable) return undefined

        if (updates.symbol !== undefined) {
            this.renameVariable(variableId, updates.symbol)
        }

        // Apply remaining fields (symbol already handled by renameVariable)
        const { symbol: _symbol, ...rest } = updates
        if (Object.keys(rest).length > 0) {
            const current = this.variables.get(variableId)!
            this.variables.set(variableId, {
                ...current,
                ...rest,
            } as TVar)
        }

        return this.variables.get(variableId)
    }

    /** Returns a serializable snapshot of the current state. */
    public snapshot(): TVariableManagerSnapshot<TVar> {
        return {
            variables: this.toArray(),
            config: this.config,
        }
    }

    /** Creates a new VariableManager from a previously captured snapshot. */
    public static fromSnapshot<
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    >(snapshot: TVariableManagerSnapshot<TVar>): VariableManager<TVar> {
        const vm = new VariableManager<TVar>(snapshot.config)
        for (const v of snapshot.variables) {
            vm.addVariable(v)
        }
        return vm
    }
}
