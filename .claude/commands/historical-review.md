---
description: Review historical-scan candidates for duplicates, evidence quality, and grouping. Still does not publish.
argument-hint: "[path to candidates .json, defaults to the most recent in ferrarilabs-work/audits/]"
---

Review the historical-Issue candidate list produced by `/historical-scan`. **Still read-only
with respect to GitHub Issues** — this step only produces a reviewed/annotated candidate list,
never creates anything.

Input: $ARGUMENTS, or if empty, the most recently dated
`github-historical-issue-candidates-*.json` under `~/Documents/GitHub/ferrarilabs-work/audits/`.

For every candidate:
1. Check for duplicates against: current open/closed GitHub Issues (`gh issue list --state all`),
   other candidates in the same list, and any already-`CREATED`/`LINKED` entries in the backfill
   registry (`github-issues-backfill-*.md`). Duplicate = same component + same symptom + same
   root cause + same fix commits, not just similar wording.
2. Re-check evidence quality: does the cited evidence actually support the summary and root
   cause as written? Downgrade `confidence`/`evidence_quality` if not.
3. Re-check chronology: do `historical_start_date`/`historical_resolution_date` actually match
   the cited commits/PRs/docs?
4. Re-check grouping: should any candidates be merged (`MERGE_WITH_OTHER_CANDIDATE`) or split
   (materially independent problems bundled into one candidate)?
5. Re-check materiality against the rules in `/historical-scan` — reclassify anything that
   should be `SKIP_TRIVIAL` or `SKIP_INSUFFICIENT_EVIDENCE`.
6. For anything ambiguous, set `recommended_action: NEEDS_REVIEW` rather than guessing toward
   `CREATE`.

Write the reviewed list to a new file (do not overwrite the scan output):
`~/Documents/GitHub/ferrarilabs-work/audits/github-historical-issue-candidates-reviewed-<YYYY-MM-DD>.md`
and matching `.json`, each candidate keeping its original `candidate_id` plus a `review_notes`
field explaining any change from the scan's original classification.

Report a summary: total candidates, counts per `recommended_action`, counts per `confidence`,
duplicates found, and how many need human review before any publish decision. Explicitly state
that no GitHub Issues were created, edited, or closed. The next step, `/historical-publish`,
requires an explicit human-approved subset of this list — it will not run against the full list
by default.
