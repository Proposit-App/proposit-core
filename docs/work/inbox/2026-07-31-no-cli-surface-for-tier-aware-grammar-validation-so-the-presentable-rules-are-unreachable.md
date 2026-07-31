---
from: proposit-app
---

# No CLI surface for tier-aware grammar validation, so the Presentable rules are unreachable

Found while implementing
`2026-07-30-origin-data-library-and-enthymeme-annotation`, which added the
Presentable-tier rule `P-6`. Filed separately — nobody asked for CLI surface, so
that slice correctly did not add any.

## Problem

The CLI has no tier-aware grammar validation at all. `engine.validate(tier)` is
library-only, so every Presentable-tier rule — `P-6` included — is invisible to a
CLI user. A `CLI_EXAMPLES.md` draft written during that slice reached for
`analysis validate-argument --tier presentable` before anyone noticed no such
flag exists; the docs were corrected rather than the gap filled.

## Proposed fix

A tier argument on the existing validation command surface, defaulting to
whatever tier the CLI validates at today so the change is additive. The four
tiers nest (`Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`), so the flag
selects how far down to check rather than which checks to run.

Worth confirming first that CLI users want it — this is discoverability of an
existing library capability, not a missing capability.

## Consumer impact

None. Library consumers already reach `engine.validate(tier)` directly; this is
CLI-only.

## Test cases

- `scripts/smoke-test.sh` covers the new flag, per the repo's Public-CLI-API
  Documentation Sync entry.
- Validating an argument with a premise-bound variable marked unspoken reports
  `P-6` at the Presentable tier and reports nothing at the other three.
