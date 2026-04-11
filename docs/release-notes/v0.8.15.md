# Release Notes

- **`setExtras` now produces changesets** — `PremiseEngine.setExtras()` now returns a proper changeset with the modified premise in `changes.premises.modified`, enabling consumers to persist premise metadata changes through the standard changeset pipeline.
- **New `updateExtras` method** — Both `PremiseEngine` and `ArgumentEngine` now have `updateExtras()` for partial (shallow-merge) extras updates with full changeset support.
- **New `ArgumentEngine` extras methods** — `ArgumentEngine` now exposes `getExtras()`, `setExtras()`, and `updateExtras()` for symmetric metadata handling with premises.
- **CLI `premises update` uses engine** — The `premises update` command now routes through the engine instead of direct file I/O, ensuring checksums stay consistent.
