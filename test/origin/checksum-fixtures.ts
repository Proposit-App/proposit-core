// Frozen fixture entities for the enthymeme checksum regression.
//
// These are plain records rather than engine output on purpose: the guarantee
// under test is about `entityChecksum`'s field selection, and a fixture built
// by the engine would move whenever the engine's construction defaults move.
//
// DO NOT EDIT THESE OBJECTS. The golden checksums in
// `enthymeme-checksum.test.ts` were recorded against them before the
// `enthymeme` field existed; changing a fixture invalidates the proof that
// adding the field left every pre-existing checksum untouched.

export type TChecksumFixtureKind = "expression" | "premise"

export const CHECKSUM_FIXTURES: readonly [
    string,
    TChecksumFixtureKind,
    Record<string, unknown>,
][] = [
    [
        "variable expression",
        "expression",
        {
            id: "expr-var-1",
            type: "variable",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "prem-1",
            parentId: "expr-op-1",
            position: 0,
            variableId: "var-1",
        },
    ],
    [
        "operator expression",
        "expression",
        {
            id: "expr-op-1",
            type: "operator",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "prem-1",
            parentId: null,
            position: 0,
            operator: "and",
        },
    ],
    [
        "formula expression",
        "expression",
        {
            id: "expr-formula-1",
            type: "formula",
            argumentId: "arg-1",
            argumentVersion: 3,
            premiseId: "prem-2",
            parentId: "expr-op-1",
            position: 1,
        },
    ],
    [
        "freeform premise",
        "premise",
        {
            id: "prem-1",
            type: "freeform",
            argumentId: "arg-1",
            argumentVersion: 0,
        },
    ],
    [
        "derivation premise",
        "premise",
        {
            id: "prem-2",
            type: "derivation",
            argumentId: "arg-1",
            argumentVersion: 3,
            derivedClaimId: "claim-7",
        },
    ],
    [
        "premise carrying an app field",
        "premise",
        {
            id: "prem-3",
            type: "freeform",
            argumentId: "arg-2",
            argumentVersion: 1,
            appLabel: "supporting evidence",
        },
    ],
    [
        "expression carrying an app field",
        "expression",
        {
            id: "expr-var-2",
            type: "variable",
            argumentId: "arg-2",
            argumentVersion: 1,
            premiseId: "prem-3",
            parentId: null,
            position: 0,
            variableId: "var-2",
            appLabel: "highlighted",
        },
    ],
]
