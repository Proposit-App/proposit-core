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
  silently deleted the row. The two exceptions the 5.4.0 docs listed are
  gone. Two remain, only when the deletes are held, both a per-statement
  unique rule meeting a row not yet deleted: an inserted variable reusing a
  removed one's symbol, and an inserted conclusion premise while the removed
  conclusion premise still exists.
- `orderChangeset` orders a change of premise around the premise rows it
  names.
    - An expression update whose `premiseId` is a premise the changeset
      inserts is handled like one pointing at a new variable. This arises when
      a combined changeset removes an expression and adds one with the same id
      to a new premise.
    - Variable updates no longer run last (phase 9). They run after the
      variable deletes and before the premise deletes, so a variable rebound
      off a removed premise leaves it before the premise is deleted. Before,
      the premise delete ran while the stored variable still named it, and
      where the bound-premise key cascades (proposit-app's does) that deleted
      the variable and every expression naming it.
    - A variable bound to a premise the changeset inserts is updated right
      after the premise inserts, and the premise deletes wait for it. The
      one-conclusion exception above applies then too. The symbol exception
      does not, because the variable deletes still run first.
    - A changeset with no variable update and no expression update that needs
      an insert first is ordered exactly as before.
    - One side effect: a variable renamed off a symbol that an inserted
      variable takes is now accepted by a store with a per-statement unique
      symbol rule, because the update runs before the insert, unless the
      deletes are held. Held, all variable updates run after the inserts, so
      that case joins the exceptions above.
    - An expression moved into a new premise holds the deletes, like one
      pointing at a new variable, so both exceptions above apply to it.

## Tests

- `test/order-changeset-fk.test.ts` applies every changeset to two
  simulated stores: one that refuses a delete while a row points at the
  deleted row, and one that cascades such deletes, where a wrongly timed
  delete shows up as a lost row. It gains reproductions for each dependent
  update, a random test over changesets combined with `composeChangesets`
  (1,000 seeds per behavior, in both stores), and a pin that a changeset
  with no dependent update keeps its order.
- The simulated stores also model a premise-bound variable's key to its
  premise, refusing or cascading a premise delete while a variable is bound
  to it. They gain reproductions for a variable rebound off a removed premise
  and for an expression id reused in a new premise. The random test also
  rebinds and renames variables and reuses an expression id in a new
  premise, and compares premise rows at the end. Exact-order pins cover a
  replaced premise with no variable update and with its variable rebound.

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
