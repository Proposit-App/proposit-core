# Argument Parsing — Design Spec

**Date:** 2026-03-16
**Status:** Draft

## Overview

A new library capability that converts human-language text into a fully populated `ArgumentEngine` with associated libraries (`ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary`). The library is AI-model-agnostic — it provides prompt construction, response schemas, and an ingestion pipeline, but does not call any AI model directly.

A companion `src/extensions/basics/` module demonstrates the extension pattern by adding common metadata fields (title, body) to the core schemas and parsing pipeline.

## Decisions

| Decision | Choice |
|----------|--------|
| Scope | Raw text → full proposit model (claims, sources, variables, premises with formula-string ASTs) |
| Argument count | Single argument; `selectionRationale` explains choice if multiple found |
| Unprocessable content | `uncategorizedText` field for irrelevant/unprocessable text |
| Source representation | Minimal — raw text/URL + miniId; developer maps to their `TSource` |
| Ingestion phases | Two-phase: validate response → build engine + libraries |
| Prompt strategy | Hybrid — hand-crafted core prose + schema-driven extension instructions |
| Schema constraint discovery | Prompt builder reads `minLength`/`maxLength`/`description` from TypeBox attributes |
| Builder extensibility | Subclassable class with protected mapping hooks |
| Formula format | Formula strings (e.g., `"V1 and V2 implies V3"`) parsed by existing `parseFormula()` |
| Module location | `src/lib/parsing/` (core), `src/extensions/basics/` (metadata extension) |
| Naming | "parsing" — `ArgumentParser`, `TParsedArgumentResponse`, etc. |
| Metadata fields | Not in core schemas; provided by basics extension (title/body on claims, title on premises and arguments) |
| Cross-reference identifiers | `miniId` — short placeholder for future UUIDs, avoids collision with propositional variable "symbol" |

## Module Layout

```
src/lib/parsing/               # Core parsing (model-agnostic, no metadata fields)
├── schemata.ts                # Response schemas (TParsedArgumentResponse, etc.)
├── prompt-builder.ts          # Composable prompt builder
├── argument-parser.ts         # Subclassable builder class
├── types.ts                   # Options types, prompt config
└── index.ts                   # Barrel

src/extensions/basics/         # "Basics" extension: common metadata fields
├── schemata.ts                # Extended core + parsing schemas (title/body)
├── argument-parser.ts         # Subclass of core ArgumentParser
└── index.ts                   # Barrel
```

## AI Response Schema (Core)

All schemas use `additionalProperties: true` for developer extensibility.

### `TParsedArgumentResponse`

```typescript
{
  argument: {
    claims: TParsedClaim[]
    variables: TParsedVariable[]
    sources: TParsedSource[]
    premises: TParsedPremise[]
    conclusionPremiseMiniId: string  // miniId of the conclusion premise
  } | null
  uncategorizedText: string | null
  selectionRationale: string | null
  failureText: string | null
}
```

### `TParsedClaim`

```typescript
{
  miniId: string              // e.g., "C1"
  role: "premise" | "conclusion" | "intermediate"
  sourceMiniIds: string[]     // References to sources by miniId
}
```

The `role` field is informational metadata — it communicates the AI's assessment of each claim's function in the argument. The authoritative conclusion designation is `conclusionPremiseMiniId` on the argument object, which references a *premise* (not a claim), consistent with `ArgumentEngine.setConclusionPremise()`.

### `TParsedVariable`

```typescript
{
  miniId: string              // e.g., "V1" — used in formula strings
  symbol: string              // Propositional symbol, e.g., "P", "Q"
  claimMiniId: string         // Which claim this variable is bound to
}
```

One variable per claim within an argument. If multiple premises reference the same claim, they share the same variable in their formula strings. This 1:1 constraint is a parsing-layer simplification — the core engine allows multiple variables per claim.

### `TParsedSource`

```typescript
{
  miniId: string              // e.g., "S1"
  text: string                // Citation/URL as it appears in the text
}
```

Note: `TCoreSource` has no `text` field — it only has system fields (`id`, `version`, `frozen`, `checksum`) with `additionalProperties: true`. In core-only usage, the `text` value from the AI response is not persisted. Developers must subclass `ArgumentParser` and override `mapSource()` to map `text` to an extension field on their custom source type.

### `TParsedPremise`

```typescript
{
  miniId: string              // e.g., "P1"
  formula: string             // e.g., "V1 and V2 implies V3"
}
```

Formula strings use the syntax accepted by `parseFormula()`: variable miniIds as operand names, `and`, `or`, `not`, `implies`, `iff` as operators, parentheses for grouping.

**Root-only constraint:** `implies` and `iff` operators must appear only at the root of a formula (they cannot be nested). This matches the engine's invariant enforced by `ExpressionManager`. The prompt builder includes this constraint in its formula syntax instructions.

## Prompt Builder

```typescript
type TPromptOptions = {
  customInstructions?: string
}

function buildParsingPrompt(
  responseSchema: TSchema,
  options?: TPromptOptions
): string
```

### Behavior

1. **Core prompt** — hand-crafted prose adapted from the server's existing prompts:
   - "You are an expert argument analyst. Analyze the provided text and convert it into a structured propositional argument."
   - Instructions for identifying claims, assigning variables (one per claim, shared across premises), writing formula strings
   - Content that doesn't fit → `uncategorizedText`
   - Multiple arguments → pick the most substantial, explain in `selectionRationale`
   - Can't parse → set `argument` to null, explain in `failureText`
   - Formula syntax rules (operators: `and`, `or`, `not`, `implies`, `iff`; parentheses for grouping)
   - Root-only constraint: `implies` and `iff` must appear only at the root level of a formula, never nested inside other operators
   - Third person, active voice, present tense

2. **Schema-driven extension instructions** — walks the response schema to discover fields beyond the core set. For each extension field, generates an instruction line using the field's `description`, `minLength`, and `maxLength` TypeBox attributes.

3. **Custom instructions** — appends `customInstructions` if provided (domain-specific guidance, e.g., "CMV means change my view").

## Schema Extension Mechanism

```typescript
type TParsingSchemaOptions = {
  claimSchema?: TSchema
  sourceSchema?: TSchema
  variableSchema?: TSchema
  premiseSchema?: TSchema
  parsedArgumentSchema?: TSchema   // Extends the inner parsed argument object, not TCoreArgument
  responseSchema?: TSchema         // Extends the outer TParsedArgumentResponse
}

function buildParsingResponseSchema(
  options?: TParsingSchemaOptions
): TSchema
```

With no options, returns the core response schema. When extensions are provided, merges the developer's additional fields into the corresponding schema objects. The resulting schema is passed to both `buildParsingPrompt()` and `getParsingResponseSchema()`.

## Response Schema Utility

```typescript
function getParsingResponseSchema(
  schema?: TSchema
): object
```

Converts the TypeBox response schema to a standard JSON Schema object for use with any AI model's structured output configuration. Model-agnostic — the developer handles model-specific wrapping.

## ArgumentParser (Builder Class)

```typescript
class ArgumentParser<
  TArg extends TCoreArgument = TCoreArgument,
  TPremise extends TCorePremise = TCorePremise,
  TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
  TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
  TSource extends TCoreSource = TCoreSource,
  TClaim extends TCoreClaim = TCoreClaim,
  TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
>
```

### Two-Phase API

**Phase 1 — Validate:**
```typescript
validate(raw: unknown): TParsedArgumentResponse
```
Validates raw JSON against the response schema (core or extended). Throws on invalid input.

**Phase 2 — Build:**
```typescript
build(response: TParsedArgumentResponse): {
  engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
  claimLibrary: ClaimLibrary<TClaim>
  sourceLibrary: SourceLibrary<TSource>
  claimSourceLibrary: ClaimSourceLibrary<TAssoc>
}
```

### Build Phase Internals

`build()` throws if `response.argument` is null — there is nothing to build. The caller should check for null and handle `failureText` before calling `build()`.

1. **Validate formulas** — for each parsed premise, call `parseFormula()` on the formula string. Verify that every variable name in the resulting AST matches a declared `TParsedVariable.miniId`. Verify that `implies`/`iff` operators appear only at the root. Throw a descriptive error identifying the premise miniId and the specific issue on failure.
2. `mapArgument()` → create `TArg` (build phase generates `id`, `version`, `checksum`)
3. For each parsed claim → `mapClaim()` → `claimLibrary.create()` (build phase generates `id`, `version`, `frozen`, `checksum`)
4. For each parsed source → `mapSource()` → `sourceLibrary.create()` (build phase generates `id`, `version`, `frozen`, `checksum`)
5. Wire up claim-source associations via `sourceMiniIds`
6. Create `ArgumentEngine` with the libraries
7. For each parsed variable → `mapVariable()` → `engine.addVariable()` with claim binding (build phase generates `id`, `argumentId`, `argumentVersion`, `checksum`)
8. For each parsed premise → `mapPremise()` → `engine.addPremise()`, then use the pre-validated formula AST to add expressions (build phase generates all expression system fields)
9. Set conclusion role based on `conclusionPremiseMiniId`

### Protected Mapping Hooks

```typescript
protected mapClaim(parsed: TParsedClaim): Record<string, unknown>
protected mapSource(parsed: TParsedSource): Record<string, unknown>
protected mapVariable(parsed: TParsedVariable): Record<string, unknown>
protected mapArgument(parsed: NonNullable<TParsedArgumentResponse["argument"]>): Record<string, unknown>
protected mapPremise(parsed: TParsedPremise): Record<string, unknown>
```

Mapping hooks return extension fields only. System fields (`id`, `version`, `frozen`, `checksum`, `argumentId`, `argumentVersion`, etc.) are generated by the build phase and must not come from hooks. Default implementations return empty objects (core schemas have no metadata fields). Subclasses override to map extension fields onto their custom entity types.

## Basics Extension

### Extended Schemas (`src/extensions/basics/schemata.ts`)

Core entity extensions:
- `TBasicsArgument` = `TCoreArgument & { title: string, description?: string }`
- `TBasicsClaim` = `TCoreClaim & { title: string, body: string }`
- `TBasicsPremise` = `TCorePremise & { title: string }`

Parsing response extensions (passed to `buildParsingResponseSchema()`):
- `TParsedClaim` + `title: Type.String({ maxLength: 50 })`, `body: Type.String({ maxLength: 500 })`
- `TParsedPremise` + `title: Type.String({ maxLength: 50 })`
- Argument level + `title: Type.String({ maxLength: 50 })`

### Subclassed Parser (`src/extensions/basics/argument-parser.ts`)

```typescript
class BasicsArgumentParser extends ArgumentParser<
  TBasicsArgument, TBasicsPremise, ...
> {
  protected mapClaim(parsed) {
    return { title: parsed.title, body: parsed.body }
  }
  protected mapPremise(parsed) {
    return { title: parsed.title }
  }
  protected mapArgument(parsed) {
    return { title: parsed.title }
  }
}
```

### Pre-Built Schema

Exports a `BasicsParsingSchema` — the result of calling `buildParsingResponseSchema()` with the basics extensions pre-applied. Consumers can pass this directly to `buildParsingPrompt()` and `getParsingResponseSchema()`.

## Exports

### Library barrel (`src/lib/index.ts`)

```typescript
export { ArgumentParser } from "./parsing/argument-parser.js"
export { buildParsingPrompt } from "./parsing/prompt-builder.js"
export { buildParsingResponseSchema, getParsingResponseSchema } from "./parsing/schemata.js"
export type {
  TParsedArgumentResponse, TParsedClaim, TParsedSource,
  TParsedVariable, TParsedPremise, TPromptOptions,
  TParsingSchemaOptions
} from "./parsing/index.js"
```

### Basics extension (`src/extensions/basics/index.ts`)

Imported separately via `proposit-core/extensions/basics`:

```typescript
export { BasicsArgumentParser } from "./argument-parser.js"
export { BasicsParsingSchema } from "./schemata.js"
export type { TBasicsArgument, TBasicsClaim, TBasicsPremise } from "./schemata.js"
```

## Testing

### Core parsing tests (new `describe` blocks in `test/core.test.ts`)

- `buildParsingResponseSchema` — returns core schema with no options; merges extension fields correctly
- `getParsingResponseSchema` — produces valid JSON Schema from TypeBox
- `buildParsingPrompt` — includes core instructions; discovers extension fields and generates constraint instructions from schema attributes; appends `customInstructions`
- `ArgumentParser.validate` — accepts valid response JSON; rejects malformed responses; handles null argument with failureText
- `ArgumentParser.build` — produces working `ArgumentEngine` + libraries from a valid parsed response; correctly maps miniIds to real UUIDs; parses formula strings into expression trees; wires claim-source associations; sets conclusion role; one variable per claim shared across premises
- `ArgumentParser.build` validation — throws on formula referencing undeclared variable miniId; throws on nested `implies`/`iff` in formula; throws on null argument; throws on invalid formula syntax with descriptive error identifying the premise miniId
- `ArgumentParser` subclass hooks — `mapClaim`/`mapSource`/`mapVariable`/`mapArgument`/`mapPremise` overrides called and reflected in built entities

### Basics extension tests (new `test/extensions/basics.test.ts`)

- `BasicsArgumentParser` — maps title/body fields onto claims, premises, and argument
- `BasicsParsingSchema` — includes title/body fields with correct constraints
- Round-trip: parsed response with metadata → build → snapshot contains extended fields

## Notes

- If `.untracked/proposit-server` causes issues during implementation or testing, delete the entire folder.
- CLI migration to basics extension schemas is a follow-up task, not part of this implementation.
- `TPromptOptions` and `TParsingSchemaOptions` live in `src/lib/parsing/types.ts`, imported by `prompt-builder.ts` and `schemata.ts` respectively.
- A `package.json` exports entry must be added for the basics extension: `"./extensions/basics"` pointing to `./dist/extensions/basics/index.js` (and corresponding types entry).
- The `tsconfig.build.json` may need updating to include `src/extensions/` in compilation.
