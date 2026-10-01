# Private-repository dependency audit

Searched the whole tracked tree for: `raw.githubusercontent.com`, `githubusercontent`, `github.com/ferrarilabs/...`,
`api.github.com/repos/ferrarilabs`, blob/raw links, Actions/dispatch calls, Pages URLs, `ferrarilabs.github.io`,
fetch/XHR/import/script/link references, Workers and Supabase functions calling GitHub, and links in emails/audit pages.
Companion: `WORKER_TOKEN_AUDIT.md` (credentials), `ACTIONS_PRIVATE_REPO_AUDIT.md` (Actions).

**Result: no production path depends on anonymous access to repository contents.** Verified two ways: static search
(below) and a Chromium run over the built `_site` (21 entry pages, no 4xx/5xx, no page errors; `scripts/smoke-public-artifact.mjs`).

| Match | Where | Classification | Action |
|---|---|---|---|
| `github.com/ferrarilabs/.../blob/main/...` (5 links x 3 languages) | `bolao/copa2026/audit-report.html` (+ generator `generate_audit_report.py`) | **email/user-facing dependency** (audit page emailed to participants) | **Fixed**: links removed; page points to public `js/app.js`, full source "on request". Gate rule `private-repo-link` now blocks regressions |
| `blob/main/docs/bolao/CDB2026_RULES_AND_MODEL.md` | `bolao/cdb2026/scripts/register_final_topology.py:107`; already persisted in Supabase topology provenance (`sourceUrl`) | stored data; operator/audit metadata, not rendered by the app | **Deferred**: link will 404 for non-owners; history is immutable evidence. Not changed |
| `blob/main/docs/bolao/CHANGELOG.md` | `.github/ISSUE_TEMPLATE/config.yml` | GitHub-internal link, viewers are authenticated | none |
| `actions/runs/<id>` | SQL incident comment, workflow summary | documentation-only | none |
| `api.github.com/.../dispatches` | `workers/live-producer` | **GitHub-authenticated operation** (fine-grained PAT) | needs PAT to include the repo; see token audit (UNVERIFIED externally) |
| `api.github.com` | `workers/user-report-intake` | authenticated; targets another (private) repo | none |
| `ferrarilabs.github.io/...` URLs in sender scripts, app code, `canonical` tags, `bolao-teste/` | emails, HTML | **user-facing**, but they resolve through the 301 to `www.ferrarilabs.com`, not to repo content | none; will keep working only while Pages serves (see plan blocker) |
| `www.ferrarilabs.com/bolao/loterias/powerball/tickets/<draw>/tickets.{pdf,csv}` | Powerball emails | **email/user-facing runtime dependency on a Pages file** | preserved by manifest pattern |
| `https://www.ferrarilabs.com/bolao/classificacao-geral.html`, `/bolao/cdb2026/` | emails | email-facing | preserved |
| `ferrarilabs.github.io/blob/main`, `.git/worktrees` | docs / local paths | documentation-only | none |
| `raw.githubusercontent.com` | — | none found | — |
| browser `fetch`/`<script>`/`<link>` | all apps | production browser dependency on same-origin files only | all in allowlist; verified by crawl |
| Supabase Edge Functions | `supabase/functions/**` | no GitHub calls found | Supabase's own GitHub integration is separate: UNVERIFIED (external console) |

External-service readers of the repo (webhooks, integrations) cannot be enumerated from the repository; see UNVERIFIED items
in the token audit and the runbook checklist.
