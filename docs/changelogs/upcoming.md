# upcoming changelog

- Added `scripts/first-time-setup.sh`, the per-repo tier of the workspace
  onboarding flow (invoked by the orchestration repo's `scripts/setup.sh`). It
  installs nothing: it checks prerequisites (node ≥ 22.3, pnpm, `node_modules/`),
  confirms `core.hooksPath` is `.githooks` (repairing it only if an install
  skipped the `prepare` script), then runs `pnpm run check` and
  `bash scripts/smoke-test.sh`. Idempotent, exits non-zero on any failure.
