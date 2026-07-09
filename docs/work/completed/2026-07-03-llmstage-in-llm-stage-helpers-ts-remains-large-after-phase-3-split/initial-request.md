# llmStage in llm-stage-helpers.ts remains large after Phase 3 split

## Product changes

None — internal file-size follow-up only.

## Technical changes

Accepted follow-up candidate from
`2026-06-21-lib-extensions-decomposition-residual-expressionmanager-pipelines-execute-stage-grouping`
(see its `outcome.md`, "Follow-up notes" section). After that item's
Phase 3 split, `llmStage` in `src/lib/pipelines/llm-stage-helpers.ts` is
still large (~290 lines). No further internal decomposition was
attempted at the time — this item picks that up if/when it's worth the
effort. Low priority; not urgent.

## Meta changes



## Resolution (wontfix — backlog audit 2026-07-09)

Premise no longer holds. Commit `ddc95f9` ("extract single-attempt body from
llmStage") reduced `llmStage` from ~290 lines to ~89 lines
(`src/lib/pipelines/llm-stage-helpers.ts`). The "still large" concern that
motivated this follow-up was addressed incidentally by that refactor.
