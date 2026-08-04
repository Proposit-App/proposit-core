# Verification: Ingestion pipelines author premise titles

**Accepted** 2026-08-04.

## What the acceptance rests on

- `pnpm run check` green: 78 test files, 2358 tests, prettier + eslint clean,
  build clean. Run by the coordinating session, not taken on a subagent report.
- All eight acceptance criteria in `spec.md` are covered by tests, including
  both directions of the conclusion-title guard.
- A live Scribe run outside the golden corpus returned noun-phrase titles
  (`Cost-free lending removes barriers`, `Barrier removal yields access`,
  `Access from free lending`), with the conclusion premise taking an authored
  title rather than echoing its claim — the guard firing on real output, not a
  fixture.
- Twenty golden files re-recorded against the live API. Premise formulas and
  roles are unchanged in every fixture, so the spec's "prompt changes shift
  model behavior" risk did not materialize.

## Accepted knowingly

An authored gloss can drift from the premise it labels where the composed title
could not. Bounded by the strict first-candidate guard (the one case where a
title could be confidently about the wrong claim) and by the title being
user-editable before publish.

## Version

Patch, at the user's direction. Noted at acceptance: `RelationExtractionOutputSchema`
gained a **required** `title`, so a consumer composing a custom pipeline that
emits relations without one would now fail validation. Consumer-visible; the
patch number does not signal it.
