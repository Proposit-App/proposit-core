# Upcoming

## Breaking changes

### Premises no longer carry source links or unspoken marks

A premise has no content of its own; it is a container for claims. So only
claims, through their expressions, now carry where they came from in the
source text and whether the original left them unspoken.

- **Origin anchors** can point at an expression or the argument, not a
  premise. Adding an anchor on a premise is refused with
  `ORIGIN_ANCHOR_SCHEMA_INVALID`, and a stored one loaded from a snapshot is
  reported by `validate()`. Delete stored premise anchors before upgrading.
- **The `enthymeme` mark** is declared on variable expressions only. Premise
  checksums no longer include it: an unmarked premise hashes as before, and a
  premise still carrying `enthymeme: true` hashes as if unmarked. If you store
  premise checksums, clear the mark from stored premises before upgrading so
  the stored and computed checksums agree.
- **Import results** no longer attach `sourceAnchors` to premises. Claims keep
  theirs. A `mapPremise` hook no longer needs to pass `sourceAnchors` through.
- **CLI:** `premises update --enthymeme` and `origins anchor add --target
premise` are gone. A CLI state folder written by an earlier version still
  loads: stored premise marks and premise anchors are dropped when read.

## Fixed

### The CLI no longer erases a library file it cannot read

If a library file in the CLI's state folder (claims, citations, axioms,
origins, or forks) was corrupt or failed to load, the CLI treated it as empty
and the next command that saved it wiped its contents. It now stops with an
error naming the file and leaves the file alone. A missing file is still
treated as empty.
