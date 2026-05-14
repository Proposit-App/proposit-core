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

_(To author — pulls from spec §3.)_

- 2.1 Definitions
- 2.2 The subset chain (Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable)
- 2.3 Enforcement gates

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
