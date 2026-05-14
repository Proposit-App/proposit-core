# Proposit Grammar Reference

> **Status — draft (grammar-tiers/core, 2026-05).** This doc replaces the
> pre-1.0 `Proposit_Grammar.md`, which covered only the formula-string
> parser grammar. The new model spans the entire engine: the four-tier
> grammar (Structural / Evaluable / Derivable / Presentable), enforcement
> gates, auto-normalization, the `validate(tier)` / `normalize(tier?)` API,
> and the rule-code wire format.
>
> The cross-repo design spec lives at
> `proposit-orchestration/docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`
> and is the source of truth for §2–§6 here.

## 1. Formula-string parser grammar

This section defines the grammar for logical formulas accepted by
proposit-core's formula-string parser. It is the textual surface for
human-authored formulas; the parser materializes formulas into the AST
that the rest of this document describes.

### 1.1 Quick Reference

| Operator      | Unicode | ASCII  | Arity          | Example |
| ------------- | ------- | ------ | -------------- | ------- |
| Negation      | `¬`     | `!`    | Unary (prefix) | `¬P`    |
| Conjunction   | `∧`     | `&&`   | Binary/n-ary   | `P ∧ Q` |
| Disjunction   | `∨`     | `\|\|` | Binary/n-ary   | `P ∨ Q` |
| Implication   | `→`     | `->`   | Binary         | `P → Q` |
| Biconditional | `↔`     | `<->`  | Binary         | `P ↔ Q` |

### 1.2 Operator Precedence

From highest to lowest binding strength:

1. `¬` / `!` (negation) — tightest binding, right-associative prefix
2. `∧` / `&&` (conjunction) — left-associative
3. `∨` / `||` (disjunction) — left-associative
4. `→` / `->` and `↔` / `<->` (implication, biconditional) — lowest precedence, non-associative

Parentheses `( )` override precedence.

### 1.3 Variables

A variable is any identifier matching the pattern:

```
[A-Za-z_][A-Za-z0-9_]*
```

Valid examples: `P`, `Q`, `Rain`, `is_wet`, `P1`, `myVar`

Variables are case-sensitive: `p` and `P` are distinct variables.

### 1.4 Grammar

```
formula       ← implication

implication   ← disjunction ( ('→' / '->') disjunction
                             / ('↔' / '<->') disjunction )?

disjunction   ← conjunction ( ('∨' / '||') conjunction )*

conjunction   ← unary ( ('∧' / '&&') unary )*

unary         ← ('¬' / '!') unary
              / atom

atom          ← '(' formula ')'
              / variable

variable      ← [A-Za-z_][A-Za-z0-9_]*
```

Whitespace between tokens is optional and ignored.

### 1.5 Root-Only Restriction

Implication (`→`) and biconditional (`↔`) may only appear at the **top level** of a formula. They cannot be nested inside other operators or within parentheses. (This corresponds to Structural rule S-5 in the AST grammar — §3.1.)

**Valid:**

```
P → Q
A ∧ B → C ∨ D
¬P ↔ Q
```

**Invalid:**

```
(P → Q) ∧ R        # implication inside parentheses
P ∨ (A ↔ B)        # biconditional inside parentheses
P → Q → R          # chained implications
```

### 1.6 Examples

**Simple formulas:**

| Formula | Description        |
| ------- | ------------------ |
| `P`     | A single variable  |
| `¬P`    | Negation of P      |
| `P ∧ Q` | P and Q            |
| `P ∨ Q` | P or Q             |
| `P → Q` | P implies Q        |
| `P ↔ Q` | P if and only if Q |

**Compound formulas:**

| Formula       | Parsed as                                      |
| ------------- | ---------------------------------------------- |
| `P ∧ Q ∧ R`   | Three-way conjunction: and(P, Q, R)            |
| `P ∨ Q ∨ R`   | Three-way disjunction: or(P, Q, R)             |
| `¬P ∧ Q`      | (¬P) ∧ Q — negation binds tighter              |
| `P ∨ Q ∧ R`   | P ∨ (Q ∧ R) — conjunction binds tighter        |
| `P ∧ Q → R`   | (P ∧ Q) → R — implication is lowest precedence |
| `(P ∨ Q) ∧ R` | Parentheses override precedence                |

**ASCII equivalents:**

| Unicode            | ASCII                  |
| ------------------ | ---------------------- |
| `¬P ∧ Q`           | `!P && Q`              |
| `P ∨ Q → R`        | `P \|\| Q -> R`        |
| `A ↔ B`            | `A <-> B`              |
| `!(A \|\| B) && C` | Same as `¬(A ∨ B) ∧ C` |

**Mixed notation** — Unicode and ASCII operators may be mixed freely within a formula:

```
¬P && Q || R -> S
```

is equivalent to:

```
¬P ∧ Q ∨ R → S
```

which parses as `((¬P) ∧ Q) ∨ R → S`, i.e., `(((¬P) ∧ Q) ∨ R) → S`.

## 2. The four-tier model

Proposit's AST grammar is split into four tiers. They form a strict subset
chain: each tier admits a strictly smaller set of argument states than the
one above it. The tiers separate three orthogonal concerns:

- **What the engine _can_ hold** — answered by Structural.
- **What the system _accepts_** (saveable, evaluable) — answered by Evaluable + Derivable.
- **What the system _prefers_** (ideal canonical form) — answered by Presentable.

This separation lets users construct arguments through temporarily-invalid
intermediate states without engine rejection. The engine never blocks a
mid-edit state for failing a higher tier; the higher tiers are surfaced as
queryable violations (`validate(tier)`) rather than thrown errors.

### 2.1 Definitions

- **Structural** — the floor. Engine data integrity: operator types valid,
  FK references resolve, entity IDs and variable symbols unique within
  scope, no orphan refs, no cycles, fixed-arity-operator invariants
  (`not`/`formula` unary, `implies`/`iff` binary at fixed positions),
  sibling positions unique within a parent, derivation premise roots
  restricted to `variable`/`implies`/`iff`. **Mutations throw when they
  would produce a non-Structural state.** The engine guarantees an
  `ArgumentEngine` instance never holds a non-Structural state.

- **Evaluable** — required for `evaluate()` and `checkValidity()` to run.
  Every operator has the right number of operands (variadic arity floor),
  every variable's binding resolves to a non-broken target, every normal
  claim has at most one derivation premise paired with it, and the
  argument has a designated conclusion premise (if it has any premises at
  all). `evaluate()` and `checkValidity()` short-circuit on violation —
  they do not throw; they return a violation list.

- **Derivable** — required for the argument to be a well-formed Proposit
  argument. Concerns the canonical shape of derivation premises (naked-Q
  or populated `IMPLIES(antecedent, Q)`) and where typed claims may appear
  (axiomatic and citation claims only inside derivation premise
  antecedents). Surfaced via `validate('derivable')` for UI feedback;
  enforced indirectly by the publish gate, which requires the stricter
  Presentable tier.

- **Presentable** — the intended/ideal form. Cosmetic and clarity rules:
  formula buffers between operators, no double negation, no single-leaf
  formulas, no single-child operators, no same-operator adjacency through
  a formula. The publish endpoint rejects with a violation list when an
  argument is not Presentable. Auto-normalization (§4) preserves this
  tier across mutations when the engine is in `assistive` behavior.

### 2.2 The subset chain

```
Structural   ⊇   Evaluable   ⊇   Derivable   ⊇   Presentable
(most permissive)                              (most restrictive)
```

Set-membership consequences:

- A Presentable argument is also Derivable, Evaluable, and Structural.
- An argument that fails Structural validation also fails every other
  tier.
- The publish gate (`validate('presentable')`) implies the submit gate
  (`validate('derivable')`), so a successful publish has already passed
  every prior gate.

Validation can short-circuit: once a violation is found at tier T, lower
tiers may still run for completeness (so the UI can show every known issue
at once) but the gate decision is already made. The dispatcher
(`src/lib/grammar/validate.ts`) implements the union: `validate('evaluable')`
returns Structural + Evaluable violations; `validate('derivable')` adds
Derivable; `validate('presentable')` returns the union across all four
tiers.

### 2.3 Enforcement gates

| Tier        | Where it's enforced                                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural  | **Mutation throws.** Every mutation method on `PremiseEngine` rejects inputs that would produce a non-Structural state.                                                                                                                               |
| Evaluable   | `evaluate()` and `checkValidity()` short-circuit and return a violation list; they do not throw. Server submit endpoints may run `validate('evaluable')` as a pre-store guard.                                                                        |
| Derivable   | No dedicated engine-level gate. Surfaced via `validate('derivable')` for UI feedback. Server endpoints in `assistive` mode run `validate('derivable')` as a pre-store guard and reject 422 on violations (advanced-mode users defer to publish-time). |
| Presentable | Publish endpoint runs `validate('presentable')` and rejects with the violation list. Auto-normalization preserves this tier across mutations in `assistive` behavior.                                                                                 |

### 2.4 The name "Derivable"

The tier is named for its central concern — the canonical form of
derivation premises and where typed claims may appear in derivation
contexts. The name has a mild overlap with the logic-theoretic sense
("derivable from axioms"), but the ambiguity is contextually clear in
Proposit usage. If a better name surfaces during implementation,
`ProductGrammar` or `Conventional` are reasonable aliases.

## 3. Rule inventory

Every rule is identified by a stable string code. The codes live in
`@proposit/shared/schemas/grammar` (`TGrammarRuleCode`) so server, mobile,
and core all speak the same wire format. Core owns the **definitions** of
what each code means and what triggers it; shared owns the **string
identifiers**. Adding or renaming a code is a coordinated shared + core
publish.

Validator functions referenced below live in
`src/lib/grammar/validators/{structural,evaluable,derivable,presentable}.ts`
and have the signature `(ctx: TValidatorContext) => readonly TViolation[]`.

### 3.1 Structural rules

Always enforced at mutation time. Mutations that would produce a
non-Structural state throw.

#### S-1 — FK soundness

Every expression's `parentId` resolves to another expression in the same
premise or is `null`. Every variable's `boundPremiseId` / `claimId`
resolves. Every premise's `argumentId` / `argumentVersion` matches its
container.

- **Invalid:** an expression with `parentId: "missing-id"`.
- **Valid:** root expression with `parentId: null`; child expression whose `parentId` matches a sibling root in the same premise.
- **Validator:** `validateS1`.

#### S-2 — Operator types

Every expression's discriminator is one of `variable`, `formula`, `not`,
`and`, `or`, `implies`, `iff`.

- **Invalid:** an expression with `type: "foo"`.
- **Valid:** any expression whose `type` is in the legal set.
- **Validator:** `validateS2`.

#### S-3 — Variable required reference

Every variable has either a claim reference or a premise reference, not
both, not neither.

- **Invalid:** a variable with both `claimId` and `boundPremiseId` set; a variable with neither.
- **Valid:** a claim-bound variable (`claimId` set, `boundPremiseId` unset) or a premise-bound variable (the inverse).
- **Validator:** `validateS3`.

#### S-4 — No cycles

The expression tree of a premise contains no cycles. The argument's
claim / citation / axiom graph respects existing acyclicity invariants.

- **Invalid:** an expression whose `parentId` chain ultimately points back at itself.
- **Valid:** any tree (DAG) of expressions.
- **Validator:** `validateS4`.

#### S-5 — Root-only IMPLIES/IFF

Within a single premise's AST, `implies` and `iff` may appear at most
once and only at the root. They cannot be nested inside other operators
or appear as non-root children.

> _Rationale: implies/iff are syntactic sugar over not/or and not/and; restricting their tree position does not restrict the logical domain the engine can express._

- **Invalid:** `AND(IMPLIES(A, B), C)` — implies nested.
- **Valid:** `IMPLIES(A, B)` at root; `AND(A, B)` at root.
- **Validator:** `validateS5`.

#### S-6 — Premise type discriminator consistency

`type='derivation'` premises have a non-null `derivedClaimId`;
`type='freeform'` premises have a null `derivedClaimId`.

- **Invalid:** a `type='derivation'` premise with `derivedClaimId: null`.
- **Valid:** a freeform premise with `derivedClaimId: null`; a derivation premise with `derivedClaimId: "some-claim-id"`.
- **Validator:** `validateS6`.

#### S-7 — Claim type immutability

A claim's `type` field is set at creation and cannot be changed. This is
a **creation-time invariant** enforced by `ClaimLibrary.update()` (via
the engine-error code `CLAIM_TYPE_IMMUTABLE`); the AST-level validator
is therefore a no-op.

- **Validator:** `validateS7` (returns `[]` unconditionally; documented).

#### S-8 — Binary operator arity and positions

`implies` and `iff` have **exactly** two children, ordered as
`[antecedent, consequent]` at positions `0` and `1` respectively.

> _Rationale: pulling binary arity and position semantics into Structural eliminates ambiguity that would otherwise exist between S-5 (root-only) and E-1 (variadic-arity floor), and prevents the engine from ever holding a malformed `IMPLIES(a, b, c)` or position-swapped state._

- **Invalid:** `IMPLIES(a@0, b@1, c@2)`; `IMPLIES(a@1, b@0)`.
- **Valid:** `IMPLIES(a@0, b@1)`; `IFF(a@0, b@1)`.
- **Validator:** `validateS8`.

#### S-9 — Sibling position uniqueness

Within a single parent's children, no two siblings share the same
`position`. Mutations that would produce a collision throw. Composite
mutations that accept a position argument (e.g., `insertExpression`)
shift colliding siblings as part of the bundled op (§5).

> _Rationale: sibling position is a data-integrity concern — overlapping positions break ordering and downstream rendering. The pre-1.0 "reposition on collision" post-hook (the old AN-5) is folded into Structural enforcement, so permissive-mode mutations cannot leave the engine in a position-broken state._

- **Invalid:** two siblings under the same parent both at `position: 1000`.
- **Valid:** siblings at distinct positions.
- **Validator:** `validateS9`.

#### S-10 — Entity ID uniqueness

Within an argument, every premise, expression, and variable has a unique
ID. Within the unified claim library, every claim has a unique ID.
Connections (citations, axioms) similarly have unique IDs within their
respective libraries.

- **Invalid:** two expressions with the same `id` in the same argument.
- **Valid:** every entity ID distinct.
- **Validator:** `validateS10`.

#### S-11 — Variable symbol uniqueness

Within a single argument, no two variables share the same `symbol`.

- **Invalid:** two variables both with `symbol: "P"`.
- **Valid:** every variable symbol distinct.
- **Validator:** `validateS11`.

#### S-12 — NOT unary arity

`not` expressions have exactly one child.

- **Invalid:** `NOT()` (0 children); `NOT(a, b)` (2 children).
- **Valid:** `NOT(a)`.
- **Validator:** `validateS12`.

#### S-13 — Formula unary arity

`formula` expressions have exactly one child.

> _Rationale: `formula` is a transparent parenthesization wrapper; a 0-child or multi-child formula is not a coherent concept under Proposit's data model._

- **Invalid:** `formula()`; `formula(a, b)`.
- **Valid:** `formula(a)`.
- **Validator:** `validateS13`.

#### S-14 — Derivation premise root operator

Every `type='derivation'` premise's root expression is one of:
`variable` (naked-Q form), `implies` (canonical populated form per D-1),
or `iff` (allowed Structurally; flagged Derivable per D-1).

- **Invalid:** a derivation premise whose root is `and`, `or`, `not`, or `formula`.
- **Valid:** root `variable` (naked-Q); root `implies` (populated); root `iff` (Structural-only — fails D-1).
- **Validator:** `validateS14`.

### 3.2 Evaluable rules

Required for `evaluate()` and `checkValidity()` to run.

> Code `E-2` is reserved — see spec §4.2. The pre-spec rule "formula non-emptiness" was promoted to Structural as S-13.

#### E-1 — Variadic operator arity floor

`and` and `or` each have at least two children.

> _Pre-1.0 engine collapsed 0/1-child and/or operators via auto-normalization. The 1.0 engine accepts these states Structurally and reports them as Evaluable violations._

- **Invalid:** `AND()` (0 children); `OR(a)` (1 child).
- **Valid:** `AND(a, b)`; `OR(a, b, c)`.
- **Validator:** `validateE1`.

#### E-3 — Variable binding resolves

Every variable's claim or premise reference points at an existing,
non-deleted target.

- **Invalid:** a claim-bound variable whose `claimId` is not in the claim library.
- **Valid:** every variable resolves.
- **Validator:** `validateE3`.

#### E-4 — Axiomatic-binding constraint

Axiomatic-bound variables are not assigned in the caller's evaluation
input. This is a **runtime evaluation guard** on caller-supplied input,
not an AST invariant.

> _The AST-level validator (`validateE4`) cannot detect this from the argument tree alone — the input map isn't part of the tree. The check runs inside `ArgumentEngine.evaluate` / `.checkValidity` and rejects pre-flight with the engine-error code `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`._

- **Validator:** `validateE4` (returns `[]` unconditionally; documented).

#### E-5 — Derivation premise consequent present

Every `type='derivation'` premise's expression tree includes a variable
bound to its `derivedClaimId`. Naked-Q satisfies this (the lone variable
at the root _is_ the consequent).

- **Invalid:** a derivation premise tree containing no variable bound to `derivedClaimId`.
- **Valid:** naked-Q form; populated form with the consequent at position 1 of the root `IMPLIES`.
- **Validator:** `validateE5`.

#### E-6 — Claim-derivation pairing

For every `type='normal'` claim referenced in the argument, **at most
one** `type='derivation'` premise exists with `derivedClaimId` matching
that claim.

> _A claim with **zero** derivation premises is valid grammar — this is the natural state after publish-time pruning of naked-Q premises, and is also acceptable mid-edit if the user explicitly deletes the auto-created premise. During pre-publish editing the engine auto-creates a derivation premise when a normal claim is first added, so the typical mid-edit state is exactly one._

- **Invalid:** two derivation premises with the same `derivedClaimId`.
- **Valid:** zero or exactly one derivation premise per normal claim.
- **Validator:** `validateE6`.

#### E-7 — Argument has conclusion premise

An argument that has at least one premise has exactly one premise
designated as the conclusion via the argument's role state. A
brand-new argument with zero premises is exempt.

- **Invalid:** an argument with three premises and `roleState.conclusionPremiseId === undefined`.
- **Valid:** an argument with zero premises (brand-new); an argument with one or more premises and a designated conclusion.
- **Validator:** `validateE7`.

### 3.3 Derivable rules

Required for the server to accept an argument as well-formed.

> Code `D-7` is reserved — see spec §4.3. The pre-spec rule "derivation premise cardinality" was restated and moved to Evaluable as E-6.

#### D-1 — Derivation premise canonical shape

Every `type='derivation'` premise's expression tree is in one of two
canonical Derivable forms:

- **Naked-Q form** — a single `variable` expression at the root, bound to the consequent claim. Naked-Q is **valid Derivable** — it represents "this claim has a derivation premise but no antecedent has been added yet."
- **Populated form** — root `IMPLIES` (specifically `IMPLIES`, **not** `IFF` — `IFF` is allowed at the root of non-derivation premises per S-5 but never at the root of a derivation premise) with the consequent variable at position 1. The antecedent's operator-and-variable skeleton — **ignoring any intervening `formula` buffer nodes** (a Presentable-tier concern per P-1) — is exactly one of:
    - `IMPLIES(axiomatic-claim-variable, Q)` — single axiomatic-claim antecedent, OR
    - `IMPLIES(OR(citation-variable, citation-variable, …), Q)` — OR-of-citations antecedent (two or more citation variables; one citation wraps directly per D-2).

At the Presentable tier the populated shape carries a `formula` buffer
between `IMPLIES` and `OR` (`IMPLIES(formula(OR(c, c, …)), Q)`) per P-1
— that is the Presentable rendering of the same Derivable skeleton.
Validators for D-1 treat `formula` nodes as transparent when matching
the populated-form skeleton.

- **Invalid:** `IFF(antecedent, Q)` rooted on a derivation premise; populated form whose antecedent is a `not(x)` chain.
- **Valid:** naked-Q; `IMPLIES(c, Q)`; `IMPLIES(formula(OR(c, c)), Q)`.
- **Validator:** `validateD1`.

#### D-2 — Single-citation derivation form

If a derivation premise has exactly one citation as antecedent, the form
is `IMPLIES(citation-variable, Q)` — no surrounding `OR`.

- **Invalid:** `IMPLIES(OR(c1), Q)` — single-element OR.
- **Valid:** `IMPLIES(c1, Q)`.
- **Validator:** `validateD2`.

#### D-3 — No mixing axioms and citations in one derivation

The antecedent of a single derivation premise cannot mix axiomatic and
citation variables. A claim that has both kinds of grounding has _two_
derivation premises (one of each form).

- **Invalid:** `IMPLIES(OR(axiomVar, citationVar), Q)`; `IMPLIES(formula(OR(axiomVar, citationVar)), Q)`.
- **Valid:** all-citation antecedent; all-axiom antecedent.
- **Validator:** `validateD3`.

#### D-4 — Axiomatic claim placement

Variables bound to `type='axiomatic'` claims appear only in the
antecedent of a derivation premise, never in freeform premises and
never in a derivation premise's consequent slot.

- **Invalid:** an axiomatic-bound variable used in a freeform premise; an axiomatic-bound variable at position 1 (the consequent slot) of `IMPLIES`.
- **Valid:** axiomatic-bound variable in the antecedent of a derivation premise.
- **Validator:** `validateD4`.

#### D-5 — Citation claim placement

Mirror of D-4 for citation claims. Variables bound to `type='citation'`
claims appear only in the antecedent of a derivation premise.

- **Invalid:** a citation-bound variable in a freeform premise; a citation-bound variable at the consequent slot of a derivation premise.
- **Valid:** citation-bound variable in the antecedent.
- **Validator:** `validateD5`.

#### D-6 — Derivation premise role

Every `type='derivation'` premise has `role='supporting'` (i.e.,
`roleState.conclusionPremiseId !== premise.id`).

- **Invalid:** a derivation premise designated as the conclusion.
- **Valid:** a derivation premise that is not the conclusion (the default).
- **Validator:** `validateD6`.

### 3.4 Presentable rules

The ideal form. Auto-normalization (§4) preserves this tier when the
engine is in `assistive` behavior. The publish gate enforces it.

#### P-1 — Formula buffer between operators

A non-`not` operator (`and`, `or`, `implies`, `iff`) is never a direct
child of another operator. A `formula` node sits between them. `not` is
exempt — it can be a direct child of any operator.

- **Invalid:** `AND(OR(a, b), c)` — OR is a direct child of AND.
- **Valid:** `AND(formula(OR(a, b)), c)`; `AND(NOT(a), b)`.
- **Validator:** `validateP1`.

#### P-2 — No double negation

`not(not(x))` does not appear in the tree.

- **Invalid:** `NOT(NOT(a))`.
- **Valid:** `NOT(a)` for any `a`.
- **Validator:** `validateP2`.

#### P-3 — Formula has operator descendant

A `formula` node's bounded subtree (stopping at the next nested formula)
contains at least one binary operator. Formulas wrapping a leaf or a
single `not` are not Presentable.

- **Invalid:** `formula(a)` (leaf wrapper); `formula(NOT(a))` (no binary descendant).
- **Valid:** `formula(AND(a, b))`.
- **Validator:** `validateP3`.

#### P-4 — No single-child binary operator

`and` and `or` with exactly one child are not Presentable. (Also fails
E-1 — this rule is included in the Presentable inventory for clarity.)

- **Invalid:** `AND(a)`; `OR(a)`.
- **Valid:** `AND(a, b)` and any larger arity.
- **Validator:** `validateP4`.

#### P-5 — No operator-of-same-type adjacency through a formula

After an operator swap, same-typed children separated only by a formula
are absorbed into the parent. The Presentable tier rejects the
unabsorbed state.

- **Invalid:** `AND(formula(AND(b, c)), d)` — the inner AND should be absorbed into `AND(b, c, d)`.
- **Valid:** `AND(formula(OR(b, c)), d)` — different operator types; no absorption.
- **Validator:** `validateP5`.

## 4. Engine behavior and auto-normalization

_(To author — pulls from spec §5.)_

- 4.1 `behavior: 'assistive' | 'permissive'`
- 4.2 AN rule set (AN-1..AN-4)
- 4.3 Worked examples — AN preserves Presentable across each kind of mutation

## 5. `normalize(tier?)` contract

_(To author — pulls from spec §6.)_

- 5.1 What `normalize` does
- 5.2 What `normalize` does _not_ do
- 5.3 Worked examples
- 5.4 Forward-compat `tier` parameter

## 6. Validation output reference

_(To author.)_

- 6.1 `TViolation` shape
- 6.2 `TGrammarRuleCode` namespace
- 6.3 Example validation responses

## 7. Migration notes (pre-1.0 → 1.0)

_(To author.)_

- 7.1 Removed: `grammarConfig`, `autoNormalize`, `enforceFormulaBetweenOperators`
- 7.2 Removed: `LOAD_GRAMMAR` / `STRICT_GRAMMAR` snapshot split
- 7.3 Removed: `ManagedDerivationPremiseEngine`
- 7.4 Replaced: `populateFromSupports` → `populateFromCitations` + `populateFromAxioms`
- 7.5 Behavioral change: naked-Q is a valid Derivable state, eval no-op
- 7.6 Behavioral change: snapshot loading accepts any Structural state
