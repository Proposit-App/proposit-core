# Plan

## Steps

1. **Failing tests.** In `test/conversation/conversation.test.ts`, `builder turns` block: add a helper provider that records each request's `systemPrompt` and answers with the turn's expected shape, and tests that run `createReviewTurn` and `createDistillTurn` through `executeTurn` and check the recorded prompt for the sentences in spec acceptance criteria 1-5. Done when the new tests fail on the current code, and only on the missing sentences.
2. **Review prompt.** Change the system prompt in `src/extensions/builder/review.ts` to the text in the spec's Design. Done when the review tests from step 1 pass.
3. **Distill prompt.** Add the plain-prose bullet to `src/extensions/builder/distill.ts`'s `## Instructions` list. Done when the distill test from step 1 passes.
4. **Docs and version.** Create `docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` with a Changed entry; set `package.json` to `6.0.2`. Done when `pnpm run check` passes and `git diff -- src/extensions/builder/simulate.ts` is empty.

## Documentation Sync

- `docs/changelogs/upcoming.md` [Any-Code-Change]: fires. Changed entry naming both prompts.
- `docs/release-notes/upcoming.md` [Public-API]: fires, because consumers see different reply formatting. A short Changed entry.
- `docs/api-reference.md`, `skills/proposit-core/SKILL.md`, `skills/proposit-core/docs/*.md` [Public-API / Public-Engine-API]: do not fire. They name the builder turns but do not describe their prompts or reply formatting, and no signature changes.
- `README.md`, `CLI_EXAMPLES.md`, `skills/proposit-core/docs/cli.md`, `scripts/smoke-test.sh` [Public-CLI-API]: do not fire. No command, flag or output format of the CLI changes. The REPL (`src/cli/builder-repl.ts:67-68`) prints the reply text as it arrives, so its Markdown markers show literally, and none of these documents describe the REPL's output.
- `README.md#invalid-constructions`, `AGENTS.md`, engine interface JSDoc, `examples/arguments/*.yaml`: do not fire.

## Verification

- The model's compliance with the prompts cannot be checked by unit tests. The consumer's tarball validation and the QA plan cover it.
- Live runs are not part of this change's checks: they cost tokens and the outcome varies between runs.
