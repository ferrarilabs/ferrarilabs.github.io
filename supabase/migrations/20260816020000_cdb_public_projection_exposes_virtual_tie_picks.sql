--
-- 20260816020000_cdb_public_projection_exposes_virtual_tie_picks.sql
--
-- ═══ A PROJECAO PUBLICA APAGA CAMPEAO E VICE DE 5 PARTICIPANTES ══════════════════════════════
--
-- `bolao.read_document('cdb2026')` monta `entries[].picks.qualified` assim:
--
--     select jsonb_object_agg(ti.slug, p.predicted_qualified_side)
--       from bolao.predictions p
--       join bolao.ties ti on ti.tie_id = p.tie_id
--
-- Os slugs `sf-1`, `sf-2` e `final-1` NAO tem linha em `bolao.ties`: sao confrontos VIRTUAIS,
-- cuja composicao depende dos vencedores que cada participante escolheu. O join nao os produz, e
-- o palpite some da superficie que o navegador le.
--
-- Medido em 2026-08-16 (auditoria de persistencia ponta a ponta, 12 entradas reais):
--
--     documento autoritativo  5 entradas com 15 palpites, campeao e vice definidos
--     projecao publica        as mesmas 5 com 12 palpites, sem campeao, sem vice
--
-- Efeito hoje: ranking, card de podio, "Ver palpites" e CSV mostram campeao "—". Efeito quando a
-- final for jogada: `predictedPodium()` devolve null e os 30 + 20 pontos de bonus nao entram.
--
-- O DADO NAO ESTAVA EM RISCO em momento nenhum: o navegador nao grava mais o documento inteiro
-- (`saveState()` nao chama `saveRemoteState()` desde PLATFORM-CDB-BROWSER-WRITER), e o
-- participante edita a partir de `cdb_my_entry`, que le o documento autoritativo. Sempre foi
-- defeito de LEITURA.
--
-- O caminho de ESCRITA ja resolve isto desde `20260813180000`:
-- `bolao.cdb_authoritative_document()` remescla o residuo por cima do normalizado, com o
-- comentario "so a pick against a tie slug the bracket never registered survives instead of being
-- silently deleted on its owner's next save". Esta migracao aplica a MESMA expressao no caminho
-- de LEITURA. Nao ha regra nova: ha uma regra existente que faltava num dos dois lados.
--
-- ═══ POR QUE NENHUM TESTE PEGOU ══════════════════════════════════════════════════════════════
--
-- `bolao.cdb_mirror_entry_picks` monta a temporaria `_mirror_want` com o MESMO
-- `join bolao.ties` e depois compara `_mirror_want` com `bolao.predictions`. Os dois lados da
-- assercao passam pelo mesmo filtro, entao `MIRROR_DIVERGENCE` e estruturalmente incapaz de ficar
-- vermelha por esta causa. Registrado em `docs/bolao/CONSISTENCY_MATRIX.md` e em
-- `docs/bolao/LESSONS_LEARNED.md`.
--
-- ═══ O QUE ESTA MIGRACAO PODE E O QUE NAO PODE ═══════════════════════════════════════════════
--
-- PODE  expor palpite que JA ESTA GRAVADO no documento autoritativo.
-- NAO PODE criar, inferir, reparar, preencher ou alterar palpite nenhum.
--
-- A mescla e `legado || normalizado`, nesta ordem: o normalizado VENCE em qualquer chave que os
-- dois tenham. Ou seja, para todo confronto registrado a autoridade continua sendo o modelo
-- normalizado, sem excecao; so as chaves que existem UNICAMENTE no legado (os slugs virtuais)
-- atravessam. Toda chave do resultado vem de um documento gravado -- nenhuma e calculada aqui.
--
-- Consequencias exatas, e sao as pedidas:
--   entrada com bracket completo gravado      -> projecao completa
--   entrada legitimamente incompleta          -> continua incompleta (nada e preenchido)
--   entrada inexistente ou com tombstone      -> continua ausente (o laco itera o NORMALIZADO)
--
-- ENTRY_SET_CHANGED = NO por construcao: a funcao percorre as entradas que `read_document` ja
-- devolve e nunca acrescenta uma.
--
-- ═══ PRIVACIDADE ═════════════════════════════════════════════════════════════════════════════
--
-- `security definer` e necessario -- `anon` nao tem SELECT em `public.bolao_state` (Q38) e nao
-- pode ganhar. Entao a funcao e a superficie de risco, e e escrita para nao ter nenhuma:
--
--   * nao aceita argumento: o documento e literal 'cdb2026', nao ha parametro para envenenar;
--   * do legado le EXATAMENTE dois caminhos -- `picks.matches` e `picks.qualified` --, campo a
--     campo, por lista de permissao. `participantEmail`, `payerName`, `paymentMethod`,
--     `paymentTo`, `lastClientRef`, `diagnostics` e `auditLog` nunca sao nomeados;
--   * o restante do documento continua vindo inteiramente de `read_document`, que ja e a
--     superficie sanitizada publicada.
--
-- A assercao no fim da migracao le a saida real e recusa o commit se qualquer marcador privado
-- aparecer, ou se o conjunto de entradas mudar.
--
-- ROLLBACK: `20260816020000_..._exposes_virtual_tie_picks.rollback.sql` devolve a view a
-- `bolao.read_document` direto e derruba a funcao. Reverter faz campeao e vice sumirem de novo
-- para as 5 entradas -- e o comportamento anterior, nao um efeito colateral.

begin;

create or replace function bolao.cdb_public_document()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_norm    jsonb := bolao.read_document('cdb2026');
  v_legacy  jsonb;
  v_entries jsonb := '[]'::jsonb;
  e  jsonb;
  le jsonb;
begin
  if v_norm is null then
    return null;
  end if;

  select s.state into v_legacy from public.bolao_state s where s.id = 'cdb2026';
  if v_legacy is null then
    -- Sem documento legado nao ha residuo para expor. Devolver o normalizado como esta e o
    -- comportamento anterior, que e correto -- nao ha nada a inventar.
    return v_norm;
  end if;

  for e in select jsonb_array_elements(coalesce(v_norm->'entries', '[]'::jsonb)) loop
    -- Casamento por ID, nunca por posicao.
    select le2 into le
      from jsonb_array_elements(coalesce(v_legacy->'entries', '[]'::jsonb)) le2
     where le2->>'id' = e->>'id'
     limit 1;

    if le is not null then
      -- `legado || normalizado`: o normalizado VENCE toda chave que os dois tenham. So o que
      -- existe unicamente no legado -- os slugs virtuais -- atravessa.
      e := e || jsonb_build_object('picks', jsonb_build_object(
             'matches',   coalesce(le->'picks'->'matches',   '{}'::jsonb)
                       || coalesce(e ->'picks'->'matches',   '{}'::jsonb),
             'qualified', coalesce(le->'picks'->'qualified', '{}'::jsonb)
                       || coalesce(e ->'picks'->'qualified', '{}'::jsonb)));
    end if;

    v_entries := v_entries || jsonb_build_array(e);
    le := null;
  end loop;

  return v_norm || jsonb_build_object('entries', v_entries);
end
$$;

comment on function bolao.cdb_public_document() is
  'Superficie publica do cdb2026: bolao.read_document(''cdb2026'') mais os palpites gravados '
  'contra confronto VIRTUAL (sf-1/sf-2/final-1), que o modelo normalizado nao consegue guardar '
  'porque nao ha linha em bolao.ties. Mescla legado||normalizado, entao o normalizado vence '
  'qualquer chave em comum. Expoe palpite ja gravado; nunca cria, infere ou altera. Do documento '
  'legado le somente picks.matches e picks.qualified.';

revoke all on function bolao.cdb_public_document() from public;
grant execute on function bolao.cdb_public_document() to anon, authenticated, service_role;

-- A view troca so a linha do cdb2026. br2026 e copa2026 continuam em `read_document` -- nenhum
-- dos dois tem fase derivada, entao nenhum dos dois tem residuo a expor, e mexer neles seria
-- mudanca sem causa.
create or replace view public.bolao_state_normalized_public
with (security_invoker = true) as
select
  d.doc_id as id,
  case when d.slug = 'cdb2026' then bolao.cdb_public_document()
       else bolao.read_document(d.slug) end as state,
  null::timestamptz as updated_at
from (values
  ('cdb2026', 'cdb2026'),
  ('br2026', 'br2026'),
  ('copa2026', 'main')
) as d(slug, doc_id);

comment on view public.bolao_state_normalized_public is
  'Sanitized public read surface in the legacy (id, state, updated_at) contract, so a client '
  'readTable can be re-pointed here with no application code change. Emits only whitelisted '
  'fields: no email, payer, payment method, payment reference, auth user id, ip, user agent, '
  'device metadata, lineage or provenance. updated_at is deliberately NULL. cdb2026 is served by '
  'bolao.cdb_public_document(), which additionally exposes picks stored against virtual tie slugs '
  '(sf-1/sf-2/final-1) that the normalized model cannot hold.';

revoke all on table public.bolao_state_normalized_public from public;
grant select on table public.bolao_state_normalized_public to anon, authenticated;

-- ── PROVA, DENTRO DA PROPRIA MIGRACAO ───────────────────────────────────────────────────────
--
-- Le a saida REAL da projecao e recusa o commit se ela tiver mudado o que nao devia. Uma
-- migracao que so cria funcao e troca uma view e curta o bastante para parecer obviamente
-- segura, e e exatamente esse tipo que passa sem ninguem medir.
do $verify$
declare
  v_antes  jsonb := bolao.read_document('cdb2026');
  v_depois jsonb := bolao.cdb_public_document();
  v_txt    text  := v_depois::text;
  v_marca  text;
  v_a int; v_d int;
  v_extra int;
begin
  -- (1) o conjunto de entradas NAO muda
  v_a := jsonb_array_length(coalesce(v_antes->'entries','[]'::jsonb));
  v_d := jsonb_array_length(coalesce(v_depois->'entries','[]'::jsonb));
  if v_a <> v_d then
    raise exception 'ENTRY_SET_CHANGED: % -> %', v_a, v_d;
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_depois->'entries','[]'::jsonb)) d
     where not exists (select 1 from jsonb_array_elements(coalesce(v_antes->'entries','[]'::jsonb)) a
                        where a->>'id' = d->>'id')) then
    raise exception 'ENTRY_SET_CHANGED: entrada nova apareceu na projecao';
  end if;

  -- (2) nenhum campo privado atravessou
  foreach v_marca in array array['participantEmail', 'payerName', 'paymentMethod', 'paymentTo',
                                 'lastClientRef', 'accessToken', 'tokenHash', 'auditLog',
                                 'userAgent', 'diagnostics'] loop
    if position(v_marca in v_txt) > 0 then
      raise exception 'PII_NA_PROJECAO: % atravessou', v_marca;
    end if;
  end loop;

  -- (3) NADA FOI FABRICADO: toda chave de palpite da saida tem de existir no documento
  -- autoritativo com o MESMO valor. Este e o teste que separa "expor" de "inventar".
  select count(*) into v_extra
    from jsonb_array_elements(coalesce(v_depois->'entries','[]'::jsonb)) d
    cross join lateral jsonb_each_text(coalesce(d->'picks'->'qualified','{}'::jsonb)) q(k, v)
   where not exists (
     select 1 from public.bolao_state s,
                  jsonb_array_elements(coalesce(s.state->'entries','[]'::jsonb)) le
      where s.id = 'cdb2026' and le->>'id' = d->>'id'
        and le->'picks'->'qualified'->>q.k = q.v);
  if v_extra > 0 then
    raise exception 'FABRICATED_PICKS: % classificados na projecao sem origem no documento autoritativo', v_extra;
  end if;

  -- (4) e o inverso do defeito: quem tem final-1 gravado passa a te-lo na projecao
  select count(*) into v_extra
    from public.bolao_state s,
         jsonb_array_elements(coalesce(s.state->'entries','[]'::jsonb)) le
   where s.id = 'cdb2026'
     and le->'picks'->'qualified' ? 'final-1'
     and not exists (
       select 1 from jsonb_array_elements(coalesce(v_depois->'entries','[]'::jsonb)) d
        where d->>'id' = le->>'id' and d->'picks'->'qualified' ? 'final-1');
  if v_extra > 0 then
    raise exception 'PROJECAO_AINDA_PERDE_FINAL: % entradas', v_extra;
  end if;

  raise notice 'projecao cdb2026: % entradas, 0 fabricadas, 0 PII, final-1 preservada', v_d;
end
$verify$;

commit;

select 'projecao publica do cdb2026 passa a expor palpite contra confronto virtual' as resultado;
