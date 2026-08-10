# Spec: evaluation-time satisfiability gives the citation too

## Capability changes

None. Core carries no capability ledger (`docs/capabilities/` is empty). There
is a consumer-visible consequence — see Problem — but it belongs to review
capabilities in `@proposit/shared` and needs no wording change: what a blocked
review means is unchanged, only when it is reached.

## Problem

`ArgumentEngine.evaluate` builds its forced-true set from
`getAxiomaticBoundVariableIds()` (`argument-engine.ts:2850-2852`).
`ArgumentEngine.checkValidity` builds its from `getGroundedBoundVariableIds()` —
citation ∪ axiomatic — (`argument-engine.ts:2880`). Both flow into the same
`isPremiseSetSatisfiable`. So the same premise set can be satisfiable when
evaluation asks and unsatisfiable when validity asks, on an argument where a
premise holds only if a cited claim is false.

The user's decision is that evaluation should give the citation too: a cited
source is taken at its word when asking whether the premises can hold together.

### The request said this was one line. It is not.

`initial-request.md` says the narrow change is to pass the grounded set at
`argument-evaluation.ts:637`. Reading the code, `options.forcedTrueVariableIds`
is consumed at **three** places inside `evaluateArgument`, and only the first is
about satisfiability:

| Site | Use |
| --- | --- |
| `:660` | passed to `isPremiseSetSatisfiable` — pins the variable `true` in the walk |
| `:746` | `isReaderAsserted` returns `false` for it — the variable stops counting as a reader's assertion |
| `:776` | dropped from `conclusionClaimVariableIds` — excluded from the reached-without-assertion counterfactual |

Widening the single option therefore does three things, and two of them are
wrong. A reader **may** assign a citation-bound variable — that is the settled
invariant this work must not break (`AGENTS.md`, "'Grounded' and 'unassignable'
are different sets"). If citations join `forcedTrueVariableIds` wholesale, a
reader's own assignment on a citation-backed claim stops registering as their
assertion, and the argument's "reaches its conclusion without the reader having
to assert anything" counterfactual silently changes for every citation-bearing
argument.

The coupling is harmless in `checkValidity` and only there: its rows are
generated assignments with no reader behind them, so "was this reader-asserted"
has no content. It is harmful in `evaluate`, which is exactly where the reader
is.

### Consequence the decision accepts

`premiseSetSatisfiable === false` suppresses derivation argument-wide
(`argument-evaluation.ts:648-651`) and surfaces to a reader as the review's
blocked state in both clients. Pinning citations `true` can only shrink the
model set, so an argument whose premises hold *only* with a cited claim false
flips from working to blocked. That is the intended behaviour, not a
side-effect: an argument that needs a cited source to be wrong is not an
argument this engine should quietly let through.

### Sweep

Every construction of a forced-true set in `src/`:
`argument-engine.ts:2850` (evaluate — this item), `:2880` (checkValidity —
already grounded), and the `options?.forcedTrueVariableIds` union each performs
for callers. No third site. `collectAxiomaticBoundVariables` /
`applyAxiomaticForcedAssignments` are a different mechanism — the throwing
pre-pass — and are out of scope; see Non-goals.

## Goals

1. The satisfiability question is asked the same way from both entry points: a
   citation is given.
2. A reader's assignment on a citation-bound variable still registers as that
   reader's assertion, and still participates in the reached-without-assertion
   counterfactual, exactly as today.
3. The two entry points stop being able to disagree silently — the difference,
   where one remains, is named where both are read.

## Non-goals

- **No change to the evaluate-time pre-pass.**
  `collectAxiomaticBoundVariables` and `applyAxiomaticForcedAssignments` stay
  axiomatic-only. That pre-pass **throws**
  `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` on a caller assignment; widening it
  would make a reader's assignment on any citation-backed claim raise, deep
  inside a consumer's review flow. This is the trap the previous item was
  written around and it has not gone away.
- **No change to what a reader may assign.** Citations remain assignable and a
  reader may still disagree with a source.
- **No change to `checkValidity`.** It is already correct.
- **No consumer-side work.** The blocked-review surface in `proposit-server` and
  `proposit-mobile` already handles `premiseSetSatisfiable === false`; this item
  changes how often that state is reached, not what it looks like.

## Design

### A separate set for the satisfiability question

`TCoreArgumentEvaluationOptions` gains
`satisfiabilityForcedTrueVariableIds?: ReadonlySet<string>`. `evaluateArgument`
passes it — falling back to `forcedTrueVariableIds` when absent — to
`isPremiseSetSatisfiable` at `:637`, and to nothing else. Sites `:746` and
`:776` keep reading `forcedTrueVariableIds` untouched.

`ArgumentEngine.evaluate` then supplies the grounded set as
`satisfiabilityForcedTrueVariableIds` while `forcedTrueVariableIds` stays
axiomatic-only. The default keeps every existing caller — including
`checkValidity`, which passes only `forcedTrueVariableIds` — behaving exactly as
it does now.

The alternative, computing the grounded set inside `evaluateArgument`, was
rejected: the standalone function takes a `TArgumentEvaluationContext`, which
exposes `getVariable` but has no notion of claim type, so it cannot ask whether
a variable is grounded without widening that interface. Keeping the decision in
`ArgumentEngine`, which already owns `isGroundedVariable`, holds the boundary.

### Why not unify the two entry points on one set

Goal 3 is tempting to satisfy by making `evaluate` and `checkValidity` share one
construction. They must not: the sets they need genuinely differ, because
`forcedTrueVariableIds` means "not the reader's assertion" as much as it means
"pinned true", and `checkValidity` has no reader. What they share is the
*satisfiability* input, and that is what the new option makes common. The
remaining difference is then a named field rather than a coincidence of two call
sites, which is what goal 3 asks for.

## Acceptance criteria

1. An argument with a citation-bound claim and a premise satisfiable only when
   that claim is false reports `premiseSetSatisfiable === false` from
   `evaluate()`. Today it reports `true`.
2. The same argument reports the same answer from `checkValidity`'s precompute
   as from `evaluate()` — a single fixture asserting the two agree, which fails
   before this change.
3. A reader assignment on a citation-bound variable is still reported as that
   reader's assertion: its provenance reads `asserted`, not `derived` or
   `unassigned`.
4. The reached-without-assertion counterfactual is unchanged for an argument
   whose conclusion is citation-backed — pinned by a fixture whose
   `reachedWithoutAssertion` value would flip if citations entered
   `forcedTrueVariableIds` wholesale.
5. `evaluate()` still accepts a caller assignment on a citation-bound variable
   and does not throw `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`; it still throws for
   an axiomatic one.
6. A caller passing its own `forcedTrueVariableIds` to `evaluate()` still has it
   unioned with the engine's axiomatic set, and it also reaches the
   satisfiability walk.
7. `pnpm run check` passes with existing suites unmodified. Any test needing an
   edit is a defect in the change and must be justified in the outcome — with
   the exception of a test that pins the *old* disagreement, which would be a
   test of the bug and must be rewritten rather than deleted.

## Risks

- **Criteria 3 and 4 are the whole item.** The satisfiability half is
  mechanical; the reason this is not a one-line change is that the obvious
  one-line version passes criteria 1 and 2 and quietly fails 3 and 4. Both
  must be written to fail against that version before the real fix lands —
  otherwise the item ships the trap it was written to avoid.
- **More arguments become blocked.** By design, and accepted by the user. Worth
  measuring: the outcome should count how many published arguments in a
  consumer's local database change `premiseSetSatisfiable` under this change,
  so the blast radius is a number rather than a guess.
- **A new option on a public type.** `TCoreArgumentEvaluationOptions` is
  exported; adding an optional field is additive, but it is API surface and
  belongs in `docs/api-reference.md`.
