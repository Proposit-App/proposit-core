# Technical specification

End-to-end design for the cross-repo epic. Authoritative reference for all four
slices; each slice is planned and implemented in its own repo.

## Layer 1 — `proposit-core`: default-assignment derivation

### Public API

Add to the argument evaluation surface (`ArgumentEngine`, exposed via the
`TArgumentEvaluation` interface):

```ts
// Returns a default truth-value assignment for every variable in the argument,
// derived purely from claim type and immediate support structure.
// Values are `true` or `null` (unknown) — never `false`.
deriveDefaultAssignment(): TCoreVariableAssignment
```

Optional convenience (include if a consumer wants one-call ergonomics; not
required — the honest primitive is the map above):

```ts
// Merge caller overrides over the derived defaults and evaluate in one call.
evaluateWithDefaults(
  overrides?: TCoreVariableAssignment,
  options?: TCoreEvaluationOptions,
): TCoreArgumentEvaluationResult
```

`TCoreVariableAssignment = Record<string, TCoreTrivalentValue>` and
`TCoreTrivalentValue = boolean | null` already exist (`src/lib/types/evaluation.ts`).
The returned map is **variable-keyed**. Consumers key their UI/reactions by
`claimId`; core already owns the claim↔variable correspondence (canonical claim →
variable symbol) and must expose or document the lookup so the consumer can
translate. Confirm the existing accessor during implementation; add a thin
`claimId → variableId` (and inverse) helper on the evaluation view if none is
already public.

### Algorithm for `D(claim)`

For each variable `v` backing claim `c`:

1. If `c.type` is `citation` or `axiomatic` → `true`.
2. Else (`c.type === "normal"`): locate `c`'s **derivation premise** (the
   inference whose consequent is `v`). If none → `unknown`.
3. From that premise's antecedent expression, seed each **immediately
   referenced** claim's variable: `true` iff that claim is citation/axiomatic,
   else `null`. Evaluate the antecedent expression once with the existing Kleene
   operators (`src/lib/core/evaluation/kleene.ts`). Result `true` → `v = true`;
   otherwise → `v = null`.
   - **No recursion.** Only the immediate antecedent claims' *types* are
     inspected; their own supports are not walked.
4. Everything not set to `true` is `null` (unknown).

Result map contains an entry for every argument variable, each `true` or `null`.

### Consistency with existing behavior

- The engine already force-sets axiomatic-bound variables `true` before
  evaluation and treats them as user-assigned (immune to propagation
  overwrite). `D(claim)` produces the same `true` for axioms — verify no
  double-application or conflict; `deriveDefaultAssignment` should be the single
  source and the axiomatic pre-pass either subsumed by it or shown to agree.
- Propagation (`propagateOperatorConstraints`) already never overwrites
  non-null values, so seeding defaults then evaluating yields `unknown → true`
  for transitively-grounded consequents with no further work.

### Edge cases to cover in tests (`test/`, matching-area file — not `core.test.ts` by default)

- Citation claim → `true`; axiomatic claim → `true`.
- Normal claim with single citation supporter → `true`.
- Normal claim with `cite ∧ cite` → `true`; `cite ∧ normal` → `unknown`;
  `cite ∨ normal` → `true`; `cite ∨ cite` → `true`.
- Normal claim supported only by another normal claim → `unknown`.
- Unsupported normal claim → `unknown`.
- Transitive chain (citation → normal A → normal B): A `true`, B `unknown`;
  after `evaluate(deriveDefaultAssignment())`, B propagates to `true`.
- No variable is ever defaulted to `false`.
- Grade of a fully citation-grounded, valid argument under defaults is a
  non-counterexample grade (spot-check the "watch it evaluate" story).

## Layer 2 — `@proposit/shared`: resolution + overlay

### Types (`src/engine/review/types.ts`)

```ts
export type TAssignmentProvenance = "user" | "default"
```

Extend `TReviewOverlay`:

- `claimValues: Record<string, TAssignmentPill>` — effective assignment per
  `claimId` (existing field; now sourced from the precedence merge below).
- `claimProvenance: Record<string, TAssignmentProvenance>` — **new**.
- expose the argument-level **grade** and the **propagated** per-claim values
  needed for the chip's `unknown → true` display (either on the overlay or via a
  sibling result the consumer already has from `evaluate`).

### `buildReviewOverlay` extension (`src/engine/review/overlay.ts`)

Inputs: core defaults (via `deriveDefaultAssignment`, translated to claim keys),
the user's reactions, and the user's in-review overrides. For each claim:

```
effective(claim) = override ?? reaction ?? default
provenance(claim) = (override present || reaction present) ? "user" : "default"
```

Reaction → pill mapping: agree → `"true"`, disagree → `"false"`, unsure →
`"unknown"`. Reactions never produce `"skipped"` (skipped is an explicit
in-review action only).

The merged assignment is fed to core `evaluate()`; the overlay carries through
`propagatedVariableValues` and the `TCoreEvaluationGrade` so the UI can render
both the per-claim `assigned → propagated` chip and the conclusion grade.

The merge is **read-only** and cannot violate the one-way rule; document the
rule here as the invariant the consumers must honor.

### Tests

- Precedence: override wins over reaction wins over default.
- Provenance: correct `"user"` / `"default"` for each source.
- Reaction trivalent mapping (agree/disagree/unsure → true/false/unknown).
- Lazy fallback: changing a reaction (no override) moves the effective value;
  adding an override pins it and clearing the override falls back to the
  reaction again.

## Layer 3a — `proposit-server` (web)

- **Chip:** reuse `AssignmentPill`
  (`src/components/client/review/review-pills.tsx`) — True/False/Unknown, colors
  `success` / `error` / `default`, existing `propagatedValue` "marked X → pinned
  Y" mode for `unknown → true`. Mount **immediately before `{stanceControl}`** in
  `claim-card.tsx`'s footer row (the far-left slot, before `<Box flexGrow:1 />`).
  Wire the slot in `atv-items.tsx` alongside the existing `stanceControl` prop.
- **Badge:** small MUI `Badge` dot on the chip — **filled = `"user"`**, **outline
  = `"default"`** — with a `Tooltip`:
  - user: **"Your assignment."**
  - default: **"Default — derived from how this claim is used. Grounded claims
    (citations, axioms, and claims they directly support) start true; claims
    still to be proven start unknown."**
- **Grade chip:** render `TCoreEvaluationGrade` (label + its built-in UI color)
  at the **conclusion premise** row. Reuse the grade's color; no new palette.
- **Interaction:** reacting persists the reaction only (overlay resolves the
  rest). The in-review override control writes **only** to review overrides —
  never creates/updates/deletes a reaction.
- **Light/dark:** use semantic tokens (`success` / `error` / `text.secondary`
  and `verdictAgree/Disagree/Inconclusive`); verify both schemes.

## Layer 3b — `proposit-mobile`

- **Chip:** new pill component (adapt `DecisionPill` from the review decision
  screens) rendering T/F/U + the `unknown → true` propagated state + provenance
  badge. Wrap it and `ClaimStanceControl` in a new `flexDirection: "row"`
  container in `text-tree-row.tsx` so the chip sits **left of** the stance
  control (today the stance control is stacked below the body with no horizontal
  row).
- **Badge + tooltip:** same semantics; use a long-press/info affordance for the
  tooltip text above.
- **Grade chip** at the conclusion premise row.
- **Colors:** `verdictAgree` / `verdictDisagree` / `verdictInconclusive` via
  `useTheme()`; verify light **and** dark.
- Same one-way write rule as server.

## Data flow (each render, per surface)

```
load(reactions, overrides)
  → core.deriveDefaultAssignment()                     // Layer 1
  → shared.buildReviewOverlay(defaults, reactions, overrides)  // Layer 2
       → effective assignment + claimProvenance
  → core.evaluate(effective assignment)                // propagated values + grade
  → render:
       per claim: chip(effective value, propagated overlay, provenance badge)  // Layer 3
       conclusion: grade chip
```

Live-updates as reactions or in-review overrides change.

## Testing summary

- **core:** unit tests for `D(claim)` (all cases above) + a default-evaluation
  integration spot-check. Follow repo TDD: any bug fix starts with a failing
  test.
- **shared:** precedence / provenance / mapping / lazy-fallback tests.
- **server + mobile:** component tests for chip value states, propagated
  overlay, provenance badge + tooltip, and the conclusion grade chip — each
  **verified in light and dark** per the workspace rule.

## Risks / watch-items

- **Claim↔variable key translation** is the seam most likely to bite; confirm
  the public accessor early in Layer 1.
- **Axiomatic double-handling** — reconcile `deriveDefaultAssignment` with the
  existing axiomatic force-true pre-pass so they agree and don't conflict.
- **Mobile layout** needs a new horizontal row wrapper; the stance control is
  currently stacked, so "left of" is a real (small) layout change, not just a
  drop-in.
- **Wire-format stability:** `TAssignmentPill` is existing shared surface;
  adding `claimProvenance` is additive. No grammar/engine wire-format codes
  change.
