# upcoming release notes

## Added

### An argument can record the source text it was built from

A source text is now stored as its own thing — with an identity, a content fingerprint, and optional attribution to a real published source — instead of being copied into the argument. Store one and attach it to an argument version with `proposit-core origins attach`, or through `core.origins` in the library.

Attaching a text also says what the argument claims about it. _Seed_, the default, means the argument merely started from that source. _Representation_ means the argument sets out to faithfully render it — a claim about someone else's words, so it is never assumed.

### Individual parts of an argument can be tied to the passages they came from

An anchor records that a particular premise or claim came from a particular stretch of the source text, keeping both the quoted passage and its position. Anchors are checked against the text as they are created: an anchor whose position does not produce its own quote is refused outright, rather than quietly pointing at the wrong sentence later.

Positions are counted in characters the way a reader would count them, so a text containing emoji, mathematical symbols, or any other character outside the basic range is handled correctly instead of ending up off by one. Read a passage back with the new `sliceByCodePoints` helper.

### An author can mark content as left unspoken

Real arguments routinely skip a step the audience is expected to supply. A premise or a claim can now carry that fact: pass `--enthymeme` to `premises update`, or use the new `expressions mark` for a claim. Nothing infers it — only an author's explicit action sets it — and the mark can be made on an argument that has no source text at all.

Marking something that cannot meaningfully be unspoken, such as a step whose truth is worked out from another premise rather than asserted, is reported as a presentation issue (`P-6`) rather than blocked, in keeping with how the other presentation rules behave.

### Source texts are cleaned up consistently when stored

Line endings are made uniform, byte-order marks and invisible or hidden characters are removed, and accented characters are put into one standard form — so the same text pasted from two different places is recognized as the same text. Emoji, including family and flag sequences, survive intact.

What the cleanup deliberately never touches is the writing itself. Spacing, paragraph breaks, smart quotes, dashes, capitalization, and punctuation are left exactly as the author wrote them; the document is meant to be the original. It is available on its own as `normalizeOriginText` for applications that want to apply it at their own input boundary.

### Duplicate source texts are detectable

Every stored text carries a fingerprint of its content, so two pastes of the same passage can be recognized as identical — including when they differ only in line endings, a byte-order mark, or how accents were typed. What an application does with that information is its own decision.

### New CLI commands

`origins attach`, `origins list`, `origins show`, `origins anchor add`, and `origins anchor remove`, plus `--enthymeme` and `--no-enthymeme` on `premises update` and the new `expressions mark`.

## Notes

Existing data is unaffected. Nothing in this release changes the fingerprint of any argument, premise, or claim that already exists, and a saved file written before this version loads with no migration and no error.
