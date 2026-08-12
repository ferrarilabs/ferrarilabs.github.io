-- 20260812070000_cdb_secure_participant_access.sql
--
-- ═══ O QUE ISTO FECHA ════════════════════════════════════════════════════════════════════════
--
-- DEFEITO 1 — `cdb_update_entry_picks` NAO TEM AUTORIZACAO NENHUMA.
--
--   A funcao recebe `p_entry_id` e grava os palpites daquela entrada. Nao verifica NADA sobre
--   quem esta chamando. E tem `grant execute ... to anon`.
--
--   Os ids de entrada sao PUBLICOS: saem na projecao `bolao_state_public`, que qualquer pessoa le
--   com a chave publicavel que vai em todo config.js servido ao navegador.
--
--   Medido em producao em 2026-08-12, com um id inexistente (nenhum dado foi tocado):
--
--       POST /rest/v1/rpc/cdb_update_entry_picks  {"p_entry_id":"...inexistente..."}
--       -> 400 {"code":"P0001","message":"ENTRY_NOT_FOUND: nenhuma entrada com id ..."}
--
--   A funcao EXECUTOU a busca para o chamador anonimo. Com um dos 12 ids reais no lugar, ela
--   teria sobrescrito os palpites de um participante. Nao ha oraculo aqui: e escrita direta.
--
--   Agravante: o app deployado NAO chama esta funcao. Ela era superficie de ataque pura, sem
--   nenhum uso legitimo a preservar.
--
-- DEFEITO 2 — a autorizacao "de verdade" do participante era DERIVAVEL.
--
--   O fluxo de editar entrada usa `receiptCode`, que o app calcula como
--   `hash(entryName + createdAt)`. Os dois campos estao na projecao publica. Ou seja: o segredo
--   que autoriza a edicao pode ser recalculado por qualquer pessoa que leia a projecao.
--
--   Isso nao e um segredo fraco; e um segredo que nao existe.
--
-- ═══ O QUE ISTO NAO FECHA (de proposito) ═════════════════════════════════════════════════════
--
-- O app deployado grava o DOCUMENTO INTEIRO em `bolao_state` com a chave anon
-- (`POST ... Prefer: resolution=merge-duplicates`), e `anon` tem UPDATE (medido: PATCH com filtro
-- vazio devolve 204). Revogar isso AGORA quebraria o app em producao -- inclusive a sincronizacao
-- de resultados e as operacoes de admin.
--
-- A revogacao da escrita bruta e a ETAPA SEGUINTE, depois que o navegador passar a usar as RPCs
-- estreitas. Ordem obrigatoria: substituto provado primeiro, revogacao depois. Esta migracao
-- constroi o substituto.
--
-- ═══ MODELO DE CREDENCIAL ════════════════════════════════════════════════════════════════════
--
-- Token aleatorio de 32 bytes, gerado FORA do banco (o banco nunca ve o valor bruto), guardado
-- aqui apenas como sha256. Escopo: uma entrada. Revogavel. Rotacionavel.
--
-- Nao usa pgcrypto: `sha256(bytea)` e nativo do Postgres. Uma extensao a menos e uma dependencia
-- a menos numa base de producao.
--
-- ADITIVA: nenhuma tabela existente muda, nenhum dado e reescrito. A unica revogacao e a de uma
-- funcao que ninguem usa e que nao deveria ser executavel por anonimo.
--
-- ROLLBACK:
--   grant execute on function cdb_update_entry_picks(text,text,jsonb) to anon;
--   drop function cdb_save_my_picks(text,text,jsonb);
--   drop function cdb_my_entry(text);
--   drop function _cdb_entry_id_from_token(text);
--   drop table cdb_entry_access;

-- ── 1. CREDENCIAIS ───────────────────────────────────────────────────────────────────────────
create table if not exists cdb_entry_access (
  entry_id     text primary key,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz,
  note         text
);

alter table cdb_entry_access enable row level security;

-- Sem POLICY nenhuma: com RLS ligada e nenhuma policy, `anon` e `authenticated` nao enxergam uma
-- linha sequer, nem por SELECT nem por qualquer outro verbo. As funcoes abaixo sao
-- `security definer` e por isso atravessam RLS de forma controlada -- que e exatamente a
-- diferenca entre "o servidor consulta a credencial" e "o cliente le a tabela de credenciais".
revoke all on table cdb_entry_access from public, anon, authenticated;
grant  all on table cdb_entry_access to service_role;

comment on table cdb_entry_access is
  'Credencial de acesso por entrada do CDB2026. Guarda apenas sha256 do token; o valor bruto '
  'nunca entra no banco, no Git, em log ou na projecao publica.';

-- ── 2. RESOLUCAO DE TOKEN (interna) ──────────────────────────────────────────────────────────
create or replace function _cdb_entry_id_from_token(p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_entry text;
begin
  -- Token curto/vazio nunca casa. Sai antes de tocar a tabela.
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select entry_id into v_entry
    from cdb_entry_access
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and revoked_at is null
   limit 1;

  if v_entry is not null then
    update cdb_entry_access set last_used_at = now() where entry_id = v_entry;
  end if;
  return v_entry;
end $$;

revoke all on function _cdb_entry_id_from_token(text) from public, anon, authenticated;
grant execute on function _cdb_entry_id_from_token(text) to service_role;

-- ── 3. LEITURA DA PROPRIA ENTRADA ────────────────────────────────────────────────────────────
--
-- Substitui a busca por e-mail feita no NAVEGADOR. Antes, para localizar UMA entrada, o cliente
-- baixava o estado inteiro e comparava `participantEmail` em JavaScript -- ou seja, todo mundo
-- recebia o e-mail de todo mundo so para achar o proprio.
--
-- Devolve SO a propria entrada, e so os campos que o formulario precisa. Sem e-mail, sem
-- pagador, sem metodo de pagamento -- nem os proprios: o formulario de palpite nao usa nada
-- disso, e o que nao e necessario nao deve trafegar.
--
-- Token invalido, revogado ou inexistente devolvem TODOS o mesmo `null`. Nao ha mensagem que
-- distinga "entrada nao existe" de "token errado" -- essa diferenca e um oraculo de enumeracao.
create or replace function cdb_my_entry(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_entry_id text;
  v_state    jsonb;
  v_entry    jsonb;
begin
  v_entry_id := _cdb_entry_id_from_token(p_token);
  if v_entry_id is null then
    return null;
  end if;

  select state into v_state from bolao_state where id = 'cdb2026';
  if v_state is null then
    return null;
  end if;
  if coalesce(v_state->'deletedIds','[]'::jsonb) ? v_entry_id then
    return null;
  end if;

  select e into v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) as t(e)
   where e->>'id' = v_entry_id
   limit 1;

  if v_entry is null then
    return null;
  end if;

  return jsonb_build_object(
    'id',        v_entry->>'id',
    'entryName', v_entry->>'entryName',
    'picks',     coalesce(v_entry->'picks', '{}'::jsonb),
    'updatedAt', v_entry->>'updatedAt'
  );
end $$;

revoke all on function cdb_my_entry(text) from public;
grant execute on function cdb_my_entry(text) to anon, authenticated, service_role;

-- ── 4. ESCRITA DOS PROPRIOS PALPITES ─────────────────────────────────────────────────────────
--
-- Mesma mutacao estreita da `cdb_update_entry_picks` (so `picks`, `updatedAt`, `lastClientRef`),
-- com a diferenca que define tudo: a entrada vem do TOKEN, nunca de um parametro do cliente.
-- Nao existe `p_entry_id` aqui de proposito -- um parametro que o chamador escolhe e um
-- parametro que o atacante escolhe.
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
    -- Falha GENERICA: nao diz se o token e invalido, revogado, ou de uma entrada removida.
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

  -- Idempotencia: clique duplo, retry de rede e reenvio de formulario sao a MESMA edicao.
  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente');
  end if;

  -- CUTOFF por fase, falha fechada. Cutoff ilegivel BLOQUEIA: nao saber se ja fechou nao e
  -- permissao. Cutoff NULO tambem bloqueia -- sem prazo publicado nao ha fase aberta, que e a
  -- regra de negocio vigente para as quartas enquanto a CBF nao divulga datas e horarios.
  for v_fase in select jsonb_object_keys(p_picks) loop
    -- Reenviar o palpite IDENTICO nunca e bloqueado: nao e uma edicao.
    if coalesce(v_entry->'picks'->v_fase, 'null'::jsonb) is distinct from coalesce(p_picks->v_fase, 'null'::jsonb) then
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
    end if;
  end loop;

  v_entry := v_entry
    || jsonb_build_object('picks', p_picks)
    || jsonb_build_object('updatedAt', to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || jsonb_build_object('lastClientRef', p_client_ref);

  update bolao_state
     set state = jsonb_set(state, array['entries', v_idx::text], v_entry),
         updated_at = v_agora
   where id = 'cdb2026';

  return jsonb_build_object('updated', true);
end $$;

revoke all on function cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;

-- ── 5. FECHA O BURACO ────────────────────────────────────────────────────────────────────────
--
-- `cdb_update_entry_picks` aceita o id da entrada como PARAMETRO e nao autoriza nada. Nenhum
-- caminho legitimo a usa (o app deployado nao a referencia). Fica sem execucao para anonimo;
-- `service_role` mantem, porque o operador legitimamente edita por id.
revoke execute on function cdb_update_entry_picks(text, text, jsonb) from anon, authenticated, public;
grant  execute on function cdb_update_entry_picks(text, text, jsonb) to service_role;

select 'cdb_entry_access + cdb_my_entry + cdb_save_my_picks criadas; '
    || 'cdb_update_entry_picks revogada de anon' as resultado;
