# Upcoming

## Added

### `ArgumentEngine.getVariableIdsForClaim(claimId): string[]`

Every claim-bound variable for `claimId`, in `VariableManager.toArray()` order
(id-sorted), `[]` when none. Pure lookup, no materialization.

A claim binding several variables is not an edge case: `addVariable` performs
no per-claim uniqueness check, and this platform's persisted shape carries two
per claim — an authored variable and a derivation-synthesized one.
`ensureClaimBoundVariable` is idempotent and reuses the first match, so the
engine never creates the second itself, but it does not prevent one either.
Evaluation then reaches and values each independently, so the two can settle
differently — `@proposit/shared` resolves that case to `CONTESTED` on
`TReviewOverlay.claimPropagatedValues`.

## Changed

### `getVariableIdForClaim` documents which variable it returns

Behavior is unchanged — it is now literally `getVariableIdsForClaim(claimId)[0]`,
one first-wins rule written once instead of twice. It is public API since
3.1.0, so its answer could not change.

Its JSDoc (and `docs/api-reference.md`, and the `TArgumentEngine` declaration)
previously said "the claim-bound variable bound to `claimId`", implying a claim
has one, and called itself the documented seam for claim-keyed consumer state —
an invitation to the exact assumption that produced a defect in `@proposit/shared`
(a claim's review chip reading `Unknown` beside a header reading `True`, fixed
there in `v0.61.2` in its own reimplementation of this rule). It now states
that a claim may bind several, that the answer is the lowest-id one, that the
pick is deterministic and snapshot-stable but arbitrary with respect to the
claim, and when to use the plural instead.

`getClaimIdForVariable` — the inverse, well-defined for any number of variables
— is untouched.

### `validateDerivationStructure` accepts any variable bound to the derived claim

`src/lib/utils/derivation-validation.ts` located the consequent variable with
`variables.find(v => isClaimBound(v) && v.claimId === derivedClaimId)` and then
required the premise's consequent expression to name **that** variable. Its
caller, `ArgumentEngine.collectDerivationViolations`, passes every variable in
the argument, id-sorted. So a derivation premise whose consequent named the
higher-id of a two-variable claim drew `DERIVATION_STRUCTURE_INVALID` against a
structurally correct premise — both variables stand for the derived claim, and
which one the premise names is the author's business.

The lookup is now a `Set` of the claim's bound variable ids and both shape
checks (naked-form root, `implies`/`iff` consequent slot) test membership. The
two violation messages were reworded to match; the code is unchanged.

The engine's own construction path was never affected — `createPremise({ type:
"derivation" })` builds the naked-Q root from `ensureClaimBoundVariable`, which
returns the same first match the validator picked — so this fires on premises
built by a consumer or restored from a snapshot.

## Not in scope

Two variables on one claim carrying opposite settled values means an argument
asserts one proposition both ways. Core sees independent propositional
variables and cannot detect it; whether it wants a validation rule for that is
a separate question, deliberately left open here.

## Tests

- `test/default-assignment.test.ts` — `claimId ↔ variableId accessors`: the
  plural accessor over a claim bound to two variables, the empty case, and a
  pin that the singular still answers the lowest-id one.
- `test/core.test.ts` — `validateDerivationStructure`: a naked-form root naming
  the higher-id variable of a two-variable claim validates clean. Red before
  the change (`expected false to be true`).
