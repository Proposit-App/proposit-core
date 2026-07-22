# upcoming release notes

## Changed

- **An argument whose premises are unproven no longer reports as Sound.** An
  argument is sound only when it holds together _and_ its premises are true. If
  even one supporting premise is still unknown — nobody has said yes or no to it
  yet — the argument now reads **Indeterminate** instead of Sound. Arguments
  whose premises are all true still read Sound exactly as before, a false premise
  still reads Unsound, and whether an argument is _valid_ is unchanged: validity
  is about the shape of the reasoning, not about what anyone has decided is true.
