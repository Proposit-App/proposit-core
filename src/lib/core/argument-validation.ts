import { Value } from "typebox/value"
import {
    CoreArgumentSchema,
    isClaimBound,
    isExpressionBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../schemata/index.js"
import type {
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../types/evaluation.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE,
    ARG_RESPONDS_TO_ITSELF,
    VAR_BINDING_AMBIGUOUS,
    ARG_SCHEMA_INVALID,
    ARG_OWNERSHIP_MISMATCH,
    ARG_CLAIM_REF_NOT_FOUND,
    ARG_PREMISE_REF_NOT_FOUND,
    ARG_CIRCULARITY_DETECTED,
    ARG_CONCLUSION_NOT_FOUND,
    ARG_CHECKSUM_MISMATCH,
} from "../types/validation.js"
import { getOrCreate, sortedUnique } from "../utils/collections.js"
import {
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"

/**
 * Read-only interface providing the data validation needs from an
 * argument engine. This is intentionally narrow — validation should
 * not mutate anything beyond flushing checksums.
 */
export interface TArgumentValidationContext {
    argumentId: string
    argumentVersion: number
    conclusionPremiseId: string | undefined
    getArgument(): TCoreArgument
    getVariables(): TCorePropositionalVariable[]
    listPremises(): TValidatablePremise[]
    hasPremise(premiseId: string): boolean
    lookupClaim(claimId: string, claimVersion: number): unknown
    flushAndGetChecksumDeltas(): {
        savedMeta: string | undefined
        savedDescendant: string | null | undefined
        savedCombined: string | undefined
        currentMeta: string | undefined
        currentDescendant: string | null | undefined
        currentCombined: string | undefined
    }
    validateVariables(): TInvariantValidationResult
    wouldCreateCycle(
        variableId: string,
        premiseId: string,
        visited: Set<string>
    ): boolean
}

/**
 * Narrow view of a PremiseEngine needed for validation.
 */
export interface TValidatablePremise {
    getId(): string
    validate(): TInvariantValidationResult
    validateEvaluability(): TCoreValidationResult
    getExpressions(): TCorePropositionalExpression[]
    getVariables(): TCorePropositionalVariable[]
}

/**
 * Indexes variables referenced across all premises by ID and by symbol.
 */
export function collectArgumentReferencedVariables(
    ctx: TArgumentValidationContext
): {
    variableIds: string[]
    byId: Record<string, { symbol: string; premiseIds: string[] }>
    bySymbol: Record<string, { variableIds: string[]; premiseIds: string[] }>
} {
    const byIdTmp = new Map<
        string,
        { symbols: Set<string>; premiseIds: Set<string> }
    >()
    const bySymbolTmp = new Map<
        string,
        { variableIds: Set<string>; premiseIds: Set<string> }
    >()

    for (const premise of ctx.listPremises()) {
        const premiseId = premise.getId()
        const varsById = new Map(premise.getVariables().map((v) => [v.id, v]))
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

    const byId: Record<string, { symbol: string; premiseIds: string[] }> = {}
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
 * Lightweight validation triggered after a PremiseEngine mutation.
 * Skips per-premise deep validation (which is O(n) over all premises)
 * and argument-level checksum stability checks (checksums are known to
 * be dirty). Only checks argument-level cross-references that a
 * PremiseEngine mutation could affect.
 */
export function validateArgumentAfterPremiseMutation(
    ctx: TArgumentValidationContext
): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []

    // Variable references: ensure all variable expressions in the
    // mutated premise still reference known variables (this is the main
    // cross-cutting invariant a premise mutation can break).
    for (const v of ctx.getVariables()) {
        const base = v as unknown as TCorePropositionalVariable
        if (isPremiseBound(base)) {
            const pb = base as unknown as TPremiseBoundVariable
            if (pb.boundArgumentId === ctx.argumentId) {
                if (!ctx.hasPremise(pb.boundPremiseId)) {
                    violations.push({
                        code: ARG_PREMISE_REF_NOT_FOUND,
                        message: `Premise-bound variable "${pb.id}" references non-existent premise "${pb.boundPremiseId}".`,
                        entityType: "variable",
                        entityId: pb.id,
                    })
                }
            }
        }
    }

    // Conclusion premise reference
    if (
        ctx.conclusionPremiseId !== undefined &&
        !ctx.hasPremise(ctx.conclusionPremiseId)
    ) {
        violations.push({
            code: ARG_CONCLUSION_NOT_FOUND,
            message: `Conclusion premise "${ctx.conclusionPremiseId}" does not exist in this argument.`,
            entityType: "argument",
            entityId: ctx.argumentId,
        })
    }

    return {
        ok: violations.length === 0,
        violations,
    }
}

/**
 * Comprehensive invariant validation for an argument. Performs 9 checks:
 * schema conformance, variable manager validation, per-premise validation,
 * variable ownership, claim-bound references, premise-bound references,
 * circularity detection, conclusion reference, and checksum stability.
 */
export function validateArgument(
    ctx: TArgumentValidationContext
): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []

    // 1. Schema check — flush checksums first so fields are populated
    const deltas = ctx.flushAndGetChecksumDeltas()
    const arg = ctx.getArgument()
    if (!Value.Check(CoreArgumentSchema, arg as unknown as TCoreArgument)) {
        violations.push({
            code: ARG_SCHEMA_INVALID,
            message: `Argument "${arg.id}" does not conform to CoreArgumentSchema.`,
            entityType: "argument",
            entityId: arg.id,
        })
    }

    // A response names the argument it answers; that argument is never itself.
    const respondsTo = (arg as unknown as TCoreArgument).respondsTo
    if (respondsTo?.argumentId === arg.id) {
        violations.push({
            code: ARG_RESPONDS_TO_ITSELF,
            message: `Argument "${arg.id}" cannot respond to itself.`,
            entityType: "argument",
            entityId: arg.id,
        })
    }

    // Each variable has exactly one kind of reference, and an expression-bound
    // one lives only in a response and binds into the argument it answers.
    for (const v of ctx.getVariables()) {
        const kinds = [
            isClaimBound(v),
            isPremiseBound(v),
            isExpressionBound(v),
        ].filter(Boolean).length
        if (kinds > 1) {
            violations.push({
                code: VAR_BINDING_AMBIGUOUS,
                message: `Variable "${v.id}" has more than one kind of reference.`,
                entityType: "variable",
                entityId: v.id,
            })
        }
        if (!isExpressionBound(v)) continue
        if (respondsTo === undefined) {
            violations.push({
                code: ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE,
                message: `Variable "${v.id}" is bound to another argument's expression, but argument "${arg.id}" is not a response.`,
                entityType: "variable",
                entityId: v.id,
            })
        } else if (v.boundArgumentId !== respondsTo.argumentId) {
            violations.push({
                code: ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE,
                message: `Variable "${v.id}" is bound into argument "${v.boundArgumentId}", but the response answers "${respondsTo.argumentId}".`,
                entityType: "variable",
                entityId: v.id,
            })
        }
    }

    // 2. Delegate to VariableManager.validate()
    const varResult = ctx.validateVariables()
    violations.push(...varResult.violations)

    // 3. Delegate to each PremiseEngine.validate()
    for (const pe of ctx.listPremises()) {
        const premiseResult = pe.validate()
        violations.push(...premiseResult.violations)
    }

    // 4. Variable ownership: all variables must belong to this argument
    for (const v of ctx.getVariables()) {
        const base = v as unknown as TCorePropositionalVariable
        if (
            base.argumentId !== ctx.argumentId ||
            base.argumentVersion !== ctx.argumentVersion
        ) {
            violations.push({
                code: ARG_OWNERSHIP_MISMATCH,
                message: `Variable "${base.id}" has argumentId/version "${base.argumentId}/${base.argumentVersion}" but engine is "${ctx.argumentId}/${ctx.argumentVersion}".`,
                entityType: "variable",
                entityId: base.id,
            })
        }
    }

    // 5. Claim-bound variable references
    for (const v of ctx.getVariables()) {
        const base = v as unknown as TCorePropositionalVariable
        if (isClaimBound(base)) {
            const cb = base as unknown as TClaimBoundVariable
            if (!ctx.lookupClaim(cb.claimId, cb.claimVersion)) {
                violations.push({
                    code: ARG_CLAIM_REF_NOT_FOUND,
                    message: `Variable "${cb.id}" references claim "${cb.claimId}" version ${cb.claimVersion} which does not exist in the claim library.`,
                    entityType: "variable",
                    entityId: cb.id,
                })
            }
        }
    }

    // 6. Premise-bound internal variable references
    for (const v of ctx.getVariables()) {
        const base = v as unknown as TCorePropositionalVariable
        if (isPremiseBound(base)) {
            const pb = base as unknown as TPremiseBoundVariable
            if (pb.boundArgumentId === ctx.argumentId) {
                if (!ctx.hasPremise(pb.boundPremiseId)) {
                    violations.push({
                        code: ARG_PREMISE_REF_NOT_FOUND,
                        message: `Premise-bound variable "${pb.id}" references non-existent premise "${pb.boundPremiseId}".`,
                        entityType: "variable",
                        entityId: pb.id,
                    })
                }
            }
        }
    }

    // 7. Circularity detection for internal premise-bound variables.
    //    A cycle exists when a premise-bound variable's bound premise
    //    transitively references back to itself through other
    //    premise-bound variables.
    for (const v of ctx.getVariables()) {
        const base = v as unknown as TCorePropositionalVariable
        if (isPremiseBound(base)) {
            const pb = base as unknown as TPremiseBoundVariable
            if (pb.boundArgumentId === ctx.argumentId) {
                // Trace from the bound premise through expressions'
                // variable references to see if we reach back to the
                // same premise.
                if (ctx.hasPremise(pb.boundPremiseId)) {
                    const boundPremise = ctx
                        .listPremises()
                        .find((p) => p.getId() === pb.boundPremiseId)
                    if (boundPremise) {
                        let hasCycle = false
                        for (const expr of boundPremise.getExpressions()) {
                            if (expr.type === "variable") {
                                try {
                                    if (
                                        ctx.wouldCreateCycle(
                                            expr.variableId,
                                            pb.boundPremiseId,
                                            new Set()
                                        )
                                    ) {
                                        hasCycle = true
                                        break
                                    }
                                } catch {
                                    hasCycle = true
                                    break
                                }
                            }
                        }
                        if (hasCycle) {
                            violations.push({
                                code: ARG_CIRCULARITY_DETECTED,
                                message: `Premise-bound variable "${pb.id}" creates a circular dependency through premise "${pb.boundPremiseId}".`,
                                entityType: "variable",
                                entityId: pb.id,
                            })
                        }
                    }
                }
            }
        }
    }

    // 8. Conclusion premise reference
    if (
        ctx.conclusionPremiseId !== undefined &&
        !ctx.hasPremise(ctx.conclusionPremiseId)
    ) {
        violations.push({
            code: ARG_CONCLUSION_NOT_FOUND,
            message: `Conclusion premise "${ctx.conclusionPremiseId}" does not exist in this argument.`,
            entityType: "argument",
            entityId: ctx.argumentId,
        })
    }

    // 9. Argument-level checksum verification
    if (
        deltas.savedMeta !== undefined &&
        deltas.savedMeta !== deltas.currentMeta
    ) {
        violations.push({
            code: ARG_CHECKSUM_MISMATCH,
            message: `Argument "${ctx.argumentId}" meta checksum changed after flush: "${deltas.savedMeta}" → "${deltas.currentMeta}".`,
            entityType: "argument",
            entityId: ctx.argumentId,
        })
    }
    if (
        deltas.savedDescendant !== undefined &&
        deltas.savedDescendant !== deltas.currentDescendant
    ) {
        violations.push({
            code: ARG_CHECKSUM_MISMATCH,
            message: `Argument "${ctx.argumentId}" descendant checksum changed after flush: "${String(deltas.savedDescendant)}" → "${String(deltas.currentDescendant)}".`,
            entityType: "argument",
            entityId: ctx.argumentId,
        })
    }
    if (
        deltas.savedCombined !== undefined &&
        deltas.savedCombined !== deltas.currentCombined
    ) {
        violations.push({
            code: ARG_CHECKSUM_MISMATCH,
            message: `Argument "${ctx.argumentId}" combined checksum changed after flush: "${deltas.savedCombined}" → "${deltas.currentCombined}".`,
            entityType: "argument",
            entityId: ctx.argumentId,
        })
    }

    return {
        ok: violations.length === 0,
        violations,
    }
}

/**
 * Pre-evaluation structural validation. Checks conclusion presence,
 * variable-to-symbol consistency, symbol-to-variable uniqueness,
 * and delegates to per-premise evaluability checks.
 */
export function validateArgumentEvaluability(
    ctx: TArgumentValidationContext
): TCoreValidationResult {
    const issues: TCoreValidationIssue[] = []
    // A response has no conclusion, so its absence is not a fault there.
    const isResponse =
        (ctx.getArgument() as unknown as TCoreArgument).respondsTo !== undefined

    if (ctx.conclusionPremiseId === undefined) {
        if (!isResponse) {
            issues.push(
                makeErrorIssue({
                    code: "ARGUMENT_NO_CONCLUSION",
                    message: "Argument has no designated conclusion premise.",
                })
            )
        }
    } else if (!ctx.hasPremise(ctx.conclusionPremiseId)) {
        issues.push(
            makeErrorIssue({
                code: "ARGUMENT_CONCLUSION_NOT_FOUND",
                message: `Conclusion premise "${ctx.conclusionPremiseId}" does not exist.`,
                premiseId: ctx.conclusionPremiseId,
            })
        )
    }

    const idToSymbols = new Map<string, Set<string>>()
    const symbolToIds = new Map<string, Set<string>>()
    for (const premise of ctx.listPremises()) {
        const varById = new Map(premise.getVariables().map((v) => [v.id, v]))
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

    for (const premise of ctx.listPremises()) {
        const premiseValidation = premise.validateEvaluability()
        issues.push(...premiseValidation.issues)
    }

    return makeValidationResult(issues)
}
