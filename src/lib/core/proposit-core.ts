import type {
    TCoreArgument,
    TCorePremise,
    TCoreDerivationPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type { TCoreClaimConnection } from "../schemata/claim-connection.js"
import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
} from "../schemata/fork.js"
import type {
    TPropositCoreSnapshot,
    TPropositCoreConfig,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    LEGACY_CLAIM_CITATION_SHAPE,
    LEGACY_MISSING_AXIOM_SLOT,
} from "../types/validation.js"
import type { TForkArgumentOptions, TForkRemapTable } from "../types/fork.js"
import type { TCoreArgumentDiff, TCoreDiffOptions } from "../types/diff.js"
import { isClaimBound } from "../schemata/propositional.js"
import { ClaimLibrary } from "./claim-library.js"
import { ClaimCitationLibrary } from "./claim-citation-library.js"
import { ClaimAxiomLibrary } from "./claim-axiom-library.js"
import { ArgumentLibrary } from "./argument-library.js"
import { ArgumentEngine, defaultGenerateId } from "./argument-engine.js"
import { ForkLibrary } from "./fork-library.js"
import { forkArgumentEngine } from "./fork.js"
import { diffArguments as standaloneDiffArguments } from "./diff.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

/**
 * Options for constructing a `PropositCore` instance. Accepts optional
 * pre-constructed library instances and/or shared configuration. When a
 * library instance is provided, it is used directly; otherwise a new one
 * is constructed using the shared config.
 */
export type TPropositCoreOptions<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
> = TPropositCoreConfig & {
    /** Pre-constructed claim library instance. */
    claimLibrary?: ClaimLibrary<TClaim>
    /** Pre-constructed claim-citation library instance. */
    claimCitationLibrary?: ClaimCitationLibrary<TCitation>
    /** Pre-constructed claim-axiom library instance. */
    claimAxiomLibrary?: ClaimAxiomLibrary<TAxiom>
    /** Pre-constructed fork library instance. */
    forkLibrary?: ForkLibrary<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork
    >
    /** Pre-constructed argument library instance. */
    argumentLibrary?: ArgumentLibrary<TArg, TPremise, TExpr, TVar, TClaim>
}

/**
 * Top-level orchestrator for the proposit-core system. Owns all four
 * libraries (claims, claim citations, forks, arguments) and provides
 * unified snapshot/restore and validation.
 *
 * Construction order follows dependency order:
 * claims -> citations -> axioms -> forks -> arguments.
 *
 * As of v0.10.0 the legacy `sources` and `claimSources` libraries have been
 * folded into `claims` and `citations` respectively — sources are now
 * claims with `type: "citation"`. As of v0.12.0 a parallel `axioms` library
 * holds axiomatic-claim connections (a third claim type `"axiomatic"`).
 */
export class PropositCore<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
> {
    public readonly claims: ClaimLibrary<TClaim>
    public readonly citations: ClaimCitationLibrary<TCitation>
    public readonly axioms: ClaimAxiomLibrary<TAxiom>
    public readonly forks: ForkLibrary<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork
    >
    public readonly arguments: ArgumentLibrary<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TClaim
    >
    protected generateId: () => string

    constructor(
        options?: TPropositCoreOptions<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TClaim,
            TCitation,
            TAxiom,
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork
        >
    ) {
        this.generateId = options?.generateId ?? defaultGenerateId

        const checksumOpts = options?.checksumConfig
            ? { checksumConfig: options.checksumConfig }
            : undefined

        // Dependency order: claims -> citations/axioms -> forks -> arguments
        this.claims =
            options?.claimLibrary ?? new ClaimLibrary<TClaim>(checksumOpts)

        this.citations =
            options?.claimCitationLibrary ??
            new ClaimCitationLibrary<TCitation>(this.claims, checksumOpts)

        this.axioms =
            options?.claimAxiomLibrary ??
            new ClaimAxiomLibrary<TAxiom>(this.claims, checksumOpts)

        this.forks =
            options?.forkLibrary ??
            new ForkLibrary<
                TArgFork,
                TPremiseFork,
                TExprFork,
                TVarFork,
                TClaimFork
            >()

        this.arguments =
            options?.argumentLibrary ??
            new ArgumentLibrary<TArg, TPremise, TExpr, TVar, TClaim>(
                {
                    claimLibrary: this.claims,
                },
                {
                    checksumConfig: options?.checksumConfig,
                    positionConfig: options?.positionConfig,
                    grammarConfig: options?.grammarConfig,
                    generateId: this.generateId,
                }
            )
    }

    /**
     * Returns a serializable snapshot of the entire PropositCore state,
     * including all libraries.
     */
    public snapshot(): TPropositCoreSnapshot<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TClaim,
        TCitation,
        TAxiom,
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork
    > {
        return {
            arguments: this.arguments.snapshot(),
            claims: this.claims.snapshot(),
            citations: this.citations.snapshot(),
            axioms: this.axioms.snapshot(),
            forks: this.forks.snapshot(),
        }
    }

    /**
     * Restores a `PropositCore` instance from a snapshot. Libraries are
     * restored in dependency order: claims -> citations -> axioms -> forks ->
     * arguments.
     *
     * @param snapshot - The serialized PropositCore snapshot.
     * @param config - Optional shared configuration for the restored instance.
     * @returns A fully restored `PropositCore` instance.
     */
    public static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TClaim extends TCoreClaim = TCoreClaim,
        TCitation extends TCoreClaimConnection = TCoreClaimConnection,
        TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
        TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
        TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
        TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
        TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
        TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    >(
        snapshot: TPropositCoreSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TClaim,
            TCitation,
            TAxiom,
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork
        >,
        config?: TPropositCoreConfig
    ): PropositCore<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TClaim,
        TCitation,
        TAxiom,
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork
    > {
        // Pre-typecheck on raw shape. PropositCore.fromSnapshot is called with an
        // `unknown`-typed payload in real callers; the typed signature does not
        // prevent legacy data from sneaking in. Run structural checks before any
        // typed coercion.
        const raw = snapshot as unknown as Record<string, unknown>
        if ("claimCitations" in raw) {
            throw new InvariantViolationError([
                {
                    code: LEGACY_CLAIM_CITATION_SHAPE,
                    message: `${LEGACY_CLAIM_CITATION_SHAPE}: PropositCore snapshot uses pre-v0.12 slot 'claimCitations'. Run the v0.12 CLI migration.`,
                    entityType: "citation",
                    entityId: "<snapshot>",
                },
            ])
        }
        if (!("axioms" in raw)) {
            throw new InvariantViolationError([
                {
                    code: LEGACY_MISSING_AXIOM_SLOT,
                    message: `${LEGACY_MISSING_AXIOM_SLOT}: PropositCore snapshot is missing the 'axioms' slot. Run the v0.12 CLI migration to add it.`,
                    entityType: "axiom",
                    entityId: "<snapshot>",
                },
            ])
        }

        const checksumOpts = config?.checksumConfig
            ? { checksumConfig: config.checksumConfig }
            : undefined

        // Dependency order: claims -> citations/axioms -> forks -> arguments
        const claims = ClaimLibrary.fromSnapshot<TClaim>(
            snapshot.claims,
            checksumOpts
        )
        const citations = ClaimCitationLibrary.fromSnapshot<TCitation>(
            snapshot.citations,
            claims,
            checksumOpts
        )
        const axioms = ClaimAxiomLibrary.fromSnapshot<TAxiom>(
            snapshot.axioms,
            claims,
            checksumOpts
        )
        const forks = ForkLibrary.fromSnapshot<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork
        >(snapshot.forks)
        const restoredArguments = ArgumentLibrary.fromSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TClaim
        >(
            snapshot.arguments,
            {
                claimLibrary: claims,
            },
            {
                checksumConfig: config?.checksumConfig,
                positionConfig: config?.positionConfig,
                grammarConfig: config?.grammarConfig,
                generateId: config?.generateId,
            }
        )

        const core = new PropositCore<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TClaim,
            TCitation,
            TAxiom,
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork
        >({
            claimLibrary: claims,
            claimCitationLibrary: citations,
            claimAxiomLibrary: axioms,
            forkLibrary: forks,
            argumentLibrary: restoredArguments,
        })

        core.generateId = config?.generateId ?? defaultGenerateId

        return core
    }

    /**
     * Runs invariant validation across all managed libraries and merges
     * the results.
     *
     * @returns A combined validation result.
     */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = [
            ...this.claims.validate().violations,
            ...this.citations.validate().violations,
            ...this.axioms.validate().violations,
            ...this.forks.validate().violations,
            ...this.arguments.validate().violations,
        ]
        return { ok: violations.length === 0, violations }
    }

    /**
     * Forks an argument, cloning its referenced claims (including any
     * citation-typed claims reachable via citations) and the citation edges
     * between them, then remaps variable claim references to point at the
     * cloned claims. Creates fork records in all five namespaces.
     *
     * @param argumentId - The ID of the argument to fork.
     * @param newArgumentId - The ID for the forked argument. Defaults to `this.generateId()`.
     * @param options - Optional fork configuration and extras for fork records.
     * @returns The forked engine, remap tables, and the argument fork record.
     */
    public forkArgument(
        argumentId: string,
        newArgumentId?: string,
        options?: TForkArgumentOptions & {
            forkId?: string
            argumentForkExtras?: Partial<
                Omit<TArgFork, keyof TCoreArgumentForkRecord>
            >
            premiseForkExtras?: Partial<
                Omit<TPremiseFork, keyof TCorePremiseForkRecord>
            >
            expressionForkExtras?: Partial<
                Omit<TExprFork, keyof TCoreExpressionForkRecord>
            >
            variableForkExtras?: Partial<
                Omit<TVarFork, keyof TCoreVariableForkRecord>
            >
            claimForkExtras?: Partial<
                Omit<TClaimFork, keyof TCoreClaimForkRecord>
            >
        }
    ): {
        engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
        remapTable: TForkRemapTable
        claimRemap: Map<string, string>
        argumentFork: TArgFork
    } {
        // Step 1: Retrieve source engine
        const engine = this.arguments.get(argumentId)
        if (!engine) {
            throw new Error(
                `Argument "${argumentId}" not found in ArgumentLibrary.`
            )
        }

        // Step 2: canFork guard
        if (!engine.canFork()) {
            throw new Error(`Forking argument "${argumentId}" is not allowed.`)
        }

        const sourceArg = engine.getArgument()
        const resolvedNewArgumentId = newArgumentId ?? this.generateId()
        const forkId = options?.forkId ?? this.generateId()

        // Build expressionId → premiseId map from source engine snapshot
        const sourceSnap = engine.snapshot()
        const exprToPremiseMap = new Map<string, string>()
        for (const ps of sourceSnap.premises) {
            for (const expr of ps.expressions.expressions) {
                exprToPremiseMap.set(expr.id, ps.premise.id)
            }
        }

        // Step 3: Determine the closure of claims to clone — start from
        // claim-bound variables, then transitively pull in any source-side
        // claim referenced by a citation whose citing-side is already in
        // the closure (citation-typed claims become part of the fork too).
        const claimRemap = new Map<string, string>()
        const claimVersionMap = new Map<string, number>()
        const variables = engine.getVariables()
        const uniqueClaimIds = new Set<string>()
        for (const v of variables) {
            if (isClaimBound(v)) {
                uniqueClaimIds.add(v.claimId)
            }
        }

        // DFS through both the citation and axiom graphs from the seed set,
        // accumulating every reachable claim along outgoing supporting-side
        // edges. Both ends of any connection we plan to clone must themselves
        // be cloned.
        const citationsToClone: TCitation[] = []
        const axiomsToClone: TAxiom[] = []
        // Invariant: every push to connectionFrontier is gated by !uniqueClaimIds.has(...),
        // so each claim id is processed at most once. No separate visited set needed.
        const connectionFrontier: string[] = Array.from(uniqueClaimIds)
        while (connectionFrontier.length > 0) {
            const currentId = connectionFrontier.pop()!

            const outgoingCitations =
                this.citations.getConnectionsForClaim(currentId)
            for (const citation of outgoingCitations) {
                citationsToClone.push(citation)
                if (!uniqueClaimIds.has(citation.supportingClaimId)) {
                    uniqueClaimIds.add(citation.supportingClaimId)
                    connectionFrontier.push(citation.supportingClaimId)
                }
            }

            const outgoingAxioms = this.axioms.getConnectionsForClaim(currentId)
            for (const axiom of outgoingAxioms) {
                axiomsToClone.push(axiom)
                if (!uniqueClaimIds.has(axiom.supportingClaimId)) {
                    uniqueClaimIds.add(axiom.supportingClaimId)
                    connectionFrontier.push(axiom.supportingClaimId)
                }
            }
        }

        // Step 4: Clone every claim in the closure
        for (const originalClaimId of uniqueClaimIds) {
            const currentClaim = this.claims.getCurrent(originalClaimId)
            if (!currentClaim) {
                throw new Error(
                    `Claim "${originalClaimId}" not found in ClaimLibrary.`
                )
            }
            claimVersionMap.set(originalClaimId, currentClaim.version)
            const newClaimId = this.generateId()
            const {
                id: _id,
                version: _v,
                frozen: _f,
                checksum: _c,
                ...claimData
            } = currentClaim as Record<string, unknown>
            this.claims.create({
                ...claimData,
                id: newClaimId,
            } as Omit<TClaim, "version" | "frozen" | "checksum">)
            claimRemap.set(originalClaimId, newClaimId)
        }

        // Step 5: Clone citation edges between the cloned claims
        for (const citation of citationsToClone) {
            const remappedClaimId = claimRemap.get(citation.claimId)
            const remappedSupportingId = claimRemap.get(
                citation.supportingClaimId
            )
            if (!remappedClaimId || !remappedSupportingId) continue
            this.citations.add({
                ...citation,
                id: this.generateId(),
                claimId: remappedClaimId,
                claimVersion: 0,
                supportingClaimId: remappedSupportingId,
                supportingClaimVersion: 0,
            } as Omit<TCitation, "checksum">)
        }

        // Step 5b: Clone axiom edges between the cloned claims
        for (const axiom of axiomsToClone) {
            const remappedClaimId = claimRemap.get(axiom.claimId)
            const remappedSupportingId = claimRemap.get(axiom.supportingClaimId)
            if (!remappedClaimId || !remappedSupportingId) continue
            this.axioms.add({
                ...axiom,
                id: this.generateId(),
                claimId: remappedClaimId,
                claimVersion: 0,
                supportingClaimId: remappedSupportingId,
                supportingClaimVersion: 0,
            } as Omit<TAxiom, "checksum">)
        }

        // Step 6: Fork engine
        const { engine: forkedEngine, remapTable } = forkArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TClaim
        >(
            engine,
            resolvedNewArgumentId,
            {
                claimLibrary: this.claims,
            },
            {
                ...options,
                generateId: options?.generateId ?? this.generateId,
            }
        )

        // Step 7: Remap claim references
        const snap = forkedEngine.snapshot()
        snap.variables.variables = snap.variables.variables.map((v) => {
            if (isClaimBound(v)) {
                const clonedClaimId = claimRemap.get(v.claimId)
                if (clonedClaimId) {
                    return {
                        ...v,
                        claimId: clonedClaimId,
                        claimVersion: 0,
                    } as typeof v
                }
            }
            return v
        })

        // Remap derivedClaimId in derivation premises
        for (const ps of snap.premises) {
            const premise = ps.premise as TCorePremise
            if (premise.type === "derivation") {
                const originalDerivedClaimId = (
                    premise as unknown as TCoreDerivationPremise
                ).derivedClaimId
                const remappedDerivedClaimId = claimRemap.get(
                    originalDerivedClaimId
                )
                if (remappedDerivedClaimId) {
                    ps.premise = {
                        ...ps.premise,
                        derivedClaimId: remappedDerivedClaimId,
                    } as typeof ps.premise
                }
            }
        }

        const finalEngine = ArgumentEngine.fromSnapshot<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TClaim
        >(
            snap,
            this.claims,
            snap.config?.grammarConfig,
            "ignore",
            this.generateId
        )

        // Step 8: Register engine
        this.arguments.register(finalEngine)

        // Step 9: Create fork records

        // Argument fork record
        const argumentFork = this.forks.arguments.create({
            entityId: resolvedNewArgumentId,
            forkedFromEntityId: sourceArg.id,
            forkedFromArgumentId: sourceArg.id,
            forkedFromArgumentVersion: sourceArg.version,
            forkId,
            ...options?.argumentForkExtras,
        } as TArgFork)

        // Premise fork records
        for (const [oldPremiseId, newPremiseId] of remapTable.premises) {
            this.forks.premises.create({
                entityId: newPremiseId,
                forkedFromEntityId: oldPremiseId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                ...options?.premiseForkExtras,
            } as TPremiseFork)
        }

        // Expression fork records
        for (const [oldExprId, newExprId] of remapTable.expressions) {
            this.forks.expressions.create({
                entityId: newExprId,
                forkedFromEntityId: oldExprId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                forkedFromPremiseId: exprToPremiseMap.get(oldExprId)!,
                ...options?.expressionForkExtras,
            } as TExprFork)
        }

        // Variable fork records
        for (const [oldVarId, newVarId] of remapTable.variables) {
            this.forks.variables.create({
                entityId: newVarId,
                forkedFromEntityId: oldVarId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                ...options?.variableForkExtras,
            } as TVarFork)
        }

        // Claim fork records
        for (const [originalClaimId, clonedClaimId] of claimRemap) {
            this.forks.claims.create({
                entityId: clonedClaimId,
                forkedFromEntityId: originalClaimId,
                forkedFromArgumentId: sourceArg.id,
                forkedFromArgumentVersion: sourceArg.version,
                forkId,
                forkedFromEntityVersion: claimVersionMap.get(originalClaimId)!,
                ...options?.claimForkExtras,
            } as TClaimFork)
        }

        // Step 10: Return
        return {
            engine: finalEngine,
            remapTable,
            claimRemap,
            argumentFork,
        }
    }

    /**
     * Computes a structural diff between two arguments managed by this
     * `PropositCore` instance. Automatically injects fork-aware entity
     * matchers derived from the fork records stored in `this.forks`.
     * Caller-provided matchers in `options` take precedence over the
     * fork-aware defaults.
     *
     * @param argumentIdA - The ID of the "before" argument.
     * @param argumentIdB - The ID of the "after" argument.
     * @param options - Optional diff configuration and comparator overrides.
     * @returns A structural diff between the two arguments.
     */
    public diffArguments(
        argumentIdA: string,
        argumentIdB: string,
        options?: TCoreDiffOptions<TArg, TVar, TPremise, TExpr>
    ): TCoreArgumentDiff<TArg, TVar, TPremise, TExpr> {
        const engineA = this.arguments.get(argumentIdA)
        if (!engineA) {
            throw new Error(`Argument "${argumentIdA}" not found.`)
        }
        const engineB = this.arguments.get(argumentIdB)
        if (!engineB) {
            throw new Error(`Argument "${argumentIdB}" not found.`)
        }

        // Build fork-aware matchers from fork records
        const forkPremiseMatcher = (a: TPremise, b: TPremise): boolean => {
            const record = this.forks.premises.get(b.id)
            return record?.forkedFromEntityId === a.id
        }
        const forkVariableMatcher = (a: TVar, b: TVar): boolean => {
            const record = this.forks.variables.get(b.id)
            return record?.forkedFromEntityId === a.id
        }
        const forkExpressionMatcher = (a: TExpr, b: TExpr): boolean => {
            const record = this.forks.expressions.get(b.id)
            return record?.forkedFromEntityId === a.id
        }

        // Caller-provided matchers override fork-aware matchers
        return standaloneDiffArguments(engineA, engineB, {
            ...options,
            premiseMatcher: options?.premiseMatcher ?? forkPremiseMatcher,
            variableMatcher: options?.variableMatcher ?? forkVariableMatcher,
            expressionMatcher:
                options?.expressionMatcher ?? forkExpressionMatcher,
        })
    }
}
