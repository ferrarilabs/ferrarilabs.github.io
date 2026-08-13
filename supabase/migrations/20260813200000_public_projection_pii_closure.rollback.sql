--
-- PROVENANCE: FINAL_DATA_CERTIFICATION_20260813 · rollback of 20260813200000
--
-- Restores the two F10-era view definitions verbatim, as captured from production
-- `pg_get_viewdef()` on 2026-08-13 before the PII closure was applied.
--
-- Applying this rollback RE-EXPOSES copa2026's auditLog (email, ip, userAgent, screen, platform,
-- lang across 19 records) and entries[].diagnostics (21 records) to any holder of the browser's
-- publishable key. It exists so the change is reversible, not because reverting is safe.
--

begin;

create or replace view public.bolao_state_public as
  select
    id,
    case
      when state ? 'entries' then
        jsonb_set(state, '{entries}', coalesce((
          select jsonb_agg(t.e - 'participantEmail' - 'payerName' - 'paymentMethod' - 'paymentTo'
                           order by t.ord)
          from jsonb_array_elements(s.state -> 'entries') with ordinality t(e, ord)
        ), '[]'::jsonb))
      else state
    end as state,
    updated_at
  from public.bolao_state s;

create or replace view public.bolao_state_public_cdb as
  select
    id,
    jsonb_set(state, '{entries}', coalesce((
      select jsonb_agg(t.e - 'participantEmail' - 'payerName' - 'paymentMethod' - 'txId'
                       order by t.ord)
      from jsonb_array_elements(coalesce(s.state -> 'entries', '[]'::jsonb)) with ordinality t(e, ord)
    ), '[]'::jsonb)) as state
  from public.bolao_state s
  where id = 'cdb2026';

commit;
