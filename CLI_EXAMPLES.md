# CLI Examples

A complete walkthrough of the `proposit-core` CLI, from creating an argument to checking its validity. All commands can be copied and pasted into your terminal.

## Prerequisites

Build the project first:

```bash
pnpm run build
```

Then run commands using either form:

```bash
pnpm cli -- <args>      # run from the local build
proposit-core <args>             # if installed globally
```

The examples below use `proposit-core` for brevity. Substitute `pnpm cli --` when running from source.

---

## 1. Meta

```bash
proposit-core version
```

---

## 2. Arguments

### Create

`arguments create` returns the new argument's UUID on stdout, which you can capture directly:

```bash
ARG_ID=$(proposit-core arguments create "Hypothetical Syllogism" \
  "If P→Q and Q→R then P→R")

echo "Created: $ARG_ID"
```

### List

```bash
proposit-core arguments list
proposit-core arguments list --json
```

### Inspect a version

```bash
proposit-core $ARG_ID latest show
proposit-core $ARG_ID latest show --json
```

---

## 3. Variables

Register propositional variables for the argument. Each `variables create` call returns the new variable's UUID:

```bash
P_ID=$(proposit-core $ARG_ID latest variables create P)
Q_ID=$(proposit-core $ARG_ID latest variables create Q)
R_ID=$(proposit-core $ARG_ID latest variables create R)

echo "P=$P_ID  Q=$Q_ID  R=$R_ID"
```

List and inspect:

```bash
proposit-core $ARG_ID latest variables list
proposit-core $ARG_ID latest variables list --json
proposit-core $ARG_ID latest variables show $P_ID
```

Rename a variable:

```bash
proposit-core $ARG_ID latest variables update $P_ID --symbol "P_new"
proposit-core $ARG_ID latest variables update $P_ID --symbol P     # rename back
```

---

## 4. Premises

Create empty premise shells (they hold expression trees, which you add next):

```bash
P1_ID=$(proposit-core $ARG_ID latest premises create --title "P implies Q")
P2_ID=$(proposit-core $ARG_ID latest premises create --title "Q implies R")
P3_ID=$(proposit-core $ARG_ID latest premises create --title "P implies R")

echo "Premises: $P1_ID  $P2_ID  $P3_ID"
```

List all premises:

```bash
proposit-core $ARG_ID latest premises list
proposit-core $ARG_ID latest premises list --json
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

### Premise 1: P → Q

```bash
# Root: implies operator
ROOT1=$(proposit-core $ARG_ID latest expressions create $P1_ID \
  --type operator --operator implies)

# Left antecedent: variable P at position 0
proposit-core $ARG_ID latest expressions create $P1_ID \
  --type variable --variable-id $P_ID \
  --parent-id $ROOT1 --position 0

# Right consequent: variable Q at position 1
proposit-core $ARG_ID latest expressions create $P1_ID \
  --type variable --variable-id $Q_ID \
  --parent-id $ROOT1 --position 1

# Verify
proposit-core $ARG_ID latest premises render $P1_ID
# → P → Q
```

### Premise 2: Q → R

```bash
ROOT2=$(proposit-core $ARG_ID latest expressions create $P2_ID \
  --type operator --operator implies)

proposit-core $ARG_ID latest expressions create $P2_ID \
  --type variable --variable-id $Q_ID \
  --parent-id $ROOT2 --position 0

proposit-core $ARG_ID latest expressions create $P2_ID \
  --type variable --variable-id $R_ID \
  --parent-id $ROOT2 --position 1

proposit-core $ARG_ID latest premises render $P2_ID
# → Q → R
```

### Premise 3: P → R (the conclusion)

```bash
ROOT3=$(proposit-core $ARG_ID latest expressions create $P3_ID \
  --type operator --operator implies)

proposit-core $ARG_ID latest expressions create $P3_ID \
  --type variable --variable-id $P_ID \
  --parent-id $ROOT3 --position 0

proposit-core $ARG_ID latest expressions create $P3_ID \
  --type variable --variable-id $R_ID \
  --parent-id $ROOT3 --position 1

proposit-core $ARG_ID latest premises render $P3_ID
# → P → R
```

### Inspect expressions

```bash
proposit-core $ARG_ID latest expressions list $P1_ID
proposit-core $ARG_ID latest expressions list $P1_ID --json
proposit-core $ARG_ID latest expressions show $P1_ID $ROOT1
```

---

## 6. Roles

Assign premises to logical roles. P1 and P2 are supporting premises; P3 is the conclusion:

```bash
proposit-core $ARG_ID latest roles add-support $P1_ID
proposit-core $ARG_ID latest roles add-support $P2_ID
proposit-core $ARG_ID latest roles set-conclusion $P3_ID

proposit-core $ARG_ID latest roles show
proposit-core $ARG_ID latest roles show --json
```

To undo role assignments:

```bash
proposit-core $ARG_ID latest roles remove-support $P1_ID
proposit-core $ARG_ID latest roles clear-conclusion
```

---

## 7. Render

Print all premises in one shot, with the conclusion marked by an asterisk:

```bash
proposit-core $ARG_ID latest render
# → <P3_ID>*: (P → R)
# → <P1_ID>: (P → Q)
# → <P2_ID>: (Q → R)
```

Each line follows the pattern `<premise_id>[*]: <display_string>`. The asterisk appears only on the premise with the conclusion role.

---

## 8. Analysis

### Validate the argument structure

Checks that the argument is well-formed and evaluable before running analysis:

```bash
proposit-core $ARG_ID latest analysis validate-argument
proposit-core $ARG_ID latest analysis validate-argument --json
```

### Create an analysis file

Creates `analysis.json` with all variables defaulting to `true`:

```bash
proposit-core $ARG_ID latest analysis create
```

Or specify a default value and/or a custom filename:

```bash
proposit-core $ARG_ID latest analysis create --default false
proposit-core $ARG_ID latest analysis create scenario-b.json
```

### View and modify assignments

```bash
proposit-core $ARG_ID latest analysis show
proposit-core $ARG_ID latest analysis show --json

# Assign specific truth values
proposit-core $ARG_ID latest analysis set P true
proposit-core $ARG_ID latest analysis set Q true
proposit-core $ARG_ID latest analysis set R true

# Reset all to false
proposit-core $ARG_ID latest analysis reset --value false

# Validate that the file matches the argument version
proposit-core $ARG_ID latest analysis validate-assignments
```

### Reject and accept expressions

Mark an expression as rejected (evaluates to `false`, children skipped) or restore it:

```bash
# Reject an expression (e.g. the root of premise 1)
proposit-core $ARG_ID latest analysis reject $ROOT1
proposit-core $ARG_ID latest analysis show

# Accept it again (restore normal computation)
proposit-core $ARG_ID latest analysis accept $ROOT1

# Reject/accept on a specific analysis file
proposit-core $ARG_ID latest analysis reject $ROOT1 --file scenario-b.json
proposit-core $ARG_ID latest analysis accept $ROOT1 --file scenario-b.json
```

### Evaluate a specific assignment

Runs the argument engine on the assignments in the analysis file:

```bash
proposit-core $ARG_ID latest analysis evaluate
proposit-core $ARG_ID latest analysis evaluate --json
```

### Check validity (truth-table search)

Enumerates all 2³ = 8 assignments and searches for counterexamples:

```bash
proposit-core $ARG_ID latest analysis check-validity
proposit-core $ARG_ID latest analysis check-validity --mode exhaustive
proposit-core $ARG_ID latest analysis check-validity --json
```

The hypothetical syllogism argument is **valid** — no admissible assignment satisfies both supporting premises while falsifying the conclusion.

### Multiple analysis files

```bash
# Create a second analysis file to explore a specific assignment
proposit-core $ARG_ID latest analysis create counterexample-attempt.json

proposit-core $ARG_ID latest analysis set P true  --file counterexample-attempt.json
proposit-core $ARG_ID latest analysis set Q false --file counterexample-attempt.json
proposit-core $ARG_ID latest analysis set R false --file counterexample-attempt.json

proposit-core $ARG_ID latest analysis evaluate    --file counterexample-attempt.json
proposit-core $ARG_ID latest analysis list
```

### Inspect variable references across all premises

```bash
proposit-core $ARG_ID latest analysis refs
proposit-core $ARG_ID latest analysis refs --json
```

### Export the full engine state

```bash
proposit-core $ARG_ID latest analysis export
```

---

## 9. Publishing

Publishing locks the current version and prepares a new draft:

```bash
proposit-core arguments publish $ARG_ID
# Version 0 published, draft version 1 prepared

proposit-core $ARG_ID 0 show        # published version (read-only)
proposit-core $ARG_ID 1 show        # new draft
proposit-core $ARG_ID latest show   # same as version 1 (current latest)
```

Any mutation command on a published version will exit with an error. All further edits happen on the new draft.

---

## 10. Cleanup

```bash
# Delete a single premise (prompts for confirmation)
proposit-core $ARG_ID latest premises delete $P1_ID

# Skip the confirmation prompt
proposit-core $ARG_ID latest premises delete $P1_ID --confirm

# Delete the argument's latest unpublished version
proposit-core arguments delete $ARG_ID

# Delete all versions of an argument without a prompt
proposit-core arguments delete $ARG_ID --all --confirm
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
proposit-core $ARG_ID latest          show
proposit-core $ARG_ID last-published  show
proposit-core $ARG_ID 0               show
```

---

## Complete script

The full session above as a single runnable script:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Argument ──────────────────────────────────────────────────────────────────
ARG_ID=$(proposit-core arguments create "Hypothetical Syllogism" \
  "If P→Q and Q→R then P→R")
echo "ARG_ID=$ARG_ID"

# ── Variables ─────────────────────────────────────────────────────────────────
P_ID=$(proposit-core $ARG_ID latest variables create P)
Q_ID=$(proposit-core $ARG_ID latest variables create Q)
R_ID=$(proposit-core $ARG_ID latest variables create R)

# ── Premises ──────────────────────────────────────────────────────────────────
P1_ID=$(proposit-core $ARG_ID latest premises create --title "P implies Q")
P2_ID=$(proposit-core $ARG_ID latest premises create --title "Q implies R")
P3_ID=$(proposit-core $ARG_ID latest premises create --title "P implies R")

# ── Expressions: P → Q ────────────────────────────────────────────────────────
ROOT1=$(proposit-core $ARG_ID latest expressions create $P1_ID --type operator --operator implies)
proposit-core $ARG_ID latest expressions create $P1_ID --type variable --variable-id $P_ID --parent-id $ROOT1 --position 0
proposit-core $ARG_ID latest expressions create $P1_ID --type variable --variable-id $Q_ID --parent-id $ROOT1 --position 1

# ── Expressions: Q → R ────────────────────────────────────────────────────────
ROOT2=$(proposit-core $ARG_ID latest expressions create $P2_ID --type operator --operator implies)
proposit-core $ARG_ID latest expressions create $P2_ID --type variable --variable-id $Q_ID --parent-id $ROOT2 --position 0
proposit-core $ARG_ID latest expressions create $P2_ID --type variable --variable-id $R_ID --parent-id $ROOT2 --position 1

# ── Expressions: P → R ────────────────────────────────────────────────────────
ROOT3=$(proposit-core $ARG_ID latest expressions create $P3_ID --type operator --operator implies)
proposit-core $ARG_ID latest expressions create $P3_ID --type variable --variable-id $P_ID --parent-id $ROOT3 --position 0
proposit-core $ARG_ID latest expressions create $P3_ID --type variable --variable-id $R_ID --parent-id $ROOT3 --position 1

# ── Roles ─────────────────────────────────────────────────────────────────────
proposit-core $ARG_ID latest roles add-support $P1_ID
proposit-core $ARG_ID latest roles add-support $P2_ID
proposit-core $ARG_ID latest roles set-conclusion $P3_ID

# ── Render ────────────────────────────────────────────────────────────────────
proposit-core $ARG_ID latest render

# ── Analysis ──────────────────────────────────────────────────────────────────
proposit-core $ARG_ID latest analysis validate-argument
proposit-core $ARG_ID latest analysis create
proposit-core $ARG_ID latest analysis evaluate --json
proposit-core $ARG_ID latest analysis check-validity
```
