# Release Notes

## New Features

- **Operator change mutations.** New `changeOperator` method on `PremiseEngine` handles three structural cases when changing an operator's type: simple in-place change, merge (dissolving an operator into a same-type parent), and split (extracting children into a new sub-operator). Supports optional extra fields for newly created expressions.

- **Premise checksums in changesets.** Expression mutation changesets now include the premise's updated checksum as a `premises.modified` entry when the premise's composite checksum changes. Consumers no longer need to manually sync premise checksums after every expression mutation.
