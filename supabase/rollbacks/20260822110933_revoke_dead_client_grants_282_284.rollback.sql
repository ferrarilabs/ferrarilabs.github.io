-- Reversao exata da migracao de mesmo nome (Issues #282/#284).
--
-- Simetrica porque a medicao era simetrica: `anon` e `authenticated` tinham os mesmos sete
-- privilegios na view, e os dois helpers tinham `authenticated` com EXECUTE.
--
-- NAO reconcede `MAINTAIN` (nunca foi revogado) nem SELECT (nunca foi revogado), e nao toca
-- `service_role` nem o dono.

begin;

grant execute on function public._bolao_audit(jsonb, text, jsonb) to authenticated;
grant execute on function public._bolao_touch(jsonb)              to authenticated;

grant insert, update, delete, truncate, references, trigger
  on table public.bolao_state_normalized_public to anon, authenticated;

commit;
