# Upcoming changelog

`v1.0.2` is a two-rule relaxation patch on top of `v1.0.1`. It
loosens the over-strict S-8 (binary operator arity + positions) and
E-7 (argument has conclusion premise) rules that were blocking real
user workflows when downstream consumers (notably `proposit-server`'s
cycle 4f) activated the four-tier validation gates for normal-mode
users. Both fixes are bug fixes against the v1.0 contract.

## Cross-repo dependencies

- **No new dependencies.** Local patch only.
- Server bumps `@proposit/proposit-core` from `^1.0.1` to `^1.0.2`
  after this release publishes; mobile bumps in lockstep.

## Fix

### `src/lib/grammar/validators/structural.ts` — S-8 relaxed to arity-only

`validateS8` no longer checks child positions. The previous
`kids[0].position !== 0 || kids[1].position !== 1` branch is removed
along with its violation emission. Only the arity check (`kids.length
!== 2`) remains. Position semantics are now conveyed by relative
ordering ("lower-positioned child is the antecedent"), with absolute
values being sibling-ordering metadata maintained by the mutation
primitives and guarded for uniqueness by S-9.

The header comment, the rule-list table at the top of
`structural.ts`, and the JSDoc on `validateS8` were updated to
document the relaxed contract and reference the pre-1.0.2 history.

### `src/lib/core/expression-manager.ts` — revert 1.0.1 `[0, 1]` hardcodes

The `wrapExpression` (`c303aa4`) and `insertExpression` (`b9b898b`)
patches that branched on `operator.operator === "implies" || === "iff"`
to force the children to literal `[0, 1]` are reverted. Both mutation
sites now use the uniform `[POSITION_INITIAL, midpoint(POSITION_INITIAL,
POSITION_MAX)]` pattern that already covered `and` / `or`. With the
relaxed S-8, midpoint-spaced positions are valid for binary operators
just like variadic ones — the special case is no longer needed.

### `src/lib/core/premise-engine.ts` — revert SPLIT defense-in-depth

The `changeOperator` SPLIT branch's `isBinaryOp` check that pinned
the two reparented children to `[0, 1]` for binary operators is
reverted. The path uses the uniform `[POSITION_INITIAL,
midpoint(POSITION_INITIAL, POSITION_MAX)]` pattern. (The branch
remains unreachable for `implies` / `iff` today because S-5 throws
on non-root binary operators at `addExpression` time before the
reparent fires — the defense-in-depth is moot under the relaxed S-8.)

### `src/lib/grammar/validators/evaluable.ts` — E-7 threshold moved to 2+ premises

`validateE7` no longer fires on the 1-premise case when no
`conclusionPremiseId` is set. The function now:

1. Checks for a dangling `conclusionPremiseId` first (set but no
   matching premise) — always a violation regardless of count.
2. If no `conclusionPremiseId` is set, returns `[]` for
   `premises.length < 2`; otherwise emits the "no conclusion
   designated" violation.

The early-return-on-zero is folded into the "< 2" check. The JSDoc
documents the new threshold and the rationale (the 1-premise case is
trivially auto-promotable).

### `docs/Proposit_Grammar.md`, `README.md`, `AGENTS.md`

Spec, README, and per-repo guide updated to describe the relaxed S-8
(arity-only) and E-7 (2+-premise threshold) contracts. The pre-1.0.2
history is preserved as a parenthetical note for future archaeology.

### `test/grammar/structural.test.ts`

The S-8 describe block was retitled "S-8 binary operator arity
(implies/iff have exactly 2 children)". The "non-[0, 1] positions"
violation test was reformulated as two pass-cases asserting that
`[5, 10]` and `[0, 1073741823]` are now valid S-8 states. The
existing `[0, 1]` pass-case is retained for completeness.

### `test/grammar/evaluable.test.ts`

The E-7 describe block was updated: the "1-premise no-conclusion
violation" case was rewritten as a "2+ premise no-conclusion
violation" case, and a new pass-case was added asserting that
1-premise-no-conclusion is exempt. The `validateEvaluable`
aggregator test was updated to use a 2-premise fixture so E-7 still
fires (it previously used a 1-premise fixture that no longer fires
under the relaxation).

### `test/core.test.ts`

Two new regression test groups:

1. The S-8 regression tests landed by 1.0.1 (`wrapExpression` ×3 and
   `insertExpression` ×2 for `implies`/`iff`) were rewritten to
   assert midpoint-spaced positions instead of `[0, 1]`, and to
   continue asserting `engine.validate("structural").filter(v =>
v.code === "S-8")` is empty. The `and`/`or` midpoint regression
   guards are retained as-is.
2. A new top-level `describe("ArgumentEngine — E-7 exempts
1-premise no-conclusion state")` block with three engine-level
   integration tests: - The smoke-test reproducer (createPremiseWithId +
   clearConclusionPremise + `validate("derivable")` filter for
   E-7 is empty). - A `validate("presentable")` superset check (no E-7 at any
   tier for the 1-premise no-conclusion state). - The opposite-direction regression (2+ premises +
   clearConclusionPremise still fires E-7).

### Change request

The change request that scoped this fix
(`docs/change-requests/2026-05-15-relax-s8-and-investigate-e7-gate-firings.md`)
is removed from the worktree per the change-request lifecycle
convention.

## Why this didn't surface earlier

S-8's position pin and E-7's 1-premise threshold were both written
into core 1.0.0 without ever being exercised against real user data:

1. S-8's position pin was originally motivated by the (correct)
   intuition that "antecedent comes first, consequent comes second."
   That ordering is preserved by the relaxed S-8 (lower position =
   antecedent) without needing the literal pin.
2. E-7's `>= 1` threshold was written before the shared
   `mutateCreatePremise` helper's "honor the requested role even on
   the first premise" behavior was wired into the server gate.
   `proposit-server`'s cycle 4f exposed the conflict.

Both rules' relaxed forms are what the v1.0 spec arguably should
have specified at the outset; the 1.0.2 patch closes the gap.

## Hash range

`b1abed0..HEAD`
