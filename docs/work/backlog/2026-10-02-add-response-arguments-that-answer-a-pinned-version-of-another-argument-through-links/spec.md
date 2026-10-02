# Spec: response arguments that answer a pinned version of another argument through links

Second revision, after the first adversarial review (verdict NOT DONE). Line numbers are against `90578ec3`. "The intake" is this item's `intake.md`; sections C1–C7 follow its numbering. Every place this spec departs from the intake is marked **Departure**, with the reason. `## Notes` lists how each review finding was handled.

**Scope after the split** (see the dated amendment in `initial-request.md`):
- **Here:** C1 argument kinds, C2 links, C3 checks, C4 rebasing, C6 link references, and the conclusion-step flag from C5.
- **Elsewhere:** the rest of C5 — held statements, a response's evaluation under a reader's input, and carrying answers — is `2026-10-02-carry-a-reader-s-agreement-with-a-response-argument-into-the-argument-it-answers`.
- **Already fixed:** the fork defect found while specifying this is `2026-10-02-forking-breaks-bindings-into-another-argument`, which ships as 5.4.3. Today it sits unmerged on `fix/fork-external-bindings`, awaiting the consumer's validation. This item builds on that fix, so merging it is a prerequisite of implementation.

## Capability changes

The capability ledger for this repository is empty (`tcw capabilities list` prints nothing), so no ledger record changes. The taxonomy gains entries at implementation time:

- **Vocabulary:**
  - **response argument** (under `argument`);
  - **link** (a premise of a response that is one bound variable or its negation);
  - **expression-bound variable** (under `propositional-variable`);
  - **move** (contradict / affirm / undercut / reinforce).
- **Features:**
  - **response checking** (`validateLinks`, `checkLink`, `checkResponseCoherent`);
  - **response rebasing** (`structuralFingerprint`, `classifyBindings`, `rebaseResponse`).
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
- Renaming the code `checkValidity` uses for a too-many-variables refusal (`ASSIGNMENT_UNKNOWN_VARIABLE`, `argument-evaluation.ts:614-627`). It is wrong, but engine-error codes are stable wire format, and core cannot see which consumers match it. It stays. The new checks report size as an `undetermined` status with a reason, and need no error code.
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
  - A configuration persisted inside an older snapshot (`argument-engine.ts:1859`) is an explicit set, and `normalizeChecksumConfig` (`checksum-config.ts:90-106`) does not merge in the defaults. So the three new fields (`respondsTo` among argument fields; `boundExpressionId` and `boundAspect` among variable fields) are always added to **the field set actually in force**: the configured set when one is given, and the default when the key is missing. This happens wherever a field set is resolved for hashing, so creation, rollback, restore and strict verification all agree. Adding them inside `normalizeChecksumConfig` alone would be wrong. A configuration that omits `argumentFields` would become `{respondsTo}` and lose `version`, moving every checksum, and the constructor does not normalize at all (`argument-engine.ts:241`), while restore and rollback do (`:2126`). The fields are absent on all existing data, so no existing checksum changes, and a stored configuration still detects a rebase.
- **Structural invariants, checked on every mutation and on load.** Grammar validators run only through `engine.validate(tier)` (`src/lib/grammar/validate.ts:24`), so these are added to `validateArgument` (`src/lib/core/argument-validation.ts:209ff`), which `fromSnapshot` and `fromData` already run (`argument-engine.ts:1958-1959`, `2101`). Each is also reported by the grammar as **S-15**:
  - `respondsTo.argumentId` differs from the argument's own id;
  - an expression-bound variable exists only in a response (C2).
- **Engine behaviour for a response:**
  - `createPremise` does not make the first premise the conclusion (today it does, `argument-engine.ts:955-958`);
  - removing a premise promotes nothing (today the smallest remaining id is promoted, `:1066-1076`);
  - `setConclusionPremise` throws (`:1753-1777`);
  - snapshot restore and `fromData` restore a stored conclusion directly, without `setConclusionPremise` (`:1939-1940`, `:2082-2083`). So a response stored with a conclusion loads unchanged, its role checksum included, and E-8 reports it.
- **Validation.**
  - E-7 passes for a response with no conclusion.
  - A response that has a conclusion premise is a new Evaluable rule, **E-8**. It is Evaluable rather than Structural so that such data still loads and can be repaired.
  - `validateArgumentEvaluability` does not raise `ARGUMENT_NO_CONCLUSION` for a response (`argument-validation.ts:402-417`).
  - D-6 (`src/lib/grammar/validators/derivable.ts:491-511`) is unaffected.
- **Evaluation.** `evaluate()` and `checkValidity()` on a response return `ok: false` with a new engine-error code, `ARGUMENT_IS_RESPONSE`. Today both return `ARGUMENT_NO_CONCLUSION` (`argument-evaluation.ts:199-210`, `563-574`). Evaluating a response under a reader's input is the sibling item, which adds its own method. `evaluate()` keeps refusing a response, so this code stays live.
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
- **S-3 is redefined.** Today it reports a variable with both a claim and a premise reference, or with neither (`src/lib/grammar/validators/structural.ts:165-198`). Every expression-bound variable would trip the second. It becomes: exactly one of a claim reference, a premise reference or an expression reference.
  - The code `S-3` keeps its name. Its message for the "none" case changes wording.
  - A variable carrying two kinds of reference is also an invariant violation in `validateArgument`. The schema alone cannot catch one, because both existing union members allow additional properties (`propositional.ts:131-173`).
- **Checksums.** The four fields join the variable checksum fields and are hashed only when present, as `boundPremiseId` is today.
- **Columns.** The only code that evaluates over a response is the checks in C3, which decide how each expression-bound variable enters the search: statement-aspect variables expand into the target, and inference-aspect variables are columns. Standard arguments cannot hold expression-bound variables (S-15), and `evaluate()` refuses responses. So the existing column filters (`argument-evaluation.ts:240-247`, `604-612`, and the satisfiability free set) do not change.
- **Binder.** `bindVariableToExpression(variable)` on `ArgumentEngine`:
  - throws if the argument is not a response, or if `boundArgumentId` / `boundArgumentVersion` differ from `respondsTo`;
  - calls `canBind(boundArgumentId, boundArgumentVersion)` and throws if it refuses, as `bindVariableToExternalPremise` does (`argument-engine.ts:1287`);
  - if a variable with the same **raw referent** `(boundArgumentId, boundExpressionId, boundAspect)` exists, returns it instead of adding another, as `ensureClaimBoundVariable` does for claims. A duplicate arriving by snapshot is a new Evaluable rule, **E-9**.
  - The binder sees no target, so it cannot know that two expressions are occurrences of one claim. It does not try. Merging those is a check-time step (C3).
- **Loading.**
  - Snapshot restore and `fromData` restore claim-bound and premise-bound variables in two loops (`argument-engine.ts:1914-1938`, `2045-2060`), so expression-bound variables would be skipped. Both gain the third shape. While restoring (the engine's existing `restoringFromSnapshot` state), the binder skips its version check and its de-duplication, so a stored version mismatch loads and is reported by E-10, and a stored duplicate loads and is reported by E-9. If either were dropped, an expression already restored would point at a missing variable.
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
  - an expression-bound variable whose `boundArgumentVersion` differs from `respondsTo` (E-10), so that it is never looked up in the wrong snapshot;
  - two links on different occurrences of one claim with the same aspect. This is reported as information, not as a violation.
- **Sources and axioms.** D-4 and D-5 (`docs/Proposit_Grammar.md:526-543`) keep citation- and axiom-bound variables inside derivation antecedents. They do not apply to expression-bound variables, so a response may contradict or undercut anything in its target that rests on a source or an axiom.
  - **Accepted limitation:** a response cannot deny a source cited two steps back along the path. Links reach only the immediate target, and D-4 and D-5 forbid placing the response's own citation variable under `NOT`.
- **Helpers.**
  - `listLinks(response)` gives each link's premise id, variable id, bound expression, aspect and move.
  - `elementsWithinPremise(targetSnapshot, premiseId)` gives every expression id and claim id in a premise.

### C3. Checking a response

**What "the response" is.** Every check below is a function that takes the response's `ArgumentEngine`, because deciding which variables are grounded needs its claim library (`isGroundedVariable`, `src/lib/core/argument/claim-variables.ts:141-152`), and a snapshot carries none. Each check also takes the target snapshot.

**Preconditions.** Each check returns `status: "invalid"`, with the problems, without searching, when either of these holds:
- the target snapshot's id and version differ from `respondsTo`;
- `validateLinks` reports any violation.

This also means a variable on the wrong version (E-10) is never looked up in the wrong snapshot. It also means a response's own claim-bound variable is never merged with a claim it reaches through the target, because `validateLinks` forbids exactly that case.

**The evaluation model: expansion, for every check.** The checks never treat a statement link as an opaque true/false value. Before searching, each check builds one **combined, in-memory premise set**, used only for the search and never stored:

1. **Copy the response's premises.**
2. **Expand each statement-aspect expression-bound variable** into a copy of its target subtree, with fresh ids. Inside the copy, target variables become columns:
   - **Claim-bound** target variables become one column per claim id. Two occurrences of one claim, in the target or across links, are therefore the same column.
   - **Internally premise-bound** target variables expand, recursively, into a copy of their bound premise's root.
   - **Externally premise-bound** target variables stay one column, keyed by their raw referent.
   - **When the target is itself a response,** its own expression-bound variables stay one column each, keyed by their raw referent.
3. **Keep each inference-aspect variable as one column,** keyed by its raw referent. Whether a step holds is not a function of its parts.
4. **Merge** the response's own claim-bound variables that share a claim id into one column.

Since the expansion is copied into the combined set, every premise there reads only variables of the combined set. The existing reachability step (`collectReachableVariables`, `satisfiability.ts:56-101`) then groups correctly without following any binding across arguments. This keeps the "a premise reads only what it reaches" invariant: nothing reaches into another argument, because what it would reach has been copied in.

**Seeding.** A column is seeded true exactly when it comes from the response's own citation- or axiom-bound variables, as `checkValidity` seeds them (`argument-engine.ts:2561-2586`). Columns from the target are never seeded; the response may deny them. Unpopulated naked-Q derivation stubs are left out, as the evaluation context already leaves them out (`argument-engine.ts:2484-2510`).

**The search.** The combined set runs through the existing grouped search, `isPremiseSetSatisfiable` (`src/lib/core/evaluation/satisfiability.ts:132`), and its per-group ceiling (`:13-18`). It needs two changes:
- **Synthetic goal premise.** "S entails F" is "S plus not-F is unsatisfiable". not-F is added as a synthetic premise in the combined set.
- **Witness.** The search returns a satisfying assignment, combined across groups, when it finds one. Today `walkGroup` returns only true, false or undetermined (`:234-272`). The witness is reported in terms of columns: a claim id, a raw referent, or a response variable id, each with its value.

**`checkLink(response, linkPremiseId, targetSnapshot)`** asks whether the link's content follows from the response's other premises, derivation premises included.

- **Departure:** the intake excludes derivation premises. In core a source supports a claim only through a derivation premise (`IMPLIES(source, Q)`). Excluding them would make every source-backed objection read as an unsupported assertion.
- **"Other premises"** leaves out the link itself, and every link with the **same merged referent and the same polarity**. The same assertion written twice must not support itself. A link with the same referent and the opposite polarity is a contradiction, which the next step catches.
- **Order of decision:**
  1. Can the whole combined set, the link included, hold?
     - `false` → `incoherent`. The response contradicts itself, so the check refuses to say the link follows or stands as an assertion. This agrees with `checkResponseCoherent` for every link of an incoherent response.
     - Undetermined → `undetermined`.
  2. Can the other premises hold together with not-F?
     - `false` → `follows`.
     - `true` → `asserted`, with the witness as its counterexample.
     - Undetermined → `undetermined`.
- **`follows`** comes with `supportPremiseIds`: a minimal set of other premises from which the link follows, found by removing premises one at a time while it still follows. "Minimal" means no premise can be removed; it is not necessarily the smallest such set.
- **`asserted`** comes with `attemptedSupport`: true when another premise has the link's merged referent on its consequent side — right of `→`, either side of `↔`, at any depth below a `NOT` there. Inference referents count.
- **`undetermined`** comes with `reason: "too-many-variables"` when a group exceeds the ceiling. It never throws for size. This answers intake Q2.
- **`restsOnlyOnLinks`** (with `follows`) is true when the link follows but is not **grounded**:
  - A link is grounded when it is `asserted`, or when it follows from the non-link premises together with links already grounded, repeated until nothing changes.
  - Links sharing a merged referent and polarity count as one link in this fixpoint.
  - `incoherent`, `undetermined` and `invalid` links are never grounded.
  - When any link is `undetermined`, `restsOnlyOnLinks` is left out rather than guessed.
  - The fixpoint is computed once per response and reused by every `checkLink` call on it.

**`checkResponseCoherent(response, targetSnapshot)`** asks whether the whole combined set can hold at once.
- The answer is `coherent: true | false | null`; `null` means undetermined.
- When the answer is `false`, it also gives a minimal unsatisfiable set of premise ids.
- It uses the same combined set and seeding as `checkLink`, so the two cannot disagree. For example, "contradict `Q ∧ R`" with "affirm Q" and "affirm R" is incoherent to both: coherence says `false`, and every `checkLink` on that response says `incoherent`.

**Accepted limitation:** merging reaches one argument back. Z sees only Y's snapshot. So two links of Y, on two occurrences of one claim of X, are two columns for Z, and Z may affirm one and contradict the other without being reported incoherent. The same reach applies to sources two steps back (C2).

### C4. Bringing a response up to a newer target version

**Notation and flow.** `X.3` means argument X at version 3. Every reference from a response to another argument is an `(argumentId, argumentVersion)` pair: `respondsTo`, each expression-bound variable's binding, and `TLinkReference`.

Example: Y.1 answers X.3, and Z.0 answers Y.1. Publishing X.4 changes nothing in Y.1, which keeps answering X.3. Telling Y's author that a newer version exists, and offering to answer it, is the consumer's job, since core does not know which versions exist. If the author accepts, the consumer copies Y.1 into a new draft version, Y.2, keeping entity ids as it does for any version. It then calls `classifyBindings` and `rebaseResponse` on the Y.2 engine, with `targetFrom` = X.3 and `targetTo` = X.4. Y.1 is never modified. The same applies one level down: Z.0 keeps answering Y.1 until Z's author chooses to make Z.1 answer Y.2.

**Unit of work: the expression-bound variable, not the link premise.** A binding lives on a variable. One variable can serve several premises, link or not — `{R, R→¬x, ¬x}` uses `x` in two. So classification and decisions are per variable, and each variable's entry lists the premises that use it.

- **`structuralFingerprint(snapshot, expressionId)`** is a hash over a subtree's shape that ignores the argument's ids and versions.
  - Stored checksums cannot serve: expression checksums include `argumentVersion`, `parentId`, `premiseId` and `variableId` (`src/lib/checksum-config.ts:18-28`). Nothing in the library computes such a hash today, and `diffArguments` matches by id (`src/lib/core/diff.ts:70-115`, `365`).
  - It covers each node's type, operator and child order. For each variable it covers its referent:
    - claim-bound: claim id and **claim version**;
    - internally premise-bound: the bound premise's root fingerprint, recursively;
    - externally premise-bound: `(boundArgumentId, boundPremiseId)`;
    - expression-bound: `(boundArgumentId, boundExpressionId, boundAspect)`.
  - Other arguments' versions are left out of the hash, so a rebase of Y does not change the hash of Z's bindings into Y. They are not ignored, though: each re-pinned outside reference is followed when the caller supplies the snapshots it needs, and reported when it does not (`outsideReferenceRepinned`, below).
- **`classifyBindings(response, targetFrom, targetTo)`.** `targetTo` must have the same argument id as `targetFrom`. Each expression-bound variable is classified against the snapshot of its own `boundArgumentVersion`. A variable already bound to `targetTo`'s version is reported `alreadyRebased`, which is how a partly saved rebase gets finished. Every other variable must be bound to `targetFrom`'s version. Each entry gives the variable id, the premise ids that use it (marking which are links), and one label:
  - `unchanged`: the same expression id is present in `targetTo`, with the same fingerprint, the same **position class**, and the same set of `(argumentId, argumentVersion)` pairs referenced from inside the subtree.
  - `changed`: the id is present, but something differs. The entry's `reasons` say what, from `content`, `position` and `outsideReferenceRepinned`.
    - **Departure, an addition:** position class is one of root of a freeform premise, root of the conclusion premise, nested, or inside a derivation premise. The sibling item carries a move differently by position class.
    - **Re-pinned outside references.** A reference inside the subtree may point at a different version of some third argument in `targetTo` than in `targetFrom`. Example: Z.1 is brought from Y.1 to Y.2, and Y.2 itself moved from X.3 to X.4, so Y's link expressions now reference X.4 instead of X.3. `classifyBindings` takes an optional `outsideSnapshots`: snapshots of other arguments, each identified by its id and version.
      - **Both versions supplied.** If both versions of the referenced argument are present (X.3 and X.4), the referenced element is compared across them: the expression for an expression-bound reference, with its aspect; the bound premise's root for an external premise binding.
        - **Same.** The element exists in both, with the same structural fingerprint (claim versions included) and the same position class. The re-pin then counts as no change. This applies recursively, so the element's own outside references are judged the same way.
        - **Different.** Otherwise the binding is `changed` with reason `content`.
      - **A version missing.** If either version is not supplied, the binding is `changed` with reason `outsideReferenceRepinned`. Core cannot fetch the argument to tell whether the change matters, so it never assumes it does not.
      - **The outcome when nothing changed.** In the example, with X.3 and X.4 supplied and nothing changed beneath Y's links, every such binding of Z is `unchanged`. The author faces only the argument-level question, "bring Z up to Y.2?". This is the maintainer's decision of 2026-10-02.
      - **Reach.** Classification therefore reaches as far back as the caller supplies snapshots. The checks in C3 still reach one argument back.
  - `removed`: the id is absent.
  - `alreadyRebased`: as above.

  Separately, `claimBindingConflicts` lists each claim-bound variable in the response for a claim that `targetTo` uses and `targetFrom` did not. This answers intake Q4.
- **`rebaseResponse(targetFrom, targetTo, decisions)`** is an `ArgumentEngine` mutation.
  - **Departure:** the intake names this `rebaseChanges` and describes it as returning a changeset. No changeset can be produced without mutating an engine. So, like every other mutation, it returns `TCoreMutationResult`, whose `changes` (including the argument entity's new `respondsTo`) the caller persists. It rolls back entirely on any failure.
  - It recomputes the classification itself and consults `canBind` for `targetTo`.
  - It sets `respondsTo` to `targetTo`, and re-points every `unchanged` variable.
  - Each `changed` or `removed` variable takes one decision:
    - `keep`: re-point it, accepting the new content;
    - `retarget`: bind it to a chosen expression of `targetTo`;
    - `drop`: remove the variable **and every premise that uses it**, link or not, since a premise cannot keep a variable that no longer means anything. The classification lists those premises before the caller decides.
  - Each claim-binding conflict takes `convertToLink` or `drop`.
    - `convertToLink` replaces the claim-bound variable's occurrences with an expression-bound variable on a chosen variable expression of that claim in `targetTo`, adding an affirm link if the response has none for it.
    - `drop` removes every premise that uses it.
  - A missing decision throws before anything changes.
  - **Postcondition, checked before returning:** every expression-bound variable is bound to `targetTo`'s version and resolves to an expression present in `targetTo`, and `validateLinks` against `targetTo` reports nothing new. If the check fails, the mutation throws and rolls back.
- **Foreign keys.** An expression-bound variable names an expression in another argument, exactly as an externally premise-bound variable already names a premise in another argument. `orderChangeset` (`src/lib/utils/changeset-order.ts`) orders only within one argument, and the target exists before the response, so the ordering is unchanged. The reference documentation names this cross-argument reference, so that a consumer adding a database foreign key knows it exists.
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
   - Fixtures are captured with a deterministic counting `generateId`. Everything is captured from `@proposit/proposit-core@5.4.2`, except forking an argument that holds an external binding, which 5.4.2 cannot do and which is captured from 5.4.3. They cover:
     - an argument with a conclusion;
     - claim-bound, internally and externally premise-bound variables;
     - an enthymeme mark;
     - a derivation premise.
   - Every argument, premise, expression, variable and combined checksum recomputed by the new build equals the captured value. This holds under the default configuration, under one built with `createChecksumConfig` adding consumer fields, after `forkArgumentEngine`, after a snapshot round trip, after `fromData`, and after `setExtras` on a standard argument. It also holds under a partial configuration that omits `argumentFields` and `variableFields`, after a rolled-back mutation, and after reloading with `checksumVerification: "strict"`.
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
   - Contradict `Q ∧ R`, affirm Q, affirm R, plus a fourth link L: `checkLink(L)` is `incoherent`, agreeing with coherence.
   - Two affirm links on two occurrences of one claim, and nothing else: each is `asserted`, and neither reports `restsOnlyOnLinks: true`.
   - A response that `validateLinks` faults returns `invalid` from every check.
   - One group of 17 variables returns `undetermined` and does not throw.
   - Two independent groups of 10 variables each are decided.
10. **Coherence** (same file): `checkResponseCoherent` is `false` for:
    - `x` with `NOT(x)`;
    - contradict `Q ∧ R` with affirm Q and affirm R;
    - links on two occurrences of one claim used as `x` and `NOT(x')`;
    - the S→D, `NOT(D)` case above.
11. **Classification and rebasing** (`test/core/response-rebase.test.ts`):
    - Two target versions with no edits give every expression-bound variable `unchanged`.
    - A variable used only inside `R → ¬x`, with no link of its own, is classified and re-pointed.
    - `drop` on `x` in {R, R→¬x, ¬x} removes both `R→¬x` and `¬x`, and keeps R.
    - An external premise binding inside the bound subtree moved to another version of its argument is `changed` with reason `outsideReferenceRepinned`.
    - A partly rebased response, with some variables already on `targetTo`, reports them `alreadyRebased`, and `rebaseResponse` finishes it.
    - After every successful `rebaseResponse` in this file, every expression-bound variable is bound to `targetTo`'s version and resolves in `targetTo`.
    - `P→Q` edited to `P→R` is `changed`.
    - Claim Q's version bumped under an undercut of `P→Q` is `changed`.
    - A deleted operator is `removed`.
    - An unchanged operator moved from a premise root to a nested position is `changed`.
    - Rebasing Y does not mark as `changed` any of Z's variables bound to a Y expression containing no reference into another argument.
    - A Z variable bound to one of Y's link expressions, after Y.2 moved from X.3 to X.4:
      - with X.3 and X.4 supplied and the linked X expression unchanged: `unchanged`;
      - with the linked X expression's claim version bumped: `changed`, reason `content`;
      - without X's snapshots: `changed`, reason `outsideReferenceRepinned`.
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

### Second review (NOT DONE), and how each finding was handled

- **Blocking 1 (the checks' evaluation model):** accepted.
  - Both checks expand statement-aspect links into a combined, in-memory premise set built only for the search.
  - Inference-aspect links stay columns.
  - not-F is a synthetic premise, and the grouped search gains a witness.
  - Reachability stays inside that premise set, so the "reach only what you reach" invariant holds.
  - A test pins the `Q ∧ R` case in which the two checks agree.
- **Blocking 2 (rebasing per link premise):** accepted.
  - Classification and decisions are per expression-bound variable, renamed `classifyBindings`.
  - `drop` removes every premise using the variable.
  - A postcondition check rolls back any rebase that leaves a variable on the old version or unresolved.
  - Partial rebases are finished through `alreadyRebased`.
- **Significant 1 (load path contradictions):** accepted.
  - While restoring, the binder skips its version check and its de-duplication.
  - Restore sets a stored conclusion directly, so E-8, E-9 and E-10 are reachable and round trips preserve role checksums.
- **Significant 2 (duplicate links reading as circular):** accepted. Same-referent, same-polarity links are left out of each other's support, and count as one link in grounding.
- **Significant 3 (fingerprint missing outside re-pins):** accepted, as the `outsideReferenceRepinned` reason.
- **Significant 4 (stored checksum configurations):** accepted. The three new fields are always added to the field set in force; the third review corrected the mechanism.
- **Significant 5 (fixtures):** accepted. A deterministic id generator, and the external-binding fork case captured from 5.4.3.
- **Significant 6 (release status):** corrected. Merging the fork fix is a prerequisite.
- **Missing items:**
  - `response` is the `ArgumentEngine`.
  - The witness is reported in columns.
  - The order of decision is fixed.
  - `incoherent`, `undetermined` and `invalid` links are not grounded.
  - The checks refuse while `validateLinks` reports anything, which covers E-10.
- **Questions:**
  1. `checkLink` expands, as coherence does.
  2. Statement-aspect variables expand and inference-aspect ones are columns.
  3. `drop` removes every premise using the variable.
  4. The requester's code has no `boundExpressionId` or `boundAspect` fields (checked by search).
  5. A response's own claim-bound variable for a claim reached through the target is a `validateLinks` violation, so the checks return `invalid` before any merge.
- **Notes:**
  - The limitation that merging reaches one argument back is stated in C3.
  - The S-3 description is corrected.
  - The code `TOO_MANY_VARIABLES` is dropped.
  - `ARGUMENT_IS_RESPONSE` stays live, because the sibling adds its own method.

### Third review (DONE), and how each finding was handled

The second review's findings are all resolved. The rewrite introduced eight defects, none blocking. Fixed in this text:

- **B2 (`checkLink` disagreeing with coherence):** step 1 asks whether the whole set, the link included, can hold.
- **B3 (the checksum mechanism would have moved checksums):** the fields are added to the field set in force, wherever one is resolved. Criterion 5 gains a partial configuration, a rollback and a strict reload.
- **B8 (version mismatch):** `validateLinks` reports E-10.
- **B1 (re-pins cascading down a chain):** the noisy but safe behaviour is kept, and criterion 11 is narrowed to match.
  - The cost: after Y rebases, each of Z's bindings on one of Y's link expressions needs a manual `keep`.
  - Superseded by the maintainer's decision recorded below.
- The `isGroundedVariable` path is corrected.

**For the plan to state:**

- **B4.** `drop` reaches further through `removePremise`'s cascade over variables bound to the removed premise. The classification lists the full chain, and `drop` removes it or refuses.
- **B5.** An `alreadyRebased` variable whose expression is missing from `targetTo` is reported `removed`, so it can still be decided.
- **B6.** Three rebase details:
  - `retarget` or `keep` onto an expression another variable already binds either merges the two variables or refuses, so it cannot create an E-9 duplicate;
  - `convertToLink` is refused for a claim used as a derivation consequent, and for a citation-bound claim;
  - "reports nothing new" compares violations by code, variable id and expression id.
- **B7.** A link's merged referent is its expanded formula after claim columns are merged, so two links affirming identical structures are duplicates.
- **`fromData` and conclusions.** `fromData` creates premises through `createPremiseWithId`, so the no-automatic-conclusion rule covers that path. A stored conclusion is assigned directly only when present.
- **Recursion guard.** The recursive expansion of a caller-supplied target snapshot guards against binding cycles.
- **Documentation.** The reference documentation says that an affirm link cannot be backed by a derivation premise for that same claim; it is backed through a separate claim D and `D → x`.

### Maintainer's decision at spec approval (2026-10-02, relayed by the requester)

Approved: the split, and departures 1-7, 9 and 10 as sent to the requester. Departure 8 is changed. A binding whose meaning provably did not change must not ask for a decision: "If a claim didn't change between versions, then we don't need to ask the user to update anything other than if they want to update the linkage at an argument level."

So C4's re-pinned outside references are followed through caller-supplied `outsideSnapshots`. Without them, the conservative `outsideReferenceRepinned` stays, so nothing is ever silently missed. Criterion 11 is updated to match.
