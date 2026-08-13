--
-- PROVENANCE: POST_FORENSIC_CLOSURE_20260813 · §9-§10 · class SECURITY
--
-- 20260813220000_cdb_update_entry_picks_fail_closed.sql
--
-- ═══ A LEGACY-AUTHORITY WRITER THAT SURVIVED THE CUTOVER ═════════════════════════════════════
--
-- `public.cdb_update_entry_picks(text,text,jsonb)` was superseded by `cdb_save_my_picks` on
-- 2026-08-11 (`7719b45d`), after it was found accepting the victim's entry id as a parameter. It
-- was revoked from `anon` and `authenticated` then, and left executable by `service_role`.
--
-- The forensic audit classified it `REACHABLE_BUT_UNUSED` rather than `DEAD_WITH_PROOF` and
-- deliberately did not drop it. This migration answers the question that classification left open:
-- **can it, if invoked today, produce a mutation that bypasses normalized authority?**
--
-- Measured against the live definition, comments stripped:
--
--     reads    `select state into v_state from bolao_state where id = 'cdb2026' for update`   LEGACY
--     writes   `update bolao_state ... jsonb_set(entries[idx])`                               LEGACY
--     mirrors  `bolao.cdb_mirror_entry_picks`                                                 ABSENT
--     reads    `bolao.cdb_authoritative_document()`                                           ABSENT
--
-- So: **yes.** One `service_role` call writes a participant's picks into the legacy document, with
-- the cutoff validated from that same legacy document, and `bolao.predictions` never hears about
-- it. That is legacy write authority inside a domain whose four live writers were inverted to
-- normalized on 2026-08-13 — the divergence with no error and no symptom until someone reads the
-- normalized model and finds it stale.
--
-- ═══ NO CALLER LOSES ANYTHING ════════════════════════════════════════════════════════════════
--
-- Every reference on `origin/main` was examined:
--
--   `bolao/cdb2026/scripts/secure_access_canary.py:227`            calls it **as anon**, asserting
--                                                                  401/403 + "permission denied"
--   `bolao/cdb2026/scripts/test_public_projection_and_submit.py`   calls it **as anon** in three
--     (:106, :155)                                                 negative tests, asserting refusal
--   `bolao/shared/sql/025_*.sql`, two adopted baselines, one doc    definition and history only
--   `.github/**`                                                    **no reference at all**
--
-- Both scripts assert that the call is DENIED. Neither invokes it with `service_role`. Revoking
-- that grant changes nothing they observe, and there is no cron, workflow, operator CLI or database
-- function that calls it — `pg_get_functiondef` across `public`, `bolao` and `audit` finds no
-- caller.
--
-- ═══ WHY REVOKE AND NOT DROP ═════════════════════════════════════════════════════════════════
--
-- The function is evidence. It is the artifact of a real vulnerability and of its supersession, and
-- the forensic audit rules on it as a source record with a disposition. Dropping it here would
-- destroy that record to make a matrix cleaner, and would do so *before* legacy retirement, where
-- the decision actually belongs.
--
-- Revoking `service_role` leaves the definition, the comments and the history intact while removing
-- every effective execution path. The owner (`postgres`) keeps EXECUTE, so a deliberate operator
-- action can still reach it; a scheduled job or a compromised service key cannot.
--
-- **Reversal is one statement**, printed here so it never has to be reconstructed:
--
--     grant execute on function public.cdb_update_entry_picks(text, text, jsonb) to service_role;
--
-- This migration touches no row of any table.
--

begin;

revoke execute on function public.cdb_update_entry_picks(text, text, jsonb) from service_role;

-- belt and braces: these were already revoked on 2026-08-12 (ledger 20260812070000) and are
-- re-asserted because a grant that came back would be the thing this migration exists to stop.
revoke execute on function public.cdb_update_entry_picks(text, text, jsonb) from anon, authenticated, public;

do $$
declare
  v_def text;
begin
  -- the function must still exist: this is a fail-close, not a removal
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'cdb_update_entry_picks') then
    raise exception 'cdb_update_entry_picks was dropped — this migration must preserve it';
  end if;

  -- no browser or service role may execute it any more
  if has_function_privilege('anon',          'public.cdb_update_entry_picks(text,text,jsonb)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.cdb_update_entry_picks(text,text,jsonb)', 'EXECUTE')
  or has_function_privilege('service_role',  'public.cdb_update_entry_picks(text,text,jsonb)', 'EXECUTE')
  or has_function_privilege('public',        'public.cdb_update_entry_picks(text,text,jsonb)', 'EXECUTE') then
    raise exception 'cdb_update_entry_picks is still executable by a non-owner role';
  end if;

  -- the four live writers are untouched and still normalized-authoritative
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('cdb_save_my_picks','cdb_apply_operator_mutation',
                           'cdb_register_bracket_topology','cdb_refresh_topology_provenance')
         and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
             like '%cdb_authoritative_document%') <> 4 then
    raise exception 'a cdb2026 writer is no longer normalized-authoritative';
  end if;

  -- and no OTHER function writes bolao_state without mirroring: the bypass census must stay at 0
  select string_agg(p.proname, ', ') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'update\s+bolao_state'
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') not like '%cdb_mirror%'
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') not like '%cdb_authoritative_document%'
     and p.proname <> 'cdb_update_entry_picks'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if v_def is not null then
    raise notice 'CDB_LEGACY_WRITE_CANDIDATES (review, not all are cdb2026): %', v_def;
  end if;
end $$;

commit;
