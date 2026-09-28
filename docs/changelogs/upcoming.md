# Upcoming

## Changed

- `orderChangeset` no longer emits an expression update before the insert
  it depends on. An expression updated to point at a parent the changeset
  inserts (as `wrapExpression`, `insertExpression` and `toggleNegation`
  produce), or at a variable it inserts (as combined changesets can), is
  detached in phase 2 with the same `{ id, parentId: null, position: 0 }`
  update a removed expression gets. It is then updated in full after the
  expression inserts. When any such update points at a new variable, the
  variable and premise deletes (phases 4 and 5) run after it instead of
  before the inserts. The stored row still names its old variable, and
  where the variable key cascades (proposit-app's does), deleting it first
  silently deleted the row. A changeset with no such update is ordered
  exactly as before. The two exceptions the 5.4.0 docs listed are gone. One
  remains, only when the deletes are held: a removed variable and an
  inserted one sharing a symbol, which a per-statement unique-symbol rule
  rejects.

## Tests

- `test/order-changeset-fk.test.ts` applies every changeset to two
  simulated stores: one that refuses a delete while a row points at the
  deleted row, and one that cascades such deletes, where a wrongly timed
  delete shows up as a lost row. It gains reproductions for each dependent
  update, a random test over changesets combined with `composeChangesets`
  (1,000 seeds per behavior, in both stores), and a pin that a changeset
  with no dependent update keeps its order.
