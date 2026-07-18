# Slice C — core re-exports, root-barrel hygiene, retire ingestion Feature

Slice of cross-node epic `2026-07-18-shared-derived-view-layer-core-barrel-hygiene`
(root node). Adopted from the inbox brief
`docs/work/inbox/2026-07-18-slice-c-core-re-exports-barrel-hygiene-relocate-builder-retire-ingestion-feature.md`
(now removed). The full epic scope + dependency DAG live in the root epic's `spec.md`.

## Problem / root cause

Core's root barrel leaks opinionated, usage-specific machinery (the concrete
OpenAI provider + the builder turns) while correctly withholding the ingestion
pipelines — inconsistent gatekeeping. Separately, `isStageEligible` + the
canonical pipeline stage-id constants are re-implemented in `proposit-server`
only because core doesn't re-export them, and mobile is about to make a third
copy.

## Scope (major version bump)

1. Re-export `isStageEligible` (+ sibling DAG-eligibility primitives) and the
   canonical pipeline stage-id constants at importable subpaths.
2. Root-barrel hygiene: remove the concrete OpenAI provider + builder turns from
   `src/lib/index.ts`; keep them reachable via their dedicated subpaths only.
3. Keep `builder/` in core (subpath-only). No relocation, no behavior change.
4. Retire the "Argument Ingestion" taxonomy Feature (triplicates shared's
   ingestion-pipeline model). Keep the pipeline code.

Engine behavior is byte-identical; only the export surface + taxonomy move.
