# Bound the response check-analysis cache and key it on the asking response

Found by the combined 6.0.0 review (response arguments).

## Problem

`src/lib/core/response/check.ts` (around lines 58-61 and 219-227) and `argument-engine.ts` (around 3093) cache the analysis behind `checkLink` and `checkResponseCoherent`. The cache is keyed by the target snapshot object, then by the response's `combinedChecksum`.

1. **It never shrinks.** Entries are never removed. While an app holds one target snapshot and an author keeps editing the response, every edit adds an entry. That is confirmed by reading the code.
2. **It does not key on which engine asked.** It is suspected, not shown, that two different responses checked against the same snapshot object share a key whenever their 32-bit FNV checksums collide. FNV is not collision-resistant, and the engine accepts caller-chosen ids, so a collision can be crafted. The second response would then get the first one's analysis: wrong statuses, or a "Premise is not a link" error.

## Proposed direction

Key on the engine instance (a WeakMap from engine to checksum and analysis), and keep only the latest analysis per engine and snapshot, or bound the per-snapshot map.

## Tests

- A response edited many times against one snapshot holds one cache entry.
- Two responses with colliding checksums get their own analyses. Build the collision with chosen ids, or inject the checksum.
