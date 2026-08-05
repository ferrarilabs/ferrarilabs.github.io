# Persistence Architecture — Production Supabase, Not Git-as-Outbox

Eduardo's explicit architecture decision, following the "NOT READY TO MERGE" review:

## Decision

**Production notification-job persistence is Supabase** (same project/pattern this repo already
uses for real scoring state in all three apps). Filesystem-backed persistence
(`notification_outbox.{py,mjs}`, `FileNotificationRepository`) is **unit tests and local dev
only** — never production.

## `durable_persist.py` — explicitly NOT for production

The git-commit-based durability proof-of-concept built in the previous pass
(`bolao/shared/scripts/durable_persist.py`, proven with a real 3-independent-clone test) stays
in the repo as a **cross-process durability abstraction proof-of-concept** — it genuinely proved
that ephemeral CI filesystems need SOME durable channel, and that a naive line-based merge on a
JSON array fails under concurrency (a real bug it found and fixed). Both of those lessons carry
forward into the Supabase design (the atomic-claim RPC, `FOR UPDATE SKIP LOCKED`, exists
specifically because a naive read-then-write is unsafe under concurrency — the same class of bug
`durable_persist.py` found with git).

**It must never be wired into any real send workflow.** Concretely, `durable_persist.py`'s
`sync_state()` must **never** be called with a file that contains `recipient`, `payloadSnapshot`,
`providerMessageId`, or any error message that could contain PII — committing that into git
history creates an unremovable, permanent, plaintext record of a real person's email address and
what was sent to them. The function itself has no field-level awareness of what it's committing;
the caller is entirely responsible for never pointing it at a payload-bearing file. No caller in
this repo does that (its only test target is a fixture with `{"v": "x"}`/`{"v": "y"}` synthetic
payloads, or a payload_snapshot containing only synthetic Time Alfa/Beta data) — but the fact that
a future caller *could* misuse it this way is exactly why this document exists.

## Why not just keep using git

1. **PII in git history is permanent.** Even `git revert`/`filter-repo` doesn't reliably purge a
   public GitHub repo's history once pushed; a recipient's email address landing in a commit is a
   real, hard-to-undo privacy incident.
2. **No real transactional guarantee.** The JSON-merge fallback built last pass is a reasonable
   proof that array-union-by-key CAN be made safe, but it is bespoke, untested against high
   concurrency, and reinvents what a real database already does correctly.
3. **This repo already has Supabase**, already has RLS conventions, already has an established
   anon-key-only pattern (CLAUDE.md). Using it for the outbox is consistency, not new
   infrastructure.

## What ships this pass

- `bolao/shared/scripts/notification_repository.mjs` — the `NotificationRepository` contract
  (nine methods) plus `MemoryNotificationRepository` (tests) and `FileNotificationRepository`
  (local dev, same file-backed pattern as before, now behind the interface).
- `bolao/shared/scripts/supabase_notification_repository.mjs` — the production adapter.
  **Code-complete, not executed against a real Supabase project in this session** — see
  `docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_EXECUTION.md` for the explicit
  "NÃO EXECUTADO — AGUARDANDO SUPABASE DE TESTE" status. Do not treat this adapter as proven
  until that real run has happened.
- `bolao/shared/sql/001_bolao_notification_schema.sql`,
  `002_claim_bolao_notification_jobs_rpc.sql` — proposal-only migrations, not applied anywhere.

## Canonical schema (item 5)

`schemaVersion, jobId, poolId, eventId, entityId, eventVersion, recipient, templateId,
templateVersion, payloadSnapshot, idempotencyKey, status, attemptCount, nextAttemptAt,
lastAttemptAt, sentAt, providerMessageId, lastError` — one set, Node and Python both.
`toCanonical()`/`fromCanonical()` in `notification_repository.mjs` bridge the OLD
`app`/`matchId`/`resultVersion` names (still used by the three not-yet-migrated production call
sites: `send_result_email.py` x2, `send_round_email.py`) — those call sites were not
force-migrated in this same patch; migrating an already-wired, live, money-adjacent integration
deserves its own dedicated step, same reasoning as the previous pass's decision not to bolt
`durable_persist.py` directly into production workflows.
