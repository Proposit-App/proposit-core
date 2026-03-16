# README Mermaid Diagrams — Design Spec

## Goal

Add Mermaid diagrams to the README to help developers integrating the library quickly understand the data model, expression tree structure, argument composition, and evaluation flow.

## Decisions

- **Format:** Mermaid (rendered natively by GitHub, version-controlled in markdown)
- **Audience:** Developers integrating the library
- **Style:** Top-down containment/flowchart
- **Placement:** High-level overview near the top of README + detailed diagrams inline in Concepts

## Diagram Set

### 1. High-Level Overview

**Location:** New "Visual Overview" section after the opening paragraph, before Concepts.

**Content:** Top-down flowchart (`flowchart TD`) showing the full ArgumentEngine containment hierarchy:

- `ArgumentEngine` at the top
- Owned entities: `PremiseEngine` (0..N), Variables (0..N, shared across premises), Roles
- Each `PremiseEngine` contains an `ExpressionManager` with an expression tree
- Injected dependencies shown to the side in a subgraph: `ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary`
- Variables shown as a discriminated union: claim-bound variables connect to `ClaimLibrary` (via `claimId`/`claimVersion`), premise-bound variables connect to a specific premise (via `boundPremiseId`/`boundArgumentId`/`boundArgumentVersion` — may reference a premise in a different argument)
- Roles shown as pointing to a single premise (the conclusion), with an annotation that supporting and constraint roles are derived, not stored

**Purpose:** Give developers the 10-second mental model before reading prose.

### 2. Expression Tree Diagram

**Location:** Inline in Concepts → Expressions section.

**Content:** Tree diagram (`flowchart TD`) showing a concrete expression: `¬(P ∧ R) → (Q ∨ S)`.

Nodes show:
- Root `implies` operator (root-only annotation)
- Left subtree: `not` → formula (transparent wrapper, exactly one child) → `and` (variadic) → variable leaves `P`, `R`
- Right subtree: `or` (variadic) → variable leaves `Q`, `S`
- Node labels indicate type: operator nodes show the logical symbol, variable nodes show the symbol name
- Node styling differentiates operators (hexagon or rounded rect), variables (rect), and formula nodes (dashed border or distinct shape)
- A legend or annotation explains the formula node: transparent unary wrapper equivalent to parentheses, exactly one child

The formula node is included in the left subtree to demonstrate its role. The expression becomes `¬((P ∧ R)) → (Q ∨ S)` structurally, where the outer parentheses around `P ∧ R` are a formula node.

**Purpose:** Show how expressions form trees, the parent-child relationship, the root-only constraint for `implies`/`iff`, and the role of formula nodes.

### 3. Argument Composition Diagram

**Location:** Inline in Concepts, spanning Premises and Argument Roles subsections.

**Content:** Flowchart (`flowchart LR` or `flowchart TD`) showing a concrete argument with:

- Three premises with role annotations:
  - One conclusion (inference premise, root is `implies`) — explicitly set via `setConclusionPremise()`
  - One supporting (inference premise, root is `iff`) — derived role: inference AND NOT conclusion
  - One constraint (root is `and`, not an implication operator) — derived role: not inference
- Variables `P`, `Q`, `R` shown as shared across premises (referenced by multiple premise expression trees)
- Annotation: first premise added is auto-designated as conclusion if `setConclusionPremise()` is never called; explicit call overrides this
- Annotation: supporting = any inference premise not designated as conclusion (derived, not stored)

**Purpose:** Show how premises, roles, and shared variables compose an argument.

### 4. Evaluation Flow Diagram

**Location:** Inline near the evaluation/validity code examples (after Concepts, near the "Evaluating an argument" and "Checking validity" sections).

**Content:** Left-to-right flowchart (`flowchart LR`) showing the evaluation pipeline:

1. **Input:** Variable assignment (variable ID → true/false/null) + rejected expression IDs
2. **Validation gate:** `validateEvaluability()` — checks structural readiness (conclusion set, etc.). If failed → `{ ok: false }` with validation errors
3. **Constraint check:** Evaluate constraint premises → admissible? (three-valued)
4. **Supporting premises:** Evaluate each supporting premise → all true? (three-valued)
5. **Conclusion:** Evaluate conclusion premise → true? (three-valued)
6. **Decision:** If admissible AND all supporting true AND conclusion false → counterexample
7. **Validity:** No counterexamples across all admissible assignments → valid

Decision nodes use diamond shapes. Three-valued outcomes (true/false/null) shown at each evaluation step. The validation gate is shown as the first step with an early-exit path for `ok: false`.

**Purpose:** Show the evaluation pipeline and how Kleene three-valued logic flows through it.

## README Structure Changes

Current section order is preserved. Diagram 3 is placed after Argument Roles (its current position in the README), not before Variables.

Current structure:
```
# proposit-core
  (opening paragraph)
  ## Installation
  ## Concepts
    ### Argument
    ### Premises
    ### Variables
    ### Expressions
    ### Argument roles
    ### Sources
  ## Usage
  ...
```

New structure:
```
# proposit-core
  (opening paragraph)
  ## Visual Overview          ← NEW: Diagram 1
  ## Installation
  ## Concepts
    ### Argument
    ### Premises
    ### Variables
    ### Expressions
      (Diagram 2 inline)      ← NEW: expression tree diagram
    ### Argument roles
      (Diagram 3 inline)      ← NEW: argument composition diagram
    ### Sources
  ## Usage
    ...
    ### Evaluating an argument
      (Diagram 4 inline)      ← NEW: evaluation flow diagram
    ### Checking validity
  ...
```

## Mermaid Conventions

- Use `flowchart TD` for vertical hierarchy diagrams (overview, expression tree)
- Use `flowchart LR` for pipeline/flow diagrams (evaluation)
- Use subgraphs to group related entities (e.g., injected libraries)
- Style nodes by type: rounded for data entities, diamond for decisions, stadium for annotations
- Keep labels concise — full explanations stay in prose
- No custom CSS classes (not supported in GitHub Mermaid rendering)

## Out of Scope

- Interactive diagrams or JavaScript-based rendering
- Diagrams outside the README (API reference, etc.)
- Diagrams for the CLI or on-disk storage format
