# Exact Commands — Run These Once a Test Supabase Project Exists

Nothing in this doc has been executed in this session (no test project available — confirmed
again: no `supabase`/`docker`/`psql` binaries, no `SUPABASE_TEST_*` env vars). This is the exact,
copy-pasteable runbook for Eduardo (or a future session with real credentials) to close the
section 6 gap. Every command is read/write against a TEST project only — never point
`SUPABASE_TEST_URL` at the production project.

## 0. Prerequisites

```bash
# Either a hosted test project (free tier is enough) or local:
brew install supabase/tap/supabase   # macOS, if not already installed
supabase init
supabase start                        # spins up local Postgres + PostgREST + Studio
```

Export credentials (never commit these):

```bash
export SUPABASE_TEST_URL="https://<test-project-ref>.supabase.co"   # or http://localhost:54321 for local
export SUPABASE_TEST_ANON_KEY="<anon key — never the service_role key>"
```

## 1. Apply the schema (test project only)

```bash
cd /path/to/ferrarilabs-visual-framework-football
psql "$SUPABASE_TEST_DB_URL" -f bolao/shared/sql/001_bolao_notification_schema.sql
psql "$SUPABASE_TEST_DB_URL" -f bolao/shared/sql/002_claim_bolao_notification_jobs_rpc.sql
# or, via the Supabase CLI:
supabase db push --db-url "$SUPABASE_TEST_DB_URL"
```

Verify:

```bash
psql "$SUPABASE_TEST_DB_URL" -c "\d bolao_notification_jobs"
psql "$SUPABASE_TEST_DB_URL" -c "select proname from pg_proc where proname like '%bolao_notification%';"
# expect: claim_bolao_notification_jobs, mark_bolao_notification_sent,
#         mark_bolao_notification_retryable_failure, mark_bolao_notification_permanent_failure,
#         release_stale_bolao_processing
```

## 2. Install the Supabase JS client (only needed for this test)

```bash
npm install --no-save @supabase/supabase-js
```

## 3. Run the real three-runner durability test (to be written against the live client)

This session could not write and run this test for real (no client to test against), but the
shape mirrors `bolao/shared/scripts/test_durable_persist.py`'s three-independent-clone structure
exactly — swap "git clone" for "new SupabaseNotificationRepository(createClient(...))" per
runner:

```bash
node -e '
import { createClient } from "@supabase/supabase-js";
import { SupabaseNotificationRepository } from "./bolao/shared/scripts/supabase_notification_repository.mjs";
import { buildIdempotencyKey } from "./bolao/shared/scripts/notification_repository.mjs";

const client = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY);

// Runner A: create event + jobs, then this process exits (simulating total termination).
const repoA = new SupabaseNotificationRepository(client);
const { event } = await repoA.createEvent({
  poolId: "test-pool", entityType: "match", entityId: "runner-test-1",
  eventType: "final_confirmed", eventVersion: 1, payloadSnapshot: { homeScore: 1, awayScore: 0 },
});
await repoA.enqueueJobs(event.eventId, [
  { poolId: "test-pool", recipient: "alfa@example.test", payloadSnapshot: { x: 1 },
    idempotencyKey: buildIdempotencyKey("test-pool", "runner-test-1", "alfa@example.test", 1) },
]);
console.log("Runner A done, eventId:", event.eventId);
'

# Runner B: a SEPARATE node invocation (new process, no shared memory) — claims and sends.
node -e '
import { createClient } from "@supabase/supabase-js";
import { SupabaseNotificationRepository } from "./bolao/shared/scripts/supabase_notification_repository.mjs";

const client = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY);
const repoB = new SupabaseNotificationRepository(client);
const claimed = await repoB.claimPendingJobs("test-pool", 50, "runner-B");
console.log("Runner B claimed:", claimed.length, "job(s)");
for (const job of claimed) {
  // fake provider — never a real send
  await repoB.markSent(job.jobId, { providerMessageId: "fake-msg-1" });
}
'

# Runner C: another SEPARATE invocation — must send ZERO duplicates.
node -e '
import { createClient } from "@supabase/supabase-js";
import { SupabaseNotificationRepository } from "./bolao/shared/scripts/supabase_notification_repository.mjs";

const client = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY);
const repoC = new SupabaseNotificationRepository(client);
const claimed = await repoC.claimPendingJobs("test-pool", 50, "runner-C");
console.log("Runner C claimed (MUST be 0 — everything already sent):", claimed.length);
'
```

## 4. Concurrent-claim test (two runners racing)

```bash
# Run these two in the SAME second, from two separate terminals/processes:
node -e '... repo.claimPendingJobs("test-pool", 50, "concurrent-B") ...' &
node -e '... repo.claimPendingJobs("test-pool", 50, "concurrent-C") ...' &
wait
# Then verify: SELECT job_id, status, claimed_by FROM bolao_notification_jobs WHERE pool_id = 'test-pool';
# Expect: every job claimed by EXACTLY ONE of concurrent-B/concurrent-C, never both, never neither.
```

## 5. Pass/fail criteria (must be literally zero)

```bash
psql "$SUPABASE_TEST_DB_URL" -c "
  select count(*) as jobs_claimed_by_more_than_one_worker
  from (
    select job_id, count(distinct claimed_by) as claimants
    from bolao_notification_deliveries d join bolao_notification_jobs j using (job_id)
    group by job_id having count(distinct claimed_by) > 1
  ) x;
"
# must return 0

psql "$SUPABASE_TEST_DB_URL" -c "
  select recipient, event_id, count(*) from bolao_notification_deliveries d
  join bolao_notification_jobs j using (job_id)
  where outcome = 'sent' group by recipient, event_id having count(*) > 1;
"
# must return zero rows (no recipient sent more than once for the same event)
```

## 6. Cleanup (test project only)

```bash
psql "$SUPABASE_TEST_DB_URL" -c "delete from bolao_notification_deliveries where pool_id... "  # or just:
supabase db reset   # local only — never run against a hosted project without confirming it's the TEST one
```

## After running this

Update `docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_EXECUTION.md` with the REAL output (paste raw
`psql`/`node` output, not a paraphrase) and only then may the verdict move past "NOT READY —
AGUARDANDO SUPABASE DE TESTE".
