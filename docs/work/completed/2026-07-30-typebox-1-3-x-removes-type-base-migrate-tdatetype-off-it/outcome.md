# Outcome — migrate `EncodableDate` off the removed `Type.Base`

Option 1 of the two the escalation offered: migrate, don't pin the range down.
`proposit-shared` took the same route on the same day — required, because the two
packages resolve to one hoisted `typebox` copy in every shared consumer, so a
split decision would have left whichever guessed wrong broken.

## What shipped

`class TDateType extends Type.Base<Date>` in `src/lib/schemata/shared.ts` is gone.
`EncodableDate` is now `Type.Refine` + `Type.Unsafe<Date>` wrapped in a
`Type.Codec` — the replacement names TypeBox's own deprecation notice points at:

- Refine carries the `Check` / `Errors` surface.
- `Unsafe<Date>` keeps `Static<typeof EncodableDate>` inferring as `Date`.
- The codec's `Decode` normalizes a serialized date string into a `Date`; `Encode`
  passes `Date` instances through unchanged, so `JSON.stringify` still emits ISO.

The consequence worth remembering: coercion moves from the **Convert** pass to the
**Decode** pass — `Value.Decode` replaces `Value.Convert` + `Value.Parse`. TypeBox
1.3 has no per-type hook in Convert, so there is no way back to the old shape. The
schema therefore also admits a date's encoded form, which is what lets a union
member such as `Nullable(EncodableDate)` resolve a wire value at all.

`f55895b` then narrowed that: only date **strings** are admitted, not epoch
numbers. Once the serialized form has to pass `Check` (TypeBox resolves a union
member and asserts the decode input before any decode callback runs), the accepted
encodings became part of the validation contract rather than a lenient conversion
step — and accepting numbers would mean any numeric field supplied where a date
belongs validates clean, which is the exact failure a date field exists to catch.

- `5a0ca6b` — the migration.
- `f55895b` — reject numbers as a serialized date.
- `68adfef` — merge to `main`.
- Released **v3.3.0**, tagged, published to npm.

## Verification

`test/encodable-date.test.ts` covers the accept/reject set and the ISO round-trip.
The escalation's load-bearing case — `Value.Parse` on a `TIntersect` schema
carrying a date field, *for a valid value* — is the one a green suite would not
have caught on its own, and it passes: the `~guard`-stripping defect that motivated
the consumer's `Value.Convert` workarounds does not exist without `Base`.

Consumer close-out: `proposit-server` repinned to `^3.3.0`, restored
`typebox: "^1.3.8"`, and removed both `Value.Convert` workarounds
(`proposit-server` `7b8a752d`). `pnpm why typebox` there resolves a single 1.3.8.

## Notes

The escalation asked for one agreed resolution across core and shared, and that
held — same shape, same day, verified together against the consumer's single
hoisted copy rather than in isolation.
