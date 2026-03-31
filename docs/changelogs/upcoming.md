# Changelog

<changes starting-hash="2cc56a3" ending-hash="dd27d0f">

## Changed

- Minimum Node.js version raised from `>=20` to `>=22.3.0` in `package.json` `engines` field. The CLI uses `fetch` (stable Node 21+) and `fs/promises.cp` (stable Node 22.3.0+).

## Added

- Added `eslint-plugin-n` dev dependency for Node.js version-aware linting
- ESLint browser-compat rules for `src/lib/**` and `src/extensions/**`:
  - `no-restricted-imports` bans all Node.js built-in module imports (both `node:*` prefix and bare names)
  - `no-restricted-globals` bans Node-only globals (`process`, `Buffer`, `__dirname`, `__filename`, `require`, `global`)
  - Globals changed from `globals.node` to `globals.es2021` + `globals["shared-node-browser"]`
- ESLint Node version rules for `src/cli/**`:
  - `n/no-unsupported-features/node-builtins` enforces Node 22.3.0 API boundaries
  - `n/prefer-node-protocol` enforces `node:` prefix on built-in imports
- ESLint globals override for `test/**` with `globals.node` (no restrictions)

</changes>
