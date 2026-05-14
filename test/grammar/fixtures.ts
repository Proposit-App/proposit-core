// Inline fixture builders for grammar validator tests. Each helper returns
// a minimal valid instance of the relevant entity type; overrides via the
// `Partial<T>` parameter let each test compose exactly the malformed state
// it wants to assert against.
//
// Conventions per proposit-core/CLAUDE.md: all tests build their own
// fixtures inline — no shared beforeEach state.

import type {
    TCoreArgument,
    TCorePremise,
    TCoreFreeformPremise,
    TCoreDerivationPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariableExpression,
    TCoreOperatorExpression,
    TCoreFormulaExpression,
    TCorePropositionalVariable,
    TClaimBoundVariable,
    TPremiseBoundVariable,
    TCoreClaim,
    TCoreLogicalOperatorType,
} from "../../src/lib/schemata/index.js"
import type { TCoreArgumentRoleState } from "../../src/lib/types/evaluation.js"
import type { TValidatorContext } from "../../src/lib/grammar/validators/context.js"

// -- Context --

/**
 * Build a TValidatorContext from a partial; missing keys default to empty
 * collections and a minimal argument.
 */
export function buildContext(
    parts: Partial<TValidatorContext>
): TValidatorContext {
    return {
        argument: parts.argument ?? makeArgument(),
        premises: parts.premises ?? [],
        expressions: parts.expressions ?? [],
        variables: parts.variables ?? [],
        claims: parts.claims ?? [],
        roleState: parts.roleState ?? {},
    }
}

// -- Argument --

export function makeArgument(
    overrides: Partial<TCoreArgument> = {}
): TCoreArgument {
    return {
        id: "arg-1",
        version: 1,
        checksum: "arg-checksum",
        descendantChecksum: null,
        combinedChecksum: "arg-combined-checksum",
        ...overrides,
    }
}

// -- Premises --

export function makeFreeformPremise(
    overrides: Partial<TCoreFreeformPremise> = {}
): TCoreFreeformPremise {
    return {
        id: "p-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        checksum: "p-checksum",
        descendantChecksum: null,
        combinedChecksum: "p-combined-checksum",
        ...overrides,
        type: "freeform",
    }
}

export function makeDerivationPremise(
    overrides: Partial<TCoreDerivationPremise> = {}
): TCoreDerivationPremise {
    return {
        id: "p-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        derivedClaimId: "claim-1",
        checksum: "p-checksum",
        descendantChecksum: null,
        combinedChecksum: "p-combined-checksum",
        ...overrides,
        type: "derivation",
    }
}

// -- Expressions --

export function makeVariableExpression(
    overrides: Partial<TCorePropositionalVariableExpression> = {}
): TCorePropositionalVariableExpression {
    return {
        id: "e-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "p-1",
        parentId: null,
        position: 0,
        variableId: "v-1",
        checksum: "e-checksum",
        descendantChecksum: null,
        combinedChecksum: "e-combined-checksum",
        ...overrides,
        type: "variable",
    }
}

export function makeOperatorExpression(
    operator: TCoreLogicalOperatorType,
    overrides: Partial<TCoreOperatorExpression> = {}
): TCoreOperatorExpression {
    return {
        id: "e-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "p-1",
        parentId: null,
        position: 0,
        checksum: "e-checksum",
        descendantChecksum: null,
        combinedChecksum: "e-combined-checksum",
        ...overrides,
        type: "operator",
        operator,
    }
}

export function makeFormulaExpression(
    overrides: Partial<TCoreFormulaExpression> = {}
): TCoreFormulaExpression {
    return {
        id: "e-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        premiseId: "p-1",
        parentId: null,
        position: 0,
        checksum: "e-checksum",
        descendantChecksum: null,
        combinedChecksum: "e-combined-checksum",
        ...overrides,
        type: "formula",
    }
}

// -- Variables --

export function makeClaimBoundVariable(
    overrides: Partial<TClaimBoundVariable> = {}
): TClaimBoundVariable {
    return {
        id: "v-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        symbol: "P",
        claimId: "claim-1",
        claimVersion: 0,
        checksum: "v-checksum",
        ...overrides,
    }
}

export function makePremiseBoundVariable(
    overrides: Partial<TPremiseBoundVariable> = {}
): TPremiseBoundVariable {
    return {
        id: "v-1",
        argumentId: "arg-1",
        argumentVersion: 1,
        symbol: "P",
        boundPremiseId: "p-1",
        boundArgumentId: "arg-1",
        boundArgumentVersion: 1,
        checksum: "v-checksum",
        ...overrides,
    }
}

// -- Claims --

export function makeNormalClaim(
    overrides: Partial<TCoreClaim> = {}
): TCoreClaim {
    return {
        id: "claim-1",
        version: 0,
        frozen: false,
        checksum: "c-checksum",
        ...overrides,
        type: "normal",
    }
}

export function makeCitationClaim(
    overrides: Partial<TCoreClaim> = {}
): TCoreClaim {
    return {
        id: "claim-1",
        version: 0,
        frozen: false,
        checksum: "c-checksum",
        ...overrides,
        type: "citation",
    }
}

export function makeAxiomaticClaim(
    overrides: Partial<TCoreClaim> = {}
): TCoreClaim {
    return {
        id: "claim-1",
        version: 0,
        frozen: false,
        checksum: "c-checksum",
        ...overrides,
        type: "axiomatic",
    }
}

// -- Convenience role state --

export function makeRoleState(
    overrides: Partial<TCoreArgumentRoleState> = {}
): TCoreArgumentRoleState {
    return { ...overrides }
}

// Re-export the union types that test files frequently need to annotate
// helper return values.
export type {
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
}
