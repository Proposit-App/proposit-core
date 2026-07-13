---
from: .
---

# Add logical-simplification rules (contradiction/tautology reduction)

Standalone core backlog item (not part of the XOR epic — captured while planning
it). The engine today has **structural** auto-normalization (AN-1..AN-4:
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

Raised during the XOR epic (`2026-07-13-add-xor-propositional-logic-operator`
at the orchestration root): XOR's `xor(a,a) → false` was recognized as the same
class as `AND(a, ¬a) → false` and pulled out of the XOR slice into this item.
