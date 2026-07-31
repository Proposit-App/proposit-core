import type {
    TClaimBoundVariable,
    TPremiseBoundVariable,
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
} from "../../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreArgumentRoleState,
    TCoreExpressionAssignment,
    TCoreValidationResult,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
    TCoreVariableAssignment,
} from "../../types/evaluation.js"
import type { TCoreMutationResult } from "../../types/mutation.js"
import type { TReactiveSnapshot } from "../../types/reactive.js"
import type { TInvariantValidationResult } from "../../types/validation.js"
import type { TGrammarTier, TViolation } from "../../grammar/types.js"
import type { PremiseEngine } from "../premise-engine.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"

/**
 * Premise creation, removal, and lookup.
 */
export interface TPremiseCrud<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Creates a new premise with an auto-generated UUID and registers it
     * with this engine.
     *
     * Two call styles are supported:
     *
     * - **Typed-bag (preferred, since 0.11.0):**
     *   ```ts
     *   engine.createPremise({
     *       type: "freeform",        // or "derivation"
     *       derivedClaimId: claimId, // required when type === "derivation"
     *       extras: { label: "P1" },
     *       symbol: "P1",
     *   })
     *   ```
     *
     * - **Legacy positional (kept for compatibility):**
     *   ```ts
     *   engine.createPremise(extras, symbol)  // creates a freeform premise
     *   ```
     *
     * When `type === "derivation"`, the engine looks up `derivedClaimId` in
     * the claim library, materializes a claim-bound variable for it (via
     * `ensureClaimBoundVariable`) if one does not already exist, and
     * initializes the premise's expression tree to the naked-Q form — a
     * single variable expression at the root referencing the consequent.
     *
     * @returns The newly created PremiseEngine instance and changeset.
     *
     * @throws `InvariantViolationError(CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID)`
     *   when `type === "derivation"` and `derivedClaimId` is absent.
     * @throws `InvariantViolationError(CREATE_DERIVATION_CLAIM_NOT_FOUND)`
     *   when `type === "derivation"` and the claim is not in the library.
     *
     * @since 0.11.0 — typed-bag overload; derivation premise initialization.
     */
    createPremise(): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    createPremise(
        extras: Record<string, unknown> | undefined,
        symbol: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    createPremise(
        extras: Record<string, unknown>,
        symbol?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    createPremise(options: {
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
    /**
     * Creates a premise with a caller-supplied ID and registers it with
     * this engine. Mirrors `createPremise` exactly, but accepts an explicit
     * `id` as the first argument instead of generating one.
     *
     * Two call styles are supported:
     *
     * - **Typed-bag (preferred, since 0.11.0):**
     *   ```ts
     *   engine.createPremiseWithId(id, {
     *       type: "freeform",        // or "derivation"
     *       derivedClaimId: claimId, // required when type === "derivation"
     *       extras: { label: "P1" },
     *       symbol: "P1",
     *   })
     *   ```
     *
     * - **Legacy positional (kept for compatibility):**
     *   ```ts
     *   engine.createPremiseWithId(id, extras, symbol)  // creates a freeform premise
     *   ```
     *
     * When `type === "derivation"`, the same derivation initialization as
     * `createPremise` runs: variable materialization and naked-Q tree setup.
     *
     * @param id - The ID to assign to the new premise.
     *
     * @throws `InvariantViolationError(CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID)`
     *   when `type === "derivation"` and `derivedClaimId` is absent.
     * @throws `InvariantViolationError(CREATE_DERIVATION_CLAIM_NOT_FOUND)`
     *   when `type === "derivation"` and the claim is not in the library.
     * @throws If a premise with the given ID already exists.
     *
     * @since 0.11.0 — typed-bag overload; derivation premise initialization.
     */
    createPremiseWithId(
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
    createPremiseWithId(
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
    /**
     * Removes a premise and reassigns any role assignments that
     * reference it.
     *
     * **Invariant guard (1.0.2):** when the removed premise was the
     * conclusion AND other premises remain after the delete, the
     * conclusion role is atomically reassigned to the **lowest-id
     * remaining premise** (sorted lexicographically) rather than left
     * `undefined`, preserving the engine-level invariant that a
     * non-empty argument always has a conclusion designated (E-7).
     * When the removed premise was the conclusion AND no premises
     * remain, the role is cleared as before (vacuous invariant on the
     * empty argument). Consumers that want a different reassignment
     * policy (e.g., server-side `createdOn` ordering or a UI-defined
     * sibling position) should issue their own
     * `setConclusionPremise(...)` call immediately after this method
     * returns — the post-mutation E-7 will continue to pass because
     * a conclusion stays designated throughout.
     *
     * @param premiseId - The ID of the premise to remove.
     * @returns The removed premise data, or `undefined` if not found.
     */
    removePremise(
        premiseId: string
    ): TCoreMutationResult<TPremise | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Returns the premise with the given ID, or `undefined` if not found.
     *
     * @param premiseId - The ID of the premise to retrieve.
     * @returns The PremiseEngine instance, or `undefined`.
     */
    getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
    /**
     * Returns `true` if a premise with the given ID exists.
     *
     * @param premiseId - The ID to check.
     * @returns Whether the premise exists.
     */
    hasPremise(premiseId: string): boolean
    /**
     * Returns all premise IDs in lexicographic order.
     *
     * @returns An array of premise ID strings.
     */
    listPremiseIds(): string[]
    /**
     * Returns all premises in lexicographic ID order.
     *
     * @returns An array of PremiseEngine instances.
     */
    listPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    /**
     * Returns the PremiseEngine containing the given expression, or
     * `undefined`.
     *
     * @param expressionId - The expression ID to search for.
     * @returns The owning PremiseEngine, or `undefined`.
     */
    findPremiseByExpressionId(
        expressionId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
}

/**
 * Variable CRUD and lookup across the argument.
 */
export interface TVariableManagement<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Registers a propositional variable for use across all premises.
     *
     * @param variable - The variable entity to register.
     * @returns The registered variable (with checksum) and changeset.
     * @throws If `variable.symbol` is already in use.
     * @throws If `variable.id` already exists.
     * @throws If the variable does not belong to this argument.
     */
    addVariable(
        variable: TOptionalChecksum<TClaimBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
    /**
     * Registers a premise-bound propositional variable whose truth value is
     * derived from another premise's evaluation.
     *
     * @param variable - The premise-bound variable entity to register.
     * @returns The registered variable (with checksum) and changeset.
     * @throws If `variable.symbol` is already in use.
     * @throws If `variable.id` already exists.
     * @throws If `variable.boundPremiseId` does not exist in this argument.
     * @throws If `variable.boundArgumentId` does not match this argument.
     * @throws If the variable does not belong to this argument.
     */
    bindVariableToPremise(
        variable: TOptionalChecksum<TPremiseBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
    /**
     * Updates fields on an existing variable. Since all premises share the
     * same VariableManager, the update is immediately visible everywhere.
     *
     * @param variableId - The ID of the variable to update.
     * @param updates - Fields to update. For claim-bound variables: `symbol`,
     *   `claimId`, `claimVersion`. For premise-bound variables: `symbol`,
     *   `boundPremiseId`, `boundArgumentId`, `boundArgumentVersion`.
     *   `claimId` and `claimVersion` must be provided together on claim-bound variables.
     * @returns The updated variable, or `undefined` if not found.
     * @throws If the new symbol is already in use by a different variable.
     * @throws If the new claim reference does not exist in the claim library.
     * @throws If updates include fields from the wrong binding type (e.g., `boundPremiseId` on a claim-bound variable).
     * @throws If the new `boundPremiseId` does not exist in this argument.
     */
    updateVariable(
        variableId: string,
        updates: Record<string, unknown>
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Removes a variable and cascade-deletes all expressions referencing it
     * across every premise (including their full subtrees). As of v1.0
     * operator collapse on the surviving parents is the AN-3
     * post-mutation hook's responsibility in assistive behavior; in
     * permissive behavior the un-collapsed shape stays and surfaces via
     * `engine.validate('presentable')`.
     *
     * @param variableId - The ID of the variable to remove.
     * @returns The removed variable, or `undefined` if not found.
     */
    removeVariable(
        variableId: string
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Returns the variable with the given ID, or `undefined` if not found.
     *
     * @param variableId - The variable ID to look up.
     * @returns The variable entity, or `undefined`.
     */
    getVariable(variableId: string): TVar | undefined
    /**
     * Returns `true` if a variable with the given ID exists.
     *
     * @param variableId - The variable ID to check.
     * @returns Whether the variable exists.
     */
    hasVariable(variableId: string): boolean
    /**
     * Returns the variable with the given symbol, or `undefined` if not
     * found.
     *
     * @param symbol - The symbol string to look up.
     * @returns The variable entity, or `undefined`.
     */
    getVariableBySymbol(symbol: string): TVar | undefined
    /**
     * Returns all registered variables sorted by ID.
     *
     * @returns An array of variable entities.
     */
    getVariables(): TVar[]
    /**
     * Builds a Map keyed by a caller-supplied function over all variables.
     * Useful for indexing by extension fields (e.g. statementId). The
     * caller should cache the result — this is O(n) per call.
     *
     * @param keyFn - A function that extracts the map key from a variable.
     * @returns A Map from the extracted key to the variable.
     */
    buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar>
    /**
     * Returns all premise-bound variables whose `boundPremiseId` matches the
     * given premise ID. This is a linear scan over all variables.
     *
     * @param premiseId - The premise ID to filter by.
     * @returns An array of variables bound to the given premise.
     */
    getVariablesBoundToPremise(premiseId: string): TVar[]
    /**
     * Idempotent lookup-or-create for a claim-bound variable. If a
     * claim-bound variable for `claimId` already exists in this argument,
     * it is returned as-is. Otherwise a new variable is created with a
     * fresh UUID, the current version of the claim from the `ClaimLibrary`,
     * and an auto-generated symbol.
     *
     * This method is used internally by derivation premise initialization
     * but is also available to callers that need to pin a claim as a
     * propositional variable without creating a full premise.
     *
     * @param claimId - The ID of the claim to bind a variable to.
     * @returns The existing or newly created `TClaimBoundVariable`.
     *
     * @throws `InvariantViolationError(CLAIM_NOT_FOUND)`
     *   when `claimId` is not present in the claim library.
     *
     * @since 0.11.0
     */
    ensureClaimBoundVariable(claimId: string): TClaimBoundVariable
}

/**
 * Cross-premise expression lookups and analysis.
 */
export interface TArgumentExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    /**
     * Returns an expression by ID from any premise, or `undefined` if not
     * found.
     *
     * @param expressionId - The expression ID to look up.
     * @returns The expression entity, or `undefined`.
     */
    getExpression(expressionId: string): TExpr | undefined
    /**
     * Returns `true` if an expression with the given ID exists in any
     * premise.
     *
     * @param expressionId - The expression ID to check.
     * @returns Whether the expression exists.
     */
    hasExpression(expressionId: string): boolean
    /**
     * Returns the premise ID that contains the given expression, or
     * `undefined`.
     *
     * @param expressionId - The expression ID to look up.
     * @returns The owning premise ID, or `undefined`.
     */
    getExpressionPremiseId(expressionId: string): string | undefined
    /**
     * Returns all expressions across all premises, sorted by ID.
     *
     * @returns An array of expression entities.
     */
    getAllExpressions(): TExpr[]
    /**
     * Returns all expressions that reference the given variable ID, across
     * all premises.
     *
     * @param variableId - The variable ID to search for.
     * @returns An array of referencing expression entities.
     */
    getExpressionsByVariableId(variableId: string): TExpr[]
    /**
     * Returns the root expression from each premise that has one.
     *
     * @returns An array of root expression entities.
     */
    listRootExpressions(): TExpr[]
    /**
     * Collects all variables referenced by expressions across all premises,
     * indexed both by variable ID and by symbol.
     *
     * @returns An object with `variableIds`, `byId`, and `bySymbol` indexes.
     */
    collectReferencedVariables(): {
        variableIds: string[]
        byId: Record<string, { symbol: string; premiseIds: string[] }>
        bySymbol: Record<
            string,
            { variableIds: string[]; premiseIds: string[] }
        >
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
     * dirty — callers cannot patch without marking or mark without
     * patching (atomic patch-and-mark).
     *
     * @param expressionId - The ID of the expression to patch.
     * @param fields - Fields to merge into the expression. A field whose
     *   value is `undefined` is deleted rather than assigned.
     *   The generic `Partial<TExpr>` ensures type compatibility with the
     *   engine's expression type (which includes app-specific fields when
     *   the engine is instantiated with a consumer-supplied expression type).
     * @throws `NotFoundError` if no expression with the given ID exists.
     *
     * @since 2.3.1
     */
    patchExpressionAppFields(expressionId: string, fields: Partial<TExpr>): void
}

/**
 * Conclusion and supporting premise role management.
 */
export interface TArgumentRoleState<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Returns the conclusion premise, or `undefined` if none is set.
     *
     * @returns The conclusion PremiseEngine, or `undefined`.
     */
    getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar>
        | undefined
    /**
     * Returns all supporting premises (derived: inference premises that are
     * not the conclusion) in lexicographic ID order.
     *
     * @returns An array of supporting PremiseEngine instances.
     */
    listSupportingPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    /**
     * Designates a premise as the argument's conclusion.
     *
     * @param premiseId - The ID of the premise to designate.
     * @returns The updated role state and changeset.
     * @throws If the premise does not exist.
     */
    setConclusionPremise(
        premiseId: string
    ): TCoreMutationResult<TCoreArgumentRoleState, TExpr, TVar, TPremise, TArg>
    /**
     * Clears the conclusion designation.
     *
     * **Invariant guard (1.0.2):** A non-empty argument always has a
     * conclusion designated (E-7). On an argument with one or more
     * premises this method is a **no-op** — it returns the current
     * (unchanged) role state with an empty changeset rather than
     * leaving the engine in an E-7-violating state. The only path to
     * legitimately end up with no conclusion designated is to remove
     * every premise first. On a zero-premise argument the call still
     * clears (vacuously satisfies the invariant).
     *
     * @returns The current role state and changeset. If premises
     *   exist, the changeset is empty (no-op); if zero premises, the
     *   role state is cleared and the changeset reflects the role
     *   change.
     */
    clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    /**
     * Returns the current role assignments (conclusion premise ID only;
     * supporting is derived).
     *
     * @returns The current argument role state.
     */
    getRoleState(): TCoreArgumentRoleState
}

/**
 * Argument-level evaluation: single-assignment evaluation, evaluability
 * validation, and exhaustive validity checking.
 */
export interface TArgumentEvaluation {
    /**
     * Validates that this argument is structurally ready for evaluation: a
     * conclusion must be set, all role references must point to existing
     * premises, variable ID/symbol mappings must be consistent, every
     * premise must be individually evaluable, and all derivation premise
     * structures must be well-formed (naked-Q invariant; since 0.11.0).
     *
     * Derivation premises with structurally broken trees are flagged with
     * `DERIVATION_STRUCTURE_INVALID`. Use
     * `validateDerivationStructures()` to isolate derivation checks without
     * running the full evaluability sweep.
     *
     * Naked-Q derivation premises (single-variable root) are **not** flagged
     * — they are a valid Derivable state per spec §4.2 and are skipped by
     * evaluation rather than throwing. The pre-1.0
     * `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` code has been removed.
     *
     * @returns A validation result with any issues found.
     *
     * @since 0.11.0 — derivation pre-flight added to the sweep.
     */
    validateEvaluability(): TCoreValidationResult
    /**
     * Returns the derivation-specific subset of `validateEvaluability`
     * checks as an invariant result. Only derivation premises are inspected;
     * freeform premises are ignored.
     *
     * Use this to pre-check derivation structure before entering the full
     * evaluation pipeline, without requiring a conclusion or complete role
     * state.
     *
     * Derivation premises with broken trees produce violations with code
     * `DERIVATION_STRUCTURE_INVALID`. Naked-Q (single-variable root) is
     * a valid Derivable state per spec §4.2 and is **not** flagged here —
     * it is skipped by evaluation rather than thrown. The pre-1.0
     * `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` override has been
     * removed.
     *
     * @returns An `TInvariantValidationResult` — `ok: true` when all
     *   derivation premises are structurally valid, `ok: false` with
     *   per-premise violations otherwise.
     *
     * @since 0.11.0
     */
    validateDerivationStructures(): TInvariantValidationResult
    /**
     * Evaluates the argument under a three-valued expression assignment.
     *
     * Variables may be `true`, `false`, or `null` (unknown). All result
     * flags (`isAdmissibleAssignment`, `isCounterexample`, etc.) are
     * three-valued: `null` means indeterminate due to unknown variable
     * values.
     *
     * Calls `validateEvaluability()` internally before evaluation; if the
     * argument is not structurally ready (including derivation pre-flight),
     * the method returns early with `{ ok: false }` and the validation
     * details. Do not bypass `evaluate` to avoid this check.
     *
     * @param assignment - The variable assignment and optional rejected
     *   expression IDs.
     * @param options - Optional evaluation options.
     * @returns The evaluation result, or `{ ok: false }` with validation
     *   details if the argument is not structurally evaluable.
     */
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult
    /**
     * Enumerates all 2^n variable assignments and checks for
     * counterexamples.
     *
     * A counterexample is an admissible assignment where all supporting
     * premises are true but the conclusion is false. The argument is valid
     * if no counterexamples exist.
     *
     * Calls `validateEvaluability()` (including derivation pre-flight)
     * before enumeration. If the argument is not evaluable, returns early
     * with an appropriate result rather than throwing.
     *
     * @param options - Optional limits on variables/assignments checked
     *   and early termination mode.
     * @returns The validity check result including any counterexamples.
     */
    checkValidity(options?: TCoreValidityCheckOptions): TCoreValidityCheckResult
    /**
     * Derives a default truth-value assignment for every variable in the
     * argument, from claim type and immediate support structure alone. Values
     * are `true` or `null` (unknown) — never `false`.
     *
     * `D(claim)`: a citation/axiomatic claim's variable → `true`; a normal
     * claim's variable → `true` iff its derivation premise's immediate
     * antecedent Kleene-evaluates `true` when each immediately-referenced claim
     * is seeded `true` iff citation/axiomatic (else `null`) — one level, no
     * recursion; everything else → `null`.
     *
     * The map is variable-keyed; translate to/from `claimId` with
     * `getVariableIdForClaim` / `getClaimIdForVariable`.
     *
     * The map reports axiomatic-bound variables as `true` in agreement with
     * `evaluate`'s force-true pre-pass, but those keys must not be passed to
     * `evaluate` directly (it rejects explicit axiom assignments). Use
     * `evaluateWithDefaults`, or strip axiomatic-bound keys first.
     *
     * @returns A variable-keyed assignment of `true` / `null` values.
     *
     * @since 3.1.0
     */
    deriveDefaultAssignment(): TCoreVariableAssignment
    /**
     * Merges caller `overrides` over `deriveDefaultAssignment()` and evaluates
     * in one call. Default-sourced axiomatic-bound keys are dropped before
     * evaluation (the engine force-sets them `true`), so the defaults and the
     * pre-pass agree without tripping `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
     * An override naming an axiomatic variable is preserved so `evaluate`
     * still enforces the rule.
     *
     * @param overrides - Variable assignments to layer over the defaults.
     * @param options - Optional evaluation options, forwarded to `evaluate`.
     * @returns The evaluation result under the merged assignment.
     *
     * @since 3.1.0
     */
    evaluateWithDefaults(
        overrides?: TCoreVariableAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult
    /**
     * Returns the ID of the claim-bound variable bound to `claimId`, or
     * `undefined` if none exists. Pure lookup — never creates a variable
     * (contrast `ensureClaimBoundVariable`). The documented seam, with its
     * inverse, for translating between the variable-keyed evaluation surface
     * and consumers' `claimId`-keyed state.
     *
     * @param claimId - The claim whose bound variable to look up.
     * @returns The variable ID, or `undefined`.
     *
     * @since 3.1.0
     */
    getVariableIdForClaim(claimId: string): string | undefined
    /**
     * Returns the `claimId` a claim-bound variable is bound to, or `undefined`
     * when the variable is unknown or premise-bound. Inverse of
     * `getVariableIdForClaim`.
     *
     * @param variableId - The variable whose claim to look up.
     * @returns The claim ID, or `undefined`.
     *
     * @since 3.1.0
     */
    getClaimIdForVariable(variableId: string): string | undefined
}

/**
 * Snapshot, rollback, and reactive subscription lifecycle.
 * Static factory methods (fromSnapshot, fromData) are class-level only.
 */
export interface TArgumentLifecycle<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Registers a listener that is called after every mutation.
     *
     * @param listener - The callback to invoke on mutation.
     * @returns An unsubscribe function that removes the listener.
     */
    subscribe(listener: () => void): () => void
    /**
     * Returns the current reactive snapshot for external store consumption.
     *
     * @returns The reactive snapshot.
     */
    getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
    /**
     * Returns a serializable snapshot of the full engine state.
     *
     * @returns The engine snapshot.
     */
    snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    /**
     * Restores the engine to a previously captured snapshot state.
     *
     * @param snapshot - The snapshot to restore from.
     */
    rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void
    /**
     * Run a comprehensive invariant validation sweep on the entire
     * argument. Checks schema conformance, reference integrity,
     * ownership, conclusion-ref + circularity, and per-premise
     * validation.
     *
     * Distinct from {@link TArgumentLifecycle.validate}, which runs
     * the four-tier grammar validator (`Structural ⊇ Evaluable ⊇
     * Derivable ⊇ Presentable`). The two are complementary — grammar
     * tiers cover AST-shape rules; this method covers
     * schema/reference/structural-bookkeeping invariants that sit
     * outside the tier hierarchy.
     *
     * @since 1.0.0 — replaces the pre-1.0 `validate()` no-arg
     *   overload, which has been removed.
     */
    validateInvariants(): TInvariantValidationResult
    /**
     * Four-tier grammar validation per spec §4. Returns the union of
     * violations from Structural up through `tier` — `'structural'`
     * returns S-rule violations only, `'evaluable'` returns S + E,
     * `'derivable'` returns S + E + D, `'presentable'` returns the
     * full union. Empty array means the argument is at the requested
     * tier or stricter. Never throws on grammar issues.
     *
     * For the invariant sweep (schema/reference/checksums) see
     * {@link TArgumentLifecycle.validateInvariants}.
     */
    validate(tier: TGrammarTier): readonly TViolation[]
    /**
     * Global normalize pass per spec §6. Runs the AN rule set
     * (AN-1..AN-4) everywhere it can fire, converging the argument
     * toward `tier` (defaults to `'presentable'`).
     *
     * `normalize` is non-destructive in the logical-meaning sense — it
     * does not delete variables, change claim references, or modify
     * operator semantics. Recovery from Evaluable or Derivable
     * violations requires user intent and is exposed via the repair
     * primitives.
     *
     * In v1.0 every AN rule targets a Presentable invariant, so calls
     * with `tier` ∈ {'structural', 'evaluable', 'derivable'} are
     * effectively no-ops. The parameter exists as forward-compatible
     * API surface.
     *
     * Bypasses `behavior`: cleanup runs regardless of whether the
     * engine is in `'assistive'` or `'permissive'` mode.
     *
     * @since 1.0.0
     */
    normalize(tier?: TGrammarTier): void
}

/**
 * Argument entity access and extras mutation.
 */
export interface TArgumentIdentity<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Returns a shallow copy of the argument metadata with checksum
     * attached.
     *
     * @returns The argument entity.
     */
    getArgument(): TArg
    /**
     * Returns the argument's extra metadata record (all fields except
     * id, version, and checksums).
     *
     * @returns The extras record.
     */
    getExtras(): Record<string, unknown>
    /**
     * Replaces the argument's extra metadata record.
     *
     * @param extras - The new extras record.
     * @returns The new extras record and a changeset with the modified argument.
     */
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
    /**
     * Shallow-merges updates into the argument's existing extras.
     *
     * @param updates - Key-value pairs to merge into the current extras.
     * @returns The merged extras record and a changeset with the modified argument.
     */
    updateExtras(
        updates: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
}
