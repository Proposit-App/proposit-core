---
from: proposit-server
initiative: typebox-1-3-type-base-removal
---

# proposit-core: typebox 1.3.x removes Type.Base — migrate or tighten the range

Route to the `proposit-core` node. A sibling escalation with the same initiative
slug goes to `proposit-shared`; the two must land on **one** agreed resolution,
not two independent ones.

## Problem

`@proposit/proposit-core` fails to load at runtime whenever `typebox` resolves to
1.3.x:

```
TypeError: Class extends value undefined is not a constructor or null
    at node_modules/@proposit/proposit-core/dist/lib/schemata/shared.js:6
```

Line 6 is `export class TDateType extends Type.Base {`. At 1.3.x `Type.Base` is
`undefined`, so the class declaration throws at module-evaluation time — before
any consumer code runs.

## Root cause

`Type.Base` was removed in typebox 1.3.x. Tarball evidence recorded in the
consumer investigation: `build/type/types/base.mjs` is **absent** at 1.3.8, and
`build/typebox.d.mts` no longer re-exports `Base`/`IsBase` (it does at 1.1.14,
line 37).

A consumer bump reaches this because `proposit-core` declares
`typebox: "^1.1.14"`, and `^1.1.14` admits 1.3.x. `proposit-server` resolves a
single hoisted copy of typebox shared by core and shared together, so one
in-range bump breaks both packages at once.

## Proposed fix — one of two, decided jointly with `proposit-shared`

1. **Migrate off `Type.Base`.** `Type.Refine`
   (`build/type/types/_refine.d.mts`) covers the `Check`/`Errors` surface, and
   `Type.Codec` / `Decode` / `Encode` (`build/type/types/_codec.d.mts`) covers
   the string↔`Date` conversion `TDateType` exists for.
2. **Tighten the range** to `>=1.1.14 <1.3.0` and stay on `Type.Base`.

Either is acceptable to this consumer. What is *not* acceptable is core and
shared choosing differently — they share one hoisted copy, so a split decision
leaves whichever package guessed wrong broken, intermittently and confusingly.

## Consumer impact

`proposit-server` currently pins `typebox` to an exact `"1.1.14"`
(`package.json:95`) to hold the tree green. That pin is a workaround, not a
position — it blocks every typebox bump for the whole repo.

**Migrating also removes a live cost, not just a future one.** This repo already
works around a `Type.Base` defect at two sites:

- `src/model/source.ts:20-32`
- `src/model/argument/queries.ts:59`

Both comments record the same finding: `Value.Parse` on `TIntersect` schemas
containing `Base` types **can fail for valid values**, because clone/spread
strips the `~guard` property. Both sites therefore call `Value.Convert` instead
and accept the reduced validation. If option 1 is taken, those workarounds and
their comments come out.

## Test cases

- Import `@proposit/proposit-core` with typebox 1.3.x resolved: must not throw
  at module evaluation.
- `Value.Check` / `Value.Errors` on a schema carrying a `Date` field: same
  accept/reject behavior as at 1.1.14.
- Round-trip an ISO date string through decode → `Date` → encode, across a
  package boundary (the `instanceof`-across-copies hazard is already documented
  in `@proposit/shared/dist/schemas/common.js:12-15`).
- **`Value.Parse` on a `TIntersect` schema containing a date field, for a valid
  value.** This is the exact shape the consumer workarounds say fails silently
  today, and a broad suite will not catch it — a green suite is not evidence
  this one passes.

## Cross-reference

Sibling escalation: `proposit-shared` carries an independent
`class TDateType extends Type.Base` at
`node_modules/@proposit/shared/dist/schemas/common.js:12-15`, with a comment
stating custom types "must be defined locally". Same `^1.1.14` range. A
core-only fix leaves shared broken against the same hoisted copy.

Consumer work item: `2026-07-28-typebox-1-3-x-removes-type-base-breaking-proposit-proposit-core-at-runtime` (`proposit-server`).
