# Powerball Admin — Security

Status legend: **testado e executado** / **validado estaticamente** / **proposto, mas não
executado** (NÃO EXECUTADO).

## Auth (proposto, mas não executado)

Supabase Auth. `admin/js/supabaseClient.js` configures the client with
`auth.storage = window.sessionStorage`, `persistSession: true`, `autoRefreshToken: true`,
`detectSessionInUrl: false` — the session token lives only in sessionStorage, never
localStorage, and is gone when the tab closes. This was grep-tested for real (testado e
executado — `tests/sessionstorage_scope_test.mjs` output attached in the test plan).

Initial admin: `emferrari@gmail.com`, granted the `owner` role via
`scripts/bootstrap_owner_role.sql`, a standalone SQL script run once by a human with direct DB
access — never something the frontend can grant to itself. This directly addresses the
bootstrap problem: without this script, no first owner could ever be created, since every RPC
requires an existing role to call.

## Authorization boundary (proposto, mas não executado)

Every authorization decision is server-side:
- `lottery_current_role()` (SQL function, `002_rls.sql`) resolves the caller's active role from
  `lottery_admin_roles` keyed by `auth.uid()` — never a frontend-supplied email or role string.
- RLS policies gate all SELECTs; there are zero INSERT/UPDATE/DELETE policies for any
  role on any primary table — writes are RPC-only.
- Every `admin_*` RPC is `SECURITY DEFINER` with `SET search_path = public` (prevents search-path
  hijacking) and begins by re-checking `lottery_current_role()` itself — it does not trust that
  the caller reaching the function at all implies authorization, because Postgres would let any
  authenticated role call a SECURITY DEFINER function that grants EXECUTE to it. The explicit
  `if lottery_current_role() not in (...) then raise exception` check inside every RPC is what
  actually enforces this, not just naming a function "admin_*".

## Roles

`owner` / `admin` / `auditor` (`lottery_role` enum). Auditor is read-only everywhere: RLS grants
`SELECT` to `('owner','admin','auditor')` uniformly, and no RPC includes `auditor` in its allowed
list, so an auditor session can never reach a write path even if it discovers an RPC name.

## Logout (validado estaticamente)

`admin/js/auth.js`'s `signOut()`: calls `supabase.auth.signOut()`, then `window.sessionStorage.clear()`
as defense in depth, clears `window.PowerballAdmin.state`, and redirects to the login route. No
operational data should exist client-side at this point regardless, since screens never cache
beyond render (see "no client cache" rule in POWERBALL_ADMIN_ARCHITECTURE.md).

## Storage (proposto, mas não executado — not yet created as an actual bucket)

Design: a private Supabase Storage bucket `powerball-private` for comprovantes/PDF/CSV/JSON.
Never public. Admin access via the authenticated client; participant-facing access via email
attachment or a signed URL with an expiration — never a bare public URL, and never a
localhost/example.invalid/empty/internal path sent to a real recipient (same discipline as the
bug already found and fixed in `powerball-email-professionalization`). This bucket has not been
created in any Supabase project in this pass — it is a design decision recorded here, to be
created via the Supabase dashboard/CLI when a real project is available, and documented in the
runbook (POWERBALL_ADMIN_OPERATIONS.md).

## service_role (testado e executado — grep check)

Real grep, real output — `service_role` appears exactly once in the whole admin tree, and it is
a comment, not a key or a usage:

```
$ grep -rn "service_role" bolao/loterias/powerball/admin/
bolao/loterias/powerball/admin/js/supabaseClient.js:10:// remain the anon key only — never the service_role key — per the platform's hard rule.
```

No actual `service_role` key value, variable holding one, or API call using one exists anywhere.
Only the anon key is referenced (`admin/js/supabaseClient.js`), and it is left unset (empty
string default) rather than hardcoded to any real project's key.

## Known limitation, stated honestly

The audit log (see POWERBALL_ADMIN_AUDIT.md) is tamper-evident, not tamper-proof against a full
database superuser / anyone holding the `service_role` key with direct SQL access — such an
actor could in principle rewrite rows and recompute the hash chain. This is a Postgres-level
limitation of any DB-resident audit log and is stated here explicitly rather than implied to be
stronger than it is.
