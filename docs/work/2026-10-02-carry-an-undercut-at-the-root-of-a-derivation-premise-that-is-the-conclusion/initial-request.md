# Carry an undercut at the root of a derivation premise that is the conclusion

Found by the combined 6.0.0 review (carrying), and confirmed by running a probe.

## Problem

`carryInference` (`src/lib/core/response/carry.ts`, the derivation check) tests "in a derivation premise" before "at the conclusion root".

Suppose X's conclusion is a derivation premise `S → Q`. That breaks rule D-6, but D-6 is a Derivable-tier rule, so the argument still evaluates. A response Y undercuts its root, and the reader agrees with Y:

- carrying reports `derivationOperator`, a reason that says evaluation ignores the decision;
- `evaluate` with that rejection returns `conclusionInferenceRejected: true`, because `argument-evaluation.ts` (around lines 334-337) does not exempt derivation premises.

So a decision evaluation would act on is left uncarried. No wrong value is carried, only a value evaluation would use is missed, under a misleading reason.

## Proposed direction

Test `inConclusion && atRoot` before `inDerivation`, so the undercut carries `rejected` and sets `conclusionInferenceRejected`, matching the carry table's conclusion-root row. Alternatively, document the case in the carry table. Decide which one before changing it.

## Tests

The probe's shape: a derivation premise as the conclusion, an undercut on its root, and carrying compared against `evaluate`.
