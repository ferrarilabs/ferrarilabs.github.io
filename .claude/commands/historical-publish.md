---
description: Create GitHub Issues for an explicitly approved subset of historical candidates. Never publishes all candidates by default.
argument-hint: <candidate-id-list, comma-separated — REQUIRED, e.g. "HIST-003,HIST-007,HIST-012">
---

Publish historical GitHub Issues for the approved candidates: $ARGUMENTS

**Hard requirement: $ARGUMENTS must be a non-empty, explicit list of candidate IDs that a human
has reviewed and approved.** If $ARGUMENTS is empty, or looks like "all", "everything", or a
whole confidence tier ("all HIGH"), STOP and ask for the explicit list instead of proceeding —
never publish an entire candidate list by default, even if it's all `HIGH`/`CREATE`.

For each approved candidate ID:
1. Load its record from the latest reviewed candidate JSON
   (`github-historical-issue-candidates-reviewed-*.json`).
2. Re-check for duplicates one more time (`gh issue list --state all`) — state may have changed
   since `/historical-review` ran.
3. If `recommended_action` is not `CREATE`, stop for that candidate and report why it's not
   eligible (e.g. it was `MERGE_WITH_OTHER_CANDIDATE` or `NEEDS_REVIEW`) rather than force it
   through.
4. Build the Issue body from the historical template:
   ```
   # Historical Record

   This Issue was created retrospectively to preserve the engineering and operational history
   of Ferrarilabs. The GitHub creation timestamp does not represent the original occurrence
   date.

   ## Original Occurrence Date
   ## Resolution Date
   ## Competition
   ## Environment
   ## Summary
   ## Impact
   ## Root Cause          (mark explicitly if inferred vs. documented)
   ## Resolution
   ## Validation
   ## Data Impact
   ## Scoring / Ranking Impact
   ## Related Commits
   ## Related Pull Requests
   ## Related Existing Issues
   ## Evidence
   ## Historical Reconstruction
   Reconstructed on <today's date> from repository and operational evidence.
   ```
5. Create the Issue with `gh issue create`, applying the `historical` label plus the
   appropriate type/competition/area/priority labels from the taxonomy in
   `docs/bolao/` governance / this repo's label set.
6. Add it to the "Ferrarilabs Engineering" Project if the Project exists and is reachable with
   current `gh` auth scopes; if not, note that in the report rather than failing silently.
7. Set Project Status to `Done` and Resolved Date to the historical resolution date, if the
   Project and its fields exist.
8. Close the Issue as completed.
9. Update the backfill registry (`github-issues-backfill-*.md`) for this candidate:
   `CREATED → GitHub #NNN` (or `SKIPPED → reason` if step 3 stopped it).

After processing all requested candidates, report a table of candidate_id → outcome (created
Issue number, or skipped + reason). Do not process any candidate not explicitly named in
$ARGUMENTS.
