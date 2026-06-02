import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
} from "../schemata/fork.js"
import {
    CoreEntityForkRecordSchema,
    CoreExpressionForkRecordSchema,
    CoreClaimForkRecordSchema,
} from "../schemata/fork.js"
import { ForkNamespace } from "./fork-namespace.js"
import type { TForkLibrarySnapshot } from "./interfaces/library.interfaces.js"
import type { TInvariantValidationResult } from "../types/validation.js"

/**
 * Aggregate container for fork provenance across all entity types.
 * Holds five {@link ForkNamespace} instances — one per entity kind
 * (arguments, premises, expressions, variables, claims).
 * Fork records are immutable after creation and carry no checksums.
 *
 * As of v0.10.0 the legacy `sources` namespace has been folded into
 * `claims` — sources are now claims with `type: "citation"`.
 */
export class ForkLibrary<
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
> {
    public readonly arguments: ForkNamespace<TArgFork>
    public readonly premises: ForkNamespace<TPremiseFork>
    public readonly expressions: ForkNamespace<TExprFork>
    public readonly variables: ForkNamespace<TVarFork>
    public readonly claims: ForkNamespace<TClaimFork>

    constructor() {
        this.arguments = new ForkNamespace<TArgFork>(CoreEntityForkRecordSchema)
        this.premises = new ForkNamespace<TPremiseFork>(
            CoreEntityForkRecordSchema
        )
        this.expressions = new ForkNamespace<TExprFork>(
            CoreExpressionForkRecordSchema
        )
        this.variables = new ForkNamespace<TVarFork>(CoreEntityForkRecordSchema)
        this.claims = new ForkNamespace<TClaimFork>(CoreClaimForkRecordSchema)
    }

    /** Returns a serializable snapshot of all five namespaces. */
    public snapshot(): TForkLibrarySnapshot<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork
    > {
        return {
            arguments: this.arguments.snapshot(),
            premises: this.premises.snapshot(),
            expressions: this.expressions.snapshot(),
            variables: this.variables.snapshot(),
            claims: this.claims.snapshot(),
        }
    }

    /**
     * Restores a full library from a previously captured snapshot.
     *
     * Pre-v0.10.0 snapshots that contained a `sources` namespace are not
     * supported here — callers must convert them via the CLI migration
     * before invoking `fromSnapshot`. Any stray `sources` key on
     * an input snapshot is silently ignored.
     */
    public static fromSnapshot<
        TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
        TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
        TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
        TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
        TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    >(
        snapshot: TForkLibrarySnapshot<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork
        >
    ): ForkLibrary<TArgFork, TPremiseFork, TExprFork, TVarFork, TClaimFork> {
        const lib = new ForkLibrary<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork
        >()

        for (const record of snapshot.arguments) {
            lib.arguments.create(record)
        }
        for (const record of snapshot.premises) {
            lib.premises.create(record)
        }
        for (const record of snapshot.expressions) {
            lib.expressions.create(record)
        }
        for (const record of snapshot.variables) {
            lib.variables.create(record)
        }
        for (const record of snapshot.claims) {
            lib.claims.create(record)
        }

        return lib
    }

    /** Validates all five namespaces and returns the combined result. */
    public validate(): TInvariantValidationResult {
        const allViolations = [
            ...this.arguments.validate().violations,
            ...this.premises.validate().violations,
            ...this.expressions.validate().violations,
            ...this.variables.validate().violations,
            ...this.claims.validate().violations,
        ]
        return { ok: allViolations.length === 0, violations: allViolations }
    }
}
