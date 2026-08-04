# upcoming release notes

## Imported premises are now named for the step they make

When an argument is imported from text, each premise gets a heading. Until now
that heading just restated the premise in words — `If "Forcing Hormuz open is
too risky" then "No realistic off-ramp exists"` — directly above the very same
claims, written out again line by line. It said nothing the reader could not
already see.

Both importers now write a short name for what the step _does_ in the argument
instead: "Limits of the crowd's power", "Residence as tacit consent",
"Principle over survival". The reasoning underneath is unchanged; only the
heading is.

This costs nothing extra to import — the name comes back on work the importer
was already doing, so an import makes the same number of model calls and takes
the same time as before.

If no name comes back, the old wording is used instead, so an import never
fails for want of one. The conclusion also keeps the old wording in the one
case where a written name could mislead: when the conclusion that was settled
on is not the one the name was written for. Every heading stays editable before
you publish.

Arguments already imported keep the headings they have.
