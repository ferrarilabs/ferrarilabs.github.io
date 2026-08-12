-- 027_copa2026_operator_mutations.sql — mutacoes de operador do COPA2026, do lado do servidor.
--
-- ─── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────────────────────
--
-- COPA-IDENTITY, opcao (b), ratificada pelo operador: runtime confiavel com service_role.
--
-- O inventario de contrato (COPA_CONTRACT_INVENTORY.json, 25 operacoes, UNKNOWN = 0) provou que
-- TODO `admin_only: YES` do copa2026 e uma guarda de INTERFACE. `guardAdmin()` e uma flag em
-- sessionStorage mais um SHA-256 contra um hash em config.js; o navegador nunca se autentica no
-- Supabase e carrega a MESMA chave anon publica que qualquer visitante. O banco nao consegue
-- distinguir um administrador de um visitante anonimo.
--
-- Por isso as RPCs `op_*` que ja existem e ja servem (op_confirm_payment, op_set_results,
-- op_remove_entry, op_update_entry) nao podem simplesmente ser concedidas a anon: elas sao
-- SECURITY DEFINER e passam por cima da RLS. Conceder a anon seria uma exposicao MAIOR que a de
-- hoje, nao menor -- qualquer visitante poderia gravar resultado e marcar pagamento.
--
-- ─── POR QUE ISTO NAO E `write_state(json)` ──────────────────────────────────────────────────
--
-- Uma RPC generica que aceita o documento inteiro nao e melhora nenhuma: e o upsert atual com
-- outro nome. Esta funcao NAO substitui estado. Ela recebe um TIPO, valida os campos daquele
-- tipo, e aplica so a transicao correspondente por caminho jsonb estreito. Tipo desconhecido
-- levanta; campo nao previsto pelo tipo e ignorado.
--
-- ─── O QUE ESTE ARQUIVO ACRESCENTA, E O QUE ELE DELIBERADAMENTE NAO REFAZ ────────────────────
--
-- Os tipos aqui sao exatamente as lacunas que o inventario demonstrou. Onde uma `op_*` existente
-- ja e contrato exato, o runtime confiavel a chama DIRETAMENTE -- nao ha copia aqui:
--
--   op_confirm_payment   paid[ref]          contrato exato, ja usado pelo CLI
--   op_set_results       results{}          contrato exato
--   op_remove_entry      deletedIds         contrato exato (lapide logica)
--
-- O que elas NAO cobrem, e portanto vive aqui:
--
--   update-entry    op_update_entry NAO TEM p_payment_to nem picks
--   clear-result    nenhuma RPC existe, e `deletedResults` nao tem representacao normalizada
--   clear-all       nenhuma RPC existe
--
-- ─── AUTORIZACAO ─────────────────────────────────────────────────────────────────────────────
--
-- Revogada de PUBLIC, de anon e de authenticated. So `service_role` executa. O navegador nunca a
-- alcanca, com ou sem senha de admin: a senha de admin protege a UI, nao o banco. A credencial
-- privilegiada existe apenas no runtime confiavel (secret do workflow) e NUNCA em codigo de
-- cliente, asset estatico, log, resposta ou configuracao.
--
-- ─── CONCORRENCIA ────────────────────────────────────────────────────────────────────────────
--
-- `for update` no inicio, e IDEMPOTENCIA por client_ref antes de qualquer escrita. Hoje existem
-- DOIS gravadores de documento inteiro da mesma linha (o navegador e send_result_email.py) sem
-- token de concorrencia comum, e o Python ainda omite `updated_at`, que e justamente a coluna que
-- o navegador consulta para decidir quem e mais novo. Nenhuma mutacao aqui e last-write-wins:
-- cada uma le sob lock, aplica um caminho estreito, e grava.
--
-- ─── PRAZO ───────────────────────────────────────────────────────────────────────────────────
--
-- NAO ha verificacao de prazo aqui, e isso e deliberado e fiel ao comportamento atual: nenhum
-- caminho administrativo do copa2026 verifica o cutoff hoje -- nem resultado, nem pagamento, nem
-- exclusao, nem limpeza. So `saveEntry` verifica. Inventar uma checagem de prazo para o operador
-- seria criar uma regra de negocio que nunca existiu. Alem disso o prazo do copa2026 sao DOIS
-- escalares em config.js (r32CutoffIso e cutoffIso), um arquivo publicado -- nao um valor do
-- documento -- e o banco nao e sua fonte de verdade.
--
-- ADITIVA: nao revoga permissao existente, nao altera policy, nao muda o app deployado.
-- ROLLBACK: `drop function copa_apply_operator_mutation(text, jsonb, text, text);`

create or replace function copa_apply_operator_mutation(
  p_type text,
  p_payload jsonb,
  p_actor text,
  p_client_ref text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
  v_agora timestamptz := now();
  v_iso text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_entry_id text;
  v_mid text;
  v_idx int;
  v_entries jsonb;
  v_hoje jsonb;
  v_novo jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'copa_apply_operator_mutation: actor obrigatorio (auditoria)';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'copa_apply_operator_mutation: client_ref obrigatorio (idempotencia)';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'copa_apply_operator_mutation: payload precisa ser objeto';
  end if;

  select state into v_state from bolao_state where id = 'main' for update;
  if v_state is null then
    raise exception 'copa_apply_operator_mutation: estado do copa2026 (main) inexistente';
  end if;

  -- IDEMPOTENCIA: a mesma operacao reenviada (retry de CI, clique duplo) nao se aplica duas vezes.
  if exists (select 1 from jsonb_array_elements(coalesce(v_state->'auditLog','[]'::jsonb)) a
              where a->>'clientRef' = p_client_ref) then
    return jsonb_build_object('applied', false, 'reason', 'idempotente');
  end if;

  -- ── despacho por tipo ─────────────────────────────────────────────────

  if p_type = 'update-entry' then
    -- A lacuna que op_update_entry nao cobre: paymentTo e picks.
    v_entry_id := p_payload->>'entryId';
    if v_entry_id is null then
      raise exception 'update-entry: entryId obrigatorio';
    end if;
    select ord - 1 into v_idx
      from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
     where e->>'id' = v_entry_id;
    if v_idx is null then
      raise exception 'update-entry: entrada % inexistente', v_entry_id;
    end if;
    if p_payload ? 'participantEmail'
       and p_payload->>'participantEmail' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'update-entry: e-mail com sintaxe invalida';
    end if;
    if p_payload ? 'picks' and jsonb_typeof(p_payload->'picks') <> 'object' then
      raise exception 'update-entry: picks precisa ser objeto';
    end if;

    -- `jsonb_strip_nulls` sobre um objeto montado campo a campo: so o que o payload REALMENTE
    -- trouxe e sobrescrito. Um campo ausente do payload permanece como estava -- que e como o
    -- app edita hoje -- e um campo presente com null nao vira null silenciosamente.
    v_novo := (v_state->'entries'->v_idx) || jsonb_strip_nulls(jsonb_build_object(
      'entryName',        p_payload->'entryName',
      'participantEmail', p_payload->'participantEmail',
      'payerName',        p_payload->'payerName',
      'paymentMethod',    p_payload->'paymentMethod',
      'paymentTo',        p_payload->'paymentTo',
      'diagnostics',      p_payload->'diagnostics',
      'picks',            p_payload->'picks'
    )) || jsonb_build_object('updatedAt', v_iso);
    v_state := jsonb_set(v_state, array['entries', v_idx::text], v_novo);

    -- Espelho privado: mesma correcao, mesma transacao. Sem isto o documento e o espelho
    -- divergem, e o espelho e a unica copia fora do documento.
    update bolao_entry_private set
        participant_email = coalesce(p_payload->>'participantEmail', participant_email),
        payer_name        = coalesce(p_payload->>'payerName', payer_name),
        payment_method    = coalesce(p_payload->>'paymentMethod', payment_method),
        payment_to        = coalesce(p_payload->>'paymentTo', payment_to),
        updated_at        = v_agora
    where pool_id = 'main' and entry_ref = v_entry_id;

  elsif p_type = 'set-result' then
    -- UM resultado, por caminho estreito. `op_set_results` ja existe e substitui o mapa
    -- `results` INTEIRO -- contrato exato para "publicar a tabela toda de uma vez", e errado
    -- para "gravar o placar deste jogo": quem so quer um jogo teria de mandar o mapa completo,
    -- e duas gravacoes concorrentes de jogos diferentes perderiam uma. E exatamente a classe de
    -- perda que este arquivo existe para fechar, entao ela nao pode voltar pela porta do lado.
    --
    -- Tambem retira o matchId de `deletedResults`: gravar um resultado que estava sepultado sem
    -- levantar a lapide deixaria o navegador com cache descartando o valor novo.
    v_mid := p_payload->>'matchId';
    if v_mid is null then
      raise exception 'set-result: matchId obrigatorio';
    end if;
    if jsonb_typeof(p_payload->'result') <> 'object' then
      raise exception 'set-result: result precisa ser objeto';
    end if;
    if jsonb_typeof(p_payload->'result'->'goalsA') <> 'number'
       or jsonb_typeof(p_payload->'result'->'goalsB') <> 'number' then
      -- Teste de TIPO, nunca de verdade: 0-0 e um placar real e um `if (!goalsA)` o descartaria.
      raise exception 'set-result: goalsA e goalsB precisam ser numeros';
    end if;
    v_state := jsonb_set(v_state, array['results', v_mid], p_payload->'result', true);
    v_state := jsonb_set(v_state, '{deletedResults}',
                 (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                    select jsonb_array_elements_text(coalesce(v_state->'deletedResults','[]'::jsonb)) as x
                  ) u where x <> v_mid), true);

  elsif p_type = 'clear-result' then
    -- Retratar um resultado errado. `deletedResults` e a lapide que faz o navegador com cache
    -- tambem largar o resultado -- sem ela, o valor errado volta na proxima uniao de merge.
    v_mid := p_payload->>'matchId';
    if v_mid is null then
      raise exception 'clear-result: matchId obrigatorio';
    end if;
    v_state := jsonb_set(v_state, '{results}', coalesce(v_state->'results','{}'::jsonb) - v_mid, true);
    v_state := jsonb_set(v_state, '{deletedResults}',
                 (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
                    select jsonb_array_elements_text(coalesce(v_state->'deletedResults','[]'::jsonb)) as x
                    union select v_mid) u), true);

  elsif p_type = 'clear-all' then
    -- Limpeza preservando as entradas criadas HOJE em America/New_York, que e a regra que o app
    -- ja aplica (isToday em app.js:171-175).
    --
    -- DUAS CORRECOES DELIBERADAS ao comportamento atual, ambas autorizadas como defeito provado:
    --
    --   1. `deletedResults` era PERDIDO -- a chave nem existe em emptyState() -- de modo que uma
    --      lapide de resultado escrita por `--clear-result` sumia e o resultado errado podia
    --      voltar. Aqui ela e preservada.
    --   2. `deletedIds` era PERDIDO pelo mesmo motivo, e o efeito e pior: sem a lapide, um
    --      participante ja excluido RESSUSCITA na proxima uniao de merge vinda de qualquer
    --      navegador com cache velho. Aqui ela e preservada.
    --
    -- Preservar lapide nunca ressuscita dado; descarta-la sim. Por isso a correcao anda nesta
    -- direcao e nao na outra.
    select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_hoje
      from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
     where (e->>'createdAt') is not null
       and ((e->>'createdAt')::timestamptz at time zone 'America/New_York')::date
           = (v_agora at time zone 'America/New_York')::date;

    v_state := jsonb_build_object(
      'entries',        v_hoje,
      'deletedIds',     coalesce(v_state->'deletedIds', '[]'::jsonb),
      'deletedResults', coalesce(v_state->'deletedResults', '[]'::jsonb),
      -- `as t(e)` da nome a COLUNA. Sem isso `h->>'id'` referencia a tabela, nao o elemento, e a
      -- consulta nao compila -- que e o modo barulhento de errar. O silencioso seria manter o
      -- mapa `paid` inteiro e devolver marcas de pagamento de entradas que a limpeza removeu.
      'paid',           coalesce((select jsonb_object_agg(t.e->>'id', v_state->'paid'->(t.e->>'id'))
                                    from jsonb_array_elements(v_hoje) as t(e)
                                   where (v_state->'paid') ? (t.e->>'id')), '{}'::jsonb),
      'results',        '{}'::jsonb,
      'auditLog',       coalesce(v_state->'auditLog', '[]'::jsonb),
      'meta',           coalesce(v_state->'meta', '{}'::jsonb)
    );

  else
    raise exception 'copa_apply_operator_mutation: tipo desconhecido %', p_type;
  end if;

  -- ── auditoria e gravacao ──────────────────────────────────────────────
  -- A entrada carrega o client_ref, que e o que torna a idempotencia acima verificavel.
  v_state := jsonb_set(v_state, '{auditLog}',
    (jsonb_build_array(jsonb_build_object(
        'ts', v_iso, 'action', 'copa-op-' || p_type, 'admin', true,
        'actor', p_actor, 'clientRef', p_client_ref,
        'detail', p_payload - 'picks' - 'diagnostics'))
     || coalesce(v_state->'auditLog','[]'::jsonb)), true);

  update bolao_state set state = _bolao_touch(v_state), updated_at = v_agora where id = 'main';

  return jsonb_build_object('applied', true, 'type', p_type, 'clientRef', p_client_ref);
end
$$;

comment on function copa_apply_operator_mutation(text, jsonb, text, text) is
  'COPA2026 operator mutations, server-side. service_role only: the copa2026 browser is anon and its admin password guards the UI, not the database. Narrow per-type dispatch, never a whole-document write. Idempotent by client_ref.';

-- KPLUS-F059: toda funcao gerada revoga EXECUTE de PUBLIC.
revoke all on function copa_apply_operator_mutation(text, jsonb, text, text) from public;
revoke all on function copa_apply_operator_mutation(text, jsonb, text, text) from anon;
revoke all on function copa_apply_operator_mutation(text, jsonb, text, text) from authenticated;
grant execute on function copa_apply_operator_mutation(text, jsonb, text, text) to service_role;
