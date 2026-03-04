# Auto-Conclusion on First Premise

## Problem

An `ArgumentEngine` without a conclusion premise cannot evaluate. Currently, callers must explicitly call `setConclusionPremise()` after creating the first premise. This is an easy step to forget and adds ceremony.

## Design

Modify `createPremiseWithId` to auto-assign the new premise as conclusion when `this.conclusionPremiseId` is `undefined`.

### Behavior

- First `createPremise()` call: premise becomes conclusion; changeset includes `roles`.
- Subsequent `createPremise()` calls: no role change (conclusion already set).
- After `clearConclusionPremise()` or removing the current conclusion, the next `createPremise()` auto-assigns again.
- `setConclusionPremise()` remains available as an explicit override.
- `removePremise()` behavior unchanged: removing the conclusion clears it without auto-reassignment.

### Scope

- One method change in `ArgumentEngine.createPremiseWithId`.
- Tests for the new behavior.
- Documentation updates (README, CLAUDE.md, CLI_EXAMPLES.md, smoke test as needed).
