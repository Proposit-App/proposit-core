# Enrich diffArguments with explicit four-state model and id-stability contract

## Product changes

## Technical changes

## Meta changes

# Enrich diffArguments: four-state model + expressions.modified + conclusion-role + reference-version; document id-stability contract

Core slice of the cross-repo epic `2026-07-12-argument-diff-unified-modification-semantics-cross-repo`.
Authoritative design: `docs/design/2026-07-12-argument-diff-modification-semantics.md` (workspace root).

## Problem

`diffArguments` returns a three-bucket set diff (`added` / `removed` / `modified`) per entity kind, with no explicit own-vs-within distinction and no reference-edge propagation. Consequences the epic must close at the core layer:

- A "modified" premise/expression carries no explicit state saying whether *its own* content changed or only something it contains/references. Consumers must re-derive this, and they do so inconsistently (server drops `expressions.modified` entirely).
- A claim edit (variable `claimVersion` bump) marks the *variable* modified but does NOT mark the premises that reference it — the reference edge is never traversed, so "this premise is touched by a changed claim" is unexpressed.
- `conclusionPremiseId` reassignment is emitted as a standalone `roles` field, not folded into the argument's own-state, so consumers can miss it.
- No documented contract that version-producing paths must preserve entity ids — the invariant the whole `modified` state rests on.

## Root cause

`src/lib/core/diff.ts` is a flat, comparator-driven set diff. It never consults the checksum decomposition (`checksum` / `descendantChecksum` / `combinedChecksum`) that already exists on Argument, Premise, and Expression, and it never walks the reference edge (variable-expression -> variable -> claim@version). The output type (`src/lib/types/diff.ts`) has no `state` discriminant.

## Proposed fix (enrichment, not restructure)

Keep the existing `added` / `removed` / `modified` / `roles` shape; enrich it:

1. Add a `TCoreDiffState` discriminant (`added` | `removed` | `modified-own` | `modified-within`) and tag every matched entity. own = its own comparator changes (its `checksum` differs); within = own unchanged but a containment child or a referenced entity changed.
2. Reference-edge within-propagation: mark premises/expressions `modified-within` when a variable they reference is `modified-own` (this is the reference-version awareness — `claimVersion` bumps flow through).
3. Fold `conclusionPremiseId` change into the argument's own-state (`modified-own`), keeping the `roles` detail.
4. Confirm `expressions.modified` is surfaced (it already is in core; the in-place operator edit `and`->`or` already lands in `expressions.modified[].changes`) and covered by the state tagging.
5. Document the id-stability contract in `diffArguments`' doc comment.

Owns epic open questions:
- OQ3 (diffArguments shape): resolved = enrichment.
- OQ5 (derivation premises): resolved = core does not synthesize/filter anything in the diff path; naked-Q pruning is upstream (server publish). Regression-lock that derivation premises diff like ordinary premises with no synthesized within-leakage.

## Consumer impact

The enriched `TCoreArgumentDiff` is the foundation the shared slice re-wraps as the wire `TArgumentDiff`. Additive `state` field is backward-shaped (existing `added`/`removed`/`modified` arrays retained), but the shared/server/mobile slices adopt the new state semantics. Publish is gated on consumer-side validation at the workspace root — do not self-publish.

