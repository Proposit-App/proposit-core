# Upcoming changelog

`v1.0.2` is a two-fix patch on top of `v1.0.1`:

1. **S-8 relaxed to arity-only** — drops the over-strict literal
   `[0, 1]` position pin on `implies` / `iff` children that was
   false-flagging the engine's own midpoint-spaced output.
2. **Engine-enforced E-7 invariant** — adds mutation-surface guards
   so the engine cannot leave a non-empty argument without a
   conclusion designated. E-7's validator-level reading is restored
   to its strict pre-1.0.2 form.

Both fixes are bug fixes against the v1.0 contract. No API surface
changes (the two affected method signatures stay identical; only
their pre-conditions / post-conditions tightened).

## Cross-repo dependencies

- **No new dependencies.** Local patch only.
- Server bumps `@proposit/proposit-core` from `^1.0.1` to `^1.0.2`
  after this release publishes; mobile bumps in lockstep.

## Fix 1 — S-8 relaxed to arity-only

### `src/lib/grammar/validators/structural.ts` — `validateS8`

The `kids[0].position !== 0 || kids[1].position !== 1` branch and
its violation emission are removed. Only the arity check
(`kids.length !== 2`) remains. The function's JSDoc, the rule-list
comment at the top of the file, and the trailing describe-block
header in `structural.test.ts` are updated to describe the relaxed
contract and reference the pre-1.0.2 history.

### `src/lib/core/expression-manager.ts` — revert 1.0.1 hardcodes

The `wrapExpression` (`c303aa4`) and `insertExpression` (`b9b898b`)
patches that branched on `operator.operator === "implies" || === "iff"`
to force the children to literal `[0, 1]` are reverted. Both
mutation sites now use the uniform `[POSITION_INITIAL,
midpoint(POSITION_INITIAL, POSITION_MAX)]` pattern that already
covered `and` / `or`.

### `src/lib/core/premise-engine.ts` — revert SPLIT defense-in-depth

The `changeOperator` SPLIT branch's `isBinaryOp` check that pinned
the two reparented children to `[0, 1]` for binary operators is
reverted. The path uses the uniform midpoint pattern.

### `src/lib/grammar/repair.ts` — comment on `pickLargestAntecedent`

The `position === 0` antecedent lookup at line 274 is intentional
under the current call topology (the only caller writes literal
position 0). A comment near the lookup documents the dependency on
the writer's choice and references the post-relaxation contract.

### `test/grammar/structural.test.ts`

S-8 describe block retitled. The pre-1.0.2 "non-[0, 1] positions"
violation case is reformulated as two pass-cases: `[5, 10]` and
`[0, 1073741823]` are now valid S-8 states. The existing `[0, 1]`
pass-case is retained. Arity-1 and arity-3 violation tests
unchanged.

### `test/core.test.ts` (S-8 region)

The five S-8 regression tests landed by 1.0.1 (3 in `wrapExpression`,
2 in `insertExpression` — `implies`/`iff`) are rewritten to assert
midpoint-spaced positions instead of `[0, 1]`. Each continues to
assert `engine.validate("structural").filter(v => v.code === "S-8")`
is empty. The `and` / `or` regression guards are unchanged.

## Fix 2 — Engine-enforced E-7 invariant on non-empty argument

### `src/lib/grammar/validators/evaluable.ts` — `validateE7`

Reverted to the strict pre-1.0.2 form: any non-empty argument with
`conclusionPremiseId === undefined` fires, regardless of premise
count. A dangling `conclusionPremiseId` (set, but no premise has
that id) still fires at any premise count. The JSDoc is rewritten
to document the new framing: the validator is the safety net for
snapshot loads and direct data-shape construction; the engine
mutation surface guards the invariant for the in-memory mutation
flow.

### `src/lib/core/argument-engine.ts` — `clearConclusionPremise()`

Now a no-op when `this.premises.size > 0`: returns the current
(unchanged) role state with an empty changeset rather than clearing
`this.conclusionPremiseId`. On a zero-premise argument the call
still clears (vacuous invariant). The shared helper's clear call
after `createPremiseWithId` therefore becomes a structural no-op
when the auto-conclusion-assignment was just applied; the
post-mutation state is `1 premise / that premise is the conclusion`
and E-7 passes trivially.

### `src/lib/core/argument-engine.ts` — `removePremise()`

When the removed premise was the conclusion AND other premises
remain, the conclusion role is atomically reassigned to the
**lowest-id remaining premise** (sorted lexicographically) inside
the same mutation pass that emits the `removedPremise` change. The
roles delta in the changeset reflects the new conclusion id rather
than `undefined`. When the removed premise was the conclusion AND
no premises remain, the role is cleared as before (vacuous
invariant on the empty argument). When the removed premise was not
the conclusion, no roles delta is emitted.

The lowest-id selector is the only core-knowable, deterministic,
snapshot-stable choice — core premises carry no `position` field
(premise-level ordering is server-side metadata, typically
`createdOn`). Consumers that want a non-lowest-id policy (server's
`createdOn`, UI sibling position) should issue a
`setConclusionPremise(...)` call immediately after the
`removePremise(...)` returns — the post-mutation E-7 keeps passing
because a conclusion stays designated across both calls.

### `src/lib/core/interfaces/argument-engine.interfaces.ts`

JSDoc updated on `clearConclusionPremise()` and `removePremise()`
to document the invariant-guard contract.

### `test/grammar/evaluable.test.ts`

E-7 describe block updated: the "1-premise no-conclusion" case is
restored to its strict violation form (a pass-case version was
added by the 1.0.2 relaxation that has since been rolled back).
The `validateEvaluable` aggregator test reverts to a 1-premise
fixture (sufficient for E-7 to fire under the strict reading).

### `test/core.test.ts` (E-7 region)

The "E-7 exempts 1-premise no-conclusion state" describe block
from the relaxation attempt is replaced by an "E-7 invariant guard
on non-empty argument" describe block with seven engine-level
integration tests:

1. **Smoke-test reproducer:** `createPremiseWithId` +
   `clearConclusionPremise` on a fresh argument → post-mutation
   state is `1 premise / that premise is the conclusion` (the
   no-op guard refused to clear). Mirrors the server-side
   `sharedCreatePremise(engine, id, { role: "supporting" })` call
   sequence end-to-end.
2. **Presentable superset:** `validate('presentable')` returns no
   E-7 for the smoke-test post-state at any tier.
3. **Multi-premise guard:** `clearConclusionPremise` on a 2-premise
   argument is also a no-op (the guard is cardinality-independent
   for non-empty arguments).
4. **Snapshot-load safety net:** an engine restored from a snapshot
   whose `conclusionPremiseId` was surgically nulled validates with
   an E-7 violation — the mutation-surface guards bypass snapshot
   loads, so the validator stays load-bearing for that path.
5. **2-premise auto-reassign:** `removePremise(conclusionId)` on a
   2-premise argument auto-promotes the other premise (lowest-id)
   to conclusion; E-7 stays clean.
6. **3-premise auto-reassign chain:** delete the middle conclusion
   premise → auto-promote lowest remaining; delete the new
   conclusion → auto-promote next lowest; delete the last → role
   clears (vacuous). E-7 stays clean across all three deletes.
7. **Non-conclusion delete leaves roles untouched:** removing a
   non-conclusion premise emits no `roles` delta in the changeset.

Three existing `clearConclusionPremise` / `removePremise` tests
needed updating to reflect the new contracts:

- "supports role APIs and removes roles when a premise is deleted"
  (line ~1878) — renamed and the assertion changed from
  `conclusionPremiseId === undefined` to `=== support.getId()` (the
  remaining premise). A companion test was added asserting the
  vacuous-empty-argument case still clears.
- "clearConclusionPremise returns empty role state" (in the
  mutation-changesets describe block) — split into "on a
  zero-premise argument clears and emits role change" and "on a
  non-empty argument is a no-op (invariant guard)".
- "notifies subscriber when conclusion is cleared" (in the subscribe
  describe block) — split into "notifies on the empty path" and
  "does NOT notify when guarded out on non-empty".
- "createPremise after clearConclusionPremise auto-sets again" (in
  the auto-conclusion-on-first-premise describe block) — rewritten
  to drain via `removePremise` before clearing, since clear on
  non-empty no longer transitions state.

### `docs/Proposit_Grammar.md`, `README.md`, `AGENTS.md`

Spec, README, and per-repo guide updated to describe the relaxed
S-8 (arity-only), the strict-restored E-7 with its engine-enforced
invariant framing, and the `clearConclusionPremise` /
`removePremise` mutation-surface contracts. The "Auto-conclusion
assignment" bullet in `AGENTS.md` gets a companion bullet for the
new "Conclusion-premise invariant (E-7)" contract.

### Change request

The change request that scoped this fix
(`docs/change-requests/2026-05-15-relax-s8-and-investigate-e7-gate-firings.md`)
is removed from the worktree per the change-request lifecycle
convention.

## Open question deferred to consumers

The reassignment selector in `removePremise(conclusionId)` is
**lowest-id** because core premises carry no `position` field.
Consumers that prefer a different policy (server's `createdOn` time,
UI-defined sibling position) can layer their own
`setConclusionPremise(...)` call immediately after the
`removePremise(...)` returns. The post-mutation E-7 keeps passing
because a conclusion stays designated throughout the
remove-then-reassign pair.

If a future consumer requests the engine accept a custom
reassignment callback or comparator, the 1.0.2 implementation
becomes the default and the API surface gains a third overload.
None of today's consumers need this, so it's deferred.

## Why this didn't surface earlier

S-8's position pin and the "clearConclusionPremise + non-empty
argument" intermediate-state break were both written into core
1.0.0 without ever being exercised against real user data:

1. S-8's position pin was originally motivated by the (correct)
   intuition that "antecedent comes first, consequent comes second."
   That ordering is preserved by the relaxed S-8 (lower position =
   antecedent) without needing the literal pin.
2. The engine's mutation surface assumed callers would keep the E-7
   invariant by convention. The cycle 4f rollout of the server's
   Derivable gate exposed the case where the shared `mutateCreatePremise`
   helper deliberately breaks the invariant to honor a caller-supplied
   `role: "supporting"` — at which point the gate fired on the next
   pass and the user couldn't make progress.

Both rules' updated forms are what the v1.0 spec arguably should
have specified at the outset; the 1.0.2 patch closes the gap.

## Hash range

`b1abed0..HEAD` (final range will be stamped in the version-bump
commit).
