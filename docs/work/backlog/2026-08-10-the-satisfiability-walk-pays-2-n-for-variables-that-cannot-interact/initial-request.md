# The satisfiability walk pays 2^n for variables that cannot interact

`isPremiseSetSatisfiable` (`src/lib/core/evaluation/satisfiability.ts`) walks a
full truth table over every free variable handed to it. Two of those columns are
avoidable without any change to what the function answers, and both matter
because the row count is the only thing standing between a real argument and a
"not determined" verdict.

The function is honest about being a truth-table walk — the `ponytail:` comment
at `satisfiability.ts:48` says a solver is not worth building, and that judgment
stands. Neither change below is a solver. They shrink the input to the same walk.

## Product changes

An argument that is currently refused, or answered "not determined", because it
crosses `SATISFIABILITY_VARIABLE_CEILING` (16) may become answerable. Real
arguments do not have all their claims touching each other — premises cluster
around small groups of claims — so the effective work is usually far below what
the raw variable count suggests.

The visible payoff is the exhaustive check on the review results stage. Its cap
and its ceiling currently disagree: shared defaults `maxAssignmentsChecked` to
10,000, but the ceiling admits 16 variables, and 2^14 = 16,384. Every argument
with 14, 15, or 16 enumerated variables is admitted and then guaranteed to stop
early — three of the sixteen allowed slots cannot produce a finished answer. A
14-variable argument that decomposes into components never approaches 10,000
rows, so this closes that gap by making the work smaller rather than by moving
a limit.

No answer changes. Every reduction here is required to be answer-preserving; an
argument that was `true`/`false`/`null` before must be the same after.

## Technical changes

### 1. Conclusion-only variables get no column in the satisfiability walk

`argument-evaluation.ts:975` passes `checkedVariableIds` as `freeVariableIds`.
That list is built at `argument-evaluation.ts:930` from
`[conclusion, ...supportingPremises, ...constraintPremises]`. A variable that
occurs only in the conclusion cannot affect whether the premise set can hold
together, but it still gets a column and doubles the walk.

Restrict the ids passed to `isPremiseSetSatisfiable` to those the premises
actually mention. `checkValidity`'s own enumeration keeps the full set — it
needs conclusion variables, because a counterexample is an assignment making
the conclusion false.

### 2. Decompose the premise set into connected components

Build a graph over the free variables, with an edge between two variables when
they can both reach the same premise. The components partition the premise set,
and because components share no variables their satisfying assignments compose
freely:

- every component satisfiable → the whole set is satisfiable
- any component unsatisfiable → the whole set is unsatisfiable
- none unsatisfiable but any undetermined → undetermined

Cost falls from `2^n` to `Σ 2^n_i`. A 14-variable argument splitting 5/5/4 costs
32 + 32 + 16 = 80 rows rather than 16,384.

**The edge set must be the resolved dependency closure, not each premise's own
expressions.** `premise-resolver.ts:39`: an internally premise-bound variable
resolves by evaluating its bound premise's whole tree under the same assignment,
so premise A can depend on every variable in premise B while naming none of
them. Those variables get no column, so a graph built from syntactic occurrence
alone would show A and B as disconnected when they are coupled, and the
decomposition would return a wrong answer silently. The closure has to follow
`boundPremiseId` transitively, and it has to tolerate a cycle.

The trivalent result composes as listed above; `sawIndeterminateRow` becomes
per-component and folds into the same disjunction.

### Deliberately out of scope

- **No SAT solver, no CNF encoding.** Premises evaluate through a resolver into
  strong-Kleene trivalent values with a load-bearing `null`, and there is a
  fourth value (`CONTESTED`) in the neighborhood. Clauses have none of that.
- **No partial-assignment pruning.** Abandoning a subtree the moment a premise
  reads false would be a larger win in `checkValidity`, but its soundness rests
  on strong-Kleene monotonicity — determined-false stays false under every
  completion — and that property is currently unexercised: both walks only ever
  pass total boolean assignments. It needs pinning before anything leans on it.
  Worth its own item if measurement says the counterexample search is what hurts.
- **No formula rewriting.** Reducing a formula by logical equivalence is the
  separate inbox item
  `docs/work/inbox/2026-07-13-add-logical-simplification-rules-contradiction-tautology-reduction.md`,
  which needs a boolean-literal AST node first. Nothing here touches an
  expression tree; both changes only decide which variables get a column.
- **No change to `SATISFIABILITY_VARIABLE_CEILING` or to shared's
  `maxAssignmentsChecked`.** Whether those two should be reconciled directly is
  a separate call, and this item is meant to reduce how often it matters.

## Meta changes

Both reductions are answer-preserving claims, so the tests have to be
differential rather than illustrative: for a set of fixtures, the decomposed
answer must equal the answer from the undecomposed walk, including the `null`
cases. The resolver-coupling trap needs its own fixture — two premises sharing
no named variable, coupled through an internally premise-bound variable — which
must come out identical to the flat walk. A fixture that passes without that
edge in the graph is not pinning anything.

Worth a measurement in the outcome: rows walked before and after on a real
multi-premise argument, since the whole case rests on the claim that real
arguments decompose.
