import Type, { type Static } from "typebox"
import { CoreClaimSchema } from "../../../lib/schemata/index.js"
import { Nullable } from "../../../lib/schemata/shared.js"
import { IEEEReferenceSchema } from "./references.js"

export const IEEECitationClaimSchema = Type.Intersect([
    CoreClaimSchema,
    Type.Object({
        type: Type.Literal("citation"),
        url: Nullable(Type.String()),
        citation: IEEEReferenceSchema,
    }),
])
export type TIEEECitationClaim = Static<typeof IEEECitationClaimSchema>
