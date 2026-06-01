# Upcoming changelog

Commit range: `v1.7.0..HEAD`.

## Documentation

- Trimmed `AGENTS.md` (the `CLAUDE.md` symlink target) from a ~45 KB reference
  wiki back to a routing file: the verbose `## Key design rules` section (grammar
  model, engine behavior, pipeline-framework version history) is replaced by a
  6-bullet "Invariants easy to violate" list plus topic routes to
  `docs/Proposit_Grammar.md`, `docs/api-reference.md`, and `docs/release-notes/`.
  173 → 112 lines, ~45 KB → ~10.5 KB.
- Repointed the `AGENTS.md` Documentation Sync trigger from `[Public-API]`
  ("Design rules and conventions sections") to `[Routing]`, so core API changes
  no longer regrow a second API reference inside the agent-instruction file.
- Ported the hierarchical-checksum protocol (`checksum` / `descendantChecksum` /
  `combinedChecksum` composition, bottom-up dirty propagation, `flushChecksums`)
  into a new "Hierarchical checksums" section in `docs/api-reference.md`.
