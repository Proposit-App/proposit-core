# The proposit-core command-line tool

The package installs a `proposit-core` command. It keeps arguments, claims and the other libraries as JSON files on disk and runs the same engine the library exposes. `proposit-core --help`, and `--help` on any subcommand, lists every option.

## Storage and versions

- Data lives in `~/.proposit-core`. Set `PROPOSIT_HOME` to use another directory. Every run is logged to `$PROPOSIT_HOME/logs/cli.jsonl`.
- The layout is `arguments/<id>/<version>/…` (argument metadata, variables, roles, premises and analysis files), plus `claims.json`, `citations.json`, `axioms.json`, `origins.json` and `forks.json` at the top.
- Arguments start at version `0`. `arguments publish <id>` makes the latest version read-only and copies it into a new draft version. Every command that changes a published version refuses.
- Wherever a version is expected you can write a number, `latest`, or `last-published`.
- Commands that create something print the new id on standard output, so a shell script can capture it.

## Commands

Global commands:

```text
proposit-core version
proposit-core arguments create <title> <description>
proposit-core arguments list [--json]
proposit-core arguments import <yaml_file>
proposit-core arguments parse [text] [--pipeline scholar|scribe] [--model <m>] [--api-key <k>] [--title <t>] [--dry-run]
proposit-core arguments publish <argument_id>
proposit-core arguments fork <argument_id>
proposit-core arguments delete <argument_id> [--all] [--confirm]
proposit-core diff <id> <verA> <verB>            # or: diff <idA> <verA> <idB> <verB>   [--json]
proposit-core claims list|show|add|update|freeze
proposit-core citations list|show|add|remove
proposit-core axioms list|show|add|remove
proposit-core origins attach|list|show|link|unlink|remove|anchor add|anchor remove
```

Commands for one argument version take the form `proposit-core <argument_id> <version> <group> <subcommand>`:

| Group / command                          | Subcommands and notes                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show`, `render`, `graph [--analysis f]` | Metadata; the whole argument as text (the conclusion is marked `*`); a Graphviz DOT graph, optionally coloured by an analysis file's results.                                                                                                                                                                                                                                 |
| `variables`                              | `create <symbol>` (also creates a claim for it), `bind <symbol> --premiseId <id>`, `list`, `show`, `update --symbol`, `delete`, `list-unused`, `delete-unused`.                                                                                                                                                                                                               |
| `premises`                               | `create [--title] [--symbol] [--type freeform\|derivation] [--derived-claim <claimId>]`, `list`, `show`, `update`, `delete`, `render`, `populate-supports <premiseId>` (fills a derivation premise from citations, or from axioms if there are none).                                                                                                                         |
| `expressions`                            | `create <premise_id> --type variable\|operator\|formula [--variable-id] [--operator not\|and\|or\|xor\|implies\|iff] [--parent-id] [--before\|--after <id>] [--position n]`, `insert` (with `--left-node-id` / `--right-node-id`), `delete`, `list`, `show`, `toggle-negation`, `change-operator`, `mark --enthymeme\|--no-enthymeme`.                                        |
| `roles`                                  | `show`, `set-conclusion <premise_id>`, `clear-conclusion`.                                                                                                                                                                                                                                                                                                                    |
| `analysis`                               | `create [file] [--default true\|false\|unset] [--from f]`, `list`, `show`, `set <symbol> true\|false\|unset`, `reset`, `set-operator <expr_id> accepted\|rejected\|unset`, `set-all-operators`, `validate-assignments`, `evaluate`, `check-validity [--mode first-counterexample\|exhaustive]`, `validate-argument [--tier <tier>]`, `refs`, `operators`, `export`, `delete`. |
| `validate`, `repair [--dry-run]`         | Run the invariant checks; tidy the tree (insert missing parentheses and similar).                                                                                                                                                                                                                                                                                             |

Notes:

- `expressions create` builds trees one node at a time. It works in permissive behavior, so a half-built tree is kept as it is. Run `repair` when the tree is finished.
- An **analysis file** stores one reader's assignment (by symbol) and operator decisions. `analysis create` names files `analysis-1.json`, `analysis-2.json` and so on, and `--file` defaults to the latest one.
- `claims add --type axiomatic` requires `--reason true-by-definition|historically-established|logically-required`. A claim's type and reason cannot be changed afterwards.
- `citations add --claim-id <id> --supporting-claim-id <id>` and `axioms add --claim-id <id> --axiom-id <id>` add connections.
- `arguments parse` runs the text-to-argument pipeline and needs an OpenAI API key, from `--api-key` or the `OPENAI_API_KEY` environment variable.

## Walkthrough

```bash
ARG=$(proposit-core arguments create "Modus ponens" "If P then Q; P; so Q")
P=$(proposit-core "$ARG" latest variables create P)
Q=$(proposit-core "$ARG" latest variables create Q)

RULE=$(proposit-core "$ARG" latest premises create --title "P implies Q")
FACT=$(proposit-core "$ARG" latest premises create --title "P")
GOAL=$(proposit-core "$ARG" latest premises create --title "Q")

IMP=$(proposit-core "$ARG" latest expressions create "$RULE" --type operator --operator implies)
proposit-core "$ARG" latest expressions create "$RULE" --type variable --variable-id "$P" --parent-id "$IMP"
proposit-core "$ARG" latest expressions create "$RULE" --type variable --variable-id "$Q" --parent-id "$IMP"
proposit-core "$ARG" latest expressions create "$FACT" --type variable --variable-id "$P"
proposit-core "$ARG" latest expressions create "$GOAL" --type variable --variable-id "$Q"
proposit-core "$ARG" latest roles set-conclusion "$GOAL"

proposit-core "$ARG" latest render
proposit-core "$ARG" latest analysis validate-argument --tier presentable   # ok
proposit-core "$ARG" latest analysis check-validity                         # isValid: valid

proposit-core "$ARG" latest analysis create                 # analysis-1.json
proposit-core "$ARG" latest analysis set P true
proposit-core "$ARG" latest analysis set-operator "$IMP" accepted
proposit-core "$ARG" latest analysis evaluate               # conclusion true: true, reached without: true

proposit-core arguments publish "$ARG"                      # version 0 is now read-only; version 1 is the draft
```

## Importing from YAML

`arguments import` builds an argument from formula strings (the syntax is in [grammar.md](grammar.md)):

```yaml
metadata:
    title: "Modus ponens"
premises:
    - formula: "P -> Q"
    - formula: "P"
    - role: "conclusion"
      formula: "Q"
```

Each premise may also carry `metadata: { title }`. The repository's `examples/arguments/` folder has larger examples.
