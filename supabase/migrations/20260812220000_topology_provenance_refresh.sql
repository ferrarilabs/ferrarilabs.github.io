--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812220000_topology_provenance_refresh.sql
--
-- Re-registrar a MESMA topologia com proveniencia melhor documentada deve ATUALIZAR a
-- proveniencia, nao virar no-op.
--
-- POR QUE: `topologyProvenanceIsValid()` no app exige os campos
-- ["authority", "source", "ingestedAt", "validatedAt"]. O primeiro registro trouxe `sourceUrl`,
-- `sources` e `channel` -- mas nao `source`. Sem ele o app trata a topologia como NAO validada e
-- a tela continua dizendo que o chaveamento nao saiu, com a topologia gravada logo ali.
--
-- Como as vagas sao identicas, a versao anterior devolvia no-op e nao havia caminho para
-- corrigir o registro sem apagar e regravar -- e apagar chaveamento oficial e exatamente o que
-- nao se quer poder fazer.
--
-- O QUE CONTINUA PROIBIDO: mudar as VAGAS depois de registradas. Proveniencia descreve de onde o
-- fato veio; vaga E o fato. Trocar a primeira e corrigir documentacao, trocar a segunda
-- reescreveria o significado dos palpites de quem ja palpitou.

create or replace function public.cdb_refresh_topology_provenance(
  p_phase_id   text,
  p_slots      jsonb,
  p_provenance jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_state jsonb;
  v_atual jsonb;
  v_iso   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if coalesce(p_provenance->>'authority','') <> 'CBF' then
    raise exception 'TOPOLOGY_PROVENANCE: authority deve ser CBF';
  end if;
  if coalesce(p_provenance->>'source','') = '' then
    raise exception 'TOPOLOGY_PROVENANCE: campo `source` obrigatorio (o app exige)';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  v_atual := v_state->'phases'->p_phase_id->'topology'->'slots';
  if v_atual is null then
    raise exception 'TOPOLOGY_AUSENTE: registre a topologia antes de refrescar a proveniencia';
  end if;
  -- As VAGAS tem de ser identicas. Esta funcao documenta; nao rechaveia.
  if v_atual <> p_slots then
    raise exception 'TOPOLOGY_SLOTS_DIFEREM: esta funcao so atualiza proveniencia';
  end if;

  v_state := jsonb_set(v_state, array['phases', p_phase_id, 'topology', 'provenance'],
                       p_provenance || jsonb_build_object('refreshedAt', v_iso), true);
  update bolao_state set state = v_state, updated_at = now() where id = 'cdb2026';
  return jsonb_build_object('refreshed', true, 'phaseId', p_phase_id);
end;
$$;

revoke all on function public.cdb_refresh_topology_provenance(text,jsonb,jsonb) from public;
revoke all on function public.cdb_refresh_topology_provenance(text,jsonb,jsonb) from anon;
revoke all on function public.cdb_refresh_topology_provenance(text,jsonb,jsonb) from authenticated;
grant execute on function public.cdb_refresh_topology_provenance(text,jsonb,jsonb) to service_role;

select 'refresh de proveniencia criado (vagas imutaveis)' as resultado;
