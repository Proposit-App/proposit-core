# Changelog

All notable changes to proposit-core are documented here.

---

## 0.5.0 (unreleased)

Global, inter-argument entity libraries with versioning and freeze semantics.

### Added

- **`AssertionLibrary`** — versioned repository for assertion entities. Supports `create`, `update`, `freeze`, `get`, `getCurrent`, `getAll`, `getVersions`, `snapshot`, and `fromSnapshot`.
- **`SourceLibrary`** — versioned repository for source entities (same API shape as `AssertionLibrary`).
- **`CoreAssertionSchema`** — new schema (`id`, `version`, `frozen`, `checksum`) with `additionalProperties: true`.
- **`TAssertionLookup` / `TSourceLookup`** — narrow lookup interfaces for dependency inversion.
- **`TAssertionLibrarySnapshot` / `TSourceLibrarySnapshot`** — serialization types for libraries.
- Variables now require `assertionId` and `assertionVersion` fields referencing a valid assertion in the library.
- `updateVariable` accepts `{ symbol?, assertionId?, assertionVersion? }` (assertion fields must be provided together).
- Source associations now carry `sourceVersion`.
- `assertionFields` added to `TCoreChecksumConfig`.

### Changed

- **`ArgumentEngine` constructor** — now `(argument, assertionLibrary, sourceLibrary, options?)`. Libraries are required.
- **`ArgumentEngine.fromSnapshot` / `fromData`** — now take `assertionLibrary` and `sourceLibrary` parameters.
- **`CoreSourceSchema`** — dropped `argumentId`/`argumentVersion`, added `version`/`frozen`. Sources are now global entities.
- **`SourceManager`** — stripped to association-only registry. No longer generic (`TSource` param removed).
- **`TSourceManagerSnapshot`** — contains only `variableSourceAssociations` and `expressionSourceAssociations`.
- `addVariableSourceAssociation` signature: `(sourceId, sourceVersion, variableId)`.
- `addExpressionSourceAssociation` signature: `(sourceId, sourceVersion, expressionId, premiseId)`.
- `defaultCompareVariable` now compares `assertionId` and `assertionVersion`.
- Association comparators now compare `sourceVersion`.

### Removed

- `ArgumentEngine.addSource()`, `removeSource()`, `getSource()`, `getSources()` — source CRUD moved to `SourceLibrary`.
- `TSource` generic parameter from `TCoreChangeset`, `TCoreMutationResult`, `TReactiveSnapshot`, `TCoreArgumentDiff`, `TCoreDiffOptions`, `ChangeCollector`, `PremiseEngine`, and all engine interfaces.
- `sources` field from `TCoreChangeset`, `TReactiveSnapshot`, and `TCoreArgumentDiff`.
- `defaultCompareSource` function.
- `TSourceRemovalResult` type (replaced by `TSourceAssociationRemovalResult`).
- Orphan source cleanup (`SourceManager.removeOrphans()`).

---

## 0.4.0

Source management system with argument-scoped sources, associations, and IEEE extension.

### Added

- **`SourceManager`** — manages source entities and their associations to variables and expressions within an argument.
- **`TSourceManagement` interface** — capability interface for source operations on `ArgumentEngine` and `PremiseEngine`.
- **`CoreSourceSchema`** and association schemas (`CoreVariableSourceAssociationSchema`, `CoreExpressionSourceAssociationSchema`).
- Source and association diffing (`defaultCompareSource`, `defaultCompareVariableSourceAssociation`, `defaultCompareExpressionSourceAssociation`).
- Source validation checks in evaluation pipeline.
- CLI source commands: `source add`, `source remove`, `source list`, `source show`, `source link-variable`, `source link-expression`, `source unlink`.
- CLI source storage I/O and disk hydration.
- **IEEE extension** (`src/extensions/ieee/`) — IEEE reference schemas and `IEEESourceSchema`.
- Engine capability interfaces (`TDisplayable`, `TChecksummable`, `TPremiseCrud`, `TVariableManagement`, etc.) with full JSDoc.
- `wrapExpression` on `ExpressionManager` and `PremiseEngine`.

### Changed

- `ArgumentEngine` and `PremiseEngine` implement capability interfaces.
- `TCoreChangeset` and `TCoreMutationResult` gained `TSource` generic parameter and `sources` field.
- `TCoreArgumentDiff` gained `sources` field.
- `TReactiveSnapshot` gained `sources` field.
- Interface JSDoc moved from engine classes to interface files.
- Engine interfaces re-exported from library barrel.

---

## 0.3.0

Naming conventions, file organization, and `wrapExpression`.

### Added

- `wrapExpression` method on `ExpressionManager` and `PremiseEngine` — wraps an existing expression in a new binary operator.
- ESLint `@typescript-eslint/naming-convention` rule enforcement.
- `eslint-plugin-check-file` for kebab-case filename enforcement.

### Changed

- All multi-word source files renamed from camelCase to kebab-case.
- Type aliases renamed to use `T` prefix (`FormulaAST` → `TFormulaAST`, `UUID` → `TUUID`, `JsonValue` → `TJsonValue`, etc.).
- `DateType()` → `dateType()`, `Nullable` param `T` → `schema`.
- API reference moved to `docs/api-reference.md`.

---

## 0.2.0

Public API redesign for dual-instance synchronization.

### Added

- `TCoreMutationResult<T>` — all mutating methods now return result + changeset.
- Entity checksums (`checksum` field on expressions, variables, premises, arguments).
- `ArgumentEngine` constructor option `checksumConfig`.
- Generic engine types (`ArgumentEngine<TArg, TPremise, TExpr, TVar>`).
- Configurable position range (`TCorePositionConfig`).
- `diffArguments` standalone function with pluggable comparators.
- `analyzePremiseRelationships` and `buildPremiseProfile`.
- Formula parser (`parseFormula`).
- Reactive snapshot (`TReactiveSnapshot`).

### Changed

- Supporting premises are now derived (any inference premise not designated as conclusion).
- `TCoreArgumentRoleState` stores only `{ conclusionPremiseId? }`.
- `CorePremiseSchema` slimmed to `{ id, argumentId, argumentVersion, checksum }`.
- Publish semantics: publishing copies to a new unpublished version.

### Removed

- `addSupportingPremise()` and `removeSupportingPremise()`.
- `supportingPremiseIds` from `TCoreArgumentRoleState`.
- `variables`, `expressions`, `rootExpressionId` from `CorePremiseSchema`.
