import Type, { type Static, type TSchema, type TSchemaOptions } from "typebox"

// ---------------------------------------------------------------------------
// EncodableDate — custom TypeBox type for Date values
// ---------------------------------------------------------------------------
export class TDateType extends Type.Base<Date> {
    public readonly type = Date

    public override Check(value: unknown) {
        return value instanceof Date
    }
    public override Errors(value: unknown): object[] {
        if (this.Check(value)) return []
        return [{ message: "Invalid date", value }]
    }
    public override Convert(value: unknown) {
        if (this.Check(value)) return value
        if (typeof value === "string" || typeof value === "number") {
            const date = new Date(value)
            if (this.Check(date)) return date
        }
        throw new Error("Cannot convert value to Date")
    }
    public override Clone(): Type.Base<Date> {
        return new TDateType()
    }
}
export function dateType(): TDateType {
    return new TDateType()
}
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
