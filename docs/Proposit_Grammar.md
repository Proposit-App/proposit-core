# Proposit Grammar Reference

> **Applies to `@proposit/proposit-core@1.0.0` and later.** This document
> is the durable reference for the grammar model. It covers the formula-
> string parser grammar (the human-authored surface), the four-tier AST
> grammar (Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable), the
> enforcement gates, auto-normalization, the `validate(tier)` /
> `normalize(tier?)` API surface, the rule-code wire format, and the
> migration notes for readers upgrading from pre-1.0 versions.
>
> The 1.0 grammar model was specified in the cross-repo design at
> `proposit-orchestration/docs/superpowers/specs/2026-05-13-grammar-tiers-design.md`
> (the source of truth for §2–§6 of this doc during the
> initial 1.0 rollout). This file is now the canonical reference.

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
  (`not`/`formula` unary, `implies`/`iff` binary), sibling positions
  unique within a parent, derivation premise roots restricted to
  `variable`/`implies`/`iff`. **Mutations throw when they would produce
  a non-Structural state.** The engine guarantees an `ArgumentEngine`
  instance never holds a non-Structural state.

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
`@proposit/proposit-core/src/lib/grammar/types.ts` (`TGrammarRuleCode`

- the TypeBox `GrammarRuleCodeSchema`) — proposit-core owns the wire
  format. `@proposit/shared` re-exports the same names from
  `@proposit/shared/schemas/grammar` for consumer ergonomics; server and
  mobile may import from either location. Adding or renaming a code
  extends the TypeBox union and the validator implementation in the
  same single-repo commit; TypeScript catches drift at build time.

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

#### S-8 — Binary operator arity

`implies` and `iff` have **exactly** two children. The lower-positioned
child is the antecedent and the higher-positioned child is the
consequent; the absolute position values are sibling-ordering metadata
maintained by the mutation primitives — any `[a, b]` with `a < b` is
semantically equivalent. Sibling-position uniqueness is enforced
separately by S-9.

> _Rationale: pulling binary arity into Structural eliminates ambiguity that would otherwise exist between S-5 (root-only) and E-1 (variadic-arity floor), and prevents the engine from ever holding a malformed `IMPLIES(a, b, c)` state. Positions themselves carry no Structural meaning beyond their ordering relationship — pinning them to literal `[0, 1]` (as the pre-1.0.2 rule did) false-flagged the engine's own midpoint-spaced bisection pattern (e.g., `[0, 1073741823]` from `wrapExpression`)._

- **Invalid:** `IMPLIES(a)` (1 child); `IMPLIES(a, b, c)` (3 children).
- **Valid:** `IMPLIES(a@0, b@1)`; `IMPLIES(a@0, b@1073741823)`;
  `IFF(a@0, b@1)`.
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
designated as the conclusion via `roleState.conclusionPremiseId`. A
brand-new argument with zero premises is exempt. A dangling
`conclusionPremiseId` (set, but no premise has that id) is always a
violation regardless of premise count.

> _Rationale: every non-empty argument must commit to a single conclusion premise; supporting premises and constraints all derive meaning relative to it. The cycle 4f smoke-test that surfaced this rule's interaction with the server's "Add Premise" UI flow was resolved in 1.0.2 by guarding the engine's mutation surface, not by relaxing E-7 — see "Engine-enforced invariant" below._

> _**Engine-enforced invariant (1.0.2):** core guards the "non-empty argument always has a conclusion" invariant at the mutation surface. `clearConclusionPremise()` is a no-op when premises exist (the call refuses to leave the engine in an E-7-violating state). `removePremise(conclusionPremiseId)` on a multi-premise argument atomically reassigns the conclusion role to the lowest-id remaining premise rather than clearing. Snapshot loads (`fromSnapshot` / `fromData`) deliberately bypass these mutation-surface guards — they accept any Structural-valid state and surface E-7 via `validate()` like other Evaluable issues. The rule's strict reading therefore stays in place as the validate-time safety net for loaded snapshots and direct data-shape construction._

- **Invalid:** an argument with one or more premises and `roleState.conclusionPremiseId === undefined`; any argument with `roleState.conclusionPremiseId` set to a non-existent premise id.
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

### 4.1 `behavior: 'assistive' | 'permissive'`

The engine has a single `behavior` setting that controls whether
**auto-normalization** (AN) runs after every successful Structural
mutation.

- **`assistive`** (default for normal-mode users): after each successful
  Structural mutation, the engine runs the AN rule set (§4.2). AN's
  contract is **preservation**, not convergence: _if the pre-mutation
  state was Presentable, the post-mutation state is Presentable_ (modulo
  the logical effect of the mutation itself — e.g., `removeExpression`
  removes a node; AN keeps the residue Presentable). On non-Presentable
  starting states AN still runs its rule set; it just cannot promise to
  converge to Presentable.
- **`permissive`** (advanced mode): mutations execute exactly as
  described; AN does not run. The engine guarantees only Structural
  integrity. Lower-tier violations (Evaluable, Derivable, Presentable)
  are queryable via `validate(tier)`.

The behavior is a property of the engine instance, set at construction or
via `setBehavior(...)`. The UI's "advanced mode" user setting controls
which behavior the loaded engine is in. Switching from `permissive` →
`assistive` does **not** auto-run a global `normalize()` pass; the UI
prompts the user explicitly before invoking `normalize()`.

### 4.2 AN rule set (AN-1..AN-4)

AN runs a small, ordered set of local cleanup rules after each mutation.
Each rule corresponds to a Presentable invariant from §3.4 and is
designed to fire _only when the mutation introduces a violation that can
be locally repaired without changing user-meaningful structure_.

- **AN-1 (insert formula buffer):** if the mutation places a non-`not`
  operator as a direct child of another operator, insert a `formula`
  between them. Preserves P-1.
- **AN-2 (collapse double negation):** if the mutation produces
  `not(not(x))`, replace with `x`. Preserves P-2.
- **AN-3 (collapse empty/single-child operator/formula):** if the
  mutation leaves an operator or formula with no children, delete it
  (recurse to grandparent). Single-child operators and formulas are
  collapsed where the rule can fire without changing logical meaning;
  see `src/lib/grammar/auto-normalize.ts` for the exact firing
  conditions. Preserves P-3 and P-4 (and incidentally E-1).
- **AN-4 (absorb same-operator adjacency):** if a mutation produces a
  same-operator parent/grandchild pair separated only by a formula,
  absorb. Preserves P-5.

There is no per-rule opt-in or opt-out — the engine is either in
`assistive` (all AN runs) or `permissive` (none runs). The pre-1.0 rule
"reposition on collision" (AN-5 in earlier drafts) was promoted to
Structural enforcement at mutation time (S-9), so it is no longer part
of the post-mutation AN pass.

### 4.3 Worked examples

**AN-1 — formula buffer insertion**

Starting state (Presentable): `AND(formula(OR(a, b)), c)`. The user
inserts a new OR as a direct child of the outer AND:

```
Pre-mutation     AND(formula(OR(a, b)), c)
Mutation         insertExpression: new OR after the formula
Post-mutation    AND(formula(OR(a, b)), OR(d, e), c)   ← non-Presentable mid-step
AN-1 fires       AND(formula(OR(a, b)), formula(OR(d, e)), c)   ← Presentable
```

**AN-2 — double-negation collapse**

```
Pre-mutation     AND(NOT(a), b)
Mutation         toggleNegation on NOT(a)
Post-mutation    AND(NOT(NOT(a)), b)   ← non-Presentable
AN-2 fires       AND(a, b)   ← Presentable
```

**AN-3 — operator collapse on removal**

```
Pre-mutation     AND(a, b)
Mutation         removeExpression(b)
Post-mutation    AND(a)   ← single-child binary operator
AN-3 fires       a   ← child promoted; AND removed
```

If the AND was itself the sole child of a parent operator, AN-3 recurses
to the grandparent. If the AND was the root of a premise, the child
becomes the new root (parentId → null).

**AN-4 — same-operator absorption**

```
Pre-mutation     OR(formula(AND(b, c)), d)   (Presentable; different operator types)
Mutation         updateExpression: swap outer OR to AND
Post-mutation    AND(formula(AND(b, c)), d)   ← same-operator adjacency through formula
AN-4 fires       AND(b, c, d)   ← children absorbed; formula + inner AND removed
```

## 5. `normalize(tier?)` contract

`engine.normalize(tier?: TGrammarTier)` is a separate, explicit operation.
It runs a global pass over the argument and applies the AN rule set
everywhere it can fire, converging the argument toward the requested
tier.

### 5.1 What `normalize` does

- Runs AN-1..AN-4 globally, not just on a single mutation's affected
  nodes.
- Iterates to a fixed point — local rules can cascade, so a single
  invocation may run the rule set multiple times (typically ≤ 3
  iterations because the rules are local and idempotent in combination).
- Defaults `tier` to `'presentable'`. In v1.0 every AN rule targets a
  Presentable invariant, so `normalize('derivable')`,
  `normalize('evaluable')`, and `normalize('structural')` are effectively
  no-ops in the v1.0 ruleset. The parameter exists as forward-compatible
  API surface (§5.4).
- Respects the engine's `behavior` setting only insofar as it does not
  re-run as a post-hook — `normalize()` is always explicit. The engine
  in `permissive` mode still executes `normalize()` when the caller asks.

### 5.2 What `normalize` does _not_ do

`normalize` is **non-destructive in the logical-meaning sense** — its
rules never change the logical meaning of the argument. They only add
buffers, collapse redundant nodes, and absorb same-operator children.
Specifically, `normalize`:

- **Never deletes a variable.** Variables that fail E-3 (binding doesn't
  resolve) stay in place; the corresponding violation is reported by
  `validate('evaluable')` and the UI offers the user a targeted repair
  primitive — see the API reference for the current list.
- **Never changes a claim reference.** A variable bound to claim X stays
  bound to X.
- **Never modifies an operator's semantics.** `AND` does not become `OR`,
  `IMPLIES` does not become `IFF`. (These swaps exist as user-initiated
  mutations on `PremiseEngine`; AN never invokes them.)

`normalize` therefore **cannot recover from Evaluable or Derivable
violations** regardless of the `tier` parameter. Recovering from those
requires user intent — "delete this orphan operator?", "switch this
claim's grounding from axiom to citation?" — and is exposed via
targeted, user-initiated repair primitives. See the API reference for
the current list.

### 5.3 Worked examples

**Pre-publish tidy on an argument that drifted from Presentable**

```
Pre-normalize    AND(OR(a, b), NOT(NOT(c)))
                 ↑ no formula buffer (P-1 violation)
                       ↑ double negation (P-2 violation)
normalize()      AND(formula(OR(a, b)), c)   ← Presentable
```

**Advanced-mode → normal-mode toggle, user accepts auto-clean**

```
Pre-normalize    OR(formula(AND(a, b)), AND(c, d))
                       ↑ no buffer for AND(c, d) (P-1 violation)
normalize()      OR(formula(AND(a, b)), formula(AND(c, d)))   ← Presentable
```

**Evaluable violation that `normalize` cannot fix**

```
Pre-normalize    AND(a)   ← single-child binary operator (E-1 violation)
normalize()      AND(a)   ← single-child operator collapses via AN-3 only when
                            the parent context allows promotion. At the root of
                            a freeform premise this DOES fire and yields `a` —
                            but AN-3 cannot help if the engine's structural
                            mutation rules require the user to pick a fix
                            explicitly. validate('evaluable') still reports E-1.
```

### 5.4 Forward-compat `tier` parameter

The parameter exists so that a future submit/finalize gate (a
less-strict-than-publish tier) can introduce lower-tier AN rules without
an API break. When that happens, `normalize('derivable')` becomes
meaningful — it runs whatever AN rules target Derivable invariants
while leaving Presentable-only rules un-applied. Calls with stricter
tiers run the same pass; calls with more-permissive tiers are no-ops in
v1.0.

## 6. Validation output reference

### 6.1 `TViolation` shape

A single grammar violation. Defined in
`@proposit/proposit-core/src/lib/grammar/types.ts` (the `ViolationSchema`
TypeBox object plus the derived `TViolation` type), and re-exported from
`@proposit/shared/schemas/grammar` for downstream consumers:

```ts
type TViolation = {
    tier: TGrammarTier
    code: TGrammarRuleCode
    message: string // human-readable; UI may localize/replace
    argumentId?: string
    premiseId?: string
    expressionId?: string
    variableId?: string
    claimId?: string
    // additional rule-specific context fields as needed
}
```

The optional entity-ID fields are populated by validators when the
violation localizes to a specific entity — the UI uses these to render
the issue inline alongside the offending entity (per spec §1's "See
what's wrong with my argument" capability).

### 6.2 `TGrammarRuleCode` namespace

The string-literal codes are the wire format shared across core, server,
and mobile:

```
S-1  S-2  S-3  S-4  S-5  S-6  S-7  S-8  S-9  S-10  S-11  S-12  S-13  S-14
E-1            E-3  E-4  E-5  E-6  E-7
D-1  D-2  D-3  D-4  D-5  D-6
P-1  P-2  P-3  P-4  P-5
```

Codes `E-2` and `D-7` are intentionally absent — those rules were
promoted/restated elsewhere in the spec and their codes are reserved
(not reused) to keep historical references unambiguous.

`TGrammarRuleCode` lives in `@proposit/proposit-core`. Adding or
renaming a code is a single-repo coordinated change — extend the
TypeBox union in `src/lib/grammar/types.ts` and ship the validator
implementation in the same commit. TypeScript catches drift at build
time. After a core publish, `@proposit/shared` bumps and re-exports
the updated union from `@proposit/shared/schemas/grammar`; server and
mobile pick up the change via dep bumps.

### 6.3 Example validation responses

**All-empty (Presentable argument):**

```ts
engine.validate("presentable")
// → []
```

**Single Presentable violation (one missing formula buffer):**

```ts
engine.validate("presentable")
// → [
//   {
//     tier: "presentable",
//     code: "P-1",
//     message: "operator 'or' appears as direct child of operator 'and'",
//     argumentId: "...",
//     premiseId: "...",
//     expressionId: "..."
//   }
// ]
```

**Mixed-tier violations (Structural + Evaluable + Derivable):**

```ts
engine.validate("derivable")
// → [
//   { tier: "structural", code: "S-3", message: "...", variableId: "..." },
//   { tier: "evaluable", code: "E-1", message: "operator 'and' has 1 child", ... },
//   { tier: "derivable", code: "D-3", message: "antecedent mixes axiom and citation", ... }
// ]
```

The dispatcher always returns Structural violations first, then
Evaluable, then Derivable, then Presentable. Within a tier, validators
return in the per-rule order defined by their tier's source file.

**Engine-error codes vs grammar-rule codes.** `TViolation.code` (a
`TGrammarRuleCode`) is distinct from the engine-error codes in
`src/lib/types/validation.ts` (`EXPR_PARENT_NOT_FOUND`,
`AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`, etc.). The two namespaces serve
different purposes:

- **Engine-error codes** identify _thrown_ errors from engine operations
  (mutation rejections, snapshot load failures, runtime evaluation
  guards). They are pre-existing and remain stable wire format.
- **Grammar-rule codes** identify _returned_ violations from
  `validate(tier)`. They are new in 1.0.

Both are stable wire format. Do not rename either without a coordinated
shared + core publish.

## 7. Migration notes (pre-1.0 → 1.0)

The 1.0 release removes the pre-1.0 `grammarConfig` / `autoNormalize` /
`ManagedDerivationPremiseEngine` / `LOAD_GRAMMAR-STRICT_GRAMMAR`
machinery with **no deprecation period**. Migration boils down to a
small number of pattern swaps; the new API is strictly more orthogonal.

### 7.1 Removed: `grammarConfig`, `autoNormalize`, `enforceFormulaBetweenOperators`

**Before (≤ 0.12):**

```ts
const engine = new ArgumentEngine(arg, claims, citations, {
    grammarConfig: {
        autoNormalize: {
            wrapInsertFormula: true,
            collapseEmptyFormula: false,
            collapseDoubleNegation: true,
            // ...
        },
        enforceFormulaBetweenOperators: true,
    },
})
```

**After (1.0):**

```ts
const engine = new ArgumentEngine(arg, claims, citations, {
    behavior: "assistive", // or "permissive"
})
```

There is no per-rule opt-in or opt-out. The engine is either in
`assistive` (all AN runs) or `permissive` (none runs).
`enforceFormulaBetweenOperators` is folded into the post-hook (AN-1) and
into the Presentable rule P-1.

### 7.2 Removed: `LOAD_GRAMMAR` / `STRICT_GRAMMAR` snapshot split

**Before:**

```ts
const engine = ArgumentEngine.fromSnapshot(snapshot, claims, citations, {
    grammarConfig: STRICT_GRAMMAR_CONFIG, // or LOAD_GRAMMAR_CONFIG
})
```

**After:**

```ts
const engine = ArgumentEngine.fromSnapshot(snapshot, claims, citations)
// Lower-tier violations are queryable post-load:
const issues = engine.validate("presentable")
```

`fromSnapshot` and `fromData` accept any **Structural** state. Lower-tier
violations are queryable post-load via `validate(tier)`. Load failures
only happen on truly broken (non-Structural) snapshots; the existing
`LEGACY_*` codes for truly broken legacy snapshots remain.

### 7.3 Removed: `ManagedDerivationPremiseEngine`

The subclass enforced derivation invariants on every mutation. In 1.0,
those invariants become Derivable rules (D-1..D-6) plus the Evaluable
rule E-6 (claim-derivation pairing). Mutations on derivation premises go
through the regular `PremiseEngine`; correctness is queried via
`validate('derivable')` rather than thrown at mutation time.

**Before:**

```ts
const managed = new ManagedDerivationPremiseEngine(premise, ...)
managed.toggleNegation(consequentId) // throws DERIVATION_CONSEQUENT_LOCKED
```

**After:**

```ts
const premise = engine.getPremise(id)
premise.toggleNegation(consequentId) // succeeds (Structurally valid)
const issues = engine.validate("derivable") // surfaces D-1 if consequent broken
```

`TVariableMaterializer` (the input shape `ManagedDerivationPremiseEngine`
accepted) is removed too.

### 7.4 Replaced: `populateFromSupports` → `populateFromCitations` + `populateFromAxioms`

`populateFromSupports` ingested both kinds of grounding at once and
produced `IMPLIES(OR(citations, axioms), Q)` — a single premise mixing
both. That shape violates the new D-3 rule (no mixing). In 1.0 the
method is split:

**Before:**

```ts
managed.populateFromSupports(citations, axioms, materializer)
// → IMPLIES(OR(cit-vars + axiom-vars), Q)   ← now illegal (D-3)
```

**After:**

```ts
// Call ONE of these per derivation premise — never both at once.
engine.populateFromCitations(derivedClaimId)
// → IMPLIES(formula(OR(cit-vars)), Q) in assistive mode
//   IMPLIES(OR(cit-vars), Q) in permissive mode

engine.populateFromAxioms(derivedClaimId)
// → IMPLIES(formula(OR(axiom-vars)), Q) in assistive mode
```

Switching grounding kinds on the same derivation premise is "empty the
antecedent (back to naked-Q), then call the other method." The premise
persists across the switch; no row deletion. The runtime path **never
silently drops** user-provided grounding — both methods reject a non-empty
antecedent rather than blending or replacing it without consent.

### 7.5 Behavioral change: naked-Q is a valid Derivable state, eval no-op

Pre-1.0 the engine threw `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`
when `evaluate()` or `checkValidity()` encountered a naked-Q derivation
premise (a single variable at the root). In 1.0 naked-Q is a valid
Derivable state (D-1) and a **no-op for evaluation** — the evaluator
skips it. Naked-Q premises are placeholders for grounding that hasn't
been added yet; they neither assert their consequent nor support its
derivation.

The publish-time pruning step (server-side) deletes naked-Q derivation
premises before storage, so post-publish arguments never carry them. The
"needs grounding" UX hint warns users of unground claims before they
publish.

### 7.6 Behavioral change: snapshot loading accepts any Structural state

Pre-1.0 the loader was configurable between strict (reject any
non-Presentable state) and permissive (load anything) via the
`LOAD_GRAMMAR` / `STRICT_GRAMMAR` constants. In 1.0 the loader is always
permissive at the Structural floor: any Structural-valid snapshot loads,
and lower-tier issues surface via `validate(tier)` post-load. The only
load failures are truly broken snapshots (Structural violations) or
legacy-format snapshots that need a library-level migration first.
