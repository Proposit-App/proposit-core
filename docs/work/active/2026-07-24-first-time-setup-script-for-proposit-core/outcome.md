# Outcome — First-time setup script for proposit-core

Added `scripts/first-time-setup.sh` (executable), satisfying the binding contract
from the workspace root's `scripts/setup.sh`.

## What the script does

1. **Prerequisites** — `node` and `pnpm` on PATH, node ≥ 22.3 (the `engines`
   floor), and `node_modules/` present. Each failure dies with an instruction and
   a non-zero exit; nothing is installed automatically.
2. **Git hooks** — reads `core.hooksPath`. If it is already `.githooks` (the
   normal case, set by the `prepare` script on every `pnpm install`), it says so
   and moves on. Only a `--ignore-scripts` install or a hand-edited config
   reaches the repair branch, which sets it and reports that it did.
3. **Verification** — `pnpm run check` (typecheck + lint + tests + build, ~20s),
   then `bash scripts/smoke-test.sh` (~30s, output captured to a temp log that is
   deleted on success and reported on failure).
4. **Summary** — states that nothing was installed and nothing is left to do by
   hand, lists the everyday commands, and mentions the optional live-LLM suites
   (`RUN_LIVE_LLM_TESTS=1` + `OPENAI_API_KEY`) as not required.

It `cd`s to the repo root from `${BASH_SOURCE[0]}`, so it works both under
`setup.sh`'s `( cd "$repo" && ./scripts/first-time-setup.sh )` and when run
directly by absolute path.

## Deliberately left out

- **A separate `git config core.hooksPath` step.** Confirmed: `package.json`'s
  `prepare` runs it on every install, and `git config --get core.hooksPath`
  already returned `.githooks` on a normal checkout. The script verifies instead
  of re-running it, with a repair branch only for the abnormal case.
- **`pnpm install`.** Tier 1 owns it; the script fails with an instruction when
  `node_modules/` is absent rather than duplicating it.
- **A separate `pnpm run build` step.** `pnpm run check` ends with `build`, which
  runs the peggy parser generation and emits `dist/`. Running build first would
  just build twice.
- **Any platform branch.** There is no macOS-only step here — no env file, no
  services, no database, no native toolchain. The script header says so; there is
  nothing to skip on Linux.
- **`bash scripts/smoke-test.sh` was kept**, not dropped: at ~30s it is not
  punishing, and it is the only check that proves the shipped CLI actually runs
  on this machine (`check` never executes `dist/cli.js`).

## Verification observed

Measured on this machine: typecheck 0.8s, lint 5.6s, test 7.8s, build 4.8s,
smoke test 31.8s — the script totals ~50s.

- `bash -n scripts/first-time-setup.sh` — clean.
- Run 1 → `EXIT=0`. Run 2 immediately after → `EXIT=0`; the two logs differ only
  in vitest timings and temp-dir names. `git status` after both runs showed no
  change beyond the script itself (the regenerated `formula-gen.js` is
  byte-identical; `dist/` and `docs/api/` are gitignored). No temp smoke log left
  behind.
- Missing prerequisites all exit 1 with the intended message: `node` absent,
  `pnpm` absent (node present), `node_modules/` absent, and a stubbed Node 20.9.0
  ("Node v20.9.0 is too old — package.json requires >=22.3.0.").
- Repair branch exercised by unsetting `core.hooksPath`: printed
  "core.hooksPath was unset — set it to .githooks" and restored it.
- Invocation forms: `( cd repo && ./scripts/first-time-setup.sh )` and an
  absolute path from `/tmp` both exit 0.

## Review

One round of local-LLM review on the staged diff. The configured reviewer models
failed their readiness check (a concurrently running llama-server on the same
box), so the diff plus a written constraints doc went to the healthy local server
directly. Verdict: no defects, with specific reasoning on portability,
idempotency, `set -e` interaction with `git config --get`, and path resolution.

One issue was found by follow-up verification rather than by the reviewer, and
fixed: the original `mktemp -t proposit-core-smoke` is BSD-only — GNU `mktemp`
requires trailing `X`s in a `-t` template, so the script would have failed at the
smoke-test step on Linux. Replaced with the explicit, portable
`mktemp "${tmp_dir%/}/proposit-core-smoke.XXXXXX"`.

## Consumer impact

None. Developer tooling only — no product delta, so no capability declarations.
Docs touched: `README.md` (Development section), `AGENTS.md` (Commands block),
`docs/changelogs/upcoming.md`.
