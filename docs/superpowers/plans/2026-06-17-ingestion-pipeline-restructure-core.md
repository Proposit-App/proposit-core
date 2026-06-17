# Ingestion pipeline restructure — proposit-core 3.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure core's argument-ingestion into `src/extensions/pipelines/{base,ingestion/{scholar,scribe}}`, rename the multi-stage factory to `createScholarPipeline`, add a new 2-LLM-call `createScribePipeline`, drop v1 single-shot + `finalizeResponse`, repoint the CLI, and ship per-dir subpath exports — all as core `3.0.0`.

**Architecture:** `base/` holds the shared one-shot task contract (relocated `argument-ingestion/shared/*` + the 12 `stages/` + `STAGE_IDS`). `ingestion/scholar/` is the renamed v2 pipeline (byte-identical). `ingestion/scribe/` is new: two cheap LLM stages (`extract`, `structure`) whose outputs are reshaped by deterministic *adapter* stages into scholar's 6 standard stage-output slots, so scholar's 4 deterministic stages + `finalizeResponseV2` are reused verbatim. New `./pipelines/base` + `./pipelines/ingestion` package subpaths replace the root-barrel ingestion exports.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), TypeBox schemas, vitest, the in-house DAG pipeline framework (`src/lib/pipelines/`), `createRecordingLlmProvider` golden-fixture replay.

## Global Constraints

- Version floor: this branches off published core `2.0.0`; ship as `3.0.0` (major). **Do NOT run `pnpm version` / `git tag` / `pnpm publish`** — release is user-gated. Prepare `upcoming.md` content only.
- No engine/grammar change; `TParsedArgumentResponse` output shape unchanged.
- **Byte-identity of scholar:** the relocation+rename must NOT touch any prompt string, `STAGE_IDS` value, or schema. Scholar acceptance test = the existing v2 golden suite passes UNCHANGED.
- **No initiative/planning language in shipped code** (comments, test titles, log/error/CLI strings): no slice/phase/wave/P1/CR labels, no `docs/superpowers/**` paths. Keep domain terms.
- All relative imports in `src/` end in `.js`; directory imports use explicit `index.js`.
- TypeScript naming/casing per the `brain-style` skill (invoke it before writing TS). `T`-prefixed types, PascalCase schemas, camelCase functions, SCREAMING_SNAKE consts. ESLint enforces filename kebab-case.
- Cross-repo wire ids (authoritative source of the new strings): scholar `PIPELINE_ID = "argument-ingestion-scholar"`, scribe `PIPELINE_ID = "argument-ingestion-scribe"`, `PIPELINE_VERSION = "1.0.0"`.
- New cheap-model default: `gpt-5.4-mini` (lives in scribe `*_STAGE_DEFAULTS.model`).
- Verify each task with the exact command shown; never claim green without running it (verification-before-completion).

---

## File Structure (decomposition)

**New tree** `src/extensions/pipelines/`:
- `base/` — relocated `argument-ingestion/shared/*` (`finalize-response-v2.ts`, `types.ts`, `resolve-llm-stage-options.ts`, `basics-extension.ts`, `role-derivation.ts`) + `base/stages/` (the 12 stage files + `schemas.ts`) + `base/index.ts` (new barrel for the `./pipelines/base` subpath).
- `ingestion/scholar/` — `scholar.ts` (was `v2-multi-stage.ts`) + `index.ts`.
- `ingestion/scribe/` — `scribe.ts` (factory), `extract-stage.ts`, `structure-stage.ts`, `adapters.ts` (the 4 deterministic adapter stages), `schemas.ts` (scribe LLM output schemas) + `index.ts`.
- `ingestion/index.ts` — barrel for the `./pipelines/ingestion` subpath (re-exports scholar + scribe factories + option types).

**Deleted:** `argument-ingestion/v1-single-shot.ts`, `argument-ingestion/shared/finalize-response.ts`, the whole old `argument-ingestion/` dir after the move.

**Modified:** `src/lib/index.ts` (drop ingestion re-exports), `src/cli/commands/parse.ts` (repoint to scholar), `package.json` (exports + version note), `typedoc.json` (entry points), `docs/api-reference.md`, `docs/release-notes/upcoming.md`, `docs/changelogs/upcoming.md`.

**Test tree** moves `test/extensions/argument-ingestion/` → `test/extensions/pipelines/`; deletes v1 test files + v1 fixtures; adds scribe tests.

---

## Task 1: Relocate the ingestion tree (pure move, byte-identity preserved)

**Files:**
- Move (git mv): `src/extensions/argument-ingestion/shared/*` → `src/extensions/pipelines/base/*` (5 files: `finalize-response-v2.ts`, `types.ts`, `resolve-llm-stage-options.ts`, `basics-extension.ts`, `role-derivation.ts`). NOTE: `finalize-response.ts` is moved too for now (deleted in Task 6).
- Move: `src/extensions/argument-ingestion/stages/*` (13 files incl. `index.ts` + `schemas.ts`) → `src/extensions/pipelines/base/stages/*`.
- Move: `src/extensions/argument-ingestion/v2-multi-stage.ts` → `src/extensions/pipelines/ingestion/scholar/scholar.ts`.
- Move: `src/extensions/argument-ingestion/v1-single-shot.ts` → `src/extensions/pipelines/ingestion/_v1-single-shot.ts` (temporary; deleted in Task 6 — keeps the tree compiling between tasks).
- Move: `src/extensions/argument-ingestion/index.ts` → delete its role is replaced by new barrels; move to `src/extensions/pipelines/_old-index.ts` temporarily (deleted in Task 4).
- Move test tree: `test/extensions/argument-ingestion/` → `test/extensions/pipelines/` (entire dir, git mv).
- Modify (import-path fixups only): every moved file's relative imports + the 3 external importers (`src/cli/commands/parse.ts`, `src/lib/index.ts`, `test/core.test.ts:151`).

**Interfaces:**
- Consumes: nothing new.
- Produces: the new directory layout. All symbol names, signatures, prompt strings, `STAGE_IDS` values UNCHANGED.

- [ ] **Step 1: Move the shared/ files to base/ via git mv**

```bash
cd <worktree>
mkdir -p src/extensions/pipelines/base
git mv src/extensions/argument-ingestion/shared/finalize-response-v2.ts src/extensions/pipelines/base/finalize-response-v2.ts
git mv src/extensions/argument-ingestion/shared/finalize-response.ts    src/extensions/pipelines/base/finalize-response.ts
git mv src/extensions/argument-ingestion/shared/types.ts                src/extensions/pipelines/base/types.ts
git mv src/extensions/argument-ingestion/shared/resolve-llm-stage-options.ts src/extensions/pipelines/base/resolve-llm-stage-options.ts
git mv src/extensions/argument-ingestion/shared/basics-extension.ts     src/extensions/pipelines/base/basics-extension.ts
git mv src/extensions/argument-ingestion/shared/role-derivation.ts      src/extensions/pipelines/base/role-derivation.ts
```

- [ ] **Step 2: Move the stages/ dir to base/stages/**

```bash
git mv src/extensions/argument-ingestion/stages src/extensions/pipelines/base/stages
```

- [ ] **Step 3: Move the pipeline factories + old barrel + v1 (temp names)**

```bash
mkdir -p src/extensions/pipelines/ingestion/scholar
git mv src/extensions/argument-ingestion/v2-multi-stage.ts src/extensions/pipelines/ingestion/scholar/scholar.ts
git mv src/extensions/argument-ingestion/v1-single-shot.ts src/extensions/pipelines/ingestion/_v1-single-shot.ts
git mv src/extensions/argument-ingestion/index.ts          src/extensions/pipelines/_old-index.ts
rmdir src/extensions/argument-ingestion/shared src/extensions/argument-ingestion 2>/dev/null || true
```

- [ ] **Step 4: Move the test tree**

```bash
git mv test/extensions/argument-ingestion test/extensions/pipelines
```

- [ ] **Step 5: Fix import paths in all moved + importing files**

Mechanical depth-fixup. The relative-import depth changes for files that moved to a deeper level:
- `base/stages/*` files import the framework via `../../../lib/pipelines/...` today (from `argument-ingestion/stages/`, depth 3). New location `pipelines/base/stages/` is **also depth 3** under `src/extensions/` → wait, verify: `src/extensions/argument-ingestion/stages/` and `src/extensions/pipelines/base/stages/` are BOTH 4 segments under `src/`. So `../../../lib/` (3 ups: stages→argument-ingestion→extensions→src... no: stages → up to argument-ingestion → up to extensions → up to src? that's `../../../` = stages's parent's parent's parent). For `pipelines/base/stages/`: stages → base → pipelines → extensions → src needs `../../../../lib/`. **The depth increased by one for stage files** (they gained the `base/` level). Fix all `../../../lib/` → `../../../../lib/` in `base/stages/*.ts`, and `../shared/` → `../` (shared collapsed into base) in `base/stages/*.ts`.
- `base/*` (ex-shared) files: were at `argument-ingestion/shared/` (depth 3), now `pipelines/base/` (depth 3) — same depth. Their `../../../lib/` stays `../../../lib/`. Their intra-shared imports (`./types.js` etc.) stay. Their `../stages/` → `./stages/`.
- `scholar.ts`: was `argument-ingestion/v2-multi-stage.ts` (depth 2), now `pipelines/ingestion/scholar/scholar.ts` (depth 4). `../../lib/` → `../../../../lib/`; `./stages/index.js` → `../../base/stages/index.js`; `./shared/finalize-response-v2.js` → `../../base/finalize-response-v2.js`; `./shared/resolve-llm-stage-options.js` → `../../base/resolve-llm-stage-options.js`; `./shared/types.js` → `../../base/types.js`.
- `_v1-single-shot.ts`: was depth 2, now `pipelines/_v1-single-shot.ts` (depth 2) — same depth. `./shared/` → `./base/`; `./stages/` → `./base/stages/` (it imports `finalizeResponse`, `basicsExtension`, types, `V1_PARSE_STAGE_ID` const).
- `_old-index.ts`: was `argument-ingestion/index.ts` (depth 2), now `pipelines/_old-index.ts` (depth 2). `./v1-single-shot.js` → `./_v1-single-shot.js`; `./v2-multi-stage.js` → `./ingestion/scholar/scholar.js`; `./shared/*` → `./base/*`; `./stages/index.js` → `./base/stages/index.js`.
- External importers:
  - `src/lib/index.ts:215,227` — `"../extensions/argument-ingestion/index.js"` → `"../extensions/pipelines/_old-index.js"` (temporary; rewired in Task 4).
  - `src/cli/commands/parse.ts:13` — imports from `"../../lib/index.js"` (not the dir directly) → no path change needed here yet (rewired in Task 7).
  - `test/core.test.ts:151` — `"../src/extensions/argument-ingestion/stages/claim-canonicalization"` → `"../src/extensions/pipelines/base/stages/claim-canonicalization"`.
  - Every test file under the moved `test/extensions/pipelines/` that imports `../../../src/extensions/argument-ingestion/...` → `../../../src/extensions/pipelines/...` with corrected sub-paths (`shared/` → `base/`, `stages/` → `base/stages/`, `v2-multi-stage` → `ingestion/scholar/scholar`, `v1-single-shot` → `_v1-single-shot`). Also fix the relative depth: test files stay at `test/extensions/pipelines/` (same depth as `test/extensions/argument-ingestion/`), so only the path tail changes, not the `../` count — EXCEPT `test/extensions/pipelines/stages/*` which import `../../../../src/...` (depth unchanged).

Use the LSP/typecheck loop to drive these: run `pnpm run typecheck` and fix each unresolved-path error until clean. Do NOT edit any string literal inside a prompt template or `STAGE_IDS`.

- [ ] **Step 6: Verify the move compiles and tests pass UNCHANGED**

Run: `pnpm run typecheck`
Expected: clean (0 errors).

Run: `pnpm vitest run test/extensions/pipelines/v2-e2e.test.ts`
Expected: PASS — the v2 golden suite passes with zero fixture/recording changes. **This is the scholar byte-identity proof.** If any golden fails, a prompt/schema was perturbed during the move — revert the offending edit.

Run: `pnpm vitest run`
Expected: same pass count as baseline (1935 passed / 15 skipped), 0 failures.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(pipelines): relocate argument-ingestion to extensions/pipelines (no behavior change)"
```

---

## Task 2: Export the three helpers scribe needs (still private today)

**Files:**
- Modify: `src/extensions/pipelines/base/stages/conclusion-selection.ts` — export `selectFallbackConclusion`.
- Modify: `src/extensions/pipelines/base/stages/claim-canonicalization.ts` — export `buildResponseSchema` + `buildClaimRecordSchema`.
- Test: `test/extensions/pipelines/stages/conclusion-selection.test.ts` (add a `selectFallbackConclusion` unit test); `test/extensions/pipelines/stages/claim-canonicalization-schema.test.ts` (new — a `buildResponseSchema` shape test).

**Interfaces:**
- Produces (consumed by Task 5 scribe adapters):
  - `selectFallbackConclusion(classifications: readonly TClaimTypeClassificationEntry[], relations: readonly TRelation[]): string | null`
  - `buildResponseSchema(extension: TIngestionExtension): TSchema`
  - `buildClaimRecordSchema(claimSchema: TSchema): TSchema`

- [ ] **Step 1: Write the failing test for the exported helpers**

Add to `test/extensions/pipelines/stages/conclusion-selection.test.ts`:

```ts
import { selectFallbackConclusion } from "../../../../src/extensions/pipelines/base/stages/conclusion-selection.js"

describe("selectFallbackConclusion (exported helper)", () => {
    it("picks the pure-sink normal claim with highest in-degree", () => {
        const classifications = [
            { miniId: "c1", type: "normal" as const, sourceString: null },
            { miniId: "c2", type: "normal" as const, sourceString: null },
            { miniId: "c3", type: "normal" as const, sourceString: null },
        ]
        const relations = [
            { relationId: "r1", type: "support" as const, sources: ["c1"], target: "c3", evidence: { segmentIds: [], quote: "" } },
            { relationId: "r2", type: "support" as const, sources: ["c2"], target: "c3", evidence: { segmentIds: [], quote: "" } },
        ]
        expect(selectFallbackConclusion(classifications, relations)).toBe("c3")
    })

    it("returns null when there are no relations", () => {
        expect(selectFallbackConclusion([], [])).toBeNull()
    })
})
```

Create `test/extensions/pipelines/stages/claim-canonicalization-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { Value } from "typebox/value"
import { buildResponseSchema, buildClaimRecordSchema } from "../../../../src/extensions/pipelines/base/stages/claim-canonicalization.js"
import { basicsExtension } from "../../../../src/extensions/pipelines/base/basics-extension.js"

describe("buildResponseSchema / buildClaimRecordSchema (exported)", () => {
    it("produces a schema that accepts a basics canonical claim with extension fields", () => {
        const schema = buildResponseSchema(basicsExtension)
        const ok = Value.Check(schema, {
            canonicalClaims: [
                { miniId: "c1", mentionIds: ["m1"], suggestedSymbol: "Rain_Wets", type: "normal", title: "Rain wets the ground", body: "Rain makes the ground wet." },
            ],
            mentionToClaim: [{ mentionId: "m1", claimMiniId: "c1" }],
        })
        expect(ok).toBe(true)
    })

    it("buildClaimRecordSchema injects miniId/mentionIds/suggestedSymbol into the claim shape", () => {
        const recordSchema = buildClaimRecordSchema(basicsExtension.claimSchema)
        // base record must reject a claim missing the canonicalizer fields
        const missingFields = Value.Check(recordSchema, { type: "normal", title: "x", body: "y" })
        expect(missingFields).toBe(false)
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/extensions/pipelines/stages/conclusion-selection.test.ts test/extensions/pipelines/stages/claim-canonicalization-schema.test.ts`
Expected: FAIL — `selectFallbackConclusion`/`buildResponseSchema`/`buildClaimRecordSchema` are not exported (import errors).

- [ ] **Step 3: Export the helpers**

In `conclusion-selection.ts`, change `function selectFallbackConclusion(` → `export function selectFallbackConclusion(`. Update its JSDoc to drop any internal-only phrasing if present (keep the algorithm description).

In `claim-canonicalization.ts`, change `function buildResponseSchema(` → `export function buildResponseSchema(` and `function buildClaimRecordSchema(` → `export function buildClaimRecordSchema(`. Add a one-line JSDoc to each noting it is the per-extension canonicalization schema builder (used by both scholar's canon stage and scribe's extract).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run test/extensions/pipelines/stages/conclusion-selection.test.ts test/extensions/pipelines/stages/claim-canonicalization-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(pipelines): export selectFallbackConclusion + canonicalization schema builders"
```

---

## Task 3: Add new STAGE_IDS for scribe + the scholar factory rename

**Files:**
- Modify: `src/extensions/pipelines/base/stages/schemas.ts` — add `extract` + `scribeStructure` to `STAGE_IDS`.
- Modify: `src/extensions/pipelines/ingestion/scholar/scholar.ts` — rename `createIngestionV2Pipeline` → `createScholarPipeline`, `TCreateIngestionV2PipelineOptions` → `TCreateScholarPipelineOptions`, `PIPELINE_ID` → `"argument-ingestion-scholar"`. Refresh the v1/v2-referencing comments.
- Create: `src/extensions/pipelines/ingestion/scholar/index.ts` — barrel.
- Test: `test/extensions/pipelines/v2-multi-stage.test.ts` (rename references), `test/extensions/pipelines/v2-e2e.test.ts` (update factory import + name).

**Interfaces:**
- Produces:
  - `STAGE_IDS.extract = "extract"`, `STAGE_IDS.scribeStructure = "scribe-structure"` (consumed by Task 5).
  - `createScholarPipeline(extension: TIngestionExtension, options?: TCreateScholarPipelineOptions): TPipeline<TIngestionInput, TParsedArgumentResponse>`
  - `TCreateScholarPipelineOptions = { llm?: TIngestionLlmOptions }`

- [ ] **Step 1: Add the new STAGE_IDS (no test yet — consumed downstream)**

In `schemas.ts`, append to the `STAGE_IDS` const object (after `formulaValidation`):

```ts
    // scribe's two cheap LLM stages (extract → structure). Their
    // deterministic adapters republish the canonicalization /
    // classification / relation / conclusion slots scholar's backend
    // reads, so the 4 deterministic stages + finalize reuse verbatim.
    extract: "extract",
    scribeStructure: "scribe-structure",
```

- [ ] **Step 2: Rename the scholar factory (write the failing test first)**

Update `test/extensions/pipelines/v2-e2e.test.ts`: change the import `createIngestionV2Pipeline` → `createScholarPipeline` (from the new `../ingestion/scholar/index.js` once it exists; for now point at `../ingestion/scholar/scholar.js`) and every call site. Update the `describe` title from any "v2" phrasing to "scholar".

Run: `pnpm vitest run test/extensions/pipelines/v2-e2e.test.ts`
Expected: FAIL — `createScholarPipeline` is not exported yet.

- [ ] **Step 3: Apply the rename in scholar.ts**

- `export function createIngestionV2Pipeline(` → `export function createScholarPipeline(`
- `export type TCreateIngestionV2PipelineOptions =` → `export type TCreateScholarPipelineOptions =`
- `const PIPELINE_ID = "argument-ingestion-v2"` → `const PIPELINE_ID = "argument-ingestion-scholar"`
- Update the file's header comment + JSDoc: replace "v2 multi-stage" / "createIngestionV1Pipeline" references with "scholar" framing; drop the "same output shape as createIngestionV1Pipeline" comparison (v1 is being removed) — describe scholar as the thorough multi-stage ingestion pipeline. Keep the DAG ASCII + the 12-stage description (domain content). **Do not** rename `STAGE_IDS` values or any prompt.

Create `src/extensions/pipelines/ingestion/scholar/index.ts`:

```ts
// Barrel for the scholar (thorough, multi-stage) ingestion pipeline.
export { createScholarPipeline } from "./scholar.js"
export type { TCreateScholarPipelineOptions } from "./scholar.js"
```

- [ ] **Step 4: Run to verify scholar e2e passes (byte-identity holds under the rename)**

Run: `pnpm vitest run test/extensions/pipelines/v2-e2e.test.ts`
Expected: PASS — goldens unchanged; only the factory name changed.

Run: `pnpm run typecheck`
Expected: FAIL is acceptable here ONLY for the not-yet-rewired barrels (`_old-index.ts`, `src/lib/index.ts` still import the old name). If so, temporarily update `_old-index.ts` to export `createScholarPipeline as createIngestionV2Pipeline` is NOT wanted — instead update `_old-index.ts` + `src/lib/index.ts` to the new name now (they are deleted/rewired in Task 4 anyway). Re-run typecheck to clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(pipelines): rename v2 factory to createScholarPipeline + add scribe stage ids"
```

---

## Task 4: New subpath barrels + package.json exports + typedoc + drop ingestion from root barrel

**Files:**
- Create: `src/extensions/pipelines/base/index.ts` (the `./pipelines/base` subpath barrel).
- Create: `src/extensions/pipelines/ingestion/index.ts` (the `./pipelines/ingestion` subpath barrel — scholar now; scribe added in Task 5).
- Delete: `src/extensions/pipelines/_old-index.ts`.
- Modify: `src/lib/index.ts` — remove the ingestion re-export block (`:205-227`) + its stale comment (`:201-204`).
- Modify: `package.json` — add `./pipelines/base` + `./pipelines/ingestion` to `exports`.
- Modify: `typedoc.json` — add the two new entry points.
- Test: a subpath-resolution smoke check via typecheck + a small import test.

**Interfaces:**
- Produces the public import surface:
  - `@proposit/proposit-core/pipelines/base` → `finalizeResponseV2`, `FINALIZE_V2_FAILURE_TEXTS`, `TIngestionExtension`/`TIngestionInput`/`TIngestionLlmOptions`/`TLlmStageOptionsOverride`, `resolveLlmStageOptions`, `basicsExtension`, `deriveRoles`/`TClaimRole`/`TDeriveRolesInput`, `selectFallbackConclusion`, `buildResponseSchema`, `buildClaimRecordSchema`, `STAGE_IDS` + all stage factories/consts/schemas, `TFinalizeResponseV2Input`.
  - `@proposit/proposit-core/pipelines/ingestion` → `createScholarPipeline` + `TCreateScholarPipelineOptions` (+ scribe in Task 5).

- [ ] **Step 1: Write base/index.ts**

```ts
// Barrel for the shared one-shot ingestion task contract + helpers.
// Subpath: @proposit/proposit-core/pipelines/base
export {
    finalizeResponseV2,
    FINALIZE_V2_FAILURE_TEXTS,
} from "./finalize-response-v2.js"
export type { TFinalizeResponseV2Input } from "./finalize-response-v2.js"
export { resolveLlmStageOptions } from "./resolve-llm-stage-options.js"
export { basicsExtension } from "./basics-extension.js"
export type {
    TIngestionExtension,
    TIngestionInput,
    TIngestionLlmOptions,
    TLlmStageOptionsOverride,
} from "./types.js"
export { deriveRoles } from "./role-derivation.js"
export type { TClaimRole, TDeriveRolesInput } from "./role-derivation.js"
// Stage factories, STAGE_IDS, schemas, *_DEFAULTS, and the newly-exported
// per-extension schema builders + fallback-conclusion helper.
export * from "./stages/index.js"
```

Ensure `base/stages/index.ts` re-exports `selectFallbackConclusion`, `buildResponseSchema`, `buildClaimRecordSchema` (add the lines if `stages/index.ts` is an explicit re-export list rather than `export *` from each stage file — verify and add).

- [ ] **Step 2: Write ingestion/index.ts**

```ts
// Barrel for the ingestion pipeline family (scholar + scribe).
// Subpath: @proposit/proposit-core/pipelines/ingestion
export { createScholarPipeline } from "./scholar/index.js"
export type { TCreateScholarPipelineOptions } from "./scholar/index.js"
// scribe exports added in the scribe task.
```

- [ ] **Step 3: Delete _old-index.ts and remove ingestion re-exports from src/lib/index.ts**

```bash
git rm src/extensions/pipelines/_old-index.ts
```

In `src/lib/index.ts`, delete the comment block at `:201-204` and the two `export {...}` / `export type {...}` blocks (`:205-227`) that re-export from the old ingestion barrel. Leave the `lib/` engine + framework + provider exports intact.

- [ ] **Step 4: Add the package.json subpath exports**

In `package.json` `exports`, after the existing `./extensions/*` entries add:

```json
        "./pipelines/base": {
            "types": "./dist/extensions/pipelines/base/index.d.ts",
            "import": "./dist/extensions/pipelines/base/index.js",
            "default": "./dist/extensions/pipelines/base/index.js"
        },
        "./pipelines/ingestion": {
            "types": "./dist/extensions/pipelines/ingestion/index.d.ts",
            "import": "./dist/extensions/pipelines/ingestion/index.js",
            "default": "./dist/extensions/pipelines/ingestion/index.js"
        }
```

- [ ] **Step 5: Add typedoc entry points**

In `typedoc.json` `entryPoints`, add `"src/extensions/pipelines/base/index.ts"` and `"src/extensions/pipelines/ingestion/index.ts"`.

- [ ] **Step 6: Write the import-surface test**

Create `test/extensions/pipelines/export-surface.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import * as base from "../../../src/extensions/pipelines/base/index.js"
import * as ingestion from "../../../src/extensions/pipelines/ingestion/index.js"

describe("pipelines subpath barrels", () => {
    it("base exports the contract + newly-public helpers", () => {
        expect(typeof base.finalizeResponseV2).toBe("function")
        expect(typeof base.resolveLlmStageOptions).toBe("function")
        expect(typeof base.basicsExtension).toBe("object")
        expect(typeof base.selectFallbackConclusion).toBe("function")
        expect(typeof base.buildResponseSchema).toBe("function")
        expect(typeof base.buildClaimRecordSchema).toBe("function")
        expect(base.STAGE_IDS.extract).toBe("extract")
        expect(base.STAGE_IDS.scribeStructure).toBe("scribe-structure")
    })
    it("ingestion exports the scholar factory", () => {
        expect(typeof ingestion.createScholarPipeline).toBe("function")
    })
})
```

- [ ] **Step 7: Verify typecheck + the surface test + full suite**

Run: `pnpm run typecheck`
Expected: FAIL only where `_v1-single-shot.ts` / its test still import the deleted old barrel — those are removed in Task 6. If `_v1-single-shot.ts` imported from `_old-index.ts`, repoint it to `./base/*` directly so the tree compiles. Re-run until clean.

Run: `pnpm vitest run test/extensions/pipelines/export-surface.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(pipelines): per-dir subpath exports (./pipelines/base, ./pipelines/ingestion); drop ingestion from root barrel"
```

---

## Task 5: Implement the scribe pipeline (the core new work)

**Files:**
- Create: `src/extensions/pipelines/ingestion/scribe/schemas.ts` — scribe LLM output schemas (`extract`, `structure`) + types.
- Create: `src/extensions/pipelines/ingestion/scribe/extract-stage.ts` — the `extract` LLM stage (per-extension schema) + the two adapter `deterministicStage`s (canonicalization + classification slots).
- Create: `src/extensions/pipelines/ingestion/scribe/structure-stage.ts` — the `structure` LLM stage + the two adapters (relation-extraction + conclusion-selection slots, the latter reproducing `selectFallbackConclusion` + the `NO_SINGLE_CONCLUSION` failure).
- Create: `src/extensions/pipelines/ingestion/scribe/scribe.ts` — `createScribePipeline`.
- Create: `src/extensions/pipelines/ingestion/scribe/index.ts` — barrel.
- Modify: `src/extensions/pipelines/ingestion/index.ts` — add scribe exports.
- Test: `test/extensions/pipelines/scribe.test.ts` (unit/edge — no live LLM).

**Interfaces:**
- Consumes: `STAGE_IDS.extract`/`.scribeStructure`/`.claimCanonicalization`/`.claimTypeClassification`/`.relationExtraction`/`.conclusionSelection` (Task 3); `selectFallbackConclusion`, `buildResponseSchema`, `buildClaimRecordSchema` (Task 2); `deterministicStage`, `llmStage` from `lib/pipelines`; scholar's deterministic stage consts (`claimReferenceValidationStage`, `variableAssignmentStage`, `formulaCompilationStage`, `formulaValidationStage`) + `finalizeResponseV2` + `resolveLlmStageOptions`.
- Produces:
  - `createScribePipeline(extension: TIngestionExtension, options?: { llm?: TIngestionLlmOptions }): TPipeline<TIngestionInput, TParsedArgumentResponse>`
  - `EXTRACT_STAGE_DEFAULTS`, `STRUCTURE_STAGE_DEFAULTS` (model `gpt-5.4-mini`).

### Design detail (scribe stage graph)

```
extract (LLM, STAGE_IDS.extract, per-extension schema, threads `extension`)
  ├─ adapter → STAGE_IDS.claimCanonicalization  (TClaimCanonicalizationOutput)
  └─ adapter → STAGE_IDS.claimTypeClassification (TClaimTypeClassificationOutput)
scribe-structure (LLM, STAGE_IDS.scribeStructure)
  ├─ adapter → STAGE_IDS.relationExtraction  (TRelationExtractionOutput)
  └─ adapter → STAGE_IDS.conclusionSelection (TConclusionSelectionOutput; runs selectFallbackConclusion + NO_SINGLE_CONCLUSION)
then scholar's 4 deterministic consts (claim-reference-validation, variable-assignment, formula-compilation, formula-validation)
then finalize: finalizeResponseV2({ ctx, extension })
```

`extract`'s LLM output must carry, per canonical claim: the per-extension claim fields (so the canon adapter republishes a valid `TClaimCanonicalizationOutput`) PLUS a `type`/`sourceString` (so the classification adapter republishes `TClaimTypeClassificationOutput.classifications`). Define the extract schema as `buildResponseSchema(extension)` extended with a per-claim `sourceString` (or read `type` from the claim record + emit `sourceString: null`). Keep it simple: the canon adapter maps extract's `canonicalClaims` (minus any classification-only field) into `{canonicalClaims, mentionToClaim}`; the classification adapter maps each claim to `{miniId, type, sourceString}`.

`structure`'s LLM output: `{ relations: [...], conclusionCandidates: string[], rationale: string }`. The relation adapter republishes `{relations}` as `TRelationExtractionOutput`. The conclusion adapter reproduces `createConclusionSelectionStage`'s outer-run resolution: pick the first `conclusionCandidate` that is a normal claim (from the classification slot), else `selectFallbackConclusion(classifications, relations)`, else null → emit `NO_SINGLE_CONCLUSION` failure; output the full `TConclusionSelectionOutput`.

- [ ] **Step 1: Write the failing scribe unit/edge tests**

Create `test/extensions/pipelines/scribe.test.ts`. Use a stub `TLlmProvider` that returns canned `extract` + `structure` outputs keyed by the `<!-- stage-id: ... -->` marker (mirror the pattern in `recording-provider.ts` / existing stage tests). Cases:

```ts
import { describe, it, expect } from "vitest"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import { executePipeline } from "../../../src/lib/index.js"
// + a local stub provider returning fixed outputs per stage id, and createDeterministicGenerateId helper (copy the test pattern used by v2-e2e)

describe("createScribePipeline", () => {
    it("produces a schema-valid TParsedArgumentResponse with a compiled, validated formula on a small fixture", async () => {
        // extract → 2 normal claims; structure → one support relation + conclusion = c2
        const result = await executePipeline(createScribePipeline(basicsExtension), { text: "..." }, { llm: stub, generateId })
        expect(result.output.argument).not.toBeNull()
        expect(result.output.argument.premises.length).toBeGreaterThan(0)
        expect(result.output.processingFailures).toEqual([])
    })

    it("structure on an empty claim list → empty-but-valid response (no throw)", async () => {
        const result = await executePipeline(createScribePipeline(basicsExtension), { text: "" }, { llm: emptyStub, generateId })
        expect(result.output.argument).toBeNull()
        expect(result.output.failureText).toBeTruthy()
    })

    it("a cheap-model structure output with an invalid formula surfaces a processingFailure, not a crash", async () => {
        const result = await executePipeline(createScribePipeline(basicsExtension), { text: "..." }, { llm: badFormulaStub, generateId })
        expect(result.failures.some((f) => f.severity)).toBe(true) // formula-validation caught it
        // pipeline did not throw; output is a defined response
        expect(result.output).toBeDefined()
    })

    it("PIPELINE_ID is the cross-repo wire id", () => {
        expect(createScribePipeline(basicsExtension).id).toBe("argument-ingestion-scribe")
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/extensions/pipelines/scribe.test.ts`
Expected: FAIL — `createScribePipeline` not found.

- [ ] **Step 3: Implement scribe schemas**

`scribe/schemas.ts`: export `buildExtractOutputSchema(extension)` (= `buildResponseSchema(extension)`; reuse it — extract's canonical claims already carry `type`), and `StructureOutputSchema = Type.Object({ relations: <RelationExtractionOutputSchema.relations>, conclusionCandidates: Type.Array(Type.String()), rationale: Type.String() }, {additionalProperties:false})` + `TStructureOutput`. Mark each stage's system prompt with `<!-- stage-id: ${STAGE_IDS.extract} -->` / `${STAGE_IDS.scribeStructure}`.

- [ ] **Step 4: Implement extract-stage.ts (LLM + 2 adapters)**

`createExtractStage(extension, options?)` = `llmStage<TClaimCanonicalizationOutput>({ id: STAGE_IDS.extract, dependsOn: [], outputSchema: buildResponseSchema(extension), model: options?.model ?? EXTRACT_STAGE_DEFAULTS.model, ..., buildPrompt })` where `buildPrompt` reads `ctx.input.text`. Plus:
- `extractCanonAdapterStage = deterministicStage<TClaimCanonicalizationOutput>({ id: STAGE_IDS.claimCanonicalization, dependsOn: [STAGE_IDS.extract], outputSchema: <base ClaimCanonicalizationOutputSchema or extension schema>, fn: (ctx) => ctx.get(STAGE_IDS.extract) ?? {canonicalClaims:[], mentionToClaim:[]} })` (extract already emits the canon shape → passthrough; if extract carries extra fields, strip to canon shape).
- `extractClassificationAdapterStage = deterministicStage<TClaimTypeClassificationOutput>({ id: STAGE_IDS.claimTypeClassification, dependsOn: [STAGE_IDS.extract], outputSchema: ClaimTypeClassificationOutputSchema, fn: (ctx) => ({ classifications: (ctx.get(STAGE_IDS.extract)?.canonicalClaims ?? []).map((c) => ({ miniId: c.miniId, type: c.type, sourceString: (c as any).url ?? null })) }) })`.

EXTRACT_STAGE_DEFAULTS = `{ model: "gpt-5.4-mini" }`.

- [ ] **Step 5: Implement structure-stage.ts (LLM + 2 adapters, conclusion reproduces resolution)**

`createStructureStage(options?)` = `llmStage<TStructureOutput>({ id: STAGE_IDS.scribeStructure, dependsOn: [STAGE_IDS.claimCanonicalization, STAGE_IDS.claimTypeClassification], ... })`. Plus:
- `structureRelationAdapterStage = deterministicStage<TRelationExtractionOutput>({ id: STAGE_IDS.relationExtraction, dependsOn: [STAGE_IDS.scribeStructure], outputSchema: RelationExtractionOutputSchema, fn: (ctx) => ({ relations: ctx.get(STAGE_IDS.scribeStructure)?.relations ?? [] }) })`.
- `structureConclusionAdapterStage = deterministicStage<TConclusionSelectionOutput>({ id: STAGE_IDS.conclusionSelection, dependsOn: [STAGE_IDS.scribeStructure, STAGE_IDS.claimTypeClassification, STAGE_IDS.relationExtraction], outputSchema: ConclusionSelectionOutputSchema, fn: (ctx) => { ...reproduce createConclusionSelectionStage's outer run: classifications from classification slot, relations from relation slot, modelPick = first candidate that is a normal claim, else selectFallbackConclusion(...), else null → ctx.addFailure({code: CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE, ...}); return {conclusionMiniId, conclusionCandidates, rationale} } })`.

STRUCTURE_STAGE_DEFAULTS = `{ model: "gpt-5.4-mini" }`. Import `selectFallbackConclusion` + `CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE` from the canon/conclusion stage modules.

- [ ] **Step 6: Implement scribe.ts (the factory)**

```ts
const PIPELINE_ID = "argument-ingestion-scribe"
const PIPELINE_VERSION = "1.0.0"
export function createScribePipeline(extension, options?) {
  const llm = options?.llm
  const extractStage = createExtractStage(extension, resolveLlmStageOptions(STAGE_IDS.extract, EXTRACT_STAGE_DEFAULTS, llm))
  const structureStage = createStructureStage(resolveLlmStageOptions(STAGE_IDS.scribeStructure, STRUCTURE_STAGE_DEFAULTS, llm))
  const stages = [
    extractStage, extractCanonAdapterStage, extractClassificationAdapterStage,
    claimReferenceValidationStage, variableAssignmentStage,
    structureStage, structureRelationAdapterStage, structureConclusionAdapterStage,
    formulaCompilationStage, formulaValidationStage,
  ]
  return { id: PIPELINE_ID, version: PIPELINE_VERSION, inputSchema: INGESTION_INPUT_SCHEMA, outputSchema: extension.responseSchema, stages, finalize: { dependsOn: [...the 6 slots, optional where scholar marks optional...], run: (ctx) => finalizeResponseV2({ ctx, extension }) } }
}
```

Reuse the 4 deterministic stage CONSTS by import (reference-equality with scholar — the invariant). Reuse scholar's `INGESTION_INPUT_SCHEMA` (export it from scholar.ts or relocate it to base).

- [ ] **Step 7: Wire scribe into the ingestion barrel**

`scribe/index.ts`: `export { createScribePipeline } from "./scribe.js"`. In `ingestion/index.ts` add: `export { createScribePipeline } from "./scribe/index.js"`.

- [ ] **Step 8: Run to verify the scribe tests pass**

Run: `pnpm vitest run test/extensions/pipelines/scribe.test.ts`
Expected: PASS (all 4 cases).

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(pipelines): add createScribePipeline (2 cheap LLM stages + adapters over scholar backend)"
```

---

## Task 6: Drop v1 single-shot + finalizeResponse + their tests/fixtures

**Files:**
- Delete: `src/extensions/pipelines/_v1-single-shot.ts`, `src/extensions/pipelines/base/finalize-response.ts`.
- Delete: `test/extensions/pipelines/v1-single-shot.test.ts`, `test/extensions/pipelines/finalize-response.test.ts`, `test/extensions/pipelines/e2e.test.ts`.
- Delete v1 fixtures: per case under `test/extensions/pipelines/fixtures/<case>/` remove `recorded-llm.json` + `expected.json` (KEEP `v2-recorded-llm.json` + `v2-expected.json` + `input.txt`).
- Modify: `test/extensions/pipelines/llm-options-overrides.test.ts` — remove the v1 import + the `createIngestionV1Pipeline` describe block.
- Modify: `test/extensions/pipelines/recording-provider.test.ts` — repoint the v1-pipeline build to `createScholarPipeline`.
- Verify: no remaining references to dropped symbols anywhere.

**Interfaces:**
- Consumes: nothing.
- Produces: a tree with zero v1/`finalizeResponse` references.

- [ ] **Step 1: Delete the v1 source + finalize-response source**

```bash
git rm src/extensions/pipelines/_v1-single-shot.ts
git rm src/extensions/pipelines/base/finalize-response.ts
```

- [ ] **Step 2: Delete the v1 test files**

```bash
git rm test/extensions/pipelines/v1-single-shot.test.ts
git rm test/extensions/pipelines/finalize-response.test.ts
git rm test/extensions/pipelines/e2e.test.ts
```

- [ ] **Step 3: Delete the v1 fixtures (keep v2 + input.txt)**

```bash
for d in test/extensions/pipelines/fixtures/*/; do
  git rm "$d/recorded-llm.json" "$d/expected.json"
done
```

- [ ] **Step 4: Edit the two surviving v1-referencing tests**

In `llm-options-overrides.test.ts`: remove the `createIngestionV1Pipeline` / `V1_PARSE_STAGE_ID` import and the entire `describe("createIngestionV1Pipeline …")` block. Repoint the v2 blocks' import to `createScholarPipeline` from `../ingestion/scholar/index.js` (and rename in-test references).

In `recording-provider.test.ts`: change the v1-pipeline construction (`createIngestionV1Pipeline(...)`) to `createScholarPipeline(...)` with the new import; adjust any v1-specific assertion.

Also rename the surviving `v2-multi-stage.test.ts` / `v2-e2e.test.ts` files' in-content references already done in Task 3; optionally `git mv` them to `scholar.test.ts` / `scholar-e2e.test.ts` for clarity (keep fixture filenames `v2-*.json` — they are the recorded data, renaming them would require re-keying paths in the test; leave fixture names as-is, they're internal).

- [ ] **Step 5: Sweep for stragglers**

Run: `grep -rn "createIngestionV1Pipeline\|createIngestionV2Pipeline\|V1_PARSE_STAGE_ID\|TCreateIngestionV1PipelineOptions\|TCreateIngestionV2PipelineOptions\|finalizeResponse\b\|TFinalizeResponseInput\b" src test`
Expected: **only comment/JSDoc mentions in non-ingestion files** (e.g. `src/extensions/openai/errors.ts`, `ollama/provider-live.test.ts`, `openai/provider.test.ts`) that reference the OLD name in prose. Update those prose mentions to `createScholarPipeline` (they are doc comments, safe to edit — NOT prompt strings). Zero code references to dropped symbols.

- [ ] **Step 6: Verify typecheck + full suite green**

Run: `pnpm run typecheck`
Expected: clean.

Run: `pnpm vitest run`
Expected: PASS — fewer tests than baseline (v1 suites removed), 0 failures. Scholar e2e (`v2-e2e.test.ts`) still green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(pipelines): drop v1 single-shot + finalizeResponse (dead after scholar/scribe)"
```

---

## Task 7: Repoint the CLI `parse` command to scholar

**Files:**
- Modify: `src/cli/commands/parse.ts`.
- Verify: `scripts/smoke-test.sh` (CLI smoke — check the parse invocation still matches).

**Interfaces:**
- Consumes: `createScholarPipeline` (Task 3), `createScribePipeline` (Task 5), `basicsExtension` from `@proposit/proposit-core/pipelines/*` — but the CLI imports relatively from `src/`. Use `../../extensions/pipelines/ingestion/index.js` + `../../extensions/pipelines/base/index.js`.

- [ ] **Step 1: Update imports + construction**

In `parse.ts`:
- Import line `:11-15`: replace `createIngestionV1Pipeline` (from `../../lib/index.js`, which no longer re-exports it) with `createScholarPipeline` (and `createScribePipeline`) from `../../extensions/pipelines/ingestion/index.js`; import `basicsExtension` from `../../extensions/pipelines/base/index.js`; keep `executePipeline` from `../../lib/index.js`.
- Construction `:127-130`: `const pipeline = (opts.pipeline === "scribe" ? createScribePipeline : createScholarPipeline)(basicsExtension, { llm: { defaults: { model: opts.model ?? DEFAULT_PARSE_MODEL } } })`.

- [ ] **Step 2: Rework the `--pipeline` flag**

- `:60-64`: change the option to `.option("--pipeline <name>", "Ingestion pipeline (scholar or scribe)", "scholar")`.
- `:84-95`: replace the v1-only / v2-reject branch with validation accepting `scholar`|`scribe`: `if (opts.pipeline !== "scholar" && opts.pipeline !== "scribe") errorExit(\`Unknown pipeline "${opts.pipeline}". Supported: scholar, scribe.\`)`.
- `:123-126`: update the "build the v1 ingestion pipeline" comment to describe scholar/scribe.

- [ ] **Step 3: Fix the now-live null branch (:146-156)**

The block that says `output === null` is "not reachable under v1 single-shot … leave wired for a v2 cutover" is now a LIVE path (scholar/scribe finalize returns `argument: null` on empty-canon / no-conclusion). Rewrite the comment to state the null branch handles a finalize that produced no argument (degraded import), and ensure the code path prints the `failureText` / exits cleanly rather than treating null as impossible.

- [ ] **Step 4: Build + smoke the CLI**

Run: `pnpm run build`
Expected: build succeeds (tsc + typedoc clean — this also validates the new typedoc entry points + subpath d.ts emission).

Run: `node dist/cli.js parse --help`
Expected: help shows `--pipeline <name>` with `scholar`/`scribe`.

Run: `grep -n "parse" scripts/smoke-test.sh`
Expected: if the smoke test invokes `parse` with `--pipeline v1` or asserts v1 output, update it to `--pipeline scholar` (or drop the flag). Re-run `bash scripts/smoke-test.sh` if it does not require network (it needs a build; if it requires an API key for `parse`, leave that arm as-is and note it).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cli): repoint parse to scholar/scribe; rework --pipeline flag"
```

---

## Task 8: Invariant test — scribe reuses scholar's deterministic consts by reference

**Files:**
- Test: `test/extensions/pipelines/reuse-invariant.test.ts` (new).

**Interfaces:**
- Consumes: `createScholarPipeline`, `createScribePipeline`, the 4 deterministic stage consts.

- [ ] **Step 1: Write the invariant test**

```ts
import { describe, it, expect } from "vitest"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import {
    claimReferenceValidationStage,
    variableAssignmentStage,
    formulaCompilationStage,
    formulaValidationStage,
} from "../../../src/extensions/pipelines/base/stages/index.js"

describe("scribe reuses scholar's deterministic stages by reference (the reuse invariant)", () => {
    const scholar = createScholarPipeline(basicsExtension)
    const scribe = createScribePipeline(basicsExtension)
    const shared = [claimReferenceValidationStage, variableAssignmentStage, formulaCompilationStage, formulaValidationStage]

    it.each(shared.map((s) => [s.id, s] as const))("both pipelines include the same %s stage const", (_id, stageConst) => {
        expect(scholar.stages).toContain(stageConst)
        expect(scribe.stages).toContain(stageConst)
    })

    it("scribe populates the 6 finalize slots via its stage ids", () => {
        const ids = new Set(scribe.stages.map((s) => s.id))
        for (const id of ["claim-canonicalization", "claim-type-classification", "variable-assignment", "relation-extraction", "conclusion-selection", "formula-compilation"]) {
            expect(ids.has(id)).toBe(true)
        }
    })
})
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run test/extensions/pipelines/reuse-invariant.test.ts`
Expected: PASS. If `toContain` fails, scribe rebuilt a deterministic stage instead of importing the const — fix scribe to import the const.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(pipelines): pin scribe↔scholar deterministic-stage reuse invariant"
```

---

## Task 9: scribe golden fixtures (LIVE LLM — flagged-deferrable)

**Files:**
- Create per case `test/extensions/pipelines/fixtures/<case>/scribe-recorded-llm.json` + `scribe-expected.json`.
- Create: `test/extensions/pipelines/scribe-e2e.test.ts` (replay-mode golden driver, mirroring `v2-e2e.test.ts`).

**Interfaces:** mirrors `v2-e2e.test.ts` — replay provider + `createDeterministicGenerateId()`, assert `result.output` deep-equals the recorded `scribe-expected.json` runtime portion.

> **GATE:** recording needs `OPENAI_API_KEY` + the record flag and spends quota. If unavailable, implement `scribe-e2e.test.ts` but `describe.skip` it (mirroring the live suites) with a comment, and report this as the one deferred step. Do NOT block Tasks 1–8 or the `check` on it.

- [ ] **Step 1: Write scribe-e2e.test.ts (replay-mode, skipped if no recordings)**

Mirror `v2-e2e.test.ts`: load `input.txt`, run `createScribePipeline` under `createRecordingLlmProvider({ fixtureDir, mode: "replay", fileName: "scribe-recorded-llm.json" })`, `expect(result.output).toEqual(splitExpected(scribeExpected).runtime)`. Guard the whole describe with `describe.skipIf(!existsSync(firstScribeRecording))` so it is inert until recordings exist.

- [ ] **Step 2 (LIVE — only if key available): record the fixtures**

Run (per the repo's record convention — confirm the exact env flag from `recording-provider.ts`): `OPENAI_API_KEY=sk-... <RECORD_FLAG>=1 pnpm vitest run test/extensions/pipelines/scribe-e2e.test.ts`
Expected: writes `scribe-recorded-llm.json` + `scribe-expected.json` per case. Review the expected outputs for sanity (compiled formula present, conclusion resolved).

- [ ] **Step 3: Verify replay-mode passes**

Run: `pnpm vitest run test/extensions/pipelines/scribe-e2e.test.ts`
Expected: PASS (or SKIPPED if Step 2 was deferred — report it).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(pipelines): scribe golden e2e (replay) + recorded fixtures"
```

---

## Task 10: Docs + release-note content (no version cut)

**Files:**
- Modify: `docs/api-reference.md` — drop v1 + `finalizeResponse` sections; rename the v2 factory section → `createScholarPipeline`; add `createScribePipeline`; document the new subpaths + the 3 newly-public helpers.
- Modify: `docs/release-notes/upcoming.md` — user-facing 3.0.0 notes.
- Modify: `docs/changelogs/upcoming.md` — developer changelog with the commit-hash range of this branch.
- Modify: `README.md` if it has ingestion-factory mentions / import examples (grep first).
- Run: `skill-cefailures:documentation-sync`.

> **Constraint:** Do NOT rename `upcoming.md` → `v3.0.0.md`, do NOT `pnpm version`, do NOT `git tag`. Author the `upcoming.md` content for the future cut only.

- [ ] **Step 1: Edit docs/api-reference.md**

Grep `docs/api-reference.md` for `createIngestionV1Pipeline`, `createIngestionV2Pipeline`, `finalizeResponse`. Delete the `createIngestionV1Pipeline` subsection (`~:1736-1738`) and any `finalizeResponse` mention. Rename the `createIngestionV2Pipeline` subsection (`~:1740-1742,1770,1774`) to `createScholarPipeline`, update its import example to `import { createScholarPipeline } from "@proposit/proposit-core/pipelines/ingestion"`. Add a `createScribePipeline` subsection (2-LLM-call fast import, same output shape, `{ llm }` options, `gpt-5.4-mini` default). Add a short "Ingestion pipeline subpaths" note documenting `./pipelines/base` + `./pipelines/ingestion` and the newly-public `selectFallbackConclusion` / `buildResponseSchema` / `buildClaimRecordSchema`.

- [ ] **Step 2: Write docs/release-notes/upcoming.md (user-facing)**

Plain language: a new fast import option (scribe) alongside the thorough one (scholar); the import factories moved to dedicated subpaths; the legacy single-shot pipeline was removed. No jargon, no slice/phase labels.

- [ ] **Step 3: Write docs/changelogs/upcoming.md (developer)**

Get the hash range: `git log --oneline main..HEAD`. List breaking (factory renames, dropped `createIngestionV1Pipeline`/`V1_PARSE_STAGE_ID`/`finalizeResponse`, `PIPELINE_ID` strings `argument-ingestion-scholar`/`-scribe`, root-barrel → subpath move) + additive (`createScribePipeline`, the 3 newly-exported helpers, the 2 new subpaths) with the commit hashes.

- [ ] **Step 4: README sweep**

Run: `grep -n "createIngestionV\|argument-ingestion\|finalizeResponse" README.md CLI_EXAMPLES.md`
Update any factory name / import path / `--pipeline` example to scholar/scribe + the new subpath. Do not touch prompt-string examples.

- [ ] **Step 5: Run documentation-sync**

Invoke `skill-cefailures:documentation-sync`; address any tracked-file drift it flags (AGENTS.md routing only if a new invariant/route was introduced — the new subpath convention may qualify; the api-reference edits cover API detail).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(pipelines): api-reference + release notes for the 3.0.0 ingestion restructure"
```

---

## Task 11: Full verification gate

- [ ] **Step 1: Run the full check**

Run: `pnpm run check`
Expected: typecheck + lint + test + build all green. (Build validates typedoc entry points + the new subpath `.d.ts` emission.)

- [ ] **Step 2: Confirm scholar byte-identity one more time**

Run: `pnpm vitest run test/extensions/pipelines/v2-e2e.test.ts`
Expected: PASS with zero fixture changes since Task 1.

- [ ] **Step 3: Final straggler sweep**

Run: `grep -rn "createIngestionV1Pipeline\|V1_PARSE_STAGE_ID\|finalizeResponse\b\|argument-ingestion-v2\|argument-ingestion-v1" src test docs` (allow only historical mentions in `docs/release-notes/v2*.md` / `docs/changelogs/v2*.md` — the changelog history).
Expected: no live code/spec references to the dropped/renamed symbols.

- [ ] **Step 4: Report** — summarize landed work, the `pnpm run check` result, the branch/worktree, and whether Task 9 (scribe recordings) was completed or deferred. Do NOT cut the version.

---

## Self-Review (spec coverage)

- Relocate to `extensions/pipelines/{base,ingestion}` → Task 1. `role-derivation.ts` included → Task 1 Step 1.
- New STAGE_IDS in `base/stages/schemas.ts` → Task 3 Step 1.
- Per-dir subpath exports + move off root barrel + typedoc → Task 4.
- Factory rename + `TCreateScholarPipelineOptions` + `PIPELINE_ID` → Task 3.
- scribe: 1 LLM + 2 adapters per call; conclusion adapter reproduces resolution + `NO_SINGLE_CONCLUSION`; per-extension schema; export the 3 helpers → Tasks 2 + 5.
- Reuse the 4 det consts + `finalizeResponseV2` verbatim; invariant test → Tasks 5 + 8.
- Drop v1 + `finalizeResponse` + 5 test files + v1 fixtures (keep v2-*) → Task 6.
- CLI repoint incl. `:146-156` live null branch → Task 7.
- Byte-identity acceptance (v2 goldens unchanged) → Task 1 Step 6, Task 3 Step 4, Task 11 Step 2.
- scribe unit/edge + golden → Tasks 5 + 9.
- Docs (api-reference + release rotation content) + documentation-sync → Task 10.
- No version cut / tag / publish → Global Constraints + Task 10 + Task 11 Step 4.
