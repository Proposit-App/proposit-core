# Add an at-most-one operator for mutually exclusive options

Raised by the user on 2026-09-24, in the session implementing the Social Media
citation fields item. It was filed together with the in-place `and`/`or`/`xor`
swap fix and split out the same day, because that fix ships and is worth having
on its own while this waits on a decision.

**Waiting on the user:** how long are the mutually exclusive lists authors
actually write? That answer decides whether the operator earns its cost, and
should be settled before `spec`.

## The request

**Why.** `xor` is n-ary and means *parity*: `A ⊻ B ⊻ C` is true when an odd
number of its operands are true, so it is true when all three are. It is
associative (checked over all 64 four-valued combinations of `belnapXor`), and
that is correct and stays. But authors very often mean something else: a list
of options that are mutually exclusive ("exactly one of A, B, C", "these
cannot both hold"). With two operands the readings coincide; from three they
do not, and an author can pick `xor` believing it means "exactly one".

**The user's principle.** Core is a logic engine and should not assume what an
author means; it should support propositional formulas as written. A new
operator is justified only when the same thing is hard to express with the
operators that exist, because every operator adds a lot of work. Prefer one
new operator over two.

**Where the discussion landed (for `spec` to test, not a decision).**

- "Exactly one" and "at most one" can each be built from the other cheaply:
  `exactlyOne(xs) = atMostOne(xs) ∧ or(xs)`, and
  `atMostOne(xs) = exactlyOne(xs) ∨ ¬or(xs)`. So one operator gives both.
- "At most one" looked like the better primitive: the hard part of both is the
  pairwise exclusion, which is exactly what it is; "exactly one" is then one
  `or` authors already write; and its propagation rule is simple (one operand
  true forces every other false), with the existing `or` rule supplying the
  rest of "exactly one".
- Without it, "at most one" needs one `¬(X ∧ Y)` per pair of operands:

  | Operands | Pairwise terms |
  | --- | --- |
  | 2 | 1 (trivial today: `¬(A ∧ B)`) |
  | 3 | 3 |
  | 4 | 6 |
  | 5 | 10 |
  | 10 | 45 |

  So the case for the operator rests on how often authors list four or more
  mutually exclusive options.
- **A shorter form with today's operators** (found after the table above):
  "if p1 then none of the later ones; if p2 then none of the later ones; …",
  which needs n−1 clauses rather than n(n−1)/2. `implies` must be a premise
  root (S-5), so it is written with `or`/`not`:

  `(¬p1 ∨ ¬(p2 ∨ … ∨ pn)) ∧ (¬p2 ∨ ¬(p3 ∨ … ∨ pn)) ∧ … ∧ (¬pn-1 ∨ ¬pn)`

  Checked against "at most one" on every row for n = 3, 4, 5. Operands are
  still listed about n²/2 times in total, but the clause count grows linearly
  and each clause reads as a sentence. This weakens the case for a new
  operator somewhat.
- **For exactly three operands only**, "exactly one of A, B, C" is
  `(A ⊻ B ⊻ C) ∧ ¬(A ∧ B ∧ C)` (checked on every row). It does not
  generalise: from four operands, three true is also odd.
- **Not a route:** no formula built only from `xor` and `not` can express
  "at most one". In such a formula, flipping any single operand it uses always
  flips the result; "at most one" does not (from all false, making one operand
  true leaves it true). A chain of adjacent pairs,
  `(p1 ⊻ p2) ⊻ (p2 ⊻ p3) ⊻ … ⊻ (pn-1 ⊻ pn)`, reduces to `p1 ⊻ pn`, because
  every middle operand appears twice and cancels.

**Known hazard.** Unlike `and`, `or` and `xor`, it is not associative: with A,
B and C all true, `atMostOne(atMostOne(A, B), C)` is true while
`atMostOne(A, B, C)` is false. Any rule that merges a same-operator child into
its parent (the auto-normalization rules, and the merge path in
`changeOperator`) must never apply to it. Swapping between it and `and`/`or`/
`xor` changes meaning too, so whether it joins that swap group is a question
for `spec`.

**Other work it implies** (the size of `xor` in v5.0.0): a grammar wire code,
parser syntax and a rendering symbol, a four-valued truth table (what "at most
one" means with unknown or contested operands), constraint-propagation rules,
arity and validation rules, CLI support, and a coordinated release with
consuming applications. An application would likely also want an "exactly one
of…" shortcut in its editor that builds the `atMostOne(...) ∧ or(...)` pair, and plain-language
wording for `xor` ("an odd number of these are true").

## Out of scope

- Changing what `xor` means.

## Notes

- The user said they were unsure whether both "exactly one" and "at most one"
  are needed, and would prefer adding only one operator.
- Reference material: none beyond this discussion.

## References

- `2026-09-24-swap-and-or-and-xor-in-place-at-any-arity-and-add-an-at-most-one-operator`
  — the swap fix this was split from. Whether the new operator joins the
  `and`/`or`/`xor` swap group is a question for this item's spec.
- `docs/release-notes/v5.0.0.md` — how `xor` shipped; the size of work to expect.
- `src/lib/core/evaluation/belnap.ts` `belnapXor` — the four-valued `xor`
  definition, built from truth components so that it is associative; the model
  for defining the new operator's table.

## Added 2026-10-02

Asked again while scoping 6.0.0. The requester relayed:

- **How long the mutually exclusive lists are**, and **whether "at most one" stays the preferred single operator** (with "exactly one" written as `atMostOne(...) ∧ or(...)`): still the maintainer's to answer. They have been passed to the maintainer, and the spec waits on them, as above.
- **Editor support in the consuming application in 6.0.0:** no. The application would add it later either way. (Requester's answer.)
- **Reference material:** asked; none provided.
- **Whether it must ship in 6.0.0** is an open scope question with the maintainer. The spec has to say whether the operator needs a major version on its own, because that decides whether leaving it out of 6.0.0 costs a 7.0.0.

## Added 2026-10-02: what it would cost to ship outside a major release

This records a survey of the code made to answer the scope question. It is not a spec.

- **It needs a major version on its own.** The operator union is public: `CoreLogicalOperatorType` and `TCoreLogicalOperatorType` (`src/lib/schemata/propositional.ts:75-84`), `TFormulaAST` (`src/lib/core/parser/formula.ts:5-11`), and `TFormulaTreeVisitor.operator` (`src/lib/core/interfaces/premise-engine.interfaces.ts:17`). A consumer that switches over operators exhaustively stops compiling, and data validated by an older schema rejects the new value. `xor` shipped as 5.0.0 for the same reason. So leaving it out of 6.0.0 means it arrives in 7.0.0.
- **One classifier carries most of the risk, and the spec must split it.** `isVariadicOperator` (`src/lib/core/expression-manager/checks.ts:17-30`, `["and","or","xor"]`) decides the arity floor (E-1), formula buffers (P-3), P-4, the swap group, and same-operator absorption (P-5, AN-4). "At most one" takes many operands, but it is neither associative nor transparent with one operand: `atMostOne(x)` is always true, not `x`. Added to that list as it stands, it would let three paths change what a formula means:
  - AN-4 absorption (`src/lib/grammar/an-rules.ts:339-350`);
  - the merge in `changeOperator` (`src/lib/core/premise-engine.ts:1012-1033`, `:1076`);
  - AN-3's promotion of a single child (`an-rules.ts:227`).
- **Every evaluator folds a binary function over the children** (`src/lib/core/premise/evaluation.ts:113-158`, `src/lib/core/evaluation/argument-evaluation.ts:154-183`, `propagation.ts:137-174`, `src/lib/core/response/combined-premise-set.ts:356-378`). "At most one" cannot be written as such a fold, so it needs an n-ary four-valued function. The accepted-operator switch in `propagation.ts:280-424` has no default, so without a rule the operator would silently propagate nothing.
- **Found in passing, unrelated to this item:** the formula-syntax list given to the language model (`src/lib/parsing/prompt-builder.ts:34-48`) has no `xor`.

## Decided 2026-10-02: not being done

The maintainer decided on 2026-10-02 that the at-most-one operator will not be built, in 6.0.0 or later. The item is closed as won't-do.

The survey recorded above under "what it would cost to ship outside a major release" stays here for anyone who reopens it. Its main finding: "at most one" is not associative and is not transparent with one operand, so it cannot join the `isVariadicOperator` class without letting AN-3, AN-4 and `changeOperator`'s merge change what formulas mean. The comment in `src/lib/parsing/prompt-builder.ts` explaining why the extraction prompt leaves out `xor` stays as it is.
