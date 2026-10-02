# Spec: carry a reader's agreement with a response argument into the argument it answers

Fourth revision. The second revised the first draft after its adversarial review (verdict NOT DONE) and for two maintainer decisions of 2026-10-02: a response may use the target's claims, and an undercut may target any operator at any depth. The third applied a bounded review of the second (verdict NOT DONE): the cube is found over the target expression alone, and a nested reinforce is not carried. The maintainer accepted both choices. The fourth applies a review of the third (verdict NOT DONE): a reinforce of a conclusion whose root is not a conditional is not carried. Line numbers are against `1eac5758` on `feat/response-arguments`, where response arguments are implemented.

Sources referred to:
- **"The intake"**: the first item's `intake.md`, section C5.
- **"The first spec"**: that item's `spec.md`.
- **"The first item's review"**: the adversarial review of the first spec. Its carrying findings moved here.
- **"This review"**: the review of this spec's first draft.
- **"The bounded review"**: the review of the second revision's changes.
- **"The fourth review"**: the review of the third revision's changes.

Every departure from the intake is marked **Departure**. `## Notes` says how each finding was handled, and records the maintainer's answer to the one question asked before planning.

## Capability changes

The capability ledger is empty (`tcw capabilities list` prints nothing), so no ledger record changes. At implementation time the taxonomy gains:

- **Vocabulary:** **carried value**, a value one argument's agreed link puts into the reader's input for the argument it answers.
- **Features:** **answer carrying** (`ArgumentEngine.carryAnswers`, `mergeCarriedInput`).
- **Changed features:** `argument-evaluation`. `evaluateWithDefaults` gains operator decisions.

## Problem

Responses can answer arguments (first item), but a reader's verdict on a response stops at the response. Suppose a reader agrees with Y's link "C is false", and Y answers X, whose conclusion is C. When the reader then evaluates X, nothing they agreed to in Y reaches X. They must re-enter it by hand, and the record of where the value came from is lost.

What makes carrying harder than copying values:

- **Evaluation takes input only for variables and operators** (`TCoreExpressionAssignment`, `src/lib/types/evaluation.ts:51-56`). A link can name a compound expression, such as "`Q ∧ R` is false", and no input can say that.
- **Attribution decides what the reader asserted from `assignment.variables` alone** (`src/lib/core/evaluation/argument-evaluation.ts:455-457`). A carried value kept anywhere else would let `reachedWithoutAssertion` report a conclusion reached on its own merits using a value the reader supplied. The guide records that trap for `forcedTrueVariableIds`.
- **Whether a target's claim is axiomatic needs a claim library.** A snapshot carries no claims (`TArgumentEngineSnapshot`, `src/lib/core/argument-engine.ts:174-185`). Assigning an axiom-bound variable makes `evaluate` throw `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` (`src/lib/core/argument/claim-variables.ts:77-89`).

## Goals

1. **Carry one step.** Given a response, the snapshot of the argument it answers, that argument's claims, and the reader's answers on the response's links, produce the input those answers imply for the argument answered. A path is carried one step at a time.
2. **Carry only what is exact.** A carried value means exactly what the agreed link says about the target expression. The expression is expanded the way the checks expand it, and read with every column free (Design, "Statement links"). What cannot be carried exactly is reported with its reason, never approximated, and never dropped silently. The one coarse reading is a nested undercut, which strikes its whole premise (Design, "Inference links"). It is allowed because a struck premise asserts nothing, so it can never assert more than the link.
3. **Carried values are the reader's assertions.** They enter evaluation as the reader's own input, so attribution counts them.
4. **Provenance.** Every carried value names every link it came from.
5. **No silent resolution.** Disagreements among carried values, or with the reader's own input, are reported. A carried value that the argument's accepted steps contradict comes out `CONTESTED`, as any reader value does today.
6. **Nothing existing changes.** No evaluation result field changes value for any input expressible today, and no checksum changes. This item adds no new evaluation input.

## Non-goals

- **Holding a statement or a premise.** The intake's held statements are not in 6.0.0, by the maintainer's decision (Notes). The reason is under Design, "Why no held statements". Holding a whole premise is the backlog item `2026-10-02-let-a-reader-hold-a-whole-premise-true-or-false-during-evaluation`. Until it ships, a link that does not reduce to fixed variable values is reported as not carried.
- **Evaluating a response under a reader's input.** Carrying into a response needs only its links' answers ("Carrying into a response"), so `evaluate` still refuses a response (`ARGUMENT_IS_RESPONSE`).
- **Automatic scoring** of a web of answers.
- **Who answered, storage, display.** Answers arrive as plain records.
- **A claim-level contested roll-up.** Carrying sets every variable bound to a claim, and those variables can come out contested differently. Reporting the claim as contested is the backlog item `2026-08-14-decide-whether-an-argument-asserting-one-claim-both-ways-is-a-validation-error`. The request asks that it be planned alongside this item. It is weighed under Risks and stays separate: this item makes the case more common but no different in kind.
- **The CLI.** It stores no responses (first spec, Non-goals).

## Design

### Words

- **Answers on a response**: `linkAnswers: Record<premiseId, "agree" | "disagree">`. A link with no entry is unanswered.
- **Agreed link**: a link answered `agree`, either by the reader or as derived when carrying into a response.
- **Target**: the argument the response answers, supplied as a snapshot at the version `respondsTo` names.
- **Premise root**: an expression E is the root of premise P when E, after unwrapping `formula` nodes from P's root, is P's root operator or variable. Formula nodes are transparent everywhere else (`combined-premise-set.ts:173-176`).

### What an agreed link means

An agreed link asserts its content:

- affirm `x` asserts the bound expression E is true;
- contradict `NOT(x)` asserts E is false;
- reinforce `s` asserts E's step holds;
- undercut `NOT(s)` asserts E's step does not hold.

A disagreed or unanswered link carries nothing.

**Only links carry, never a response's reasons.** A response may use the target's own claims as reasons (first item's spec, change of 2026-10-02): `P → NOT(r)` with P the target's claim. Agreeing with the link `NOT(r)` carries "R false"; it does not carry P, even though P is the target's claim. Agreeing with a move is not agreeing with every reason given for it, and a reader who also holds P says so in their own input.

Only agreed links carry, never a link that merely evaluates true. Carrying links that "come out true" was lopsided. An affirm link can become true by propagation, but a contradict link never can, because propagation does not merge into a `not` child (`propagation.ts:180-193`). This matches the intake and answers the first item's review, significant finding 2.

### Statement links: exact decomposition

A statement link asserts "E has value v". E is expanded the way the checks expand the target of a statement link (`buildCombinedSet`, `src/lib/core/response/combined-premise-set.ts:101`; target expansion at `:156`):

- claim-bound variables become one column per claim id;
- internally premise-bound variables expand into their bound premise's formula;
- externally premise-bound variables, and the target's expression-bound variables when the target is itself a response, are one column each.

Over those columns, the rows where E has value v fall into four cases:

- **They form a cube.** E = v exactly when some columns each have one fixed value and every other column is free. Examples:
  - affirm `Q ∧ R`: Q true and R true;
  - contradict `Q ∨ R`: Q false and R false;
  - contradict `P → Q`: P true and Q false;
  - any link on a single claim.

  The link carries those fixed values and nothing else (placement below).
- **They do not form a cube**, as with contradict `Q ∧ R`. Not carried (reason `notExpressible`).
- **There are none**: E can never have value v. Not carried (reason `impossible`).
- **They are all rows**: E has value v whatever the columns. Not carried (reason `vacuous`).

If the expansion has more columns than `SATISFIABILITY_VARIABLE_CEILING` (`src/lib/core/evaluation/satisfiability.ts:17`), the link is not carried (reason `tooLarge`).

**The cube is found over E's expansion alone, with every column free.** Nothing else enters the walk: not the response's premises, not its grounded columns (`forcedTrueColumns`, `combined-premise-set.ts:248-254`), not the target's axioms. The carry asks what the link says about E, not what follows from E together with anything else.

- **Departure from `checkLink`, deliberate.** Since a response may use the target's claims, `buildCombinedSet` holds the response's grounded columns true, and those can include columns shared with E. `checkLink` then reads E with those columns fixed. The carry does not: a column the response grounds stays free in the cube walk. Otherwise a link would carry a meaning that depends on the response's own reasons, which "Only links carry, never a response's reasons" rules out. Example: Y cites S, which X also uses, and Y contradicts X's `S ∧ Q`. `checkLink` reads that with S true, as "Q false". The carry finds no cube over `S ∧ Q` and reports `notExpressible`.
- **Axiomatic columns are free too.** Its cost is that contradicting `A ∧ Q` with A axiomatic reports `notExpressible`, although in X, where A is forced true, it means "Q false".

**Placing a fixed value:**

- **A claim column** goes onto each variable bound to that claim in the premises the target's evaluation sees: every premise except an unpopulated naked-Q derivation stub, which evaluation hides (`argument-engine.ts:2880-2902`). Each variable's claim type is looked up at that variable's own claim version through the supplied claim lookup, so one claim bound at two versions is decided per variable:
  - **axiomatic, value `true`:** skipped; it is already true;
  - **axiomatic, value `false`:** the link contradicts an axiom, and the whole link is not carried (reason `axiom`);
  - **citation:** carried. A reader may disagree with a source.
  - If every fixed value of a link is skipped, the link is reported with reason `axiom`, so nothing is dropped silently.
- **An externally premise-bound column** goes onto that variable.
- **An expression-bound column** (the target is a response) becomes link answers, as described in "Carrying into a response".

The carry and the checks share one expansion, so they agree on what E is. They do not always read it the same way: the carry reads it with every column free, and `checkLink` reads it with the response's grounded columns held true. They cannot report contradictory values, because `checkLink` reports a verdict (`follows`, `asserted`, `incoherent`, `undetermined` or `invalid`, `src/lib/core/response/check.ts:303-349`) and never a value. That resolves the "two meanings" part of the first item's review, blocking 1.

### Inference links

An agreed inference link carries an operator decision: reinforce gives `accepted`, undercut gives `rejected`. Any operator may be the target, at any depth: the consumer stores "undercut this premise" on the premise's top-most operator, and expects undercuts of nested operators later. What is carried follows what evaluation does with the decision, with "root" as defined under Words:

| The bound operator | Reinforce carries | Undercut carries |
|---|---|---|
| root of a freeform premise that is not the conclusion | `accepted` | `rejected`; evaluation strikes the whole premise (`argument-evaluation.ts:297-316`) |
| nested in a freeform premise that is not the conclusion | nothing (reason `nestedReinforce`) | `rejected`; evaluation strikes the whole premise, as for any rejection inside it |
| root of the conclusion premise, a conditional (`implies` or `iff`) | `accepted` | `rejected`; sets `conclusionInferenceRejected` |
| root of the conclusion premise, any other operator | nothing (reason `conclusionStatement`) | `rejected`; sets `conclusionInferenceRejected` |
| nested in the conclusion premise | nothing (reason `nestedReinforce`) | nothing (reason `ignoredInConclusion`): evaluation ignores that rejection |
| root of a derivation premise | `accepted` | nothing (reason `derivationOperator`): evaluation ignores that rejection |
| nested in a derivation premise | nothing (reason `nestedReinforce`) | nothing (reason `derivationOperator`) |

**Why a nested reinforce is not carried.** Evaluation reads an accepted operator as "this subexpression is true": an accepted `and` forces its children true, an accepted `not` forces its child false (`propagation.ts:256-300`). At a premise root that is what reinforcing the step means: the premise's step holds, so the premise holds. On a nested operator it is not. "The step `Q ∧ R` inside `(Q ∧ R) → S` holds" does not say `Q ∧ R` is true, yet carrying `accepted` would make evaluation force Q and R true. `checkLink` gives no guidance either way, because it treats an inference link as one opaque column (`combined-premise-set.ts:132`). This is the conservative choice: carrying nested reinforces later, once their meaning is settled, adds output without changing any value carried today.

**Why a reinforce of a non-conditional conclusion root is not carried.** When the conclusion's root is `and`, `not`, `or` or `xor`, accepting that operator asserts the conclusion itself, which is not what reinforcing a step means. For `and` and `not` it also misleads attribution. Attribution counts only variable values as the reader's assertions (`argument-evaluation.ts:455-457`), and its counterfactual keeps operator decisions while it withholds the conclusion's variables (`:477-500`). So an accepted `and` or `not` forces those variables back, and evaluation reports `assertedByReader: false` and `reachedWithoutAssertion: true`. That was confirmed by running it on `and(Q, R)` and on `not(C)`. An accepted `or` or `xor` forces nothing on its own, so it does not mislead attribution in the same way. It is excluded anyway, because it still asserts the conclusion, not a step. A carried reinforce would then tell a reader who only agreed with "X's conclusion holds" that X reached its conclusion without their assertion, which Goal 3 rules out. A conditional root (`P → Q`) does not leak, because the counterfactual withholds P and Q. Carrying such a reinforce later, for example as the statement "E true" in `variables`, adds output without changing what carries now. A reader who accepts such a root by hand gets the same report today; that is a separate item (Notes).

**Why a nested undercut is carried although a nested reinforce is not.** An operator decision is never a truth value: a rejection strikes the premise it lives in, and a struck premise asserts nothing. So a carried rejection can withdraw more than the link disputes. Striking `(Q ∧ R) → S` over an undercut of the nested `Q ∧ R` withdraws the whole premise. But the strike itself asserts nothing. It can change what evaluation derives elsewhere, for example by making an unsatisfiable premise set satisfiable again, which lifts the suppression of derivation (`argument-evaluation.ts:357-362`). That is equally true of an undercut at a root, and it is evaluation's existing reading of a rejection. This is the one deliberate coarse reading in Goal 2, chosen because it errs towards asserting less. A nested reinforce would err the other way.

**Departure:** the intake carries nothing for a nested operator, and nothing for a derivation premise's operator. Here a nested undercut in a freeform premise is carried, for the reason above. A reinforce at the root of a derivation premise is carried, because evaluation honours it and the premise is a conditional. Everything else on those rows is reported with its reason.

An inference link of Z on an operator of Y is a different case: see "Carrying into a response".

### Carrying into a response

When the target is itself a response (Z answers Y, which answers X), the carried result for Y is **answers on Y's links**. This answers the intake's Q3.

- Every link L of Y is `x` or `NOT(x)` for one of Y's expression-bound variables `x`. The expansion keeps `x` as one column (`combined-premise-set.ts:156`). So whenever an agreed statement link of Z decomposes to a fixed value of `x`, that value answers every link of Y on `x`:
  - `x` true: each affirm or reinforce link `x` is agreed, and each contradict or undercut link `NOT(x)` is disagreed;
  - `x` false: the reverse.
- This covers every place Z can point:
  - a statement on L's root `NOT(x)` with value v fixes `x` to not v;
  - a statement on the `x` inside it fixes `x` directly;
  - a statement on another premise of Y that decomposes to a value of `x` answers L too, because that premise says the same about `x`.
- An inference link of Z on L's `NOT` is not carried (reason `linkStep`). A link has no step to dispute.
- An inference link of Z on any operator inside one of Y's non-link premises is not carried (reason `noLinkReached`). Y is never evaluated, so an operator decision on it reaches nothing, and an operator decision fixes no `x`.
- Agreeing with Z's affirm of Y's link therefore counts as agreeing with it, and agreeing with Z's contradiction counts as disagreeing.
- **One consequence, matching the intake.** Suppose Z fixes `x` true, and Y holds only the contradict link `NOT(x)`. That link becomes disagreed, and disagreeing carries nothing into X. Agreeing with Z never asserts E in X unless Y has a link asserting it.
- **Only link answers are returned for a response target.** Y is never evaluated, so values on Y's claims and operators would be public output with no use. Z's links that fix no `x` are reported as not carried (reason `noLinkReached`).

The reader's own answers on Y and the derived ones are combined by `mergeCarriedInput`. The combined answers are then carried from Y into X.

### Collisions

- **Among one response's carried values.** Several agreed links may fix one variable to opposite values, decide one operator both ways, or derive both answers on one link of Y. **Every link involved carries nothing**, with reason `conflict` naming the others. A link that carried only the part that did not conflict would assert less than it says, which is the approximation Goal 2 forbids. This happens only in a response that `checkResponseCoherent` calls incoherent, and carrying does not require the response to be coherent.
- **With the reader's own input.** `mergeCarriedInput` keeps the reader's value on every collision and reports the carried one beside it. A collision is reported and never resolved in the carried value's favour.
  - **An explicit `null` is not a value.** "Not sure" yields to a carried value, without a collision.
- **With the argument.** A carried value contradicted by the target's accepted steps comes out `CONTESTED` through propagation (`propagation.ts:57-60`) and is listed in `contestedVariableIds`, as today.

### Defaults

`own` in `mergeCarriedInput` is the reader's **explicit** input only. A default (`deriveDefaultAssignment`, `claim-variables.ts:215-242`) is not the reader's assertion.

- If defaults were passed as `own`, the default `true` on a citation would silently beat a carried "the citation is false". Criterion 1's citation case exists to prevent that.
- The supported order is: defaults, then carried values, then the reader's explicit values. So `evaluateWithDefaults(mergeCarriedInput(explicit, carried).variables, …)`.
- `evaluateWithDefaults` (`argument-engine.ts:3194-3218`) today always passes `operatorAssignments: {}`, so carried operator decisions could not reach it. It gains an optional third parameter, `operatorAssignments`, passed through unchanged. Existing calls behave as before.

### Interface

- **`ArgumentEngine.carryAnswers(targetSnapshot, linkAnswers, targetClaims): TCarryResult`**, on the response's engine.
  - `targetClaims` is a `TClaimLookup` (the type the engine's constructor already takes) that resolves the target's claims at the versions it binds. It is required: the response's own library is not guaranteed to hold them.
  - It uses the checks' precondition, which answers the first item's review, significant 3. It returns `status: "invalid"`, with problems, when:
    - the engine is not a response;
    - the snapshot is not the argument and version `respondsTo` names;
    - `validateLinks` reports an error.
  - **Otherwise it returns `status: "carried"`**, with:
    - `into: TCoreArgumentReference`;
    - for a standard target, `variables: Record<variableId, boolean>` and `operatorAssignments: Record<expressionId, "accepted" | "rejected">`;
    - for a response target, `linkAnswers: Record<premiseId, "agree" | "disagree">`;
    - `sources`: one entry per carried value, giving its kind (`variable`, `operator` or `linkAnswer`), id and value, and the premise ids of every link it came from;
    - `notCarried`: one entry per `agree` answer that carried nothing, giving its premise id and reason. The reasons are `axiom`, `notExpressible`, `impossible`, `vacuous`, `tooLarge`, `nestedReinforce`, `conclusionStatement`, `ignoredInConclusion`, `derivationOperator`, `linkStep`, `noLinkReached`, `conflict` and `notALink`.
    - `notALink`: an `agree` on a premise of the response that is not a link. A `disagree` there carries nothing and is not reported, as for any disagreed link.
  - It never throws on an answer it cannot carry.
  - **Departure:** the intake sketches `carryAnswers(pathSnapshots, answers)` over a whole path. One step, with the caller walking the path, keeps each step's inputs explicit and lets the reader's own answers on Y join at the right point. The intake itself says to carry one step at a time.
  - It is an engine method, not a free function, for the reason the checks are (first item's `outcome.md`, Departures): it reads the response's links and grounding through the engine.
- **`mergeCarriedInput(own, carried)`**, a free function.
  - `own` is the reader's explicit input for the target: `{ variables, operatorAssignments }`, plus `linkAnswers` when the target is a response.
  - It returns the combined input and a list of collisions. Each collision gives the kind, the id, the reader's value, the carried value and the carried value's source links.
  - The combined input never contains `CONTESTED`, which a reader may not assign.
  - It does not check that `own` is for `carried.into`: `own` names no argument. The caller pairs them.
- **Exports:** both, and their types (`TLinkAnswer`, `TCarryResult`, `TCarriedSource`, `TNotCarriedReason`, `TCarryCollision`, `TMergedCarriedInput`).

### Attribution of carried values

Carried values enter `variables` and `operatorAssignments` through `mergeCarriedInput`, so evaluation treats them exactly as the reader's own:

- `isReaderAsserted` counts them (`argument-evaluation.ts:455-457`);
- the counterfactuals withhold them wherever they withhold a reader value;
- `assertedByReader` and `claimAttribution` include them.

A reader who agrees with a link has asserted what it says, so a conclusion reached through a carried value is not reached without the reader's assertion. Which link a value came from lives in `sources`, not in evaluation. This answers the first item's review, blocking 2.

The counterfactual withholds only claim variables the conclusion names directly (`:477-489`). That limit is today's behaviour for a reader's own values, and carried values inherit it without making it worse.

### Why no held statements

The intake asks that an agreed link on a compound expression, such as contradict `Q ∧ R`, produce a "held statement". Two designs were weighed.

- **A hold on any expression has to join into every evaluator that computes a value,** including propagation, which keeps no per-expression state (first item's review, blocking 1).
- **A hold only on whole premises** was this spec's first draft. Its review found two problems:
  - **An attribution leak.** When the conclusion names no claim variable directly, `reachedWithoutAssertion` is read straight from the conclusion's value (`argument-evaluation.ts:490`). With a hold joined into that value, it would report a held conclusion as reached without the reader's assertion.
  - **A public interface that would ignore holds.** The join sat inside `TEvaluablePremise`, a public interface, so a consumer's own premise implementation would ignore holds.

  Both are fixable. But either design adds a permanent public evaluation input to a major release, and a later nested hold would overlap a premise hold at premise roots.

Adding an input later is cheap; removing one after 6.0.0 is not. So this item carries what reduces exactly to variable values and operator decisions, and reports the rest.

**Departure:** the intake's criterion 10 says agreeing with contradict `Q ∧ R` "produces a held statement". Here it reports `notExpressible`. The maintainer confirmed this for 6.0.0 (Notes).

## Acceptance criteria

Test file: `test/core/response-carry.test.ts` unless stated. Y answers X, and Z answers Y.

1. **Decomposition.** For an agreed link of Y on an expression of X:
   - contradict on claim C's variable expression: `variables` sets every variable of C that X's evaluated premises name to false. With C bound by two variables, both are set;
   - affirm `Q ∧ R`: Q and R true;
   - contradict `Q ∨ R`: Q and R false;
   - contradict a premise `P → Q`: P true and Q false;
   - contradict `Q ∧ R`: not carried, reason `notExpressible`;
   - a link on a formula-wrapped expression decomposes as the unwrapped one;
   - contradict an axiom-bound claim: reason `axiom`, and evaluating X with the merged input does not throw;
   - affirm an axiom-bound claim: reason `axiom`, nothing carried;
   - contradict a citation-bound claim: carried. Through `evaluateWithDefaults(merged.variables)` it is false in the result, not the default true.
   - a column the response grounds is free: Y cites S, which X also uses, and Y contradicts X's `S ∧ Q`. Not carried, reason `notExpressible`. The test checks the `notCarried` entry and that nothing is carried for S or Q.
2. **Inference links:**
   - undercut a freeform premise's root, including a `not` root, a root under a formula wrapper, and an `and` root: `rejected`, and evaluating X with the merged input lists the premise in `struckPremiseIds`;
   - undercut a nested operator of a freeform premise: `rejected`, and the premise is struck;
   - reinforce the root of a freeform premise, a conditional conclusion root and a derivation premise, including a root under a formula wrapper: `accepted`. For a freeform `and` root, evaluating X with the merged input propagates the acceptance: both conjuncts come out true where the reader gave no value;
   - reinforce a conclusion rooted at `and`, one rooted at `not`, one rooted at `or`, and an `and` conclusion root under a formula wrapper: not carried, reason `conclusionStatement`;
   - reinforce a nested operator of a freeform premise, of the conclusion and of a derivation premise: not carried, reason `nestedReinforce`. Evaluating X with the merged input gives the nested operator's children the same values as without the link;
   - undercut the conclusion's root: `rejected`, and evaluating X with the merged input reports `conclusionInferenceRejected`;
   - undercut a nested operator of the conclusion, or a derivation premise's operator: not carried, with reason `ignoredInConclusion` or `derivationOperator`.
3. **A response using the target's claims.** X is `P → Q`, `Q → R` with P derived from cited S; Y holds a copy of that derivation premise, `P → NOT(r)` and the link `NOT(r)`. Agreeing with the link carries R false onto X and nothing onto P or S; `sources` names the link.
4. **Only agreed links carry.** An unanswered link and a disagreed link carry nothing. So does an affirm link the reader left unanswered that would evaluate true by propagation.
5. **Provenance.** Two links fixing C to the same value give one `sources` entry naming both. Every carried value has a source, and every `agree` answer appears in `sources` or `notCarried`. An `agree` on a non-link premise gives `notALink`, and a `disagree` there is not reported.
6. **Collisions:**
   - affirm `Q ∧ R` with contradict `Q` in one response: both links `conflict`, and neither Q nor R is carried;
   - `mergeCarriedInput` with the reader holding C true and C carried false keeps true and reports one collision naming the source link;
   - with the reader's explicit `null` on C, the carried false is kept and no collision is reported;
   - a carried value contradicted by an accepted step of X: X's evaluation lists the variable in `contestedVariableIds`.
7. **Refusals.** `status: "invalid"` for a standard (non-response) engine, for a snapshot of another argument or version, and for a response with a `validateLinks` error.
8. **Carrying into a response:**
   - Z affirms Y's contradict link L at L's root: `linkAnswers[L] = "agree"`;
   - Z contradicts it at L's root: `"disagree"`;
   - Z affirms the `x` inside `NOT(x)`: `"disagree"`;
   - Z fixes `x` both ways through two links: both `conflict`, and no answer for L;
   - a statement link of Z on a non-link premise of Y that fixes no `x`: reason `noLinkReached`;
   - an inference link of Z on an operator of a non-link premise of Y: reason `noLinkReached`;
   - the result for a response target has no `variables` or `operatorAssignments`;
   - carrying Z → Y → X: the reader's agreement with Z's affirm of L makes L carry into X, with `sources` on X's values naming L. The reader's own "disagree" on L wins in `mergeCarriedInput`, with a collision reported.
9. **Attribution** (`test/evaluation/attribution.test.ts`, extended):
   - a conclusion `C` reached only through a carried value of C reports `assertedByReader: true` and `reachedWithoutAssertion: false`. A wrong implementation that seeds carried values into the closure without putting them in `variables` is tried and fails this test;
   - a reinforce of an `and`-rooted conclusion, carried and merged, never yields `reachedWithoutAssertion: true`. A wrong implementation that carries it as `accepted` is tried and fails this test.
10. **One meaning.** For every link in criterion 1 that carries, including the case with a response that grounds a target claim, a test substitutes the carried values into E's expansion and checks it evaluates to the link's value under every value of the free columns. The free columns are all of E's columns that the link does not fix, including any the response grounds and any axiomatic ones. For every `notExpressible` link, the test checks that two rows giving E the link's value differ in a column whose value the link would have fixed.
11. **`evaluateWithDefaults`** with an `operatorAssignments` argument applies the decisions. Every existing call's result is unchanged, checked by the existing suites.
12. **Public surface.** `docs/api-surface.txt` gains only the names under Interface and the new `evaluateWithDefaults` parameter. No name refers to accounts, ownership, storage or user limits. `pnpm run check` passes.
13. **Documentation:**
    - `docs/api-reference.md`: a carrying section, and the defaults order;
    - `skills/proposit-core`: carrying;
    - the release notes and changelog;
    - `README.md`'s response section: a pointer.

## Risks

- **Fewer links carry than the intake imagined.** Contradicting a non-cube expression, such as a premise `Q ∧ R`, carries nothing in 6.0.0, nor does a nested reinforce or a reinforce of a non-conditional conclusion root. All are always reported, and each can be carried later without changing what carries now.
- **Decomposition cost.** A truth table over one expression's columns, bounded by the ceiling, once per agreed statement link. A timing note goes in the outcome.
- **"Every variable of a claim" can split.** If X's steps contest one variable of a claim and not another, only that one is contested. The claim-level roll-up (Non-goals) is where that is reported, and carrying makes it more likely to matter. The combined 6.0.0 review should look at both together.
- **The at-most-one operator**, batched into 6.0.0, needs its case in the combined set's evaluator (`combined-premise-set.ts:335` throws on an unknown operator). The cube walk uses that evaluator. Its propagation rule's effect on carried values is checked in the combined review.

## Notes

### Question for the requester, before planning

Agreeing with a link whose content does not reduce to fixed claim values carries nothing and is reported `notExpressible`. Common shapes:

- contradicting a conjunction (`Q ∧ R`), whether it is a whole premise or nested;
- affirming a conditional or a disjunction;
- any link on a variable bound to such a premise;
- contradicting `A ∧ Q` where A is axiomatic.

Does the consumer need any of these carried in 6.0.0? If so, they need a held input, and the cheapest is a hold on whole premises, `heldPremises`, applied by core outside the premise implementation. The review's two findings on it would be fixed as follows:

- `reachedWithoutAssertion` computed without holds whenever any are present;
- the hold applied in `evaluateArgument` and the premise-bound resolver, not in `TEvaluablePremise`.

If the answer is yes, that design returns to this spec before planning. If no, the spec plans as written.

**Answered 2026-10-02 (maintainer, relayed by the requester): not in 6.0.0.** The spec plans as written, with these shapes reported as `notExpressible`. Held premises are the backlog item `2026-10-02-let-a-reader-hold-a-whole-premise-true-or-false-during-evaluation`, which records the two defects and their fixes, to ship later as an additive release.

### How this review's findings were handled

- **Blocking 1 (held premises leak into `reachedWithoutAssertion` through the shortcut):** accepted, and verified at `argument-evaluation.ts:481` (now `:490`). It is resolved by deferring holds, and recorded in the question above as a condition on any hold design.
- **Blocking 2 (no source for the target's claim types):** accepted, and verified: the snapshot type has no claims. `carryAnswers` is an engine method taking a required `TClaimLookup`. The axiom status is decided per variable at its own claim version, which answers the related question.
- **Significant 3 (departure not confirmed by the requester):** accepted. It is the question above.
- **Significant 4 (shapes wrongly reported `notExpressible`):**
  - (a), a premise-bound variable: depends on holds, so it is in the question.
  - (b), formula wrappers: accepted, through the "premise root" definition.
  - (c), axiomatic columns: kept free, now stated as a choice. The case of affirming an axiom now has reason `axiom`.
- **Significant 5 (defaults):** accepted and verified (`argument-engine.ts:3271-3292`, now `:3194-3218`, `claim-variables.ts:215-242`). See Design, "Defaults".
- **Significant 6 (where the join lives):** no longer applies, since there is no join. Recorded in the question.
- **Significant 7 (strict unknown keys):** confirmed by running. It was a defect in released code: every assignment giving values in two premises was refused. Fixed separately on this branch in `8cc1387d`, test first, and carried values meet the corrected check. Carrying places values only on variables that evaluated premises name, which answers the naked-Q part.
- **Minor findings:**
  - Response targets now return link answers only. Accepted.
  - A conflict now drops every link involved. Accepted.
  - The Z-to-contradict-link consequence is now stated. Accepted.
  - Criteria 8 to 10 of the first draft were held-premise criteria and are gone. The "one meaning" criterion now names its test.
  - Explicit `null` and the missing guard on `own` are now stated. Accepted.
  - The changed signature is now marked as a Departure. Accepted.
  - A `not` root and a formula-wrapped root are now cases in criterion 2. Accepted.
- **Overlap:** the at-most-one operator and the roll-up are in Risks.
- **Missing:** documentation is criterion 13.

### How the bounded review's findings were handled

- **Decomposition read more than the target expression:** accepted. The second revision said axiomatic columns are free "exactly as `checkLink` leaves the target's columns unseeded", which stopped being true once a response could ground a target claim (`combined-premise-set.ts:248-254`). The cube is now found over E's expansion alone, every column free, and the departure from `checkLink` is stated, with a criterion-1 case.
- **Nested reinforce:** accepted. Evaluation's reading of an accepted nested operator says more than "the step holds", so a reinforce carries only at a premise root, and a nested one is reported `nestedReinforce`. Undercuts are unchanged.
- **An inference link of Z on a non-link premise of Y:** now stated as `noLinkReached`, with a criterion-8 case.
- **Conclusion step under a formula root:** a defect in the response item's evaluation, fixed there in `1eac5758`, test first.
- **Stale text:** the open-question wording, the table cross-reference, the criterion number and the line numbers are corrected, and the base commit is now `1eac5758`.

### Maintainer decisions on the third revision

**Accepted 2026-10-02 (maintainer, relayed by the requester):** (a) the cube is found over the target expression alone, every column free, so a link whose meaning depends on the response's own grounded claims reports `notExpressible`; (b) a reinforce carries only at a premise root, and a nested one reports `nestedReinforce`. **Accepted 2026-10-02 (maintainer, relayed by the requester):** (c) the fourth revision's narrowing of (b) at the conclusion: a reinforce of the conclusion's root carries only when that root is `implies` or `iff`, and any other root reports `conclusionStatement`.

### How the fourth review's findings were handled

- **A reinforce of a non-conditional conclusion root leaks past attribution (blocking):** accepted. Reproduced on `and(Q, R)` and `not(C)`: `assertedByReader: false`, `reachedWithoutAssertion: true`. Not carried, reason `conclusionStatement`, with cases in criteria 2 and 9.
- **The same report for a reader's own acceptance of such a root:** existing behaviour, not caused by carrying. It is a separate item, `2026-10-02-decide-whether-accepting-a-non-conditional-conclusion-root-is-the-reader-s-assertion`, blocked on the maintainer deciding what accepting such a step means.
- **Goal 2 and the "one meaning" sentence overstated the agreement with `checkLink`:** accepted. Both now say the expansion is shared and read with every column free. Criterion 1's grounded case no longer describes a `checkLink` output.
- **The reason given for carrying a nested undercut:** accepted. It now rests on "an operator decision is never a truth value", and is named as the one coarse reading Goal 2 allows.
- **Criterion 10 never exercised a grounding response:** accepted. It now includes that case; the plan runs it over Task 3's links.
- **`notALink` was in the plan only:** accepted, now in Interface and criterion 5.
- **Stale line references in these Notes:** corrected beside the original numbers.
- **Plan findings** (collecting E's columns, the factory's column helpers, `isPremiseRootExpression`): applied in the plan.

### How the fifth review's findings were handled

The fifth review ended NOT DONE with nothing blocking. Applied: criterion 2's freeform-root propagation sentence back on its own bullet; the `or` and `xor` conclusion roots no longer described as misleading attribution (they do not; they are excluded because they assert the conclusion); `conclusionStatement` cases for `or` and a formula-wrapped root; `checkLink`'s full list of verdicts; "the strike itself asserts nothing" in place of a claim it can never change anything else; typos. In the plan: the conclusion-premise check for a nested undercut, and leftover `notALink` references. Sent to the requester as a separate question: a reinforce at the root of a freeform non-conditional premise (`Q ∧ R` accepted, conclusion Q) gives the same attribution report, by hand or carried.

### How the first item's review's carrying findings are handled

- **Blocking 1 (held statements):** not in 6.0.0. See "Why no held statements" and the answered question above.
- **Blocking 2 (attribution of carried values):** carried values are reader assertions (criterion 9).
- **Significant 2 (links that come out true):** only agreed links carry.
- **Significant 3 (version guard):** `carryAnswers` uses the checks' precondition.

### Release

This ships in 6.0.0 with the first item, and goes into the release-candidate tarball. Development tarballs before then do not include it.
