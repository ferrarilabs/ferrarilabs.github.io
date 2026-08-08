# Powerball — Proposed Data Model

**Not applied anywhere.** These are proposed migrations for review, corrected against the flaws
found in `POWERBALL_SECURITY_REVIEW.md`. Current production has none of this — `js/data.js` is the
only source of truth today (see `POWERBALL_CURRENT_ARCHITECTURE.md`).

## Why change

- `data.js` requires a git commit (and thus repo write access) for every participant, payment, or
  ticket change — that's the direct cause of Incident 3 (no working Admin) having no alternative.
- No admin CRUD is possible without a real backend to write to — a static file committed to git
  cannot be safely written to from a browser.
- `localStorage`-based results (Incidents 1/2) need a shared, server-visible place to land instead.

## Tables

```sql
-- ── lottery_pools ────────────────────────────────────────────────────────────
-- One row per lottery game type this platform runs (powerball, megamillions, ...).
-- Mirrors LOTTERY_GAME_TYPES in data.js today.
CREATE TABLE public.lottery_pools (
  id            TEXT PRIMARY KEY,             -- 'powerball', 'megamillions'
  label         TEXT NOT NULL,
  icon          TEXT,
  accent        TEXT,
  accent2       TEXT,
  results_api   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── lottery_draws ────────────────────────────────────────────────────────────
CREATE TABLE public.lottery_draws (
  id                TEXT PRIMARY KEY,          -- e.g. '2026-08-05'
  pool_id           TEXT NOT NULL REFERENCES public.lottery_pools(id),
  jackpot           BIGINT,
  draw_date_iso     TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('draft','open','closed','tickets_published',
                                        'awaiting_result','result_available',
                                        'prizes_calculated','completed','cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── lottery_participants ─────────────────────────────────────────────────────
CREATE TABLE public.lottery_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id       TEXT NOT NULL REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,                          -- nullable: email may arrive after payment (real
                                                 -- case this session: Marcelo M. Pereira paid
                                                 -- before his email was confirmed)
  status        TEXT NOT NULL DEFAULT 'verificado'
                  CHECK (status IN ('organizador','verificado','pendente')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT NOT NULL,                  -- admin identity, for audit
  UNIQUE (draw_id, name)                        -- blocks the exact duplicate-row class of bug
                                                 -- fixed by hand in commit da774b3 this session
);

-- ── lottery_payments ─────────────────────────────────────────────────────────
-- Split out from participants (today they're the same row) so a participant can exist before
-- payment is confirmed, and so payment corrections don't require rewriting participant identity.
CREATE TABLE public.lottery_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL REFERENCES public.lottery_participants(id) ON DELETE CASCADE,
  cotas           INT,
  valor_cents     BIGINT,                        -- cents, not floats — avoids rounding drift
  metodo          TEXT,
  tx_id           TEXT,
  paid_at         TIMESTAMPTZ,
  recorded_by     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, tx_id)                  -- blocks double-recording the same Zelle/Venmo
                                                   -- confirmation twice (Admin Matrix P1 finding)
);

-- ── lottery_tickets ───────────────────────────────────────────────────────────
CREATE TABLE public.lottery_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id       TEXT NOT NULL REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
  serial        TEXT NOT NULL,
  numbers       INT[] NOT NULL,
  special       INT NOT NULL,
  price_cents   BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draw_id, serial, numbers, special)      -- duplicate-ticket detection, spec part 14
);

-- ── lottery_results ───────────────────────────────────────────────────────────
-- One row, written ONCE per draw by the worker after a stability re-check (fixes Incident 2's
-- "two browsers compute two different results" mechanism entirely — there's one row, not one
-- localStorage per browser).
CREATE TABLE public.lottery_results (
  draw_id         TEXT PRIMARY KEY REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
  numbers         INT[] NOT NULL,
  special         INT NOT NULL,
  multiplier      INT,
  checked_at      TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL DEFAULT 'ny-open-data',
  confirmed_stable BOOLEAN NOT NULL DEFAULT false  -- worker sets this only after 2 consecutive
                                                     -- matching fetches, mirroring cdb2026/copa2026's
                                                     -- send_result_email.py pattern
);

-- ── lottery_email_jobs (the outbox) ─────────────────────────────────────────
-- See POWERBALL_EMAIL_RELIABILITY.md for the full design; schema mirrors the local
-- implementation in bolao/loterias/powerball/scripts/lib/email_outbox.mjs exactly, so the same
-- code can run against Postgres later with the same shape.
CREATE TABLE public.lottery_email_jobs (
  email_job_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id              TEXT NOT NULL,
  draw_id              TEXT NOT NULL,
  event_type           TEXT NOT NULL,
  recipient             TEXT NOT NULL,
  template_id           TEXT NOT NULL,
  template_version       TEXT NOT NULL,
  payload_snapshot        JSONB NOT NULL,
  idempotency_key           TEXT NOT NULL UNIQUE,
  status                     TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','sent','failed',
                                                  'cancelled','suppressed')),
  attempt_count               INT NOT NULL DEFAULT 0,
  last_attempt_at               TIMESTAMPTZ,
  sent_at                        TIMESTAMPTZ,
  provider_status                 TEXT,
  provider_message_id               TEXT,
  last_error                          TEXT,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── lottery_email_events / lottery_admin_audit ──────────────────────────────
CREATE TABLE public.lottery_email_events (
  event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_job_id   UUID NOT NULL REFERENCES public.lottery_email_jobs(email_job_id),
  event          TEXT NOT NULL,                 -- 'enqueued'|'attempted'|'sent'|'failed'|'retried'
  detail         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.lottery_admin_audit (
  event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor          TEXT NOT NULL,
  action         TEXT NOT NULL,
  entity         TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  before         JSONB,
  after          JSONB,
  correlation_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## RLS — corrected against the flaws found in the Security Review

```sql
-- Deny by default: enable RLS everywhere, add explicit policies only.
ALTER TABLE public.lottery_pools           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_draws           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_participants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_results         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_email_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_email_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_admin_audit     ENABLE ROW LEVEL SECURITY;

-- Only truly public data gets an anon SELECT policy.
CREATE POLICY pools_public_read  ON public.lottery_pools  FOR SELECT USING (true);
CREATE POLICY draws_public_read  ON public.lottery_draws  FOR SELECT USING (true);
CREATE POLICY tickets_public_read ON public.lottery_tickets FOR SELECT USING (true);
CREATE POLICY results_public_read ON public.lottery_results FOR SELECT USING (true);

-- Participants/payments/audit: admin-only, both read and write. Requires REAL Supabase Auth
-- issuing a JWT with an is_admin claim (service-side, e.g. via a Supabase Edge Function checking
-- a server-held secret) -- NOT the client-side SHA-256 comparison flagged as not-real-auth in the
-- Security Review. No self_select policy: this is a ~14-person private pool among people who
-- know each other, not a system where participants need individual portal access; simplifies the
-- policy surface and removes the "requires auth nothing sets up" flaw from the old draft.
CREATE POLICY participants_admin_all ON public.lottery_participants
  FOR ALL USING (auth.jwt() ->> 'is_admin' = 'true')
  WITH CHECK (auth.jwt() ->> 'is_admin' = 'true');

CREATE POLICY payments_admin_all ON public.lottery_payments
  FOR ALL USING (auth.jwt() ->> 'is_admin' = 'true')
  WITH CHECK (auth.jwt() ->> 'is_admin' = 'true');

-- Audit log: admin reads; INSERT restricted to admin too (fixes the "anyone can forge an audit
-- entry" P0 from the old draft's `WITH CHECK (true)`). Writes should come from a trusted server
-- context (Edge Function / worker service role), not directly from the browser's anon key --
-- this policy is the floor, not the intended write path.
CREATE POLICY audit_admin_read ON public.lottery_admin_audit
  FOR SELECT USING (auth.jwt() ->> 'is_admin' = 'true');
CREATE POLICY audit_admin_insert ON public.lottery_admin_audit
  FOR INSERT WITH CHECK (auth.jwt() ->> 'is_admin' = 'true');
-- No UPDATE/DELETE policy anywhere on this table -- immutability by omission, not a flag.

-- Email jobs/events: admin-only, no anon access at all (contains recipient PII + full HTML
-- payload snapshots).
CREATE POLICY email_jobs_admin_all ON public.lottery_email_jobs
  FOR ALL USING (auth.jwt() ->> 'is_admin' = 'true')
  WITH CHECK (auth.jwt() ->> 'is_admin' = 'true');
CREATE POLICY email_events_admin_all ON public.lottery_email_events
  FOR ALL USING (auth.jwt() ->> 'is_admin' = 'true')
  WITH CHECK (auth.jwt() ->> 'is_admin' = 'true');
```

## Migration plan (not executed)

1. Stand up real Supabase Auth for the single admin identity (magic link to `emferrari@gmail.com`
   is simplest — avoids a second password to manage).
2. Apply the schema above to a **staging** Supabase project first, not production.
3. Backfill `lottery_draws`/`lottery_participants`/`lottery_payments`/`lottery_tickets` from the
   current `data.js` via a one-time script (not written in this branch — flagged in the
   Professionalization Report as its own reviewable step, since it touches real participant data).
4. Cut the admin UI over to read/write Supabase instead of requiring a git commit.
5. Only after 1-4 are live and verified: retire `data.js` as the write path (it can stay as a
   read-only static mirror/fallback if desired — the existing "local-first, Supabase failure
   degrades gracefully" pattern from `cdb2026`/`br2026`/`copa2026` is worth reusing here).

None of this is applied by this branch. `bolao/loterias/powerball/js/data.js` remains the live
source of truth until Eduardo decides to execute this migration.
