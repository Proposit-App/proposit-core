# Implement round 1

## What was done

1. Added four tests to `test/conversation/conversation.test.ts` (`builder turns`). A provider records each request's `systemPrompt`; the tests run `createReviewTurn` and `createDistillTurn` through `executeTurn` and check for the sentences in spec criteria 1-5. Run against the unchanged code, all four failed, each on its missing sentence (`expected 'You are a Socratic reviewer…' to contain …`), and the other 22 passed.
2. Changed the review system prompt in `src/extensions/builder/review.ts` to the spec's text.
3. Added the plain-prose bullet to `src/extensions/builder/distill.ts`'s instructions.
4. Wrote the changelog and release notes, then moved them to `docs/changelogs/v6.0.2.md` and `docs/release-notes/v6.0.2.md` in a `release: v6.0.2` commit that also sets `package.json` to 6.0.2. This follows the pattern of the v6.0.1 release commit.

Commits on branch `feat/builder-markdown-replies`: a27dcf8f (change), da29ecc6 (release). Not merged or tagged: that waits for the consumer's tarball validation.

## Test result

`pnpm run check`, run just now: exit 0. 148 test files passed, 5 skipped. 3330 tests passed, 15 skipped. Typecheck, lint, build and the API-surface check passed.

`git diff 3785b4c7 -- src/extensions/builder/simulate.ts` is empty, so simulate is unchanged.

Tarball: `pnpm pack` produced `proposit-proposit-core-6.0.2.tgz`. Its `dist/extensions/builder/review.js` and `distill.js` contain the new sentences.

## What the plan or spec got wrong

- The plan put the docs in `upcoming.md`. Because this change is released at once, they were renamed to the versioned files in the release commit, as v6.0.1 was.
- The first version of the recording provider used an `async` method with no `await`, which lint (`require-await`) rejected. It now returns `Promise.resolve`.

## Records changed

None. `capabilities.yaml` declares no changes; the ledger records no builder capability.

## Rejections answered

None (first round).
