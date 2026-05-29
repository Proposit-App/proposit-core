# Upcoming release notes

## Changed

- **Premise titles in imported arguments now read as plain language.**
  When an argument is built from raw prose by the v2 ingestion
  pipeline, each premise used to be titled with the underlying logic
  formula — e.g. `Support: Hormuz_Too_Risky implies No_Offramp`, cut
  off at 50 characters. Those titles are now written out as readable
  sentences composed from the claim titles the model authored. The same
  premise now reads:
  `If "Forcing Hormuz open is too risky" then "No realistic off-ramp exists"`.
  A premise supported by several claims joins them with "and"
  (`If "…" and "…" then "…"`), and the conclusion premise simply shows
  the conclusion's title. The underlying logic formula is unchanged —
  only the human-readable title is improved. This applies to newly
  imported arguments; existing saved arguments are not changed.
