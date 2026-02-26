# CLI Diff Command Design

## Overview

Add a top-level `diff` command to the proposit-core CLI that compares two argument versions and prints their differences. Uses the existing `diffArguments` library function.

## Command Syntax

```
proposit-core diff <id> <verA> <verB>           # same-argument shorthand
proposit-core diff <idA> <verA> <idB> <verB>    # cross-argument full form
```

Version selectors: `latest`, `last-published`, or integer.

Options: `--json` emits the raw `TCoreArgumentDiff` object.

Detection: 3 positional args = shorthand (same argument, two versions). 4 positional args = full form. Any other count is an error.

## File Structure

### `src/cli/commands/diff.ts` — Command registration

- Exports `registerDiffCommand(program: Command): void`
- Parses positional args, detects 3-arg vs 4-arg form
- Calls `resolveVersion` for both sides
- Hydrates two engines via `hydrateEngine`
- Calls `diffArguments(engineA, engineB)`
- Delegates to renderer or `printJson` based on `--json`

### `src/cli/output/diffRenderer.ts` — Human-readable formatter

- Exports a function that takes a `TCoreArgumentDiff` and prints it
- Walks the diff structure: argument fields, variables, premises (with nested expressions), roles
- Uses `+`/`-`/`~` prefixes and `→` arrows
- Prints "No differences." when the diff is empty

## CLI Routing Changes

Add `"diff"` to `NAMED_COMMANDS` in `router.ts`. Register `registerDiffCommand(program)` in `cli.ts` alongside the existing named command registrations.

## Output Format

### Human-readable (default)

```
Argument:
  title: "Old Title" → "New Title"
Variables:
  + p (added)
  ~ q: symbol "q" → "Q"
  - r (removed)
Premises:
  + premise-2 (added)
  ~ premise-1:
    title: "Old" → "New"
    Expressions:
      + expr-3 (added)
      ~ expr-4: type "variable" → "operator"
      - expr-5 (removed)
Roles:
  conclusion: premise-1 → premise-2
  + support: premise-3 (added)
  - support: premise-4 (removed)
```

Rules:
- Sections only appear if they have changes
- Added/removed entities: `+ id (added)` / `- id (removed)`
- Modified entities: `~ id:` followed by indented field changes
- Field changes: `field: "before" → "after"`
- "No differences." when the entire diff is empty

### JSON (`--json`)

Emits the full `TCoreArgumentDiff` object via `printJson`.

## Empty Diff Detection

A diff is empty when all of:
- `argument.changes` is empty
- `variables.added`, `.removed`, `.modified` are all empty
- `premises.added`, `.removed`, `.modified` are all empty
- `roles.conclusion.before === roles.conclusion.after` and `roles.supportingAdded`, `.supportingRemoved` are both empty

## Error Handling

- Invalid argument ID or version selector: caught from `hydrateEngine`/`resolveVersion`, forwarded via `errorExit`
- Wrong positional arg count (not 3 or 4): `errorExit` with usage hint
- Same argument+version on both sides: not an error, produces empty diff
