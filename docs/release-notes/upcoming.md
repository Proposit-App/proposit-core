# Upcoming

## Added

### Response arguments

An argument can now answer another one. A **response** carries
`respondsTo: { argumentId, argumentVersion }`, naming the argument it answers
pinned to one version, and it has no conclusion of its own. It answers through
**links**: premises whose whole content is `x` or `NOT(x)`, where `x` is a
variable bound to one expression of the argument answered.

A link can say four things about that expression:

|                                      | Against                 | For               |
| ------------------------------------ | ----------------------- | ----------------- |
| Is the statement true?               | **contradict** `NOT(x)` | **affirm** `x`    |
| Does the step of this operator hold? | **undercut** `NOT(s)`   | **reinforce** `s` |

The undercut is the new capability: it denies that a step follows without
denying either side of it, which a negated `implies` cannot express.

Build one with `bindVariableToExpression`, then read it with `listLinks` and
check its bindings against the answered argument's snapshot with
`validateLinks`.

`checkLink` tells you whether a link follows from the response's other
premises (and which ones it needs), stands as a bare assertion, or cannot be
judged because the response contradicts itself. `checkResponseCoherent` asks
whether the response can hold at all. Both read what each link says by
expanding it into the expression it names, so "contradict `Q ∧ R`" next to
"affirm Q" and "affirm R" is caught.

When the answered argument publishes a new version, the response keeps
answering the old one. To move it, copy it into a new version of your own
(keeping entity ids, as for any version) and call `classifyBindings` to see
which bindings changed, then `rebaseResponse` with a decision for each one that
did. Bindings whose meaning provably did not change need no decision.

A response may reason from the same claims its target uses, and may copy the
target's derivation premises with the same cited sources: a claim is one
proposition wherever it appears. Only links answer the target; everything else
in a response is its reasons.

`linkTargetsElement` tells you whether a stored link reference is about a
given claim or expression.

### Carrying a reader's answers

A reader who agrees with a response's links can now see that agreement in the
argument the response answers. `carryAnswers` on the response turns the
reader's `agree` answers into input for the argument answered, and
`mergeCarriedInput` adds it to the reader's own input, keeping the reader's
value wherever the two differ and listing each difference. Pass the merged
values to `evaluateWithDefaults`, which now also takes operator decisions.

Carrying is exact. A link carries what it says and nothing it does not:
affirming `Q ∧ R` carries Q and R true, but contradicting `Q ∧ R` carries
nothing, because no fixed values say "not both". A link that cannot be carried
is reported with the reason, never approximated and never dropped. Carried
values count as the reader's own assertions in attribution, and each one names
the links it came from. For a chain of answers, carry one step at a time:
carrying into another response gives answers on its links.

### Rejected conclusion step

When a reader rejects the conclusion premise's root operator, the evaluation
result now carries `conclusionInferenceRejected: true`. Nothing else in the
result changes.

### Satisfying assignments

`findSatisfyingAssignment` runs the same search as `isPremiseSetSatisfiable`
and returns an assignment under which every premise holds, when there is one.

## Fixed

- Reloading an argument or premise with nothing beneath it under strict
  checksum verification no longer throws.
- A stored variable with two kinds of reference now fails to load with an
  error that says so, instead of one about a duplicate symbol.

- `strictUnknownAssignmentKeys` now accepts an assignment with values for
  variables in several premises; it rejected nearly every real assignment
  before. Its refusal now has the code `ASSIGNMENT_UNKNOWN_VARIABLE`.
- A variable bound to a premise in another argument no longer draws a warning
  that its premise is empty.

## Migrating

- **The variable union has a third member.** If you switch on
  `isClaimBound` / `isPremiseBound` and treat "neither" as impossible, handle
  `isExpressionBound`. Only a response can hold one.
- **Not every argument has a conclusion.** A response never has one, and
  `evaluate` and `checkValidity` refuse it with `ARGUMENT_IS_RESPONSE`. Code
  that assumes every argument with premises has a conclusion should check
  `isResponse()` first.
- **S-3** reports a variable that does not have exactly one of a claim, a
  premise or an expression reference. If you match its message text, the
  "none" wording changed; match the code instead.
- **`setExtras` refuses `respondsTo`** and keeps the existing one. Set it when
  you construct the engine.
- **New checksum fields.** `respondsTo`, `boundExpressionId` and `boundAspect`
  are hashed under every checksum configuration, including one stored in an
  older snapshot. They are absent from every existing entity, so no stored
  checksum changes.
- **Keep ids stable across versions.** Rebasing a response matches the
  answered argument's expressions by id between its versions. If you copy an
  argument into a new version, keep the ids of everything that persists.
- **Implementing `TArgumentEvaluation` yourself?** It gains `carryAnswers`;
  add it, or extend `ArgumentEngine` instead.
- **A renamed refusal code.** With `strictUnknownAssignmentKeys: true`, an
  assignment naming a variable that no evaluated premise uses is now refused
  with `ASSIGNMENT_UNKNOWN_VARIABLE` instead of `ASSIGNMENT_MISSING_VARIABLE`.
  If you match that code, match the new one.
- **A cross-argument reference.** An expression-bound variable names an
  expression in another argument, as an externally premise-bound variable
  already names a premise there. If your store enforces foreign keys, account
  for it.
