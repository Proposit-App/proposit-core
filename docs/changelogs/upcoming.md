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
