#!/usr/bin/env bash
#
# Pack a consumer-validation tarball whose filename carries the branch it was
# built from, and print the filename.
#
# `pnpm pack` names by version alone. Two branches sitting at the same version
# therefore produce the *same* filename in the *same* directory, so a consumer
# pinning `file:…/proposit-proposit-core-3.2.0.tgz` installs whichever branch packed
# last — silently, because the version string still matches whatever the
# consumer verifies. That is the failure this exists to make impossible.
#
# It matters more with git worktrees, where several branches of this repo are
# checked out at once and all resolve `../proposit-core/*.tgz` to this one
# directory.
#
# The branch also makes a stale pin legible: the consumer's `package.json` says
# which build it is pinned to, rather than a version that could mean anything.
set -euo pipefail

cd "$(dirname "$0")/.."

# `@proposit/proposit-core` -> `proposit-proposit-core`, matching what `pnpm pack`
# itself would name the file, so the only difference is the branch suffix.
name=$(node -p "require('./package.json').name.replace(/^@/, '').replace(/\//g, '-')")
version=$(node -p "require('./package.json').version")
# `--abbrev-ref HEAD` is worktree-aware. Slashes are legal in branch names and
# would be read as path separators in the output filename.
branch=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')

out="${name}-${version}-${branch}.tgz"

# Remove this branch's previous tarball rather than accumulating one per pack.
# A leftover *.tgz in the package root makes `pnpm publish` fail with an EUSAGE
# "two package-specs" error, and every extra file is another chance to pin a
# stale one.
rm -f "$out"

pnpm pack --out "$out" >/dev/null
echo "$out"
