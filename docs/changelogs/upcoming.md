# Upcoming

## Tests

- The origin library's anchor-cost test no longer holds 100 `addAnchor` calls
  to a fixed 300 ms, which failed on slower CI runners while the library was
  fine. It now times the same calls over documents 20x apart in size (fastest
  of three runs each) and requires the larger run to take under 3x as long.
  Measured locally: about 1.0x now, about 17x with the verified-body skip in
  `validate()` disabled.
- The pipeline overlap test drops its "stages started within 50 ms" check; the
  remaining assertions (each stage started before the other ended) already
  prove the overlap and do not depend on machine speed.
