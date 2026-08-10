# Spec: The satisfiability walk pays 2^n for variables that cannot interact

## Capability changes

None. `docs/capabilities/` in this node is empty — core carries no capability
ledger, and this item adds no product surface. The consumer-visible effect (an
exhaustive check that finishes where it used to stop early) belongs to
capabilities already recorded in `@proposit/shared`; no ledger delta is planned
here.

## Problem

`isPremiseSetSatisfiable` (`src/lib/core/evaluation/satisfiability.ts:52`) walks
a full truth table over the `freeVariableIds` it is handed:
`2 ** freeVariableIds.length` rows (`satisfiability.ts:64`), each building a
total assignment and evaluating every premise from scratch
(`satisfiability.ts:79-82`). Past `SATISFIABILITY_VARIABLE_CEILING` (16,
`satisfiability.ts:16`) it declines with `null` rather than paying
(`satisfiability.ts:62`).

Two properties of the input make much of that walk provably wasted.

**It is handed variables the premise set cannot see.** There are two call sites,
and both over-supply:

- `argument-evaluation.ts:975`, inside `checkArgumentValidity`, passes
  `checkedVariableIds` — filtered at `argument-evaluation.ts:946` from a list
  built at `argument-evaluation.ts:930` over
  `[conclusion, ...supportingPremises, ...constraintPremises]`.
- `argument-evaluation.ts:637`, inside `evaluateArgument`, passes
  `referencedVariableIds` — filtered at `argument-evaluation.ts:603` from
  `allVariableIds` (`:590`), built over `allRelevantPremises` (`:585`), which
  begins with `conclusion`.

Both therefore include variables that occur only in the conclusion. Whether the
premises can hold together does not depend on those, but each one still doubles
the walk.

**The premises rarely all interact.** The walk enumerates the cross product of
every free variable even when the premise set splits into groups sharing no
variables at all — which is the ordinary shape of an argument, where premises
cluster around small groups of claims.

The `evaluateArgument` call site is the one that matters most, and it is not the
one the request named. It runs on **every** evaluation — every reader
assignment — not only when someone asks for the exhaustive check.
`checkArgumentValidity` precomputes the answer once (`argument-evaluation.ts:975`)
and threads it in via `options.premiseSetSatisfiable`, which
`evaluateArgument` prefers when present (`argument-evaluation.ts:634-636`), so
the check's per-row evaluations do not recompute it. Ordinary evaluation has no
such shortcut: a 12-variable argument pays 4,096 rows × premises on every pass.

### Sweep

Repo-wide. `2 **` / `1 <<` occurs at exactly four lines in `src/`:
`satisfiability.ts:64,69` and `argument-evaluation.ts:988,1004` — the two walks
described here. There is no third enumeration site.

`checkArgumentValidity`'s own loop (`argument-evaluation.ts:988`) is **not** in
scope; see Non-goals.

### Consequence in the consumer

Shared defaults `maxAssignmentsChecked` to 10,000
(`proposit-shared/src/engine/review/evaluation.ts:160`) while the ceiling admits
16 variables. 2^13 = 8,192 and 2^14 = 16,384, so any argument with 14, 15, or 16
enumerated variables is admitted by the ceiling and then guaranteed to stop
early — three of the sixteen allowed slots cannot produce a finished answer. An
argument that decomposes never approaches 10,000 rows. This item narrows that
band by making the work smaller; it does not move either limit.

## Goals

1. `isPremiseSetSatisfiable` gives no truth-table column to a variable the
   premise set cannot reach.
2. `isPremiseSetSatisfiable` walks each connected group of interacting variables
   separately, at `Σ 2^n_i` rather than `2^n`.
3. Every answer is unchanged — `true`, `false`, and `null` alike — for both call
   sites, including where premises are coupled through the lazy premise-bound
   resolver rather than through shared named variables.
4. The reduction is measured, not assumed: the outcome records rows walked
   before and after on a real multi-premise argument.

## Non-goals

- **No SAT solver, no CNF encoding, no clause learning.** Premises evaluate
  through a resolver into strong-Kleene trivalent values with a load-bearing
  `null` (`satisfiability.ts:86-91`), and a fourth value (`CONTESTED`) exists in
  the surrounding evaluation. Clauses model none of that. The `ponytail:` note
  at `satisfiability.ts:48` stands and should survive this item, amended rather
  than deleted.
- **No partial-assignment pruning, in either walk.** Abandoning a subtree the
  moment a premise reads false would be the larger win in
  `checkArgumentValidity`, but its soundness rests on strong-Kleene
  monotonicity — determined-`false` stays `false` under every completion — and
  both walks currently pass only total boolean assignments
  (`satisfiability.ts:67-73`, `argument-evaluation.ts:998-1011`), so that
  property is unexercised. It needs pinning before anything leans on it. Its own
  item, if measurement shows the counterexample search is what hurts.
- **No change to `checkArgumentValidity`'s enumeration** (`:988`). Decomposition
  does not transfer: a counterexample is a single assignment making every
  premise true *and the conclusion false*, and the conclusion couples the
  components back together. Its `checkedVariableIds` keeps the conclusion's
  variables for the same reason.
- **No formula rewriting.** Reducing an expression by logical equivalence is the
  separate inbox item
  `docs/work/inbox/2026-07-13-add-logical-simplification-rules-contradiction-tautology-reduction.md`,
  which needs a boolean-literal AST node first. Nothing here touches an
  expression tree; both changes only decide which variables get a column.
- **No change to `SATISFIABILITY_VARIABLE_CEILING` or to shared's
  `maxAssignmentsChecked`.** Whether those two should be reconciled is a
  separate call.
- **No change to either call site's variable list.** See Design.

## Design

### One reachability closure, computed inside the function

Both goals reduce to the same question — *which variables can this premise
reach?* — so the work is done once, in `isPremiseSetSatisfiable`, not at the two
call sites. Goal 1 then falls out of goal 2: a variable in no component is a
variable no premise reaches, and it simply gets no column.

Fixing it inside the function rather than at the callers is deliberate. The two
call sites derive their variable lists differently (`:946` vs `:603`) and a
third caller would derive a third; a filter placed in the shared function is one
rule instead of a rule per caller, and it is the site that already owns the
`forcedTrueVariableIds` filtering (`satisfiability.ts:58-61`).

### The premise-to-variable relation must be the resolved closure

For each premise, its reachable variable set is the transitive closure of:

1. the variables named in its own expressions
   (`premise.getExpressions()`, `type === "variable"`), plus
2. for any of those that is internally premise-bound — `isPremiseBound(v)` and
   `v.boundArgumentId === ctx.argumentId` — the reachable set of the premise at
   `v.boundPremiseId`.

Step 2 is load-bearing and is the one way this change can be silently wrong.
`premise-resolver.ts:39` evaluates the bound premise's whole tree under the same
assignment, so premise A can depend on every variable in premise B while naming
none of them. A graph built from named occurrence alone would place A and B in
different components, and the decomposition would compose two independently
satisfying assignments into one that does not satisfy the set — a wrong `true`.

The closure must terminate on a cycle (A bound into B bound into A): mark
in-progress premises and treat a re-entry as contributing nothing further, which
matches the resolver's own behavior — its cache (`premise-resolver.ts:21`) is
seeded only after the recursive evaluation returns, so a cycle there resolves
through `assignment.variables[variableId] ?? null` (`:32`) rather than looping.
Whatever the closure does on a cycle, the decomposed answer must equal the flat
one; that is what the criterion checks, not the closure's internal choice.

### Components and composition

Variables are nodes. For each premise, its reachable set forms a clique. Union
the connected components (a disjoint-set over the free variable ids is
sufficient). Each premise belongs to the component of any variable it reaches; a
premise reaching no free variable at all — every variable forced true or
internally resolved — forms its own component with an empty column set, walked
in one row.

The set is satisfiable iff every component's premise subset is satisfiable, so
the per-component results fold:

- any component `false` → `false`
- else any component `null` → `null`
- else `true`

`sawIndeterminateRow` becomes per-component and feeds that fold. The early
`return true` on the first satisfying row (`satisfiability.ts:83`) stays,
per component.

### The ceiling applies per component

`freeVariableIds.length > SATISFIABILITY_VARIABLE_CEILING` currently declines the
whole call (`satisfiability.ts:62`). After decomposition the ceiling is checked
against the **largest component**, so a 30-variable argument in components of 6
and 7 is answered rather than declined. A single component over the ceiling
still yields `null`, and by the fold that makes the whole answer `null` unless
some other component is already `false` — which is a strictly better answer than
today's unconditional `null`, and still sound.

`forcedTrueVariableIds` are filtered out before the graph is built, exactly as
today (`satisfiability.ts:58-61`), so they are never nodes.

### Cost of the reduction itself

Building the closure is O(premises × variables) with small constants against a
walk that is exponential, and it runs on the hot `evaluateArgument` path. No
size guard is planned: the degenerate case is one component containing
everything, where the added cost is the graph build and the walk is what it is
today. If measurement contradicts that, the guard belongs in the outcome, not
in the design.

## Acceptance criteria

1. `isPremiseSetSatisfiable` returns the same value as the current
   implementation for every fixture in a differential suite covering all three
   outcomes (`true`, `false`, `null`), with the pre-change implementation kept in
   the test as the oracle.
2. A fixture in which two premises share no named variable but are coupled
   through an internally premise-bound variable, and whose flat answer is
   `false`, still returns `false`. Removing step 2 of the closure from the
   implementation makes exactly this test fail.
3. A fixture whose premises split into two disjoint groups of `k` variables each
   walks at most `2·2^k + 1` rows, not `2^(2k)` — asserted by counting premise
   evaluations, not by timing.
4. A variable occurring only in the conclusion causes no additional rows: the
   row count for an argument is unchanged when a conclusion-only variable is
   added to it.
5. An argument whose free variables exceed `SATISFIABILITY_VARIABLE_CEILING` but
   whose largest component does not is answered `true` or `false`, where today
   it returns `null`.
6. A single component exceeding the ceiling still returns `null` for the call,
   unless another component is `false`, in which case `false`.
7. `pnpm run check` passes, and the existing evaluation suites pass unmodified —
   any test that needed editing to accommodate this change is a defect in the
   change, not in the test, and must be justified in the outcome.
8. The outcome records rows walked before and after for at least one real
   multi-premise argument from `examples/arguments/`.

## Risks

- **A wrong `true` from an incomplete closure.** The failure mode of missing the
  resolver coupling is not a crash but a satisfiable verdict for a contradictory
  premise set — and `premiseSetSatisfiable === false` is what suppresses
  derivation argument-wide (`argument-evaluation.ts:648-651`), so a wrong `true`
  silently re-enables derivation through contradictory premises. Criterion 2 is
  the pin; it must be written to fail against the un-closed graph before the
  closure is added.
- **The oracle is the current implementation.** A differential suite inherits any
  bug the current walk has. Mitigated by criteria 5 and 6, which assert
  *improvements* over the oracle rather than agreement with it, and are stated
  separately for that reason.
- **The hot path is the risky one.** `evaluateArgument` calls this on every
  evaluation; a regression here is a regression in every reader interaction, not
  in an opt-in check. The existing evaluation suites passing unmodified
  (criterion 7) is the main guard.
- **Cycles.** A premise-bound cycle must not hang the closure. The resolver's own
  cycle behavior (`premise-resolver.ts:22-33`) is incidental rather than
  designed, so the closure should not assume cycles are impossible.

## Notes

The request scoped this to `argument-evaluation.ts:975`. Reading the code widened
it: the second call site at `:637` is on the evaluation hot path and
over-supplies variables the same way. This extends the request rather than
contradicting it, and the design lands both by fixing the callee.
