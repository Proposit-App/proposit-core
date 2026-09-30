## Inbox manifest

- `2026-07-13-add-logical-simplification-rules-contradiction-tautology-reduction.md`

## Inbox body

---
from: .
---

# Add logical-simplification rules (contradiction/tautology reduction)

Standalone core backlog item (not part of the XOR operator work — captured while
planning it). The engine today has **structural** auto-normalization (AN-1..AN-4:
buffering, double-negation collapse, 0/1-child collapse, same-operator
absorption) but **no semantic simplification** that reduces a formula by logical
equivalence involving a variable and its negation, or repeated operands.

## Rules to add (the family)

- **Contradiction:** `AND(a, ¬a) → false`
- **Tautology:** `OR(a, ¬a) → true`
- **XOR self-cancellation:** `xor(a, a) → false`; more generally parity
  cancellation of duplicate operands (`xor(a,a,b) → b`, `xor(a,a,a) → a`).
- Consider the neighbours these imply: `AND(a, a) → a` / `OR(a, a) → a`
  (idempotence), `AND(a, false) → false`, `OR(a, true) → true`, etc.

Scope this deliberately — decide which reductions belong to auto-normalization
(assistive/`normalize()`) vs. a separate explicit `simplify()` surface, and how
a reduced-to-constant residual is represented, since **there is no boolean
`true`/`false` literal AST node today** (the biggest open design question — a
new atom/literal node type may be required first).

## Why deferred / why its own item

- Applies to **all** operators, not just xor — belongs to its own effort, not the
  XOR operator-introduction slice.
- Introducing constant literals (`true`/`false`) is a non-trivial AST + grammar +
  evaluation + validator + serialization change with its own test surface; it
  should not ride along inside an operator addition.

## Suggested follow-up

Likely decomposes into child items (`tcw work new --parent`): (1) boolean-literal
AST node + grammar/eval, (2) contradiction/tautology AN or `simplify` rules,
(3) idempotence/identity reductions. Plan with `/tcw-plan-work` when picked up.

## Prior context

Raised while planning the XOR operator: XOR's `xor(a,a) → false` was recognized as the same
class as `AND(a, ¬a) → false` and pulled out of the XOR slice into this item.

## Verified 2026-08-18

Every premise of this entry holds against the tree.

- **Structural auto-normalization exists, semantic simplification does not.**
  `src/lib/grammar/an-rules.ts:6-12` documents exactly AN-1 (formula-buffer
  insertion), AN-2 (double-negation collapse), AN-3 (0/1-child collapse) and
  AN-4 (same-operator absorption). There is no fifth rule, and no `simplify()`
  surface anywhere in `src/`.
- **There is no boolean literal AST node.** Searched `src/` for a `literal`
  expression type, a `BooleanLiteral` schema and a `constantExpression` helper
  — zero hits. `CoreLogicalOperatorType`
  (`src/lib/schemata/propositional.ts:74-80`) carries operators only, and the
  expression union has no constant member. So the entry's "biggest open design
  question" is real and still open: a reduction to `true`/`false` has nothing
  to reduce *to*.
- **Evaluation moved from three-valued to four-valued.** `kleene.ts` was
  deleted in v4.0.0; `src/lib/core/evaluation/belnap.ts` now implements
  Belnap's `FOUR` over `true | false | null | CONTESTED`, computing each table
  from a told-true / told-false bit pair (`belnap.ts:26-46`).

  **This refutes the entry's two headline rules as stated.** `AND(a, ¬a) → false`
  and `OR(a, ¬a) → true` are classical identities and hold on *neither* of the
  non-classical values this engine already produces:

  | `a` | `¬a` | `AND(a, ¬a)` | `OR(a, ¬a)` |
  |---|---|---|---|
  | `null` (told nothing) | `null` | `null` | `null` |
  | `CONTESTED` (told both) | `CONTESTED` | `CONTESTED` | `CONTESTED` |

  (Negation swaps the two components, so both non-classical values are their
  own negation; the meet and the join then reproduce them.) Rewriting
  `AND(a, ¬a)` to a `false` literal would therefore *change the evaluated
  answer* for an unanswered or contested variable — and `null` is the ordinary
  state of every variable a reader has not reached yet.

  So this item is not "add the classical rules"; it is a real design question
  about whether a truth-preserving simplification set exists over `FOUR` at
  all, and if so which rewrites belong to it. Settle that against
  `belnap.ts:26-46` before writing any rule.
- **XOR does not exist yet.** The XOR self-cancellation bullet is contingent on
  `2026-08-18-add-the-xor-operator-to-the-logic-engine`, which is still in
  backlog. Do not treat the xor
  parity-cancellation rules as implementable before that lands.

**Sequencing.** The entry's own suggested decomposition is right, but the first
child is a hard prerequisite for the other two: a boolean-literal AST node
touches the schema, the peggy grammar (`pnpm run generate:parser`), evaluation,
all four validator tiers and serialization. Nothing else can be started until
it is designed.
