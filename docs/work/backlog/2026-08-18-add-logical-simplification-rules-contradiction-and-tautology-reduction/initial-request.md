# Decide whether a sound simplification set exists over four-valued evaluation

> **Do not start this item from its filed title.** The intake asks for
> "logical-simplification rules (contradiction and tautology reduction)". Its
> headline rules are **unsound against the semantics this engine already
> ships**, and implementing them as written would change real answers. This item
> is the decision that has to come first: which formula rewrites, if any, keep
> every evaluated answer unchanged, and whether those are worth building.

The raw request is preserved in `intake.md`. This is the written-up request,
rewritten 2026-09-24 to fold in earlier audit corrections; the superseded
sections are in git history. It absorbed its former child
`2026-08-28-decide-whether-a-truth-preserving-rewrite-set-exists-over-belnap-four`,
which restated this item's question and was closed as a duplicate.

## The refutation, verified by execution

Evaluation in this engine is not classical. It is Belnap's `FOUR` over
`true | false | null | CONTESTED`, across six operators:
`not and or xor implies iff`. Running the built connectives in
`dist/lib/core/evaluation/belnap.js`:

| `a` | `AND(a, ¬a)` | `OR(a, ¬a)` | `xor(a, a)` |
|---|---|---|---|
| `true` | `false` | `true` | `false` |
| `false` | `false` | `true` | `false` |
| `null` | **`null`** | **`null`** | **`null`** |
| `CONTESTED` | **`CONTESTED`** | **`CONTESTED`** | **`CONTESTED`** |

`src/lib/core/evaluation/belnap.ts:71` states why: NOT swaps the told-true and
told-false components, so `null` and `CONTESTED` are their own negation. All
three of the intake's headline rules — `AND(a, ¬a) → false`,
`OR(a, ¬a) → true`, `xor(a, a) → false` — fail at exactly those two values.

This matters in practice: **`null` is the ordinary state of every variable a
reader has not answered yet**, so rewriting `AND(a, ¬a)` to `false` would change
the answer for the most common state in the product.

Judge `xor` against `belnapXor` (`belnap.ts:125`) directly, never as
`not(iff(...))`: `xor(null, CONTESTED) = null` while
`not(iff(null, CONTESTED)) = false`. The comment at `belnap.ts:104-122` records
that this divergence also costs `xor` associativity for 8 of 64 triples.

## What does hold

`FOUR` is a De Morgan lattice, and the laws that follow from that were checked
by running every combination of the four values through the built tables on
2026-09-24. All of these hold:

- idempotence: `AND(a, a) = a`, `OR(a, a) = a`
- absorption: `AND(a, OR(a, b)) = a`, `OR(a, AND(a, b)) = a`
- distributivity of `AND` over `OR`
- De Morgan: `¬AND(a, b) = OR(¬a, ¬b)`
- double negation: `¬¬a = a` (already applied structurally by AN-2)

What fails are the complement laws and `xor` self-cancellation — exactly the
rules the intake asked for. So "no sound rewrite set exists" is not the likely
answer. The real question is whether the sound rules are **worth building**.
None of them needs a constant to reduce to; each reduces a formula to one of
its own operands.

## What exists today

- **No boolean literal.** `CorePropositionalExpressionSchema`
  (`src/lib/schemata/propositional.ts:103-107`) is a union of variable, operator
  and formula only. Any rule reducing to `true`/`false` would need a new AST
  node — schema, peggy grammar (`pnpm run generate:parser`), evaluation, all four
  validator tiers, serialization.
- **No semantic simplification.** There is no `simplify` surface in `src/`.
  What exists is structural auto-normalization AN-1..AN-4
  (`src/lib/grammar/an-rules.ts:6-12`). AN-4 flattens a same-operator child and
  absorbs nested `xor` (`:342-348`), but does not remove duplicate operands, so
  even idempotence would be new work — and would sit directly next to AN-4.
- **Satisfiability is a different mechanism.** `isPremiseSetSatisfiable`
  (`src/lib/core/evaluation/satisfiability.ts`) detects an unsatisfiable premise
  set by walking truth tables; it rewrites nothing.

## Acceptance criteria

This is a decision item. It is done when a short written answer, added to this
item, states:

1. For each of the six operators, which rewrites are truth-preserving over
   `FOUR`, starting from the list above rather than re-deriving it.
2. For each surviving rule, whether it is worth building: what authors would
   gain (a shorter or clearer formula, a cheaper evaluation) against the cost of
   a new normalization rule interacting with AN-1..AN-4 and with stored
   checksums.
3. A recommendation: either close this item with "sound rules exist but are not
   worth building", or file one build item per rule worth having. A boolean
   literal node is filed only if some surviving rule genuinely needs a constant.

No engine code is written under this item.
