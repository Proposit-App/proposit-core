# Spec: carry a reader's agreement with a response argument into the argument it answers

Line numbers are against `e10555ab`, on `feat/response-arguments`, where response arguments are implemented. "The intake" is the first item's `intake.md`, section C5. "The first spec" is that item's `spec.md`. "The first review" is the adversarial review of the first spec, whose findings on carrying moved here: blocking 1 and 2, and significant 2 and 3. `## Notes` says how each is handled. Every departure from the intake is marked **Departure**, with its reason.

## Capability changes

The capability ledger is empty (`tcw capabilities list` prints nothing), so no ledger record changes. At implementation time the taxonomy gains:

- **Vocabulary:**
  - **carried value**: a value one argument's agreed link puts into the input for the argument it answers;
  - **held premise**: a reader's input saying a whole premise is true or false.
- **Features:**
  - **answer carrying** (`carryAnswers`, `mergeCarriedInput`).
- **Changed features:** `argument-evaluation` gains `heldPremises`.

## Problem

Responses can answer arguments (first item), but a reader's verdict on a response stops at the response. Suppose a reader agrees with Y's link "C is false", and Y answers X, whose conclusion is C. When the reader then evaluates X, nothing they agreed to in Y reaches X. They must re-enter it by hand, and the record of where the value came from is lost.

Three things in today's evaluation make carrying harder than copying values:

- **Evaluation inputs exist only for variables and operators.** `TCoreExpressionAssignment` has `variables` and `operatorAssignments` (`src/lib/types/evaluation.ts:51-56`). A link may target a compound expression, such as "`Q ∧ R` is false", or a whole premise, and no input can say that.
- **Propagation keeps values on variables only.** `closeUnderAcceptedOperators` (`src/lib/core/evaluation/propagation.ts:78-468`) stores one value per variable (`:86`). `mergeIntoChild` writes only into a leaf variable and does nothing for an operator child (`:234-241`). Holding a compound expression's value therefore has nowhere to go.
- **Attribution decides what the reader asserted from `assignment.variables` alone** (`argument-evaluation.ts:425-427`). It withholds only the conclusion's claim variables in its counterfactual (`:448-471`). A carried value kept anywhere else would let `reachedWithoutAssertion` report a conclusion reached on its own merits using a value the reader supplied. That is the trap the guide records for `forcedTrueVariableIds`.

## Goals

1. **Carry one step.** Given a response, the snapshot of the argument it answers, and the reader's answers on the response's links, produce the input those answers imply for the argument answered. A path is carried by applying this one step at a time.
2. **Carry only what is exact.** Every carried value means exactly what the agreed link says, read the way `checkLink` reads it, so a check and a carry never give one link two meanings. What cannot be carried exactly is reported, with its reason, and never approximated.
3. **Carried values are the reader's assertions.** They enter evaluation as the reader's own input, so attribution counts them as asserted.
4. **Provenance.** Every carried value names every link it came from.
5. **No silent resolution.** A carried value that disagrees with another carried value, or with what the reader already holds, is reported. A carried value that disagrees with what the argument's accepted steps derive surfaces as `CONTESTED`, as it does today.
6. **Hold a whole premise.** A reader can say a premise is true or false, so that contradicting or affirming a premise whose content does not break down into variable values can still carry.
7. **Nothing existing changes.** No evaluation result field changes value for any input expressible today, and no checksum changes.

## Non-goals

- **Holding an arbitrary nested expression.** Only whole premises can be held (Goal 6). A nested compound that does not break down into variable values is reported as not carried. See Design, "Why not held statements".
- **Evaluating a response under a reader's input.** Carrying into a response needs only its links' answers (Design, "Carrying into a response"), so a response is still refused by `evaluate` (`ARGUMENT_IS_RESPONSE`).
- **Automatic scoring** of a web of answers, or deciding which answers a reader "should" hold.
- **Who answered, storage, display.** Answers arrive as plain records; core does not know whose they are.
- **A claim-level contested roll-up.** Setting one claim on every variable bound to it can leave those variables contested differently. Reporting the claim as contested is the backlog item `2026-08-14-decide-whether-an-argument-asserting-one-claim-both-ways-is-a-validation-error`, and stays there.
- **The CLI.** It stores no responses (first spec, Non-goals).

## Design

### Words

- **Answers on a response**: `linkAnswers: Record<premiseId, "agree" | "disagree">`. A link with no entry is unanswered.
- **Agreed link**: a link answered `agree`, either by the reader or as derived when carrying into a response (below).
- **Carry target**: the argument the response answers, given as a snapshot at the version `respondsTo` names.

### What an agreed link means

An agreed link asserts its content: affirm `x` asserts the bound expression E is true, contradict `NOT(x)` asserts it is false; reinforce `s` asserts E's step holds, undercut `NOT(s)` that it does not. A disagreed or unanswered link carries nothing.

**Departure from the first spec's draft, now matching the intake:** only agreed links carry, never a link that merely evaluates true. Carrying links that "come out true" was lopsided. An affirm link can become true by propagation, but a contradict link never does, because propagation does not merge into a `not` child (`propagation.ts:180-193`). That was the first review's significant finding 2.

### Statement links: exact decomposition

A statement link asserts "E has value v". It is read as `checkLink` reads it: E is expanded as the checks expand a statement link (`buildCombinedSet`, `src/lib/core/response/combined-premise-set.ts:101`, its target expansion at `:156`). Claim-bound variables become one column per claim. Internally premise-bound variables expand into their bound premise's formula. Externally premise-bound variables, and expression-bound variables when the target is itself a response, become one column each.

Over those columns, the rows where E has value v either:

- **form a cube**, meaning E = v exactly when each of some columns has one fixed value and every other column is free. For example, affirm `Q ∧ R` means Q true and R true. Contradict `Q ∨ R` means Q false and R false. Contradict `P → Q` means P true and Q false. Any link on a single claim is a cube. Then the link **carries those fixed values and nothing else**:
  - a claim column carries its value onto **every** variable of the target bound to that claim (`getVariableIdsForClaim`, `argument-engine.ts:3175`);
  - an externally premise-bound column carries onto that variable;
  - an expression-bound column (target is a response) carries as described in "Carrying into a response";
  - a fixed column whose claim is axiomatic: a value of `true` is dropped, since it is already true. A value of `false` means the link contradicts an axiom, and **the whole link** is not carried (reason `axiom`). Rule E-4 forbids assigning one, and the engine throws `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
  - a fixed column whose claim is a citation carries normally: a reader may disagree with a source.
- **do not form a cube**, as with contradict `Q ∧ R`. If E is the root of a premise of the target, the link carries as a **held premise** with value v (below). Otherwise it is not carried (reason `notExpressible`).
- **are none**, meaning E can never have value v. Not carried (reason `impossible`).
- **are all rows**, meaning E has value v whatever the columns are. Nothing to carry (reason `vacuous`).

If E's expansion has more columns than `SATISFIABILITY_VARIABLE_CEILING` (`src/lib/core/evaluation/satisfiability.ts:17`), the link is not carried (reason `tooLarge`).

Because the decomposition is exact, carrying never approximates, and the check and the carry give the link one meaning. That is the first review's blocking finding 1, "two meanings".

### Held premises

A new optional evaluation input, beside `variables` and `operatorAssignments`:

- `heldPremises?: Record<premiseId, boolean>`, on `TCoreExpressionAssignment` (`src/lib/types/evaluation.ts:51`).
- **Where it applies:**
  - **Premise evaluation.** `evaluatePremise` (`src/lib/core/premise/evaluation.ts:33`) joins the held value into the premise's root value in the knowledge order: `join(computed, held)`, the same join propagation uses (`joinKnowledge`, `belnap.ts`). It records the joined value as the root's entry in `expressionValues`. A held `false` on a premise that evaluates `true` comes out `CONTESTED`.
  - **Bindings to the premise.** The premise-bound resolver evaluates a bound premise through the same function (`premise-resolver.ts`), so a variable bound to a held premise reads the joined value. One function applies it, so the premise result and every reader of it agree.
- **Where it does not apply:**
  - **Propagation.** Propagation reads compound values only for children of accepted operators (`resolveValue`, `propagation.ts:117`), and a premise root is no operator's child. So the closure never sees a held value, and its monotonicity and order-independence are untouched. A held premise contributes its value, not its consequences. A reader who wants the consequences accepts the premise's operators.
  - **Satisfiability and derivation suppression.** The satisfiability search builds its own assignment (`walkGroup`, `satisfiability.ts`), so held premises are excluded there automatically. A premise the reader holds false makes the argument unsound for that reader, not self-contradictory. This is intake criterion 6.
  - **`evaluateSubtree`** (`argument-evaluation.ts:131`), the standalone subtree evaluator, takes no held input. It evaluates subtrees, not premises.
- **Results:**
  - Each premise result's `rootValue` is the joined value, and the aggregates follow from it as today.
  - **New optional field** `contestedPremiseIds: string[]`: premises whose held value disagrees with their computed value. It is present only when `heldPremises` is supplied, so no existing result changes.
- **Attribution:**
  - The counterfactual for `reachedWithoutAssertion` evaluates the conclusion under an assignment built from `variables` and `operatorAssignments` alone (`argument-evaluation.ts:462-469`). It therefore withholds every held premise, including any reached through a premise-bound variable. This is stated as a rule and pinned by a test.
  - `assertedByReader` becomes true also when the conclusion premise, or a premise the conclusion reaches through bound variables, is held.
  - `claimAttribution` is unchanged, because held premises never enter the closure.
- **Strictness and refusals:**
  - Under `strictUnknownAssignmentKeys`, a held premise id the argument does not have is an error, as an unknown variable id is today.
  - A struck premise is struck whether or not it is held. Striking discards a premise whole (`docs/api-reference.md:308`). The held value is ignored and `contestedPremiseIds` does not list it.
  - Holding a derivation premise is allowed and evaluated like any other.

### Why not held statements on any expression

The intake asked for `heldStatements: Record<expressionId, boolean>` on any expression. Holding a nested expression has to join into every evaluator that computes a value, and propagation is one of them. Otherwise propagation and premise evaluation disagree about a value, and propagation keeps no per-expression state (first review, blocking 1). Joining it into propagation's `resolveValue` would also mean defining a contested compound's provenance, and which counterfactual withholds it, for every expression.

Most links do not need it. A link on a single claim, an affirmed conjunction, and a contradicted disjunction or conditional all decompose exactly. A link on a whole premise is covered by held premises. What remains is a nested compound that does not decompose, such as contradicting the `Q ∧ R` inside `(Q ∧ R) → C`. That is reported as `notExpressible`.

**Departure:** held statements on arbitrary expressions are replaced by exact decomposition plus held premises. A later item can add nested holds if consumers need them, on top of this design.

### Inference links

An agreed inference link carries an operator decision: reinforce → `accepted`, undercut → `rejected`. The intake's table, unchanged:

| The bound operator | Carried |
|---|---|
| root of a freeform premise that is not the conclusion | the decision; a rejection strikes the premise, as today (`argument-evaluation.ts:276-295`) |
| root of the conclusion premise | the decision; a rejection sets `conclusionInferenceRejected` |
| nested in any premise | nothing (reason `nestedOperator`) |
| in a derivation premise | nothing (reason `derivationOperator`) |

### Carrying into a response

When the carry target is itself a response (Z answers Y, which answers X), the carried result for Y includes **derived answers on Y's links**. These are what the reader's agreement with Z implies about Y's links. This answers the intake's Q3:

- Every link L of Y is `x` or `NOT(x)` for one of Y's expression-bound variables `x`, and the expansion keeps `x` as one column (`combined-premise-set.ts:156`). So whenever a statement link of Z decomposes to a fixed value of `x`, that value answers every link of Y on `x`:
  - `x` true: each affirm or reinforce link `x` is agreed, each contradict or undercut link `NOT(x)` disagreed;
  - `x` false: the reverse.
- This covers both places Z can point. A statement on L's root `NOT(x)` with value v fixes `x` to not v. A statement on the `x` inside it fixes `x` directly. A statement on a non-link premise of Y that decomposes to a value of `x` answers L too, since that premise says the same about `x`.
- An inference link of Z on L's `NOT` is not carried (reason `linkStep`). A link has no step to dispute.
- So agreeing with Z's affirm of Y's link counts as agreeing with that link, and agreeing with Z's contradiction of it counts as disagreeing. If carried values of one `x` disagree, the `x` is a conflict (Collisions) and no derived answer is given on its links.
- Values Z carries onto Y's claims and operators are returned as for any target, but Y is never evaluated, so they reach X only through the link answers they fix. Whether L follows from Y's other premises is `checkLink`'s question; agreeing with L is the reader's.

The reader's own answers on Y and the derived ones are combined by `mergeCarriedInput` (below), which reports any conflict. The combined answers are then carried from Y into X. One step at a time, as the intake says.

### Collisions

- **Among the carried values themselves.** Two agreed links of one response may fix one claim to opposite values, or decide one operator both ways. Each such value is reported as a conflict, naming every link involved, and is not carried. This happens only in a response `checkResponseCoherent` calls incoherent (first item), and carrying does not require the response to be coherent.
- **With the reader's own input.** `mergeCarriedInput` keeps the reader's own value and reports the carried one beside it. A collision is reported and never resolved in the carried value's favour.
- **With the argument.** A carried value that the target's accepted steps contradict comes out `CONTESTED` through propagation (`propagation.ts:57-60`), and is reported in `contestedVariableIds` as today. A held premise that disagrees with its computed value is in `contestedPremiseIds`.

### Interface

- `carryAnswers(response, targetSnapshot, linkAnswers): TCarryResult`, in `src/lib/core/response/carry.ts`.
  - **Refuses with `status: "invalid"`** when the snapshot is not the argument and version `respondsTo` names, or `validateLinks` reports an error. This is the same precondition the checks use, so nothing is carried onto expression ids of the wrong version (first review, significant 3).
  - **Otherwise** `status: "carried"`, with:
    - `into: TCoreArgumentReference`;
    - `variables: Record<variableId, boolean>`;
    - `operatorAssignments: Record<expressionId, "accepted" | "rejected">`;
    - `heldPremises: Record<premiseId, boolean>`;
    - `linkAnswers?: Record<premiseId, "agree" | "disagree">`, present only when the target is a response;
    - `sources`: one entry per carried value, giving its kind (`variable`, `operator`, `heldPremise`, `linkAnswer`), its id and value, and the premise ids of every link it came from;
    - `notCarried`: one entry per agreed link, or per part of one, that carried nothing. Each gives its premise id and reason: `axiom`, `notExpressible`, `impossible`, `vacuous`, `tooLarge`, `nestedOperator`, `derivationOperator`, `linkStep` or `conflict`.
    - It never throws on an answer it cannot carry.
- `mergeCarriedInput(own, carried)`:
  - `own` is the reader's input for the target: an assignment, plus `linkAnswers` when the target is a response.
  - It returns the combined input and a list of collisions. Each collision gives the kind, id, the reader's value, the carried value, and the carried value's source links.
  - The reader's value is kept on every collision.
  - The combined input never contains `CONTESTED`, which a reader may not assign.
- **Exports:** both functions, and their types (`TLinkAnswer`, `TCarryResult`, `TCarriedSource`, `TNotCarriedReason`, `TCarryCollision`).

### Attribution of carried values

Carried variable values and operator decisions enter `variables` and `operatorAssignments` through `mergeCarriedInput`. Evaluation therefore treats them exactly as the reader's own:

- `isReaderAsserted` counts them;
- every counterfactual withholds them;
- `assertedByReader` and `claimAttribution` include them.

This is deliberate. A reader who agrees with a link has asserted what it says, so a conclusion reached through a carried value is not reached without the reader's assertion. Which link a value came from lives in `sources`, not in evaluation. This answers the first review's blocking finding 2.

## Acceptance criteria

Test files are new unless stated. `X`, `Y`, `Z` follow the intake's notation, with Y answering X and Z answering Y.

1. **Decomposition** (`test/core/response-carry.test.ts`), for an agreed link of Y on an expression of X:
   - contradict on claim C's variable expression: `variables` sets every variable of C in X false;
   - affirm `Q ∧ R`: Q and R true;
   - contradict `Q ∨ R`: Q and R false;
   - contradict a premise `P → Q`: P true and Q false;
   - contradict `Q ∧ R` as a premise root: `heldPremises` holds that premise false;
   - contradict `Q ∧ R` nested inside `(Q ∧ R) → C`: not carried, reason `notExpressible`;
   - contradict an axiom-bound claim: not carried, reason `axiom`, and nothing throws;
   - contradict a citation-bound claim: carried.
2. **Inference links** (same file):
   - undercut a freeform premise's root: `rejected`;
   - reinforce: `accepted`;
   - undercut the conclusion root: `rejected`, and evaluating X with the merged input reports `conclusionInferenceRejected`;
   - undercut a nested operator or a derivation premise operator: not carried, with the reason.
3. **Only agreed links carry** (same file): an unanswered link, and a disagreed one, carry nothing. So does an affirm link that would evaluate true by propagation.
4. **Provenance** (same file): two links fixing claim C to the same value give one `sources` entry naming both. Every carried value has a source.
5. **Collisions** (same file):
   - two agreed links fixing C to opposite values: both reported as `conflict`, C not carried;
   - `mergeCarriedInput` with the reader holding C true and C carried false: the result keeps true and reports one collision naming the source link;
   - a carried value contradicted by an accepted step of X: X's evaluation lists the variable in `contestedVariableIds`.
6. **Version guard** (same file): a snapshot of another version, or a response with a `validateLinks` error, gives `status: "invalid"`.
7. **Carrying into a response** (same file):
   - Z affirms Y's contradict link L at L's root: `linkAnswers[L] = "agree"`;
   - Z contradicts it at L's root: `"disagree"`;
   - Z affirms the `x` inside `NOT(x)`: `"disagree"`;
   - Z agrees and disagrees on L through two links: a conflict, and no derived answer for L;
   - carrying Z → Y → X: the reader's agreement with Z's affirm of L makes L carry into X, with `sources` on X's values naming L. The reader's own "disagree" on L wins in `mergeCarriedInput`, with a collision reported.
8. **Held premises** (`test/evaluation/held-premises.test.ts`):
   - holding `A ∧ B` false where X asserts `A ∧ B`: `premiseSetSatisfiable` is unchanged; that premise's `rootValue` is false, or `CONTESTED` with its id in `contestedPremiseIds` when A and B are true;
   - a variable bound to a held premise reads the held value;
   - a held premise inside a struck premise is ignored;
   - an unknown held premise id fails under `strictUnknownAssignmentKeys`;
   - evaluating with `heldPremises` absent gives a result equal, field by field, to today's for the same input. This is checked over the existing evaluation fixtures.
9. **Attribution** (same files):
   - a conclusion `C` reached only through a carried value of C reports `assertedByReader: true` and `reachedWithoutAssertion: false`;
   - a conclusion premise held true reports `assertedByReader: true`, and `reachedWithoutAssertion` is computed with the hold withheld;
   - a plausible wrong implementation, carried values kept outside `variables` and not withheld, is tried and fails this test.
10. **One meaning** (same file as 1): for every link in criterion 1 that carries, the carried values, substituted into the expanded expression, make it evaluate to the link's value, and a carried held premise is that link's own expression. For every link that does not carry, the reason holds.
11. **Public surface:** `docs/api-surface.txt` gains only the names in Interface and `heldPremises`, `contestedPremiseIds`. No name refers to accounts, ownership, storage or user limits. `pnpm run check` passes.

## Risks

- **Decomposition cost.** It walks a truth table over one expression's columns, bounded by the ceiling, once per agreed statement link. This is cheap for the expressions links target. A timing note goes in the outcome.
- **Fewer links carry than the intake imagined.** A nested non-decomposable compound does not carry. It is reported, never dropped silently, and a later item can add nested holds.
- **"Every variable of a claim" can disagree with a single occurrence.** A claim bound by several variables gets the carried value on all of them, as the intake asks. If X's steps contest one of them, that variable alone is contested; the claim-level roll-up is the backlog item named in Non-goals.
- **Held premises add one input to evaluation.** The join runs in one function, and the "absent means unchanged" criterion runs over every existing evaluation fixture.

## Notes

### How the first review's findings that moved here are handled

- **Blocking 1 (held statements on compound expressions not representable):** resolved by not holding nested expressions. Each of its sub-points:
  - Exact decomposition carries what is expressible as variable values.
  - Held premises join only at premise roots, which propagation never reads, in the one function that computes a premise's value, so the resolver and the premise result agree.
  - **"Does a held compound constrain its children":** a decomposable one carries its children's values. A held premise does not, which is stated.
  - **Contested compounds:** reported in `contestedPremiseIds`.
  - **Counterfactual:** withholds every held premise.
  - **Internally premise-bound variables:** they expand into their bound premise's formula, as the checks do, so no hold lands on one.
  - **Axioms:** reported as not carried.
- **Blocking 2 (attribution status of carried values):** carried values are reader assertions, by entering `variables` and `operatorAssignments`. Criterion 9 pins attribution, not only values.
- **Significant 2 (links that come out true, and the affirm/contradict asymmetry):** only agreed links carry.
- **Significant 3 (no version guard):** `carryAnswers` uses the checks' precondition.

### The intake's questions

- **Q3** (carrying an affirm across depth, and Z targeting the inner `x`): answered in "Carrying into a response".
- The intake's criterion 6 (holding `A ∧ B` false leaves `premiseSetSatisfiable` unchanged) is criterion 8 here.
- The intake's criterion 10 is criteria 1, 2 and 7 here, with "a held statement on `Q ∧ R`" read as a held premise when `Q ∧ R` is a premise root, per the Departure above.

### Release

This ships in 6.0.0 with the first item and goes into the 6.0.0 release-candidate tarball. Development tarballs before then do not include it.
