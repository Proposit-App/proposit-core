#!/usr/bin/env bash
#
# proposit-core first-time setup.
#
# Invoked by the workspace root's scripts/setup.sh as
#   ( cd proposit-core && ./scripts/first-time-setup.sh )
# and safe to run directly from anywhere.
#
# There is nothing to install here. proposit-core is a pure TypeScript library
# plus a CLI: no env file, no services, no database, and no macOS- or
# Linux-specific dependency — `pnpm install` (run by the workspace bootstrap)
# already did everything, including pointing git at .githooks via the
# package.json "prepare" script. So this script configures nothing and instead
# proves the machine can build and run the thing. That makes it idempotent by
# construction: re-running it just re-verifies.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

step() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------
step "Checking prerequisites"

command -v node >/dev/null ||
  die "Node.js not found. Install 22.3+ via nvm, Homebrew, or https://nodejs.org"

command -v pnpm >/dev/null ||
  die "pnpm not found. Try: corepack enable pnpm   (or: npm install -g pnpm)"

node -e 'const [maj, min] = process.versions.node.split(".").map(Number); process.exit(maj > 22 || (maj === 22 && min >= 3) ? 0 : 1)' ||
  die "Node $(node --version) is too old — package.json requires >=22.3.0."

[ -d node_modules ] ||
  die "node_modules/ is missing. Run 'pnpm install' here first (the workspace bootstrap normally does it)."

printf '  node %s · pnpm %s\n' "$(node --version)" "$(pnpm --version)"

# --- git hooks ---------------------------------------------------------------
# "prepare" sets this on every install, so it is normally already correct; only
# a --ignore-scripts install or a hand-edited config lands in the else branch.
step "Checking git hooks"

hooks_path="$(git config --get core.hooksPath || true)"
if [ "$hooks_path" = ".githooks" ]; then
  printf '  core.hooksPath is .githooks — already set by the "prepare" script on install\n'
else
  git config core.hooksPath .githooks
  printf '  core.hooksPath was %s — set it to .githooks\n' "${hooks_path:-unset}"
fi

# --- verify ------------------------------------------------------------------
# `check` ends with `build`, which runs the peggy parser generation and emits
# dist/ — a fresh clone has neither, and the CLI needs both.
step "Verifying the toolchain: typecheck, lint, tests, build (~20s)"
pnpm run check

step "Verifying the CLI end to end (~30s)"
# An explicit template, not `mktemp -t`: BSD mktemp treats -t's argument as a
# bare prefix, GNU mktemp demands trailing X's in it.
tmp_dir="${TMPDIR:-/tmp}"
smoke_log="$(mktemp "${tmp_dir%/}/proposit-core-smoke.XXXXXX")"
if bash scripts/smoke-test.sh >"$smoke_log" 2>&1; then
  rm -f "$smoke_log"
  printf '  CLI smoke test passed\n'
else
  tail -n 30 "$smoke_log" >&2
  die "CLI smoke test failed. Full log: $smoke_log"
fi

# --- done --------------------------------------------------------------------
step "proposit-core is ready"
cat <<'EOF'

Nothing was installed and nothing is left for you to do by hand.

Everyday commands:
  pnpm run check              # typecheck + lint + tests + build
  pnpm cli -- --help          # the local CLI (needs a build first)
  bash scripts/smoke-test.sh  # CLI end to end

Optional: the live OpenAI integration suites are skipped unless you set BOTH
RUN_LIVE_LLM_TESTS=1 and OPENAI_API_KEY. They call the real API and cost
tokens; CI sets neither. You do not need them to develop here.
EOF
