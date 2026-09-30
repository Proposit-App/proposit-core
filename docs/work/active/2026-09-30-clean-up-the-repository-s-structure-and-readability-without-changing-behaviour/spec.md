# Spec — Clean up the repository's structure and readability without changing behaviour

## Capability changes

None. No user-facing capability is added or removed. Two small CLI corrections
(below) change error behaviour only.

## Why

A read-only review of the whole repository on 2026-09-30 found large files
mixing several jobs, code copied between files, comments that narrate history
instead of describing behaviour, tests that do not follow the source layout, a
published skill that describes an engine this library stopped being, and a peer
dependency nothing uses. The maintainer approved every cleanup batch below and
decided the open questions.

## Hard constraints

- **No change to library behaviour.** The public API is pinned by
  `docs/api-surface.txt`, checked by `pnpm run build`; it must not change except
  where a step below says so. Error messages and the order of checks stay
  exactly as they are.
- **Pure moves stay pure.** A file split or function extraction moves code
  without editing its logic. Where a fix is needed, it lands as a separate
  commit.
- Each batch is its own branch, merged to `main` only after `pnpm run check` and
  `pnpm run build` pass. A batch that moves tests keeps the test count
  identical.

## Not doing (decided)

- Moving engine mutation methods or the restore factories (`fromSnapshot`,
  `fromData`) out of the engine classes: discarded twice before, because they
  write private state and consumers subclass the engines.
- Merging the deliberately separate evaluation switch in `premise/evaluation.ts`.
- Moving `evaluateArgument`'s attribution block.
- Removing unused public exports (the `V2` names, unused codes, `isContested`).
- Reorganising `docs/.archive/`, splitting `docs/api-reference.md`, or merging
  `CLI_EXAMPLES.md` into the README.
- Replacing the second Belnap evaluator in propagation (a hot path; needs a
  benchmark, so it is not part of a no-behaviour-change cleanup).

## Batches, in the order they will be done

1. **Comments and dead code.** Rewrite history-narrating comments (about 45:
   "As of core 1.0.2", "legacy grammarConfig", references to removed code) as
   statements of the rule they protect, and remove planning labels (`D5 —`,
   `D3 —`, "(Phase C)", "(added in Task 2)"). Remove stale mentions of the
   deleted first finalize, `resolveApiKey`'s always-empty seam, tombstone
   comments in `types/validation.ts`, and wrong comments in `conversation/turn.ts`,
   `chat-completions/errors.ts` and `ieee/formatting.ts`. Drop the unused
   `openai` peer dependency and correct the documents that describe it.
2. **Remove copies of the same code.** Premise-engine wiring in
   `argument-engine.ts` (three copies), the variable-adding guards and storage,
   `ExpressionManager`'s expression storage (four copies), the grammar child-map
   helper (three copies), the "permissive build then normalize" block (two
   copies), the two providers' TypeBox-to-JSON-Schema walkers and HTTP error
   classification, and the CLI's `assertNotPublished`, premise lookup and error
   message helpers.
3. **Put files where they belong.** `utils/derivation-validation.ts`,
   `consts.ts`, `shortenToLength`, the loose `expression-manager-*.ts` files,
   `cli/llm/`, `cli/output.ts` beside `cli/output/`, scribe's import from
   scholar, and a sectioned root export file.
4. **Split the large files.** `finalize-response-v2.ts` into a `finalize/`
   folder; propagation out of `evaluation/argument-evaluation.ts`;
   `utils/changeset.ts` into merge and order; the stage runner out of
   `pipelines/scheduler.ts` (breaking the import cycles); `changeOperator`,
   `ArgumentParser.build` and `forkArgument` into private helpers;
   `segment-templates.ts` into shared fragment builders and per-category files,
   proved by comparing every template before and after.
5. **Tests.** Split `test/core.test.ts` (24,930 lines) along its `describe`
   blocks into `test/core/`, move CLI and pipeline tests into `test/cli/` and
   `test/pipelines/`, merge the two `orderChangeset` suites, rename
   `parser.test.ts`, gather the citation tests, and share the copied
   `createDeterministicGenerateId`.
6. **Repository housekeeping.** Fold `docs/CHANGELOG.md` into
   `docs/changelogs/`; delete the old migration guides (maintainer's decision);
   remove the stray `.ltstash` entry from `tsconfig.json` and the one-off
   `scripts/rewrite-v2-expected.ts`; index `examples/texts/`; make the pull
   request template generic; add a CI check that the committed generated parser
   matches the grammar.
7. **Maintainer decisions that change behaviour or published content**, each its
   own commit:
   - Rewrite `skills/proposit-core/` against today's API, stop shipping this
     repository's internal testing notes in it, and add documentation entries
     to `tcw-config.yaml` so a change to the public API or CLI prompts updating
     the skill.
   - Investigate whether `repair` saving without the "already published" check
     is a bug; if it is, reproduce it with a failing test first, then fix it.
   - Make `analysis show` and `analysis reset` check that the analysis file
     exists, as the other analysis commands do (a failing test first).

## Acceptance criteria

1. Every batch merged to `main` with `pnpm run check` and `pnpm run build`
   passing, and `docs/api-surface.txt` unchanged except where batch 1 or 7 says
   otherwise (none is expected).
2. The test count after batch 5 equals the count before it.
3. No comment in `src/` or `test/` carries a planning label, and no comment
   describes code that no longer exists.
4. `package.json` declares no `openai` peer dependency, and no document says
   the provider needs it.
5. `skills/proposit-core/` describes four-valued evaluation, claims and the
   current CLI, and `tcw work docs` lists entries covering it.
6. `repair` and the two analysis commands behave as decided, each pinned by a
   test that failed before its fix.
