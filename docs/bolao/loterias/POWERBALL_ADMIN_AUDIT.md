# Powerball Admin — Audit Trail

Status legend: **testado e executado** / **validado estaticamente** / **proposto, mas não
executado** (NÃO EXECUTADO).

## Design (proposto, mas não executado — migrations/001_schema.sql)

`lottery_admin_audit`: `audit_id, actor_user_id, actor_email_snapshot, actor_role, action_type,
entity_type, entity_id, before_snapshot, after_snapshot, reason, request_id, correlation_id,
source, server_created_at, client_metadata, previous_entry_hash, entry_hash`.

- **Append-only**: `trg_lottery_audit_no_update` / `trg_lottery_audit_no_delete` raise an
  exception on any UPDATE or DELETE, unconditionally — this applies even to the `owner` role,
  because the trigger doesn't check role at all; it blocks the SQL operation itself.
- **Hash chain**: `trg_lottery_audit_hash` (BEFORE INSERT) looks up the most recent row's
  `entry_hash`, sets it as this row's `previous_entry_hash`, computes
  `sha256(previous_entry_hash || actor_user_id || action_type || entity_type || entity_id ||
  before_snapshot || after_snapshot || reason || server_created_at)` as `entry_hash`, and
  overwrites `server_created_at` with `now()` regardless of what the caller sent — so a modified
  browser clock can never be attributed as the audit timestamp.
- **Integrity check**: `verify_powerball_audit_chain()` walks the whole table in
  `server_created_at, audit_id` order, recomputes each hash independently, and returns
  `(valid, first_broken_audit_id, checked_count)`.

## Honesty about the guarantee

This is **tamper-evident**, not tamper-proof. A hash chain computed and verified inside the same
Postgres instance cannot defend against someone with direct superuser or `service_role` access
to that instance — they could rewrite a row and recompute the whole chain from that point
forward, and `verify_powerball_audit_chain()` run against the tampered data would then report
`valid = true`. What the chain *does* guarantee: any tampering that does **not** also recompute
every subsequent hash is detectable, and the anon/authenticated (non-superuser) roles the admin
UI actually uses have no path to UPDATE/DELETE the table at all (RLS has no write policy, and the
trigger blocks it regardless of RLS). This limitation is stated here and in
POWERBALL_ADMIN_SECURITY.md — not hidden or implied to be stronger.

## Mandatory reason (validado estaticamente)

`lottery_validate_reason()` (003_rpcs.sql) rejects `null`, anything under 8 characters, and the
literal values `.`, `teste`, `test`, `n/a`, `na`, `x` (case-insensitive, trimmed). Every RPC that
performs a state-changing action calls this before doing anything else. The reason is stored in
`lottery_admin_audit.reason` alongside the actor/action/entity — verifiable by reading the
migration source, not yet verified by running it against a live database.

## What's proven vs. not

- **testado e executado**: the localStorage/sessionStorage scope of the admin code (see
  POWERBALL_ADMIN_TEST_PLAN.md) — unrelated to the audit chain itself, but relevant because the
  audit design depends on there being no client-side path around the RPC/audit boundary, and
  that absence of a client-side write shortcut is what was actually grep-tested.
- **proposto, mas não executado**: the hash-chain computation, the append-only trigger, and
  `verify_powerball_audit_chain()` have never run against a live Postgres — no Docker/local
  Supabase available in this sandbox. `tests/audit_chain_test.mjs` is real, runnable test code
  for this and was executed just now; it correctly reported `SKIPPED (NÃO EXECUTADO)` with exit
  code 2, not a false pass. Running it for real requires the runbook in
  POWERBALL_ADMIN_OPERATIONS.md.
