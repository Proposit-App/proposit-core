# Stop expanding premise-bound subtrees again at every reference

Found by the combined 6.0.0 review (carrying), and confirmed by running a probe.

## Problem

`createTargetExpander` (`src/lib/core/response/combined-premise-set.ts`, around lines 246-247) remembers only expansions made at the top level. A premise reached through a premise-bound variable inside another expansion is rebuilt every time it is reached.

For a chain of premises where each `q_i` is `q_{i-1} ∧ q_{i-1}`, over only 3 columns, one affirm link took:

| Depth | Time |
|---|---|
| 10 | 3 ms |
| 14 | 24 ms |
| 16 | 71 ms |
| 18 | 264 ms |

The time roughly doubles with each level. The column ceiling counts columns, not formula size, so nothing caps this.

This is shared with `checkLink` and `checkResponseCoherent` through `buildCombinedSet`, so it predates carrying, and the shape is contrived.

## Proposed direction

Remember each bound premise's expansion by premise id at every depth. Keep the cycle check separate from that cache, so a cached entry is never mistaken for a premise still being expanded.

## Tests

A test of depth 18 or more that finishes within a fixed bound, and a cycle test that still throws.
