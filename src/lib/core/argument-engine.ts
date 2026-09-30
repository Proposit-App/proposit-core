import {
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCoreArgument,
    type TCoreClaim,
    type TCoreDerivationPremise,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TOptionalChecksum,
} from "../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreArgumentRoleState,
    TCoreExpressionAssignment,
    TCoreValidationResult,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
    TCoreVariableAssignment,
} from "../types/evaluation.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type { TCorePositionConfig } from "../utils/position.js"
import type { TInvariantValidationResult } from "../types/validation.js"
import {
    CLAIM_NOT_FOUND,
    CREATE_DERIVATION_CLAIM_NOT_FOUND,
    CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID,
} from "../types/validation.js"
import { validateDerivationStructure } from "../utils/derivation-validation.js"
import { withoutUndefinedValues } from "../utils/collections.js"
import {
    DEFAULT_CHECKSUM_CONFIG,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "../consts.js"
import type { TCoreMutationResult, TCoreChangeset } from "../types/mutation.js"
import { composeChangesets, withCurrentEntries } from "../utils/changeset.js"
import type {
    TReactiveSnapshot,
    TReactivePremiseSnapshot,
} from "../types/reactive.js"
import { ChangeCollector } from "./change-collector.js"
import { canonicalSerialize, computeHash, entityChecksum } from "./checksum.js"
import { HierarchicalChecksumCache } from "./checksum-cache.js"
import {
    evaluateArgument as evaluateArgumentStandalone,
    checkArgumentValidity as checkArgumentValidityStandalone,
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "./evaluation/argument-evaluation.js"
import {
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"
import {
    validateArgument as validateArgumentStandalone,
    validateArgumentAfterPremiseMutation as validateAfterPremiseMutationStandalone,
    validateArgumentEvaluability as validateArgumentEvaluabilityStandalone,
    collectArgumentReferencedVariables as collectArgumentReferencedVariablesStandalone,
    type TArgumentValidationContext,
    type TValidatablePremise,
} from "./argument-validation.js"
import type { TExpressionInput } from "./expression-manager.js"
import { normalizeArgument } from "../grammar/normalize.js"
import { runAssistiveNormalization } from "../grammar/auto-normalize.js"
import { isNakedQDerivationPremise } from "../grammar/naked-q.js"
import {
    populateFromGrounding as populateFromGroundingImpl,
    type TPopulateResult,
} from "../grammar/populate-from.js"
import {
    removeUnresolvableVariables as removeUnresolvableVariablesImpl,
    removeOrphanOperators as removeOrphanOperatorsImpl,
    removeDuplicateDerivationPremises as removeDuplicateDerivationPremisesImpl,
    dropAxiomsFromMixedAntecedent as dropAxiomsFromMixedAntecedentImpl,
} from "../grammar/repair.js"
import { validate as validateGrammar } from "../grammar/validate.js"
import type { TGrammarTier, TViolation } from "../grammar/types.js"
import type { TValidatorContext as TGrammarValidatorContext } from "../grammar/validators/context.js"
import type { TCoreClaimConnection } from "../schemata/claim-connection.js"
import type { TClaimConnectionLookup } from "./interfaces/library.interfaces.js"
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
} from "./interfaces/index.js"
import {
    verifyDataChecksums,
    verifySnapshotChecksums,
} from "./argument/checksum-verification.js"
import {
    applyAxiomaticForcedAssignments,
    deriveDefaultAssignment,
    getAxiomaticBoundVariableIds,
    getClaimIdForVariable,
    getGroundedBoundVariableIds,
    getVariableIdsForClaim,
    type TClaimVariableContext,
} from "./argument/claim-variables.js"
import { type TCycleContext, wouldCreateCycle } from "./argument/circularity.js"
import { renderArgumentDisplay } from "./argument/display.js"
import { parsePremiseArgs } from "./argument/premise-args.js"

/** Default ID generator using the Web Crypto API (Node.js 20+, all modern browsers). */
export const defaultGenerateId = (): string => globalThis.crypto.randomUUID()

export type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
    /**
     * Engine behavior. Controls whether the auto-normalization (AN) rule
     * set runs as a post-hook after every successful Structural mutation.
     *
     * - `'assistive'` (default): AN runs after every successful Structural
     *   mutation. AN preserves Presentable — if the pre-mutation state was
     *   Presentable, the post-mutation state is Presentable.
     * - `'permissive'`: AN does not run. The engine accepts mutations that
     *   leave the argument outside the Presentable/Derivable/Evaluable
     *   tiers (down to but not including Structural, which is always
     *   guaranteed).
     *
     * Switchable at runtime via `engine.setBehavior(...)`. See
     * `docs/Proposit_Grammar.md` §4 for the full contract.
     *
     * @since 1.0.0
     */
    behavior?: "assistive" | "permissive"
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
    TClaim extends TCoreClaim = TCoreClaim,
>
    extends HierarchicalChecksumCache
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
    private conclusionPremiseId: string | undefined
    private checksumConfig?: TCoreChecksumConfig
    private positionConfig?: TCorePositionConfig
    private engineBehavior: "assistive" | "permissive"
    private generateId: () => string
    private restoringFromSnapshot = false
    // Re-entrance guard for the AN post-mutation hook. Each premise's
    // mutation follow-up (`followUpWithNormalization`, wired at three
    // sites: createPremise, fromSnapshot, restoreFromSnapshot) runs
    // `runAssistiveNormalization(this)` after every successful mutation
    // when `behavior === 'assistive'`. AN itself mutates premises
    // (removeExpression / reparentExpression / wrapInFormula), which
    // re-fires the follow-up. Without a guard the outer mutation would
    // trigger nested AN sweeps. The guard is
    // toggled by `_beginApplyAN()` / `_endApplyAN()` (see below); the
    // chokepoint is `applyANToFixedPoint` in
    // `src/lib/grammar/an-rules.ts`, so both
    // `runAssistiveNormalization` (post-hook) and `normalizeArgument`
    // (`engine.normalize()`) are covered by the same gate. The
    // accessor pair is `beginApplyAN()` / `endApplyAN()` below
    // (marked `@internal` — not part of the public API).
    private applyingAN = false
    // What assistive normalization has changed so far while it runs after a
    // mutation, composed in order; undefined when it is not running.
    private normalizationChanges:
        | TCoreChangeset<TExpr, TVar, TPremise, TArg>
        | undefined
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
        options?: TLogicEngineOptions
    ) {
        super()
        this.argument = { ...argument }
        this.claimLibrary = claimLibrary
        this.premises = new Map()
        this.checksumConfig = options?.checksumConfig
        this.positionConfig = options?.positionConfig
        this.engineBehavior = options?.behavior ?? "assistive"
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
            return wouldCreateCycle(
                this.asCycleContext(),
                variableId,
                targetPremiseId,
                new Set()
            )
        }
    }

    /**
     * The state the circularity check under `argument/` reads, built per call
     * and read once per call, as `asClaimVariableContext` is.
     */
    private asCycleContext(): TCycleContext<TArg, TPremise, TExpr, TVar> {
        return {
            variables: this.variables,
            premises: this.premises,
        }
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

    /**
     * Connects a premise engine to this argument: the circularity and
     * empty-bound-premise checks, the source of known variable ids, the
     * argument-level validation run after each premise mutation, the
     * change notification, and the normalization follow-up. Every place
     * that adds a premise engine to `this.premises` calls this once.
     */
    private wirePremiseEngine(
        pe: PremiseEngine<TArg, TPremise, TExpr, TVar>
    ): void {
        this.wireCircularityCheck(pe)
        this.wireEmptyBoundPremiseCheck(pe)
        pe.setVariableIdsCallback(
            () => new Set(this.variables.toArray().map((v) => v.id))
        )
        this.wireArgumentValidation(pe)
        const premiseId = pe.getId()
        pe.setOnMutate(() => {
            this.markDirty()
            this.reactiveDirty.premiseIds.add(premiseId)
            this.notifySubscribers()
        })
        pe.setMutationFollowUp((changes) =>
            this.followUpWithNormalization(changes)
        )
    }

    private wireArgumentValidation(
        pe: PremiseEngine<TArg, TPremise, TExpr, TVar>
    ): void {
        pe.setArgumentValidateCallback(() =>
            this.validateAfterPremiseMutation()
        )
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

    /**
     * Runs after every premise mutation, given the changeset it built. In
     * assistive behavior it runs normalization and returns the mutation's
     * changeset with what normalization changed composed onto it, so the
     * mutation reports everything the call changed. Returns undefined, which
     * leaves the mutation's own changeset in place, when normalization is
     * off or changed nothing. While normalization is running, the mutations
     * it makes arrive here too, and are collected rather than normalized
     * again.
     */
    private followUpWithNormalization(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> | undefined {
        if (this.restoringFromSnapshot) return undefined
        if (this.normalizationChanges !== undefined) {
            this.normalizationChanges = composeChangesets(
                this.normalizationChanges,
                changes
            )
            return undefined
        }
        if (this.engineBehavior !== "assistive") return undefined
        this.normalizationChanges = {}
        let normalized: TCoreChangeset<TExpr, TVar, TPremise, TArg>
        try {
            runAssistiveNormalization(this)
            normalized = this.normalizationChanges
        } finally {
            this.normalizationChanges = undefined
        }
        if (Object.keys(normalized).length === 0) return undefined
        return this.withCurrentEntries(composeChangesets(changes, normalized))
    }

    /** Every added and modified entry, at its current value in this engine. */
    private withCurrentEntries(
        changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
    ): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
        return withCurrentEntries(
            changes,
            (id) => {
                const pe = this.premises.get(this.expressionIndex.get(id) ?? "")
                pe?.flushChecksums()
                return pe?.getExpression(id)
            },
            (id) => this.premises.get(id)?.toPremiseData()
        )
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
            this.wireArgumentValidation(pe)
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
            const validation = this.validateInvariants()
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

    /**
     * Current engine behavior setting. Controls whether the
     * auto-normalization (AN) rule set runs as a post-hook after every
     * successful Structural mutation. See the JSDoc on
     * `TLogicEngineOptions.behavior` for the full contract.
     *
     * @since 1.0.0
     */
    public get behavior(): "assistive" | "permissive" {
        return this.engineBehavior
    }

    /**
     * Access to the engine's ID generator function. Used by in-package
     * helpers that build new entity trees and need fresh IDs (e.g. the
     * `populateFromGrounding` factory in
     * `src/lib/grammar/populate-from.ts`). The generator is captured
     * once at construction (default `crypto.randomUUID`) and stays
     * immutable for the engine's lifetime; this accessor returns the
     * same function reference on every call.
     *
     * Replaces the prior `(engine as unknown as { generateId: () =>
     * string }).generateId` cast in `populate-from.ts`. The accessor is
     * marked `@internal` so it is not surfaced in generated API docs /
     * type bundles — the in-package factory callers are its intended
     * consumers; external programmatic-construction use cases should
     * supply their own generator rather than borrowing the engine's.
     *
     * @internal
     * @since 1.0.0
     */
    public get idGenerator(): () => string {
        return this.generateId
    }

    /**
     * Switches the engine's behavior at runtime. Going `permissive →
     * assistive` does **not** auto-run a global `normalize()` pass; the
     * UI is expected to prompt the user before invoking `normalize()`
     * explicitly.
     *
     * Behavior is enforced entirely via the AN post-mutation hook in
     * `runAssistiveNormalization`. Switching `permissive →
     * assistive` makes the next successful Structural mutation trigger
     * the AN pass; switching the other direction stops the AN pass
     * from running until the user opts back in.
     *
     * @since 1.0.0
     */
    public setBehavior(b: "assistive" | "permissive"): void {
        this.engineBehavior = b
    }

    /**
     * Acquire the AN re-entrance guard. Returns `true` iff the guard
     * was acquired (i.e. AN is not already running for this engine);
     * the caller is then obligated to call `endApplyAN()` after the
     * AN sweep. Returns `false` if AN is already in progress, in
     * which case the caller short-circuits to avoid nested AN
     * sweeps.
     *
     * Used by `applyANToFixedPoint` in `src/lib/grammar/an-rules.ts`
     * (the single chokepoint for both `runAssistiveNormalization`
     * and `normalizeArgument`). The post-mutation follow-up calls
     * `runAssistiveNormalization(this)` which delegates to
     * `applyANToFixedPoint`; AN's own mutations re-fire the follow-up,
     * which would otherwise recurse. This guard
     * breaks the recursion.
     *
     * @internal
     * @since 1.0.0
     */
    public beginApplyAN(): boolean {
        if (this.applyingAN) return false
        this.applyingAN = true
        return true
    }

    /**
     * Release the AN re-entrance guard. Pairs with `beginApplyAN()`.
     *
     * @internal
     * @since 1.0.0
     */
    public endApplyAN(): void {
        this.applyingAN = false
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
            ...withoutUndefinedValues(extras),
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
        return renderArgumentDisplay(
            this.getArgument(),
            this.listSupportingPremises(),
            () => this.listPremises(),
            this.conclusionPremiseId
        )
    }

    public createPremise(): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    public createPremise(
        extras: Record<string, unknown> | undefined,
        symbol: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    public createPremise(
        extras: Record<string, unknown>,
        symbol?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    public createPremise(options: {
        type?: "freeform" | "derivation"
        derivedClaimId?: string
        extras?: Record<string, unknown>
        symbol?: string
    }): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    public createPremise(
        arg1?:
            | Record<string, unknown>
            | {
                  type?: "freeform" | "derivation"
                  derivedClaimId?: string
                  extras?: Record<string, unknown>
                  symbol?: string
              },
        arg2?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.createPremiseWithId(
            this.generateId(),
            arg1 as Record<string, unknown> | undefined,
            arg2
        )
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
    >
    public createPremiseWithId(
        id: string,
        options: {
            type?: "freeform" | "derivation"
            derivedClaimId?: string
            extras?: Record<string, unknown>
            symbol?: string
        }
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    public createPremiseWithId(
        id: string,
        arg2?:
            | Record<string, unknown>
            | {
                  type?: "freeform" | "derivation"
                  derivedClaimId?: string
                  extras?: Record<string, unknown>
                  symbol?: string
              },
        arg3?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        const options = parsePremiseArgs(arg2, arg3)
        return this.withValidation(() => {
            if (this.premises.has(id)) {
                throw new Error(`Premise "${id}" already exists.`)
            }

            // Derivation init flow — only when not restoring from snapshot.
            if (options.type === "derivation" && !this.restoringFromSnapshot) {
                if (!options.derivedClaimId) {
                    throw new InvariantViolationError([
                        {
                            code: CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID,
                            message: `${CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID}: createPremise with type "derivation" requires derivedClaimId`,
                            entityType: "premise",
                            entityId: id,
                            premiseId: id,
                        },
                    ])
                }
                const claim = this.claimLibrary.getCurrent(
                    options.derivedClaimId
                )
                if (!claim) {
                    throw new InvariantViolationError([
                        {
                            code: CREATE_DERIVATION_CLAIM_NOT_FOUND,
                            message: `${CREATE_DERIVATION_CLAIM_NOT_FOUND}: claim ${options.derivedClaimId} not found in claim library`,
                            entityType: "claim",
                            entityId: options.derivedClaimId,
                        },
                    ])
                }
            }

            const premiseType: "freeform" | "derivation" =
                options.type ?? "freeform"
            const premiseData: TOptionalChecksum<TPremise> =
                premiseType === "derivation" && options.derivedClaimId
                    ? ({
                          ...options.extras,
                          id,
                          argumentId: this.argument.id,
                          argumentVersion: this.argument.version,
                          type: "derivation" as const,
                          derivedClaimId: options.derivedClaimId,
                      } as unknown as TOptionalChecksum<TCoreDerivationPremise> as TOptionalChecksum<TPremise>)
                    : ({
                          ...options.extras,
                          id,
                          argumentId: this.argument.id,
                          argumentVersion: this.argument.version,
                          type: "freeform" as const,
                      } as TOptionalChecksum<TPremise>)
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
                    generateId: this.generateId,
                }
            )
            this.premises.set(id, pm)
            this.wirePremiseEngine(pm)
            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            collector.addedPremise(pm.toPremiseData())
            this.markDirty()

            if (this.conclusionPremiseId === undefined) {
                this.conclusionPremiseId = id
                collector.setRoles(this.getRoleState())
            }

            // Auto-create a premise-bound variable for this premise
            if (!this.restoringFromSnapshot) {
                const autoSymbol = options.symbol ?? this.generateUniqueSymbol()
                const autoVariable = {
                    id: this.generateId(),
                    argumentId: this.argument.id,
                    argumentVersion: this.argument.version as number,
                    symbol: autoSymbol,
                    boundPremiseId: id,
                    boundArgumentId: this.argument.id,
                    boundArgumentVersion: this.argument.version as number,
                } as TOptionalChecksum<TPremiseBoundVariable>
                const withChecksum = this.storeNewVariable(
                    autoVariable as unknown as TOptionalChecksum<TVar>
                )
                collector.addedVariable(withChecksum)
                this.markAllPremisesDirty()
            }

            // Derivation init: add naked-Q root expression for the consequent variable.
            // Only runs when not restoring from snapshot.
            let appended: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
            if (
                options.type === "derivation" &&
                options.derivedClaimId &&
                !this.restoringFromSnapshot
            ) {
                // Track existing variables before ensureClaimBoundVariable so we
                // can detect whether a new variable was materialized.
                const variablesBefore = new Set(
                    this.variables.toArray().map((v) => v.id)
                )
                const consequentVariable = this.ensureClaimBoundVariable(
                    options.derivedClaimId
                )
                // If ensureClaimBoundVariable created a new variable, record it.
                if (!variablesBefore.has(consequentVariable.id)) {
                    collector.addedVariable(
                        consequentVariable as unknown as TVar
                    )
                    this.markAllPremisesDirty()
                }
                // Add the naked-Q root expression via appendExpression. Its
                // whole changeset is kept, including what normalization then
                // changed elsewhere.
                appended = pm.appendExpression(null, {
                    id: this.generateId(),
                    type: "variable" as const,
                    variableId: consequentVariable.id,
                    premiseId: id,
                    argumentId: this.argument.id,
                    argumentVersion: this.argument.version,
                } as unknown as import("./expression-manager.js").TExpressionWithoutPosition<TExpr>).changes
            }

            const changes = composeChangesets(
                this.finalizeChanges(collector),
                appended
            )
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
            // The premise's expressions go with it: list them as removed and
            // drop them from the expression index.
            for (const expr of pm.getExpressions()) {
                collector.removedExpression(expr)
                this.expressionIndex.delete(expr.id)
            }
            this.premises.delete(premiseId)
            collector.removedPremise(data)
            // Invariant guard: a non-empty argument always has a
            // conclusion designated. When the removed premise was
            // the conclusion AND other premises remain, atomically
            // reassign the role to the lowest-id remaining premise
            // rather than leaving conclusionPremiseId === undefined
            // (which would trip E-7). When the removed premise was the
            // conclusion AND no premises remain, the invariant is
            // vacuously satisfied — clear the role.
            //
            // Why lowest-id: core premises carry no `position` field
            // (sibling ordering at the premise level is server-side
            // metadata, typically by createdOn). Lowest-id is the only
            // core-knowable, deterministic, snapshot-stable selector
            // — sorting `listPremiseIds()` by lexicographic id matches
            // the engine's existing premise-enumeration order, so the
            // promoted premise is the one consumers will already think
            // of as "first" in any list view backed by `listPremises()`.
            // Consumers that want a different selector (e.g., server
            // ordering by `createdOn` or UI ordering by user-set
            // position) can opt out of this auto-reassign by issuing
            // their own `setConclusionPremise(...)` call immediately
            // after `removePremise(...)` — the post-mutation E-7 will
            // continue to pass because a conclusion stays designated
            // throughout.
            if (this.conclusionPremiseId === premiseId) {
                const remainingIds = Array.from(this.premises.keys()).sort(
                    (a, b) => a.localeCompare(b)
                )
                if (remainingIds.length > 0) {
                    this.conclusionPremiseId = remainingIds[0]
                } else {
                    this.conclusionPremiseId = undefined
                }
                collector.setRoles(this.getRoleState())
            }
            // Cascade: remove variables bound to the deleted premise, keeping
            // everything each removal changed, not only what it removed.
            let changes = this.finalizeChanges(collector)
            for (const v of this.getVariablesBoundToPremise(premiseId)) {
                changes = composeChangesets(
                    changes,
                    this.removeVariableCore(v.id).changes
                )
            }
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

    /**
     * Throws unless the variable names this engine's argument id and
     * version, checking the id first. The messages are part of what
     * callers see, so they must not change.
     */
    private assertVariableInThisArgument(variable: {
        argumentId: string
        argumentVersion: number
    }): void {
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
    }

    /**
     * Computes the variable's checksum and adds it to the variable manager.
     * Returns the stored variable. Records no change and marks nothing
     * dirty; each caller does that itself.
     */
    private storeNewVariable(variable: TOptionalChecksum<TVar>): TVar {
        const withChecksum = this.attachVariableChecksum({ ...variable })
        this.variables.addVariable(withChecksum)
        return withChecksum
    }

    /**
     * Stores a new variable and returns it with a changeset listing it as
     * added, after marking every premise dirty. The shared ending of the
     * public methods that add one variable.
     */
    private addNewVariable(
        variable: TOptionalChecksum<TVar>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        const withChecksum = this.storeNewVariable(variable)
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.addedVariable(withChecksum)
        this.markAllPremisesDirty()
        const changes = this.finalizeChanges(collector)
        return {
            result: withChecksum,
            changes,
        }
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
            this.assertVariableInThisArgument(variable)
            // Validate claim reference
            if (
                !this.claimLibrary.get(variable.claimId, variable.claimVersion)
            ) {
                throw new Error(
                    `Claim "${variable.claimId}" version ${variable.claimVersion} does not exist in the claim library.`
                )
            }
            return this.addNewVariable(
                variable as unknown as TOptionalChecksum<TVar>
            )
        })
    }

    /**
     * Ensures a claim-bound variable for the given claim exists in this
     * argument. If one already exists, returns it. Otherwise creates a new
     * claim-bound variable with a fresh UUID, the current version of the claim
     * from the ClaimLibrary, and an auto-generated symbol.
     *
     * @throws InvariantViolationError(CLAIM_NOT_FOUND) when the claim is not in
     *         the library.
     *
     * @since 0.11.0
     */
    public ensureClaimBoundVariable(claimId: string): TClaimBoundVariable {
        // Return existing claim-bound variable if one is already bound to this claim.
        const existing = this.variables
            .toArray()
            .find(
                (v) =>
                    isClaimBound(v as unknown as TCorePropositionalVariable) &&
                    (v as unknown as TClaimBoundVariable).claimId === claimId
            )
        if (existing) {
            return existing as unknown as TClaimBoundVariable
        }

        // Verify the claim exists in the library.
        const currentClaim = this.claimLibrary.getCurrent(claimId)
        if (!currentClaim) {
            throw new InvariantViolationError([
                {
                    code: CLAIM_NOT_FOUND,
                    message: `${CLAIM_NOT_FOUND}: Claim ${claimId} not found in claim library`,
                    entityType: "claim",
                    entityId: claimId,
                },
            ])
        }

        const rawVariable: TOptionalChecksum<TClaimBoundVariable> &
            Record<string, unknown> = {
            id: this.generateId(),
            argumentId: this.argument.id,
            argumentVersion: this.argument.version,
            symbol: this.generateUniqueSymbol(),
            claimId,
            claimVersion: currentClaim.version,
        }

        const withChecksum = this.storeNewVariable(
            rawVariable as unknown as TOptionalChecksum<TVar>
        )
        this.markAllPremisesDirty()
        return withChecksum as unknown as TClaimBoundVariable
    }

    public bindVariableToPremise(
        variable: TOptionalChecksum<TPremiseBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            this.assertVariableInThisArgument(variable)
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
            return this.addNewVariable(
                variable as unknown as TOptionalChecksum<TVar>
            )
        })
    }

    /** Adds a premise-bound variable that references a premise in a different argument. */
    public bindVariableToExternalPremise(
        variable: TOptionalChecksum<TPremiseBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg> {
        return this.withValidation(() => {
            this.assertVariableInThisArgument(variable)
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
            return this.addNewVariable(
                variable as unknown as TOptionalChecksum<TVar>
            )
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

        // Cascade: delete referencing expressions in every premise, keeping
        // everything each deletion changed, not only what it removed.
        let cascade: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
        for (const pm of this.listPremises()) {
            cascade = composeChangesets(
                cascade,
                pm.deleteExpressionsUsingVariable(variableId).changes
            )
        }

        this.variables.removeVariable(variableId)
        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        collector.removedVariable(variable)
        this.markAllPremisesDirty()
        const changes = composeChangesets(
            cascade,
            this.finalizeChanges(collector)
        )
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

    /**
     * Look up a claim by `(id, version)` in the engine's claim library.
     * Returns `undefined` if the claim is not present. Exposed for
     * repair primitives and other tooling that needs to inspect a
     * claim's `type` discriminator at a particular version pinned by
     * a claim-bound variable.
     *
     * @since 1.0.0
     */
    public getClaim(claimId: string, claimVersion: number): TClaim | undefined {
        return this.claimLibrary.get(claimId, claimVersion)
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
     * Patches application-specific fields onto an expression across all
     * premises, then marks the expression and its ancestors dirty so the
     * next checksum flush recomputes from the patched values.
     *
     * This is the public API for consumers that need to attach app-level
     * metadata (e.g. `creatorId`, `createdOn`) to expressions synthesized
     * by the engine's auto-normalization. It resolves the owning premise
     * internally, applies the patch in place, and marks the expression
     * dirty — callers cannot patch without marking (stale checksum) or mark
     * without patching (no-op). A field whose value is `undefined` is
     * **deleted** rather than assigned, so clearing one restores the shape and
     * the checksum the entity had before it was set.
     *
     * @param expressionId - The ID of the expression to patch.
     * @param fields - Fields to merge into the expression.
     * @throws If no expression with the given ID exists.
     *
     * @since 2.3.1
     */
    public patchExpressionAppFields(
        expressionId: string,
        fields: Partial<TExpr>
    ): void {
        const pm = this.findPremiseByExpressionId(expressionId)
        if (!pm) {
            throw new Error(
                `Expression "${expressionId}" not found in any premise.`
            )
        }
        pm.patchAndMarkExpression(expressionId, fields)
    }

    /**
     * Construct (or no-op on) the per-claim derivation premise's
     * antecedent from a citation lookup. Factory + naked-Q-only:
     *
     *  - 0 connections → no-op (naked-Q stays).
     *  - 1 connection → `IMPLIES(citation-var, Q)`.
     *  - ≥ 2 connections → `IMPLIES(OR(c1, …, cn), Q)`. In
     *    `'assistive'` mode the per-mutation AN-1 post-hook inserts a
     *    formula buffer between IMPLIES and OR; in `'permissive'` the
     *    OR sits directly under IMPLIES (a P-1 violation surfaces via
     *    `validate('presentable')`).
     *
     * **No throw on already-populated.** Per the Structural-only
     * mutation throw rule, if the target derivation premise is not in
     * the naked-Q form the factory returns `{ kind: 'no-op', state:
     * <existing> }` without mutating. UI/caller is responsible for
     * explicit user consent + clearing the antecedent via a repair
     * primitive before re-calling. Preserves the no-changes-without-
     * consent principle.
     *
     * Throws only when no derivation premise exists for the given
     * `derivedClaimId` (legitimate entity-not-found Structural check).
     *
     * @since 1.0.0
     */
    public populateFromCitations<
        TConn extends TCoreClaimConnection = TCoreClaimConnection,
    >(
        derivedClaimId: string,
        citationLookup: TClaimConnectionLookup<TConn>
    ): TPopulateResult {
        return populateFromGroundingImpl(this, derivedClaimId, citationLookup)
    }

    /**
     * Mirror of `populateFromCitations` for axiom connections. Same
     * factory contract: naked-Q-only, no throw on already-populated.
     *
     * @since 1.0.0
     */
    public populateFromAxioms<
        TConn extends TCoreClaimConnection = TCoreClaimConnection,
    >(
        derivedClaimId: string,
        axiomLookup: TClaimConnectionLookup<TConn>
    ): TPopulateResult {
        return populateFromGroundingImpl(this, derivedClaimId, axiomLookup)
    }

    /**
     * Repair primitive: resolve E-3 violations by deleting each
     * unresolvable claim- or premise-bound variable, cascading the
     * removal across all premises. Returns the violations resolved
     * (for UX confirmation / undo / "we made N changes" feedback).
     *
     * **User-initiated; never auto-runs.** Respects `behavior`: in
     * `'assistive'` mode, the AN post-hook fires after each cascade
     * mutation; in `'permissive'` no AN runs.
     *
     * @since 1.0.0
     */
    public removeUnresolvableVariables(): readonly TViolation[] {
        return removeUnresolvableVariablesImpl(this)
    }

    /**
     * Repair primitive: resolve E-1 violations (operators with < 2
     * children) by running the AN-3 cleanup pass globally. Returns the
     * violations resolved. The repair is non-meaning-changing — it
     * only removes empty operators and promotes single-child operators
     * — but lives alongside `normalize()` so the UI can present a
     * focused "Remove N orphan operators" action with a precise return
     * value.
     *
     * **User-initiated; never auto-runs.** Bypasses `behavior` —
     * cleanup runs even in permissive mode (the user has already
     * accepted the action by clicking the repair button).
     *
     * @since 1.0.0
     */
    public removeOrphanOperators(): readonly TViolation[] {
        return removeOrphanOperatorsImpl(this)
    }

    /**
     * Repair primitive: resolve E-6 violations (claim has > 1
     * derivation premise) by keeping one premise per `derivedClaimId`
     * and deleting the rest. Strategy controls which premise is kept:
     *
     *  - `'keep-first'` (default): keep the premise with the
     *    lexicographically smallest id; delete the rest. Deterministic
     *    and snapshot-stable.
     *  - `'keep-largest-antecedent'`: keep the premise whose antecedent
     *    subtree has the most claim-bound variable expressions; tie-break
     *    by id.
     *
     * **User-initiated; never auto-runs.** Respects `behavior`.
     *
     * @since 1.0.0
     */
    public removeDuplicateDerivationPremises(
        strategy: "keep-first" | "keep-largest-antecedent" = "keep-first"
    ): readonly TViolation[] {
        return removeDuplicateDerivationPremisesImpl(this, strategy)
    }

    /**
     * Repair primitive: resolve D-3 violations (mixed-grounding
     * antecedent — axioms + citations in one derivation) by deleting
     * every axiom-bound variable expression from the offending
     * antecedent subtree. The remaining citation-bound variables stay,
     * giving the derivation a homogeneous citation-grounded antecedent.
     *
     * **User-initiated; never auto-runs.** Respects `behavior`. In
     * `'assistive'` mode, AN may collapse a resulting single-child OR
     * via AN-3; in `'permissive'` the OR may persist with one child
     * (a downstream D-2 violation — follow up with
     * `removeOrphanOperators()` if desired).
     *
     * @since 1.0.0
     */
    public dropAxiomsFromMixedAntecedent(): readonly TViolation[] {
        return dropAxiomsFromMixedAntecedentImpl(this)
    }

    /**
     * Global normalize pass. Runs the AN rule set
     * (AN-1..AN-4) everywhere it can fire, converging the argument
     * toward `tier` (defaults to `'presentable'`).
     *
     * `normalize` is non-destructive in the logical-meaning sense — it
     * does not delete variables, change claim references, or modify
     * operator semantics. Recovery from Evaluable or Derivable violations
     * requires user intent and is exposed via the repair primitives.
     *
     * Every AN rule currently targets a Presentable invariant, so calls
     * with `tier` ∈ {'structural', 'evaluable', 'derivable'} are
     * effectively no-ops. The parameter is reserved so a future
     * submit/finalize gate can add lower-tier rules without an API break.
     *
     * **Bypasses `behavior`.** `normalize()` is user-initiated (the UI
     * invokes it after the user confirms a Tidy / Normalize action), so
     * cleanup runs regardless of whether the engine is in `'assistive'`
     * or `'permissive'` mode. The engine's `behavior` setting is not
     * mutated by this call.
     *
     * @since 1.0.0
     */
    public normalize(tier: TGrammarTier = "presentable"): void {
        normalizeArgument(this, tier)
    }

    // Normalization is reached via `engine.normalize(tier?)`, which
    // routes through the four native AN passes in
    // `src/lib/grammar/an-rules.ts`. There is no per-engine
    // `normalizeAllExpressions` wrapper and no per-premise
    // `pe.normalizeExpressions()`.

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
            // Invariant guard: a non-empty argument always has a
            // conclusion designated. If premises exist, this call
            // is a no-op rather than a state change — the caller's
            // intent ("remove the conclusion designation") is structurally
            // incompatible with the premise count, and the only way to
            // legitimately leave a non-empty argument without a
            // conclusion is to remove every premise first. Returning the
            // current (unchanged) role state with an empty changeset
            // keeps the shared-helper call site that asks for "supporting"
            // on a fresh-argument first-premise from breaking E-7
            // post-mutation — the engine simply refuses to clear, the
            // first premise keeps its auto-assigned conclusion role,
            // and the post-mutation state is `1 premise / that premise
            // is the conclusion`, which satisfies the invariant.
            //
            // When there are zero premises the call clears the role —
            // clearing on an empty argument is fine because the
            // invariant ("non-empty argument has a conclusion") is
            // vacuously satisfied.
            if (this.premises.size > 0) {
                return {
                    result: this.getRoleState(),
                    changes: {},
                }
            }
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
                // `behavior` is intentionally omitted from the snapshot.
                // Consumers re-supply it at restore time via
                // `new ArgumentEngine(...)` options or `setBehavior()`;
                // a restored engine defaults to `'assistive'`. The fork
                // path (`forkArgumentEngine` / `PropositCore.forkArgument`)
                // explicitly threads the source engine's `behavior` into
                // the forked engine's config (see `fork.ts`), so fork
                // callers don't lose the setting. All P-1 / AN behavior
                // is driven by `engine.behavior` + the AN post-mutation
                // hook.
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
        TClaim extends TCoreClaim = TCoreClaim,
    >(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>,
        claimLibrary: TClaimLookup<TClaim>,
        checksumVerification?: "ignore" | "strict",
        generateId?: () => string
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim> {
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>(
            snapshot.argument,
            claimLibrary,
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
                generateId
            )
            engine.premises.set(pe.getId(), pe)
            engine.wirePremiseEngine(pe)
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

        // No post-load normalization. The snapshot loads as-is; any
        // lower-tier (Evaluable / Derivable / Presentable) violations
        // are queryable post-load via `engine.validate(tier)`.

        if (checksumVerification === "strict") {
            engine.flushChecksums()
            verifySnapshotChecksums(engine, snapshot)
        }

        // Load-time invariant validation covers no grammar rule: P-1 and
        // the other lower-tier rules surface via `engine.validate(tier)`
        // post-load. Non-grammar invariants (schema conformance,
        // reference integrity, conclusion ref, circularity, etc.)
        // still throw at load time, routed through the public
        // `validateInvariants()` method.
        const loadValidation = engine.validateInvariants()
        if (!loadValidation.ok) {
            throw new InvariantViolationError(loadValidation.violations)
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
        TClaim extends TCoreClaim = TCoreClaim,
    >(
        argument: TOptionalChecksum<TArg>,
        claimLibrary: TClaimLookup<TClaim>,
        variables: TOptionalChecksum<TVar>[],
        premises: TOptionalChecksum<TPremise>[],
        expressions: TExpressionInput<TExpr>[],
        roles: TCoreArgumentRoleState,
        config?: TLogicEngineOptions,
        checksumVerification?: "ignore" | "strict"
    ): ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim> {
        const normalizedConfig = config
            ? {
                  ...config,
                  checksumConfig: normalizeChecksumConfig(
                      config.checksumConfig
                  ),
              }
            : undefined
        const engine = new ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>(
            argument,
            claimLibrary,
            normalizedConfig
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
            // Restoration shape: every sibling property on the row that isn't
            // an entity-id or hierarchical-checksum field is a project extra.
            // Pull `type` / `derivedClaimId` out explicitly and pass the rest
            // under the typed-bag's `extras` slot so they survive the parser.
            // Passing the row directly would trip the typed-bag heuristic
            // on `type: string` and drop every sibling.
            const {
                id: _id,
                argumentId: _argumentId,
                argumentVersion: _argumentVersion,
                checksum: _checksum,
                descendantChecksum: _descendantChecksum,
                combinedChecksum: _combinedChecksum,
                type,
                derivedClaimId,
                ...siblingExtras
            } = premise as unknown as Record<string, unknown>
            const { result: pe } = engine.createPremiseWithId(premise.id, {
                type: type as "freeform" | "derivation" | undefined,
                derivedClaimId: derivedClaimId as string | undefined,
                extras: siblingExtras,
            })
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

        // Add expressions via loadExpressions, which loads them as-is
        // without grammar checks.
        for (const [premiseId, pe] of premiseEngines) {
            const premiseExprs = exprsByPremise.get(premiseId) ?? []
            pe.loadExpressions(premiseExprs)
        }

        // Set roles (override auto-assignment)
        if (roles.conclusionPremiseId !== undefined) {
            engine.setConclusionPremise(roles.conclusionPremiseId)
        }

        engine.restoringFromSnapshot = false

        // No post-load normalization. See the matched note in
        // `fromSnapshot` above. Load is non-mutating; lower-tier
        // violations surface via `engine.validate(tier)`.

        if (checksumVerification === "strict") {
            engine.flushChecksums()
            verifyDataChecksums(engine, argument, variables, premises)
        }

        // Load-time invariant validation (see matched comment in
        // `fromSnapshot` above). Non-grammar invariants still throw at
        // load; lower-tier grammar violations surface post-load via
        // `engine.validate(tier)`, routed through the public
        // `validateInvariants()` method.
        const loadValidation = engine.validateInvariants()
        if (!loadValidation.ok) {
            throw new InvariantViolationError(loadValidation.violations)
        }

        return engine
    }

    public rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void {
        const preRollbackSnap = this.snapshot()
        this.rollbackInternal(snapshot)
        const validation = this.validateInvariants()
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
        for (const pe of this.premises.values()) {
            this.wirePremiseEngine(pe)
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

    /**
     * Four-tier grammar validation. Returns the union of
     * violations from Structural up through `tier` — `'structural'`
     * returns S-rule violations only, `'evaluable'` returns S + E,
     * `'derivable'` returns S + E + D, `'presentable'` returns the full
     * union. Empty array means the argument is at the requested tier
     * or stricter. Never throws on grammar issues.
     *
     * For the invariant sweep (schema conformance, reference integrity,
     * ownership, conclusion ref, circularity, checksums) use
     * {@link validateInvariants} instead.
     */
    public validate(tier: TGrammarTier): readonly TViolation[] {
        return validateGrammar(tier, this.asGrammarValidatorContext())
    }

    /**
     * Invariant sweep — schema conformance, reference integrity,
     * ownership, conclusion-ref + circularity, checksum stability, and
     * per-premise validation. Returns a `TInvariantValidationResult`.
     * Used internally by mutation-rollback and snapshot-load paths and
     * exposed publicly for library-wide invariant checks (see
     * `ArgumentLibrary.validate` and `PropositCore.validate`).
     *
     * Distinct from {@link validate}, which runs the four-tier grammar
     * validator (`Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`)
     * and returns a `readonly TViolation[]`. The two are
     * complementary — grammar tiers cover AST-shape rules; this method
     * covers schema/reference/structural-bookkeeping invariants that
     * sit outside the tier hierarchy.
     *
     * @since 1.0.0
     */
    public validateInvariants(): TInvariantValidationResult {
        return validateArgumentStandalone(this.asValidationContext())
    }

    /**
     * Construct the pure-data `TValidatorContext` consumed by the
     * grammar-tier validators. Claims are gathered by walking the
     * engine's claim-bound variables and looking each one up in the
     * claim library — the `TClaimLookup` contract doesn't expose
     * iteration, so we materialize the referenced subset only.
     */
    private asGrammarValidatorContext(): TGrammarValidatorContext {
        const argument = this.getArgument() as unknown as TCoreArgument
        const premises: TCorePremise[] = []
        const expressions: TCorePropositionalExpression[] = []
        for (const pe of this.listPremises()) {
            premises.push(pe.toPremiseData() as unknown as TCorePremise)
            expressions.push(
                ...(pe.getExpressions() as unknown as TCorePropositionalExpression[])
            )
        }
        const variables =
            this.variables.toArray() as unknown as TCorePropositionalVariable[]

        // Gather referenced claims via claim-bound variables. Duplicate
        // (id, version) pairs are deduped via a Set on the composite key.
        const seen = new Set<string>()
        const claims: TCoreClaim[] = []
        for (const v of variables) {
            if (!isClaimBound(v)) continue
            const cb = v as unknown as TClaimBoundVariable
            const key = `${cb.claimId}:${cb.claimVersion}`
            if (seen.has(key)) continue
            seen.add(key)
            const claim = this.claimLibrary.get(cb.claimId, cb.claimVersion)
            if (claim !== undefined) {
                claims.push(claim as unknown as TCoreClaim)
            }
        }

        return {
            argument,
            premises,
            expressions,
            variables,
            claims,
            roleState: this.getRoleState(),
        }
    }

    public validateEvaluability(): TCoreValidationResult {
        const base = validateArgumentEvaluabilityStandalone(
            this.asValidationContext()
        )
        const derivationIssues = this.collectDerivationStructureIssues()
        if (derivationIssues.length === 0) return base
        return makeValidationResult([...base.issues, ...derivationIssues])
    }

    /**
     * Returns the derivation-specific subset of `validateEvaluability` checks.
     * Apps can pre-check derivation premise structures before invoking the full
     * evaluation pipeline.
     *
     * Violations carry the underlying `DERIVATION_STRUCTURE_INVALID` code
     * (per the derivation-validation utility). A naked-Q derivation
     * premise is a valid Derivable state and is skipped by evaluation
     * rather than thrown.
     *
     * @since 0.11.0
     */
    public validateDerivationStructures(): TInvariantValidationResult {
        const violations: TInvariantValidationResult["violations"] = []
        for (const { violation } of this.collectDerivationViolations()) {
            violations.push(violation)
        }
        return { ok: violations.length === 0, violations }
    }

    private collectDerivationStructureIssues(): TCoreValidationResult["issues"] {
        const issues: TCoreValidationResult["issues"] = []
        for (const { violation } of this.collectDerivationViolations()) {
            issues.push(
                makeErrorIssue({
                    code: "DERIVATION_STRUCTURE_INVALID",
                    message: violation.message,
                    premiseId: violation.entityId,
                })
            )
        }
        return issues
    }

    private *collectDerivationViolations(): Iterable<{
        violation: TInvariantValidationResult["violations"][number]
    }> {
        const allVars =
            this.variables.toArray() as unknown as TCorePropositionalVariable[]
        for (const premise of this.listPremises()) {
            const premiseData = premise.toPremiseData()
            if (premiseData.type !== "derivation") continue
            const derivationPremise =
                premiseData as unknown as TCoreDerivationPremise
            const exprs =
                premise.getExpressions() as unknown as TCorePropositionalExpression[]
            const subResult = validateDerivationStructure(
                derivationPremise,
                exprs,
                allVars
            )
            for (const violation of subResult.violations) {
                yield { violation }
            }
        }
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
                wouldCreateCycle(
                    this.asCycleContext(),
                    variableId,
                    premiseId,
                    visited
                ),
        }
    }

    private asEvaluationContext(): TArgumentEvaluationContext {
        // Naked-Q derivation premises (single variable expression at
        // root, type='derivation') contribute nothing to evaluation. The
        // evaluator-context's premise listings filter them out so they
        // are entirely invisible to evaluate() and checkValidity() —
        // evaluation never throws on naked-Q. Filter applies uniformly to conclusion,
        // supporting, and full premise listings. The predicate lives in
        // `src/lib/grammar/naked-q.ts` so the populate-from factory and
        // this filter share one definition.
        return {
            argumentId: this.argument.id,
            conclusionPremiseId: this.conclusionPremiseId,
            getConclusionPremise: () => {
                const c = this.getConclusionPremise()
                if (c === undefined) return undefined
                if (isNakedQDerivationPremise(c)) return undefined
                return c as TEvaluablePremise
            },
            listSupportingPremises: () =>
                this.listSupportingPremises().filter(
                    (pm) => !isNakedQDerivationPremise(pm)
                ) as TEvaluablePremise[],
            listPremises: () =>
                this.listPremises().filter(
                    (pm) => !isNakedQDerivationPremise(pm)
                ) as TEvaluablePremise[],
            getVariable: (id) =>
                this.variables.getVariable(id) as
                    | TCorePropositionalVariable
                    | undefined,
            getPremise: (id) => {
                const pe = this.premises.get(id)
                if (pe === undefined) return undefined
                if (isNakedQDerivationPremise(pe)) return undefined
                return pe as TEvaluablePremise
            },
            validateEvaluability: () => this.validateEvaluability(),
        }
    }

    public evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult {
        const callerVariables = assignment.variables ?? {}
        const claimVariables = this.asClaimVariableContext()
        const effectiveVariables = applyAxiomaticForcedAssignments(
            claimVariables,
            callerVariables
        )
        const effectiveAssignment: TCoreExpressionAssignment = {
            ...assignment,
            variables: effectiveVariables,
        }
        // Axiomatic-bound variables are forced true by the pre-pass above, so
        // evaluation must not read them back as reader assertions. Union the
        // engine's axiomatic set with anything the caller passed, exactly as
        // `checkValidity` does — a caller's own set adds to the axioms, it
        // never replaces them.
        const forcedTrueVariableIds = new Set<string>(
            getAxiomaticBoundVariableIds(claimVariables)
        )
        for (const id of options?.forcedTrueVariableIds ?? []) {
            forcedTrueVariableIds.add(id)
        }
        // Whether the premises can hold together is asked of the argument, not
        // of the reader, so it takes a cited claim at its source's word —
        // exactly as `checkValidity` does. This set stays separate from the one
        // above because that one also decides what counts as the reader's own
        // assertion, and a reader may disagree with a source.
        const satisfiabilityForcedTrueVariableIds = new Set<string>(
            getGroundedBoundVariableIds(claimVariables)
        )
        for (const id of forcedTrueVariableIds) {
            satisfiabilityForcedTrueVariableIds.add(id)
        }
        return evaluateArgumentStandalone(
            this.asEvaluationContext(),
            effectiveAssignment,
            {
                ...options,
                forcedTrueVariableIds,
                satisfiabilityForcedTrueVariableIds,
            }
        )
    }

    public checkValidity(
        options?: TCoreValidityCheckOptions
    ): TCoreValidityCheckResult {
        const groundedIds = getGroundedBoundVariableIds(
            this.asClaimVariableContext()
        )
        // Grounded variables — axiomatic and citation alike — are both excluded
        // from the 2^n enumeration and pinned to `true` in every generated
        // assignment. A citation reports what its source says, so a failing
        // case that only exists because the source said the opposite is not a
        // fact about this argument. Union the engine's grounded set with any
        // explicit sets the caller passed.
        const excludedVariableIds = new Set<string>(groundedIds)
        for (const id of options?.excludedVariableIds ?? []) {
            excludedVariableIds.add(id)
        }
        const forcedTrueVariableIds = new Set<string>(groundedIds)
        for (const id of options?.forcedTrueVariableIds ?? []) {
            forcedTrueVariableIds.add(id)
        }
        return checkArgumentValidityStandalone(this.asEvaluationContext(), {
            ...options,
            excludedVariableIds,
            forcedTrueVariableIds,
        })
    }

    /**
     * The state the claim/variable functions under `argument/` read, as a
     * plain object built per call (accessor properties on such a context
     * slowed evaluation measurably in the premise engine). The fields are read
     * once per call; only a rollback replaces the variable manager, and
     * nothing this library calls rolls back during a read.
     */
    private asClaimVariableContext(): TClaimVariableContext<TVar, TClaim> {
        return {
            variables: this.variables,
            claimLibrary: this.claimLibrary,
        }
    }

    /**
     * Returns the IDs of every claim-bound variable bound to `claimId` in this
     * argument, in the engine's id-sorted variable order, or `[]` when none is.
     * Pure lookup — it never creates a variable (contrast
     * `ensureClaimBoundVariable`).
     *
     * A claim may bind more than one variable: `addVariable` enforces no
     * per-claim uniqueness, so an argument can carry several variables
     * standing for the same proposition, each reached — and valued —
     * independently by evaluation. Any translation that must not lose one of
     * them (reading propagated values back onto a claim, say) belongs here
     * rather than on the singular accessor.
     *
     * @since 4.1.0
     */
    public getVariableIdsForClaim(claimId: string): string[] {
        return getVariableIdsForClaim(this.asClaimVariableContext(), claimId)
    }

    /**
     * Returns the ID of the lowest-id claim-bound variable bound to `claimId`
     * in this argument, or `undefined` if no variable is. Pure lookup — it
     * never creates a variable (contrast `ensureClaimBoundVariable`).
     *
     * The engine's evaluation surface is variable-keyed, but consumers key
     * their review/UI state by `claimId`; this accessor (with its inverse
     * `getClaimIdForVariable`) is the documented seam for translating between
     * the two.
     *
     * **It answers for one variable, and a claim may bind several.** The pick
     * is deterministic and snapshot-stable — variables enumerate sorted by id
     * — but arbitrary with respect to the claim: it is not "the authored one"
     * or "the one an evaluation settled". When a claim may bind more than one
     * and losing the others would be wrong, use `getVariableIdsForClaim`.
     *
     * @since 3.1.0
     */
    public getVariableIdForClaim(claimId: string): string | undefined {
        return this.getVariableIdsForClaim(claimId)[0]
    }

    /**
     * Returns the `claimId` a claim-bound variable is bound to, or `undefined`
     * when the variable is unknown or premise-bound (premise-bound variables
     * have no claim). Inverse of `getVariableIdForClaim`.
     *
     * @since 3.1.0
     */
    public getClaimIdForVariable(variableId: string): string | undefined {
        return getClaimIdForVariable(this.asClaimVariableContext(), variableId)
    }

    /**
     * Derives a default truth-value assignment for every variable in the
     * argument, from claim type and immediate support structure alone. Values
     * are `true` or `null` (unknown) — **never `false`**.
     *
     * `D(claim)` for the variable backing claim `c`:
     * 1. `c` is a citation or axiomatic claim → `true`.
     * 2. `c` is a normal claim: locate its derivation premise (the inference
     *    whose consequent is `c`'s variable). Seed each variable referenced in
     *    that premise's immediate antecedent `true` iff it is itself bound to a
     *    citation/axiomatic claim, else `null`, and Kleene-evaluate the
     *    antecedent once. Antecedent `true` → `true`; otherwise `null`. **No
     *    recursion** — only the immediate antecedent claims' types are
     *    inspected, never their own supports.
     * 3. Anything else (no derivation premise, naked-Q derivation, a
     *    premise-bound variable) → `null`.
     *
     * The returned map is **variable-keyed**; use `getVariableIdForClaim` /
     * `getClaimIdForVariable` to translate to/from `claimId`.
     *
     * Consistency with the axiomatic pre-pass: `evaluate` force-sets
     * axiomatic-bound variables `true` and **rejects** any explicit assignment
     * for them (`AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`). This map reports those
     * same variables as `true` (the two agree), but the axiom keys must not be
     * passed to `evaluate` directly. Feed the map through `evaluateWithDefaults`
     * (which drops them), or strip axiomatic-bound keys before calling
     * `evaluate` yourself.
     *
     * @since 3.1.0
     */
    public deriveDefaultAssignment(): TCoreVariableAssignment {
        return deriveDefaultAssignment(
            this.asClaimVariableContext(),
            this.listPremises()
        )
    }

    /**
     * Convenience: merge caller `overrides` over `deriveDefaultAssignment()`
     * and `evaluate` in one call. Default-sourced **axiomatic-bound** keys are
     * dropped before evaluation — the engine's pre-pass force-sets them `true`
     * and rejects explicit axiom assignments, so passing the default `true`
     * through would throw `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`. Dropping them
     * keeps `deriveDefaultAssignment` (which reports axioms as `true`) and the
     * pre-pass in agreement without double-applying. An `override` that names
     * an axiomatic variable is left intact, so `evaluate` still enforces the
     * one-way rule.
     *
     * **Citations are different from axioms.** The engine does *not* force
     * citation-bound variables `true` and does *not* reject an explicit
     * citation assignment — a citation is a free variable, so its default
     * `true` is *kept* here (dropping it would leave the citation unknown at
     * evaluation). Both citations and axioms read as `true` under defaults, but
     * only the axiom `true` comes from the engine; the citation `true` is
     * supplied by this map. That also makes citation defaults reviewer-
     * overridable, whereas axioms stay locked.
     *
     * @since 3.1.0
     */
    public evaluateWithDefaults(
        overrides?: TCoreVariableAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult {
        const defaults = this.deriveDefaultAssignment()
        const axiomaticIds = getAxiomaticBoundVariableIds(
            this.asClaimVariableContext()
        )
        const merged: TCoreVariableAssignment = {}
        for (const [variableId, value] of Object.entries(defaults)) {
            if (axiomaticIds.has(variableId)) continue
            merged[variableId] = value
        }
        if (overrides) {
            for (const [variableId, value] of Object.entries(overrides)) {
                merged[variableId] = value
            }
        }
        return this.evaluate(
            { variables: merged, operatorAssignments: {} },
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
