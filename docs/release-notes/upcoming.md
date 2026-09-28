# Upcoming

## Added

### A note for a claim that was never looked up in the source

Finalize now reports `SOURCE_ANCHOR_NOT_ATTEMPTED` (a new member of
`SOURCE_ANCHOR_NOTE_CODES`) for each claim the mention stage produced no
mention for. Before, such a claim had no source anchor and no note, so it read
the same as a claim whose quote failed to resolve — or as success. The note is
a warning with `context: { claimMiniId }`, and it is emitted only when the
mention stage ran and the input carried text. A claim with an empty
`mentionIds` list was, and still is, also reported as `CLAIM_MENTION_LIST_EMPTY`
by claim-reference validation, so a consumer summing warnings sees it twice;
the new code is the one that also covers ids naming no produced mention. A consumer that counts every code
in `SOURCE_ANCHOR_NOTE_CODES` picks it up with no change.
