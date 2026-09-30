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

## Removed

- `single-stage`'s private `resolveApiKey`, which always returned `""`; the
  empty key is passed directly.
- The always-true `Value.Check({ type: "any" }, {})` choice of the turn
  pipeline's input schema, and the TypeBox imports only it used.

## Tests

- The iff-rooted axiom derivation test runs instead of being skipped. It now
  uses `populateFromAxioms`, keeps the derivation premise as a supporting
  premise, and accepts the root step.
