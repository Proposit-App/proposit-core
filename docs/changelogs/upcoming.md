# Upcoming

## Added

- `TChatCompletionsFetch` is exported from
  `@proposit/proposit-core/extensions/chat-completions`. It is the type of
  `TChatCompletionsProviderConfig.fetch`, which was public without it.
- `TStageOutcomeRecordMap` (`Readonly<Record<string, TStageOutcomeRecord>>`)
  is exported from `@proposit/proposit-core/pipelines/scheduling`. It is the
  `records` parameter of `isStageEligible`, `hasRequiredFailureUpstream` and
  `computeDagProgress`. It was a private alias named `TRecordMap`.

## Changed

- `orderChangeset` no longer emits an expression update before the insert
  it depends on. An expression updated to point at a parent the changeset
  inserts (as `wrapExpression`, `insertExpression` and `toggleNegation`
  produce), or at a variable it inserts (as combined changesets can), is
  moved to the root in phase 2 and updated in full after the expression
  inserts. In phase 2, one late only for its new parent is written whole
  with `parentId: null, position: 0`, so it leaves its old variable before
  that can be deleted. One that points at a new variable gets only the
  `{ id, parentId: null, position: 0 }` update a removed expression gets. When any such update points at a new variable, the
  variable and premise deletes (phases 4 and 5) run after it instead of
  before the inserts. The stored row still names its old variable, and
  where the variable key cascades (proposit-app's does), deleting it first
  silently deleted the row. A changeset with no such update is ordered
  exactly as before. The two exceptions the 5.4.0 docs listed are gone. Two
  remain, only when the deletes are held, both a per-statement unique rule
  meeting a row not yet deleted: an inserted variable reusing a removed
  one's symbol, and an inserted conclusion premise while the removed
  conclusion premise still exists.

## Tests

- `test/order-changeset-fk.test.ts` applies every changeset to two
  simulated stores: one that refuses a delete while a row points at the
  deleted row, and one that cascades such deletes, where a wrongly timed
  delete shows up as a lost row. It gains reproductions for each dependent
  update, a random test over changesets combined with `composeChangesets`
  (1,000 seeds per behavior, in both stores), and a pin that a changeset
  with no dependent update keeps its order.

## Internal

- `typedoc.json` lists the `extensions/openai`, `extensions/chat-completions`,
  `builder` and `pipelines/scheduling` subpaths as entry points. Their API is
  now in the generated site and in `docs/api-surface.txt` (240 lines), so
  `pnpm run docs` fails when one of their members disappears. `./conversation`
  needed no entry point: the root index re-exports all of it.
- `pnpm run docs` (so `build` and `check`) first runs
  `scripts/check-exports-documented.mjs`. It fails when a `package.json`
  `exports` key's source file is not a typedoc entry point, unless the key is
  listed in the script as covered through the root index (`.` and
  `./conversation`, each with its reason), and names the key.
