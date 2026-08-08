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

## 7. Claims, Citations, and Axioms

Claims are the global library of propositional content (separate from argument-scoped data). Every claim has an immutable `type` discriminator: `normal` (the default — primary-reasoning content), `citation` (external/cited content; the unified replacement for the former separate `Source` entity, added in v0.10.0), or `axiomatic` (self-evident invoked propositions, added in v0.12.0).

Two parallel **connection libraries** track the support edges between claims:

- **Citations** — directed connections from a claim to a `type=citation` supporting claim, stored in the global claim-citation graph. Cycle detection runs on `add`.
- **Axioms** (v0.12.0) — directed connections from a `type=normal` claim to a `type=axiomatic` supporting claim. No cycle detection is needed because axiomatic claims cannot appear on the dependent side.

### Claims

```bash
# Create a normal claim (default type)
proposit-core claims add --title "It is raining" --body "Precipitation is currently occurring"
# → <claim-id>

# Create a citation claim (the v0.10.0 replacement for `sources add`)
proposit-core claims add --type=citation --title "Journal of Atmospheric Sciences, 2024" \
    --body "Smith et al., 'Patterns of urban precipitation', JAS 81(4), 2024"
# → <citation-claim-id>

# List all claims (citations tagged [citation]; axiomatic tagged [axiom: <reasonCode>])
proposit-core claims list

# Show versions of a claim
proposit-core claims show <claim-id>

# Update claim metadata (type and reasonCode are immutable — cannot be changed)
proposit-core claims update <claim-id> --title "New title" --body "New description"

# Freeze a claim version
proposit-core claims freeze <claim-id>
```

### Citations

> **Breaking change in v0.12.0.** The `citations` command group switched from positional arguments + `unlink` to flag arguments + `remove`. Update scripts that used `citations add <citing> <source>` or `citations unlink <id>` to the flag form below.

```bash
# Cite a citation-typed claim as supporting another claim
# (the supporting claim must have type=citation)
proposit-core citations add \
    --claim-id <claim-id> \
    --supporting-claim-id <citation-claim-id>
# → <citation-connection-id>

# List all citation connections
proposit-core citations list
# → <connection-id> | <claimId>@<v> -> <supportingClaimId>@<v>

# Show a single citation connection
proposit-core citations show <connection-id>
# → id:                       <connection-id>
# → claimId:                  <claimId>
# → claimVersion:             0
# → supportingClaimId:        <supportingClaimId>
# → supportingClaimVersion:   0

# Remove a citation connection
proposit-core citations remove <connection-id>
```

---

## 7a. Axiomatic Claims and Axiom Connections

Axiomatic claims (v0.12.0) represent self-evident propositions that justify a derived claim's truth without further support — propositions that hold by definition, by historical convention, or by logical necessity. The CLI requires a `reasonCode` from a fixed set when creating one:

- `true-by-definition`
- `historically-established`
- `logically-required`

### Create an axiomatic claim

```bash
# --reason is required when --type=axiomatic
proposit-core claims add \
    --type axiomatic \
    --reason true-by-definition \
    --title "All bachelors are unmarried"
# → <axiomatic-claim-id>

# Listings tag axiomatic claims with [axiom: <reasonCode>]
proposit-core claims list
# → <axiomatic-claim-id>@0 [axiom: true-by-definition] | All bachelors are unmarried
```

The `reasonCode` is set at creation time and is immutable — `claims update` rejects `--reason` as an unknown option.

### Wire an axiom into a normal claim's support set

Axiom connections always go from a `type=normal` claim to a `type=axiomatic` claim:

```bash
# Create the normal claim being supported
proposit-core claims add --title "Bachelors are unmarried men"
# → <normal-claim-id>

# Add an axiom connection
proposit-core axioms add \
    --claim-id <normal-claim-id> \
    --axiom-id <axiomatic-claim-id>
# → <axiom-connection-id>

# List, show, remove
proposit-core axioms list
# → <connection-id> | <claimId>@<v> -> <supportingClaimId>@<v>

proposit-core axioms show <axiom-connection-id>
# → id:                       <connection-id>
# → claimId:                  <normal-claim-id>
# → claimVersion:             0
# → supportingClaimId:        <axiomatic-claim-id>
# → supportingClaimVersion:   0

proposit-core axioms remove <axiom-connection-id>
```

### Render shows axiom support

When an argument's `render` output lists claims and connections, axiom-backed derivations appear alongside citation-backed ones — the render walk reads both `core.citations` and `core.axioms` for each claim. Derivation premises whose antecedent was populated via `populate-supports` (citations first, then axioms — see §7b) see the supporting claim's variable in the antecedent.

### Evaluation note

Axiomatic claim-bound variables are forced to `true` at evaluation time. Passing an explicit assignment for one (e.g., `analysis set <symbol> false`) raises `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` before the evaluator runs. To express "this derivation should not be supported by this axiom," wrap the axiom's variable expression in the antecedent with `not` — `not(true) = false`, so the negated reference contributes `false` to its parent operator.

---

## 7b. Derivation Premises

A **derivation premise** is structurally committed to deriving a specific named claim. It carries a `derivedClaimId` that never changes. Structurally (S-14) its expression tree's root is one of `variable` (naked-Q form), `implies`, or `iff`. The Derivable-tier rules (D-1..D-6 — see `docs/Proposit_Grammar.md` §3.3) restrict the populated form further to `IMPLIES(c, Q)` (single-citation antecedent), `IMPLIES(OR(c1, …, cn), Q)` (OR-of-same-grounding-kind antecedent), or `IMPLIES(axiom-variable, Q)` (single-axiomatic-claim antecedent). Mixing citation-bound and axiom-bound variables in a single antecedent is a D-3 violation. Naked-Q is a **valid Derivable state** and represents "no support given yet."

The `premises populate-supports` command is the CLI's recommended way to build the antecedent automatically. As of v1.0 it calls the engine's `populateFromCitations` first; if citations populate the antecedent, the subsequent `populateFromAxioms` no-ops (the target is no longer naked-Q). If no citation connections exist for the derived claim, `populateFromAxioms` takes effect with whatever axiom connections are present. This matches the D-3 "no mixing" rule (one antecedent grounded by one kind). To switch a populated derivation premise from citations to axioms (or vice versa), the user must explicitly empty the antecedent via a clearing repair primitive first — the factory methods no-op on already-populated premises rather than silently dropping user data.

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

### Step 3: Add a citation connection (normal claim is supported by the citation claim)

```bash
proposit-core citations add \
    --claim-id <normal-claim-id> \
    --supporting-claim-id <citation-claim-id>
# → <citation-connection-id>
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

### Step 5: Populate supports

`populate-supports` reads the current citations and axiom connections for the derived claim and builds the antecedent:

```bash
proposit-core <argument-id> latest premises populate-supports <derivation-premise-id>
```

Render again to see the result:

```bash
proposit-core <argument-id> latest premises render <derivation-premise-id>
# → [derivation] (S0 → Q)   (one support: IMPLIES(S1, Q))
```

With two supports it would produce `[derivation] ((S0 ∨ S1) → Q)`.

### populate-supports rules

- **0 supports** — no change; premise stays in naked-Q form.
- **1 support** — builds `IMPLIES(VariableS, Q)`.
- **≥ 2 supports** — builds `IMPLIES(OR(VariableS1, …, VariableSn), Q)`.
- Source ordering: citations are listed first, axioms second; source order is preserved within each group.
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

## 7c. Origin Data and Unspoken Content

Record the source text an argument was built from, which parts derive from
which spans of it, and which parts the original left unspoken.

### Attach a source text

```bash
DOC=$(proposit-core origins attach ./speech.txt \
    --argument <argument-id> --version 0 --stance seed)
# → <document-id>
```

`--stance seed` (the default) says the argument merely started from the source.
`--stance representation` asserts it faithfully renders the source — a claim
about someone else's text, so it is never the default.

The stored text is normalized on the way in: every line-break form folds to LF,
the byte-order mark, control characters other than LF and tab, bidirectional
controls, zero-width characters, and stray variation selectors are stripped, and
the result is composed to Unicode NFC and trimmed. Internal whitespace,
paragraph breaks, smart quotes, dashes, case, and punctuation survive untouched.

### Inspect what was stored

```bash
proposit-core origins list
# → <document-id> | 74 code points | 1 link(s) | 0 anchor(s)
# →   <argument-id>@0 (seed)

proposit-core origins show $DOC
# → id:          <document-id>
# → digest:      7b605bcd…
# → codePoints:  74
# → link:        <link-id> -> <argument-id>@0 (seed)

# Just the text, for piping
proposit-core origins show $DOC --text
```

### Anchor a premise to a span

```bash
proposit-core origins anchor add --document $DOC \
    --argument <argument-id> --version 0 \
    --target premise --target-id <premise-id> \
    --start 0 --end 12
# → <anchor-id>
```

`--target` is `expression`, `premise`, or `argument`. A global claim cannot be
anchored: a claim is shared by reference across arguments, so its provenance is
a property of _this_ argument's use of it.

The argument version must already be linked to the document — `origins attach`
creates that link, `origins link` adds one for an argument that already has the
text. Without it the anchor is refused with `ORIGIN_ANCHOR_LINK_NOT_FOUND`,
because the link carries the stance that gives the anchor its meaning.

**`--start` and `--end` count Unicode code points, not UTF-16 code units** — the
unit the Web Annotation Data Model requires and the one Postgres `substring()`
uses. The quote is sliced out of the stored document rather than typed in, and
an anchor whose span leaves the document is refused:

```bash
proposit-core origins anchor add --document $DOC \
    --argument <argument-id> --version 0 \
    --target premise --target-id <premise-id> --start 0 --end 99999
# → ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE: origin anchor "…" spans [0, 99999) of a
#   document 74 code points long

proposit-core origins anchor remove <anchor-id>
```

### Reuse or remove a source text

A second argument can share one stored text rather than pasting it in again:

```bash
proposit-core origins link $DOC --argument <other-argument-id> --version 0 --stance representation
# → <link-id>

proposit-core origins unlink <link-id>
```

Removing a source text is refused while anything still points at it, so
unlink and drop its anchors first:

```bash
proposit-core origins remove $DOC
# → ORIGIN_DOCUMENT_IN_USE: origin document "…" is still referenced by 1 link(s) or anchor(s)
```

### Mark content as unspoken

An _enthymeme_ is content the natural-language original left for the audience to
supply. It is always declared by an author — nothing infers it — and it can be
declared on an argument with no source text at all.

```bash
proposit-core <argument-id> latest premises update <premise-id> --enthymeme
proposit-core <argument-id> latest expressions mark <premise-id> <expression-id> --enthymeme

# Unmark — removes the field rather than storing false, which restores the
# entity's original checksum.
proposit-core <argument-id> latest premises update <premise-id> --no-enthymeme
proposit-core <argument-id> latest expressions mark <premise-id> <expression-id> --no-enthymeme
```

Only a claim-bound variable expression can meaningfully be marked — a
premise-bound variable's truth is derived from another premise rather than
asserted, so there is nothing for a speaker to have suppressed, and an operator
or formula has no assertion at all. Marking one does not throw (mutations throw
only on Structural violations); it is reported as `P-6` by the library's
tier-aware `engine.validate('presentable')`, which the CLI does not currently
surface. The CLI's own `expressions mark` refuses a non-variable expression up
front.

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

Record a decision about an operator: accepted (grant the step), rejected (withhold it), or unset (no decision). A decision is not a truth value — rejecting an operator strikes the whole premise it lives in from the evaluated set and asserts nothing:

```bash
# Accept an operator (propagates constraints to unknown variables)
proposit-core <argument-id> latest analysis set-operator <operator-id> accepted

# Reject an operator (strikes its premise; nothing is forced false)
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
