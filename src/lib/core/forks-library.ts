import { randomUUID } from "node:crypto"
import { Value } from "typebox/value"
import type { TCoreFork } from "../schemata/fork.js"
import { CoreForkSchema } from "../schemata/fork.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type { TCoreClaim } from "../schemata/claim.js"
import type {
    TCoreSource,
    TCoreClaimSourceAssociation,
} from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type { TForkArgumentOptions, TForkRemapTable } from "../types/fork.js"
import { entityChecksum } from "./checksum.js"
import { ArgumentEngine } from "./argument-engine.js"
import { forkArgumentEngine } from "./fork.js"
import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
    TForkLookup,
    TForksLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import { FORK_SCHEMA_INVALID } from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

export class ForksLibrary<
    TFork extends TCoreFork = TCoreFork,
> implements TForkLookup<TFork> {
    private forks: Map<string, TFork>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.forks = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    private restoreFromSnapshot(snap: TForksLibrarySnapshot<TFork>): void {
        this.forks = new Map()
        for (const fork of snap.forks) {
            this.forks.set(fork.id, fork)
        }
    }

    private withValidation<T>(fn: () => T): T {
        const snap = this.snapshot()
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.restoreFromSnapshot(snap)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromSnapshot(snap)
            }
            throw e
        }
    }

    private static readonly forkChecksumFields = new Set([
        "id",
        "sourceArgumentId",
        "sourceArgumentVersion",
        "createdOn",
    ])

    private computeChecksum(fork: TFork): string {
        return entityChecksum(
            fork as unknown as Record<string, unknown>,
            ForksLibrary.forkChecksumFields
        )
    }

    public create(
        fork: Omit<TFork, "checksum"> & { checksum?: string }
    ): TFork {
        return this.withValidation(() => {
            if (this.forks.has(fork.id)) {
                throw new Error(
                    `Fork record with ID "${fork.id}" already exists.`
                )
            }

            const full = { ...fork, checksum: "" } as TFork
            full.checksum = this.computeChecksum(full)

            this.forks.set(full.id, full)
            return full
        })
    }

    public get(id: string): TFork | undefined {
        return this.forks.get(id)
    }

    public getAll(): TFork[] {
        return Array.from(this.forks.values())
    }

    public remove(id: string): TFork {
        return this.withValidation(() => {
            const fork = this.forks.get(id)
            if (!fork) {
                throw new Error(`Fork record "${id}" not found.`)
            }

            this.forks.delete(id)
            return fork
        })
    }

    public snapshot(): TForksLibrarySnapshot<TFork> {
        return { forks: this.getAll() }
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [id, fork] of this.forks) {
            if (!Value.Check(CoreForkSchema, fork)) {
                violations.push({
                    code: FORK_SCHEMA_INVALID,
                    message: `Fork record "${id}" does not conform to schema`,
                    entityType: "fork",
                    entityId: id,
                })
            }
        }
        return { ok: violations.length === 0, violations }
    }

    /**
     * Creates an independent copy of an argument engine under a new argument ID,
     * with a fork record tracking the operation.
     *
     * Calls `engine.canFork()` as a guard. Delegates engine forking to
     * `forkArgumentEngine()` and creates the fork record.
     *
     * @param engine - The source engine to fork.
     * @param newArgumentId - The ID for the forked argument.
     * @param libraries - Claim, source, and claim-source libraries for the fork.
     * @param options - Fork options plus optional `forkId` and `creatorId`.
     * @returns The forked engine, remap table, and fork record.
     * @throws If `engine.canFork()` returns false.
     */
    forkArgument<
        TArg extends TCoreArgument = TCoreArgument,
        TPremise extends TCorePremise = TCorePremise,
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
        TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
        TSource extends TCoreSource = TCoreSource,
        TClaim extends TCoreClaim = TCoreClaim,
        TAssoc extends TCoreClaimSourceAssociation =
            TCoreClaimSourceAssociation,
    >(
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >,
        newArgumentId: string,
        libraries: {
            claimLibrary: TClaimLookup<TClaim>
            sourceLibrary: TSourceLookup<TSource>
            claimSourceLibrary: TClaimSourceLookup<TAssoc>
        },
        options?: TForkArgumentOptions & {
            forkId?: string
            creatorId?: string
        }
    ): {
        engine: ArgumentEngine<
            TArg,
            TPremise,
            TExpr,
            TVar,
            TSource,
            TClaim,
            TAssoc
        >
        remapTable: TForkRemapTable
        fork: TFork
    } {
        // 1. Guard
        if (!engine.canFork()) {
            throw new Error("Forking is not allowed for this engine.")
        }

        // 2. Snapshot source argument metadata for the fork record
        const sourceArg = engine.getArgument()

        // 3. Fork the engine
        const { engine: forkedEngine, remapTable } = forkArgumentEngine(
            engine,
            newArgumentId,
            libraries,
            options
        )

        // 4. Create fork record
        const forkId = options?.forkId ?? randomUUID()
        const fork = this.create({
            id: forkId,
            sourceArgumentId: sourceArg.id,
            sourceArgumentVersion: sourceArg.version,
            createdOn: new Date().toISOString(),
            ...(options?.creatorId ? { creatorId: options.creatorId } : {}),
        } as Omit<TFork, "checksum">)

        return { engine: forkedEngine, remapTable, fork }
    }

    public static fromSnapshot<TFork extends TCoreFork = TCoreFork>(
        snapshot: TForksLibrarySnapshot<TFork>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ForksLibrary<TFork> {
        const lib = new ForksLibrary<TFork>(options)
        for (const fork of snapshot.forks) {
            lib.forks.set(fork.id, fork)
        }
        return lib
    }
}
