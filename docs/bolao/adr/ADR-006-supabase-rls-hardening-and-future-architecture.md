# ADR-006: Supabase RLS hardening and future data-model architecture

- **Status:** Proposed (not implemented — this ADR is a proposal produced by a read-only
  security review, 2026-08-02; no schema or policy change was made).
- **Context owner:** Security review requested by Eduardo, covering all three bolão apps
  (`bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/`).

## Context

All three bolão apps share one Supabase project and one table, `public.bolao_state`, with one
JSON-blob row per app (`id = 'main' | 'br2026' | 'cdb2026'`). RLS policies (documented in
`bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md`, not versioned as `.sql` migrations) grant the
`anon` role `select`/`insert`/`update` on all three rows, scoped only by `id`. This was empirically
confirmed in `docs/bolao/security/SUPABASE_SECURITY_REVIEW.md` via a passive read-only test
(2026-08-02): an unfiltered `select=*` returns all three rows in one call.

This is consistent with the product's explicit design intent — "bolão informal, transparente"
(`SECURITY.md`, `PROJECT_MEMORY.md`) — not a misconfiguration. But row-level scoping alone cannot
express the finer-grained authorization the product actually needs: a participant should be able
to add their own entry, but not rewrite official results, payment status, the audit log, or
another participant's entry — all of which currently live in the same mutable JSON document that
the same `anon` role can `update` in full.

## Decision drivers

- Real money changes hands based on `results`/`paid` in this same document (see `CLAUDE.md`
  "Scoring" section — "This is the part of the site that can never be broken").
- No backend exists today beyond Supabase + GitHub Actions cron scripts; adding one is a
  meaningful engineering investment, not a small patch.
- The apps must keep working with `database.enabled: false`/Supabase down (local-first is a
  foundational architectural decision — see `PROJECT_MEMORY.md` "Decisões arquiteturais").
- Any change to RLS/schema is classified `SECURITY`/`PLATFORM_SHARED` per
  `docs/bolao/PLATFORM_GOVERNANCE.md` — requires the Copa (`bolao/copa2026/`, in production,
  real money already paid out) to be touched only with small, tested, reversible patches.

## What RLS *can* protect (already true today)

- Row-level isolation by `id` — no row outside `('main','br2026','cdb2026')` is reachable with
  the anon key.
- Table-level isolation — no other `public` table is reachable with the anon key (confirmed: the
  OpenAPI schema-introspection endpoint now refuses this key type entirely).
- Absence of a privileged key in the client — `service_role` is not used anywhere in this repo
  (confirmed by code search across all three apps and git history).

## What RLS *cannot* solve in the current one-document-per-row model

1. **Object property level authorization** — no way to say "this role may write `entries[]` but
   not `results`/`paid`/`auditLog`" when they're all fields of the same JSON column in the same
   row.
2. **Function-level authorization** — "submit a pick" and "record an official result" are the
   same SQL operation (`UPDATE ... SET state = ...`) at the database level; only the client's
   `app.js` UI gate and `guardAdmin()` distinguish them, and neither is enforced server-side.
3. **State-transition validity** — nothing stops a well-formed but malicious `UPDATE` from
   deleting the audit log, un-marking a payment, or reopening a cutoff, since the whole document
   is replaced/merged by client-controlled JSON.
4. **Immutable audit trail** — `auditLog` lives inside the same mutable document it's supposed to
   audit.
5. **Admin identity** — RLS operates on Postgres roles (`anon`/`authenticated`/`service_role`);
   there is no per-admin identity at the database level, because there is no Supabase Auth in use
   anywhere in the platform today. The admin password hash lives in client-shipped `config.js`
   and is compared in the browser — see "Administração client-side" in
   `SECURITY_ASSESSMENT_REPORT.md`.
6. **Concurrency / double-write races** — merge-before-save is a client convention
   (`mergeStates()`), not a database guarantee; a client that skips the merge (or a raw HTTP call)
   can still overwrite the row.
7. **Segregation of duties / dual approval** — none exists for high-value actions (declaring a
   final result, marking large payments).

## Short-term options (do not require a new backend)

These reduce blast radius without a rewrite. None were implemented by this review (documentation
only, per task scope); each would need its own risk assessment and Eduardo's explicit approval
before touching the Copa (production, real money) per `PLATFORM_GOVERNANCE.md`.

- **Revoke `DELETE` explicitly** for `anon` (currently absent by omission, not by an explicit
  `revoke` — make it explicit and add a regression test, see `supabase/tests/rls/`).
- **Tighten `WITH CHECK` on UPDATE** using Postgres JSON operators to reject payloads that change
  `state->'results'`, `state->'paid'`, or `state->'auditLog'` unless a separate, additional
  signal is present (still weak without real auth, but raises the bar above "any well-formed
  JSON").
- **Move official-result/payment writes to a Postgres RPC** (`security definer` function) that
  validates a shape and appends to `results`/`auditLog` atomically, instead of accepting an
  arbitrary full-document `UPDATE`. Still callable by `anon` today (no real admin auth exists to
  gate it), but it closes the "arbitrary property write" gap even before real auth exists.
- **Never accept a full-document `state` blob from the client** for anything except the
  participant's own `entries[]` — split the write path so results/paid/audit updates go through
  a narrower RPC even if authorization is still weak in the interim.

## Recommended medium-term architecture

Split `bolao_state` into normalized tables, each with its own RLS policy, once the product
justifies the investment (see `SECURITY_BASELINE_FOR_FUTURE_POOLS.md` for when a *new* pool
should start this way from day one instead of retrofitting):

```
competitions       (id, name, status, cutoff_rules)         -- admin-writable only
participants       (id, competition_id, name, payer, email) -- self-insert, no self-update of others
entries            (id, participant_id, competition_id)     -- owner-scoped RLS (needs real auth)
picks              (entry_id, match_id, pick_data)           -- owner-scoped RLS
matches             (id, competition_id, phase, teams)        -- admin-writable only
official_results    (match_id, result_data, entered_by, entered_at) -- admin-writable, append-only
payments             (entry_id, status, marked_by, marked_at)  -- admin-writable only
audit_events         (id, actor, action, payload, at)          -- insert-only, no update/delete for any role
admin_actions        (id, admin_id, action, at)                -- requires real Supabase Auth + claims
```

Recommended architecture once this is built:

- Real authentication (Supabase Auth) for admin identity — replaces the shared SHA-256 password
  hash with per-admin accounts and JWT claims.
- Admin-sensitive writes (results, payments, cutoff changes, entry deletion) go through RPC or
  Edge Functions that check the caller's claims — never a direct table `UPDATE` from an anonymous
  browser session.
- `audit_events` is genuinely append-only: `INSERT` allowed, `UPDATE`/`DELETE` denied for every
  role including admin, enforced by RLS, not by client convention.
- RLS policies are tested in CI (see `supabase/tests/rls/` proposal in this same review) before
  every deploy that touches the schema.

## Consequences

- **If not adopted:** the platform continues to rely on client-side UI gating and the honor
  system for the gap between "can write per RLS" and "should write per product rules." This is
  the same trade-off already accepted for admin auth and cutoff enforcement elsewhere in the
  platform (`PROJECT_MEMORY.md` "Decisões arquiteturais") — consistent with the existing risk
  posture, not a new exposure introduced by this ADR.
- **If adopted incrementally (short-term options):** meaningfully reduces the blast radius of a
  malformed or malicious direct API call without requiring Supabase Auth yet. Low risk, small
  patches, reversible — fits `PLATFORM_GOVERNANCE.md`'s constraint on Copa (production) changes.
  Copa is concluded/archived, though, and no longer accepting entries — any RLS hardening should
  be validated against BR2026/CDB2026 (both still active/near-active) first, and only propagated
  to Copa if it doesn't risk breaking read-only access to already-paid-out historical data.
- **If adopted fully (medium-term architecture):** requires a genuine backend/auth investment —
  explicitly out of scope for "informal friends/family bolão" today per
  `PROJECT_MEMORY.md`'s "Decisões arquiteturais" (admin auth judged disproportionate to risk at
  current scale). Revisit if entry volume, prize size, or number of concurrent pools grows
  materially (see roadmap items `L-02`/`L-04`).

## Not done as part of this ADR

No schema change, no RLS policy change, no code change. This document is a proposal only, per the
read-only scope of the security review that produced it.
