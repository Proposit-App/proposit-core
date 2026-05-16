# Upcoming release notes

Patch release relaxing two grammar rules that were over-strict and
blocking real user workflows when downstream consumers (notably
`proposit-server`) activated the four-tier validation gates for
normal-mode users. Both fixes are bug fixes against the v1.0
contract; no API surface changes.

## What changed

### S-8 relaxed to arity-only — implies/iff position pin removed

S-8 previously required `implies` / `iff` children to sit at literal
positions `[0, 1]`. That check was over-strict — sibling positions
are sibling-ordering metadata, not Structural invariants, and
sibling-position uniqueness is already enforced separately by S-9.

The pre-1.0.2 reading false-flagged any binary operator whose
children sat at the engine's default midpoint-spaced positions (e.g.,
`[0, 1073741823]`, the natural `wrapExpression` / `insertExpression`
spacing for variadic operators). It also false-flagged pre-1.0.1
arguments persisted with midpoint-spaced binary children — a real
data corpus the engine then refused to re-validate cleanly.

S-8 is now arity-only: `implies` / `iff` must have exactly two
children. The lower-positioned child is the antecedent and the
higher-positioned child is the consequent; any `[a, b]` with `a < b`
is valid.

Knock-on cleanups: the 1.0.1 patches that pinned `wrapExpression`,
`insertExpression`, and the `changeOperator` SPLIT path to literal
`[0, 1]` for binary operators have been reverted. All four mutation
sites now use the uniform midpoint-spaced pattern, mirroring
`and` / `or`.

### E-7 relaxed to fire only on 2+ premises

E-7 previously fired on any argument with `≥ 1` premises and no
designated conclusion. The threshold has moved to `≥ 2`: a 1-premise
argument with no designation is exempt — the single premise is
trivially the conclusion regardless of designation, so requiring an
explicit `conclusionPremiseId` adds no semantic information.

The pre-1.0.2 reading blocked the most common new-argument UI flow:
when a user added their first premise via an "Add Premise" button
that defaulted to `role: "supporting"`, the upstream `mutateCreatePremise`
helper honored that role by undoing core's auto-conclusion-assignment
— leaving the engine with 1 premise / no conclusion and tripping E-7
in the server's normal-mode Derivable gate. Users couldn't add their
first premise without a 422.

A dangling `conclusionPremiseId` (set, but no premise has that id)
remains a violation at any cardinality — that's a data-integrity
concern, not a designation-completeness concern.

## Impact

Consumers calling `engine.validate(tier)` (any tier ≥ Structural for
S-8; any tier ≥ Evaluable for E-7) will see fewer false positives.
Specifically:

- Pre-1.0.1-era arguments with midpoint-spaced binary children no
  longer trip S-8.
- The "user added their first premise via `role: 'supporting'`" path
  no longer trips E-7.

No data migration is required. No API surface changed.

## What didn't change

- `POSITION_INITIAL` / `POSITION_MAX` constants — unchanged.
- The `midpoint`-spacing strategy for both binary and variadic
  operators — unchanged after the 1.0.1 reverts (now uniform across
  all binary writes).
- S-9 sibling-position uniqueness — unchanged; still the only rule
  guarding position collisions.
- E-7 dangling-reference check — unchanged; still fires at any
  premise count.
- No new error codes, validator codes, or schema fields.
