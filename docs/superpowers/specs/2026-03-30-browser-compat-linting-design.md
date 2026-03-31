# Browser-Compat Linting Design

## Goal

Ensure all code in `src/lib/` and `src/extensions/` works in both Node.js 20+ and modern browsers. Ensure CLI code in `src/cli/` stays within Node 20 API boundaries. Enforce via ESLint rules that fail the lint check.

## Scope

| Directory           | Environment           | Enforcement                                        |
| ------------------- | --------------------- | -------------------------------------------------- |
| `src/lib/**`        | Node 20+ and browsers | No Node built-in imports, no Node-only globals     |
| `src/extensions/**` | Node 20+ and browsers | Same as `src/lib/`                                 |
| `src/cli/**`        | Node 20+ only         | No APIs newer than Node 20, enforce `node:` prefix |
| `test/**`           | Node only             | No restrictions (test runner is Node)              |

## Changes

### 1. Add `eslint-plugin-n` dev dependency

```bash
pnpm add -D eslint-plugin-n
```

### 2. Add `engines` field to `package.json`

```json
"engines": { "node": ">=20" }
```

This is read by `eslint-plugin-n` to determine the Node version target for `n/no-unsupported-features/node-builtins`.

### 3. ESLint config — library override (`src/lib/**`, `src/extensions/**`)

Add a file-scoped override with two rules:

**`no-restricted-imports`** (ESLint built-in) bans Node built-in module imports:

- Pattern `node:*` catches all `node:`-prefixed imports
- Explicit list of bare module names catches unprefixed imports:
  `assert`, `assert/strict`, `async_hooks`, `buffer`, `child_process`, `cluster`, `console`, `constants`, `crypto`, `dgram`, `diagnostics_channel`, `dns`, `dns/promises`, `domain`, `events`, `fs`, `fs/promises`, `http`, `http2`, `https`, `inspector`, `inspector/promises`, `module`, `net`, `os`, `path`, `path/posix`, `path/win32`, `perf_hooks`, `process`, `punycode`, `querystring`, `readline`, `readline/promises`, `repl`, `stream`, `stream/consumers`, `stream/promises`, `stream/web`, `string_decoder`, `sys`, `timers`, `timers/promises`, `tls`, `trace_events`, `tty`, `url`, `util`, `util/types`, `v8`, `vm`, `wasi`, `worker_threads`, `zlib`

Error message: `"Node.js built-in modules are not allowed in browser-compatible library code. Use src/cli/ for Node-specific code."`

**`no-restricted-globals`** (ESLint built-in) bans Node-only globals:

- `process` — Node-only; no browser equivalent
- `Buffer` — Node-only; use `Uint8Array` or `ArrayBuffer` in cross-platform code
- `__dirname` — CJS/Node-only
- `__filename` — CJS/Node-only
- `require` — CJS/Node-only
- `global` — Node-only; use `globalThis`

Error message per global explaining the restriction.

**Globals change:** Switch from `globals.node` to a combination that reflects what's available in both environments. Since `globals.node` includes Node-specific identifiers, library files should not inherit it. Use `globals.browser` or a targeted subset. The TypeScript compiler (via `tsconfig.json` `lib` settings) already constrains available types, so the ESLint globals setting is primarily about suppressing `no-undef` for legitimate cross-platform globals like `globalThis`, `crypto`, `structuredClone`, `URL`, etc.

### 4. ESLint config — CLI override (`src/cli/**`)

Add a file-scoped override with:

**`n/no-unsupported-features/node-builtins`** — set to `"error"`. Reads the `engines` field from `package.json` to determine minimum Node version. Flags any use of Node APIs introduced after Node 20.

**`n/prefer-node-protocol`** — set to `"error"`. Enforces the `node:` prefix on built-in imports (e.g., `import fs from "node:fs"` instead of `import fs from "fs"`). This is already the convention in the codebase; this rule locks it in.

### 5. Globals restructuring

Current config applies `globals.node` at the top level. Restructure to:

- **Top-level:** Only `globals.es2021` (or similar) — safe everywhere
- **`src/cli/**`override:** Add`globals.node` — full Node global access
- **`src/lib/**`, `src/extensions/**`:** No additional globals beyond ES baseline. The `no-restricted-globals` rule provides a safety net.

This way, a developer who types `process.` in library code will see both an ESLint error and no autocomplete suggestion for it.

### 6. No code changes required

The library code is already clean:

- No `node:*` imports in `src/lib/` or `src/extensions/`
- No `process`, `Buffer`, `__dirname`, `__filename`, `require`, or `global` usage
- `globalThis.crypto.randomUUID()` is a Web Crypto API (available in browsers and Node 20+)

## What this catches

| Mistake                                  | Rule                                      |
| ---------------------------------------- | ----------------------------------------- |
| `import fs from "node:fs"` in library    | `no-restricted-imports` (pattern)         |
| `import { join } from "path"` in library | `no-restricted-imports` (paths)           |
| `process.env.FOO` in library             | `no-restricted-globals`                   |
| `Buffer.from(...)` in library            | `no-restricted-globals`                   |
| `require("something")` in library        | `no-restricted-globals`                   |
| `global.something` in library            | `no-restricted-globals`                   |
| Using a Node 22+ API in CLI              | `n/no-unsupported-features/node-builtins` |
| `import fs from "fs"` in CLI (no prefix) | `n/prefer-node-protocol`                  |

## Files modified

1. `package.json` — add `eslint-plugin-n` to `devDependencies`, add `engines` field
2. `eslint.config.mjs` — add plugin import, restructure globals, add library and CLI overrides
