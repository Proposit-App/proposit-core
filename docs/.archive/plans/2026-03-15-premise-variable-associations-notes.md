# Premise-Variable Associations — Design Notes

**Status:** Early idea, not yet designed

## Problem

The root-only operator restriction means `implies` and `iff` cannot be nested. To express "P implies that A implies B" as a single argument, you need two premises:

- Premise 1: `A implies B`
- Premise 2: `P implies Q`

Where Q "stands for" Premise 1's content.

Currently, Q references a claim in ClaimLibrary, but there's no structural link between Q and the expression tree of Premise 1. The claim is just metadata — it doesn't say "Q is this specific premise."

## Proposed Concept

A **premise-variable association** (or **formula-variable association**) that binds a variable to a formula or premise within the same argument:

- "Variable Q is bound to Formula/Premise X" — meaning Q represents the proposition expressed by X's expression tree
- This is a substitution/abbreviation mechanism, not a source citation

## Open Questions

- **Binding target:** Premise or formula? Binding to a formula node would allow referencing sub-structures (e.g., a parenthesized sub-expression), not just entire premises.
- **Scope:** Argument-local only, or cross-argument? (Likely argument-local since expression trees are argument-scoped.)
- **Claim relationship:** Does the bound variable's claim need to match the structural content of the premise? Or is the association purely a convenience annotation?
- **Evaluation implications:** Should the evaluator treat Q as semantically equivalent to the bound premise when computing truth values?
- **Circularity:** Need to prevent cycles (Q bound to a premise that references Q).

## Relationship to Other Work

Orthogonal to the claim-source association refactor. That work changes where sources live (claim-level, not variable/expression-level). This work changes how variables can reference structural content within an argument.
