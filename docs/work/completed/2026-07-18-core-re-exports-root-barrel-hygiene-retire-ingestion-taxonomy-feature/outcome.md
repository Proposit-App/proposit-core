# Outcome

Shipped as `@proposit/proposit-core@3.0.0` (tag `v3.0.0`, live on npm).

## What changed

- **New subpath `@proposit/proposit-core/pipelines/scheduling`** (`src/lib/pipelines/scheduling.ts`): `isStageEligible`, `hasRequiredFailureUpstream`, `computeDagProgress`, `optional`, `depId`, `isOptionalDep`, and types `TStageDescriptor`, `TDagProgress`, `TDepSpec`. Server's DAG-eligibility logic now binds to this instead of re-implementing it.
- **New subpath `@proposit/proposit-core/pipelines/ingestion`** (`src/extensions/pipelines/ingestion/`): `INGESTION_SCHOLAR_STAGE_IDS`, `INGESTION_SCRIBE_STAGE_IDS`, `getCanonicalStageIds(pipelineId)`.
- **Root barrel (`src/lib/index.ts`) slimmed** to the pure logic engine: the OpenAI provider moved to `@proposit/proposit-core/extensions/openai`; the builder turns `createReviewTurn`/`createSimulateTurn`/`createDistillTurn` moved to `@proposit/proposit-core/builder`.
- **Retired the "Argument Ingestion" taxonomy Feature** (`tcw taxonomy rm argument-ingestion`); the pipeline code stays, only the taxonomy entry was removed.

## Versioning

Major bump (pre-3.0 core → breaking public root-barrel surface change).

## Verification

Consumers (shared peerDep `^3.0.0`, server + mobile) validated against a `file:` tarball before publish, then repinned to the registry `^3.0.0`. All downstream typechecks + suites green.
