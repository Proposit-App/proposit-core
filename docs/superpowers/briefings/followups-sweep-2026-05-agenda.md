# Follow-ups Sweep 2026-05 — proposit-core agenda

**Initiative spec:** `/Users/brian/Projects/Proposit-App/docs/superpowers/specs/2026-05-22-followups-sweep-overview.md`
**Branch:** `followups-sweep-2026-05` off `proposit-core/main` @ `268c723` (`v1.0.2`)
**Reviewer:** `proposit-core-reviewer` after the commit lands (single review pass — tiny scope)
**Target release:** no version cut for this cycle. Pure file-delete cleanup.

## Capability changes

None.

## Scope — 1 item

### D1 — Delete stale change-request file

**File:** `docs/change-requests/2026-05-15-relax-s8-and-investigate-e7-gate-firings.md`

**Background:** This change-request was authored 2026-05-15 to drive the core 1.0.1 / 1.0.2 fix cycles (S-8 relax + E-7 engine-invariant). Per repo convention, the change-request file is supposed to be deleted by the commit that lands the fix. The 1.0.2 fix landed (commits `08ab7c8`..`51b87ec`..`c36051a`..`4f30948`..`3bd0ba8`..`268c723`) but the change-request file was not deleted — it sits as untracked-or-orphaned in the docs tree.

**Action:**

1. Confirm the file exists at the path above (`ls docs/change-requests/`).
2. Verify the underlying fixes shipped — `git log --oneline v1.0.1..v1.0.2` should show the S-8 + E-7 engine-invariant work, matching the change-request's "Proposed fix" section. Quick read-through to confirm; no implementation work.
3. `git rm docs/change-requests/2026-05-15-relax-s8-and-investigate-e7-gate-firings.md`.
4. Commit with message:

    ```
    chore(change-requests): retire 2026-05-15-relax-s8-and-investigate-e7-gate-firings

    Shipped via v1.0.1 + v1.0.2 engine-invariant E-7 work; file was supposed
    to be deleted by the fix commit per repo convention but landed as
    orphaned.
    ```

## Verification before claiming done

- `pnpm run check` passes (should be trivial; no code touched).
- File no longer exists at `docs/change-requests/`.
- Commit is on `followups-sweep-2026-05` branch.

## No release cut

Nothing user-visible changed; no version bump warranted. Branch is a free rider for whenever the next core release happens.

## Branch posture reminder

Single branch `followups-sweep-2026-05` off main @ `268c723`. One commit. Reviewer runs once.

## Coordination notes

If the change-request file's "Proposed fix" section meaningfully diverges from what shipped (e.g., the fix took a different approach), surface to orchestrator before deleting — that might warrant a short retrospective note instead of a silent retirement.
