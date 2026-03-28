export type {
    TDisplayable,
    THierarchicalChecksummable,
} from "./shared.interfaces.js"

export type {
    TPremiseCrud,
    TVariableManagement,
    TArgumentExpressionQueries,
    TArgumentRoleState,
    TArgumentEvaluation,
    TArgumentLifecycle,
    TArgumentIdentity,
} from "./argument-engine.interfaces.js"

export type {
    TExpressionMutations,
    TExpressionQueries,
    TVariableReferences,
    TPremiseClassification,
    TPremiseEvaluation,
    TPremiseLifecycle,
    TPremiseIdentity,
} from "./premise-engine.interfaces.js"

export type {
    TClaimLookup,
    TClaimLibraryManagement,
    TSourceLookup,
    TSourceLibraryManagement,
    TClaimLibrarySnapshot,
    TSourceLibrarySnapshot,
    TClaimSourceLookup,
    TClaimSourceLibraryManagement,
    TClaimSourceLibrarySnapshot,
    TForkLookup,
    TForksLibrarySnapshot,
} from "./library.interfaces.js"
