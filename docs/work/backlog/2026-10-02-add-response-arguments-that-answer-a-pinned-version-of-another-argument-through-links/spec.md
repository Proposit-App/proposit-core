# Spec: response arguments that answer a pinned version of another argument through links

Line numbers are against `90578ec3`. "The intake" is this item's `intake.md`; sections C1–C7 below follow its numbering, and every place this spec departs from it is marked **Departure** with the reason.

## Capability changes

The capability ledger for this repository is empty (`tcw capabilities list` prints nothing), so no ledger record changes. The taxonomy gains entries at implementation time:

- Vocabulary: **response argument** (under `argument`), **link** (a premise of a response that is a single bound variable or its negation), **expression-bound variable** (under `propositional-variable`), **move** (contradict / affirm / undercut / reinforce), **held statement** (an evaluation input that holds an expression true or false).
- Feature: **response checking** (`checkLink`, `checkResponseCoherent`, `validateLinks`), **response rebasing** (`structuralFingerprint`, `classifyLinks`, `rebaseResponse`), and **answer carrying** (`evaluateResponse`, `carryAnswers`). `argument-evaluation` gains held statements and the conclusion-step flag. `argument-construction` gains argument kinds and the expression binder.

## Problem

An argument here is one set of premises, asserted together, with one conclusion premise (rule E-7, `src/lib/grammar/validators/evaluable.ts:194-235`). Nothing lets one argument answer another:

- The only relationship between two arguments is a fork record, which says "copied from" and nothing else (`src/lib/schemata/fork.ts:14-26`).
- An objection written into the argument it objects to makes that argument assert both sides.
- Denying that a step follows has only a reader-side form: `operatorAssignments[id] = "rejected"` strikes the premise and asserts nothing (`src/lib/core/evaluation/argument-evaluation.ts:249-268`). There is no authored, argued form. Writing `NOT(P → Q)` instead asserts "P and not Q", which is not what someone conceding P and Q but denying the step means.
- A rejection recorded against the conclusion premise is ignored (`argument-evaluation.ts:255-259`), so a reader cannot withhold the final step at all.

Two existing defects sit in exactly the code this change extends. Both are fixed here, as separate commits:

1. **Forking an argument that holds a binding into another argument throws.** `forkArgumentEngine` remaps every premise-bound variable as if it were internal (`src/lib/core/fork.ts:147-159`). For an external binding, `premiseRemap.get` returns `undefined` and `boundArgumentId` is rewritten to the new argument. Loading the forked snapshot then fails with `Bound premise "undefined" does not exist in this argument` (`argument-engine.ts:1263-1266`), reproduced against `90578ec3`. Response arguments are built entirely from external bindings, so without this fix no response can be forked.
2. **`checkValidity` reports a too-many-variables refusal under the code `ASSIGNMENT_UNKNOWN_VARIABLE`** (`argument-evaluation.ts:614-627`), which names a different failure. The new checks in C3 need the same refusal and must not copy the wrong code. This one is fixed only if the plan finds that the code is not matched by consumers. If it is, it is reported rather than renamed, since engine-error codes are stable wire format.

## Goals

1. A second argument kind, the **response**, that answers exactly one other argument at a pinned version and has no conclusion premise.
2. **Links**: premises of a response that bind, by expression, into the argument it answers. Each makes exactly one of four moves, read from its content alone.
3. Checks on a response that need only content: whether each link follows from the rest of the response, whether the response is consistent with itself, and whether its bindings still resolve in a target snapshot the caller supplies.
4. Bringing a response up to a newer version of its target: classify what happened to each link, then re-point the links under the caller's decisions.
5. Carrying a reader's agreement with a response into the evaluation of the argument it answers, one step at a time along a chain of answers, with a record of where each carried value came from.
6. A reader may reject the conclusion premise's root step, reported in a new field.
7. **Nothing existing changes.** No checksum of existing data changes. No evaluation result field changes value for any input expressible today. Every standard argument validates and evaluates exactly as before.

## Non-goals

- Who wrote or answered anything, storage, availability of versions, display. Core never fetches a snapshot. Allow/refuse policy stays on the existing `canBind` hook.
- Scoring a whole web of answers automatically (abstract argumentation semantics). Carrying is one step, driven by a reader's answers.
- Parsing responses from text (`src/lib/parsing/`) or producing them from the ingestion pipelines (`src/extensions/pipelines/`). Both keep producing standard arguments.
- CLI commands for authoring responses. The CLI must *read* a response without failing (C1); it gains no new commands.
- A partial strike of a premise. The existing per-premise limitation (`docs/api-reference.md:383`) stands and is cited where it matters (C5).
- A generic "apply a changeset to an engine" function. None exists (changesets come only from engine mutations, `src/lib/core/change-collector.ts`), and C4 does not need one.

## Design

### Words

- **Standard argument**: every argument today. **Response**: an argument with `kind: "response"`. **Target**: the argument a response answers, at the pinned version `respondsTo`.
- **Path**: `X ← Y ← Z`, where Y answers X and Z answers Y. Any depth.
- **Expression-bound variable**: a variable whose truth is tied to one expression of the target (C2).
- **Link**: a premise of a response whose entire content is `x` or `NOT(x)`, where `x` is expression-bound.
- **Referent**: what a variable stands for. A claim-bound variable stands for its claim. An expression-bound variable stands for `(target expression, aspect)`, except as normalised below.
- **Moves**:

  | | Attack | Support |
  |---|---|---|
  | **Statement aspect** — is it true? | **contradict**: `NOT(x)` | **affirm**: `x` |
  | **Inference aspect** — does the step hold? | **undercut**: `NOT(s)` | **reinforce**: `s` |

### C1. Argument kinds

- **Fields.** The argument entity (`src/lib/schemata/argument.ts:4-25`, which already allows additional properties) gains optional `kind: "response"` and `respondsTo: { argumentId, argumentVersion }`.
  - **Departure:** the intake types `kind` as `"standard" | "response"`. Here only `"response"` is a legal value, and a standard argument has no `kind` key. A legal `"standard"` value would be a present key on some standard arguments and absent on others. Under `entityChecksum`'s key-presence rule (`src/lib/core/checksum.ts:36-47`) those two would checksum differently while meaning the same thing. That is the `enthymeme` trap, and one legal spelling removes it.
- **Checksums.** `kind` and `respondsTo` join the default `argumentFields` (`src/lib/checksum-config.ts:45`, `src/lib/types/checksum.ts:9-12`). They are hashed only when present, so every existing argument checksum is unchanged.
- **Consistency of the fields** (new Structural rule S-15). If one of `kind: "response"` and `respondsTo` is present, the other must be too. `respondsTo.argumentId` must differ from the argument's own id. A snapshot that breaks this does not load, like any Structural violation.
- **Engine behaviour for a response:**
  - `createPremise` does not make the first premise the conclusion (today it does, `argument-engine.ts:955-958`).
  - Removing a premise promotes nothing (today the smallest remaining id is promoted, `argument-engine.ts:1066-1076`).
  - `setConclusionPremise` throws (`argument-engine.ts:1753-1777`).
  - `fromSnapshot` and `fromData` load a response without calling `setConclusionPremise` (`argument-engine.ts:1939-1940`, `2082-2083`).
- **Validation.**
  - E-7 passes for a response with no conclusion.
  - A response that has a conclusion premise is a new Evaluable violation, **E-8**. It is Evaluable rather than Structural so that such data still loads and can be repaired.
  - `validateArgumentEvaluability` does not raise `ARGUMENT_NO_CONCLUSION` for a response (`src/lib/core/argument-validation.ts:402-417`).
  - D-6 (`src/lib/grammar/validators/derivable.ts:491-511`) is unaffected.
- **Evaluation.** `evaluate()` and `checkValidity()` on a response return `ok: false` with a new engine-error code, `ARGUMENT_IS_RESPONSE`, whose message names `evaluateResponse` and `checkLink`. Today both return `ARGUMENT_NO_CONCLUSION` (`argument-evaluation.ts:199-210`, `563-574`). The new code is additive; no existing code changes meaning.
- **Supporting premises.** In a response, `listSupportingPremises` returns the premises that are not links (today it returns inference premises other than the conclusion, `argument-engine.ts:1833-1842`).
- **Readers of the conclusion handle its absence.** The ones that would misbehave on a response:
  - rendering (`src/lib/core/argument/display.ts:16-27`, `argument-engine.ts:772`), review ordering (`src/lib/core/review-helpers.ts:92-93`), role diffing (`src/lib/core/diff.ts:410`, `455-456`);
  - the CLI's `render`, `graph` and `roles show` (`src/cli/commands/render.ts:31-53`, `graph.ts:102`, `152`, `180-181`, `roles.ts:22-33`) and the diff renderer (`src/cli/diff-renderer.ts:18`, `107-112`);
  - the CLI's `roles set-conclusion` (`roles.ts:39-55`) writes the roles file without going through the engine, so it gains its own refusal for a response.
  - Untouched, because they only ever build standard arguments: parsing (`src/lib/parsing/schemata.ts:60`, `137`; `argument-parser.ts:632-653`), the pipeline assembler (`src/extensions/pipelines/base/finalize/assembler.ts`), and CLI import (`src/cli/import.ts:416`, `439`).
- **Forking a response** produces a response with the same `respondsTo`. Expression-bound variables are copied with their bindings unchanged, because they point into the target, not into the argument being forked. This lands together with defect 1's fix, which treats external premise-bound variables the same way.

### C2. Expression-bound variables and links

- **New variable shape** (a third member of the variable union, `src/lib/schemata/propositional.ts:170-173`): base fields plus `boundExpressionId`, `boundArgumentId`, `boundArgumentVersion`, `boundAspect: "statement" | "inference"`.
  - The union has no discriminator field; members are told apart by which keys are present (`isClaimBound`, `isPremiseBound`, `propositional.ts:180-191`). The new member is recognised by `boundExpressionId`, through a new guard `isExpressionBound`. `isPremiseBound` keeps testing `boundPremiseId`, which the new shape never carries, so the existing guards' answers do not change.
- **Checksums.** The four fields join the variable checksum fields and are hashed only when present, as `boundPremiseId` is today.
- **Binder.** `bindVariableToExpression(variable)` on `ArgumentEngine`:
  - Throws if the argument is not a response, or if `boundArgumentId` / `boundArgumentVersion` differ from `respondsTo`. Both are part of new Structural rule **S-16**, which also makes a snapshot carrying such a variable fail to load.
  - Calls `canBind(boundArgumentId, boundArgumentVersion)` and throws if it refuses, as `bindVariableToExternalPremise` does (`argument-engine.ts:1287`).
  - If a variable with the same referent already exists (normalisation below), returns it instead of adding a second, as `ensureClaimBoundVariable` does for claims. A duplicate arriving by snapshot is a new Evaluable violation, **E-9**.
- **Loading.** `fromSnapshot` always constructs the base class (`argument-engine.ts:~1889`), so a subclass's `canBind` is never consulted on load today. That stays true for the new binder, so a response whose target the consumer no longer offers still loads. The intake states this as a requirement; here it is recorded as existing behaviour that must not regress.
- **Referent normalisation. Answers intake Q1.**
  - A **statement**-aspect binding to a **variable expression of a claim-bound variable** in the target stands for that **claim**, not for the expression. Two links on two occurrences of one claim are therefore one referent.
  - All other bindings stand for `(boundArgumentId, boundExpressionId, aspect)`.
  - Q1 ("are a claim-bound `c` and a link on c's expression one referent?") is then mostly moot: a response may not hold a claim-bound variable for a claim its immediate target uses (next point), so the two cannot both be legal at once. Where both exist, the response is already invalid, and checks treat them as one referent so they do not mask each other.
- **Claims the target uses.** A claim-bound variable, in a response, for a claim that the immediate target uses is a violation. Claims used only further back along the path may be claim-bound, as the response's own assertions. Detecting this needs the target snapshot, so it is reported by `validateLinks`, not by the grammar tiers, which have no target.
- **What a link is.** A premise is a link exactly when its whole content is a single variable expression, or `NOT` over a single variable expression, and that variable is expression-bound. The move comes from the aspect and the presence of `NOT`. Nothing else is stored, so a link cannot disagree with its own content.
- **`validateLinks(response, targetSnapshot)`**, given a snapshot whose id and version must equal `respondsTo`. It reports:
  - a bound expression missing from the snapshot;
  - an inference-aspect binding whose expression is not an operator; any operator is allowed, including `and`, `or`, `not`, and operators inside derivation premises;
  - a claim-bound variable for a claim the target uses (above).
- **Sources and axioms.** D-4 and D-5 (`docs/Proposit_Grammar.md:526-543`) keep citation- and axiom-bound variables inside derivation antecedents. They do not apply to expression-bound variables, so a response may contradict or undercut anything that rests on a source or an axiom.
- **Helpers.**
  - `listLinks(response)` returns each link: premise id, variable id, bound expression, aspect, move.
  - `elementsWithinPremise(targetSnapshot, premiseId)` returns every expression id and claim id in a premise.

### C3. Checking a response

All checks merge variables with one referent before working (C2 normalisation, plus claim-bound variables sharing a claim id, which core allows, `CLAUDE.md` invariant on claims binding more than one variable). Grounded variables are seeded true, exactly as `checkValidity` seeds them (`argument-engine.ts:2561-2586`).

- **`checkLink(response, linkPremiseId, options?)`**: does the link's content follow from the response's other premises?
  - **Departure:** the intake excludes derivation premises. Here they are included, with grounded variables seeded true. A response's most ordinary support for "x is false" is a cited source, and in core a source supports a claim *only* through a derivation premise (`IMPLIES(source, Q)`). Excluding derivation premises would make every source-backed objection read as an unsupported assertion.
  - Result `status`:
    - `follows`, with `supportPremiseIds`: a smallest set of other premises from which it follows, found by removing premises one at a time while it still follows. This set is minimal (nothing can be removed), not necessarily the smallest possible.
    - `asserted`: it does not follow, with up to `options.maxCounterexamples` counterexamples (default 1), and `attemptedSupport`.
    - `undetermined`, with `reason: "too-many-variables"`. **Answers intake Q2.** Returned when the merged variable count exceeds `options.maxVariables`, which defaults to the satisfiability ceiling of 16 (`src/lib/core/evaluation/satisfiability.ts:18`). It never throws for size.
  - `attemptedSupport` (with `asserted`) is true when another premise has the link's referent on its consequent side: right of `→`, either side of `↔`, at any depth below a `NOT` there. Inference referents count.
  - `restsOnlyOnLinks` (with `follows`) is true when the link follows but is not **grounded**. A link is grounded when it is `asserted`, or when it follows from the non-link premises together with links already grounded, repeated until nothing changes. The fixpoint is computed once per response and shared by every `checkLink` call on it.
- **`checkResponseCoherent(response, targetSnapshot, options?)`**: can all of the response's premises hold at once?
  - Each statement-aspect variable is expanded to its meaning in the target, down to claims. A binding to `Q ∧ R` behaves as `q ∧ r`, where `q` and `r` are the claims' referents. So "contradict `Q ∧ R`" with "affirm Q" and "affirm R" is incoherent.
  - Inference-aspect variables stay free. Axiom- and citation-bound claims in the expansion stay free too, because a response may deny them.
  - Internally premise-bound variables in the target expand to their bound premise's root; external ones stay free.
  - Returns `coherent: true | false | null`; `null` means above `maxVariables`. Where it is `false`, it also returns an unsatisfiable set of premise ids found by the same remove-one-at-a-time reduction.
  - This check matters because anything follows from a contradiction, so a self-contradicting response would pass every `checkLink`.
- **Size refusals** in this section use a new code `TOO_MANY_VARIABLES`, not `ASSIGNMENT_UNKNOWN_VARIABLE` (defect 2).

### C4. Bringing a response up to a newer target version

- **`structuralFingerprint(snapshot, expressionId)`**: a hash over the subtree's shape that ignores ids and versions of the argument. Stored checksums cannot serve, because expression checksums include `argumentVersion`, `parentId`, `premiseId` and `variableId` (`src/lib/checksum-config.ts:18-28`). Nothing in the library computes such a hash today, and `diffArguments` matches by id (`src/lib/core/diff.ts:70-115`, `365`).
  - The hash covers each node's type, operator and child order.
  - For each variable it covers its referent: claim id and **claim version** for claim-bound; the bound premise's root fingerprint (recursively) for internally premise-bound; coordinates including version for externally bound.
  - Consumer-defined extra fields are excluded.
- **`classifyLinks(response, targetFrom, targetTo)`** labels each link:
  - `unchanged`: same expression id present in `targetTo`, same fingerprint, same **position class**.
  - `changed`: id present but the fingerprint or position class differs. **Departure, an addition:** position class is root of a freeform premise / root of the conclusion premise / nested / inside a derivation premise. C5 carries a move differently by position class, so a step that moved from a premise root to a nested position changes what agreeing with the link does, even with an identical subtree.
  - `removed`: id absent.
  - Separately, `claimBindingConflicts`: each claim-bound variable in the response for a claim that `targetTo` uses and `targetFrom` did not. **Answers intake Q4.**
- **`rebaseResponse(decisions)`**, an `ArgumentEngine` mutation on the response:
  - **Departure:** the intake names this `rebaseChanges(response, classification, decisions)` and describes it as returning a changeset. No changeset can be produced without mutating an engine (see Non-goals), so it is a mutation like every other: it returns `TCoreMutationResult` whose `changes` the caller persists, and it rolls back entirely on any failure.
  - It moves `respondsTo` to `targetTo` and re-points every unchanged link.
  - Each changed or removed link takes a decision: `keep` (re-point and accept the new content), `retarget` (bind to a chosen expression of `targetTo`), or `drop` (remove the link premise; other premises stay).
  - Each claim-binding conflict takes `convertToLink` (replace the claim-bound variable's occurrences with an expression-bound variable on a chosen variable expression of that claim in `targetTo`, adding an affirm link if the response has none for it) or `drop` (remove the premises that use it).
  - A missing decision throws before anything changes. `canBind` is consulted for the new version.

### C5. Carrying answers along a path

- **Held statements.** The evaluation input gains `heldStatements?: Record<expressionId, boolean>`: "this reader holds this expression true or false".
  - A held value is joined into that expression's evaluated value in the knowledge order, the same merge propagation uses (`src/lib/core/evaluation/propagation.ts`, header comment). So agreeing with what the structure gives changes nothing, and disagreeing gives `CONTESTED`.
  - It is a reader assertion. It seeds propagation like a reader's variable value, and it is withheld in attribution counterfactuals like one.
  - It is excluded from `premiseSetSatisfiable` and from derivation suppression (`argument-evaluation.ts:270-296`), which ask about the argument's own premises.
  - A held statement on a single variable expression is the same as assigning that variable.
  - With no held statements, every result is identical to today's.
- **Departure, a simplification: a link answer is a held statement.** The intake adds `linkAnswers: Record<premiseId, "agree" | "disagree">` as a separate input. Here, "agree with link L" means "hold L's root true", and "disagree" means "hold it false". `linkAnswers` remains as a convenience that is translated into held statements, so there is one mechanism. This also settles the intake's depth rule without a special case: a link's effective answer is the value its root evaluates to for this reader, so values carried in from a later answer can make it false or contested, and then it carries nothing.
- **`evaluateResponse(input)`**: evaluates a response's premises under a reader's input, with the same propagation, contested reporting and provenance as `evaluate`. Returns each premise's value and each link's effective value. The intake had `evaluate` on a response point only at the checks; carrying needs this.
- **The conclusion step.** A new optional result field, `conclusionInferenceRejected: true`, is set when the reader rejects the conclusion premise's **root** operator.
  - The conclusion premise is not struck and stays out of `struckPremiseIds`, so its nested accepted operators keep propagating.
  - `conclusionTrue`, `premisesHoldConclusionFalse` and `conclusionAttribution` keep their formulas and values. An operator decision is never a truth value.
  - A rejection of a nested operator inside the conclusion premise stays ignored, and the reference documentation says so.
- **`carryAnswers(response, responseInput, targetSnapshot)`**: one step. It evaluates the response under the reader's input and returns a **carried input** for the target. For each link whose effective value is true:

  | Link move | Bound expression in the target | Carried |
  |---|---|---|
  | contradict / affirm | variable expression of a claim-bound variable | the claim false / true, on **every** variable bound to that claim in the target |
  | contradict / affirm | variable expression of an axiom-bound variable | nothing; reported as shown-not-carried (E-4 forbids assigning one, `evaluable.ts:102-113`) |
  | contradict / affirm | any other expression (compound, premise root, premise-bound variable) | a held statement on that expression |
  | undercut / reinforce | root operator of a freeform, non-conclusion premise | that operator `rejected` / `accepted` |
  | undercut / reinforce | root operator of the conclusion premise | `rejected` / `accepted`; a rejection sets `conclusionInferenceRejected` |
  | undercut / reinforce | a nested operator, or any operator in a derivation premise | nothing; reported as shown-not-carried |

  A link whose effective value is false, unknown or contested carries nothing. A contested one is listed so a caller can say why.
- **Provenance.** Every carried value names the response, the link premise and the move.
- **Carried input is its own layer.** **Departure:** the intake folds carried values into the reader's own input. Here the evaluation input gains `carried?: TCarriedInput`, kept apart from the reader's `variables`, `operatorAssignments` and `heldStatements`.
  - Carried and own values are joined in the knowledge order, so a disagreement surfaces as `CONTESTED` with provenance naming both sources, rather than one silently overwriting the other.
  - When carried and own operator decisions disagree on one operator, the step is treated as **not granted** (rejected), and the disagreement is reported in a new `operatorDecisionConflicts` field. Withholding is the direction that asserts nothing.
  - A carried rejection strikes the whole premise. The per-premise limitation (`docs/api-reference.md:383`) is cited in the documentation of this table.
- **Across depth. Answers intake Q3.**
  - Carrying Z into Y produces a carried input for Y. The caller evaluates Y with it and then carries Y into X.
  - Z affirming Y's link `L` holds `L`'s root true in Y. If the reader has not answered `L`, that makes `L` effectively agreed. If the reader disagreed with `L`, `L` comes out contested and carries nothing.
  - Z binding the inner `x` of Y's link `NOT(x)` holds `x` in Y. Contradicting `x` there *agrees* with Y's contradiction, and the evaluation shows it.
  - `carryAlongPath(snapshots, inputs)` loops the single step from newest to oldest, for convenience.

### C6. Link references

- `TLinkReference = { argumentId, argumentVersion, premiseId }`.
- `linkTargetsElement(reference, response, targetSnapshot, element)` is true when the referenced premise is a link of that response and:
  - for a claim element, the link binds a variable expression of that claim (any version of the claim);
  - for an expression element, the bound expression is that expression, or is the root of the premise containing it.
  - These are the intake's rules, unchanged.

### C7. Release

- **Major version, 6.0.0.**
  - A second argument kind removes the guarantee that every evaluable argument has one conclusion.
  - The variable union gains a member, so a consumer's code switching over every variable shape stops compiling or falls through.
  - Neither alone is large, but together they change what consumers can assume about every argument and every variable.
  - Per the maintainer's decision at request time, the two backlog items that also break compatibility ship in the same release: the calendar-date type for citation dates and the at-most-one operator. They keep their own items and their own specs. This item's release waits for both.
- Changelog, release notes and API reference follow this repository's documentation entries. Release notes carry a migration section on the union widening and the new argument kind.
- Before release, build the validation tarball (`pnpm run build && pnpm run pack:branch`), report its path to the requester, and release only after the requester reports the validation verdict.

## Acceptance criteria

Each criterion names the test file that pins it. All are new tests unless stated.

1. **Kinds** (`test/core/response-kind.test.ts`):
   - A response with premises and no conclusion validates at every tier.
   - A standard argument with premises and no conclusion still fails E-7.
   - A response loaded from a snapshot with a conclusion fails E-8.
   - A snapshot with `kind: "response"` and no `respondsTo`, or `respondsTo` naming itself, fails to load with an S-15 violation.
2. **No promotion** (same file): on a response, `createPremise` leaves no conclusion; `removePremise` leaves no conclusion; `setConclusionPremise` throws.
3. **Checksums unchanged** (`test/core/checksum-stability.test.ts`): fixtures captured with `@proposit/proposit-core@5.4.2` cover each entity type, including an argument with a conclusion, a premise-bound variable and an enthymeme mark. Every argument, premise, expression, variable and combined checksum recomputed by the new build equals the captured value.
4. **Inference binding** (`test/core/response-links.test.ts`): `validateLinks` reports an inference-aspect binding on a variable expression; it reports none on an `and`, a `not`, or an `implies` inside a derivation premise.
5. **Moves** (same file):
   - `listLinks` reports `NOT(x)` statement-bound as contradict, `x` as affirm, `NOT(s)` inference-bound as undercut, `s` as reinforce.
   - A premise `p` with a claim-bound `p` is not listed.
   - `validateLinks` reports a claim-bound variable for a claim the target uses, and does not report one for a claim only an older argument uses.
   - Binding a second variable to the same referent returns the first.
6. **Held statements** (`test/evaluation/held-statements.test.ts`):
   - Holding `A ∧ B` false in an argument that asserts `A ∧ B` leaves `premiseSetSatisfiable` equal to its value without the held statement, and reports that premise's root as false or `CONTESTED`.
   - Every existing test in `test/evaluation/` passes unchanged with `heldStatements` absent.
7. **`checkLink`** (`test/core/response-check.test.ts`):
   - {R, R→¬x, ¬x}: `follows`, `supportPremiseIds` = {R, R→¬x}.
   - {R→¬x, ¬x}: `asserted`, `attemptedSupport: true`.
   - {¬x}: `asserted`, `attemptedSupport: false`.
   - {p, p→¬c, ¬c} with `p` an affirm link: `p` `asserted`, `attemptedSupport: false`; `¬c` `follows`, `restsOnlyOnLinks: false`.
   - Undercut ¬s with R and R→¬s: `follows`.
   - {¬x, ¬y, ¬y→¬x, ¬x→¬y}: both `follows`, both `restsOnlyOnLinks: true`; adding R and R→¬y makes both `restsOnlyOnLinks: false`.
   - A citation S with derivation premise S→D and D→¬x: ¬x `follows`.
   - A response with 17 merged variables returns `undetermined` / `too-many-variables` and does not throw.
8. **Coherence** (same file): `checkResponseCoherent` is `false` for `x` with `NOT(x)`; for contradict `Q ∧ R` with affirm Q and affirm R; and for two links on two occurrences of one claim used as `x` and `NOT(x')`.
9. **Classification** (`test/core/response-rebase.test.ts`):
   - Two target versions with no edits give every link `unchanged`.
   - `P→Q` edited to `P→R` is `changed`.
   - Claim Q's version bumped under an undercut of `P→Q` is `changed`.
   - A deleted operator is `removed`.
   - An unchanged operator moved from a premise root to a nested position is `changed`.
   - A claim newly used by `targetTo` and claim-bound in the response appears in `claimBindingConflicts`.
   - `rebaseResponse` with a missing decision throws and leaves the engine's snapshot unchanged.
10. **Carrying** (`test/evaluation/carry-answers.test.ts`):
    - Agreeing with a contradict on a claim sets every variable of that claim false in the carried input.
    - Agreeing with a contradict on `Q ∧ R` yields a held statement.
    - Agreeing with an undercut of the conclusion premise's root operator makes the target's evaluation report `conclusionInferenceRejected: true`, with `conclusionTrue` equal to its value without the carried input.
    - An agreed undercut on a nested operator or a derivation operator, and an agreed contradict on an axiom-bound variable, each appear as shown-not-carried, and nothing throws.
    - A carried value opposing the reader's own yields `CONTESTED` with provenance naming both.
    - Opposing operator decisions yield a struck premise and an `operatorDecisionConflicts` entry.
11. **Conclusion step alone** (`test/evaluation/conclusion-step.test.ts`):
    - Rejecting the conclusion's root operator sets `conclusionInferenceRejected` and changes no other result field compared with the same input without it.
    - Rejecting a nested operator in the conclusion sets nothing.
12. **Forking** (`test/core/fork.test.ts`, extended): forking an argument holding an external premise-bound variable succeeds and keeps the binding unchanged. This test is written first and fails at `90578ec3`. Forking a response keeps `kind`, `respondsTo` and every expression binding.
13. **CLI** (`test/cli/`): `render`, `graph` and `roles show` on a response snapshot exit 0 and show no conclusion marker; `roles set-conclusion` on a response exits non-zero.
14. **Public surface:** `docs/api-surface.txt` gains only the names in this spec, and none of them names accounts, ownership, storage, availability or limits on users. `pnpm run check` passes.

## Risks

- **Size.** Seven parts touching validation, evaluation, checksums, forking and the CLI. The plan should land them in an order where each step passes `pnpm run check`: kinds, then bindings, then checks, then rebasing, then carrying.
- **Evaluation invariants.** Held statements and the carried layer enter the propagation merge, which core's guide calls load-bearing (monotone, order-independent). A held statement must be a seed joined like any other, never an overwrite. A test must show that the closure is the same whatever order the inputs are visited in.
- **Attribution.** Held statements are reader assertions. If the plan routes them through `forcedTrueVariableIds` it will invert `reachedWithoutAssertion`, the trap the guide documents. They must not go there.
- **Exponential checks.** `checkLink`'s minimal-set search runs the entailment test once per premise, and grounding repeats it per link. With the default ceiling of 16 that is about 65,000 rows per test. The plan should measure a worst case under the ceiling.
- **Releasing with two other items.** Batching ties this release to two items that today have only an intake or a request. If either stalls, the maintainer will need to decide whether to unbatch.
- **Departures from the intake.** The requester should confirm each one marked above before planning, in particular:
  - derivation premises counting in `checkLink`;
  - link answers as held statements;
  - carried input as a separate layer;
  - opposing decisions treated as not granted;
  - `rebaseResponse` as a mutation.

## Notes

- `canBind` effectively not running on load is existing behaviour (`fromSnapshot` constructs the base class), not something this change adds.
- Rule numbers S-15, S-16, E-8 and E-9 are the next free numbers in their tiers (E-2 is unused and is left unused). They become stable wire format when released.
- Can any part ship alone? The conclusion-step flag and held statements are useful without responses. The maintainer prefers fewer, larger items and the requester validates them together, so they stay here. The plan may order them first.
