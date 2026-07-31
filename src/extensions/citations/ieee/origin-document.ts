import Type, { type Static } from "typebox"
import { CoreOriginDocumentSchema } from "../../../lib/schemata/index.js"
import { Nullable } from "../../../lib/schemata/shared.js"
import { IEEEReferenceSchema } from "./references.js"

/**
 * An origin document attributed to a real, publicly reachable source.
 *
 * The attribution lives here rather than in `src/lib/` for the same reason
 * `IEEECitationClaimSchema` does: core holds the slot — `CoreOriginDocument`
 * carries `additionalProperties: true` — while the reference vocabulary stays
 * an extension concern. A document with no attribution is complete and valid
 * on its own; nothing prompts for one.
 *
 * No citation claim is created by attributing a document, so grammar rule D-5
 * (citation-bound variables only in a derivation premise's antecedent) is
 * untouched by attribution.
 */
export const IEEEOriginDocumentSchema = Type.Intersect([
    CoreOriginDocumentSchema,
    Type.Object({
        url: Nullable(Type.String()),
        reference: IEEEReferenceSchema,
    }),
])
export type TIEEEOriginDocument = Static<typeof IEEEOriginDocumentSchema>
