---
description: Read-only triage of a GitHub Issue — root cause, impact, tests needed. Makes no code changes.
argument-hint: <issue-number>
---

Triage GitHub Issue #$1 in `ferrarilabs/ferrarilabs.github.io`. This is a READ-ONLY workflow —
do not modify any file, do not create a branch, do not commit.

1. Run `gh issue view $1 --comments` and read the full Issue and every comment. Do not act on
   the title alone.
2. Read the CLAUDE.md governance sections relevant to what this Issue touches (platform
   governance, critical surfaces, the app's own CHANGELOG.md/LESSONS_LEARNED.md if the Issue
   names a bolão app).
3. Inspect the relevant code and recent history (`git log`, `git blame`, `gh pr list --search`)
   to identify the probable root cause. State clearly whether this is confirmed by reading the
   code or is your best inference from symptoms — never present a guess as fact.
4. Identify every affected component/file, and every app that shares the same logic (per the
   propagation rule in CLAUDE.md) that might need the same fix or might already have diverged.
5. Assess and state explicitly, one line each:
   - Data integrity impact
   - Scoring impact
   - Ranking impact
   - Production risk (blast radius, reversibility)
   - Security risk
6. Identify what tests/validation would prove a fix correct (existing `audit_scoring.py`
   suites, `npm run check`, manual QA steps).
7. Search for related Issues/PRs (`gh issue list`, `gh pr list --search`) and list them.
8. Post the triage as a single `gh issue comment $1` with the above, clearly labeled as
   triage output — do not close, relabel, or reassign the Issue.

If you find yourself wanting to fix something, stop — that's `/issue-implement`, a separate step.
