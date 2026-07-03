# upcoming changelog

## Changed

- `src/lib/core/expression-manager.ts` (2,042 → 1,397 lines) split into
  four files: the class shell, `expression-manager-dirty-set.ts` (checksum
  dirty-set bookkeeping), `expression-manager-invariants.ts` (the
  whole-tree `validate()` scan), and `expression-manager-checks.ts`
  (per-mutation structural-check functions for `insertExpression`,
  `wrapExpression`, `repositionSiblings`, `updateExpression`,
  `removeAndPromote`, `addExpressionRelative`). Internal-only — no import
  path, public API, or behavior change.
- `src/lib/pipelines/execute.ts` (1,278 lines) removed and split into
  `scheduler.ts` (the whole-DAG concurrent scheduler: `executePipeline`,
  `validateDag`, `makeStageContext`, `runOneStage`, `runFinalize`,
  `PipelineConfigurationError`) and `single-stage.ts` (the single-stage
  entry points: `executeStage`, `executeFinalize`, `launchStage`,
  `completeStage`). The public barrel (`src/lib/pipelines/index.ts`)
  re-exports the same names from the new files — no import path, public
  API, or behavior change for consumers.
