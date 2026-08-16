--
-- 20260816010000_cdb_confirmation_payload_carries_snapshot_again.sql
--
-- ═══ O COMPROVANTE DE PRODUCAO ESTA MUDO DESDE 2026-08-13 ════════════════════════════════════
--
-- `send_entry_saved_confirmation.py` EXIGE `payload.snapshot` e falha permanente sem ele
-- (`failure_category = payload_sem_snapshot`), de proposito: montar o recibo lendo a entrada no
-- momento do consumo produziria um documento com a identidade da versao A e o conteudo da versao
-- B -- pior que nao mandar recibo. Ver 20260813050000, que introduziu o snapshot por esse motivo.
--
-- `20260813180000` (write cutover) reescreveu `cdb_save_my_picks` inteiro a partir do corpo de
-- `20260813030000`, que e ANTERIOR ao snapshot. O snapshot caiu junto -- silenciosamente, porque
-- nenhum teste do cutover olhava o payload do outbox, e porque a emissao do evento so acontece
-- para quem tem `cdb_confirmation_allowance`, o que hoje e quase ninguem.
--
-- Ou seja: nada quebrou ainda, e quebra na PROXIMA concessao de permissao. Achado na auditoria de
-- persistencia de 2026-08-16.
--
-- ═══ O QUE ESTA MIGRACAO FAZ ═════════════════════════════════════════════════════════════════
--
-- Reaplica o corpo APLICADO de `20260813180000` -- verbatim, incluindo a leitura de
-- `bolao.cdb_authoritative_document()`, o `for update`, o espelho normalizado e a ausencia
-- deliberada de handler de excecao -- e devolve as tres coisas que faltavam:
--
--   v_canon      forma canonica dos palpites (matches + qualified)
--   v_snapshot   o que o recibo precisa, congelado no instante do save
--   'snapshot'   no payload do evento
--
-- A expressao do snapshot e a de `20260813050000`, sem uma virgula de diferenca. Lista de
-- PERMISSAO campo a campo: nem endereco, nem token, nem `payerName`, nem metodo de pagamento, nem
-- `lastClientRef`, nem resultado de partida.
--
-- NAO muda: roteamento de leitura, autorizacao, scoring, cutoff, idempotencia, o espelho.
--
-- ROLLBACK: `20260816010000_..._again.rollback.sql` reaplica o corpo de `20260813180000`. O
-- efeito de reverter e o comprovante de producao voltar a falhar com `payload_sem_snapshot`.

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
  v_canon    jsonb;
  v_snapshot jsonb;
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
    v_canon  := jsonb_build_object(
      'matches',   coalesce(p_picks->'matches',   '{}'::jsonb),
      'qualified', coalesce(p_picks->'qualified', '{}'::jsonb));

    -- SNAPSHOT: tudo que o recibo precisa, congelado AGORA. Lista de permissao campo a campo --
    -- nem endereco, nem token, nem payerName, nem metodo de pagamento, nem lastClientRef, nem
    -- resultado de partida. Expressao identica a de 20260813050000, reaplicada sobre o corpo do
    -- write cutover.
    v_snapshot := jsonb_build_object(
      'picks',     v_canon,
      'entryName', v_entry->>'entryName',
      'savedAt',   to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'phases',    coalesce((
        select jsonb_object_agg(ph.key, jsonb_build_object(
                 'ties', coalesce((
                   select jsonb_object_agg(tt.key, jsonb_build_object(
                            'teamA', tt.value->>'teamA',
                            'teamB', tt.value->>'teamB'))
                     from jsonb_each(ph.value->'ties') tt), '{}'::jsonb),
                 'topology', coalesce(ph.value->'topology'->'slots', '{}'::jsonb)))
          from jsonb_each(v_state->'phases') ph
         where jsonb_typeof(ph.value) = 'object'), '{}'::jsonb));

    insert into bolao.outbox_events (idempotency_key, channel, event_type, payload)
    values ('cdb2026:entry-saved-confirmation:' || v_entry_id || ':' || v_versao || ':v1',
            'email',
            'cdb2026.entry_saved_confirmation',
            -- `picksVersion` e hash, nao conteudo: o consumidor precisa dele para montar a chave
            -- de entrega, e um hash nao reidrata palpite nem identifica pessoa. O `snapshot` e o
            -- conteudo, e sai do MESMO p_picks que gerou o hash -- por isso o consumidor pode
            -- recalcular e recusar se divergirem.
            jsonb_build_object('entryId', v_entry_id, 'savedAt', v_agora,
                               'picksVersion', v_versao, 'snapshot', v_snapshot))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('updated', true);
end $function$;

revoke all on function public.cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function public.cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;

-- ── PROVA ESTRUTURAL, DENTRO DA PROPRIA MIGRACAO ────────────────────────────────────────────
--
-- Uma migracao que redefine uma funcao de 140 linhas para acrescentar tres pode perder outra
-- coisa no caminho. Estas assercoes leem o corpo GRAVADO e recusam o commit se qualquer uma das
-- pecas que NAO deveriam mudar tiver sumido.
do $verify$
declare
  v_src text;
  v_codigo text;
  v_falta text[] := array[]::text[];
  v_peca text;
begin
  -- `regprocedure` resolve a assinatura sem depender do formato do texto: a primeira versao
  -- comparava com `pg_get_function_identity_arguments(...) = 'text, text, jsonb'`, que devolve
  -- `p_token text, p_client_ref text, p_picks jsonb` -- os NOMES entram. A assercao ficava
  -- vermelha com a funcao no lugar certo, que e o pior tipo de portao: recusa o commit correto.
  begin
    select pg_get_functiondef('public.cdb_save_my_picks(text,text,jsonb)'::regprocedure)
      into v_src;
  exception when undefined_function then
    raise exception 'cdb_save_my_picks(text,text,jsonb) nao existe apos a migracao';
  end;

  if v_src is null then
    raise exception 'cdb_save_my_picks(text,text,jsonb) nao existe apos a migracao';
  end if;

  foreach v_peca in array array[
    'bolao.cdb_authoritative_document()',   -- a autoridade de entrada do write cutover
    'for update',                           -- o lock que serializa save contra sync de calendario
    'bolao.cdb_mirror_entry_picks',         -- o espelho normalizado, mesma transacao
    'CUTOFF_PASSADO',                       -- o cutoff continua sendo verificado
    'FASE_FECHADA',
    'ACESSO_NEGADO',
    'idempotente',                          -- lastClientRef repetido nao grava
    'identico',                             -- picks iguais nao criam evento
    'public.cdb_picks_version',
    'snapshot'                              -- o que esta migracao existe para devolver
  ] loop
    if position(v_peca in v_src) = 0 then
      v_falta := v_falta || v_peca;
    end if;
  end loop;

  if array_length(v_falta, 1) is not null then
    raise exception 'cdb_save_my_picks perdeu pecas na redefinicao: %', v_falta;
  end if;

  -- O snapshot NAO pode carregar campo privado. Barato de checar, caro de descobrir depois.
  --
  -- Varre o CODIGO, nao os comentarios. A primeira versao varria `pg_get_functiondef` inteiro e
  -- se acusou sozinha: o comentario tres paragrafos acima LISTA os campos proibidos para dizer
  -- que nao entram, e a assercao leu a lista como se fosse uso. Portao que casa com prosa e o
  -- falso-positivo espelhado do falso-verde -- recusa o commit correto por causa de uma frase.
  v_codigo := regexp_replace(v_src, '--[^\n]*', '', 'g');

  foreach v_peca in array array['participantEmail', 'payerName', 'paymentMethod', 'paymentTo',
                                'accessToken', 'tokenHash'] loop
    if position(v_peca in v_codigo) > 0 then
      raise exception 'cdb_save_my_picks passou a referenciar campo privado: %', v_peca;
    end if;
  end loop;

  raise notice 'cdb_save_my_picks: snapshot restaurado, %s pecas do cutover preservadas', 10;
end
$verify$;

commit;

select 'snapshot devolvido ao payload de cdb2026.entry_saved_confirmation' as resultado;
