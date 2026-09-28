# Upcoming

## Added

- `TChatCompletionsFetch` is exported from
  `@proposit/proposit-core/extensions/chat-completions`. It is the type of
  `TChatCompletionsProviderConfig.fetch`, which was public without it.
- `TStageOutcomeRecordMap` (`Readonly<Record<string, TStageOutcomeRecord>>`)
  is exported from `@proposit/proposit-core/pipelines/scheduling`. It is the
  `records` parameter of `isStageEligible`, `hasRequiredFailureUpstream` and
  `computeDagProgress`. It was a private alias named `TRecordMap`.

## Internal

- `typedoc.json` lists the `extensions/openai`, `extensions/chat-completions`,
  `builder` and `pipelines/scheduling` subpaths as entry points. Their API is
  now in the generated site and in `docs/api-surface.txt` (240 lines), so
  `pnpm run docs` fails when one of their members disappears. `./conversation`
  needed no entry point: the root index re-exports all of it.
