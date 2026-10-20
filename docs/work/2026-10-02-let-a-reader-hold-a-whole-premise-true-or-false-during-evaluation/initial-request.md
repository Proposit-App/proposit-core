# Let a reader hold a whole premise true or false during evaluation

## Request

Add an evaluation input, `heldPremises: Record<premiseId, boolean>`, by which a reader says a whole premise is true or false, so that agreeing with a response's link can carry what the carrying item reports as `notExpressible`. Examples are contradicting a conjunction (`Q ∧ R`), affirming a conditional or a disjunction, and a link on a variable bound to such a premise.

The maintainer decided on 2026-10-02 that this is not part of 6.0.0. It can ship later as an additive release: a new optional input changes nothing for existing callers.

## Background

The carrying item (`2026-10-02-carry-a-reader-s-agreement-with-a-response-argument-into-the-argument-it-answers`) carries only what reduces exactly to variable values and operator decisions. Its spec, "Why no held statements", records why holds were deferred. Its first draft specified held premises, and the adversarial review of that draft found two defects. Both are fixable, and the fixes below are the starting design.

### Defect 1: a held conclusion leaks into `reachedWithoutAssertion`

The draft joined a held value into the premise's computed root value. `evaluateArgument` runs the reached-without-assertion counterfactual only when the conclusion names claim variables directly (`src/lib/core/evaluation/argument-evaluation.ts`, the `conclusionClaimVariableIds` list). Otherwise it reads `reachedWithoutAssertion` straight from `conclusionTrue`, which would then include the hold. So a conclusion that is only premise-bound, or whose claims are all axiomatic, and that the reader holds true, would report `assertedByReader: true` together with `reachedWithoutAssertion: true`. That is the same trap the guide records for `forcedTrueVariableIds`.

**Fix:** whenever any hold is present, compute `reachedWithoutAssertion` from an evaluation without holds, never from `conclusionTrue`. Pin it with a conclusion that is purely premise-bound, and with one whose claims are all axiomatic.

### Defect 2: the hold lived inside a public interface

The draft applied the join in `evaluatePremise`, reached through `TEvaluablePremise.evaluate`. `TEvaluablePremise` and `evaluateArgument` are public, so a consumer's own premise implementation would silently ignore holds. The draft also put `heldPremises` on `TCoreExpressionAssignment`, while premises receive a `TCoreResolvedAssignment` that `evaluateArgument` rebuilds from variables and operator decisions only.

**Fix:** apply the hold in core-owned code outside the premise implementation:
- in `evaluateArgument`, after each premise is evaluated;
- in the premise-bound resolver (`src/lib/core/evaluation/premise-resolver.ts`), where a bound premise's root value is read.

`evaluateArgument` also owns striking, so it can decide that a struck premise's hold is ignored. The spec must say what a variable bound to a struck, held premise reads.

## Other points the review raised, to settle in the spec

- **Where a contested hold is reported.** Propose a new optional `contestedPremiseIds`, present only when holds are supplied, for premises whose hold disagrees with their computed value.
- **Propagation and satisfiability never see a hold.** A premise root is no accepted operator's child, so propagation does not read it, and the satisfiability search builds its own assignment. State this as the rule: a hold contributes its value, not its consequences.
- **Echoed values.** Decide whether the echoed `assignment` result field includes `heldPremises`, and which root value the inference diagnostic carries: the computed one or the held one.
- **Strict mode.** Under `strictUnknownAssignmentKeys`, a held id that names no evaluated premise is an error at the argument level. This includes unpopulated naked-Q derivation stubs, which evaluation hides.
- **`evaluateWithDefaults`** needs a way to pass holds.
- **Carrying.** Two kinds of link would carry as holds:
  - a statement link whose expression, read through formula nodes or through an internally premise-bound variable, is a premise's root;
  - a link that does not form a cube.

  Add the reason the carrying spec gives for each `notExpressible` case it replaces.
- **Overlap.** If holds on nested expressions are ever wanted, they would overlap a premise hold at premise roots. Decide now whether premise holds are the final form.
