# Powerball Admin — Architecture

Status legend used throughout this doc: **testado e executado** (ran for real, evidence exists) /
**validado estaticamente** (written and carefully reviewed, never run) / **proposto, mas não
executado** (written, not reviewed against a live system, NÃO EXECUTADO).

## Overview (validado estaticamente)

`bolao/loterias/powerball/admin/` is a real route (`index.html` + `admin.css` + `js/*.js`), not a
modal or `#` anchor. The footer link in `bolao/loterias/powerball/index.html` points at `./admin/`
and was click-tested for real in a browser (testado e executado — see
POWERBALL_ADMIN_TEST_PLAN.md).

Unauthenticated visitors see only the login form + a restricted-access note. Authenticated
visitors see the admin shell (sidebar nav + content area). Authorization is never decided in the
browser — the shell only decides what to *render* based on whether a Supabase Auth session
exists; every actual read is gated by RLS and every write by a SECURITY DEFINER RPC that
re-checks `auth.uid()` and role itself.

## Data flow

```
Browser (admin/js/app.js)
  -> supabase-js client (session in sessionStorage only)
  -> SELECT on tables with RLS read policies (owner/admin/auditor only)  [reads]
  -> RPC call (admin_*)                                                  [writes]
       -> SECURITY DEFINER function
            -> re-check auth.uid() + lottery_current_role()
            -> validate inputs + expected_version + reason
            -> mutate primary table
            -> lottery_write_audit(...) -> lottery_admin_audit (hash-chained, append-only)
            -> return new row
```

No table has an INSERT/UPDATE/DELETE RLS policy for any role (see `002_rls.sql`) — the RPC is
the only writable path, even for the owner role. This was a specific design choice so that a
compromised or buggy UI cannot bypass audit logging by issuing a raw table write; the ledger and
audit-log guarantees are enforced at the database boundary, not the application boundary.

## Schema (proposto, mas não executado — see migrations/001_schema.sql)

13 tables: `lottery_admin_roles`, `lottery_participants`, `lottery_pools`, `lottery_draws`,
`lottery_participations`, `lottery_payment_transactions` (append-only ledger), `lottery_tickets`,
`lottery_ticket_publications` + `lottery_ticket_publication_items`, `lottery_results`,
`lottery_email_jobs` + `lottery_email_deliveries`, `lottery_admin_audit`.

Key design decisions:
- **Participants vs. participations**: identity (`lottery_participants`) is separate from
  per-pool/draw participation (`lottery_participations`) so a person's history spans multiple
  draws without duplicating their contact info.
- **Payments are an append-only ledger**: `lottery_payment_transactions` has `type` ∈
  {contribution, refund, adjustment, reversal, carryover}. A correction is a new row with
  `reverses_transaction_id` pointing at the original — the original is never edited.
- **Tickets are immutable once published**: `status` goes draft → published, and published rows
  are never edited again; a correction creates a **new** `lottery_ticket_publications` row with
  `supersedes_publication_id` set, and a fresh set of `lottery_ticket_publication_items`.
- **Every mutable entity has `version` + `updated_at`** for optimistic concurrency; RPCs take
  `p_expected_version` and raise a `STALE_VERSION:` error (caught explicitly in `admin/js/app.js`)
  if the caller's version is behind.
- **No hard deletes** anywhere — participants/participations/payments/draws/tickets/results/
  publications/emails only ever move through states (`archived`, `cancelled`, `reversed`,
  `superseded`).

## Open items (not silently assumed complete)

- The public-projection view (`lottery_public_projection` in `002_rls.sql`) intentionally does
  not yet join published ticket numbers/results — that join was deliberately left out rather
  than guessed at, pending validation against real fixture data. Tracked here, not hidden.
- Participantes, Pagamentos, Sorteios, Bilhetes, Resultados, Publicações, and E-mails are fully
  wired end-to-end in the admin UI (list via RLS-gated SELECT, every mutation via a real RPC
  call). Resultados' "Corrigir" and Publicações' "Publicar bilhetes" both require typing
  "CONFIRMAR" literally before the RPC call, matching the critical-action requirement. The
  remaining 4 sections (Visão geral, Comprovantes, Auditoria, Saúde do sistema) have RPCs/design
  specified but no UI screen yet — per Eduardo's instruction, an unwired button must not exist in
  the shipped UI, so these sections render explanatory text and no buttons.
- **Publicações' financial_snapshot/participant_snapshot are a known simplification**: the UI
  sends a minimal placeholder object (ticket count + a note), not a fully computed per-participant
  financial breakdown. Building that computation (matching cotas/payments to the specific tickets
  being published) is real business logic that was not implemented in this pass — flagged in the
  screen's own on-page copy, not hidden. `admin_publish_tickets` itself accepts whatever jsonb is
  passed for these two fields; the RPC does not currently validate their shape.
- **E-mails screen is outbox-management only.** It enqueues/retries/cancels rows in
  `lottery_email_jobs` via RPC; it never sends anything itself. Actual delivery still requires
  the separate worker process from `powerball-email-professionalization` to be pointed at this
  table — that wiring was not built in this pass (see "Open items" below).
- The Pagamentos and Sorteios screens ask for raw UUIDs (participation_id / pool_id) via
  `window.prompt()` rather than a proper picker/dropdown — functional but crude, flagged here as
  a UX debt rather than silently presented as polished.
- Email integration reuses the outbox tables' shape (`lottery_email_jobs`/`lottery_email_deliveries`)
  designed to be compatible with the worker described in
  `docs/bolao/loterias/POWERBALL_EMAIL_ARCHITECTURE.md` from the email-professionalization
  branch, but the actual wiring between `admin_enqueue_email`/`admin_retry_email` and that
  worker's queue-processing code has not been implemented in this pass.
