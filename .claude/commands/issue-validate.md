---
description: Independently validate that a fix meets an Issue's acceptance criteria. Does not close the Issue.
argument-hint: <issue-or-pr-number>
---

Independently validate GitHub Issue/PR #$1 in `ferrarilabs/ferrarilabs.github.io`.

1. Read the Issue's acceptance criteria (or, for a PR, read the linked Issue's criteria) via
   `gh issue view` / `gh pr view $1 --comments`.
2. Read the actual diff (`gh pr diff $1` or `git diff` on the branch) — do not trust the PR
   description alone.
3. Read the tests that were added or changed. If none were added for a behavioral fix, flag
   that as a gap rather than assuming coverage.
4. Independently exercise the expected behavior — run `npm run check`, and where practical,
   reproduce the original bug's repro steps against the fixed code to confirm it no longer
   occurs.
5. Explicitly check for regressions in:
   - Scoring correctness (run the relevant app's `audit_scoring.py`)
   - Ranking/tiebreak correctness
   - Data integrity (Supabase/localStorage shape, migrations)
   - The other two bolão apps, if the change touched shared/platform code (propagation rule)
6. Produce validation evidence: command output, screenshots, or a clear written account of
   manual verification — not just "looks good."
7. Post the validation result as a `gh issue comment` or `gh pr comment` on #$1, stating clearly
   whether acceptance criteria are met, partially met, or not met, and why.
8. Do NOT close the Issue and do NOT merge the PR yourself — report your findings and stop.
   Closing/merging requires explicit authorization from Eduardo.
