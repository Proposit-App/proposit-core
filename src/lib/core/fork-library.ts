import type {
    TCoreArgumentForkRecord,
    TCorePremiseForkRecord,
    TCoreExpressionForkRecord,
    TCoreVariableForkRecord,
    TCoreClaimForkRecord,
    TCoreSourceForkRecord,
} from "../schemata/fork.js"
import {
    CoreEntityForkRecordSchema,
    CoreExpressionForkRecordSchema,
    CoreClaimForkRecordSchema,
    CoreSourceForkRecordSchema,
} from "../schemata/fork.js"
import { ForkNamespace } from "./fork-namespace.js"
import type { TForkLibrarySnapshot } from "./interfaces/library.interfaces.js"
import type { TInvariantValidationResult } from "../types/validation.js"

/**
 * Aggregate container for fork provenance across all entity types.
 * Holds six {@link ForkNamespace} instances — one per entity kind
 * (arguments, premises, expressions, variables, claims, sources).
 * Fork records are immutable after creation and carry no checksums.
 */
export class ForkLibrary<
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
> {
    public readonly arguments: ForkNamespace<TArgFork>
    public readonly premises: ForkNamespace<TPremiseFork>
    public readonly expressions: ForkNamespace<TExprFork>
    public readonly variables: ForkNamespace<TVarFork>
    public readonly claims: ForkNamespace<TClaimFork>
    public readonly sources: ForkNamespace<TSourceFork>

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
        this.sources = new ForkNamespace<TSourceFork>(
            CoreSourceForkRecordSchema
        )
    }

    /** Returns a serializable snapshot of all six namespaces. */
    public snapshot(): TForkLibrarySnapshot<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    > {
        return {
            arguments: this.arguments.snapshot(),
            premises: this.premises.snapshot(),
            expressions: this.expressions.snapshot(),
            variables: this.variables.snapshot(),
            claims: this.claims.snapshot(),
            sources: this.sources.snapshot(),
        }
    }

    /** Restores a full library from a previously captured snapshot. */
    public static fromSnapshot<
        TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
        TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
        TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
        TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
        TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
        TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
    >(
        snapshot: TForkLibrarySnapshot<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
        >
    ): ForkLibrary<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    > {
        const lib = new ForkLibrary<
            TArgFork,
            TPremiseFork,
            TExprFork,
            TVarFork,
            TClaimFork,
            TSourceFork
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
        for (const record of snapshot.sources) {
            lib.sources.create(record)
        }

        return lib
    }

    /** Validates all six namespaces and returns the combined result. */
    public validate(): TInvariantValidationResult {
        const allViolations = [
            ...this.arguments.validate().violations,
            ...this.premises.validate().violations,
            ...this.expressions.validate().violations,
            ...this.variables.validate().violations,
            ...this.claims.validate().violations,
            ...this.sources.validate().violations,
        ]
        return { ok: allViolations.length === 0, violations: allViolations }
    }
}
