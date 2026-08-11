-- 024_cdb2026_public_projection.sql — CDB2026 Stage 4, etapa ADITIVA.
--
-- ─── ONDE O CDB2026 ESTA HOJE ────────────────────────────────────────────────────────────────
--
-- Igual ao que o BR2026 era antes do F10/N22:
--   LEITURA : `bolao_state` cru, com os campos privados de cada inscrito
--   ESCRITA : documento INTEIRO via upsert `merge-duplicates`, com a anon key
--
-- A anon key vai dentro de `js/config.js`, servido a todo navegador. Qualquer portador pode
-- hoje reescrever inscritos, pagamentos, chaveamento e resultados oficiais de uma vez so. As
-- policies confirmam: anon tem INSERT e UPDATE em bolao_state.
--
-- Descoberta contra o codigo ATUAL (nao contra o handoff): as 17 chamadas a saveState do CDB
-- NAO carregam rotulo de operacao -- diferente do BR2026. Nao existe, hoje, uma lista de
-- mutacoes nomeadas para traduzir em RPCs; existe um upsert de documento inteiro. O inventario
-- de nomes que circulava em handoff (set-cutoff, batch, unlock-tie, ...) nao corresponde a este
-- arquivo.
--
-- ─── ESTA MIGRACAO E ADITIVA E INERTE ────────────────────────────────────────────────────────
--
-- Cria a projecao publica e a submissao estreita. NAO revoga nada, NAO altera policy, e o app
-- deployado continua funcionando exatamente como antes. A revogacao vem depois da prova de que
-- o consumidor deployado usa o caminho novo -- nunca antes.
--
-- ROLLBACK: `drop view bolao_state_public_cdb; drop function submit_cdb_entry(...);`
--           Nada mais depende delas ate o corte.

-- ── PROJECAO PUBLICA ─────────────────────────────────────────────────────────────────────────
-- Mesma forma do documento, sem os campos privados de cada inscrito. O que sai daqui pode ser
-- servido a um navegador sem revelar contato nem dado de pagamento de ninguem.
create or replace view bolao_state_public_cdb as
select
  s.id,
  jsonb_set(
    s.state,
    '{entries}',
    coalesce((
      select jsonb_agg(
               e - 'participantEmail' - 'payerName' - 'paymentMethod' - 'txId'
               order by ord)
        from jsonb_array_elements(coalesce(s.state->'entries','[]'::jsonb))
             with ordinality as t(e, ord)
    ), '[]'::jsonb)
  ) as state
from bolao_state s
where s.id = 'cdb2026';

grant select on bolao_state_public_cdb to anon, authenticated, service_role;

-- ── SUBMISSAO PUBLICA ESTREITA ───────────────────────────────────────────────────────────────
-- A UNICA operacao anonima. Acrescenta uma inscricao; nao substitui estado, nao toca pagamento,
-- nao toca resultado, nao toca fase.
create or replace function submit_cdb_entry(
  p_client_ref text,
  p_name text,
  p_picks jsonb default '{}'::jsonb,
  p_private jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
  v_cutoff timestamptz;
  v_existente jsonb;
  v_nova jsonb;
begin
  -- ── validacao de entrada ──────────────────────────────────────────────
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'submit_cdb_entry: client_ref obrigatorio (idempotencia)';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'submit_cdb_entry: nome obrigatorio';
  end if;
  if length(p_name) > 120 then
    raise exception 'submit_cdb_entry: nome longo demais';
  end if;
  if jsonb_typeof(p_picks) <> 'object' then
    raise exception 'submit_cdb_entry: picks precisa ser objeto';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'submit_cdb_entry: estado do cdb2026 inexistente';
  end if;

  -- ── IDEMPOTENCIA ──────────────────────────────────────────────────────
  -- Clique duplo, reenvio de formulario e retry de rede sao a mesma submissao. O client_ref
  -- decide, nao o nome: duas pessoas homonimas continuam sendo duas inscricoes.
  select e into v_existente
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
   where e->>'clientRef' = p_client_ref
   limit 1;
  if v_existente is not null then
    return jsonb_build_object('created', false, 'entryId', v_existente->>'id');
  end if;

  -- ── CUTOFF ────────────────────────────────────────────────────────────
  -- Fecha fechado: cutoff ilegivel bloqueia a inscricao em vez de liberar.
  v_cutoff := nullif(v_state->>'cutoffIso','')::timestamptz;
  if v_cutoff is not null and now() > v_cutoff then
    raise exception 'submit_cdb_entry: inscricoes encerradas em %', v_cutoff;
  end if;

  v_nova := jsonb_build_object(
    'id',         gen_random_uuid()::text,
    'clientRef',  p_client_ref,
    'name',       trim(p_name),
    'picks',      p_picks,
    'createdAt',  to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source',     'submit_cdb_entry'
  ) || coalesce(p_private, '{}'::jsonb);

  update bolao_state
     set state = jsonb_set(state, '{entries}',
                   coalesce(state->'entries','[]'::jsonb) || jsonb_build_array(v_nova))
   where id = 'cdb2026';

  return jsonb_build_object('created', true, 'entryId', v_nova->>'id');
end $$;

revoke all on function submit_cdb_entry(text, text, jsonb, jsonb) from public;
grant execute on function submit_cdb_entry(text, text, jsonb, jsonb) to anon, authenticated, service_role;

select 'projecao e submissao criadas' as resultado;
