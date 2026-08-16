--
-- 20260816010000_..._again.rollback.sql
--
-- Reaplica o corpo APLICADO de `20260813180000`, verbatim: o payload do evento volta a levar so
-- `entryId`, `savedAt` e `picksVersion`.
--
-- ⚠ EFEITO DE REVERTER: o consumidor de producao exige `payload.snapshot` e passa a falhar
-- permanente com `payload_sem_snapshot` em todo save de quem tenha `cdb_confirmation_allowance`.
-- Isto e o comportamento anterior, nao um efeito colateral do rollback -- e a razao de a migracao
-- existir.

begin;

CREATE OR REPLACE FUNCTION public.cdb_save_my_picks(p_token text, p_client_ref text, p_picks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id text;
  v_state    jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_cutoff   timestamptz;
  v_fase     text;
  v_agora    timestamptz := now();
  v_versao   text;
begin
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_save_my_picks: client_ref obrigatorio (idempotencia)';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_save_my_picks: picks precisa ser objeto';
  end if;
  if length(p_picks::text) > 20000 then
    raise exception 'cdb_save_my_picks: picks grande demais';
  end if;

  v_entry_id := _cdb_entry_id_from_token(p_token);
  if v_entry_id is null then
    raise exception 'ACESSO_NEGADO';
  end if;

  -- ── WRITE_CUTOVER: NORMALIZED IS THE INPUT AUTHORITY ─────────────────────────────────────
  -- Was: `select state into v_state from bolao_state ... for update`, which made the LEGACY
  -- document the input this function computed from -- and therefore the authority. The row lock
  -- is kept unchanged: it is what serialises concurrent saves against schedule syncs, and it
  -- still guards the compatibility write below.
  --
  -- The state now comes from bolao.cdb_authoritative_document(): the normalized model rendered in
  -- legacy shape, with the four things normalized does not model (auditLog, meta, phase
  -- scheduleProvenance, per-entry private fields and unregistered residue picks) preserved from
  -- the legacy document rather than dropped. Structure proven leaf-for-leaf identical: 1591
  -- leaves, 0 missing, 0 extra.
  perform 1 from bolao_state where id = 'cdb2026' for update;
  v_state := bolao.cdb_authoritative_document();
  if v_state is null then
    raise exception 'ACESSO_NEGADO';
  end if;
  if coalesce(v_state->'deletedIds','[]'::jsonb) ? v_entry_id then
    raise exception 'ACESSO_NEGADO';
  end if;

  select ord - 1, e into v_idx, v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
   where e->>'id' = v_entry_id
   limit 1;
  if v_entry is null then
    raise exception 'ACESSO_NEGADO';
  end if;

  -- NENHUM EVENTO PARA SAVE QUE NAO GRAVOU NADA. Os dois ramos abaixo saem ANTES do UPDATE e
  -- antes da criacao da obrigacao. O comprovante confirma um estado gravado novo, nao um clique
  -- no botao Salvar.
  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente');
  end if;

  if coalesce(v_entry->'picks','null'::jsonb) is not distinct from coalesce(p_picks,'null'::jsonb) then
    return jsonb_build_object('updated', false, 'reason', 'identico');
  end if;

  v_fase := nullif(v_state->'espnSync'->>'activePhaseId','');
  if v_fase is null then
    raise exception 'FASE_FECHADA: nenhuma fase ativa declarada';
  end if;

  begin
    v_cutoff := nullif(v_state->'phases'->v_fase->>'cutoffAt','')::timestamptz;
  exception when others then
    raise exception 'CUTOFF_ILEGIVEL: fase % tem cutoffAt invalido', v_fase;
  end;

  if v_cutoff is null then
    raise exception 'FASE_FECHADA: fase % ainda nao tem prazo oficial publicado', v_fase;
  end if;
  if v_agora >= v_cutoff then
    raise exception 'CUTOFF_PASSADO: fase % fechou em %', v_fase, v_cutoff;
  end if;

  v_entry := v_entry
    || jsonb_build_object('picks', p_picks)
    || jsonb_build_object('updatedAt', to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || jsonb_build_object('lastClientRef', p_client_ref);

  update bolao_state
     set state = jsonb_set(state, array['entries', v_idx::text], v_entry),
         updated_at = v_agora
   where id = 'cdb2026';

  -- ─── NORMALIZED WRITE MIRROR (20260813140000, stamp added 20260813150000) ──────────────────
  --
  -- Same transaction as the legacy UPDATE above. Legacy remains the write AUTHORITY; this keeps
  -- the normalized read model from going stale the moment a participant saves.
  --
  -- NO exception handler, deliberately. Catching here would produce a committed legacy write
  -- beside a stale normalized model — the exact silent divergence the mirror exists to prevent.
  --
  -- v_agora is passed rather than re-read: the mirror must record the SAME instant the legacy
  -- entry was stamped with, not the instant the mirror happened to run.
  perform bolao.cdb_mirror_entry_picks(
            (select pe.pool_entry_id
               from bolao.pool_entries pe
               join bolao.pools pl on pl.pool_id = pe.pool_id and pl.slug = 'cdb2026'
              where pe.legacy_entry_id = v_entry_id::uuid),
            p_picks, v_agora);

  -- ── A OBRIGACAO, IDENTIFICADA PELA VERSAO GRAVADA ─────────────────────────────────────────
  --
  -- Forma canonica por LISTA DE PERMISSAO: so `matches` e `qualified` entram. Campo transitorio
  -- que apareca no payload amanha fica de fora sem ninguem precisar proibi-lo, e token/endereco/
  -- PII nunca entram porque nunca estao aqui.
  --
  -- O hash sai do `jsonb`, que ja e canonico: chaves ordenadas, sem espaco em branco, numeros
  -- normalizados. Mesma previsao escrita em outra ordem de propriedades da o MESMO hash.
  if exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = v_entry_id) then
    -- UMA definicao de versao, compartilhada com o teste. Ver `cdb_picks_version` acima.
    v_versao := public.cdb_picks_version(p_picks);

    insert into bolao.outbox_events (idempotency_key, channel, event_type, payload)
    values ('cdb2026:entry-saved-confirmation:' || v_entry_id || ':' || v_versao || ':v1',
            'email',
            'cdb2026.entry_saved_confirmation',
            -- `picksVersion` e hash, nao conteudo: o consumidor precisa dele para montar a chave
            -- de entrega, e um hash nao reidrata palpite nem identifica pessoa.
            jsonb_build_object('entryId', v_entry_id, 'savedAt', v_agora,
                               'picksVersion', v_versao))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('updated', true);
end $function$;

revoke all on function public.cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function public.cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;

commit;

select 'cdb_save_my_picks revertida ao corpo de 20260813180000 (sem snapshot)' as resultado;
