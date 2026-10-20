#!/bin/sh
# Commit a work item's files after TCW moves it to a new stage, then push.
#
# Bound as a `post` hook on every stage. TCW itself never changes git state;
# this keeps the board's history in git the way TCW 2.x's automatic commits
# did. It works from the item's own folder, so a board kept in another
# repository is committed there, and it commits only that folder, leaving any
# other change in the checkout alone. In Jira mode a move usually changes no
# file, and then there is nothing to commit.
#
# The push is skipped when the branch tracks no remote. It never forces: when
# the remote has moved on, the push fails, the move still stands, and the
# remote's commits have to be merged before pushing again.
set -eu
cd "$TCW_ITEM_PATH"
git add -A -- .
if git diff --cached --quiet -- .; then
    exit 0
fi
git commit --quiet -m "Move $TCW_SLUG to $TCW_STAGE" -- .
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git push --quiet
fi
