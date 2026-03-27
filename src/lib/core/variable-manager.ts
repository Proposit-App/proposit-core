import type { TCorePropositionalVariable } from "../schemata/index.js"
import { CorePropositionalVariableSchema } from "../schemata/index.js"
import { DEFAULT_CHECKSUM_CONFIG, serializeChecksumConfig } from "../consts.js"
import type { TLogicEngineOptions } from "./argument-engine.js"
import { entityChecksum } from "./checksum.js"
import { Value } from "typebox/value"
import type {
    TInvariantViolation,
    TInvariantValidationResult,
} from "../types/validation.js"
import {
    VAR_SCHEMA_INVALID,
    VAR_DUPLICATE_ID,
    VAR_DUPLICATE_SYMBOL,
    VAR_CHECKSUM_MISMATCH,
} from "../types/validation.js"

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

    /**
     * Validates all managed variables, collecting every invariant violation.
     * Checks: schema conformance, duplicate IDs, duplicate symbols, and
     * checksum integrity.
     */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        const seenIds = new Set<string>()
        const seenSymbols = new Set<string>()

        const fields =
            this.config?.checksumConfig?.variableFields ??
            DEFAULT_CHECKSUM_CONFIG.variableFields!

        for (const variable of this.toArray()) {
            const id = variable.id

            // 1. Schema check
            if (
                !Value.Check(
                    CorePropositionalVariableSchema,
                    variable as unknown as TCorePropositionalVariable
                )
            ) {
                violations.push({
                    code: VAR_SCHEMA_INVALID,
                    message: `Variable "${id}" does not conform to CorePropositionalVariableSchema.`,
                    entityType: "variable",
                    entityId: id,
                })
            }

            // 2. Duplicate ID
            if (seenIds.has(id)) {
                violations.push({
                    code: VAR_DUPLICATE_ID,
                    message: `Duplicate variable ID "${id}".`,
                    entityType: "variable",
                    entityId: id,
                })
            }
            seenIds.add(id)

            // 3. Duplicate symbol
            if (seenSymbols.has(variable.symbol)) {
                violations.push({
                    code: VAR_DUPLICATE_SYMBOL,
                    message: `Duplicate variable symbol "${variable.symbol}".`,
                    entityType: "variable",
                    entityId: id,
                })
            }
            seenSymbols.add(variable.symbol)

            // 4. Checksum integrity (skip empty string — before first computation)
            if (variable.checksum !== "") {
                const computed = entityChecksum(
                    variable as unknown as Record<string, unknown>,
                    fields
                )
                if (variable.checksum !== computed) {
                    violations.push({
                        code: VAR_CHECKSUM_MISMATCH,
                        message: `Variable "${id}" checksum mismatch: stored="${variable.checksum}", computed="${computed}".`,
                        entityType: "variable",
                        entityId: id,
                    })
                }
            }
        }

        return {
            ok: violations.length === 0,
            violations,
        }
    }

    /** Returns a serializable snapshot of the current state. */
    public snapshot(): TVariableManagerSnapshot<TVar> {
        return {
            variables: this.toArray(),
            config: this.config
                ? ({
                      ...this.config,
                      checksumConfig: serializeChecksumConfig(
                          this.config.checksumConfig
                      ),
                  } as TLogicEngineOptions)
                : this.config,
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
