# Schema Slimming Design

## Problem

The core library's schemas include metadata fields (title, description, createdAt, published, publishedAt) that are CLI concerns, not logic concerns. This makes the schemas rigid for consumers who want to extend them with their own fields. Additionally, the library should preserve consumer-added fields through round-trips.

## Design

### Core schema changes

Strip schemas down to only fields the engine uses for logic:

**Argument**: `{ id, version }`

- Remove: `metadata` (title, description), `createdAt`, `published`, `publishedAt`
- Remove intermediate schemas: `CoreArgumentMetadataSchema`, `CoreArgumentVersionedSchema`, `CoreArgumentMutableDataSchema`, `CoreArgumentVersionMetaSchema`

**Premise**: `{ id, rootExpressionId, variables, expressions }`

- Remove: `metadata` (title)
- Remove intermediate schemas: `CorePremiseMetadataSchema`, `CorePremiseMetaSchema`

**Variable**: `{ id, argumentId, argumentVersion, symbol }`

- Remove: `metadata`
- Remove: `CoreVariableMetadataSchema`

**Expression, RoleState, Analysis**: unchanged.

All core schemas use `additionalProperties: true` so Typebox validation does not strip unknown fields.

### Unknown field preservation

The engine stores the full objects it receives (including consumer-added fields). When returning data via `toData()`, `getArgument()`, `getVariables()`, etc., it spreads the original object and overrides with current engine state:

```ts
// Conceptual example
toData() {
    return { ...this.originalObject, ...this.currentEngineState }
}
```

This ensures consumer fields survive round-trips through the engine.

### CLI extensions

The CLI defines its own extended schemas via `Type.Intersect`, with extra fields at the root level (not nested under a `metadata` key):

```ts
const CliArgumentSchema = Type.Intersect([
    CoreArgumentSchema,
    Type.Object({
        title: Type.String(),
        description: Type.Optional(Type.String()),
        createdAt: Type.Number(),
        published: Type.Boolean(),
        publishedAt: Type.Optional(Type.Number()),
    }),
])
```

Similar flat extensions for premises (`title`) and variables (TBD per CLI needs).

### Moved out of core

- `importArgumentFromYaml` and YAML schemas (`import.ts`) move to the CLI layer, since the YAML format is opinionated about metadata.
- `parseFormula` stays in core (purely logic-related).

### Breaking changes

- Removed metadata schemas/types no longer exported from core
- `importArgumentFromYaml` no longer in core public API
- `TCoreArgument`, `TCorePremise`, `TCorePropositionalVariable` shapes change (fewer fields)

### Not in scope

- Timestamp type change (`createdAt`, `publishedAt`) — separate future work
- CJS support, CLI trimming from package — not needed
