# TCW 3.0 migration log

Projects: proposit-core.

## Run 1

Started: 2026-10-20
Starting commit: 71e73d57e7502bd8ab95e46aab9773643b28463a

### Step 0

Tagged `tcw-2.x-final` (local); work on branch `tcw-3-migration`. 2.8.3's
`tcw validate` printed `validate OK`. `git status --ignored --porcelain --
docs/work` listed nothing.

### Step 1: Approved plan

This project moves to TCW 3.0 in **filesystem mode** (the default backend),
with every optional stage on (spec, plan, review, qa, postmortem) and a git
hook that commits and pushes an item's folder after every move. All 22 items
are kept, with no folder renamed:

- 12 in `backlog/` → stage `request` (none has a spec or plan);
- 9 in `completed/` → `completed`, each `refined-outcome.md` becoming
  `qa/round-1.md` (or `round-2.md` after a `rework.md`) with `verdict` and
  `judges` front matter, and `outcome.md` becoming `implement/round-1.md`;
- 1 in `discarded/` → `discarded`, with a comment recording its 2.x
  resolution;
- one free-text blocker becomes a comment beginning `Carried over from TCW
2.x: blocked outside TCW`, and one blocker naming another item here becomes
  `blocked-by`.

Approved by the maintainer on 2026-10-20.

### Step 3: Configuration

`tcw-config.yaml`: `work.lifecycle` → `work.stages`, `builtin: true` →
`inherit: true`, the "pull first" prompt text, and
`scripts/tcw-commit-item.sh` (added) as a `post` hook on every stage.

Check, in a scratch copy with the 3.0 CLI: the 2.x key grep printed nothing;
`tcw validate`: `0 errors, 0 warnings, 0 unresolved`; composing every stage
prompt and procedure printed nothing.

### Step 4: Flatten the board

`git mv` moved all 22 item folders to the top of `docs/work`, each with an
`item.yaml` holding its `title` and `stage`; every status folder's `.gitkeep`
and `graveyard.yaml` were deleted. No folder needed renaming, and there was no
`renames.yaml` or `dod.yaml`.

Check: the status-folder `find` printed nothing; the `item.yaml` loop printed
nothing.

### Step 5: Item fields

Every `item.yaml` now holds its converted fields (priority as a name, `medium`
where 2.x had none; effort, complexity, tags; `blocked-by` as full slugs), and
every `state.yaml` and `tracker.yaml` was deleted. Comments written:

- the discarded item: `Carried over from TCW 2.x: discarded as wontfix`,
  followed by the reason its request records (decided 2026-10-02);
- the free-text blocker: `Carried over from TCW 2.x: blocked outside TCW`,
  followed by the 2.x text.

Check: `find docs/work \( -name state.yaml -o -name tracker.yaml \)` printed
nothing, and the `^priority: [0-9]` grep printed nothing.

### Step 7: Documents

`initial-request.md` (with `intake.md` under `## Original intake` where not
already contained) → `request/request.md`; `spec.md`, `plan.md` and
`outcome.md` into their stage folders; each `refined-outcome.md` and
`rework.md` → `qa/round-<N>.md` with `verdict` and `judges` front matter
(`judges: 1` where the item has `implement/round-1.md`, else 0), a rework
before the acceptance that followed it.

Correction to step 5: one `item.yaml` with no list field had been written as a
one-line `{…}` mapping; it was rewritten one key per line, as the guide's
example shows.

Check: the document-name `find` printed nothing; every verdict round has its
front matter.

### Step 8: Inbox

The inbox was empty; `inbox/.gitkeep` deleted. Check: `ls docs/work | grep -x
inbox` printed nothing.

### Step 9: Live references

No folder was renamed and the inbox was empty, so there are no old names. The
relative-link search over the 12 open items printed nothing.

### Step 10: The project's own files

`/tcw-config.local.yaml` added to `.gitignore`. No capability record had a
`Planning doc:` or `Tracker:` line. `AGENTS.md`'s paragraph on change requests
now points at the inbox stage instead of `tcw work inbox accept`. The hook
script uses `TCW_ITEM_PATH`, and `TCW_SLUG` only in its commit message.
Checks printed nothing, and `1` for the `.gitignore` line.

### Step 11: Validate

`tcw validate; echo "exit $?"`: `0 errors, 0 warnings, 0 unresolved`, `exit 0`.
`tcw work list --all --json` lists the 22 items, each at the stage the plan
gave it.

## Agent instructions

Step 12. Searched the places the guide lists, run from this repository's
root, plus the bound prompt folder (`docs/lifecycle`). The user approved every
proposed action in one answer.

In this repository:

- `.claude/settings.local.json` (untracked) lines 6–7: delete (approved); two
  permissions from moving this board at the migration, removed.
- `AGENTS.md` and the bound prompts: no passage wrong for 3.0 left (rewritten
  at step 10).

Outside the repository: the user's own instruction files, settings and saved
memories were reviewed under the same approval; one memory written for this
project's 2.x Jira mirroring was deleted, as this board is now on the
filesystem. They are not listed by path here, because their paths name other
projects. Their remaining lines are in the private file
`~/.tcw-3.0-migration-proposit-core-expected-names.txt`.

No line in a tracked file is still printed by the search:

<!-- prettier-ignore -->
```expected-names
```
