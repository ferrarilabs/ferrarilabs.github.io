--
-- PROVENANCE: FINAL_DATA_CERTIFICATION_20260813 · finding G1 · class SECURITY
--
-- 20260813200000_public_projection_pii_closure.sql
--
-- ═══ Q38 WAS VERIFIED AGAINST THE TABLE AND NOT AGAINST THE SANITISERS ═══════════════════════
--
-- The read cutover proved `anon` cannot read `public.bolao_state` (401) and cannot reach the
-- `bolao` schema. Both are true and both remain true. Neither statement covers the two views that
-- were granted to `anon` in F10 and never revisited:
--
--     GET /rest/v1/bolao_state_public?id=eq.main      ->  HTTP 200, 141 872 bytes
--
-- measured 2026-08-13 with the browser's publishable key. That response carried, for copa2026:
--
--     auditLog[]  19 records  ->  email (10 distinct), ip (8), userAgent (5), screen (7),
--                                 platform (4), lang (1)
--     entries[]   21 records  ->  diagnostics.{userAgent, viewport, timezone, capturedAt}
--
-- The view strips exactly four keys — participantEmail, payerName, paymentMethod, paymentTo —
-- from `entries[]`. It was written when those four were the only private fields, and it was never
-- taught about `diagnostics`, which arrived later on the same objects, or about `auditLog`, which
-- is a sibling of `entries` and was therefore never in scope of a projection that only ever
-- rewrote `entries`. A sanitiser that enumerates fields fails silently every time the document
-- grows a new one; that is the same failure mode as the hand-enumerated `mergeStates` base object
-- that lost four cdb2026 fields in a row until it was replaced by a spread.
--
-- ═══ WHY auditLog IS REMOVED WHOLE, AND FROM EVERY POOL ══════════════════════════════════════
--
-- Only copa2026's auditLog carries contact and network data (br2026 and cdb2026 records contain no
-- `@` at all — asserted below). Stripping six named keys out of copa's records would restore the
-- exact defect this migration exists to close: the next diagnostic field added to an audit record
-- would be public on the day it is written.
--
-- Removing the section instead is not a new policy. `AUDITLOG_PUBLIC_PROJECTION = EXCLUDED` is
-- already the platform's published contract: `bolao.read_document()` emits no `auditLog`, and
-- since the read cutover all three browsers read `bolao_state_normalized_public`, which is built
-- from it. This migration makes the legacy projection agree with the contract the applications
-- have actually been served for a day at 0 BUG / 0 UNKNOWN.
--
-- ═══ WHY NOT REVOKE SELECT INSTEAD ═══════════════════════════════════════════════════════════
--
-- Two live readers use these views with the anon key and would break:
--   · bolao/copa2026/scripts/backup_watch_m88.py  — reads `results` only
--   · bolao/br2026/scripts/operator_cli.py        — reads entries to build its masked diff
-- Neither reads `auditLog` or `diagnostics`. Sanitising preserves both readers and removes 100%
-- of the exposure; revoking would remove the exposure and break both.
--
-- ═══ WHAT IS DELIBERATELY LEFT PUBLIC ════════════════════════════════════════════════════════
--
-- `roundEmail` (br2026)   — delivery ledger: entryRef, state, providerMessageId. Contains no `@`
--                           (asserted below). Operational, not personal.
-- `lastClientRef` (cdb)   — idempotency token. Useless without the entry access token, which is
--                           held in `public.cdb_entry_access` as a hash and is not exposed here.
-- `espnSync`, `phases`, `paid`, `results`, `deletedIds` — already in the normalized public
--                           contract; unchanged here.
--
-- No row of `public.bolao_state` is read, written or moved by this migration. It replaces two view
-- definitions and nothing else. Rollback restores both prior definitions verbatim.
--

begin;

create or replace view public.bolao_state_public as
  select
    s.id,
    case
      when s.state ? 'entries' then
        (s.state - 'auditLog') || jsonb_build_object('entries', coalesce((
          select jsonb_agg(
                   t.e - 'participantEmail' - 'payerName' - 'paymentMethod' - 'paymentTo'
                       - 'txId' - 'diagnostics'
                   order by t.ord)
          from jsonb_array_elements(s.state -> 'entries') with ordinality t(e, ord)
        ), '[]'::jsonb))
      else s.state - 'auditLog'
    end as state,
    s.updated_at
  from public.bolao_state s;

create or replace view public.bolao_state_public_cdb as
  select
    s.id,
    (s.state - 'auditLog') || jsonb_build_object('entries', coalesce((
      select jsonb_agg(
               t.e - 'participantEmail' - 'payerName' - 'paymentMethod' - 'paymentTo'
                   - 'txId' - 'diagnostics'
               order by t.ord)
      from jsonb_array_elements(coalesce(s.state -> 'entries', '[]'::jsonb)) with ordinality t(e, ord)
    ), '[]'::jsonb)) as state
  from public.bolao_state s
  where s.id = 'cdb2026';

-- ── assertions ───────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_pii   int;
  v_ents  int;
  v_at    int;
begin
  -- no PII-bearing key survives in either projection
  select count(*) into v_pii
  from public.bolao_state_public v
  where v.state ? 'auditLog'
     or exists (select 1 from jsonb_array_elements(coalesce(v.state->'entries','[]'::jsonb)) e
                where e.value ?| array['participantEmail','payerName','paymentMethod','paymentTo',
                                       'txId','diagnostics']);
  if v_pii <> 0 then raise exception 'bolao_state_public still projects private fields (% rows)', v_pii; end if;

  select count(*) into v_pii
  from public.bolao_state_public_cdb v
  where v.state ? 'auditLog'
     or exists (select 1 from jsonb_array_elements(coalesce(v.state->'entries','[]'::jsonb)) e
                where e.value ?| array['participantEmail','payerName','paymentMethod','paymentTo',
                                       'txId','diagnostics']);
  if v_pii <> 0 then raise exception 'bolao_state_public_cdb still projects private fields'; end if;

  -- no '@' anywhere in either projection
  select count(*) into v_at from public.bolao_state_public v where v.state::text like '%@%';
  if v_at <> 0 then raise exception 'bolao_state_public still contains an address-shaped value'; end if;
  select count(*) into v_at from public.bolao_state_public_cdb v where v.state::text like '%@%';
  if v_at <> 0 then raise exception 'bolao_state_public_cdb still contains an address-shaped value'; end if;

  -- entry counts are unchanged: this is a projection change, never a data change
  select count(*) into v_ents
  from public.bolao_state s
  join public.bolao_state_public v on v.id = s.id
  where jsonb_array_length(coalesce(s.state->'entries','[]'::jsonb))
     <> jsonb_array_length(coalesce(v.state->'entries','[]'::jsonb));
  if v_ents <> 0 then raise exception 'entry count changed in projection (% pools)', v_ents; end if;

  -- the sections the readers actually use survive
  if (select count(*) from public.bolao_state_public where id='main' and state ? 'results') <> 1 then
    raise exception 'copa results no longer projected — backup_watch_m88.py would break';
  end if;
  if (select count(*) from public.bolao_state_public where id='br2026' and state ? 'roundEmail') <> 1 then
    raise exception 'br2026 roundEmail no longer projected — operator_cli.py context lost';
  end if;
end $$;

commit;
