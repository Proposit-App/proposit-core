# Upcoming

## Changed

- Dropped the optional `openai` peer dependency. Neither LLM provider imports
  the SDK; both call their endpoints with plain `fetch`.
- Comments across `src/` and `test/` now describe behaviour rather than
  history, and no longer carry planning or review labels. Wrong comments about
  which HTTP statuses map to which OpenAI error class, and where the providers'
  error classes are exported from, are corrected.

## Removed

- `single-stage`'s private `resolveApiKey`, which always returned `""`; the
  empty key is passed directly.
- The always-true `Value.Check({ type: "any" }, {})` choice of the turn
  pipeline's input schema, and the TypeBox imports only it used.

## Tests

- The iff-rooted axiom derivation test runs instead of being skipped. It now
  uses `populateFromAxioms`, keeps the derivation premise as a supporting
  premise, and accepts the root step.
