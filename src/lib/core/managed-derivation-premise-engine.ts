import {
    type TCoreArgument,
    type TCoreDerivationPremise,
    type TCoreLogicalOperatorType,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TOptionalChecksum,
    type TClaimBoundVariable,
} from "../schemata/index.js"
import { PremiseEngine, type TPremiseEngineSnapshot } from "./premise-engine.js"
import { VariableManager } from "./variable-manager.js"
import {
    defaultGenerateId,
    type TLogicEngineOptions,
} from "./argument-engine.js"

/**
 * Minimal structural interface needed by `populateFromSupports`. Using a
 * structural type rather than the concrete `ArgumentEngine<…>` class prevents
 * generic-parameter variance errors when the caller uses default type params.
 */
export type TVariableMaterializer = {
    ensureClaimBoundVariable(claimId: string): TClaimBoundVariable
}
import { type TGrammarConfig } from "../types/grammar.js"
import {
    DERIVATION_TYPE_MISMATCH,
    DERIVATION_STRUCTURE_INVALID,
    DERIVATION_CONSEQUENT_LOCKED,
    DERIVATION_ROOT_OPERATOR_INVALID,
    DERIVATION_ANTECEDENT_NON_EMPTY,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"
import { validateDerivationStructure } from "../utils/derivation-validation.js"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./expression-manager.js"
import type { TCoreMutationResult } from "../types/mutation.js"
import type { ClaimCitationLibrary } from "./claim-citation-library.js"
import type { ClaimAxiomLibrary } from "./claim-axiom-library.js"

/**
 * A managed engine for derivation premises that enforces structural rules
 * from the v0.11.0 spec on construction and on snapshot restoration.
 *
 * Construction validates the premise type (`DERIVATION_TYPE_MISMATCH` if the
 * premise isn't `type: "derivation"`). Full expression-tree structural
 * validation (`DERIVATION_STRUCTURE_INVALID`) runs in `fromSnapshot` — after
 * expressions are loaded — and will be called from mutation overrides in
 * Task 6.
 *
 * Note: The constructor only validates the premise type, not the expression
 * tree, because `PremiseEngine` is always constructed before expressions are
 * loaded (expressions are added separately via mutations or `loadExpressions`).
 * Structural validation at the end of `fromSnapshot` catches tampered
 * snapshots, and Task 6 mutation overrides will enforce it on every change.
 *
 * The classic `PremiseEngine` is permissive and allows mutations that leave a
 * derivation premise temporarily or permanently invalid. The managed engine
 * wraps it for safe, structurally-enforced editing.
 *
 * Use `ManagedDerivationPremiseEngine.fromSnapshot(...)` to restore from a
 * serialized snapshot — the validation pass catches tampered snapshots.
 */
export class ManagedDerivationPremiseEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> extends PremiseEngine<TArg, TPremise, TExpr, TVar> {
    /**
     * Captured from `config.generateId` (or the default UUID generator) for
     * use in `populateFromSupports`, which needs to mint new expression IDs.
     * Stored separately because `PremiseEngine`'s generateId is private.
     * Not `readonly` because `fromSnapshot` re-injects it after the prototype
     * upgrade.
     */
    private generateIdFn: () => string

    constructor(
        premise: TOptionalChecksum<TPremise>,
        deps: {
            argument: TOptionalChecksum<TArg>
            variables: VariableManager<TVar>
            expressionIndex?: Map<string, string>
        },
        config?: TLogicEngineOptions
    ) {
        super(premise, deps, config)
        this.generateIdFn = config?.generateId ?? defaultGenerateId
        // Validate premise type immediately — no expressions needed.
        // Structural validation (assertWellFormed) is deferred to fromSnapshot
        // and mutation overrides because PremiseEngine is always constructed
        // before expressions are loaded.
        this.assertDerivationType()
    }

    /**
     * Restore a `ManagedDerivationPremiseEngine` from a serialized snapshot,
     * applying both derivation-type and structural validation. Throws on
     * tampered or structurally invalid snapshots.
     *
     * Delegates to `PremiseEngine.fromSnapshot` for the full restoration logic
     * (including the private `rebuildVariableIndex` pass), then upgrades the
     * prototype and validates. TypeScript's static methods do not support
     * `super`, so the parent is called by name and the result is recast.
     */
    static fromSnapshot<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    >(
        snapshot: TPremiseEngineSnapshot<TPremise, TExpr>,
        argument: TOptionalChecksum<TArg>,
        variables: VariableManager<TVar>,
        expressionIndex?: Map<string, string>,
        grammarConfig?: TGrammarConfig,
        generateId?: () => string
    ): ManagedDerivationPremiseEngine<TArg, TPremise, TExpr, TVar> {
        // Validate type before doing the full restore work.
        const premiseType = (snapshot.premise as TCorePremise).type
        if (premiseType !== "derivation") {
            throw new InvariantViolationError([
                {
                    code: DERIVATION_TYPE_MISMATCH,
                    message: `${DERIVATION_TYPE_MISMATCH}: ManagedDerivationPremiseEngine requires a premise with type "derivation" (got "${premiseType}")`,
                    entityType: "premise",
                    entityId: snapshot.premise.id,
                },
            ])
        }

        // Delegate to the parent's static fromSnapshot to get a fully restored
        // engine, including the private rebuildVariableIndex pass.
        const pe = PremiseEngine.fromSnapshot<TArg, TPremise, TExpr, TVar>(
            snapshot,
            argument,
            variables,
            expressionIndex,
            grammarConfig,
            generateId
        )

        // Upgrade the instance prototype so it becomes a
        // ManagedDerivationPremiseEngine with all subclass methods available.
        Object.setPrototypeOf(pe, ManagedDerivationPremiseEngine.prototype)
        const engine = pe as ManagedDerivationPremiseEngine<
            TArg,
            TPremise,
            TExpr,
            TVar
        >

        // Inject the generateId captured from config (or the default) so that
        // populateFromSupports can mint new expression IDs.
        engine.generateIdFn = generateId ?? defaultGenerateId

        // Validate the full tree — expressions are fully loaded at this point.
        // (Type was already checked at the top before delegating to the parent.)
        engine.assertWellFormed()

        return engine
    }

    /**
     * Validate that the wrapped premise has `type === "derivation"`.
     * @throws InvariantViolationError with code `DERIVATION_TYPE_MISMATCH`
     */
    protected assertDerivationType(): void {
        const premise = this.premise as TCorePremise
        if (premise.type !== "derivation") {
            throw new InvariantViolationError([
                {
                    code: DERIVATION_TYPE_MISMATCH,
                    message: `${DERIVATION_TYPE_MISMATCH}: ManagedDerivationPremiseEngine requires a premise with type "derivation" (got "${premise.type}")`,
                    entityType: "premise",
                    entityId: premise.id,
                },
            ])
        }
    }

    /**
     * Validate that the expression tree conforms to the derivation rules from
     * the v0.11.0 spec (naked-Q or IMPLIES/IFF with Q as consequent).
     * @throws InvariantViolationError with code `DERIVATION_STRUCTURE_INVALID`
     */
    protected assertWellFormed(): void {
        const result = validateDerivationStructure(
            this.premise as TCoreDerivationPremise,
            this.expressions.toArray(),
            this.variables.toArray()
        )
        if (result.violations.length > 0) {
            // Prefix each violation message with the code so the thrown Error's
            // message text is searchable by code (InvariantViolationError uses
            // violations[0].message as the Error message when there is exactly
            // one violation).
            const prefixed = result.violations.map((v) => ({
                ...v,
                message: `${DERIVATION_STRUCTURE_INVALID}: ${v.message}`,
            }))
            throw new InvariantViolationError(prefixed)
        }
    }

    // -------------------------------------------------------------------------
    // Mutation overrides — enforce derivation invariants on every change
    // -------------------------------------------------------------------------

    public override addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        const result = super.addExpression(expression)
        this.assertWellFormed()
        return result
    }

    public override appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        const result = super.appendExpression(parentId, expression)
        this.assertWellFormed()
        return result
    }

    public override addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        const result = super.addExpressionRelative(
            siblingId,
            relativePosition,
            expression
        )
        this.assertWellFormed()
        return result
    }

    public override updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertConsequentNotMutated(expressionId, updates)
        const result = super.updateExpression(expressionId, updates)
        this.assertWellFormed()
        return result
    }

    public override removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TCoreMutationResult<TExpr | undefined, TExpr, TVar, TPremise, TArg> {
        this.assertNotConsequentExpression(expressionId)
        const result = super.removeExpression(expressionId, deleteSubtree)
        this.assertWellFormed()
        return result
    }

    public override insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        this.assertNotConsequentSlot(expression)
        const result = super.insertExpression(
            expression,
            leftNodeId,
            rightNodeId
        )
        this.assertWellFormed()
        return result
    }

    public override toggleNegation(
        expressionId: string,
        extraFields?: Partial<TExpr>
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg> {
        this.assertNotConsequentExpression(expressionId)
        const result = super.toggleNegation(expressionId, extraFields)
        this.assertWellFormed()
        return result
    }

    public override wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg> {
        // wrapExpression rejects calls without exactly one of leftNodeId/rightNodeId,
        // so the !-assertion is safe: at least one of the two is always defined here.
        this.assertNotConsequentExpression((leftNodeId ?? rightNodeId)!)
        const result = super.wrapExpression(
            operator,
            newSibling,
            leftNodeId,
            rightNodeId
        )
        this.assertWellFormed()
        return result
    }

    public override changeOperator(
        expressionId: string,
        newOperator: TCoreLogicalOperatorType,
        sourceChildId?: string,
        targetChildId?: string,
        extraFields?: Partial<TExpr>
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg> {
        this.assertRootOperatorChangeValid(expressionId, newOperator)
        const result = super.changeOperator(
            expressionId,
            newOperator,
            sourceChildId,
            targetChildId,
            extraFields
        )
        this.assertWellFormed()
        return result
    }

    public override normalizeExpressions(): TCoreMutationResult<
        void,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        const result = super.normalizeExpressions()
        // Post-validate: normalization could destroy the consequent structure.
        // assertWellFormed throws DERIVATION_STRUCTURE_INVALID if so.
        this.assertWellFormed()
        return result
    }

    public override loadExpressions(
        expressions: TExpressionInput<TExpr>[]
    ): void {
        // Pre-validate the proposed expression set BEFORE mutation because
        // loadExpressions is a bulk replace — we need to reject the whole set
        // atomically rather than rolling back after the fact.
        const premise = this.premise as TCoreDerivationPremise
        const validationResult = validateDerivationStructure(
            premise,
            // TExpressionInput strips checksum fields, but validateDerivationStructure
            // only reads parentId, type, variableId, operator, position, premiseId —
            // all of which are present on TExpressionInput.
            expressions as unknown as TCorePropositionalExpression[],
            this.variables.toArray()
        )
        if (validationResult.violations.length > 0) {
            const prefixed = validationResult.violations.map((v) => ({
                ...v,
                message: `${DERIVATION_STRUCTURE_INVALID}: ${v.message}`,
            }))
            throw new InvariantViolationError(prefixed)
        }
        super.loadExpressions(expressions)
    }

    // -------------------------------------------------------------------------
    // Public one-shot helpers
    // -------------------------------------------------------------------------

    /**
     * One-shot helper that builds the antecedent of this derivation premise
     * from the current global support (citations + axiom invocations) of the
     * derived claim.
     *
     * Behavior by total support count `n = citations + axioms`:
     *   - n = 0: no change. Premise stays in its current form (typically
     *     naked-Q, indicating "no support given").
     *   - n = 1: `IMPLIES(VarExpr(S1), Q)`.
     *   - n ≥ 2: `IMPLIES(formula(OR(VarExpr(S1), …, VarExpr(Sn))), Q)`.
     *     Citations come first, axioms second; source order preserved within
     *     each. The formula buffer between IMPLIES and OR is auto-inserted by
     *     the engine's standard grammar.
     *
     * Materializes a claim-bound variable for each supporting claim via
     * `argumentEngine.ensureClaimBoundVariable(supportingClaimId)`.
     *
     * **Tree construction approach:** Mutations are performed via `super.*`
     * calls, bypassing this class's overrides (which call `assertWellFormed()`
     * after every mutation and would reject intermediate states during
     * multi-step construction). Standard grammar is used throughout — the
     * engine's `wrapInsertFormula` rule inserts a formula buffer between
     * IMPLIES and OR for n ≥ 2 automatically. `assertWellFormed()` is called
     * at the end to validate the final state.
     *
     * @throws InvariantViolationError(DERIVATION_ANTECEDENT_NON_EMPTY) when
     *         the antecedent slot is already filled.
     *
     * @since 0.12.0
     */
    public populateFromSupports(
        citationLib: ClaimCitationLibrary,
        axiomLib: ClaimAxiomLibrary,
        argumentEngine: TVariableMaterializer
    ): void {
        const premise = this.premise as TCoreDerivationPremise
        const derivedClaimId = premise.derivedClaimId

        // 1. Reject if antecedent is already non-empty.
        const rootId = this.rootExpressionId
        if (rootId !== undefined) {
            const root = this.expressions.getExpression(rootId)
            if (
                root &&
                root.type === "operator" &&
                (root.operator === "implies" || root.operator === "iff")
            ) {
                // Sort children by position; lowest-position child is the antecedent.
                const children = this.expressions
                    .getChildExpressions(rootId)
                    .sort((a, b) => a.position - b.position)
                const antecedent = children[0]
                if (antecedent) {
                    throw new InvariantViolationError([
                        {
                            code: DERIVATION_ANTECEDENT_NON_EMPTY,
                            message: `${DERIVATION_ANTECEDENT_NON_EMPTY}: derivation premise already has a non-empty antecedent`,
                            entityType: "premise",
                            entityId: premise.id,
                            premiseId: premise.id,
                        },
                    ])
                }
            }
        }

        // 2. Collect supporting connections from both libraries (citations
        //    first, axioms second; source order preserved within each).
        const citationConnections =
            citationLib.getConnectionsForClaim(derivedClaimId)
        const axiomConnections =
            axiomLib.getConnectionsForClaim(derivedClaimId)
        const totalCount =
            citationConnections.length + axiomConnections.length
        if (totalCount === 0) return

        // 3. Materialize claim-bound variables for each support.
        // ensureClaimBoundVariable adds the variable to the live argumentEngine,
        // but the managed engine has its own VariableManager snapshot that was
        // taken before these new variables were created. Register each newly
        // returned variable into this engine's VariableManager so that the
        // variable expressions we construct below pass assertVariableExpressionValid.
        const supportingVariables: TClaimBoundVariable[] = []
        for (const conn of citationConnections) {
            supportingVariables.push(
                argumentEngine.ensureClaimBoundVariable(conn.supportingClaimId)
            )
        }
        for (const conn of axiomConnections) {
            supportingVariables.push(
                argumentEngine.ensureClaimBoundVariable(conn.supportingClaimId)
            )
        }
        for (const sv of supportingVariables) {
            if (!this.variables.hasVariable(sv.id)) {
                this.variables.addVariable(sv as unknown as TVar)
            }
        }

        // 4. Build the antecedent expression tree.
        this.buildAntecedentFromSupportingVariables(supportingVariables)

        // 5. Validate the final tree is well-formed.
        this.assertWellFormed()
    }

    /**
     * Build the antecedent expression tree from a list of already-materialized
     * supporting variables. Shared between populate helpers.
     *
     * - n=0 → no-op (caller decides whether to leave the naked-Q form intact).
     * - n=1 → IMPLIES(VarExpr(S1), Q) using wrapExpression with rightNodeId=Q.
     * - n≥2 → IMPLIES(formula(OR(S1, ..., Sn)), Q) via wrapExpression + appendExpression.
     *
     * Uses `super.*` mutation calls to bypass this class's overrides during
     * multi-step construction. Caller is responsible for the final
     * `assertWellFormed()`.
     */
    private buildAntecedentFromSupportingVariables(
        supportingVars: TClaimBoundVariable[]
    ): void {
        if (supportingVars.length === 0) return

        const argId = (this.premise as TCorePremise).argumentId
        const argVersion = (this.premise as TCorePremise).argumentVersion
        const premiseId = (this.premise as TCorePremise).id

        // qRootExprId is the ID of the current naked-Q root variable expression.
        const qRootExprId = this.rootExpressionId!

        if (supportingVars.length === 1) {
            // n = 1: wrap naked-Q with IMPLIES using rightNodeId so that Q lands
            // at the midpoint (consequent) position and S1 lands at initial.
            const impliesId = this.generateIdFn()
            const s1ExprId = this.generateIdFn()
            const impliesOp = {
                id: impliesId,
                argumentId: argId,
                argumentVersion: argVersion,
                premiseId,
                parentId: null,
                type: "operator" as const,
                operator: "implies" as const,
            } as TExpressionWithoutPosition<TExpr>
            const s1VarExpr = {
                id: s1ExprId,
                argumentId: argId,
                argumentVersion: argVersion,
                premiseId,
                parentId: null, // wrapExpression sets the parentId internally
                type: "variable" as const,
                variableId: supportingVars[0].id,
            } as TExpressionWithoutPosition<TExpr>
            // rightNodeId=qRootExprId: existing node (Q) → midpoint (consequent),
            // newSibling (S1) → initial (antecedent).
            super.wrapExpression(impliesOp, s1VarExpr, undefined, qRootExprId)
        } else {
            // n ≥ 2: build IMPLIES(formula(OR(S1,...,Sn)), Q). Standard grammar
            // throughout — the engine's wrapInsertFormula rule auto-inserts a
            // formula buffer between IMPLIES and OR. The OR keeps its original
            // ID, so subsequent appendExpression(orId, ...) calls still attach
            // the supporting variables to the same OR node.
            const impliesId = this.generateIdFn()
            const orId = this.generateIdFn()
            const impliesOp = {
                id: impliesId,
                argumentId: argId,
                argumentVersion: argVersion,
                premiseId,
                parentId: null,
                type: "operator" as const,
                operator: "implies" as const,
            } as TExpressionWithoutPosition<TExpr>
            const orOp = {
                id: orId,
                argumentId: argId,
                argumentVersion: argVersion,
                premiseId,
                parentId: null, // wrapExpression sets the parentId internally
                type: "operator" as const,
                operator: "or" as const,
            } as TExpressionWithoutPosition<TExpr>
            // rightNodeId=qRootExprId: Q → midpoint (consequent), OR → initial (antecedent).
            super.wrapExpression(impliesOp, orOp, undefined, qRootExprId)
            // Append each supporting variable expression as a child of OR.
            for (const sourceVar of supportingVars) {
                const srcExprId = this.generateIdFn()
                const srcVarExpr = {
                    id: srcExprId,
                    argumentId: argId,
                    argumentVersion: argVersion,
                    premiseId,
                    parentId: orId,
                    type: "variable" as const,
                    variableId: sourceVar.id,
                } as TExpressionWithoutPosition<TExpr>
                super.appendExpression(orId, srcVarExpr)
            }
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Returns the ID of the consequent expression, or `undefined` if the tree
     * has no root yet.
     *
     * - Naked form (root is a variable expression): the root IS the consequent.
     * - Implication/biconditional form (root is `implies`/`iff`): the position-1
     *   child of the root is the consequent.
     */
    private getConsequentExpressionId(): string | undefined {
        const rootId = this.rootExpressionId
        if (rootId === undefined) {
            return undefined
        }
        const root = this.expressions.getExpression(rootId)
        if (!root) {
            return undefined
        }
        if (root.type === "variable") {
            // Naked form — root IS the consequent.
            return rootId
        }
        if (
            root.type === "operator" &&
            (root.operator === "implies" || root.operator === "iff")
        ) {
            // Implication/biconditional form — position-1 child is the consequent.
            const children = this.expressions
                .getChildExpressions(rootId)
                .sort((a, b) => a.position - b.position)
            return children[1]?.id
        }
        return undefined
    }

    /**
     * Reject an `insertExpression` call that would place a new node into the
     * consequent slot of the root `implies`/`iff`.
     *
     * Detection is by parentId + position on the input: we block when
     * `expression.parentId === rootId` AND `expression.position >= consequent.position`.
     * For `implies`/`iff` the consequent sits at position 1, so this blocks
     * insertions into position 1 (which would displace the consequent) and
     * positions beyond (which would exceed arity 2). Insertions at position 0
     * (antecedent slot) pass through.
     */
    private assertNotConsequentSlot(expression: TExpressionInput<TExpr>): void {
        const rootId = this.rootExpressionId
        if (rootId === undefined) {
            return
        }
        const root = this.expressions.getExpression(rootId)
        if (
            !root ||
            root.type !== "operator" ||
            (root.operator !== "implies" && root.operator !== "iff")
        ) {
            return
        }
        // The consequent is the position-1 child of the root operator.
        const consequentId = this.getConsequentExpressionId()
        if (!consequentId) {
            return
        }
        // Block if the incoming expression is being inserted directly under root
        // with position 1 (i.e., it claims the consequent slot).
        if (expression.parentId === rootId) {
            // Determine the consequent's current position to compare.
            const consequentExpr = this.expressions.getExpression(consequentId)
            if (
                consequentExpr &&
                expression.position >= consequentExpr.position
            ) {
                throw new InvariantViolationError([
                    {
                        code: DERIVATION_CONSEQUENT_LOCKED,
                        message: `${DERIVATION_CONSEQUENT_LOCKED}: Cannot insert an expression into the consequent slot of a derivation premise`,
                        entityType: "expression",
                        entityId: expression.id,
                        premiseId: (this.premise as TCorePremise).id,
                    },
                ])
            }
        }
    }

    /**
     * Reject `removeExpression` and `toggleNegation` calls on the consequent
     * expression.
     */
    private assertNotConsequentExpression(exprId: string): void {
        const consequentId = this.getConsequentExpressionId()
        if (consequentId !== undefined && exprId === consequentId) {
            throw new InvariantViolationError([
                {
                    code: DERIVATION_CONSEQUENT_LOCKED,
                    message: `${DERIVATION_CONSEQUENT_LOCKED}: Cannot remove or negate the consequent expression of a derivation premise`,
                    entityType: "expression",
                    entityId: exprId,
                    premiseId: (this.premise as TCorePremise).id,
                },
            ])
        }
    }

    /**
     * Reject `updateExpression` calls that change the consequent's `variableId`
     * or `type`.
     */
    private assertConsequentNotMutated(
        exprId: string,
        updates: TExpressionUpdate
    ): void {
        const consequentId = this.getConsequentExpressionId()
        if (consequentId === undefined || exprId !== consequentId) {
            return
        }
        if (
            updates.variableId !== undefined ||
            updates.operator !== undefined
        ) {
            throw new InvariantViolationError([
                {
                    code: DERIVATION_CONSEQUENT_LOCKED,
                    message: `${DERIVATION_CONSEQUENT_LOCKED}: Cannot change the variable or operator of the consequent expression of a derivation premise`,
                    entityType: "expression",
                    entityId: exprId,
                    premiseId: (this.premise as TCorePremise).id,
                },
            ])
        }
    }

    /**
     * Reject `changeOperator` calls that would swap the root `implies`/`iff`
     * to a non-implication operator (`and`, `or`, `not`).
     */
    private assertRootOperatorChangeValid(
        exprId: string,
        newOperator: TCoreLogicalOperatorType
    ): void {
        const rootId = this.rootExpressionId
        if (rootId === undefined || exprId !== rootId) {
            return
        }
        const root = this.expressions.getExpression(rootId)
        if (
            !root ||
            root.type !== "operator" ||
            (root.operator !== "implies" && root.operator !== "iff")
        ) {
            return
        }
        if (newOperator !== "implies" && newOperator !== "iff") {
            throw new InvariantViolationError([
                {
                    code: DERIVATION_ROOT_OPERATOR_INVALID,
                    message: `${DERIVATION_ROOT_OPERATOR_INVALID}: Cannot change a derivation premise's root operator from "${root.operator}" to "${newOperator}" — only implies↔iff swaps are permitted`,
                    entityType: "expression",
                    entityId: exprId,
                    premiseId: (this.premise as TCorePremise).id,
                },
            ])
        }
    }
}
