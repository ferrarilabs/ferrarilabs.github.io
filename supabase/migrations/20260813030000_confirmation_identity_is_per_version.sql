-- 20260813030000_confirmation_identity_is_per_version.sql
--
-- ═══ A IDENTIDADE ERA GROSSA DEMAIS ══════════════════════════════════════════════════════════
--
-- A chave era `cdb2026:entry-saved-confirmation:<entryId>:v1` -- derivada so da ENTRADA. Isso
-- resolve a tempestade (salvar dez vezes = um aviso) e cria um problema pior de outro lado: o
-- PRIMEIRO comprovante aceito suprime TODOS os futuros. O participante corrige um palpite dias
-- depois, salva, e nunca mais recebe recibo de nada.
--
-- Um comprovante confirma um ESTADO GRAVADO, nao uma entrada e nao um clique. Entao a identidade
-- passa a ser:
--
--     identidade da entrada  +  hash do conteudo canonico efetivamente persistido
--
-- Nao carimbo de tempo, nao id de execucao, nao uuid, nao retry do cliente -- qualquer um desses
-- faria de cada tentativa uma notificacao nova, que e exatamente como a tempestade nasceu.
--
--     estado A salvo        -> comprovante A, uma vez
--     salvar A de novo      -> 0
--     recarregar e salvar A -> 0
--     rerodar o consumidor  -> 0
--     mudar para o estado B -> comprovante B, uma vez
--     salvar B de novo      -> 0
--
-- CONSEQUENCIA DELIBERADA: voltar de B para A NAO gera comprovante novo, porque o participante ja
-- tem recibo daquele estado exato. Isso e o lado seguro da escolha; registro aqui porque e uma
-- decisao, nao um esquecimento.
--
-- ═══ CANONICALIZACAO ═════════════════════════════════════════════════════════════════════════
--
-- O hash sai de `jsonb`, nao do texto que o cliente mandou. `jsonb` normaliza sozinho: ordena
-- chaves, descarta espaco em branco, deduplica e normaliza numeros. Dois objetos semanticamente
-- iguais viram o mesmo texto, entao ordem de propriedade e formatacao nao criam identidade nova.
--
-- E a forma canonica e uma LISTA DE PERMISSAO -- `matches` e `qualified`, nada mais. Nao uma lista
-- de proibicao: se amanhem alguem acrescentar um campo transitorio ao payload (rascunho, carimbo
-- de UI, token), ele fica de fora por construcao, sem ninguem lembrar de proibi-lo. Token,
-- endereco e PII nunca entram no hash porque nunca entram na forma canonica.
--
-- ═══ POR QUE O `family` EXISTE AGORA ═════════════════════════════════════════════════════════
--
-- A unicidade de entrega usa `business_key`. Se ela continuasse constante, a mesma supressao
-- aconteceria uma camada abaixo: primeira entrega aceita, todas as versoes futuras recusadas com
-- JA_ENTREGUE. Entao a `business_key` tambem passa a carregar o hash da versao.
--
-- So que o disjuntor de 45 minutos compara `business_key <> p_business_key` -- ele existe para
-- pegar "mesma pessoa, notificacoes DIFERENTES, minutos atras". Com a chave variando por versao,
-- salvar A e depois B em dez minutos passaria a parecer anomalia e B seria BLOQUEADO. O disjuntor
-- caçaria justamente o comportamento que este patch veio permitir.
--
-- Por isso a coluna `family`: o disjuntor passa a comparar FAMILIA, nao chave. Duas versoes do
-- mesmo comprovante sao a mesma familia e nao se disparam. Convite + correcao + reenvio continuam
-- familias diferentes e continuam disparando -- que era o padrao de 2026-08-12.
--
-- `p_family` tem default `p_business_key`, entao todo chamador existente (Powerball, BR2026)
-- mantem exatamente o comportamento de hoje. Aditivo.
--
-- ROLLBACK: `alter table bolao.notification_deliveries drop column family` e reaplicar o corpo de
-- 20260812190000 (reserve_delivery) e de 20260813010000 (cdb_save_my_picks).

-- ── FAMILIA ─────────────────────────────────────────────────────────────────────────────────
alter table bolao.notification_deliveries add column if not exists family text;

-- Retroativo: familia = a propria chave. Preserva a semantica atual bit a bit para tudo que ja
-- existe -- nenhuma linha antiga passa a se comportar diferente por causa desta migracao.
update bolao.notification_deliveries set family = business_key where family is null;

comment on column bolao.notification_deliveries.family is
  'Agrupa versoes da MESMA notificacao. O disjuntor de envio rapido compara familia, nao chave: '
  'dois comprovantes de dois estados gravados diferentes nao sao anomalia; convite seguido de '
  'correcao e.';


-- ACRESCENTAR PARAMETRO CRIA SOBRECARGA, NAO SUBSTITUICAO.
--
-- `create or replace` so substitui quando a assinatura bate. Com um parametro a mais, o Postgres
-- passaria a ter DUAS `reserve_delivery`, e o PostgREST resolve por nome de argumento: uma chamada
-- com os seis campos antigos casaria com as duas (a nova tem default) e viraria
-- "function is not unique". A antiga tem de sair explicitamente.
drop function if exists public.reserve_delivery(text, text, text, integer, interval, boolean);

create or replace function public.reserve_delivery(
  p_app            text,
  p_business_key   text,
  p_recipient      text,
  p_generation     integer default 1,
  p_anomaly_window interval default '45 minutes',
  p_bypass_anomaly boolean default false,
  p_family         text default null
)
  returns table (reserved boolean, reason text, delivery_id uuid)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_hash text := encode(sha256(convert_to(lower(trim(p_recipient)), 'utf8')), 'hex');
  v_id   uuid;
  v_recente timestamptz;
  -- Sem familia declarada, a familia E a chave: comportamento identico ao de antes.
  v_family text := coalesce(p_family, p_business_key);
begin
  -- ANOMALIA: mesma pessoa, mesmo app, OUTRA FAMILIA de notificacao, minutos atras. Comparar
  -- familia (e nao chave) e o que deixa duas versoes do mesmo comprovante conviverem sem que a
  -- segunda pareca surto -- sem afrouxar nada para notificacoes de tipos diferentes.
  if not p_bypass_anomaly then
    select max(d.claimed_at) into v_recente
      from bolao.notification_deliveries d
     where d.app = p_app
       and d.recipient_hash = v_hash
       and coalesce(d.family, d.business_key) is distinct from v_family
       and d.status in ('accepted', 'claimed')
       and d.claimed_at > now() - p_anomaly_window;
    if v_recente is not null then
      return query select false,
        format('ANOMALIA_ENVIO_RAPIDO: este destinatario recebeu de %s em %s (janela %s). '
               'Exige aprovacao explicita.', p_app, v_recente, p_anomaly_window), null::uuid;
      return;
    end if;
  end if;

  insert into bolao.notification_deliveries (app, business_key, recipient_hash, generation, family)
  values (p_app, p_business_key, v_hash, p_generation, v_family)
  on conflict (app, business_key, recipient_hash, generation) do nothing
  returning bolao.notification_deliveries.delivery_id into v_id;

  if v_id is null then
    return query select false, 'JA_ENTREGUE: reserva existente para este destinatario/evento',
                        null::uuid;
    return;
  end if;
  return query select true, null::text, v_id;
end;
$$;

revoke all on function public.reserve_delivery(text,text,text,integer,interval,boolean,text) from public;
revoke all on function public.reserve_delivery(text,text,text,integer,interval,boolean,text) from anon;
revoke all on function public.reserve_delivery(text,text,text,integer,interval,boolean,text) from authenticated;
grant execute on function public.reserve_delivery(text,text,text,integer,interval,boolean,text) to service_role;


-- Contagem por familia: `--status` precisa saber "quantos comprovantes ja sairam para esta
-- entrada", e a chave agora varia por versao, entao contar por chave nao responde mais isso.
create or replace function public.delivery_count_family(p_app text, p_family text)
  returns table (total bigint, accepted bigint)
  language sql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
  select count(*)::bigint,
         count(*) filter (where status = 'accepted')::bigint
    from bolao.notification_deliveries
   where app = p_app and coalesce(family, business_key) = p_family;
$$;

revoke all on function public.delivery_count_family(text, text) from public;
revoke all on function public.delivery_count_family(text, text) from anon;
revoke all on function public.delivery_count_family(text, text) from authenticated;
grant execute on function public.delivery_count_family(text, text) to service_role;

-- A purga de canario passa a alcancar tambem o que foi gravado com familia de canario.
create or replace function public.purge_canary_deliveries()
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare v_n integer;
begin
  delete from bolao.notification_deliveries
   where business_key like 'canary:%' or family like 'canary:%';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ── A VERSAO CANONICA, UMA DEFINICAO SO ─────────────────────────────────────────────────────
--
-- Funcao propria, e nao expressao embutida no produtor, por um motivo de TESTE: o teste precisa
-- provar que ordem de propriedade, espaco em branco e campo transitorio nao mudam a identidade.
-- Provar isso exigiria fazer SAVES DE VERDADE na entrada de um participante -- e um save real
-- cria um evento de PRODUCAO, que o consumidor agendado entregaria de verdade mais tarde.
--
-- Com a funcao separada, o teste exercita EXATAMENTE o que o produtor usa, sem gravar nada e sem
-- tocar em palpite de ninguem. Se fosse uma copia da expressao, as duas poderiam divergir e o
-- teste passaria a concordar consigo mesmo -- o modo de falha que ja apareceu duas vezes aqui.
--
-- `immutable`: mesma entrada, mesma saida, sempre. E o que autoriza o Postgres a tratar isto como
-- identidade de conteudo, e o que garante que o hash nao dependa de relogio nem de sessao.
create or replace function public.cdb_picks_version(p_picks jsonb)
  returns text
  language sql
  immutable
  set search_path = pg_catalog, public, pg_temp
as $$
  -- LISTA DE PERMISSAO, nao de proibicao. Campo novo no payload fica de fora por construcao;
  -- token, endereco e PII nunca entram porque nunca sao selecionados. `jsonb` ja e canonico:
  -- chaves ordenadas, sem espaco em branco, numeros normalizados.
  select left(encode(sha256(convert_to(
           jsonb_build_object(
             'matches',   coalesce(p_picks->'matches',   '{}'::jsonb),
             'qualified', coalesce(p_picks->'qualified', '{}'::jsonb)
           )::text, 'utf8')), 'hex'), 16);
$$;

revoke all on function public.cdb_picks_version(jsonb) from public;
revoke all on function public.cdb_picks_version(jsonb) from anon;
revoke all on function public.cdb_picks_version(jsonb) from authenticated;
grant execute on function public.cdb_picks_version(jsonb) to service_role;


-- ── O PRODUTOR: A CHAVE PASSA A CARREGAR A VERSAO ───────────────────────────────────────────
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
end $$;

revoke all on function cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;

select 'comprovante: uma identidade por VERSAO gravada, familia protege o disjuntor' as resultado;
