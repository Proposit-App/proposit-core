# Release Notes

## Bug Fixes

- **Fixed data loss when absorbing same-operator children:** When changing an operator back to match its parent (e.g., OR→AND inside AND), reparented children could be destroyed during persistence if the database uses cascading deletes. The persistence ordering now moves children to their new parent before deleting the old one.
- **Cleaned up redundant changeset entries:** Expressions that are both modified and then deleted in the same operation no longer produce a wasted update followed by a delete. The update is dropped since the row is about to be removed.
