# Outcome — core slice (argument-diff four-state)

## Status: implementation-complete, green — pending release + consumer-side validation

Commits `1cc69bb..00ce62f` (tcw-start `057bf83` + 6 impl/docs commits). `pnpm run check`
green: 2003 passed | 14 skipped; new `test/diff-state.test.ts` 13 passing.

### Delivered (Tasks 1–8)
- `TCoreDiffState` four-state union (`added`/`removed`/`modified-own`/`modified-within`);
  matched entities tagged own-vs-within. No `"unchanged"` member (decided); argument root
  defaults `modified-within`, `isDiffEmpty` decides true emptiness.
- Conclusion reassignment folds into argument own-state.
- Reference-edge propagation: claim/variable changes mark referencing premises `modified-within`
  (containment/own wins; no clobber/dup).
- Regression-lock tests: diff-stability (unchanged→empty; single edit→exactly one `modified-own`)
  and derivation-premise non-leakage. Two-variables-per-claim confirmed = **one** origin.
- Dead-ternary cleanup (`bllm-agent`, `914617a`); id-stability contract JSDoc + api-reference +
  changelog + release-notes (`00ce62f`).

### Review
- Task review: spec ✅, quality Approved (2 Minor; dead-ternary fixed, matcher-guard note-only).
- Dual review (subagent + bllm-review-many) clean; converged only on the dead ternary.

### Open questions resolved
- OQ3 (diffArguments shape): **enrichment**, not restructure.
- OQ5 (derivation premises): core filters nothing; pruned upstream at server publish → no leakage.

## Remaining before this slice can complete (release gate)
1. Version cut `2.4.3 → 2.5.0` (minor; additive API). Rename `upcoming.md` release-notes/changelog
   → `v2.5.0.md`. **Do not push the tag / publish** (tag push triggers CI release).
2. Consumer-side validation (orchestrator-dispatched): `pnpm pack` → each consumer
   (`proposit-server`, `proposit-shared`, `proposit-mobile`) `pnpm add <tgz>` + `check:full` →
   PUBLISH-READY verdict. Change is additive, so expected green.
3. **User** publishes `@proposit/core@2.5.0`; consumers revert `file:` pins → `^2.5.0`.
4. Only then does the shared slice unblock.
