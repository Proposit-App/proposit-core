# Plan

1. TDD: tests for `pipelines/scheduling` eligibility helpers + canonical
   stage-id lists (assert lists equal `pipeline.stages.map(s => s.id)` — drift
   guard).
2. Add `src/lib/pipelines/scheduling.ts` (descriptor-based eligibility, reusing
   `depId`/`isOptionalDep` from `./types.js`).
3. Add `src/extensions/pipelines/ingestion/canonical-stages.ts`; re-export from
   the ingestion barrel.
4. Declare the `./pipelines/scheduling` subpath in `package.json` `exports`.
5. Remove OpenAI + builder re-exports from `src/lib/index.ts` (root barrel).
6. Retire the "Argument Ingestion" taxonomy Feature via `tcw taxonomy rm`.
7. Verify: `pnpm run check` green; grep proves root barrel clean + subpaths
   still export the symbols; engine goldens unchanged.
8. Version: `pnpm version major` → 3.0.0; release-notes + changelog; tag; pack.
