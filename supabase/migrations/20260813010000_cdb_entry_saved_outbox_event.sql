-- 20260813010000_cdb_entry_saved_outbox_event.sql
--
-- ═══ COMPROVANTE DE ENTRADA SALVA, DO LADO DO SERVIDOR ═══════════════════════════════════════
--
-- O comprovante saia do NAVEGADOR (`queueReceipt()` -> EmailJS). Dois motivos pelos quais aquele
-- caminho nao volta:
--
--   1. `cdb_my_entry` NAO devolve `participantEmail` -- de proposito. Essa omissao e a correcao
--      de PII deste incidente. Devolver o endereco para o cliente poder enderecar o e-mail
--      desfaria exatamente o que foi consertado.
--   2. O caminho seguro que passou a existir retorna antes de `queueReceipt`, entao na pratica
--      nenhum participante recebia comprovante desde 12/08.
--
-- A correcao certa nao e reexpor o e-mail: e o servidor mandar. Aqui nasce a OBRIGACAO; quem
-- resolve o destinatario e envia e o consumidor confiavel, com service_role.
--
-- ═══ POR QUE DENTRO DE `cdb_save_my_picks` ═══════════════════════════════════════════════════
--
-- Este e o outbox transacional de verdade: o UPDATE dos palpites e o INSERT do evento acontecem
-- na MESMA transacao. Ou os dois valem, ou nenhum. Nao existe a janela em que o palpite foi
-- gravado e a obrigacao de avisar se perdeu -- que e o modo de falha que o outbox existe para
-- eliminar, e que aqui o banco resolve de graca.
--
-- Se o save falhar por qualquer motivo (prazo, acesso, payload), a transacao inteira volta e
-- NENHUM evento existe. providerCalls = 0 sem precisar de codigo defensivo.
--
-- ═══ IDENTIDADE DE NEGOCIO ═══════════════════════════════════════════════════════════════════
--
--     cdb2026:entry-saved-confirmation:<entryId>:v1
--
-- Deriva da ENTRADA, nao do relogio nem de uuid. Salvar dez vezes nao gera dez avisos: o
-- `on conflict do nothing` na chave de idempotencia transforma repeticao em no-op. Chave com
-- timestamp faria de cada retry uma notificacao nova -- foi assim que o operador levou quatro
-- e-mails hoje.
--
-- ═══ O PAYLOAD NAO CARREGA ENDERECO ══════════════════════════════════════════════════════════
--
-- So o `entryId`. O destinatario e resolvido pelo consumidor confiavel, lendo a linha crua com
-- service_role. Endereco em payload de fila seria PII em repouso num lugar novo, e um parametro
-- que alguem poderia querer "so ajustar" mais tarde.
--
-- ═══ A PERMISSAO CONTINUA MANDANDO ═══════════════════════════════════════════════════════════
--
-- Sem linha em `cdb_confirmation_allowance` para aquela entrada, NENHUM evento e criado. A tabela
-- nasceu vazia; hoje ela libera exatamente uma entrada, para uma validacao unica.
--
-- ROLLBACK: reaplicar o corpo de 20260812170000 (que e identico a este, menos o bloco final).

create or replace function cdb_save_my_picks(
  p_token      text,
  p_client_ref text,
  p_picks      jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_entry_id text;
  v_state    jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_cutoff   timestamptz;
  v_fase     text;
  v_agora    timestamptz := now();
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

  select state into v_state from bolao_state where id = 'cdb2026' for update;
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

  -- ── A OBRIGACAO DE AVISAR, NA MESMA TRANSACAO DO SALVAMENTO ────────────────────────────────
  --
  -- Depois do UPDATE, de proposito: so ha o que confirmar se houve o que gravar. E dentro da
  -- mesma transacao, tambem de proposito: se qualquer coisa abaixo falhar, o palpite volta atras
  -- junto com o evento, e nao sobra obrigacao orfa nem palpite sem aviso.
  if exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = v_entry_id) then
    insert into bolao.outbox_events (idempotency_key, channel, event_type, payload)
    values ('cdb2026:entry-saved-confirmation:' || v_entry_id || ':v1',
            'email',
            'cdb2026.entry_saved_confirmation',
            -- SEM endereco: so a identidade da entrada. Quem resolve destinatario e o consumidor.
            jsonb_build_object('entryId', v_entry_id, 'savedAt', v_agora))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('updated', true);
end $$;

revoke all on function cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;

select 'cdb_save_my_picks cria o evento de comprovante na MESMA transacao' as resultado;
