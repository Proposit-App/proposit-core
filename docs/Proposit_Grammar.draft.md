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

_(To author — pulls from spec §4. For each rule: tier, code, statement, examples of valid + invalid states, validator function name.)_

- 3.1 Structural rules (S-1..S-14)
- 3.2 Evaluable rules (E-1, E-3..E-7; E-2 reserved)
- 3.3 Derivable rules (D-1..D-6; D-7 reserved)
- 3.4 Presentable rules (P-1..P-5)

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
