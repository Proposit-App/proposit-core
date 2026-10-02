# Plan: response arguments that answer a pinned version of another argument through links

## Setup

- **Prerequisite.** `fix/fork-external-bindings`, the 5.4.3 fork fix, is merged to `main`. Forking a response depends on it.
- **Branch.** Work happens on `feat/response-arguments`, cut from `main` after that merge.
- **Release.** Nothing is released from this branch alone. It joins 6.0.0, together with the sibling carrying item and the other batched items.

## Rules for every task

- Every commit leaves `pnpm run check` green. A task that would leave the tree red is split.
- Each new test is first run against the code as it stands before its task, and its failure is recorded in `outcome.md`. A pin that passes before the change is reworded until it measures the change.
- Where a plausible wrong implementation exists, it is tried, the pin is seen to fail, and the attempt is reverted (the repository's implement-stage rule).
- New response code lives in a new folder, `src/lib/core/response/`, one concern per file. Engine methods delegate to it, as `src/lib/core/argument/` does today.

## Tasks

### 1. Conclusion-step flag

This task is independent of responses, and it is the only change to evaluation results.

- **Files:**
  - `src/lib/types/evaluation.ts`: optional `conclusionInferenceRejected?: true` on `TCoreArgumentEvaluationResult`, with JSDoc stating that a nested rejection is ignored.
  - `src/lib/core/evaluation/argument-evaluation.ts`: set the field when `operatorAssignments[root of conclusion premise] === "rejected"`. Leave the strike filter (`:249-268`) and every aggregate untouched.
- **Test:** `test/evaluation/conclusion-step.test.ts` (criterion 12).
  - It compares the whole result with and without the rejection, removing only the new key, so that any other field moving fails.
  - The wrong implementation to try: striking the conclusion. The comparison must catch it, through `struckPremiseIds` and propagation.

### 2. Pin today's checksums before anything changes

- **Files:**
  - `scripts/checksum-fixtures/capture.mjs`: builds each fixture case with a deterministic counting `generateId` and writes every argument, premise, expression, variable, role and combined checksum. It loads the package from a path given on the command line.
  - `test/core/fixtures/checksums-5.4.2.json`: captured from the published 5.4.2 package, installed into a scratch folder.
  - `test/core/fixtures/checksums-5.4.3-fork-external.json`: the external-binding fork case, captured from the 5.4.3 tarball.
- **Test:** `test/core/checksum-stability.test.ts` (criterion 5 in full).
  - Cases: default configuration; a `createChecksumConfig` configuration with consumer fields; a partial configuration missing `argumentFields` and `variableFields`; after `forkArgumentEngine`; a snapshot round trip; `fromData`; a rolled-back mutation; a reload with `checksumVerification: "strict"`; `setExtras` on a standard argument.
- **Proof.** This pin passes before every later task, by design.
  - To show it is sensitive, temporarily add a field to `DEFAULT_CHECKSUM_CONFIG.argumentFields` and check the test fails; then revert.
  - It must still pass after every later task.

### 3. The `respondsTo` field, its checksums and its ownership

- **Files:**
  - `src/lib/schemata/argument.ts`: optional `respondsTo: { argumentId, argumentVersion }`.
  - `src/lib/checksum-config.ts` and `src/lib/types/checksum.ts`: `respondsTo` joins the default argument fields. A new helper, `resolveChecksumFields(config, key)`, returns the field set in force: the configured set if present, otherwise the default, always unioned with that key's always-included new fields. This task adds `respondsTo` to that list. Task 4 adds `boundExpressionId` and `boundAspect`.
  - Replace each hash-time `config?.X ?? DEFAULT_CHECKSUM_CONFIG.X` with the helper: `src/lib/core/argument-engine.ts:2178`, `:2258`, and `src/lib/core/variable-manager.ts:177`. The plan re-greps for `DEFAULT_CHECKSUM_CONFIG` before committing, in case a site was missed. Role and origin fields gain nothing, so their sites keep their current lookups.
  - `src/lib/core/argument-engine.ts`: `getExtras` (`:715`) excludes `respondsTo`; `setExtras` (`:727`) keeps it and throws when the input names it. `updateExtras` inherits both.
- **Tests:**
  - `test/core/response-kind.test.ts` (criterion 3).
  - `test/core/checksum-stability.test.ts` stays green.
  - New cases in the same stability file: a response's checksum includes `respondsTo` under the default, partial and stored configurations, and stays the same across creation, rollback and strict reload.

### 4. Responses in the engine, validation and evaluation

- **Files:**
  - `src/lib/core/argument-engine.ts`:
    - no automatic conclusion in `createPremise` and `createPremiseWithId` (`:955-958`);
    - no promotion in `removePremise` (`:1066-1076`);
    - `setConclusionPremise` throws for a response;
    - `fromData` assigns a stored conclusion directly, only when one is present (`:2082-2083`). `fromSnapshot` already does (`:1939`);
    - `listSupportingPremises` gains its response meaning (`:1833-1842`);
    - `evaluate` and `checkValidity` refuse with `ARGUMENT_IS_RESPONSE`.
  - `src/lib/types/evaluation.ts`: add `ARGUMENT_IS_RESPONSE` to the issue codes (`:77`).
  - `src/lib/core/evaluation/argument-evaluation.ts`: the refusal at `:199-210` and `:563-574`. It is decided from the context, which gains `isResponse`.
  - `src/lib/core/argument-validation.ts`:
    - the S-15 self-reference invariant inside `validateArgument`;
    - no `ARGUMENT_NO_CONCLUSION` for a response (`:402-417`).
  - Grammar rules:
    - `src/lib/grammar/validators/structural.ts`: report S-15;
    - `src/lib/grammar/validators/evaluable.ts`: E-7 skips a response, and the new E-8;
    - `src/lib/grammar/validators/context.ts`: carry `respondsTo`;
    - `src/lib/grammar/types.ts`: add `S-15` and `E-8` to `GrammarRuleCodeSchema`.
  - Conclusion readers: `src/lib/core/argument/display.ts`, `src/lib/core/review-helpers.ts:92-93`, `src/lib/core/diff.ts` (`diffRoles`, plus `defaultCompareArgument` comparing `respondsTo` in depth).
- **Tests:**
  - `test/core/response-kind.test.ts`: criteria 1, 2 and 14.
  - `test/core/diff.test.ts`: `respondsTo` changes appear in the argument diff.
  - `test/grammar/structural.test.ts` and `test/grammar/evaluable.test.ts`: one case each for S-15, E-7 on a response, and E-8.
  - Wrong implementation to try: dropping the stored conclusion on load. Criterion 1's E-8 case must fail.

### 5. Expression-bound variables

- **Files:**
  - `src/lib/schemata/propositional.ts`: the third union member; `isExpressionBound`; `boundAspect`.
  - `src/lib/checksum-config.ts`: the new fields in the default variable fields, and the always-included list for variables.
  - `src/lib/grammar/validators/structural.ts`:
    - S-3 becomes "exactly one of claim, premise or expression reference", with the message wording updated;
    - S-15 also covers an expression-bound variable in a standard argument, or one bound into an argument other than `respondsTo.argumentId`.
  - `src/lib/core/argument-validation.ts`: the same Structural checks as invariants, plus "a variable carrying two kinds of reference".
  - `src/lib/grammar/validators/evaluable.ts` and `src/lib/grammar/types.ts`: E-9 (a duplicate raw referent) and E-10 (a version mismatch).
  - `src/lib/core/argument-engine.ts`:
    - `bindVariableToExpression`, which checks it is a response, checks `respondsTo`, calls `canBind`, and de-duplicates on the raw referent. While `restoringFromSnapshot` is set, it skips the version check and the de-duplication.
    - The third shape in both restore loops (`:1914-1938`, `:2045-2060`).
    - `updateVariable` (`:1317-1386`) refuses binding-field edits and shape conversions.
  - `src/lib/core/interfaces/argument-engine.interfaces.ts`: JSDoc for `bindVariableToExpression`.
  - `src/lib/core/diff.ts`: `defaultCompareVariable`'s binding fields (`:42-48`).
  - `src/lib/core/fork.ts`: confirm that expression-bound variables pass through untouched. Their `isPremiseBound` is false, so the remap at `:147` never touches them. A test pins it.
- **Tests:**
  - `test/core/response-links.test.ts`: criterion 6.
  - `test/core/response-kind.test.ts`: criterion 4, the round trips.
  - `test/core/forks.test.ts`: criterion 13.
  - `test/grammar/structural.test.ts`: S-3 with each of the three shapes, both kinds of reference together, and none.
  - `test/core/checksum-stability.test.ts` stays green.

### 6. Links: `listLinks`, `validateLinks`, `elementsWithinPremise`

- **Files:** `src/lib/core/response/links.ts` holds the move derivation and the three functions. `validateLinks` reports:
  - a missing expression;
  - an inference binding on a non-operator;
  - a claim-bound variable for a claim the target uses;
  - E-10;
  - same-claim duplicate links, as information.
- **Test:** `test/core/response-links.test.ts`, criteria 7 and 8.

### 7. A witness from the satisfiability search

- **Files:** `src/lib/core/evaluation/satisfiability.ts` gains `findSatisfyingAssignment(ctx, options)`.
  - It runs the same grouped walk as `isPremiseSetSatisfiable` and returns `{ satisfiable: true, assignment } | { satisfiable: false } | { satisfiable: null }`. A witness is merged across groups.
  - `isPremiseSetSatisfiable` becomes a thin wrapper over it, so its own results are unchanged.
- **Tests:**
  - `test/evaluation/satisfiability-witness.test.ts`: the witness satisfies every premise, across two independent groups.
  - All of `test/evaluation/satisfiability*.test.ts` passes unchanged.

### 8. The combined premise set, `checkLink` and `checkResponseCoherent`

- **Files:**
  - `src/lib/core/response/combined-premise-set.ts`. It builds the in-memory set as a scratch `ArgumentEngine`, in permissive behaviour, over a scratch `ClaimLibrary` with one synthetic claim per column. It then:
    - copies the response's premises;
    - expands statement-aspect variables from the target snapshot, recursively through internal premise bindings, with a guard against binding cycles that throws on a cycle in the supplied snapshot;
    - keeps inference-aspect variables, external bindings and the target's own expression bindings as columns, keyed by raw referent;
    - merges the response's own claim-bound variables by claim id;
    - leaves out naked-Q stubs;
    - seeds the response's own grounded columns true;
    - computes each link's merged referent as its expanded formula over merged columns (review item B7).

    The scratch engine reuses premise evaluation and the reachability step unchanged, and nothing reads another argument.
  - `src/lib/core/response/check.ts`:
    - the `invalid` precondition;
    - the order of decision (whole set, then other premises with not-F);
    - the exclusion of same-referent, same-polarity links;
    - the minimal support set and the minimal unsatisfiable set (remove one premise at a time);
    - `attemptedSupport`;
    - the grounding fixpoint, cached per response and target pair;
    - `restsOnlyOnLinks` left out when any link is undetermined.
- **Tests:**
  - `test/core/response-check.test.ts`: criteria 9 and 10, plus B2's `checkLink(affirm Q)` in the `{¬(Q∧R), Q, R}` response returning `incoherent`.
  - A timing case logs the worst case under the ceiling (one group of 16 columns, 10 links). Its result goes in `outcome.md`, not into an assertion.

### 9. Fingerprints, `classifyBindings` and `rebaseResponse`

- **Files:**
  - `src/lib/core/response/fingerprint.ts`: `structuralFingerprint` and the position class.
  - `src/lib/core/response/rebase.ts`:
    - `classifyBindings`, with `alreadyRebased` checked for resolution (review item B5);
    - `outsideSnapshots` followed recursively for re-pinned references, falling back to `outsideReferenceRepinned`;
    - each entry lists the full chain of affected premises, including those reached through `removePremise`'s cascade over variables bound to a removed premise (review item B4);
    - `claimBindingConflicts`.
  - `src/lib/core/argument-engine.ts`: `rebaseResponse` as a mutation, which:
    - recomputes the classification;
    - calls `canBind`;
    - applies the decisions;
    - merges or refuses a `retarget`/`keep` that would create an E-9 duplicate (review item B6);
    - refuses `convertToLink` for a derivation consequent or a citation-bound claim (B6);
    - checks the postcondition, comparing violations by code, variable id and expression id (B6), and rolls back on failure.
- **Test:** `test/core/response-rebase.test.ts`: criterion 11 in full, including the three outside-snapshot cases.

### 10. Link references

- **Files:** `src/lib/core/response/link-reference.ts` (`TLinkReference`, `linkTargetsElement`).
- **Test:** `test/core/response-link-reference.test.ts`:
  - a claim element matched through any occurrence and any claim version;
  - an expression element matched directly, and through its premise root;
  - a non-link premise is never matched.

  The spec gave C6 no criterion; this test supplies one.

### 11. Public surface and documentation

- **Files:**
  - `src/lib/index.ts`: exports for the new functions and types.
  - `docs/api-surface.txt` via `pnpm run api-surface:update`, checked against criterion 15: no consumer concepts in any new name.
  - The documentation entries listed below.

## Documentation Sync

Every entry from `tcw work docs` was evaluated.

- **`docs/changelogs/upcoming.md`** [Any-Code-Change]: fires. Entries go under Added, Changed and Breaking: responses, expression-bound variables, the checks, rebasing, link references, the conclusion-step flag, S-3's widened meaning, the new rules, `ARGUMENT_IS_RESPONSE`, `setExtras` refusing `respondsTo`, and the always-included checksum fields.
- **`docs/release-notes/upcoming.md`** [Public-API]: fires. It includes a migration section covering:
  - the variable union gaining a third member;
  - responses having no conclusion;
  - S-3;
  - `setExtras`;
  - checksum fields added to every configuration;
  - consumers keeping entity ids stable across versions, which rebasing relies on.
- **`docs/api-reference.md`** [Public-API]: fires. It gains:
  - a "Response arguments" section: moves, links, the checks and their statuses, rebasing with an `X.3` / `Y.1` worked example, link references, and the cross-argument foreign key;
  - updates to `listSupportingPremises`, `setExtras` / `getExtras`, `evaluate` / `checkValidity`, the evaluation result (`conclusionInferenceRejected`), the satisfiability witness, and the variable union;
  - the limitations: reach of one argument back for the checks, and an affirm link that cannot be backed by a derivation premise for the same claim.
- **`README.md#invalid-constructions`** [Validation-Rules]: fires, for S-3, S-15, E-8, E-9, E-10, the new thrown errors and `ARGUMENT_IS_RESPONSE`.
- **`docs/Proposit_Grammar.md`.** It is not a declared entry, but it is the rule inventory the guide routes to. It gains S-15, E-8, E-9 and E-10, S-3's new wording, and the note that D-4 and D-5 do not restrict expression-bound variables.
- **`src/lib/core/interfaces/argument-engine.interfaces.ts`** [Public-Engine-API]: fires, for `bindVariableToExpression`, `rebaseResponse`, `setConclusionPremise`'s new throw, `setExtras`, `listSupportingPremises`, `evaluate` and `checkValidity`.
- **`skills/proposit-core/SKILL.md`** [Public-API]: fires. One concept line on responses, and a routing row.
- **`skills/proposit-core/docs/*.md`** [Public-Engine-API]: fires.
  - `building-arguments.md` gains responses and links.
  - `evaluation.md` gains the conclusion-step flag and the checks.
  - `grammar.md` gains the rules.
  - `persistence.md` gains the checksum fields and the cross-argument reference.
  - `forking-and-diffs.md` gains forking a response, and rebasing.
  - Every code example must compile.
- **`AGENTS.md`** [Routing]: fires, for two new easy-to-violate invariants:
  - `respondsTo` is engine-owned and never passes through extras;
  - a response's links are merged by referent only at check time, so code counting a response's links by claim must merge first.
- **`README.md`** [Public-CLI-API] and **`skills/proposit-core/docs/cli.md`** [Public-CLI-API]: fire for one sentence each, saying that response arguments are a library feature the CLI does not store.
- **Not fired:** `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`, `examples/arguments/*.yaml` (the CLI's import shape is unchanged), `premise-engine.interfaces.ts`, `shared.interfaces.ts`, `library.interfaces.ts`, and the `PropositCore`, `ArgumentLibrary`, `ForkLibrary` and `ForkNamespace` JSDoc. No signature changes in any of these.

## Verification

What the suite cannot check:

- **Consumer validation.** The requester validates a tarball (`pnpm run build && pnpm run pack:branch`) of the combined 6.0.0 branch, including the sibling item, against its own data. That covers stored checksums, its version copying keeping ids stable, and the upgrade flow it builds on `classifyBindings` and `rebaseResponse`.
- **The combined review.** Before 6.0.0, the merged change, including the at-most-one operator, which also changes propagation, gets a review of its own. Single-item reviews cannot see interactions between items.
- **Performance.** Task 8's timing case is read by a person against the expected response size. If it is too slow, the ceiling for the checks is lowered before release, rather than shipping a slow default.
- **Public-repository wording.** Before the release commit, a read of every new name, comment, test title, changelog and release-notes line confirms that none mentions a consumer or a planning artifact.

## Notes

- **Order.** Task 1 is independent and goes first: it is small, and it makes the only change to evaluation results, so it is reviewed alone. Task 2 pins checksums before Tasks 3 and 5 touch them. Tasks 7 and 8 are split so that the change to the shared satisfiability search lands, with its existing tests unchanged, before anything depends on it.
- **The scratch engine** (Task 8) is the riskiest choice. It reuses evaluation and reachability instead of writing a second evaluator. Its cost is building an engine per check, which is acceptable at the sizes the ceiling allows. If the plan's review rejects it, the alternative is an evaluation context over plain data that implements `TArgumentEvaluationContext` directly.
