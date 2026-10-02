# Evaluation and validity

Two questions, two methods:

- `engine.evaluate(assignment, options?)` asks what follows **for one reader**, given the truth values they assign and the steps they accept or reject.
- `engine.checkValidity(options?)` asks whether the conclusion follows **in every case**. It tries every combination of true and false for the free variables (a truth table).

## The assignment

```typescript
type TCoreExpressionAssignment = {
    variables: Record<string, boolean | null> // variable id → value; null or absent = unknown
    operatorAssignments: Record<string, "accepted" | "rejected"> // operator expression id → decision
}
```

- **Variables** are keyed by variable id, not symbol or claim id. To translate, use `getVariableIdsForClaim` and `getClaimIdForVariable`.
- **Operator decisions** record whether the reader grants a step of reasoning:
    - `"accepted"` lets the engine carry values through that operator (for an accepted `A → B`, a true `A` makes `B` true);
    - `"rejected"` **strikes the whole premise** the operator is in, so the premise no longer counts. It never makes anything false;
    - no entry means ordinary evaluation.
- `not` operators are not decided. `premise.getDecidableOperatorExpressions()` lists the operators a reader can decide. `canonicalizeOperatorAssignments` expands per-premise decisions into per-operator ones.
- The conclusion premise and derivation premises are never struck. A rejection recorded on a derivation premise, or on an operator nested inside the conclusion premise, is ignored.
- A rejection of the conclusion premise's **root** operator means the reader withholds the final step. A formula (parenthesis) node at the root is looked through, so the operator just inside it is the root. The result then carries `conclusionInferenceRejected: true`, and nothing else changes: the conclusion premise is not struck and stays out of `struckPremiseIds`, its nested accepted operators keep carrying values, and `conclusionTrue`, `premisesHoldConclusionFalse` and `conclusionAttribution` keep their values.

```typescript
const rootId = engine.getConclusionPremise()!.getRootExpressionId()!
const withheld = engine.evaluate({
    variables: {},
    operatorAssignments: { [rootId]: "rejected" },
})
if (withheld.ok) {
    console.log(withheld.conclusionInferenceRejected) // true, when the root is an operator
    console.log(withheld.struckPremiseIds) // []: the conclusion is not struck
}
```

## Four truth values

A reader assigns three values: `true`, `false` and `null` (unknown). Evaluation can report a fourth, `CONTESTED` (the string `"contested"`). It means the reader's own values, carried through the steps they accepted, force something both true and false. It is **not** a kind of unknown. Use `isContested(value)` to test for it, and show it to the reader as a conflict they can resolve by changing an assignment or withdrawing an acceptance.

The operators follow Belnap's four-valued logic: each value records whether we have been told "true", told "false", both, or neither. Restricted to `true`, `false` and `null`, the tables are the usual three-valued (strong Kleene) ones. An argument with no conflict in it therefore behaves as it always did. `CONTESTED` can be reported but never assigned: the assignment type does not allow it.

## Example

Using the argument from [building-arguments.md](building-arguments.md) ("R → W; R; therefore W"):

```typescript
const result = engine.evaluate({
    variables: { "v-rain": true }, // W is left unknown
    operatorAssignments: { "e-implies": "accepted" }, // the reader grants R → W
})
if (result.ok) {
    console.log(result.conclusionTrue) // true: W was derived through the accepted step
    console.log(result.conclusionAttribution)
    // { assertedByReader: false, reachedWithoutAssertion: true }
    console.log(result.survivingSupportingPremiseCount) // 1
    console.log(result.contestedVariableIds) // []
}

const asserted = engine.evaluate({
    variables: { "v-rain": true, "v-wet": true },
    operatorAssignments: {},
})
console.log(asserted.conclusionAttribution)
// { assertedByReader: true, reachedWithoutAssertion: false }: no step was
// granted, so nothing but the reader's own "W is true" makes W true.
```

A conflict, and what striking does, in an argument with premises `A → C`, `A → ¬C` and conclusion `C`:

```typescript
import { isContested } from "@proposit/proposit-core"

// A → C and A → ¬C, both accepted, with A asserted true.
const result = engine.evaluate({
    variables: { vA: true },
    operatorAssignments: { imp1: "accepted", imp2: "accepted" },
})
if (result.ok) {
    // C is derived true through the first step; the second step then
    // runs backwards from C and forces A false as well as true.
    console.log(result.contestedVariableIds) // ["vA"]
    console.log(isContested(result.variableProvenance?.vA.value)) // true
    console.log(result.conclusionTrue) // true: the aggregates can read clean
}

// Rejecting the step in A → ¬C strikes that whole premise.
const struck = engine.evaluate({
    variables: { vA: true },
    operatorAssignments: { imp1: "accepted", imp2: "rejected" },
})
console.log(struck.struckPremiseIds) // [id of the A → ¬C premise]
console.log(struck.conclusionTrue) // true
```

## What a result reports

`evaluate` returns separate facts, not one verdict. The library ships no labels such as "sound" or "refuted"; combining the facts into wording is the application's job. If `ok` is `false`, the argument was not ready to evaluate and `validation` lists why.

| Field                                                                | Meaning                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conclusionTrue`                                                     | Value of the conclusion premise's root (may be `CONTESTED`).                                                                                                                                                                                                                                            |
| `conclusionAttribution.assertedByReader`                             | The reader gave `true` or `false` to a claim the conclusion uses. An explicit unknown does not count.                                                                                                                                                                                                   |
| `conclusionAttribution.reachedWithoutAssertion`                      | With those assertions withheld and the reasoning redone, the conclusion still comes out `true`. This, not `survivingSupportingPremisesTrue`, answers "did the argument get there?".                                                                                                                     |
| `contestedVariableIds`                                               | Every variable that came out `CONTESTED`. **The only reliable signal of a conflict**: every other field can look clean while one exists.                                                                                                                                                                |
| `struckPremiseIds`                                                   | Premises struck by a rejection. They are still evaluated and returned, so they can be shown crossed out.                                                                                                                                                                                                |
| `conclusionInferenceRejected`                                        | Present, and `true`, only when the reader rejected the conclusion premise's root operator. No other field moves because of it.                                                                                                                                                                          |
| `survivingSupportingPremiseCount`, `survivingSupportingPremisesTrue` | Authored supporting premises that were not struck, and whether all of them are true. Derivation premises are left out. **`…True` is `true` when the count is 0**, so always read the two together.                                                                                                      |
| `isAdmissibleAssignment`                                             | Every surviving constraint premise is true.                                                                                                                                                                                                                                                             |
| `premisesHoldConclusionFalse`                                        | Constraints hold, all surviving support is true, and the conclusion is false, under this one assignment. This is a gap for this reader, not proof the argument is invalid (that is `checkValidity`'s job).                                                                                              |
| `premiseSetSatisfiable`                                              | Some assignment makes every surviving premise true (ordinary true/false logic, ignoring the reader's values). `null` means "not determined": the search gives up above `SATISFIABILITY_VARIABLE_CEILING` (16) free variables in one connected group. When `false`, no values are carried through steps. |
| `conclusion`, `supportingPremises`, `constraintPremises`             | Per-premise results: `rootValue`, `expressionValues`, `variableValues`.                                                                                                                                                                                                                                 |
| `claimAttribution`, `variableProvenance`, `propagatedVariableValues` | Detail reported only when diagnostics are on (the default). Provenance says whether each value was `asserted`, `derived` (and by which step), `contested` (and by which steps) or `unassigned`.                                                                                                         |

Options: `validateFirst` (default `true`), `includeExpressionValues` (default `true`), `includeDiagnostics` (default `true`) and `strictUnknownAssignmentKeys` (default `false`; when `true`, assignment keys no premise uses are rejected).

## Claim types during evaluation

| Bound claim type | In `evaluate`                                                                                                                 | In `checkValidity`                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `normal`         | Reader assigns it. Unassigned means unknown.                                                                                  | Varies over true and false.                   |
| `citation`       | Reader assigns it and may disagree with the source.                                                                           | Held `true`: the source is taken at its word. |
| `axiomatic`      | Always `true`. Assigning any value, even `null`, throws `InvariantViolationError` with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`. | Held `true`.                                  |

Other variable kinds:

- A premise-bound variable inside the same argument takes its value from the premise it is bound to.
- A variable bound to a premise in another argument is assigned by the reader.

### Default assignments

- `deriveDefaultAssignment()` returns a starting value for every variable. Citation and axiomatic claims start `true`. A normal claim starts `true` only when its derivation premise's antecedent is made true by citation or axiomatic claims alone. Everything else starts `null`. It never returns `false`.
- `evaluateWithDefaults(overrides?, options?)` merges your overrides over those defaults and evaluates. It drops the axiomatic keys, so it does not trip the axiom rule.

If you build your own assignment from the defaults and call `evaluate` directly, remove the axiom-bound keys but **keep** the citation-bound ones. Dropping those would leave the citations unknown.

## checkValidity

```typescript
const validity = engine.checkValidity({ mode: "exhaustive" })
if (validity.ok) {
    console.log(validity.isValid) // true, false, or undefined if the search was cut short
    console.log(validity.counterexamples) // [{ assignment, result }, …]
}
```

An argument is valid when no assignment makes every constraint premise and every supporting premise true while the conclusion is false. The search covers 2ⁿ assignments, where n counts the free variables (citation- and axiom-bound variables are held `true` and not counted).

Options:

- `mode`: `"firstCounterexample"` (the default) or `"exhaustive"`;
- `maxVariables` and `maxAssignmentsChecked`: safety limits. Hitting one sets `truncated`;
- `includeCounterexampleEvaluations`;
- `validateFirst`.

The result also reports `checkedVariableIds`, `numAssignmentsChecked` and `numAdmissibleAssignments`.

## Checking a response

A response (see [building-arguments.md](building-arguments.md#responses-and-links)) has no conclusion, so `evaluate` and `checkValidity` refuse it: both return `ok: false` with the validation code `ARGUMENT_IS_RESPONSE`. A response is checked instead by two methods on its `ArgumentEngine`. Each takes a snapshot of the target, which the caller supplies:

- `response.checkLink(linkPremiseId, targetSnapshot)` asks whether one link follows from the response's other premises.
- `response.checkResponseCoherent(targetSnapshot)` asks whether all of the response's premises can be true at once.

Both throw when the argument is not a response, and `checkLink` throws when the premise is not one of its links.

**How the checks read a link.** A statement link is not treated as an opaque true-or-false value. Each check builds a combined set of premises in memory, used only for the search:

- every premise of the response is copied in, with each statement-bound variable replaced by a copy of the target expression it names;
- inside those copies, every occurrence of one claim becomes one column (a value to search over), whether it appears in the target or across several links;
- an inference-bound variable stays one column of its own, since whether a step holds does not depend on its parts;
- the response's own citation- and axiom-bound variables are held true, as `checkValidity` holds them. Nothing from the target is held true, because the response may deny it.

Because of this merging, two links on different occurrences of one claim are one thing to the checks. Merging reaches one argument back only. When Z answers Y and Y answers X, Y's own links into X are single columns to Z, so two of Y's links on two occurrences of one claim of X are two separate things for Z's checks.

### checkLink statuses

`checkLink` first asks whether the whole set, the link included, can be true at once. If it can, it asks whether the other premises can be true with the link false. The link itself, and every other link with the same content and the same polarity, are left out of "the other premises", so the same assertion written twice does not support itself.

| `status`       | Meaning                                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `follows`      | The other premises force the link. `supportPremiseIds` is a minimal set it follows from: no premise in it can be removed, though it is not necessarily the smallest such set. `restsOnlyOnLinks` is `true` when the link follows only through links that are themselves unsupported; it is absent when any link is `undetermined`. |
| `asserted`     | The other premises can be true with the link false, so the link stands as a bare assertion. `counterexample` is such an assignment, as a list of `{ column, value }`. `attemptedSupport` is `true` when another premise has the link's content on its consequent side (right of `→`, either side of `↔`).                          |
| `incoherent`   | The response's premises cannot all be true, so nothing is said about the link. This agrees with `checkResponseCoherent` for every link of an incoherent response.                                                                                                                                                                  |
| `undetermined` | The search could not decide. `reason` is `"too-many-variables"`: one connected group of columns is larger than the search's ceiling (16). It never throws for size.                                                                                                                                                                |
| `invalid`      | The snapshot is not the argument and version in `respondsTo`, or `validateLinks` reports an error. `problems` lists them. No search is run.                                                                                                                                                                                        |

A column in a counterexample is `{ kind: "claim", claimId }`, `{ kind: "expression", argumentId, expressionId, aspect }` (an inference, or a binding further back) or `{ kind: "premise", argumentId, argumentVersion, premiseId }` (a premise of another argument).

### checkResponseCoherent statuses

- `{ status: "checked", coherent: true }`: the premises can all be true at once.
- `{ status: "checked", coherent: false, unsatisfiablePremiseIds }`: they cannot. `unsatisfiablePremiseIds` is a minimal set that cannot: removing any one of them lets the rest hold.
- `{ status: "checked", coherent: null, reason: "too-many-variables" }`: the search could not decide.
- `{ status: "invalid", problems }`: as for `checkLink`.

For example, "contradict `Q ∧ R`" together with "affirm `Q`" and "affirm `R`" is incoherent: coherence says `false`, and every link checks as `incoherent`.

Continuing the example in [building-arguments.md](building-arguments.md#example), where Y undercuts X's step with `R` and `R → NOT(Xstep)`, and contradicts X's conclusion with nothing behind it:

```typescript
const target = x.snapshot()

console.log(y.checkLink(undercut.getId(), target))
// { status: "follows", supportPremiseIds: ["y-reason", "y-rule"], restsOnlyOnLinks: false }
console.log(y.checkLink(contradict.getId(), target).status) // "asserted"
console.log(y.checkResponseCoherent(target)) // { status: "checked", coherent: true }

const refused = y.evaluate({ variables: {}, operatorAssignments: {} })
console.log(refused.ok) // false
console.log(refused.validation?.issues[0]?.code) // "ARGUMENT_IS_RESPONSE"
```

## Readiness

Both `evaluate` and `checkValidity` first run `validateEvaluability()`. It returns `{ ok, issues }` and checks, among other things, that a conclusion is set and that every operator has enough operands. For a response it does not ask for a conclusion, but `evaluate` and `checkValidity` still refuse a response with `ARGUMENT_IS_RESPONSE`. A premise can be evaluated alone with `premise.evaluate(assignment)`.

Standalone versions of these checks exist for code that does not hold an `ArgumentEngine`: `evaluateArgument`, `checkArgumentValidity` and `isPremiseSetSatisfiable`.
