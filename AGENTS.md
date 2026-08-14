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

## Researching the OpenAI API

The OpenAI provider lives in `src/extensions/openai/`. When you need to verify OpenAI behavior, prefer OpenAI's LLM-formatted doc indexes — plain-markdown link lists where each entry links a `.md` you can fetch directly (e.g. `curl`):

- `https://developers.openai.com/api/llms.txt` — top-level index spanning BOTH the conceptual guides (**Docs**) and the per-endpoint **Reference** (request/response params, e.g. Responses → Create / Retrieve / Cancel). Start here when you need exact endpoint/parameter behavior or aren't sure which half you need; it also links the focused sub-indexes and the full-text exports.
- `https://developers.openai.com/api/docs/llms.txt` — guides / concepts / tutorials only (how-to: background mode, streaming, structured outputs, migration). Smaller; use for "how does feature X work" without endpoint-reference noise.
- `…/reference/llms.txt` is the reference-only index; the `…/llms-full.txt` variants are single-file full-content exports (use when you want everything inline rather than following links).

Opt-in live integration suites exercise the provider against the real Responses API (and cost tokens). They are `describe.skip`-ed unless `RUN_LIVE_LLM_TESTS=1` AND `OPENAI_API_KEY` are both set — CI sets neither. Run them with: `RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=sk-... pnpm exec vitest run test/extensions/openai/provider-live.test.ts test/extensions/openai/provider-live-background-stream.test.ts` (the background-stream suite covers mid-flight id + disconnect-survival via `reconnectStream` — passive `retrieveResponse` polling does NOT drive a dropped background response to completion; only reconnect-and-stream does).

## Change requests

Incoming cross-repo change requests arrive in this node's `tcw work` inbox. Adopt them with the `tcw-work` skill's inbox stage; the workspace root's `AGENTS.md` carries the two local caveats about `--title` and re-linking `--initiative`.

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
- **Core owns no application metadata** (user IDs, timestamps, display text) — those are consumer concerns. Applications extend core types via generic parameters. The one string that looks like an exception is an origin document's `text`: core stores, digests, measures, and index-slices it and never interprets it, exactly as a citation claim's IEEE reference data lives outside `src/lib/`.
- **`enthymeme` must be absent, never `null` or `false`, when unmarked.** `entityChecksum` includes a field only `if (field in entity)`, so a present key changes the checksum of every premise and expression in existence and breaks hierarchical checksums platform-wide. Schema is `Type.Optional`, never `Nullable`; unmarking deletes the key. Pinned by `test/origin/enthymeme-checksum.test.ts`.
- **An entity never carries a key holding `undefined`.** Same reason: `"field" in entity` becomes true and any mapper that coerces `undefined` to `null` flips the field from absent to present. Every place caller-supplied fields are spread into an entity routes through `withoutUndefinedValues` (`src/lib/utils/collections.ts`) — `setExtras` on both engines, and the `ArgumentParser` `map*` hooks. Adding a sixth such site means using it there too.
- **`normalizeOriginText` (`src/lib/utils/origin-text.ts`) is a one-way door.** Every stored origin anchor is a code-point offset into text it produced, so changing what it emits silently re-indexes all of them — treat an edit as a data migration, not a bug fix. Two things make it idempotent and both are load-bearing: the step order (line breaks → strip → NFC → trim), and the rule that a removal candidate never legitimizes another removal candidate — the joiner, the variation selectors, and the tag characters all satisfy the emoji-adjacency tests themselves, so the preservation checks read the emitted output, never the raw input. Anchor offsets are code points, never UTF-16 code units: use `sliceByCodePoints`, never `String.prototype.slice`.
- **An operator decision is never a truth value.** `operatorAssignments[id] === "rejected"` means the reader withheld that step: it **strikes the whole premise the operator lives in** from the evaluated set and asserts nothing — it never forces the expression, its children, or anything else to `false`. Two independent sites had encoded the opposite (the propagator's back-propagation and `PremiseEngine.evaluate`'s short-circuit), so fixing one is not fixing it.
- **Constraint propagation merges, it never overwrites and never declines to write.** Each granted step joins what it forces into the variable's current value in the knowledge order, and every rule triggers on a truth _component_ rather than an exact value. Both halves are load-bearing: they make the closure monotone, hence order-independent, and the attribution counterfactual is wrong without that. Two steps forcing opposite values yield `CONTESTED`, a fourth truth value evaluation may report and a reader may never assign — including onto a value the reader asserted, so a reader's own `true` can come back contested. Widening a rule's trigger back to an exact-value test (`=== true`, "still `null`") reintroduces the nondeterminism, silently.
- **"Grounded" and "unassignable" are different sets, and conflating them breaks readers.** `isGroundedVariable` (citation ∪ axiomatic) drives the default assignment and `checkValidity`'s carve-out: both types are seeded true and neither is a free column in the 2ⁿ search. `collectAxiomaticBoundVariables` (axiomatic only) drives the evaluate-time pre-pass, which **throws** `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` on a caller assignment. Widening that pre-pass to the grounded set makes a reader's assignment on any citation-backed claim throw — a normal action, failing deep in a consumer's review flow rather than here. Validity asks a structural question and gives the citation; evaluation asks the reader's, and the reader may disagree with a source. Evaluation's own **satisfiability** sub-question is structural too, so it gives the citation as well — see the next entry for why that needed a second set rather than a wider one.
- **`forcedTrueVariableIds` means three things at once, and only one of them wants citations.** Inside `evaluateArgument` it (1) pins the variable `true` in the premise-set satisfiability walk, (2) makes `isReaderAsserted` return `false` for it — driving `assertedByReader` and which claims get a `claimAttribution` entry — and (3) drops it from `conclusionClaimVariableIds`, so it never enters the reached-without-assertion counterfactual. Giving citations their due in (1) by widening this set therefore strips the reader's credit for a cited claim they asserted and **inverts** `reachedWithoutAssertion`, so an argument reports reaching its conclusion on its own merits using a value the reader supplied. That is why `satisfiabilityForcedTrueVariableIds` exists: (1) takes the grounded set, (2) and (3) keep the axiomatic-only one. The one-line version passes every satisfiability test and fails only on attribution, so a test that pins provenance — a different mechanism — will not catch it.
- **A premise's evaluation may read only the variables it reaches.** Reaching means the variables its own expressions name, plus — transitively — those reached by the premise behind any internally premise-bound variable among them. `TEvaluablePremise.evaluate` receives the whole assignment, and nothing in the type or at runtime stops it consulting more; the satisfiability search nonetheless splits the premises into groups sharing no reachable variable and walks each over its own columns alone. A premise that consults a variable outside its reach is walked without that variable varying, and can report a contradictory set as satisfiable — which decides, argument-wide, whether derivation is suppressed. The trap is subtler than it sounds, because _naming_ and _reaching_ differ: two premises with no variable in common are still coupled when one binds into the other, and a partition built from named occurrence alone is silently wrong on exactly those.
- **A claim may bind more than one variable, and "the claim's variable" is not a thing.** `addVariable` enforces no per-claim uniqueness; `ensureClaimBoundVariable` reuses the first match but prevents nothing, and this platform's persisted shape carries two per claim (an authored variable plus a derivation-synthesized one). Evaluation reaches and values each independently, so they can settle differently — even oppositely. Any lookup written as `variables.find(v => v.claimId === id)` is picking by id order and calling it the answer: it was written that way twice here (`getVariableIdForClaim`, which is public API since 3.1.0 and so keeps its first-wins answer under an honest contract, and `validateDerivationStructure`, where it reported a correct derivation premise as malformed), and a third time in `@proposit/shared`, which shipped a user-visible defect from it. Use `getVariableIdsForClaim`; when you genuinely want one, say which one and why any is acceptable.
- **Grammar-rule codes (`TGrammarRuleCode`) and engine-error codes are stable wire format** — renaming either requires a coordinated cross-repo publish. Core owns the codes; `@proposit/shared` re-exports the grammar wire format.
- **The parser is generated.** `src/lib/core/parser/formula.peggy` compiles to `formula-gen.js` via `pnpm run generate:parser` (folded into `build`). Editing the `.peggy` grammar without regenerating ships a stale parser.

For the full design detail, route by topic:

- Grammar model, the four tiers (`Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable`), the S/E/D/P rule inventory, auto-normalization (AN-1..AN-4), and derivation / naked-Q form → `docs/Proposit_Grammar.md`.
- Engine, library, parser, pipeline, and provider API — method signatures, error codes, hierarchical-checksum protocol, forking, evaluation defaults by claim type, and the claim / citation / axiom libraries → `docs/api-reference.md`.
- Per-version feature history ("as of 1.x.0…") for the pipeline framework and LLM providers → `docs/release-notes/`.

## Testing

**Run a new test against the unchanged code and read which ones fail, before writing the fix.** A pin that passes before the change proves nothing, and the failure mode is not "I forgot to run it" — it is measuring something _adjacent_ to the claim. Three times in two days: a counterexample-list assertion whose fixture's only counterexample was already correct; a row-count assertion that the first-satisfying-row early return made identical either way; a `variableProvenance` assertion aimed at a defect that lives in `claimAttribution`. Each looked like coverage. Before trusting a pin, name the exact field the change writes and assert on **that field**; where a plausible wrong fix exists, implement it, confirm the pin fails, and revert.

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

Before reporting any code change complete, invoke the `tcw:documentation-sync` skill to evaluate the entries below. When writing an implementation plan, include explicit documentation-update tasks for every entry whose trigger is expected to fire.

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
- `docs/release-notes/upcoming.md` [Public-API]
- `docs/changelogs/upcoming.md` [Any-Code-Change]
