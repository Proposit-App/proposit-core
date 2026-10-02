# Upcoming

## Breaking

- The variable union `TCorePropositionalVariable` has a third member,
  `TExpressionBoundVariable` (`boundExpressionId`, `boundArgumentId`,
  `boundArgumentVersion`, `boundAspect: "statement" | "inference"`), told apart
  by the new guard `isExpressionBound`. Code that assumed a variable that is not
  claim-bound must be premise-bound is no longer exhaustive.
- An argument carrying `respondsTo` is a response and has no conclusion:
  `createPremise` and `createPremiseWithId` make no premise the conclusion,
  `removePremise` promotes none, `setConclusionPremise` throws, and
  `clearConclusionPremise` clears a conclusion a response was stored with
  (reported by E-8) even when premises exist. `evaluate`
  and `checkValidity` on a response return `ok: false` with the new code
  `ARGUMENT_IS_RESPONSE`. `listSupportingPremises` on a response returns every
  premise that is not a link.
- Rule S-3 now asks for exactly one of a claim, a premise or an expression
  reference; its message for a variable with none changed wording.
- `setExtras` throws when given `respondsTo`, and keeps the argument's
  `respondsTo`; `getExtras` leaves it out.
- `respondsTo` (argument fields) and `boundExpressionId` and `boundAspect`
  (variable fields) are hashed under every checksum configuration, including a
  configuration stored in an older snapshot, through the new
  `resolveChecksumFields`. They are hashed only when present, so no existing
  checksum changes.

## Added

- Response arguments: `respondsTo: { argumentId, argumentVersion }` on the
  argument entity (`TCoreArgumentReference`), owned by the engine;
  `ArgumentEngine.isResponse()` and `getRespondsTo()`.
- `ArgumentEngine.bindVariableToExpression`, which binds a response's variable
  to one expression of the argument it answers, in its statement or inference
  aspect, and returns the existing variable for a binding with the same
  referent.
- Links: a response premise whose whole content is `x` or `NOT(x)` for an
  expression-bound `x`, read as contradict, affirm, undercut or reinforce.
  `listLinks`, `validateLinks` (codes `LINK_EXPRESSION_MISSING`,
  `LINK_INFERENCE_ON_NON_OPERATOR`, `LINK_VERSION_MISMATCH`, and the informational `LINK_SAME_CLAIM`; it throws
  for a snapshot of another argument or version) and `elementsWithinPremise`.
  The checks below report a wrong snapshot as `invalid` with
  `LINK_TARGET_MISMATCH`.
- `ArgumentEngine.checkLink` and `checkResponseCoherent`, which search a
  premise set built from the response with each statement link expanded into
  the expression it names and claims merged into one column per claim.
  `checkLink` answers `follows` (with a minimal support set and
  `restsOnlyOnLinks`), `asserted` (with `attemptedSupport` and a
  counterexample), `incoherent`, `undetermined` or `invalid`.
- `classifyBindings`, `structuralFingerprint`, `positionClassOf` and
  `ArgumentEngine.rebaseResponse`, which move a response to another version of
  the argument it answers. Each binding is `unchanged`, `changed` (`content`,
  `position`, `outsideReferenceRepinned`), `removed` or `alreadyRebased`;
  `outsideSnapshots` lets references re-pinned to other versions of a third
  argument be compared rather than reported. `positionClassOf` and
  `linkTargetsElement` look through formula nodes at a premise's root.
- A response's claim-bound variables may use any claim, including claims the
  argument it answers uses; the checks read a shared claim as one proposition,
  and rebasing leaves claim-bound variables alone. Only links answer the
  target.
- `TLinkReference` and `linkTargetsElement`.
- Grammar rules S-15 (a response answering itself, or an expression-bound
  variable outside a response or bound into another argument), E-8 (a response
  with a conclusion), E-9 (two variables binding the same expression in the same
  aspect) and E-10 (a binding on another version of the argument answered).
  Invariant codes `ARG_RESPONDS_TO_ITSELF`,
  `ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE` and `VAR_BINDING_AMBIGUOUS`.
- `conclusionInferenceRejected: true` on the evaluation result when the reader
  rejects the conclusion premise's root operator. Nothing is struck and no other
  result field changes.
- `findSatisfyingAssignment`, which answers the premise-set satisfiability
  search with a satisfying assignment; `isPremiseSetSatisfiable` wraps it.
- `defaultCompareArgument` reports a change of `respondsTo`, and
  `defaultCompareVariable` compares `boundExpressionId` and `boundAspect`.
- `toDisplayString` on a response names the argument and version it answers.

## Changed

- The satisfiability walk stops evaluating a row at its first false premise.
  Answers and witnesses are unchanged; a search with no satisfying row is
  several times faster.

## Fixed

- Strict checksum verification threw on an argument or premise with nothing
  beneath it, whose stored `descendantChecksum` is `null`. Pinned by
  `test/core/hierarchical-checksums.test.ts`.
- A stored variable carrying two kinds of reference (for example both a claim
  and a premise) failed to load with `Variable symbol "…" already exists.`
  It now fails naming the problem, `VAR_BINDING_AMBIGUOUS`. Pinned by
  `test/core/response-links.test.ts`.

- `strictUnknownAssignmentKeys: true` rejected every assignment that gave
  values to variables in two different premises, because each premise was
  checked against its own variables. A key is now unknown only when no
  evaluated premise names it, and the refusal uses the code
  `ASSIGNMENT_UNKNOWN_VARIABLE` (it was `ASSIGNMENT_MISSING_VARIABLE`). Pinned
  by `test/evaluation/strict-unknown-keys.test.ts`.

## Tests

- Every checksum is pinned to values captured from the published 5.4.2 (and,
  for forking an argument with an external binding, 5.4.3) under the default, a
  consumer-extended and a partial configuration, across snapshot and data
  round trips, rollbacks, strict reloads, `setExtras` and forking
  (`test/core/checksum-stability.test.ts`, built by
  `scripts/checksum-fixtures/`).
