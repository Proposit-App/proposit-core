#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# proposit-core CLI smoke test
#
# Builds a "Rain Chain" argument from scratch, exercises every CLI command,
# then cleans up. Uses an isolated PROPOSIT_HOME so it never touches real data.
#
# Usage:
#   pnpm run build && bash scripts/smoke-test.sh
#
# The script uses `set -euo pipefail` — any command failure aborts immediately.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Resolve the CLI binary ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="node $PROJECT_DIR/dist/cli.js"

# ── Isolated state directory ─────────────────────────────────────────────────
export PROPOSIT_HOME
PROPOSIT_HOME="$(mktemp -d)"
trap 'rm -rf "$PROPOSIT_HOME"' EXIT
echo "PROPOSIT_HOME=$PROPOSIT_HOME"

# Helper: print a section header
section() { printf "\n══ %s ══\n" "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
# 1. META
# ─────────────────────────────────────────────────────────────────────────────
section "1. version"
$CLI version

# ─────────────────────────────────────────────────────────────────────────────
# 2. ARGUMENTS — create, list, show
# ─────────────────────────────────────────────────────────────────────────────
section "2. arguments create / list"
ARG=$($CLI arguments create "Rain Chain" "If it rains the streets are wet; if wet then slippery; therefore rain implies slippery")
echo "ARG=$ARG"

$CLI arguments list
$CLI arguments list --json

$CLI "$ARG" latest show
$CLI "$ARG" latest show --json

# ─────────────────────────────────────────────────────────────────────────────
# 3. VARIABLES — create, list, show, update
# ─────────────────────────────────────────────────────────────────────────────
section "3. variables"
R=$($CLI "$ARG" latest variables create R)
W=$($CLI "$ARG" latest variables create W)
S=$($CLI "$ARG" latest variables create S)
echo "R=$R  W=$W  S=$S"

# Create an extra variable that will be unused (for list-unused / delete-unused)
T=$($CLI "$ARG" latest variables create T)
echo "T=$T (will be unused)"

$CLI "$ARG" latest variables list
$CLI "$ARG" latest variables list --json
$CLI "$ARG" latest variables show "$R"
$CLI "$ARG" latest variables show "$R" --json

# Rename T → Temp, then back to T
$CLI "$ARG" latest variables update "$T" --symbol Temp
$CLI "$ARG" latest variables show "$T"
$CLI "$ARG" latest variables update "$T" --symbol T

# list-unused should show T (not referenced by any expression yet)
echo "--- unused variables (expect T) ---"
$CLI "$ARG" latest variables list-unused
$CLI "$ARG" latest variables list-unused --json

# ─────────────────────────────────────────────────────────────────────────────
# 4. PREMISES — create, list, show, update, render
# ─────────────────────────────────────────────────────────────────────────────
section "4. premises"
P1=$($CLI "$ARG" latest premises create --title "Rain implies wet streets")
P2=$($CLI "$ARG" latest premises create --title "Wet streets implies slippery")
P3=$($CLI "$ARG" latest premises create --title "Rain implies slippery")
# Extra premise we will delete later
P4=$($CLI "$ARG" latest premises create --title "Temporary premise")
echo "P1=$P1  P2=$P2  P3=$P3  P4=$P4"

$CLI "$ARG" latest premises list
$CLI "$ARG" latest premises list --json
$CLI "$ARG" latest premises show "$P1"
$CLI "$ARG" latest premises show "$P1" --json

# Update title, clear title, set title again
$CLI "$ARG" latest premises update "$P4" --title "Updated title"
$CLI "$ARG" latest premises show "$P4"
$CLI "$ARG" latest premises update "$P4" --clear-title
$CLI "$ARG" latest premises show "$P4"

# ─────────────────────────────────────────────────────────────────────────────
# 5. EXPRESSIONS — create (various positioning), list, show
# ─────────────────────────────────────────────────────────────────────────────
section "5. expressions — build P1: (R → W)"

# P1: R → W (using explicit positions)
ROOT1=$($CLI "$ARG" latest expressions create "$P1" \
  --type operator --operator implies)
echo "ROOT1=$ROOT1"
EXPR_R1=$($CLI "$ARG" latest expressions create "$P1" \
  --type variable --variable-id "$R" \
  --parent-id "$ROOT1" --position 0)
EXPR_W1=$($CLI "$ARG" latest expressions create "$P1" \
  --type variable --variable-id "$W" \
  --parent-id "$ROOT1" --position 1)
echo "EXPR_R1=$EXPR_R1  EXPR_W1=$EXPR_W1"

$CLI "$ARG" latest premises render "$P1"
$CLI "$ARG" latest expressions list "$P1"
$CLI "$ARG" latest expressions list "$P1" --json
$CLI "$ARG" latest expressions show "$P1" "$ROOT1"
$CLI "$ARG" latest expressions show "$P1" "$ROOT1" --json

section "5b. expressions — build P2: (W → S)"

# P2: W → S (binary operators need children at positions 0 and 1)
ROOT2=$($CLI "$ARG" latest expressions create "$P2" \
  --type operator --operator implies)
$CLI "$ARG" latest expressions create "$P2" \
  --type variable --variable-id "$W" \
  --parent-id "$ROOT2" --position 0
$CLI "$ARG" latest expressions create "$P2" \
  --type variable --variable-id "$S" \
  --parent-id "$ROOT2" --position 1

$CLI "$ARG" latest premises render "$P2"

section "5c. expressions — build P3: (R → S)"

# P3: R → S (conclusion)
ROOT3=$($CLI "$ARG" latest expressions create "$P3" \
  --type operator --operator implies)
EXPR_R3=$($CLI "$ARG" latest expressions create "$P3" \
  --type variable --variable-id "$R" \
  --parent-id "$ROOT3" --position 0)
$CLI "$ARG" latest expressions create "$P3" \
  --type variable --variable-id "$S" \
  --parent-id "$ROOT3" --position 1

$CLI "$ARG" latest premises render "$P3"

# ─────────────────────────────────────────────────────────────────────────────
# 5d. EXPRESSIONS — insert (wrap existing nodes with a new operator)
# ─────────────────────────────────────────────────────────────────────────────
section "5d. expressions — insert: extend P1 from (R → W) to ((R ∧ T) → W)"

# Insert an AND operator wrapping R (it inherits R's slot under implies)
AND_OP=$($CLI "$ARG" latest expressions insert "$P1" \
  --type operator --operator and \
  --left-node-id "$EXPR_R1")
echo "AND_OP=$AND_OP"

# Now add T as the second child of AND
EXPR_T1=$($CLI "$ARG" latest expressions create "$P1" \
  --type variable --variable-id "$T" \
  --parent-id "$AND_OP")

echo "P1 after insert:"
$CLI "$ARG" latest premises render "$P1"
# Expected: ((R ∧ T) → W)

# ─────────────────────────────────────────────────────────────────────────────
# 5e. EXPRESSIONS — delete (remove T, triggers operator collapse)
# ─────────────────────────────────────────────────────────────────────────────
section "5e. expressions — delete T from AND (triggers collapse)"

$CLI "$ARG" latest expressions delete "$P1" "$EXPR_T1"

echo "P1 after removing T (AND collapsed):"
$CLI "$ARG" latest premises render "$P1"
# Expected: (R → W) — the AND was collapsed since only R remained

# ─────────────────────────────────────────────────────────────────────────────
# 5f. EXPRESSIONS — relative positioning (--before / --after)
# ─────────────────────────────────────────────────────────────────────────────
section "5f. expressions — relative positioning on P4"

# Build an AND with three children using --before and --after
AND4=$($CLI "$ARG" latest expressions create "$P4" \
  --type operator --operator and)

# Append first child (R)
EXPR_R4=$($CLI "$ARG" latest expressions create "$P4" \
  --type variable --variable-id "$R" \
  --parent-id "$AND4")

# Append second child (S) — auto-appended after R
EXPR_S4=$($CLI "$ARG" latest expressions create "$P4" \
  --type variable --variable-id "$S" \
  --parent-id "$AND4")

# Insert W before S (so order is R, W, S)
$CLI "$ARG" latest expressions create "$P4" \
  --type variable --variable-id "$W" \
  --before "$EXPR_S4"

# Insert T after S (so order is R, W, S, T)
$CLI "$ARG" latest expressions create "$P4" \
  --type variable --variable-id "$T" \
  --after "$EXPR_S4"

echo "P4 with relative positioning:"
$CLI "$ARG" latest premises render "$P4"
# Expected: (R ∧ W ∧ S ∧ T)

# ─────────────────────────────────────────────────────────────────────────────
# 5g. EXPRESSIONS — formula wrapper
# ─────────────────────────────────────────────────────────────────────────────
section "5g. expressions — formula wrapper on P4"

# Wrap R in a formula (parentheses) node via insert
FORMULA=$($CLI "$ARG" latest expressions insert "$P4" \
  --type formula \
  --left-node-id "$EXPR_R4")
echo "FORMULA=$FORMULA"

echo "P4 after wrapping R in formula:"
$CLI "$ARG" latest premises render "$P4"

# ─────────────────────────────────────────────────────────────────────────────
# 6. PREMISES — delete P4 (cleanup the temporary premise)
# ─────────────────────────────────────────────────────────────────────────────
section "6. premises delete"
$CLI "$ARG" latest premises delete "$P4" --confirm
echo "P4 deleted"

$CLI "$ARG" latest premises list

# ─────────────────────────────────────────────────────────────────────────────
# 6b. VARIABLES — delete-unused (T is now unreferenced)
# ─────────────────────────────────────────────────────────────────────────────
section "6b. variables — delete-unused"
echo "--- unused variables (expect T) ---"
$CLI "$ARG" latest variables list-unused

$CLI "$ARG" latest variables delete-unused --confirm --json
$CLI "$ARG" latest variables list

# ─────────────────────────────────────────────────────────────────────────────
# 7. ROLES — set-conclusion, show, clear-conclusion
# ─────────────────────────────────────────────────────────────────────────────
section "7. roles"
$CLI "$ARG" latest roles show
$CLI "$ARG" latest roles set-conclusion "$P3"
$CLI "$ARG" latest roles show
$CLI "$ARG" latest roles show --json

# Demonstrate clear-conclusion then re-set
$CLI "$ARG" latest roles clear-conclusion
$CLI "$ARG" latest roles show
$CLI "$ARG" latest roles set-conclusion "$P3"

# ─────────────────────────────────────────────────────────────────────────────
# 8. RENDER — full argument
# ─────────────────────────────────────────────────────────────────────────────
section "8. render (full argument)"
$CLI "$ARG" latest render

# ─────────────────────────────────────────────────────────────────────────────
# 9. ANALYSIS — validate-argument, create, show, set, reset, reject, accept,
#    validate-assignments, evaluate, check-validity, refs, export, delete
# ─────────────────────────────────────────────────────────────────────────────
section "9a. analysis — validate-argument"
$CLI "$ARG" latest analysis validate-argument
$CLI "$ARG" latest analysis validate-argument --json

section "9b. analysis — create and show"
$CLI "$ARG" latest analysis create
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis show --json

section "9c. analysis — set variable assignments"
$CLI "$ARG" latest analysis set R true
$CLI "$ARG" latest analysis set W true
$CLI "$ARG" latest analysis set S true
$CLI "$ARG" latest analysis show

section "9d. analysis — validate-assignments"
$CLI "$ARG" latest analysis validate-assignments
$CLI "$ARG" latest analysis validate-assignments --json

section "9e. analysis — evaluate"
$CLI "$ARG" latest analysis evaluate
$CLI "$ARG" latest analysis evaluate --json

section "9f. analysis — reset all to false and re-evaluate"
$CLI "$ARG" latest analysis reset --value false
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis evaluate

section "9g. analysis — reject and accept an expression"
$CLI "$ARG" latest analysis reject "$ROOT1"
$CLI "$ARG" latest analysis show
$CLI "$ARG" latest analysis evaluate
$CLI "$ARG" latest analysis accept "$ROOT1"

section "9h. analysis — check-validity (first-counterexample)"
$CLI "$ARG" latest analysis check-validity
$CLI "$ARG" latest analysis check-validity --json

section "9i. analysis — check-validity (exhaustive)"
$CLI "$ARG" latest analysis check-validity --mode exhaustive
$CLI "$ARG" latest analysis check-validity --mode exhaustive --json

section "9j. analysis — multiple analysis files"
$CLI "$ARG" latest analysis create scenario-b.json --default false
$CLI "$ARG" latest analysis set R true  --file scenario-b.json
$CLI "$ARG" latest analysis set W false --file scenario-b.json
$CLI "$ARG" latest analysis set S false --file scenario-b.json
$CLI "$ARG" latest analysis show --file scenario-b.json
$CLI "$ARG" latest analysis evaluate --file scenario-b.json --json
$CLI "$ARG" latest analysis list
$CLI "$ARG" latest analysis list --json

section "9k. analysis — refs and export"
$CLI "$ARG" latest analysis refs
$CLI "$ARG" latest analysis refs --json
$CLI "$ARG" latest analysis export

section "9l. analysis — delete"
$CLI "$ARG" latest analysis delete --file scenario-b.json --confirm
$CLI "$ARG" latest analysis list

# ─────────────────────────────────────────────────────────────────────────────
# 9m. CLAIMS — add, update, list, show, freeze
# ─────────────────────────────────────────────────────────────────────────────
section "9m. claims"
CLAIM1=$($CLI claims add --title "It rains" --body "Precipitation is occurring")
echo "CLAIM1=$CLAIM1"

$CLI claims list
$CLI claims list --json

$CLI claims show "$CLAIM1"
$CLI claims show "$CLAIM1" --json

$CLI claims update "$CLAIM1" --title "Rain occurs" --body "Precipitation is actively occurring"
$CLI claims show "$CLAIM1"

$CLI claims freeze "$CLAIM1"
$CLI claims show "$CLAIM1"

# ─────────────────────────────────────────────────────────────────────────────
# 9n. SOURCES — add, list, show, link-claim, unlink
# ─────────────────────────────────────────────────────────────────────────────
section "9n. sources"
SRC1=$($CLI sources add --text "Journal of Atmospheric Sciences, 2024")
echo "SRC1=$SRC1"

$CLI sources list
$CLI sources list --json
$CLI sources show "$SRC1"
$CLI sources show "$SRC1" --json

# Link the source to the claim (use the frozen version: v0)
ASSOC=$($CLI sources link-claim "$SRC1" "$CLAIM1")
echo "ASSOC=$ASSOC"

# Unlink
$CLI sources unlink "$ASSOC"

# ─────────────────────────────────────────────────────────────────────────────
# 10. PUBLISH and VERSION SELECTORS
# ─────────────────────────────────────────────────────────────────────────────
section "10. publish and version selectors"
$CLI arguments publish "$ARG"
$CLI "$ARG" 0 show
$CLI "$ARG" latest show
$CLI "$ARG" last-published show

# ─────────────────────────────────────────────────────────────────────────────
# 11. DIFF — compare published v0 with draft v1 (identical at this point)
# ─────────────────────────────────────────────────────────────────────────────
section "11a. diff (same-argument, two versions)"

# Modify draft v1 so there is something to diff: rename R → Rain
$CLI "$ARG" latest variables update "$R" --symbol Rain

$CLI diff "$ARG" 0 1
$CLI diff "$ARG" 0 1 --json

# Revert rename for consistency
$CLI "$ARG" latest variables update "$R" --symbol R

section "11b. diff (cross-argument)"

# Create a second argument with a complex premise: (R ∧ W) → S
ARG2=$($CLI arguments create "Another Rain Chain" "Variant with compound antecedent")
R2=$($CLI "$ARG2" latest variables create R)
W2=$($CLI "$ARG2" latest variables create W)
S2=$($CLI "$ARG2" latest variables create S)
P2_1=$($CLI "$ARG2" latest premises create --title "Rain and wet implies slippery")

# Build: (R ∧ W) → S — manually constructing a complex antecedent
ROOT2_1=$($CLI "$ARG2" latest expressions create "$P2_1" \
  --type operator --operator implies)
AND2_1=$($CLI "$ARG2" latest expressions create "$P2_1" \
  --type operator --operator and \
  --parent-id "$ROOT2_1" --position 0)
$CLI "$ARG2" latest expressions create "$P2_1" \
  --type variable --variable-id "$R2" --parent-id "$AND2_1" --position 0
$CLI "$ARG2" latest expressions create "$P2_1" \
  --type variable --variable-id "$W2" --parent-id "$AND2_1" --position 1
$CLI "$ARG2" latest expressions create "$P2_1" \
  --type variable --variable-id "$S2" --parent-id "$ROOT2_1" --position 1

echo "ARG2 P2_1 (complex antecedent):"
$CLI "$ARG2" latest premises render "$P2_1"
# Expected: ((R ∧ W) → S)

$CLI diff "$ARG" 0 "$ARG2" latest

# ─────────────────────────────────────────────────────────────────────────────
# 12. IMPORT — import an argument from YAML
# ─────────────────────────────────────────────────────────────────────────────
section "12. import from YAML"

# Create a temporary YAML file
YAML_FILE="$PROPOSIT_HOME/test-import.yaml"
cat > "$YAML_FILE" <<'YAML'
metadata:
    title: "Modus Ponens"
    description: "Classic deductive argument: P, P -> Q, therefore Q"
premises:
    - metadata:
          title: "P is true"
      formula: "P"
    - metadata:
          title: "P implies Q"
      formula: "P -> Q"
    - metadata:
          title: "Q follows"
      role: "conclusion"
      formula: "Q"
YAML

ARG3=$($CLI arguments import "$YAML_FILE")
echo "Imported ARG3=$ARG3"

$CLI "$ARG3" latest render
$CLI "$ARG3" latest analysis validate-argument
$CLI "$ARG3" latest analysis check-validity

section "12b. import from YAML — complex formulae"

# Create a YAML file with complex antecedents and consequents
YAML_COMPLEX="$PROPOSIT_HOME/test-import-complex.yaml"
cat > "$YAML_COMPLEX" <<'YAML'
metadata:
    title: "Weather Hazard Argument"
    description: "Complex argument with compound antecedents and consequents"
premises:
    - metadata:
          title: "Weather conditions imply wet roads"
      formula: "((Rain && Wind) || Storm) -> WetRoads"
    - metadata:
          title: "Wet roads with traffic issues imply danger"
      formula: "(WetRoads && (HeavyTraffic || Construction)) -> Danger"
    - metadata:
          title: "Severe weather implies reduced visibility"
      formula: "(Storm && !Daylight) -> (LowVisibility && SlowTraffic)"
    - metadata:
          title: "Weather plus traffic implies danger"
      role: "conclusion"
      formula: "((Rain && Wind) || Storm) -> Danger"
YAML

ARG4=$($CLI arguments import "$YAML_COMPLEX")
echo "Imported ARG4=$ARG4"

$CLI "$ARG4" latest render
$CLI "$ARG4" latest analysis validate-argument

# Evaluate with an assignment
$CLI "$ARG4" latest analysis create --default false
$CLI "$ARG4" latest analysis set Rain true
$CLI "$ARG4" latest analysis set Wind true
$CLI "$ARG4" latest analysis set Storm false
$CLI "$ARG4" latest analysis set WetRoads true
$CLI "$ARG4" latest analysis set HeavyTraffic true
$CLI "$ARG4" latest analysis set Construction false
$CLI "$ARG4" latest analysis set Danger true
$CLI "$ARG4" latest analysis set Daylight true
$CLI "$ARG4" latest analysis set LowVisibility false
$CLI "$ARG4" latest analysis set SlowTraffic false
$CLI "$ARG4" latest analysis evaluate
$CLI "$ARG4" latest analysis check-validity

# ─────────────────────────────────────────────────────────────────────────────
# 13. VARIABLE CASCADE DELETE
# ─────────────────────────────────────────────────────────────────────────────
section "13. variable cascade delete"

# On ARG2, deleting variable S2 should cascade-delete any referencing expressions
echo "Before delete — ARG2 variables:"
$CLI "$ARG2" latest variables list

$CLI "$ARG2" latest variables delete "$S2"

echo "After deleting S2:"
$CLI "$ARG2" latest variables list

# ─────────────────────────────────────────────────────────────────────────────
# 14. CLEANUP — delete arguments
# ─────────────────────────────────────────────────────────────────────────────
section "14. cleanup"
$CLI arguments delete "$ARG2" --all --confirm
$CLI arguments delete "$ARG3" --all --confirm
$CLI arguments delete "$ARG4" --all --confirm

# Delete ARG: has two versions (published v0 + draft v1)
# First delete just the latest draft
$CLI arguments delete "$ARG" --confirm
# Then delete the remaining version
$CLI arguments delete "$ARG" --all --confirm

$CLI arguments list
echo ""
echo "All arguments cleaned up."

# ─────────────────────────────────────────────────────────────────────────────
section "SMOKE TEST PASSED"
echo "All CLI features exercised successfully."
