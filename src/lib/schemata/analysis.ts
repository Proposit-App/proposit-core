import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreAnalysisFileSchema = Type.Object({
    argumentId: UUID,
    argumentVersion: Type.Number(),
    assignments: Type.Record(
        Type.String(),
        Type.Union([Type.Boolean(), Type.Null()]),
        {
            description: "Variable symbol → true/false/null (unset).",
        }
    ),
    operatorAssignments: Type.Record(
        Type.String(),
        Type.Union([Type.Literal("accepted"), Type.Literal("rejected")]),
        {
            description:
                "Operator expression ID → accepted/rejected. Unset operators evaluate normally.",
        }
    ),
})
export type TCoreAnalysisFile = Static<typeof CoreAnalysisFileSchema>
