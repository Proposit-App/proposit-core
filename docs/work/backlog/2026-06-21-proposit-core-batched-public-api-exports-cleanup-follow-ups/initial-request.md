# proposit-core — batched public-API exports + cleanup follow-ups

## Product changes

## Technical changes

## Meta changes

Batched public-API exports + cleanup follow-ups for the next `@proposit/proposit-core` release.
Each unblocks a consumer (`@proposit/shared` / `proposit-server`) dropping a local re-implementation.

- **Export `isNakedQDerivationPremise` / `isNakedQTree`** from `src/lib/index.ts` so `@proposit/shared`
  drops its local re-implementation.
- ~~**Export an `isLlmStage()` predicate** so `proposit-server` deletes its local deterministic-vs-LLM
  stage set.~~ **DONE — shipped:** `isLlmStage` is now exported as a runtime value from
  `src/lib/index.ts:138` (change-request `docs/inbox/.archive/2026-06-08-pipeline-public-isllmstage-predicate.md`).
- **Surface TypeBox runtime values for `TProcessingFailure` + `TLlmTokenUsage`** from the public API so
  `@proposit/shared` replaces its local TypeBox values in one minor.
- **Dedup the `openai` provider onto the shared raw-`fetch` HTTP helper** introduced by the
  Ollama→llamacpp migration (fast-follow; gate on test coverage, else fast-follow after).
- **Fix four typedoc build warnings** (`ExpressionManager`, `TOpenAiFetch`, `TPopulateResult`,
  `TClaimCreateInput`) emitted during `pnpm run build`.

Repo: `proposit-core` (consumers: `@proposit/shared`, `proposit-server`). Publish-gated per
ORCHESTRATOR-AGENTS.md. **Migrated 2026-06-21** from the initiative ledger
(`docs/.archive/initiatives/proposit-core.md` "Cross-repo follow-ups batched for next core release";
`docs/.archive/initiatives/ARCHIVE.md` Decomposition follow-ups).

