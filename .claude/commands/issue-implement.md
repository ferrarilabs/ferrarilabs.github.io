---
description: Implement the smallest safe fix for a triaged GitHub Issue and open a PR. Does not merge.
argument-hint: <issue-number>
---

Implement GitHub Issue #$1 in `ferrarilabs/ferrarilabs.github.io`.

1. Check whether `/issue-triage` has already run for this Issue (look for a triage comment via
   `gh issue view $1 --comments`). If not, run the triage steps yourself first — do not start
   implementing on symptoms alone.
2. Run `git worktree list` and `git status` before doing anything. Preserve any unrelated
   in-progress work you find.
3. Create a dedicated branch (or worktree) named for this Issue, off an up-to-date `main`
   (`git fetch origin && git merge --ff-only origin/main` first, never force).
4. Make the smallest safe, reversible change that fixes the confirmed root cause. Do not
   refactor unrelated code. Do not fix unrelated defects you notice — open a separate Issue for
   those instead and mention it in the PR description.
5. If the change touches a critical surface (`bolao/shared/safety/critical_surfaces.json`),
   follow the declare → explain → run dedicated gates → report workflow from
   `docs/bolao/CHANGE_SAFETY_CONTRACT.md` before proceeding.
6. Run `npm run check`. It must pass — this is non-negotiable per CLAUDE.md, regardless of how
   unrelated the change looks to scoring/email/database.
7. If any of `bolao/copa2026/scripts/audit_scoring.py`, `bolao/br2026/scripts/audit_scoring.py`,
   or `bolao/cdb2026/scripts/audit_scoring.py` are relevant (or even if the change looks
   unrelated — CLAUDE.md requires this every time), run all three and report the result.
8. Update the affected app's CHANGELOG.md and bump its `siteVersion` if this is a bolão app
   change, per the release process in CLAUDE.md.
9. Create atomic, well-scoped commits with clear messages.
10. Open a PR using `.github/pull_request_template.md`, filled out completely — Risk, Rollback,
    Data Impact, and Scoring/Ranking Impact must reflect real analysis, not boilerplate. Use
    `Closes #$1` only if the PR fully resolves the Issue; otherwise `Relates to #$1`.
11. Do NOT merge the PR. Do not push directly to `main`. Stop and report the PR URL.

If the fix isn't small — if it would require touching scoring formulas, bracket logic, or
business rules — stop and report that explicit authorization from Eduardo is required before
proceeding, per CLAUDE.md.
