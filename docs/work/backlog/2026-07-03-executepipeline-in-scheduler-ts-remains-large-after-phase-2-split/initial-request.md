# executePipeline in scheduler.ts remains large after Phase 2 split

## Product changes

None — internal file-size follow-up only.

## Technical changes

Accepted follow-up candidate from
`2026-06-21-lib-extensions-decomposition-residual-expressionmanager-pipelines-execute-stage-grouping`
(see its `outcome.md`, "Follow-up notes" section). After that item's
Phase 2 split, `executePipeline` in `src/lib/pipelines/scheduler.ts` is
still large (307 lines). No further internal decomposition was attempted
at the time — this item picks that up if/when it's worth the effort. Low
priority; not urgent.

## Meta changes


