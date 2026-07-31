import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import type { TParserWarning, TParserBuildOptions } from "./types.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
    TCoreClaimConnection,
} from "../schemata/index.js"
import { type TClaimBoundVariable } from "../schemata/propositional.js"
import { parseFormula } from "../core/parser/formula.js"
import type { TFormulaAST } from "../core/parser/formula.js"
import type { TExpressionInput } from "../core/expression-manager.js"
import { POSITION_INITIAL } from "../utils/position.js"
import { withoutUndefinedValues } from "../utils/collections.js"
import { ArgumentEngine, defaultGenerateId } from "../core/argument-engine.js"
import { ClaimLibrary } from "../core/claim-library.js"
import { ClaimCitationLibrary } from "../core/claim-citation-library.js"
import { ClaimAxiomLibrary } from "../core/claim-axiom-library.js"
import { ParsedArgumentResponseSchema } from "./schemata.js"
import { clampMaxLengths } from "./clamp-max-lengths.js"
import type {
    TParsedArgumentResponse,
    TParsedArgument,
    TParsedClaim,
    TParsedVariable,
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
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
    claimLibrary: ClaimLibrary<TClaim>
    claimCitationLibrary: ClaimCitationLibrary<TCitation>
    claimAxiomLibrary: ClaimAxiomLibrary<TAxiom>
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
    addExpression: (expr: TExpressionInput) => void,
    generateId: () => string
): string {
    const id = generateId()

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
                addExpression,
                generateId
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
                    addExpression,
                    generateId
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
                addExpression,
                generateId
            )
            buildExpressions(
                ast.right,
                id,
                1,
                argumentId,
                argumentVersion,
                premiseId,
                variablesBySymbol,
                addExpression,
                generateId
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
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
> {
    protected readonly responseSchema: TSchema

    constructor(responseSchema?: TSchema) {
        this.responseSchema = responseSchema ?? ParsedArgumentResponseSchema
    }

    /**
     * Validate raw LLM output against the response schema.
     */
    public validate(raw: unknown): TParsedArgumentResponse {
        clampMaxLengths(this.responseSchema, raw)
        // `responseSchema` is a caller-supplied `TSchema`, so TypeBox can only
        // infer `unknown` for the parsed value; the schema is contracted to
        // describe a parsed-argument response.
        return Value.Parse(this.responseSchema, raw) as TParsedArgumentResponse
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
        TClaim,
        TCitation,
        TAxiom
    > {
        const warnings: TParserWarning[] = []
        const strict = options?.strict ?? true
        const genId = options?.generateId ?? defaultGenerateId
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
        const argumentId = genId()
        const argumentVersion = 0
        const argumentExtras = this.mapArgument(arg)
        const argument = {
            ...argumentExtras,
            id: argumentId,
            version: argumentVersion,
        } as TArg

        // 3. Create claims (unified — citation-typed and normal-typed)
        const claimLibrary = new ClaimLibrary<TClaim>()
        const claimMiniIdToId = new Map<
            string,
            { id: string; version: number }
        >()

        for (const parsedClaim of arg.claims) {
            const extras = this.mapClaim(parsedClaim)
            const claimId = genId()
            const claim = claimLibrary.create({
                ...withoutUndefinedValues(extras),
                id: claimId,
                type: parsedClaim.type,
            } as Omit<TClaim, "version" | "frozen" | "checksum">)
            claimMiniIdToId.set(parsedClaim.miniId, {
                id: claim.id,
                version: claim.version,
            })
        }

        const claimCitationLibrary = new ClaimCitationLibrary<TCitation>(
            claimLibrary
        )
        const claimAxiomLibrary = new ClaimAxiomLibrary<TAxiom>(claimLibrary)

        // 5. Create ArgumentEngine
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>(
            argument,
            claimLibrary,
            {
                generateId: genId,
            }
        )

        // 6. Create variables — resolve claimMiniId to real claim UUID
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
                ...withoutUndefinedValues(extras),
                id: genId(),
                argumentId,
                argumentVersion,
                symbol: parsedVar.symbol,
                claimId: claimRef.id,
                claimVersion: claimRef.version,
            }
            variablesBySymbol.set(parsedVar.symbol, variable)
            engine.addVariable(variable)
        }

        // 6b. Filter formulas against surviving declared symbols
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

        // 7. Create premises and build expression trees.
        //
        // Permissive-build + explicit normalize() pattern. The
        // expression-tree build below is incremental (one
        // `pm.addExpression` per AST node, parents first). Under the
        // post-mutation AN hook (assistive mode), AN-3 would eagerly
        // collapse 0-child operators between addExpression calls,
        // breaking the build. We disarm AN for the build by
        // switching the engine to `permissive`, then re-arm + run a
        // single explicit `engine.normalize()` after all premises
        // are built. The parser test 'auto-normalizes nested
        // operators by inserting formula buffers' verifies AN-1
        // fires on the post-build tree as expected.
        //
        // Engines constructed at step 5 use the default behavior
        // (assistive); we save and restore so the returned engine
        // surfaces the canonical assistive state.
        //
        // D3 — unify with populate-from's pattern: `normalize()`
        // runs only on the success path (inside `try` after the
        // build completes). Behavior restoration runs on both
        // success and failure paths via a `catch` that rethrows.
        // Running `normalize()` from a `finally` block would mean AN
        // executes on a half-built tree when the build throws,
        // potentially masking the original error or collapsing the
        // partial state the caller wants to diagnose.
        const premiseMiniIdToId = new Map<string, string>()
        const savedBehavior = engine.behavior
        engine.setBehavior("permissive")
        try {
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
                    (expr) => pm.addExpression(expr as TExpressionInput<TExpr>),
                    genId
                )
            }

            // Success path: restore the original behavior, then run a
            // single explicit `engine.normalize()` so AN fires on the
            // fully-built tree (when the caller wanted assistive
            // behavior).
            engine.setBehavior(savedBehavior)
            if (savedBehavior === "assistive") {
                engine.normalize()
            }
        } catch (e) {
            // Failure path: restore behavior so the engine is not
            // left stuck in permissive after a build error. The build
            // is not transactional — the caller may inspect the
            // partial state surfaced by the original throw; only the
            // behavior flag gets restored here.
            engine.setBehavior(savedBehavior)
            throw e
        }

        // 8. Set conclusion
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

        // 9. Derivation backing edges
        //    The pipeline's deterministic relation sort extracted
        //    citation/axiomatic antecedents out of freeform premises into
        //    `derivationBacking` (each backed claim → its citation/axiomatic
        //    supporters). Materialize each as a ClaimCitationLibrary /
        //    ClaimAxiomLibrary edge.
        const citationEdgeKeys = new Set<string>()
        const axiomEdgeKeys = new Set<string>()

        const tryAddSupportEdge = <
            TConnection extends TCoreClaimConnection,
        >(params: {
            library: {
                add(connection: Omit<TConnection, "checksum">): TConnection
            }
            edgeKeys: Set<string>
            edgeKey: string
            mapHook: (
                dep: TParsedClaim,
                sup: TParsedClaim,
                depId: string,
                supId: string
            ) => Record<string, unknown>
            consequentParsed: TParsedClaim
            supportingParsed: TParsedClaim
            consequentClaimId: string
            consequentClaimVersion: number
            supportingClaim: TClaim
            warningCode: "CITATION_EDGE_REJECTED" | "AXIOM_EDGE_REJECTED"
            edgeKind: "Citation" | "Axiom"
        }): void => {
            if (params.edgeKeys.has(params.edgeKey)) return
            params.edgeKeys.add(params.edgeKey)
            const extras = params.mapHook(
                params.consequentParsed,
                params.supportingParsed,
                params.consequentClaimId,
                params.supportingClaim.id
            )
            try {
                params.library.add({
                    ...withoutUndefinedValues(extras),
                    id: genId(),
                    claimId: params.consequentClaimId,
                    claimVersion: params.consequentClaimVersion,
                    supportingClaimId: params.supportingClaim.id,
                    supportingClaimVersion: params.supportingClaim.version,
                } as Omit<TConnection, "checksum">)
            } catch (error) {
                if (strict) throw error
                const code =
                    error instanceof Error && "violations" in error
                        ? (error as { violations: { code: string }[] })
                              .violations[0]?.code
                        : "unknown"
                warnings.push({
                    code: params.warningCode,
                    message: `${params.edgeKind} edge ${params.consequentClaimId} ← ${params.supportingClaim.id} rejected by library: ${code}`,
                    context: {
                        claimId: params.consequentClaimId,
                        supportingClaimId: params.supportingClaim.id,
                        libraryErrorCode: String(code),
                    },
                })
            }
        }

        for (const backing of arg.derivationBacking ?? []) {
            const consequentRef = claimMiniIdToId.get(
                backing.derivedClaimMiniId
            )
            if (!consequentRef) continue
            const consequentParsed = arg.claims.find(
                (pc) => pc.miniId === backing.derivedClaimMiniId
            )
            if (!consequentParsed) continue
            const consequentClaimId = consequentRef.id
            const consequentClaimVersion = consequentRef.version

            for (const supporterMiniId of backing.supportingClaimMiniIds) {
                const supporterRef = claimMiniIdToId.get(supporterMiniId)
                if (!supporterRef) continue
                const supportingClaim = claimLibrary.get(
                    supporterRef.id,
                    supporterRef.version
                )
                if (!supportingClaim) continue
                const supportingParsed = arg.claims.find(
                    (pc) => pc.miniId === supporterMiniId
                )
                if (!supportingParsed) continue

                const edgeKey = `${consequentClaimId}|${supportingClaim.id}`

                if (supportingClaim.type === "citation") {
                    tryAddSupportEdge<TCitation>({
                        library: claimCitationLibrary,
                        edgeKeys: citationEdgeKeys,
                        edgeKey,
                        mapHook: (a, b, c, d) =>
                            this.mapClaimCitation(a, b, c, d),
                        consequentParsed,
                        supportingParsed,
                        consequentClaimId,
                        consequentClaimVersion,
                        supportingClaim,
                        warningCode: "CITATION_EDGE_REJECTED",
                        edgeKind: "Citation",
                    })
                } else if (supportingClaim.type === "axiomatic") {
                    tryAddSupportEdge<TAxiom>({
                        library: claimAxiomLibrary,
                        edgeKeys: axiomEdgeKeys,
                        edgeKey,
                        mapHook: (a, b, c, d) => this.mapClaimAxiom(a, b, c, d),
                        consequentParsed,
                        supportingParsed,
                        consequentClaimId,
                        consequentClaimVersion,
                        supportingClaim,
                        warningCode: "AXIOM_EDGE_REJECTED",
                        edgeKind: "Axiom",
                    })
                }
                // type === 'normal' → no edge
            }
        }

        return {
            engine,
            claimLibrary,
            claimCitationLibrary,
            claimAxiomLibrary,
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

    protected mapVariable(_parsed: TParsedVariable): Record<string, unknown> {
        return {}
    }

    protected mapPremise(_parsed: TParsedPremise): Record<string, unknown> {
        return {}
    }

    protected mapClaimCitation(
        _dependentParsed: TParsedClaim,
        _supportingParsed: TParsedClaim,
        _dependentClaimId: string,
        _supportingClaimId: string
    ): Record<string, unknown> {
        return {}
    }

    protected mapClaimAxiom(
        _dependentParsed: TParsedClaim,
        _supportingParsed: TParsedClaim,
        _dependentClaimId: string,
        _supportingClaimId: string
    ): Record<string, unknown> {
        return {}
    }
}
