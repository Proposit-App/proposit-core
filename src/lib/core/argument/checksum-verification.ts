import type {
    TCoreArgument,
    TCoreClaim,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
} from "../../schemata/index.js"
import type {
    ArgumentEngine,
    TArgumentEngineSnapshot,
} from "../argument-engine.js"

// Checks run on an engine just restored from stored data: each checksum
// the data carried must equal the one the engine recomputes. They read the
// engine only through its public methods.

/**
 * Whether a stored checksum field agrees with the recomputed one. An absent
 * stored value is not checked. Values are compared as they are, not as
 * strings: a `descendantChecksum` is `null` for an argument with no premises
 * or a premise with no expressions, and a stored `null` must match a computed
 * `null`.
 */
function storedChecksumAgrees(stored: unknown, computed: unknown): boolean {
    return stored === undefined || stored === computed
}

/**
 * Verifies that all checksum fields in the snapshot match the recomputed
 * checksums on the restored engine. Throws on the first mismatch.
 */
export function verifySnapshotChecksums<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
): void {
    const checksumFields = [
        "checksum",
        "descendantChecksum",
        "combinedChecksum",
    ] as const

    // Verify expression checksums
    for (const pe of engine.listPremises()) {
        for (const expr of pe.getExpressions()) {
            const premiseSnap = snapshot.premises.find(
                (ps) => ps.premise.id === pe.getId()
            )
            const exprSnap = premiseSnap?.expressions.expressions.find(
                (e) => e.id === expr.id
            )
            if (exprSnap) {
                for (const field of checksumFields) {
                    const stored = (exprSnap as Record<string, unknown>)[field]
                    const computed = (expr as Record<string, unknown>)[field]
                    if (!storedChecksumAgrees(stored, computed)) {
                        throw new Error(
                            `Checksum mismatch on expression "${expr.id}" field "${field}": stored="${String(stored)}", computed="${String(computed)}"`
                        )
                    }
                }
            }
        }
    }

    // Verify variable checksums
    for (const v of engine.getVariables()) {
        const varSnap = snapshot.variables.variables.find(
            (sv) => (sv as Record<string, unknown>).id === v.id
        )
        const storedVarChecksum = varSnap
            ? String((varSnap as Record<string, unknown>).checksum)
            : undefined
        if (storedVarChecksum && storedVarChecksum !== "undefined") {
            if (storedVarChecksum !== v.checksum) {
                throw new Error(
                    `Checksum mismatch on variable "${v.id}": stored="${storedVarChecksum}", computed="${v.checksum}"`
                )
            }
        }
    }

    // Verify premise checksums
    for (const pe of engine.listPremises()) {
        const premiseSnap = snapshot.premises.find(
            (ps) => ps.premise.id === pe.getId()
        )
        if (premiseSnap?.premise) {
            const sp = premiseSnap.premise as Record<string, unknown>
            for (const field of checksumFields) {
                const stored = sp[field]
                const computed = pe[field]()
                if (!storedChecksumAgrees(stored, computed)) {
                    throw new Error(
                        `Checksum mismatch on premise "${pe.getId()}" field "${field}": stored="${String(stored)}", computed="${String(computed)}"`
                    )
                }
            }
        }
    }

    // Verify argument checksums
    const sa = snapshot.argument as Record<string, unknown>
    for (const field of checksumFields) {
        const stored = sa[field]
        const computed = engine[field]()
        if (!storedChecksumAgrees(stored, computed)) {
            throw new Error(
                `Checksum mismatch on argument "${engine.getArgument().id}" field "${field}": stored="${String(stored)}", computed="${String(computed)}"`
            )
        }
    }
}

/**
 * Verifies that all checksum fields in the input data match the recomputed
 * checksums on the restored engine. Throws on the first mismatch.
 */
export function verifyDataChecksums<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    argument: TOptionalChecksum<TArg>,
    variables: TOptionalChecksum<TVar>[],
    premises: TOptionalChecksum<TPremise>[]
): void {
    const checksumFields = [
        "checksum",
        "descendantChecksum",
        "combinedChecksum",
    ] as const

    // Verify variable checksums
    for (const v of engine.getVariables()) {
        const inputVar = variables.find(
            (iv) => (iv as Record<string, unknown>).id === v.id
        )
        const storedVarChecksum = inputVar
            ? String((inputVar as Record<string, unknown>).checksum)
            : undefined
        if (storedVarChecksum && storedVarChecksum !== "undefined") {
            if (storedVarChecksum !== v.checksum) {
                throw new Error(
                    `Checksum mismatch on variable "${v.id}": stored="${storedVarChecksum}", computed="${v.checksum}"`
                )
            }
        }
    }

    // Verify premise checksums
    for (const pe of engine.listPremises()) {
        const inputPremise = premises.find((p) => p.id === pe.getId())
        if (inputPremise) {
            const sp = inputPremise as Record<string, unknown>
            for (const field of checksumFields) {
                const stored = sp[field]
                const computed = pe[field]()
                if (!storedChecksumAgrees(stored, computed)) {
                    throw new Error(
                        `Checksum mismatch on premise "${pe.getId()}" field "${field}": stored="${String(stored)}", computed="${String(computed)}"`
                    )
                }
            }
        }
    }

    // Verify argument checksums
    const sa = argument as Record<string, unknown>
    for (const field of checksumFields) {
        const stored = sa[field]
        const computed = engine[field]()
        if (!storedChecksumAgrees(stored, computed)) {
            throw new Error(
                `Checksum mismatch on argument "${engine.getArgument().id}" field "${field}": stored="${String(stored)}", computed="${String(computed)}"`
            )
        }
    }
}
