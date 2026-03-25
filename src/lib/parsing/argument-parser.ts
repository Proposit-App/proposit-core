import { randomUUID } from "node:crypto"
import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import type { TParserWarning, TParserBuildOptions } from "./types.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreSource,
    TCoreClaim,
    TCoreClaimSourceAssociation,
} from "../schemata/index.js"
import type { TClaimBoundVariable } from "../schemata/propositional.js"
import { parseFormula } from "../core/parser/formula.js"
import type { TFormulaAST } from "../core/parser/formula.js"
import type { TExpressionInput } from "../core/expression-manager.js"
import { POSITION_INITIAL } from "../utils/position.js"
import { ArgumentEngine } from "../core/argument-engine.js"
import { ClaimLibrary } from "../core/claim-library.js"
import { SourceLibrary } from "../core/source-library.js"
import { ClaimSourceLibrary } from "../core/claim-source-library.js"
import { ParsedArgumentResponseSchema } from "./schemata.js"
import type {
    TParsedArgumentResponse,
    TParsedArgument,
    TParsedClaim,
    TParsedVariable,
    TParsedSource,
    TParsedPremise,
} from "./schemata.js"

/**
 * The result returned by `ArgumentParser.build()`.
 */
export type TArgumentParserResult<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    claimLibrary: ClaimLibrary<TClaim>
    sourceLibrary: SourceLibrary<TSource>
    claimSourceLibrary: ClaimSourceLibrary<TAssoc>
    warnings: TParserWarning[]
}

// ---------------------------------------------------------------------------
// Internal helpers — reused from src/cli/import.ts patterns
// ---------------------------------------------------------------------------

/**
 * Validates that `implies` and `iff` nodes appear only at the AST root.
 */
function validateRootOnly(
    ast: TFormulaAST,
    isRoot: boolean,
    premiseMiniId: string
): void {
    if (!isRoot && (ast.type === "implies" || ast.type === "iff")) {
        throw new Error(
            `${ast.type === "implies" ? "Implication (→)" : "Biconditional (↔)"} operator must be at the root of a formula, but found nested in premise "${premiseMiniId}".`
        )
    }
    switch (ast.type) {
        case "variable":
            break
        case "not":
            validateRootOnly(ast.operand, false, premiseMiniId)
            break
        case "and":
        case "or":
            for (const operand of ast.operands) {
                validateRootOnly(operand, false, premiseMiniId)
            }
            break
        case "implies":
        case "iff":
            validateRootOnly(ast.left, false, premiseMiniId)
            validateRootOnly(ast.right, false, premiseMiniId)
            break
    }
}

/** Recursively collects all variable names from a formula AST. */
function collectVariableNames(ast: TFormulaAST, names: Set<string>): void {
    switch (ast.type) {
        case "variable":
            names.add(ast.name)
            break
        case "not":
            collectVariableNames(ast.operand, names)
            break
        case "and":
        case "or":
            for (const operand of ast.operands) {
                collectVariableNames(operand, names)
            }
            break
        case "implies":
        case "iff":
            collectVariableNames(ast.left, names)
            collectVariableNames(ast.right, names)
            break
    }
}

/**
 * Converts a formula AST into expression objects and adds them to a premise.
 */
function buildExpressions(
    ast: TFormulaAST,
    parentId: string | null,
    position: number,
    argumentId: string,
    argumentVersion: number,
    premiseId: string,
    variablesBySymbol: Map<string, Omit<TClaimBoundVariable, "checksum">>,
    addExpression: (expr: TExpressionInput) => void
): string {
    const id = randomUUID()

    switch (ast.type) {
        case "variable": {
            const variable = variablesBySymbol.get(ast.name)!
            addExpression({
                id,
                argumentId,
                argumentVersion,
                premiseId,
                type: "variable",
                variableId: variable.id,
                parentId,
                position,
            })
            return id
        }
        case "not": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                premiseId,
                type: "operator",
                operator: "not",
                parentId,
                position,
            })
            buildExpressions(
                ast.operand,
                id,
                0,
                argumentId,
                argumentVersion,
                premiseId,
                variablesBySymbol,
                addExpression
            )
            return id
        }
        case "and":
        case "or": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                premiseId,
                type: "operator",
                operator: ast.type,
                parentId,
                position,
            })
            for (let i = 0; i < ast.operands.length; i++) {
                buildExpressions(
                    ast.operands[i],
                    id,
                    i,
                    argumentId,
                    argumentVersion,
                    premiseId,
                    variablesBySymbol,
                    addExpression
                )
            }
            return id
        }
        case "implies":
        case "iff": {
            addExpression({
                id,
                argumentId,
                argumentVersion,
                premiseId,
                type: "operator",
                operator: ast.type,
                parentId,
                position,
            })
            buildExpressions(
                ast.left,
                id,
                0,
                argumentId,
                argumentVersion,
                premiseId,
                variablesBySymbol,
                addExpression
            )
            buildExpressions(
                ast.right,
                id,
                1,
                argumentId,
                argumentVersion,
                premiseId,
                variablesBySymbol,
                addExpression
            )
            return id
        }
    }
}

// ---------------------------------------------------------------------------
// ArgumentParser
// ---------------------------------------------------------------------------

/**
 * Validates and builds an `ArgumentEngine` from a parsed LLM response.
 *
 * Override the protected `map*` hooks to inject custom fields into
 * the entities created during the build phase.
 */
export class ArgumentParser<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    protected readonly responseSchema: TSchema

    constructor(responseSchema?: TSchema) {
        this.responseSchema = responseSchema ?? ParsedArgumentResponseSchema
    }

    /**
     * Validate raw LLM output against the response schema.
     */
    public validate(raw: unknown): TParsedArgumentResponse {
        return Value.Parse(this.responseSchema, raw)
    }

    /**
     * Build an ArgumentEngine from a validated response.
     *
     * @throws If `response.argument` is null
     * @throws If any formula references an undeclared variable
     * @throws If any formula contains nested implies/iff
     * @throws If a variable references an undeclared claim miniId
     * @throws If the conclusion premise miniId is unresolvable
     */
    public build(
        response: TParsedArgumentResponse,
        options?: TParserBuildOptions
    ): TArgumentParserResult<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    > {
        const warnings: TParserWarning[] = []
        const strict = options?.strict ?? true
        const arg = response.argument
        if (!arg) {
            throw new Error("Cannot build: argument is null.")
        }

        // 1. Parse all formulas upfront and validate
        const declaredSymbols = new Set(arg.variables.map((v) => v.symbol))
        const parsedFormulas: { ast: TFormulaAST; premise: TParsedPremise }[] =
            []

        for (const premise of arg.premises) {
            let ast: TFormulaAST
            try {
                ast = parseFormula(premise.formula)
            } catch (error) {
                const msg =
                    error instanceof Error ? error.message : String(error)
                if (strict) {
                    throw new Error(
                        `Failed to parse formula for premise "${premise.miniId}": ${msg}`
                    )
                }
                warnings.push({
                    code: "FORMULA_PARSE_ERROR",
                    message: `Failed to parse formula for premise "${premise.miniId}": ${msg}`,
                    context: {
                        premiseMiniId: premise.miniId,
                        formula: premise.formula,
                    },
                })
                continue
            }

            // Validate root-only constraint
            try {
                validateRootOnly(ast, true, premise.miniId)
            } catch (error) {
                const msg =
                    error instanceof Error ? error.message : String(error)
                if (strict) {
                    throw error
                }
                warnings.push({
                    code: "FORMULA_STRUCTURE_ERROR",
                    message: msg,
                    context: {
                        premiseMiniId: premise.miniId,
                        formula: premise.formula,
                    },
                })
                continue
            }

            parsedFormulas.push({ ast, premise })
        }

        // 2. Create argument
        const argumentId = randomUUID()
        const argumentVersion = 0
        const argumentExtras = this.mapArgument(arg)
        const argument = {
            ...argumentExtras,
            id: argumentId,
            version: argumentVersion,
        } as TArg

        // 3. Create claims
        const claimLibrary = new ClaimLibrary<TClaim>()
        const claimMiniIdToId = new Map<
            string,
            { id: string; version: number }
        >()

        for (const parsedClaim of arg.claims) {
            const extras = this.mapClaim(parsedClaim)
            const claimId = randomUUID()
            const claim = claimLibrary.create({
                ...extras,
                id: claimId,
            } as Omit<TClaim, "version" | "frozen" | "checksum">)
            claimMiniIdToId.set(parsedClaim.miniId, {
                id: claim.id,
                version: claim.version,
            })
        }

        // 4. Create sources
        const sourceLibrary = new SourceLibrary<TSource>()
        const sourceMiniIdToId = new Map<
            string,
            { id: string; version: number }
        >()

        for (const parsedSource of arg.sources) {
            const extras = this.mapSource(parsedSource)
            const sourceId = randomUUID()
            const source = sourceLibrary.create({
                ...extras,
                id: sourceId,
            } as Omit<TSource, "version" | "frozen" | "checksum">)
            sourceMiniIdToId.set(parsedSource.miniId, {
                id: source.id,
                version: source.version,
            })
        }

        // 5. Wire claim-source associations
        const claimSourceLibrary = new ClaimSourceLibrary<TAssoc>(
            claimLibrary,
            sourceLibrary
        )

        for (const parsedClaim of arg.claims) {
            const claimRef = claimMiniIdToId.get(parsedClaim.miniId)!
            for (const sourceMiniId of parsedClaim.sourceMiniIds) {
                const sourceRef = sourceMiniIdToId.get(sourceMiniId)
                if (!sourceRef) {
                    if (strict) {
                        throw new Error(
                            `Claim "${parsedClaim.miniId}" references undeclared source "${sourceMiniId}".`
                        )
                    }
                    warnings.push({
                        code: "UNRESOLVED_SOURCE_MINIID",
                        message: `Claim "${parsedClaim.miniId}" references undeclared source "${sourceMiniId}".`,
                        context: {
                            claimMiniId: parsedClaim.miniId,
                            sourceMiniId,
                        },
                    })
                    continue
                }
                const extras = this.mapClaimSourceAssociation(
                    parsedClaim,
                    claimRef.id,
                    sourceRef.id
                )
                claimSourceLibrary.add({
                    ...extras,
                    id: randomUUID(),
                    claimId: claimRef.id,
                    claimVersion: claimRef.version,
                    sourceId: sourceRef.id,
                    sourceVersion: sourceRef.version,
                } as Omit<TAssoc, "checksum">)
            }
        }

        // 6. Create ArgumentEngine
        const engine = new ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >(argument, claimLibrary, sourceLibrary, claimSourceLibrary)

        // 7. Create variables — resolve claimMiniId to real claim UUID
        const variablesBySymbol = new Map<
            string,
            Omit<TClaimBoundVariable, "checksum">
        >()

        for (const parsedVar of arg.variables) {
            const claimRef = claimMiniIdToId.get(parsedVar.claimMiniId)
            if (!claimRef) {
                if (strict) {
                    throw new Error(
                        `Variable "${parsedVar.miniId}" references undeclared claim miniId "${parsedVar.claimMiniId}".`
                    )
                }
                warnings.push({
                    code: "UNRESOLVED_CLAIM_MINIID",
                    message: `Variable "${parsedVar.miniId}" references undeclared claim miniId "${parsedVar.claimMiniId}".`,
                    context: {
                        variableMiniId: parsedVar.miniId,
                        claimMiniId: parsedVar.claimMiniId,
                    },
                })
                declaredSymbols.delete(parsedVar.symbol)
                continue
            }
            const extras = this.mapVariable(parsedVar)
            const variable: Omit<TClaimBoundVariable, "checksum"> &
                Record<string, unknown> = {
                ...extras,
                id: randomUUID(),
                argumentId,
                argumentVersion,
                symbol: parsedVar.symbol,
                claimId: claimRef.id,
                claimVersion: claimRef.version,
            }
            variablesBySymbol.set(parsedVar.symbol, variable)
            engine.addVariable(variable)
        }

        // 7b. Filter formulas against surviving declared symbols
        const survivingFormulas: typeof parsedFormulas = []
        for (const entry of parsedFormulas) {
            const formulaVarNames = new Set<string>()
            collectVariableNames(entry.ast, formulaVarNames)
            let hasUndeclared = false
            for (const name of formulaVarNames) {
                if (!declaredSymbols.has(name)) {
                    if (strict) {
                        throw new Error(
                            `Formula for premise "${entry.premise.miniId}" references undeclared variable symbol "${name}". Declared symbols: ${[...declaredSymbols].join(", ")}.`
                        )
                    }
                    warnings.push({
                        code: "UNDECLARED_VARIABLE_SYMBOL",
                        message: `Formula for premise "${entry.premise.miniId}" references undeclared variable symbol "${name}". Declared symbols: ${[...declaredSymbols].join(", ")}.`,
                        context: {
                            premiseMiniId: entry.premise.miniId,
                            symbol: name,
                        },
                    })
                    hasUndeclared = true
                    break
                }
            }
            if (!hasUndeclared) survivingFormulas.push(entry)
        }

        // 8. Create premises and build expression trees
        const premiseMiniIdToId = new Map<string, string>()

        for (const { ast, premise: parsedPremise } of survivingFormulas) {
            const extras = this.mapPremise(parsedPremise)
            const { result: pm } = engine.createPremise(extras)
            premiseMiniIdToId.set(parsedPremise.miniId, pm.getId())

            buildExpressions(
                ast,
                null,
                POSITION_INITIAL,
                argumentId,
                argumentVersion,
                pm.getId(),
                variablesBySymbol,
                (expr) => pm.addExpression(expr as TExpressionInput<TExpr>)
            )
        }

        // 9. Set conclusion
        const conclusionId = premiseMiniIdToId.get(arg.conclusionPremiseMiniId)
        if (!conclusionId) {
            if (strict) {
                throw new Error(
                    `Conclusion premise miniId "${arg.conclusionPremiseMiniId}" could not be resolved to a premise.`
                )
            }
            warnings.push({
                code: "UNRESOLVED_CONCLUSION_MINIID",
                message: `Conclusion premise miniId "${arg.conclusionPremiseMiniId}" could not be resolved to a premise.`,
                context: {
                    conclusionPremiseMiniId: arg.conclusionPremiseMiniId,
                },
            })
        } else {
            engine.setConclusionPremise(conclusionId)
        }

        return {
            engine,
            claimLibrary,
            sourceLibrary,
            claimSourceLibrary,
            warnings,
        }
    }

    // -----------------------------------------------------------------------
    // Protected mapping hooks — override to inject custom fields
    // -----------------------------------------------------------------------

    protected mapArgument(_parsed: TParsedArgument): Record<string, unknown> {
        return {}
    }

    protected mapClaim(_parsed: TParsedClaim): Record<string, unknown> {
        return {}
    }

    protected mapSource(_parsed: TParsedSource): Record<string, unknown> {
        return {}
    }

    protected mapVariable(_parsed: TParsedVariable): Record<string, unknown> {
        return {}
    }

    protected mapPremise(_parsed: TParsedPremise): Record<string, unknown> {
        return {}
    }

    protected mapClaimSourceAssociation(
        _parsed: TParsedClaim,
        _claimId: string,
        _sourceId: string
    ): Record<string, unknown> {
        return {}
    }
}
