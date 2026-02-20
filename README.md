# TypeScript Shared Library Boilerplate

This folder contains a starter template for a standalone TypeScript shared-library project aligned with the tooling used in this repository.

## Included

- TypeScript (`tsconfig.json`, `tsconfig.build.json`)
- ESLint flat config (`eslint.config.mjs`) with type-aware `typescript-eslint` rules
- Prettier (`.prettierrc.json`, `.prettierignore`)
- Vitest setup (example test + globals in TypeScript config)
- Package scripts for `build`, `typecheck`, `lint`, and `test`

## Usage

1. Copy this folder to a new repository.
2. Run `pnpm install`.
3. Run `pnpm run check`-style commands as needed:
    - `pnpm run typecheck`
    - `pnpm run lint`
    - `pnpm run test`
    - `pnpm run build`

## Notes

- This intentionally excludes React, Next.js, and Postgres-specific setup.
- Path alias `@/*` maps to `src/*`.
