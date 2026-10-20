# checkLink reports no attempted support for a reply's links

Reported by a consumer of 6.0.0.

## Problem

`checkLink` answers `attemptedSupport: false` for a link of a **reply**, meaning a response whose target is itself a response, even when the reply gives a reason for that link. A response to a standard argument correctly gets `true`.

## Reproduction

All engines share one claim library:

- X: conclusion `X`.
- Y answers X with `yl: ¬x` and `R → ¬x`, where x is bound to X's conclusion.
- Z answers Y with `¬L` and `S → ¬L`, where L is bound to Y's `yl`.
- `Z.checkLink(<Z's link>, Y.snapshot())` gives `asserted` with `attemptedSupport: false`. Expected: `true`.

The consumer reports the same result when Y affirms (`yl: x`) and when Z affirms (`L`, `S → L`).

## Expected

Per the API reference, `attemptedSupport` is true when another premise has the link's merged referent on its consequent side, and `S → ¬L` does.

## Consumer impact

There is no crash, but every reply's check reads "no reason given". The consumer has an expected-failure test waiting for the fix.

## Test cases

- The three polarity combinations.
- A reply whose reason a source backs, which should be `follows`.
