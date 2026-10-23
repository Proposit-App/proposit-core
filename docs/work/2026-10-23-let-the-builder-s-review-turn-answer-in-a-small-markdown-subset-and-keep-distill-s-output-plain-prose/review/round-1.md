---
verdict: accepted
judges: 1
---

# Review round 1

Reviewed by a separate read-only reviewer agent that did not write the code. This review ran after 6.0.2 had already been merged, tagged and published, which was out of order: review and qa should come before the release steps.

## Checks

`pnpm run check` at 79390098 exited 0. Test files: 148 passed, 5 skipped. Tests: 3330 passed, 15 skipped.

## Acceptance criteria

1. Met. `review.ts:37` contains the formatting-allowance sentence word for word, with literal `**bold**` and `*italic*`. A test pins it.
2. Met. `review.ts:37` contains the prohibitions sentence. A test pins it.
3. Met. `review.ts:37` contains the numbered-list sentence. A test pins it.
4. Met. `review.ts:35` contains the reworded single-message line, and the old phrase "parse or structure the argument" is gone. A test checks both.
5. Met. The plain-prose bullet in `distill.ts` comes right after the "single coherent prose passage" bullet. A test pins it.
6. Met. `git diff 3785b4c7 da29ecc6 -- src/extensions/builder/simulate.ts` and `git diff 0a7abd95 HEAD -- …` are both empty.
7. Met, by reasoning. None of the four new sentences occurs in the old `review.ts`/`distill.ts` at 0a7abd95, and the old phrase does occur once, so every new assertion fails on the old prompts. The implement round records seeing them fail when run before the change. Each test reads `req.systemPrompt` from a recording provider, which is the prompt actually sent.
8. Met (see Checks).
9. Met. `package.json` is 6.0.2, and the tag `v6.0.2` exists.

## Capabilities

`capabilities.yaml` declares nothing. That is correct: `tcw capabilities search builder|review|distill` return nothing, and no documentation describes the prompts.

## Documentation

The changelog and release notes are public-safe and name only "a consumer". The reviewer pointed out that the changelog's "`createSimulateTurn` is unchanged. Pinned by …" read as if a test pinned simulate. That was fixed in ad371d7e: the pin now names the review and distill prompts. The release notes say the reviewer "puts two or more questions in a numbered list" without saying this is only a prompt instruction. The "may now use" framing softens it enough, and it was left as written.

## Stale claim in the implement round

Round 1's "Not merged or tagged" was true when written. The change has since been merged (79390098), tagged v6.0.2 and published.
