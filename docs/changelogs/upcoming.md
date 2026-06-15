# Upcoming changelog

Commit range: `v1.11.2..HEAD`.

## Fixes

- `fix(cli)`: build expression-tree commands (`expressions create`,
  `expressions insert`) in permissive mode so partial intermediate trees
  persist. The CLI builds a tree across separate process invocations
  (create the operator, then attach each child); under the default
  assistive behavior the post-mutation AN hook removed the freshly-created
  childless operator (AN-3) or promoted a single-child operator before the
  next invocation could attach a child, leaving an empty premise and
  breaking the documented top-down build. The completed tree is still
  tidied explicitly via `repair` / `normalize`. Adds
  `test/integration/expressions-create.test.ts` and restores the
  `scripts/smoke-test.sh` step-5 build.

## Refactors

- **`refactor(openai)`** (`9c3ead1..de685a5`): Split the 1,589-line
  `src/extensions/openai/provider.ts` into focused, dependency-layered
  modules with no public-API or behavior change. SSE/response parsing
  moved to `openai-parsing.ts`; HTTP-error classification
  (`classifyHttpError`, `formatIncompleteMessage`) moved into `errors.ts`;
  tool translation + schema-name derivation to `openai-tools.ts`; HTTP
  transport to `openai-http.ts`; the public retrieval API
  (`retrieveResponse`, `reconnectStream`, `cancelResponse`,
  `submitBackgroundResponse` + `TRetrievedResponse`/`TResponseStatus`) to
  `openai-retrieval.ts`. The shared `DEFAULT_BASE_URL` constant moved to
  `types.ts`. The barrel (`index.ts`) re-exports the identical symbol set,
  so consumers see no change; `provider.ts` is now ~457 lines.
