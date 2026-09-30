# Upcoming

## Changed

- The agent skill published in the package (`skills/proposit-core/`) is
  rewritten for the current API. `SKILL.md` and six reference files
  (`building-arguments.md`, `evaluation.md`, `grammar.md`, `persistence.md`,
  `forking-and-diffs.md`, `pipelines.md`) plus a rewritten `cli.md` replace
  `api-usage.md`, `architecture.md` and `types-schemas.md`. It now covers
  claims and the claim, citation and axiom libraries, `PropositCore`,
  four-valued evaluation, the four grammar tiers, changesets and checksums,
  forking, pipelines and the CLI; the old files described three-valued
  evaluation and had no claims. `testing.md`, which described this
  repository's own test suite, is removed.
- `README.md`, `docs/api-reference.md` and `CLI_EXAMPLES.md` corrected where
  they disagreed with the code: the `ArgumentEngine` constructor is
  `(argument, claimLookup, options?)`; `validate(tier)` returns grammar
  violations and `validateInvariants()` is the invariant sweep;
  `getPremiseType()` returns `"freeform"` or `"derivation"`;
  `populateFromCitations` and `populateFromAxioms` take the derived claim's
  id; `removeExpression` takes `deleteSubtree` and collapses parents only
  through assistive tidying; placing an operator directly under another does
  not throw; the default claim and argument types reject extra keys unless
  widened through the type parameters. Tree-building examples now use
  permissive behavior, since assistive tidying removes a new operator that has
  no children yet. The README usage examples now compile and run. The CLI
  docs use `analysis set-operator` and the `analysis-N.json` file names.
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
- Internal only, no change in behaviour or public API: three large modules
  were split. Constraint propagation (`propagateOperatorConstraints`,
  `closeUnderAcceptedOperators`) moved from `argument-evaluation.ts` to
  `src/lib/core/evaluation/propagation.ts`. `src/lib/utils/changeset.ts` became
  `changeset-merge.ts` (combining changesets and recording per-entity changes)
  and `changeset-order.ts` (`orderChangeset`). In `src/lib/pipelines/`, the
  retry policy, the stage errors, the token-usage side channel and the clock
  moved to `stage-primitives.ts`, and running one stage or the finalize moved
  from `scheduler.ts` to `stage-runner.ts`; this removes the import cycles
  between the stage modules, and the clock function is no longer written
  twice. Every old module still exports the names it exported before.
- Internal only, no change in behaviour: three very long methods are split into
  private methods of the same class. `PremiseEngine.changeOperator` hands its
  merge, in-place and split cases to one method each. `ArgumentParser.build`
  runs one method per step (parse formulas, create claims, create variables,
  filter formulas, build premises, set the conclusion, add derivation backing
  edges), and its step comments are numbered 1 to 9 without a gap.
  `PropositCore.forkArgument` moves the claim closure walk, claim cloning, the
  citation and axiom edge copies (now one method), the claim-reference rebuild
  and the fork-record creation into their own methods, and generates ids in
  the same order, so a fork produces the same ids as before.
- The 0.2.0 to 0.5.0 changelog moved from `docs/CHANGELOG.md` to
  `docs/changelogs/legacy-0.2-0.5.md`, and 0.5.0 is no longer labelled
  unreleased.
- `docs/api-reference.md` now documents `orderChangeset`: its ordering, the two
  things a store must do (write only the fields an update carries, and check a
  one-root-per-premise rule at the end of the transaction), and its known
  exceptions.
- `examples/texts/README.md` explains what the folder holds and which graph
  belongs to which text.
- CI now fails when the committed `formula-gen.js` does not match what
  `formula.peggy` generates.
- `tsconfig.json` no longer includes a path under an ignored local folder, or
  lists `eslint.config.mjs` beside the `*.mjs` pattern that already covers it.
- The pull request template asks about impact on applications that use the
  library, without naming any.

## Removed

- `single-stage`'s private `resolveApiKey`, which always returned `""`; the
  empty key is passed directly.
- The always-true `Value.Check({ type: "any" }, {})` choice of the turn
  pipeline's input schema, and the TypeBox imports only it used.
- The migration guides for 0.2.0, 0.9.0 to 0.10.0 and 0.10.0 to 0.11.0
  (`docs/migration-0.2.0.md`, `docs/migrations/`).
- `scripts/rewrite-v2-expected.ts`, a one-off script for regenerating pipeline
  test expectations that nothing referenced and that needed `tsx`, which is not
  a dev dependency.

## Tests

- The iff-rooted axiom derivation test runs instead of being skipped. It now
  uses `populateFromAxioms`, keeps the derivation premise as a supporting
  premise, and accepts the root step.
- The test tree now follows the source tree. The 24,800-line engine suite
  `test/core.test.ts` is split, block by block and unchanged, into 23 topic
  files under `test/core/` (with its shared builders in
  `test/core/fixtures.ts`), plus a few blocks that belong under `test/cli/`,
  `test/parsing/` and `test/extensions/pipelines/`. CLI tests moved to
  `test/cli/`, pipeline framework tests to `test/pipelines/`, the changeset
  utility tests to `test/changeset/`, and the IEEE citation tests to
  `test/extensions/citations/`. The pipeline tests share one deterministic id
  generator instead of three copies. Every test keeps its name and result.

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
