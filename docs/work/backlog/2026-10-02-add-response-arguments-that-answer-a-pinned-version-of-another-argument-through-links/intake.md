## Inbox manifest

- `2026-10-02-response-arguments-and-links-into-a-pinned-target.md`

## Inbox body

Change request from a consumer of the library, delivered by message on 2026-10-02. Replies go back to the sender. Recorded as it arrived.

# Request: response arguments, and links that bind into a pinned version of another argument

Paths below are relative to the proposit-core repository root, at `90578ec3`.

## The problem, in library terms

Proposit models an argument as one set of premises with exactly one conclusion premise, all asserted together. There is no way to represent a second argument whose purpose is to answer the first:

1. **A fork means "copied from", never "opposes".** `forkArgument` records only that one argument was copied from another (`src/lib/schemata/fork.ts:14-26`). A fork cannot also carry disagreement, because forks are made for other reasons too: rephrasing, extending, restricting.
2. **Putting an objection inside the argument it objects to makes it contradict itself.** An argument asserts every premise at once, so `P implies Q` and its denial cannot both live in it.
3. **There is no way to argue that an inference fails.** An evaluation input can already reject an operator (`operatorAssignments[id] = "rejected"`, `src/lib/core/evaluation/argument-evaluation.ts:248-266`), but that is a caller's private decision with no argued content behind it. Writing `NOT(P implies Q)` instead asserts something else: under material implication it means "P is true and Q is false", which contradicts accepting Q.

What is wanted is a second kind of argument, a **response argument**, that answers one other argument at a pinned version, through **links**: variables bound to expressions in that other argument. Every link must be logically checkable. There is no free-text content anywhere.

## Words used here

- **Standard argument**: what exists today, with one conclusion premise.
- **Response argument**: answers one other argument (standard or response) at a pinned version. It has no conclusion premise.
- **Target**: the argument a response answers, at its pinned version.
- **Path**: a run of arguments, each answering the one before: `X ← Y ← Z`, where Y answers X and Z answers Y. Any depth is allowed.
- **Link**: a premise of a response whose whole content is `x` or `NOT(x)`, where `x` is an expression-bound variable (C2) referring into the target.
- **Referent**: what a variable stands for. For a claim-bound variable, its claim id. For an expression-bound variable, `(argumentId, expressionId, aspect)`. Two variables with one referent mean the same thing.
- **The four moves**, read from a link's content:

  | | Attack | Support |
  |---|---|---|
  | **Statement** (is it true?) | **contradict**: `NOT(x)` | **affirm**: `x` |
  | **Inference** (does it follow?) | **undercut**: `NOT(s)` | **reinforce**: `s` |

## Boundary

Core owns what is decidable from argument content alone: structure and logic, bindings between arguments, what changed between two snapshots, and how an evaluator's answers carry along a path. Everything about who made something, how it is stored, which versions exist or are available, and how anything is shown stays with the consumer. Core never fetches a snapshot; the consumer passes one in. Where a consumer needs to allow or refuse something, the consumer decides, through the `canBind` hook. No new hook is needed.

Core is deliberately more permissive than any one consumer: every move is allowed on every expression, including operators inside derivation premises. A consumer offering a narrower set is making its own choice, not a rule of the logic.

## C1. Argument kinds

- **Fields.** The argument schema (`src/lib/schemata/argument.ts:4-25`) gains optional `kind: "standard" | "response"` (absent means standard) and, for a response, `respondsTo: { argumentId, argumentVersion }`. The target may itself be a response.
- **Checksums.** Both fields join the default checksummed argument fields **only when present**, so no existing checksum changes (`src/lib/types/checksum.ts:9-12`, `src/lib/checksum-config.ts`). `kind` is absent for a standard argument, never present with a default value.
- **Engine guards, for a response:** creating its first premise does not make it the conclusion (`argument-engine.ts:955-957`); removing a premise promotes nothing (`:1066-1075`); setting a conclusion is refused.
- **Validation, for a response:** rule E-7 (`src/lib/grammar/validators/evaluable.ts:195-234`) passes with no conclusion; a response that has a conclusion is a new, named violation; `ARGUMENT_NO_CONCLUSION` (`argument-validation.ts:402-416`) does not fire.
- **Evaluation.** `evaluate()` and `checkValidity()` on a response return a typed result directing callers to C3, not `ARGUMENT_NO_CONCLUSION` (`argument-evaluation.ts:199-208`, `:563-571`).
- **Every reader of the conclusion handles its absence:** rendering (`src/lib/core/argument/display.ts:16-27`); the CLI (`src/cli/commands/render.ts:31-53`, `graph.ts:102,152,180`, `roles.ts:22-66`); the diff renderer (`src/cli/diff-renderer.ts:18,107-112`); parsing (`src/lib/parsing/schemata.ts:60,137`); changeset ordering (`src/lib/core/changeset-order.ts:108-109`).
- **Supporting premises.** In a response, "supporting premises" (today `isInference() && id !== conclusionPremiseId`, `argument-engine.ts:1834-1842`) means the premises that are not links.

## C2. Links are bindings into the target

- **Today** there are claim-bound variables and premise-bound variables (`src/lib/schemata/propositional.ts:132-163`). `bindVariableToExternalPremise` and `bindVariableToArgument` point a premise-bound variable into another argument, gated by `canBind` (`argument-engine.ts:1275-1315`), and evaluation treats it as a free input (`argument-evaluation.ts:238-247`).
- **New: an expression-bound variable**, with `boundExpressionId`, `boundArgumentId`, `boundArgumentVersion` and `boundAspect`:
  - `boundAspect: "statement"`: its truth is the truth of that expression in the target. The expression can be anything: one claim's variable expression, a compound such as `Q ∧ R`, or a premise's root.
  - `boundAspect: "inference"`: its truth is "this operator's inference holds". The bound expression must be an operator. **Any operator** is allowed, including `and`, `or` and `not`, and operators inside derivation premises. Core checks only that the target is an operator; what an inference link on a non-inference operator means is the consumer's to present.
- **Links are always expression-bound.** A claim in the target is linked by binding to one of its variable expressions there. A claim-bound variable cannot tell "I am answering your claim P" from "I am using P as my own reason", so it is never a link.
- **Using the target's own claim as a reason.** The response affirms the claim with a link, then builds on that link's variable. "C is false, because of P, which you assert" is written as: the affirm link `p` (bound to P's expression in the target), `p → NOT(c)`, and the contradict link `NOT(c)`. Consequently, binding with a **claim-bound** variable a claim that the **immediate target** uses is a violation.
- **Claims from further back along the path** (used by an older argument but not by the immediate target) may be bound with an ordinary claim-bound variable, as the response's own assertion. Links point only into the immediate target.
- **One variable per referent within a response.** A second binding to the same expression and aspect reuses the existing variable; a duplicate is a violation.
- **What makes a premise a link:** its whole content is `x` or `NOT(x)`, with `x` expression-bound into `respondsTo`. The move is read from the content (table above); nothing else is stored, so a link cannot disagree with its own content. A binding into any argument other than `respondsTo` is a violation.
- **Checks against a target snapshot** the caller supplies: `validateLinks(response, targetSnapshot)` reports each link whose bound expression is missing, and each inference binding not on an operator.
- **Rules D-4 and D-5** (`docs/Proposit_Grammar.md:526-543`) keep citation and axiom claims inside derivation antecedents. They do not restrict expression-bound variables, so disputing sources and axioms is supported.
- **Policy.** `canBind(boundArgumentId, boundArgumentVersion)` is called by the new expression binder and by `rebaseChanges` when it re-points a link, as well as from `bindVariableToExternalPremise` (`argument-engine.ts:1287`) today. It is **not** called when a snapshot is loaded, so a response whose target the consumer no longer makes available still loads.
- **Helpers:** `listLinks(response)`: each link with its bound target and move. `elementsWithinPremise(targetSnapshot, premiseId)`: every expression id and claim id in a premise, so a caller can find the links touching it.
- **Checksums.** The new variable fields join the variable checksum fields only when present, as `boundPremiseId` does today.

## C3. Checking a response

- **Variables are compared by referent, not by id.** Before checking, variables with the same referent are merged. A consumer may hold several variables bound to one claim (for example one made by hand and one created for a derivation).
- **`checkLink(response, linkPremiseId)`** asks whether the link's content follows from the response's *other* premises, links included, excluding derivation premises. A response's links may support each other.
  - Results: `follows`; or `asserted` (it does not follow, so it is a base assertion), with counterexamples. A bare denial is `asserted`, and so is the affirm link `p` in the "because of P, which you assert" pattern.
  - `attemptedSupport`, with `asserted`: true when some other premise has the link's referent on its consequent side (right of `→`, or either side of `↔`). Inference referents count: `R → NOT(s)` has `s` on its consequent side. It separates "support given but incomplete" ({R→¬x, ¬x}, no R) from a plain assertion ({¬x} alone).
  - `supportPremiseIds`: a smallest set of other premises from which the link follows, found by dropping premises one at a time while it still follows.
  - `restsOnlyOnLinks`: true for a link that follows but is not **grounded**. A link is grounded when it is `asserted`, or when it follows from the ordinary (non-link) premises together with links already grounded, repeated until nothing changes. So the affirm-then-build pattern is grounded, while two links supporting only each other through ordinary connecting premises (`¬y → ¬x`, `¬x → ¬y`) both follow and are both flagged.
- **`checkResponseCoherent(response, targetSnapshot)`** reports whether the response's premises can all hold at once. It expands each statement binding through the target's structure down to claim level, so "contradict `Q ∧ R`" with "affirm Q" and "affirm R" is caught. Inference bindings stay free inputs. Without this, a self-contradicting response passes every `checkLink`, because anything follows from a contradiction.
- **The usual shape** of "x is false because R": `R`, `R → NOT(x)`, and the link `NOT(x)`, all using one variable `x`.

## C4. Bringing a response up to a newer target version

- **A fingerprint that ignores version numbers.** Stored checksums cannot be compared across versions: expression checksums include `argumentVersion` (`src/lib/checksum-config.ts:18-28`), which a version copy rewrites, and they hash `variableId`, so an edit to a claim beneath a step leaves them unchanged. Core computes `structuralFingerprint(snapshot, expressionId)` over the subtree: each node's type, operator and child order, and for every variable its referent, including the bound claim's version. Argument coordinates and consumer-defined fields are left out.
- **`classifyLinks(response, targetFrom, targetTo)`** labels each link: `unchanged` (same expression id in `targetTo`, same fingerprint; two versions with no edits between them give `unchanged`); `changed` (the id exists but the fingerprint differs: `P→Q` becoming `P→R`, or Q's claim text edited); `removed` (the id is absent). Entity ids persist across versions in the consumers that copy versions.
- **`rebaseChanges(response, classification, decisions)`** returns a changeset for the response as it currently stands, not a new version (core does not create versions): unchanged links are re-pointed to `targetTo`; each changed or removed link is decided by the caller: `keep` (re-point; for a changed link that accepts the new content), `retarget` (bind to a chosen element of `targetTo`), or `drop` (remove the link premise; other premises are left alone).

## C5. Carrying answers along a path

- **The shape of answers on a response:** one answer per link, Agree or Disagree, as `linkAnswers: Record<premiseId, "agree" | "disagree">`, beside today's `variables` and `operatorAssignments`. Who gave the answers is the consumer's concern.
- **A new evaluation input, `heldStatements: Record<expressionId, boolean>`**: "the evaluator holds this expression true or false".
  - It is caller-side input, not part of the argument. It is applied where the caller's variable values are applied.
  - It is excluded from `premiseSetSatisfiable` and from derivation suppression (`argument-evaluation.ts:271-293`), which ask about the argument's own premises.
  - A clash with what the argument asserts is reported through the existing contested and premise-false results: the premise is false for this evaluator, which makes the argument unsound for them, not self-contradictory.
- **The conclusion's inference can be rejected.** Today a rejection on the conclusion premise is ignored (`argument-evaluation.ts:248-266`). Core gains an optional result field, `conclusionInferenceRejected: true`, set when the conclusion premise's **root** operator is rejected. Consumers read it as "conclusion not established". As you proposed earlier:
  - **marking only, not striking**: the conclusion premise is not struck and stays out of `struckPremiseIds`; its nested accepted operators keep propagating;
  - **`conclusionTrue` keeps its evaluated value**, because a rejection asserts nothing and an operator decision is never a truth value;
  - `premisesHoldConclusionFalse` and `conclusionAttribution` keep their formulas, so no existing result field changes value for any input;
  - a rejection of a **nested** operator inside the conclusion premise stays ignored, and the documentation says so.
- **`carryAnswers(pathSnapshots, answers)`**: given a path, newest first, and the answers on each argument already evaluated, return the starting input for the next older argument. For each link answered **agree**:

  | Link | Its target | Carried into the older argument |
  |---|---|---|
  | contradict or affirm | a single claim's variable | that claim false or true, set on **every** variable bound to the claim there |
  | contradict or affirm | a compound expression or a premise root | a held statement on that expression |
  | contradict or affirm | an axiom-bound variable | nothing; reported as shown-not-carried (rule E-4 forbids assigning one) |
  | undercut or reinforce | the root operator of a freeform, non-conclusion premise | that operator `rejected` or `accepted` |
  | undercut or reinforce | the conclusion premise's root operator | `rejected` or `accepted`; a rejection sets `conclusionInferenceRejected` |
  | undercut or reinforce | a nested operator, or any operator in a derivation premise | nothing; reported as shown-not-carried |

  A link answered **disagree** carries nothing.
- **Depth.** Carrying always goes one step, from an argument into the one it answers. Values carried into Y from Z are part of Y's answers. If agreeing with Z's contradiction of Y's link L makes L false in Y, that counts as disagreeing with L, so L carries nothing into X.
- **Provenance.** Every carried value names the answer it came from.
- **Collisions** with the older argument are reported through the existing contested result, citing the existing limitation that a struck premise is discarded whole (`docs/api-reference.md:383`).

## C6. Link references

- **Type:** `{ argumentId, argumentVersion, premiseId }` names one link.
- **`linkTargetsElement(reference, response, targetSnapshot, element)`** answers whether that link contradicts or undercuts the given element: for a claim, the link must bind a variable expression of that claim (any version of the claim counts); for an operator, the expression id must match, and a link to a premise's root counts for every expression in that premise.

A consumer that records which link was the reason for a disagreement can use this to check the reference.

## C7. Release

The version number is yours to decide from the full request. Your earlier answers, which this request already reflects:

- the conclusion-step change alone is minor, because no existing result field changes value (C5);
- expression-bound variables widen the variable union, so code switching over every variable type stops compiling or falls through: minor, with a warning in the release notes;
- the fingerprint and held statements are additive;
- argument kinds with no conclusion are what could justify a major, because `ARGUMENT_NO_CONCLUSION` is part of the stable wire format and many places reference the conclusion premise;
- if it is a major, you may batch the two breaking items already on your board.

A major is acceptable. Either way: `kind` is absent for standard arguments so no existing checksum moves; changelog, release notes and API reference follow your own documentation entries; and the release waits for consumer-side validation. Please build the validation tarball with `pnpm run build && pnpm run pack:branch` and tell the sender its path; do not release until the sender reports the validation verdict.

## Acceptance criteria

1. A response with premises and no conclusion validates. A standard argument with premises and no conclusion still fails E-7. A response with a conclusion fails with a named code.
2. Creating the first premise of a response, or removing one, leaves it without a conclusion.
3. Every checksum the currently released core computes for data without the new fields is unchanged. A test runs over fixtures captured from the released version.
4. An expression-bound variable with `boundAspect: "inference"` on a non-operator expression is a violation. On any operator, including one inside a derivation premise, it is not.
5. `listLinks` reports each move by its content: `NOT(x)` statement-bound is contradict, `x` is affirm, `NOT(s)` inference-bound is undercut, `s` is reinforce. A premise `p` using a claim-bound variable is never a link. Binding, with a claim-bound variable, a claim the immediate target uses is a violation.
6. Carrying a held statement "`A ∧ B` false" into an argument that asserts `A ∧ B` leaves `premiseSetSatisfiable` unchanged; that premise is reported false for the evaluator, not as a contradiction among the premises.
7. `checkLink` results:
   - {R, R→¬x, ¬x}: `follows`, with `supportPremiseIds` = the R premises;
   - {R→¬x, ¬x}: `asserted` with `attemptedSupport: true`;
   - {¬x} alone: `asserted` with `attemptedSupport: false`;
   - {p, p→¬c, ¬c} (affirm then build): `p` is `asserted` with `attemptedSupport: false`; `¬c` `follows` with `restsOnlyOnLinks: false`;
   - an undercut ¬s with R and R→¬s: `follows`;
   - {¬x, ¬y, ¬y→¬x, ¬x→¬y}: both `follows`, both `restsOnlyOnLinks: true`;
   - adding an ordinary R with R→¬y grounds ¬y, and ¬x with it: both then `restsOnlyOnLinks: false`.
8. `checkResponseCoherent` is false for: `x` with `NOT(x)`; "contradict `Q ∧ R`" with "affirm Q" and "affirm R", given the target snapshot; two variables with one referent used as `x` and `NOT(x')`.
9. `classifyLinks`: two versions with no edits give every link `unchanged`; `P→Q` edited to `P→R` is `changed`; claim Q's text edited under an undercut of `P→Q` is `changed`; a deleted operator is `removed`.
10. `carryAnswers` follows the C5 table. In particular: agreeing with a contradict on a claim sets every variable of that claim false in the older argument; agreeing with a contradict on `Q ∧ R` produces a held statement; agreeing with an undercut of the conclusion premise's root operator makes the older argument report `conclusionInferenceRejected`; an agreed undercut on a nested or derivation operator, or a contradict on an axiom, is reported as shown-not-carried, and nothing throws.
11. No addition to the public API names consumer concepts such as accounts, ownership, storage or availability state, or limits.

## Questions to settle in your own spec

- **Q1 (one referent?).** In `checkLink`, are a claim-bound `c` and a link on c's expression one referent?
- **Q2 (large responses).** What does `checkLink` return above `maxVariables` (`argument-evaluation.ts:614-627`)? The smallest-set search re-runs the validity check many times.
- **Q3 (carrying an affirm across depth).** What carries when an evaluator agrees with Z's *affirm* of Y's link, and when Z targets the inner `x` of Y's link rather than the link premise?
- **Q4 (a claim becomes used by the target).** When a newer target version starts using a claim the response had bound with a claim-bound variable (from further back along the path), that binding becomes a violation under C2. What do `classifyLinks` and `rebaseChanges` report and do with it?

Please reply to the sender with the item's slug once filed, and again when the spec review closes and when the validation tarball is ready.
