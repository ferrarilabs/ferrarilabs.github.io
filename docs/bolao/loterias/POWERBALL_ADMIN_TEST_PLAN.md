# Powerball Admin — Test Plan & Status Matrix

Three categories used for every claim below, per Eduardo's explicit instruction — never blurred:

- **testado e executado** — actually ran in this session, real output captured.
- **validado estaticamente** — written and carefully read/reviewed, never executed.
- **proposto, mas não executado (NÃO EXECUTADO)** — written, real runnable code, never run
  against anything real in this session.

## Environment limitation (stated once, applies to every NÃO EXECUTADO item below)

`docker` and `brew` are both unavailable in this sandbox (`command not found`). `npx supabase`
(v2.111.0) runs, but `supabase start` requires Docker to bring up local
Postgres/GoTrue/PostgREST, so no local Supabase instance could be created here. No remote
test-project credentials were provided. This is why every SQL/RLS/RPC-touching item below is
NÃO EXECUTADO rather than passed. See `docs/bolao/loterias/POWERBALL_ADMIN_OPERATIONS.md` for
the exact runbook to execute all of it for real once Docker or a remote test project is
available.

## Status matrix

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Footer "Admin" link opens the real route | **testado e executado** | Clicked in a live Chrome tab via claude-in-chrome against a local `python3 -m http.server`; navigated to `/bolao/loterias/powerball/admin/`, showed login + honest config-error message. Screenshot captured in-session. |
| 2 | Zero direct UI writes (RPC-only) | **testado e executado** (via code read + grep) | `grep -n "\.insert(\|\.update(\|\.delete(" bolao/loterias/powerball/admin/js/*.js` finds none; only `.select()` (reads, RLS-gated) and `.rpc()` (writes) are called. |
| 3 | Zero operational `localStorage` in admin code | **testado e executado** | `tests/no_localstorage_test.mjs` → `PASS: 0 localStorage calls found in 4 files`. Output: `tests/no_localstorage_test.output.txt`. |
| 4 | `sessionStorage` used only for the auth session | **testado e executado** | `tests/sessionstorage_scope_test.mjs` → `PASS`. Output: `tests/sessionstorage_scope_test.output.txt`. |
| 5 | Every shipped button wired to a real RPC | **testado e executado** (via code read + `node -c` syntax check) | Participantes, Pagamentos, Sorteios, Bilhetes ("Novo bilhete" → `admin_create_ticket`, "Editar rascunho" → `admin_update_draft_ticket`, disabled once `status != 'draft'`), and Resultados ("Registrar resultado" → `admin_record_result`, "Corrigir" → `admin_correct_result`, requires typing "CONFIRMAR" before the RPC call) are the five wired screens. All other 6 sections render text only, no `<button>` elements — confirmed by reading `admin/js/app.js`'s `renderNotImplemented()`. `node -c admin/js/app.js` confirms valid syntax; grep confirms zero `.insert()/.update()/.delete()` calls anywhere in the file. |
| 6 | Migration file ordering (001→004) has no forward references | **validado estaticamente** | Manually re-read; types/tables precede their uses; `lottery_current_role()` (002) precedes all policies/RPCs that call it (003, 004). Not run against a real Postgres parser. |
| 7 | `service_role` never in frontend | **testado e executado** | `grep -rn "service_role" bolao/loterias/powerball/admin/` → one hit, a comment, not a value. |
| 8 | Owner bootstrap is a separate, non-frontend script | **validado estaticamente** | `bolao/loterias/powerball/scripts/bootstrap_owner_role.sql` reviewed; not referenced from any `admin/` file; idempotent `on conflict` upsert. |
| 9 | RLS deny-by-default, real negative tests written | **proposto, mas não executado** | `tests/rls_negative_test.mjs` — real runnable code, 7 sub-assertions (anon write/read/RPC blocked, roleless blocked, auditor read-only, admin RPC-only, audit table immutable even for owner). Ran just now → `SKIPPED (NÃO EXECUTADO)`, exit code 2. Output: `tests/rls_negative_test.output.txt`. |
| 10 | Audit hash-chain integrity | **proposto, mas não executado** | `tests/audit_chain_test.mjs` — real runnable code. Ran just now → `SKIPPED (NÃO EXECUTADO)`, exit code 2. Output: `tests/audit_chain_test.output.txt`. |
| 11 | Mandatory-reason enforcement (`lottery_validate_reason`) | **validado estaticamente** | Function body reviewed; rejects null/short/trivial values. Not exercised against a live DB; not exercised via the UI's `requireReasonPrompt()` beyond code review either (UI-side check is client convenience only — the DB function is the real enforcement point and is untested live). |
| 12 | Optimistic concurrency (`STALE_VERSION`) | **validado estaticamente** | RPC bodies raise `STALE_VERSION: ...` on mismatch; UI's `admin_archive_participant` handler catches the exact string and shows the required Portuguese message. Not exercised against a live DB. |
| 13 | Data migration dry-run tool | **testado e executado** | `scripts/powerball/import_data_to_supabase.mjs` run for real; found and reported real counts (2 draws, 28 participant rows, $418.00, 0 tickets) from the actual `data.js` in this repo. No network/writes. |
| 14 | Playwright evidence at 3 breakpoints for ~20 admin screens | **NOT DONE — stated honestly, not fabricated** | Only one real screenshot exists (the footer-link click-test above, captured via claude-in-chrome, not Playwright, at whatever the default viewport was). No Playwright suite was written or run in this pass; most of the 20 requested screens (payments, draws, tickets, publications, results, emails, audit, health, version-conflict, expired-session, etc.) don't exist as built UI yet — only Participantes does. Faking these screenshots was explicitly forbidden and none were faked. This is flagged as outstanding work, not silently dropped. |
| 15 | Public projection view | **validado estaticamente** | `lottery_public_projection` in `002_rls.sql` reviewed; exposes only non-PII aggregates; grants `SELECT` to `anon`. Not run against a live DB. Does not yet include published ticket/result data (documented gap). |

## What "done" does not mean here

Written SQL/RPCs/tests are real and reviewable, but **none of the database-side guarantees
(RLS rejection, RPC authorization, audit hash chain, append-only trigger) have been verified by
actually running them.** Anyone relying on this branch before running the Section "Environment
limitation" runbook should treat those specific guarantees as unverified, not as passing.
