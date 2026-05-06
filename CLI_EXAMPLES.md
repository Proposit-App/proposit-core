# CLI Examples

A complete walkthrough of the `proposit-core` CLI, from creating an argument to checking its validity.

## Prerequisites

Build the project first:

```bash
pnpm run build
```

Then run commands using either form:

```bash
pnpm cli <args>                  # run from the local build
proposit-core <args>             # if installed globally
```

The examples below use `proposit-core` for brevity. Substitute `pnpm cli` when running from source.

Throughout these examples, angle-bracket placeholders like `<argument-id>` represent UUIDs returned by previous commands. Replace them with the actual values from your session.

---

## 1. Meta

```bash
proposit-core version
```

---

## 2. Arguments

### Create

`arguments create` returns the new argument's UUID on stdout:

```bash
proposit-core arguments create "Hypothetical Syllogism" "If P→Q and Q→R then P→R"
# → <argument-id>
```

### List

```bash
proposit-core arguments list
proposit-core arguments list --json
```

### Inspect a version

```bash
proposit-core <argument-id> latest show
proposit-core <argument-id> latest show --json
```

---

## 3. Variables

Register propositional variables for the argument. Each `variables create` call returns the new variable's UUID:

```bash
proposit-core <argument-id> latest variables create P
# → <p-id>

proposit-core <argument-id> latest variables create Q
# → <q-id>

proposit-core <argument-id> latest variables create R
# → <r-id>
```

List and inspect:

```bash
proposit-core <argument-id> latest variables list
proposit-core <argument-id> latest variables list --json
proposit-core <argument-id> latest variables show <p-id>
```

Rename a variable:

```bash
proposit-core <argument-id> latest variables update <p-id> --symbol "P_new"
proposit-core <argument-id> latest variables update <p-id> --symbol P     # rename back
```

---

## 4. Premises

Create empty premise shells (they hold expression trees, which you add next):

```bash
proposit-core <argument-id> latest premises create --title "P implies Q"
# → <premise1-id>

proposit-core <argument-id> latest premises create --title "Q implies R"
# → <premise2-id>

proposit-core <argument-id> latest premises create --title "P implies R"
# → <premise3-id>
```

List all premises:

```bash
proposit-core <argument-id> latest premises list
proposit-core <argument-id> latest premises list --json
```

---

## 5. Expressions

Each premise needs an expression tree. For an implication `A → B`, the tree is:

```
implies  (root, parentId=null)
├── A    (variable, position=0)
└── B    (variable, position=1)
```

`expressions create` returns the new expression's UUID.

When no `--position`, `--before`, or `--after` is specified, the expression is appended as the last child. For binary operators like `implies`, children at position 0 and 1 represent the antecedent and consequent respectively.

### Premise 1: P → Q

```bash
# Root: implies operator (appended as root — no parent specified)
proposit-core <argument-id> latest expressions create <premise1-id> \
  --type operator --operator implies
# → <root1-id>

# Left antecedent: variable P at position 0
proposit-core <argument-id> latest expressions create <premise1-id> \
  --type variable --variable-id <p-id> \
  --parent-id <root1-id> --position 0

# Right consequent: variable Q at position 1
proposit-core <argument-id> latest expressions create <premise1-id> \
  --type variable --variable-id <q-id> \
  --parent-id <root1-id> --position 1

# Verify
proposit-core <argument-id> latest premises render <premise1-id>
# → (P → Q)
```

### Premise 2: Q → R

```bash
proposit-core <argument-id> latest expressions create <premise2-id> \
  --type operator --operator implies
# → <root2-id>

proposit-core <argument-id> latest expressions create <premise2-id> \
  --type variable --variable-id <q-id> \
  --parent-id <root2-id> --position 0

proposit-core <argument-id> latest expressions create <premise2-id> \
  --type variable --variable-id <r-id> \
  --parent-id <root2-id> --position 1

proposit-core <argument-id> latest premises render <premise2-id>
# → (Q → R)
```

### Premise 3: P → R (the conclusion)

```bash
proposit-core <argument-id> latest expressions create <premise3-id> \
  --type operator --operator implies
# → <root3-id>

proposit-core <argument-id> latest expressions create <premise3-id> \
  --type variable --variable-id <p-id> \
  --parent-id <root3-id> --position 0

proposit-core <argument-id> latest expressions create <premise3-id> \
  --type variable --variable-id <r-id> \
  --parent-id <root3-id> --position 1

proposit-core <argument-id> latest premises render <premise3-id>
# → (P → R)
```

### Relative positioning

For non-binary operators (e.g. `and`, `or`), use `--before` and `--after` to insert children relative to existing siblings instead of specifying explicit positions:

```bash
# Append first child (auto-positioned)
proposit-core <argument-id> latest expressions create <premise-id> \
  --type variable --variable-id <p-id> \
  --parent-id <and-op-id>
# → <expr-p-id>

# Append second child (auto-positioned after first)
proposit-core <argument-id> latest expressions create <premise-id> \
  --type variable --variable-id <q-id> \
  --parent-id <and-op-id>
# → <expr-q-id>

# Insert a third child before P
proposit-core <argument-id> latest expressions create <premise-id> \
  --type variable --variable-id <r-id> \
  --before <expr-p-id>

# Insert a fourth child after Q
proposit-core <argument-id> latest expressions create <premise-id> \
  --type variable --variable-id <s-id> \
  --after <expr-q-id>
```

### Inspect expressions

```bash
proposit-core <argument-id> latest expressions list <premise1-id>
proposit-core <argument-id> latest expressions list <premise1-id> --json
proposit-core <argument-id> latest expressions show <premise1-id> <root1-id>
```

---

## 6. Roles

Assign the conclusion role. Supporting premises are derived automatically — any inference premise (root is `implies` or `iff`) that is not the conclusion is considered supporting.

```bash
proposit-core <argument-id> latest roles set-conclusion <premise3-id>

proposit-core <argument-id> latest roles show
proposit-core <argument-id> latest roles show --json
```

To clear the conclusion assignment:

```bash
proposit-core <argument-id> latest roles clear-conclusion
```

---

## 7. Claims and Citations

Claims are the global library of propositional content (separate from argument-scoped data). As of v0.10.0 every claim has an immutable `type` discriminator: `normal` (the default — primary-reasoning content) or `citation` (external/cited content; the unified replacement for the former separate `Source` entity).

Citations are directed edges between claims, stored in the global claim-citation graph. The source side of a citation must be a `type=citation` claim.

### Claims

```bash
# Create a normal claim (default type)
proposit-core claims add --title "It is raining" --body "Precipitation is currently occurring"
# → <claim-id>

# Create a citation claim (the v0.10.0 replacement for `sources add`)
proposit-core claims add --type=citation --title "Journal of Atmospheric Sciences, 2024" \
    --body "Smith et al., 'Patterns of urban precipitation', JAS 81(4), 2024"
# → <citation-claim-id>

# List all claims (citation-typed claims are tagged [citation])
proposit-core claims list

# Show versions of a claim
proposit-core claims show <claim-id>

# Update claim metadata (type is immutable — cannot be changed)
proposit-core claims update <claim-id> --title "New title" --body "New description"

# Freeze a claim version
proposit-core claims freeze <claim-id>
```

### Citations

```bash
# Cite a citation-typed claim from another claim
# (the source claim must have type=citation)
proposit-core citations add <citing-claim-id> <citation-claim-id>
# → <citation-edge-id>

# List all citation edges
proposit-core citations list
# → <citation-id> | <citingClaimId>@<v> -> <sourceClaimId>@<v>

# Show a single citation edge
proposit-core citations show <citation-id>
# → id:                  <citation-id>
# → citingClaimId:       <citingClaimId>
# → citingClaimVersion:  0
# → sourceClaimId:       <sourceClaimId>
# → sourceClaimVersion:  0

# Remove a citation edge
proposit-core citations unlink <citation-id>
```

---

## 7b. Derivation Premises

A **derivation premise** is structurally committed to deriving a specific named claim. It carries a `derivedClaimId` that never changes, and its expression tree is locked to either naked-Q form (no antecedent yet) or `IMPLIES(antecedent, Q)` / `IFF(antecedent, Q)` form.

The `populate-citations` command is the recommended way to build the antecedent automatically from the citation graph.

### Step 1: Create a citation claim (the external support)

```bash
proposit-core claims add --type=citation \
    --title "Smith et al., Journal of Atmospheric Sciences 2024"
# → <citation-claim-id>
```

### Step 2: Create the claim to be derived

```bash
proposit-core claims add --title "It is raining"
# → <normal-claim-id>
```

### Step 3: Add a citation edge (normal claim cites the citation claim as support)

```bash
proposit-core citations add <normal-claim-id> <citation-claim-id>
# → <citation-edge-id>
```

### Step 4: Create a derivation premise

```bash
proposit-core <argument-id> latest premises create \
    --type=derivation \
    --derived-claim=<normal-claim-id> \
    --title "Rain is supported"
# → <derivation-premise-id>
```

The premise is initialized to **naked-Q form** — a single variable expression referencing the consequent variable bound to `<normal-claim-id>`. Render it to confirm:

```bash
proposit-core <argument-id> latest premises render <derivation-premise-id>
# → [derivation] Q          (naked-Q: no antecedent yet)
```

### Step 5: Populate citations

`populate-citations` reads the current citations for the derived claim and builds the antecedent:

```bash
proposit-core <argument-id> latest premises populate-citations <derivation-premise-id>
```

Render again to see the result:

```bash
proposit-core <argument-id> latest premises render <derivation-premise-id>
# → [derivation] (S0 → Q)   (one citation: IMPLIES(S1, Q))
```

With two citations it would produce `[derivation] ((S0 ∨ S1) → Q)`.

### populate-citations rules

- **0 citations** — no change; premise stays in naked-Q form.
- **1 citation** — builds `IMPLIES(VariableS, Q)`.
- **≥ 2 citations** — builds `IMPLIES(OR(VariableS1, …, VariableSn), Q)`.
- The command is **one-shot**: it fails if the premise already has a non-empty antecedent. Delete and re-create the premise to repopulate.

### Rendering and listing derivation premises

Derivation premises are tagged `[derivation]` in all listing and rendering output, mirroring the `[citation]` convention for citation-typed claims:

```bash
proposit-core <argument-id> latest premises list
# → [derivation] <derivation-premise-id>  Rain is supported
# →              <premise-id>             P implies Q

proposit-core <argument-id> latest premises render <derivation-premise-id>
# → [derivation] (S0 → Q)
```

---

## 8. Render

Print the full argument with metadata:

```bash
proposit-core <argument-id> latest render
# → Argument: Hypothetical Syllogism — If P→Q and Q→R then P→R
# →
# → Premises:
# →   * (P → R) | P implies R
# →     (P → Q) | P implies Q
# →     (Q → R) | Q implies R
# →
# → Variables:
# →   P → <claim title>
# →   Q → <claim title>
# →   R → <claim title>
# →
# → Claims:
# →   <claim-id>@0 | title: ... | body: ...
```

The conclusion premise is marked with `*`. Each section includes any available metadata (title, body) from the basics extension.

---

## 8b. Graph (DOT / Graphviz)

Output the argument as a DOT directed graph:

```bash
proposit-core <argument-id> latest graph
# → digraph argument {
# →   compound=true;
# →   rankdir=TB;
# →   label="Hypothetical Syllogism";
# →   ...
# → }
```

Pipe to Graphviz to produce an image:

```bash
proposit-core <argument-id> latest graph | dot -Tsvg -o argument.svg
```

Overlay evaluation results from an analysis file:

```bash
proposit-core <argument-id> latest graph --analysis analysis.json
```

Expression nodes are colored by truth value (green/red/gray), operator-assigned expressions get double borders, and the graph subtitle shows the evaluation summary.

---

## 9. Analysis

### Validate the argument structure

Checks that the argument is well-formed and evaluable before running analysis:

```bash
proposit-core <argument-id> latest analysis validate-argument
proposit-core <argument-id> latest analysis validate-argument --json
```

### Create an analysis file

Creates `analysis.json` with all variables defaulting to `unset`:

```bash
proposit-core <argument-id> latest analysis create
```

Or specify a default value and/or a custom filename:

```bash
proposit-core <argument-id> latest analysis create --default false
proposit-core <argument-id> latest analysis create scenario-b.json
```

### View and modify assignments

```bash
proposit-core <argument-id> latest analysis show
proposit-core <argument-id> latest analysis show --json

# Assign specific truth values
proposit-core <argument-id> latest analysis set P true
proposit-core <argument-id> latest analysis set Q true
proposit-core <argument-id> latest analysis set R true

# Reset all to false
proposit-core <argument-id> latest analysis reset --value false

# Validate that the file matches the argument version
proposit-core <argument-id> latest analysis validate-assignments
```

### Set operator states

Set an operator expression to accepted (relationship holds), rejected (relationship doesn't hold), or unset (normal evaluation):

```bash
# Accept an operator (propagates constraints to unknown variables)
proposit-core <argument-id> latest analysis set-operator <operator-id> accepted

# Reject an operator (evaluates to false, children skipped)
proposit-core <argument-id> latest analysis set-operator <operator-id> rejected

# Clear an operator back to normal evaluation
proposit-core <argument-id> latest analysis set-operator <operator-id> unset

# Mass-set all operators
proposit-core <argument-id> latest analysis set-all-operators accepted
proposit-core <argument-id> latest analysis set-all-operators unset
```

### Evaluate a specific assignment

Runs the argument engine on the assignments in the analysis file:

```bash
proposit-core <argument-id> latest analysis evaluate
proposit-core <argument-id> latest analysis evaluate --json
```

### Check validity (truth-table search)

Enumerates all 2³ = 8 assignments and searches for counterexamples:

```bash
proposit-core <argument-id> latest analysis check-validity
proposit-core <argument-id> latest analysis check-validity --mode exhaustive
proposit-core <argument-id> latest analysis check-validity --json
```

The hypothetical syllogism argument is **valid** — no admissible assignment satisfies both supporting premises while falsifying the conclusion.

### Multiple analysis files

```bash
# Create a second analysis file to explore a specific assignment
proposit-core <argument-id> latest analysis create counterexample-attempt.json

proposit-core <argument-id> latest analysis set P true  --file counterexample-attempt.json
proposit-core <argument-id> latest analysis set Q false --file counterexample-attempt.json
proposit-core <argument-id> latest analysis set R false --file counterexample-attempt.json

proposit-core <argument-id> latest analysis evaluate    --file counterexample-attempt.json
proposit-core <argument-id> latest analysis list
```

### Inspect variable references across all premises

```bash
proposit-core <argument-id> latest analysis refs
proposit-core <argument-id> latest analysis refs --json
```

### Export the full engine state

```bash
proposit-core <argument-id> latest analysis export
```

---

## 10. Publishing

Publishing locks the current version and prepares a new draft:

```bash
proposit-core arguments publish <argument-id>
# Version 0 published, draft version 1 prepared

proposit-core <argument-id> 0 show        # published version (read-only)
proposit-core <argument-id> 1 show        # new draft
proposit-core <argument-id> latest show   # same as version 1 (current latest)
```

Any mutation command on a published version will exit with an error. All further edits happen on the new draft.

---

## 11. Cleanup

```bash
# Delete a single premise (prompts for confirmation)
proposit-core <argument-id> latest premises delete <premise1-id>

# Skip the confirmation prompt
proposit-core <argument-id> latest premises delete <premise1-id> --confirm

# Delete the argument's latest unpublished version
proposit-core arguments delete <argument-id>

# Delete all versions of an argument without a prompt
proposit-core arguments delete <argument-id> --all --confirm
```

---

## Version selectors

All version-scoped commands (`<id> <version> <command>`) accept three forms:

| Selector         | Meaning                   |
| ---------------- | ------------------------- |
| `latest`         | Highest version number    |
| `last-published` | Highest published version |
| `0`, `1`, `2`, … | Exact version number      |

```bash
proposit-core <argument-id> latest          show
proposit-core <argument-id> last-published  show
proposit-core <argument-id> 0               show
```

---

## Smoke test

A comprehensive smoke test script exercises every CLI command (including import, diff, insert, formula, cascade delete, and more) against an isolated temporary state directory:

```bash
pnpm run build
bash scripts/smoke-test.sh
```

The script uses `PROPOSIT_HOME` pointed at a `mktemp` directory so it never touches real data, and the directory is cleaned up on exit.

---

## Complete script

The full session above as a single runnable script (uses shell variables to pass IDs between commands):

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Argument ──────────────────────────────────────────────────────────────────
ARG=$(proposit-core arguments create "Hypothetical Syllogism" \
  "If P→Q and Q→R then P→R")
echo "ARG=$ARG"

# ── Variables ─────────────────────────────────────────────────────────────────
P=$(proposit-core $ARG latest variables create P)
Q=$(proposit-core $ARG latest variables create Q)
R=$(proposit-core $ARG latest variables create R)

# ── Premises ──────────────────────────────────────────────────────────────────
P1=$(proposit-core $ARG latest premises create --title "P implies Q")
P2=$(proposit-core $ARG latest premises create --title "Q implies R")
P3=$(proposit-core $ARG latest premises create --title "P implies R")

# ── Expressions: P → Q ────────────────────────────────────────────────────────
ROOT1=$(proposit-core $ARG latest expressions create $P1 --type operator --operator implies)
proposit-core $ARG latest expressions create $P1 --type variable --variable-id $P --parent-id $ROOT1 --position 0
proposit-core $ARG latest expressions create $P1 --type variable --variable-id $Q --parent-id $ROOT1 --position 1

# ── Expressions: Q → R ────────────────────────────────────────────────────────
ROOT2=$(proposit-core $ARG latest expressions create $P2 --type operator --operator implies)
proposit-core $ARG latest expressions create $P2 --type variable --variable-id $Q --parent-id $ROOT2 --position 0
proposit-core $ARG latest expressions create $P2 --type variable --variable-id $R --parent-id $ROOT2 --position 1

# ── Expressions: P → R ────────────────────────────────────────────────────────
ROOT3=$(proposit-core $ARG latest expressions create $P3 --type operator --operator implies)
proposit-core $ARG latest expressions create $P3 --type variable --variable-id $P --parent-id $ROOT3 --position 0
proposit-core $ARG latest expressions create $P3 --type variable --variable-id $R --parent-id $ROOT3 --position 1

# ── Roles ─────────────────────────────────────────────────────────────────────
# Supporting premises are derived automatically from expression type —
# only the conclusion needs explicit assignment.
proposit-core $ARG latest roles set-conclusion $P3

# ── Render ────────────────────────────────────────────────────────────────────
proposit-core $ARG latest render

# ── Graph (DOT) ────────────────────────────────────────────────────────────────────
proposit-core $ARG latest graph                          # DOT to stdout
proposit-core $ARG latest graph | dot -Tsvg -o arg.svg   # render to SVG
# ── Analysis ──────────────────────────────────────────────────────────────────
proposit-core $ARG latest analysis validate-argument
proposit-core $ARG latest analysis create
proposit-core $ARG latest analysis evaluate --json
proposit-core $ARG latest analysis check-validity

# ── Graph with evaluation overlay ────────────────────────────────────────────────────────────────────
proposit-core $ARG latest graph --analysis analysis.json
```
