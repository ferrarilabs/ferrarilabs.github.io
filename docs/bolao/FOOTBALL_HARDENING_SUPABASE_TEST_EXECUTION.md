# Supabase Test Execution — Status

## Status: **NÃO EXECUTADO — AGUARDANDO SUPABASE DE TESTE**

This is stated explicitly and plainly, per Eduardo's own instruction not to let the final
verdict claim more than what was actually proven.

## What was checked before declaring this

- No `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY` (or equivalent) environment variables are set
  in this session.
- No local Supabase CLI (`supabase start` / a local Postgres+PostgREST stack) is installed or
  running in this environment.
- The existing production Supabase project (`cmhqkkfczotdnssupkni.supabase.co`, referenced in
  `bolao/{copa2026,br2026,cdb2026}/js/config.js`) is explicitly OFF LIMITS for this work — the
  task's own hard constraint is "no production Supabase writes," and even read-only
  experimentation against the production project's schema risks confusion with real state.
- No new Supabase project was created for this session (would require external account access
  this environment does not have).

## What IS proven, and what is NOT

**Proven** (real code, real tests, run in this session, all exit 0):
- `notification_repository.mjs`'s `NotificationRepository` contract, exercised identically
  against `MemoryNotificationRepository` and `FileNotificationRepository` — 27/27 checks.
- The SQL migration proposals (`001_bolao_notification_schema.sql`,
  `002_claim_bolao_notification_jobs_rpc.sql`) are internally consistent and reviewed, but
  **never executed against any real Postgres instance** — no syntax check beyond careful manual
  review, no EXPLAIN ANALYZE, no real `FOR UPDATE SKIP LOCKED` contention test.
- `SupabaseNotificationRepository` — code-complete, follows the same method contract as the
  tested adapters, but its actual network calls to `this.client.rpc(...)` /
  `this.client.from(...)` have never executed against a real Supabase client.

**NOT proven** (this is the honest gap):
- The real cross-run durability scenario from section 6 — Runner A creates event+jobs in
  Supabase and terminates, Runner B (clean dir) claims and sends via a fake provider, Runner C
  (clean dir) sends zero duplicates — has **not been run**, because it requires a real Supabase
  (or Postgres-compatible) endpoint this session does not have access to.
- The concurrent-claim scenario (Runner B and Runner C claiming simultaneously, proving
  `FOR UPDATE SKIP LOCKED` actually prevents a double-claim under real Postgres, not just in the
  SQL's intent) — **not run**, same reason.
- Whether the RPC functions as written actually compile/execute correctly in a real Postgres —
  the SQL has been reviewed carefully but SQL that looks correct can still have a syntax error,
  a wrong column reference, or a subtly wrong lock behavior that only a real execution reveals.

## What would need to happen to close this gap

1. A test Supabase project (either a dedicated free-tier project or `supabase start` locally)
   with credentials provided via environment variables, never committed to the repo.
2. Apply `001_bolao_notification_schema.sql` and `002_claim_bolao_notification_jobs_rpc.sql` to
   that test project only.
3. Run a real three-process test (three separate `node`/`python3` invocations, each with its own
   clean working directory, using `SupabaseNotificationRepository` against the test project) —
   the equivalent of `test_durable_persist.py`'s three-clone structure, but against Supabase
   instead of git.
4. Add a concurrent-claim variant (two processes calling `claimPendingJobs()` at approximately
   the same instant against the same pending jobs) and assert zero jobs claimed twice.

## Consequence for the final verdict

Per Eduardo's explicit instruction: this gap alone caps the verdict at **NOT READY** (not "READY
FOR STAGED TEST DEPLOYMENT") until a real Supabase test execution happens and this document is
updated with real results.
