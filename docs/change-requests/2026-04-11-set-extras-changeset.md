# Change Request: `PremiseEngine.setExtras` should produce a changeset

**Date:** 2026-04-11
**Severity:** High — blocks server-side architecture improvement
**Affected versions:** proposit-core 0.8.x+

## Problem

`PremiseEngine.setExtras(extras)` updates the premise's mutable fields (title, role, createdOn, creatorId) and marks the premise dirty, but returns an **empty changeset** (`changes: {}`). This prevents consumers from routing premise field updates through the standard `persistChangeset` pipeline.

```js
// premise-engine.js:727
setExtras(extras) {
    return this.withValidation(() => {
        const { id, argumentId, argumentVersion, checksum, descendantChecksum, combinedChecksum } = this.premise;
        this.premise = { ...extras, id, argumentId, argumentVersion, ... };
        this.markDirty();
        this.onMutate?.();
        return { result: this.getExtras(), changes: {} };  // ← empty changeset
    });
}
```

## Root Cause

`setExtras` was designed as a low-level internal method. It marks the premise dirty (so checksums are recomputed on next flush) but doesn't use a `ChangeCollector` to record the modification. All other mutation methods (`addExpression`, `removeExpression`, `updateExpression`, `toggleNegation`, `changeOperator`, etc.) use a collector and return proper changesets.

## Impact on proposit-server

The server has two persistence patterns:
1. **Engine-driven:** mutation → changeset → `persistChangeset` → DB (checksums always correct)
2. **DB-primary:** direct Knex update → manual `entityChecksum` recomputation → `engineCache.invalidate` (error-prone)

Premise title updates currently use pattern 2 because `setExtras` doesn't produce a changeset. This has caused multiple checksum bugs:
- Manual `recomputePremiseChecksums` diverges from engine computation
- The same logic must be duplicated between server (`model/logic.ts`) and client (`arg-data-context.tsx`)
- No shared mutation function exists for premise title updates — it's the only mutation that can't be shared

The server wants to eliminate all DB-primary update paths and route everything through shared mutation functions + `persistChangeset`. The `setExtras` changeset gap is the only core library blocker.

## Proposed Fix

`setExtras` should use a `ChangeCollector` and include the modified premise in `changes.premises.modified`, following the same pattern as other mutation methods:

```js
setExtras(extras) {
    return this.withValidation(() => {
        const { id, argumentId, argumentVersion, checksum, descendantChecksum, combinedChecksum } = this.premise;
        this.premise = { ...extras, id, argumentId, argumentVersion, ... };
        this.markDirty();

        const collector = new ChangeCollector();
        // Flush checksums so the changeset has correct values
        this.flushChecksums();
        collector.modifiedPremise(this.toPremiseData());
        const changes = collector.toChangeset();

        this.onMutate?.();
        return { result: this.getExtras(), changes };
    });
}
```

The return type already accommodates this — `TCoreMutationResult` includes a `changes` field that accepts premise modifications.

## Alternative: Partial update method

Instead of fixing `setExtras` (which replaces ALL extras), add a new method:

```ts
updateExtras(updates: Record<string, unknown>): TCoreMutationResult<Record<string, unknown>, ...>
```

This would merge `updates` into the existing extras rather than replacing them, and produce a changeset. This is closer to how the server uses it (updating title without touching role/createdOn/creatorId).

## Test Cases

1. Call `setExtras({ title: "New Title", role: "supporting", createdOn: new Date(), creatorId: "user1" })` → changeset should contain `premises.modified` with one entry whose `title` is `"New Title"` and checksums are correct
2. After `setExtras`, `toPremiseData().checksum` should match the premise in the changeset
3. Calling `setExtras` twice should produce two separate changesets, each with the correct state
4. `setExtras` should not include expressions or variables in the changeset (it only modifies the premise metadata)

## Priority

This is blocking the elimination of DB-primary update paths in proposit-server. The workaround (manual checksum recomputation after direct DB writes) is the root cause of 5 of 8 checksum bugs found on 2026-04-11.
