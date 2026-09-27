# Upcoming

## Removed

- `OriginAnchorTargetTypeSchema` no longer admits `"premise"`; it is
  `"expression" | "argument"`. `OriginLibrary.addAnchor` refuses a premise
  target with `ORIGIN_ANCHOR_SCHEMA_INVALID`, and `validate()` reports one
  restored by `fromSnapshot` the same way.
- `CommonPremiseFields.enthymeme` (both premise schemas) and `"enthymeme"` in
  `DEFAULT_CHECKSUM_CONFIG.premiseFields`. An unmarked premise's checksum is
  unchanged; a premise still holding `enthymeme: true` now hashes as if
  unmarked. Expression `enthymeme` and P-6 are unchanged.
- `finalizeResponseV2` no longer attaches `sourceAnchors` to premises, and no
  longer resolves a relation's `evidence.quote` (`relationAnchor` removed from
  `src/extensions/pipelines/base/finalize-response-v2.ts`). Relation quotes
  therefore produce no `SOURCE_ANCHOR_*` notes. Claim anchors are unchanged.
- CLI: `premises update --enthymeme/--no-enthymeme`, and `premise` as an
  `origins anchor add --target`. `CliPremiseMetaSchema` no longer declares
  `enthymeme`.

## Changed

- CLI: reading a premise's `meta.json` drops a stored `enthymeme` key, and
  reading `origins.json` drops anchors whose `targetType` is `"premise"`, so
  state written by earlier versions still loads; the next write saves it
  without them.

## Fixed

- CLI: the claim, citation, axiom, origin, and fork library readers
  (`src/cli/storage/libraries.ts`) returned an empty library on any error,
  so a corrupt or invalid file was overwritten by the command's next write.
  Only a missing file now yields an empty library; any other failure exits
  with the file's path.
- `scripts/smoke-test.sh` swapped a four-child `and` to `xor`, which
  `change-operator` treats as a split, so the smoke test stopped at section 5f.
  The swap now runs on a two-child root.
