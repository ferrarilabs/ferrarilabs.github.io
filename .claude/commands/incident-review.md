---
description: Audit-style analysis of a production incident (timeline, root cause, blast radius, corrective actions).
argument-hint: <issue-number, PR-number, or free-text description of the incident>
---

Produce an audit-style incident review for: $ARGUMENTS

Use `docs/bolao/AUDIT_PROTOCOL.md` and `docs/bolao/LIVE_DATA_INCIDENT_RUNBOOK.md` as the
methodology reference. This command is read-only with respect to GitHub Issues/PRs (comment
only if explicitly asked) and never modifies production data or scoring/ranking logic.

Produce a report with these sections:

- **Timeline** — chronological sequence of what happened, with timestamps where evidenced
  (commit times, PR times, deploy times, doc-stated times). Mark inferred timestamps as such.
- **Trigger** — the specific event/change/condition that set the incident off.
- **Blast radius** — which app(s), which users/entries, production vs. staging, how many
  records/participants affected if determinable.
- **Root cause** — the actual underlying cause. Separate confirmed-from-code/logs vs. inferred.
- **Contributing factors** — anything that made this worse or harder to catch (missing test,
  missing gate, silent failure mode, etc.).
- **Mitigation** — what stopped the bleeding immediately, and when.
- **Permanent corrective action** — what actually fixed the root cause (link commit/PR).
- **Validation** — how the fix was proven to work.
- **Preventive controls** — what now exists (test, gate, doc, critical-surface declaration) to
  stop recurrence, and whether it's actually enforced (e.g. wired into `npm run check`) or just
  documented.
- **Related GitHub artifacts** — Issues, PRs, commits.

Ground every claim in cited evidence (commit SHA, PR number, doc path + line, log excerpt).
Where the repository's own incident docs already cover this (e.g.
`docs/bolao/CDB2026_RECEIPT_IDENTITY_INCIDENT_*.md`), read and cite them rather than
re-deriving from scratch — but verify their claims against current code/history rather than
repeating them uncritically.

Write the report to
`~/Documents/GitHub/ferrarilabs-work/incidents/<slug>-review-<YYYY-MM-DD>.md` and report the
path. If this reveals the incident should become a historical Issue candidate, say so — but do
not create it here; that goes through `/historical-scan` → `/historical-review` →
`/historical-publish`.
