# Public predicate to tell an LLM-background stage from a deterministic one

## Context

The pipeline framework ships three public drivers (1.1.0+):

- `executePipeline` — the in-process loop that runs every stage, blocking each
  LLM stage for the call's full duration and picking the right driver internally.
- `launchStage` (submit background response, suspend) + `completeStage` (validate
  on the completion signal) — for **LLM-background stages**.
- `executeStage` — run a **deterministic / sub-pipeline stage** inline.

The launch/complete split exists for consumers that drive the pipeline
**out-of-process, stage-by-stage**, because they cannot block one invocation for
an LLM call's full duration: a durable orchestrator, a queue worker, or a
webhook-driven server that submits a background response, suspends, and resumes
on the provider's completion callback. Such a consumer must decide, per stage,
which driver to use:

- **LLM-background stages** → `launchStage` + `completeStage`.
- **Deterministic / sub-pipeline stages** → `executeStage` (run inline).

`launchStage`/`completeStage` already enforce this: both call the
package-internal `requireLlmStage`, which throws `PipelineConfigurationError`
("…is not one (it carries no LLM config). Run deterministic stages via
executeStage.") for any stage that carries no LLM config.

## Problem

There is **no public way for a consumer to make the same LLM-vs-deterministic
decision before calling `launchStage`**. The carrier is a module-private `Symbol`
(`LLM_STAGE_CONFIG` in `src/lib/pipelines/stage-helpers.ts`), and its reader
`readLlmStageConfig(stage)` is not exported (the pipelines barrel re-exports
`deterministicStage` / `llmStage` / `subPipelineStage` / retry types, but not the
predicate). So a consumer's only options are to maintain a hand-written allowlist
of stage ids, or to call `launchStage` and catch the thrown
`PipelineConfigurationError` — neither is acceptable for routing.

The library hands consumers `launchStage` / `completeStage` / `executeStage` as
public API but gives them no public way to know which to call. The hand-written
allowlist drifts from the pipeline: add or change a stage kind and the external
list silently disagrees with the pipeline definition, routing a deterministic
stage to a background launch (which core rejects) or vice versa. The
call-and-catch alternative turns a `PipelineConfigurationError` into routing
control flow — an anti-pattern. The gap is in the published surface and applies
to any out-of-process orchestrator, independent of how that consumer suspends and
resumes (workflow engine, queue, webhook).

### Subtlety worth preserving in the predicate's contract

A stage factory may build an inner `llmStage(...)` and invoke its `run`
internally while **returning a plain `{ id, dependsOn, outputSchema, run }`
object** that does NOT carry the `LLM_STAGE_CONFIG` symbol (the default
`conclusion-selection` stage is built this way). core's `readLlmStageConfig`
therefore (correctly) sees no carrier on the returned stage, and `launchStage`
rejects it — it must be driven via `executeStage`, where its own `run` performs
the inner LLM call. The predicate must reflect **"is this stage driven as an
LLM-background stage by `launchStage`/`completeStage`"** — i.e. the presence of
the config carrier — NOT "does this stage ever touch an LLM internally." The two
differ for `conclusion-selection`, and the launch/complete contract is the one
that matters for routing.

## Proposed API

Export a public predicate from the pipelines barrel (and package root) over the
existing internal `readLlmStageConfig`:

```ts
/**
 * True iff `stage` is an LLM-background stage — one built by `llmStage` that
 * carries the resolved LLM config and is therefore driven by `launchStage` /
 * `completeStage`. False for deterministic and sub-pipeline stages (drive those
 * with `executeStage`). Mirrors exactly the check `launchStage`/`completeStage`
 * apply internally (`requireLlmStage`), so a consumer can route a stage to the
 * right driver without catching a thrown `PipelineConfigurationError`.
 */
export function isLlmStage<TOutput>(stage: TStage<TOutput>): boolean
```

`isLlmStage(stage)` ≡ `readLlmStageConfig(stage) != null`. `isLlmStage` is the
minimum the consumer needs: deterministic and sub-pipeline stages both route to
`executeStage`, so the boolean (not a three-way `stageKind` discriminant) is the
whole decision. No behavior change to existing exports.

## Impact on the consumer

Any out-of-process orchestrator deletes its hand-maintained deterministic/LLM
stage-id allowlist and derives each stage's routing directly from the resolved
pipeline: `deterministic: !isLlmStage(stage)`. The classification then comes from
the pipeline definition itself and can never drift from it again.

## Test cases (core side)

Build the default `argument-ingestion-v2` pipeline and assert `isLlmStage` per
stage:

- `true` for the genuine LLM-background stages (e.g. `segmentation`,
  `claim-mention-extraction`, `relation-extraction`, …).
- `false` for the deterministic stages (`claim-reference-validation`,
  `variable-assignment`, `formula-compilation`, `formula-validation`).
- `false` for `conclusion-selection` — the inner-`llmStage`-but-returns-a-literal
  case — proving the predicate keys on the returned stage's carrier (and thus
  agrees with what `launchStage` would do), not on whether a stage runs an LLM
  internally.
- For every stage, `isLlmStage(stage) === true` must be equivalent to
  `launchStage(pipeline, stage.id, …)` NOT throwing the "not an LLM stage"
  `PipelineConfigurationError` — i.e. the predicate and the launch/complete guard
  can never disagree.
