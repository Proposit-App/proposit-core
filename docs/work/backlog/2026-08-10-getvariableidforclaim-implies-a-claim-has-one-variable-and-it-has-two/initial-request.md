# getVariableIdForClaim implies a claim has one variable, and it has two

Escalated from `@proposit/shared` via the workspace root inbox
(`2026-08-08-getvariableidforclaim-returns-one-variable-for-a-claim-that-binds-several`),
adopted here on 2026-08-10. Shared raised it rather than fixing it: it fixed its
own copy of the rule and is flagging the source contract.

## Technical changes

`ArgumentEngine.getVariableIdForClaim(claimId)`
(`src/lib/core/argument-engine.ts:2915`) scans `this.variables` and returns the
**first** claim-bound variable matching `claimId`. Its JSDoc reads "the ID of
the claim-bound variable bound to `claimId`", as though there were one, and
calls itself "the documented seam" for translating between claim-keyed consumer
state and the engine's variable-keyed evaluation surface.

A persisted claim binds more than one: an authored variable plus the
engine-synthesized derivation variable. So the accessor's answer depends on
enumeration order rather than on anything about the claim, and its contract is
under-specified for the ordinary case rather than an edge one.

## Product changes

None directly — **nothing calls it outside core.** Shared, server and mobile
were grepped at escalation time and none uses it; what existed was shared's
*reimplementation* of the same first-wins rule in
`src/engine/review/overlay.ts`, written to match this one.

That copy did produce a user-visible defect: a claim's review chip rendered
`Unknown` while the review header for the same argument read `True`, because the
propagated value had landed on the claim's other variable. Shared resolved it
across the full set in `v0.61.2`. So the cost here is not a live bug but a
documented seam inviting the next consumer to make the same assumption — and a
comment in shared that cited this accessor as the precedent for first-wins.

## Meta changes

Shared offers two shapes and says it is core's call:

1. Add `getVariableIdsForClaim(claimId): string[]` and document the singular one
   as "any one of them", or deprecate it.
2. Keep it singular but say **which** one it is and why that is well-defined.

Option 2 is only honest if the engine actually guarantees an ordering, which
`this.variables.toArray()` does not obviously do; the spec should establish that
before choosing. Either way the JSDoc must stop implying a claim has one
variable, and the `@since` tag means the singular method cannot simply change
its answer — it is public API since 3.1.0.

Not in scope, and named by the escalation as a separate question: two variables
bound to one claim can carry **opposite** settled values in a single evaluation
— modus ponens onto one, modus tollens onto the other — which means an argument
asserts one proposition both true and false. Core cannot see it; they are
independent propositional variables to it. Shared reports such claims via
`TReviewOverlay.conflictedClaimIds` rather than tie-breaking. Whether core wants
a validation rule for that is its own item, and this one should not grow into
it.

Shared's fixtures, if useful:
`src/engine/review/__tests__/inline-overlay.test.ts` —
`buildEngineWithConclusionBoundToTwoVariables`.
