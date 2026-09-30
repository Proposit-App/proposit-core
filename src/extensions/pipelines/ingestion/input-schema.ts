import Type from "typebox"

/**
 * Input schema shared by every ingestion pipeline: a single non-empty
 * raw argument text. The scholar and scribe factories both use it, so the
 * two pipelines advertise the identical input contract.
 */
export const INGESTION_INPUT_SCHEMA = Type.Object({
    text: Type.String({ minLength: 1 }),
})
