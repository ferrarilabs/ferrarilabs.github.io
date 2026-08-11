-- 025_cdb2026_participant_picks.sql — CDB2026: a operacao anonima correta.
--
-- ─── CORRECAO DA MIGRACAO 024 ────────────────────────────────────────────────────────────────
--
-- A 024 criou `submit_cdb_entry`, que CRIA uma inscricao. Este app nao faz isso: o config tem
-- `entryRosterFrozen: true`, e `applyAdminMutation` recusa o ramo de append com
-- ENTRY_ROSTER_FROZEN. Nenhuma inscricao nova pode entrar no CDB2026.
--
-- O que o participante REALMENTE faz (app.js, saveEntry): edita os PALPITES de uma entrada que
-- ja existe. Com o roster congelado o app entra em `frozenSelfServiceEdit` e monta
-- `{ ..._editingEntry, picks, updatedAt }` -- so os palpites mudam; nome, e-mail, pagador e
-- metodo de pagamento sao preservados do registro existente.
--
-- Esta funcao reproduz exatamente esse contrato do lado do servidor. Escrever uma RPC para uma
-- operacao que o app nao executa seria superficie de ataque sem beneficio.
--
-- ─── O QUE ELA NAO PODE FAZER ────────────────────────────────────────────────────────────────
--
-- Nao cria entrada. Nao apaga entrada. Nao toca pagamento, fase, cutoff, confronto, resultado
-- oficial nem sorteio. Nao substitui o documento. Um chamador anonimo hostil, de posse da chave
-- publica que vai em todo config.js, consegue no maximo trocar os palpites de uma entrada cujo
-- id ele ja conheca -- e so antes do cutoff da fase.
--
-- ADITIVA: nenhum revoke aqui. `submit_cdb_entry` da 024 e removida por ser operacao inexistente
-- no produto; nada a consumia.
--
-- ROLLBACK: `drop function cdb_update_entry_picks(text, text, jsonb);`

drop function if exists submit_cdb_entry(text, text, jsonb, jsonb);

create or replace function cdb_update_entry_picks(
  p_entry_id text,
  p_client_ref text,
  p_picks jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
  v_idx int;
  v_entry jsonb;
  v_cutoff timestamptz;
  v_fase text;
  v_agora timestamptz := now();
begin
  -- ── validacao de entrada ──────────────────────────────────────────────
  if p_entry_id is null or length(trim(p_entry_id)) = 0 then
    raise exception 'cdb_update_entry_picks: entry_id obrigatorio';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_update_entry_picks: client_ref obrigatorio (idempotencia)';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_update_entry_picks: picks precisa ser objeto';
  end if;
  -- Teto de tamanho: o palpite e um mapa pequeno de fase->escolha. Qualquer coisa muito maior
  -- e uso indevido, e o estado inteiro do bolao vive numa unica linha jsonb.
  if length(p_picks::text) > 20000 then
    raise exception 'cdb_update_entry_picks: picks grande demais';
  end if;

  -- Bloqueia a linha: duas abas do mesmo participante, ou participante e operador ao mesmo
  -- tempo, nao podem intercalar leitura e escrita sobre o mesmo documento.
  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'cdb_update_entry_picks: estado do cdb2026 inexistente';
  end if;

  -- ── a entrada tem de existir e nao estar removida ─────────────────────
  select ord - 1, e into v_idx, v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
   where e->>'id' = p_entry_id
   limit 1;

  if v_entry is null then
    raise exception 'ENTRY_NOT_FOUND: nenhuma entrada com id %', p_entry_id;
  end if;
  if coalesce(v_state->'deletedIds','[]'::jsonb) ? p_entry_id then
    raise exception 'ENTRY_REMOVED: entrada % foi removida', p_entry_id;
  end if;

  -- ── IDEMPOTENCIA ──────────────────────────────────────────────────────
  -- Clique duplo, retry de rede e reenvio de formulario sao a MESMA edicao. Repetir com o mesmo
  -- client_ref nao e uma segunda edicao.
  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente', 'entryId', p_entry_id);
  end if;

  -- ── CUTOFF, por fase, falha fechada ───────────────────────────────────
  -- Cada fase tem seu proprio cutoffAt. Um palpite so pode mudar enquanto a fase dele estiver
  -- aberta. Cutoff ilegivel bloqueia em vez de liberar: nao saber se ja fechou nao e permissao.
  for v_fase in select jsonb_object_keys(p_picks) loop
    begin
      v_cutoff := nullif(v_state->'phases'->v_fase->>'cutoffAt','')::timestamptz;
    exception when others then
      raise exception 'CUTOFF_ILEGIVEL: fase % tem cutoffAt invalido', v_fase;
    end;
    if v_cutoff is not null and v_agora > v_cutoff then
      -- So bloqueia se o palpite daquela fase MUDOU. Reenviar identico e inofensivo.
      if coalesce(v_entry->'picks'->v_fase, 'null'::jsonb) is distinct from coalesce(p_picks->v_fase, 'null'::jsonb) then
        raise exception 'CUTOFF_PASSADO: fase % fechou em %', v_fase, v_cutoff;
      end if;
    end if;
  end loop;

  -- ── a mutacao, estreita ───────────────────────────────────────────────
  -- Só `picks`, `updatedAt` e `lastClientRef`. Todo o resto da entrada vem do registro que ja
  -- estava la: nome, e-mail, pagador e metodo de pagamento nao sao regravaveis por esta via.
  v_entry := v_entry
    || jsonb_build_object('picks', p_picks)
    || jsonb_build_object('updatedAt', to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || jsonb_build_object('lastClientRef', p_client_ref);

  update bolao_state
     set state = jsonb_set(state, array['entries', v_idx::text], v_entry),
         updated_at = v_agora
   where id = 'cdb2026';

  return jsonb_build_object('updated', true, 'entryId', p_entry_id);
end $$;

revoke all on function cdb_update_entry_picks(text, text, jsonb) from public;
grant execute on function cdb_update_entry_picks(text, text, jsonb) to anon, authenticated, service_role;

select 'cdb_update_entry_picks criada; submit_cdb_entry removida' as resultado;
