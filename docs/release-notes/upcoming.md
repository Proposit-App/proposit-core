# Upcoming

## Added

### Exclusive disjunction

`xor` joins the propositional operator set as a variadic, freely nestable
connective — the same family as `and` and `or`, taking two or more operands
anywhere in a formula. It expresses that an odd number of its operands hold,
which for two operands is the familiar "exactly one of these two".

It parses from `⊻`, `⊕`, `^`, or the word `xor`, and renders as `⊻`. It binds
looser than `∨` and tighter than `→` and `↔`, so `P ∨ Q ⊻ R` reads as
`(P ∨ Q) ⊻ R`; parentheses override as usual. A chain flattens into a single
n-ary node, so `P ⊻ Q ⊻ R` is one three-operand expression rather than nested
pairs.

Evaluation is four-valued like every other connective. Restricted to
`true`/`false`/`null` it is exactly strong Kleene exclusive disjunction, and
`null` absorbs: parity depends on every operand, so an unanswered operand
leaves the whole relation unanswered.

One consequence is worth stating plainly, because it is the one place `xor`
does not behave as an abbreviation. `xor(a, b)` and `not(iff(a, b))` agree on
every pair except `xor(null, contested)`, where `xor` answers `null` and
`not(iff(...))` answers `false`. The two cannot be reconciled: the composed
reading is not associative over the four-valued tables, and a variadic operator
whose value depends on how a chain is bracketed would make flattening change
what a formula means. `iff` is binary and never has to associate, so it keeps
its own answer.

A granted `xor` step also participates in constraint propagation. Where a
granted `and` forces every operand true, a granted `xor` forces an operand only
once the others are pinned, and that operand then takes whatever value makes
the count odd. An operand whose siblings can be read both ways inherits that
ambiguity as `contested`.

## Changed

### Operator swaps are now decided by arity class

`changeOperator` previously consulted a table pairing each operator with a
single permitted partner — `and` with `or`, `implies` with `iff`. That table
was an arity guard that happened to look like a pairing, because each class had
exactly two members. With `xor` joining the variadic class it is now written as
the class membership it always was: a swap is permitted when both operators
belong to the same class.

This only widens what is accepted. Every swap that was legal before remains
legal, and `and`, `or` and `xor` may now be exchanged for one another in either
direction.
