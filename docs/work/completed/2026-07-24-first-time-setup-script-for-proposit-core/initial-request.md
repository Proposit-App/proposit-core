# First-time setup script for proposit-core

Delegated from `proposit-app` (workspace root).
Epic: [New-developer onboarding setup scripts](tcw://W/proposit-app/2026-07-24-new-developer-onboarding-setup-scripts)

## Problem

There is no reproducible path from "new laptop" to "working Proposit workspace."
The orchestration repo now ships two tiers of onboarding script:

1. `scripts/initial-setup.sh` — pasted into a terminal from Discord or a web
   page. Checks prerequisites (git, Node ≥ 22.3, pnpm via corepack, GitHub SSH),
   clones all five repos, runs `pnpm install` in each.
2. `scripts/setup.sh` — asks which repos the developer works on, then runs each
   one's own `scripts/first-time-setup.sh`.

Tier 3 is the per-repo script, and it does not exist here yet. `setup.sh` warns
and reports the repo as incomplete when it is missing.

## Proposed fix

Add `scripts/first-time-setup.sh` to this repo.

### Contract (binding — `setup.sh` depends on it)

- Path is exactly `scripts/first-time-setup.sh`, committed executable (`chmod +x`).
- Runs from the repo root. It is invoked as
  `( cd "$repo" && ./scripts/first-time-setup.sh )`.
- Idempotent — a second run on an already-configured machine succeeds and changes
  nothing.
- Works on macOS and Linux. A macOS-only step must be skipped on Linux with a
  printed explanation, not a failure.
- Exits non-zero on failure.
- Never attempts anything that cannot be installed non-interactively. Print
  instructions instead.
- Does **not** re-run `pnpm install` as its main job — tier 1 already did that.
  Repo-local post-install steps that `pnpm install` does not cover are in scope.
- Prints what it did and what the developer must still do by hand.

## Scope for this repo

proposit-core is the thinnest of the four: no env file, no services, no database.
Verify the following rather than trusting it — this list was assembled from the
README and AGENTS.md by an orchestrator agent, not from running the code.

- `prepare` already runs `git config core.hooksPath .githooks` on install, so git
  hooks need no separate step. Confirm that and say so in the script's output
  rather than re-running it blindly.
- The natural body is a verification pass — `pnpm run build` then
  `pnpm run check`, or whichever subset actually proves the machine is ready
  without being punishingly slow. Note that `build` runs the peggy parser
  generation, so a fresh clone needs it before the CLI works.
- `bash scripts/smoke-test.sh` exercises the CLI after a build. Judge whether it
  belongs in first-time setup or is too slow.
- Mention, do not require, the optional live-LLM test pair
  (`RUN_LIVE_LLM_TESTS=1` + `OPENAI_API_KEY`). CI sets neither.

If a step turns out to be unnecessary, leave it out and say why in the outcome —
a short honest script beats a long ceremonial one.

## Consumer impact

None to the published package. This is developer tooling only; no product delta,
so no capability declarations.

## Test cases

- Run on a machine that is already set up → succeeds, changes nothing.
- Run twice in a row → second run is a clean no-op.
- `bash -n scripts/first-time-setup.sh` is clean.
- Exits non-zero when a required tool is missing.
