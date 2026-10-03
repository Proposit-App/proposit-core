# Outcome: checkLink reports no attempted support for a reply's links

Branch `fix/reply-attempted-support`, off main at v6.0.0. Prepared as 6.0.1.

## Cause

`hasOnConsequentSide` (`src/lib/core/response/check.ts`) stripped every `NOT` above a reason's consequent, then compared the result with the link's referent as it stood. When the referent is itself a negation, the two never matched.

A reply's link binds the content of the answered response's link, which is `NOT(x)` for a contradict link. So a reason `S → NOT(L)` expands to a consequent `NOT(NOT(x))`, which strips to `x`, while the referent is `NOT(x)`.

The same gap hit a link on a negated expression of a standard argument. The consumer's diagnosis, that one side is expanded and the other is not, describes the symptom; the comparison itself was the cause.

## Fix

The fix compares both sides up to negation: the `NOT`s above the consequent and above the referent are both set aside. Nothing else changed:

- Link merging still uses the exact referent key, with polarity.
- `carryAnswers` and `checkResponseCoherent` never use this comparison: carrying reads fixed column values, and coherence has no attempted-support answer.

## Tests

In `test/core/response-check.test.ts`, red before the fix and green after:

- Y contradicts and Z contradicts: was red.
- Y contradicts and Z affirms: was red.
- A link on a negated expression of a standard argument, with a reason: was red.

The rest of the item's cases:

- Y affirms and Z contradicts: passed before the fix in this repository's fixtures, because Y's link content `x` has no leading `NOT`. The consumer reports it failing; their setup is the thing to compare in validation.
- A bare reply link: `attemptedSupport: false`.
- A reply whose reason a citation backs: `follows`.

`pnpm run check` passes. No LLM code changed, so the live suites were not run.

## Documentation

- The API reference's `attemptedSupport` paragraph, the `TLinkCheckResult` doc comment and the skill's evaluation table now say "up to negation".
- The 6.0.1 changelog and release notes record the fix.
