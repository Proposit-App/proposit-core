# Upcoming

## Changed

- Dropped the optional `openai` peer dependency. Neither LLM provider imports
  the SDK; both call their endpoints with plain `fetch`.
- Comments across `src/` and `test/` now describe behaviour rather than
  history, and no longer carry planning or review labels. Wrong comments about
  which HTTP statuses map to which OpenAI error class, and where the providers'
  error classes are exported from, are corrected.
- The structural, derivable and presentable grammar validators each had their
  own copy of the function that maps every expression to its children sorted by
  position, and three validators built the id-to-expression map inline. Both
  now live in one place, `src/lib/grammar/validators/tree-views.ts`
  (`buildChildMap`, `buildExpressionsById`). The copies were the same algorithm,
  so validation results are unchanged. The unsorted child map built inside
  `repair.ts` stays where it is, because sorting it would change the order in
  which the D-3 repair removes expressions.
- `ArgumentParser` and `populateFromGrounding` both switched the engine to
  `permissive` for an incremental tree build, restored the previous behavior,
  then ran one `normalize()` pass, restoring the behavior on error as well. That
  sequence is now one internal helper, `buildWithoutAutoNormalization`
  (`src/lib/grammar/permissive-build.ts`). It switches only when the engine
  starts out `assistive`, as `populateFromGrounding` did; the parser always
  builds a new engine with the default `assistive` behavior, so it makes the
  same calls as before. Nothing is added to the public API.
- Internal only, no change in behaviour: `ArgumentEngine` now connects each
  premise engine to its argument, checks a new variable's argument id and
  version, and stores a new variable through shared private helpers, and
  `ExpressionManager` stores every new expression through one private helper,
  where each of these steps used to be written out at every call site.
- The OpenAI and chat-completions providers share one TypeBox-to-JSON-Schema
  walker (`src/extensions/structured-output/typebox-converter.ts`); each passes
  in only how it writes an object. `typeboxToOpenAiSchema` and
  `typeboxToJsonSchema` produce the same output and the same errors as before.
- The two providers share the sorting of a failed HTTP status into a category,
  and the abort check, in `src/extensions/llm-http/errors.ts`. Each provider's
  `classifyHttpError` still returns its own error classes, with the same
  messages. None of the shared code is exported.
- The CLI no longer repeats the same small pieces of code across its command
  files. The check that refuses to change a published argument version, the
  check that a premise exists, and the conversion of a caught error to its
  message now live once in `src/cli/guards.ts`. The expression commands load
  their premise through `requireHydratedPremise` in `src/cli/engine.ts`. The
  analysis commands read `true`/`false`/`unset` and
  `accepted`/`rejected`/`unset` through one parser each. Command output, error
  messages and exit codes are unchanged.
- Internal files moved to where their contents belong; the public API and
  behaviour are unchanged. The derivation-premise shape check moved to
  `src/lib/grammar/derivation-validation.ts`; `src/lib/consts.ts`, which held
  only checksum configuration, is now `src/lib/checksum-config.ts`;
  `shortenToLength` moved from `parsing/` to `src/lib/utils/strings.ts`; the
  expression manager's helper files moved into
  `src/lib/core/expression-manager/`; the CLI's `llm/index.ts` became
  `src/cli/llm.ts` and its diff renderer moved to `src/cli/diff-renderer.ts`.
  The ingestion input schema and the two ingestion pipeline ids now each live
  in one file (`src/extensions/pipelines/ingestion/input-schema.ts` and
  `pipeline-ids.ts`) that the scholar and scribe factories and
  `getCanonicalStageIds` import. The IEEE citation segment types moved to
  `segment-types.ts`, removing an import cycle; `formatting.ts` still exports
  them. The root export file is grouped into commented sections.
- Internal only, no change in behaviour or public API: the ingestion finalize
  step, `finalize-response-v2.ts`, is split into one file per job under
  `src/extensions/pipelines/base/finalize/`: `citation-type.ts` (cleaning up
  the model's citation-type guess), `source-anchor-resolution.ts` (resolving
  claims' source anchors and the `SOURCE_ANCHOR_NOTE_CODES` notes),
  `titles.ts` (composing premise and argument titles) and `assembler.ts`
  (`finalizeResponseV2` itself). The functions moved unchanged, and
  `finalize-response-v2.ts` re-exports the same public names from the same
  subpath.
- The 33 IEEE segment templates are now built from small shared pieces (the
  authors list, the "Accessed:" date, the "[Online]. Available:" link, the
  optional doi, edition, isbn, page and version parts) instead of repeating the
  same objects by hand, and they live in `src/extensions/citations/ieee/templates/`,
  one file per group of reference types. Each piece returns new objects every
  time, so no two templates share one. `segment-templates.ts` still exports
  every template and instruction type under the same names, and every template
  holds exactly the same instructions, so rendered citations are unchanged.

## Removed

- `single-stage`'s private `resolveApiKey`, which always returned `""`; the
  empty key is passed directly.
- The always-true `Value.Check({ type: "any" }, {})` choice of the turn
  pipeline's input schema, and the TypeBox imports only it used.

## Tests

- The iff-rooted axiom derivation test runs instead of being skipped. It now
  uses `populateFromAxioms`, keeps the derivation premise as a supporting
  premise, and accepts the root step.

## Fixed

- `repair` wrote its formula buffers to a published version, the one command
  that changes a version without checking. It now refuses with the same
  "is published and cannot be modified" error as the others, just before it
  would write; `--dry-run` still reports on a published version, since it only
  reads. Pinned by `test/cli/repair-command.test.ts`.
- `analysis show` and `analysis reset` reported a missing analysis file as
  `Analysis file "…" not found.` from inside the file read, and `reset` checked
  its `--value` first. Both now check that the file exists straight after
  resolving its name, like `set`, `set-operator` and `delete`, and report
  `Analysis file "…" does not exist.`. Pinned by
  `test/cli/analysis-file-checks.test.ts`.
