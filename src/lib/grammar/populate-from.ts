// C6: populateFromCitations / populateFromAxioms factory pattern.
//
// Per briefing §7 (post-handoff refinement, 2026-05-14):
//   - Each method is a factory operating on naked-Q derivation premises.
//   - For 0 connections: no-op (naked-Q stays).
//   - For 1 connection: IMPLIES(supporting-var, Q).
//   - For ≥2 connections: IMPLIES(OR(s1, …, sn), Q). In assistive mode
//     the engine's per-mutation AN-1 post-hook inserts a formula buffer
//     between IMPLIES and OR; in permissive mode the OR sits directly
//     under IMPLIES (Structural-valid, but a P-1 violation surfaces via
//     validate('presentable')).
//   - If the target derivation premise is already populated (non-naked-Q),
//     factory returns kind='no-op' without mutating — preserves Proposit's
//     no-changes-without-consent principle AND the Structural-only
//     mutation throw rule. UI/caller is responsible for clearing the
//     antecedent (via a repair primitive) before re-calling.
//   - If no derivation premise exists for derivedClaimId: throws (entity-
//     not-found is a legitimate Structural integrity check).
//
// **Atomicity contract.** The factory is observed-atomic: callers
// never see a half-populated tree. The expression-tree replacement
// proceeds as `removeExpression(nakedRoot)` followed by sequential
// `addExpression` calls for the populated IMPLIES/OR/var skeleton. All
// mutations are bundled inside a single synchronous call frame; no
// reactive listener fires between them on the post-mutation state, and
// no other engine method runs concurrently (JS is single-threaded).
// External observers only ever see the pre-call naked-Q state or the
// fully populated post-call state. The intermediate "tree empty" /
// "tree partially built" states exist transiently in memory but are
// never observable from outside `populateFromGrounding`'s call frame.
//
// Return shape:
//   { kind: 'populated' | 'no-op',
//     state: TCoreDerivationPremise,
//     resolved?: readonly TViolation[] }

import type { ArgumentEngine } from "../core/argument-engine.js"
import type { PremiseEngine } from "../core/premise-engine.js"
import type { TClaimConnectionLookup } from "../core/interfaces/library.interfaces.js"
import type { TCoreClaimConnection } from "../schemata/claim-connection.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCoreDerivationPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
    TClaimBoundVariable,
} from "../schemata/index.js"
import { isNakedQTree } from "./naked-q.js"
import type { TViolation } from "./types.js"

/**
 * Result returned by a `populateFrom*` factory. `kind === 'populated'`
 * means the factory built a new antecedent; `kind === 'no-op'` means
 * the factory did not act (either zero connections, or the target
 * premise was already populated).
 */
export type TPopulateResult<
    TDerivationPremise extends TCoreDerivationPremise = TCoreDerivationPremise,
> = {
    kind: "populated" | "no-op"
    state: TDerivationPremise
    resolved?: readonly TViolation[]
}

/**
 * Run the factory for one grounding kind. Shared by
 * `populateFromCitations` / `populateFromAxioms` — the only difference
 * between them is which lookup is queried.
 *
 * @since 1.0.0
 */
export function populateFromGrounding<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    derivedClaimId: string,
    lookup: TClaimConnectionLookup<TConn>
): TPopulateResult {
    const pe = findDerivationPremiseForClaim(engine, derivedClaimId)
    if (pe === undefined) {
        throw new Error(
            `populateFrom: no derivation premise found for derivedClaimId "${derivedClaimId}".`
        )
    }

    // Naked-Q precondition: the premise's expression tree must be a
    // single variable expression at the root. Any other shape (already
    // populated, or some other malformed state) → no-op + return the
    // existing premise data. The premise's `type === 'derivation'` is
    // already guaranteed by `findDerivationPremiseForClaim`, so the
    // tree-shape-only `isNakedQTree` is the correct predicate here.
    if (!isNakedQTree(pe)) {
        return {
            kind: "no-op",
            state: pe.toPremiseData() as unknown as TCoreDerivationPremise,
        }
    }

    // Collect unique supporting claim ids in source order. Connection
    // duplicates (same supportingClaimId appearing twice) collapse to
    // one OR child each.
    const connections = lookup.getConnectionsForClaim(derivedClaimId)
    const seen = new Set<string>()
    const supportingIds: string[] = []
    for (const c of connections) {
        if (seen.has(c.supportingClaimId)) continue
        seen.add(c.supportingClaimId)
        supportingIds.push(c.supportingClaimId)
    }

    if (supportingIds.length === 0) {
        // No supports → nothing to build. Naked-Q stays.
        return {
            kind: "no-op",
            state: pe.toPremiseData() as unknown as TCoreDerivationPremise,
        }
    }

    // Materialize claim-bound variables for each supporting claim. The
    // engine's `ensureClaimBoundVariable` is idempotent and resolves the
    // current claim version from the claim library; if any of these
    // throws CLAIM_NOT_FOUND, propagate (the caller passed a stale
    // lookup pointing at claims that aren't in the engine's library).
    const supportingVars: TClaimBoundVariable[] = supportingIds.map((id) =>
        engine.ensureClaimBoundVariable(id)
    )

    // Capture the current Q-root expression id so we can replace it
    // atomically. After this point, mutations on `pe` rebuild the tree.
    // From this point onward up to the final addExpression call, the
    // tree passes through transient empty / partial states; per the
    // atomicity comment at the top of this file those states are not
    // externally observable.
    const nakedRoot = pe.getRootExpression()!
    const qVariableId = (nakedRoot as { variableId: string }).variableId
    const argId = engine.getArgument().id
    const argVersion = engine.getArgument().version
    const premiseId = pe.getId()
    const gen = engine.idGenerator

    // Step 1: remove the naked-Q root (cascades nothing — it's a leaf).
    pe.removeExpression(nakedRoot.id, true)

    // Step 2: add IMPLIES at root.
    const impliesId = gen()
    pe.addExpression({
        id: impliesId,
        argumentId: argId,
        argumentVersion: argVersion,
        premiseId,
        type: "operator",
        operator: "implies",
        parentId: null,
        position: 0,
    } as unknown as Parameters<typeof pe.addExpression>[0])

    // Step 3: add the antecedent (position 0) — either a single variable
    // (n=1) or an OR with one child per supporting variable (n≥2).
    // AN-1 inserts a formula buffer between IMPLIES and OR in assistive
    // mode at the moment we add the OR; permissive mode skips the buffer.
    // The OR's variable children attach to the OR by its `orId`
    // regardless of whether AN-1 reparented the OR under a formula buffer
    // (the OR's own id is stable across the post-hook).
    if (supportingVars.length === 1) {
        const sv = supportingVars[0]
        const varExprId = gen()
        pe.addExpression({
            id: varExprId,
            argumentId: argId,
            argumentVersion: argVersion,
            premiseId,
            type: "variable",
            variableId: sv.id,
            parentId: impliesId,
            position: 0,
        } as unknown as Parameters<typeof pe.addExpression>[0])
    } else {
        const orId = gen()
        pe.addExpression({
            id: orId,
            argumentId: argId,
            argumentVersion: argVersion,
            premiseId,
            type: "operator",
            operator: "or",
            parentId: impliesId,
            position: 0,
        } as unknown as Parameters<typeof pe.addExpression>[0])

        for (let i = 0; i < supportingVars.length; i++) {
            const sv = supportingVars[i]
            const varExprId = gen()
            pe.addExpression({
                id: varExprId,
                argumentId: argId,
                argumentVersion: argVersion,
                premiseId,
                type: "variable",
                variableId: sv.id,
                parentId: orId,
                position: i,
            } as unknown as Parameters<typeof pe.addExpression>[0])
        }
    }

    // Step 4: add the Q consequent (position 1 of IMPLIES).
    const qExprId = gen()
    pe.addExpression({
        id: qExprId,
        argumentId: argId,
        argumentVersion: argVersion,
        premiseId,
        type: "variable",
        variableId: qVariableId,
        parentId: impliesId,
        position: 1,
    } as unknown as Parameters<typeof pe.addExpression>[0])

    return {
        kind: "populated",
        state: pe.toPremiseData() as unknown as TCoreDerivationPremise,
    }
}

/**
 * Find the (sole) derivation premise in the engine whose
 * `derivedClaimId` matches. Returns `undefined` if none exist. If
 * multiple exist (an E-6 violation), returns the first — the caller's
 * naked-Q check then determines whether the factory acts. (E-6 is
 * resolved separately via `removeDuplicateDerivationPremises`.)
 */
function findDerivationPremiseForClaim<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    derivedClaimId: string
): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined {
    for (const pe of engine.listPremises()) {
        const data = pe.toPremiseData() as unknown as TCorePremise
        if (data.type !== "derivation") continue
        if (
            (data as unknown as TCoreDerivationPremise).derivedClaimId ===
            derivedClaimId
        ) {
            return pe
        }
    }
    return undefined
}
