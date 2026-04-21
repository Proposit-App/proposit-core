# Release Notes

## Package resolution fix for non-ESM resolvers

`package.json` now declares a `"default"` condition alongside `"import"` on every entry in its `exports` map. This lets resolvers that don't speak the `"import"` condition (notably Jest's CJS resolver) find the published dist files. No source, API, or runtime behavior changed.
