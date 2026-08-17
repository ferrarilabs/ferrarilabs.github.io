---
description: Read-only scan of Git/PR/doc history to produce candidate historical-Issue records. Never creates GitHub Issues.
argument-hint: "[optional: area or app to focus on, e.g. cdb2026]"
---

Scan repository history for past bugs, incidents, data issues, and material technical debt that
predate GitHub Issue tracking in this repo, and produce candidate records for later review.

**This command is READ-ONLY with respect to GitHub Issues.** Do not create, edit, close, or
label any Issue. It may write files under `~/Documents/GitHub/ferrarilabs-work/audits/`.

Scope: $ARGUMENTS (if empty, scan the whole repository).

Sources to mine:
- `git log --all`, `git show`, `git blame` where needed, `git tag`
- `gh pr list --state all --limit 1000` and `gh pr view` on relevant PRs
- `gh issue list --state all` (to avoid recommending duplicates of what already exists)
- `docs/bolao/LESSONS_LEARNED.md`, `docs/bolao/PROJECT_MEMORY.md`, `docs/bolao/CHANGELOG.md`,
  each app's own `CHANGELOG.md`, `docs/bolao/CONSISTENCY_MATRIX.md`, and any named incident
  docs (e.g. `docs/bolao/CDB2026_RECEIPT_IDENTITY_INCIDENT_*.md`,
  `docs/bolao/LIVE_DATA_INCIDENT_RUNBOOK.md`)
- Any audit/review docs under `docs/bolao/` or `ferrarilabs-work/audits/` and
  `ferrarilabs-work/incidents/`

Search semantically (not just grep) for: fix, bug, hotfix, repair, incident, regression,
restore, rollback, corruption, duplicate, production, ranking, scoring, entry, prediction,
payment, result, email, PDF, deployment, security, migration, database, Supabase.

Do not trust commit messages as ground truth — read the actual diff/doc when the finding is
material enough to matter.

**Group, don't enumerate by commit.** A diagnostic commit, a temporary mitigation, a test fix,
the permanent correction, and its doc update very often belong to ONE candidate record if they
share a root cause/incident/user-visible defect. Never create one candidate per commit.

For each candidate, produce all fields of the schema below — write both a human-readable
Markdown table/list and a machine-readable JSON array, to:

- `~/Documents/GitHub/ferrarilabs-work/audits/github-historical-issue-candidates-<YYYY-MM-DD>.md`
- `~/Documents/GitHub/ferrarilabs-work/audits/github-historical-issue-candidates-<YYYY-MM-DD>.json`

(use today's actual date; if a file for today already exists, treat this as a re-scan and
merge/update rather than silently overwriting prior candidates)

Schema per candidate:
```
candidate_id, recommended_title, type, competition, area, environment, priority,
historical_start_date, historical_resolution_date, summary, impact, root_cause, resolution,
validation, data_impact, scoring_impact, ranking_impact, related_commits, related_prs,
related_existing_issues, evidence_files, evidence_quality (STRONG/MODERATE/WEAK),
confidence (HIGH/MEDIUM/LOW), materiality, recommended_action
```

`recommended_action` ∈ `CREATE`, `MERGE_WITH_OTHER_CANDIDATE`, `LINK_TO_EXISTING_ISSUE`,
`SKIP_TRIVIAL`, `SKIP_INSUFFICIENT_EVIDENCE`, `NEEDS_REVIEW`.

Prefer `CREATE` for: real production bugs, material user-facing defects, incidents, data
corruption/integrity failures, scoring/ranking defects, entry/payment defects, security
defects, deployment failures, meaningful regressions, material email/PDF failures, and
architectural debt whose remediation materially reduced operational risk.

Prefer `SKIP_TRIVIAL` for: typo-only commits, formatting, cosmetic-only changes, exploratory/
debug commits, build noise, dependency bumps without a documented defect, mechanical refactors,
and intermediate commits already represented by another candidate.

Never fabricate dates, root causes, or evidence. If a date is uncertain, use the best-evidenced
date available (commit date, PR merge date, changelog entry date) and say in the record that it
is inferred, not confirmed. If evidence is too thin to state a root cause, say so — set
`evidence_quality: WEAK` and `confidence: LOW` rather than inventing a plausible-sounding one.

When finished, report: commits/PRs/docs inspected, total candidates, breakdown by confidence,
and the two output file paths. Do not proceed to review or publish — that's
`/historical-review` and `/historical-publish`.
