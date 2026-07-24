# proposit-core — Agent Guide

## Repository scope and identity

`proposit-core` is a standalone open-source TypeScript library implementing a propositional-logic engine, with a CLI and optional extensions. Published as `@proposit/proposit-core`. The library is designed to be installable and usable on its own and has no inter-project dependencies within this organization.

**This repo owns:**

- The propositional-logic AST, grammar, engine, and mutation primitives
- The four-tier grammar model and validator implementations
- The grammar wire-format codes (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) and engine-error codes
- The on-disk snapshot schema (`TPropositCoreSnapshot` and library wrappers) and hierarchical checksum protocol
- The pipeline framework (DAG runtime, retry / circuit-breaker) and the abstract `TLlmProvider` interface — shipped as 1.1.0+ public API
- The CLI — shipped as a `proposit-core` bin (`pnpm cli --` invokes it locally); the only execution surface this repo distributes
- Optional extensions under `src/extensions/` (LLM providers, reference-type schemas, default ingestion pipelines, basic argument schemas), shipped as subpath exports. SDK-coupled extensions declare their SDK as an optional peer dependency.

**This repo does NOT own:**

- Any concept of user identity, sessions, or auth — the engine has no notion of "user"
- Deployment infrastructure: web server, mobile build, hosted service. The CLI is the sole exception; the library otherwise leaves runtime entirely to its consumer.
- HTML, React, or any front-end UI logic. The library may expose helpers that make the engine easier to use from a UI context, but the UI itself is always the consumer's concern.
- Client/server transport schemas or API contracts
- Dependencies on, or knowledge of, any other library in this organization

**Push back on requests to:**

- Add a dependency on, or import from, any other library in this organization
- Add user-, account-, or session-aware code paths
- Add framework-specific helpers (React hooks, Next.js route handlers, Expo modules)
- Make the library depend on a hosted service to function
- Move cross-runtime concerns (shared schemas, API client utilities) into this library

## Generic instructions

- Git commit messages should not include any co-authoring content
- When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.
- All TypeScript development work must use the `brain-style` skill (specifically its TypeScript sub-skill). Invoke it before writing or reviewing any TypeScript code to ensure naming conventions, casing rules, and style guidelines are followed. Use the TypeScript language server (LSP tool) to verify types, check for errors, and navigate definitions during development.
- After completing a major set of changes, offer to cut a new version via `pnpm version patch|minor|major`. Use `patch` for most changes, `minor` for major feature work, and `major` only when explicitly instructed. When versioning, rename `docs/release-notes/upcoming.md` to `docs/release-notes/v{version}.md` and `docs/changelogs/upcoming.md` to `docs/changelogs/v{version}.md`, then start fresh `upcoming.md` files for subsequent work. After the version bump commit, create a git tag at that commit: `git tag v{version}`. This tag triggers the release and docs deployment workflows.

## Researching the OpenAI API

The OpenAI provider lives in `src/extensions/openai/`. When you need to verify OpenAI behavior, prefer OpenAI's LLM-formatted doc indexes — plain-markdown link lists where each entry links a `.md` you can fetch directly (e.g. `curl`):

- `https://developers.openai.com/api/llms.txt` — top-level index spanning BOTH the conceptual guides (**Docs**) and the per-endpoint **Reference** (request/response params, e.g. Responses → Create / Retrieve / Cancel). Start here when you need exact endpoint/parameter behavior or aren't sure which half you need; it also links the focused sub-indexes and the full-text exports.
- `https://developers.openai.com/api/docs/llms.txt` — guides / concepts / tutorials only (how-to: background mode, streaming, structured outputs, migration). Smaller; use for "how does feature X work" without endpoint-reference noise.
- `…/reference/llms.txt` is the reference-only index; the `…/llms-full.txt` variants are single-file full-content exports (use when you want everything inline rather than following links).

Opt-in live integration suites exercise the provider against the real Responses API (and cost tokens). They are `describe.skip`-ed unless `RUN_LIVE_LLM_TESTS=1` AND `OPENAI_API_KEY` are both set — CI sets neither. Run them with: `RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=sk-... pnpm exec vitest run test/extensions/openai/provider-live.test.ts test/extensions/openai/provider-live-background-stream.test.ts` (the background-stream suite covers mid-flight id + disconnect-survival via `reconnectStream` — passive `retrieveResponse` polling does NOT drive a dropped background response to completion; only reconnect-and-stream does).

## Change requests

Incoming cross-repo change requests and work items are tracked through `tcw work` (the Work axis of TCW), not a hand-managed folder. A request delegated from the root or escalated from a sibling arrives in this node's `tcw` inbox; adopt it with `tcw work inbox list` → `tcw work inbox show <entry>` → `tcw work inbox accept <entry>`, which converts it into a durable backlog item you then plan and drive. See the root `AGENTS.md` for the cross-node flow.

## Commands

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # prettier --check + eslint
pnpm run prettify    # prettier --write (auto-fix formatting)
pnpm run test        # vitest run
pnpm run build       # generate:parser (peggy) + tsc -p tsconfig.build.json → dist/ + typedoc
pnpm run check       # all of the above in sequence
pnpm cli -- --help   # run the local proposit-core CLI from the local build
bash scripts/smoke-test.sh  # CLI smoke test (requires build first)
./scripts/first-time-setup.sh  # new-machine check: prerequisites + check + smoke test
```

## Invariants easy to violate

Non-obvious constraints the code enforces. Terse here — follow the route below for the full rule, signature, or mechanism.

- **Mutations throw only on Structural violations.** Evaluable / Derivable / Presentable issues never throw at mutation time; query them via `engine.validate(tier)`.
- **`src/lib/` carries zero third-party SDK imports.** Concrete LLM providers live in `src/extensions/` (the OpenAI provider keeps `openai` as an optional `peerDependency`; the chat-completions provider talks to an external OpenAI-compatible HTTP endpoint via raw `fetch` with no SDK) — a grep-proof boundary; keep it that way.
- **Never `import { randomUUID } from "node:crypto"` in `src/lib/`.** Use the injected `generateId` from engine options (`TLogicEngineOptions` / `TPropositCoreConfig`). CLI files may use `node:crypto` directly.
- **`orderChangeset` (`src/lib/utils/changeset.ts`) emits FK-safe persistence ordering** — an invariant. Flag any change that touches entity relationships, adds entity types, or alters FK dependencies.
- **Core owns no application metadata** (user IDs, timestamps, display text) — those are consumer concerns. Applications extend core types via generic parameters.
- **Grammar-rule codes (`TGrammarRuleCode`) and engine-error codes are stable wire format** — renaming either requires a coordinated cross-repo publish. Core owns the codes; `@proposit/shared` re-exports the grammar wire format.
- **The parser is generated.** `src/lib/core/parser/formula.peggy` compiles to `formula-gen.js` via `pnpm run generate:parser` (folded into `build`). Editing the `.peggy` grammar without regenerating ships a stale parser.

For the full design detail, route by topic:

- Grammar model, the four tiers (`Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`), the S/E/D/P rule inventory, auto-normalization (AN-1..AN-4), and derivation / naked-Q form → `docs/Proposit_Grammar.md`.
- Engine, library, parser, pipeline, and provider API — method signatures, error codes, hierarchical-checksum protocol, forking, evaluation defaults by claim type, and the claim / citation / axiom libraries → `docs/api-reference.md`.
- Per-version feature history ("as of 1.x.0…") for the pipeline framework and LLM providers → `docs/release-notes/`.

## Testing

Tests live under `test/`: `core.test.ts` (the largest suite) plus per-area dirs — `test/grammar/` (per-tier suites), `test/extensions/<provider>/`, and `test/integration/`. All tests build their own fixtures inline — no shared `beforeEach` state. Add a new feature's tests to the matching file/dir, not by default to `core.test.ts`.

## Linting notes

- `*.mjs` files are excluded from type-aware ESLint rules — see `disableTypeChecked` override in `eslint.config.mjs`.
- `.claude/` is excluded from Prettier via `.prettierignore`.
- Run `pnpm eslint . --fix` to auto-fix stylistic issues before checking manually.

## ESM import requirements

All relative imports in `src/cli/` and `src/lib/` must end in `.js`. Directory imports must use the explicit index path (e.g. `schemata/index.js`).

## Naming conventions

Defined in the `brain-style` skill. Enforced by ESLint (`@typescript-eslint/naming-convention` and `check-file/filename-naming-convention`).

## Documentation Sync

- `README.md` [Public-CLI-API] — Concepts, usage examples, and CLI sections
- `README.md` "Invalid Constructions" section [Validation-Rules] — Update when adding, removing, or changing validation rules, thrown errors, error codes, operator constraints, cascade behaviors, or grammar config options
- `docs/api-reference.md` [Public-API] — Full API reference for engines, standalone functions, and types; update when public API changes
- `AGENTS.md` [Routing] — Repo scope, the invariants list, and routing pointers (`CLAUDE.md` is a symlink to this file). Fires only when a NEW easy-to-violate invariant or a NEW canonical doc route is introduced — NOT when an API detail changes (that belongs to `docs/api-reference.md`).
- `CLI_EXAMPLES.md` [Public-CLI-API] — Walkthrough examples and the complete script
- `scripts/smoke-test.sh` [Public-CLI-API] — Add coverage for new commands, flags, or behaviors
- `src/lib/core/interfaces/argument-engine.interfaces.ts` [Public-Engine-API] — JSDoc for ArgumentEngine interface methods; update when ArgumentEngine public method signatures, parameters, return types, or thrown errors change
- `src/lib/core/interfaces/premise-engine.interfaces.ts` [Public-Engine-API] — JSDoc for PremiseEngine interface methods; update when PremiseEngine public method signatures, parameters, return types, or thrown errors change
- `src/lib/core/interfaces/shared.interfaces.ts` [Public-Engine-API] — JSDoc for shared engine interfaces (TDisplayable, THierarchicalChecksummable); update when shared method signatures change
- `src/lib/core/interfaces/library.interfaces.ts` [Public-Engine-API] — JSDoc for `TClaimLookup`, `TClaimConnectionLookup`, `TClaimConnectionLibraryManagement`, and library snapshot interfaces (including `TClaimLibrarySnapshot`, `TClaimConnectionLibrarySnapshot`, `TArgumentLibrarySnapshot`, `TForkLibrarySnapshot`, `TPropositCoreSnapshot`); update when library interface signatures change
- `src/lib/core/proposit-core.ts` [Public-API] — JSDoc for PropositCore; update when PropositCore public methods change
- `src/lib/core/argument-library.ts` [Public-API] — JSDoc for ArgumentLibrary; update when ArgumentLibrary public methods change
- `src/lib/core/fork-library.ts` [Public-API] — JSDoc for ForkLibrary; update when ForkLibrary public methods change
- `src/lib/core/fork-namespace.ts` [Public-API] — JSDoc for ForkNamespace; update when ForkNamespace public methods change
- `examples/arguments/*.yaml` [Argument-Schema] — Example argument YAML files used by `test/examples.test.ts`; update when core argument schemas (`src/lib/schemata/`) or CLI-extended schemas (`src/cli/schemata.ts`, YAML import shape) change
- `docs/release-notes/upcoming.md` [Public-API] — User-facing release notes; plain language, no jargon
- `docs/changelogs/upcoming.md` [Any-Code-Change] — Developer changelog with commit hash ranges
