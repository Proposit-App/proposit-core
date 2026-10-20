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
