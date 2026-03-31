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
