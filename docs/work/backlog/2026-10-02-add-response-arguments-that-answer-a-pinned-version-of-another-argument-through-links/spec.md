# Spec: response arguments that answer a pinned version of another argument through links

Second revision, after the first adversarial review (verdict NOT DONE). Line numbers are against `90578ec3`. "The intake" is this item's `intake.md`; sections C1–C7 follow its numbering. Every place this spec departs from the intake is marked **Departure**, with the reason. `## Notes` lists how each review finding was handled.

**Scope after the split** (see the dated amendment in `initial-request.md`):
- **Here:** C1 argument kinds, C2 links, C3 checks, C4 rebasing, C6 link references, and the conclusion-step flag from C5.
- **Elsewhere:** the rest of C5 — held statements, a response's evaluation under a reader's input, and carrying answers — is `2026-10-02-carry-a-reader-s-agreement-with-a-response-argument-into-the-argument-it-answers`.
- **Already fixed:** the fork defect found while specifying this is `2026-10-02-forking-breaks-bindings-into-another-argument`, released as 5.4.3. This item builds on that fix.

## Capability changes

The capability ledger for this repository is empty (`tcw capabilities list` prints nothing), so no ledger record changes. The taxonomy gains entries at implementation time:

- **Vocabulary:**
  - **response argument** (under `argument`);
  - **link** (a premise of a response that is one bound variable or its negation);
  - **expression-bound variable** (under `propositional-variable`);
  - **move** (contradict / affirm / undercut / reinforce).
- **Features:**
  - **response checking** (`validateLinks`, `checkLink`, `checkResponseCoherent`);
  - **response rebasing** (`structuralFingerprint`, `classifyLinks`, `rebaseResponse`).
- **Changed features:** `argument-construction` gains responses and the expression binder; `argument-evaluation` gains the conclusion-step flag.

## Problem

An argument here is one set of premises, asserted together, with one conclusion premise (rule E-7, `src/lib/grammar/validators/evaluable.ts:194-235`). Nothing lets one argument answer another:

- The only relationship between two arguments is a fork record, which means "copied from" (`src/lib/schemata/fork.ts:14-26`).
- An objection written into the argument it objects to makes that argument assert both sides.
- Denying that a step follows exists only on the reader's side. `operatorAssignments[id] = "rejected"` strikes the premise and asserts nothing (`src/lib/core/evaluation/argument-evaluation.ts:249-268`). Writing `NOT(P → Q)` instead asserts "P and not Q", which is not what someone conceding P and Q means.
- A rejection recorded against the conclusion premise is ignored (`argument-evaluation.ts:255-259`), so a reader cannot withhold the final step at all.

## Goals

1. **A response:** an argument that answers exactly one other argument at a pinned version and has no conclusion premise.
2. **Links:** premises of a response bound, by expression, into the argument it answers. Each makes exactly one of four moves, read from its content alone.
3. **Checks** on a response that need only content plus a target snapshot the caller supplies:
   - each binding still resolves;
   - each link follows from the rest of the response, or is a base assertion;
   - the response is consistent with itself.
4. **Bringing a response up to a newer version of its target:** classify what happened to each link, then re-point the links under the caller's decisions.
5. **The conclusion step:** a reader may reject the conclusion premise's root step, reported in a new field.
6. **Nothing existing changes:**
   - no checksum of existing data changes;
   - no evaluation result field changes value for any input expressible today;
   - every standard argument validates and evaluates exactly as before.

## Non-goals

- Who wrote or answered anything, storage, availability of versions, display. Core never fetches a snapshot. Allow/refuse policy stays on the existing `canBind` hook.
- Carrying answers along a chain, held statements, and evaluating a response under a reader's input. These are the sibling item.
- Parsing responses from text (`src/lib/parsing/`) or producing them from the ingestion pipelines (`src/extensions/pipelines/`). Both keep producing standard arguments.
- **Response arguments in the CLI.** No CLI command can create one, and the CLI's argument storage holds only string metadata (`src/cli/schemata.ts:9-17`) and writes only id, title and description (`src/cli/engine.ts:228-241`). So a response cannot enter CLI storage, and the CLI's conclusion readers can never meet one.
  - **Departure:** the intake lists the CLI's conclusion readers among the sites to change. Changing them would build CLI support for data the CLI cannot hold.
  - The CLI documentation says responses are a library feature.
- Renaming the code `checkValidity` uses for a too-many-variables refusal (`ASSIGNMENT_UNKNOWN_VARIABLE`, `argument-evaluation.ts:614-627`). It is wrong, but engine-error codes are stable wire format, and core cannot see which consumers match it. It stays. The new checks use a correct code of their own.
- A generic "apply a changeset to an engine" function. None exists; changesets come only from engine mutations (`src/lib/core/change-collector.ts`).

## Design

### Words

- **Standard argument**: every argument today. **Response**: an argument carrying `respondsTo`. **Target**: the argument named by `respondsTo`, at its pinned version.
- **Path**: `X ← Y ← Z`, where Y answers X and Z answers Y. Any depth.
- **Expression-bound variable**: a variable whose meaning is one expression of the target (C2).
- **Link**: a premise of a response whose entire content is `x` or `NOT(x)`, where `x` is an expression-bound variable.
- **Moves**:

  | | Attack | Support |
  |---|---|---|
  | **Statement aspect**: is it true? | **contradict**: `NOT(x)` | **affirm**: `x` |
  | **Inference aspect**: does the step hold? | **undercut**: `NOT(s)` | **reinforce**: `s` |

**Assumption, stated because C4 depends on it:** a consumer that copies an argument into a new version keeps the id of every entity that persists. Core already documents this as the id-stability contract under `diffArguments` (`docs/api-reference.md`). The intake states it for its own versioning.

### C1. Responses

- **One field.** The argument entity (`src/lib/schemata/argument.ts:4-25`, which allows additional properties) gains optional `respondsTo: { argumentId, argumentVersion }`. An argument is a response exactly when the field is present.
  - **Departure:** the intake adds `kind: "standard" | "response"` as well. A `kind` that could say `"standard"` would be a present key on some standard arguments and an absent one on others. Under `entityChecksum`'s key-presence rule (`src/lib/core/checksum.ts:36-47`), those would checksum differently while meaning the same thing. A `kind` whose only legal value is `"response"` carries no information `respondsTo` does not already carry. So there is one field.
  - This also drops a generic field name likely to collide with consumer data.
- **Engine-owned.** `respondsTo` is set when the engine is constructed and changed only by `rebaseResponse` (C4), never by `setExtras`. Today `setExtras` replaces every argument field except id, version and the three checksums (`argument-engine.ts:727-752`). Left as is, a consumer's `setExtras({ title })` would strip `respondsTo` and silently turn a response into a standard argument with no conclusion, and `setExtras({ respondsTo })` would bypass every guard. Instead:
  - `getExtras` (`:715`) excludes `respondsTo`;
  - `setExtras` keeps it and throws if the input names it.
- **Checksums.**
  - `respondsTo` joins the default `argumentFields` (`src/lib/checksum-config.ts:45`, `src/lib/types/checksum.ts:9-12`). It is hashed only when present, so every existing argument checksum is unchanged.
  - A consumer that builds its configuration with `createChecksumConfig` gets the new default automatically, because that function adds the defaults to the consumer's sets every time it runs (`checksum-config.ts:130-140`).
  - A configuration persisted inside an older snapshot (`argument-engine.ts:1859`) is an explicit set and will not include the new field. The release notes tell consumers to rebuild their configuration rather than reuse a stored one.
- **Structural invariants, checked on every mutation and on load.** Grammar validators run only through `engine.validate(tier)` (`src/lib/grammar/validate.ts:24`), so these are added to `validateArgument` (`src/lib/core/argument-validation.ts:209ff`), which `fromSnapshot` and `fromData` already run (`argument-engine.ts:1958-1959`, `2101`). Each is also reported by the grammar as **S-15**:
  - `respondsTo.argumentId` differs from the argument's own id;
  - an expression-bound variable exists only in a response (C2).
- **Engine behaviour for a response:**
  - `createPremise` does not make the first premise the conclusion (today it does, `argument-engine.ts:955-958`);
  - removing a premise promotes nothing (today the smallest remaining id is promoted, `:1066-1076`);
  - `setConclusionPremise` throws (`:1753-1777`);
  - snapshot restore and `fromData` load a response without setting a conclusion (`:1939-1940`, `:2082-2083`).
- **Validation.**
  - E-7 passes for a response with no conclusion.
  - A response that has a conclusion premise is a new Evaluable rule, **E-8**. It is Evaluable rather than Structural so that such data still loads and can be repaired.
  - `validateArgumentEvaluability` does not raise `ARGUMENT_NO_CONCLUSION` for a response (`argument-validation.ts:402-417`).
  - D-6 (`src/lib/grammar/validators/derivable.ts:491-511`) is unaffected.
- **Evaluation.** `evaluate()` and `checkValidity()` on a response return `ok: false` with a new engine-error code, `ARGUMENT_IS_RESPONSE`. Today both return `ARGUMENT_NO_CONCLUSION` (`argument-evaluation.ts:199-210`, `563-574`). Evaluating a response under a reader's input is the sibling item.
- **Supporting premises.** In a response, `listSupportingPremises` returns the premises that are not links. Today it returns inference premises other than the conclusion (`argument-engine.ts:1833-1842`). The reference documentation states both meanings. It also keeps the existing warning that the result is the wrong input for any total meant to speak for what the author offered.
- **Readers of the conclusion in the library** handle its absence:
  - rendering (`src/lib/core/argument/display.ts:16-27`, `argument-engine.ts:772`);
  - review ordering (`src/lib/core/review-helpers.ts:92-93`);
  - role diffing (`src/lib/core/diff.ts:410`, `455-456`).
- **Diffing.**
  - `defaultCompareArgument` returns no changes today (`diff.ts:20-26`). It gains a deep comparison of `respondsTo`.
  - `defaultCompareVariable`'s binding fields (`diff.ts:42-48`) gain the expression-binding fields.
  - Without both, a rebase is invisible to `diffArguments`.
- **Forking a response** produces a response with the same `respondsTo`. Expression-bound variables are copied with their bindings unchanged, as the 5.4.3 fix does for external premise bindings.

### C2. Expression-bound variables and links

- **New variable shape.** A third member of the variable union (`src/lib/schemata/propositional.ts:170-173`): base fields plus `boundExpressionId`, `boundArgumentId`, `boundArgumentVersion` and `boundAspect: "statement" | "inference"`.
  - The union has no discriminator; members are told apart by which keys are present (`isClaimBound`, `isPremiseBound`, `propositional.ts:180-191`). The new member is recognised by `boundExpressionId`, through a new guard `isExpressionBound`.
  - Every existing guard's answer is unchanged.
- **S-3 is redefined.** Today it reports any variable with "neither claim nor premise reference" (`src/lib/grammar/validators/structural.ts:165-198`), which every expression-bound variable would trip. It becomes: exactly one of a claim reference, a premise reference or an expression reference.
  - The code `S-3` keeps its name. Its message for the "none" case changes wording.
  - A variable carrying two kinds of reference is also an invariant violation in `validateArgument`. The schema alone cannot catch one, because both existing union members allow additional properties (`propositional.ts:131-173`).
- **Checksums.** The four fields join the variable checksum fields and are hashed only when present, as `boundPremiseId` is today.
- **Columns.** Wherever evaluation and satisfiability decide which variables are free columns (claim-bound or externally premise-bound, `argument-evaluation.ts:240-247`, `604-612`, and the satisfiability free set), expression-bound variables are free columns too.
- **Binder.** `bindVariableToExpression(variable)` on `ArgumentEngine`:
  - throws if the argument is not a response, or if `boundArgumentId` / `boundArgumentVersion` differ from `respondsTo`;
  - calls `canBind(boundArgumentId, boundArgumentVersion)` and throws if it refuses, as `bindVariableToExternalPremise` does (`argument-engine.ts:1287`);
  - if a variable with the same **raw referent** `(boundArgumentId, boundExpressionId, boundAspect)` exists, returns it instead of adding another, as `ensureClaimBoundVariable` does for claims. A duplicate arriving by snapshot is a new Evaluable rule, **E-9**.
  - The binder sees no target, so it cannot know that two expressions are occurrences of one claim. It does not try. Merging those is a check-time step (C3).
- **Loading.**
  - Snapshot restore and `fromData` restore claim-bound and premise-bound variables in two loops (`argument-engine.ts:1914-1938`, `2045-2060`), so expression-bound variables would be skipped. Both gain the third shape, through the binder.
  - `fromSnapshot` constructs the base class, so a subclass's `canBind` is not consulted on load; that stays true. A response whose target the consumer no longer offers still loads.
- **Version mismatch.** A loaded expression-bound variable whose `boundArgumentId` matches `respondsTo` but whose `boundArgumentVersion` does not is a new Evaluable rule, **E-10**, not a load failure. A partly saved rebase must remain loadable so that it can be finished. A different `boundArgumentId` is part of S-15 and fails to load.
- **Updating a variable.** `updateVariable` guards conversions between the two existing shapes (`argument-engine.ts:1317-1386`). It gains two refusals:
  - it refuses any change to an expression-bound variable's four binding fields; only `rebaseResponse` re-points a link;
  - it refuses converting to or from the expression-bound shape.
- **What a link is.** A premise is a link exactly when its whole content is a single variable expression, or `NOT` over one, and that variable is expression-bound. The move comes from the aspect and the presence of `NOT`. Nothing else is stored, so a link cannot disagree with its own content.
- **`validateLinks(response, targetSnapshot)`.** It throws unless the snapshot's id and version equal `respondsTo`. It reports:
  - a bound expression missing from the snapshot;
  - an inference-aspect binding whose expression is not an operator. Any operator is allowed: `and`, `or`, `not`, `implies`, `iff`, and operators inside derivation premises.
  - a claim-bound variable in the response for a claim the target uses. The response affirms such a claim through a link instead. A claim used only further back along the path may be claim-bound, as the response's own assertion.
  - two links on different occurrences of one claim with the same aspect. This is reported as information, not as a violation.
- **Sources and axioms.** D-4 and D-5 (`docs/Proposit_Grammar.md:526-543`) keep citation- and axiom-bound variables inside derivation antecedents. They do not apply to expression-bound variables, so a response may contradict or undercut anything in its target that rests on a source or an axiom.
  - **Accepted limitation:** a response cannot deny a source cited two steps back along the path. Links reach only the immediate target, and D-4 and D-5 forbid placing the response's own citation variable under `NOT`.
- **Helpers.**
  - `listLinks(response)` gives each link's premise id, variable id, bound expression, aspect and move.
  - `elementsWithinPremise(targetSnapshot, premiseId)` gives every expression id and claim id in a premise.

### C3. Checking a response

All three checks take the target snapshot and throw unless its id and version equal `respondsTo`. Before working, each **merges variables by referent**:

- **Claim-bound variables sharing a claim id** are merged. Core allows several per claim (see the guide's invariant on a claim binding more than one variable).
- **A statement-aspect variable** bound to a variable expression of a claim-bound variable in the target stands for that claim. It merges with every other variable that stands for the claim. This answers intake Q1 at check time, where the target is available.
- **When the target is itself a response,** a statement-aspect variable bound to a variable expression of one of the target's own expression-bound variables stands for that variable's raw referent. So two links on two occurrences of the target's `x` merge.

The search uses the existing grouped satisfiability search, `isPremiseSetSatisfiable` (`src/lib/core/evaluation/satisfiability.ts:132`):
- "S entails F" is computed as "S plus not-F is unsatisfiable".
- The search splits premises into groups that share no variable and enforces its ceiling per group (`satisfiability.ts:13-18`).
- Any group over the ceiling makes the answer undetermined. This replaces running the full evaluation on every one of 2ⁿ rows, which the review showed is far slower and applies the ceiling to the wrong count.

**Seeding:**
- The response's own grounded variables (citation- and axiom-bound) are seeded true, exactly as `checkValidity` seeds them (`argument-engine.ts:2561-2586`).
- Claims reached by expanding a binding into the target are never seeded. The response may deny them.
- Unpopulated naked-Q derivation stubs are excluded, as the evaluation context already excludes them (`argument-engine.ts:2484-2510`). Otherwise a stub would assert its claim outright.

**`checkLink(response, linkPremiseId, targetSnapshot)`** asks whether the link's content follows from the response's other premises, derivation premises included.
- **Departure:** the intake excludes derivation premises. In core a source supports a claim only through a derivation premise (`IMPLIES(source, Q)`), so excluding them would make every source-backed objection read as an unsupported assertion.
- `status` is one of:
  - `follows`, with `supportPremiseIds`: a minimal set of other premises from which it follows, found by removing premises one at a time while it still follows. "Minimal" means no premise can be removed; it is not necessarily the smallest such set.
  - `asserted`: it does not follow. Comes with one counterexample and `attemptedSupport`.
  - `incoherent`: the other premises cannot all hold under the seeding. Anything would "follow" from them, so the check refuses to say it does.
  - `undetermined`, with `reason: "too-many-variables"`: a group exceeds the ceiling. It never throws for size. This answers intake Q2.
- `attemptedSupport` (with `asserted`) is true when another premise has the link's referent on its consequent side: right of `→`, either side of `↔`, at any depth below a `NOT` there. Inference referents count.
- `restsOnlyOnLinks` (with `follows`) is true when the link follows but is not **grounded**. A link is grounded when it is `asserted`, or when it follows from the non-link premises together with links already grounded, repeated until nothing changes. The fixpoint is computed once per response and reused by every `checkLink` call.

**`checkResponseCoherent(response, targetSnapshot)`** asks whether all the response's premises can hold at once.
- Each statement-aspect variable is expanded to its meaning in the target, down to claims. A binding to `Q ∧ R` behaves as `q ∧ r`, so "contradict `Q ∧ R`" with "affirm Q" and "affirm R" is incoherent.
- Inference-aspect variables stay free.
- Internally premise-bound variables in the target expand to their bound premise's root. External ones stay free.
- Seeding is as above, the same as `checkLink`'s, so the two checks cannot disagree about a source.
- Returns `coherent: true | false | null`; `null` means undetermined. When `false`, it also returns a minimal unsatisfiable set of premise ids.

**Size refusals** in this section carry the new engine-error code `TOO_MANY_VARIABLES`.

### C4. Bringing a response up to a newer target version

- **`structuralFingerprint(snapshot, expressionId)`.** A hash over a subtree's shape that ignores the argument's ids and versions.
  - Stored checksums cannot serve: expression checksums include `argumentVersion`, `parentId`, `premiseId` and `variableId` (`src/lib/checksum-config.ts:18-28`). Nothing in the library computes such a hash today, and `diffArguments` matches by id (`src/lib/core/diff.ts:70-115`, `365`).
  - The hash covers each node's type, operator and child order, and for each variable its referent:
    - claim-bound: claim id and **claim version**, so an edit to a claim beneath a step counts;
    - internally premise-bound: the bound premise's root fingerprint, recursively; binding is acyclic, `src/lib/core/argument/circularity.ts`;
    - externally premise-bound: `(boundArgumentId, boundPremiseId)`;
    - expression-bound: `(boundArgumentId, boundExpressionId, boundAspect)`.
  - Versions of other arguments are left out. Otherwise every rebase of Y would mark every one of Z's links into Y as changed. Consumer-defined extra fields are excluded.
- **`classifyLinks(response, targetFrom, targetTo)`** throws unless `targetFrom` equals `respondsTo` and `targetTo` has the same argument id. It labels each link:
  - `unchanged`: the same expression id is present in `targetTo`, with the same fingerprint and the same **position class**.
  - `changed`: the id is present, but the fingerprint or the position class differs.
    - **Departure, an addition:** position class is one of root of a freeform premise, root of the conclusion premise, nested, or inside a derivation premise. The sibling item carries a move differently by position class, and a move from root to nested changes what a link says even with an identical subtree.
  - `removed`: the id is absent.

  Separately, `claimBindingConflicts` lists each claim-bound variable in the response for a claim that `targetTo` uses and `targetFrom` did not. This answers intake Q4.
- **`rebaseResponse(targetFrom, targetTo, decisions)`** is an `ArgumentEngine` mutation on the response.
  - **Departure:** the intake names this `rebaseChanges` and describes it as returning a changeset. No changeset can be produced without mutating an engine. So, like every other mutation, it returns `TCoreMutationResult`, whose `changes` (including the argument entity's new `respondsTo`) the caller persists, and it rolls back entirely on any failure.
  - It recomputes the classification itself rather than trusting one passed in.
  - It consults `canBind` for `targetTo`.
  - It sets `respondsTo` to `targetTo` and re-points every unchanged link.
  - Each changed or removed link takes one of three decisions:
    - `keep`: re-point it, accepting the new content;
    - `retarget`: bind it to a chosen expression of `targetTo`;
    - `drop`: remove the link premise; other premises stay.
  - Each claim-binding conflict takes one of two decisions:
    - `convertToLink`: replace the claim-bound variable's occurrences with an expression-bound variable on a chosen variable expression of that claim in `targetTo`, adding an affirm link if the response has none for it;
    - `drop`: remove the premises that use it.
  - A missing decision throws before anything changes.
- **Foreign keys.** An expression-bound variable names an expression in another argument, exactly as an externally premise-bound variable already names a premise in another argument. `orderChangeset` (`src/lib/utils/changeset-order.ts`) orders only within one argument, and the target exists before the response does, so the ordering is unchanged. The reference documentation names the new cross-argument reference so that a consumer adding a database foreign key knows it exists.
  - **Departure:** the intake listed `changeset-order.ts:108-109` among the conclusion readers. That line is a comment about a standard argument's conclusion. The real interaction is this foreign key.

### C5 (part). The conclusion step

- **A new optional result field, `conclusionInferenceRejected: true`.** It is set when the reader rejects the conclusion premise's **root** operator.
- The conclusion premise is not struck and stays out of `struckPremiseIds`, so its nested accepted operators keep propagating.
- `conclusionTrue`, `premisesHoldConclusionFalse` and `conclusionAttribution` keep their formulas and values. An operator decision is never a truth value.
- A rejection of a nested operator inside the conclusion premise stays ignored. The reference documentation says so.

### C6. Link references

- `TLinkReference = { argumentId, argumentVersion, premiseId }`.
- `linkTargetsElement(reference, response, targetSnapshot, element)` is true when the referenced premise is a link of that response and:
  - for a claim element, the link binds a variable expression of that claim (any version of the claim);
  - for an expression element, the bound expression is that expression, or is the root of the premise containing it.
- These are the intake's rules, unchanged.

### C7. Release

- **The version is 6.0.0.** The maintainer confirmed that 6.0.0 carries many changes beyond this work, so the version number is not this item's to justify. What this item contributes to it:
  - a second argument kind, which removes the guarantee that every argument evaluates against one conclusion;
  - a third member of the variable union.
- **Batched with it,** by the maintainer's decision: the sibling carrying item, the calendar-date type for citation dates, and the at-most-one operator.
  - The at-most-one operator also changes `propagation.ts` and `belnap.ts`.
  - This spec's rules that say "any operator" (inference links, fingerprints) cover it automatically, since they name no operator list.
  - The combined change still gets its own review before release.
- Changelog, release notes and API reference follow this repository's documentation entries. The release notes carry a migration section covering:
  - the union widening;
  - responses and `ARGUMENT_IS_RESPONSE`;
  - S-3's widened meaning;
  - `setExtras` refusing `respondsTo`;
  - rebuilding a checksum configuration rather than reusing a stored one.
- Before release, build the validation tarball (`pnpm run build && pnpm run pack:branch`), report its path to the requester, and release only after the requester reports the verdict.

## Acceptance criteria

Each names the test file that pins it. All are new unless stated.

1. **Responses** (`test/core/response-kind.test.ts`):
   - A response with premises and no conclusion passes `validate("presentable")` and `validateInvariants()`.
   - A standard argument with premises and no conclusion still fails E-7.
   - A response loaded with a conclusion fails E-8.
   - A snapshot whose `respondsTo` names its own argument fails to load.
2. **No promotion** (same file): on a response, `createPremise` leaves no conclusion; `removePremise` leaves no conclusion; `setConclusionPremise` throws.
3. **Engine-owned field** (same file):
   - `setExtras({ title: "t" })` on a response keeps `respondsTo`;
   - `setExtras({ respondsTo: … })` throws;
   - `getExtras()` has no `respondsTo`.
4. **Round trips** (same file): a response with one link of each move, a claim-bound premise and a derivation premise survives `snapshot()` → `fromSnapshot`, and `fromData`, with every variable, premise and checksum equal.
5. **Checksums unchanged** (`test/core/checksum-stability.test.ts`).
   - Fixtures captured with `@proposit/proposit-core@5.4.2` cover:
     - an argument with a conclusion;
     - claim-bound, internally and externally premise-bound variables;
     - an enthymeme mark;
     - a derivation premise.
   - Every argument, premise, expression, variable and combined checksum recomputed by the new build equals the captured value. This holds under the default configuration, under one built with `createChecksumConfig` adding consumer fields, after `forkArgumentEngine`, after a snapshot round trip, after `fromData`, and after `setExtras` on a standard argument.
6. **Shapes** (`test/core/response-links.test.ts`):
   - an expression-bound variable passes S-3;
   - a variable carrying both `claimId` and `boundExpressionId` fails to load;
   - an expression-bound variable in a standard argument fails to load;
   - one whose `boundArgumentVersion` differs from `respondsTo` loads and fails E-10;
   - `updateVariable` on a binding field throws.
7. **Inference binding** (same file): `validateLinks` reports an inference-aspect binding on a variable expression, and none on an `and`, a `not`, or an `implies` inside a derivation premise.
8. **Moves** (same file):
   - `listLinks` reports `NOT(x)` statement-bound as contradict, `x` as affirm, `NOT(s)` inference-bound as undercut, `s` as reinforce;
   - a premise `p` with a claim-bound `p` is not listed;
   - `validateLinks` reports a claim-bound variable for a claim the target uses, and does not report one for a claim only an older argument uses;
   - binding a second variable with the same raw referent returns the first.
9. **`checkLink`** (`test/core/response-check.test.ts`):
   - {R, R→¬x, ¬x}: `follows`, `supportPremiseIds` = {R, R→¬x}.
   - {R→¬x, ¬x}: `asserted`, `attemptedSupport: true`.
   - {¬x}: `asserted`, `attemptedSupport: false`.
   - {p, p→¬c, ¬c} with `p` an affirm link: `p` is `asserted` with `attemptedSupport: false`; `¬c` `follows` with `restsOnlyOnLinks: false`.
   - Undercut ¬s with R and R→¬s: `follows`.
   - {¬x, ¬y, ¬y→¬x, ¬x→¬y}: both `follows`, both `restsOnlyOnLinks: true`. Adding R and R→¬y makes both `restsOnlyOnLinks: false`.
   - A citation S with derivation premise S→D, plus D→¬x: ¬x `follows`.
   - A citation S with derivation premise S→D, plus `NOT(D)`: every link is `incoherent`.
   - One group of 17 variables returns `undetermined` and does not throw.
   - Two independent groups of 10 variables each are decided.
10. **Coherence** (same file): `checkResponseCoherent` is `false` for:
    - `x` with `NOT(x)`;
    - contradict `Q ∧ R` with affirm Q and affirm R;
    - links on two occurrences of one claim used as `x` and `NOT(x')`;
    - the S→D, `NOT(D)` case above.
11. **Classification** (`test/core/response-rebase.test.ts`):
    - Two target versions with no edits give every link `unchanged`.
    - `P→Q` edited to `P→R` is `changed`.
    - Claim Q's version bumped under an undercut of `P→Q` is `changed`.
    - A deleted operator is `removed`.
    - An unchanged operator moved from a premise root to a nested position is `changed`.
    - Rebasing Y does not mark Z's unchanged links into Y as `changed`.
    - A claim newly used by `targetTo` and claim-bound in the response appears in `claimBindingConflicts`.
    - `rebaseResponse` with a missing decision throws and leaves the snapshot unchanged.
    - After a successful rebase, `diffArguments` between the before and after snapshots reports the `respondsTo` change and each re-pointed variable.
12. **Conclusion step** (`test/evaluation/conclusion-step.test.ts`):
    - Rejecting the conclusion's root operator sets `conclusionInferenceRejected`, and every other result field equals its value for the same input without the rejection.
    - Rejecting a nested operator in the conclusion sets nothing.
13. **Forking** (`test/core/forks.test.ts`, extended): forking a response keeps `respondsTo` and every expression binding.
14. **Evaluation refusal** (`test/core/response-kind.test.ts`): `evaluate()` and `checkValidity()` on a response return `ARGUMENT_IS_RESPONSE`.
15. **Public surface:**
    - `docs/api-surface.txt` gains only the names in this spec;
    - none of them names accounts, ownership, storage, availability or limits on users;
    - every existing test passes unchanged;
    - `pnpm run check` passes.

## Risks

- **Size.** The plan should land the pieces in an order where each step passes `pnpm run check`: shapes and invariants, then the binder and loading, then the checks, then rebasing, with the conclusion-step flag independent of all of them.
- **S-3's widened meaning** is a wire-format change in what the rule accepts. A consumer that reacts to S-3 by assuming the only two shapes would mishandle the third. The release notes must name it.
- **Merge-by-referent** happens only inside the checks, so the engine can hold two links on two occurrences of one claim. `validateLinks` reports this, and the checks treat them as one. A consumer that counts links by claim must do the same merge. The reference documentation says so.
- **Exponential checks.** The minimal-set search and the grounding fixpoint each call the satisfiability search once per premise or link. The grouped search bounds each call, but a response with many links in one large group will be slow just under the ceiling. The plan measures a worst case.
- **The batched release** now holds four items, two of which have no spec yet. If either stalls, the maintainer decides whether to unbatch.

## Notes

How the first review's findings were handled. Findings about carrying moved to the sibling item: blocking 1 and 2, and significant 2 and 3.

- **Blocking 3 (referent merging needs the target):** accepted. The binder and E-9 deduplicate on the raw referent only. Claim merging happens at check time, where the target is supplied. Responses that answer responses are covered.
- **Blocking 4 (S-3, load path, restore loops, `updateVariable`):** accepted. All are listed in C1 and C2. The two Structural checks are added to `validateArgument` so they block loading.
- **Blocking 5 (`setExtras`):** accepted. `respondsTo` is engine-owned.
- **Significant 1 (coherence and `checkLink` seeding disagreed):** accepted. Both use one seeding. `checkLink` reports `incoherent` instead of a vacuous `follows`. Naked-Q stubs are excluded.
- **Significant 4 (no truth-table columns):** accepted.
- **Significant 5 (diff comparators, `orderChangeset`, CLI storage):**
  - Diff comparators and the foreign-key note: accepted.
  - CLI: narrowed. Responses are a non-goal for the CLI, since it cannot store them.
- **Significant 6 (checksum holes):**
  - The acceptance criterion now covers configurations, forks, round trips, `fromData` and `setExtras`.
  - The requester was checked by reading its code. It has no `kind` or `respondsTo` field, and builds its configuration with `createChecksumConfig`.
  - Stored configurations go in the release notes.
- **Significant 7 (tiers):** accepted. A version mismatch is Evaluable (E-10). Self-reference and a misplaced expression-bound variable are Structural.
- **Significant 8 (fingerprint cascading down chains):** accepted. Other arguments' versions are left out.
- **Significant 9 (release):**
  - The fork defect shipped separately as 5.4.3.
  - On the version: the maintainer confirmed 6.0.0 carries many other changes.
  - The combined review with the at-most-one operator is recorded in C7.
- **Significant 10 (defect 2):** narrowed. The existing code stays, and new checks use their own.
- **Alternatives:**
  - Dropping `kind`: adopted.
  - Entailment as unsatisfiability over the grouped search: adopted.
  - Carrying directly onto claims and operators without held statements: handed to the sibling item to weigh.
- **Missing items:**
  - The id-stability assumption is now stated.
  - Attribution tracking belongs to the sibling item.
  - The "false or CONTESTED" criterion moved with held statements.
  - The test file name `forks.test.ts` is corrected.
- **Rule numbers.** S-15, E-8, E-9 and E-10 are the next free numbers in their tiers. E-2 is unused and stays unused. They become stable wire format when released.
