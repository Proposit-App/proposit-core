# Usage-based default variable assignments and inline T/F/U review in the argument text view

## Summary

Make review/evaluation a **central, always-on** feature rather than an optional
wizard pass. Two coupled changes:

1. **Usage-based default assignments.** Every claim's variable receives a
   default truth value derived from *how the claim is used in the argument*:
   grounded claims start `true` (what the author believes), claims still to be
   proven start `unknown` (what the author is attempting to prove). Truth is
   never defaulted to `false`.
2. **Inline review in the argument text view.** A small colored **T/F/U chip**
   (true / false / unknown) sits to the **left of each claim's reaction
   control**, carrying a **badge** that marks whether the value is the user's
   own assignment or the derived default (with an explanatory tooltip). The
   **argument-level evaluation grade** renders at the **conclusion premise**.

> **This is a cross-repo effort**, coordinated by the cross-node TCW epic
> [`proposit-app/…inline-t-f-u-review-cross-repo`](tcw://W/proposit-app/2026-07-21-usage-based-default-assignments-and-inline-t-f-u-review-cross-repo)
> spanning `proposit-core → @proposit/shared → (proposit-server ‖
> proposit-mobile)`. This backlog item is the **core** slice (Layer 1), linked to
> the epic via `initiative`.

## Product changes

- Every claim in the argument text view shows a T/F/U assignment chip, left of
  its reaction control, colored by value (true = green, false = red, unknown =
  gray — reusing the existing verdict tokens).
- The chip carries a small provenance **badge**: filled dot = the user's own
  assignment, outline dot = the derived default. Hovering/long-pressing the
  badge shows a tooltip explaining the provenance.
- The conclusion premise shows the argument's evaluation **grade** (sound /
  vacuously-true / unsound / counterexample / inadmissible / indeterminate).
- Adding a reaction (agree / disagree / unsure) to a claim now *is* that claim's
  variable assignment for the user's review, whenever the review has not already
  been given an explicit assignment for that claim.
- Reviewers can still experiment with different assignments inside a review
  without disturbing their reactions.

Product deltas live in the **consumer** slices (server + mobile). Their
capabilities must be run through the tcw-capabilities planning gate **in those
repos** when their slices are planned. `proposit-core` (this item) ships a
library API only and declares **no** user-facing capability.

## Technical changes

### Confirmed design decisions

**Default-assignment function `D(claim)` — pure function of structure:**

- `true` if the claim **is** a citation or axiomatic claim.
- `true` if the claim is **normal** and its derivation premise's **immediate**
  antecedent evaluates to `true` under Kleene when each immediate antecedent
  claim is seeded `true` iff it is itself citation/axiomatic and `unknown`
  otherwise. **One level, no recursion.** This makes AND / OR / mixed support
  fall out for free: `cite` → `true`; `cite ∧ cite` → `true`; `cite ∧ normal` →
  `unknown`; `cite ∨ normal` → `true`.
- `unknown` (`null`) otherwise — a consequent backed by normal claims, or a
  normal claim with no support.
- **Never `false`.** A default affirms a grounded belief (`true`) or withholds
  (`unknown`); it never asserts a claim is false.

This formalizes and extends the engine's existing behavior of force-setting
axiomatic variables `true`. Transitively-grounded claims stay `unknown` at
assignment time and are lit up by **propagation** as `unknown → true` when the
default evaluation runs — which is exactly the "watch it evaluate" story that
makes review feel central.

**Effective-assignment resolution (per claim, per user's review):**

```
effective(claim) =
    review override for claim        // explicit in-review assignment (incl. what-if)
 ?? user's reaction for claim        // agree→true, disagree→false, unsure→unknown
 ?? D(claim)                         // structural default
```

- **Reaction → assignment: yes** (lazy fallback, not a snapshot — a later
  reaction change is reflected while no in-review override exists).
- **Assignment → reaction: never.** In-review overrides (what-if exploration)
  must not create / update / delete any reaction. This one-way rule is a
  write-path contract in the consumers.
- **Provenance / badge:** value from an override *or* a reaction → `"user"`;
  value from `D(claim)` → `"default"`.

**Provenance is computed, not stored.** Defaults are fully derivable from
structure, so only explicit user overrides (and reactions) are persisted; the
default is recomputed and auto-corrects as the author edits the argument.

### Layered breakdown

| Layer | Repo | Owns | New surface |
|---|---|---|---|
| 1. Defaults | `proposit-core` | `D(claim)` from claim type + immediate support | `ArgumentEngine.deriveDefaultAssignment()` (+ optional `evaluateWithDefaults`) |
| 2. Resolution | `@proposit/shared` | merge `override ?? reaction ?? default`, provenance, feed `evaluate`, expose pill values + grade | extend `buildReviewOverlay` / `TReviewOverlay` (+ `claimProvenance`, `TAssignmentProvenance`) |
| 3a. Web UI | `proposit-server` | chip + badge left of `ClaimStanceControl`; grade chip at conclusion; one-way write rule | reuse `AssignmentPill` + MUI `Badge` |
| 3b. Mobile UI | `proposit-mobile` | same, native | new pill (adapt `DecisionPill`) + badge |

The full technical specification (API signatures, algorithm, overlay contract,
UI placement, testing) is in [`spec.md`](./spec.md).

## Cross-repo epic

The **cross-node epic**
[`…inline-t-f-u-review-cross-repo`](tcw://W/proposit-app/2026-07-21-usage-based-default-assignments-and-inline-t-f-u-review-cross-repo)
hangs the four slices off it in dependency order — **core → shared → (server ‖
mobile)**:

- **Layer 1 / core** — this item (or its successor): `deriveDefaultAssignment`.
- **Layer 2 / shared** — escalate to `@proposit/shared`: overlay resolution +
  provenance.
- **Layer 3a / server** and **Layer 3b / mobile** — delegate: inline chip +
  badge + tooltip + conclusion grade chip; run each repo's tcw-capabilities gate.

Nothing downstream can begin until core ships Layer 1 and shared merges it.

## Scope of THIS item

- **In scope:** Layer 1 only — the `proposit-core` default-assignment derivation
  API and its tests. No UI, no consumer wiring, no epic creation.
- **Out of scope (separate slices):** the shared overlay changes and both UI
  surfaces, tracked via the cross-repo epic above.

## Meta changes

- None to the TCW process itself. Downstream slices will each own their repo's
  Documentation Sync updates (api-reference, capabilities, etc.) when planned.
