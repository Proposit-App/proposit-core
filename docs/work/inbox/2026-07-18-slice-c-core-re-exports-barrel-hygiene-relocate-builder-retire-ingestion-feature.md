---
from: .
initiative: 2026-07-18-shared-derived-view-layer-core-barrel-hygiene
---

# Slice C: core re-exports + barrel hygiene + relocate builder + retire ingestion Feature

Slice of cross-node epic `2026-07-18-shared-derived-view-layer-core-barrel-hygiene`
(root node). Full epic scope + dependency DAG live in the root epic's `spec.md`.
Adopt with `tcw work new --initiative 2026-07-18-shared-derived-view-layer-core-barrel-hygiene`
(NOT `inbox accept` — it mangles the delegated slug and drops the initiative link).

## Problem / root cause

Core's root barrel leaks opinionated, usage-specific machinery while correctly
withholding the ingestion pipelines — inconsistent gatekeeping that dilutes the
"pure logic engine" identity this repo's own AGENTS.md asserts. Separately, two
pure functions (`isStageEligible`, canonical stage-id constants) are
re-implemented in `proposit-server` only because core doesn't re-export them —
and mobile is about to make a third copy.

## Scope (this slice) — **major version bump**

1. **Re-export** `isStageEligible` + the canonical pipeline stage-id constants at
   an importable subpath (core owns the pipeline framework, so this is in-charter).
   Unblocks deletion of `server/src/services/tasks/workflow/dag-eligibility.ts`.
2. **Root-barrel hygiene:** remove the concrete OpenAI provider
   (`createOpenAiResponsesProvider` + its error classes) and the builder turns
   (`createReviewTurn`/`createSimulateTurn`/`createDistillTurn`) from the root
   barrel (`src/lib/index.ts`). Keep them reachable via their dedicated subpaths
   only. Rule: *opinionated extensions are subpath-only; root barrel = pure engine*
   (ingestion already follows this).
3. **Keep `builder/` in core** — resolved 2026-07-18. It stays a core-owned
   extension because it powers the CLI and a planned **interactive
   argument-builder CLI experience** (needs the turns in-package). Item 2's barrel
   hygiene still applies: builder goes subpath-only (off the root barrel); the CLI
   imports the subpath internally, so the experience is unaffected. Keep the
   "Argument Builder" taxonomy Feature (justified by the CLI surface). Only the
   *root-barrel export* changes — no relocation, no behavior change.
4. **Retire the "Argument Ingestion" taxonomy Feature** (`docs/taxonomy/`) — it
   triplicates shared's richer `ingestion-pipeline` model. Keep the pipeline *code*
   (subpath-only extension); drop only the redundant taxonomy Feature.

## Consumer impact

Breaking published-surface change → **major**. Consumers (`shared`, `server`,
`mobile`) repin afterward via the epic's flip-order. Engine *behavior* is
unchanged — only the export surface + taxonomy move.

## Ordering

**This slice is first.** Shared's Slice S consumes the new re-exports; it cannot
finish until C publishes and passes the consumer-side tarball validation gate.

## Test cases

- New re-export subpath imports resolve; `isStageEligible` + stage-id constants
  are byte-identical to server's current local copy (diff before deleting there).
- Root barrel no longer exports OpenAI/builder symbols; their subpaths still do.
- Full engine goldens unchanged (no behavioral drift).
- `pnpm run check` green; naming/casing via `brain-style`.
