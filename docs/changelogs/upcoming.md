# Changelog

<changes starting-hash="1a9b85c" ending-hash="76ad916">

## Added

- `src/lib/types/validation.ts` — New `TInvariantViolation`, `TInvariantValidationResult` types and 31 violation code constants across 7 entity categories (expression, variable, premise, argument, claim, source, association)
- `src/lib/core/invariant-violation-error.ts` — `InvariantViolationError` extends `Error` with a `violations` array
- `ExpressionManager.validate()` — 10-check sweep: schema, duplicate IDs, self-referential parents, parent existence, parent-is-container, root-only, formula-between-operators, child limits, position uniqueness, checksum verification
- `VariableManager.validate()` — schema, duplicate IDs, duplicate symbols, checksum verification
- `PremiseEngine.validate()` — delegates to ExpressionManager, adds premise schema, root expression consistency, variable reference checks
- `PremiseEngine.setVariableIdsCallback()` / `PremiseEngine.setArgumentValidateCallback()` — callbacks for hierarchical validation
- `ArgumentEngine.validate()` — delegates to all children, adds argument schema, ownership, claim refs, premise refs, circularity, conclusion, checksum verification
- `ClaimLibrary.validate()` — schema, frozen-without-successor
- `SourceLibrary.validate()` — schema, frozen-without-successor
- `ClaimSourceLibrary.validate()` — schema, claim refs, source refs
- `validate()` added to `TArgumentLifecycle`, `TPremiseLifecycle`, `TClaimLibraryManagement`, `TSourceLibraryManagement`, `TClaimSourceLibraryManagement` interfaces
- `setVariableIdsCallback` and `setArgumentValidateCallback` added to `TPremiseLifecycle` interface
- Exported `TInvariantViolation`, `TInvariantValidationResult`, all violation codes, and `InvariantViolationError` from library barrel

## Changed

- All `ArgumentEngine` mutations (`createPremiseWithId`, `removePremise`, `addVariable`, `bindVariableToPremise`, `bindVariableToExternalPremise`, `updateVariable`, `removeVariable`, `setConclusionPremise`, `clearConclusionPremise`) now wrapped in snapshot-validate-rollback bracket
- All `PremiseEngine` mutations (`addExpression`, `appendExpression`, `addExpressionRelative`, `removeExpression`, `updateExpression`, `insertExpression`, `wrapExpression`, `toggleNegation`, `changeOperator`, `deleteExpressionsUsingVariable`, `setExtras`) now wrapped in snapshot-validate-rollback bracket
- All library mutations (`ClaimLibrary.create/update/freeze`, `SourceLibrary.create/update/freeze`, `ClaimSourceLibrary.add/remove`) now wrapped in snapshot-validate-rollback bracket
- `ArgumentEngine.fromSnapshot()` — validates loaded state; throws `InvariantViolationError` on failure
- `ArgumentEngine.fromData()` — default grammar config changed from `PERMISSIVE_GRAMMAR_CONFIG` to `config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG`; validates loaded state
- `ArgumentEngine.rollback()` — validates after restoring; rejects invalid snapshots by restoring pre-rollback state. Extracted `rollbackInternal()` for unvalidated internal rollbacks
- `ExpressionManager.insertExpression()` — now supports `autoNormalize`: auto-inserts formula buffers at two sites (new expression under operator parent, operator children under new operator)
- `ExpressionManager.wrapExpression()` — now supports `autoNormalize`: auto-inserts formula buffers at three sites (operator under parent, existing node under operator, new sibling under operator)
- `ArgumentEngine.markDirty()` — clears cached checksum values to prevent false-positive checksum mismatch violations
- `ArgumentEngine.removeVariable` logic extracted to `removeVariableCore` to avoid nested validation during premise removal cascade
- `ArgumentEngine.variableIdsCallback` wired on PremiseEngines in `createPremiseWithId`, `fromSnapshot`, `rollback`
- `TGrammarConfig` JSDoc updated to reflect `autoNormalize` support in `insertExpression` and `wrapExpression`

## Internal

- Re-entrancy guards (`insideValidation` flag) in `PremiseEngine.withValidation` to prevent redundant validation during internal cascade operations
- `ArgumentEngine` suppresses PremiseEngine validation callbacks during its own `withValidation` bracket to avoid mid-cascade validation
- Stress test timeout increased to 30s to accommodate per-mutation validation overhead
- 69 new tests across 9 describe blocks covering all validate() methods, withValidation brackets, bulk path validation, autoNormalize in insertExpression/wrapExpression, and loadExpressions grammar enforcement

</changes>
