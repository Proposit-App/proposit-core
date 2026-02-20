import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"
import globals from "globals"

export default defineConfig([
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            globals: {
                ...globals.node,
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
        },
    },
    globalIgnores(["dist/", "node_modules/"]),
])
