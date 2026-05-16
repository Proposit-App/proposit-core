# Public `engine.patchExpressionAppFields(id, fields)` API for stamping AN-synthesized expressions

## Context

`proposit-server`'s cycle 3 (Grammar Tiers, branch
`grammar-tiers/server`) introduced the `stampAnSynthesizedAppFields`
helper at `src/model/logic.ts:145-196` to backfill
`creatorId` / `createdOn` (and the type-discriminated null fields
`variableId` / `operator`) on expressions that core 1.0's AN
(auto-normalization) post-hook synthesizes inside
`captureChangesetByDiff`. The cycle 3 dual-review flagged the
mechanism as fragile — see review synthesis at
`proposit-orchestration/docs/reviews/proposit-server/2026-05-15-73565665-ce2c6af9.md`
§P2 #1.

## Problem

The server needs to invalidate the cached checksum on each
AN-synthesized expression after patching its app-level fields, so the
diff's after-snapshot (taken inside `captureChangesetByDiff` after the
mutation block returns) recomputes the entity checksum from the
patched values rather than the cached pre-patch hash. The only way to
do this today is to reach into the engine's internals:

```ts
// src/model/logic.ts:172-193
const pm = engine.findPremiseByExpressionId(expr.id)
const internal = pm?.getExpression(expr.id) as
    | Record<string, unknown>
    | undefined
if (!internal) continue
if (needsCreatorId) internal.creatorId = creatorId
if (needsCreatedOn) internal.createdOn = createdOn
if (needsVariableIdNull) internal.variableId = null
if (needsOperatorNull) internal.operator = null
// …
const pmRaw = pm as unknown as {
    expressions?: { markExpressionDirty?: (id: string) => void }
}
pmRaw.expressions?.markExpressionDirty?.(expr.id)
```

Two patterns of internal-API reach in one helper:

1. **`pm.getExpression(id)` returns the engine's internal `Map` entry
   and the server mutates it in place.** `getExpression` is a public
   method but the contract is "give me a read-only view of the
   expression"; the in-place patch survives only by accident of the
   current Map-backed implementation.
2. **`(pm as unknown as ...).expressions?.markExpressionDirty?.(id)`
   reaches through `unknown` to invoke a method on
   `PremiseEngine.expressions` (the internal `ExpressionManager`).**
   `markExpressionDirty` exists on the `ExpressionManager` class and
   is load-bearing (10+ internal callsites in core), but it's not
   on `PremiseEngine`'s declared public surface. The double-`unknown`
   cast bypasses the type system entirely.

Both patterns survive core's current implementation but break silently
on any refactor — for example, if `ExpressionManager` becomes private,
gains a different dirty-flag mechanism, or `getExpression` switches to
returning a defensive copy. The server's unit-test suite passes today
but production divergence would surface as checksum mismatches on the
next mutation that touches a stamped entity.

## Why the server has to stamp at all

Core 1.0's AN rules synthesize new `formula` / `operator` /
`variable` expressions for several normalization patterns:

- **AN-1** inserts a `formula` buffer between non-`not` operators.
- **AN-4** reparents same-operator absorb cases through a `formula`.

These synthesized expressions are emitted into the engine state but
do not carry app-level metadata fields. Specifically:

- `creatorId` and `createdOn` are required by the server's DB schema
  (NOT NULL) and participate in the expression's entity checksum (per
  `@proposit/shared/checksum`'s `expressionFields`).
- The discriminated-union representation in the server's wire format
  requires explicit `variableId: null` on `formula` and `operator`
  expressions, and explicit `operator: null` on `formula` and
  `variable` expressions.

The server stamps these fields inside the `captureChangesetByDiff`
window so the diff's after-snapshot's `combinedChecksum` agrees with:
(a) the DB write (which uses the post-stamp values), and (b) the next
engine reload's freshly-computed checksum (which reads the stamped
values from the DB).

Stamping post-diff is wrong (three-way checksum divergence — see the
comment block at `src/model/logic.ts:127-143`). Stamping inside the
diff requires invalidating each patched expression's cached checksum,
which is what `markExpressionDirty` does.

## Proposed change

Add a single public method on `ArgumentEngine` (or on `PremiseEngine`
if the per-premise scope is preferred — both work for the server's
use case):

```ts
/**
 * Patch app-level fields on an expression in-place and mark it dirty
 * so `flushChecksums()` (and the snapshot's auto-flush) recompute
 * its entity checksum + ancestor chain from the patched values.
 *
 * Intended for application-layer adapters that need to backfill
 * fields the core engine does not own (creatorId, createdOn,
 * timestamps, etc.) on expressions synthesized by AN inside a
 * captureChangesetByDiff window. Fields that participate in
 * the entity checksum (per the consumer's checksumConfig) MUST be
 * patched through this method rather than via `getExpression(id)`
 * mutation, otherwise the cached checksum becomes stale.
 *
 * Throws if `expressionId` doesn't exist.
 */
patchExpressionAppFields(
    expressionId: string,
    fields: Partial<TPropositionalExpression>
): void
```

Implementation sketch:

```ts
patchExpressionAppFields(expressionId, fields) {
    const pm = this.findPremiseByExpressionId(expressionId)
    if (!pm) throw new Error(`Expression ${expressionId} not found`)
    const internal = pm.expressions.getExpressionInternal(expressionId)
    Object.assign(internal, fields)
    pm.expressions.markExpressionDirty(expressionId)
}
```

(`getExpressionInternal` is the new name for the existing
`getExpression` Map-lookup; the public `getExpression` then becomes a
defensive copy.)

Alternative API shape: a bulk variant
`engine.markSynthesizedDirty(ids: string[])` plus the existing
`getExpression` keeping its in-place-Map-entry semantics documented.
This is simpler but leaves the in-place mutation pattern on the
public contract. The named `patchExpressionAppFields` is preferred
because it encapsulates the patch-and-mark sequence as one atomic
operation, removing the chance that a future caller patches without
marking dirty (silently stale checksum) or marks dirty without
patching (no-op).

## Test cases

In `test/core.test.ts`:

1. **`patchExpressionAppFields` patches the field and recomputes the
   checksum.** Add a `creatorId` to an expression that previously
   lacked it. Assert the expression's `checksum` value changes (the
   checksumConfig must include `creatorId` for this to be observable;
   pass a fixture config that does).
2. **`patchExpressionAppFields` propagates the dirty flag up the
   ancestor chain.** Patch a leaf; assert the parent's
   `combinedChecksum` recomputes on next `flushChecksums()`.
3. **`patchExpressionAppFields` throws on unknown id.** Negative case.
4. **`patchExpressionAppFields` is observed correctly by
   `engine.snapshot()`.** Patch a creatorId; take a snapshot; the
   snapshot's `expressions[i].creatorId` is the patched value AND the
   `combinedChecksum` is the post-patch hash.

## Server-side follow-up after core ships this

Once core publishes a patch with `patchExpressionAppFields`:

1. Server bumps `@proposit/proposit-core` to the patch version.
2. Server's `stampAnSynthesizedAppFields` at
   `src/model/logic.ts:145-196` swaps the internal-Map mutation +
   `markExpressionDirty` cast for a single call to
   `engine.patchExpressionAppFields(expr.id, { creatorId, createdOn,
variableId, operator })`. ~30 lines down to ~5.
3. The `as unknown as { expressions?: {...} }` cast deletes.

## Scope

This change-request is independent of the
`createExpressionWithOperator` / `wrapExpression` S-8 bug filed at
`2026-05-15-createExpressionWithOperator-s8-position-bug.md`. Both
are server-side fragility points discovered by the Grammar Tiers
cycle 3 + 4d dual reviews; they may ship in the same core patch or
separate patches at core's discretion. No version dependency between
them.

The cycle 3 helper currently works against `@proposit/proposit-core@1.0.0`
on the server (proven by 753 passing unit tests + green
`pnpm run check:full`). The change-request is about long-term API
ergonomics, not a bug blocking the v0.13.0 cut.
