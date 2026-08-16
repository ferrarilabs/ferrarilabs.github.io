-- 20260813050000_confirmation_payload_carries_snapshot.sql
--
-- ═══ O COMPROVANTE PRECISA PROVAR O QUE FOI SALVO, NAO O QUE ESTA SALVO AGORA ════════════════
--
-- O payload carregava so `entryId` + `picksVersion`. Para montar o recibo, o consumidor teria de
-- ir LER a entrada no momento em que roda -- e entre o save e o consumo o participante pode ter
-- salvo de novo.
--
-- O resultado seria um recibo com a identidade da versao A e o CONTEUDO da versao B. Como
-- evidencia isso e pior que nao mandar recibo: o documento afirmaria, com hash proprio, algo que
-- nunca foi gravado daquele jeito.
--
-- Hoje isso e concreto, nao hipotetico: o consumidor agendado ja ficou 14 minutos sem rodar, com
-- a obrigacao parada na fila. Qualquer save nessa janela teria trocado o conteudo do recibo.
--
-- Entao o evento passa a carregar o SNAPSHOT do que foi gravado. O recibo se torna reproduzivel a
-- partir do proprio evento, sem depender do estado atual de nada.
--
-- ═══ O QUE ENTRA NO SNAPSHOT ═════════════════════════════════════════════════════════════════
--
--   picks       forma canonica (matches + qualified) -- o mesmo objeto que gera o hash
--   entryName   rotulo da entrada, que o recibo mostra
--   phases      SO teamA/teamB de cada confronto + os slots de topologia
--
-- `phases` e congelado junto de proposito. Os confrontos reais vem da CBF e mudam: se a estrutura
-- fosse lida no consumo, um recibo poderia mostrar um par de times diferente do que estava na tela
-- quando a pessoa palpitou.
--
-- ═══ O QUE NAO ENTRA ═════════════════════════════════════════════════════════════════════════
--
-- Nem endereco, nem token, nem `payerName`, nem metodo de pagamento, nem `lastClientRef`. O
-- snapshot e montado por LISTA DE PERMISSAO: `jsonb_build_object` nomeia campo por campo, entao
-- nada novo entra sozinho quando a entrada ganhar colunas. Resultado de partida tambem fica de
-- fora -- recibo e prova do PALPITE, nao boletim do torneio.
--
-- `picksVersion` continua sendo calculado por `cdb_picks_version(p_picks)`, entao a identidade do
-- evento e o conteudo do recibo saem do MESMO objeto. O consumidor recalcula e recusa se
-- divergirem.
--
-- ROLLBACK: reaplicar o corpo de 20260813030000.

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

  -- ── REBASED ONTO THE WRITE CUTOVER (20260813180000) ─────────────────────────────────────────
  -- This file was authored 2026-08-12, BEFORE cdb2026 write authority moved to the normalized
  -- model, and it was never applied. Its original line here was
  --
  --     select state into v_state from bolao_state where id = 'cdb2026' for update;
  --
  -- which is the legacy-input form. Because this version (…050000) sorts BEFORE the cutover
  -- (…180000) and the cutover is already in the ledger, a `db push` would apply this file and
  -- NOT re-apply the cutover -- silently returning cdb_save_my_picks to legacy authority while
  -- cdb_apply_operator_mutation, cdb_register_bracket_topology and cdb_refresh_topology_provenance
  -- stayed normalized. Mixed authority inside one domain, with no error raised.
  --
  -- Only the input source is changed, and it is the identical substitution the cutover applied to
  -- the other four writers. This file's own contribution -- the receipt snapshot in the outbox
  -- payload -- is untouched below.
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

  -- Save que nao gravou nada nao cria obrigacao. Os dois ramos saem antes do UPDATE.
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

  -- ── RESTORED: THE NORMALIZED WRITE (20260813140000, stamp 20260813150000) ───────────────────
  --
  -- The first rebase of this file substituted the INPUT line and stopped there, because that is
  -- the substitution the cutover applied to the other four writers. `cdb_save_my_picks` is the one
  -- writer whose cutover ALSO added a mirror call, and this file — authored 2026-08-12 — predates
  -- both changes. Fixing only the input produced a definition that reads normalized, validates
  -- against normalized, reports NORMALIZED-INPUT to every detector, and then writes the
  -- participant's picks to the legacy document ALONE.
  --
  -- Measured on a clone at production level with this file applied: the save returned
  -- `{"updated": true}`, `bolao_state` carried the new goals, `bolao.predictions` stayed at 1045
  -- and `mirrored_at` stayed 0. Normalized would have gone stale on the first real save, silently,
  -- with the authority probe still green.
  --
  -- Same transaction as the legacy UPDATE above, and NO exception handler — catching here would
  -- produce a committed legacy write beside a stale normalized model, which is the divergence the
  -- mirror exists to prevent. `v_agora` is passed rather than re-read so the mirror records the
  -- SAME instant the legacy entry was stamped with.
  perform bolao.cdb_mirror_entry_picks(
            (select pe.pool_entry_id
               from bolao.pool_entries pe
               join bolao.pools pl on pl.pool_id = pe.pool_id and pl.slug = 'cdb2026'
              where pe.legacy_entry_id = v_entry_id::uuid),
            p_picks, v_agora);

  if exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = v_entry_id) then
    v_canon := jsonb_build_object(
      'matches',   coalesce(p_picks->'matches',   '{}'::jsonb),
      'qualified', coalesce(p_picks->'qualified', '{}'::jsonb));
    v_versao := public.cdb_picks_version(p_picks);

    -- SNAPSHOT: tudo que o recibo precisa, congelado agora. Lista de permissao campo a campo.
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
            jsonb_build_object('entryId', v_entry_id, 'savedAt', v_agora,
                               'picksVersion', v_versao, 'snapshot', v_snapshot))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('updated', true);
end $$;

revoke all on function cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;


-- ── SNAPSHOT SOB DEMANDA, PARA O TESTE DE TEMPLATE APROVADO ────────────────────────────────
--
-- O operador autorizou UM e-mail para validar o desenho do recibo, sem exigir outro save. Isto
-- monta o MESMO snapshot a partir da versao canonica hoje persistida -- mesma expressao, mesma
-- lista de permissao -- para que o teste de template exercite o renderizador de verdade.
--
-- So leitura. Nao grava, nao cria evento, nao envia. Nao devolve endereco: o `entryName` e rotulo
-- de entrada, nao identidade de contato, e e o unico campo de pessoa que o recibo mostra.
create or replace function public.cdb_current_receipt_snapshot(p_entry_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_state jsonb;
  v_entry jsonb;
  v_canon jsonb;
begin
  -- Mesmo portao do resto do caminho: sem permissao nominal, nada sai.
  if not exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = p_entry_id) then
    return null;
  end if;

  select state into v_state from bolao_state where id = 'cdb2026';
  if v_state is null then return null; end if;

  select e into v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) as e
   where e->>'id' = p_entry_id
   limit 1;
  if v_entry is null then return null; end if;

  v_canon := jsonb_build_object(
    'matches',   coalesce(v_entry->'picks'->'matches',   '{}'::jsonb),
    'qualified', coalesce(v_entry->'picks'->'qualified', '{}'::jsonb));

  return jsonb_build_object(
    'picksVersion', public.cdb_picks_version(v_entry->'picks'),
    'snapshot', jsonb_build_object(
      'picks',     v_canon,
      'entryName', v_entry->>'entryName',
      'savedAt',   v_entry->>'updatedAt',
      'phases',    coalesce((
        select jsonb_object_agg(ph.key, jsonb_build_object(
                 'ties', coalesce((
                   select jsonb_object_agg(tt.key, jsonb_build_object(
                            'teamA', tt.value->>'teamA',
                            'teamB', tt.value->>'teamB'))
                     from jsonb_each(ph.value->'ties') tt), '{}'::jsonb),
                 'topology', coalesce(ph.value->'topology'->'slots', '{}'::jsonb)))
          from jsonb_each(v_state->'phases') ph
         where jsonb_typeof(ph.value) = 'object'), '{}'::jsonb)));
end;
$$;

revoke all on function public.cdb_current_receipt_snapshot(text) from public;
revoke all on function public.cdb_current_receipt_snapshot(text) from anon;
revoke all on function public.cdb_current_receipt_snapshot(text) from authenticated;
grant execute on function public.cdb_current_receipt_snapshot(text) to service_role;

select 'o evento carrega o snapshot: o recibo prova a versao que o gerou' as resultado;
