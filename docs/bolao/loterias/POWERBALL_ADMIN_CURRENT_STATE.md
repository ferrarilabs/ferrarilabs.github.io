# Powerball Admin — Current State Audit (checkpoint 1)

Date: 2026-08-05
Branch: `powerball-admin-supabase-audit` (tracking `origin/powerball-email-professionalization`, merge-base `1a6fa30`)

## Method

Direct inspection of `bolao/loterias/powerball/` (index.html, js/app.js, js/config.js,
js/data.js, scripts/) plus `docs/bolao/loterias/*.md` carried over from the
`powerball-email-professionalization` branch. No code executed beyond `grep`/`wc`.

## Findings

| Area | State | Classification | Evidence |
|---|---|---|---|
| "Admin" link/route | No `Admin`/`admin` string found anywhere in `bolao/loterias/powerball/index.html` | NÃO IMPLEMENTADA | `grep -in admin index.html` → 0 matches. There is no footer admin link, no `#admin`, no modal. |
| Auth code | None found in `js/app.js` or `js/config.js` | NÃO IMPLEMENTADA (confirmed, as expected) | No `password`, `adminPasswordHash`, `supabase.auth` references in `js/*.js`. |
| Supabase usage (runtime app) | Not wired into `js/config.js` (18 lines, no `supabase` key) or `js/app.js` | NÃO IMPLEMENTADA at runtime | `js/config.js` has no `supabase.url`/`anonKey` block (compare to `bolao/cdb2026/js/config.js:78-79`, which does: `provider: "supabase", url: "https://cmhqkkfczotdnssupkni.supabase.co"`). |
| `add_participant_to_supabase.py` | Present in `scripts/`, orphaned — no caller found, not referenced by app.js or any workflow doc read so far | ORPHANED / SOMENTE SCRIPT (not wired to admin UI) |  |
| `data.js` | 278 lines, present, used as the current fixture/persistence source for participants/draws | HARDCODED / DATA_ONLY (current persistence) | `wc -l js/data.js` → 278. |
| localStorage usage | 2 occurrences in `js/app.js` | LOCALSTORAGE (must be zero for operational data per hard rule — needs classification of exactly what those 2 calls do before removal) | `grep -c localStorage js/app.js` → 2. |
| Email outbox (from `powerball-email-professionalization`) | Present: `js/email/` referenced under scripts, plus `docs/bolao/loterias/POWERBALL_EMAIL_ARCHITECTURE.md`, `POWERBALL_EMAIL_OPERATIONS_RUNBOOK.md`, `POWERBALL_EMAIL_TEST_PLAN.md`, `POWERBALL_TICKET_PUBLICATION_EMAIL.md`, `POWERBALL_PARTICIPANT_CONFIRMATION.md`, `POWERBALL_PII_AUDIT.md` all present under `docs/bolao/loterias/` | FUNCIONAL (per prior branch's own test plan — not independently re-verified in this pass) | Files exist; content not yet fully reviewed in this pass. |
| `POWERBALL_UI_AND_OPERATIONS_REVIEW.md` | Not found anywhere in repo | DOES NOT EXIST (referenced by task spec as "if present" — it is not present) | `find . -iname "*POWERBALL_UI_AND_OPERATIONS*"` → no results. |
| Comprovante/proof storage | Not investigated yet in this pass | UNKNOWN — pending |  |
| `supabase` CLI (for local dev instance) | Available via `npx supabase` (v2.111.0) but requires Docker | Docker (`docker`) is **not installed/available** in this sandbox | `docker --version` → command not found. `brew` also unavailable. |

## Hard environment limitation (reporting honestly, not working around it)

Section 19 of the task asks to stand up local/test Supabase (Supabase CLI local dev) to run
real RLS/RPC tests. `npx supabase` itself runs (v2.111.0), but Supabase local dev requires
Docker to run the Postgres/GoTrue/PostgREST containers, and Docker is not installed in this
sandbox (`docker` and `brew` both report "command not found"). This means genuine RLS/RPC/audit
integration tests cannot be executed against a live Postgres instance from this environment.
This will be stated plainly in the test plan/evidence sections rather than papered over — per
the task's own instruction not to fabricate passing tests.

## Scope reality check

This task specifies a full production-grade multi-tenant admin system: 13 tables, ~17
SECURITY DEFINER RPCs, deny-by-default RLS with real negative tests, a DB-computed hash-chained
append-only audit log with a blocking trigger, optimistic concurrency on every mutable entity,
a full admin SPA with 11 sections and reinforced-confirmation flows, a dry-run-only data
migration tool, Playwright evidence at 3 breakpoints across ~20 screens, and 6 new docs — while
reusing (not duplicating) the existing email-outbox code from
`powerball-email-professionalization`. This is realistically a multi-week engineering effort,
not something that can be honestly completed (with real, executed tests and real evidence
rather than fabricated ones) in a single bounded session. The rest of this document will be
extended, and the schema/RLS/RPC design work will proceed, but delivering all 24 checkpoints
with genuine automated-test evidence in one pass is not something I can honestly claim to have
finished — see the status report accompanying this checkpoint.
