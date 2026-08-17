# RLS test suite — proposal (not yet runnable in this repo)

This directory is a **proposal**, produced by the 2026-08-02 read-only security review. There is
no local Supabase instance in this environment, so nothing here has been executed against a real
database. Nothing here was run against the production project
(`cmhqkkfczotdnssupkni.supabase.co`) either — only passive `GET` requests were made during the
review itself, documented in `docs/bolao/security/SUPABASE_SECURITY_REVIEW.md`.

## Why this exists

`docs/bolao/security/SUPABASE_SECURITY_REVIEW.md` and
`docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md` found that the RLS
policy on `public.bolao_state` is permissive by design at the row level (any of the 3 known
`id`s) but has no property-level authorization inside the JSON document. That gap should be
covered by an automated regression suite before any RLS policy is ever changed — today there is
none, and policy correctness is verified only by manual testing (per
`bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` step 6: "Open the site in two different browsers
simultaneously...").

## How to actually run this in the future

1. Install the Supabase CLI (`supabase --version`) — not installed in this environment, not
   attempted here (would require `npm`/package installation this task's constraints avoid).
2. `supabase init` in the repo root (or a dedicated subfolder) to scaffold a local Postgres +
   PostgREST stack.
3. `supabase db reset` to apply `supabase/migrations/*.sql` (does not exist yet — the real schema
   currently only lives as documentation in `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md`; a
   prerequisite of actually running this suite is turning that documentation into a versioned
   migration file, which this review did not do — schema/policy changes are out of scope for a
   read-only review).
4. Supabase's own testing framework (`pgTAP`, invoked via `supabase test db`) is the recommended
   runner for the scenarios below — each scenario becomes a `.sql` file under this directory
   asserting on `set local role anon; set local request.jwt.claims = '...';` before running a
   query and checking row counts / error codes.
5. Wire `supabase test db` into a CI workflow (`.github/workflows/`) that runs on any PR touching
   `supabase/migrations/**` — currently no such workflow exists.

## Minimum scenarios (from the security review's task list)

Each row below is a scenario this suite should cover once runnable. "Current status" reflects
what this review could verify *today* without a local Supabase instance — either by the passive
production read test, or by code/policy analysis only (never a live write).

| # | Scenario | Current status (this review) |
|---|---|---|
| 1 | `anon` can `select` only the 3 known competition rows, nothing else in `public` | Confirmed empirically against production (read-only) — see `SUPABASE_SECURITY_REVIEW.md` |
| 2 | `anon` **cannot** alter `state->'results'` for a match that already has an official result, without going through an admin-gated path | **Not enforced today** — policy analysis shows no property-level check exists; not tested live (would require a write) |
| 3 | `anon` **cannot** alter `state->'paid'` for an entry it doesn't own | **Not enforced today** — same reason as #2 |
| 4 | `anon` **cannot** change `cutoffAt`/`phases[].cutoffAt` | **Not enforced today** — same reason |
| 5 | `anon` **cannot** delete another participant's entry (i.e. remove it from `entries[]` without going through `deletedIds` tombstone convention) | **Not enforced by RLS** — only by client convention (`mergeStates()`); a raw API call could still emit a payload without the entry, and RLS would accept the `UPDATE` |
| 6 | A participant can insert their own entry | Confirmed by design/code review (this is the intended, working path) — not re-tested live to avoid a production write |
| 7 | A participant cannot modify a third party's entry fields (name, payer, email, picks) once created | **Not enforced by RLS** — same document-level gap |
| 8 | Admin can alter result/payment/cutoff | True today only because the *client* gates it behind `guardAdmin()` — the database has no concept of "admin" at all (no Supabase Auth in use) |
| 9 | Admin actions are audited | Only client-side, inside the same mutable JSON (`auditLog`) — not database-enforced, not append-only |
| 10 | `service_role` is never used in the browser | Confirmed by static code search — no occurrence of a service_role key anywhere in the repo (code, docs, or git history) |

## What this proposal deliberately does not include

- A working CI pipeline (would require deciding on hosting for a local Supabase instance in
  Actions — out of scope for a read-only review).
- Any actual policy change to make scenarios 2–5 and 7–9 pass — see
  `docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md` for the proposed
  direction; implementing it needs Eduardo's explicit sign-off per
  `docs/bolao/PLATFORM_GOVERNANCE.md` (`SECURITY`/`PLATFORM_SHARED` classification).
