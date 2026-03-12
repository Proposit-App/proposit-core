import Type, { type Static } from "typebox"
import { CoreSourceSchema } from "../../lib/schemata/index.js"
import { Nullable } from "../../lib/schemata/shared.js"
import { IEEEReferenceSchema } from "./references.js"

export const IEEESourceSchema = Type.Intersect([
    CoreSourceSchema,
    Type.Object({
        url: Nullable(Type.String()),
        citation: IEEEReferenceSchema,
    }),
])
export type TIEEESource = Static<typeof IEEESourceSchema>
