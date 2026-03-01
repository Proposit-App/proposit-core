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

### Premise 1: P → Q

```bash
# Root: implies operator
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

### Inspect expressions

```bash
proposit-core <argument-id> latest expressions list <premise1-id>
proposit-core <argument-id> latest expressions list <premise1-id> --json
proposit-core <argument-id> latest expressions show <premise1-id> <root1-id>
```

---

## 6. Roles

Assign premises to logical roles. Premises 1 and 2 are supporting premises; premise 3 is the conclusion:

```bash
proposit-core <argument-id> latest roles add-support <premise1-id>
proposit-core <argument-id> latest roles add-support <premise2-id>
proposit-core <argument-id> latest roles set-conclusion <premise3-id>

proposit-core <argument-id> latest roles show
proposit-core <argument-id> latest roles show --json
```

To undo role assignments:

```bash
proposit-core <argument-id> latest roles remove-support <premise1-id>
proposit-core <argument-id> latest roles clear-conclusion
```

---

## 7. Render

Print all premises in one shot, with the conclusion marked by an asterisk:

```bash
proposit-core <argument-id> latest render
# → <premise3-id>*: (P → R)
# → <premise1-id>: (P → Q)
# → <premise2-id>: (Q → R)
```

Each line follows the pattern `<premise_id>[*]: <display_string>`. The asterisk appears only on the premise with the conclusion role.

---

## 8. Analysis

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

### Reject and accept expressions

Mark an expression as rejected (evaluates to `false`, children skipped) or restore it:

```bash
# Reject an expression (e.g. the root of premise 1)
proposit-core <argument-id> latest analysis reject <root1-id>
proposit-core <argument-id> latest analysis show

# Accept it again (restore normal computation)
proposit-core <argument-id> latest analysis accept <root1-id>

# Reject/accept on a specific analysis file
proposit-core <argument-id> latest analysis reject <root1-id> --file scenario-b.json
proposit-core <argument-id> latest analysis accept <root1-id> --file scenario-b.json
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

## 9. Publishing

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

## 10. Cleanup

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
proposit-core $ARG latest roles add-support $P1
proposit-core $ARG latest roles add-support $P2
proposit-core $ARG latest roles set-conclusion $P3

# ── Render ────────────────────────────────────────────────────────────────────
proposit-core $ARG latest render

# ── Analysis ──────────────────────────────────────────────────────────────────
proposit-core $ARG latest analysis validate-argument
proposit-core $ARG latest analysis create
proposit-core $ARG latest analysis evaluate --json
proposit-core $ARG latest analysis check-validity
```
