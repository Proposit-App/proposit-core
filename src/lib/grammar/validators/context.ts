// Pure data view consumed by every tier's validators. No engine references.
// Built by ArgumentEngine.validate() (Phase C) before delegating to the
// dispatcher in src/lib/grammar/validate.ts.

import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../../schemata/index.js"
import type { TCoreArgumentRoleState } from "../../types/evaluation.js"

export type TValidatorContext = {
    argument: TCoreArgument
    premises: readonly TCorePremise[]
    expressions: readonly TCorePropositionalExpression[]
    variables: readonly TCorePropositionalVariable[]
    claims: readonly TCoreClaim[]
    roleState: TCoreArgumentRoleState
}
