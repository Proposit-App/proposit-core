# README Mermaid Diagrams Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Mermaid diagrams to README.md showing the data model hierarchy, expression tree structure, argument composition, and evaluation flow.

**Architecture:** All changes are to a single file (`README.md`). Each task adds one Mermaid diagram at a specific location. No code changes, no tests — purely documentation.

**Tech Stack:** Mermaid (GitHub-native rendering), Markdown

**Spec:** `docs/plans/2026-03-16-readme-diagrams-design.md`

**Note:** All insertion points are identified by surrounding content, not line numbers. Tasks are ordered top-to-bottom in the README; each insertion shifts subsequent content down.

---

## Chunk 1: All Diagrams

### Task 1: Add Visual Overview diagram

**Files:**

- Modify: `README.md` — insert new section between opening paragraph and `## Installation`

- [ ] **Step 1: Add the Visual Overview section with Mermaid diagram**

Insert a new `## Visual Overview` section after the opening paragraph (the line starting with `Also ships a **CLI**...`) and before `## Installation`. The diagram is a `flowchart TD` showing the ArgumentEngine containment hierarchy.

````markdown
## Visual Overview

```mermaid
flowchart TD
    AE["ArgumentEngine"]

    AE --> PM["PremiseEngine (0..N)"]
    AE --> VM["Variables (0..N, shared)"]
    AE --> Roles["Roles"]

    PM --> EM["ExpressionManager"]
    EM --> ET["Expression Tree"]

    VM --> CBV["Claim-Bound\n(claimId, claimVersion)"]
    VM --> PBV["Premise-Bound\n(boundPremiseId,\nboundArgumentId,\nboundArgumentVersion)"]

    CBV -.-> CL
    PBV -.->|"references specific premise\n(may be cross-argument)"| PM

    Roles -.->|"conclusionPremiseId\n(supporting & constraint\nroles are derived)"| PM

    subgraph Injected["Injected Libraries"]
        CL["ClaimLibrary"]
        SL["SourceLibrary"]
        CSL["ClaimSourceLibrary"]
    end

    AE -.-> Injected

    style Injected fill:none,stroke:#888,stroke-dasharray: 5 5
`` `
```
````

- [ ] **Step 2: Verify the diagram renders**

Open the README in a Mermaid-capable preview (GitHub, VS Code with Mermaid extension, or `npx @mermaid-js/mermaid-cli` if available). Confirm:

- ArgumentEngine at top, flows down to PremiseEngine, Variables, Roles
- Variables split into claim-bound and premise-bound with dotted arrows to ClaimLibrary and PremiseEngine respectively
- Injected Libraries in a dashed subgraph
- Roles annotation mentions derived roles

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add visual overview diagram to README"
```

---

### Task 2: Add Expression Tree diagram

**Files:**

- Modify: `README.md` — insert after the operator arity table in the Expressions section (after the line `` `implies` and `iff` are **root-only** ``) and before `### Argument roles`

- [ ] **Step 1: Add the expression tree diagram**

Insert after the line `` `implies` and `iff` are **root-only**: they must have `parentId: null` and cannot be nested inside another expression. `` and before `### Argument roles`. The example expression is `¬((P ∧ R)) → (Q ∨ S)` — a formula node wraps the `and` to show its role.

````markdown
The following diagram shows how the expression `¬(P ∧ R) → (Q ∨ S)` is represented as a tree. Note the formula node — a transparent wrapper equivalent to parentheses — and that `implies` must be the root:

```mermaid
flowchart TD
    IMP["→ implies\n(root-only, binary)"]

    IMP --> NOT["¬ not\n(unary)"]
    IMP --> OR["∨ or\n(variadic, ≥ 2)"]

    NOT --> FRM["( ) formula\n(transparent wrapper,\nexactly 1 child)"]

    FRM --> AND["∧ and\n(variadic, ≥ 2)"]

    AND --> P["P\n(variable)"]
    AND --> R["R\n(variable)"]

    OR --> Q["Q\n(variable)"]
    OR --> S["S\n(variable)"]

    style IMP fill:#e8f4fd,stroke:#2196f3
    style NOT fill:#e8f4fd,stroke:#2196f3
    style AND fill:#e8f4fd,stroke:#2196f3
    style OR fill:#e8f4fd,stroke:#2196f3
    style FRM fill:none,stroke:#888,stroke-dasharray: 5 5
    style P fill:#f5f5f5,stroke:#666
    style R fill:#f5f5f5,stroke:#666
    style Q fill:#f5f5f5,stroke:#666
    style S fill:#f5f5f5,stroke:#666
`` `
```
````

- [ ] **Step 2: Verify the diagram renders**

Confirm:

- `implies` is root, with annotation "(root-only, binary)"
- Left subtree: `not` → formula (dashed) → `and` → P, R
- Right subtree: `or` → Q, S
- Operators styled blue, variables grey, formula dashed
- Arity annotations on each operator

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add expression tree diagram to README"
```

---

### Task 3: Add Argument Composition diagram

**Files:**

- Modify: `README.md` — insert at the end of the `### Argument roles` section, after the paragraph about constraint premises and before `### Sources`

- [ ] **Step 1: Add the argument composition diagram**

Insert after the paragraph starting with `A premise that is neither supporting nor the conclusion` (end of the Argument roles section) and before `### Sources`. Add a new paragraph and Mermaid block:

````markdown
The following diagram shows how premises, roles, and shared variables compose an argument:

```mermaid
flowchart TD
    ARG["Argument"]

    ARG --> P1["Premise 1\n<b>Conclusion</b>\n(inference: root is →)"]
    ARG --> P2["Premise 2\n<b>Supporting</b>\n(inference: root is ↔)"]
    ARG --> P3["Premise 3\n<b>Constraint</b>\n(root is ∧)"]

    subgraph Shared["Shared Variables"]
        VP["P"]
        VQ["Q"]
        VR["R"]
    end

    P1 -.- VP
    P1 -.- VQ
    P2 -.- VQ
    P2 -.- VR
    P3 -.- VP
    P3 -.- VR

    note1["Conclusion: set via setConclusionPremise()\nFirst premise auto-designated if not set"]
    note2["Supporting: any inference premise\nthat is not the conclusion (derived)"]
    note3["Constraint: any non-inference premise (derived)"]

    P1 ~~~ note1
    P2 ~~~ note2
    P3 ~~~ note3

    style P1 fill:#e8f4fd,stroke:#2196f3
    style P2 fill:#e8f4fd,stroke:#2196f3
    style P3 fill:#fff3e0,stroke:#ff9800
    style Shared fill:none,stroke:#888,stroke-dasharray: 5 5
    style note1 fill:none,stroke:none
    style note2 fill:none,stroke:none
    style note3 fill:none,stroke:none
`` `
```
````

- [ ] **Step 2: Verify the diagram renders**

Confirm:

- Three premises with role labels: Conclusion, Supporting, Constraint
- Inference premises (P1, P2) styled blue, constraint (P3) styled orange
- Variables P, Q, R in a shared subgraph with dotted connections to premises
- Annotation nodes explain role derivation rules

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add argument composition diagram to README"
```

---

### Task 4: Add Evaluation Flow diagram

**Files:**

- Modify: `README.md` — insert before the `### Evaluating an argument` code example (before the line `Assignments use \`TCoreExpressionAssignment\`...`)

- [ ] **Step 1: Add the evaluation flow diagram**

Insert before the paragraph starting with `Assignments use \`TCoreExpressionAssignment\``(inside the`### Evaluating an argument` section). Add a new paragraph and Mermaid block:

````markdown
The evaluation pipeline proceeds as follows:

```mermaid
flowchart LR
    IN["Input\n(variable ID → true/false/null\n+ rejected expression IDs)"]

    IN --> VAL{"validateEvaluability()"}

    VAL -->|"fail"| FAIL["{ ok: false }\nvalidation errors"]
    VAL -->|"pass"| CON["Evaluate\nConstraint\nPremises"]

    CON --> ADM{"Admissible?\n(three-valued)"}

    ADM -->|"true"| SUP["Evaluate\nSupporting\nPremises"]
    ADM -->|"false/null"| INADM["Not admissible\n(skip)"]

    SUP --> SUPR{"All supporting\ntrue?\n(three-valued)"}

    SUPR -->|"true"| CONC["Evaluate\nConclusion"]
    SUPR -->|"false/null"| NONCE["Not a\ncounterexample"]

    CONC --> CONCR{"Conclusion\ntrue?\n(three-valued)"}

    CONCR -->|"false"| CE["Counterexample\n(admissible + all supporting\ntrue + conclusion false)"]
    CONCR -->|"true/null"| NONCE2["Not a\ncounterexample"]

    subgraph Validity["Validity Check (all 2ⁿ assignments)"]
        direction LR
        VALID["No counterexamples\namong admissible\nassignments → Valid"]
    end

    CE --> Validity
    NONCE --> Validity
    NONCE2 --> Validity
    INADM --> Validity

    style FAIL fill:#ffebee,stroke:#f44336
    style CE fill:#ffebee,stroke:#f44336
    style NONCE fill:#e8f5e9,stroke:#4caf50
    style NONCE2 fill:#e8f5e9,stroke:#4caf50
    style INADM fill:#f5f5f5,stroke:#888
    style VALID fill:#e8f5e9,stroke:#4caf50
    style Validity fill:none,stroke:#888,stroke-dasharray: 5 5
`` `
```
````

- [ ] **Step 2: Verify the diagram renders**

Confirm:

- Left-to-right flow starting with Input
- Validation gate with early exit to `{ ok: false }`
- Constraint → admissible? → Supporting → all true? → Conclusion → true?
- Counterexample path highlighted red
- Non-counterexample paths highlighted green
- Validity subgraph at the end summarizes the overall check
- Three-valued annotations on each decision diamond

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add evaluation flow diagram to README"
```

---

### Task 5: Final verification

**Files:**

- Read: `README.md` (full file)

- [ ] **Step 1: Read the full README and verify section order**

Confirm the final structure matches the spec:

```
# proposit-core
  (opening paragraph)
  ## Visual Overview          ← Diagram 1
  ## Installation
  ## Concepts
    ### Argument
    ### Premises
    ### Variables
    ### Expressions
      (Diagram 2 inline)      ← Expression tree
    ### Argument roles
      (Diagram 3 inline)      ← Argument composition
    ### Sources
  ## Usage
    ### Evaluating an argument
      (Diagram 4 inline)      ← Evaluation flow
    ### Checking validity
  ...
```

- [ ] **Step 2: Run lint to check formatting**

```bash
pnpm run prettify && pnpm run lint
```

- [ ] **Step 3: Commit any formatting fixes**

```bash
git add README.md
git commit -m "docs: format README after diagram additions"
```
