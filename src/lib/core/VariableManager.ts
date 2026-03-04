import type { TCorePropositionalVariable } from "../schemata/index.js"

/**
 * Registry for propositional variables within a single premise.
 *
 * Enforces uniqueness of both variable IDs and symbols. This class is an
 * internal building block used by {@link PremiseManager} and is not part
 * of the public API.
 */
export class VariableManager {
    private variables: Map<string, TCorePropositionalVariable>
    private variableSymbols: Set<string>

    constructor(initialVariables: TCorePropositionalVariable[] = []) {
        this.variables = new Map()
        this.variableSymbols = new Set()

        for (const variable of initialVariables) {
            this.addVariable(variable)
        }
    }

    /** Returns all registered variables sorted by ID for deterministic output. */
    public toArray(): TCorePropositionalVariable[] {
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
    public addVariable(variable: TCorePropositionalVariable) {
        if (this.variableSymbols.has(variable.symbol)) {
            throw new Error(
                `Variable symbol "${variable.symbol}" already exists.`
            )
        }
        if (this.variables.has(variable.id)) {
            throw new Error(`Variable with ID "${variable.id}" already exists.`)
        }

        this.variables.set(variable.id, variable)
        this.variableSymbols.add(variable.symbol)
    }

    /**
     * Removes a variable by ID.
     * @returns The removed variable, or `undefined` if not found.
     */
    public removeVariable(variableId: string) {
        const variable = this.variables.get(variableId)
        if (!variable) {
            return undefined
        }

        this.variables.delete(variableId)
        this.variableSymbols.delete(variable.symbol)
        return variable
    }

    /** Returns `true` if a variable with the given ID is registered. */
    public hasVariable(variableId: string): boolean {
        return this.variables.has(variableId)
    }

    /** Returns the variable with the given ID, or `undefined` if not found. */
    public getVariable(
        variableId: string
    ): TCorePropositionalVariable | undefined {
        return this.variables.get(variableId)
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
            this.variableSymbols.has(newSymbol) &&
            variable.symbol !== newSymbol
        ) {
            throw new Error(`Variable symbol "${newSymbol}" is already in use.`)
        }
        this.variableSymbols.delete(variable.symbol)
        this.variableSymbols.add(newSymbol)
        this.variables.set(variableId, { ...variable, symbol: newSymbol })
    }

    /**
     * Updates fields on an existing variable.
     * Currently supports `symbol` updates.
     *
     * @throws If the new symbol is already in use by a different variable.
     * @returns The updated variable, or `undefined` if not found.
     */
    public updateVariable(
        variableId: string,
        updates: { symbol?: string }
    ): TCorePropositionalVariable | undefined {
        const variable = this.variables.get(variableId)
        if (!variable) return undefined

        if (updates.symbol !== undefined) {
            this.renameVariable(variableId, updates.symbol)
        }

        return this.variables.get(variableId)
    }
}
