# Report a claim held both ways as a claim-level contested roll-up

> **Decided 2026-08-28.** This is no longer a decision item. The maintainer
> chose the **claim-level roll-up** (option 3 below): core gains a claim-level
> `CONTESTED` roll-up beside the variable-level `contestedVariableIds` that
> already ships. Not a validation rule, and not do-nothing. The options are kept
> below as recorded rationale, not as an open question.

**The work:** group `getVariableIdsForClaim`'s answers per claim, join their
values, and emit the claim ids whose join is `CONTESTED`.

The premise was established by
`2026-08-10-getvariableidforclaim-implies-a-claim-has-one-variable-and-it-has-two`,
which scoped the decision out. That item is completed and its
`getVariableIdsForClaim` surface shipped in v4.1.0 (merged at `b0cadeb`, cut at
`2c9a640`, tagged, and live on npm). Nothing here is release-gated.

## The situation

A claim may bind more than one variable. `addVariable` enforces no per-claim
uniqueness, and a consumer's persisted shape can carry **two** per claim — an
authored variable and a derivation-synthesized one. Evaluation reaches and
values each independently.

So two variables standing for the same proposition can settle to **opposite**
values in the same evaluation. When that happens, the argument asserts one
proposition both ways, and nothing in core says so.

## Why core currently cannot see it

Core sees independent propositional variables. `claimId` is the only thing
relating them, and core treats a claim binding several variables as legitimate
— which it is, structurally. There is no rule that two variables sharing a
`claimId` must agree, and adding one silently would be a behavior change for
any consumer that relies on the current permissiveness.

A downstream consumer already detects the condition itself: it keeps a map of
each claim's propagated value, built by walking the claim's variables and
joining their values, and a claim held both ways reads as `"contested"` in that
map. There is no separate list of such claims; a client filters the map when it
wants them.

So the situation is *observable* today — just not by the engine, and not at
construction or validation time.

## Recorded rationale — the three options, and why the roll-up won

These were the three defensible answers. **Option 3 was chosen on 2026-08-28**;
1 and 2 are kept for the record, not as live alternatives.

Why the roll-up over a validation rule: option 2 is the only one that can fail
an argument a consumer accepts today, and it carries an unresolved
structural-vs-evaluative question (the condition only exists *after* an
assignment, so it does not belong to validation cleanly). Option 1 got weaker
over time — "consumers reimplement the detection" stopped being hypothetical
once a consumer shipped its own copy. Option 3 is additive, cannot fail an
existing argument, and matches a precedent that already ships.

1. **Nothing.** Two variables on a claim disagreeing is the author's business,
   consumers can already report it to readers, and core stays a permissive
   engine.
2. **A validation rule** — a new violation code raised when an evaluation
   settles two variables of one claim oppositely. Needs a decision about
   whether it is structural (raised by validation) or evaluative (raised by
   `evaluateArgument`), because the condition only exists after an assignment.
3. **A non-fatal signal** — expose the conflict on the evaluation result so
   consumers stop reimplementing the detection, without failing the argument.
   This is the option that would let consumers retire their own copies.

## Not in scope

Changing `addVariable` to enforce per-claim uniqueness. The two-variable shape
is deliberate and load-bearing for derivations; this item is about what the
engine *says* when they disagree, not about preventing them.

## Verified 2026-08-18

Two statements in an earlier draft were false and were corrected in place: a
`conflictedClaimIds` field that does not exist (the consumer's mechanism is a
per-claim value map reading `"contested"`), and the upstream item's state
(`review`, not `completed`). Both were flagged by the 2026-08-18 backlog audit.
**The item's substance survives both corrections.** What follows is the engine
that actually exists, so the decision is made against it.

### Core already has a contested vocabulary, and already reports one case

`CONTESTED` is a first-class evaluation value: `TCoreQuadrivalentValue` is
`true | false | null | CONTESTED`, implemented as Belnap's `FOUR` in
`src/lib/core/evaluation/belnap.ts` and shipped by the completed item
`2026-08-08-contested-as-a-fourth-evaluation-value-make-the-constraint-closure-confluent`.

`evaluateArgument` already surfaces it: **`contestedVariableIds`**
(`src/lib/types/evaluation.ts:286`, computed at
`src/lib/core/evaluation/argument-evaluation.ts:820-823`, returned at `:962`).
It is reported unconditionally, not behind `includeDiagnostics`, for the reason
given in the code comment at `:817-819`: *"a contested value can leave every
aggregate above reading clean, so this is the only fact that always records
one."*

### Why that does not already answer this item

`contestedVariableIds` reports **a single variable** whose constraint closure
was driven both ways. This item's case is **two distinct variables of one
claim** settling oppositely — each individually clean, `null`-free, and
non-contested. Core's closure never compares them, because `claimId` is the
only thing relating them and the engine treats a claim binding several
variables as legitimate.

So the shape of the answer is much narrower than the three options suggest:

- **Option 3 is no longer "expose the conflict at all"** — it is "add a
  claim-level roll-up beside the variable-level one that already ships". The
  precedent, the value vocabulary, the always-reported convention, and the
  naming are all settled. It is plausibly a dozen lines: group
  `getVariableIdsForClaim`'s answers, join their values, emit the claim ids
  whose join is `CONTESTED`. That also makes it the option that lets consumers
  retire their own detection.
- **Option 2 (a validation rule) still carries the structural-vs-evaluative
  question** unchanged, and it is the only option that can fail an argument a
  consumer currently accepts.
- **Option 1 (nothing) is now weaker than when this was filed**, because
  "consumers reimplement the detection" is no longer hypothetical.

### Unchanged

The "Not in scope" section stands: `addVariable` performs no per-claim
uniqueness check by design, and the two-variable shape is load-bearing for
derivations. This item is about what the engine *says*, not about preventing
the shape.

## Verified 2026-08-28

Re-audited. The options were left untouched by this audit; the decision was
made separately the same day (see the note at the top). Only stale facts around
them were corrected:

- **The opening framing was entirely stale** and has been rewritten. All four of
  its assertions were false: the upstream item is completed (not in `review`),
  `package.json` reads `4.1.0` (not `4.0.1`), `v4.1.0` is tagged, and the cut
  item is completed. Read as written it made this item look release-gated. It is
  not.
- **The premise still holds.** The consumer still hand-rolls the detection (a
  roughly 12-line join that option 3 would let core absorb) and does not call
  `getVariableIdsForClaim` anywhere. So "consumers reimplement the detection"
  remains true.
- **The completed `2026-08-08-contested-as-a-fourth-evaluation-value` still does
  not moot this**, re-checked: `contestedVariableIds` is computed per-variable
  from closure provenance, so two *distinct* variables of one claim settling
  oppositely are each individually non-contested and invisible to it.

## Acceptance criteria

1. `evaluateArgument`'s result carries a **claim-level** roll-up of contested
   claims, computed by grouping each claim's bound variables via
   `getVariableIdsForClaim`, joining their values after constraint propagation
   (`propagation.provenance`, the same source `contestedVariableIds` reads —
   computed inside the engine, since the public `propagatedVariableValues` field
   is optional), and emitting the claim ids whose join is `CONTESTED`.
2. It is reported **unconditionally**, not behind `includeDiagnostics`, matching
   the convention and the stated reason for `contestedVariableIds`
   (`argument-evaluation.ts:817-819`) — a contested value can leave every
   aggregate above reading clean.
3. **A claim whose two variables settle oppositely appears in the roll-up**,
   while `contestedVariableIds` stays empty for that argument. This is the case
   the variable-level field cannot see, and is the reason the item exists; it is
   the primary test.
4. **A single variable driven both ways still appears in
   `contestedVariableIds`** and its claim also appears in the roll-up. The two
   fields coexist; neither replaces the other.
5. A claim whose variables agree — or which binds only one variable — appears in
   neither.
6. **No existing argument changes verdict.** The roll-up is additive reporting:
   no aggregate, no validity/soundness fact, and no violation code changes value
   as a result of this work. An argument that evaluates cleanly today still does.
7. Per the repo rule, the failing test is written first (criterion 3 is the one
   to start from).

## Consumer consequence

This is what lets a consumer retire its hand-rolled detection. A consumer has
two paths, and they differ in cost:

- **Start now, against `getVariableIdsForClaim`.** That accessor shipped in
  v4.1.0, so this needs no new core release. The consumer stops hand-rolling the
  claim→variables walk immediately, but still does its own value join.
- **Wait and consume the roll-up.** The smaller end state — the consumer deletes
  the join as well as the walk — but it needs this item to land plus a further
  core minor release.

## Verified 2026-09-24

Re-audited against v5.1.0. Not shipped: the only contested field in the result
is still the variable-level `contestedVariableIds`, and `claimAttribution`
records reader credit, not a contested roll-up. Anchors refreshed in place —
`argument-evaluation.ts` comment `:817-819`, computation `:820-823`, return
`:962`. Criterion 1 now names which values are joined.
