# Metadata Record Restructuring Design

## Goal

Move descriptive fields (`title`, `description`) from top-level schema fields into a unified `metadata: Record<string, string>` on arguments, premises, and variables. Each object type defines typed base keys with open extensibility for arbitrary additional string key-value pairs.

## Schema Changes

### Approach

Use `Type.Object(knownKeys, { additionalProperties: Type.String() })` for objects with known base keys. Use `Type.Record(Type.String(), Type.String())` for objects with no known keys.

### Argument (`schemata/argument.ts`)

New metadata schema:

```typescript
CoreArgumentMetadataSchema = Type.Object(
    { title: Type.String(), description: Type.Optional(Type.String()) },
    { additionalProperties: Type.String() }
)
```

`CoreArgumentMetaSchema` changes from `{ id, title, description }` to `{ id, metadata }`.

`CoreArgumentVersionedSchema`, `CoreArgumentMutableDataSchema`, `CoreArgumentSchema`, `CoreArgumentVersionMetaSchema`, and `CoreArgumentRoleStateSchema` are unchanged.

### Premise (`schemata/propositional.ts`)

New metadata schema:

```typescript
CorePremiseMetadataSchema = Type.Object(
    { title: Type.Optional(Type.String()) },
    { additionalProperties: Type.String() }
)
```

`CorePremiseMetaSchema` changes from `{ id, title? }` to `{ id, metadata }`.

### Variable (`schemata/propositional.ts`)

New metadata schema:

```typescript
CoreVariableMetadataSchema = Type.Record(Type.String(), Type.String())
```

`CorePropositionalVariableSchema` adds a `metadata` field. `symbol` stays top-level (it is functional/identity, not descriptive metadata).

### YAML Import (`schemata/import.ts`)

`CoreYamlArgumentSchema` changes from `{ title, description?, premises }` to `{ metadata: { title, description?, ... }, premises }`.

`CoreYamlPremiseSchema` changes from `{ title?, role?, formula }` to `{ metadata?: { title?, ... }, role?, formula }`.

## Per-Object Summary

| Object   | Current fields                            | New structure                                       | Metadata base keys                           |
| -------- | ----------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Argument | `id, title, description`                  | `id, metadata`                                      | `title` (required), `description` (optional) |
| Premise  | `id, title?`                              | `id, metadata`                                      | `title` (optional)                           |
| Variable | `id, argumentId, argumentVersion, symbol` | `id, argumentId, argumentVersion, symbol, metadata` | none (open `Record<string, string>`)         |

## Affected Layers

1. **Schemas** — `schemata/argument.ts`, `schemata/propositional.ts`, `schemata/import.ts`
2. **Core engine** — `ArgumentEngine` and `PremiseManager` constructors, serialization, and any code accessing `title`/`description` directly
3. **CLI commands** — `arguments create`, `premises create/update` CLI flags map into `metadata` object
4. **CLI storage** — reads/writes follow the schema automatically, but field access code may need updating
5. **Diff types and comparators** — `types/diff.ts` comparators reference `title`/`description` as field names; update to look inside `metadata`
6. **YAML import function** — `importArgumentFromYaml` passes `metadata` through instead of extracting individual fields
7. **Tests** — all fixtures constructing arguments/premises with `title`/`description` need updating

## Breaking Changes

- Disk format changes (`meta.json` for arguments and premises). No migration — clean break (pre-release software).

## Design Decisions

- **Variable `symbol` stays top-level** — it is a functional/identity field used in evaluation and display, not descriptive metadata.
- **Metadata value type is `string`** — simple string values only. Covers all current and anticipated text metadata.
- **Premise `title` stays optional** — unlike argument `title` which is required.
- **`additionalProperties: Type.String()`** — standard JSON Schema pattern for typed base keys with open extension.
