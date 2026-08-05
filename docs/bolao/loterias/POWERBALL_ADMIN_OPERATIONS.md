# Powerball Admin — Operations Runbook

Status legend: **testado e executado** / **validado estaticamente** / **proposto, mas não
executado** (NÃO EXECUTADO). Everything in this runbook is proposto, mas não executado — it has
never been run against a real Supabase project from this sandbox (no Docker available here).
Follow it exactly, in order, to validate the branch for real.

## Prerequisites

- Docker Desktop (or Docker Engine) installed and running.
- Node.js (already available; this sandbox has Node 24.x).
- The Supabase CLI: `npx supabase --version` (works without install; confirmed in this sandbox
  — testado e executado, prints `2.111.0`).
- `@supabase/supabase-js` installed locally: `npm install @supabase/supabase-js` (run from
  `bolao/loterias/powerball/` or a scratch directory — not yet added to the repo's own
  package.json since this app has no build step / package.json by design).

## 1. Stand up a local Supabase instance

```bash
cd bolao/loterias/powerball
npx supabase init          # only if not already a supabase project directory
npx supabase start         # brings up local Postgres/GoTrue/PostgREST/Studio via Docker
```

Note the printed `API URL`, `anon key`, and `service_role key` — use ONLY the anon key for
anything below; never paste the service_role key into a browser-facing file.

## 2. Apply the migrations, in order

```bash
npx supabase db execute -f migrations/001_schema.sql
npx supabase db execute -f migrations/002_rls.sql
npx supabase db execute -f migrations/003_rpcs.sql
npx supabase db execute -f migrations/004_rpcs_draws_tickets_publications_results_emails.sql
```

(Or paste each file's contents into the local Studio SQL editor at the printed Studio URL, in
the same order — order matters, since 002 depends on tables from 001, and 003/004 depend on the
`lottery_current_role()` helper from 002.)

## 3. Create test users and bootstrap the first owner

```bash
# Create these via the local Studio's Auth > Users > "Add user" UI, or supabase-js signUp():
#   emferrari@gmail.com          (will become owner)
#   admin.test@example.invalid   (admin role, for RLS tests)
#   auditor.test@example.invalid (auditor role, for RLS tests)
#   roleless.test@example.invalid (no role at all, for RLS negative tests)

npx supabase db execute -f scripts/bootstrap_owner_role.sql
# Then grant admin/auditor roles to the other test users with direct INSERTs into
# lottery_admin_roles as the owner (or via SQL editor), since the RPCs to manage roles beyond
# bootstrap were not built in this pass — see POWERBALL_ADMIN_ARCHITECTURE.md open items.
```

## 4. Run the real test suite against this instance

```bash
cd bolao/loterias/powerball
export SUPABASE_URL="http://127.0.0.1:<port from supabase start>"
export SUPABASE_ANON_KEY="<anon key from supabase start>"
export TEST_OWNER_EMAIL=emferrari@gmail.com TEST_OWNER_PASSWORD=<the password you set>
export TEST_ADMIN_EMAIL=admin.test@example.invalid TEST_ADMIN_PASSWORD=<...>
export TEST_AUDITOR_EMAIL=auditor.test@example.invalid TEST_AUDITOR_PASSWORD=<...>
export TEST_ROLELESS_EMAIL=roleless.test@example.invalid TEST_ROLELESS_PASSWORD=<...>

node tests/no_localstorage_test.mjs        # already passes without a live instance
node tests/sessionstorage_scope_test.mjs   # already passes without a live instance
node tests/rls_negative_test.mjs           # requires the env vars above
node tests/audit_chain_test.mjs            # requires the env vars above
```

Expect all four to print `PASS: ...` and exit 0 if the schema/RLS/RPCs are correct. Any
`FAIL:` line names the specific assertion that broke — do not proceed to a production migration
until all four pass for real.

## 5. Point the admin UI at this instance (local testing only)

Before opening `bolao/loterias/powerball/admin/index.html` in a browser, set the two globals it
reads (e.g. add a small local-only `<script>` block, never commit real credentials):

```html
<script>
  window.POWERBALL_SUPABASE_URL = "http://127.0.0.1:<port>";
  window.POWERBALL_SUPABASE_ANON_KEY = "<anon key>";
</script>
```

Then serve the app locally (`python3 -m http.server 8080` from repo root) and open
`http://localhost:8080/bolao/loterias/powerball/admin/`.

## 6. Tear down

```bash
npx supabase stop
```

## Rollback (for a real deployed project, not this sandbox)

```bash
# Revert application code:
git revert <commit> && git push
# Revert schema (never DROP in place on a project with real data — add a new migration that
# reverses the specific change, e.g. re-adding a dropped column as nullable, disabling a new
# trigger). Full destructive rollback of 001-004 should only be done on a project that has
# never received real writes.
```

## Common operations (once wired to a real project — not yet exercised here)

- **New participant**: Admin > Participantes > "Novo participante" → prompts for name/email/
  phone/reason → calls `admin_create_participant` → row appears after re-fetch → audit row
  created with `action_type = 'create_participant'`.
- **Archive a participant**: same screen, "Arquivar" button per row → prompts for reason → calls
  `admin_archive_participant` with the row's current `version` → on version mismatch, shows
  "Este registro foi alterado por outro processo. Recarregue os dados antes de continuar." and
  reloads the list rather than overwriting silently.
- **Recovering from a stuck email job / reversing a payment / publishing tickets**: RPCs exist
  (`admin_retry_email`, `admin_reverse_payment`, `admin_publish_tickets`) but have no UI screen
  yet — call them directly via the Supabase client console/Studio's RPC tester as an interim
  measure, always with a real reason string, until the corresponding admin screens are built.

## Incidents

If `verify_powerball_audit_chain()` ever returns `valid = false`: stop making further admin
mutations, capture `first_broken_audit_id`, and treat it as a security incident — see the
"Known limitation" section of POWERBALL_ADMIN_AUDIT.md for what this can and cannot mean.
