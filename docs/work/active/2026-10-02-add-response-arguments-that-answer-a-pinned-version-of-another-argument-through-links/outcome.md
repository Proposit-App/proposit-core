# Outcome

Implemented on `feat/response-arguments`. Not released: it joins 6.0.0 with the carrying item and the other batched items. `pnpm run check` passes at c9ec1b34 (2934 tests, 13 skipped).

## Commits

| Plan task | Commits | What |
|---|---|---|
| 1 | 171c67db | `conclusionInferenceRejected` on the evaluation result |
| found | 205cdb43 | strict checksum verification threw on a stored `null` descendant checksum (an argument or premise with nothing beneath it) |
| 7 | 834acb70, merge ff38f619 | `findSatisfyingAssignment` |
| 3 | 342993e8 | `respondsTo`, `resolveChecksumFields`, extras ownership |
| 2 | 9620bab4, merge 64c29b84 | every checksum pinned to values captured from published 5.4.2 / 5.4.3 |
| 4 | d18b8dbc | responses: no conclusion, S-15 / E-8, `ARGUMENT_IS_RESPONSE`, diff and display |
| 5 | 08f114c2 | expression-bound variables, S-3 widened, E-9 / E-10, load paths, `updateVariable` refusals |
| 6 | f47c83af | `readLink`, `listLinks`, `validateLinks`, `elementsWithinPremise` |
| 8 | 1d90d7a5, 4385e843 | the shared walk stops a row at its first false premise; the combined premise set, `checkLink`, `checkResponseCoherent` |
| 10 | 9aa2acd8 | `TLinkReference`, `linkTargetsElement` |
| found | 7c253542 | a stored variable with two kinds of reference failed to load with a duplicate-symbol message; now `VAR_BINDING_AMBIGUOUS` |
| 9 | 8eda6e9f, merge 8c3eecf9, c2f5b466 | fingerprints, `classifyBindings`, `rebaseResponse`; `convertToLink` made an in-place swap |
| — | 0e828c8c | spec: answers to two consumer questions after approval |
| 11 | 9a2e484f, ed5507fe, 7393922a, ad4addcb, 81bacd46, ab28c48d, a726e44b, merges 627243f1, c9ec1b34 | exports; `clearConclusionPremise` clears a response's stored conclusion; documentation |

## Tests seen failing before the change

- Task 4: `response-kind.test.ts`, 10 failed and 11 passed before. The cases that passed pin behaviour meant to stay the same, such as E-7 on a standard argument. Diff and display: 2 failed, 1 passed (an unchanged `respondsTo` reports nothing).
- Task 5: `response-links.test.ts`, 15 failed and 3 passed. The 3 used a bare `toThrow()` and passed for the wrong reason, because the binder did not yet exist. Every such assertion now matches its own message. Doing that exposed the duplicate-symbol load defect (7c253542), whose 3 tests failed before the fix. The diff case for the new binding fields failed before.
- Task 9: all 47 tests failed against throw-only stubs. The `convertToLink` cases failed against the first implementation (c2f5b466).
- `clearConclusionPremise` on a response (ed5507fe): failed before.
- Tasks 6, 8 and 10, and the grammar-rule tests: written after the code. Wrong implementations were tried instead (below).

## Wrong implementations tried (each caught, then reverted)

- Task 4: dropping a response's stored conclusion on load. The E-8 case fails.
- Task 6: counting a premise holding a claim-bound variable as a link. 2 tests fail.
- Task 8:
  - letting a repeated assertion support itself: 1 test fails;
  - treating statement links as opaque values: 4 fail;
  - not seeding the response's cited and axiomatic claims true: 3 fail;
  - not checking the whole set first: 2 fail.
- Task 9: nine tries, including hashing other arguments' versions into the fingerprint (5 fail), skipping the deletion cascade, ignoring position class, skipping the postcondition, and leaving the argument out of the changeset.
- Task 10: matching an expression through any expression in the bound expression's premise rather than only through that premise's root. 1 test fails.

## Departures from the plan

- **The combined premise set is plain data, not a scratch `ArgumentEngine`.** Expanding a statement link puts a copied `implies` under `NOT`, which an engine refuses (S-5). I took the plan's named fallback: `CombinedPremise` implements `TEvaluablePremise`. It is evaluated with the operators in `belnap.ts` and searched by the unchanged `findSatisfyingAssignment`. An operator the evaluator does not know throws, so the batched at-most-one operator must add its case there.
- **`checkLink` and `checkResponseCoherent` are `ArgumentEngine` methods,** not free functions, because grounding needs the engine's private claim library.
- **Speed.** The worst case under the ceiling is one group of 16 columns with 10 links, every link following. It first measured about 5.3 s of shared analysis plus 1.8 s per link. Three changes that preserve every answer brought it down:
  - the walk stops a row at its first false premise;
  - a link is asked first whether it follows from the non-link premises, which also grounds it;
  - the minimal support set tries removing every other link at once.

  It now measures about 0.2 s plus 19 ms per link on a quiet machine. The timing test asserts answers only. The plan's verification item asks a person to read this against expected response sizes: lower the ceiling before release if it is too slow.
- **Public names beyond the spec's list:**
  - `isResponse()`, `getRespondsTo()`, `positionClassOf`, and the result types in `src/lib/types/response.ts`;
  - invariant codes `ARG_RESPONDS_TO_ITSELF`, `ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE`, `VAR_BINDING_AMBIGUOUS`;
  - `LINK_TARGET_MISMATCH`, used by the checks' `invalid` answer.
- **`convertToLink`.** The approved text said to add an affirm link when the response has none. Against a response that denied the claim, that made the response contradict itself. It is now an in-place swap that keeps polarity (spec note of 2026-10-02, c2f5b466).
- **`clearConclusionPremise` on a response** always clears, so a response reported by E-8 can be repaired. The spec did not say this; without it, such a response could not be repaired.
- **Test placement:**
  - grammar rule cases are in `test/grammar/response-rules.test.ts`;
  - forking a response is in `response-links.test.ts`;
  - the shared builders are in `test/core/response-fixtures.ts`.

## Not done here

- The combined review of 6.0.0, the consumer's validation of the release candidate, and the release itself.
- The carrying item (backlog) is still to be specified.

## Speed, judged (2026-10-02)

The plan's verification item asked a person to read the check timings against expected response sizes. The maintainer, relayed by the requester, judged them acceptable: the 16-column ceiling stays, and above it the checks answer `undetermined` as they do today. The consumer runs the checks when a response is published and in the background after an edit pauses, never on every keystroke. This closes that item.

## Changed after this outcome

Commit 6418cc30: a response may use the claims of the argument it answers (maintainer decision; spec amendment of 2026-10-02). It removes `LINK_CLAIM_USED_BY_TARGET`, `claimBindingConflicts` and `convertToLink`, and makes `positionClassOf` and `linkTargetsElement` look through formula nodes at a premise's root. Commit 8cc1387d, found while specifying the carrying item, fixes `strictUnknownAssignmentKeys`.
