# Carry a reader's agreement with a response argument into the argument it answers

## What is wanted

This is the second half of the response-arguments request, split out of `2026-10-02-add-response-arguments-that-answer-a-pinned-version-of-another-argument-through-links`. The request as it arrived is that item's `intake.md`, section C5, "Carrying answers along a path".

A reader who agrees with points a response makes should see that agreement reflected when they evaluate the argument the response answers. The wanted behaviour:

- **Agreeing with a contradicting or affirming link** makes the claim or statement it targets false or true for that reader in the answered argument.
- **Agreeing with an undercutting or reinforcing link** rejects or accepts the step it targets.
- Carrying goes one step at a time along a chain of answers.
- Every carried value records which answer it came from.
- A collision with what the reader already holds is reported, not resolved silently.

The request also asks for a new evaluation input, holding an arbitrary expression (not only a variable) true or false, so that a link answering a compound statement or a premise as a whole can carry.

## Why it is a separate item

The first item's adversarial spec review (2026-10-02) found that this part's evaluation semantics were not settled. These questions belong here:

- **Values on compound expressions.** Propagation stores values per variable only (`src/lib/core/evaluation/propagation.ts`). Premises are evaluated by separate code (`src/lib/core/premise/evaluation.ts`, and `evaluateSubtree` in `argument-evaluation.ts`). "Holding `Q ∧ R` false" therefore has no representation yet. It is also undecided whether it constrains Q and R.
- **Where a contested compound value is reported.** Today contested results and their provenance are keyed by variable.
- **The attribution status of carried values**, both variable values and operator decisions. If carried values are not reader assertions in every counterfactual, `reachedWithoutAssertion` can report a conclusion as reached on its own merits using a value the reader supplied, which is the trap core's guide documents for `forcedTrueVariableIds`.
- **Which links carry.** Only links the reader explicitly agreed with, or any link that comes out true? Affirm and contradict links do not behave symmetrically under propagation.
- **Opposing decisions.** When a carried decision on a step opposes the reader's own, which applies?
- **Internally premise-bound variables** take their value from the resolver, not from the assignment (`premise/evaluation.ts:165-171`), so "holding" one needs its own rule.
- **A carried value meeting an axiom-bound variable**, which may not be assigned.

## Constraints

- No existing evaluation result field changes value for any input expressible today.
- It ships in 6.0.0 with the first item, and goes into the same validation tarball for the requester.
- Any automatic scoring of a whole web of answers stays out of scope.

## Notes

- References: the first item's `intake.md` (C5) and `spec.md`, which carry the original proposal and the first answers to the intake's question Q3.
- The backlog item `2026-08-14-decide-whether-an-argument-asserting-one-claim-both-ways-is-a-validation-error` (a claim-level contested roll-up) is what "a claim, set on every variable bound to it" needs for reporting a claim as contested. Plan it alongside this one.
- The requester has not yet been asked about this split. The maintainer delegated the decision ("use your judgement") on 2026-10-02.
