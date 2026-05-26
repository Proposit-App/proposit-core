# Upcoming changelog

Commit range: `v1.3.0..HEAD`.

## Added

- `.githooks/pre-push` hook — verifies Prettier formatting before a push. Checks
  only the files added/modified on the current branch relative to its
  counterpart on the remote being pushed to (three-dot diff,
  `--diff-filter=ACMR`), falling back to `prettier --check .` when that
  comparison point can't be resolved (new/unpushed branch, missing remote ref,
  detached HEAD). Respects `.prettierignore`. Bypass once with
  `git push --no-verify`.
- `prepare` package script — runs `git config core.hooksPath .githooks` on
  install so the pre-push hook activates automatically after `pnpm install`.

## Removed

- `postinstall` package script (`prettier -w package.json pnpm-lock.yaml`).
  Removing it means installing `@proposit/proposit-core` as a dependency no
  longer triggers pnpm's `Ignored build scripts: @proposit/proposit-core`
  warning — `prepare` is not an install lifecycle script and never runs for
  registry consumers. Formatting is now verified at push time by the pre-push
  hook rather than auto-fixed at install time; run `pnpm prettify` to fix
  formatting manually.
