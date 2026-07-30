import Type, { type Static, type TSchema, type TSchemaOptions } from "typebox"

// ---------------------------------------------------------------------------
// EncodableDate — custom TypeBox type for Date values
// ---------------------------------------------------------------------------
/**
 * Normalizes a `Date` or its serialized form to a `Date`.
 *
 * Only date strings are treated as a serialized date — the form
 * `JSON.stringify` produces. Numbers are rejected so that a numeric field
 * mistakenly supplied where a date belongs still fails validation.
 */
function toDate(value: unknown): Date | undefined {
    if (value instanceof Date) return value
    if (typeof value !== "string") return undefined
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Creates a new {@link TDateType} schema instance.
 *
 * The schema admits a `Date` or its serialized date string. `Value.Decode`
 * normalizes either into a `Date`; `Value.Encode` leaves `Date` instances in
 * place so `JSON.stringify` renders them as ISO strings.
 */
export function dateType() {
    return Type.Codec(
        Type.Refine(
            Type.Unsafe<Date>({}),
            (value: unknown) => toDate(value) !== undefined,
            () => "Invalid date"
        )
    )
        .Decode((value: unknown): Date => {
            const date = toDate(value)
            if (date === undefined)
                throw new Error("Cannot convert value to Date")
            return date
        })
        .Encode((value: Date) => value)
}
/** TypeBox type that validates and decodes `Date` values. */
export type TDateType = ReturnType<typeof dateType>
export const EncodableDate = dateType()

// ---------------------------------------------------------------------------
// JSON value schemata
// ---------------------------------------------------------------------------
export const JsonPrimitiveSchema = Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    EncodableDate,
])
export type TJsonPrimitive = Static<typeof JsonPrimitiveSchema>

export const JsonValueSchema = Type.Cyclic(
    {
        JsonValueSchema: Type.Union([
            Type.Record(Type.String(), Type.Ref("JsonValueSchema")),
            Type.Array(Type.Ref("JsonValueSchema")),
            Type.String(),
            Type.Number(),
            Type.Boolean(),
            Type.Null(),
            EncodableDate,
        ]),
    },
    "JsonValueSchema"
)

export const JsonObjectSchema = Type.Record(Type.String(), Type.Any())

export const JsonArraySchema = Type.Array(JsonValueSchema)

// Manual implementation workaround for TypeBox cyclic Static issue
// see: https://github.com/sinclairzx81/typebox/issues/1356
export type TJsonValue =
    | TJsonPrimitive
    | { [key: string]: TJsonValue }
    | TJsonValue[]
export type TJsonObject = Record<string, TJsonValue>
export type TJsonArray = TJsonValue[]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Wraps a TypeBox schema in a `Union([schema, Null()])` with `default: null`. */
export const Nullable = <T extends TSchema>(
    schema: T,
    options?: Omit<TSchemaOptions, "default">
) => {
    return Type.Union([schema, Type.Null()], { ...options, default: null })
}
export const UUID = Type.String() // `${string}-${string}-${string}-${string}-${string}`
export type TUUID = Static<typeof UUID>

/** Makes the `checksum`, `descendantChecksum`, and `combinedChecksum` fields optional on a type that has them. */
export type TOptionalChecksum<T extends { checksum?: unknown }> = Omit<
    T,
    "checksum" | "descendantChecksum" | "combinedChecksum"
> &
    Partial<
        Pick<
            T,
            Extract<
                keyof T,
                "checksum" | "descendantChecksum" | "combinedChecksum"
            >
        >
    >

/** Makes checksum, descendantChecksum, and combinedChecksum optional on a hierarchical entity type. */
export type TOptionalHierarchicalChecksum<
    T extends {
        checksum: unknown
        descendantChecksum: unknown
        combinedChecksum: unknown
    },
> = Omit<T, "checksum" | "descendantChecksum" | "combinedChecksum"> &
    Partial<Pick<T, "checksum" | "descendantChecksum" | "combinedChecksum">>
