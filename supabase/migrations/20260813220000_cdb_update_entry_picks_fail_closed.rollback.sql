--
-- PROVENANCE: POST_FORENSIC_CLOSURE_20260813 · rollback of 20260813220000
--
-- Restores `service_role` EXECUTE on `public.cdb_update_entry_picks(text,text,jsonb)`.
--
-- Applying this re-opens a legacy-authority write path into `bolao_state.entries[].picks` that
-- does not call `bolao.cdb_mirror_entry_picks` and validates its cutoff from the legacy document.
-- One `service_role` invocation would leave `bolao.predictions` stale with no error raised.
--
-- It exists so the change is reversible. `anon` and `authenticated` are deliberately NOT restored:
-- they were revoked on 2026-08-12 by ledger 20260812070000, for a different and older reason.
--
begin;
grant execute on function public.cdb_update_entry_picks(text, text, jsonb) to service_role;
commit;
