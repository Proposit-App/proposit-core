# Browser-Compat Linting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ESLint rules that prevent Node-specific code in library files (`src/lib/`, `src/extensions/`) and enforce Node 20 API boundaries in CLI files (`src/cli/`).

**Architecture:** Install `eslint-plugin-n`, add file-scoped ESLint overrides for library (browser-compat) and CLI (Node version compat), restructure globals from top-level `globals.node` to scoped sets.

**Tech Stack:** ESLint flat config, `eslint-plugin-n`, `globals` package (`shared-node-browser`, `es2021`, `node` sets)

---

### Task 1: Install `eslint-plugin-n` and add `engines` field

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the plugin**

Run:

```bash
pnpm add -D eslint-plugin-n
```

- [ ] **Step 2: Add `engines` field to `package.json`**

Add after the `"type": "module"` line in `package.json`:

```json
"engines": {
    "node": ">=20"
},
```

This tells `eslint-plugin-n` which Node version to target for `n/no-unsupported-features/node-builtins`.

- [ ] **Step 3: Verify installation**

Run:

```bash
pnpm ls eslint-plugin-n
```

Expected: Shows `eslint-plugin-n` with a version number.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add eslint-plugin-n and engines field"
```

---

### Task 2: Restructure ESLint globals and add library browser-compat rules

**Files:**

- Modify: `eslint.config.mjs`

The current config applies `globals.node` at the top level. We need to:

1. Replace the top-level globals with `globals.es2021` (JS builtins only)
2. Add a library override for `src/lib/**` and `src/extensions/**` with `globals["shared-node-browser"]`, `no-restricted-imports`, and `no-restricted-globals`
3. Add a CLI override for `src/cli/**` with `globals.node` and `eslint-plugin-n` rules

- [ ] **Step 1: Replace the full `eslint.config.mjs` content**

Replace the entire file with:

```javascript
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"
import globals from "globals"
import checkFile from "eslint-plugin-check-file"
import nodePlugin from "eslint-plugin-n"

// All Node.js built-in module names (bare imports without node: prefix).
// Used by no-restricted-imports to prevent Node built-in usage in library code.
const nodeBuiltinModules = [
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
]

export default defineConfig([
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            globals: {
                ...globals.es2021,
            },
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            semi: "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-empty-object-type": "warn",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": [
                "error",
                { checksVoidReturn: { arguments: true, attributes: false } },
            ],
            "@typescript-eslint/require-await": "warn",
            "@typescript-eslint/no-unsafe-assignment": "warn",
            "prefer-promise-reject-errors": "off",
            "@typescript-eslint/prefer-promise-reject-errors": [
                "error",
                { allowThrowingAny: true, allowThrowingUnknown: false },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    caughtErrors: "all",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],
            "@typescript-eslint/no-inferrable-types": "warn",
            "@typescript-eslint/consistent-type-definitions": "off",
            "@typescript-eslint/naming-convention": [
                "error",
                // Default: camelCase for everything not specifically overridden
                { selector: "default", format: ["camelCase"] },
                // Destructured variables: no enforcement (source determines naming)
                {
                    selector: "variable",
                    modifiers: ["destructured"],
                    format: null,
                },
                // const: camelCase, UPPER_CASE (true constants), PascalCase (Typebox schemas)
                {
                    selector: "variable",
                    modifiers: ["const"],
                    format: ["camelCase", "UPPER_CASE", "PascalCase"],
                    leadingUnderscore: "allowSingleOrDouble",
                },
                // Non-const variables: camelCase only
                {
                    selector: "variable",
                    format: ["camelCase"],
                    leadingUnderscore: "allow",
                },
                // Functions: camelCase
                { selector: "function", format: ["camelCase"] },
                // Parameters: camelCase, allow leading underscore for unused
                {
                    selector: "parameter",
                    format: ["camelCase"],
                    leadingUnderscore: "allow",
                },
                // Override methods: no enforcement (can't control inherited names)
                {
                    selector: "classMethod",
                    modifiers: ["override"],
                    format: null,
                },
                // Classes: PascalCase
                { selector: "class", format: ["PascalCase"] },
                // Type aliases and interfaces: T-prefixed PascalCase
                {
                    selector: ["typeAlias", "interface"],
                    format: ["PascalCase"],
                    prefix: ["T"],
                },
                // Type parameters: PascalCase (no prefix — allows T, K, V, TArg, etc.)
                { selector: "typeParameter", format: ["PascalCase"] },
                // Enum names: PascalCase
                { selector: "enum", format: ["PascalCase"] },
                // Enum members: UPPER_CASE
                { selector: "enumMember", format: ["UPPER_CASE"] },
                // Object literal properties: no enforcement (JSON schemas, external APIs)
                { selector: "objectLiteralProperty", format: null },
                // Imports: no enforcement (external package naming)
                { selector: "import", format: null },
            ],
        },
    },
    // .mjs files (e.g. this config file) are not part of the TypeScript project,
    // so type-aware rules cannot be applied to them.
    {
        files: ["*.mjs"],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ["src/**/*.ts", "test/**/*.ts"],
        plugins: { "check-file": checkFile },
        rules: {
            "check-file/filename-naming-convention": [
                "error",
                { "**/*.ts": "KEBAB_CASE" },
                { ignoreMiddleExtensions: true },
            ],
        },
    },
    // Browser-compat rules for library and extension code.
    // These files must work in both Node 20+ and modern browsers.
    {
        files: ["src/lib/**/*.ts", "src/extensions/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals["shared-node-browser"],
            },
        },
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: nodeBuiltinModules.map((name) => ({
                        name,
                        message:
                            "Node.js built-in modules are not allowed in browser-compatible library code. Use src/cli/ for Node-specific code.",
                    })),
                    patterns: [
                        {
                            group: ["node:*"],
                            message:
                                "Node.js built-in modules are not allowed in browser-compatible library code. Use src/cli/ for Node-specific code.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "process",
                    message:
                        "process is Node-only. Do not use in browser-compatible library code.",
                },
                {
                    name: "Buffer",
                    message:
                        "Buffer is Node-only. Use Uint8Array or ArrayBuffer for cross-platform code.",
                },
                {
                    name: "__dirname",
                    message:
                        "__dirname is CJS/Node-only. Do not use in browser-compatible library code.",
                },
                {
                    name: "__filename",
                    message:
                        "__filename is CJS/Node-only. Do not use in browser-compatible library code.",
                },
                {
                    name: "require",
                    message:
                        "require is CJS/Node-only. Use ES module imports in browser-compatible library code.",
                },
                {
                    name: "global",
                    message:
                        "global is Node-only. Use globalThis for cross-platform code.",
                },
            ],
        },
    },
    // Node-specific rules for CLI code.
    // CLI runs on Node 20+ only — enforce version boundaries and node: prefix.
    {
        files: ["src/cli/**/*.ts"],
        plugins: { n: nodePlugin },
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "n/no-unsupported-features/node-builtins": "error",
            "n/prefer-node-protocol": "error",
        },
    },
    // Test files run on Node only — no browser-compat restrictions.
    {
        files: ["test/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    globalIgnores([
        "dist/",
        "node_modules/",
        ".untracked/",
        ".worktrees/",
        ".claude/",
        "src/lib/core/parser/formula-gen.js",
    ]),
])
```

Key changes from the current config:

- Import `nodePlugin` from `eslint-plugin-n`
- Top-level globals changed from `globals.node` to `globals.es2021`
- New library override: `src/lib/**/*.ts` and `src/extensions/**/*.ts` with `globals["shared-node-browser"]`, `no-restricted-imports`, `no-restricted-globals`
- New CLI override: `src/cli/**/*.ts` with `globals.node`, `n/no-unsupported-features/node-builtins`, `n/prefer-node-protocol`
- New test override: `test/**/*.ts` with `globals.node`

- [ ] **Step 2: Run lint to verify no regressions**

Run:

```bash
pnpm run lint
```

Expected: All files pass. The library code is already clean and should not trigger any new rules. If there are failures, they reveal pre-existing issues that need fixing (unlikely based on the grep audit).

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "feat: add browser-compat linting for library and Node version linting for CLI"
```

---

### Task 3: Verify the rules catch violations (manual smoke test)

This task creates a temporary test file to verify the rules fire correctly, then removes it. This is not a permanent test — it's a one-time verification.

**Files:**

- Create (temporary): `src/lib/utils/test-browser-compat-lint.ts`
- Create (temporary): `src/cli/test-node-version-lint.ts`

- [ ] **Step 1: Create a temporary library file with Node violations**

Create `src/lib/utils/test-browser-compat-lint.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-unused-vars */
import fs from "node:fs"
import path from "path"

const dir = __dirname
const buf = Buffer.from("hello")
const env = process.env.HOME
```

- [ ] **Step 2: Run lint on the test file and verify violations**

Run:

```bash
pnpm eslint src/lib/utils/test-browser-compat-lint.ts 2>&1 || true
```

Expected: At least these errors:

- `no-restricted-imports`: `"node:fs"` flagged (pattern match)
- `no-restricted-imports`: `"path"` flagged (paths list)
- `no-restricted-globals`: `__dirname` flagged
- `no-restricted-globals`: `Buffer` flagged
- `no-restricted-globals`: `process` flagged

- [ ] **Step 3: Delete the temporary library test file**

```bash
rm src/lib/utils/test-browser-compat-lint.ts
```

- [ ] **Step 4: Create a temporary CLI file to test `n/prefer-node-protocol`**

Create `src/cli/test-node-version-lint.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-unused-vars */
import path from "path"

const p = path.join("a", "b")
```

- [ ] **Step 5: Run lint on the CLI test file and verify violations**

Run:

```bash
pnpm eslint src/cli/test-node-version-lint.ts 2>&1 || true
```

Expected: `n/prefer-node-protocol` error for `"path"` (should be `"node:path"`).

- [ ] **Step 6: Delete the temporary CLI test file**

```bash
rm src/cli/test-node-version-lint.ts
```

- [ ] **Step 7: Run full lint to confirm clean**

Run:

```bash
pnpm run lint
```

Expected: All files pass with no errors.

- [ ] **Step 8: Run full check to confirm nothing else broke**

Run:

```bash
pnpm run check
```

Expected: Typecheck, lint, test, and build all pass.
