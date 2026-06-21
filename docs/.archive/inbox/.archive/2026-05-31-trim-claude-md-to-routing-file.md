# Trim `CLAUDE.md` / `AGENTS.md` from a wiki back to a routing file

## Context

`AGENTS.md` (with `CLAUDE.md` symlinked to it) had grown to **173 lines / ~45 KB**. The
`brain-style:claude-md` skill's core principle is that a `CLAUDE.md` should be
**minimal — a routing file first, a reference file second**: inline only what is
useful for the average task, and route everything else to where it already
lives. This file violates that: roughly 60% of it is API reference and design
narrative, not agent instruction.

Filed by the workspace orchestrator (request originated from the human). The
orchestrator does not edit child-repo source/instruction files directly — this
inbox doc is the handoff. Process via `skill-cefailures:process-inbox`.

## Problem

The `## Key design rules` section (lines ~59–134) is ~75 lines across three
sub-sections — **Grammar model**, **Engine behavior + auto-normalization**, and
**Pipeline framework**. Almost all of it describes _how the system works and how
the code is organized_: per-error-code mechanics, claim/citation/axiom library
internals, evaluation defaults, fork-BFS details, checksum protocol, and
version-by-version pipeline history. This duplicates content that already has a
canonical home:

- `docs/Proposit_Grammar.md` (§2–§3) — the grammar model + full rule inventory
- `docs/api-reference.md` — engine/library/standalone API reference
- `docs/release-notes/v*.md` — the "As of 1.x.0…" pipeline-framework narrative

An agent doing an average task does not need this inline; when it does, the
routes already point at the authoritative source.

## Root cause (fix this too, or the section regrows)

The file's own Documentation Sync table contains:

```
- `CLAUDE.md` [Public-API] — Design rules and conventions sections
```

This trigger designates the design-rules prose as a **tracked public-API
surface**, so every core API change has been appended _here_, growing a second
API reference that shadows the already-tracked `docs/api-reference.md`. Trimming
the prose without repointing this trigger means it will refill over time. The
trigger must be rewritten so `CLAUDE.md` only carries **routing pointers + a
short invariants list**, with the authoritative detail owned by
`docs/api-reference.md` and `docs/Proposit_Grammar.md`.

## Proposed change

### Keep (genuine agent value — leave essentially as-is)

- `## Repository scope and identity` incl. the "Push back on requests to…" list
  — boundaries/guardrails, exactly what belongs in a routing file.
- `## Generic instructions`, `## Change requests`, `## Commands`.
- `## Testing`, `## Linting notes`, `## ESM import requirements`,
  `## Naming conventions` — short, real gotchas (esp. the `.js`-suffix rule).
- `## Documentation Sync` — keep the trigger table (it's the doc-sync skill's
  required section), but edit the `CLAUDE.md` line (see below).

### Cut / route (the ~75-line `## Key design rules` body)

Replace the three verbose sub-sections with a single short
**"Invariants easy to violate"** list — terse one-liners, each with a keyword-
bearing route to the canonical doc. Suggested distilled set (tune as you see
fit; these are the genuinely non-obvious "you'll break it if you don't know it"
rules, stripped of mechanism and version history):

- Mutations throw only on Structural violations; Evaluable/Derivable/Presentable
  surface via `engine.validate(tier)` and never throw — see grammar tiers in
  `docs/Proposit_Grammar.md`.
- `src/lib/` carries **zero** third-party SDK imports; SDK-coupled code lives in
  `src/extensions/` as optional peer deps (grep-proof boundary).
- Never `import { randomUUID } from "node:crypto"` in `src/lib/` — use the
  injected `generateId` from engine options.
- `orderChangeset` (`src/lib/utils/changeset.ts`) emits FK-safe persistence
  ordering; it is an invariant — flag any change touching entity relationships.
- Core owns no application metadata (user IDs, timestamps, display text) —
  applications extend core types via generic parameters.
- Grammar-rule codes (`TGrammarRuleCode`) and engine-error codes are stable wire
  format — renames require a coordinated publish.

For the full grammar model, engine/library API, and pipeline framework, route
to `docs/Proposit_Grammar.md`, `docs/api-reference.md`, and
`docs/release-notes/` respectively, with topic keywords on each route so the
agent knows when to follow it.

### Repoint the doc-sync trigger

Change the Documentation Sync entry from:

```
- `CLAUDE.md` [Public-API] — Design rules and conventions sections
```

to something like (the tracked file is `AGENTS.md`; `CLAUDE.md` is a symlink to
it, so the trigger names `AGENTS.md`):

```
- `AGENTS.md` [Routing] — Repo scope, the invariants list, and routing pointers
  (`CLAUDE.md` is a symlink to this file). Fires only when a NEW easy-to-violate
  invariant or a NEW canonical doc route is introduced — NOT when an API detail
  changes (that belongs to `docs/api-reference.md`).
```

This is the load-bearing change: it removes the incentive that grew the file.

## Optional (nice-to-have)

The file uses domain terms without definition (tier names, `naked-Q`, AN rules,
`TViolation`). The `brain-style:claude-md` skill lists **Project Terminology**
as a recommended section. Consider a ~5-line glossary that routes to
`docs/Proposit_Grammar.md` for the full definitions. Only add if it nets out
shorter than the confusion it removes.

## Impact

- **Size:** 173 → ~110 lines. The line count lands above the original ~70–80
  guess because the genuinely-keep sections (repo scope/guardrails, generic
  instructions, commands, testing/linting/ESM/naming, and the required
  Documentation Sync table) already total ~95 lines on their own. The real win
  is bytes: ~45 KB → ~10.5 KB (~77% smaller), since the deleted design-rules
  prose was a small number of very long lines.
- **No behavior change.** Documentation restructure; no library code, no public
  API, no test changes. (Docs-only — exempt from the consumer-side
  publish-validation gate.) One doc-only addition: the hierarchical-checksum
  protocol was ported into `docs/api-reference.md` (see below).
- **Consumers unaffected** — `AGENTS.md` is agent-facing, not a published
  artifact.
- Detail is not lost — it relocates to (or already exists in) the canonical docs
  that the routes point at. Before deleting a bullet, confirm its content is
  actually present in the target doc; if a specific invariant exists _only_ in
  `AGENTS.md` today, port it to `docs/api-reference.md` (or the grammar doc)
  rather than dropping it. **Porting performed:** a presence audit found every
  routed-away invariant already covered except the three-field hierarchical
  checksum protocol (`checksum` / `descendantChecksum` / `combinedChecksum`,
  bottom-up dirty propagation, `flushChecksums`), which was added as a new
  "Hierarchical checksums" section in `docs/api-reference.md`. `orderChangeset`
  is retained inline as a distilled one-liner routing to its source file.

## Acceptance criteria

- `## Key design rules` is replaced by a short "Invariants easy to violate" list
  (≈6 one-liners) plus routes; no version-history ("As of 1.x.0…") prose remains
  in `CLAUDE.md`.
- The `AGENTS.md` Documentation Sync trigger is repointed away from "Design
  rules and conventions sections."
- Every routed-away invariant is verified present in its target doc (port any
  that are missing).
- `pnpm run lint` passes (prettier formatting on the rewritten markdown).
- File lands around ~110 lines / ~10 KB (line target relaxed — see Impact).
