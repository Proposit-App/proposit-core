import {
    type TCoreArgument,
    type TCoreDerivationPremise,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TOptionalChecksum,
} from "../schemata/index.js"
import { PremiseEngine, type TPremiseEngineSnapshot } from "./premise-engine.js"
import { VariableManager } from "./variable-manager.js"
import type { TLogicEngineOptions } from "./argument-engine.js"
import type { TGrammarConfig } from "../types/grammar.js"
import {
    DERIVATION_TYPE_MISMATCH,
    DERIVATION_STRUCTURE_INVALID,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"
import { validateDerivationStructure } from "../utils/derivation-validation.js"

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
        TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
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
}
