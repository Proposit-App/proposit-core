---
from: .
initiative: 2026-07-13-add-xor-propositional-logic-operator
---

# Add XOR operator to logic engine

Slice 1 (foundational) of the cross-node epic **Add XOR propositional logic
operator**. This repo owns the operator enum, grammar, evaluation, and
validators — every downstream repo inherits from here, so this slice unblocks
the rest of the epic.

## Locked design decisions (from the epic)

- **XOR is variadic and freely nestable — same family as `and`/`or`.** 2+
  operands, allowed anywhere in a formula. Use the **E-1** arity-floor path;
  do **NOT** add it to S-8 (binary) or S-5/S-14 (root-only).
- **Semantics: parity.** `xor(a,b,c,…)` is true iff an **odd** number of
  operands are true. Kleene three-valued: any `null` operand ⇒ `null`.
- **Not an inference/derivation operator.** No inference diagnostic; cannot be a
  derivation root. Leave `implies`-only D-1 and the inference-diagnostic unions
  untouched.
- **Glyph:** consumers render `⊕`; the DOT/CLI label here should be sensible
  (e.g. `xor`).

## Surface map (add `xor` everywhere `or` is handled, variadic-style)

- `src/lib/schemata/propositional.ts` — add `Type.Literal("xor")` to
  `CoreLogicalOperatorType` (single source of truth; publicly re-exported).
- `src/lib/core/parser/formula.ts` — variadic AST node (operands list, like
  and/or). `src/lib/core/parser/formula.peggy` — add XOR at the disjunction/
  conjunction precedence tier + AST constructor, then **`pnpm run
  generate:parser`** (or `formula-gen.js` goes stale).
- `src/lib/core/evaluation/kleene.ts` — `kleeneXor` (parity, null-propagating).
- `src/lib/core/premise-engine.ts` — `case "xor"` in the eval switch; include
  xor in the variadic/normalization branches where and/or are handled; keep it
  out of the inference guards.
- `src/lib/grammar/validators/structural.ts` — add `"xor"` to
  `validOperatorTypes` (S-2). `src/lib/grammar/validators/evaluable.ts` — add to
  **E-1** (≥2 operands).
- `src/lib/grammar/an-rules.ts` / `auto-normalize.ts` / `normalize.ts` +
  `validators/presentable.ts` — **add `xor` to the existing AN
  auto-normalization rules and presentable (P) validators wherever `and`/`or`
  are handled, so xor behaves consistently with the current operators.** That
  means the *structural* family already applied to variadic operators:
  same-operator flattening/absorption (`xor(xor(a,b),c) == xor(a,b,c)`, AN-4),
  0/1-child collapse (AN-3), formula-buffer insertion (AN-1), and the
  corresponding P-3/P-4/P-5 invariants. Create a new AN rule / P validator only
  if xor needs one that the variadic operators don't already have.
- **Out of scope for this slice — semantic simplification.** `xor(a,a) → false`
  is *contradiction/tautology reduction*, the same class as `AND(a, ¬a) → false`
  / `OR(a, ¬a) → true`, which **does not exist for any operator today**. Do NOT
  add it here. It is tracked as a **separate backlog item** (logical-simplification
  rules) to be done later; XOR's self-cancellation lands with that family, not
  with this operator-introduction slice.
- `src/lib/core/expression-manager.ts` + `expression-manager-checks.ts` —
  variadic arity branch (`assertChildLimit`); add xor to
  `PERMITTED_OPERATOR_SWAPS` in the and/or class.
- `src/cli/import.ts` (3 AST switches), `src/cli/commands/graph.ts`
  (`operatorLabel`), `src/extensions/pipelines/base/stages/
  formula-validation.ts` (`collectAtoms`).

## Consumer impact

- Additive union member → minor version bump. `@proposit/shared` re-exports the
  enum; server/mobile inherit it. Publish is gated on orchestrator consumer-side
  validation.

## Test cases (TDD — write failing tests first)

- Kleene parity truth table (incl. `null` propagation).
- Parse / round-trip of a `xor(...)` formula (`test/import.test.ts`).
- E-1 arity floor: `xor` with <2 operands rejected (`test/grammar/evaluable.test.ts`).
- Normalization consistent with and/or: nested-xor flatten/absorb, 0/1-child
  collapse (`an-rules`/`normalize`/`auto-normalize`), + P-3/P-4/P-5 validator
  coverage for xor (`test/grammar/presentable.test.ts`). (No self-cancellation
  test — deferred to the simplification-rules backlog item.)
- Operator swap into/out of xor (`test/grammar/mutation-structural.test.ts`).

## Docs (Documentation Sync)

`docs/Proposit_Grammar.md` (operator/precedence/symbol tables + xor in the
existing AN/P rule listings alongside and/or), `docs/api-reference.md`,
`README.md` "Invalid Constructions", release-notes/changelog `upcoming.md`.

## Version / publish

`pnpm version minor`; roll `upcoming.md` → new version; tag after the
orchestrator PUBLISH-READY gate. Do **not** self-publish.
